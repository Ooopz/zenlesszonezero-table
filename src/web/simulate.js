// src/web/simulate.js —— 成长极限模拟视图：选择角色/音擎/套装/456 主词条后，
// 生成任意两个或三个面板属性之间的帕累托有效前沿，并支持临时叠加多张图。
import { library, charIndex, wengineIndex, discIndex, myCharacters, plansByName, readCharTarget } from './data.js';
import { PANEL_ORDER, MAIN_STAT_OPTIONS, TARGET_KEYS } from '../lib/constants.js';
import { simulateFrontier3D, simulateFrontierLevels, simulateFixedPanel, axisAvailable, axisSubstatTypes, axisRollCap } from '../lib/simulate.js';
import { escapeHtml, formatValue } from '../lib/util.js';
import { clearCharts, registerChart, chartBox, CHART_COLORS } from './charts.js';

let rerender = () => {};
export function setSimRerender(fn) {
  rerender = fn;
}

let nextChartId = 1;
const simCache = new Map();
function simCacheKey(kind, chart, maxRolls) {
  return JSON.stringify([state.charName, state.wengineName, state.set2, state.set4, state.main4, state.main5, state.main6, kind, chart.x, chart.y, chart.z, maxRolls]);
}
const state = {
  charName: '',
  wengineName: '',
  set2: '',
  set4: '',
  main4: '',
  main5: '',
  main6: '',
  charts: [],
};

function sortedNames(obj) {
  return Object.keys(obj || {}).sort((a, b) => a.localeCompare(b, 'zh'));
}

function firstPlan(roleName) {
  const entry = plansByName[roleName];
  return entry?.plans?.[0] || null;
}

function defaultAxes(roleName) {
  const trait = library.characters[roleName]?.trait || '';
  if (trait === '异常') return { kind: '2d', x: '攻击力', y: '异常精通' };
  if (trait === '强攻') return { kind: '2d', x: '暴击率', y: '暴击伤害' };
  if (trait === '击破') return { kind: '2d', x: '攻击力', y: '暴击率' };
  if (trait === '支援') return { kind: '2d', x: '攻击力', y: '异常精通' };
  return { kind: '2d', x: '攻击力', y: '暴击率' };
}

function default3DAxes(roleName) {
  const trait = library.characters[roleName]?.trait || '';
  if (trait === '异常') return { kind: '3d', x: '攻击力', y: '异常精通', z: '暴击率' };
  if (trait === '强攻') return { kind: '3d', x: '暴击率', y: '暴击伤害', z: '攻击力' };
  if (trait === '击破') return { kind: '3d', x: '攻击力', y: '暴击率', z: '异常精通' };
  return { kind: '3d', x: '攻击力', y: '暴击率', z: '暴击伤害' };
}

function applyRoleDefaults(roleName) {
  state.charName = roleName;
  const role = library.characters[roleName];
  const target = readCharTarget(roleName);
  const plan = firstPlan(roleName);

  const wengineNames = sortedNames(library.wengines);
  const wanted = target[TARGET_KEYS.WENGINE] || plan?.weapon?.main || '';
  state.wengineName = library.wengines[wanted]
    ? wanted
    : wengineNames.find((n) => library.wengines[n].trait === role?.trait) || wengineNames[0] || '';

  const discNames = sortedNames(library.discs);
  const set4 = (plan?.sets || []).find((s) => s.cnt === 4)?.name || discNames[0] || '';
  const set2 = (plan?.sets || []).find((s) => s.cnt === 2)?.name || discNames[1] || discNames[0] || '';
  state.set4 = set4;
  state.set2 = set2 === set4 ? (discNames.find((n) => n !== set4) || '') : set2;
  for (const slot of [4, 5, 6]) {
    state['main' + slot] = target[TARGET_KEYS['MAIN' + slot]] || plan?.mainProps?.[slot] || MAIN_STAT_OPTIONS[slot][0] || '';
  }

  state.charts = [{ id: nextChartId++, ...defaultAxes(roleName) }];
}

function ensureState() {
  if (state.charName) return;
  const charNames = sortedNames(library.characters);
  const myName = (myCharacters || []).map((c) => c.name).find((n) => library.characters[n]);
  applyRoleDefaults(myName || charNames[0] || '');
}

