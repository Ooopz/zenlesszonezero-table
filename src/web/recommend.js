// src/web/recommend.js —— 统计视图（原推荐）：五个二级子面板（角色面板 / 角色配装 / 驱动盘 / 角色配队 / 角色总览）
// 数据源：plans.json（方案推荐）+ workshop-grad.json（全服真实占比，工坊 grad_stat 接口）+ library.json。
// 供「角色面板」/「角色总览」作玩家样本对标（不当作全服分布）。
// 容器结构仿 wiki.js：TABS + PANEL_RENDERERS 键控分发 + 共享排序。
import { plans, library, workshopGrad, workshopStats, myCharacters, charIndex, wengineIndex } from './data.js';
import { CHAR_ALIASES, computeRecTierStats } from '../lib/panelBench.js';
import { computeRoleBuildsFromPlans, orderComboSets4First } from '../lib/plansStats.js';
import { renderDiscStats, resetDiscStatsSort } from './discstats.js';
import { escapeHtml, escapeJsAttr, renderRichText, formatValue, statEntries, romanNumeralUnicode } from '../lib/util.js';
import { resolveEntry, canonicalName, CATEGORY } from '../lib/names.js';
import { createSort } from '../lib/sort.js';
import { STAT, SUBSTAT_TYPE_SET, SKILL_TYPES, OFFICIAL_SKILL_TYPE } from '../lib/constants.js';
import {
  clearCharts,
  mountCharts,
  registerChart,
  chartBox,
  heatmapOption,
  consensusScatterOption,
  violinBoxOption,
  densityScatterOption,
  rankPyramidOption,
  playerScatterOption,
  relicBarOption,
  layerGainOption,
  tierBarOption,
  skillDistOption,
  tierRichOption,
} from './charts.js';

export let recommendTab = 'detail';
export function setRecommendTab(key) {
  recommendTab = key;
  recSort.reset(); // 切子面板清空统计视图排序
  resetDiscStatsSort(); // 驱动盘面板排序也复位
}

// 排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js；各面板共用）
const recSort = createSort();
export function toggleRecommendSort(key) {
  recSort.toggle(key);
}

const TABS = [
  { key: 'detail', label: '角色面板' },
  { key: 'discs', label: '驱动盘' },
  { key: 'abyss', label: '深渊配队' },
  { key: 'overview', label: '角色总览' },
  { key: 'progress', label: '练度总览' },
];
/** 子面板 key → 渲染函数（renderRecommend 键控分发，驱动盘复用 discstats） */
const PANEL_RENDERERS = {
  detail: renderRoleDetail,
  discs: renderDiscStats,
  abyss: renderAbyssTeams,
  overview: renderOverview,
  progress: renderProgressOverview,
};

/** 统一空态：msg 为说明、hint 为操作提示/按钮（可选） */
function emptyState(msg, hint = '') {
  return `<div class="empty">${msg}${hint ? `<br>${hint}` : ''}</div>`;
}
/** 渲染可排序表格（rec-table 骨架；内容列复用 .ds-count/.ds-main/.ds-chars 等类） */
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
/** grad/工坊名 → plans 标准角色名（resolver 优先；落空 CHAR_ALIASES + plans 子串） */
function alignRoleName(name) {
  const planNames = Object.values(plans).map((v) => v.name);
  const n = canonicalName(CATEGORY.CHAR, charIndex, name);
  if (n) return n;
  const a = CHAR_ALIASES[name] || name;
  if (planNames.includes(a)) return a;
  return planNames.find((p) => p.includes(a) || a.includes(p)) || a;
}
/** 角色名 → 玩家真实样本面板统计（workshop-stats.panels；{count,min,max,mean,median}）。
 *  key 对齐到 plans 角色名（grad 名可能是简称/缇提差异，需匹配到账号/plans 一致的名字）。 */
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
/** 通用缓存：role_id 键的 stats 对象（relicStats/rankLayers/rankDist/skillStats）→ 角色名键 Map。
 *  数据引用变化时惰性重建（与 wsPanelMap 同模式）。 */
