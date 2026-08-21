// src/lib/discRules.js —— 驱动盘领域规则「唯一权威」模块（Node 与浏览器共用）
// ⚠️ 新增/修改任何驱动盘相关规则前先查这里；每条规则带编号注释（A-H 审阅稿编号）。
// 依赖：constants.js（叶子）+ util.js（叶子），禁止反向 import；本模块被 calc.js / discProb.js / workshopAgg.js / web/* 引用。
// 规则编号：A=词条体系 · B=生成模型(ZZZ-DDC) · C=分数与命中 · D=权重来源 · E=保词条比较 · F=套装 · G=工坊口径 · H=显示
// （F 套装规则与 G 工坊口径依赖各自上下文，保留在原模块，此处只收录 A/B/C/D/E/H 的可复用纯规则）

import {
  STAT,
  SUBSTAT,
  DISC_SUBSTATS,
  DISC_SUBSTAT_SPECIAL_WEIGHTS,
  DISC_MAIN_PROB_WEIGHTS,
  DISC_MAIN_BLOCK,
  MAIN_STAT_OPTIONS,
  mainStatName,
  WS_KEY_TO_STAT,
  DISC_SUBSTAT_WS_KEY,
} from './constants.js';
import { statEntries } from './util.js';

// ============================================================
// A. 词条体系
// ============================================================
// A1/A2/A6/A7/A8/A9/D3 的权威定义在 constants.js（依赖树叶子），此处再导出，驱动盘逻辑统一从这里取。
export {
  DISC_SUBSTATS,
  DISC_SUBSTAT_SPECIAL_WEIGHTS,
  DISC_MAIN_PROB_WEIGHTS,
  DISC_MAIN_BLOCK,
  MAIN_STAT_OPTIONS,
  mainStatName,
  WS_KEY_TO_STAT,
  DISC_SUBSTAT_WS_KEY,
};

// A5：1-3 号位主词条固定（游戏定死，不可选）
export const SLOT_FIXED_MAIN = { 1: STAT.HP, 2: STAT.ATK, 3: STAT.DEF };

// A3：副词条成长表（S/A/B 三档，内部小数口径：百分比存小数如 0.024=2.4%）。
// 数据来源：bilibili wiki。S 级副词条初始值 = 成长值，每强化一次 +成长值，等级每 +3 触发一次成长。
// ⚠️ mys 源（去 % 的整数，如暴击率 2.4）与 2025 源（×100 整数）在此表基础上换算，见 C4 substatRolls。
export const substatGrowthTable = {
  S: {
    穿透值: 9,
    异常精通: 9,
    防御力: 15,
    攻击力: 19,
    生命值: 112,
    暴击率: 0.024,
    '生命值%': 0.03,
    '攻击力%': 0.03,
    暴击伤害: 0.048,
    '防御力%': 0.048,
  },
  A: {
    穿透值: 6,
    异常精通: 6,
    防御力: 10,
    攻击力: 13,
    生命值: 75,
    暴击率: 0.016,
    '生命值%': 0.02,
    '攻击力%': 0.02,
    暴击伤害: 0.032,
    '防御力%': 0.032,
  },
  B: {
    穿透值: 3,
    异常精通: 3,
    防御力: 5,
    攻击力: 6,
    生命值: 0,
    暴击率: 0.008,
    '生命值%': 0.01,
    '攻击力%': 0.01,
    暴击伤害: 0.016,
    '防御力%': 0.016,
  },
};

// A4：副词条形态判定（% vs 固定）。暴击/暴伤恒为 %；其余按数值大小（≤1 视为百分比）。
export function substatType(name, value) {
  return [STAT.CR, STAT.CD].includes(name) ? name : value <= 1 ? name + '%' : name;
}

// ============================================================
// B. 驱动盘生成模型（ZZZ-DDC 移植）
// ============================================================
// B2：初始词条数占比（游戏实际：掉落盘初始 3 副词条占 80%、4 副词条占 20%）
export const FOUR_SUB_CHANCE = 0.2; // 初始 4 词条盘概率
export const THREE_SUB_CHANCE = 0.8; // 初始 3 词条盘概率
// B3：强化成长次数。15 级盘共 5 次强化事件：4 词条盘 5 次全是成长；3 词条盘第 1 次强化补第 4 词条、之后 4 次成长
export const FOUR_SUB_TIMES = 5; // 4 词条盘成长次数
export const THREE_SUB_TIMES = 4; // 3 词条盘补词条后的成长次数

// B4/B5：强化成长通过率。递归 times 次（每次从 nowGroup 随机一条 +score），统计 add > need（严格大于）的路径占比。
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

