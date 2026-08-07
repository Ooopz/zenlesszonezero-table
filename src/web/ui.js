// src/web/ui.js —— 交互层：提示条、服务器同步、目标/有效/备注弹窗、事件绑定、初始化
import { CLIPBOARD_SCRIPT, escapeHtml, escapeJsAttr, formatValue } from '../lib/util.js';
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
  plansByName,
  library,
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
    else if (p.step === 'plans') msg = `正在同步推荐方案 ${p.done}/${p.total}…`;
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

/** 同步推荐方案（米游社养成指南「切换方案」列表，每角色前 20 个）。依赖账号 cookie，复用角色同步的缓存。 */
async function syncPlans() {
  const st = await apiRequest('/api/cookie-status', { method: 'GET' });
  if (!st || !st.ok || !st.cached) {
    notify('推荐方案同步需要 cookie：请先在「同步数据 → 更新我的角色」里粘贴一次 cookie', 10);
    return;
  }
  notify('正在同步推荐方案…（每角色最多 20 个方案，约 1 分钟）', 120);
  startSyncPolling('plans');
  const j = await apiRequest('/api/sync-plans', { method: 'POST' });
  stopSyncPolling();
  if (j && j.ok) {
    notify(`推荐方案同步完成：${j.stats.characters} 角色 / ${j.stats.plans} 个方案，即将刷新`);
    setTimeout(() => location.reload(), 900);
  } else {
    notify('同步失败：' + (j && j.error ? j.error : '无法连接本地服务器（请先运行 npm start）'), 10);
  }
}

// ---------- 目标设置弹窗 ----------
let currentTargetChar = null;

/** 驱动盘 4/5/6 号位主词条候选（对应各槽位推荐，含养成指南所用固定值名与百分比变体） */
const MAIN_STAT_OPTIONS = {
  4: ['暴击率', '暴击伤害', '异常精通', '攻击力', '攻击力%', '防御力', '防御力%', '生命值', '生命值%'],
  5: [
    '穿透率',
    '攻击力',
    '攻击力%',
    '防御力',
    '防御力%',
    '生命值',
    '生命值%',
    '物理伤害加成',
    '火属性伤害加成',
    '冰属性伤害加成',
    '电属性伤害加成',
    '以太伤害加成',
    '风属性伤害加成',
    '烈霜伤害加成',
    '流明伤害加成',
  ],
  6: ['冲击力', '能量自动回复', '异常掌控', '攻击力', '攻击力%', '防御力', '防御力%', '生命值', '生命值%'],
};

/** 填充「推荐音擎」下拉：只允许选属性库（wiki）中的音擎 */
function fillWengineSelect() {
  const sel = document.getElementById('targetWengine');
  const names = Object.keys(library.wengines || {}).sort((a, b) => a.localeCompare(b, 'zh'));
  sel.innerHTML = '<option value="">—</option>' + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}
/** 填充指定槽位主词条下拉 */
function fillMainSelect(slot) {
  const sel = document.getElementById('targetMain' + slot);
  sel.innerHTML =
    '<option value="">—</option>' +
    MAIN_STAT_OPTIONS[slot].map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

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
  // 推荐音擎（wiki 音擎下拉）+ 4/5/6 号位主词条（各槽位候选下拉）
  fillWengineSelect();
  for (const slot of [4, 5, 6]) fillMainSelect(slot);
  document.getElementById('targetWengine').value = target['推荐音擎'] || '';
  document.getElementById('targetMain4').value = target['4号位主词条'] || '';
  document.getElementById('targetMain5').value = target['5号位主词条'] || '';
  document.getElementById('targetMain6').value = target['6号位主词条'] || '';
  renderPlanTable(name);
  document.getElementById('targetModal').classList.add('show');
}
function saveTargetSettings() {
  if (!currentTargetChar) return;
  const target = {};
  document.querySelectorAll('#targetGrid input').forEach((inp) => {
    const v = inp.value.trim();
    if (v !== '') target[inp.dataset.name] = Number(v);
  });
  // 音擎/主词条（字符串目标，空值不覆盖）
  const w = document.getElementById('targetWengine').value.trim();
  if (w) target['推荐音擎'] = w;
  for (const [id, key] of [
    ['targetMain4', '4号位主词条'],
    ['targetMain5', '5号位主词条'],
    ['targetMain6', '6号位主词条'],
  ]) {
    const v = document.getElementById(id).value.trim();
    if (v) target[key] = v;
  }
  saveCharTarget(currentTargetChar, target);
  document.getElementById('targetModal').classList.remove('show');
  render();
  notify(`${currentTargetChar} 目标已保存`);
}

