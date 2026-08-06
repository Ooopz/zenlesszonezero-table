import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibrary, validateCharacters, validateCharacter, KEYS } from '../src/lib/schema.js';
import { loadDataFile } from './helpers.js';

function readData(name) {
  const hint =
    name === 'library.json'
      ? 'npm run sync:library（或网页「更新数据库」）'
      : 'npm run sync:characters（或网页「更新我的角色」）';
  return loadDataFile(name, hint);
}

test('KEYS 键名定义完整', () => {
  assert.equal(KEYS.NAME, 'name');
  assert.equal(KEYS.MAIN_STATS, 'mainStats');
  assert.equal(KEYS.MAX_LEVEL, 'maxLevel');
  assert.equal(KEYS.CHAR_TARGETS, 'charTargets');
});

test('validateLibrary 对现有属性库通过', () => {
  const errors = validateLibrary(readData('library.json'));
  assert.deepEqual(errors, []);
});

test('validateLibrary 发现各类条目缺 name / 非对象', () => {
  const bad = {
    characters: { '角色X': { id: '1' } }, // 缺 name
    wengines: { '音擎X': null }, // 非对象
    discs: {},
    bangboos: { '邦布X': { name: '' } }, // name 为空
  };
  const errors = validateLibrary(bad);
  assert.ok(errors.some((e) => e.includes('角色X') && e.includes('缺 name')), `角色缺 name：${errors}`);
  assert.ok(errors.some((e) => e.includes('音擎X') && e.includes('非对象')), `音擎非对象：${errors}`);
  assert.ok(errors.some((e) => e.includes('邦布X') && e.includes('缺 name')), `邦布缺 name：${errors}`);
});

test('validateCharacters 对现有角色数据通过', () => {
  const errors = validateCharacters(readData('characters.json'));
  assert.deepEqual(errors, []);
});

test('validateCharacter 能发现缺 name 的异常', () => {
  assert.notEqual(validateCharacter({ id: '1' }).length, 0);
  assert.deepEqual(validateCharacter(null), ['角色应为对象']);
});

test('validateCharacters 拒绝非数组', () => {
  assert.deepEqual(validateCharacters({}), ['角色数据应为数组']);
});

test('柏妮思·怀特 满级数据完整（wiki 满级行名为「满级数据」，解析需容错）', () => {
  const c = readData('library.json').characters['柏妮思·怀特'];
  assert.ok(c.maxLevel['生命值'] > 0, '满级生命值应 > 0');
  assert.ok(c.maxLevel['攻击力'] > 0, '满级攻击力应 > 0');
  assert.ok(c.maxLevel['防御力'] > 0, '满级防御力应 > 0');
});
