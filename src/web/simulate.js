// src/web/simulate.js —— 成长极限模拟视图：选择角色/音擎/套装/456 主词条后，
// 生成任意两个面板属性之间的帕累托有效前沿，并支持临时叠加多张图。
import { library, charIndex, wengineIndex, discIndex, myCharacters, plansByName, readCharTarget } from './data.js';
import { PANEL_ORDER, MAIN_STAT_OPTIONS, TARGET_KEYS } from '../lib/constants.js';
import { simulateFrontier, simulateFrontier3D, simulateFixedPanel, axisAvailable } from '../lib/simulate.js';
import { escapeHtml, formatValue } from '../lib/util.js';
import { notify } from './util.js';
import { clearCharts, registerChart, chartBox, CHART_COLORS } from './charts.js';

// 重渲染回调由 ui.js 注入（render 函数在 render.js，避免循环依赖）。
let rerender = () => {};
export function setSimRerender(fn) {
  rerender = fn;
}

// ---------- echarts-gl 按需加载（625KB，仅三维图需要） ----------
// index.html 不再预载 echarts-gl：页面打开（含统计视图）不解析这 625KB，
// 首次「添加三维图」时才注入脚本；加载完成后才创建 3D 图（见 simAddChart）。
let glPromise = null;
function ensureEchartsGl() {
  if (window.echarts?.gl) return Promise.resolve();
  glPromise =
    glPromise ||
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/src/vendor/echarts-gl.min.js';
      s.onload = () => resolve();
      s.onerror = () => {
        glPromise = null; // 失败可重试
        reject(new Error('三维图组件加载失败，请刷新页面重试'));
      };
      document.head.appendChild(s);
    });
  return glPromise;
}

let nextChartId = 1;
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

  // 音擎：目标/方案推荐优先，其次同特性，最后第一个。
  const wengineNames = sortedNames(library.wengines);
  const wanted = target[TARGET_KEYS.WENGINE] || plan?.weapon?.main || '';
  state.wengineName = library.wengines[wanted]
    ? wanted
    : wengineNames.find((n) => library.wengines[n].trait === role?.trait) || wengineNames[0] || '';

  // 套装与 456 主词条：优先取方案第一条 4+2 推荐，否则取第一个盘/各槽第一个候选。
  const discNames = sortedNames(library.discs);
  const set4 = (plan?.sets || []).find((s) => s.cnt === 4)?.name || discNames[0] || '';
  const set2 = (plan?.sets || []).find((s) => s.cnt === 2)?.name || discNames[1] || discNames[0] || '';
  state.set4 = set4;
  state.set2 = set2 === set4 ? discNames.find((n) => n !== set4) || '' : set2;
  for (const slot of [4, 5, 6]) {
    state['main' + slot] =
      target[TARGET_KEYS['MAIN' + slot]] || plan?.mainProps?.[slot] || MAIN_STAT_OPTIONS[slot][0] || '';
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
  return (
    '<option value="' +
    escapeHtml(value) +
    '"' +
    (value === current ? ' selected' : '') +
    '>' +
    escapeHtml(label) +
    '</option>'
  );
}

