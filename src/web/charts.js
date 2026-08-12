// src/web/charts.js —— ECharts 图表辅助：主题色 / 容器注册 / 渲染挂载 + 各图表 option 构建
// 依赖 index.html 引入的 window.echarts（本地 vendor）。视觉匹配项目暗色 + 金色 accent 主题。
/* global echarts */
import { formatValue } from '../lib/util.js';

/** 项目主题色（对应 style.css :root 变量） */
export const CHART_COLORS = {
  acc: '#f7d41d',
  acc2: '#ffb300',
  green: '#7fd8a4',
  orange: '#ff9b5c',
  red: '#e5484d',
  blue: '#59b7ff',
  purple: '#b48cff',
  dim: '#8b8a83',
  line: '#2b2b2b',
  bg: '#171717',
  card: '#1e1e1e',
};

const AXIS_LINE = { lineStyle: { color: '#2b2b2b' } };
const AXIS_LABEL = { color: '#8b8a83', fontSize: 10 };
const SPLIT_LINE = { lineStyle: { color: '#222' } };

/** 图表通用 grid 边距 */
export const CHART_GRID = { left: 44, right: 20, top: 40, bottom: 30, containLabel: true };

/** 已注册待挂载的图表 option：key → option */
let pending = {};
/** 已初始化的 ECharts 实例（供 resize） */
const instances = new Map();

/** 注册一个图表 option（渲染函数在返回 chartBox 时调用） */
export function registerChart(key, option) {
  pending[key] = option;
}
/** 清空待挂载（每次 renderRecommend 开头调用） */
export function clearCharts() {
  pending = {};
}
/** 生成图表容器 HTML（render 后由 mountCharts 初始化） */
export function chartBox(key, height = 380) {
  return `<div class="chart-init" data-chart="${key}" style="height:${height}px"></div>`;
}
/** 挂载所有 .chart-init 容器（renderRecommend 后由 render.js 调用） */
export function mountCharts() {
  document.querySelectorAll('.chart-init').forEach((el) => {
    const key = el.dataset.chart;
    const opt = pending[key];
    if (!opt || typeof echarts === 'undefined') return;
    if (instances.has(key)) instances.get(key).dispose();
    const chart = echarts.init(el);
    chart.setOption(opt);
    instances.set(key, chart);
  });
}
/** 窗口尺寸变化时 resize 所有已挂载图表（render.js 可调用） */
export function resizeCharts() {
  for (const c of instances.values()) c.resize();
}

// ---------- 公共 option 片段 ----------
/** 基础坐标轴样式（暗色） */
export function baseXAxis(cats) {
  return { type: 'category', data: cats, axisLine: AXIS_LINE, axisLabel: AXIS_LABEL, axisTick: { show: false } };
}
export function baseYAxis() {
  return { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE };
}
/** 暗色 tooltip */
export const DARK_TOOLTIP = {
  backgroundColor: '#1e1e1e',
  borderColor: '#f7d41d',
  textStyle: { color: '#eee', fontSize: 12 },
};

// ---------- 各图表的 option 构建函数（数据由 recommend.js 各面板准备） ----------


/** 达标热力图：角色×属性，色 = 我的玩家百分位，悬浮标注是否达推荐中档 */
export function heatmapOption(data, attrs) {
  // data: [{name, cells: [{pct, reached}|null]}]，attrs: 属性列表
  const rows = [];
  data.forEach((r, i) => {
    r.cells.forEach((c, j) => {
      // NaN/非有限值转 null，杜绝格子显示 NaN
      rows.push([j, i, c == null || !Number.isFinite(c.pct) ? null : c.pct]);
    });
  });
  return {
    grid: { left: 110, right: 20, top: 20, bottom: 70 },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const c = data[p.value[1]]?.cells[p.value[0]];
        if (!c || c.pct == null || !Number.isFinite(c.pct)) return '无数据';
        const hit = c.reached ? `<span style="color:#7fd8a4">✓ 达到推荐中档</span>` : `<span style="color:#ff9b5c">未达推荐中档</span>`;
        return `${attrs[p.value[0]]}<br>玩家百分位 <b>${Math.round(c.pct)}%</b><br>${hit}`;
      },
    },
    xAxis: { ...baseXAxis(attrs), axisLabel: { ...AXIS_LABEL, interval: 0, rotate: 35 } },
    yAxis: { type: 'category', data: data.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    visualMap: {
      min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#4a1a1a', '#8a4a1e', '#d4a81e', '#4caf7a'] }, // 深红→橙→金→绿，色阶鲜明
      textStyle: { color: '#8b8a83' },
    },
    series: [
      {
        type: 'heatmap', data: rows,
        label: { show: false }, // 不显示格子内数字，格子颜色传达百分位（悬浮看具体值），避免窄格子渲染异常
        itemStyle: { borderColor: '#000', borderWidth: 1 }, // 清晰分隔
      },
    ],
  };
}

