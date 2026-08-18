// test/discProb.test.js —— 驱动盘练度提升概率计算（ZZZ-DDC 移植）
// 纯内联 fixture，不依赖 data/，永远不会 SKIP
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_NAMES,
  SUBSTAT_SPECIAL_WEIGHTS,
  passChance,
  computeDiscProb,
  computePosProb,
  buildTypes,
  roleWeightsFromWs,
  DEFAULT_WEIGHTS,
  gradeOf,
} from '../src/lib/discProb.js';
import { MAIN_STAT_OPTIONS, DISC_MAIN_PROB_WEIGHTS } from '../src/lib/constants.js';

test('passChance：强化成长通过率（确定性手算）', () => {
  // 词条 [1,1]（两条权重 1），2 次成长：nowAdd 恒为 2
  assert.equal(passChance(2, 1, [1, 1]), 1); // 2 > 1 ✓
  assert.equal(passChance(2, 2, [1, 1]), 0); // 2 > 2 严格大于，不通过
  assert.equal(passChance(2, 3, [1, 1]), 0);
  // 词条 [1, 0]：2 次成长，need=1 → 4 条路径 add 为 2、1、1、0，仅 2>1 通过
  assert.equal(passChance(2, 1, [1, 0]), 0.25); // 2>1 ✓, 1>1 ✗, 1>1 ✗, 0>1 ✗
  assert.equal(passChance(0, 1, [1, 0]), 0); // 0 次成长
});

test('computeDiscProb：确定性 + 边界（概率随目标分单调不增）', () => {
  // 精简池：3 种词条，各 rest=2，可枚举 4 词条组合
  const types = [
    { typeIndex: 0, score: 1, rest: 2, specialWeight: 10 },
    { typeIndex: 1, score: 0.5, rest: 2, specialWeight: 10 },
    { typeIndex: 2, score: 0, rest: 2, specialWeight: 10 },
  ];
  const r1 = computeDiscProb(types, 1);
  const r2 = computeDiscProb(types, 1);
  assert.equal(r1.chance, r2.chance, '同参结果应确定');
  assert.ok(r1.chance > 0 && r1.chance <= 1, '概率应在 (0,1]');
  const gs = [0.5, 1, 2, 4, 8];
  let prev = Infinity;
  for (const g of gs) {
    const c = computeDiscProb(types, g).chance;
    assert.ok(c <= prev + 1e-12, `目标分 ${g} 概率 ${c} 应 ≤ 上一档 ${prev}`);
    prev = c;
  }
  assert.equal(computeDiscProb(types, 1e9).chance, 0, '目标远超上限概率为 0');
});

test('computeDiscProb：定向词条（首 4 词条必须含）过滤生效', () => {
  const types = [0, 1, 2, 3].map((i) => ({ typeIndex: i, score: 1, rest: 2, specialWeight: 10 }));
  const all = computeDiscProb(types, 0).chance;
  // 定向「必须含 typeIndex 4」——池里没有该类型 → 无满足组合 → 概率 0
  const impossible = computeDiscProb(types, 0, [4]).chance;
  assert.equal(impossible, 0, '定向类型不在池中应无满足组合');
  // 定向含池中类型：概率应 ≤ 全部组合的概率
  const directed = computeDiscProb(types, 0, [0]).chance;
  assert.ok(directed > 0 && directed <= all + 1e-12, `定向概率 ${directed} 应 ≤ 全组合 ${all}`);
});

test('buildTypes：构造 10 词条池并排除主词条同类', () => {
  const w = [0, 0, 1, 0.3, 0.3, 0, 0, 1, 1, 0];
  const t = buildTypes(w);
  assert.equal(t.length, 10);
  assert.equal(t[0].score, 0); // 生命值% 权重 0
  assert.equal(t[2].score, 1); // 攻击力% 权重 1
  assert.equal(t[8].score, 1); // 暴击率权重 1
  // 排除暴击率（idx 8）
  const t2 = buildTypes(w, 1, 8);
  assert.equal(t2[8].rest, 0, '主词条同类副词条应被禁用');
  assert.equal(t2[7].rest, 1);
});

