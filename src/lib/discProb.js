// src/lib/discProb.js —— 驱动盘练度提升概率计算（双端共享纯逻辑，Node 与浏览器共用）
// 移植自 qfmyqqx.github.io/ZZZ-DDC（绝区零驱动盘练度提升概率计算器），仅保留「游戏内」核心模型：
//   ① 首 4 副词条按词条抽取权重（specialWeight）枚举组合（同盘副词条不重复，rest 为可用数）；
//   ② 强化成长：每次从已有 4 词条中随机一条 +1 层（加其价值权重 score），共若干次；
//   ③ 初始 4 词条盘（20%）成长 5 次，初始 3 词条盘（80%）首次强化补第 4 词条、之后成长 4 次；
//   ④ 456 号位主词条按出现概率加权，位置基础概率 1/6；
//   ⑤ 定向（directedTypes，≤2）：要求首 4 词条必须包含的类型。
// 词条体系（名称/抽取权重/主词条表/概率表）在 constants.js（DISC_*，与项目属性名统一）；
// 角色价值权重来自 workshop-weights（经 workshop-grad 的 role_id→名对齐，工坊有效词条口径）。
// 结果 = Σ_首4组合 P(组合) × P(强化成长达标 | 组合) × P(主词条) × 位置系数。数值越低 = 目标分越高 = 越接近毕业。

import {
  DISC_SUBSTATS,
  DISC_SUBSTAT_SPECIAL_WEIGHTS,
  DISC_MAIN_PROB_WEIGHTS,
  DISC_MAIN_BLOCK,
  DISC_SUBSTAT_WS_KEY,
  SUBSTAT,
} from './constants.js';

// ---------- 强化参数（初始 3/4 词条盘的占比与成长次数） ----------
// 游戏实际：掉落盘初始 3 副词条占 80%、初始 4 副词条占 20%。
// 15 级盘共 5 次强化事件：4 词条盘 5 次全是成长；3 词条盘第 1 次强化补第 4 词条、之后 4 次成长。
export const FOUR_SUB_CHANCE = 0.2; // 初始 4 词条盘概率
export const THREE_SUB_CHANCE = 0.8; // 初始 3 词条盘概率
export const FOUR_SUB_TIMES = 5; // 4 词条盘成长次数
export const THREE_SUB_TIMES = 4; // 3 词条盘补词条后的成长次数

/** 副词条 10 维（名称顺序即 DISC_SUBSTATS） */
export const ENTRY_NAMES = DISC_SUBSTATS;
export { DISC_SUBSTAT_SPECIAL_WEIGHTS as SUBSTAT_SPECIAL_WEIGHTS };

/** 库角色名 → 10 维价值权重。数据源：workshop-weights（经 workshop-grad 的 role_id→wiki 名对齐）。
 *  落地数据 key 已是 CONSTANT 标准名（抽取时映射），此处按 DISC_SUBSTAT_WS_KEY 直接匹配
 *  （% 与固定共享父属性权重：攻击力%/攻击力 都取「攻击力」）。查不到角色返回 null。 */
export function roleWeightsFromWs(libName, weightJson, gradRoles) {
  const role = (gradRoles || []).find((r) => r.name === libName);
  const entry = role && weightJson?.[role.item_id];
  const ws = entry?.factions?.[0]?.weights;
  if (!ws) return null;
  const w = new Map(ws.map((x) => [x.key, x.weight]));
  return DISC_SUBSTATS.map((name) => w.get(DISC_SUBSTAT_WS_KEY[name]) || 0);
}
/** 查不到工坊权重时的默认模板（攻击力% 0.3 + 通用双暴） */
export const DEFAULT_WEIGHTS = [0, 0, 0.3, 0.3, 0.3, 0, 0, 1, 1, 0];

// ---------- 强化成长通过率 ----------
/** 递归：leaveTimes 次成长（每次从 nowGroup 随机一条 +score），统计 nowAdd > need 的路径占比 */
export function passChance(times, need, nowGroup) {
  let total = 0;
  let pass = 0;
  (function dfs(leave, add) {
    if (leave <= 0) {
      total++;
      if (add > need) pass++;
      return;
    }
    for (const g of nowGroup) dfs(leave - 1, add + g);
  })(times, 0);
  return total === 0 ? 0 : pass / total;
}

