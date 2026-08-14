// src/web/ui.js —— 交互层：提示条、服务器同步、目标/有效/备注弹窗、事件绑定、初始化
import { CLIPBOARD_SCRIPT, escapeHtml, escapeJsAttr, formatValue } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { registerZZZ } from './shared.js';
import { targetStats, targetUnits, validStatOptions } from '../lib/calc.js';
import { TARGET_KEYS, MAIN_STAT_OPTIONS, SYNC_KINDS, VIEWS, SUBSTAT_TYPE_SET, mainStatName } from '../lib/constants.js';
import { apiRequest, postJSON } from './util.js';
import {
  readCharTarget,
  saveCharTarget,
  readValidStats,
  readNote,
  saveNote,
  userConfig,
  saveUserConfig,
  loadUserConfig,
  plansByName,
  library,
} from './data.js';
import { render, setMyTab } from './render.js';
import { setWikiTab } from './wiki.js';
import { setRecommendTab, setSelectedRole } from './recommend.js';

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
/** 同步进度轮询：同步期间定时查询 /api/sync-progress，更新提示条与同步中心弹窗内进度 */
let syncPollTimer = null;
function stopSyncPolling() {
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
}
/** 更新同步中心弹窗内进度区（打开时）；未打开则忽略 */
function progress(msg) {
  const el = document.getElementById('syncProgress');
  if (el) el.textContent = msg;
}
function startSyncPolling(kind) {
  stopSyncPolling();
  syncPollTimer = setInterval(async () => {
    const j = await apiRequest('/api/sync-progress', { method: 'GET' });
    if (!j || !j.ok || !j.progress || j.progress.kind !== kind) return;
    const p = j.progress;
    let msg = '正在同步…';
    if (p.step === SYNC_KINDS.CHARACTERS) msg = `正在同步角色 ${p.done}/${p.total}…`;
    else if (p.step === 'wengines') msg = `正在同步音擎 ${p.done}/${p.total}…`;
    else if (p.step === 'discs') msg = `正在同步驱动盘 ${p.done}/${p.total}…`;
    else if (p.step === 'bangboos') msg = `正在同步邦布 ${p.done}/${p.total}…`;
    else if (p.step === SYNC_KINDS.PLANS) msg = `正在同步推荐方案 ${p.done}/${p.total}…`;
    else if (p.step === 'rank') msg = `正在爬取排名 ${p.done}/${p.total}…`;
    else if (p.step === 'fetch') msg = `正在拉取工坊配装 ${p.done}/${p.total}…`;
    else if (p.step === 'grad') msg = `正在更新工坊统计 ${p.done}/${p.total}…`;
    progress(msg);
  }, 300); // 300ms 轮询：各阶段（尤其较短的驱动盘/邦布）都能可靠捕获
}

/** 统一同步请求：执行一个同步并返回 {ok, data}（由调用方决定刷新/汇总）。
 *  同步可跑数小时（工坊全量/推荐方案全量），POST 不设超时（timeout: 0），
 *  完成与否以服务器最终响应为准；进度靠 startSyncPolling 轮询展示。 */
async function runSync(label, kind, url, body) {
  startSyncPolling(kind);
  const j = body ? await postJSON(url, body, { timeout: 0 }) : await apiRequest(url, { method: 'POST', timeout: 0 });
  stopSyncPolling();
  return { ok: !!(j && j.ok), data: j };
}
const syncBase = () => runSync('数据库', SYNC_KINDS.LIBRARY, '/api/sync-base');
const syncCharacters = (cookie) =>
  runSync('我的角色', SYNC_KINDS.CHARACTERS, '/api/sync-characters', { cookie: cookie || '' });
const syncPlans = (cookie) => runSync('推荐方案', SYNC_KINDS.PLANS, '/api/sync-plans', { cookie: cookie || '' });
const syncWorkshopData = () => runSync('工坊数据', SYNC_KINDS.WORKSHOP, '/api/sync-workshop');