let _roleKeyedSource = null;
let _roleKeyedCache = null;
function roleKeyedMap(source) {
  if (_roleKeyedSource !== source) {
    _roleKeyedSource = source;
    const idToName = wsRoleIdMap();
    const m = new Map();
    for (const [rid, v] of Object.entries(source || {})) {
      const gradName = idToName.get(String(rid));
      if (gradName) m.set(alignRoleName(gradName), v);
    }
    _roleKeyedCache = m;
  }
  return _roleKeyedCache;
}

// ---------- 深渊配队（实战指导：出场榜 / 双队配队 Top / 队友共现 + 官方推荐对比） ----------
let selectedAbyssRole = '';
export function setSelectedAbyssRole(name) {
  selectedAbyssRole = name;
}
/** 深渊角色 id → plans 角色名（grad item_id 体系与深渊 id 同源） */
function abyssNameOf(id, idToName) {
  const n = idToName?.get(String(id));
  return n ? alignRoleName(n) : String(id);
}
/** plans 角色名 → 深渊角色 id（反查；无 → null） */
function abyssIdOf(name, idToName) {
  for (const [id, n] of idToName || []) if (alignRoleName(n) === name) return id;
  return null;
}
/** 官方推荐队友：该角色全部方案的 team 角色名并集（去重） */
function planTeammates(name) {
  const set = new Set();
  for (const p of plans[name]?.plans || []) for (const t of p.team || []) set.add(t);
  return [...set];
}