/** 共识度散点图：X=玩家 sd、Y=推荐 CV，每角色一点（默认不显示名称，悬浮时高亮并显示） */
export function consensusScatterOption(points) {
  // points: [{name, sd, cv}]
  return {
    grid: CHART_GRID,
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) =>
        `${p.data[2]}<br>玩家分化(sd): <b>${p.data[0].toFixed(1)}</b><br>攻略分歧(CV): <b>${(p.data[1] * 100).toFixed(1)}%</b>`,
    },
    xAxis: { name: '玩家分化(sd)', ...baseYAxis() },
    yAxis: { name: '攻略分歧(CV)', ...baseYAxis() },
    series: [
      {
        type: 'scatter',
        symbolSize: 11,
        data: points.map((p) => [p.sd, p.cv, p.name]),
        itemStyle: { color: CHART_COLORS.purple },
        label: { show: true, formatter: (p) => p.data[2], position: 'top', color: '#8b8a83', fontSize: 10 },
        emphasis: {
          scale: 1.7, // 悬浮放大
          label: {
            show: true,
            formatter: (p) => p.data[2],
            position: 'top',
            color: CHART_COLORS.acc, // 网站金色
            fontSize: 12,
            fontWeight: 'bold',
          },
          itemStyle: { color: CHART_COLORS.acc, borderColor: CHART_COLORS.acc, borderWidth: 1.5 },
        },
      },
    ],
  };
}

/** 每属性独立子图的箱线图（玩家分布箱线 + 推荐三档点 + 个人点）：各属性独立 y 轴刻度，避免量纲差异压缩小数值属性 */
export function violinBoxOption(items) {
  // items: [{attr, dist:{p10,p25,median,p75,p90}, rec:{low,mid,high}, mine}]
  const n = items.length;
  if (!n) return {};
  const pad = 18;
  const width = (100 - pad * (n + 1)) / n;
  const grids = items.map((_, i) => ({
    left: `${pad + i * (width + pad)}%`,
    top: '6%',
    width: `${width}%`,
    height: '68%',
  }));
  const xAxes = items.map((item, i) => ({
    gridIndex: i,
    type: 'category',
    data: [item.attr],
    axisLine: { lineStyle: { color: '#2b2b2b' } },
    axisLabel: { color: '#8b8a83', fontSize: 10, interval: 0 }, // 属性名在箱线正下方，与类目严格对齐
    axisTick: { show: false },
  }));
  const yAxes = items.map((_, i) => ({
    gridIndex: i,
    type: 'value',
    scale: true, // 不强制从 0 开始，让箱线占据更多纵向空间
    axisLine: { show: false },
    axisLabel: { show: false }, // 不显示刻度标签
    splitLine: { show: false }, // 不显示网格刻度线
  }));
  const series = [];
  items.forEach((item, i) => {
    // boxplot 数据序：[下须, Q1, 中位, Q3, 上须]
    series.push({
      type: 'boxplot',
      gridIndex: i,
      xAxisIndex: i,
      yAxisIndex: i,
      data: [[
        item.dist.whiskerLow ?? item.dist.p10,
        item.dist.p25,
        item.dist.median,
        item.dist.p75,
        item.dist.whiskerHigh ?? item.dist.p90,
      ]],
      itemStyle: { color: 'rgba(247,212,29,0.12)', borderColor: CHART_COLORS.acc },
      lineStyle: { color: CHART_COLORS.acc },
    });
    ['low', 'mid', 'high'].forEach((t) => {
      if (item.rec && item.rec[t] != null) {
        series.push({
          type: 'scatter',
          gridIndex: i,
          xAxisIndex: i,
          yAxisIndex: i,
          data: [[0, item.rec[t]]],
          symbolSize: 5,
          itemStyle: { color: CHART_COLORS.blue },
          z: 3,
        });
      }
    });
    if (item.mine != null) {
      series.push({
        type: 'scatter',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: i,
        data: [[0, item.mine]],
        symbolSize: 9,
        itemStyle: { color: CHART_COLORS.orange },
        z: 4,
      });
    }
  });
  return {
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: DARK_TOOLTIP,
    series,
  };
}