/** 打开同步中心弹窗：填充数据新鲜度 + 当前 cookie 明文 */
async function openSyncCenter() {
  const j = await apiRequest('/api/sync-status', { method: 'GET' });
  document.getElementById('syncCookieSnippet').textContent = CLIPBOARD_SCRIPT;
  document.getElementById('syncCookieInput').value = j && j.cookie ? j.cookie : '';
  document.getElementById('syncFreshness').innerHTML =
    j && j.ok ? renderFreshness(j.files) : '⚠ 未检测到本地服务器：请先运行 npm start';
  document.getElementById('syncProgress').textContent = '';
  document.getElementById('syncErrors').innerHTML = '';
  document.getElementById('syncModal').classList.add('show');
}
/** 距现在的时间描述（数据新鲜度） */
function ago(ms) {
  if (ms == null) return '未更新';
  const d = Date.now() - ms;
  const day = Math.floor(d / 86400000);
  const h = Math.floor(d / 3600000);
  const m = Math.floor(d / 60000);
  if (day > 0) return `${day} 天前`;
  if (h > 0) return `${h} 小时前`;
  return m > 0 ? `${m} 分钟前` : '刚刚';
}
function renderFreshness(files) {
  const labels = {
    library: '数据库',
    characters: '我的角色',
    plans: '推荐方案',
    workshop: '工坊配装',
    workshopGrad: '工坊统计',
  };
  const items = Object.entries(files || {}).map(
    ([k, v]) => `<span class="fresh-item">${labels[k] || k}：<b>${ago(v)}</b></span>`
  );
  return `<div class="fresh-row">${items.join('')}</div>`;
}
/** 按勾选同步（可多选）：串行执行、失败隔离，最后汇总并刷新 */
async function runSelectedSyncs() {
  const checked = [...document.querySelectorAll('.sync-chk:checked')].map((c) => c.dataset.key);
  if (!checked.length) return notify('未勾选任何同步', 6);
  const cookie = document.getElementById('syncCookieInput').value.trim();
  const labels = { wiki: '数据库', characters: '我的角色', plans: '推荐方案', workshop: '工坊数据' };
  const results = [];
  for (const key of checked) {
    const label = labels[key] || key;
    progress(`正在更新${label}…`);
    let r;
    if (key === 'wiki') r = await syncBase();
    else if (key === 'characters') r = await syncCharacters(cookie);
    else if (key === 'plans') r = await syncPlans(cookie);
    else r = await syncWorkshopData();
    const error = r.ok ? '' : (r.data && r.data.error) || '网络错误';
    results.push({ label, ok: r.ok, error });
    if (!r.ok) progress(`正在更新${label}…失败：${error}`);
  }
  const summary = results.map((r) => `${r.label}${r.ok ? '✓' : '✗'}`).join(' ');
  progress(`同步完成：${summary}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    // 有失败项 → 在更新面板内展示失败详情（面板保持打开，便于调整后重试）
    document.getElementById('syncErrors').innerHTML =
      `<div class="sync-errors-title">以下数据更新失败，可查看原因后重试：</div>` +
      failed
        .map(
          (f) =>
            `<div class="sync-errors-item"><b>${escapeHtml(f.label)}</b>：<span>${escapeHtml(f.error)}</span></div>`
        )
        .join('');
  } else {
    notify(`同步完成：${summary}，即将刷新`);
    setTimeout(() => location.reload(), 1200);
  }
}

/** 保存 cookie 到本地（data/.cookie.json），不触发同步 */
async function saveCookie() {
  const cookie = document.getElementById('syncCookieInput').value.trim();
  if (!cookie) return notify('cookie 为空，粘贴后保存', 6);
  const j = await postJSON('/api/cookie', { cookie });
  if (j && j.ok) notify('cookie 已保存');
  else notify('保存失败：' + ((j && j.error) || '无法连接本地服务器'), 10);
}

/** 复制代码到剪贴板（指南脚本/命令） */
function copyText(text, label) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => notify(`${label}已复制到剪贴板`))
      .catch(() => notify('复制失败，请手动框选复制'));
  } else {
    notify('当前浏览器不支持一键复制，请手动框选复制');
  }
}

// ---------- 目标设置弹窗 ----------
let currentTargetChar = null;

/** 填充「推荐音擎」下拉：只允许选属性库（wiki）中的音擎（候选见 constants.MAIN_STAT_OPTIONS） */
function fillWengineSelect() {
  const sel = document.getElementById('targetWengine');
  const names = Object.keys(library.wengines || {}).sort((a, b) => a.localeCompare(b, 'zh'));
  sel.innerHTML =
    '<option value="">—</option>' +
    names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}
/** 填充指定槽位主词条下拉 */
function fillMainSelect(slot) {
  const sel = document.getElementById('targetMain' + slot);
  sel.innerHTML =
    '<option value="">—</option>' +
    MAIN_STAT_OPTIONS[slot].map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
}

function openTargetSettings(name) {
  if (currentTargetChar !== name) planSort.reset(); // 切换角色时重置方案排序
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
  document.getElementById('targetWengine').value = target[TARGET_KEYS.WENGINE] || '';
  document.getElementById('targetMain4').value = target[TARGET_KEYS.MAIN4] || '';
  document.getElementById('targetMain5').value = target[TARGET_KEYS.MAIN5] || '';
  document.getElementById('targetMain6').value = target[TARGET_KEYS.MAIN6] || '';
  // 有效副词条勾选（并入目标弹窗，未手动配置时预勾选默认游戏推荐）
  const effSelected = new Set(readValidStats(name));
  document.getElementById('effGrid').innerHTML = validStatOptions
    .map(
      (o) =>
        `<label class="chk"><input type="checkbox" data-type="${escapeHtml(o.type)}" ${effSelected.has(o.type) ? 'checked' : ''}> ${escapeHtml(o.label)}</label>`
    )
    .join('');
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
  if (w) target[TARGET_KEYS.WENGINE] = w;
  for (const [id, key] of [
    ['targetMain4', TARGET_KEYS.MAIN4],
    ['targetMain5', TARGET_KEYS.MAIN5],
    ['targetMain6', TARGET_KEYS.MAIN6],
  ]) {
    const v = document.getElementById(id).value.trim();
    if (v) target[key] = v;
  }
  // 有效副词条（勾选结果；全不勾选 = 清空 → 覆盖默认游戏推荐）
  target[TARGET_KEYS.VALID_STATS] = [...document.querySelectorAll('#effGrid input:checked')].map(
    (inp) => inp.dataset.type
  );
  saveCharTarget(currentTargetChar, target);
  document.getElementById('targetModal').classList.remove('show');
  render();
  notify(`${currentTargetChar} 目标已保存`);
}

/** 推荐方案表格排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js） */
const planSort = createSort();
function togglePlanSort(key) {
  planSort.toggle(key);
}
/** 各列排序取值：属性列取 panel.high（数值），发布时间取时间戳，其余按展示文本 */
function planSortValue(p, key) {
  if (key === '方案') return p.name;
  if (key === '发布时间') return Number(p.releasedAt) || 0;
  if (key === '推荐音擎') return p.weapon?.main || '';
  if (key === '二件套')
    return (
      (p.sets || [])
        .filter((s) => s.cnt === 2)
        .map((s) => s.name)
        .join('、') || ''
    );
  if (key === '四件套')
    return (
      (p.sets || [])
        .filter((s) => s.cnt === 4)
        .map((s) => s.name)
        .join('、') || ''
    );
  if (key === '4号位') return p.mainProps?.[4] || '';
  if (key === '5号位') return p.mainProps?.[5] || '';
  if (key === '6号位') return p.mainProps?.[6] || '';
  if (key === '推荐副词条') return (p.subStats || []).join('、') || '';
  const a = (p.panel || []).find((x) => x.name === key);
  return a?.high ?? null;
}

/** 目标弹窗推荐方案表格：动态属性列（该角色所有方案推荐面板属性并集，取 high 档）+ 音擎 / 456 主词条 / 副词条。
 *  表头可点击排序（复用 compareValues 与列表视图三态模式）；排序后「应用」仍按原始下标取对应方案。 */
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

  // 排序（未激活时 apply 原样返回；激活时空值行始终排最后，不受升降序影响）
  const list = planSort.apply(plansList, planSortValue);

  const heads = [
    '',
    '方案',
    '发布时间',
    ...statNames,
    TARGET_KEYS.WENGINE,
    '二件套',
    '四件套',
    '4号位',
    '5号位',
    '6号位',
    '推荐副词条',
  ];
  const rows = list.map((p) => {
    const statMap = {};
    for (const a of p.panel || []) statMap[a.name] = a;
    // 发布时间：releasedAt 为 Unix 秒
    let released = '—';
    if (p.releasedAt) {
      const d = new Date(Number(p.releasedAt) * 1000);
      if (!Number.isNaN(d.getTime())) {
        const pad = (x) => String(x).padStart(2, '0');
        released = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }
    // 二/四件套名（部分方案为 2+2 无四件套，可能同名多套）
    const setName = (cnt) =>
      (p.sets || [])
        .filter((s) => s.cnt === cnt)
        .map((s) => s.name)
        .join('、') || '—';
    const cells = [
      `<td><button class="mini apply-btn" onclick="window.ZZZ.applyPlan('${escapeJsAttr(name)}', ${plansList.indexOf(p)})">应用</button></td>`,
      `<td class="pname" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</td>`,
      `<td>${released}</td>`,
      ...statNames.map((n) => {
        const a = statMap[n];
        const val = a && a.high != null ? (a.percent ? `${(a.high * 100).toFixed(1)}%` : formatValue(n, a.high)) : '—';
        return `<td>${val}</td>`;
      }),
      `<td>${escapeHtml(p.weapon?.main || '—')}</td>`,
      `<td>${escapeHtml(setName(2))}</td>`,
      `<td>${escapeHtml(setName(4))}</td>`,
      `<td>${escapeHtml(p.mainProps?.[4] || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[5] || '—')}</td>`,
      `<td>${escapeHtml(p.mainProps?.[6] || '—')}</td>`,
      `<td class="subs">${escapeHtml((p.subStats || []).join('、'))}</td>`,
    ];
    return `<tr>${cells.join('')}</tr>`;
  });
  container.innerHTML = `<table class="plantable"><thead><tr>${heads
    .map((h) => {
      if (!h) return '<th></th>'; // 应用列不可排序
      const on = planSort.key === h;
      return `<th data-sort="${escapeHtml(h)}"${on ? ' class="sorted"' : ''}>${escapeHtml(h)}${on ? (planSort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
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
  if (p.weapon?.main) target[TARGET_KEYS.WENGINE] = p.weapon.main;
  // 456 号位主词条恒为百分比：mainStatName 兜底把旧数据/接口固定值名转百分比（攻击力→攻击力%）
  if (p.mainProps?.[4]) target[TARGET_KEYS.MAIN4] = mainStatName(p.mainProps[4]);
  if (p.mainProps?.[5]) target[TARGET_KEYS.MAIN5] = mainStatName(p.mainProps[5]);
  if (p.mainProps?.[6]) target[TARGET_KEYS.MAIN6] = mainStatName(p.mainProps[6]);
  // 推荐副词条 → 有效副词条（过滤到合法副词条类型，如「攻击力%」「异常精通」）
  if (p.subStats?.length) target[TARGET_KEYS.VALID_STATS] = p.subStats.filter((s) => SUBSTAT_TYPE_SET.has(s));
  saveCharTarget(name, target);
  openTargetSettings(name); // 重新渲染显示已应用的值
  notify(`${name} 已应用「${p.name}」推荐值`);
}
registerZZZ({ applyPlan });

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

/** 初始化交互：绑定事件并启动加载配置（由 main.js 在数据就绪后调用） */
export function initUi() {
  // 图片加载失败统一占位：隐藏破图，露出容器背景色块（error 事件不冒泡，需捕获阶段）
  document.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG') t.style.visibility = 'hidden';
    },
    true
  );
  // Esc 关闭当前弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const id of ['targetModal', 'noteModal', 'helpModal', 'syncModal', 'skillModal']) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('show');
    }
  });
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
  // 技能每级数值弹窗（wiki 数据库视图技能图标点击打开）
  document
    .getElementById('skillClose')
    .addEventListener('click', () => document.getElementById('skillModal').classList.remove('show'));
  // 推荐方案表格表头点击排序（targetModal 不在 grid 内，需单独委托；排序后按当前角色重渲染）
  document.getElementById('planTable').addEventListener('click', (e) => {
    const th = e.target.closest ? e.target.closest('th[data-sort]') : null;
    if (!th) return;
    togglePlanSort(th.dataset.sort);
    renderPlanTable(currentTargetChar);
  });
  // 同步中心：点「同步数据」打开弹窗；「更新」执行勾选的同步
  document.getElementById('syncBtn').addEventListener('click', openSyncCenter);
  document.getElementById('syncRun').addEventListener('click', runSelectedSyncs);
  document
    .getElementById('syncClose')
    .addEventListener('click', () => document.getElementById('syncModal').classList.remove('show'));
  document
    .getElementById('syncCopy')
    .addEventListener('click', () => copyText(document.getElementById('syncCookieSnippet').textContent, '脚本'));
  document.getElementById('syncCookieSave').addEventListener('click', saveCookie);
  // 视图切换（我的角色 / 数据库 / 统计）：独立一组，切视图并同步 URL 与配置
  document.querySelectorAll('.view-tab').forEach((b) =>
    b.addEventListener('click', () => {
      userConfig.view = b.dataset.view;
      saveUserConfig();
      history.replaceState(null, '', b.dataset.view === VIEWS.MY_CHARS ? location.pathname : `?view=${b.dataset.view}`);
      render();
    })
  );
  // wiki 子面板切换（wiki.js 渲染的 tab 内联引用）
  registerZZZ({
    wikiTab: (key) => {
      setWikiTab(key);
      render();
    },
    recommendTab: (key) => {
      setRecommendTab(key);
      render();
    },
    selectRole: (name) => {
      setSelectedRole(name); // 角色详情/分布分析面板的角色下拉
      render();
    },
    myTab: (key) => {
      setMyTab(key);
      render();
    },
    syncWorkshop: () =>
      syncWorkshopData().then((r) => {
        if (r.ok) {
          notify('工坊数据已更新，即将刷新');
          setTimeout(() => location.reload(), 900);
        } else {
          notify('更新失败：' + ((r.data && r.data.error) || '无法连接本地服务器'), 10);
        }
      }),
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
