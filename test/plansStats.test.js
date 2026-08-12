// test/plansStats.test.js —— 方案推荐侧每角色 Top 音擎/套装统计
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRoleBuildsFromPlans, orderComboSets4First } from '../src/lib/plansStats.js';
import { loadDataFile } from './helpers.js';

const PLANS = {
  1011: {
    name: '安比',
    plans: [
      { weapon: { main: '硫磺石', backup: '德玛拉电池Ⅱ型' }, sets: [{ name: '震星迪斯科', cnt: 4 }, { name: '摇摆爵士', cnt: 2 }] },
      { weapon: { main: '硫磺石', backup: '德玛拉电池Ⅱ型' }, sets: [{ name: '震星迪斯科', cnt: 4 }, { name: '摇摆爵士', cnt: 2 }] },
      { weapon: { main: '硫磺石' }, sets: [{ name: '啄木鸟电音', cnt: 4 }] },
    ],
  },
};

test('每角色 Top 音擎：按方案出现次数 + 占比', () => {
  const out = computeRoleBuildsFromPlans(PLANS);
  const w = out['安比'].wengines;
  // 硫磺石 3（主）、德玛拉电池Ⅱ型 2（备）、total 5
  assert.equal(w[0].name, '硫磺石');
  assert.equal(w[0].percent, 60); // 3/5 = 60%
  assert.equal(w[1].name, '德玛拉电池Ⅱ型');
  assert.equal(w[1].percent, 40); // 2/5 = 40%
});

test('每角色 Top 套装组合：按组合统计（4 件套在前）+ 占比 + sets', () => {
  const out = computeRoleBuildsFromPlans(PLANS);
  const r = out['安比'].relics;
  // 方案1/2 都是 震星迪斯科4+摇摆爵士2（2 次）、方案3 啄木鸟电音4（1 次），total 3
  assert.equal(r[0].name, '震星迪斯科4+摇摆爵士2');
  assert.equal(r[0].percent, 66.7);
  assert.deepEqual(r[0].sets, [
    { name: '震星迪斯科', num: 4 },
    { name: '摇摆爵士', num: 2 },
  ]);
  assert.equal(r[1].name, '啄木鸟电音4');
  assert.equal(r[1].percent, 33.3);
  assert.deepEqual(r[1].sets, [{ name: '啄木鸟电音', num: 4 }]);
});

test('orderComboSets4First：4 件套在前、2 件套在后，num/cnt 两字段兼容', () => {
  // 工坊侧（set_info 顺序不固定，num 字段）
  const ws = orderComboSets4First([
    { name: '啄木鸟电音', num: 2 },
    { name: '如影相随', num: 4 },
  ]);
  assert.equal(ws.name, '如影相随4+啄木鸟电音2');
  assert.deepEqual(ws.sets.map((s) => s.num), [4, 2]);
  // 方案侧（cnt 字段）与工坊侧归一后同名组合文本一致
  const pl = orderComboSets4First([
    { name: '如影相随', cnt: 4 },
    { name: '啄木鸟电音', cnt: 2 },
  ]);
  assert.equal(pl.name, ws.name);
  assert.deepEqual(pl.sets.map((s) => s.num), [4, 2]);
  // 空组合
  assert.deepEqual(orderComboSets4First([]), { name: '', sets: [] });
});

test('真实数据冒烟：plans.json 每角色都有 Top 音擎/套装组合', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const out = computeRoleBuildsFromPlans(plans);
  assert.ok(Object.keys(out).length > 0);
  for (const [name, b] of Object.entries(out)) {
    assert.ok(Array.isArray(b.wengines) && b.wengines.length > 0, `${name} 应有 Top 音擎`);
    assert.ok(Array.isArray(b.relics) && b.relics.length > 0, `${name} 应有 Top 套装组合`);
    for (const w of b.wengines) assert.ok(w.percent >= 0 && w.percent <= 100);
    for (const r of b.relics) {
      assert.ok(r.percent >= 0 && r.percent <= 100);
      assert.ok(Array.isArray(r.sets) && r.sets.length > 0, `${name} 的 ${r.name} 应有 sets`);
      assert.ok(r.sets.every((s) => s.name && (s.num === 2 || s.num === 4)));
    }
  }
});
