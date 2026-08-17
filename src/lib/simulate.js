// src/lib/simulate.js —— 驱动盘成长极限模拟：给定角色/音擎/套装/456 主词条后，
// 把六枚 S 级满级驱动盘的副词条强化次数在任意两个面板属性之间分配，
// 求这两个属性的帕累托有效前沿（Pareto efficient frontier）。
// 纯逻辑、无 DOM/Node 依赖；数据经参数注入，浏览器与 Node 测试共用。
//
// 模型口径（重要）：
// - 每枚盘按 S 级满级处理：4 个副词条槽、总强化次数 9（4 初始 + 5 次强化）。
// - 每枚盘同一副词条类型只能出现一次、单条最多 6 次强化（初始 1 + 强化 5）。
// - 副词条类型不得与该盘主词条重复：例如 4 号位主词条为异常精通时，该盘副词条不再出现异常精通。
// - 有效前沿只关心两个轴属性；其余副词条槽一律视为「废词条」填 1 次。
//   这是「把成长极限画成两属性前沿」的可视化口径，不承诺三属性同时最优。
// - 4 件套条件效果与音擎被动特效不计入面板（与现有「推算未计 4 件套条件效果」口径一致）；
//   4 件套所选套装的 2 件套效果按 4+2 配装实际生效计入。

import { resolveEntry, CATEGORY } from './names.js';
import { panelBonus, classifyBonus, coreSkillBoostAt, substatGrowthTable } from './calc.js';
import { PANEL_ORDER, STAT } from './constants.js';
import { statEntries } from './util.js';

const S = substatGrowthTable.S;

/** S 级满级驱动盘主词条数值（456 号位的百分比/特殊词条均为内部小数口径） */
export const MAIN_STAT_S = {
  1: { 生命值: 2200 },
  2: { 攻击力: 316 },
  3: { 防御力: 184 },
  4: {
    '生命值%': 0.3,
    '攻击力%': 0.3,
    '防御力%': 0.48,
    异常精通: 92,
    暴击率: 0.24,
    暴击伤害: 0.48,
  },
  5: {
    '生命值%': 0.3,
    '攻击力%': 0.3,
    '防御力%': 0.48,
    穿透率: 0.24,
    物理伤害加成: 0.3,
    火属性伤害加成: 0.3,
    冰属性伤害加成: 0.3,
    电属性伤害加成: 0.3,
    以太伤害加成: 0.3,
    风属性伤害加成: 0.3,
  },
  6: {
    '生命值%': 0.3,
    '攻击力%': 0.3,
    '防御力%': 0.48,
    冲击力: 0.18,
    异常掌控: 0.3,
    能量自动回复: 0.6,
  },
};

/** 面板属性 -> 能影响它的副词条类型。攻击/生命/防御有 % 与固定值两种形态。 */
const SUBSTAT_SOURCES = {
  [STAT.ATK]: [
    { type: '攻击力%', kind: 'pct', stat: STAT.ATK, value: S['攻击力%'] },
    { type: '攻击力', kind: 'flat', stat: STAT.ATK, value: S['攻击力'] },
  ],
  [STAT.HP]: [
    { type: '生命值%', kind: 'pct', stat: STAT.HP, value: S['生命值%'] },
    { type: '生命值', kind: 'flat', stat: STAT.HP, value: S['生命值'] },
  ],
  [STAT.DEF]: [
    { type: '防御力%', kind: 'pct', stat: STAT.DEF, value: S['防御力%'] },
    { type: '防御力', kind: 'flat', stat: STAT.DEF, value: S['防御力'] },
  ],
  [STAT.CR]: [{ type: '暴击率', kind: 'add', stat: STAT.CR, value: S['暴击率'] }],
  [STAT.CD]: [{ type: '暴击伤害', kind: 'add', stat: STAT.CD, value: S['暴击伤害'] }],
  [STAT.ANOMALY_PROF]: [{ type: '异常精通', kind: 'add', stat: STAT.ANOMALY_PROF, value: S['异常精通'] }],
  [STAT.PEN_VALUE]: [{ type: '穿透值', kind: 'add', stat: STAT.PEN_VALUE, value: S['穿透值'] }],
};

