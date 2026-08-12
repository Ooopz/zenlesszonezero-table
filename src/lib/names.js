// src/lib/names.js —— 统一名称解析：跨数据源（library/wiki、账号、养成指南、工坊）名称变体 → 标准名
// library.json 是标准名权威源（对象键 === 条目 name）。本模块集中「类别归一化键 + 手工别名表」，
// 同步脚本写时固化、消费端统一解析都走这里，避免各处打补丁。
// 注意：双端共用（Node 与浏览器均可 import），禁止 import 任何 node: 模块。
import { normalize, normalizeRomanKey } from './util.js';

/** 实体类别 */
export const CATEGORY = { CHAR: 'char', WENGINE: 'wengine', DISC: 'disc', BANGBOO: 'bangboo' };

/** 各类别归一化键：char/disc/bangboo 用 normalize（只留中文数字）；
 *  wengine 必须用 normalizeRomanKey —— normalize 会剥光罗马数字，使 残响-Ⅰ/Ⅱ/Ⅲ 三个系列键碰撞。 */
const CATEGORY_KEY = {
  [CATEGORY.CHAR]: normalize,
  [CATEGORY.WENGINE]: normalizeRomanKey,
  [CATEGORY.DISC]: normalize,
  [CATEGORY.BANGBOO]: normalize,
};

/** 手工别名表（变体 → 规范名；规范名须存在于 library 键，否则 buildNameIndex 会跳过该条） */
export const ALIASES = {
  [CATEGORY.CHAR]: {
    亚历山德丽娜·莎芭丝提安: '亚历山德丽娜·莎芭丝缇安', // 工坊「提」vs wiki「缇」（原 panelBench.CHAR_ALIASES）
    维琳娜: '维琳娜·艾嘉德', // 工坊 grad 短名
    '11号': '「11号」', // 工坊 grad 缺书名号（normalize 也能命中，显式别名表意）
    星徽·比利: '星徽·比利·奇德', // 歧义关键：比利·奇德 是两者子串，显式别名抢占
  },
  [CATEGORY.WENGINE]: {},
  [CATEGORY.DISC]: {
    荆棘玫瑰: '棘刺玫瑰', // 养成指南用词差异（原 discstats.DISC_ALIASES）
  },
  [CATEGORY.BANGBOO]: {},
};

/** 兼容旧引用（原 panelBench.CHAR_ALIASES / discstats.DISC_ALIASES） */
export const CHAR_ALIASES = ALIASES[CATEGORY.CHAR];
export const DISC_ALIASES = ALIASES[CATEGORY.DISC];

/**
 * 构建名称索引。
 * @param {object|string[]} names  object: {规范名: 条目}（library 表 / 实例集合）
 *                                  array : [规范名, ...]（纯函数只关心名字集合时用）
 * @param {string} category  实体类别（CATEGORY.*）
 * @returns {{lib:object|null, category:string, keyFn:Function, names:string[],
 *            byKey:Map, byAlias:Map, byAliasKey:Map}}
 *   byKey      归一化键(规范名) → 规范名（首见优先）
 *   byAlias    变体原串 → 规范名（仅收录规范名在集合内的，防脏别名）
 *   byAliasKey 归一化键(变体) → 规范名（处理变体带空白/标点）
 */
export function buildNameIndex(names, category) {
  const isArray = Array.isArray(names);
  const lib = isArray ? null : names || {};
  const list = isArray ? names : Object.keys(lib);
  const keyFn = CATEGORY_KEY[category] || normalize;
  const aliases = ALIASES[category] || {};
  const byKey = new Map();
  const byAlias = new Map();
  const byAliasKey = new Map();
  for (const name of list) {
    const k = keyFn(name);
    if (!byKey.has(k)) byKey.set(k, name);
  }
  for (const [variant, canonical] of Object.entries(aliases)) {
    if (!list.includes(canonical)) continue; // 规范名不在集合 → 跳过
    if (!byAlias.has(variant)) byAlias.set(variant, canonical);
    const k = keyFn(variant);
    if (!byAliasKey.has(k)) byAliasKey.set(k, canonical);
  }
  return { lib, category, keyFn, names: list, byKey, byAlias, byAliasKey };
}

/**
 * 解析任意变体名 → 标准名与条目。解析链：精确 → 别名(原串) → 别名(归一化键) → 归一化键 → 子串(char 专属)。
 * 歧义确定性：精确/别名优先于子串（如「比利·奇德」精确命中自己，「星徽·比利」走显式别名），
 * 子串兜底取最短规范名，同长按 zh localeCompare，结果确定。
 * @param {string} category  实体类别
 * @param {object} index     buildNameIndex 的产物
 * @param {string} rawName   变体名
 * @param {{fuzzy?:boolean}} opts  fuzzy=false 关闭子串兜底（默认 char 开、其余关）
 * @returns {{name:string, entry:object|null, matchedBy:string}|null}
 */
export function resolveName(category, index, rawName, opts = {}) {
  if (rawName == null || rawName === '' || !index) return null;
  const keyFn = index.keyFn || CATEGORY_KEY[category] || normalize;
  const fuzzy = opts.fuzzy !== undefined ? opts.fuzzy : category === CATEGORY.CHAR;
  // 对未构建（空对象/旧格式）索引防御：Map 字段缺失时视为无命中
  if (index.lib && rawName in index.lib) return { name: rawName, entry: index.lib[rawName], matchedBy: 'exact' };
  let canonical = index.byAlias?.get(rawName);
  if (canonical && (!index.lib || index.lib[canonical] != null))
    return { name: canonical, entry: index.lib?.[canonical] ?? null, matchedBy: 'alias' };
  const rawKey = keyFn(rawName);
  canonical = index.byAliasKey?.get(rawKey);
  if (canonical && (!index.lib || index.lib[canonical] != null))
    return { name: canonical, entry: index.lib?.[canonical] ?? null, matchedBy: 'alias' };
  if (index.byKey?.has(rawKey)) {
    const name = index.byKey.get(rawKey);
    return { name, entry: index.lib?.[name] ?? null, matchedBy: 'norm' };
  }
  if (fuzzy) {
    const hit = substringMatch(index, rawKey);
    if (hit) return { name: hit, entry: index.lib?.[hit] ?? null, matchedBy: 'fuzzy' };
  }
  return null;
}

/** 子串兜底：归一化键互相包含；确定性 = 最短规范名优先，同长按 zh localeCompare */
function substringMatch(index, rawKey) {
  if (!rawKey) return null;
  const candidates = [];
  for (const name of index.names) {
    const k = index.keyFn(name);
    if (k.includes(rawKey) || rawKey.includes(k)) candidates.push(name);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b, 'zh'));
  return candidates[0];
}

/** 消费端主入口：返回条目（找不到返回 null） */
export function resolveEntry(category, index, rawName, opts) {
  return resolveName(category, index, rawName, opts)?.entry ?? null;
}

/** 写时固化 / 迁移：返回标准名串（找不到返回 null） */
export function canonicalName(category, index, rawName, opts) {
  return resolveName(category, index, rawName, opts)?.name ?? null;
}
