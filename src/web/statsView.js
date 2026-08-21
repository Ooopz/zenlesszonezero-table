// src/web/statsView.js —— 统计视图：三个二级子面板（角色面板 / 驱动盘 / 全服总览）
// 数据源：plans.json + workshop-grad.json + workshop-stats.json + characters.json；样本对标为高练度标杆池（不当作全服分布）。
// 容器结构仿 wiki.js：TABS + PANEL_RENDERERS 键控分发 + 共享排序。
import { plans, library, workshopGrad, workshopStats, myCharacters, charIndex, wengineIndex, statsMissingData, roleOptionsHtml } from './data.js';
import { computeRecTierStats } from '../lib/panelBench.js';
import { CHAR_ALIASES } from '../lib/names.js';
import { computeRoleBuildsFromPlans, orderComboSets4First } from '../lib/plansStats.js';
import { styleMatch } from '../lib/workshopAgg.js';
import { renderDiscStats } from './discstats.js';
import { tableHtml } from './shared.js';
import {
  escapeHtml,
  renderRichText,
  formatValue,
  statEntries,
  romanNumeralUnicode,
} from '../lib/util.js';
import { resolveEntry, canonicalName, CATEGORY } from '../lib/names.js';
import { createSort } from '../lib/sort.js';
import { STAT, SUBSTAT_TYPE_SET, SKILL_TYPES, OFFICIAL_SKILL_TYPE } from '../lib/constants.js';
import {
  clearCharts,
  mountCharts,
  registerChart,
  chartBox,
  consensusGridOption,
  violinBoxOption,
  densityScatterOption,
  rankPyramidOption,
  relicBarOption,
  skillDistOption,
  tierRichOption,
  scoreRelicOption,
  roleOwnershipOption,
  attainmentOption,
  slotEfficiencyOption,
} from './charts.js';
export let statsTab = 'detail';
export function setStatsTab(key) {
  statsTab = key;
  statsSort.reset(); // 切子面板清空统计视图排序
}

// 排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js；各面板共用）
const statsSort = createSort();
export function toggleStatsSort(key) {
  statsSort.toggle(key);
}

const TABS = [
  { key: 'detail', label: '角色面板' },
  { key: 'discs', label: '驱动盘' },
  { key: 'overview', label: '全服总览' },
];
/** 子面板 key → 渲染函数（renderStatsView 键控分发，驱动盘复用 discstats） */
const PANEL_RENDERERS = {
  detail: renderRoleDetail,
  discs: renderDiscStats,
  overview: renderOverview,
};

/** 统一空态：msg 为说明、hint 为操作提示/按钮（可选） */
function emptyState(msg, hint = '') {
  return `<div class="empty">${msg}${hint ? `<br>${hint}` : ''}</div>`;
}
/** 统计视图数据就绪检查：按缺失数据源给对应同步指引（plans / workshop 分开提示）。
 *  缺 plans → 推荐方案；缺 workshop 聚合（panels 为空）→ 工坊数据（数小时）。有数据返回 null。 */
function statsNotReady() {
  const miss = statsMissingData();
  if (!miss.length) return null;
  const hint =
    miss.length === 2
      ? '请在右上角 <b>同步数据 → 更新推荐方案</b>，以及 <b>更新工坊数据</b>（全量爬取，耗时数小时）后刷新查看。'
      : miss[0] === '推荐方案'
        ? '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。'
        : '请在右上角 <b>同步数据 → 更新工坊数据</b>（全量爬取，耗时数小时）后刷新查看。';
  return emptyState(`暂无${miss.join('、')}数据。`, hint);
}
/** 供 discstats.js 复用（驱动盘子面板同款空态） */
export { statsNotReady };
/** 渲染可排序表格（rec-table 骨架；内容列复用 .ds-main/.ds-dim/.ds-rolecnt 等类） */
const table = (headers, rows, sortable, className = '') =>
  tableHtml(headers, rows, sortable, { cls: 'rec-table', sort: statsSort, className });
/** 音擎悬浮：稀有度/特性/基础攻击/副属性/特效（键查 library.wengines，key 即音擎名） */
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
/** 查 library.wengines 音擎：统一 resolver（精确/别名/normalizeRomanKey，如 残响-II型→「残响」-Ⅱ型） */
function findLibraryWengine(name) {
  return resolveEntry(CATEGORY.WENGINE, wengineIndex, name);
}
/** 占比进度条：percent 为百分数（如 45.8），样式对齐卡片视图达成率（.rpct 文字 + .tbar/.tfill）。
 *  颜色阈值：≥50 绿、≥20 黄、<20 红。 */
function gradPct(percent) {
  const pct = percent || 0;
  const color = pct >= 50 ? 'var(--green)' : pct >= 20 ? 'var(--orange)' : 'var(--red)';
  return `<span class="rpct">${pct.toFixed(1)}%</span><span class="tbar"><span class="tfill" style="width:${Math.min(100, pct)}%;background:${color}"></span></span>`;
}
/** 驱动盘组合悬浮：各套装二/四件套效果（查 library.discs，4 件套在前、2 件套在后） */
function relicTip(sets) {
  return (sets || [])
    .map((s) => {
      const d = library.discs?.[s.name];
      return (
        `<b>${escapeHtml(s.name)}${s.num != null ? s.num + '件' : ''}</b>` +
        (d?.set4Text ? `<br><span style="color:var(--orange)">【4件套】${d.set4Text}</span>` : '') +
        (d?.set2Text ? `<br><span style="color:var(--green)">【2件套】${d.set2Text}</span>` : '')
      );
    })
    .join('<div class="tip-hr"></div>');
}

// ---------- grad 数据缓存（workshopGrad.roles 引用变化时惰性重建） ----------
let _roleIdRoles = null;
let _roleIdCache = null;
let _roleIdByName = null;
/** grad item_id → 角色名（供 workshop-stats 的 role_id 映射） */
function wsRoleIdMap() {
  const roles = workshopGrad.roles;
  if (_roleIdRoles !== roles) {
    _roleIdRoles = roles;
    _roleIdCache = new Map((roles || []).map((r) => [String(r.item_id), r.name]));
    _roleIdByName = new Map((roles || []).map((r) => [r.name, String(r.item_id)]));
  }
  return _roleIdCache;
}
let _wsPanelRoles = null;
let _wsPanelCache = null;
/** 角色名 → role_id（workshop-stats 的 panels/panelScatter 按 role_id 键；grad name→id 缓存反查） */
function roleIdFor(name) {
  if (!_roleIdByName) wsRoleIdMap();
  return _roleIdByName?.get(name) ?? null;
}
/** 推荐三档统计（plans → 每角色每属性 low/mid/high 的 mean/median/sd/cv），按 plans 引用缓存。
 *  实测 ~51ms/次而每次切角色都重渲染（两面板各调一次，等于每次交互白烧 ~100ms）。 */