/** 主词条 UI 名 -> 面板属性名（456 的 攻击力%/生命值%/防御力% 累加到对应面板属性乘区）。 */
function mainStatForPanel(name) {
  if (name === '攻击力%') return STAT.ATK;
  if (name === '生命值%') return STAT.HP;
  if (name === '防御力%') return STAT.DEF;
  return name;
}
function canonMain(name) {
  if (name === STAT.ATK) return '攻击力%';
  if (name === STAT.HP) return '生命值%';
  if (name === STAT.DEF) return '防御力%';
  return name;
}

/** 固定面板（角色满级基础 + 音擎 + 456 主词条，不含 2 件套与副词条）。 */
function fixedPanel(libChar, libWengine, mains) {
  const max = libChar?.maxLevel || {};
  const coreFlat = (s) => coreSkillBoostAt(libChar, s, 7);
  const base = {};
  for (const s of PANEL_ORDER) base[s] = null;
  base[STAT.ATK] = (max[STAT.ATK] ?? libChar?.[STAT.ATK] ?? 0) + (libWengine?.baseAtk ?? 0) + coreFlat(STAT.ATK);
  base[STAT.HP] = (max[STAT.HP] ?? libChar?.[STAT.HP] ?? 0) + coreFlat(STAT.HP);
  base[STAT.DEF] = (max[STAT.DEF] ?? libChar?.[STAT.DEF] ?? 0) + coreFlat(STAT.DEF);
  for (const s of PANEL_ORDER) {
    if (base[s] != null || s === STAT.PEN_VALUE) continue;
    base[s] = (libChar?.[s] ?? 0) + coreFlat(s);
  }
  base[STAT.PEN_VALUE] = 0;

  const pct = {};
  const flat = {};
  const damage = {};
  const accumulate = (name, value) => {
    const c = classifyBonus(name, value);
    if (!c) return;
    if (c.kind === 'damage') {
      damage[name] = (damage[name] || 0) + value;
    } else if (c.kind === 'pen') {
      flat[STAT.PEN_VALUE] = (flat[STAT.PEN_VALUE] || 0) + value;
    } else if (c.kind === 'pct') {
      pct[name] = (pct[name] || 0) + value;
    } else {
      flat[name] = (flat[name] || 0) + value;
    }
  };

  for (const t of statEntries(libWengine?.subStats)) accumulate(t.name, t.value);

  // 核心技百分比提升（攻击力%/生命值%/防御力%/冲击力%）进入对应乘区。
  for (const baseName of [STAT.ATK, STAT.HP, STAT.DEF, STAT.IMPACT]) {
    const v = coreSkillBoostAt(libChar, baseName + '%', 7);
    if (v) accumulate(baseName, v);
  }

  const slots = [
    { slot: 1, name: '生命值' },
    { slot: 2, name: '攻击力' },
    { slot: 3, name: '防御力' },
    { slot: 4, name: mains[4] },
    { slot: 5, name: mains[5] },
    { slot: 6, name: mains[6] },
  ];
  for (const { slot, name } of slots) {
    if (!name) continue;
    const table = MAIN_STAT_S[slot] || {};
    const value = table[canonMain(name)] ?? table[name];
    if (value != null) accumulate(mainStatForPanel(canonMain(name)), value);
  }

  const final = {};
  for (const s of PANEL_ORDER) {
    if (base[s] == null) continue;
    final[s] = panelBonus(s, base[s], pct[s] || 0, flat[s] || 0).final;
  }
  for (const [name, value] of Object.entries(damage)) final[name] = value;

  if (libChar?.trait === '命破' && final[STAT.ATK] != null && final[STAT.HP] != null) {
    const pierce = (a, h) => Math.round(0.3 * a + 0.1 * h);
    base[STAT.PIERCE] = pierce(base[STAT.ATK], base[STAT.HP]);
    final[STAT.PIERCE] = pierce(final[STAT.ATK], final[STAT.HP]);
    base[STAT.PEN_RATE] = null;
    final[STAT.PEN_RATE] = null;
  }

  return { base, final, pct, flat, damage };
}