/** 构造 10 词条池：weights 为角色 10 维价值权重（score），rest 默认 1（同盘不重复），blockedIdx 排除主词条同类 */
export function buildTypes(weights, rest = 1, blockedIdx = -1) {
  return DISC_SUBSTATS.map((_, i) => ({
    typeIndex: i,
    score: weights[i] || 0,
    rest: i === blockedIdx ? 0 : rest,
    specialWeight: DISC_SUBSTAT_SPECIAL_WEIGHTS[i],
  }));
}

// B1/B5：首 4 词条组合枚举 + 达标概率。
// 词条池 types: [{ typeIndex, score, rest, specialWeight }]（rest = 该词条可用数，通常 1 = 同盘不重复）
// 目标 goal（价值分）：对每个首 4 词条组合（按 specialWeight 概率加权），
// 基础分达标则通过率 1，否则按 4/3 词条两路径强化成长算通过率；两路径按 20%/80% 占比加权。
// 返回 { chance, p4, p3 }（均未含主词条/位置 scaleFactor）：chance = 0.2×p4 + 0.8×p3；
// p4 = 初始 4 词条盘（成长 5 次）的条件通过率；p3 = 初始 3 词条盘（补词条后成长 4 次）的条件通过率。
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

// B6/B7/B8：位置级概率（主词条加权 + 位置系数 + 定向道具）。
// pos 1-6；mains = 该位置选中的主词条（pos≤3 忽略，传 [] 或 null，空 = 不限即全部主词条）。
// B7：主词条概率按「全位置权重和」归一（mains 只决定哪些主词条计入成功，不改变其出现概率）；
// B6：位置随机 ×1/6。
// B8 opts.posFixed（定向道具）：非空主词条名 = 位置与主词条都已确定（不乘 1/6、不乘主词条出现概率），
//   123 号位传任意非空值即可（主词条固定，仅消除位置随机）。
// 返回 { prob, hitMain, p4, p3 }：
//   hitMain = 抽中该号位主词条的概率（未定向 456 = 1/6 × 主词条出现概率和，123 = 1/6；定向 = 1）；
//   p4 = 初始 4 词条盘升满后超过的纯条件概率（不含 hitMain：456 按主词条相对占比加权平均）；
//   p3 = 初始 3 词条盘升满后超过的纯条件概率（不含 hitMain）；
//   prob = 总概率（含 hitMain 与分支占比）；单目标主词条时 prob = hitMain × (0.2×p4 + 0.8×p3)。
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

// ============================================================
// C. 分数与命中
// ============================================================
// C1：单盘副词条价值分 = Σ 每条副词条 命中次数(1+强化次数) × 价值权重。
// growth 为 C2 discGrowth 产物（{type, growthCount} 数组）；weights 为 10 维价值权重（按 DISC_SUBSTATS 下标）。
export function discScore(growth, weights) {
  return (growth || []).reduce((s, g) => {
    const w = weights?.[DISC_SUBSTATS.indexOf(g.type)] ?? 0;
    return s + (1 + g.growthCount) * w;
  }, 0);
}

// C3：单盘落在有效词条上的命中次数（每个词条本身 1 + 成长次数）；validSet 空 = 无有效集，返回 null。
// 供 models.Disc.getHitCount / calc.hitCount 与「我的角色」副词条命中共用。
export function discHits(growth, validSet) {
  if (!validSet || !validSet.size) return null;
  return (growth || []).filter((g) => validSet.has(g.type)).reduce((s, g) => s + 1 + g.growthCount, 0);
}

// C2：单个驱动盘各副词条的成长（强化）次数 = 当前值/成长值 - 1（下限 0）。
// 与 subStats 顺序一一对应；返回 [{name, value, type, growthCount}]。
export function discGrowth(disc, rarity) {
  const table = substatGrowthTable[rarity] || substatGrowthTable.S;
  return statEntries(disc.subStats).map((t) => {
    const type = substatType(t.name, t.value);
    const growth = table[type];
    return { ...t, type, growthCount: growth ? Math.max(0, Math.round(t.value / growth - 1)) : 0 };
  });
}

