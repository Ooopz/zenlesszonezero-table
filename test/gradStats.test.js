// test/gradStats.test.js —— 全服真实使用统计聚合（workshop-grad → 音擎/套装/组合榜）
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGradStats } from '../src/lib/gradStats.js';
import { loadDataFile } from './helpers.js';

const FIXTURE = [
  {
    item_id: '1341',
    name: '「扳机」',
    weapons: [
      { name: '索魂影眸', count: 69643, percent: 45.8 },
      { name: '拘缚者', count: 25587, percent: 16.8 },
      { name: '其他', count: 26779, percent: 17.6 },
    ],
    relics: [
      {
        name: '啄木鸟电音2+如影相随4',
        sets: [
          { name: '啄木鸟电音', num: 2 },
          { name: '如影相随', num: 4 },
        ],
        count: 52010,
        percent: 49.2,
      },
      {
        name: '震星迪斯科2+如影相随4',
        sets: [
          { name: '震星迪斯科', num: 2 },
          { name: '如影相随', num: 4 },
        ],
        count: 15807,
        percent: 15,
      },
      { name: '其他', sets: [], count: 17077, percent: 16.2 },
    ],
  },
  {
    item_id: '1361',
    name: '角色B',
    weapons: [
      { name: '索魂影眸', count: 30000, percent: 40 },
      { name: '其他', count: 45000, percent: 60 },
    ],
    relics: [
      { name: '如影相随4', sets: [{ name: '如影相随', num: 4 }], count: 20000, percent: 30 },
      { name: '其他', sets: [], count: 30000, percent: 70 },
    ],
  },
];

test('音擎榜：跨角色累加 count、角色去重、排除「其他」但计入占比分母、按 count 降序', () => {
  const { wengines } = computeGradStats(FIXTURE);
  assert.deepEqual(
    wengines.map((w) => w.name),
    ['索魂影眸', '拘缚者']
  );
  const a = wengines.find((w) => w.name === '索魂影眸');
  assert.equal(a.count, 69643 + 30000);
  assert.deepEqual(a.roles, ['「扳机」', '角色B']);
  // 总量 = 全部音擎（含其他）：69643+25587+26779 + 30000+45000
  const total = 69643 + 25587 + 26779 + 30000 + 45000;
  assert.ok(Math.abs(a.ratio - (69643 + 30000) / total) < 1e-9);
  const b = wengines.find((w) => w.name === '拘缚者');
  assert.deepEqual(b.roles, ['「扳机」']);
});

test('套装榜：组合内各套装都累加该组合 count；同套装跨组合累加', () => {
  const { discs } = computeGradStats(FIXTURE);
  const order = discs.map((d) => d.name);
  assert.ok(order.indexOf('如影相随') < order.indexOf('啄木鸟电音'));
  const yyr = discs.find((d) => d.name === '如影相随');
  assert.equal(yyr.count, 52010 + 15807 + 20000);
  assert.deepEqual(yyr.roles, ['「扳机」', '角色B']);
  const zmt = discs.find((d) => d.name === '啄木鸟电音');
  assert.equal(zmt.count, 52010);
});

test('组合榜：按组合名聚合，「其他」不入榜', () => {
  const { combos } = computeGradStats(FIXTURE);
  assert.deepEqual(
    combos.map((c) => c.name),
    ['啄木鸟电音2+如影相随4', '如影相随4', '震星迪斯科2+如影相随4']
  );
  const c = combos.find((x) => x.name === '啄木鸟电音2+如影相随4');
  assert.equal(c.count, 52010);
  assert.deepEqual(c.roles, ['「扳机」']);
  assert.ok(!combos.some((x) => x.name === '其他'));
});

test('空数据 / 无角色名：返回空数组', () => {
  const r = computeGradStats([]);
  assert.deepEqual(r, { wengines: [], discs: [], combos: [] });
  const r2 = computeGradStats([{ weapons: [], relics: [] }]);
  assert.deepEqual(r2.wengines, []);
});

test('真实数据冒烟：workshop-grad.json 三榜非空、计数与占比合法', () => {
  const grad = loadDataFile('workshop-grad.json', 'node src/sync/workshop.js');
  const { wengines, discs, combos } = computeGradStats(grad.roles || []);
  assert.ok(wengines.length > 0);
  assert.ok(discs.length > 0);
  assert.ok(combos.length > 0);
  for (const list of [wengines, discs, combos]) {
    for (const e of list) {
      assert.ok(Number.isInteger(e.count) && e.count > 0);
      assert.ok(e.ratio >= 0 && e.ratio <= 1);
      assert.ok(Array.isArray(e.roles) && e.roles.length > 0);
    }
  }
});