/** 值 → 直方图箱索引（超出范围 clamp 到两端） */
function binIndexOf(item, val) {
  if (!item?.hist || val == null) return null;
  const h = item.hist;
  const span = h.bins[h.bins.length - 1] - h.bins[0] || 1;
  return Math.max(0, Math.min(h.counts.length - 1, Math.floor(((val - h.bins[0]) / span) * h.counts.length)));
}
/** 值在玩家分布中的近似累计占比（分位线性插值，0-100） */
function percentileFromDist(v, d) {
  if (v == null || !d || d.p10 == null || d.p99 == null) return null;
  const pts = [
    [d.min, 0], [d.p10, 10], [d.p25, 25], [d.p50, 50], [d.p75, 75], [d.p90, 90], [d.p99, 99], [d.max, 100],
  ];
  if (v <= d.min) return 0;
  if (v >= d.max) return 100;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (v >= x0 && v <= x1) {
      const span = x1 - x0;
      return span === 0 ? y0 : y0 + ((v - x0) / span) * (y1 - y0);
    }
  }
  return 50;
}
/** 玩家分位 → CDF 点 [[箱索引, 累计%], ...]（补全每箱，便于轴触发悬浮显示累计占比） */
function cdfPoints(item) {
  const d = item.dist;
  if (!d || !item.hist || d.p10 == null) return [];
  const h = item.hist;
  const pts = [];
  for (let j = 0; j < h.counts.length; j++) {
    const mid = (h.bins[j] + h.bins[j + 1]) / 2;
    const cum = percentileFromDist(mid, d);
    if (cum != null) pts.push([j, cum]);
  }
  return pts;
}

/** 每属性独立子图的分布形态图：直方图+密度+CDF 叠加，双 y 轴对齐（左 counts / 右 累计%），3 列多行、子图较高 */
export function distShapeOption(items) {
  // items: [{attr, hist:{bins, counts}, dist, mine, minePct}]
  const n = items.length;
  if (!n) return {};
  const COLS = 3;
  const rows = Math.ceil(n / COLS);
  const padX = 4;
  const padY = 7; // 行间距收紧，让子图更紧凑且纵向更高
  const gw = (100 - padX * (COLS + 1)) / COLS;
  const gh = (100 - padY * (rows + 1)) / rows;
  const grids = items.map((_, i) => ({
    left: `${padX + (i % COLS) * (gw + padX)}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY)}%`,
    width: `${gw}%`,
    height: `${gh}%`,
    containLabel: true, // y 轴刻度标签在子图内留足空间，子图变高后刻度清晰可见
  }));
  const titles = items.map((item, i) => ({
    text: item.attr,
    left: `${padX + (i % COLS) * (gw + padX) + gw / 2}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY) - 3}%`,
    textAlign: 'center',
    textStyle: { color: '#8b8a83', fontSize: 11 },
  }));
  const xAxes = items.map((item, i) => ({
    gridIndex: i,
    type: 'category',
    data: item.hist ? item.hist.bins.slice(0, -1).map((b, j) => (b + item.hist.bins[j + 1]) / 2) : [],
    axisLine: { lineStyle: { color: '#2b2b2b' } },
    axisLabel: { show: false },
    axisTick: { show: false },
  }));
  // 双 y 轴对齐：左轴 counts（直方图/密度），右轴累计%（CDF，0-100）
  const yAxes = items.flatMap((_, i) => [
    { gridIndex: i, type: 'value', axisLine: { show: false }, axisLabel: { ...AXIS_LABEL, fontSize: 10 }, splitLine: SPLIT_LINE },
    { gridIndex: i, type: 'value', axisLine: { show: false }, axisLabel: { ...AXIS_LABEL, fontSize: 10, formatter: '{value}%' }, splitLine: { show: false }, min: 0, max: 100 },
  ]);
  const series = [];
  items.forEach((item, i) => {
    if (!item.hist) return;
    // 直方图柱（左轴 counts，name 用于轴悬浮）
    series.push({
      name: `${item.attr}|玩家数`,
      type: 'bar', gridIndex: i, xAxisIndex: i, yAxisIndex: i * 2,
      data: item.hist.counts, barWidth: '70%',
      itemStyle: { color: 'rgba(247,212,29,0.18)' },
    });
    // 密度线（左轴，silent 不参与悬浮避免重复）
    series.push({
      type: 'line', gridIndex: i, xAxisIndex: i, yAxisIndex: i * 2,
      data: item.hist.counts, smooth: true, symbol: 'none',
      lineStyle: { color: CHART_COLORS.acc, width: 1.5 }, silent: true,
    });
    // CDF 累计占比曲线（右轴，补全每箱便于轴悬浮）
    series.push({
      name: `${item.attr}|累计占比`,
      type: 'line', gridIndex: i, xAxisIndex: i, yAxisIndex: i * 2 + 1,
      data: cdfPoints(item), smooth: true, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: CHART_COLORS.blue },
      lineStyle: { color: CHART_COLORS.blue, width: 1.5 },
    });
    // 我的数值点（label 标注，silent 不参与轴悬浮）
    const mineIdx = item.mine != null ? binIndexOf(item, item.mine) : null;
    if (mineIdx != null) {
      series.push({
        type: 'scatter', gridIndex: i, xAxisIndex: i, yAxisIndex: i * 2 + 1,
        data: [[mineIdx, item.minePct != null ? item.minePct : 100]],
        symbolSize: 8,
        itemStyle: { color: CHART_COLORS.orange, borderColor: '#000', borderWidth: 1 },
        label: {
          show: true,
          formatter: item.minePct != null ? `我的 P${Math.round(item.minePct)}` : '我的',
          color: CHART_COLORS.orange, fontSize: 10, position: 'top',
        },
        silent: true,
      });
    }
  });
  // K 线式悬浮：鼠标在 x 位置显示数值区间 + 玩家数 + 累计占比
  return {
    title: titles,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        if (!arr.length) return '';
        const attr = (arr[0].seriesName || '').split('|')[0];
        const it = items.find((x) => x.attr === attr);
        if (!it || !it.hist) return '';
        const j = arr[0].dataIndex;
        const lo = it.hist.bins[j];
        const hi = it.hist.bins[j + 1];
        const range = lo != null && hi != null ? `<br>数值 ${formatValue(it.attr, lo)} ~ ${formatValue(it.attr, hi)}` : '';
        const lines = [];
        for (const p of arr) {
          const [a, type] = (p.seriesName || '').split('|');
          if (a !== attr) continue;
          if (type === '玩家数') lines.push(`${p.marker}玩家数 <b>${p.value}</b>`);
          else if (type === '累计占比') {
            const cum = Array.isArray(p.value) ? p.value[1] : p.value;
            lines.push(`${p.marker}累计占比 <b>${Math.round(cum)}%</b>`);
          }
        }
        return `${attr}${range}<br>${lines.join('<br>')}`;
      },
    },
    series,
  };
}

