// src/web/recommend.js —— 推荐视图：四个二级子面板（驱动盘 / 音擎 / 配队 / 角色数值）
// 全部只基于 data/plans.json + library.json 统计，不联动账号数据（characters.json）。
// 容器结构仿 wiki.js：TABS + PANEL_RENDERERS 键控分发 + 共享排序，驱动盘面板复用 discstats.js。
import { plans, library, workshopGrad, workshopStats } from './data.js';
import { computeWengineStats } from '../lib/wengineStats.js';
import { computeTeamStats } from '../lib/teamStats.js';
import { computePanelRanges } from '../lib/panelRange.js';
import { renderDiscStats, resetDiscStatsSort } from './discstats.js';
import { escapeHtml, renderRichText, formatValue, statEntries } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { panelOrder } from '../lib/calc.js';
import { STAT } from '../lib/constants.js';

export let recommendTab = 'discs';
export function setRecommendTab(key) {
  recommendTab = key;
  recSort.reset(); // 切子面板清空推荐页排序
  resetDiscStatsSort(); // 驱动盘面板排序也复位
}

// 排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js；三个新面板共用）
const recSort = createSort();
export function toggleRecommendSort(key) {
  recSort.toggle(key);
}

const TABS = [
  { key: 'discs', label: '驱动盘' },
  { key: 'wengines', label: '音擎' },
  { key: 'teams', label: '配队' },
  { key: 'panels', label: '角色数值' },
  { key: 'grad', label: '工坊配装' },
  { key: 'ws-wengine', label: '工坊音擎' },
  { key: 'ws-disc', label: '工坊驱动盘' },
  { key: 'ws-panel', label: '工坊数值' },
];
/** 子面板 key → 渲染函数（renderRecommend 键控分发，驱动盘复用 discstats） */
const PANEL_RENDERERS = {
  discs: renderDiscStats,
  wengines: renderWengineStats,
  teams: renderTeamStats,
  panels: renderPanelRanges,
  grad: renderWorkshopGrad,
  'ws-wengine': renderWorkshopWengine,
  'ws-disc': renderWorkshopDisc,
  'ws-panel': renderWorkshopPanel,
};

