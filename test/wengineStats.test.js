// test/wengineStats.test.js —— 音擎推荐统计聚合逻辑
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWengineStats } from '../src/lib/wengineStats.js';
import { loadDataFile } from './helpers.js';

const FIXTURE = {
  1011: {
    name: '安比',
    plans: [
      { weapon: { main: '硫磺石', backup: '德玛拉电池Ⅱ型' } },
      { weapon: { main: '硫磺石', backup: '德玛拉电池Ⅱ型' } },
    ],
  },
  1012: {
    name: '妮可',
    plans: [{ weapon: { main: '硫磺石', backup: '德玛拉电池Ⅱ型' } }],
  },
};

test('按音擎聚合：推荐次数 / 主备计数 / 推荐角色去重', () => {
  const rows = computeWengineStats(FIXTURE, ['硫磺石', '德玛拉电池Ⅱ型', '无人用']);
  const a = rows.find((r) => r.name === '硫磺石');
  assert.equal(a.count, 3); // 三个方案都作主推荐
  assert.equal(a.mainCount, 3);
  assert.equal(a.backupCount, 0);
  assert.deepEqual(a.characters, ['安比', '妮可']); // 角色去重
  const b = rows.find((r) => r.name === '德玛拉电池Ⅱ型');
  assert.equal(b.count, 3);
  assert.equal(b.mainCount, 0);
  assert.equal(b.backupCount, 3);
  const n = rows.find((r) => r.name === '无人用');
  assert.equal(n.count, 0);
  assert.deepEqual(n.characters, []);
});

test('音擎名去标点/空白归一化匹配（尾随空格也能命中）', () => {
  const rows = computeWengineStats({ a: { name: '照', plans: [{ weapon: { main: '硫磺石 ' } }] } }, ['硫磺石']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 1);
  assert.deepEqual(rows[0].characters, ['照']);
});

test('未知音擎名（不在 wengineNames 内）跳过；无方案数据返回全空行', () => {
  const rows = computeWengineStats({ a: { name: '角色A', plans: [{ weapon: { main: '不存在的音擎' } }] } }, [
    '已知音擎',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 0);
  const empty = computeWengineStats({}, ['某音擎']);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].count, 0);
});

test('真实数据冒烟：plans.json 每把音擎都有聚合行且计数不报错', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const names = Object.values(lib.wengines || {}).map((w) => w.name);
  const rows = computeWengineStats(plans, names);
  assert.equal(rows.length, names.length);
  for (const r of rows) {
    assert.ok(Number.isInteger(r.count) && r.count >= 0);
    assert.ok(Number.isInteger(r.mainCount) && r.mainCount >= 0);
    assert.ok(Number.isInteger(r.backupCount) && r.backupCount >= 0);
    assert.ok(Array.isArray(r.characters));
  }
});