function optionHtml(value, label, current) {
  return '<option value="' + escapeHtml(value) + '"' + (value === current ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

function selectHtml(id, label, current, options) {
  return (
    '<div class="titem"><label>' + escapeHtml(label) + '</label>' +
    '<select data-sim="' + id + '" onchange="ZZZ.simSelect(' + "'" + id + "'" + ', this.value)">' +
    '<option value="">—</option>' +
    options.map((n) => optionHtml(n, n, current)).join('') +
    '</select></div>'
  );
}

function mainSelectHtml(slot) {
  const id = 'main' + slot;
  const options = MAIN_STAT_OPTIONS[slot] || [];
  const current = state[id] || '';
  return (
    '<div class="titem"><label>' + slot + '号位主词条</label>' +
    '<select data-sim="' + id + '" onchange="ZZZ.simSelect(' + "'" + id + "'" + ', this.value)">' +
    '<option value="">—</option>' +
    options.map((n) => optionHtml(n, n, current)).join('') +
    '</select></div>'
  );
}

function fixedSummary() {
  let out;
  try {
    const fixed = simulateFixedPanel({ charIndex, wengineIndex, discIndex }, state);
    const keys = PANEL_ORDER.concat(Object.keys(fixed).filter((k) => !PANEL_ORDER.includes(k)));
    const parts = keys
      .filter((s) => fixed[s] != null && fixed[s] !== 0)
      .map((s) => '<span class="sim-fixed-item"><b>' + escapeHtml(s) + '</b> ' + formatValue(s, fixed[s]) + '</span>');
    out = parts.join('');
  } catch (e) {
    out = '<span style="color:var(--red)">固定面板计算失败：' + escapeHtml(e.message) + '</span>';
  }
  return '<div class="sim-fixed">固定面板（满级 + 音擎 + 456 主词条 + 2件套，不含副词条）<div class="sim-fixed-row">' + out + '</div></div>';
}

function axisOptionsFor(chart, axis) {
  const others = ['x', 'y', 'z'].filter((k) => k !== axis).map((k) => chart[k]).filter(Boolean);
  return PANEL_ORDER.filter((s) => axisAvailable(s) && !others.includes(s));
}

function axisSelectHtml(chart, axis, label) {
  return (
    '<div class="titem"><label>' + escapeHtml(label) + '</label>' +
    '<select onchange="ZZZ.simAxis(' + chart.id + ',\'' + axis + '\', this.value)">' +
    axisOptionsFor(chart, axis).map((n) => optionHtml(n, n, chart[axis])).join('') +
    '</select></div>'
  );
}

function frontierOption(frontiers, xName, yName, myPoint) {
  if (!frontiers || !frontiers.length) return {};
  const levelDefs = [
    { level: 1, name: '完美毕业', color: CHART_COLORS.acc, type: 'solid', width: 2 },
    { level: 0.8, name: '大毕业', color: CHART_COLORS.green, type: 'dashed', width: 2 },
    { level: 0.7, name: '小毕业', color: CHART_COLORS.blue, type: 'dotted', width: 2 },
  ];
  const lookups = frontiers.map((f) => {
    const def = levelDefs.find((d) => d.level === f.level) || levelDefs[0];
    return { name: def.name, color: def.color, points: f.points };
  });
  const series = lookups.map((l) => ({
    name: l.name,
    type: 'line',
    data: l.points.map((p) => [p.x, p.y]),
    showSymbol: false,
    lineStyle: { color: l.color, width: 2, type: levelDefs.find((d) => d.name === l.name)?.type || 'solid' },
    itemStyle: { color: l.color },
  }));
  if (myPoint) {
    series.push({
      name: '我的面板',
      type: 'scatter',
      data: [[myPoint.x, myPoint.y]],
      symbol: 'diamond',
      symbolSize: 13,
      itemStyle: { color: CHART_COLORS.orange, borderColor: '#0a0a0a', borderWidth: 1 },
      z: 4,
    });
  }

  function interpY(points, x) {
    if (!points || !points.length) return null;
    if (x <= points[0].x) return points[0].y;
    if (x >= points[points.length - 1].x) return points[points.length - 1].y;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / (b.x - a.x || 1);
        return a.y + t * (b.y - a.y);
      }
    }
    return points[points.length - 1].y;
  }

  return {
    animation: false,
    grid: { left: 78, right: 32, top: 40, bottom: 58 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART_COLORS.card,
      borderColor: CHART_COLORS.line,
      textStyle: { color: '#f0ede2', fontSize: 12 },
      formatter: function (params) {
        const list = Array.isArray(params) ? params : [params];
        const first = list.find((p) => p.value && p.value.length);
        if (!first) return '';
        const x = first.value[0];
        let html = xName + ' ' + formatValue(xName, x) + '<br>';
        for (const l of lookups) {
          const y = interpY(l.points, x);
          html += '<span style="color:' + l.color + '">' + l.name + '</span>　' + formatValue(yName, y) + '<br>';
        }
        if (myPoint && list.some((p) => p.seriesName === '我的面板')) {
          html += '<br><span style="color:' + CHART_COLORS.orange + '">我的面板 ' + formatValue(xName, myPoint.x) + ' / ' + formatValue(yName, myPoint.y) + '</span>';
        }
        return html;
      },
    },
    xAxis: {
      type: 'value',
      scale: true,
      name: xName,
      nameTextStyle: { color: CHART_COLORS.dim },
      axisLine: { lineStyle: { color: CHART_COLORS.line } },
      axisLabel: { color: CHART_COLORS.dim, fontSize: 11 },
      splitLine: { lineStyle: { color: CHART_COLORS.line } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: yName,
      nameTextStyle: { color: CHART_COLORS.dim },
      axisLine: { lineStyle: { color: CHART_COLORS.line } },
      axisLabel: { color: CHART_COLORS.dim, fontSize: 11 },
      splitLine: { lineStyle: { color: CHART_COLORS.line } },
    },
    series: series,
  };
}

function scalePointCloud(points, fixedPoint, level) {
  return points.map((p) => ({
    x: fixedPoint.x + (p.x - fixedPoint.x) * level,
    y: fixedPoint.y + (p.y - fixedPoint.y) * level,
    z: fixedPoint.z + (p.z - fixedPoint.z) * level,
  }));
}

function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}