let _tierPlans = null;
let _tierCache = null;
function recTierStats() {
  if (_tierPlans !== plans) {
    _tierPlans = plans;
    _tierCache = computeRecTierStats(plans);
  }
  return _tierCache;
}

/** grad/工坊名 → plans 标准角色名（resolver 优先；落空 CHAR_ALIASES + plans 子串）。
 *  按名字缓存：建表循环逐角色调用（57 角色 × 8 个源），每次调用都重建 planNames 并做子串扫描。 */
let _alignPlans = null;
let _alignCache = new Map();
function alignRoleName(name) {
  if (_alignPlans !== plans) {
    _alignPlans = plans;
    _alignCache = new Map();
  }
  const cached = _alignCache.get(name);
  if (cached !== undefined) return cached;
  const planNames = Object.values(plans).map((v) => v.name);
  const n = canonicalName(CATEGORY.CHAR, charIndex, name);
  let out;
  if (n) {
    out = n;
  } else {
    const a = CHAR_ALIASES[name] || name;
    out = planNames.includes(a) ? a : planNames.find((p) => p.includes(a) || a.includes(p)) || a;
  }
  _alignCache.set(name, out);
  return out;
}
/** 角色名 → 玩家真实样本面板统计（workshop-stats.panels）；key 对齐 plans 角色名（grad 名可能为简称/缇提差异） */
function wsPanelMap() {
  const panels = workshopStats.panels;
  if (_wsPanelRoles !== panels) {
    _wsPanelRoles = panels;
    const idToName = wsRoleIdMap();
    _wsPanelCache = new Map();
    for (const p of panels || []) {
      const gradName = idToName.get(String(p.name));
      if (gradName && p.stats) _wsPanelCache.set(alignRoleName(gradName), p.stats);
    }
  }
  return _wsPanelCache;
}
/** 通用缓存：role_id 键的 stats 对象（relicStats/rankDist/skillStats 等）→ 角色名键 Map。
 *  用 WeakMap 按源对象缓存而非单槽：多个源的调用方会轮流打穿单槽（命中率 0），WeakMap 各源各自命中且旧表可回收。 */
const _roleKeyedCache = new WeakMap();
function roleKeyedMap(source) {
  if (!source || typeof source !== 'object') return new Map();
  const hit = _roleKeyedCache.get(source);
  if (hit) return hit;
  const idToName = wsRoleIdMap();
  const m = new Map();
  for (const [rid, v] of Object.entries(source)) {
    const gradName = idToName.get(String(rid));
    if (gradName) m.set(alignRoleName(gradName), v);
  }
  _roleKeyedCache.set(source, m);
  return m;
}

// ---------- 工坊配装（全服真实：每角色 Top 音擎 / 套装组合及占比） ----------
/** 套装组合文本顺序统一：4 件套在前、2 件套在后（工坊/方案两源一致；'其他' 等空组合原样返回） */
const normCombo = (x) => {
  if (!x?.sets || !x.sets.length) return x;
  return { ...x, ...orderComboSets4First(x.sets) };
};
/** 角色配装对标（单角色）：工坊实况 vs 方案推荐的音擎/套装对比（角色面板内卡片） */
function gradBenchHtml(name) {
  const data = workshopGrad.roles || [];
  if (!data.length) return '';
  const planBuilds = computeRoleBuildsFromPlans(plans); // 方案推荐侧（结构与工坊 grad 一致）
  const r = data.find((x) => x.name === name) || data.find((x) => alignRoleName(x.name) === name);
  if (!r) return '';
  const pb = planBuilds[r.name] || { wengines: [], relics: [] };
  // 套装组合顺序统一（4 件套在前）：工坊 grad 的 set_info 顺序不固定，两列渲染时各归一一次保证文本/对比一致
  const normRelics = (r.relics || []).map(normCombo);
  const normPlanRelics = (pb.relics || []).map(normCombo);
  const weapons = (r.weapons || [])
    .map((w) => {
      const libW = findLibraryWengine(w.name); // 工坊源音擎名解析为 wiki 规范名（ASCII 罗马数字/括号差异）
      const wname = libW?.name || romanNumeralUnicode(w.name);
      const icon = libW?.icon || w.icon;
      return `<span class="ws-item" data-detail="${escapeHtml(wengineTip(wname))}">${icon ? `<img class="ws-ico" src="${icon}" data-fallback="${libW?.iconUrl || ''}" alt="">` : ''}<span>${escapeHtml(wname)}</span>${gradPct(w.percent)}</span>`;
    })
    .join('<br>');
  const relics = normRelics
    .map(
      (x) =>
        `<span class="ws-item" data-detail="${escapeHtml(relicTip(x.sets))}"><span class="ws-sets">${(
          x.sets || []
        )
          .map((s) => (s.icon ? `<img class="ws-ico" src="${s.icon}" data-fallback="${library.discs?.[s.name]?.icon || ''}" alt="">` : ''))
          .join('')}</span><span>${escapeHtml(x.name)}</span>${gradPct(x.percent)}</span>`
    )
    .join('<br>');
  // 方案推荐侧音擎 / 套装（Top3 + 占比）
  const planWeapons = pb.wengines
    .map(
      (w) =>
        `<span class="ws-item">${library.wengines?.[w.name]?.icon ? `<img class="ws-ico" src="${library.wengines[w.name].icon}" data-fallback="${library.wengines[w.name].iconUrl || ''}" alt="">` : ''}<span>${escapeHtml(w.name)}</span>${gradPct(w.percent)}</span>`
    )
    .join('<br>');
  const planRelics = normPlanRelics
    .map(
      (x) =>
        `<span class="ws-item" data-detail="${escapeHtml(relicTip(x.sets))}"><span class="ws-sets">${(x.sets || []).map((s) => (library.discs?.[s.name]?.icon ? `<img class="ws-ico" src="${library.discs[s.name].icon}" data-fallback="${library.discs[s.name].iconUrl || ''}" alt="">` : '')).join('')}</span><span>${escapeHtml(x.name)}</span>${gradPct(x.percent)}</span>`
    )
    .join('<br>');
  // 差异分析：方案 Top1 vs 实况 Top1（工坊跳过「其他」，名字解析为 wiki 规范名再比较）
  const gradW1 = (r.weapons || [])
    .map((w) => findLibraryWengine(w.name)?.name || romanNumeralUnicode(w.name))
    .find((n) => n !== '其他');
  const gradR1 = normRelics.find((x) => x.name !== '其他')?.name;
  const planW1 = pb.wengines?.[0]?.name;
  const planR1 = normPlanRelics[0]?.name;
  const diffCell = (plan1, grad1) => {
    if (!plan1 || !grad1) return '—';
    if (plan1 === grad1) return '<span class="ds-same">✓ 一致</span>';
    return `<span class="ds-diff">✗ 方案 ${escapeHtml(plan1)} / 实况 ${escapeHtml(grad1)}</span>`;
  };
  const diffW = diffCell(planW1, gradW1);
  const diffR = diffCell(planR1, gradR1);
  // 主表 4 列（音擎×2 + 套装×2）；差异列改为底部一行，音擎/套装差异各占两列宽（colspan=2）
  return table(
    ['常用音擎(工坊)', '常用音擎(方案)', '常用套装(工坊)', '常用套装(方案)'],
    [
      `<tr><td class="ds-main">${weapons || '—'}</td><td class="ds-main">${planWeapons || '—'}</td><td class="ds-main">${relics || '—'}</td><td class="ds-main">${planRelics || '—'}</td></tr>`,
      `<tr><td class="ds-diff-row" colspan="2"><b>音擎差异</b>　${diffW}</td><td class="ds-diff-row" colspan="2"><b>套装差异</b>　${diffR}</td></tr>`,
    ],
    new Set(),
    'grad-table'
  );
}

