// src/lib/calc.js —— 计算引擎：属性常量 + 词条成长 + 面板计算 + 达成率
// 纯逻辑、无 DOM/Node 依赖；需要数据的函数通过 setCalcContext 注入上下文，
// 因此浏览器（web/main.js 注入）与 Node（测试/批量分析）都能使用。
import { statEntries, formatValue, lookup } from './util.js';
import {
  STAT,
  PANEL_ORDER,
  PANEL_STAT_MAP,
  MULT_STATS,
  MAX_LEVEL_STATS,
  PERCENT_STATS,
  TARGET_STATS,
  TARGET_PERCENTS,
  TARGET_UNITS,
  VALID_STAT_OPTIONS,
  isDamageBonus as isDamageBonusName,
} from './constants.js';

// ---------- 数据上下文（由调用方注入） ----------
// ctx = { library, charIndex, wengineIndex, discIndex, readCharTarget, readValidStats }
let ctx = {
  library: { characters: {}, wengines: {}, discs: {} },
  charIndex: {},
  wengineIndex: {},
  discIndex: {},
  readCharTarget: () => ({}),
  readValidStats: () => [],
};
/** 上下文版本号：数据源变化（setCalcContext）时递增，Character.calculate 据此作废缓存 */
export let ctxVersion = 0;
/** 注入/更新计算所需的数据上下文（浏览器在数据加载后、测试在断言前调用） */
export function setCalcContext(c) {
  ctx = { ...ctx, ...c };
  ctxVersion++;
}

// ---------- 属性常量（单一权威定义在 constants.js，此处仅兼容导出） ----------
export const panelOrder = PANEL_ORDER;
/** 面板属性 → 对应哪些有效副词条类型（用于按有效属性配置高亮面板行） */
export const panelStatMap = PANEL_STAT_MAP;
export const multStats = MULT_STATS; // 百分比加成按 基础×(1+Σ%)
/** 满级行仅含的基础属性（wiki 成长表「满级」只有这三项），wiki 视图的「满级X」列与此对齐 */
export const maxLevelStats = MAX_LEVEL_STATS;
export const isDamageBonus = isDamageBonusName;
/** 百分比面板属性（值 ≤1 表示百分比），供 plans 等按属性名判定百分比的模块复用 */
export const percentStats = PERCENT_STATS;

export const targetStats = TARGET_STATS;
export const targetPercents = TARGET_PERCENTS;
export const targetUnits = TARGET_UNITS;

// ---------- 副词条成长与命中 ----------
// 数据来源：bilibili wiki。S级副词条初始值=成长值，每强化一次 +成长值；等级每 +3 触发一次成长。
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
export const validStatOptions = VALID_STAT_OPTIONS;
/** 副词条成长类型：暴击/暴伤恒为%；其余按数值大小（≤1 视为百分比） */
export function substatType(name, value) {
  return [STAT.CR, STAT.CD].includes(name) ? name : value <= 1 ? name + '%' : name;
}
/** 单个驱动盘：各副词条的成长（强化）次数 = 当前值/成长值 - 1 */
export function discGrowth(disc, rarity) {
  const table = substatGrowthTable[rarity] || substatGrowthTable.S;
  return statEntries(disc.subStats).map((t) => {
    const type = substatType(t.name, t.value);
    const growth = table[type];
    return { ...t, type, growthCount: growth ? Math.max(0, Math.round(t.value / growth - 1)) : 0 };
  });
}
/** 角色副词条命中：落在有效属性上的词条次数（每个词条本身算 1，每强化一次再 +1）；未设有效属性返回 null */
export function hitCount(character) {
  const valid = new Set(ctx.readValidStats(character.name));
  if (!valid.size) return null;
  let hits = 0;
  for (const d of character.discs || []) {
    // Disc 实例在构造时已缓存 growth，无需按盘重算
    for (const g of d.growth || discGrowth(d, d.rarity)) if (valid.has(g.type)) hits += 1 + g.growthCount;
  }
  return hits;
}