/** 在 fixedPanel 基础上补 2 件套后合成最终固定面板。 */
function fixedPanelWithSets(fixed, libChar, setBonuses) {
  const base = { ...fixed.base };
  const pct = { ...fixed.pct };
  const flat = { ...fixed.flat };
  const damage = { ...(fixed.damage || {}) };
  for (const [name, value] of Object.entries(setBonuses)) {
    const c = classifyBonus(name, value);
    if (!c) continue;
    if (c.kind === 'damage') damage[name] = (damage[name] || 0) + value;
    else if (c.kind === 'pct') pct[name] = (pct[name] || 0) + value;
    else flat[name] = (flat[name] || 0) + value;
  }
  const final = {};
  for (const s of PANEL_ORDER) {
    if (base[s] == null) continue;
    final[s] = panelBonus(s, base[s], pct[s] || 0, flat[s] || 0).final;
  }
  for (const [name, value] of Object.entries(damage)) final[name] = value;
  if (libChar?.trait === '命破' && final[STAT.ATK] != null && final[STAT.HP] != null) {
    const pierce = (a, h) => Math.round(0.3 * a + 0.1 * h);
    base[STAT.PIERCE] = pierce(base[STAT.ATK], base[STAT.HP]);
    final[STAT.PIERCE] = pierce(final[STAT.ATK], final[STAT.HP]);
    base[STAT.PEN_RATE] = null;
    final[STAT.PEN_RATE] = null;
  }
  return { base, final };
}

/** 单个副词条源在给定白值下的每强化次数收益。 */
function rollContribution(def, base) {
  if (def.kind === 'pct') return (base[def.stat] ?? 0) * def.value;
  return def.value;
}

/** 生成单枚驱动盘的全部帕累托副词条分配方案（仅关心两个轴属性的收益）。
 *  bannedType 为该盘主词条对应的副词条类型（副词条不能与主词条重复）。 */
function discOptions(relevant, bannedType) {
  const allowedIdx = relevant.map((_, i) => i).filter((i) => relevant[i].type !== bannedType);
  if (!allowedIdx.length) return [{ dx: 0, dy: 0, detail: '无可用词条' }];
  const m = allowedIdx.length;
  const raw = [];
  const maxK = Math.min(4, m);
  const pick = (arr, k) => {
    const out = [];
    const walk = (start, cur) => {
      if (cur.length === k) {
        out.push(cur.slice());
        return;
      }
      for (let i = start; i < arr.length; i++) {
        cur.push(arr[i]);
        walk(i + 1, cur);
        cur.pop();
      }
    };
    walk(0, []);
    return out;
  };
  const comps = (k, total, prefix = [], out = []) => {
    if (k === 1) {
      if (total >= 1 && total <= 6) out.push([...prefix, total]);
      return out;
    }
    for (let r = 1; r <= Math.min(6, total - (k - 1)); r++) {
      prefix.push(r);
      comps(k - 1, total - r, prefix, out);
      prefix.pop();
    }
    return out;
  };

  for (let k = 1; k <= maxK; k++) {
    for (const idx of pick(allowedIdx, k)) {
      for (const rolls of comps(k, 5 + k)) {
        let dx = 0;
        let dy = 0;
        const detail = [];
        idx.forEach((ri, pos) => {
          const src = relevant[ri];
          dx += rolls[pos] * src.dx;
          dy += rolls[pos] * src.dy;
          detail.push(src.type + '×' + rolls[pos]);
        });
        raw.push({ dx, dy, detail: detail.join('、') });
      }
    }
  }
  return paretoPoints(raw);
}

/** 二维最大化帕累托过滤：按 x 升序、y 降序，保留 y 严格递增的点。 */
function paretoPoints(points) {
  const arr = points
    .map((p) => ({ dx: p.dx, dy: p.dy, detail: p.detail }))
    .sort((a, b) => b.dx - a.dx || b.dy - a.dy);
  const out = [];
  let maxY = -Infinity;
  for (const p of arr) {
    if (p.dy > maxY + 1e-9) {
      out.push(p);
      maxY = p.dy;
    }
  }
  return out.reverse();
}

/** 把六枚盘各自的分配方案做动态规划卷积，得到两轴总收益前沿。 */
function combineDiscOptions(optionsBySlot) {
  let states = [{ dx: 0, dy: 0 }];
  for (const options of optionsBySlot) {
    const next = [];
    for (const s of states) {
      for (const o of options) {
        next.push({ dx: s.dx + o.dx, dy: s.dy + o.dy });
      }
    }
    states = paretoPoints(next);
  }
  return states;
}


