// src/web/data.js —— 数据层：由 main.js 注入数据（不再从 DOM 内嵌块读取），维护索引/配置/过滤
import { statEntries, escapeHtml } from '../lib/util.js';
import { buildNameIndex, canonicalize, CATEGORY } from '../lib/names.js';
import { Character, Wengine, Disc, toInstances } from '../lib/models.js';
import { SUBSTAT_TYPE_SET, TARGET_KEYS } from '../lib/constants.js';
import { apiRequest, postJSON, notify } from './api.js';

// ---------- 数据（由 setData 注入） ----------
// 注：export let 为 ESM 活绑定，setData 重新赋值后 import 方自动读到新值。
export let library = { characters: {}, wengines: {}, discs: {} };
export let myCharacters = [];
/** 角色名 → Character（供 readValidStats 默认路径 O(1) 查找，随 setData 重建） */
let myCharByName = new Map();
export const grid = document.getElementById('grid');

// ---------- GitHub Pages 单文件模式 ----------
// 构建（scripts/publish-release.mjs --no-publish 或发布时）在 release/index.html 注入 window.__STATIC__=true + window.__STATIC_DATA__（全量数据内联）。
// 静态模式下：数据全内联、characters/user-config 存 localStorage，不走本地服务器。
export const isStatic = () => typeof window !== 'undefined' && window.__STATIC__ === true;
const LS = {
  chars: 'zzz.characters',
  config: 'zzz.userConfig',
};
const readLS = (k) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const writeLS = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 隐私模式等场景忽略 */
  }
};
/** 静态模式（单文件版）：读构建时内联的 window.__STATIC_DATA__（release/index.html），characters 从 localStorage 读 */
export async function loadStaticData() {
  const inline = typeof window !== 'undefined' ? window.__STATIC_DATA__ : null;
  if (!inline) throw new Error('单文件版缺少内联数据（window.__STATIC_DATA__）');
  return {
    library: inline.library,
    characters: readLS(LS.chars) || [],
    plans: inline.plans,
    workshopGrad: inline.workshopGrad,
    workshopStats: inline.workshopStats,
  };
}
/** 静态模式：导入采集的我的角色（粘贴 JSON），归一音擎/驱动盘名后保存 localStorage 并刷新数据层 */
export async function importCharacters(jsonText) {
  const chars = JSON.parse(jsonText || '[]');
  if (!Array.isArray(chars)) throw new Error('数据格式不正确（应为角色数组）');
  const wIdx = buildNameIndex(library.wengines || {}, CATEGORY.WENGINE);
  const dIdx = buildNameIndex(library.discs || {}, CATEGORY.DISC);
  const normalized = chars.map((c) => ({
    ...c,
    wengine:
      c.wengine && c.wengine.name && c.wengine.name !== '未佩戴音擎'
        ? { ...c.wengine, name: canonicalize(CATEGORY.WENGINE, wIdx, c.wengine.name, { fuzzy: false }).name }
        : c.wengine,
    discs: (c.discs || []).map((d) =>
      d.set === '未佩戴驱动盘' || d.set === '未知' ? d : { ...d, set: canonicalize(CATEGORY.DISC, dIdx, d.set, { fuzzy: false }).name }
    ),
  }));
  writeLS(LS.chars, normalized);
  setData(library, normalized, plans, workshopGrad, workshopStats); // 刷新 myCharacters（数据其余部分不变）
  return normalized.length;
}
/** 静态模式：清空本地缓存的我的角色 */
export function clearLocalChars() {
  try {
    localStorage.removeItem(LS.chars);
  } catch {
    /* ignore */
  }
  setData(library, [], plans, workshopGrad, workshopStats);
}

/** 养成指南推荐方案：{ avatarId: { name, plans: [...] } }，按角色名另建索引供目标弹窗表格用 */
export let plans = {};
export let plansByName = {};

