// src/web/discstats.js —— 「统计→驱动盘」面板：盘为中心的「决策卡」
// 使命：选一个驱动盘，回答 适配哪些角色 / 456 号位保留哪些主词条 / 副词条保留哪些组合 / 哪些主词条可抛弃。
// 两口径独立产出同一套维度，经 computeDiscAdvisor 对齐并判定：
//   keep  = 官方推荐 + 实况占比 ≥3%（共识 → 保留，绿）
//   split = 仅一方出现（官方推荐玩家不用 / 玩家在用官方没推 → 分歧，橙）
//   drop  = 两口径都未出现（仅 456 候选主词条 → 可抛弃，灰删除线）
// 对比条：金=官方推荐占比（方案数）、蓝=玩家实况占比（盘数/槽分母），数值显示在条右侧。
import { plans, library, workshopStats } from './data.js';
import { computeDiscStats, computeDiscAdvisor } from '../lib/discstats.js';
import { MAIN_STAT_OPTIONS } from '../lib/constants.js';
import { escapeHtml } from '../lib/util.js';
import { discSetEffectsHtml } from './shared.js';
import { registerChart, chartBox, discMain456Option, discSubsOption, discComboOption } from './charts.js';

let selectedDisc = '';
export function setSelectedDisc(name) {
  selectedDisc = name;
}
// 本面板无表格排序，保留导出兼容 render.js 的表头排序委托
export function resetDiscStatsSort() {}
export function toggleDiscStatsSort() {}

const pct = (v) => Math.round((v || 0) * 100);

/** 两口径对齐后的全盘决策卡（每次渲染重算：~65 盘 × 判定，开销可忽略） */
function allCards() {
  const discSet2 = Object.fromEntries(Object.values(library.discs || {}).map((d) => [d.name, d.set2]));
  const official = new Map(
    computeDiscStats(plans, Object.keys(library.discs || {}), discSet2).map((r) => [r.name, r])
  );
  const live = new Map((workshopStats.discDetails || []).map((d) => [d.name, d]));
  const cards = new Map();
  for (const name of Object.keys(library.discs || {})) {
    cards.set(name, computeDiscAdvisor(official.get(name) || null, live.get(name) || null, MAIN_STAT_OPTIONS));
  }
  return cards;
}

/** 盘下拉（所有盘，按玩家实况盘数降序；默认选中盘数最多者） */
function discSelectHtml(current, cards) {
  const opts = [...cards.entries()]
    .sort((a, b) => b[1].equips - a[1].equips)
    .map(
      ([name, card]) =>
        `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}${card.equips ? `（${card.equips.toLocaleString()} 盘）` : ''}</option>`
    )
    .join('');
  return `<div class="chart-select"><label>驱动盘</label><select onchange="ZZZ.selectDisc(this.value)">${opts}</select></div>`;
}

/** 对比条：词条名 + 判定标签 + 双条（金=官方、蓝=实况）+ 右侧数值（官方% / 实况%） */
function barHtml(name, official, live, verdict) {
  const tag =
    verdict === 'keep'
      ? '<span class="ad-tag ad-keep">保留</span>'
      : '<span class="ad-tag ad-drop">可抛弃</span>';
  const w = (v) => (v > 0 ? Math.max(3, pct(v)) : 0);
  const bar = (v, cls) =>
    `<div class="ad-bar-track">${v > 0 ? `<div class="ad-bar-fill ${cls}" style="width:${w(v)}%"></div>` : ''}</div>`;
  return `<div class="ad-bar">
    <div class="ad-bar-head"><span class="ad-bar-name">${escapeHtml(name)}</span>${tag}<span class="ad-bar-val">${pct(official)}% / ${pct(live)}%</span></div>
    ${bar(official, 'off')}
    ${bar(live, 'live')}
  </div>`;
}

/** ① 适配角色：两口径徽章行，both 优先 + 名称序排列（两行同一规则，位置尽量对齐） */
function rolesHtml(card) {
  const { official, live, both } = card.roles;
  const sortKey = (n) => (both.includes(n) ? 0 : 1) + n; // 交集在前，其余按名称
  const chip = (n) => `<span class="ad-chip${both.includes(n) ? ' both' : ''}">${escapeHtml(n)}</span>`;
  return `<div class="ad-sec">
    <h4>① 适配角色（金色 ★=两口径一致，最适配）</h4>
    <div class="ad-row"><span class="ad-row-label">官方推荐</span><span class="ad-chips">${[...official].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'zh')).map(chip).join('') || '—'}</span></div>
    <div class="ad-row"><span class="ad-row-label">玩家实况</span><span class="ad-chips">${[...live].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'zh')).map(chip).join('') || '—'}</span></div>
  </div>`;
}

