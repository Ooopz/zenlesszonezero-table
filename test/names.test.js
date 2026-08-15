// test/names.test.js —— 统一名称解析：别名 / 罗马数字 / 归一化键 / 子串兜底 / 歧义确定性
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNameIndex,
  resolveName,
  resolveEntry,
  canonicalName,
  CATEGORY,
  CHAR_ALIASES,
  DISC_ALIASES,
} from '../src/lib/names.js';

// 内联 library 风格 fixture（键 === name）
const CHARS = {
  维琳娜·艾嘉德: { name: '维琳娜·艾嘉德' },
  '「11号」': { name: '「11号」' },
  亚历山德丽娜·莎芭丝缇安: { name: '亚历山德丽娜·莎芭丝缇安' },
  星徽·比利·奇德: { name: '星徽·比利·奇德' },
  比利·奇德: { name: '比利·奇德' },
};
const WENGINES = {
  德玛拉电池Ⅱ型: { name: '德玛拉电池Ⅱ型' },
  '「残响」-Ⅰ型': { name: '「残响」-Ⅰ型' },
  '「残响」-Ⅱ型': { name: '「残响」-Ⅱ型' },
  '「残响」-Ⅲ型': { name: '「残响」-Ⅲ型' },
};
const DISCS = { 荆棘玫瑰: { name: '荆棘玫瑰' }, 震星迪斯科: { name: '震星迪斯科' } };

test('buildNameIndex 支持对象与数组两种形态', () => {
  const obj = buildNameIndex(CHARS, CATEGORY.CHAR);
  assert.equal(obj.lib, CHARS);
  assert.ok(obj.byKey.has('维琳娜艾嘉德'));
  const arr = buildNameIndex(Object.keys(CHARS), CATEGORY.CHAR);
  assert.equal(arr.lib, null);
  assert.ok(arr.byKey.has('维琳娜艾嘉德'));
});

test('解析优先级：精确 → 别名(原串) → 别名(归一键) → 归一化键 → 子串(char)', () => {
  const idx = buildNameIndex(CHARS, CATEGORY.CHAR);
  assert.equal(resolveName(CATEGORY.CHAR, idx, '比利·奇德').name, '比利·奇德', '精确，不误判到星徽·比利·奇德');
  assert.equal(resolveName(CATEGORY.CHAR, idx, '维琳娜').name, '维琳娜·艾嘉德', '别名原串');
  assert.equal(resolveName(CATEGORY.CHAR, idx, '亚历山德丽娜·莎芭丝提安').name, '亚历山德丽娜·莎芭丝缇安', '提→缇');
  assert.equal(resolveName(CATEGORY.CHAR, idx, '星徽·比利').name, '星徽·比利·奇德', '别名抢占歧义');
  assert.equal(resolveName(CATEGORY.CHAR, idx, '11号').name, '「11号」', '归一化键命中');
  assert.equal(resolveName(CATEGORY.CHAR, idx, '维琳娜·艾嘉德').matchedBy, 'exact');
  assert.equal(resolveName(CATEGORY.CHAR, idx, '不存在的角色'), null);
});

test('角色别名表覆盖 4 个工坊变体', () => {
  assert.equal(CHAR_ALIASES['维琳娜'], '维琳娜·艾嘉德');
  assert.equal(CHAR_ALIASES['星徽·比利'], '星徽·比利·奇德');
  assert.equal(CHAR_ALIASES['亚历山德丽娜·莎芭丝提安'], '亚历山德丽娜·莎芭丝缇安');
  assert.equal(CHAR_ALIASES['11号'], '「11号」');
});

test('wengine：ASCII 罗马数字解析到 Unicode 规范名，Ⅰ/Ⅱ/Ⅲ 不碰撞', () => {
  const idx = buildNameIndex(WENGINES, CATEGORY.WENGINE);
  assert.equal(resolveName(CATEGORY.WENGINE, idx, '德玛拉电池II型').name, '德玛拉电池Ⅱ型');
  assert.equal(resolveName(CATEGORY.WENGINE, idx, '残响-II型').name, '「残响」-Ⅱ型', '括号差异 + 罗马');
  assert.equal(resolveName(CATEGORY.WENGINE, idx, '残响I型').name, '「残响」-Ⅰ型');
  assert.equal(resolveName(CATEGORY.WENGINE, idx, '残响III型').name, '「残响」-Ⅲ型');
  assert.notEqual(
    resolveName(CATEGORY.WENGINE, idx, '残响-I型').name,
    resolveName(CATEGORY.WENGINE, idx, '残响II型').name,
    'Ⅰ/Ⅱ 不互相碰撞'
  );
});

test('disc：旧名别名 + 尾随空格', () => {
  const idx = buildNameIndex(DISCS, CATEGORY.DISC);
  assert.equal(resolveName(CATEGORY.DISC, idx, '棘刺玫瑰').name, '荆棘玫瑰', '旧名别名（wiki 改名前的历史数据）');
  assert.equal(resolveName(CATEGORY.DISC, idx, '震星迪斯科 ').name, '震星迪斯科', 'normalize 剥空白');
  assert.equal(DISC_ALIASES['棘刺玫瑰'], '荆棘玫瑰');
});

test('fuzzy 子串仅 char 开启', () => {
  const cidx = buildNameIndex(CHARS, CATEGORY.CHAR);
  const widx = buildNameIndex(WENGINES, CATEGORY.WENGINE);
  assert.ok(resolveName(CATEGORY.CHAR, cidx, '维琳娜·艾嘉'), 'char 默认 fuzzy 子串命中');
  assert.equal(resolveName(CATEGORY.WENGINE, widx, '电池'), null, 'wengine 默认不做 fuzzy（会误命中）');
  assert.equal(resolveName(CATEGORY.CHAR, cidx, '维琳娜·艾嘉', { fuzzy: false }), null, '显式关闭 fuzzy');
});

test('别名过滤：规范名不在集合内的别名被跳过', () => {
  const idx = buildNameIndex({ 其他角色: { name: '其他角色' } }, CATEGORY.CHAR);
  assert.equal(resolveName(CATEGORY.CHAR, idx, '维琳娜'), null, '维琳娜·艾嘉德 不在集合');
});

test('canonicalName / resolveEntry / 空值与 null', () => {
  const idx = buildNameIndex(CHARS, CATEGORY.CHAR);
  assert.equal(canonicalName(CATEGORY.CHAR, idx, '维琳娜'), '维琳娜·艾嘉德');
  assert.deepEqual(resolveEntry(CATEGORY.CHAR, idx, '维琳娜'), { name: '维琳娜·艾嘉德' });
  assert.equal(canonicalName(CATEGORY.CHAR, idx, ''), null);
  assert.equal(canonicalName(CATEGORY.CHAR, idx, null), null);
  assert.equal(resolveEntry(CATEGORY.CHAR, null, '维琳娜'), null);
});