function rollGraduationHtml(effRolls, maxRolls) {
  const labels = [
    { key: 'perfect', label: '完美毕业', pct: clampPct((effRolls / maxRolls) * 100) },
    { key: 'big', label: '大毕业', pct: clampPct((effRolls / (maxRolls * 0.8)) * 100) },
    { key: 'small', label: '小毕业', pct: clampPct((effRolls / (maxRolls * 0.7)) * 100) },
  ];
  const colors = { perfect: CHART_COLORS.acc, big: CHART_COLORS.green, small: CHART_COLORS.blue };
  const items = labels.map((x) => {
    return '<span class="sim-grad" style="border-color:' + colors[x.key] + '"><b>' + x.label + '</b> ' + x.pct.toFixed(0) + '%</span>';
  });
  return '<div class="sim-grads">毕业度（有效强化次数）：' + items.join('') + '</div>';
}

function frontier3DOption(frontiers, xName, yName, zName, myPoint) {
  if (!frontiers || !frontiers.length) return {};
  const levelDefs = [
    { level: 1, name: '完美毕业', color: 'rgba(255,212,0,0.85)' },
    { level: 0.8, name: '大毕业', color: 'rgba(124,231,168,0.55)' },
    { level: 0.7, name: '小毕业', color: 'rgba(86,184,255,0.35)' },
  ];
  const series = frontiers.map((f) => {
    const def = levelDefs.find((d) => d.level === f.level) || levelDefs[0];
    return {
      name: def.name,
      type: 'scatter3D',
      data: f.points.map((p) => [p.x, p.y, p.z]),
      symbolSize: 6,
      itemStyle: { color: def.color },
    };
  });
  if (myPoint) {
    series.push({
      name: '我的面板',
      type: 'scatter3D',
      data: [[myPoint.x, myPoint.y, myPoint.z]],
      symbolSize: 14,
      itemStyle: { color: CHART_COLORS.orange },
    });
  }
  const axisBase = (name) => ({
    type: 'value',
    name: name,
    nameTextStyle: { color: CHART_COLORS.dim },
    axisLine: { lineStyle: { color: CHART_COLORS.line } },
    axisLabel: { color: CHART_COLORS.dim, fontSize: 11 },
    splitLine: { lineStyle: { color: CHART_COLORS.line } },
  });
  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      backgroundColor: CHART_COLORS.card,
      borderColor: CHART_COLORS.line,
      textStyle: { color: '#f0ede2', fontSize: 12 },
      formatter: function (params) {
        const p = Array.isArray(params) ? params[0] : params;
        const v = p && p.value ? p.value : [];
        if (!v || v.length < 3) return '';
        const head = p.seriesName === '我的面板' ? '<span style="color:' + CHART_COLORS.orange + '">我的面板</span><br>' : '';
        return head + xName + ' ' + formatValue(xName, v[0]) + '<br>' + yName + ' ' + formatValue(yName, v[1]) + '<br>' + zName + ' ' + formatValue(zName, v[2]);
      },
    },
    grid3D: {
      axisLine: { lineStyle: { color: CHART_COLORS.line } },
      axisLabel: { color: CHART_COLORS.dim, fontSize: 11 },
      splitLine: { lineStyle: { color: CHART_COLORS.line } },
      viewControl: { projection: 'perspective', autoRotate: false, distance: 220, alpha: 20, beta: 45 },
    },
    xAxis3D: axisBase(xName),
    yAxis3D: axisBase(yName),
    zAxis3D: axisBase(zName),
    series: series,
  };
}