function renderAbyssTeams() {
  if (!Object.keys(plans || {}).length)
    return emptyState('暂无推荐方案数据。', '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。');
  const at = workshopStats.abyssStats?.abyssTeam;
  if (!at?.charUsage?.length)
    return emptyState('暂无深渊战绩数据。', '请先运行 <b>node src/sync/workshop.js</b> 更新工坊数据（含深渊战绩）后刷新。');
  const idToName = wsRoleIdMap();
  const roleNames = Object.values(plans).map((v) => v.name);
  if (!selectedAbyssRole || !roleNames.includes(selectedAbyssRole)) selectedAbyssRole = roleNames[0];

  // ① 角色出场榜（横向进度条，全量）
  const total = at.charUsage.reduce((s, c) => s + c.count, 0) || 1;
  const usageBody = at.charUsage
    .map((c) => {
      const nm = abyssNameOf(c.id, idToName);
      return `<tr><td class="ds-chars" style="text-align:left">${escapeHtml(nm)}</td><td class="ds-count">${c.count.toLocaleString()}</td><td style="min-width:140px">${gradPct((c.count / total) * 100)}</td></tr>`;
    })
    .join('');
  const usageTable = `<div class="wiki-wrap"><table class="rec-table" style="min-width:0"><thead><tr><th>角色</th><th>出场次数</th><th>出场占比</th></tr></thead><tbody>${usageBody}</tbody></table></div>`;

  // ② 双队配队 Top + S 评级配队 Top
  const teamCard = (label, teams, tip) => {
    if (!teams?.length) return '';
    return `<div class="chart-card"><h4>${label}${tip ? `<span class="ad-sub">${tip}</span>` : ''}</h4>${teams
      .map(
        (t) =>
          `<div class="ab-team"><span class="ad-chip both">${t.chars.map((c) => escapeHtml(abyssNameOf(c, idToName))).join(' / ')}</span><span class="ad-sub">×${t.count.toLocaleString()}</span></div>`
      )
      .join('')}</div>`;
  };

  // ③ 全角色下拉 → 选中角色：实战队友 Top vs 官方推荐
  const myId = abyssIdOf(selectedAbyssRole, idToName);
  const mates = myId ? at.teammates?.[myId] : null;
  const mateList = mates
    ? Object.entries(mates)
        .map(([mid, cnt]) => ({ name: abyssNameOf(mid, idToName), cnt }))
        .sort((a, b) => b.cnt - a.cnt)
    : [];
  const planMates = planTeammates(selectedAbyssRole);
  const mateCell = (list) =>
    list.length
      ? list
          .map((m) => {
            const inPlan = planMates.includes(m.name);
            return `<span class="ad-chip${inPlan ? ' both' : ''}">${escapeHtml(m.name)}${inPlan ? '★' : ''}<span class="ad-sub"> ${m.cnt != null ? m.cnt.toLocaleString() : ''}</span></span>`;
          })
          .join('')
      : '—';
  const abyssSelect = `<div class="chart-select"><label>角色</label><select onchange="ZZZ.selectAbyssRole(this.value)">${roleNames
    .map((n) => `<option value="${escapeHtml(n)}"${n === selectedAbyssRole ? ' selected' : ''}>${escapeHtml(n)}</option>`)
    .join('')}</select></div>`;

  // ④ 全角色对照表：官方推荐队友 / 深渊实战队友 Top / 一致（按一致数降序，其次出场热度）
  const rowObjs = roleNames
    .map((name) => {
      const off = planTeammates(name);
      const id = abyssIdOf(name, idToName);
      const live = id && at.teammates?.[id]
        ? Object.entries(at.teammates[id]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([mid]) => abyssNameOf(mid, idToName))
        : [];
      const offSet = new Set(off);
      const hit = live.filter((n) => offSet.has(n)).length;
      const usage = id ? at.charUsage.find((c) => c.id === id)?.count ?? 0 : 0;
      return { name, off, live, hit, usage };
    })
    .sort((a, b) => b.hit - a.hit || b.usage - a.usage);
  const tableRows = rowObjs.map((r) => {
    const offSet = new Set(r.off);
    const offHtml = r.off.length
      ? `<span class="ab-chiprow">${r.off.map((n) => `<span class="ad-chip">${escapeHtml(n)}</span>`).join('')}</span>`
      : '—';
    const liveHtml = r.live.length
      ? `<span class="ab-chiprow">${r.live.map((n) => `<span class="ad-chip${offSet.has(n) ? ' both' : ''}">${escapeHtml(n)}</span>`).join('')}</span>`
      : '<span class="ad-sub">深渊未出场</span>';
    const hitHtml = r.hit
      ? `<span class="ds-same">${r.live.filter((n) => offSet.has(n)).map((n) => escapeHtml(n)).join('、')}</span>`
      : '<span class="ad-sub">—</span>';
    return `<tr><td class="ds-chars" style="text-align:left">${escapeHtml(r.name)}</td><td class="ds-chars">${offHtml}</td><td class="ds-chars">${liveHtml}</td><td class="ds-chars">${hitHtml}</td></tr>`;
  });

  return `<div class="chart-grid">
    <div class="chart-card" style="grid-column:1/-1"><h3>深渊角色出场榜（玩家池 · 谁在打深渊）</h3>${usageTable}</div>
    ${teamCard('第一队实战配队 Top', at.nodeTeams[1], '（按通关楼层节点 1）')}
    ${teamCard('第二队实战配队 Top', at.nodeTeams[2], '（节点 2）')}
    ${teamCard('S/SS 评级配队 Top', at.sTeams, '（只看 S 评级通关）')}
    <div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(selectedAbyssRole)} · 深渊实战队友 vs 官方推荐（★=官方也推荐）</h3>${abyssSelect}
      <div class="ad-row"><span class="ad-row-label">实战队友</span><span class="ad-chips">${mateCell(mateList)}</span></div>
      <div class="ad-row"><span class="ad-row-label">官方推荐</span><span class="ad-chips">${planMates.map((n) => `<span class="ad-chip">${escapeHtml(n)}</span>`).join('') || '—'}</span></div>
    </div>
    <div class="chart-card" style="grid-column:1/-1"><h3>全角色 · 官方推荐队友 vs 深渊实战队友（金色=两口径一致 · 按一致数排序）</h3>
      <div class="wiki-wrap">${table(['角色', '官方推荐队友', '深渊实战队友 Top5', '一致'], tableRows, new Set(), 'stat-table')}</div>
    </div>
  </div>`;
}

