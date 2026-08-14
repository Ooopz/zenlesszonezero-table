// src/web/recommend.js —— 统计视图（原推荐）：五个二级子面板（角色面板 / 角色配装 / 驱动盘 / 角色配队 / 角色总览）
// 数据源：plans.json（方案推荐）+ workshop-grad.json（全服真实占比，工坊 grad_stat 接口）+ library.json。
// 供「角色面板」/「角色总览」作玩家样本对标（不当作全服分布）。
// 容器结构仿 wiki.js：TABS + PANEL_RENDERERS 键控分发 + 共享排序。
import { plans, library, workshopGrad, workshopStats, myCharacters, charIndex, wengineIndex } from './data.js';
import { computeTeamStats } from '../lib/teamStats.js';
import { CHAR_ALIASES, computeRecTierStats } from '../lib/panelBench.js';
import { computeRoleBuildsFromPlans, orderComboSets4First } from '../lib/plansStats.js';
import { renderDiscStats, resetDiscStatsSort } from './discstats.js';
import { escapeHtml, escapeJsAttr, renderRichText, formatValue, statEntries, romanNumeralUnicode } from '../lib/util.js';
import { resolveEntry, canonicalName, CATEGORY } from '../lib/names.js';
import { createSort } from '../lib/sort.js';
import { STAT } from '../lib/constants.js';
import {
  clearCharts,
  mountCharts,
  registerChart,
  chartBox,
  heatmapOption,
  consensusScatterOption,
  violinBoxOption,
  distShapeOption,
  densityScatterOption,
  tierRangeOption,
} from './charts.js';

export let recommendTab = 'detail';
export function setRecommendTab(key) {
  recommendTab = key;
  recSort.reset(); // 切子面板清空统计视图排序
  resetDiscStatsSort(); // 驱动盘面板排序也复位
}

// 排序状态（三态：升序 → 降序 → 恢复默认，统一走 src/lib/sort.js；各面板共用）
const recSort = createSort();
// 任意面板点过表头 → 配队面板的「默认按被引用次数降序」只在从未交互时生效，点过后排序/复位走 recSort 自然顺序
let recommendTouched = false;
export function toggleRecommendSort(key) {
  recommendTouched = true;
  recSort.toggle(key);
}

const TABS = [
  { key: 'detail', label: '角色面板' },
  { key: 'grad', label: '角色配装' },
  { key: 'discs', label: '驱动盘' },
  { key: 'teams', label: '角色配队' },
  { key: 'overview', label: '角色总览' },
];
/** 子面板 key → 渲染函数（renderRecommend 键控分发，驱动盘复用 discstats） */
const PANEL_RENDERERS = {
  detail: renderRoleDetail,
  grad: renderWorkshopGrad,
  discs: renderDiscStats,
  teams: renderTeamStats,
  overview: renderOverview,
};