/** 工坊全服配装统计：{ roles: [{ item_id, name, weapons, relics }] }（src/sync/workshop.js 的 fetchWorkshopGrad 爬取） */
export let workshopGrad = { roles: [] };

/** 工坊配装汇总（src/sync/workshop.js 的 buildWorkshopStats 生成，基于 workshop.json）；
 *  discDetails 为驱动盘单盘真实统计，供「统计→驱动盘」决策卡实况口径 */
export let workshopStats = { wengines: [], discs: [], panels: [], discDetails: [] };

/** 注入各数据源（实例化为基类）并重建索引（main.js 在 fetch /api/data 后调用） */
export function setData(lib, chars, plansData, gradData, statsData) {
  lib = lib || { characters: {}, wengines: {}, discs: {}, bangboos: {} };
  library = {
    characters: toInstances(lib.characters, Character),
    wengines: toInstances(lib.wengines, Wengine),
    discs: toInstances(lib.discs, Disc),
    bangboos: lib.bangboos || {}, // 邦布为普通对象（基类无附加逻辑）
  };
  myCharacters = (chars || []).map((c) => new Character(c)); // 账号角色（含 Wengine/Disc 嵌套）
  myCharByName = new Map(myCharacters.map((c) => [c.name, c]));
  plans = plansData || {};
  plansByName = {};
  for (const v of Object.values(plans)) if (v && v.name) plansByName[v.name] = v;
  workshopGrad = gradData || { roles: [] };
  workshopStats = statsData || { wengines: [], discs: [], panels: [], discDetails: [] };
  rebuildIndex();
}

// ---------- 索引与查找 ----------
export let charIndex = {},
  wengineIndex = {},
  discIndex = {};
function rebuildIndex() {
  charIndex = buildNameIndex(library.characters || {}, CATEGORY.CHAR);
  wengineIndex = buildNameIndex(library.wengines || {}, CATEGORY.WENGINE);
  discIndex = buildNameIndex(library.discs || {}, CATEGORY.DISC);
}
export { statEntries };

// ---------- 统计视图数据就绪检查（statsView/discstats 共用单一来源） ----------
/** 返回统计视图缺失的数据源列表（空数组 = 就绪）；panels 为空视为缺工坊聚合数据 */
export function statsMissingData() {
  const miss = [];
  if (!Object.keys(plans || {}).length) miss.push('推荐方案');
  if (!Object.keys(workshopStats.panels || {}).length) miss.push('工坊配装');
  return miss;
}

// ---------- 元素颜色（属性展示用） ----------
export const elementColors = {
  物理: '#d9d9d9',
  火: '#ff5a3c',
  冰: '#5fc7ff',
  电: '#c9a8ff',
  以太: '#b48cff',
  烈霜: '#8fe3ff',
  流明: '#ffd98a',
  虚: '#9aa7ff',
};

// ---------- 用户配置（目标/有效词条/表格顺序/视图），经服务器持久化到 data/user-config.json ----------
export let userConfig = { charTargets: {}, validStats: {}, notes: {}, rowOrder: [], colOrder: [], view: 'mychars', discWeights: {} };
export function readCharTarget(name) {
  return userConfig.charTargets[name] || {};
}
export function saveCharTarget(name, target) {
  userConfig.charTargets[name] = target;
  return saveUserConfig();
}
export function readValidStats(name) {
  const target = readCharTarget(name);
  // 整合到目标：目标配置含「有效副词条」键（含清空 []）→ 手动配置覆盖默认
  if (TARGET_KEYS.VALID_STATS in target) return target[TARGET_KEYS.VALID_STATS] || [];
  // 兼容旧数据：未迁移前有效副词条独立存于 validStats
  if (name in userConfig.validStats) return userConfig.validStats[name] || [];
  // 否则用角色默认：游戏推荐的有效属性（equipPlan.plan_effective_property_list）。
  // 合法有效副词条类型见 constants.SUBSTAT_TYPE_SET（与 calc.validStatOptions 的 type 一致）
  const character = myCharByName.get(name);
  if (!character) return [];
  return (character.equipPlan?.plan_effective_property_list || [])
    .map((p) => (p.full_name && p.full_name.includes('百分比') ? `${p.name}%` : p.name))
    .filter((t) => SUBSTAT_TYPE_SET.has(t));
}
export function readNote(name) {
  return userConfig.notes[name] || '';
}
export function saveNote(name, text) {
  userConfig.notes[name] = text;
  return saveUserConfig();
}
export function readRowOrder() {
  return userConfig.rowOrder || null;
}
export function readColOrder() {
  return userConfig.colOrder || null;
}
export function saveRowOrder(order) {
  userConfig.rowOrder = order;
  saveUserConfig();
}
export function saveColOrder(order) {
  userConfig.colOrder = order;
  saveUserConfig();
}

