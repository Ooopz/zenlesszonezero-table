// src/lib/calc.js —— 计算引擎：属性常量 + 词条成长 + 面板计算 + 达成率
// 纯逻辑、无 DOM/Node 依赖；需要数据的函数通过 setCalcContext 注入上下文，
// 因此浏览器（web/main.js 注入）与 Node（测试/批量分析）都能使用。
import { statEntries, formatValue, lookup } from './util.js';

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

// ---------- 属性常量 ----------
export const panelOrder = [
  '攻击力',
  '生命值',
  '防御力',
  '冲击力',
  '暴击率',
  '暴击伤害',
  '异常掌控',
  '异常精通',
  '穿透率',
  '穿透值',
  '能量自动回复',
];
/** 面板属性 → 对应哪些有效副词条类型（用于按有效属性配置高亮面板行） */
export const panelStatMap = {
  攻击力: ['攻击力', '攻击力%'],
  生命值: ['生命值', '生命值%'],
  防御力: ['防御力', '防御力%'],
  暴击率: ['暴击率'],
  暴击伤害: ['暴击伤害'],
  穿透值: ['穿透值'],
  异常精通: ['异常精通'],
};
export const multStats = new Set(['攻击力', '生命值', '防御力', '冲击力']); // 百分比加成按 基础×(1+Σ%)
/** 满级行仅含的基础属性（wiki 成长表「满级」只有这三项），wiki 视图的「满级X」列与此对齐 */
export const maxLevelStats = ['生命值', '攻击力', '防御力'];
export const isDamageBonus = (name) => name.endsWith('伤害加成') || name.endsWith('伤害提升');

export const targetStats = [
  '攻击力',
  '暴击率',
  '暴击伤害',
  '穿透率',
  '异常掌控',
  '异常精通',
  '冲击力',
  '能量自动回复',
  '生命值',
  '防御力',
  '属性伤害加成',
];
export const targetPercents = new Set(['暴击率', '暴击伤害', '穿透率', '属性伤害加成']);
export const targetUnits = { 暴击率: '%', 暴击伤害: '%', 穿透率: '%', 属性伤害加成: '%' };

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
export const validStatOptions = [
  { type: '攻击力', label: '攻击力（固定）' },
  { type: '攻击力%', label: '攻击力%' },
  { type: '暴击率', label: '暴击率' },
  { type: '暴击伤害', label: '暴击伤害' },
  { type: '穿透值', label: '穿透值' },
  { type: '异常精通', label: '异常精通' },
  { type: '生命值', label: '生命值（固定）' },
  { type: '生命值%', label: '生命值%' },
  { type: '防御力', label: '防御力（固定）' },
  { type: '防御力%', label: '防御力%' },
];
/** 副词条成长类型：暴击/暴伤恒为%；其余按数值大小（≤1 视为百分比） */
export function substatType(name, value) {
  return ['暴击率', '暴击伤害'].includes(name) ? name : value <= 1 ? name + '%' : name;
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

// ---------- 计算引擎 ----------
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

  // ① 基础值：优先用账号接口返回的 base（含音擎基础攻击力），否则 wiki 满级
  const base = {};
  for (const s of panelOrder) base[s] = null;
  if (character.panel) for (const [name, v] of Object.entries(character.panel)) if (v.base != null) base[name] = v.base;
  for (const s of panelOrder) {
    if (base[s] == null) {
      if (s === '攻击力') {
        const charAtk = baseSource.攻击力 ?? baseSource['基础攻击力'];
        const wengineAtk =
          statEntries(wengine.mainStats).find((t) => t.name === '基础攻击力')?.value ?? libWengine?.baseAtk ?? 0;
        base[s] = charAtk != null ? charAtk + wengineAtk : null;
      } else {
        base[s] = baseSource[s] ?? null;
      }
    }
  }

  // ② 收集加成（百分比 / 固定值）
  const pct = {},
    flat = {},
    damageBonus = {};
  function accumulate(name, value) {
    if (name == null || value == null || !Number.isFinite(value)) return;
    if (isDamageBonus(name)) {
      damageBonus[name] = (damageBonus[name] || 0) + value;
      return;
    }
    if (name === '穿透值') {
      flat.穿透值 = (flat.穿透值 || 0) + value;
      return;
    }
    if (multStats.has(name) ? value <= 1 : true) pct[name] = (pct[name] || 0) + value;
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

  // 驱动盘主/副词条 + 套装 2 件套（每种套装只计一次）
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
    if (discLib?.set2 && !countedSets.has(d.set)) {
      countedSets.add(d.set);
      for (const [name, value] of Object.entries(discLib.set2)) {
        accumulate(name, value);
        recordSource(name, `${d.set}2件套`, value);
      }
    }
  }

  // ③ 汇总
  const bonus = {},
    final = {};
  for (const s of panelOrder) {
    if (base[s] == null) continue;
    const pb = pct[s] || 0,
      fb = flat[s] || 0;
    bonus[s] = multStats.has(s) ? base[s] * pb + fb : fb + (pct[s] || 0);
    final[s] = base[s] + bonus[s];
  }
  for (const [name, value] of Object.entries(damageBonus)) final[name] = value;

  // 账号接口实际值（覆盖）
  const actual = {};
  if (character.panel)
    for (const [name, v] of Object.entries(character.panel)) {
      actual[name] = { base: v.base, bonus: v.bonus, final: v.final };
      if (final[name] == null) final[name] = v.final;
    }

  return { base, bonus, final, actual, sources, libCharacter, libWengine };
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
  const core = R.libCharacter?.coreSkillBoost?.[name] || 0;
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
