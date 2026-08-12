// src/web/discstats.js —— 「统计→驱动盘」面板渲染：按驱动盘聚合 方案推荐/全服使用/工坊真实 三口径
// 数据源：plans.json（方案推荐，lib/discstats.js 聚合）+ workshop-grad.json（全服使用，gradStats）+ workshop-stats.json discDetails（工坊真实穿戴：主/副词条、盘数）。
// 副词条与 456 主属性单元格内上下两行：上行=方案推荐、下行=工坊玩家真实；456 冷门主词条（候选里方案/工坊都没出现）灰色删除线标出。
import { plans, library, workshopGrad, workshopStats } from './data.js';
import { computeDiscStats } from '../lib/discstats.js';
import { computeGradStats } from '../lib/gradStats.js';
import { MAIN_STAT_OPTIONS } from '../lib/constants.js';
import { escapeHtml } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { discSetEffectsHtml } from './shared.js';

// 排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js）
const sort = createSort();
export function toggleDiscStatsSort(key) {
  sort.toggle(key);
}
/** 复位驱动盘面板排序（统计视图切换子面板时调用） */
export function resetDiscStatsSort() {
  sort.reset();
}

const HEADERS = ['驱动盘', '方案推荐', '全服使用', '工坊盘数', '匹配角色', '副词条', '4号位', '5号位', '6号位'];
const SORTABLE = new Set(['驱动盘', '方案推荐', '全服使用', '工坊盘数', '匹配角色']);
/** 各列排序取值：驱动盘按名，方案推荐/全服使用/工坊盘数/匹配角色按数量（越多越常用排越前） */
function sortVal(row, key) {
  if (key === '驱动盘') return row.name;
  if (key === '方案推荐') return row.count;
  if (key === '全服使用') return row.gradCount;
  if (key === '工坊盘数') return row.wsEquips;
  if (key === '匹配角色') return row.characters.length;
  return null;
}
/** 列表 → HTML：每项独立一行（逐项 escapeHtml 后再拼 <br>，避免把 <br> 一起转义） */
const joinBr = (items) => (items?.length ? items.map((x) => escapeHtml(x)).join('<br>') : '—');

/** 悬浮详情：盘名 + 二/四件套效果 + 同效果二件套替代盘（复用角色卡片驱动盘悬浮的构成方式，套件效果走 shared.discSetEffectsHtml） */
function discTipHtml(name, alternatives) {
  const alt = alternatives?.length
    ? `<br><span style="color:var(--dim)">同效果二件套：${alternatives.map((x) => escapeHtml(x)).join('、')}</span>`
    : '';
  return `<b>${escapeHtml(name)}</b>${discSetEffectsHtml(library.discs?.[name])}${alt}`;
}

/** 频次列表 → HTML：每词条一行（<br> 分隔）。三档区分：≥50% 加粗高亮（优先留）、<5% 灰色弱化（特化低优先级）、中间档普通显示 */
function freqHtml(list) {
  if (!list?.length) return '—';
  return list
    .map((f) => {
      const cls = f.ratio >= 0.5 ? 'ds-hot' : f.ratio < 0.05 ? 'ds-dim' : '';
      return `<span${cls ? ` class="${cls}"` : ''}>${escapeHtml(f.name)} ${Math.round(f.ratio * 100)}%</span>`;
    })
    .join('<br>');
}

/** 工坊真实频次列表 → HTML（下行；ratio 分母由调用方给：subs 用物理盘数、456 用该槽 2025 源盘数 mainDenom）。空 → null */
function freqWsHtml(list, total) {
  if (!list?.length) return null;
  return list
    .map((f) => {
      const ratio = total ? f.count / total : 0;
      const cls = ratio >= 0.5 ? 'ds-hot' : ratio < 0.05 ? 'ds-dim' : '';
      return `<span${cls ? ` class="${cls}"` : ''}>${escapeHtml(f.name)} ${Math.round(ratio * 100)}%</span>`;
    })
    .join('<br>');
}

/** 456 槽冷门主词条：MAIN_STAT_OPTIONS 候选里「方案没推荐过 且 工坊没出现过」的 → 灰色删除线。空 → '' */
function coldMainsHtml(slot, planMains, wsMains) {
  const used = new Set([...(planMains || []).map((f) => f.name), ...(wsMains || []).map((f) => f.name)]);
  const cold = (MAIN_STAT_OPTIONS[slot] || []).filter((n) => !used.has(n));
  if (!cold.length) return '';
  return `<span class="ds-cold">未用主词条：${cold.map((n) => `<del>${escapeHtml(n)}</del>`).join('、')}</span>`;
}

