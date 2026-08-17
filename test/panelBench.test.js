// test/panelBench.test.js —— 推荐方案三档统计（computeRecTierStats：low/mid/high 的 mean/median/sd/cv）
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRecTierStats } from '../src/lib/panelBench.js';
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
      {
        panel: [
          { name: '攻击力', low: 2200, mid: 2700, high: 3200 },
          { name: '暴击率', low: 0.54, mid: 0.64, high: 0.74 },
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

test('computeRecTierStats：每角色每属性三档 mean/median/sd/cv', () => {
  const out = computeRecTierStats(PLANS);
  const atk = out['艾莲']['攻击力'];
  // 三个方案的 low：2000、2100、2200 → median/mean 2100
  assert.equal(atk.low.count, 3);
  assert.equal(atk.low.median, 2100);
  assert.equal(atk.low.mean, 2100);
  assert.ok(atk.low.sd > 0);
  assert.ok(atk.low.cv > 0);
  assert.equal(atk.high.median, 3100);
  // 单方案档位：样本 <3 视为不可靠 → null
  const cj = out['苍角']['攻击力'];
  assert.equal(cj.low, null);
});

test('computeRecTierStats：MAD 排除离群哨兵值（如生命 100000）', () => {
  const plans = {
    1001: {
      name: '角色',
      plans: [
        { panel: [{ name: '生命值', low: 8000, mid: 9000, high: 10000 }] },
        { panel: [{ name: '生命值', low: 8100, mid: 9100, high: 10100 }] },
        { panel: [{ name: '生命值', low: 8200, mid: 9200, high: 10200 }] },
        // 哨兵：high 100000 超出 MAD 阈值 → 排除
        { panel: [{ name: '生命值', low: 8000, mid: 9000, high: 100000 }] },
      ],
    },
  };
  const out = computeRecTierStats(plans);
  const t = out['角色']['生命值'];
  assert.equal(t.high.outliers, 1, '哨兵被 MAD 排除');
  assert.equal(t.high.median, 10100, '剩余 3 个正常样本的中位');
});

test('computeRecTierStats：low/mid 恒 0 的占位属性 → low/mid 置 null', () => {
  const plans = {
    1001: {
      name: '角色',
      plans: [
        { panel: [{ name: '冲击力', low: 0, mid: 0, high: 120 }] },
        { panel: [{ name: '冲击力', low: 0, mid: 0, high: 125 }] },
        { panel: [{ name: '冲击力', low: 0, mid: 0, high: 130 }] },
      ],
    },
  };
  const out = computeRecTierStats(plans);
  const t = out['角色']['冲击力'];
  assert.equal(t.low, null);
  assert.equal(t.mid, null);
  assert.equal(t.high.median, 125);
});

test('真实数据冒烟：plans.json 三档统计不报错且多数角色有值', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const out = computeRecTierStats(plans);
  const names = Object.keys(out);
  assert.ok(names.length > 0);
  const withAttr = names.filter((n) => Object.keys(out[n]).length);
  assert.ok(withAttr.length > 0, '有角色带三档统计');
});