// ---------- 局外面板公式（可复用：计算引擎内部使用，后续功能可直接 import） ----------
/** 局外面板单一属性合成：攻击/生命/防御/冲击力（multStats）= 基础×(1+Σ%)+Σ固定；
 *  其余属性（暴击率等）= 基础+Σ值；穿透值为固定值累加。base 为空返回 null。 */
export function panelBonus(name, base, pct = 0, flat = 0) {
  if (base == null) return null;
  const bonus = multStats.has(name) ? base * pct + flat : flat + pct;
  return { bonus, final: base + bonus };
}

/** 加成分类：无效值→null；伤害加成→damage；穿透值→pen；
 *  multStats 属性值≤1→pct、>1→flat；非 multStats 属性→pct */
export function classifyBonus(name, value) {
  if (name == null || value == null || !Number.isFinite(value)) return null;
  if (isDamageBonus(name)) return { kind: 'damage' };
  if (name === '穿透值') return { kind: 'pen' };
  return multStats.has(name) ? (value <= 1 ? { kind: 'pct' } : { kind: 'flat' }) : { kind: 'pct' };
}

/** 基础攻击白值 = 角色基础攻击 + 音擎基础攻击 + 核心技满级基础攻击提升 */
export function atkWhiteValue(charAtk, wengineAtk, coreAtk = 0) {
  return charAtk + wengineAtk + coreAtk;
}

/** 局内攻击力 = 场外总攻 × (1+局内%) + 局内固定（战斗 buff 预留，后续伤害功能用） */
export function inBattleAtk(outOfBattleAtk, { inPct = 0, inFlat = 0 } = {}) {
  return outOfBattleAtk * (1 + inPct) + inFlat;
}

/** 核心技在指定等级（1-7）的基础面板提升（累计值）。
 *  coreSkillBoost 为每档增量数组（A-F 顺序，第 i 项对应等级 i+2），等级 lv 取前 (lv-1) 档之和；
 *  兼容旧结构（满级累计对象）时直接返回对象值。 */