function selectHtml(id, label, current, options) {
  return (
    '<div class="titem"><label>' +
    escapeHtml(label) +
    '</label>' +
    '<select data-sim="' +
    id +
    '" onchange="ZZZ.simSelect(' +
    "'" +
    id +
    "'" +
    ', this.value)">' +
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
    '<div class="titem"><label>' +
    slot +
    '号位主词条</label>' +
    '<select data-sim="' +
    id +
    '" onchange="ZZZ.simSelect(' +
    "'" +
    id +
    "'" +
    ', this.value)">' +
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
  return (
    '<div class="sim-fixed">固定面板（满级 + 音擎 + 456 主词条 + 2件套，不含副词条）<div class="sim-fixed-row">' +
    out +
    '</div></div>'
  );
}

function frontierOption(points, xName, yName, myPoint) {
  if (!points.length) return {};
  const data = points.map((p) => [p.x, p.y]);
  const series = [
    {
      name: '有效前沿',
      type: 'line',
      data: data,
      showSymbol: true,
      symbolSize: 5,
      lineStyle: { color: CHART_COLORS.acc, width: 2 },
      itemStyle: { color: CHART_COLORS.acc },
      areaStyle: { color: 'rgba(255,212,0,0.08)' },
    },
  ];
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
  return {
    animation: false,
    grid: { left: 78, right: 32, top: 34, bottom: 58 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART_COLORS.card,
      borderColor: CHART_COLORS.line,
      textStyle: { color: '#f0ede2', fontSize: 12 },
      formatter: function (params) {
        const list = Array.isArray(params) ? params : [params];
        const line = list.find((p) => p.seriesName === '有效前沿');
        if (!line) return '';
        const v = line.value || [];
        let html = xName + ' ' + formatValue(xName, v[0]) + '<br>' + yName + ' ' + formatValue(yName, v[1]);
        if (myPoint && list.some((p) => p.seriesName === '我的面板')) {
          html +=
            '<br><span style="color:' +
            CHART_COLORS.orange +
            '">我的面板 ' +
            formatValue(xName, myPoint.x) +
            ' / ' +
            formatValue(yName, myPoint.y) +
            '</span>';
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

function axisOptionsFor(chart, axis) {
  const others = ['x', 'y', 'z']
    .filter((k) => k !== axis)
    .map((k) => chart[k])
    .filter(Boolean);
  return PANEL_ORDER.filter((s) => axisAvailable(s) && !others.includes(s));
}

function axisSelectHtml(chart, axis, label) {
  return (
    '<div class="titem"><label>' +
    escapeHtml(label) +
    '</label>' +
    '<select onchange="ZZZ.simAxis(' +
    chart.id +
    ",'" +
    axis +
    '\', this.value)">' +
    axisOptionsFor(chart, axis)
      .map((n) => optionHtml(n, n, chart[axis]))
      .join('') +
    '</select></div>'
  );
}

function frontier3DOption(points, xName, yName, zName, myPoint) {
  if (!points.length) return {};
  const series = [
    {
      name: '有效前沿',
      type: 'scatter3D',
      data: points.map((p) => [p.x, p.y, p.z]),
      symbolSize: 7,
      itemStyle: { color: 'rgba(255,212,0,0.85)' },
    },
  ];
  if (myPoint) {
    series.push({
      name: '我的面板',
      type: 'scatter3D',
      data: [[myPoint.x, myPoint.y, myPoint.z]],
      symbolSize: 14,
      itemStyle: { color: CHART_COLORS.orange, borderColor: '#0a0a0a', borderWidth: 1 },
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
        const head =
          p.seriesName === '我的面板' ? '<span style="color:' + CHART_COLORS.orange + '">我的面板</span><br>' : '';
        return (
          head +
          xName +
          ' ' +
          formatValue(xName, v[0]) +
          '<br>' +
          yName +
          ' ' +
          formatValue(yName, v[1]) +
          '<br>' +
          zName +
          ' ' +
          formatValue(zName, v[2])
        );
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
    if (is3d) {
      const result = simulateFrontier3D(
        { charIndex, wengineIndex, discIndex },
        { ...state, xAxis: chart.x, yAxis: chart.y, zAxis: chart.z }
      );
      if (!result.points.length) {
        body = '<div class="empty">该属性组合暂无有效前沿（可能所选属性无法通过副词条成长）。</div>';
      } else {
        const my = (myCharacters || []).find((c) => c.name === state.charName);
        let myPoint = null;
        if (my) {
          const R = my.calculate();
          const mx = R.actual?.[chart.x]?.final ?? R.final?.[chart.x];
          const myy = R.actual?.[chart.y]?.final ?? R.final?.[chart.y];
          const mz = R.actual?.[chart.z]?.final ?? R.final?.[chart.z];
          if (Number.isFinite(mx) && Number.isFinite(myy) && Number.isFinite(mz)) myPoint = { x: mx, y: myy, z: mz };
        }
        registerChart('sim-' + chart.id, frontier3DOption(result.points, chart.x, chart.y, chart.z, myPoint));
        body = chartBox('sim-' + chart.id, 540);
        note =
          '<div class="sim-range">' +
          result.points.length +
          ' 个前沿点' +
          (myPoint ? '　·　<span style="color:var(--orange)">我的面板已标注</span>' : '') +
          '</div>';
      }
    } else {
      const result = simulateFrontier(
        { charIndex, wengineIndex, discIndex },
        { ...state, xAxis: chart.x, yAxis: chart.y }
      );
      if (!result.points.length) {
        body = '<div class="empty">该属性组合暂无有效前沿（可能所选属性无法通过副词条成长）。</div>';
      } else {
        const my = (myCharacters || []).find((c) => c.name === state.charName);
        let myPoint = null;
        if (my) {
          const R = my.calculate();
          const mx = R.actual?.[chart.x]?.final ?? R.final?.[chart.x];
          const myy = R.actual?.[chart.y]?.final ?? R.final?.[chart.y];
          if (Number.isFinite(mx) && Number.isFinite(myy)) myPoint = { x: mx, y: myy };
        }
        registerChart('sim-' + chart.id, frontierOption(result.points, chart.x, chart.y, myPoint));
        body = chartBox('sim-' + chart.id, 430);
        const p0 = result.points[0];
        const p1 = result.points[result.points.length - 1];
        note =
          '<div class="sim-range">' +
          formatValue(chart.x, p0.x) +
          ' ~ ' +
          formatValue(chart.x, p1.x) +
          '　·　' +
          formatValue(chart.y, p1.y) +
          ' ~ ' +
          formatValue(chart.y, p0.y) +
          (myPoint
            ? '　·　<span style="color:var(--orange)">我的 ' +
              formatValue(chart.x, myPoint.x) +
              ' / ' +
              formatValue(chart.y, myPoint.y) +
              '</span>'
            : '') +
          '</div>';
      }
    }
  } catch (e) {
    body = '<div class="empty">计算失败：' + escapeHtml(e.message) + '</div>';
  }
  return (
    '<div class="chart-card sim-chart-card">' +
    '<div class="sim-chart-head">' +
    '<div class="sim-axis-row">' +
    axisSelectHtml(chart, 'x', is3d ? 'X 轴' : 'X 轴') +
    axisSelectHtml(chart, 'y', is3d ? 'Y 轴' : 'Y 轴') +
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

export async function simAddChart(kind) {
  const is3d = kind === '3d';
  if (is3d) {
    try {
      await ensureEchartsGl(); // 首次添加三维图：先加载 echarts-gl，避免 scatter3D 未注册
    } catch (e) {
      notify(e.message, 8);
      return;
    }
  }
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
    '<p class="sim-desc">每枚盘按 S 级满级、4 初始副词条 + 5 次强化计算；副词条不与本盘主词条重复。只把副词条强化次数分配到 X/Y 两个属性，其余槽位视为废词条；4 件套条件效果不计入面板。</p>' +
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
  return (
    '<div class="wiki"><div class="sim-wrap">' +
    config +
    '<div class="chart-grid">' +
    cards +
    '</div>' +
    addBtn +
    '</div></div>'
  );
}