/** 每属性独立子图的推荐三档山脊图（堆叠面积），3 列多行布局 */
export function ridgeMultiOption(items) {
  // items: [{attr, cats, series:[{name, data}]}]
  const n = items.length;
  if (!n) return {};
  const COLS = 3;
  const rows = Math.ceil(n / COLS);
  const padX = 4;
  const padY = 7;
  const gw = (100 - padX * (COLS + 1)) / COLS;
  const gh = (100 - padY * (rows + 1)) / rows;
  const grids = items.map((_, i) => ({
    left: `${padX + (i % COLS) * (gw + padX)}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY)}%`,
    width: `${gw}%`,
    height: `${gh}%`,
    containLabel: true,
  }));
  const titles = items.map((item, i) => ({
    text: item.attr,
    left: `${padX + (i % COLS) * (gw + padX) + gw / 2}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY) - 2}%`,
    textAlign: 'center',
    textStyle: { color: '#8b8a83', fontSize: 11 },
  }));
  const xAxes = items.map((item, i) => ({
    gridIndex: i, type: 'category', data: item.cats,
    axisLine: { lineStyle: { color: '#2b2b2b' } }, axisLabel: { show: false }, axisTick: { show: false },
  }));
  const yAxes = items.map((_, i) => ({
    gridIndex: i, type: 'value', axisLine: { show: false }, axisLabel: { show: false }, splitLine: { show: false },
  }));
  const COLORS = ['#7fd8a4', '#f7d41d', '#ff9b5c'];
  const series = [];
  items.forEach((item, i) => {
    (item.series || []).forEach((s, si) => {
      series.push({
        name: s.name, type: 'line', gridIndex: i, xAxisIndex: i, yAxisIndex: i,
        data: s.data, smooth: true, stack: 'tier', areaStyle: { opacity: 0.5 },
        symbol: 'circle', symbolSize: 4,
        itemStyle: { color: COLORS[si] || CHART_COLORS.blue },
        lineStyle: { color: COLORS[si] || CHART_COLORS.blue },
      });
    });
  });
  // K 线式悬浮：鼠标在 x 轴位置即显示该箱低/中/高三档曲线值（axis 触发）
  return {
    title: titles,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        if (!arr.length) return '';
        const it = items[Math.floor(arr[0].seriesIndex / 3)];
        const v = it?.cats?.[arr[0].dataIndex];
        const valLine = v != null ? `数值 <b>${v}</b><br>` : '';
        const rows = arr.map((p) => `${p.marker}${p.seriesName} <b>${p.value}</b>`).join('<br>');
        return `${it?.attr || ''}<br>${valLine}${rows}`;
      },
    },
    series,
  };
}