// ---------- 首 4 词条组合枚举 + 达标概率 ----------
/**
 * 词条池 types: [{ typeIndex, score, rest, specialWeight }]（rest = 该词条可用数，通常 1 = 同盘不重复）
 * 目标 goal（价值分）：对每个首 4 词条组合（按 specialWeight 概率加权），
 * 基础分达标则通过率 1，否则按 4/3 词条两路径强化成长算通过率；两路径按 20%/80% 占比加权。
 * 返回 { chance, p4, p3 }（均未含主词条/位置 scaleFactor）：
 *   chance = 0.2×p4 + 0.8×p3（合并达成概率）；
 *   p4 = 初始 4 词条盘（成长 5 次）的条件通过率；p3 = 初始 3 词条盘（补词条后成长 4 次）的条件通过率。
 */
export function computeDiscProb(types, goal, directedTypes = []) {
  const groups = [];
  (function pick(rest, chosen, scoreSum, weight) {
    if (chosen.length === 4) {
      if (directedTypes.length) {
        const have = new Set(chosen.map((c) => c.typeIndex));
        if (!directedTypes.every((t) => have.has(t))) return;
      }
      groups.push({ scores: chosen.map((c) => c.score), scoreSum, weight });
      return;
    }
    const total = rest.reduce((s, t) => s + (t.rest > 0 ? t.specialWeight : 0), 0);
    if (total === 0) return;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t.rest <= 0) continue;
      const next = rest.map((x) => ({ ...x }));
      next[i].rest--;
      chosen.push(t);
      pick(next, chosen, scoreSum + t.score, weight * (t.specialWeight / total));
      chosen.pop();
    }
  })(types.map((t) => ({ ...t })), [], 0, 1);

  let totalW = 0;
  let totalA = 0;
  let totalB = 0;
  for (const g of groups) {
    const pA = g.scoreSum > goal ? 1 : passChance(FOUR_SUB_TIMES, goal - g.scoreSum, g.scores);
    const pB = g.scoreSum > goal ? 1 : passChance(THREE_SUB_TIMES, goal - g.scoreSum, g.scores);
    totalW += g.weight;
    totalA += pA * g.weight;
    totalB += pB * g.weight;
  }
  if (totalW === 0) return { chance: 0, p4: 0, p3: 0 };
  const mA = totalA / totalW; // 4 词条盘路径（成长 5 次）通过率
  const mB = totalB / totalW; // 3 词条盘路径（补词条后成长 4 次）通过率
  return { chance: FOUR_SUB_CHANCE * mA + THREE_SUB_CHANCE * mB, p4: mA, p3: mB };
}

// ---------- 保词条版（比当前盘更强且词条不缩水） ----------
/** 固定值副词条 → 其百分比变体（保词条匹配时百分比视为「一定超过」固定值） */
const FIXED_TO_PCT = {
  [DISC_SUBSTATS.indexOf(SUBSTAT.ATK)]: DISC_SUBSTATS.indexOf(SUBSTAT.ATK_PCT), // 攻击力 → 攻击力%
  [DISC_SUBSTATS.indexOf(SUBSTAT.HP)]: DISC_SUBSTATS.indexOf(SUBSTAT.HP_PCT), // 生命值 → 生命值%
  [DISC_SUBSTATS.indexOf(SUBSTAT.DEF)]: DISC_SUBSTATS.indexOf(SUBSTAT.DEF_PCT), // 防御力 → 防御力%
};

/**
 * 同 computeDiscProb，但额外要求「当前盘每个副词条在新盘中命中数都不低于原盘」：
 * minHits = 10 维数组（typeIndex → 最低命中次数，0 = 无约束）。
 * 新盘 4 个副词条（槽位顺序无关，按词条类型一对一匹配）必须满足全部约束：
 *   - 同类型：新盘该词条最终命中（1 + 强化次数）≥ minHits[type]；
 *   - 百分比变体替代：约束为固定值（攻击力/生命值/防御力）时，新盘的对应百分比词条
 *     （攻击力%/生命值%/防御力%）可视为「词条超过」直接满足（命中 ≥ 1 即可，反向不成立）；
 *   - 当前盘同时有固定值与百分比时两者各自独立约束（一个词条只能满足一个约束）。
 * 且总分 > goal。返回 { chance }。
 */
