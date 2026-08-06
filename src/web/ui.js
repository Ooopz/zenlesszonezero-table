// src/web/ui.js —— 交互层：提示条、服务器同步、目标/有效/备注弹窗、事件绑定、初始化
import { CLIPBOARD_SCRIPT } from '../lib/util.js';
import { targetStats, targetUnits, validStatOptions } from '../lib/calc.js';
import { apiRequest } from './util.js';
import {
  readCharTarget,
  saveCharTarget,
  readValidStats,
  saveValidStats,
  readNote,
  saveNote,
  userConfig,
  saveUserConfig,
  loadUserConfig,
} from './data.js';
import { render } from './render.js';
import { setWikiTab } from './wiki.js';

// ---------- 提示条 ----------
const statusEl = document.getElementById('status');
let statusTimer = null;
function notify(msg, seconds = 4) {
  statusEl.textContent = msg;
  statusEl.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove('show'), seconds * 1000);
}

// ---------- 服务器一键同步 ----------
/** 同步进度轮询：同步期间定时查询 /api/sync-progress 并刷新提示条 */
let syncPollTimer = null;
function stopSyncPolling() {
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
}
function startSyncPolling(kind) {
  stopSyncPolling();
  syncPollTimer = setInterval(async () => {
    const j = await apiRequest('/api/sync-progress', { method: 'GET' });
    if (!j || !j.ok || !j.progress || j.progress.kind !== kind) return;
    const p = j.progress;
    let msg = '正在同步…';
    if (p.step === 'characters') msg = `正在同步角色 ${p.done}/${p.total}…`;
    else if (p.step === 'wengines') msg = `正在同步音擎 ${p.done}/${p.total}…`;
    else if (p.step === 'discs') msg = `正在同步驱动盘 ${p.done}/${p.total}…`;
    else if (p.step === 'bangboos') msg = `正在同步邦布 ${p.done}/${p.total}…`;
    notify(msg, 60);
  }, 300); // 300ms 轮询：各阶段（尤其较短的驱动盘/邦布）都能可靠捕获
}

/** 更新数据库（需本地服务器） */
async function syncLibrary() {
  notify('正在更新数据库…（约 1 分钟，请稍候）', 60);
  startSyncPolling('library');
  const j = await apiRequest('/api/sync-base', { method: 'POST' });
  stopSyncPolling();
  if (j && j.ok) {
    notify(`属性库同步完成：角色${j.stats.characters} / 音擎${j.stats.wengines} / 驱动盘${j.stats.discs} / 邦布${j.stats.bangboos}，即将刷新`);
    setTimeout(() => location.reload(), 900);
  } else {
    notify('同步失败：' + (j && j.error ? j.error : '未检测到本地服务器，请先运行 npm start'), 10);
  }
}

// 角色同步弹窗
async function openRoleSync() {
  document.getElementById('cookieSnippet').value = CLIPBOARD_SCRIPT;
  const info = document.getElementById('cookieInfo');
  const j = await apiRequest('/api/cookie-status', { method: 'GET' });
  if (j && j.ok) {
    info.textContent = j.cached
      ? '已缓存 cookie，可点击「用缓存的 cookie 同步」一键更新。'
      : '尚未缓存 cookie，粘贴一次即可（之后会缓存）。';
  } else {
    info.textContent = '⚠ 未检测到本地服务器：请先运行 npm start，再打开本页。';
  }
  document.getElementById('rolesyncModal').classList.add('show');
}
async function syncCharacters(cookie) {
  notify('正在同步角色…', 60);
  startSyncPolling('characters');
  const j = await apiRequest('/api/sync-characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookie: cookie || '' }),
  });
  stopSyncPolling();
  if (j && j.ok) {
    notify(`角色同步完成：${j.stats.characters} 个角色，即将刷新`);
    setTimeout(() => location.reload(), 900);
  } else {
    notify('同步失败：' + (j && j.error ? j.error : '无法连接本地服务器（请先运行 npm start）'), 10);
  }
}

// ---------- 目标设置弹窗 ----------
let currentTargetChar = null;
function openTargetSettings(name) {
  currentTargetChar = name;
  const target = readCharTarget(name);
  document.getElementById('targetChar').textContent = name || '';
  document.getElementById('targetGrid').innerHTML = targetStats
    .map(
      (stat) =>
        `<div class="titem"><label>${stat}</label><input data-name="${stat}" type="number" step="any" value="${target[stat] ?? ''}" placeholder="—"><span class="unit">${targetUnits[stat] || ''}</span></div>`
    )
    .join('');
  document.getElementById('targetModal').classList.add('show');
}
function saveTargetSettings() {
  if (!currentTargetChar) return;
  const target = {};
  document.querySelectorAll('#targetGrid input').forEach((inp) => {
    const v = inp.value.trim();
    if (v !== '') target[inp.dataset.name] = Number(v);
  });
  saveCharTarget(currentTargetChar, target);
  document.getElementById('targetModal').classList.remove('show');
  render();
  notify(`${currentTargetChar} 目标已保存`);
}

