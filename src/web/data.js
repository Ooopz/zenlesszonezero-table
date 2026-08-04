// src/web/data.js —— 数据层：由 main.js 注入数据（不再从 DOM 内嵌块读取），维护索引/配置/过滤
import { buildIndex, lookup, statEntries } from '../lib/util.js';
import { apiRequest } from './util.js';

// ---------- 数据（由 setData 注入） ----------
// 注：这些是 export let，ESM 的 import 是活绑定（live binding），
// setData 重新赋值后，import 方读到的总是最新值。
export let library = { characters: {}, wengines: {}, discs: {} };
export let myCharacters = [];
export const grid = document.getElementById('grid');

/** 注入属性库与我的角色数据，并重建索引（main.js 在 fetch /api/data 后调用） */
export function setData(lib, chars) {
  library = lib || { characters: {}, wengines: {}, discs: {} };
  myCharacters = chars || [];
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
export function readValidStats(name) {
  return userConfig.validStats[name] || [];
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

// ---------- 角色过滤（属性 / 职业） ----------
export const filterState = { element: '', trait: '' };
/** 应用筛选，返回当前可见的角色列表 */
export function getFilteredCharacters() {
  return myCharacters.filter((c) => {
    const lc = lookup(library.characters, charIndex, c.name) || {};
    if (filterState.element && lc.element !== filterState.element) return false;
    if (filterState.trait && lc.trait !== filterState.trait) return false;
    return true;
  });
}
/** 按我的角色数据动态填充筛选下拉的选项 */
export function populateFilters() {
  const elements = new Set(),
    traits = new Set();
  for (const c of myCharacters) {
    const lc = lookup(library.characters, charIndex, c.name) || {};
    if (lc.element) elements.add(lc.element);
    if (lc.trait) traits.add(lc.trait);
  }
  const fill = (id, values, placeholder) => {
    document.getElementById(id).innerHTML =
      `<option value="">${placeholder}</option>` + values.map((v) => `<option value="${v}">${v}</option>`).join('');
  };
  // 已知元素按固定顺序，未收录的新元素追加在后面
  const knownElements = Object.keys(elementColors).filter((e) => elements.has(e));
  const newElements = [...elements].filter((e) => !(e in elementColors));
  fill('filterElement', knownElements.concat(newElements), '全部属性');
  fill('filterTrait', [...traits].sort(), '全部职业');
}