/** 空方案数据提示（各面板共用） */
function emptyPlans() {
  return '<div class="empty">暂无推荐方案数据。<br>请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。</div>';
}
/** 列表 → HTML：每项独立一行（逐项 escapeHtml 后再拼 <br>，避免把 <br> 一起转义） */
const joinBr = (items) => (items?.length ? items.map((x) => escapeHtml(x)).join('<br>') : '—');
/** 渲染可排序表格（rec-table；新面板共用骨架，行内容列复用 .ds-chars/.ds-count 等类） */
function table(headers, rows, sortable = new Set(), className = '') {
  const head = headers
    .map((h) => {
      if (!sortable.has(h)) return `<th>${h}</th>`;
      const on = recSort.key === h;
      return `<th data-sort="${h}"${on ? ' class="sorted"' : ''}>${h}${on ? (recSort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
    .join('');
  return `<div class="wiki-wrap"><table class="rec-table${className ? ' ' + className : ''}"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------- 音擎统计 ----------
const WENGINE_HEADERS = ['音擎', '推荐次数', '主推荐', '备推荐', '推荐角色'];
const WENGINE_SORTABLE = new Set(['音擎', '推荐次数', '主推荐', '备推荐']);
function wengineVal(w, key) {
  if (key === '音擎') return w.name;
  if (key === '推荐次数') return w.count;
  if (key === '主推荐') return w.mainCount;
  if (key === '备推荐') return w.backupCount;
  return null;
}
/** 音擎悬浮：稀有度/特性/基础攻击/副属性/特效 */
function wengineTipHtml(name) {
  const w = Object.values(library.wengines || {}).find((x) => x.name === name);
  const sub = w?.subStats?.length
    ? statEntries(w.subStats)
        .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
        .join('、')
    : '';
  return (
    `<b>${escapeHtml(name)}</b>` +
    (w
      ? `<br>${[w.rarity, w.trait].filter(Boolean).join(' · ')}${w.baseAtk != null ? ` · 基础攻击 ${formatValue(STAT.ATK, w.baseAtk)}` : ''}`
      : '') +
    (sub ? `<br>${sub}` : '') +
    (w?.specialEffect ? `<br><span style="color:var(--dim)">${renderRichText(w.specialEffect)}</span>` : '')
  );
}
function renderWengineStats() {
  if (!Object.keys(plans || {}).length) return emptyPlans();
  const names = Object.values(library.wengines || {}).map((w) => w.name);
  const rows = recSort.apply(computeWengineStats(plans, names), wengineVal).map((w) => {
    const icon = library.wengines?.[w.name]?.icon
      ? `<img class="wiki-ico ds-dico" src="${library.wengines[w.name].icon}" alt="">`
      : '';
    return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(wengineTipHtml(w.name))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(w.name)}</span>${icon}</td>
      <td class="ds-count">${w.count || '—'}</td>
      <td class="ds-count">${w.mainCount || '—'}</td>
      <td class="ds-count">${w.backupCount || '—'}</td>
      <td class="ds-chars">${joinBr(w.characters)}</td>
    </tr>`;
  });
  return `<div class="discstats">${table(WENGINE_HEADERS, rows, WENGINE_SORTABLE)}</div>`;
}

// ---------- 配队统计 ----------
const TEAM_HEADERS = ['角色', '作为队友被引用', '引用角色数', '自身方案数', '引用角色'];
const TEAM_SORTABLE = new Set(['角色', '作为队友被引用', '引用角色数', '自身方案数']);
function teamVal(t, key) {
  if (key === '角色') return t.name;
  if (key === '作为队友被引用') return t.mateCount;
  if (key === '引用角色数') return t.characters.length;
  if (key === '自身方案数') return t.selfCount;
  return null;
}
/** 角色悬浮：方案数 + 稀有度/元素/特性/阵营 */
function charTipHtml(name, planCount) {
  const c = Object.values(library.characters || {}).find((x) => x.name === name);
  return (
    `<b>${escapeHtml(name)}</b>` +
    (planCount != null ? `<br><span style="color:var(--dim)">${planCount} 个方案</span>` : '') +
    (c ? `<br>${[c.rarity, c.element, c.trait, c.faction].filter(Boolean).join(' · ')}` : '')
  );
}
function renderTeamStats() {
  if (!Object.keys(plans || {}).length) return emptyPlans();
  const names = Object.values(library.characters || {}).map((c) => c.name);
  // 默认按「作为队友被引用」降序（未点击表头时也显示最常被组队的在前）
  const data = [...computeTeamStats(plans, names)].sort((a, b) => b.mateCount - a.mateCount);
  const rows = recSort.apply(data, teamVal).map(
    (t) => `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(charTipHtml(t.name, t.selfCount))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(t.name)}</span></td>
      <td class="ds-count">${t.mateCount || '—'}</td>
      <td class="ds-count">${t.characters.length || '—'}</td>
      <td class="ds-count">${t.selfCount || '—'}</td>
      <td class="ds-chars">${joinBr(t.characters)}</td>
    </tr>`
  );
  return `<div class="discstats">${table(TEAM_HEADERS, rows, TEAM_SORTABLE)}</div>`;
}

// ---------- 角色数值推荐区间 ----------
function renderPanelRanges() {
  if (!Object.keys(plans || {}).length) return emptyPlans();
  const data = computePanelRanges(plans);
  // 属性列 = 数据中出现过的属性，按 calc.panelOrder 顺序（未覆盖的追加到末尾）
  const seen = new Set();
  for (const r of data) for (const k of Object.keys(r.stats)) seen.add(k);
  const cols = [...panelOrder.filter((s) => seen.has(s)), ...[...seen].filter((s) => !panelOrder.includes(s))];
  const PANEL_SORTABLE = new Set(['角色', '方案数']);
  const panelVal = (r, key) => {
    if (key === '角色') return r.name;
    if (key === '方案数') return r.planCount;
    return null;
  };
  const rows = recSort.apply(data, panelVal).map((r) => {
    const cells = cols
      .map((s) => {
        const v = r.stats[s];
        if (!v) return '<td class="ds-main">—</td>';
        const cell = [v.low, v.mid, v.high].map((x) => formatValue(s, x)).join(' / ');
        return `<td class="ds-main" title="低配 / 毕业 / 高配">${cell}</td>`;
      })
      .join('');
    return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(charTipHtml(r.name, r.planCount))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(r.name)}</span></td>
      <td class="ds-count">${r.planCount || '—'}</td>
      ${cells}
    </tr>`;
  });
  return `<div class="discstats">${table(['角色', '方案数', ...cols], rows, PANEL_SORTABLE)}</div>`;
}

// ---------- 工坊配装统计（全服每角色最常用音擎 / 驱动盘套装） ----------
/** 占比进度条：percent 为百分数（如 76.8），样式对齐卡片视图达成率（.rpct 文字 + .tbar/.tfill）。
 *  颜色阈值：≥20% 绿、<20% 红（无黄色档）。 */
function gradPct(percent) {
  const pct = percent || 0;
  const color = pct >= 20 ? 'var(--green)' : 'var(--red)';
  return `<span class="rpct">${pct}%</span><span class="tbar"><span class="tfill" style="width:${Math.min(100, pct)}%;background:${color}"></span></span>`;
}
/** 音擎悬浮：查 library.wengines 取稀有度/特性/副属性/特效 */
function wengineTip(name) {
  const w = library.wengines?.[name];
  const sub = w?.subStats?.length
    ? statEntries(w.subStats)
        .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
        .join('、')
    : '';
  return (
    `<b>${escapeHtml(name)}</b>` +
    (w
      ? `<br>${[w.rarity, w.trait].filter(Boolean).join(' · ')}${w.baseAtk != null ? ` · 基础攻击 ${formatValue(STAT.ATK, w.baseAtk)}` : ''}`
      : '') +
    (sub ? `<br>${sub}` : '') +
    (w?.specialEffect ? `<br><span style="color:var(--dim)">${renderRichText(w.specialEffect)}</span>` : '')
  );
}
/** 驱动盘组合悬浮：各套装二/四件套效果（查 library.discs） */
function relicTip(sets) {
  return (sets || [])
    .map((s) => {
      const d = library.discs?.[s.name];
      return (
        `<b>${escapeHtml(s.name)}${s.num}件</b>` +
        (d?.set2Text ? `<br><span style="color:var(--green)">【2件套】${d.set2Text}</span>` : '') +
        (d?.set4Text ? `<br><span style="color:var(--orange)">【4件套】${d.set4Text}</span>` : '')
      );
    })
    .join('<div class="tip-hr"></div>');
}
function renderWorkshopGrad() {
  const data = workshopGrad.roles || [];
  if (!data.length) {
    return '<div class="empty">暂无工坊配装统计。<br><button class="mini" onclick="ZZZ.syncWorkshop()">更新工坊配装</button>（或运行 <b>node src/sync/workshop.js</b>）</div>';
  }
  const gradVal = (r, key) => (key === '角色' ? r.name : null);
  const rows = recSort.apply(data, gradVal).map((r) => {
    // 音擎：图标 + 名称 + 进度条（悬浮看音擎详情）；驱动盘组合：各套装图标并排 + 组合名 + 进度条（悬浮看套装效果）
    const weapons = (r.weapons || [])
      .map(
        (w) =>
          `<span class="ws-item" data-detail="${escapeHtml(wengineTip(w.name))}" title="悬浮查看音擎详情">${w.icon ? `<img class="ws-ico" src="${w.icon}" alt="">` : ''}<span>${escapeHtml(w.name)}</span>${gradPct(w.percent)}</span>`
      )
      .join('<br>');
    const relics = (r.relics || [])
      .map(
        (x) =>
          `<span class="ws-item" data-detail="${escapeHtml(relicTip(x.sets))}" title="悬浮查看套装效果"><span class="ws-sets">${(
            x.sets || []
          )
            .map((s) => (s.icon ? `<img class="ws-ico" src="${s.icon}" alt="">` : ''))
            .join('')}</span><span>${escapeHtml(x.name)}</span>${gradPct(x.percent)}</span>`
      )
      .join('<br>');
    return `<tr>
      <td class="wiki-name" title="${escapeHtml(r.name)}">${r.icon ? `<img class="ws-ico grad-role" src="${r.icon}" alt="">` : ''}<span class="ds-dname">${escapeHtml(r.name)}</span></td>
      <td class="ds-main">${weapons || '—'}</td>
      <td class="ds-main">${relics || '—'}</td>
    </tr>`;
  });
  return `<div class="discstats">${table(['角色', '常用音擎', '常用驱动盘套装'], rows, new Set(['角色']), 'grad-table')}</div>`;
}

// ---------- 工坊汇总：音擎 / 驱动盘 / 数值（基于 workshop.json，见 lib/workshopStats.js） ----------
/** 工坊 item_id → 角色名 映射（工坊配装数据里有；缺失时回退显示 id） */
const wsRoleNames = () => new Map((workshopGrad.roles || []).map((r) => [String(r.item_id), r.name]));
const wsRoleName = (id) => wsRoleNames().get(String(id)) || String(id);

/** 工坊音擎推荐：按配装条目数聚合 */
function renderWorkshopWengine() {
  const data = workshopStats.wengines || [];
  if (!data.length) {
    return '<div class="empty">暂无工坊音擎推荐。<br>运行 <b>node src/sync/workshop-stats.js</b> 生成后刷新查看。</div>';
  }
  const val = (w, key) => (key === '音擎' ? w.name : key === '使用配装数' ? w.count : null);
  const rows = recSort.apply(data, val).map((w) => {
    const icon = library.wengines?.[w.name]?.icon
      ? `<img class="ws-ico" src="${library.wengines[w.name].icon}" alt="">`
      : '';
    return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(wengineTip(w.name))}" title="悬浮查看音擎详情"><span class="ds-dname">${escapeHtml(w.name)}</span>${icon}</td>
      <td class="ds-count">${w.count || '—'}</td>
      <td class="ds-chars">${joinBr((w.characters || []).map(wsRoleName))}</td>
    </tr>`;
  });
  return `<div class="discstats">${table(['音擎', '使用配装数', '推荐角色'], rows, new Set(['音擎', '使用配装数']), 'grad-table')}</div>`;
}

/** 工坊驱动盘推荐：按配装条目数聚合（同配装同套装只计一次） */
function renderWorkshopDisc() {
  const data = workshopStats.discs || [];
  if (!data.length) {
    return '<div class="empty">暂无工坊驱动盘推荐。<br>运行 <b>node src/sync/workshop-stats.js</b> 生成后刷新查看。</div>';
  }
  const val = (d, key) => (key === '驱动盘' ? d.name : key === '使用配装数' ? d.count : null);
  const rows = recSort.apply(data, val).map((d) => {
    const libD = library.discs?.[d.name];
    const icon = libD?.icon ? `<img class="ws-ico" src="${libD.icon}" alt="">` : '';
    return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(relicTip(d.name ? [{ name: d.name }] : []))}" title="悬浮查看套装效果"><span class="ds-dname">${escapeHtml(d.name)}</span>${icon}</td>
      <td class="ds-count">${d.count || '—'}</td>
      <td class="ds-chars">${joinBr((d.characters || []).map(wsRoleName))}</td>
    </tr>`;
  });
  return `<div class="discstats">${table(['驱动盘', '使用配装数', '推荐角色'], rows, new Set(['驱动盘', '使用配装数']), 'grad-table')}</div>`;
}

