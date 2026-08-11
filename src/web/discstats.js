// src/web/discstats.js —— 独立视图「驱动盘统计」：按驱动盘聚合推荐方案的统计表
import { plans, library } from './data.js';
import { computeDiscStats } from '../lib/discstats.js';
import { escapeHtml, renderRichText, compareValues } from '../lib/util.js';

// 排序状态（三态：升序 → 降序 → 恢复默认），模式与 wiki/统计表一致
let sort = { key: null, dir: 1 };
export function toggleDiscStatsSort(key) {
  if (sort.key === key) {
    if (sort.dir === 1) sort.dir = -1;
    else sort = { key: null, dir: 1 };
  } else {
    sort = { key, dir: 1 };
  }
}

const HEADERS = ['驱动盘', '匹配角色', '副词条组合', '4号位', '5号位', '6号位'];
const SORTABLE = new Set(['驱动盘', '匹配角色', '副词条组合']);
/** 各列排序取值：驱动盘按名，其余按去重后数量（越常用排越前） */
function sortVal(row, key) {
  if (key === '驱动盘') return row.name;
  if (key === '匹配角色') return row.characters.length;
  if (key === '副词条组合') return row.subCombos.length;
  return null;
}
const isEmptyVal = (v) => v == null || v === '';
/** 列表 → HTML：每项独立一行（逐项 escapeHtml 后再拼 <br>，避免把 <br> 一起转义） */
const joinBr = (items) => (items?.length ? items.map((x) => escapeHtml(x)).join('<br>') : '—');

/** 悬浮详情：盘名 + 二/四件套效果（复用角色卡片驱动盘悬浮的构成方式） */
function discTipHtml(name) {
  const lib = library.discs?.[name];
  const set2 = lib?.set2Text
    ? `<br><span style="color:var(--green)">【2件套】${renderRichText(lib.set2Text)}</span>`
    : '';
  const set4 = lib?.set4Text
    ? `<br><span style="color:var(--orange)">【4件套】${renderRichText(lib.set4Text)}</span>`
    : '';
  return `<b>${escapeHtml(name)}</b>${set2}${set4}`;
}

/** 渲染驱动盘推荐统计表（返回 HTML；空方案数据时返回提示） */
export function renderDiscStats() {
  if (!Object.keys(plans || {}).length) {
    return '<div class="empty">暂无推荐方案数据。<br>请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。</div>';
  }
  const rows = computeDiscStats(plans, Object.keys(library.discs || {}));
  if (sort.key) {
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const va = sortVal(a, key),
        vb = sortVal(b, key);
      if (isEmptyVal(va) && isEmptyVal(vb)) return 0;
      if (isEmptyVal(va)) return 1;
      if (isEmptyVal(vb)) return -1;
      return compareValues(va, vb) * dir;
    });
  }
  const head = HEADERS.map((h) => {
    if (!SORTABLE.has(h)) return `<th>${h}</th>`;
    const on = sort.key === h;
    return `<th data-sort="${h}"${on ? ' class="sorted"' : ''}>${h}${on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
  }).join('');
  const body = rows
    .map((r) => {
      const combos = r.subCombos.length ? r.subCombos.map((c) => escapeHtml(c.join('、'))).join('<br>') : '—';
      const icon = library.discs?.[r.name]?.icon
        ? `<img class="wiki-ico ds-dico" src="${library.discs[r.name].icon}" alt="">`
        : '';
      return `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(discTipHtml(r.name))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(r.name)}</span>${icon}</td>
      <td class="ds-chars">${joinBr(r.characters)}</td>
      <td class="ds-combos">${combos}</td>
      <td class="ds-main">${joinBr(r.main4)}</td>
      <td class="ds-main">${joinBr(r.main5)}</td>
      <td class="ds-main">${joinBr(r.main6)}</td>
    </tr>`;
    })
    .join('');
  // 列宽下限（自动布局 + 单元格 nowrap）：长内容按行内项定宽，单个名字/组合/主属性保持单行
  const colgroup =
    '<colgroup><col style="width:110px"><col style="width:180px"><col style="width:260px"><col style="width:110px"><col style="width:110px"><col style="width:110px"></colgroup>';
  return `<div class="discstats"><div class="wiki-wrap"><table class="discstats-table">${colgroup}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}