function chartCard(chart, canRemove) {
  const is3d = chart.kind === '3d';
  let body;
  let note = '';
  try {
    const my = (myCharacters || []).find((c) => c.name === state.charName);
    const axes = is3d ? [chart.x, chart.y, chart.z] : [chart.x, chart.y];
    const axisTypes = axisSubstatTypes(axes);
    const effRolls = my
      ? (my.discs || []).reduce((sum, d) => sum + (d.getHitCount(axisTypes) ?? 0), 0)
      : 0;
    const maxRolls = axisRollCap(
      { charIndex, wengineIndex, discIndex },
      { ...state, xAxis: axes[0], yAxis: axes[1], zAxis: axes[2] },
      axes
    );
    let myPoint = null;
    if (my) {
      const R = my.calculate();
      const mx = R.actual?.[chart.x]?.final ?? R.final?.[chart.x];
      const myy = R.actual?.[chart.y]?.final ?? R.final?.[chart.y];
      if (Number.isFinite(mx) && Number.isFinite(myy)) myPoint = { x: mx, y: myy };
    }
    if (is3d) {
      const ck3 = simCacheKey('3d', chart, maxRolls);
      let result = simCache.get(ck3);
      if (!result) {
        result = simulateFrontier3D(
          { charIndex, wengineIndex, discIndex },
          { ...state, xAxis: chart.x, yAxis: chart.y, zAxis: chart.z }
        );
        simCache.set(ck3, result);
      }
      if (!result.points.length) {
        body = '<div class="empty">该属性组合暂无有效前沿（可能所选属性无法通过副词条成长）。</div>';
      } else {
        const R3 = my ? my.calculate() : null;
        const mz = R3 ? (R3.actual?.[chart.z]?.final ?? R3.final?.[chart.z]) : null;
        if (myPoint && Number.isFinite(mz)) myPoint = { x: myPoint.x, y: myPoint.y, z: mz };
        const fixedPoint = { x: result.fixed[chart.x], y: result.fixed[chart.y], z: result.fixed[chart.z] };
        const frontiers = [1, 0.8, 0.7].map((level) => ({
          level,
          points: level === 1 ? result.points : scalePointCloud(result.points, fixedPoint, level),
        }));
        registerChart('sim-' + chart.id, frontier3DOption(frontiers, chart.x, chart.y, chart.z, myPoint));
        body = chartBox('sim-' + chart.id, 540);
        const grads = rollGraduationHtml(effRolls, maxRolls);
        note =
          '<div class="sim-range">毕业基准：完美 ' + maxRolls + ' / 大毕业 ' + Math.round(maxRolls * 0.8) + ' / 小毕业 ' + Math.round(maxRolls * 0.7) + ' 个有效强化次数</div>' +
          grads;
      }
    } else {
      const ck2 = simCacheKey('2d', chart, maxRolls);
      let result = simCache.get(ck2);
      if (!result) {
        result = simulateFrontierLevels(
          { charIndex, wengineIndex, discIndex },
          { ...state, xAxis: chart.x, yAxis: chart.y },
          maxRolls
        );
        simCache.set(ck2, result);
      }
      if (!result.frontiers.length || !result.frontiers.some((f) => f.points.length)) {
        body = '<div class="empty">该属性组合暂无有效前沿（可能所选属性无法通过副词条成长）。</div>';
      } else {
        registerChart('sim-' + chart.id, frontierOption(result.frontiers, chart.x, chart.y, myPoint));
        body = chartBox('sim-' + chart.id, 430);
        const grads = rollGraduationHtml(effRolls, maxRolls);
        note =
          '<div class="sim-range">毕业基准：完美 ' + maxRolls + ' / 大毕业 ' + Math.round(maxRolls * 0.8) + ' / 小毕业 ' + Math.round(maxRolls * 0.7) + ' 个有效强化次数</div>' +
          grads;
      }
    }
  } catch (e) {
    body = '<div class="empty">计算失败：' + escapeHtml(e.message) + '</div>';
  }
  return (
    '<div class="chart-card sim-chart-card">' +
    '<div class="sim-chart-head">' +
    '<div class="sim-axis-row">' +
    axisSelectHtml(chart, 'x', 'X 轴') +
    axisSelectHtml(chart, 'y', 'Y 轴') +
    (is3d ? axisSelectHtml(chart, 'z', 'Z 轴') : '') +
    (canRemove ? '<button class="mini sim-remove" onclick="ZZZ.simRemoveChart(' + chart.id + ')">移除</button>' : '') +
    '</div>' +
    note +
    '</div>' +
    body +
    '</div>'
  );
}