// ---------- 全服总览辅助（近似百分位 / 直方图达标率 / 槽位短板 / 样本口径 / 集中度） ----------
/** 我的值在玩家分布中的近似百分位（分位插值，处理零宽区间/零分位避免 NaN；无分布返回 null） */
function approxPercentile(v, dist) {
  if (v == null || !dist || dist.p10 == null || dist.p99 == null) return null;
  const pts = [
    [dist.p10, 10],
    [dist.p25, 25],
    [dist.p50, 50],
    [dist.p75, 75],
    [dist.p90, 90],
    [dist.p95, 95],
    [dist.p99, 99],
  ];
  if (v <= dist.p10) return dist.p10 === 0 ? (v === 0 ? 0 : 1) : Math.max(0, (v / dist.p10) * 10);
  if (v >= dist.p99) {
    const span = dist.p99 - dist.p10;
    return span === 0 ? 99 : Math.min(100, 99 + ((v - dist.p99) / span) * 1);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (v >= x0 && v <= x1) {
      const span = x1 - x0;
      return span === 0 ? (y0 + y1) / 2 : y0 + ((v - x0) / span) * (y1 - y0);
    }
  }
  return 50;
}

/** 从压缩直方图近似计算 P(X >= threshold)。直方图按等宽箱保存，避免把逐条样本下发到浏览器。 */
function histAtLeast(dist, threshold) {
  if (!dist || !Number.isFinite(threshold) || !dist.count) return null;
  const bins = dist.hist?.bins;
  const counts = dist.hist?.counts;
  if (!Array.isArray(bins) || !Array.isArray(counts) || bins.length !== counts.length + 1) return null;
  if (threshold <= bins[0]) return 1;
  if (threshold >= bins[bins.length - 1]) {
    return threshold === bins[bins.length - 1] ? counts[counts.length - 1] / dist.count : 0;
  }
  let idx = counts.length - 1;
  for (let i = 0; i < counts.length; i++) {
    if (threshold <= bins[i + 1]) {
      idx = i;
      break;
    }
  }
  let above = 0;
  for (let i = idx + 1; i < counts.length; i++) above += counts[i];
  const lo = bins[idx];
  const hi = bins[idx + 1];
  const fraction = hi > lo ? Math.max(0, Math.min(1, (hi - threshold) / (hi - lo))) : 0;
  return Math.max(0, Math.min(1, (above + counts[idx] * fraction) / dist.count));
}

