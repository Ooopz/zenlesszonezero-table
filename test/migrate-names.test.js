// test/migrate-names.test.js —— 就地迁移脚本的纯变换函数（内联 fixture，不写盘）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNameIndexes,
  migrateLibrary,
  migrateWorkshopEntries,
  migrateGradRoles,
  migrateCharacters,
  migratePlans,
} from '../src/sync/normalize-names.js';

// 小型 library fixture（键 === name，供 resolver 作标准名权威）
const LIB = {
  characters: {
    维琳娜·艾嘉德: { name: '维琳娜·艾嘉德' },
    '「11号」': { name: '「11号」' },
    亚历山德丽娜·莎芭丝缇安: { name: '亚历山德丽娜·莎芭丝缇安' },
    星徽·比利·奇德: { name: '星徽·比利·奇德' },
    比利·奇德: { name: '比利·奇德' },
    猫宫又奈: { name: '猫宫又奈' },
  },
  wengines: {
    德玛拉电池Ⅱ型: { name: '德玛拉电池Ⅱ型' },
    防暴者Ⅵ型: { name: '防暴者Ⅵ型' },
  },
  discs: {
    棘刺玫瑰: { name: '棘刺玫瑰' },
    雪兔梦游仙境: { name: '雪兔梦游仙境' },
    如影相随: { name: '如影相随' },
    啄木鸟电音: { name: '啄木鸟电音' },
  },
};
const idx = buildNameIndexes(LIB);

test('migrateLibrary：set2/subStats 属性键归一（风属性伤害→风属性伤害加成）', () => {
  const lib = {
    discs: { 呼啸沙龙: { set2: { 风属性伤害: 0.12, 攻击力: 30 } } },
    wengines: { 某音擎: { subStats: { 闪能自动累积: 1.2 } } },
  };
  const r = migrateLibrary(lib);
  assert.deepEqual(r.data.discs.呼啸沙龙.set2, { 风属性伤害加成: 0.12, 攻击力: 30 });
  assert.deepEqual(r.data.wengines.某音擎.subStats, { 能量自动回复: 1.2 });
  assert.equal(r.changes, 2);
  assert.equal(migrateLibrary(r.data).changes, 0, '幂等');
});

test('migrateWorkshopEntries：音擎 ASCII 罗马 / 盘尾随空格 / 面板属性名', () => {
  const entries = [
    {
      weapon: { name: '德玛拉电池II型' },
      equips: [{ suit: '雪兔梦游仙境 ' }],
      panel: [{ name: '闪能自动累积', final: '1.2' }],
    },
  ];
  const r = migrateWorkshopEntries(entries, idx);
  assert.equal(r.data[0].weapon.name, '德玛拉电池Ⅱ型');
  assert.equal(r.data[0].equips[0].suit, '雪兔梦游仙境');
  assert.equal(r.data[0].panel[0].name, '能量自动回复');
  assert.ok(r.changes >= 3);
  assert.equal(migrateWorkshopEntries(r.data, idx).changes, 0, '幂等');
});

test('migrateGradRoles：角色简称/音擎罗马/套装名 + 组合名按 4 件套在前重组', () => {
  const roles = [
    {
      name: '维琳娜',
      weapons: [{ name: '防暴者VI型' }],
      relics: [
        { name: '啄木鸟电音2+如影相随4', sets: [{ name: '啄木鸟电音', num: 2 }, { name: '如影相随', num: 4 }] },
      ],
    },
    { name: '亚历山德丽娜·莎芭丝提安', weapons: [], relics: [] },
    { name: '11号', weapons: [], relics: [] },
    { name: '星徽·比利', weapons: [], relics: [] },
    { name: '比利·奇德', weapons: [], relics: [] },
  ];
  const r = migrateGradRoles(roles, idx);
  assert.equal(r.data[0].name, '维琳娜·艾嘉德', '角色简称 → 全名');
  assert.equal(r.data[0].weapons[0].name, '防暴者Ⅵ型', '音擎 ASCII 罗马 → Unicode');
  assert.equal(r.data[0].relics[0].name, '如影相随4+啄木鸟电音2', '组合名 4 件套在前');
  assert.deepEqual(
    r.data[0].relics[0].sets.map((s) => s.name),
    ['如影相随', '啄木鸟电音'],
    'sets 数组也按 4 件套在前'
  );
  assert.equal(r.data[1].name, '亚历山德丽娜·莎芭丝缇安', '提→缇');
  assert.equal(r.data[2].name, '「11号」', '缺书名号');
  assert.equal(r.data[3].name, '星徽·比利·奇德', '别名抢占歧义');
  assert.equal(r.data[4].name, '比利·奇德', '精确命中自己，不误判星徽·比利·奇德');
  assert.equal(migrateGradRoles(r.data, idx).changes, 0, '幂等');
});

test('migrateCharacters：音擎/盘名归一，占位名保留', () => {
  const chars = [
    {
      name: '某人',
      wengine: { name: '德玛拉电池II型' },
      discs: [{ set: '棘刺玫瑰' }, { set: '未佩戴驱动盘' }, { set: '未知' }],
    },
    { name: '未戴音擎者', wengine: { name: '未佩戴音擎' }, discs: [] },
  ];
  const r = migrateCharacters(chars, idx);
  assert.equal(r.data[0].wengine.name, '德玛拉电池Ⅱ型');
  assert.equal(r.data[0].discs[0].set, '棘刺玫瑰');
  assert.equal(r.data[0].discs[1].set, '未佩戴驱动盘', '占位保留');
  assert.equal(r.data[0].discs[2].set, '未知', '占位保留');
  assert.equal(r.data[1].wengine.name, '未佩戴音擎', '占位保留');
  assert.equal(migrateCharacters(r.data, idx).changes, 0, '幂等');
});

test('migratePlans：角色/音擎主备/套装/配队名', () => {
  const plans = {
    1011: {
      name: '星见 雅',
      plans: [
        {
          weapon: { main: '德玛拉电池II型', backup: '防暴者VI型' },
          sets: [{ name: '荆棘玫瑰', cnt: 4 }],
          team: ['猫宫 又奈'],
        },
      ],
    },
  };
  const r = migratePlans(plans, idx);
  const p = r.data[1011];
  assert.equal(p.name, '星见 雅', '角色名未在 fixture library 中则保留原样（不误改）');
  assert.equal(p.plans[0].weapon.main, '德玛拉电池Ⅱ型');
  assert.equal(p.plans[0].weapon.backup, '防暴者Ⅵ型');
  assert.equal(p.plans[0].sets[0].name, '棘刺玫瑰', '荆棘玫瑰→棘刺玫瑰');
  assert.deepEqual(p.plans[0].team, ['猫宫又奈'], '配队去空格归一');
  assert.equal(migratePlans(r.data, idx).changes, 0, '幂等');
});
