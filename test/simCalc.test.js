import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateFrontier, simulateFrontier3D, simulateFixedPanel, axisAvailable } from '../src/lib/simCalc.js';
import { buildNameIndex, CATEGORY } from '../src/lib/names.js';
import { loadDataFile } from './helpers.js';

const library = loadDataFile('library.json', 'npm run sync:library（或网页「更新数据库」）');

const ctx = {
  charIndex: buildNameIndex(library.characters, CATEGORY.CHAR),
  wengineIndex: buildNameIndex(library.wengines, CATEGORY.WENGINE),
  discIndex: buildNameIndex(library.discs, CATEGORY.DISC),
};

const REMIEL_OPTS = {
  charName: '蕾米埃尔·丹',
  wengineName: '嵌合编译器',
  set2: '自由蓝调',
  set4: '混沌爵士',
  main4: '异常精通',
  main5: '攻击力%',
  main6: '攻击力%',
  xAxis: '攻击力',
  yAxis: '异常精通',
};

test('simulateFrontier 生成有限、按 x 升序且无被支配点的前沿', () => {
  const r = simulateFrontier(ctx, REMIEL_OPTS);
  assert.ok(r.points.length >= 3, '前沿至少应有 3 个点');
  let prevX = -Infinity;
  let prevY = Infinity;
  for (const p of r.points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), '前沿点应为有限数');
    assert.ok(p.x >= prevX, '前沿应随 x 升序');
    assert.ok(p.y <= prevY + 1e-6, '前沿 y 应随 x 增大而不上升');
    prevX = p.x;
    prevY = p.y;
  }
});

test('simulateFrontier 的固定面板不包含副词条，前沿两端均高于固定面板', () => {
  const r = simulateFrontier(ctx, REMIEL_OPTS);
  const fixedX = r.fixed['攻击力'];
  const fixedY = r.fixed['异常精通'];
  assert.ok(fixedX > 0 && fixedY > 0, '固定面板攻击力/异常精通应为正数');
  const first = r.points[0];
  const last = r.points[r.points.length - 1];
  assert.ok(first.y > fixedY, 'Y 端应高于固定面板');
  assert.ok(last.x > fixedX, 'X 端应高于固定面板');
});

test('异常精通轴遵守「副词条不与主词条重复」：4号位主词条为异常精通，故只有 5 枚盘可带异常精通副词条', () => {
  const r = simulateFrontier(ctx, REMIEL_OPTS);
  const minY = r.points[r.points.length - 1].y;
  const maxY = r.points[0].y;
  // 4号位主词条=异常精通 -> 该盘副词条不能出现异常精通；其余 5 枚盘各至少 1 条、最多 6 条。
  assert.ok(Math.abs(minY - (r.fixed['异常精通'] + 5 * 9)) < 1e-6, '最小异常精通应为固定值 + 5×9');
  assert.ok(Math.abs(maxY - (r.fixed['异常精通'] + 5 * 9 * 6)) < 1e-6, '最大异常精通应为固定值 + 5×54');
});

test('simulateFixedPanel 与 simulateFrontier.fixed 一致', () => {
  const fixed = simulateFixedPanel(ctx, REMIEL_OPTS);
  const r = simulateFrontier(ctx, REMIEL_OPTS);
  assert.deepEqual(fixed, r.fixed);
});

test('axisAvailable 只对可由副词条成长的面板属性为 true', () => {
  assert.equal(axisAvailable('攻击力'), true);
  assert.equal(axisAvailable('暴击率'), true);
  assert.equal(axisAvailable('异常精通'), true);
  assert.equal(axisAvailable('穿透值'), true);
  assert.equal(axisAvailable('冲击力'), false);
  assert.equal(axisAvailable('异常掌控'), false);
  assert.equal(axisAvailable('穿透率'), false);
});

test('副词条与主词条不重复同时区分固定值/百分比形态', () => {
  const r = simulateFrontier(ctx, {
    ...REMIEL_OPTS,
    main4: '暴击率',
    main5: '攻击力%',
    main6: '生命值%',
    xAxis: '攻击力',
    yAxis: '生命值',
  });
  const typesOf = (slotIdx) => {
    const set = new Set();
    for (const o of r.discOptions[slotIdx]) for (const part of o.detail.split('、')) set.add(part.split('×')[0]);
    return set;
  };
  assert.equal(typesOf(0).has('生命值'), false, '1号位主词条=生命值，副词条不得出现固定生命值');
  assert.equal(typesOf(0).has('生命值%'), true, '1号位仍可出现百分比生命值');
  assert.equal(typesOf(1).has('攻击力'), false, '2号位主词条=攻击力，副词条不得出现固定攻击力');
  assert.equal(typesOf(1).has('攻击力%'), true, '2号位仍可出现百分比攻击力');
  assert.equal(typesOf(4).has('攻击力%'), false, '5号位主词条=攻击力%，副词条不得出现百分比攻击力');
  assert.equal(typesOf(4).has('攻击力'), true, '5号位仍可出现固定攻击力');
  assert.equal(typesOf(5).has('生命值%'), false, '6号位主词条=生命值%，副词条不得出现百分比生命值');
  assert.equal(typesOf(5).has('生命值'), true, '6号位仍可出现固定生命值');
});

test('simulateFrontier3D 生成三维帕累托点集', () => {
  const r = simulateFrontier3D(ctx, { ...REMIEL_OPTS, zAxis: '暴击率' });
  assert.ok(r.points.length > 0, '三维前沿应有点');
  for (const p of r.points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), '三维点应为有限数');
  }
  assert.deepEqual(r.axes, [REMIEL_OPTS.xAxis, REMIEL_OPTS.yAxis, '暴击率']);
});

test('副词条单条强化次数上限 6（discOptions 的 ×N 标注）', () => {
  const r = simulateFrontier(ctx, REMIEL_OPTS);
  let maxN = 0;
  for (const slot of r.discOptions || []) {
    for (const o of slot || []) {
      for (const part of String(o.detail).split('、')) {
        const n = Number(part.split('×')[1]);
        if (Number.isFinite(n)) maxN = Math.max(maxN, n);
      }
    }
  }
  assert.equal(maxN, 6, `单条最多 6 次强化，实际标注 ${maxN}`);
});

test('副词条对无乘区属性的总增幅受 6 次上限约束（异常精通）', () => {
  // 4 号位主词条=异常精通 → 该盘副词条不得重复，剩 5 盘可用；每盘 1 条 × 单次成长 9 × 6 次 = 270
  const r = simulateFrontier(ctx, REMIEL_OPTS);
  const maxY = Math.max(...r.points.map((p) => p.y));
  assert.equal(Math.round(maxY - r.fixed['异常精通']), 270, '异常精通总增幅应为 5盘×6次×9');
});