/** 推荐山脊图：三档密度（堆叠面积） */
export function ridgeOption(seriesData, cats) {
  // seriesData: [{name:'低档', data:number[]}, ...]，cats: 数值分箱标签
  return {
    grid: CHART_GRID,
    tooltip: DARK_TOOLTIP,
    legend: { textStyle: { color: '#8b8a83' }, top: 4 },
    xAxis: { ...baseXAxis(cats), axisLabel: { ...AXIS_LABEL, interval: Math.floor(cats.length / 8) } },
    yAxis: { ...baseYAxis(), axisLabel: { show: false } },
    series: seriesData.map((s, i) => ({
      name: s.name, type: 'line', data: s.data, smooth: true, stack: 'tier',
      areaStyle: { opacity: 0.5 }, symbol: 'none',
      lineStyle: { color: ['#7fd8a4', '#f7d41d', '#ff9b5c'][i] || CHART_COLORS.blue },
    })),
  };
}

/** 档位占比条形图 */
export function tierBarOption(data) {
  // data: [{tier:'高档', count, pct}]
  return {
    grid: CHART_GRID,
    tooltip: DARK_TOOLTIP,
    xAxis: { ...baseXAxis(data.map((d) => d.tier)), axisLabel: AXIS_LABEL },
    yAxis: baseYAxis(),
    series: [
      {
        type: 'bar', data: data.map((d) => d.count),
        barWidth: 40, itemStyle: { color: CHART_COLORS.acc },
        label: { show: true, position: 'top', color: '#8b8a83' },
      },
    ],
  };
}

/** 玩家 CDF：累计占比曲线 + 推荐档位 markLine + 个人点 */
export function cdfOption(cdf, rec, mine) {
  // cdf: {bins: [value], cum: [累计占比%]}，rec: {low,mid,high}，mine
  const series = [
    {
      name: '累计占比', type: 'line', data: cdf.cum, smooth: true, symbol: 'circle', symbolSize: 4,
      itemStyle: { color: CHART_COLORS.blue }, // 圆点统一蓝色
      lineStyle: { color: CHART_COLORS.blue }, areaStyle: { opacity: 0.12 },
      tooltip: {
        formatter: (p) => {
          const v = cdf.bins[p.dataIndex];
          return `${v != null ? `数值 <b>${v}</b><br>` : ''}累计占比 <b>${p.value}%</b>`;
        },
      },
    },
  ];
  if (mine != null) {
    // 找到 mine 在 bins 中的索引
    const idx = cdf.bins.findIndex((v) => v >= mine);
    series.push({
      name: '我的', type: 'scatter',
      data: [[idx >= 0 ? idx : cdf.bins.length - 1, idx >= 0 ? cdf.cum[idx] : 100]],
      symbolSize: 9, itemStyle: { color: CHART_COLORS.orange },
    });
  }
  return {
    grid: CHART_GRID,
    tooltip: DARK_TOOLTIP,
    legend: { textStyle: { color: '#8b8a83' }, top: 4 },
    xAxis: { ...baseXAxis(cdf.bins.map((v, i) => (i % Math.ceil(cdf.bins.length / 6) === 0 ? v : ''))), axisLabel: AXIS_LABEL },
    yAxis: { ...baseYAxis(), max: 100, axisLabel: { ...AXIS_LABEL, formatter: '{value}%' } },
    series,
  };
}

/** 双轴对比图：左轴推荐值频次（bar）+ 右轴玩家密度（line） */
export function dualAxisOption(bins, recCounts, playerDensity) {
  // bins: 分箱标签；recCounts: 推荐值每箱频次；playerDensity: 玩家密度（0-1）
  return {
    grid: CHART_GRID,
    tooltip: DARK_TOOLTIP,
    legend: { textStyle: { color: '#8b8a83' }, top: 4 },
    xAxis: { ...baseXAxis(bins), axisLabel: { ...AXIS_LABEL, interval: Math.floor(bins.length / 8) } },
    yAxis: [
      { type: 'value', name: '推荐频次', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      { type: 'value', name: '玩家密度', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: { show: false }, max: 1 },
    ],
    series: [
      { name: '推荐值频次', type: 'bar', data: recCounts, barWidth: 12, itemStyle: { color: 'rgba(247,212,29,0.5)' } },
      { name: '玩家密度', type: 'line', yAxisIndex: 1, data: playerDensity, smooth: true, symbol: 'none', lineStyle: { color: CHART_COLORS.green } },
    ],
  };
}
