// test/teamStats.test.js —— 配队推荐统计聚合逻辑
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTeamStats } from '../src/lib/teamStats.js';
import { loadDataFile } from './helpers.js';

const FIXTURE = {
  1011: {
    name: '安比',
    plans: [{ team: ['安比', '妮可', '猫宫 又奈'] }, { team: ['安比', '朱鸢'] }],
  },
  1012: {
    name: '妮可',
    plans: [{ team: ['妮可', '安比'] }],
  },
};

test('配队统计：排除自身、被引用次数与引用角色去重', () => {
  const rows = computeTeamStats(FIXTURE, ['安比', '妮可', '猫宫 又奈', '朱鸢']);
  const a = rows.find((r) => r.name === '安比');
  assert.equal(a.selfCount, 2); // 安比自己两个方案
  assert.equal(a.mateCount, 1); // 只在妮可方案里被组队
  assert.deepEqual(a.characters, ['妮可']);
  const n = rows.find((r) => r.name === '妮可');
  assert.equal(n.selfCount, 1);
  assert.equal(n.mateCount, 1); // 只在安比方案1里被组队
  assert.deepEqual(n.characters, ['安比']);
  const m = rows.find((r) => r.name === '猫宫 又奈');
  assert.equal(m.mateCount, 1); // 只进安比方案1
  assert.equal(m.selfCount, 0);
  const z = rows.find((r) => r.name === '朱鸢');
  assert.equal(z.mateCount, 1);
});

test('角色名去标点/空白归一化匹配（猫宫 又奈 带空格命中）', () => {
  // fixture 已覆盖：team 里「猫宫 又奈」匹配 charNames「猫宫 又奈」（normalize 后同为 猫宫又奈）
  const rows = computeTeamStats(
    {
      a: { name: '某角色', plans: [{ team: ['某角色', '星见 雅'] }] },
    },
    ['星见雅']
  );
  const y = rows.find((r) => r.name === '星见雅');
  assert.equal(y.mateCount, 1);
  assert.deepEqual(y.characters, ['某角色']);
});

test('未知成员名跳过；无方案数据返回全空行', () => {
  const rows = computeTeamStats({ a: { name: '角色A', plans: [{ team: ['角色A', '不存在的人'] }] } }, ['已知角色']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mateCount, 0);
  const empty = computeTeamStats({}, ['角色X']);
  assert.equal(empty[0].selfCount, 0);
  assert.equal(empty[0].mateCount, 0);
});

test('真实数据冒烟：plans.json 每角色都有配队聚合行且计数不报错', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const names = Object.values(lib.characters || {}).map((c) => c.name);
  const rows = computeTeamStats(plans, names);
  assert.equal(rows.length, names.length);
  for (const r of rows) {
    assert.ok(Number.isInteger(r.selfCount) && r.selfCount >= 0);
    assert.ok(Number.isInteger(r.mateCount) && r.mateCount >= 0);
    assert.ok(Array.isArray(r.characters));
  }
});