// ---------- 驱动盘模拟：用户自定义的副词条价值权重（按角色保存；点「计算概率」时写入，选中角色时自动加载） ----------
/** 该角色保存的 10 维价值权重（无返回 null，调用方回退 workshop 权重） */
export function readDiscWeights(name) {
  return userConfig.discWeights?.[name] || null;
}
export function saveDiscWeights(name, weights) {
  userConfig.discWeights[name] = weights;
  return saveUserConfig();
}

// ---------- 角色下拉共用（所有视图的角色选择统一：排序 + option 生成） ----------
/** 角色名排序：rowOrder（用户配置顺序）中的在前、按序；其余按中文名。names 缺省 = library 全部角色 */
export function sortRoleNames(names) {
  const list = names || Object.keys(library.characters || {});
  const order = readRowOrder() || [];
  const orderSet = new Set(order.filter((n) => list.includes(n)));
  const rest = list.filter((n) => !orderSet.has(n)).sort((a, b) => a.localeCompare(b, 'zh'));
  return [...orderSet, ...rest];
}
/** 角色下拉 option HTML（统一排序 + 转义）；current 为当前选中名，names 缺省 = library 全部角色 */
export function roleOptionsHtml(current = '', names) {
  return sortRoleNames(names)
    .map((n) => `<option value="${escapeHtml(n)}"${n === current ? ' selected' : ''}>${escapeHtml(n)}</option>`)
    .join('');
}
/** 保存用户配置到服务器。必须 await + 查 ok：postJSON 失败时返回 null 而不抛，
 *  原先不检查导致保存失败无提示、刷新后修改全部丢失。 */
export async function saveUserConfig() {
  if (isStatic()) {
    writeLS(LS.config, userConfig); // 静态模式：存浏览器 localStorage
    return true;
  }
  const j = await postJSON('/api/config', { config: userConfig });
  if (j && j.ok) return true;
  notify('配置保存失败：' + ((j && j.error) || '无法连接本地服务器') + '（刷新后本次修改会丢失）', 10);
  return false;
}
export async function loadUserConfig() {
  if (isStatic()) {
    const c = readLS(LS.config);
    if (c) {
      Object.assign(
        userConfig,
        { charTargets: {}, validStats: {}, notes: {}, rowOrder: [], colOrder: [], view: 'mychars', discWeights: {} },
        c
      );
    }
    return;
  }
  const j = await apiRequest('/api/config', { method: 'GET' });
  if (j && j.ok && j.config) {
    // 原地修改同一对象（render/ui 持有其引用），而不是重新赋值 let 变量
    Object.assign(
      userConfig,
      { charTargets: {}, validStats: {}, notes: {}, rowOrder: [], colOrder: [], view: 'mychars', discWeights: {} },
      j.config
    );
  }
}

// ---------- 计算上下文（供 src/lib/calc.js 的 setCalcContext 注入） ----------
export const dataCtx = {
  get library() {
    return library;
  },
  get charIndex() {
    return charIndex;
  },
  get wengineIndex() {
    return wengineIndex;
  },
  get discIndex() {
    return discIndex;
  },
  readCharTarget,
  readValidStats,
};
