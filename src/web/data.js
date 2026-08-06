// src/web/data.js —— 数据层：由 main.js 注入数据（不再从 DOM 内嵌块读取），维护索引/配置/过滤
import { buildIndex, lookup, statEntries } from '../lib/util.js';
import { Character, Wengine, Disc, toInstances } from '../lib/models.js';
import { apiRequest } from './util.js';

// ---------- 数据（由 setData 注入） ----------
// 注：这些是 export let，ESM 的 import 是活绑定（live binding），
// setData 重新赋值后，import 方读到的总是最新值。
export let library = { characters: {}, wengines: {}, discs: {} };
export let myCharacters = [];
export const grid = document.getElementById('grid');

/** 注入属性库与我的角色数据（实例化为基类），并重建索引（main.js 在 fetch /api/data 后调用） */
export function setData(lib, chars) {
  lib = lib || { characters: {}, wengines: {}, discs: {}, bangboos: {} };
  library = {
    characters: toInstances(lib.characters, Character), // wiki 角色
    wengines: toInstances(lib.wengines, Wengine), // wiki 音擎
    discs: toInstances(lib.discs, Disc), // wiki 驱动盘
    bangboos: lib.bangboos || {}, // 邦布为普通对象（基类无附加逻辑）
  };
  myCharacters = (chars || []).map((c) => new Character(c)); // 账号角色（含 Wengine/Disc 嵌套）
  rebuildIndex();
}

// ---------- 索引与查找 ----------
export let charIndex = {},
  wengineIndex = {},
  discIndex = {};
function rebuildIndex() {
  charIndex = buildIndex(library.characters || {});
  wengineIndex = buildIndex(library.wengines || {});
  discIndex = buildIndex(library.discs || {});
}
export { lookup, statEntries };

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
// 合法有效副词条类型（与 calc.validStatOptions 的 type 一致）
const VALID_STAT_TYPES = new Set([
  '攻击力',
  '攻击力%',
  '暴击率',
  '暴击伤害',
  '穿透值',
  '异常精通',
  '生命值',
  '生命值%',
  '防御力',
  '防御力%',
]);

export function readValidStats(name) {
  // 手动配置过（含清空）→ 覆盖默认
  if (name in userConfig.validStats) return userConfig.validStats[name] || [];
  // 否则用角色默认：游戏推荐的有效属性（equipPlan.plan_effective_property_list）
  const character = myCharacters.find((c) => c.name === name);
  if (!character) return [];
  return (character.equipPlan?.plan_effective_property_list || [])
    .map((p) => (p.full_name && p.full_name.includes('百分比') ? `${p.name}%` : p.name))
    .filter((t) => VALID_STAT_TYPES.has(t));
}
export function saveValidStats(name, list) {
  userConfig.validStats[name] = list;
  saveUserConfig();
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
  apiRequest('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: userConfig }),
  });
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