/** 统一空态：msg 为说明、hint 为操作提示/按钮（可选） */
function emptyState(msg, hint = '') {
  return `<div class="empty">${msg}${hint ? `<br>${hint}` : ''}</div>`;
}
/** 列表 → HTML：每项独立一行（逐项 escapeHtml 后再拼 <br>，避免把 <br> 一起转义） */
const joinBr = (items) => (items?.length ? items.map((x) => escapeHtml(x)).join('<br>') : '—');
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
/** 查 library.characters 角色：统一 resolver（精确/别名/归一化/子串兜底，如 维琳娜→维琳娜·艾嘉德） */
function findLibraryChar(name) {
  return resolveEntry(CATEGORY.CHAR, charIndex, name);
}
/** 查 library.wengines 音擎：统一 resolver（精确/别名/normalizeRomanKey，如 残响-II型→「残响」-Ⅱ型） */
function findLibraryWengine(name) {
  return resolveEntry(CATEGORY.WENGINE, wengineIndex, name);
}
/** 角色悬浮：方案数 + 稀有度/元素/特性/阵营 */
function charTipHtml(name, planCount) {
  const c = findLibraryChar(name);
  return (
    `<b>${escapeHtml(name)}</b>` +
    (planCount != null ? `<br><span style="color:var(--dim)">${planCount} 个方案</span>` : '') +
    (c ? `<br>${[c.rarity, c.element, c.trait, c.faction].filter(Boolean).join(' · ')}` : '')
  );
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
/** 角色名 → 玩家真实样本面板统计（workshop-stats.panels；{count,min,max,mean,median}）。
 *  key 对齐到 plans 角色名（grad 名可能是简称/缇提差异，需匹配到账号/plans 一致的名字）。 */
function wsPanelMap() {
  const panels = workshopStats.panels;
  if (_wsPanelRoles !== panels) {
    _wsPanelRoles = panels;
    const idToName = wsRoleIdMap();
    const planNames = Object.values(plans).map((v) => v.name);
    const alignName = (name) => {
      // 统一 resolver（别名/归一化/子串兜底）优先；落空回退 CHAR_ALIASES + plans 子串
      const n = canonicalName(CATEGORY.CHAR, charIndex, name);
      if (n) return n;
      const a = CHAR_ALIASES[name] || name;
      if (planNames.includes(a)) return a;
      return planNames.find((p) => p.includes(a) || a.includes(p)) || a;
    };
    _wsPanelCache = new Map();
    for (const p of panels || []) {
      const gradName = idToName.get(String(p.name));
      if (gradName && p.stats) _wsPanelCache.set(alignName(gradName), p.stats);
    }
  }
  return _wsPanelCache;
}

// ---------- 配队统计（保留现状微调：去重复列、默认排序仅限未交互时） ----------
const TEAM_HEADERS = ['角色', '作为队友被引用', '自身方案数', '引用角色'];
const TEAM_SORTABLE = new Set(['角色', '作为队友被引用', '自身方案数']);
function teamVal(t, key) {
  if (key === '角色') return t.name;
  if (key === '作为队友被引用') return t.mateCount;
  if (key === '自身方案数') return t.selfCount;
  return null;
}
function renderTeamStats() {
  if (!Object.keys(plans || {}).length)
    return emptyState('暂无推荐方案数据。', '请在右上角 <b>同步数据 → 更新推荐方案</b> 后刷新查看。');
  const names = Object.values(library.characters || {}).map((c) => c.name);
  const data = computeTeamStats(plans, names);
  // 从未点过表头时默认按「作为队友被引用」降序（最常被组队的在前）；点过表头后排序/复位走 recSort（复位回自然顺序）
  const base = !recommendTouched && !recSort.active ? [...data].sort((a, b) => b.mateCount - a.mateCount) : data;
  const rows = recSort.apply(base, teamVal).map(
    (t) => `<tr>
      <td class="wiki-name" data-detail="${escapeHtml(charTipHtml(t.name, t.selfCount))}" title="悬浮查看详情"><span class="ds-dname">${escapeHtml(t.name)}</span></td>
      <td class="ds-count">${t.mateCount || '—'}</td>
      <td class="ds-count">${t.selfCount || '—'}</td>
      <td class="ds-chars">${joinBr(t.characters)}</td>
    </tr>`
  );
  return `<div class="discstats">${table(TEAM_HEADERS, rows, TEAM_SORTABLE, 'stat-table')}</div>`;
}

// ---------- 工坊配装（全服真实：每角色 Top 音擎 / 套装组合及占比） ----------
/** 套装组合文本顺序统一：4 件套在前、2 件套在后（工坊/方案两源一致；'其他' 等空组合原样返回） */
const normCombo = (x) => {
  if (!x?.sets || !x.sets.length) return x;
  return { ...x, ...orderComboSets4First(x.sets) };
};
function renderWorkshopGrad() {
  const data = workshopGrad.roles || [];
  if (!data.length)
    return emptyState(
      '暂无工坊配装统计。',
      '<button class="mini" onclick="ZZZ.syncWorkshop()">更新工坊配装</button>（或运行 <b>node src/sync/workshop.js</b>）'
    );
  const gradVal = (r, key) => (key === '角色' ? r.name : null);
  const planBuilds = computeRoleBuildsFromPlans(plans); // 方案推荐侧（结构与工坊 grad 一致）
  const rows = recSort.apply(data, gradVal).map((r) => {
    // 套装组合顺序统一（4 件套在前）：工坊 grad 的 set_info 顺序不固定，两列渲染时各归一一次保证文本/对比一致
    const normRelics = (r.relics || []).map(normCombo);
    const pb = planBuilds[r.name] || { wengines: [], relics: [] };
    const normPlanRelics = (pb.relics || []).map(normCombo);
    const weapons = (r.weapons || [])
      .map((w) => {
        const libW = findLibraryWengine(w.name); // 工坊源音擎名解析为 wiki 规范名（ASCII 罗马数字/括号差异）
        const name = libW?.name || romanNumeralUnicode(w.name);
        const icon = libW?.icon || w.icon;
        return `<span class="ws-item" data-detail="${escapeHtml(wengineTip(name))}" title="悬浮查看音擎详情">${icon ? `<img class="ws-ico" src="${icon}" alt="">` : ''}<span>${escapeHtml(name)}</span>${gradPct(w.percent)}</span>`;
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
      return `<span class="ds-diff">方案 ${escapeHtml(plan1)}<br>实况 ${escapeHtml(grad1)}</span>`;
    };
    const diffW = diffCell(planW1, gradW1);
    const diffR = diffCell(planR1, gradR1);
    // 角色小头像优先用 library.icon（grad 的 r.icon 是大立绘 portrait），缺失时回退
    const roleIcon = findLibraryChar(r.name)?.icon || r.icon;
    return `<tr>
      <td class="wiki-name" title="${escapeHtml(r.name)}">${roleIcon ? `<img class="ws-ico" src="${roleIcon}" alt="">` : ''}<span class="ds-dname">${escapeHtml(r.name)}</span></td>
      <td class="ds-main">${weapons || '—'}</td>
      <td class="ds-main">${planWeapons || '—'}</td>
      <td class="ds-main">${diffW}</td>
      <td class="ds-main">${relics || '—'}</td>
      <td class="ds-main">${planRelics || '—'}</td>
      <td class="ds-main">${diffR}</td>
    </tr>`;
  });
  return `<div class="discstats">${table(['角色', '常用音擎(工坊)', '常用音擎(方案)', '音擎差异', '常用套装(工坊)', '常用套装(方案)', '套装差异'], rows, new Set(['角色']), 'grad-table')}</div>`;
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

  return `<div class="chart-grid">
    <div class="chart-card" style="grid-column:1/-1"><h3>我的角色 · 面板达标（色=我的玩家百分位，悬浮看是否达推荐中档）</h3>${chartBox('overview-heat', 720)}</div>
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

  // 2. 分布形态：每属性直方图 + 平滑密度曲线 + CDF 叠加 + 我的标记（多行，每行 3 个，高度随行数）
  const shapeItems = violinAttrs.map((a) => ({
    attr: a,
    hist: st[a]?.hist,
    dist: st[a],
    mine: myFinal?.[a] ?? null,
    minePct: approxPercentile(myFinal?.[a], st[a]),
  }));
  const shapeH = Math.max(340, Math.ceil(shapeItems.length / 3) * 340);
  registerChart('detail-shape', distShapeOption(shapeItems));

  // 3. 推荐三档目标（低配/毕业/高配 median + 我的值横向条；三档中位数复用 computeRecTierStats 口径）
  const tierItems = [];
  for (const a of violinAttrs) {
    const recA = rec[a];
    if (!recA?.low && !recA?.mid && !recA?.high) continue;
    tierItems.push({
      attr: a,
      low: { median: recA?.low?.median ?? null },
      mid: { median: recA?.mid?.median ?? null },
      high: { median: recA?.high?.median ?? null },
      mine: myFinal?.[a] ?? null,
    });
  }
  registerChart('detail-tiers', tierRangeOption(tierItems));
  const tiersH = Math.max(240, Math.ceil(tierItems.length / 3) * 200);

  // 面板属性对 trade-off：该角色玩家真实配比（暴击率×暴伤、攻击×暴伤）密度散点
  const scatterCards = scatterCardsHtml('detail-scatter', workshopStats.panelScatter?.perRole?.[roleIdFor(name)] || {}, '玩家真实配比', true);

  return `<div class="chart-grid">
    ${roleSelectHtml(name)}
    <div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(name)} · 玩家分布箱线 / 推荐三档 / 我的</h3>${chartBox('detail-violin', 440)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3>${escapeHtml(name)} · 玩家数值分布形态（直方图 + 密度）</h3>${chartBox('detail-shape', shapeH)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3>推荐三档目标（绿=低配 · 金=毕业 · 橙=高配 · 红=我的）</h3>${chartBox('detail-tiers', tiersH)}</div>
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
/** render 后挂载本视图的 ECharts 图表（render.js 调用） */
export function mountRecommendCharts() {
  mountCharts();
}