/** 工坊数值推荐：角色面板 P25/P50/P75 分位 */
function renderWorkshopPanel() {
  const data = workshopStats.panels || [];
  if (!data.length) {
    return '<div class="empty">暂无工坊数值推荐。<br>运行 <b>node src/sync/workshop-stats.js</b> 生成后刷新查看。</div>';
  }
  // 属性列 = 数据中出现过的属性，按 panelOrder 顺序
  const seen = new Set();
  for (const p of data) for (const k of Object.keys(p.stats)) seen.add(k);
  const cols = [...panelOrder.filter((s) => seen.has(s)), ...[...seen].filter((s) => !panelOrder.includes(s))];
  const names = wsRoleNames();
  const val = (p, key) => (key === '角色' ? wsRoleName(p.name) : null);
  const rows = recSort.apply(data, val).map((p) => {
    const roleName = names.get(String(p.name)) || String(p.name);
    const libC = Object.values(library.characters || {}).find((c) => c.name === roleName);
    const roleIcon = libC?.portrait || libC?.icon || '';
    const cells = cols
      .map((s) => {
        const q = p.stats[s];
        if (!q) return '<td class="ds-main">—</td>';
        return `<td class="ds-main" title="P25 / P50 / P75">${q.map((v) => formatValue(s, v)).join(' / ')}</td>`;
      })
      .join('');
    return `<tr>
      <td class="wiki-name" title="${escapeHtml(roleName)}">${roleIcon ? `<img class="ws-ico grad-role" src="${roleIcon}" alt="">` : ''}<span class="ds-dname">${escapeHtml(roleName)}</span></td>
      ${cells}
    </tr>`;
  });
  return `<div class="discstats">${table(['角色', ...cols], rows, new Set(['角色']), 'grad-table')}</div>`;
}

/** 渲染整个推荐视图（tab + 当前子面板） */
export function renderRecommend() {
  const tabs = TABS.map(
    (t) =>
      `<button class="wiki-tab ${t.key === recommendTab ? 'on' : ''}" data-tab="${t.key}" onclick="ZZZ.recommendTab('${t.key}')">${t.label}</button>`
  ).join('');
  const body = PANEL_RENDERERS[recommendTab] ? PANEL_RENDERERS[recommendTab]() : '';
  return `<div class="wiki"><div class="wiki-tabs">${tabs}</div>${body}</div>`;
}
