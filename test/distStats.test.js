// test/distStats.test.js —— 分布统计纯函数 + 属性相关
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, median, computeDist, pearson, computePowerScore, kmeans, tierFit } from '../src/lib/distStats.js';
import { computePanelCorrelations } from '../src/lib/workshopStats.js';
import { loadDataFile } from './helpers.js';

test('quantile/median：线性插值', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0), 1);
  assert.equal(quantile([1, 2, 3, 4, 5], 1), 5);
  // 线性插值：p25 of 1..10 = 1 + (10-1)*0.25
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.25), 3.25);
});

test('computeDist：IQR 1.5 离群值排除', () => {
  // [1..5, 100]：100 超出 Q3+1.5*IQR 上限，应为离群
  const d = computeDist([1, 2, 3, 4, 5, 100]);
  assert.equal(d.whiskerLow, 1); // 下须取非离群最低
  assert.equal(d.whiskerHigh, 5); // 上须排除 100
  assert.equal(d.outliers, 1);
  // 无离群时 whisker = min/max
  const d2 = computeDist([10, 12, 14, 16, 18]);
  assert.equal(d2.outliers, 0);
  assert.equal(d2.whiskerLow, 10);
  assert.equal(d2.whiskerHigh, 18);
});

test('computeDist：完整分布对象（分位/离散/形态）', () => {
  const d = computeDist([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(d.count, 10);
  assert.equal(d.min, 1);
  assert.equal(d.max, 10);
  assert.equal(d.range, 9);
  assert.equal(d.median, 5.5);
  assert.equal(d.p50, 5.5);
  assert.ok(d.sd > 0);
  assert.ok(d.IQR > 0);
  assert.equal(d.p10, 1.9);
  assert.ok(d.skew != null && d.kurt != null);
  const empty = computeDist([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.min, null);
});

test('pearson：完全正/负相关、零方差返回 null', () => {
  assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
  assert.ok(Math.abs(pearson([1, 2, 3], [6, 4, 2]) + 1) < 1e-9);
  assert.equal(pearson([1, 1, 1], [2, 3, 4]), null);
  assert.equal(pearson([1], [2]), null);
});

test('computePowerScore：对玩家中位归一化后加权', () => {
  const med = { 攻击力: 1000, 防御力: 500 };
  const s = computePowerScore({ 攻击力: 1000, 防御力: 500 }, med, { 攻击力: 0.5, 防御力: 0.3 });
  assert.ok(Math.abs(s - 0.8) < 1e-9);
  // 缺失属性不计
  const s2 = computePowerScore({ 攻击力: 2000 }, med, { 攻击力: 0.5, 防御力: 0.3 });
  assert.ok(Math.abs(s2 - 1) < 1e-9);
});

test('computePanelCorrelations：同条目配对 + 按角色分组', () => {
  const entries = [
    { role_id: '1011', panel: [{ name: '攻击力', final: '100' }, { name: '防御力', final: '50' }] },
    { role_id: '1011', panel: [{ name: '攻击力', final: '200' }, { name: '防御力', final: '100' }] },
    { role_id: '1011', panel: [{ name: '攻击力', final: '300' }, { name: '防御力', final: '150' }] },
  ];
  const corr = computePanelCorrelations(entries);
  assert.ok(Math.abs(corr['1011']['攻击力_防御力'] - 1) < 1e-9);
});

test('kmeans：确定性聚类返回簇编号', () => {
  const pts = [
    [1, 1], [2, 1], [1, 2],
    [100, 100], [101, 100], [100, 101],
  ];
  const a = kmeans(pts, 2);
  assert.equal(a.length, 6);
  // 前 3 个点同簇、后 3 个点同簇
  assert.equal(a[0], a[1]);
  assert.equal(a[3], a[4]);
});

test('tierFit：推荐档位匹配', () => {
  assert.equal(tierFit(100, { low: 200, mid: 300, high: 400 }).tier, 'below');
  assert.equal(tierFit(250, { low: 200, mid: 300, high: 400 }).tier, 'low-mid');
  assert.equal(tierFit(350, { low: 200, mid: 300, high: 400 }).tier, 'mid-high');
  assert.equal(tierFit(500, { low: 200, mid: 300, high: 400 }).tier, 'above');
  assert.equal(tierFit(100, null), null);
});

test('真实数据冒烟：workshop-stats 含分位/离散/形态与属性相关', () => {
  const stats = loadDataFile('workshop-stats.json', 'node src/sync/workshop.js');
  const p = stats.panels.find((x) => x.stats['攻击力']);
  assert.ok(p.stats['攻击力'].p50 != null);
  assert.ok(p.stats['攻击力'].p99 > p.stats['攻击力'].p50);
  assert.ok(p.stats['攻击力'].sd > 0);
  assert.ok(stats.panelCorr && Object.keys(stats.panelCorr).length > 0);
});