/** 方案低/中/高档目标达成率（同一角色、同一属性的玩家样本口径）。 */
function attainmentCardHtml(name, wsPanel, tiers) {
  const stats = wsPanel.get(name) || {};
  const rec = tiers[name] || {};
  const rows = Object.entries(stats)
    .map(([attr, dist]) => {
      const t = rec[attr];
      const values = [t?.low?.median, t?.mid?.median, t?.high?.median];
      if (!t || values.every((v) => v == null)) return null;
      return {
        name: attr,
        low: values[0] == null ? null : +(histAtLeast(dist, values[0]) * 100).toFixed(1),
        mid: values[1] == null ? null : +(histAtLeast(dist, values[1]) * 100).toFixed(1),
        high: values[2] == null ? null : +(histAtLeast(dist, values[2]) * 100).toFixed(1),
        n: dist.count,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.mid ?? b.low ?? 0) - (a.mid ?? a.low ?? 0));
  if (!rows.length) return '';
  registerChart('detail-attainment', attainmentOption(rows));
  const tip = `<b>${escapeHtml(name)} · 方案目标达成率</b><br><span style="color:var(--dim)">按玩家真实面板分布近似计算：达到该角色方案低/中/高档目标的样本比例。这里的“玩家”是工坊高练度标杆池，不是全体玩家；比例来自压缩直方图，适合比较属性之间的门槛难度。</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>方案目标达成率 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox('detail-attainment', Math.max(320, rows.length * 38))}</div>`;
}

/** 角色槽位短板：玩家池有效强化次数均值 + 当前账号对应六个槽位。 */
function slotEfficiencyCardHtml(name) {
  const role = roleKeyedMap(workshopStats.rollEfficiency).get(name);
  if (!role?.slotEff) return '';
  const my = myCharacters.find((c) => c.name === name);
  const weights = role.weights && Object.keys(role.weights).length ? Object.keys(role.weights) : [...SUBSTAT_TYPE_SET];
  const validSet = new Set(weights);
  const mineBySlot = {};
  for (const disc of my?.discs || []) {
    const slot = Number(disc.slot);
    if (slot >= 1 && slot <= 6) mineBySlot[slot] = disc.getHitCount(validSet);
  }
  const rows = [1, 2, 3, 4, 5, 6]
    .map((slot) => {
      const population = role.slotEff[slot]?.mean;
      if (population == null) return null;
      const mine = mineBySlot[slot] ?? null;
      return { name: `${slot}号位`, population: +population.toFixed(2), mine, gap: mine == null ? null : mine - population };
    })
    .filter(Boolean);
  if (!rows.length) return '';
  registerChart('detail-slot-efficiency', slotEfficiencyOption(rows));
  const weakest = rows.reduce((a, b) => (b.population < a.population ? b : a));
  const tip = `<b>${escapeHtml(name)} · 驱动盘槽位短板</b><br><span style="color:var(--dim)">柱 = 该角色玩家池每个槽位的有效强化次数均值；金色点 = 我的盘（有账号数据时）。有效词条按工坊角色默认权重判定。当前玩家池最低均值为 <b>${weakest.name}</b>，先检查该槽通常比盲目追总评分更有信息。</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>驱动盘槽位短板 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox('detail-slot-efficiency', 330)}</div>`;
}

/** 样本口径卡：把“高练度标杆池”从隐含前提变成可见数据。 */
function sampleCoverageCardHtml() {
  const coverage = workshopStats.sampleCoverage;
  const meta = workshopStats.meta || {};
  if (!coverage?.roles) return '';
  const roleMap = roleKeyedMap(coverage.roles);
  const rows = [...roleMap.entries()]
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, 'zh'));
  if (!rows.length) return '';
  const source = coverage.sources || {};
  const entryCount = coverage.entries ?? meta.entries;
  const pool = coverage.uidCount ?? meta.poolUids ?? 0;
  const min = rows[rows.length - 1].entries;
  const max = rows[0].entries;
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${r.entries.toLocaleString()}</td><td>${r.uids.toLocaleString()}</td><td>${(r.sources?.mys || 0).toLocaleString()}</td><td>${(r.sources?.['2025'] || 0).toLocaleString()}</td></tr>`
    )
    .join('');
  const tip = `<b>样本口径</b><br><span style="color:var(--dim)">工坊数据只包含已达到抓取门槛的高练度角色。条目数是角色配装样本，UID 是去重玩家数；mys / 2025 是两个面板来源。不同角色样本量不完全相等，比较小样本角色时应结合这里的分母。</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>样本口径 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>
    <div class="stats-kpis">
      <div><span>角色</span><b>${rows.length}</b></div>
      <div><span>配装条目</span><b>${Number(entryCount || 0).toLocaleString()}</b></div>
      <div><span>去重玩家</span><b>${Number(pool).toLocaleString()}</b></div>
      <div><span>mys / 2025</span><b>${(source.mys || 0).toLocaleString()} / ${(source['2025'] || 0).toLocaleString()}</b></div>
      <div><span>角色样本范围</span><b>${min.toLocaleString()}–${max.toLocaleString()}</b></div>
    </div>
    <div class="coverage-table-wrap"><table class="rec-table"><thead><tr><th>角色</th><th>条目</th><th>UID</th><th>mys</th><th>2025</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  </div>`;
}

function pctCell(value, title = '') {
  return value == null ? '<td class="ds-dim">—</td>' : `<td data-detail="${escapeHtml(title)}">${(value * 100).toFixed(1)}%</td>`;
}

/** 配装选择集中度：Top1 覆盖率 + HHI 等效选择数，避免只看 Top 名称。 */
function concentrationCardHtml() {
  const source = workshopStats.choiceConcentration;
  if (!source) return '';
  const rows = [...roleKeyedMap(source).entries()]
    .map(([name, d]) => {
      const metrics = [d.weapons, d.suits, d.main456?.[4], d.main456?.[5], d.main456?.[6]].filter((x) => x?.hhi != null);
      const meanHhi = metrics.length ? metrics.reduce((s, x) => s + x.hhi, 0) / metrics.length : 0;
      return { name, d, meanHhi };
    })
    .filter((r) => r.d.entries > 0)
    .sort((a, b) => b.meanHhi - a.meanHhi || a.name.localeCompare(b.name, 'zh'));
  if (!rows.length) return '';
  const share = (m) => (m?.top1 == null ? null : m.top1);
  const eq = (m) => (m?.effectiveChoices == null ? '—' : m.effectiveChoices.toFixed(1));
  const tableRows = rows
    .map(
      ({ name, d }) =>
        `<tr><td>${escapeHtml(name)}</td><td>${d.entries.toLocaleString()}</td>${pctCell(share(d.weapons), `HHI ${d.weapons?.hhi?.toFixed(3) || '—'} · 等效 ${eq(d.weapons)}`)}${pctCell(share(d.suits), `HHI ${d.suits?.hhi?.toFixed(3) || '—'} · 等效 ${eq(d.suits)}`)}${pctCell(share(d.main456?.[4]), `HHI ${d.main456?.[4]?.hhi?.toFixed(3) || '—'} · 等效 ${eq(d.main456?.[4])}`)}${pctCell(share(d.main456?.[5]), `HHI ${d.main456?.[5]?.hhi?.toFixed(3) || '—'} · 等效 ${eq(d.main456?.[5])}`)}${pctCell(share(d.main456?.[6]), `HHI ${d.main456?.[6]?.hhi?.toFixed(3) || '—'} · 等效 ${eq(d.main456?.[6])}`)}</tr>`
    )
    .join('');
  const tip = `<b>配装选择集中度</b><br><span style="color:var(--dim)">Top1 = 该角色最常见选择的覆盖率。悬浮单元格可看 HHI 与等效选择数（1/HHI）；等效选择数越小，玩家共识越强。套装按整套 6 件盘的组合统计，主词条按槽位统计。</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>配装选择集中度 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3><div class="coverage-table-wrap"><table class="rec-table"><thead><tr><th>角色</th><th>样本</th><th>音擎 Top1</th><th>套装组合 Top1</th><th>4号位</th><th>5号位</th><th>6号位</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>`;
}
/** 密度散点卡片：每个属性对网格注册一张密度散点图（perRole 用，占整行；标题只留短名，说明放悬浮） */
function scatterCardsHtml(prefix, grid, subtitle) {
  return Object.entries(grid)
    .map(([key, g]) => {
      const id = `${prefix}-${key}`;
      registerChart(id, densityScatterOption(g, `${g.xName} × ${g.yName}`));
      const tip = `<b>${escapeHtml(g.xName)} × ${escapeHtml(g.yName)}</b><br><span style="color:var(--dim)">${escapeHtml(subtitle)}：2D 密度散点——颜色越亮密度越高（每点=一位玩家的该属性组合），悬浮数据点可看坐标</span>`;
      return `<div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(g.xName)} × ${escapeHtml(g.yName)} <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox(id, 420)}</div>`;
    })
    .join('');
}
// ---------- 全服总览（全局总览层：共识度 / 评分×盘毕业度 / 练度总览） ----------

function renderOverview() {
  const notReady = statsNotReady();
  if (notReady) return notReady;
  const wsPanel = wsPanelMap();
  const tiers = recTierStats();
  const roleNames = Object.values(plans).map((v) => v.name);

  // 2. 共识度散点：一张大图，每属性一个子图（X=玩家 sd、Y=推荐 high.cv）
  const consensusAttrs = [
    '攻击力',
    '防御力',
    '生命值',
    '暴击率',
    '暴击伤害',
    '异常精通',
    '冲击力',
    '能量自动回复',
  ].filter(
    (a) =>
      roleNames.some((n) => wsPanel.get(n)?.[a]?.sd != null) && roleNames.some((n) => tiers[n]?.[a]?.high?.cv != null)
  );
  const consensusGrid = consensusAttrs
    .map((a) => ({
      attr: a,
      points: roleNames
        .map((name) => ({
          name,
          sd: wsPanel.get(name)?.[a]?.sd ?? null,
          cv: tiers[name]?.[a]?.high?.cv ?? null,
        }))
        .filter((p) => p.sd != null && p.cv != null),
    }))
    .filter((g) => g.points.length);
  if (consensusGrid.length) registerChart('overview-consensus', consensusGridOption(consensusGrid));
  const consensusTip = `<b>玩家分化 vs 攻略分歧</b><br><span style="color:var(--dim)">每属性一个子图，每点一个角色：横轴=玩家分化（该属性全服玩家数值的标准差，越大玩家之间差距越大）；纵轴=攻略分歧（米游社推荐方案 high 档毕业值的变异系数 CV=标准差/均值，越大攻略之间分歧越大）。<br>左下=玩家与攻略均共识 · 左上=玩家共识但攻略分歧 · 右下=玩家分化大但攻略一致 · 右上=两方面均无共识（该属性参考价值低）</span>`;

  // 4. D9 评分 × 盘毕业度：每角色「工坊评分 relic_point」与「加权词条效率分」的皮尔逊相关
  //    r 高 = 工坊评分基本就是词条效率的另一种写法，可放心当毕业度代理；r 低 = 评分掺了别的东西
  const rollEffMap = roleKeyedMap(workshopStats.rollEfficiency);
  const srRows = [];
  for (const [name, d] of rollEffMap) {
    const sv = d?.scoreVsRelic;
    if (!sv || sv.r == null) continue;
    srRows.push({ name, r: sv.r, n: sv.n });
  }
  srRows.sort((a, b) => b.r - a.r); // r 降序传入：ECharts 类目轴首项画在底部，故最脱节（r 最低）的落在图顶最显眼处
  if (srRows.length) registerChart('overview-score-relic', scoreRelicOption(srRows));
  const srTip = `<b>评分 × 盘毕业度（D9）</b><br><span style="color:var(--dim)">每角色：工坊装配评分 <b>relic_point</b> 与本项目的<b>加权词条效率分</b>（Σ 强化次数 × 该角色流派权重）在同一玩家样本上的皮尔逊相关 r。<br>r≈1 说明工坊评分与词条效率几乎等价——看评分即可代表毕业度；r 偏低说明评分掺入了词条效率之外的成分，此时对该角色<b>不宜直接拿评分当毕业度</b>，应看有效强化次数。配对样本 &lt;30 的角色不参与（记 null）。<br>绿 ≥0.90 · 金 ≥0.80 · 橙 &lt;0.80</span>`;

  // 5. 角色拥有率：样本池（全部上榜去重 uid）中拥有该角色的占比，降序排列
  const ownMap = roleKeyedMap(workshopStats.roleOwnership);
  const poolUids = workshopStats.meta?.poolUids || 0;
  const ownRows = [];
  for (const name of roleNames) {
    const rate = ownMap.get(name);
    if (rate == null || !poolUids) continue;
    ownRows.push({ name, rate: rate * 100, n: Math.round(rate * poolUids), pool: poolUids });
  }
  ownRows.sort((a, b) => b.rate - a.rate);
  if (ownRows.length) registerChart('overview-ownership', roleOwnershipOption(ownRows));
  const ownTip = `<b>角色拥有率</b><br><span style="color:var(--dim)">口径：工坊配装样本池（排行榜上榜玩家的去重 uid 池，${poolUids.toLocaleString()} 人）中<b>拥有该角色</b>（该 uid 的账号数据里练了这个角色）的占比。<br>占比越高说明该角色在高练度玩家中越普及；结合「装配评分/影画」看：高拥有率 + 高练度 = 该角色的养成基准。</span>`;
  const coverageCard = sampleCoverageCardHtml();
  const concentrationCard = concentrationCardHtml();

  return `<div class="chart-grid">
    ${coverageCard}
    ${consensusGrid.length ? `<div class="chart-card" style="grid-column:1/-1"><h3>玩家分化 vs 攻略分歧 <button class="chart-hint" data-hint="${escapeHtml(consensusTip)}">?</button></h3>${chartBox('overview-consensus', Math.max(440, Math.ceil(consensusGrid.length / 4) * 270))}</div>` : ''}
    ${srRows.length ? `<div class="chart-card" style="grid-column:1/-1"><h3>评分 × 盘毕业度 <button class="chart-hint" data-hint="${escapeHtml(srTip)}">?</button></h3>${chartBox('overview-score-relic', Math.max(320, srRows.length * 16))}</div>` : ''}
    ${ownRows.length ? `<div class="chart-card" style="grid-column:1/-1"><h3>角色拥有率 <button class="chart-hint" data-hint="${escapeHtml(ownTip)}">?</button></h3>${chartBox('overview-ownership', Math.max(320, ownRows.length * 16))}</div>` : ''}
    ${concentrationCard}
    ${progressCardsHtml()}
  </div>`;
}

// ---------- 角色详情 / 角色面板（角色选择） ----------
/** 详情/分布面板当前选中角色（默认首个有玩家分布的角色） */
export let selectedRole = '';
export function setSelectedRole(name) {
  selectedRole = name;
}
function roleSelectHtml(current) {
  const roleNames = Object.values(plans).map((v) => v.name);
  if (!current || !roleNames.includes(current)) current = roleNames[0];
  return `<div class="chart-select"><label>角色</label><select onchange="ZZZ.selectRole(this.value)">${roleOptionsHtml(current, roleNames)}</select></div>`;
}

// ---------- 角色面板（单角色详情层：流派分析 / 小提琴+箱线 / 推荐三档增强图 / 技能对标与组合 / 配装对标 / 配队亲和 / 密度散点） ----------
/** 流派分析卡：该角色玩家池面板（攻击/暴击率/暴伤/属性伤害）k-means 聚类出的配置取向流派 + 我的联动（styleMatch 相对距离）。
 *  ⚠️ 暴伤等百分比属性聚合侧已归一小数（mys "165.2%"→1.652），这里按值 ≤3 判百分比显示。 */
function styleCardHtml(name) {
  const style = workshopStats.roleStyles?.[roleIdFor(name)];
  if (!style || !style.styles?.length) return '';
  const my = myCharacters.find((c) => c.name === name);
  const myFinal = my?.calculate().final || null;
  const match = myFinal ? styleMatch(style, myFinal) : null;
  const fmt = (v) => (v == null ? '—' : v <= 3 ? (v * 100).toFixed(0) + '%' : Math.round(v).toString());
  const SHARE_COLORS = ['var(--hazard)', 'var(--blue)', 'var(--green)'];
  const shareBar = `<div class="style-share-bar">${style.styles
    .map(
      (st, i) =>
        `<span style="flex:${(st.share * 100).toFixed(2)};background:${SHARE_COLORS[i % SHARE_COLORS.length]}" data-detail="${escapeHtml(st.label)} · 占 ${(st.share * 100).toFixed(0)}%"></span>`
    )
    .join('')}</div>`;
  const head = `<tr><th>属性</th>${style.styles
    .map(
      (st) =>
        `<th>${escapeHtml(st.label)}<br><span class="ds-dim" style="font-weight:400">${(st.share * 100).toFixed(0)}% · mean/中位</span></th>`
    )
    .join('')}${myFinal ? '<th>我的</th>' : ''}</tr>`;
  const rows = style.attrs
    .map((a) => {
      const mine = myFinal?.[a];
      const mineCell = mine == null ? '<td class="ds-dim">—</td>' : `<td class="style-mine">${fmt(mine)}</td>`;
      return `<tr><td class="tname">${escapeHtml(a)}</td>${style.styles
        .map((st) => {
          const p = st.panel[a];
          return `<td>${fmt(p?.mean)}<span class="ds-dim">/${fmt(p?.median)}</span></td>`;
        })
        .join('')}${mineCell}</tr>`;
    })
    .join('');
  const chip = (items) =>
    items && items.length
      ? items.map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join('')
      : '<span class="ds-dim">—</span>';
  const styleBlocks = style.styles
    .map(
      (st) => `<div class="style-block">
        <div class="style-block-head"><b>${escapeHtml(st.label)}</b><span class="ds-dim">${(st.share * 100).toFixed(0)}%</span></div>
        <div class="style-block-row"><span class="style-k">4号位</span>${chip(st.main['4'])}</div>
        <div class="style-block-row"><span class="style-k">5号位</span>${chip(st.main['5'])}</div>
        <div class="style-block-row"><span class="style-k">6号位</span>${chip(st.main['6'])}</div>
        <div class="style-block-row"><span class="style-k">套装</span>${chip(st.suits)}</div>
        <div class="style-block-row"><span class="style-k">音擎</span>${chip(st.wengine)}</div>
      </div>`
    )
    .join('');
  const myLine = match
    ? `<div class="style-mine-line">你的面板最贴近 <b class="style-best">${escapeHtml(match.best.label)}</b>（相对距离 ${match.best.dist.toFixed(3)}，越小越像）</div>`
    : '';
  const tip = `<b>流派分析</b><br><span style="color:var(--dim)">该角色玩家池（高练度标杆池）按面板（攻击/暴击率/暴伤/属性伤害）k-means 聚类出的配置取向流派——同一角色的面板资源零和，玩家在「堆攻击 / 堆双暴 / 堆精通」等取向间分化（4 号位主词条是强判别信号）。<br>典型面板 = 流派内玩家 mean/中位；456 主词条/套装/音擎 = 流派内 Top2 偏好。<br>「我的」列（有账号数据时）：按属性相对差平方和判定你的面板最贴近哪个流派。暴伤等百分比属性按 % 显示（如 1.65 = 165%）</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>流派分析 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>
    ${myLine}
    ${shareBar}
    <div class="style-table-wrap"><table class="rec-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
    <div class="style-blocks">${styleBlocks}</div>
  </div>`;
}
function renderRoleDetail() {
  const notReady = statsNotReady();
  if (notReady) return notReady;
  const roleNames = Object.values(plans).map((v) => v.name);
  if (!selectedRole || !roleNames.includes(selectedRole)) selectedRole = roleNames[0];
  const name = selectedRole;
  const wsPanel = wsPanelMap();
  const tiers = recTierStats();
  const my = myCharacters.find((c) => c.name === name);
  const myFinal = my ? my.calculate().final : null;
  const st = wsPanel.get(name) || {};
  const rec = tiers[name] || {};

  // 1. 小提琴+箱线：所有有玩家分布的属性（样本≥30）全部列出，叠加推荐三档点 + 我的
  const violinAttrs = Object.keys(st).filter((a) => st[a]?.count >= 30);
  const violinItems = violinAttrs.map((a) => ({
    attr: a,
    dist: st[a],
    rec: rec[a] ? { low: rec[a].low?.median, mid: rec[a].mid?.median, high: rec[a].high?.median } : null,
    mine: myFinal?.[a] ?? null,
  }));
  registerChart('detail-violin', violinBoxOption(violinItems));
  // 小提琴图上下两行时高度翻倍（每行 ~280px）
  const violinH = violinItems.length > 4 ? 560 : 400;

  // 2. 推荐三档 × 玩家分布增强图：每属性显示 玩家 P10-P90 / 三档 median±sd / 我的值+百分位；
  //    三档全缺但玩家有分布（如异常掌控等占位属性）仍显示玩家区间与我的
  const tierItems = [];
  for (const a of violinAttrs) {
    const recA = rec[a];
    const d = st[a];
    if (!recA?.low && !recA?.mid && !recA?.high && !d?.p10 && !d?.p90) continue;
    tierItems.push({
      attr: a,
      player: { p10: d?.p10 ?? null, p90: d?.p90 ?? null },
      low: recA?.low ? { median: recA.low.median, sd: recA.low.sd } : null,
      mid: recA?.mid ? { median: recA.mid.median, sd: recA.mid.sd } : null,
      high: recA?.high ? { median: recA.high.median, sd: recA.high.sd } : null,
      mine: myFinal?.[a] ?? null,
      minePct: approxPercentile(myFinal?.[a], d),
    });
  }
  const tiersH = Math.max(300, Math.ceil(tierItems.length / 3) * 250);
  registerChart('detail-tiers', tierRichOption(tierItems, tiersH));

  // 3. 方案目标的玩家达成率 + 驱动盘槽位短板
  const attainmentCard = attainmentCardHtml(name, wsPanel, tiers);
  const slotEfficiencyCard = slotEfficiencyCardHtml(name);

  // 角色配装对标：工坊实况 vs 方案推荐（音擎/套装 + 差异）——放在面板属性对密度散点上方
  const gradBench = gradBenchHtml(name);

  // B6 配队亲和：玩家实配队友（roleCooccurrence）vs 攻略配队（plans team）两口径对比
  const matesCard = matesCardsHtml(name);

  // 面板属性对 trade-off：该角色玩家真实配比（暴击率×暴伤、攻击×暴伤）密度散点
  const scatterCards = scatterCardsHtml(
    'detail-scatter',
    workshopStats.panelScatter?.perRole?.[roleIdFor(name)] || {},
    '玩家真实配比',
    true
  );

  // 图表卡标题悬浮说明（标题本身只留短名，详情放悬浮）
  const violinTip = `<b>${escapeHtml(name)} · 玩家分布箱线</b><br><span style="color:var(--dim)">对每个有玩家样本的属性（样本≥30）展示玩家真实分布：小提琴密度 + 箱线（中位/四分位/离群点），叠加推荐方案三档点位（低/中/高）与我的数值（金色）</span>`;
  const tiersTip = `<b>推荐三档 × 玩家区间</b><br><span style="color:var(--dim)">每属性 4 行对比：玩家 P10-P90 区间（蓝）vs 推荐三档 median±sd（绿/金/橙）；金色竖线 = 我的值及其玩家百分位，悬浮图表行可看具体数值</span>`;
  const skillTip = `<b>技能等级分布</b><br><span style="color:var(--dim)">该角色玩家池的 6 类技能等级分布子图（普攻/闪避/支援/特殊/终结/核心），金色柱 = 我的等级</span>`;
  const gradTip = `<b>角色配装对标</b><br><span style="color:var(--dim)">${escapeHtml(name)} 工坊玩家实况（音擎/套装使用占比）与米游社方案推荐并排对比，标注仅方案推荐/仅实况使用等差异</span>`;

  return `<div class="chart-grid">
    ${roleSelectHtml(name)}
    ${styleCardHtml(name)}
    <div class="chart-card" style="grid-column:1/-1"><h3>玩家分布箱线 <button class="chart-hint" data-hint="${escapeHtml(violinTip)}">?</button></h3>${chartBox('detail-violin', violinH)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3>推荐三档 × 玩家区间 <button class="chart-hint" data-hint="${escapeHtml(tiersTip)}">?</button></h3>${chartBox('detail-tiers', tiersH)}</div>
    ${attainmentCard}
    ${slotEfficiencyCard}
    <div class="chart-card" style="grid-column:1/-1"><h3>技能等级分布 <button class="chart-hint" data-hint="${escapeHtml(skillTip)}">?</button></h3>${skillBenchHtml(name)}</div>
    ${gradBench ? `<div class="chart-card" style="grid-column:1/-1"><h3>角色配装对标 <button class="chart-hint" data-hint="${escapeHtml(gradTip)}">?</button></h3>${gradBench}</div>` : ''}
    ${matesCard}
    ${scatterCards}
  </div>`;
}

/** B6 配队亲和卡：玩家实配队友（同 uid 同练角色共现）vs 攻略配队（方案 team 成员）两口径 Top6 对比 */
function matesCardsHtml(name) {
  const coMap = roleKeyedMap(workshopStats.roleCooccurrence);
  const currentRid = roleIdFor(name);
  const pool = workshopStats.sampleCoverage?.uidCount || workshopStats.meta?.poolUids || 0;
  const own = workshopStats.roleOwnership || {};
  const nA = currentRid && pool ? (own[currentRid] || 0) * pool : 0;
  const partners = (coMap.get(name) || [])
    .map(([rid, cnt]) => {
      const conditional = nA ? cnt / nA : null;
      const lift = conditional != null && own[rid] > 0 ? conditional / own[rid] : null;
      return { pname: alignRoleName(wsRoleIdMap().get(String(rid)) || rid), cnt, conditional, lift };
    })
    .filter((x) => x.pname !== name && x.cnt >= 20)
    .sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1) || b.cnt - a.cnt)
    .slice(0, 6);
  const planCnt = new Map();
  for (const v of Object.values(plans || {})) {
    for (const p of v.plans || []) {
      const team = p.team || [];
      if (!team.includes(name)) continue;
      for (const m of team) if (m !== name) planCnt.set(m, (planCnt.get(m) || 0) + 1);
    }
  }
  const planMates = [...planCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!partners.length && !planMates.length) return '';
  const cell = (items, fmt) => (items.length ? items.map(fmt).join('<br>') : '<span class="ds-dim">无数据</span>');
  const tip = `<b>配队亲和</b><br><span style="color:var(--dim)">玩家侧按同 UID 共现计算：条件概率 = 拥有该角色的玩家中同时拥有队友的比例；Lift = 条件概率 ÷ 队友全池拥有率。Lift > 1 表示该队友与本角色的共现高于其自身普及度，能排除“热门角色天然排前”的偏差。右侧仍是攻略方案中的出现次数。</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3>配队亲和 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${table(
    ['玩家实配队友（条件概率 / Lift）', '攻略配队（方案）'],
    [
      `<tr><td class="ds-main">${cell(partners, (x) => `${escapeHtml(x.pname)} <span class="ds-rolecnt">${x.conditional != null ? (x.conditional * 100).toFixed(1) + '%' : '—'} · Lift ${x.lift != null ? x.lift.toFixed(2) : '—'} · ${x.cnt} 人</span>`)}</td><td class="ds-main">${cell(
        planMates,
        ([mn, c]) => `${escapeHtml(mn)} <span class="ds-rolecnt">${c} 个方案</span>`
      )}</td></tr>`,
    ],
    new Set()
  )}</div>`;
}

/** 渲染整个统计视图（tab + 当前子面板）；渲染前清空图表注册，render 后由 render.js 调 mountStatsCharts */
export function renderStatsView() {
  clearCharts();
  const tabs = TABS.map(
    (t) =>
      `<button class="wiki-tab ${t.key === statsTab ? 'on' : ''}" data-tab="${t.key}" onclick="ZZZ.statsTab('${t.key}')">${t.label}</button>`
  ).join('');
  const body = PANEL_RENDERERS[statsTab] ? PANEL_RENDERERS[statsTab]() : '';
  return `<div class="wiki"><div class="wiki-tabs">${tabs}</div>${body}</div>`;
}

// ================= 练度图（并入「全服总览」）：评分 / 影画 / trade-off =================

/** 属性相关（panelCorr）→ HTML 表格（角色 × 属性对，色标正负；列序固定，缺列显示 —） */
const PANEL_CORR_COLS = [
  ['攻击力_防御力', '攻击×防御'],
  ['攻击力_生命值', '攻击×生命'],
  ['防御力_生命值', '防御×生命'],
  ['暴击率_暴击伤害', '暴击率×暴伤'],
  ['攻击力_暴击伤害', '攻击×暴伤'],
  ['攻击力_暴击率', '攻击×暴击率'],
  ['异常精通_异常掌控', '异常精通×异常掌控'],
];
function panelCorrTableHtml() {
  const corr = workshopStats.panelCorr || {};
  const planNames = Object.values(plans).map((v) => v.name);
  const rows = [];
  for (const [rid, pairs] of Object.entries(corr)) {
    const name = alignRoleName(wsRoleIdMap().get(String(rid)) || rid);
    if (!planNames.includes(name)) continue;
    const cells = PANEL_CORR_COLS.map(([key, label]) => {
      const r = pairs[key];
      if (r == null || !Number.isFinite(r)) return `<td>—</td>`;
      const color = r > 0.2 ? 'var(--green)' : r < -0.2 ? 'var(--red)' : 'var(--dim)';
      return `<td style="color:${color}" data-detail="${label}">${r.toFixed(2)}</td>`;
    }).join('');
    rows.push(`<tr><td>${escapeHtml(name)}</td>${cells}</tr>`);
  }
  const heads = ['角色', ...PANEL_CORR_COLS.map(([, label]) => label)].map((h) => `<th>${h}</th>`).join('');
  // 不包 .wiki-wrap（限高滚动容器）：直接铺开完整展示，页面整体滚动
  return `<table class="rec-table"><thead><tr>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** 练度总览内容（并入「全服总览」）：评分分布 / 影画金字塔 / 属性 trade-off（返回 chart-card 片段，由 renderOverview 包 chart-grid） */
function progressCardsHtml() {
  if (!Object.keys(plans || {}).length) return '';
  const R = workshopStats;
  const roleNames = Object.values(plans).map((v) => v.name);
  const cards = [];

  // 1. 全角色装配评分箱线分布
  const relicMap = roleKeyedMap(R.relicStats);
  const relicRows = [];
  for (const name of roleNames) {
    const d = relicMap.get(name);
    if (!d || d.count == null) continue;
    relicRows.push({
      name,
      median: +d.median.toFixed(1),
      p10: +d.p10.toFixed(1),
      p90: +d.p90.toFixed(1),
      p25: +d.p25.toFixed(1),
      p75: +d.p75.toFixed(1),
      whiskerLow: d.whiskerLow != null ? +d.whiskerLow.toFixed(1) : null,
      whiskerHigh: d.whiskerHigh != null ? +d.whiskerHigh.toFixed(1) : null,
      outliers: d.outliers,
      count: d.count,
    });
  }
  if (relicRows.length) {
    registerChart('prog-relic', relicBarOption(relicRows));
    const tip = `<b>装配评分分布</b><br><span style="color:var(--dim)">每角色一条箱线（工坊装配评分 relic_point）：盒 = P25-P75、线 = 中位、须 = IQR 1.5 规则（塌缩时退化为 P10/P90），悬浮看分位明细与离群数</span>`;
    cards.push(
      `<div class="chart-card" style="grid-column:1/-1"><h3>装配评分分布 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox('prog-relic', Math.max(320, relicRows.length * 18))}</div>`
    );
  }

  // 2. 影画金字塔（每角色 0-6 影占比）
  const rankMap = roleKeyedMap(R.rankDist);
  const pyramidRows = [];
  for (const name of roleNames) {
    const d = rankMap.get(name);
    if (!d) continue;
    const total = Object.values(d).reduce((a, v) => a + v, 0);
    if (!total) continue;
    pyramidRows.push({ name, ranks: [0, 1, 2, 3, 4, 5, 6].map((r) => +(((d[r] || 0) / total) * 100).toFixed(1)) });
  }
  if (pyramidRows.length) {
    // 按 0 影占比升序（0 影段为堆叠最左段，占比小的排前，形成金字塔递进）
    pyramidRows.sort((a, b) => a.ranks[0] - b.ranks[0]);
    registerChart('prog-pyramid', rankPyramidOption(pyramidRows));
    const tip = `<b>影画档位金字塔</b><br><span style="color:var(--dim)">每角色一条堆叠横条：玩家池 0-6 影画占比（青→蓝→绿→金→橙→红，影画越高越醒目）；按 0 影占比升序排列</span>`;
    cards.push(
      `<div class="chart-card" style="grid-column:1/-1"><h3>影画档位金字塔 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${chartBox('prog-pyramid', Math.max(380, pyramidRows.length * 20))}</div>`
    );
  }

  // 4. 属性 trade-off 表
  if (Object.keys(R.panelCorr || {}).length) {
    const tip = `<b>面板属性相关</b><br><span style="color:var(--dim)">全服玩家面板属性对的皮尔逊相关：绿=正相关（同涨同跌）· 红=负相关（此消彼长）· 灰=无明显关系；悬浮看具体相关系数</span>`;
    cards.push(
      `<div class="chart-card" style="grid-column:1/-1"><h3>面板属性相关 <button class="chart-hint" data-hint="${escapeHtml(tip)}">?</button></h3>${panelCorrTableHtml()}</div>`
    );
  }

  return cards.join('');
}

// ================= 角色面板增强：技能对标与组合（提升清单在全服总览） =================

// 技能类型统一走 constants.SKILL_TYPES（canonical：普攻/闪避/支援/特殊/终结/核心）。聚合层（computeSkillStats）
// 已按源把工坊 type 归一化为 canonical（mys=官方语义、2025=1.x ID 语义）；官方（账号）type 匹配我的等级时
// 经 OFFICIAL_SKILL_TYPE 映射（官方 1特殊技→3、2闪避→1、3终结/连携→4、6支援→2）。

/** 我的技能 vs 玩家池技能等级分布（skillStats.dist）：每技能一个柱状子图，我的等级柱高亮金色（官方 type 经 OFFICIAL_SKILL_TYPE 映射到 canonical） */
function skillBenchHtml(name) {
  const skillMap = roleKeyedMap(workshopStats.skillStats);
  const dist = skillMap.get(name);
  const my = myCharacters.find((c) => c.name === name);
  if (!dist || !my?.skills?.length) return '';
  const items = SKILL_TYPES.map((t) => {
    const d = dist[t.key];
    if (!d) return null;
    const myLv = my.skills.find((s) => OFFICIAL_SKILL_TYPE[s.type] === t.key)?.level;
    return {
      label: t.label,
      dist: d.dist,
      mine: myLv != null ? myLv : null,
      ...(t.key === 5 ? { min: 1, max: 7 } : {}), // 核心技满级 7 级，固定 1-7 柱
    };
  }).filter(Boolean);
  if (!items.length) return '';
  const H = Math.max(300, Math.ceil(items.length / 3) * 240);
  registerChart('detail-skill-dist', skillDistOption(items));
  // 只返回图表容器：卡片由调用方包裹，避免再套 .chart-grid 形成嵌套网格（嵌套会按 520px 自动分列，窗口越宽图越窄）
  return chartBox('detail-skill-dist', H);
}

/** render 后挂载本视图的 ECharts 图表（render.js 调用） */
export function mountStatsCharts() {
  mountCharts();
}
