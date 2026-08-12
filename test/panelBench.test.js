// test/panelBench.test.js —— 面板对标三源合并（推荐 high 档 / 玩家真实样本 / 我的）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  traitKeyStats,
  TRAIT_KEY_STATS,
  computeRecHighStats,
  buildPanelBenchmark,
} from '../src/lib/panelBench.js';
import { loadDataFile } from './helpers.js';

const PLANS = {
  1001: {
    name: '艾莲',
    plans: [
      {
        panel: [
          { name: '攻击力', low: 2000, mid: 2500, high: 3000 },
          { name: '暴击率', low: 0.5, mid: 0.6, high: 0.7 },
          { name: '暴击伤害', low: 0.8, mid: 1.0, high: 1.2 },
          { name: '穿透率', low: 0, mid: 0.2, high: 0.4 },
        ],
      },
      {
        panel: [
          { name: '攻击力', low: 2100, mid: 2600, high: 3100 },
          { name: '暴击率', low: 0.52, mid: 0.62, high: 0.72 },
        ],
      },
    ],
  },
  1002: {
    name: '苍角',
    plans: [
      {
        panel: [
          { name: '攻击力', low: 1500, mid: 1800, high: 2100 },
          { name: '异常精通', low: 100, mid: 120, high: 140 },
        ],
      },
    ],
  },
};
const SAMPLE = {
  艾莲: {
    攻击力: { count: 50, min: 2200, max: 3200, mean: 2700, median: 2650 },
    暴击率: { count: 50, min: 0.5, max: 0.8, mean: 0.65, median: 0.64 },
    暴击伤害: { count: 50, min: 0.8, max: 1.4, mean: 1.1, median: 1.08 },
    穿透率: { count: 50, min: 0, max: 0.5, mean: 0.25, median: 0.24 },
  },
  苍角: {
    攻击力: { count: 40, min: 1400, max: 2200, mean: 1800, median: 1750 },
    异常精通: { count: 40, min: 90, max: 160, mean: 120, median: 118 },
  },
};
const MINE = { 艾莲: { 攻击力: 2400, 暴击率: 0.55 } };
const TRAIT = { 艾莲: '强攻', 苍角: '异常' };

test('traitKeyStats：各特性模板正确，未知特性回退通用', () => {
  assert.deepEqual(traitKeyStats('强攻'), TRAIT_KEY_STATS.强攻);
  assert.deepEqual(traitKeyStats('异常'), ['攻击力', '异常精通', '异常掌控']);
  assert.deepEqual(traitKeyStats('未知特性'), ['攻击力', '暴击率', '暴击伤害']);
});

test('computeRecHighStats：对方案 high 档聚合 min/max/mean/median', () => {
  const rec = computeRecHighStats(PLANS);
  const atk = rec['艾莲']['攻击力'];
  // 两个方案的 high：3000、3100 → mean/median 3050
  assert.equal(atk.count, 2);
  assert.equal(atk.min, 3000);
  assert.equal(atk.max, 3100);
  assert.equal(atk.mean, 3050);
  assert.equal(atk.median, 3050); // 偶数样本取相邻均值
  const crit = rec['艾莲']['暴击率'];
  assert.equal(crit.count, 2);
  assert.ok(Math.abs(crit.mean - 0.71) < 1e-9);
  assert.equal(rec['苍角']['异常精通'].count, 1);
  assert.equal(rec['苍角']['异常精通'].median, 140);
});

test('buildPanelBenchmark：特性模板排前 + 三源合并 + keyAttrs', () => {
  const rows = buildPanelBenchmark(PLANS, SAMPLE, MINE, TRAIT);
  const ai = rows.find((r) => r.name === '艾莲');
  assert.equal(ai.trait, '强攻');
  assert.equal(ai.planCount, 2);
  assert.deepEqual(ai.keyAttrs, ['攻击力', '暴击率', '暴击伤害', '穿透率']);
  assert.deepEqual(Object.keys(ai.stats), ['攻击力', '暴击率', '暴击伤害', '穿透率']);
  const atk = ai.stats['攻击力'];
  assert.deepEqual(atk.rec, { count: 2, min: 3000, max: 3100, mean: 3050, median: 3050 });
  assert.deepEqual(atk.ws, SAMPLE['艾莲']['攻击力']);
  assert.equal(atk.mine, 2400);
  assert.equal(ai.stats['暴击率'].mine, 0.55);
  const cj = rows.find((r) => r.name === '苍角');
  assert.equal(cj.trait, '异常');
  assert.deepEqual(Object.keys(cj.stats), ['攻击力', '异常精通']); // 掌控无数据不加入
  assert.equal(cj.stats['异常精通'].mine, null); // 非账号角色无 mine
});

test('buildPanelBenchmark：展示全部有数据属性，关键属性标记并排前', () => {
  const manyAttr = {
    2001: {
      name: '多属性角色',
      plans: [
        {
          panel: [
            { name: '攻击力', low: 1, mid: 2, high: 3 },
            { name: '暴击率', low: 0.5, mid: 0.6, high: 0.7 },
            { name: '暴击伤害', low: 0.8, mid: 1, high: 1.2 },
            { name: '异常精通', low: 1, mid: 2, high: 3 },
            { name: '异常掌控', low: 1, mid: 2, high: 3 },
            { name: '冲击力', low: 1, mid: 2, high: 3 },
            { name: '能量自动回复', low: 1, mid: 2, high: 3 },
          ],
        },
      ],
    },
  };
  const rows = buildPanelBenchmark(manyAttr, {}, {}, { '多属性角色': '强攻' });
  const r = rows[0];
  assert.equal(Object.keys(r.stats).length, 7); // 全部属性都展示
  assert.deepEqual(r.keyAttrs, ['攻击力', '暴击率', '暴击伤害']); // 穿透率无数据不标记
  assert.equal(Object.keys(r.stats)[0], '攻击力'); // 关键属性排前
});

test('真实数据冒烟：三源合并不报错、每属性有来源', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const stats = loadDataFile('workshop-stats.json', 'node src/sync/workshop.js');
  const grad = loadDataFile('workshop-grad.json', 'node src/sync/workshop.js');
  const chars = loadDataFile('characters.json', 'npm run sync:characters');
  const traitMap = {};
  for (const c of Object.values(lib.characters || {})) {
    traitMap[c.name] = c.trait;
    for (const v of Object.values(plans)) if (v.name && v.name !== c.name && v.name.includes(c.name)) traitMap[v.name] = c.trait;
  }
  const myFinalMap = {};
  for (const c of chars || []) myFinalMap[c.name] = c.panel || {};
  const idName = new Map((grad.roles || []).map((r) => [String(r.item_id), r.name]));
  const sampleMap = {};
  for (const p of stats.panels || []) {
    const nm = idName.get(String(p.name));
    if (nm) sampleMap[nm] = p.stats; // 真实样本统计 {属性:{count,min,max,mean,median}}
  }
  const rows = buildPanelBenchmark(plans, sampleMap, myFinalMap, traitMap);
  assert.ok(rows.length > 0);
  const sample = rows.find((r) => Object.keys(r.stats).length);
  assert.ok(sample, '有角色带关键属性');
  for (const [attr, v] of Object.entries(sample.stats)) {
    // 每属性至少一个来源；推荐 rec/样本 ws 为统计对象
    assert.ok(v.rec || v.ws || v.mine != null, `${sample.name} 的 ${attr} 应有至少一个来源`);
    if (v.rec) assert.ok('median' in v.rec);
    if (v.ws) assert.ok('median' in v.ws && 'count' in v.ws);
    assert.ok(attr);
  }
});
