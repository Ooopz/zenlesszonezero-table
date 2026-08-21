// src/web/sync.js —— 服务器一键同步中心（从 ui.js 拆出，2026-11）
// 职责：同步弹窗（勾选/新鲜度/cookie/进度轮询）+ 四个同步的请求封装。
// 入口 initSync() 绑定弹窗按钮（ui.js 的 initUi 调用）；syncWorkshopData 供「工坊更新」快捷入口复用。
import { CLIPBOARD_SCRIPT, escapeHtml } from '../lib/util.js';
import { apiRequest, postJSON, notify } from './api.js';
import { SYNC_KINDS } from '../lib/constants.js';
import { isStatic, importCharacters, clearLocalChars, myCharacters } from './data.js';
import { render } from './render.js';

// ---------- 同步进度轮询 ----------
/** 同步期间定时查询 /api/sync-progress，更新进度提示 */
let syncPollTimer = null;
/** header 同步按钮的进行中状态：文本 + .syncing 动画（关闭弹窗后仍可见，提示同步未结束） */
function setSyncing(on) {
  const btn = document.getElementById('syncBtn');
  if (!btn) return;
  btn.classList.toggle('syncing', on);
  btn.textContent = on ? '同步中…' : '同步数据';
}
function stopSyncPolling() {
  if (syncPollTimer) {
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }
  setSyncing(false);
}
/** 更新同步中心弹窗内进度区（打开时）；未打开则忽略 */
function progress(msg) {
  const el = document.getElementById('syncProgress');
  if (el) el.textContent = msg;
}
function startSyncPolling(kind) {
  stopSyncPolling();
  setSyncing(true);
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
    else if (p.step === 'fetch')
      msg = p.skipped
        ? `正在拉取工坊配装 ${p.done}/${p.total}（跳过 ${p.skipped} 个已缓存）…`
        : `正在拉取工坊配装 ${p.done}/${p.total}…`;
    else if (p.step === 'grad') msg = `正在更新工坊统计 ${p.done}/${p.total}…`;
    progress(msg);
  }, 300); // 300ms 轮询：各阶段（尤其较短的驱动盘/邦布）都能可靠捕获
}

/** 统一同步请求：执行一个同步并返回 {ok, data}。同步可跑数小时，POST 不设超时（timeout: 0），以服务器最终响应为准。 */
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
export const syncWorkshopData = () => runSync('工坊数据', SYNC_KINDS.WORKSHOP, '/api/sync-workshop');