export function coreSkillBoostAt(libCharacter, name, level = 7) {
  const list = libCharacter?.coreSkillBoost;
  if (!Array.isArray(list)) {
    const v = list?.[name];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  let sum = 0;
  for (let i = 0; i < level - 1 && i < list.length; i++) sum += list[i]?.[name] || 0;
  return sum;
}

// ---------- 计算引擎 ----------

/** wiki 推算的单属性理论基础值：攻击力 = 角色基础攻击 + 音擎白值 + 核心技当前等级攻击提升；
 *  其余 = wiki 基础 + 核心技数值提升；穿透值无基础（纯装备词条累加）→ 0。 */
function theoreticalBaseOf(s, { baseSource, wengineAtk, libCharacter, coreLevel }) {
  if (s === '攻击力') {
    const charAtk = baseSource.攻击力 ?? baseSource['基础攻击力'];
    return charAtk != null
      ? atkWhiteValue(charAtk, wengineAtk, coreSkillBoostAt(libCharacter, '攻击力', coreLevel))
      : null;
  }
  const bs = baseSource[s];
  return bs != null ? bs + coreSkillBoostAt(libCharacter, s, coreLevel) : s === '穿透值' ? 0 : null;
}

/** 从基础值合成 { base, bonus, final }；base 为空返回 null */
function synthPanel(s, tb, pct, flat) {
  if (tb == null) return null;
  const r = panelBonus(s, tb, pct[s] || 0, flat[s] || 0);
  return { base: tb, bonus: r.bonus, final: r.final };
}

/** 理论面板最终值取整（对齐游戏面板显示）：攻击/防御/冲击力/异常掌控向下取整，生命向上取整，能量回复截断 2 位 */
const THEO_ROUND = {
  攻击力: Math.floor,
  防御力: Math.floor,
  冲击力: Math.floor,
  异常掌控: Math.floor,
  生命值: Math.ceil,
  能量自动回复: (v) => Math.trunc(v * 100) / 100,
};
function roundTheoretical(final) {
  for (const [s, fn] of Object.entries(THEO_ROUND)) if (final[s] != null) final[s] = fn(final[s]);
}

/** 命破角色：贯穿力 = 0.3×攻击力 + 0.1×生命值（派生），穿透率置空（无视防御）。
 *  panel 为 { base, bonus, final }；最终面板与理论面板共用。 */
function applyPiercing(panel, libCharacter) {
  if (libCharacter.trait !== '命破') return;
  const pierce = (a, h) => (a != null && h != null ? Math.round(0.3 * a + 0.1 * h) : null);
  panel.final['贯穿力'] = pierce(panel.final['攻击力'], panel.final['生命值']);
  panel.base['贯穿力'] = pierce(panel.base['攻击力'], panel.base['生命值']);
  panel.bonus['贯穿力'] =
    panel.final['贯穿力'] != null && panel.base['贯穿力'] != null
      ? panel.final['贯穿力'] - panel.base['贯穿力']
      : null;
  panel.final['穿透率'] = null;
  panel.base['穿透率'] = null;
  panel.bonus['穿透率'] = null;
}

export function calculateCharacter(character) {
  const { library, charIndex, wengineIndex, discIndex } = ctx;
  const libCharacter = lookup(library.characters, charIndex, character.name) || {};
  // wiki 基础值 = 初始 ∪ 满级（满级只含生命/攻击/防御，其余在初始里）。
  // Character 实例构造时已把扁平初始属性归一化到实例，纯对象亦可直接取。
  const baseSource = {};
  for (const s of panelOrder) if (libCharacter[s] != null) baseSource[s] = libCharacter[s];
  if (libCharacter['基础攻击力'] != null) baseSource['基础攻击力'] = libCharacter['基础攻击力'];
  for (const [k, v] of Object.entries(libCharacter.maxLevel || {})) baseSource[k] = v;
  const libWengine = lookup(library.wengines, wengineIndex, character.wengine?.name);
  const wengine = character.wengine || {};

  // 核心技（核心被动）当前等级：账号 skills 里 type=5；缺失时默认满级 7
  const coreLevel = character.skills?.find((s) => s.type === 5)?.level ?? 7;
  const wengineAtk =
    statEntries(wengine.mainStats).find((t) => t.name === '基础攻击力')?.value ?? libWengine?.baseAtk ?? 0;
  // wiki 推算基础值（最终面板推算路径与理论面板共用；贯穿力为派生属性，末尾统一计算）
  const theoBase = {};
  for (const s of panelOrder) {
    if (s === '贯穿力') continue;
    const tb = theoreticalBaseOf(s, { baseSource, wengineAtk, libCharacter, coreLevel });
    if (tb != null) theoBase[s] = tb;
  }

  // ① 最终面板基础值：优先账号接口 base（含音擎基础攻击力），缺失时用 wiki 推算
  const base = {};
  for (const s of panelOrder) base[s] = null;
  if (character.panel) for (const [name, v] of Object.entries(character.panel)) if (v.base != null) base[name] = v.base;
  for (const s of panelOrder) {
    if (base[s] == null) base[s] = theoBase[s] ?? null; // 穿透值 theoBase 已为 0
  }

  // ② 收集加成（百分比 / 固定值）
  const pct = {},
    flat = {},
    damageBonus = {};
  function accumulate(name, value) {
    const c = classifyBonus(name, value);
    if (!c) return;
    if (c.kind === 'damage') {
      damageBonus[name] = (damageBonus[name] || 0) + value;
      return;
    }
    if (c.kind === 'pen') {
      flat.穿透值 = (flat.穿透值 || 0) + value;
      return;
    }
    if (c.kind === 'pct') pct[name] = (pct[name] || 0) + value;
    else flat[name] = (flat[name] || 0) + value;
  }
  const sources = {};
  function recordSource(name, label, value) {
    if (value == null) return;
    (sources[name] = sources[name] || []).push(label + ' +' + formatValue(name, value));
  }

  // 音擎副属性（账号接口优先，缺失时用属性库兜底）
  let wengineSub = statEntries(wengine.subStats);
  if (!wengineSub.length && libWengine?.subStats) wengineSub = statEntries(libWengine.subStats);
  for (const t of wengineSub) {
    accumulate(t.name, t.value);
    recordSource(t.name, '音擎', t.value);
  }

  // 驱动盘主/副词条 + 套装 2 件套（同套装 ≥2 件才生效，每种套装只计一次）
  const setCount = {};
  for (const d of character.discs || []) if (d.set) setCount[d.set] = (setCount[d.set] || 0) + 1;
  const countedSets = new Set();
  for (const d of character.discs || []) {
    const discLib = lookup(library.discs, discIndex, d.set);
    for (const t of statEntries(d.mainStats)) {
      accumulate(t.name, t.value);
      recordSource(t.name, `盘${d.slot}主`, t.value);
    }
    for (const t of statEntries(d.subStats)) {
      accumulate(t.name, t.value);
      recordSource(t.name, `盘${d.slot}副`, t.value);
    }
    if (discLib?.set2 && !countedSets.has(d.set) && (setCount[d.set] || 0) >= 2) {
      countedSets.add(d.set);
      for (const [name, value] of Object.entries(discLib.set2)) {
        accumulate(name, value);
        recordSource(name, `${d.set}2件套`, value);
      }
    }
  }

  // 核心技当前等级的百分比提升（攻击力%/生命值%/防御力%/冲击力%）进入对应属性百分比乘区
  for (const baseName of ['攻击力', '生命值', '防御力', '冲击力']) {
    const v = coreSkillBoostAt(libCharacter, baseName + '%', coreLevel);
    if (v) accumulate(baseName, v);
  }

  // ③ 汇总（最终面板）
  const bonus = {},
    final = {};
  for (const s of panelOrder) {
    if (base[s] == null) continue;
    const r = synthPanel(s, base[s], pct, flat);
    bonus[s] = r.bonus;
    final[s] = r.final;
  }
  for (const [name, value] of Object.entries(damageBonus)) final[name] = value;

  // 账号接口实际值（覆盖）
  const actual = {};
  if (character.panel)
    for (const [name, v] of Object.entries(character.panel)) {
      actual[name] = { base: v.base, bonus: v.bonus, final: v.final };
      if (final[name] == null) final[name] = v.final;
    }

  // ④ 理论面板：纯 wiki 推算（不含账号 base），用于与账号实际值对比定位计算问题（前端灰字展示）
  const theoretical = { base: {}, bonus: {}, final: {} };
  for (const s of panelOrder) {
    const r = synthPanel(s, theoBase[s], pct, flat);
    if (!r) continue;
    theoretical.base[s] = r.base;
    theoretical.bonus[s] = r.bonus;
    theoretical.final[s] = r.final;
  }
  roundTheoretical(theoretical.final); // 对齐游戏面板取整

  // 命破角色：贯穿力派生 + 穿透率置空（最终面板与理论面板共用同一逻辑）
  applyPiercing({ base, bonus, final }, libCharacter);
  applyPiercing(theoretical, libCharacter);

  return { base, bonus, final, actual, theoretical, sources, libCharacter, libWengine };
}

// ---------- 达成率 ----------
/** 达成率颜色：≥98% 绿，≥70% 黄，否则红 */
export function rateColor(rate) {
  return rate >= 0.97 ? 'var(--green)' : rate >= 0.9 ? 'var(--acc2)' : 'var(--red)';
}
export function rateClass(rate) {
  return rate >= 0.97 ? 'good' : rate >= 0.9 ? 'mid' : 'bad';
}
/** 单个属性相对该角色目标的达成率；未设目标返回 null；不封顶（可 >100%） */
export function statProgress(character, R, name) {
  const targetVal = ctx.readCharTarget(character.name)[name];
  if (targetVal == null || targetVal === '' || !Number.isFinite(Number(targetVal)) || Number(targetVal) <= 0)
    return null;
  let current = R.actual?.[name]?.final ?? R.final[name];
  if (name === '属性伤害加成') {
    for (const k of Object.keys(R.final))
      if (isDamageBonus(k)) {
        current = R.final[k];
        break;
      }
  }
  if (current == null) return null;
  let targetInternal = Number(targetVal);
  if (targetPercents.has(name)) targetInternal = targetVal / 100;
  return { rate: current / targetInternal };
}
/** 达成率格子：百分比（可不封顶）+ 小进度条（进度条宽度封顶 100%） */
export function progressCell(rate) {
  const width = Math.min(100, rate * 100).toFixed(0);
  return `<span class="rpct ${rateClass(rate)}">${(rate * 100).toFixed(0)}%</span><span class="tbar"><span class="tfill" style="width:${width}%;background:${rateColor(rate)}"></span></span>`;
}

// ---------- 目标副词条缺口 ----------
/** 攻击/生命/防御百分比词条的收益基准。
 *  攻击力公式：攻击力 = (角色满级攻击力 + 装备武器攻击力) × (1 + %词条) + 固定值词条，
 *  因此百分比词条收益基于「满级角色值 + 武器攻击（仅攻击力）」，并计入核心技提升的基础面板
 *  （coreSkillBoost，如「基础攻击力提升25点」），满级数据缺失时回退当前基础值。 */
function fullBase(R, name) {
  const libVal = R.libCharacter?.maxLevel?.[name];
  // 目标按满级核心技评估，核心技基础提升取满级（A-F 全部档位累计）
  const core = coreSkillBoostAt(R.libCharacter, name, 7);
  if (libVal == null) return (R.base?.[name] || 0) + core;
  return (name === '攻击力' ? libVal + (R.libWengine?.baseAtk ?? 0) : libVal) + core;
}

/** 目标属性 → 副词条类型与每词条收益（S 级成长值）。
 *  gain 为百分比词条收益，gainFlat 为固定值词条收益（攻击/生命/防御有 % 与固定值两种形态）；
 *  其余属性（冲击力/穿透率/能量自动回复/伤害加成等）无法通过副词条补足，不在表中。 */
const GAP_ADVICE = {
  攻击力: (R) => ({
    type: '攻击力%',
    gain: fullBase(R, '攻击力') * substatGrowthTable.S['攻击力%'],
    gainFlat: substatGrowthTable.S['攻击力'],
  }),
  生命值: (R) => ({
    type: '生命值%',
    gain: fullBase(R, '生命值') * substatGrowthTable.S['生命值%'],
    gainFlat: substatGrowthTable.S['生命值'],
  }),
  防御力: (R) => ({
    type: '防御力%',
    gain: fullBase(R, '防御力') * substatGrowthTable.S['防御力%'],
    gainFlat: substatGrowthTable.S['防御力'],
  }),
  暴击率: () => ({ type: '暴击率', gain: substatGrowthTable.S['暴击率'] }),
  暴击伤害: () => ({ type: '暴击伤害', gain: substatGrowthTable.S['暴击伤害'] }),
  异常精通: () => ({ type: '异常精通', gain: substatGrowthTable.S['异常精通'] }),
  穿透值: () => ({ type: '穿透值', gain: substatGrowthTable.S['穿透值'] }),
};

/** 按目标面板分析副词条缺口：逐目标属性算「当前 → 目标」差距，按每词条成长值估算还差几个副词条。
 *  count 为 null 表示该属性无法通过副词条补足；未配置目标返回 null；全部达标时 items 为空、total 为 0。 */
export function targetGap(character, R) {
  const target = ctx.readCharTarget(character.name) || {};
  const names = Object.keys(target).filter((n) => {
    const v = target[n];
    return v != null && v !== '' && Number(v) > 0;
  });
  if (!names.length) return null;
  const items = [];
  let total = 0;
  for (const name of names) {
    let current = R.actual?.[name]?.final ?? R.final[name];
    if (name === '属性伤害加成') {
      for (const k of Object.keys(R.final))
        if (isDamageBonus(k)) {
          current = R.final[k];
          break;
        }
    }
    if (current == null) continue;
    const targetInternal = targetPercents.has(name) ? Number(target[name]) / 100 : Number(target[name]);
    const gap = targetInternal - current;
    if (gap <= 0) continue; // 该属性已达标
    const advice = GAP_ADVICE[name] ? GAP_ADVICE[name](R) : null;
    const gain = advice?.gain || 0;
    const count = gain > 0 ? Math.ceil(gap / gain) : null;
    const countFlat = advice?.gainFlat ? Math.ceil(gap / advice.gainFlat) : null;
    items.push({ name, current, target: targetInternal, gap, type: advice?.type || null, count, countFlat });
    if (count != null) total += count;
  }
  return { total, items };
}