// ---------- 工坊配装（全服真实：每角色 Top 音擎 / 套装组合及占比） ----------
/** 套装组合文本顺序统一：4 件套在前、2 件套在后（工坊/方案两源一致；'其他' 等空组合原样返回） */
const normCombo = (x) => {
  if (!x?.sets || !x.sets.length) return x;
  return { ...x, ...orderComboSets4First(x.sets) };
};
/** 角色配装对标（单角色）：工坊实况 vs 方案推荐的音擎/套装对比（原「角色配装」面板按角色下钻到「角色面板」）。 */
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
      return `<span class="ws-item" data-detail="${escapeHtml(wengineTip(wname))}" title="悬浮查看音擎详情">${icon ? `<img class="ws-ico" src="${icon}" alt="">` : ''}<span>${escapeHtml(wname)}</span>${gradPct(w.percent)}</span>`;
    })
    .join('<br>');
  const relics = normRelics
    .map(
      (x) =>
        `<span class="ws-item" data-detail="${escapeHtml(relicTip(x.sets))}" title="悬浮查看套装效果"><span class="ws-sets">${(
          x.sets || []
        )
          .map((s) => (s.icon ? `<img class="ws-ico" src="${s.icon}" alt="">` : ''))
          .join('')}</span><span>${escapeHtml(x.name)}</span>${gradPct(x.percent)}</span>`
    )
    .join('<br>');
  // 方案推荐侧音擎 / 套装（Top3 + 占比）
  const planWeapons = pb.wengines
    .map(
      (w) =>
        `<span class="ws-item">${library.wengines?.[w.name]?.icon ? `<img class="ws-ico" src="${library.wengines[w.name].icon}" alt="">` : ''}<span>${escapeHtml(w.name)}</span>${gradPct(w.percent)}</span>`
    )
    .join('<br>');
  const planRelics = normPlanRelics
    .map(
      (x) =>
        `<span class="ws-item" data-detail="${escapeHtml(relicTip(x.sets))}" title="悬浮查看套装效果"><span class="ws-sets">${(x.sets || []).map((s) => (library.discs?.[s.name]?.icon ? `<img class="ws-ico" src="${library.discs[s.name].icon}" alt="">` : '')).join('')}</span><span>${escapeHtml(x.name)}</span>${gradPct(x.percent)}</span>`
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

// ---------- 对标总览（全局总览层：达标热力图 / 共识度散点） ----------
/** 我的值在玩家分布中的近似百分位（分位插值，处理零宽区间/零分位避免 NaN；无分布返回 null） */
function approxPercentile(v, dist) {
  if (v == null || !dist || dist.p10 == null || dist.p99 == null) return null;
  const pts = [
    [dist.p10, 10], [dist.p25, 25], [dist.p50, 50], [dist.p75, 75], [dist.p90, 90], [dist.p95, 95], [dist.p99, 99],
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
/** 密度散点卡片（方案二）：对每个属性对网格注册一张密度散点图并返回卡片 HTML（角色面板/角色总览共用）。
 *  fullWidth 时卡片占整行（单角色图），否则流式排列（全局图）。 */
function scatterCardsHtml(prefix, grid, subtitle, fullWidth) {
  return Object.entries(grid)
    .map(([key, g]) => {
      const id = `${prefix}-${key}`;
      registerChart(id, densityScatterOption(g, `${g.xName} × ${g.yName} · ${subtitle}`));
      const cls = fullWidth ? ' style="grid-column:1/-1"' : '';
      return `<div class="chart-card"${cls}><h3>${escapeHtml(g.xName)} × ${escapeHtml(g.yName)} · ${escapeHtml(subtitle)}（密度=样本量，悬浮看坐标）</h3>${chartBox(id, 420)}</div>`;
    })
    .join('');
}
function renderOverview() {
  if (!Object.keys(plans || {}).length)
    return emptyState('暂无推荐方案数据。', '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。');
  const wsPanel = wsPanelMap();
  const tiers = computeRecTierStats(plans);
  const myCalc = new Map(myCharacters.map((c) => [c.name, c.calculate()]));
  const roleNames = Object.values(plans).map((v) => v.name);

  // 1. 达标热力图：账号角色 × 核心属性，我的玩家百分位 + 是否达推荐中档
  const heatAttrs = ['攻击力', '防御力', '生命值', '暴击率', '暴击伤害', '异常精通', '冲击力', '能量自动回复'].filter((a) =>
    roleNames.some((n) => wsPanel.get(n)?.[a])
  );
  const heatRows = [...myCalc]
    .map(([name, my]) => {
      const st = wsPanel.get(name) || {};
      const rec = tiers[name] || {};
      const cells = heatAttrs.map((a) => {
        const dist = st[a];
        const v = my.final[a];
        if (!dist || v == null) return null;
        const pct = approxPercentile(v, dist);
        const reached = rec[a]?.mid?.median != null && v >= rec[a].mid.median;
        return { pct, reached };
      });
      return { name, cells };
    })
    .filter((r) => r.cells.some((c) => c));

  // 2. 共识度散点图：每属性一张（X=玩家 sd、Y=推荐 high.cv）
  const consensusAttrs = ['攻击力', '防御力', '生命值', '暴击率', '暴击伤害', '异常精通', '冲击力', '能量自动回复'].filter(
    (a) => roleNames.some((n) => wsPanel.get(n)?.[a]?.sd != null) && roleNames.some((n) => tiers[n]?.[a]?.high?.cv != null)
  );
  const consensusCards = consensusAttrs
    .map((a) => {
      const points = roleNames
        .map((name) => ({
          name,
          sd: wsPanel.get(name)?.[a]?.sd ?? null,
          cv: tiers[name]?.[a]?.high?.cv ?? null,
        }))
        .filter((p) => p.sd != null && p.cv != null);
      registerChart(`overview-consensus-${a}`, consensusScatterOption(points));
      return `<div class="chart-card"><h3>${escapeHtml(a)} · 玩家分化 vs 攻略分歧</h3>${chartBox(`overview-consensus-${a}`, 380)}</div>`;
    })
    .join('');

  registerChart('overview-heat', heatmapOption(heatRows, heatAttrs));

  // 面板属性对 trade-off：全体玩家真实配比（暴击率×暴伤、攻击×暴伤）全局密度散点
  const scatterCards = scatterCardsHtml('overview-scatter', workshopStats.panelScatter?.global || {}, '全体玩家配比', false);

  // 我的盘毕业度矩阵：每块盘有效词条数 vs 该盘工坊 effDist（百分位 = 优于 x% 玩家）
  const discDetailsMap = new Map((workshopStats.discDetails || []).map((d) => [d.name, d]));
  const myDiscRows = [];
  for (const c of myCalc) {
    const discs = c[1].discs || [];
    for (const disc of discs) {
      const suit = disc.set || disc.suit;
      const detail = suit ? discDetailsMap.get(suit) : null;
      const eff = (disc.subStats || []).filter((s) => s && SUBSTAT_TYPE_SET.has(s.name)).length;
      let pct = null;
      if (detail?.effDist) {
        const total = Object.values(detail.effDist).reduce((s2, v) => s2 + v, 0);
        const better = Object.entries(detail.effDist).filter(([k]) => Number(k) >= eff).reduce((s2, [, v]) => s2 + v, 0);
        pct = total ? Math.round((better / total) * 100) : null;
      }
      myDiscRows.push({ char: c[0], disc: suit || '?', eff, pct });
    }
  }
  const discMatrix = myDiscRows.length
    ? `<div class="wiki-wrap"><table class="rec-table"><thead><tr><th>我的角色</th><th>驱动盘</th><th>有效词条</th><th>优于玩家</th></tr></thead><tbody>${myDiscRows
        .map(
          (r) => `<tr>
          <td>${escapeHtml(r.char)}</td><td>${escapeHtml(r.disc)}</td>
          <td style="color:${r.eff >= 3 ? 'var(--green)' : r.eff >= 2 ? 'var(--orange)' : 'var(--red)'}">${r.eff}</td>
          <td style="color:${r.pct != null && r.pct >= 70 ? 'var(--green)' : r.pct != null && r.pct >= 40 ? 'var(--orange)' : 'var(--red)'}">${r.pct != null ? `优于 ${r.pct}% 玩家` : '—'}</td>
        </tr>`
        )
        .join('')}</tbody></table></div>`
    : '';

  return `<div class="chart-grid">
    <div class="chart-card" style="grid-column:1/-1"><h3>我的角色 · 面板达标（色=我的玩家百分位，悬浮看是否达推荐中档）</h3>${chartBox('overview-heat', 720)}</div>
    ${discMatrix ? `<div class="chart-card" style="grid-column:1/-1"><h3>我的驱动盘毕业度（有效词条数 vs 该盘工坊分布）</h3>${discMatrix}</div>` : ''}
    ${consensusCards}
    ${scatterCards}
  </div>`;
}

// ---------- 角色详情 / 分布分析（角色选择） ----------
/** 详情/分布面板当前选中角色（默认首个有玩家分布的角色） */
let selectedRole = '';
export function setSelectedRole(name) {
  selectedRole = name;
}
/** 图表面板顶部角色下拉 */
function roleSelectHtml(current) {
  const roleNames = Object.values(plans).map((v) => v.name);
  if (!current || !roleNames.includes(current)) current = roleNames[0];
  const opts = roleNames
    .map((n) => `<option value="${escapeJsAttr(n)}"${n === current ? ' selected' : ''}>${escapeHtml(n)}</option>`)
    .join('');
  return `<div class="chart-select"><label>角色</label><select onchange="ZZZ.selectRole(this.value)">${opts}</select></div>`;
}

// ---------- 角色详情（单角色详情层：小提琴+箱线 / 配比雷达 / 对标仪表盘） ----------
function renderRoleDetail() {
  if (!Object.keys(plans || {}).length)
    return emptyState('暂无推荐方案数据。', '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。');
  const roleNames = Object.values(plans).map((v) => v.name);
  if (!selectedRole || !roleNames.includes(selectedRole)) selectedRole = roleNames[0];
  const name = selectedRole;
  const wsPanel = wsPanelMap();
  const tiers = computeRecTierStats(plans);
  const my = myCharacters.find((c) => c.name === name);
  const myFinal = my ? my.calculate().final : null;
  const st = wsPanel.get(name) || {};
  const rec = tiers[name] || {};

  // 1. 小提琴+箱线：所有有玩家分布的属性（样本≥30）全部列出，叠加推荐三档点 + 我的
  const violinAttrs = Object.keys(st).filter((a) => st[a]?.count >= 30);
  const violinItems = violinAttrs.map((a) => ({
    attr: a,
    dist: st[a],
    rec: rec[a]
      ? { low: rec[a].low?.median, mid: rec[a].mid?.median, high: rec[a].high?.median }
      : null,
    mine: myFinal?.[a] ?? null,
  }));
  registerChart('detail-violin', violinBoxOption(violinItems));
  // 小提琴图上下两行时高度翻倍（每行 ~230px）
  const violinH = violinItems.length > 4 ? 500 : 360;

  // 2. 推荐三档 × 玩家分布增强图：每属性显示 玩家 P10-P90 / 三档 median±sd / 我的值+百分位
  const tierItems = [];
  for (const a of violinAttrs) {
    const recA = rec[a];
    if (!recA?.low && !recA?.mid && !recA?.high) continue;
    const d = st[a];
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

  // 角色配装对标：工坊实况 vs 方案推荐（音擎/套装 + 差异）——放在面板属性对密度散点上方
  const gradBench = gradBenchHtml(name);

  // 面板属性对 trade-off：该角色玩家真实配比（暴击率×暴伤、攻击×暴伤）密度散点
  const scatterCards = scatterCardsHtml('detail-scatter', workshopStats.panelScatter?.perRole?.[roleIdFor(name)] || {}, '玩家真实配比', true);

  return `<div class="chart-grid">
    ${roleSelectHtml(name)}
    <div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(name)} · 玩家分布箱线 / 推荐三档 / 我的</h3>${chartBox('detail-violin', violinH)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3>玩家区间 × 推荐三档 × 我的（蓝=玩家P10-P90 · 绿/金/橙=三档median±sd · 金竖线=我的+百分位）</h3>${chartBox('detail-tiers', tiersH)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3>技能等级分布（玩家池 · 金=我的等级）</h3>${skillBenchHtml(name)}</div>
    ${gradBench ? `<div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(name)} · 角色配装（工坊实况 vs 方案推荐）</h3>${gradBench}</div>` : ''}
    ${scatterCards}
  </div>`;
}

/** 渲染整个统计视图（tab + 当前子面板）；渲染前清空图表注册，render 后由 render.js 调 mountRecommendCharts */
export function renderRecommend() {
  clearCharts();
  const tabs = TABS.map(
    (t) =>
      `<button class="wiki-tab ${t.key === recommendTab ? 'on' : ''}" data-tab="${t.key}" onclick="ZZZ.recommendTab('${t.key}')">${t.label}</button>`
  ).join('');
  const body = PANEL_RENDERERS[recommendTab] ? PANEL_RENDERERS[recommendTab]() : '';
  return `<div class="wiki"><div class="wiki-tabs">${tabs}</div>${body}</div>`;
}

// ================= 练度总览（新子面板）：评分 / 影画 / 技能 / 深渊 / 玩家生态 / trade-off =================

// 技能类型统一走 constants.SKILL_TYPES（canonical：普攻/闪避/支援/特殊/终结/核心）。聚合层（computeSkillStats）
// 已按源把工坊 type 归一化为 canonical（mys=官方语义、2025=1.x ID 语义）；官方（账号）type 匹配我的等级时
// 经 OFFICIAL_SKILL_TYPE 映射（官方 1特殊技→3、2闪避→1、3终结/连携→4、6支援→2）。

/** 属性相关（panelCorr）→ HTML 表格（角色 × 属性对，色标正负） */
function panelCorrTableHtml() {
  const corr = workshopStats.panelCorr || {};
  const planNames = Object.values(plans).map((v) => v.name);
  const rows = [];
  for (const [rid, pairs] of Object.entries(corr)) {
    const name = alignRoleName(wsRoleIdMap().get(String(rid)) || rid);
    if (!planNames.includes(name)) continue;
    const cells = Object.entries(pairs)
      .map(([key, r]) => {
        if (r == null || !Number.isFinite(r)) return `<td>—</td>`;
        const color = r > 0.2 ? 'var(--green)' : r < -0.2 ? 'var(--red)' : 'var(--dim)';
        const title = key.replace('_', ' × ');
        return `<td style="color:${color}" title="${title}">${r.toFixed(2)}</td>`;
      })
      .join('');
    rows.push(`<tr><td>${escapeHtml(name)}</td>${cells}</tr>`);
  }
  const heads = ['角色', '攻击×防御', '攻击×生命', '防御×生命', '暴击率×暴伤'].map((h) => `<th>${h}</th>`).join('');
  return `<div class="wiki-wrap"><table class="rec-table"><thead><tr>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

/** 练度总览：评分分布 / 影画金字塔与收益 / 技能 P90 热力 / 深渊分布与评分×层数 / 玩家生态 / 属性 trade-off */
function renderProgressOverview() {
  if (!Object.keys(plans || {}).length)
    return emptyState('暂无推荐方案数据。', '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。');
  const R = workshopStats;
  const roleNames = Object.values(plans).map((v) => v.name);
  const cards = [];

  // 1. 全角色装配评分中位分布
  const relicMap = roleKeyedMap(R.relicStats);
  const relicRows = [];
  for (const name of roleNames) {
    const d = relicMap.get(name);
    if (!d || d.count == null) continue;
    relicRows.push({ name, median: +d.median.toFixed(1), p10: +d.p10.toFixed(1), p90: +d.p90.toFixed(1), count: d.count });
  }
  if (relicRows.length) {
    registerChart('prog-relic', relicBarOption(relicRows));
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3>玩家装配评分分布（工坊 relic_point · 中位条 + P10-P90 区间）</h3>${chartBox('prog-relic', Math.max(320, relicRows.length * 18))}</div>`);
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
    registerChart('prog-pyramid', rankPyramidOption(pyramidRows));
    cards.push(`<div class="chart-card"><h3>影画档位金字塔（玩家池 0-6 影占比）</h3>${chartBox('prog-pyramid', Math.max(360, pyramidRows.length * 16))}</div>`);
  }

  // 3. 影画收益：0 影 vs 6 影 攻击力 P50
  const layerMap = roleKeyedMap(R.rankLayers);
  const gainRows = [];
  for (const name of roleNames) {
    const l = layerMap.get(name);
    const a0 = l?.['0']?.['攻击力'];
    const a6 = l?.['6']?.['攻击力'];
    if (!a0 || !a6 || a0.count < 30 || a6.count < 30) continue;
    gainRows.push({ name, attr: '攻击力', rank0: +a0.median.toFixed(0), rank6: +a6.median.toFixed(0) });
  }
  if (gainRows.length) {
    registerChart('prog-gain', layerGainOption(gainRows));
    cards.push(`<div class="chart-card"><h3>影画收益：0 影 vs 6 影 攻击力中位（样本≥30）</h3>${chartBox('prog-gain', Math.max(320, gainRows.length * 18))}</div>`);
  }

  // 4. 技能 P90 热力图（角色 × 技能；canonical 列，玩家池无「支援」数据 → 压缩掉该列）
  const skillMap = roleKeyedMap(R.skillStats);
  const skillRows = [];
  for (const name of roleNames) {
    const s = skillMap.get(name);
    if (!s) continue;
    const cells = SKILL_TYPES.map((t) => {
      const d = s[t.key];
      if (!d) return null;
      return { pct: d.p90, label: `P90 ${d.p90} 级`, reached: null };
    });
    skillRows.push({ name, cells });
  }
  const skillRows2 = skillRows.filter((r) => r.cells.some((c) => c));
  if (skillRows2.length) {
    const used = SKILL_TYPES.map((_, i) => i).filter((i) => skillRows2.some((r) => r.cells[i]));
    const skillRows3 = skillRows2.map((r) => ({ name: r.name, cells: used.map((i) => r.cells[i]) }));
    registerChart('prog-skills', heatmapOption(skillRows3, used.map((i) => SKILL_TYPES[i].label)));
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3>技能等级 P90 热力图（玩家池 · 色=前 90% 玩家的等级）</h3>${chartBox('prog-skills', Math.max(320, skillRows2.length * 16))}</div>`);
  }

  // 5. 深渊层数分布 + 评分×层数密度
  const ab = R.abyssStats || {};
  const layerDist = ab.layerDist || {};
  const layerKeys = Object.keys(layerDist).map(Number).sort((a, b) => a - b);
  if (layerKeys.length) {
    const total = layerKeys.reduce((a, k) => a + layerDist[k], 0);
    registerChart(
      'prog-abyss',
      tierBarOption(layerKeys.map((k) => ({ tier: `第 ${k} 层`, count: layerDist[k], pct: +(((layerDist[k] || 0) / total) * 100).toFixed(1) })))
    );
    cards.push(`<div class="chart-card"><h3>深渊战绩分布（玩家池通关层数）</h3>${chartBox('prog-abyss', 300)}</div>`);
  }
  if (ab.relicLayer) {
    registerChart('prog-relic-layer', densityScatterOption(ab.relicLayer, '平均装配评分 × 深渊层数'));
    cards.push(`<div class="chart-card"><h3>练度 → 实战验证（评分越高是否层数越高）</h3>${chartBox('prog-relic-layer', 340)}</div>`);
  }

  // 6. 玩家生态散点
  const pp = (R.playerProfiles || []).filter((p) => p.avgRelic != null);
  if (pp.length > 10) {
    registerChart('prog-players', playerScatterOption(pp));
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3>玩家生态（${pp.length} 位玩家 · 角色池 × 平均评分）</h3>${chartBox('prog-players', 360)}</div>`);
  }

  // 7. 属性 trade-off 表
  if (Object.keys(R.panelCorr || {}).length) {
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3>面板属性相关（绿=正相关 · 红=负相关 · 悬浮看属性对）</h3>${panelCorrTableHtml()}</div>`);
  }

  return `<div class="chart-grid">${cards.join('')}</div>`;
}

// ================= 角色面板增强：技能对标 + 提升优先级清单 =================

/** 我的技能 vs 玩家池技能等级分布（skillStats.dist）：每技能一个柱状子图，我的等级柱高亮金色。
 *  我的等级匹配：官方（账号）type 经 OFFICIAL_SKILL_TYPE 映射到 canonical 再对子图键（工坊已归一化）。 */
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
  // 只返回图表容器本身：卡片包裹由调用方按统一结构处理（chart-card + grid-column:1/-1），
  // 避免再套 .chart-grid 形成嵌套网格——嵌套网格会按 520px 自动分列，窗口越宽图反而越窄
  return chartBox('detail-skill-dist', H);
}

/** render 后挂载本视图的 ECharts 图表（render.js 调用） */
export function mountRecommendCharts() {
  mountCharts();
}
