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
  consensusGridOption,
  violinBoxOption,
  densityScatterOption,
  rankPyramidOption,
  relicBarOption,
  skillDistOption,
  tierRichOption,
  rankRelicGapOption,
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
  { key: 'overview', label: '全服总览' },
];
/** 子面板 key → 渲染函数（renderRecommend 键控分发，驱动盘复用 discstats） */
const PANEL_RENDERERS = {
  detail: renderRoleDetail,
  discs: renderDiscStats,
  overview: renderOverview,
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
 *  fullWidth 时卡片占整行（单角色图），否则流式排列（全局图）。
 *  标题只留属性对（短名），详细说明放悬浮。 */
function scatterCardsHtml(prefix, grid, subtitle, fullWidth) {
  return Object.entries(grid)
    .map(([key, g]) => {
      const id = `${prefix}-${key}`;
      registerChart(id, densityScatterOption(g, `${g.xName} × ${g.yName}`));
      const cls = fullWidth ? ' style="grid-column:1/-1"' : '';
      const tip = `<b>${escapeHtml(g.xName)} × ${escapeHtml(g.yName)}</b><br><span style="color:var(--dim)">${escapeHtml(subtitle)}：2D 密度散点——颜色越亮密度越高（每点=一位玩家的该属性组合），悬浮数据点可看坐标</span>`;
      return `<div class="chart-card"${cls}><h3 data-detail="${escapeHtml(tip)}">${escapeHtml(g.xName)} × ${escapeHtml(g.yName)}</h3>${chartBox(id, 420)}</div>`;
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

  // 1. 达标热力图：账号角色 × 核心属性，我的玩家百分位 + 是否达推荐中档；
  //    行按「平均落后度」（50 − 百分位）降序（缺口地图：越落后越靠上），格子带缺口值悬浮
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
        const gap = rec[a]?.mid?.median != null ? rec[a].mid.median - v : null;
        return { pct, reached, gap: gap != null && gap > 0 ? gap : null };
      });
      return { name, cells };
    })
    .filter((r) => r.cells.some((c) => c))
    .sort((a, b) => avgLag(b) - avgLag(a));
  /** 平均落后度（50 − 百分位，仅有效格）：行排序依据 */
  function avgLag(row) {
    const vals = row.cells.filter((c) => c && c.pct != null).map((c) => 50 - c.pct);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  }

  // 1b. 提升清单：我的角色 × 属性，缺口 = 推荐中档 − 我的值，按 缺口 × 落后度 排序取 Top
  const upgradeRows = [];
  for (const [name, my] of myCalc) {
    const st = wsPanel.get(name) || {};
    const rec = tiers[name] || {};
    for (const a of heatAttrs) {
      const dist = st[a];
      const v = my.final[a];
      const mid = rec[a]?.mid?.median;
      if (v == null || mid == null) continue;
      const pct = approxPercentile(v, dist);
      if (pct == null) continue;
      const gap = mid - v;
      if (gap <= 0) continue; // 已达标不列入
      upgradeRows.push({ name, attr: a, current: v, target: mid, pct, gap, score: gap * (50 - pct) });
    }
  }
  upgradeRows.sort((x, y) => y.score - x.score);
  const upgradeTip = `<b>提升清单</b><br><span style="color:var(--dim)">我的角色 × 落后属性：缺口 = 推荐中档 − 我的值，按 缺口 × 落后度（50 − 我的玩家百分位）排序——先做缺口大且百分位低的事；悬浮看各维度明细</span>`;
  const upgradeCard =
    upgradeRows.length > 0
      ? `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(upgradeTip)}">提升清单</h3>${table(
          ['角色', '属性', '我的', '推荐中档', '玩家百分位', '缺口'],
          upgradeRows.slice(0, 12).map(
            (r) => `<tr>
            <td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.attr)}</td>
            <td>${formatValue(r.attr, r.current)}</td><td>${formatValue(r.attr, r.target)}</td>
            <td style="color:${r.pct >= 50 ? 'var(--green)' : 'var(--orange)'}">P${Math.round(r.pct)}</td>
            <td style="color:var(--red)">${formatValue(r.attr, r.gap)}</td>
          </tr>`
          ),
          new Set()
        )}</div>`
      : '';

  // 2. 共识度散点：一张大图，每属性一个子图（X=玩家 sd、Y=推荐 high.cv）
  const consensusAttrs = ['攻击力', '防御力', '生命值', '暴击率', '暴击伤害', '异常精通', '冲击力', '能量自动回复'].filter(
    (a) => roleNames.some((n) => wsPanel.get(n)?.[a]?.sd != null) && roleNames.some((n) => tiers[n]?.[a]?.high?.cv != null)
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
  const heatTip = `<b>面板达标</b><br><span style="color:var(--dim)">我的角色 × 核心属性：色 = 我的玩家百分位（相对全服样本），悬浮格子看是否达到推荐中档与缺口；行按平均落后度排序（越落后越靠上）</span>`;

  registerChart('overview-heat', heatmapOption(heatRows, heatAttrs));

  // 3. 我的盘毕业度矩阵 + 替换建议：有效词条 vs 该盘 effDist + 主词条是否该角色该槽主流（roleDiscStats）
  const discDetailsMap = new Map((workshopStats.discDetails || []).map((d) => [d.name, d]));
  const roleDiscMap = roleKeyedMap(workshopStats.roleDiscStats); // 角色名 → {main456}
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
      // 主词条正确率：该角色该槽最常见主词条（roleDiscStats）vs 我的盘
      const slot = disc.slot;
      const roleDisc = roleDiscMap.get(c[0]);
      const mainStat = (disc.mainStats || [])[0]?.name || null;
      const mainstream = slot != null && roleDisc?.main456?.[slot]?.length ? roleDisc.main456[slot][0].name : null;
      const mainOk = mainStat != null && mainstream != null && mainStat === mainstream;
      const advice = eff < 2 && !mainOk ? '优先替换' : eff < 2 ? '可替换' : eff < 3 && !mainOk ? '词条/主词条待优化' : mainOk ? '' : '主词条待优化';
      myDiscRows.push({ char: c[0], disc: suit || '?', eff, pct, mainStat, mainstream, mainOk, advice });
    }
  }
  const adviceColor = (a) => (a === '优先替换' ? 'var(--red)' : a === '可替换' ? 'var(--orange)' : 'var(--dim)');
  const discMatrix = myDiscRows.length
    ? `<div class="wiki-wrap"><table class="rec-table"><thead><tr><th>我的角色</th><th>驱动盘</th><th>有效词条</th><th>优于玩家</th><th>主词条</th><th>建议</th></tr></thead><tbody>${myDiscRows
        .map(
          (r) => `<tr>
          <td>${escapeHtml(r.char)}</td><td>${escapeHtml(r.disc)}</td>
          <td style="color:${r.eff >= 3 ? 'var(--green)' : r.eff >= 2 ? 'var(--orange)' : 'var(--red)'}">${r.eff}</td>
          <td style="color:${r.pct != null && r.pct >= 70 ? 'var(--green)' : r.pct != null && r.pct >= 40 ? 'var(--orange)' : 'var(--red)'}">${r.pct != null ? `优于 ${r.pct}% 玩家` : '—'}</td>
          <td>${r.mainStat ? escapeHtml(r.mainStat) : '—'}${r.mainstream && r.mainStat !== r.mainstream ? `<span class="ds-dim">（主流 ${escapeHtml(r.mainstream)}）</span>` : ''}</td>
          <td style="color:${adviceColor(r.advice)}">${r.advice || '✓'}</td>
        </tr>`
        )
        .join('')}</tbody></table></div>`
    : '';
  const discTip = `<b>驱动盘毕业度</b><br><span style="color:var(--dim)">我每块驱动盘：有效词条数 vs 该盘工坊分布（优于玩家 %）；主词条列对比该角色该槽主流选择（roleDiscStats）；建议列 = 有效词条 <2 或主词条偏离主流时提示替换</span>`;

  // 4. 完成度矩阵：每角色 音擎60 / 盘满级 / 高评分(≥P75) 占比（completeness）
  const compMap = roleKeyedMap(workshopStats.completeness);
  const compRows = [];
  for (const name of roleNames) {
    const d = compMap.get(name);
    if (!d || d.count == null || d.count === 0) continue;
    compRows.push({ name, w60: d.w60, discMax: d.discMax, relicTop: d.relicTop, count: d.count });
  }
  const pctCell = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
  const compTip = `<b>完成度矩阵</b><br><span style="color:var(--dim)">玩家池每角色：音擎 60 级占比 / 驱动盘满级（≥15 级）占比 / 高评分占比（装配评分 ≥ 该角色 P75）；字段缺失的条目不计入对应维度</span>`;
  const compCard =
    compRows.length > 0
      ? `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(compTip)}">完成度矩阵</h3>${table(
          ['角色', '音擎60', '盘满级', '高评分(≥P75)', '样本'],
          compRows.map(
            (r) => `<tr>
            <td>${escapeHtml(r.name)}</td>
            <td style="color:${r.w60 != null && r.w60 >= 0.5 ? 'var(--green)' : 'var(--orange)'}">${pctCell(r.w60)}</td>
            <td style="color:${r.discMax != null && r.discMax >= 0.5 ? 'var(--green)' : 'var(--orange)'}">${pctCell(r.discMax)}</td>
            <td style="color:${r.relicTop != null && r.relicTop >= 0.5 ? 'var(--green)' : 'var(--orange)'}">${pctCell(r.relicTop)}</td>
            <td class="ds-dim">${r.count.toLocaleString()}</td>
          </tr>`
          ),
          new Set()
        )}</div>`
      : '';

  // 5. 影画 × 装配评分：每角色 6影 median − 0影 median（rankRelic）
  const rankRelicMap = roleKeyedMap(workshopStats.rankRelic);
  const rrRows = [];
  for (const name of roleNames) {
    const d = rankRelicMap.get(name);
    if (!d?.[0] || !d?.[6]) continue;
    rrRows.push({ name, gap: +(d[6].median - d[0].median).toFixed(1), r0: d[0].median, r6: d[6].median });
  }
  rrRows.sort((a, b) => a.gap - b.gap);
  if (rrRows.length) registerChart('overview-rank-relic', rankRelicGapOption(rrRows));
  const rrTip = `<b>影画 × 装配评分</b><br><span style="color:var(--dim)">每角色：6 影玩家池装配评分中位数 − 0 影玩家池评分中位数（rankRelic）——正=氪满影画的玩家配装评分整体更高（投入相关性）；悬浮看各档中位与差距</span>`;

  return `<div class="chart-grid">
    ${upgradeCard}
    <div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(heatTip)}">面板达标</h3>${chartBox('overview-heat', 720)}</div>
    ${discMatrix ? `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(discTip)}">驱动盘毕业度</h3>${discMatrix}</div>` : ''}
    ${consensusGrid.length ? `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(consensusTip)}">玩家分化 vs 攻略分歧</h3>${chartBox('overview-consensus', Math.max(440, Math.ceil(consensusGrid.length / 4) * 270))}</div>` : ''}
    ${compCard}
    ${rrRows.length ? `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(rrTip)}">影画 × 装配评分</h3>${chartBox('overview-rank-relic', Math.max(320, rrRows.length * 16))}</div>` : ''}
    ${progressCardsHtml()}
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

  // 角色配装对标：工坊实况 vs 方案推荐（音擎/套装 + 差异）——放在面板属性对密度散点上方
  const gradBench = gradBenchHtml(name);

  // B6 配队亲和：玩家实配队友（roleCooccurrence）vs 攻略配队（plans team）两口径对比
  const matesCard = matesCardsHtml(name);

  // B9 技能组合：玩家拉满模式 Top + 我的对照（skillCombos）
  const skillComboCard = skillComboCardsHtml(name);

  // 面板属性对 trade-off：该角色玩家真实配比（暴击率×暴伤、攻击×暴伤）密度散点
  const scatterCards = scatterCardsHtml('detail-scatter', workshopStats.panelScatter?.perRole?.[roleIdFor(name)] || {}, '玩家真实配比', true);

  // 图表卡标题悬浮说明（标题本身只留短名，详情放悬浮）
  const violinTip = `<b>${escapeHtml(name)} · 玩家分布箱线</b><br><span style="color:var(--dim)">对每个有玩家样本的属性（样本≥30）展示玩家真实分布：小提琴密度 + 箱线（中位/四分位/离群点），叠加推荐方案三档点位（低/中/高）与我的数值（金色）</span>`;
  const tiersTip = `<b>推荐三档 × 玩家区间</b><br><span style="color:var(--dim)">每属性 4 行对比：玩家 P10-P90 区间（蓝）vs 推荐三档 median±sd（绿/金/橙）；金色竖线 = 我的值及其玩家百分位，悬浮图表行可看具体数值</span>`;
  const skillTip = `<b>技能等级分布</b><br><span style="color:var(--dim)">该角色玩家池的 6 类技能等级分布子图（普攻/闪避/支援/特殊/终结/核心），金色柱 = 我的等级</span>`;
  const gradTip = `<b>角色配装对标</b><br><span style="color:var(--dim)">${escapeHtml(name)} 工坊玩家实况（音擎/套装使用占比）与米游社方案推荐并排对比，标注仅方案推荐/仅实况使用等差异</span>`;

  return `<div class="chart-grid">
    ${roleSelectHtml(name)}
    <div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(violinTip)}">玩家分布箱线</h3>${chartBox('detail-violin', violinH)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(tiersTip)}">推荐三档 × 玩家区间</h3>${chartBox('detail-tiers', tiersH)}</div>
    <div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(skillTip)}">技能等级分布</h3>${skillBenchHtml(name)}</div>
    ${skillComboCard}
    ${gradBench ? `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(gradTip)}">角色配装对标</h3>${gradBench}</div>` : ''}
    ${matesCard}
    ${scatterCards}
  </div>`;
}

/** B6 配队亲和卡：玩家实配队友（同 uid 同练角色共现）vs 攻略配队（方案 team 成员）两口径 Top6 对比 */
function matesCardsHtml(name) {
  const coMap = roleKeyedMap(workshopStats.roleCooccurrence);
  const partners = (coMap.get(name) || [])
    .slice(0, 6)
    .map(([rid, cnt]) => ({ pname: alignRoleName(wsRoleIdMap().get(String(rid)) || rid), cnt }))
    .filter((x) => x.pname !== name);
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
  const cell = (items, fmt) =>
    items.length ? items.map(fmt).join('<br>') : '<span class="ds-dim">无数据</span>';
  const tip = `<b>配队亲和</b><br><span style="color:var(--dim)">该角色的队友两口径对比：左=玩家实配（同 uid 玩家同练角色共现，roleCooccurrence，真实组队行为）；右=攻略配队（米游社方案 team 里同队成员次数）</span>`;
  return `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(tip)}">配队亲和</h3>${table(
    ['玩家实配队友(同练)', '攻略配队(方案)'],
    [
      `<tr><td class="ds-main">${cell(partners, (x) => `${escapeHtml(x.pname)} <span class="ds-rolecnt">${x.cnt} 人同练</span>`)}</td><td class="ds-main">${cell(
        planMates,
        ([mn, c]) => `${escapeHtml(mn)} <span class="ds-rolecnt">${c} 个方案</span>`
      )}</td></tr>`,
    ],
    new Set()
  )}</div>`;
}

/** B9 技能组合卡：玩家「哪些技能拉满」的组合模式 Top（skillCombos）+ 我的模式对照。
 *  拉满定义与聚合层一致：普攻/闪避/支援/特殊/终结 ≥12 级，核心 =7 级。 */
function skillComboCardsHtml(name) {
  const scMap = roleKeyedMap(workshopStats.skillCombos);
  const sc = scMap.get(name);
  const my = myCharacters.find((c) => c.name === name);
  if (!sc || !sc.count) return '';
  const FULL = { 0: 12, 1: 12, 2: 12, 3: 12, 4: 12, 5: 7 };
  const LABEL = { 0: '普攻', 1: '闪避', 2: '支援', 3: '特殊', 4: '终结', 5: '核心' };
  let mine = null;
  if (my?.skills?.length) {
    const levels = {};
    for (const s of my.skills) {
      const t = OFFICIAL_SKILL_TYPE[s.type] ?? s.type;
      if (FULL[t] != null) levels[t] = s.level;
    }
    const keys = Object.keys(levels);
    if (keys.length) {
      const names = keys.filter((t) => levels[t] >= FULL[t]).map((t) => LABEL[t]).join('+');
      mine = keys.every((t) => levels[t] >= FULL[t]) ? '全拉满' : names || '无满级';
    }
  }
  const tip = `<b>技能组合</b><br><span style="color:var(--dim)">玩家池「哪些技能拉满」的组合模式（拉满 = 普攻/闪避/支援/特殊/终结 ≥12 级、核心 =7 级）：全拉满率 ${(sc.fullPct * 100).toFixed(0)}%；末行是我的模式对照</span>`;
  const rows = (sc.top || []).map(
    (t) =>
      `<tr><td>${escapeHtml(t.pattern)}</td><td>${t.count.toLocaleString()} 人</td><td>${((t.count / sc.count) * 100).toFixed(0)}%</td></tr>`
  );
  if (mine) rows.push(`<tr><td style="color:var(--acc);font-weight:800">我的：${escapeHtml(mine)}</td><td>—</td><td>—</td></tr>`);
  return `<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(tip)}">技能组合</h3>${table(['玩家组合模式', '人数', '占比'], rows, new Set())}</div>`;
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