/** 时间戳（ms）→ 本地时间 YYYY-MM-DD HH:mm */
function fmtDateTime(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** cookie 状态行：明确提示「已保存 + 保存时间」（明文不回显，安全） */
function renderCookieState(cached, savedAt) {
  const state = document.getElementById('syncCookieState');
  if (!state) return;
  if (cached) {
    state.textContent = '✓ cookie 已保存' + (savedAt ? `（保存于 ${fmtDateTime(savedAt)}）` : '');
    state.classList.add('saved');
  } else {
    state.textContent = '尚未保存 cookie';
    state.classList.remove('saved');
  }
}

/** 打开同步中心弹窗：填充数据新鲜度 + cookie 缓存状态（明文不回显，只提示已保存与保存时间） */
async function openSyncCenter() {
  const j = await apiRequest('/api/sync-status', { method: 'GET' });
  document.getElementById('syncCookieSnippet').textContent = CLIPBOARD_SCRIPT;
  // 书签小工具：同一脚本编码成 javascript: URI，拖到书签栏后点一下即可收集（免 F12/控制台）
  const bm = document.getElementById('syncBookmarklet');
  if (bm) bm.href = 'javascript:' + encodeURIComponent(CLIPBOARD_SCRIPT);
  const input = document.getElementById('syncCookieInput');
  input.value = '';
  input.placeholder = j && j.cached ? '已缓存 cookie（不回显）；需更换时在此粘贴新的' : '尚未缓存 cookie，请粘贴';
  renderCookieState(!!(j && j.cached), j && j.cookieSavedAt);
  document.getElementById('syncFreshness').innerHTML =
    j && j.ok ? renderFreshness(j.files) : '⚠ 未检测到本地服务器：请先运行 npm start';
  document.getElementById('syncProgress').textContent = '';
  document.getElementById('syncErrors').innerHTML = '';
  // 缺数据的同步项红色高亮 + 「缺数据」徽标，引导用户勾选更新
  markMissing(
    j && j.ok
      ? [
          ['library', 'wiki'],
          ['characters', 'characters'],
          ['plans', 'plans'],
          ['workshop', 'workshop'],
        ]
          .filter(([file]) => j.files[file] == null)
          .map(([, key]) => key)
      : []
  );
  document.getElementById('syncModal').classList.add('show');
}

/** 缺失数据源对应的同步项高亮（先清旧标记再打新标） */
function markMissing(missingKeys) {
  document.querySelectorAll('.sync-opts label.sync-miss').forEach((l) => {
    l.classList.remove('sync-miss');
    l.querySelector('.sync-miss-badge')?.remove();
  });
  for (const key of missingKeys) {
    const label = document.querySelector(`.sync-chk[data-key="${key}"]`)?.closest('label');
    if (!label) continue;
    label.classList.add('sync-miss');
    const badge = document.createElement('span');
    badge.className = 'sync-miss-badge';
    badge.textContent = '缺数据';
    label.appendChild(badge);
  }
}
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
  if (j && j.ok) {
    notify('cookie 已保存');
    renderCookieState(true, Date.now()); // 状态行即时更新为「刚刚保存」
  } else notify('保存失败：' + ((j && j.error) || '无法连接本地服务器'), 10);
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

/** 绑定同步中心弹窗按钮（ui.js 的 initUi 调用；syncModal 的 Esc 关闭由 ui.js 的全局 keydown 兜底） */
export function initSync() {
  // GitHub Pages 静态版：无后端，「同步数据」按钮改为打开「我的角色·数据导入」弹窗
  if (isStatic()) {
    initStaticImport();
    return;
  }
  document.getElementById('syncBtn').addEventListener('click', openSyncCenter);
  document.getElementById('syncRun').addEventListener('click', runSelectedSyncs);
  document
    .getElementById('syncClose')
    .addEventListener('click', () => document.getElementById('syncModal').classList.remove('show'));
  document
    .getElementById('syncCopy')
    .addEventListener('click', () => copyText(document.getElementById('syncCookieSnippet').textContent, '脚本'));
  document.getElementById('syncCookieSave').addEventListener('click', saveCookie);
}

// ---------- GitHub Pages 静态版：数据导入 ----------
function initStaticImport() {
  const modal = document.getElementById('importModal');
  const open = () => {
    const el = document.getElementById('importInput');
    el.value = '';
    const n = myCharacters.length;
    document.getElementById('importState').textContent = n ? `当前已缓存 ${n} 个角色` : '尚未导入角色数据';
    modal.classList.add('show');
    el.focus();
  };
  document.getElementById('syncBtn').addEventListener('click', open);
  document
    .getElementById('importClose')
    .addEventListener('click', () => modal.classList.remove('show'));
  document.getElementById('importSave').addEventListener('click', async () => {
    try {
      const n = await importCharacters(document.getElementById('importInput').value.trim());
      modal.classList.remove('show');
      render();
      notify(`已导入 ${n} 个角色（保存在本浏览器 localStorage）`);
    } catch (e) {
      notify('导入失败：' + (e.message || '数据格式不正确') + '。请重新采集后粘贴', 8);
    }
  });
  document.getElementById('importClear').addEventListener('click', async () => {
    if (!myCharacters.length) return;
    if (!confirm('确定清空本浏览器缓存的我的角色？')) return;
    clearLocalChars();
    modal.classList.remove('show');
    render();
    notify('已清空我的角色');
  });
  // 手机端导入：电脑采集下载的 zzz-chars.json 文件（手机无法运行书签/控制台）
  const fileInput = document.getElementById('importFile');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try {
        const n = await importCharacters((await f.text()).trim());
        modal.classList.remove('show');
        render();
        notify(`已导入 ${n} 个角色（保存在本浏览器 localStorage）`);
      } catch (e) {
        notify('导入失败：' + (e.message || '文件格式不正确') + '。请确认是采集脚本导出的 JSON 文件', 8);
      }
    });
  }
  // 采集书签链接：注入 collect.js（部署 URL = 当前页面目录）
  const a = document.getElementById('importBookmarklet');
  if (a) {
    const base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
    a.href =
      "javascript:(function(){var s=document.createElement('script');s.src='" +
      base +
      "collect.js';document.body.appendChild(s)})()";
  }
}