export function computeDiscProbKeep(types, goal, minHits, directedTypes = []) {
  const minH = minHits || [];
  const cons = [];
  for (let ti = 0; ti < minH.length; ti++) {
    if (minH[ti] > 0) cons.push({ type: ti, need: minH[ti] });
  }
  const groups = [];
  (function pick(rest, chosen, weight) {
    if (chosen.length === 4) {
      if (directedTypes.length) {
        const have = new Set(chosen.map((c) => c.typeIndex));
        if (!directedTypes.every((t) => have.has(t))) return;
      }
      groups.push({ chosen: chosen.slice(), weight }); // 必须存副本：chosen 在回溯时被 pop 复用
      return;
    }
    const total = rest.reduce((s, t) => s + (t.rest > 0 ? t.specialWeight : 0), 0);
    if (total === 0) return;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (t.rest <= 0) continue;
      const next = rest.map((x) => ({ ...x }));
      next[i].rest--;
      chosen.push(t);
      pick(next, chosen, weight * (t.specialWeight / total));
      chosen.pop();
    }
  })(types.map((t) => ({ ...t })), [], 1);

  /** 约束能否被 combo 词条（各带最终命中 hits）一对一全匹配（二分匹配回溯） */
  function matchOk(combo, hits, cons) {
    if (cons.length > combo.length) return false;
    const used = new Array(combo.length).fill(false);
    function tryMatch(ci) {
      if (ci === cons.length) return true;
      const c = cons[ci];
      for (let j = 0; j < combo.length; j++) {
        if (used[j]) continue;
        const t = combo[j].typeIndex;
        const okSelf = t === c.type && hits[j] >= c.need;
        const okPct = t === FIXED_TO_PCT[c.type] && hits[j] >= 1; // 百分比变体视为超过固定值
        if (okSelf || okPct) {
          used[j] = true;
          if (tryMatch(ci + 1)) return true;
          used[j] = false;
        }
      }
      return false;
    }
    return tryMatch(0);
  }

  /** 组合的强化路径通过率：times 次强化分配到 4 词条（stars-and-bars 枚举分布 × multinomial 权重，比全排列快） */
  function passKeep(combo, times) {
    const n = combo.length;
    if (cons.length > n) return 0;
    const fact = (x) => {
      let r = 1;
      for (let i = 2; i <= x; i++) r *= i;
      return r;
    };
    const num = fact(times);
    let total = 0;
    let pass = 0;
    const dist = new Array(n).fill(0);
    (function rec(i, remain) {
      if (i === n - 1) {
        dist[i] = remain;
        let w = num; // multinomial = times! / Π dist_j!（总权重 = n^times，公共因子已含）
        for (let j = 0; j < n; j++) w /= fact(dist[j]);
        total += w;
        const hits = dist.map((d) => 1 + d);
        let score = 0;
        for (let j = 0; j < n; j++) score += hits[j] * combo[j].score;
        if (score > goal && matchOk(combo, hits, cons)) pass += w;
        return;
      }
      for (let c = 0; c <= remain; c++) {
        dist[i] = c;
        rec(i + 1, remain - c);
      }
    })(0, times);
    return total === 0 ? 0 : pass / total;
  }

  let totalW = 0;
  let totalA = 0;
  let totalB = 0;
  for (const g of groups) {
    totalW += g.weight;
    totalA += passKeep(g.chosen, FOUR_SUB_TIMES) * g.weight;
    totalB += passKeep(g.chosen, THREE_SUB_TIMES) * g.weight;
  }
  if (totalW === 0) return { chance: 0 };
  return { chance: (FOUR_SUB_CHANCE * totalA + THREE_SUB_CHANCE * totalB) / totalW };
}

// ---------- 位置级概率（主词条加权 + 位置系数） ----------
/**
 * pos 1-6；mains = 该位置选中的主词条（pos≤3 忽略，传 [] 或 null，空 = 不限即全部主词条）；
 * types 为 10 词条池（含 score/rest/specialWeight），buildTypes 可构造。
 * opts.posFixed（定向道具）：非空主词条名 = 位置与主词条都已确定（不乘位置 1/6、不乘主词条出现概率），
 *   123 号位传任意非空值即可（主词条固定，仅消除位置随机）。
 * 返回 { prob, hitMain, p4, p3 }：
 *   hitMain = 抽中该号位主词条的概率（未定向 456 = 1/6 × 主词条出现概率和，123 = 1/6；定向 = 1）；
 *   p4 = 初始 4 词条盘升满后超过的<b>纯条件概率</b>（不含 hitMain：456 按主词条相对占比加权平均）；
 *   p3 = 初始 3 词条盘升满后超过的<b>纯条件概率</b>（不含 hitMain）；
 *   prob = 总概率（含 hitMain 与分支占比）；单目标主词条时 prob = hitMain × (0.2×p4 + 0.8×p3)。
 */