// C4：还原一条副词条的强化次数（1-6）。源按 value 类型自判（number=2025 需 ÷100 归一百分比、string=mys 去 % 的数）。
// 基数与 A3 成长表同源：百分比形态 = S 级成长值 × 100（mys/2025 存「去 % 的数」整数）。
// 为什么还原次数：旧「有效词条个数」99.95% 恒为 4 无区分度；value/base 99.9987% 恰为 1-6 整数（余 19 条异常靠 round+钳制兜底）。
const PCT_SUBSTATS = new Set(['暴击率', '暴击伤害', '攻击力%', '生命值%', '防御力%']);
export function substatRolls(name, value) {
  const growth = substatGrowthTable.S[name];
  if (!growth) return 0;
  const raw = parseFloat(String(value));
  if (!Number.isFinite(raw)) return 0;
  const v = typeof value === 'number' && PCT_SUBSTATS.has(name) ? raw / 100 : raw;
  const base = PCT_SUBSTATS.has(name) ? growth * 100 : growth; // 统一换算到「去 % 的数」口径
  const r = Math.round(v / base);
  return r < 1 ? 0 : r > 6 ? 6 : r; // 钳制：异常值（实测 19/144 万）不至于把分布拉出量程
}

// ============================================================
// D. 价值权重来源
// ============================================================
// D2：查不到工坊权重时的默认模板（攻击力% 0.3 + 通用双暴）
export const DEFAULT_WEIGHTS = [0, 0, 0.3, 0.3, 0.3, 0, 0, 1, 1, 0];

// D3/D4：库角色名 → 10 维价值权重。数据源 workshop-weights（经 workshop-grad 的 role_id→wiki 名对齐）。
// 落地数据 key 已是 CONSTANT 标准名（抽取时经 WS_KEY_TO_STAT 映射），此处按 DISC_SUBSTAT_WS_KEY 直接匹配
// （% 与固定共享父属性权重：攻击力%/攻击力 都取「攻击力」）。查不到角色返回 null。
export function roleWeightsFromWs(libName, weightJson, gradRoles) {
  const role = (gradRoles || []).find((r) => r.name === libName);
  const entry = role && weightJson?.[role.item_id];
  const ws = entry?.factions?.[0]?.weights;
  if (!ws) return null;
  const w = new Map(ws.map((x) => [x.key, x.weight]));
  return DISC_SUBSTATS.map((name) => w.get(DISC_SUBSTAT_WS_KEY[name]) || 0);
}

// ============================================================
// E. 保词条比较（比当前盘更强且词条不缩水）
// ============================================================
// E3：固定值副词条 → 其百分比变体（保词条匹配时百分比视为「一定超过」固定值）
export const FIXED_TO_PCT = {
  [DISC_SUBSTATS.indexOf(SUBSTAT.ATK)]: DISC_SUBSTATS.indexOf(SUBSTAT.ATK_PCT), // 攻击力 → 攻击力%
  [DISC_SUBSTATS.indexOf(SUBSTAT.HP)]: DISC_SUBSTATS.indexOf(SUBSTAT.HP_PCT), // 生命值 → 生命值%
  [DISC_SUBSTATS.indexOf(SUBSTAT.DEF)]: DISC_SUBSTATS.indexOf(SUBSTAT.DEF_PCT), // 防御力 → 防御力%
};

// E1-E4：同 computeDiscProb，但额外要求「当前盘每个副词条在新盘中命中数都不低于原盘」：
// minHits = 10 维数组（typeIndex → 最低命中次数，0 = 无约束）。
// 新盘 4 个副词条（槽位顺序无关，按词条类型一对一匹配）必须满足全部约束：
//   - 同类型：新盘该词条最终命中（1 + 强化次数）≥ minHits[type]；
//   - 百分比变体替代（E3）：约束为固定值（攻击力/生命值/防御力）时，新盘的对应百分比词条
//     可视为「词条超过」直接满足（命中 ≥ 1 即可，反向不成立）；
//   - 当前盘同时有固定值与百分比时两者各自独立约束（一个词条只能满足一个约束，E1/E2）。
// 且总分 > goal（E4）。返回 { chance }。
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

  /** 约束能否被 combo 词条（各带最终命中 hits）一对一全匹配（二分匹配回溯，E1/E3） */
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

// E1-E4 位置级：同 computePosProb，但内部用 computeDiscProbKeep（新盘必须包含当前盘全部权重>0 的副词条类型且各自命中不低，且总分超过）。
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

// ============================================================
// H. 显示规则
// ============================================================
// H1：副词条池 5 行 × 2 列配对顺序（每行两个数值即 DISC_SUBSTATS 下标；固定值在前、百分比在后）
export const DP_ROW_PAIRS = [
  [1, 0], // 生命值   | 生命值%
  [6, 5], // 防御力   | 防御力%
  [3, 2], // 攻击力   | 攻击力%
  [8, 7], // 暴击率   | 暴击伤害
  [9, 4], // 异常精通 | 穿透值
];
/** 副词条下拉/显示展示顺序（配对展平，与权重池一致） */
export const DP_SUB_ORDER = DP_ROW_PAIRS.flat();
