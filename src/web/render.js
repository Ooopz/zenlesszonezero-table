// src/web/render.js —— 渲染调度：全局悬浮提示 + 主视图分发
// 「我的角色」卡片/汇总渲染与拖拽排序在 myChars.js（2026-11 拆出）；数据库/统计/模拟视图各归 wiki.js/statsView.js/simulate.js。
import { grid, myCharacters, userConfig } from './data.js';
import { VIEWS, VIEW_VALUES } from '../lib/constants.js';
import { renderWiki, toggleWikiSort } from './wiki.js';
import { renderStatsView, toggleStatsSort, mountStatsCharts } from './statsView.js';
import { renderSimulate } from './simulate.js';
import { pruneDetachedCharts, mountCharts } from './charts.js';
import { myTab, myCharsShell, renderTable, characterCard, toggleTableSort, setMyCharsRerender } from './myChars.js';

// ---------- 悬浮提示 ----------
const tipEl = document.createElement('div');
tipEl.className = 'tip';
document.body.appendChild(tipEl);
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest ? e.target.closest('[data-detail]') : null;
  if (t) {
    tipEl.innerHTML = t.dataset.detail;
    tipEl.style.display = 'block';
  }
});
document.addEventListener('mousemove', (e) => {
  if (tipEl.style.display === 'none') return;
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 14,
    y = e.clientY + 14;
  if (x + r.width > innerWidth) x = e.clientX - r.width - 12;
  if (y + r.height > innerHeight) y = e.clientY - r.height - 12;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
});
document.addEventListener('mouseout', (e) => {
  const from = e.target.closest ? e.target.closest('[data-detail]') : null;
  const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-detail]') : null;
  if (from && from !== to) hideTip();
});
/** 强制隐藏悬浮框：render() 整块替换 innerHTML 时元素被直接移除，不再派发 mouseout，提示框会残留 */
export function hideTip() {
  tipEl.style.display = 'none';
}

// ---------- 表头点击排序（wiki/汇总/统计表格共用，经 data-sort 委托） ----------
grid.addEventListener('click', (e) => {
  const th = e.target.closest ? e.target.closest('th[data-sort]') : null;
  if (!th) return;
  const key = th.dataset.sort;
  if (th.closest('.wiki-table')) toggleWikiSort(key);
  else if (th.closest('table.tbl')) toggleTableSort(key);
  else if (th.closest('table.rec-table')) toggleStatsSort(key);
  else return;
  render();
});

/** 主视图解析：URL/配置中的 view 值；非法值（含已迁移的旧值）回退 mychars */
function resolveView() {
  const raw = new URLSearchParams(location.search).get('view') || userConfig.view || VIEWS.MY_CHARS;
  return { view: VIEW_VALUES.has(raw) ? raw : VIEWS.MY_CHARS };
}

// ---------- 渲染调度 ----------
export function render() {
  const { view } = resolveView();
  hideTip();
  document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  grid.innerHTML = '';
  // 统一回收旧图表容器：覆盖所有提前 return 的分支（切数据库/我的角色不走 mountCharts，只靠它清理会漏图）
  pruneDetachedCharts();
  if (view === VIEWS.WIKI) {
    grid.innerHTML = renderWiki();
    return;
  }
  if (view === VIEWS.STATS) {
    grid.innerHTML = renderStatsView();
    mountStatsCharts();
    return;
  }
  if (view === VIEWS.SIMULATE) {
    grid.innerHTML = renderSimulate();
    // 先让浏览器完成首帧绘制，再挂载图表，避免图表初始化阻塞面板加载。
    setTimeout(() => mountCharts(), 0);
    return;
  }
  // 我的角色：卡片 / 汇总 二级子页面
  if (!myCharacters.length) {
    grid.innerHTML = myCharsShell(
      '<div class="empty">还没有「我的角色」数据。<br>推荐：运行 <b>npm start</b> 后打开本页，点右上角 <b>更新我的角色</b> 一键拉取（需粘贴一次 cookie）。<br>或命令行运行 <b>npm run sync:characters</b>（效果相同）。</div>'
    );
    return;
  }
  const list = myCharacters;
  grid.innerHTML = myCharsShell();
  const body = grid.querySelector('.mychars-body');
  body.className = myTab === 'card' ? 'mychars-body cards' : 'mychars-body';
  if (myTab === 'table') renderTable(list, body);
  else
    list.forEach((character, i) => {
      const card = characterCard(character);
      // 入场动画的错开延迟由 CSS 的 calc(var(--i) * 40ms) 算出；封顶 12 避免长列表末尾等太久
      card.style.setProperty('--i', String(Math.min(i, 12)));
      body.appendChild(card);
    });
}

// 拖拽排序后的重渲染由 myChars.js 反向注入（myChars 不 import 本模块，避免循环依赖）
setMyCharsRerender(render);
