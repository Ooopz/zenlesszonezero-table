// src/web/discstats.js —— 独立视图「驱动盘统计」：按驱动盘聚合推荐方案的统计表
import { plans, library } from './data.js';
import { computeDiscStats } from '../lib/discstats.js';
import { escapeHtml } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { discSetEffectsHtml } from './shared.js';

// 排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js）
const sort = createSort();
export function toggleDiscStatsSort(key) {
  sort.toggle(key);
}

const HEADERS = ['驱动盘', '匹配角色', '方案数', '副词条', '4号位', '5号位', '6号位'];
const SORTABLE = new Set(['驱动盘', '匹配角色', '方案数']);
/** 各列排序取值：驱动盘按名，匹配角色/方案数按数量（越多越常用排越前） */
function sortVal(row, key) {
  if (key === '驱动盘') return row.name;
  if (key === '匹配角色') return row.characters.length;
  if (key === '方案数') return row.count;
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

/** 频次列表 → HTML：每词条一行（<br> 分隔，与角色列/原组合列的换行逻辑一致）。三档区分：
 *  ≥50% 加粗高亮（优先留）、<5% 灰色弱化（个别方案特化，优先级低）、中间档普通显示 */
function freqHtml(list) {
  if (!list?.length) return '—';
  return list
    .map((f) => {
      const cls = f.ratio >= 0.5 ? 'ds-hot' : f.ratio < 0.05 ? 'ds-dim' : '';
      return `<span${cls ? ` class="${cls}"` : ''}>${escapeHtml(f.name)} ${Math.round(f.ratio * 100)}%</span>`;
    })
    .join('<br>');
}

/** 渲染驱动盘推荐统计表（返回 HTML；空方案数据时返回提示） */
export function renderDiscStats() {
  if (!Object.keys(plans || {}).length) {
    return '<div class="empty">暂无推荐方案数据。<br>请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。</div>';
  }
  // 二件套同效果替代：把每个盘的结构化 set2 效果传给聚合层，2 件套推荐扩展到同效果组
  const discSet2 = Object.fromEntries(Object.values(library.discs || {}).map((d) => [d.name, d.set2]));
  const rows = sort.apply(computeDiscStats(plans, Object.keys(library.discs || {}), discSet2), sortVal);
  const head = HEADERS.map((h) => {
    if (!SORTABLE.has(h)) return `<th>${h}</th>`;
    const on = sort.key === h;
    return `<th data-sort="${h}"${on ? ' class="sorted"' : ''}>${h}${on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
  }).join('');
  const body = rows
    .map((r) => {
      // 副词条：主展示词条频次；悬浮显示原「组合明细」（每组合一行），保留搭配信息
      const comboTip = r.subCombos.length ? r.subCombos.map((c) => c.join('、')).join('<br>') : '';
      const subCell = r.subStats.length
        ? `<span class="ds-sub" data-detail="${escapeHtml(comboTip)}" title="悬浮查看副词条组合明细">${freqHtml(r.subStats)}</span>`
        : '—';
      const icon = library.discs?.[r.name]?.icon
        ? `<img class="wiki-ico ds-dico" src="${library.discs[r.name].icon}" alt="">`
        : '';
      return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(discTipHtml(r.name, r.alternatives))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(r.name)}</span>${icon}</td>
      <td class="ds-chars">${joinBr(r.characters)}</td>
      <td class="ds-count">${r.count || '—'}</td>
      <td class="ds-combos">${subCell}</td>
      <td class="ds-main">${freqHtml(r.main4)}</td>
      <td class="ds-main">${freqHtml(r.main5)}</td>
      <td class="ds-main">${freqHtml(r.main6)}</td>
    </tr>`;
    })
    .join('');
  // 列宽下限（自动布局 + 单元格 nowrap）：长内容按行内项定宽，单个词条频次保持单行
  const colgroup =
    '<colgroup><col style="width:110px"><col style="width:170px"><col style="width:70px"><col style="width:240px"><col style="width:120px"><col style="width:120px"><col style="width:120px"></colgroup>';
  return `<div class="discstats"><div class="wiki-wrap"><table class="discstats-table">${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}
