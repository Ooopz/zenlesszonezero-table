// test/discstats.test.js —— 驱动盘统计聚合逻辑
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscStats } from '../src/lib/discstats.js';
import { loadDataFile } from './helpers.js';

// 内联 fixture：两个角色共 3 个方案，覆盖 2 件套/4 件套、同盘多方案、不同副词条组合
const FIXTURE = {
  1011: {
    name: '安比',
    plans: [
      {
        sets: [
          { name: '震星迪斯科', cnt: 4 },
          { name: '摇摆爵士', cnt: 2 },
        ],
        subStats: ['暴击率', '暴击伤害', '攻击力%'],
        mainProps: { 4: '暴击率', 5: '电属性伤害加成', 6: '冲击力' },
      },
      {
        sets: [
          { name: '震星迪斯科', cnt: 4 },
          { name: '摇摆爵士', cnt: 2 },
        ],
        subStats: ['暴击率', '暴击伤害', '攻击力%', '穿透值'],
        mainProps: { 4: '暴击率', 5: '攻击力%', 6: '冲击力' },
      },
    ],
  },
  1012: {
    name: '妮可',
    plans: [
      {
        sets: [{ name: '摇摆爵士', cnt: 4 }],
        subStats: ['能量自动回复', '攻击力%'],
        mainProps: { 4: '攻击力%', 5: '以太属性伤害加成', 6: '能量自动回复' },
      },
    ],
  },
};

test('按驱动盘聚合：匹配角色 / 副词条组合去重 / 456 主属性去重', () => {
  const rows = computeDiscStats(FIXTURE, ['震星迪斯科', '摇摆爵士', '无人用']);
  assert.equal(rows.length, 3);

  const d = rows.find((r) => r.name === '震星迪斯科');
  assert.deepEqual(d.characters, ['安比']); // 只有安比的方案用 4 件套
  assert.equal(d.subCombos.length, 2); // 两个方案的副词条组合不同 → 各保留
  // 组合内已按内容排序规范化（忽略组内顺序）
  assert.deepEqual(d.subCombos[0], ['攻击力%', '暴击伤害', '暴击率']);
  assert.deepEqual(d.subCombos[1], ['攻击力%', '暴击伤害', '暴击率', '穿透值']);
  assert.deepEqual(d.main4, ['暴击率']); // 两方案 4 号位相同 → 去重
  assert.deepEqual(d.main5, ['电属性伤害加成', '攻击力%']); // 两方案不同 → 都保留
  assert.deepEqual(d.main6, ['冲击力']);

  const y = rows.find((r) => r.name === '摇摆爵士');
  assert.deepEqual(y.characters, ['安比', '妮可']); // 安比 2 件套 + 妮可 4 件套
  assert.equal(y.subCombos.length, 3); // 安比两方案 + 妮可一方案
  assert.deepEqual(y.main4, ['暴击率', '攻击力%']);

  const n = rows.find((r) => r.name === '无人用');
  assert.deepEqual(n.characters, []);
  assert.deepEqual(n.subCombos, []);
  assert.deepEqual(n.main4, []);
  assert.deepEqual(n.main5, []);
  assert.deepEqual(n.main6, []);
});

test('副词条组合按内容去重，忽略组内排序', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          { sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击率', '暴击伤害', '攻击力%'], mainProps: {} },
          { sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击伤害', '暴击率', '攻击力%'], mainProps: {} },
        ],
      },
    },
    ['某盘']
  );
  // 两组内容一致仅排序不同 → 去重为 1 组，展示为排序后的规范顺序
  assert.equal(rows[0].subCombos.length, 1);
  assert.deepEqual(rows[0].subCombos[0], ['攻击力%', '暴击伤害', '暴击率']);
});

test('套装名去标点/空白归一化匹配（plans 侧尾随空格也能命中 library 键）', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '照',
        plans: [{ sets: [{ name: '雪兔梦游仙境 ', cnt: 4 }], subStats: ['暴击率'], mainProps: { 4: '暴击率' } }],
      },
    },
    ['雪兔梦游仙境']
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '雪兔梦游仙境'); // 展示用 library 侧规范名，不带空格
  assert.deepEqual(rows[0].characters, ['照']);
  assert.equal(rows[0].subCombos.length, 1);
});

test('已知别名也能命中（荆棘玫瑰→棘刺玫瑰，养成指南用词差异）', () => {
  const rows = computeDiscStats(
    { a: { name: '本·比格', plans: [{ sets: [{ name: '荆棘玫瑰', cnt: 4 }], subStats: ['暴击率'], mainProps: {} }] } },
    ['棘刺玫瑰']
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '棘刺玫瑰');
  assert.deepEqual(rows[0].characters, ['本·比格']);
});

test('只统计 cnt 2/4 件套，其他件数忽略', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          {
            sets: [
              { name: '某盘', cnt: 1 },
              { name: '某盘', cnt: 3 },
            ],
            subStats: ['暴击率'],
            mainProps: { 4: '暴击率' },
          },
        ],
      },
    },
    ['某盘']
  );
  assert.deepEqual(rows[0].characters, []);
  assert.deepEqual(rows[0].subCombos, []);
  assert.deepEqual(rows[0].main4, []);
});

test('未知套装名（不在 discNames 内）跳过；无方案数据返回全空行', () => {
  const rows = computeDiscStats(
    {
      a: { name: '角色A', plans: [{ sets: [{ name: '不存在', cnt: 4 }], subStats: ['暴击率'], mainProps: {} }] },
    },
    ['已知盘']
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].characters, []);

  const empty = computeDiscStats({}, ['盘1', '盘2']);
  assert.equal(empty.length, 2);
  assert.deepEqual(empty[0].characters, []);
  assert.deepEqual(empty[0].subCombos, []);
});

test('真实数据冒烟：plans.json 每套驱动盘都有聚合行且去重不报错', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const rows = computeDiscStats(plans, Object.keys(lib.discs || {}));
  assert.equal(rows.length, Object.keys(lib.discs).length);
  for (const r of rows) {
    assert.ok(Array.isArray(r.characters));
    assert.ok(Array.isArray(r.subCombos));
    // 副词条组合本身无重复
    const keys = new Set(r.subCombos.map((c) => JSON.stringify(c)));
    assert.equal(keys.size, r.subCombos.length);
  }
});