// ---------- 有效副词条弹窗 ----------
let currentValidChar = null;
function openValidStats(name) {
  currentValidChar = name;
  const selected = new Set(readValidStats(name));
  document.getElementById('effChar').textContent = name || '';
  document.getElementById('effGrid').innerHTML = validStatOptions
    .map(
      (o) =>
        `<label class="chk"><input type="checkbox" data-type="${o.type}" ${selected.has(o.type) ? 'checked' : ''}> ${o.label}</label>`
    )
    .join('');
  document.getElementById('effModal').classList.add('show');
}
function saveValidStatsModal() {
  if (!currentValidChar) return;
  const selected = [];
  document.querySelectorAll('#effGrid input:checked').forEach((inp) => selected.push(inp.dataset.type));
  saveValidStats(currentValidChar, selected);
  document.getElementById('effModal').classList.remove('show');
  render();
  notify(`${currentValidChar} 有效副词条已保存`);
}

// 备注弹窗（点击头像）
let currentNoteChar = null;
function openNote(name) {
  currentNoteChar = name;
  document.getElementById('noteChar').textContent = name || '';
  document.getElementById('noteInput').value = readNote(name);
  document.getElementById('noteModal').classList.add('show');
}
function saveNoteModal() {
  if (!currentNoteChar) return;
  saveNote(currentNoteChar, document.getElementById('noteInput').value.trim());
  document.getElementById('noteModal').classList.remove('show');
  render();
  notify(`${currentNoteChar} 备注已保存`);
}

// 被卡片/表格内联 onclick 引用的函数，需挂到全局
window.openNote = openNote;
window.openTargetSettings = openTargetSettings;
window.openValidStats = openValidStats;

/** 初始化交互：绑定事件并启动加载配置（由 main.js 在数据就绪后调用） */
export function initUi() {
  // ---------- 事件绑定 ----------
  document
    .getElementById('targetClose')
    .addEventListener('click', () => document.getElementById('targetModal').classList.remove('show'));
  document.getElementById('targetSave').addEventListener('click', saveTargetSettings);
  document.getElementById('targetClear').addEventListener('click', () => {
    if (!currentTargetChar) return;
    saveCharTarget(currentTargetChar, {});
    document.getElementById('targetModal').classList.remove('show');
    render();
    notify('已清空该角色目标');
  });
  document
    .getElementById('effClose')
    .addEventListener('click', () => document.getElementById('effModal').classList.remove('show'));
  document.getElementById('effSave').addEventListener('click', saveValidStatsModal);
  document.getElementById('effClear').addEventListener('click', () => {
    if (!currentValidChar) return;
    saveValidStats(currentValidChar, []);
    document.getElementById('effModal').classList.remove('show');
    render();
    notify('已清空该角色有效副词条');
  });
  document
    .getElementById('noteClose')
    .addEventListener('click', () => document.getElementById('noteModal').classList.remove('show'));
  document.getElementById('noteSave').addEventListener('click', saveNoteModal);
  document.getElementById('noteClear').addEventListener('click', () => {
    if (!currentNoteChar) return;
    saveNote(currentNoteChar, '');
    document.getElementById('noteModal').classList.remove('show');
    render();
    notify('已清空该角色备注');
  });
  document.getElementById('syncBtn').addEventListener('click', syncLibrary);
  document.getElementById('rolesyncBtn').addEventListener('click', openRoleSync);
  // 视图切换（卡片 / 统计 / 数据库）：独立一组，切视图并同步 URL 与配置
  document.querySelectorAll('.view-tab').forEach((b) =>
    b.addEventListener('click', () => {
      userConfig.view = b.dataset.view;
      saveUserConfig();
      history.replaceState(null, '', b.dataset.view === 'card' ? location.pathname : `?view=${b.dataset.view}`);
      render();
    })
  );
  // wiki 子面板切换（wiki.js 渲染的 tab 内联引用）
  window.ZZZ = window.ZZZ || {};
  window.ZZZ.wikiTab = (key) => {
    setWikiTab(key);
    render();
  };
  document
    .getElementById('rolesyncClose')
    .addEventListener('click', () => document.getElementById('rolesyncModal').classList.remove('show'));
  document.getElementById('rolesyncNow').addEventListener('click', () => {
    const cookie = document.getElementById('cookieInput').value.trim();
    if (!cookie) return notify('请先粘贴 cookie', 6);
    document.getElementById('rolesyncModal').classList.remove('show');
    syncCharacters(cookie);
  });
  document.getElementById('rolesyncCached').addEventListener('click', () => {
    document.getElementById('rolesyncModal').classList.remove('show');
    syncCharacters('');
  });
  document
    .getElementById('helpBtn')
    .addEventListener('click', () => document.getElementById('helpModal').classList.add('show'));
  document
    .getElementById('helpClose')
    .addEventListener('click', () => document.getElementById('helpModal').classList.remove('show'));

  // 先加载用户配置（目标/有效词条），再渲染
  loadUserConfig().then(() => render());
}