/** 槽位主词条 -> 对应副词条类型（用于「副词条不与主词条重复」约束）。 */
function mainTypeForSlot(slot, mains) {
  if (slot === 1) return '生命值';
  if (slot === 2) return '攻击力';
  if (slot === 3) return '防御力';
  return canonMain(mains[slot]) || '';
}
/**
 * 解析一次配装，返回固定面板与主词条（2D/3D 共用）。
 */
function resolveBuild(ctx, opts) {
  const { charIndex, wengineIndex, discIndex } = ctx;
  const libChar = resolveEntry(CATEGORY.CHAR, charIndex, opts.charName) || {};
  const libWengine = resolveEntry(CATEGORY.WENGINE, wengineIndex, opts.wengineName) || {};
  const setBonuses = {};
  const addSet = (name) => {
    if (!name) return;
    const disc = resolveEntry(CATEGORY.DISC, discIndex, name);
    for (const [k, v] of Object.entries(disc?.set2 || {})) setBonuses[k] = (setBonuses[k] || 0) + v;
  };
  addSet(opts.set2);
  addSet(opts.set4);
  const mains = { 4: canonMain(opts.main4), 5: canonMain(opts.main5), 6: canonMain(opts.main6) };
  const fixed = fixedPanel(libChar, libWengine, mains);
  const withSets = fixedPanelWithSets(fixed, libChar, setBonuses);
  return { libChar, libWengine, withSets, mains };
}

/** 由坐标轴构造副词条来源：每个来源只在所属轴维度上有收益。 */
function buildSourceDefs(axes, base) {
  const nDims = axes.length;
  const sourceDefs = [];
  axes.forEach((stat, ai) => {
    for (const def of SUBSTAT_SOURCES[stat] || []) {
      const gain = rollContribution(def, base);
      if (!Number.isFinite(gain) || gain <= 0) continue;
      const dims = Array(nDims).fill(0);
      dims[ai] = gain;
      sourceDefs.push({ ...def, dims, gain });
    }
  });
  return sourceDefs;
}

/** 生成单枚驱动盘的全部 N 维帕累托副词条分配方案。 */
function discOptionsND(relevant, bannedType, nDims) {
  const allowedIdx = relevant.map((_, i) => i).filter((i) => relevant[i].type !== bannedType);
  if (!allowedIdx.length) return [{ dims: Array(nDims).fill(0), detail: '无可用词条' }];
  const raw = [];
  const maxK = Math.min(4, allowedIdx.length);
  const pick = (arr, k) => {
    const out = [];
    const walk = (start, cur) => {
      if (cur.length === k) {
        out.push(cur.slice());
        return;
      }
      for (let i = start; i < arr.length; i++) {
        cur.push(arr[i]);
        walk(i + 1, cur);
        cur.pop();
      }
    };
    walk(0, []);
    return out;
  };
  const comps = (k, total, prefix = [], out = []) => {
    if (k === 1) {
      if (total >= 1 && total <= 6) out.push([...prefix, total]);
      return out;
    }
    for (let r = 1; r <= Math.min(6, total - (k - 1)); r++) {
      prefix.push(r);
      comps(k - 1, total - r, prefix, out);
      prefix.pop();
    }
    return out;
  };
  for (let k = 1; k <= maxK; k++) {
    for (const idx of pick(allowedIdx, k)) {
      for (const rolls of comps(k, 5 + k)) {
        const dims = Array(nDims).fill(0);
        const detail = [];
        idx.forEach((ri, pos) => {
          const src = relevant[ri];
          for (let d = 0; d < nDims; d++) dims[d] += rolls[pos] * src.dims[d];
          detail.push(src.type + '×' + rolls[pos]);
        });
        raw.push({ dims, detail: detail.join('、') });
      }
    }
  }
  return paretoND(raw);
}

