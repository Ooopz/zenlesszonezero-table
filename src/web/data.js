// src/web/data.js —— 数据层：由 main.js 注入数据（不再从 DOM 内嵌块读取），维护索引/配置/过滤
import { statEntries } from '../lib/util.js';
import { buildNameIndex, CATEGORY } from '../lib/names.js';
import { Character, Wengine, Disc, toInstances } from '../lib/models.js';
import { SUBSTAT_TYPE_SET, TARGET_KEYS } from '../lib/constants.js';
import { apiRequest, postJSON } from './util.js';

// ---------- 数据（由 setData 注入） ----------
// 注：这些是 export let，ESM 的 import 是活绑定（live binding），
// setData 重新赋值后，import 方读到的总是最新值。
export let library = { characters: {}, wengines: {}, discs: {} };
export let myCharacters = [];
/** 角色名 → Character（供 readValidStats 默认路径 O(1) 查找，随 setData 重建） */
let myCharByName = new Map();
export const grid = document.getElementById('grid');

/** 养成指南推荐方案：{ avatarId: { name, plans: [...] } }，按角色名另建索引供目标弹窗表格用 */
export let plans = {};
export let plansByName = {};

/** 工坊全服配装统计：{ roles: [{ item_id, name, weapons, relics }] }（src/sync/workshop-grad.js 爬取） */
export let workshopGrad = { roles: [] };

/** 工坊配装汇总：{ wengines, discs, panels, discDetails }（src/sync/workshop-stats.js 生成，基于 workshop.json；
 *  discDetails 为驱动盘单盘真实统计，供统计视图「驱动盘」面板工坊真实列） */
export let workshopStats = { wengines: [], discs: [], panels: [], discDetails: [] };

/** 注入属性库 / 我的角色 / 推荐方案 / 工坊配装统计 / 工坊配装汇总（实例化为基类），并重建索引（main.js 在 fetch /api/data 后调用） */
export function setData(lib, chars, plansData, gradData, statsData) {
  lib = lib || { characters: {}, wengines: {}, discs: {}, bangboos: {} };
  library = {
    characters: toInstances(lib.characters, Character), // wiki 角色
    wengines: toInstances(lib.wengines, Wengine), // wiki 音擎
    discs: toInstances(lib.discs, Disc), // wiki 驱动盘
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
export let userConfig = { charTargets: {}, validStats: {}, notes: {}, rowOrder: [], colOrder: [], view: 'card' };
export function readCharTarget(name) {
  return userConfig.charTargets[name] || {};
}
export function saveCharTarget(name, target) {
  userConfig.charTargets[name] = target;
  saveUserConfig();
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
export function saveValidStats(name, list) {
  const target = readCharTarget(name);
  target[TARGET_KEYS.VALID_STATS] = list;
  saveCharTarget(name, target);
}
export function readNote(name) {
  return userConfig.notes[name] || '';
}
export function saveNote(name, text) {
  userConfig.notes[name] = text;
  saveUserConfig();
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
export async function saveUserConfig() {
  postJSON('/api/config', { config: userConfig });
}
export async function loadUserConfig() {
  const j = await apiRequest('/api/config', { method: 'GET' });
  if (j && j.ok && j.config) {
    // 原地修改同一对象（render/ui 持有其引用），而不是重新赋值 let 变量
    Object.assign(
      userConfig,
      { charTargets: {}, validStats: {}, notes: {}, rowOrder: [], colOrder: [], view: 'card' },
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
