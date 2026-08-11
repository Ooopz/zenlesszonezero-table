// test/panelRange.test.js —— 角色面板推荐区间（三档各取中位）聚合逻辑
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePanelRanges } from '../src/lib/panelRange.js';
import { loadDataFile } from './helpers.js';

const FIXTURE = {
  1011: {
    name: '安比',
    plans: [
      {
        panel: [
          { name: '攻击力', percent: false, low: 1200, mid: 1600, high: 2000 },
          { name: '暴击率', percent: true, low: 0.2, mid: 0.4, high: 0.6 },
        ],
      },
      {
        panel: [
          { name: '攻击力', percent: false, low: 1000, mid: 1500, high: 1800 },
          { name: '暴击率', percent: true, low: 0.3, mid: 0.5, high: 0.7 },
        ],
      },
    ],
  },
};

test('多方案三档各取中位（偶数样本取相邻均值）', () => {
  const rows = computePanelRanges(FIXTURE);
  assert.equal(rows.length, 1);
  const a = rows[0];
  assert.equal(a.planCount, 2);
  // 攻击力 low: [1200,1000] → 中位 (1000+1200)/2
  assert.equal(a.stats['攻击力'].low, 1100);
  assert.equal(a.stats['攻击力'].mid, 1550);
  assert.equal(a.stats['攻击力'].high, 1900);
  // 浮点近似（如 (0.6+0.7)/2 = 0.6499…）
  const approx = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ≈ ${y}`);
  approx(a.stats['暴击率'].low, 0.25);
  approx(a.stats['暴击率'].mid, 0.45);
  approx(a.stats['暴击率'].high, 0.65);
});

test('奇数样本取中间值；某档缺失为 null', () => {
  const rows = computePanelRanges({
    a: {
      name: '角色A',
      plans: [
        { panel: [{ name: '冲击力', percent: false, low: 120, mid: 150, high: 180 }] },
        { panel: [{ name: '冲击力', percent: false, low: 130, mid: 170, high: 200 }] },
        { panel: [{ name: '冲击力', percent: false, low: 140, mid: 160, high: 190 }] },
        { panel: [{ name: '能量自动回复', percent: false, low: 2, mid: null, high: 5 }] },
      ],
    },
  });
  const a = rows[0];
  // 冲击力 low 排序 [120,130,140] 中位 = 130
  assert.equal(a.stats['冲击力'].low, 130);
  assert.equal(a.stats['冲击力'].mid, 160);
  assert.equal(a.stats['冲击力'].high, 190);
  // 能量自动回复 mid 全缺 → null
  assert.equal(a.stats['能量自动回复'].mid, null);
  assert.equal(a.stats['能量自动回复'].high, 5);
});

test('无方案数据返回空；未知方案忽略', () => {
  const empty = computePanelRanges({});
  assert.equal(empty.length, 0);
  const rows = computePanelRanges({ a: { name: '角色A', plans: [] } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].planCount, 0);
  assert.deepEqual(rows[0].stats, {});
});

test('真实数据冒烟：plans.json 每角色都有面板区间且三档不报错', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const rows = computePanelRanges(plans);
  assert.ok(rows.length >= 50);
  for (const r of rows) {
    assert.ok(Number.isInteger(r.planCount) && r.planCount >= 0);
    for (const v of Object.values(r.stats)) {
      for (const key of ['low', 'mid', 'high']) {
        assert.ok(v[key] == null || typeof v[key] === 'number');
      }
    }
  }
});