export function computePosProb(pos, mains, types, goal, directedTypes = [], opts = {}) {
  if (opts.posFixed) {
    // 定向：位置确定；456 主词条确定（123 主词条固定）
    if (pos <= 3) {
      const r = computeDiscProb(types, goal, directedTypes);
      return { prob: r.chance, hitMain: 1, p4: r.p4, p3: r.p3 };
    }
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[opts.posFixed]);
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProb(pool, goal, directedTypes);
    return { prob: r.chance, hitMain: 1, p4: r.p4, p3: r.p3 };
  }
  if (pos <= 3) {
    const r = computeDiscProb(types, goal, directedTypes);
    return { prob: r.chance / 6, hitMain: 1 / 6, p4: r.p4, p3: r.p3 };
  }
  const probWeights = DISC_MAIN_PROB_WEIGHTS[pos];
  const totalAll = Object.values(probWeights).reduce((s, v) => s + v, 0); // 全位置主词条权重和（≈100）
  if (totalAll === 0) return { prob: 0, hitMain: 0, p4: 0, p3: 0 };
  const mainList = mains && mains.length ? mains : Object.keys(probWeights);
  const totalW = mainList.reduce((s, m) => s + (probWeights[m] || 0), 0); // 选中集权重和（p4/p3 归一口径）
  let hitMain = 0;
  let p4 = 0;
  let p3 = 0;
  let prob = 0;
  for (const main of mainList) {
    const w = probWeights[main] || 0;
    const f = w / totalAll / 6; // 位置 1/6 × 主词条出现概率
    hitMain += f;
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[main]); // 主词条同类副词条（SUBSTAT 值 → 索引）
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProb(pool, goal, directedTypes);
    const rel = w / totalW; // 选中集内相对占比（p4/p3 纯条件，不含位置与绝对主词条概率；单目标 = 1）
    p4 += r.p4 * rel;
    p3 += r.p3 * rel;
    prob += r.chance * f;
  }
  return { prob, hitMain, p4, p3 };
}

/**
 * 保词条版位置概率：同 computePosProb，但内部用 computeDiscProbKeep
 * （新盘必须包含当前盘全部权重>0 的副词条类型且各自命中不低，且总分超过）。
 */
export function computePosProbKeep(pos, mains, types, goal, minHits, directedTypes = [], opts = {}) {
  if (opts.posFixed) {
    if (pos <= 3) {
      const r = computeDiscProbKeep(types, goal, minHits, directedTypes);
      return { prob: r.chance };
    }
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[opts.posFixed]);
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProbKeep(pool, goal, minHits, directedTypes);
    return { prob: r.chance };
  }
  if (pos <= 3) {
    const r = computeDiscProbKeep(types, goal, minHits, directedTypes);
    return { prob: r.chance / 6 };
  }
  const probWeights = DISC_MAIN_PROB_WEIGHTS[pos];
  const totalAll = Object.values(probWeights).reduce((s, v) => s + v, 0);
  if (totalAll === 0) return { prob: 0 };
  const mainList = mains && mains.length ? mains : Object.keys(probWeights);
  let prob = 0;
  for (const main of mainList) {
    const w = probWeights[main] || 0;
    const blockedIdx = DISC_SUBSTATS.indexOf(DISC_MAIN_BLOCK[main]);
    const pool = types.map((t) => ({ ...t, rest: t.typeIndex === blockedIdx ? 0 : t.rest }));
    const r = computeDiscProbKeep(pool, goal, minHits, directedTypes);
    prob += (r.chance * w) / totalAll / 6;
  }
  return { prob };
}

/** 构造 10 词条池：weights 为角色 10 维价值权重（score），rest 默认 1（同盘不重复），blockedIdx 排除主词条同类 */
export function buildTypes(weights, rest = 1, blockedIdx = -1) {
  return DISC_SUBSTATS.map((_, i) => ({
    typeIndex: i,
    score: weights[i] || 0,
    rest: i === blockedIdx ? 0 : rest,
    specialWeight: DISC_SUBSTAT_SPECIAL_WEIGHTS[i],
  }));
}

// ---------- 练度评级（概率越低 = 目标分越高 = 越接近毕业） ----------
export const GRADE_TABLE = {
  123: [
    [0.003, '完美毕业', 'var(--red)'],
    [0.033, '大毕业', 'var(--hazard)'],
    [0.064, '小毕业', 'var(--purple)'],
    [0.12, '能用', 'var(--blue)'],
    [Infinity, '可提升空间极大', 'var(--dim)'],
  ],
  456: [
    [0.08, '完美毕业', 'var(--red)'],
    [0.17, '大毕业', 'var(--hazard)'],
    [0.24, '小毕业', 'var(--purple)'],
    [0.48, '能用', 'var(--blue)'],
    [Infinity, '可提升空间极大', 'var(--dim)'],
  ],
};
export function gradeOf(prob, pos) {
  const table = pos <= 3 ? GRADE_TABLE['123'] : GRADE_TABLE['456'];
  for (const [th, label, color] of table) {
    if (prob <= th) return { label, color };
  }
  return { label: '可提升空间极大', color: 'var(--dim)' };
}