/** 目标弹窗推荐方案表格：动态属性列（该角色所有方案推荐面板属性并集，取 high 档）+ 音擎 / 456 主词条 / 副词条 */
function renderPlanTable(name) {
  const container = document.getElementById('planTable');
  const entry = plansByName[name];
  if (!entry || !entry.plans?.length) {
    container.innerHTML =
      '<p style="padding:14px;color:var(--dim)">暂无推荐方案 —— 可在「同步数据 → 更新推荐方案」后刷新查看</p>';
    return;
  }
  const plansList = entry.plans;
  // 动态列：所有方案出现的推荐属性并集（不同角色/方案属性不同）
  const statNames = [];
  for (const p of plansList) for (const a of p.panel || []) if (!statNames.includes(a.name)) statNames.push(a.name);

  const heads = ['', '方案', ...statNames, '推荐音擎', '4号位', '5号位', '6号位', '推荐副词条'];
  const rows = plansList.map((p, i) => {
    const statMap = {};
    for (const a of p.panel || []) statMap[a.name] = a;
    const cells = [
      `<td><button class="mini apply-btn" onclick="window.ZZZ.applyPlan('${escapeJsAttr(name)}', ${i})">应用</button></td>`,
      `<td class="pname" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</td>`,
      ...statNames.map((n) => {
        const a = statMap[n];
        const val = a && a.high != null ? (a.percent ? `${(a.high * 100).toFixed(1)}%` : formatValue(n, a.high)) : '—';
        return `<td>${val}</td>`;
      }),
      `<td>${escapeHtml(p.weapon?.main || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[4] || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[5] || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[6] || '—')}</td>`,
      `<td class="subs">${escapeHtml((p.subStats || []).join('、'))}</td>`,
    ];
    return `<tr>${cells.join('')}</tr>`;
  });
  container.innerHTML = `<table class="plantable"><thead><tr>${heads
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** 应用推荐方案：把方案推荐面板（high 档）+ 推荐音擎 + 4/5/6 号位主词条写入该角色目标 */
function applyPlan(name, idx) {
  const entry = plansByName[name];
  const p = entry?.plans?.[idx];
  if (!p) return;
  const target = readCharTarget(name);
  for (const a of p.panel || []) {
    if (a.high == null) continue;
    // 目标系统：百分比属性填整数（60 = 60%），其余填实际数值
    target[a.name] = a.percent ? Math.round(a.high * 100) : a.high;
  }
  if (p.weapon?.main) target['推荐音擎'] = p.weapon.main;
  if (p.mainProps?.[4]) target['4号位主词条'] = p.mainProps[4];
  if (p.mainProps?.[5]) target['5号位主词条'] = p.mainProps[5];
  if (p.mainProps?.[6]) target['6号位主词条'] = p.mainProps[6];
  saveCharTarget(name, target);
  openTargetSettings(name); // 重新渲染显示已应用的值
  notify(`${name} 已应用「${p.name}」推荐值`);
}
window.ZZZ = window.ZZZ || {};
window.ZZZ.applyPlan = applyPlan;

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
  // 同步下拉：触发器开合，外部点击收起，菜单项分发到三个同步动作
  const syncTrigger = document.getElementById('syncBtn');
  const syncDropdown = document.querySelector('.sync-dropdown');
  syncTrigger.addEventListener('click', () => syncDropdown.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sync-menu')) syncDropdown.classList.remove('open');
  });
  document.querySelectorAll('.sync-dropdown button').forEach((b) =>
    b.addEventListener('click', () => {
      syncDropdown.classList.remove('open');
      const act = b.dataset.action;
      if (act === 'library') syncLibrary();
      else if (act === 'characters') openRoleSync();
      else if (act === 'plans') syncPlans();
    })
  );
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