// ================= 练度总览（并入「全服总览」）：评分 / 影画 / 技能 / trade-off =================

// 技能类型统一走 constants.SKILL_TYPES（canonical：普攻/闪避/支援/特殊/终结/核心）。聚合层（computeSkillStats）
// 已按源把工坊 type 归一化为 canonical（mys=官方语义、2025=1.x ID 语义）；官方（账号）type 匹配我的等级时
// 经 OFFICIAL_SKILL_TYPE 映射（官方 1特殊技→3、2闪避→1、3终结/连携→4、6支援→2）。

/** 属性相关（panelCorr）→ HTML 表格（角色 × 属性对，色标正负）。
 *  列序固定（不依赖数据键序，数据缺列时显示 —）。 */
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
      return `<td style="color:${color}" title="${label}">${r.toFixed(2)}</td>`;
    }).join('');
    rows.push(`<tr><td>${escapeHtml(name)}</td>${cells}</tr>`);
  }
  const heads = ['角色', ...PANEL_CORR_COLS.map(([, label]) => label)].map((h) => `<th>${h}</th>`).join('');
  // 不包 .wiki-wrap（限高滚动容器）：直接铺开完整展示，页面整体滚动
  return `<table class="rec-table"><thead><tr>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** 练度总览内容（并入「全服总览」）：评分分布 / 影画金字塔 / 属性 trade-off。
 *  返回 chart-card 片段（由 renderOverview 统一包 chart-grid）。 */
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
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(tip)}">装配评分分布</h3>${chartBox('prog-relic', Math.max(320, relicRows.length * 18))}</div>`);
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
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(tip)}">影画档位金字塔</h3>${chartBox('prog-pyramid', Math.max(380, pyramidRows.length * 20))}</div>`);
  }

  // 4. 属性 trade-off 表
  if (Object.keys(R.panelCorr || {}).length) {
    const tip = `<b>面板属性相关</b><br><span style="color:var(--dim)">全服玩家面板属性对的皮尔逊相关：绿=正相关（同涨同跌）· 红=负相关（此消彼长）· 灰=无明显关系；悬浮看具体相关系数</span>`;
    cards.push(`<div class="chart-card" style="grid-column:1/-1"><h3 data-detail="${escapeHtml(tip)}">面板属性相关</h3>${panelCorrTableHtml()}</div>`);
  }

  return cards.join('');
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