/** 456 单元格：上行=方案推荐 freq、下行=工坊真实 freq（.ds-wsline 分隔）+ 冷门主词条标灰 */
function mainCellHtml(planList, wsDetail, slot) {
  const wsLine = freqWsHtml(wsDetail?.main456?.[slot], wsDetail?.mainDenom?.[slot]);
  return `${freqHtml(planList)}${wsLine ? `<span class="ds-wsline">${wsLine}</span>` : ''}${coldMainsHtml(slot, planList, wsDetail?.main456?.[slot])}`;
}

/** 渲染驱动盘统计表（返回 HTML；空方案数据时返回提示） */
export function renderDiscStats() {
  if (!Object.keys(plans || {}).length) {
    return '<div class="empty">暂无推荐方案数据。<br>请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。</div>';
  }
  // 二件套同效果替代：把每个盘的结构化 set2 效果传给聚合层，2 件套推荐扩展到同效果组
  const discSet2 = Object.fromEntries(Object.values(library.discs || {}).map((d) => [d.name, d.set2]));
  // 全服真实使用（workshop-grad 按套装拆分累加），供「全服使用」对比列
  const grad = new Map(computeGradStats(workshopGrad.roles).discs.map((g) => [g.name, g]));
  // 工坊真实穿戴（workshop-stats.discDetails：每盘物理盘数/角色/主词条/副词条），供「工坊盘数」列与下行对比
  const discDetails = new Map((workshopStats.discDetails || []).map((d) => [d.name, d]));
  const totalWsDiscs = [...discDetails.values()].reduce((s, d) => s + d.equips, 0) || 1;
  const data = computeDiscStats(plans, Object.keys(library.discs || {}), discSet2).map((r) => {
    const g = grad.get(r.name);
    const d = discDetails.get(r.name);
    return { ...r, gradCount: g?.count ?? 0, gradRatio: g?.ratio ?? 0, wsEquips: d?.equips ?? 0, wsDetail: d ?? null };
  });
  const rows = sort.apply(data, sortVal);
  const head = HEADERS.map((h) => {
    if (!SORTABLE.has(h)) return `<th>${h}</th>`;
    const on = sort.key === h;
    return `<th data-sort="${h}"${on ? ' class="sorted"' : ''}>${h}${on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
  }).join('');
  const body = rows
    .map((r) => {
      // 副词条：上行=方案推荐频次（悬浮显示原「组合明细」保留搭配信息），下行=工坊真实频次
      const comboTip = r.subCombos.length ? r.subCombos.map((c) => c.join('、')).join('<br>') : '';
      const subCell = r.subStats.length
        ? `<span class="ds-sub" data-detail="${escapeHtml(comboTip)}" title="悬浮查看副词条组合明细">${freqHtml(r.subStats)}</span>`
        : '—';
      const wsSubLine = freqWsHtml(r.wsDetail?.subs, r.wsDetail?.equips);
      const icon = library.discs?.[r.name]?.icon
        ? `<img class="ws-ico" src="${library.discs[r.name].icon}" alt="">`
        : '';
      return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(discTipHtml(r.name, r.alternatives))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(r.name)}</span>${icon}</td>
      <td class="ds-count">${r.count || '—'}</td>
      <td class="ds-count">${r.gradCount ? `${r.gradCount}<span class="ds-ratio">${(r.gradRatio * 100).toFixed(1)}%</span>` : '—'}</td>
      <td class="ds-count">${r.wsEquips ? `${r.wsEquips}<span class="ds-ratio">${((r.wsEquips / totalWsDiscs) * 100).toFixed(1)}%</span>` : '—'}</td>
      <td class="ds-chars">${joinBr(r.characters)}</td>
      <td class="ds-combos">${subCell}${wsSubLine ? `<span class="ds-wsline">${wsSubLine}</span>` : ''}</td>
      <td class="ds-combos">${mainCellHtml(r.main4, r.wsDetail, 4)}</td>
      <td class="ds-combos">${mainCellHtml(r.main5, r.wsDetail, 5)}</td>
      <td class="ds-combos">${mainCellHtml(r.main6, r.wsDetail, 6)}</td>
    </tr>`;
    })
    .join('');
  // 列宽下限（自动布局 + 单元格 nowrap）：长内容按行内项定宽，单个词条频次保持单行
  const colgroup =
    '<colgroup><col style="width:110px"><col style="width:70px"><col style="width:80px"><col style="width:80px"><col style="width:170px"><col style="width:250px"><col style="width:140px"><col style="width:140px"><col style="width:140px"></colgroup>';
  return `<div class="discstats"><div class="wiki-wrap"><table class="discstats-table">${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}