/** 多维最大化帕累托过滤。 */
function paretoND(points) {
  if (!points.length) return [];
  const nDims = points[0].dims.length;
  if (nDims === 3) return pareto3(points);
  const eps = 1e-9;
  const arr = points.map((p) => ({ dims: p.dims.slice(), detail: p.detail }));
  let kept = [];
  for (const p of arr) {
    let dominated = false;
    for (const q of kept) {
      if (dominatesND(q.dims, p.dims, eps)) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;
    kept = kept.filter((q) => !dominatesND(p.dims, q.dims, eps));
    kept.push(p);
  }
  return kept;
}

/** 三维帕累托过滤：按第一维降序，维护后两维的 2D 前沿，避免全量两两比较。 */
function pareto3(points) {
  const eps = 1e-9;
  const arr = points
    .map((p) => ({ dims: p.dims.slice(), detail: p.detail }))
    .sort((a, b) => b.dims[0] - a.dims[0] || b.dims[1] - a.dims[1] || b.dims[2] - a.dims[2]);
  const kept = [];
  let front = [];
  for (const p of arr) {
    let dominated = false;
    for (const f of front) {
      if (f.y >= p.dims[1] - eps && f.z >= p.dims[2] - eps) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;
    front = front.filter((f) => !(p.dims[1] >= f.y - eps && p.dims[2] >= f.z - eps));
    front.push({ y: p.dims[1], z: p.dims[2] });
    kept.push(p);
  }
  return kept;
}

function dominatesND(a, b, eps) {
  let any = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - eps) return false;
    if (a[i] > b[i] + eps) any = true;
  }
  return any;
}

/** 把六枚盘各自的 N 维方案做 DP 卷积。 */
function combineND(optionsBySlot, nDims) {
  let states = [{ dims: Array(nDims).fill(0) }];
  for (const options of optionsBySlot) {
    const next = [];
    for (const s of states) {
      for (const o of options) {
        next.push({ dims: s.dims.map((v, i) => v + o.dims[i]) });
      }
    }
    states = paretoND(next);
  }
  return states;
}

/**
 * 计算二维有效前沿。
 * @param {object} ctx { charIndex, wengineIndex, discIndex }（buildNameIndex 产物）
 * @param {object} opts { charName, wengineName, set2, set4, main4, main5, main6, xAxis, yAxis }
 * @returns {{ fixed:object, points:Array<{x,y}>, sourceDefs:Array, discOptions:Array }}
 */
export function simulateFrontier(ctx, opts) {
  const { withSets, mains } = resolveBuild(ctx, opts);
  const axes = [opts.xAxis, opts.yAxis];
  const sourceDefs = buildSourceDefs(axes, withSets.base).map((s) => ({
    ...s,
    dx: s.dims[0],
    dy: s.dims[1],
  }));
  const optionsBySlot = [1, 2, 3, 4, 5, 6].map((slot) => discOptions(sourceDefs, mainTypeForSlot(slot, mains)));
  const combined = combineDiscOptions(optionsBySlot);
  const points = combined
    .map((s) => ({ x: withSets.final[opts.xAxis] + s.dx, y: withSets.final[opts.yAxis] + s.dy }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  return { fixed: withSets.final, base: withSets.base, points, sourceDefs, discOptions: optionsBySlot };
}

/**
 * 计算三维帕累托前沿（三个坐标轴属性的成长极限曲面）。
 * @returns {{ fixed:object, points:Array<{x,y,z}>, sourceDefs:Array, discOptions:Array, axes:Array }}
 */
export function simulateFrontier3D(ctx, opts) {
  const { withSets, mains } = resolveBuild(ctx, opts);
  const axes = [opts.xAxis, opts.yAxis, opts.zAxis];
  const sourceDefs = buildSourceDefs(axes, withSets.base);
  const optionsBySlot = [1, 2, 3, 4, 5, 6].map((slot) => discOptionsND(sourceDefs, mainTypeForSlot(slot, mains), axes.length));
  const combined = combineND(optionsBySlot, axes.length);
  const points = combined
    .map((s) => ({
      x: withSets.final[axes[0]] + s.dims[0],
      y: withSets.final[axes[1]] + s.dims[1],
      z: withSets.final[axes[2]] + s.dims[2],
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));

  return { fixed: withSets.final, base: withSets.base, points, sourceDefs, discOptions: optionsBySlot, axes };
}

/** 供 UI 使用：某面板属性能否作为前沿坐标轴（至少存在一个副词条来源）。 */
export function axisAvailable(stat) {
  return !!SUBSTAT_SOURCES[stat];
}

/** 供 UI 展示：该角色满级固定面板（不含副词条）。 */
export function simulateFixedPanel(ctx, opts) {
  const { withSets } = resolveBuild(ctx, opts);
  return withSets.final;
}