/** ② 可抛弃主词条（两口径都未使用的 456 候选） */
function dropsHtml(card) {
  const drops = [4, 5, 6].flatMap((s) =>
    card.mains[s].filter((m) => m.verdict === 'drop').map((m) => `${s}号 ${m.name}`)
  );
  if (!drops.length) return '';
  return `<div class="ad-sec">
    <h4>② 可抛弃主词条（两口径都未使用）</h4>
    <div class="ad-drops">${drops.map((d) => `<del>${escapeHtml(d)}</del>`).join('　')}</div>
  </div>`;
}

/** ③ 456 号位 + 副词条：一行 4 列对比条（每列 = 槽位或副词条，数值在条右方） */
function statGridHtml(card) {
  const cols = [4, 5, 6]
    .map(
      (slot) => `<div class="ad-slot"><h4>${slot} 号位</h4>${card.mains[slot]
        .map((m) => barHtml(m.name, m.official, m.live, m.verdict))
        .join('')}</div>`
    )
    .join('');
  const subCol = `<div class="ad-slot"><h4>副词条</h4>${card.subs
    .map((s) => barHtml(s.name, s.official, s.live, s.verdict))
    .join('') || '—'}</div>`;
  return `<div class="ad-sec">
    <h4>③ 456 号位主词条 / 副词条保留清单（金=官方推荐 · 蓝=玩家实况 · 保留=任一口径≥3% · 可抛弃=两口径都<3%）</h4>
    <div class="ad-slotgrid">${cols}${subCol}</div>
  </div>`;
}

/** 底部图表卡片区：456 主词条占比 / 副词条出现频率 / 词条组合 Top（玩家实况） */
function chartCardsHtml(selectedDetail) {
  if (!selectedDetail) return '';
  const id = `disc-chart-${selectedDetail.name}`;
  registerChart(`${id}-main`, discMain456Option(selectedDetail));
  registerChart(`${id}-subs`, discSubsOption(selectedDetail.subs, selectedDetail.equips));
  registerChart(`${id}-combo`, discComboOption(selectedDetail.subCombos));
  return `<div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(selectedDetail.name)} · 工坊真实穿戴（${selectedDetail.equips.toLocaleString()} 块盘）</h3>
    <div class="chart-grid">
      <div class="chart-card"><h4>456 主词条占比（玩家实况）</h4>${chartBox(`${id}-main`, 260)}</div>
      <div class="chart-card"><h4>副词条出现频率（带此词条的盘占比）</h4>${chartBox(`${id}-subs`, 300)}</div>
      <div class="chart-card"><h4>词条组合 Top</h4>${chartBox(`${id}-combo`, 300)}</div>
    </div>
  </div>`;
}

/** 渲染驱动盘决策卡页面 */
export function renderDiscStats() {
  if (!Object.keys(plans || {}).length) {
    return '<div class="empty">暂无推荐方案数据。<br>请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。</div>';
  }
  const cards = allCards();
  if (!selectedDisc || !cards.has(selectedDisc)) {
    selectedDisc = [...cards.entries()].sort((a, b) => b[1].equips - a[1].equips)[0][0];
  }
  const card = cards.get(selectedDisc);
  const selectedDetail = (workshopStats.discDetails || []).find((d) => d.name === selectedDisc) || null;
  const alt = card.alternatives?.length
    ? `<div class="ad-sub">同效果二件套：${card.alternatives.map((x) => escapeHtml(x)).join('、')}</div>`
    : '';
  const discLib = library.discs?.[selectedDisc];
  const sets = discLib ? discSetEffectsHtml(discLib) : '';
  return `<div class="discstats">
    ${discSelectHtml(selectedDisc, cards)}
    <div class="ad-card">
      <h3>${escapeHtml(selectedDisc)} · 决策卡${card.equips ? `（玩家在用 ${card.equips.toLocaleString()} 块）` : ''}</h3>
      ${sets ? `<div class="ad-sub">${sets}</div>` : ''}
      ${alt}
      ${rolesHtml(card)}
      ${dropsHtml(card)}
      ${statGridHtml(card)}
    </div>
    <div class="chart-grid">${chartCardsHtml(selectedDetail)}</div>
  </div>`;
}