test('computePosProb：位置系数与主词条加权', () => {
  const w = [0, 0, 1, 0.3, 0.3, 0, 0, 1, 1, 0];
  const pool = buildTypes(w);
  // 1 号位（无主词条）：prob = chance / 6
  const p1 = computePosProb(1, null, pool, 3);
  const direct = computeDiscProb(pool, 3).chance;
  assert.ok(Math.abs(p1.prob - direct / 6) < 1e-12, '1号位概率 = chance/6');
  // 4 号位全主词条：各主词条按 MAIN_PROB_WEIGHTS 加权
  const p4 = computePosProb(4, null, pool, 3);
  assert.ok(p4.prob > 0 && p4.prob <= 1);
  // 单主词条 = 主词条出现概率 × 排除同类池的 chance/6（主词条概率按全位置权重和归一，非选中集）
  const p4single = computePosProb(4, ['暴击率'], pool, 3);
  const poolNoCrit = pool.map((t) => ({ ...t, rest: t.typeIndex === 8 ? 0 : t.rest }));
  const totalAll = Object.values(DISC_MAIN_PROB_WEIGHTS[4]).reduce((s, v) => s + v, 0);
  const expectSingle = computeDiscProb(poolNoCrit, 3).chance * (DISC_MAIN_PROB_WEIGHTS[4]['暴击率'] / totalAll) / 6;
  assert.ok(Math.abs(p4single.prob - expectSingle) < 1e-12, '单主词条概率 = 主词条出现概率 × 排除同类池的 chance/6');
});

test('roleWeightsFromWs：标准名 key 直接匹配（% 与固定共享父属性权重）', () => {
  // 落地数据 key 已是 CONSTANT 标准名（抽取时映射）
  const weightJson = {
    1011: { factions: [{ name: '默认流派', weights: [{ key: '攻击力', weight: 1 }, { key: '暴击率', weight: 0.75 }, { key: '暴击伤害', weight: 0.5 }, { key: '穿透值', weight: 0.25 }, { key: '异常精通', weight: 0.6 }] }] },
  };
  const gradRoles = [{ item_id: '1011', name: '测试角色' }];
  const w = roleWeightsFromWs('测试角色', weightJson, gradRoles);
  // 10 维顺序：生命值%/生命值/攻击力%/攻击力/穿透值/防御力%/防御力/暴击伤害/暴击率/异常精通
  assert.deepEqual(w, [0, 0, 1, 1, 0.25, 0, 0, 0.5, 0.75, 0.6], '标准名直接匹配，攻击力%/攻击力 共享「攻击力」权重');
  assert.equal(roleWeightsFromWs('不存在', weightJson, gradRoles), null, '查不到角色返回 null');
  assert.deepEqual(DEFAULT_WEIGHTS.length, 10, '默认模板为 10 维');
});

test('gradeOf：评级阈值（123 与 456 两套）', () => {
  assert.equal(gradeOf(0.002, 1).label, '完美毕业');
  assert.equal(gradeOf(0.1, 1).label, '能用'); // 123 阈值：0.064~0.12 能用
  assert.equal(gradeOf(0.5, 4).label, '可提升空间极大'); // 456 阈值 >0.48
  assert.equal(gradeOf(0.1, 4).label, '大毕业'); // 456 阈值：0.08~0.17 大毕业
});

test('常量：词条体系与主词条表完整性（名称与项目统一）', () => {
  assert.equal(ENTRY_NAMES.length, 10);
  assert.equal(SUBSTAT_SPECIAL_WEIGHTS.length, 10);
  assert.equal(ENTRY_NAMES[2], '攻击力%', '副词条名称用项目标准名（SUBSTAT）');
  assert.equal(ENTRY_NAMES[9], '异常精通');
  for (const pos of [4, 5, 6]) {
    assert.ok(MAIN_STAT_OPTIONS[pos].length > 0, `${pos} 号位应有主词条候选`);
    // 主词条名与概率表 key 一致
    for (const m of MAIN_STAT_OPTIONS[pos]) {
      assert.ok(DISC_MAIN_PROB_WEIGHTS[pos][m] > 0, `${pos} 号位 ${m} 应有概率权重`);
    }
  }
  assert.equal(MAIN_STAT_OPTIONS[4].includes('暴击率'), true);
});