export function simSelect(key, value) {
  if (key === 'charName' && value && value !== state.charName) {
    applyRoleDefaults(value);
  } else {
    state[key] = value;
  }
  rerender();
}

export function simAxis(id, axis, value) {
  const chart = state.charts.find((c) => c.id === Number(id));
  if (!chart) return;
  chart[axis] = value;
  rerender();
}

export function simAddChart(kind) {
  const is3d = kind === '3d';
  if (is3d) {
    const used = new Set(state.charts.filter((c) => c.kind === '3d').map((c) => c.x + '/' + c.y + '/' + c.z));
    const fallback = [
      default3DAxes(state.charName),
      { kind: '3d', x: '暴击率', y: '暴击伤害', z: '攻击力' },
      { kind: '3d', x: '攻击力', y: '异常精通', z: '暴击率' },
      { kind: '3d', x: '攻击力', y: '暴击率', z: '穿透值' },
    ];
    const pick = fallback.find((p) => !used.has(p.x + '/' + p.y + '/' + p.z)) || fallback[0];
    state.charts.push({ id: nextChartId++, ...pick });
  } else {
    const last = state.charts[state.charts.length - 1] || { kind: '2d', x: '攻击力', y: '暴击率' };
    const used = new Set(state.charts.filter((c) => c.kind !== '3d').map((c) => c.x + '/' + c.y));
    const fallback = [
      defaultAxes(state.charName),
      { kind: '2d', x: '暴击率', y: '暴击伤害' },
      { kind: '2d', x: '攻击力', y: '暴击率' },
      { kind: '2d', x: '攻击力', y: '异常精通' },
    ];
    const pick = fallback.find((p) => !used.has(p.x + '/' + p.y)) || { kind: '2d', x: last.x, y: last.y };
    state.charts.push({ id: nextChartId++, ...pick });
  }
  rerender();
}

export function simRemoveChart(id) {
  if (state.charts.length <= 1) return;
  state.charts = state.charts.filter((c) => c.id !== Number(id));
  rerender();
}

export function renderSimulate() {
  ensureState();
  clearCharts();
  const charOptions = sortedNames(library.characters);
  const wengineOptions = sortedNames(library.wengines);
  const discOptions = sortedNames(library.discs);
  const config =
    '<div class="sim-config chart-card">' +
    '<h3>成长极限模拟</h3>' +
    '<p class="sim-desc">每枚盘按 S 级满级、4 初始副词条 + 5 次强化计算；副词条不与本盘主词条重复。只把副词条强化次数分配到 X/Y（或 X/Y/Z）轴，其余槽位视为废词条；4 件套条件效果不计入面板。</p>' +
    '<div class="tgrid sim-grid">' +
    selectHtml('charName', '角色', state.charName, charOptions) +
    selectHtml('wengineName', '音擎', state.wengineName, wengineOptions) +
    selectHtml('set4', '四件套', state.set4, discOptions) +
    selectHtml('set2', '二件套', state.set2, discOptions) +
    mainSelectHtml(4) +
    mainSelectHtml(5) +
    mainSelectHtml(6) +
    '</div>' +
    fixedSummary() +
    '</div>';

  const cards = state.charts.map((c) => chartCard(c, state.charts.length > 1)).join('');
  const addBtn =
    '<div class="sim-add-row"><button class="primary" onclick="ZZZ.simAddChart(\'2d\')">＋ 添加二维图</button><button class="primary" onclick="ZZZ.simAddChart(\'3d\')">＋ 添加三维图</button><span class="sim-tip">二维图选择 X/Y 轴；三维图选择 X/Y/Z 轴，可拖拽旋转视角。</span></div>';
  return '<div class="wiki"><div class="sim-wrap">' + config + '<div class="chart-grid">' + cards + '</div>' + addBtn + '</div></div>';
}
