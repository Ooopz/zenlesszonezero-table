// src/web/charts.js —— ECharts 图表辅助：主题色 / 容器注册 / 渲染挂载 + 各图表 option 构建
// 依赖 index.html 引入的 window.echarts（本地 vendor）。视觉匹配项目暗色 + 金色 accent 主题。
/* global echarts */
import { formatValue } from '../lib/util.js';

/** 项目主题色（对应 style.css :root 变量；所有图表统一引用，禁止硬编码色值） */
export const CHART_COLORS = {
  acc: '#ffd400',
  acc2: '#ffe95c',
  green: '#7ce7a8',
  orange: '#ff9a4d',
  red: '#ff5d5d',
  blue: '#56b8ff',
  purple: '#b28cff',
  dim: '#918d80',
  line: '#2a2a2a',
  bg: '#101010',
  card: '#141414',
};

/** 主题色半透明变体（图表大面积填充/条形用；值 = 主题色 + 透明度，保持风格一致） */
const SOFT = {
  blue: 'rgba(86,184,255,0.28)', // 小提琴密度
  blueBar: 'rgba(86,184,255,0.45)',
  blueBar70: 'rgba(86,184,255,0.7)', // 副词条/组合横向条
  acc: 'rgba(255,212,0,0.12)', // 箱线盒体
};

/** 坐标轴/网格/标签（统一引用主题色） */
const AXIS_LINE = { lineStyle: { color: CHART_COLORS.line } };
const AXIS_LABEL = { color: CHART_COLORS.dim, fontSize: 12 };
const AXIS_LABEL_SMALL = { ...AXIS_LABEL, fontSize: 11 }; // 多子图/紧凑图表
const SPLIT_LINE = { lineStyle: { color: CHART_COLORS.line } };
/** 图例统一样式 */
const CHART_LEGEND = { textStyle: { color: CHART_COLORS.dim }, top: 4 };
/** 单图标题（整图居中标题） */
const CHART_TITLE = { textStyle: { color: '#f0ede2', fontSize: 15 } };
/** 多子图的小标题（每个子图上方） */
const CHART_SUBTITLE = { textStyle: { color: CHART_COLORS.dim, fontSize: 13 } };

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
    // 读数参考线（option 带 readLine 标记时启用：小提琴图等需要按鼠标位置读数的场景）
    if (opt.readLine) attachReadLine(chart, opt);
  });
  pruneDetachedCharts();
}

/** 回收已从文档移除的图表实例。
 *  切子面板/切角色时 render 会整块替换 innerHTML，旧容器连同 canvas 脱离文档，但实例仍留在
 *  instances 里：既不会被 GC（每张图一块 canvas + option 数据），resizeCharts 也会对着
 *  已脱离的 DOM 反复 resize。mountCharts 只 dispose「同 key 重新挂载」的那些，覆盖不到
 *  本次没再出现的图。
 *  ⚠️ 必须由 render() 在清空 grid 后无条件调用，不能只靠 mountCharts 末尾那次：
 *  从「统计」切到「数据库」或「我的角色」时 render 提前 return，根本不会走到 mountCharts，
 *  统计视图那十几张图会永久驻留（来回切视图 = 每次泄漏一整套 canvas）。 */
export function pruneDetachedCharts() {
  for (const [key, chart] of instances) {
    const dom = chart.getDom();
    if (!dom || !dom.isConnected) {
      chart.dispose();
      instances.delete(key);
    }
  }
}

/** 灰色读数参考线：随鼠标移动的横虚线 + 数值标签。
 *  图表 option 需带 readLine: {attrs: [各 grid 属性名], densities: [密度系列索引|null], bins: [bins|null]}
 *  与预置 graphic 元素（id: read-line / read-label）。
 *  行为：鼠标在某个子图（grid）内任意位置（含没放在数据条上的空白处）→ 灰线横跨该子图宽度，
 *  数值标签按鼠标所在 y 轴位置换算显示；鼠标在子图外（间隙/标题/容器外）→ 隐藏。
 *  悬浮框：数据元素上由原生 item tooltip 处理（内容随位置更新）；空白处用 showTip 指向
 *  鼠标 y 对应的密度区间（复用 tooltip formatter），实现「y 轴对应时也显示」。
 *  用原生 DOM mousemove 而非 zrender 事件：canvas 空白处 DOM 事件可靠触发。 */
function attachReadLine(chart, opt) {
  const attrs = opt.readLine.attrs || [];
  const densities = opt.readLine.densities || [];
  const binsList = opt.readLine.bins || [];
  const dom = chart.getDom();
  const hide = () => {
    chart.setOption({ graphic: [{ id: 'read-line', invisible: true }, { id: 'read-label', invisible: true }] });
    chart.dispatchAction({ type: 'hideTip' });
  };
  // zrender 层标记：鼠标是否悬在数据元素上（数据元素由原生 item tooltip 处理，空白处由 showTip 接管）
  let onData = false;
  chart.on('mousemove', (e) => {
    onData = e.dataIndex != null;
  });
  chart.on('mouseout', () => {
    onData = false;
  });
  dom.addEventListener('mousemove', (e) => {
    const canvas = dom.querySelector('canvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (px < 0 || py < 0 || px > r.width || py > r.height) return hide();
    // 找鼠标所在子图（实时取像素矩形，resize 后自动正确）
    for (let i = 0; i < attrs.length; i++) {
      const comp = chart.getModel().getComponent('grid', i);
      if (!comp) continue;
      const rect = comp.coordinateSystem.getRect();
      if (px < rect.x || px > rect.x + rect.width || py < rect.y || py > rect.y + rect.height) continue;
      // 子图内：灰线横跨该子图宽度，标签 = 鼠标 y 对应的 y 轴数值
      const line = { id: 'read-line', invisible: false, shape: { x1: rect.x, y1: py, x2: rect.x + rect.width, y2: py } };
      let label = { id: 'read-label', invisible: true };
      const v = chart.convertFromPixel({ gridIndex: i }, [px, py]);
      if (v && Number.isFinite(v[1])) {
        label = {
          id: 'read-label',
          invisible: false,
          style: { text: `${attrs[i]} ${formatValue(attrs[i], v[1])}`, x: rect.x + 4, y: py - 6 },
        };
        // 空白处（未悬在数据元素上）：悬浮框显示鼠标 y 对应的密度区间（数值区间 + 玩家数 + 累计）
        if (!onData) {
          const si = densities[i];
          const bins = binsList[i];
          if (si != null && bins && bins.length > 1) {
            let idx = 0;
            for (let j = 0; j < bins.length - 1; j++) {
              if (v[1] < bins[j + 1]) {
                idx = j;
                break;
              }
            }
            chart.dispatchAction({ type: 'showTip', seriesIndex: si, dataIndex: idx, position: [px + 14, py + 14] });
          }
        }
      }
      chart.setOption({ graphic: [line, label] });
      return;
    }
    hide();
  });
  dom.addEventListener('mouseleave', hide);
}
/** 窗口尺寸变化时 resize 所有已挂载图表（页面 resize 自动触发，防抖 150ms；
 *  多子图布局（技能分布/推荐三档等百分比 grid）依赖 resize 重算才能跟随容器宽度） */
function resizeCharts() {
  for (const c of instances.values()) {
    const dom = c.getDom();
    if (dom && dom.isConnected) c.resize(); // 跳过已脱离文档的实例（下次 mountCharts 会回收）
  }
}
// 页面宽度变化 → 重排所有已挂载图表（模块加载时注册一次）
if (typeof window !== 'undefined') {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCharts, 150);
  });
}

// ---------- 公共 option 片段 ----------
/** 基础坐标轴样式（暗色） */
export function baseXAxis(cats) {
  return { type: 'category', data: cats, axisLine: AXIS_LINE, axisLabel: AXIS_LABEL, axisTick: { show: false } };
}
/** 暗色 tooltip（统一悬浮风格） */
export const DARK_TOOLTIP = {
  backgroundColor: CHART_COLORS.card,
  borderColor: CHART_COLORS.acc,
  textStyle: { color: '#f0ede2', fontSize: 14 },
};

// ---------- 各图表的 option 构建函数（数据由 recommend.js / discstats.js 各面板准备） ----------

/** 热力图：角色×属性，色 = 数值（百分位）。
 *  @param {number} [max] visualMap 上限：达标热力图默认 100（百分位）。 */
export function heatmapOption(data, attrs, max = 100) {
  // data: [{name, cells: [{pct, reached, gap}|null]}]（gap = 推荐中档 − 我的值，仅未达标时非 null），attrs: 属性列表
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
        const hit = c.reached == null ? '' : c.reached ? `<span style="color:${CHART_COLORS.green}">✓ 达到推荐中档</span>` : `<span style="color:${CHART_COLORS.orange}">未达推荐中档</span>`;
        const gap = c.gap != null && Number.isFinite(c.gap) ? `<br>缺口 ${formatValue(attrs[p.value[0]], c.gap)}` : '';
        return `${attrs[p.value[0]]}<br>${c.label != null ? `${c.label}<br>` : ''}玩家百分位 <b>${Math.round(c.pct)}%</b>${hit ? '<br>' + hit : ''}${gap}`;
      },
    },
    xAxis: { ...baseXAxis(attrs), axisLabel: { ...AXIS_LABEL, interval: 0, rotate: 35 } },
    yAxis: { type: 'category', data: data.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    visualMap: {
      min: 0, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#401515', '#a83a3a', '#d4a81e', CHART_COLORS.green] }, // 深红→橙→金→绿，色阶鲜明
      textStyle: { color: CHART_COLORS.dim },
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

/** 共识度散点多子图大图：每属性一个子图（X=玩家 sd、Y=推荐 CV，每角色一点）。
 *  attrs: [{attr, points: [{name, sd, cv}]}] —— 悬浮显示角色名与两项指标 */
export function consensusGridOption(attrs) {
  const n = attrs.length;
  if (!n) return {};
  // 布局：最多 4 列，属性多时换行（8 个属性 = 2 行）
  const COLS = 4;
  const rows = Math.ceil(n / COLS);
  const padX = 2.2;
  const padY = 7;
  const gw = (100 - padX * (COLS + 1)) / COLS;
  const gh = (100 - padY * (rows + 1)) / rows;
  const grids = attrs.map((_, i) => ({
    left: `${padX + (i % COLS) * (gw + padX)}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY)}%`,
    width: `${gw}%`,
    height: `${gh}%`,
    containLabel: true,
  }));
  const titles = attrs.map((item, i) => ({
    text: item.attr,
    left: `${padX + (i % COLS) * (gw + padX) + gw / 2}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY) - 2}%`,
    textAlign: 'center',
    ...CHART_SUBTITLE,
  }));
  const xAxes = attrs.map((_, i) => ({
    gridIndex: i,
    type: 'value',
    name: '玩家分化(sd)',
    axisLine: AXIS_LINE,
    axisLabel: AXIS_LABEL_SMALL,
    splitLine: SPLIT_LINE,
  }));
  const yAxes = attrs.map((_, i) => ({
    gridIndex: i,
    type: 'value',
    name: '攻略分歧(CV)',
    axisLine: { show: false },
    axisLabel: AXIS_LABEL_SMALL,
    splitLine: SPLIT_LINE,
  }));
  const series = attrs.map((item, i) => ({
    name: item.attr,
    type: 'scatter',
    gridIndex: i,
    xAxisIndex: i,
    yAxisIndex: i,
    symbolSize: 9,
    data: item.points.map((p) => [p.sd, p.cv, p.name]),
    itemStyle: { color: CHART_COLORS.purple },
    emphasis: {
      scale: 1.7,
      itemStyle: { color: CHART_COLORS.acc, borderColor: CHART_COLORS.acc, borderWidth: 1.5 },
    },
  }));
  return {
    grid: grids,
    title: titles,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'item',
      formatter: (p) =>
        `<b>${p.seriesName}</b><br>${p.data[2]}<br>玩家分化(sd): <b>${p.data[0].toFixed(1)}</b><br>攻略分歧(CV): <b>${(p.data[1] * 100).toFixed(1)}%</b>`,
    },
    series,
  };
}

/** 每属性独立子图的小提琴图：镜像密度（dist.hist）+ 箱线（p25/median/p75 + 须）+ 推荐三档点 + 我的点。
 *  各属性独立 y 轴刻度，避免量纲差异压缩小数值属性；hist 缺失时退化为纯箱线。 */
export function violinBoxOption(items) {
  // items: [{attr, dist:{p10,p25,median,p75,p90,hist:{bins,counts}}, rec:{low,mid,high}, mine}]
  const n = items.length;
  if (!n) return {};
  // 布局：属性 ≤4 单行；否则上下两行（每行均分），避免属性多时单行过挤
  const rows = n > 4 ? 2 : 1;
  const cols = Math.ceil(n / rows);
  const padX = 4;
  const padY = 7;
  const gw = (100 - padX * (cols + 1)) / cols;
  const gh = (100 - padY * (rows + 1)) / rows;
  const grids = items.map((_, i) => ({
    left: `${padX + (i % cols) * (gw + padX)}%`,
    top: `${padY + Math.floor(i / cols) * (gh + padY)}%`,
    width: `${gw}%`,
    height: `${gh}%`,
    containLabel: true,
  }));
  const xAxes = items.map((item, i) => ({
    gridIndex: i,
    type: 'category',
    data: [item.attr],
    axisLine: AXIS_LINE,
    axisLabel: { ...AXIS_LABEL, interval: 0 }, // 属性名在箱线正下方，与类目严格对齐
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
  // 每子图密度系列的 series 索引与 bins（供 attachReadLine 在空白处 showTip 定位鼠标 y 对应的区间）
  const densitySI = [];
  const binsList = [];
  items.forEach((item, i) => {
    // 小提琴密度：镜像直方图（dist.hist 存在时；半透明蓝左右对称，箱线居中叠加）
    const hist = item.dist?.hist;
    densitySI.push(null);
    binsList.push(hist?.bins || null);
    if (hist?.counts?.length) {
      densitySI[i] = series.length;
      const maxCount = Math.max(...hist.counts, 1);
      const bins = hist.bins;
      const counts = hist.counts;
      series.push({
        name: `${item.attr}|密度`,
        type: 'custom',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: i,
        // data 必须是真实数值坐标（bin 中点）：参与 y 轴范围计算才能与 boxplot 同量纲对齐；
        // 若传 counts（0~N 数量）会把 y 轴范围拉偏，导致密度矩形 y 坐标整体错位
        data: counts.map((_, j) => (bins[j] + bins[j + 1]) / 2),
        z: 1,
        renderItem: (params, api) => {
          const count = counts[params.dataIndex] ?? 0;
          if (count <= 0) return null;
          const k = count / maxCount; // 0-1：count 越大向两侧越宽
          const centerX = api.coord([0, 0])[0];
          const slotW = api.size([1, 0])[0]; // 类目槽宽（px）
          const half = slotW * 0.48 * k; // 每侧最大 48% 槽宽（总宽 96%），保证包住中间收窄的箱线
          const y0 = api.coord([0, bins[params.dataIndex]])[1];
          const y1 = api.coord([0, bins[params.dataIndex + 1]])[1];
          return {
            type: 'rect',
            shape: { x: centerX - half, y: Math.min(y0, y1), width: half * 2, height: Math.abs(y1 - y0) },
            style: api.style({ fill: SOFT.blue }),
          };
        },
      });
    }
    // boxplot 数据序：[下须, Q1, 中位, Q3, 上须]；盒体收窄（18%-38% 类目宽）让密度包住箱线形成小提琴形态
    series.push({
      name: `${item.attr}|箱线`,
      type: 'boxplot',
      gridIndex: i,
      xAxisIndex: i,
      yAxisIndex: i,
      boxWidth: ['18%', '38%'],
      data: [[
        item.dist.whiskerLow ?? item.dist.p10,
        item.dist.p25,
        item.dist.median,
        item.dist.p75,
        item.dist.whiskerHigh ?? item.dist.p90,
      ]],
      itemStyle: { color: SOFT.acc, borderColor: CHART_COLORS.acc },
      lineStyle: { color: CHART_COLORS.acc },
    });
    ['low', 'mid', 'high'].forEach((t) => {
      if (item.rec && item.rec[t] != null) {
        series.push({
          name: `${item.attr}|三档`,
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
        name: `${item.attr}|我的`,
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
    tooltip: {
      ...DARK_TOOLTIP,
      // item 触发：悬浮框内容随悬浮位置实时更新（密度矩形区间 / 箱线点统计）；
      // 灰色读数参考线由下方 graphic + mountCharts 的 attachReadLine 机制提供（不依赖 tooltip 触发模式）
      formatter: (p) => {
        const [attr, type] = (p.seriesName || '').split('|');
        const item = items.find((x) => x.attr === attr);
        if (!item) return '';
        const d = item.dist || {};
        const fmt = (v) => formatValue(attr, v);
        if (type === '密度') {
          // 悬浮密度矩形：数值区间 + 玩家数 + 累计占比
          const bins = d.hist?.bins;
          const counts = d.hist?.counts;
          if (!bins || !counts) return '';
          const j = p.dataIndex;
          if (j == null || j >= counts.length) return '';
          const total = counts.reduce((s, c) => s + c, 0) || 1;
          const cum = counts.slice(0, j + 1).reduce((s, c) => s + c, 0);
          return `<b>${attr}</b> · 玩家分布<br>数值 ${fmt(bins[j])} ~ ${fmt(bins[j + 1])}<br>玩家数 <b>${counts[j]}</b>（累计 ${Math.round((cum / total) * 100)}%）`;
        }
        // 箱线/三档/我的点：统一显示完整分布统计 + 我的 + 推荐三档
        const lines = [`<b>${attr}</b>`];
        if (d.count != null) lines.push(`样本 <b>${d.count.toLocaleString()}</b> 人`);
        if (d.mean != null) lines.push(`均值 <b>${fmt(d.mean)}</b>`);
        if (d.median != null) lines.push(`中位 <b>${fmt(d.median)}</b>（Q1 ${fmt(d.p25)} ~ Q3 ${fmt(d.p75)}）`);
        if (d.p10 != null && d.p90 != null) lines.push(`P10-P90 <b>${fmt(d.p10)}</b> ~ <b>${fmt(d.p90)}</b>`);
        if (item.rec && item.rec.low != null) {
          lines.push(`推荐三档 <b>${fmt(item.rec.low)}</b> / <b>${fmt(item.rec.mid)}</b> / <b>${fmt(item.rec.high)}</b>`);
        }
        if (item.mine != null) lines.push(`<span style="color:var(--orange)">我的 <b>${fmt(item.mine)}</b></span>`);
        return lines.join('<br>');
      },
    },
    series,
    // 灰色读数参考线：横虚线随鼠标移动 + 数值标签（由 mountCharts 的 attachReadLine 驱动；
    // attrs 为各 grid 的属性名，densities/bins 供空白处 showTip 显示鼠标 y 对应区间的悬浮框）
    readLine: { attrs: items.map((x) => x.attr), densities: densitySI, bins: binsList },
    graphic: [
      {
        id: 'read-line',
        type: 'line',
        invisible: true,
        silent: true,
        z: 50,
        shape: { x1: 0, y1: 0, x2: 0, y2: 0 },
        style: { stroke: '#918d80', lineDash: [4, 3], lineWidth: 1 },
      },
      {
        id: 'read-label',
        type: 'text',
        invisible: true,
        silent: true,
        z: 50,
        style: { text: '', x: 0, y: 0, fill: '#f0ede2', fontSize: 12, backgroundColor: '#1a1a1a', borderRadius: 2, padding: [2, 4] },
      },
    ],
  };
}

export function densityScatterOption(grid, title = '') {
  const N = grid.N;
  const spanX = grid.xMax - grid.xMin || 1;
  const spanY = grid.yMax - grid.yMin || 1;
  const maxCount = grid.data.reduce((m, d) => Math.max(m, d[2]), 1);
  const pts = grid.data.map(([xi, yi, count]) => [
    +(grid.xMin + ((xi + 0.5) / N) * spanX).toFixed(4),
    +(grid.yMin + ((yi + 0.5) / N) * spanY).toFixed(4),
    count,
  ]);
  return {
    title: { text: title, left: 'center', top: 4, ...CHART_TITLE },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => `<b>${grid.xName}</b> ${p.value[0]}<br><b>${grid.yName}</b> ${p.value[1]}<br>样本 ${p.value[2]}`,
    },
    grid: { left: 52, right: 18, top: 34, bottom: 36 },
    xAxis: {
      type: 'value',
      name: grid.xName,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: CHART_SUBTITLE.textStyle,
      min: 'dataMin',
      max: 'dataMax',
      axisLine: AXIS_LINE,
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    yAxis: {
      type: 'value',
      name: grid.yName,
      nameTextStyle: CHART_SUBTITLE.textStyle,
      min: 'dataMin',
      max: 'dataMax',
      axisLine: { show: false },
      axisLabel: AXIS_LABEL,
      splitLine: SPLIT_LINE,
    },
    series: [
      {
        type: 'scatter',
        large: true,
        symbolSize: 9,
        data: pts,
        emphasis: { focus: 'series', itemStyle: { borderColor: '#fff' } },
      },
    ],
    visualMap: {
      min: 1,
      max: maxCount,
      dimension: 2,
      calculable: false,
      orient: 'vertical',
      right: 4,
      top: 'middle',
      inRange: { color: ['#3a3a3a', CHART_COLORS.green, CHART_COLORS.acc] },
      textStyle: { color: CHART_COLORS.dim },
    },
  };
}

/** 推荐三档 × 玩家分布 增强图：每属性一个子图，y 轴 4 行——
 *  玩家 P10-P90 区间 / 低配·毕业·高配 median±sd 区间，我的值用贯穿全图的金色竖线标记（带玩家百分位标签）。
 *  items = [{attr, player:{p10,p90}, low:{median,sd}, mid:{median,sd}, high:{median,sd}, mine, minePct}]
 *  区间用 markArea（半透明区域，无需堆叠；兼容性最稳），我的值用 markLine 竖线。
 *  @param {number} [height]  容器高度 px（标题用像素定位，避免百分比 + 像素高度混算把标题压进图内） */
export function tierRichOption(items, height = 380) {
  const n = items.length;
  if (!n) return {};
  const COLS = 3;
  const rows = Math.ceil(n / COLS);
  const padX = 4;
  const padY = 9;
  const gw = (100 - padX * (COLS + 1)) / COLS;
  const gh = (100 - padY * (rows + 1)) / rows;
  const pos = (i) => ({ left: padX + (i % COLS) * (gw + padX), top: padY + Math.floor(i / COLS) * (gh + padY) });
  const grids = items.map((_, i) => ({ left: `${pos(i).left}%`, top: `${pos(i).top}%`, width: `${gw}%`, height: `${gh}%`, containLabel: true }));
  // 标题底边 = grid 顶 - 8px 间隙（标题高约 18px，故顶边再上移 26px）——任何容器高度下都保持图外
  const titles = items.map((item, i) => ({
    text: item.attr,
    left: `${pos(i).left + gw / 2}%`,
    top: `${(pos(i).top / 100) * height - 26}px`,
    textAlign: 'center',
    ...CHART_SUBTITLE,
  }));
  const cats = ['玩家', '低配', '毕业', '高配'];
  const yAxes = items.map((_, i) => ({
    gridIndex: i,
    type: 'category',
    data: cats,
    axisLine: { show: false },
    axisLabel: AXIS_LABEL,
    axisTick: { show: false },
    axisPointer: { show: false }, // 只保留 x 轴竖线，y 轴的指针横线禁用
  }));
  const COLORS = {
    player: CHART_COLORS.blue,
    low: CHART_COLORS.green,
    mid: CHART_COLORS.acc,
    high: CHART_COLORS.orange,
    mine: CHART_COLORS.acc,
  };
  const xAxes = [];
  const series = [];
  items.forEach((item, i) => {
    // x 轴范围：玩家区间、三档 median±sd、我的 全部有效值（含 0，供「我的」bar 从 0 起）
    const vals = [0];
    const push = (v) => { if (v != null && Number.isFinite(v)) vals.push(v); };
    push(item.player?.p10);
    push(item.player?.p90);
    for (const k of ['low', 'mid', 'high']) {
      push(item[k]?.median);
      if (item[k]?.sd != null) {
        push(Math.max(0, item[k].median - item[k].sd)); // 面板属性不可能为负，区间下界钳制到 0
        push(item[k].median + item[k].sd);
      }
    }
    push(item.mine);
    const vmin = Math.min(...vals);
    const vmax = Math.max(...vals);
    const span = vmax - vmin || 1;
    xAxes.push({
      gridIndex: i,
      type: 'value',
      min: vmin - span * 0.08,
      max: vmax + span * 0.14,
      axisLine: AXIS_LINE,
      axisLabel: AXIS_LABEL_SMALL,
      splitLine: SPLIT_LINE,
      // 数值轴的 axisPointer 默认不显示（类目轴才默认显示竖线），必须显式在轴上开启；
      // 样式不自定义：走 ECharts 默认（实线 #555），与技能等级分布图的竖线效果一致
      axisPointer: { show: true, type: 'line' },
    });
    /** 区间行：空 bar series + markArea 半透明区域（[from, to]，x 为 value 坐标） */
    const areaRow = (cat, from, to, color) => {
      if (from == null || to == null) return;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      if (hi <= 0) return; // 占位 0 区间（0~0）无信息，跳过（面板属性不可能为负）
      series.push({
        name: cat,
        type: 'bar',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: i,
        data: [],
        markArea: {
          silent: true,
          itemStyle: { color },
          label: {
            show: true,
            position: 'insideRight',
            color: '#131313',
            fontSize: 11,
            formatter: `${lo.toFixed(1)} ~ ${hi.toFixed(1)}`,
          },
          data: [[{ yAxis: cat, xAxis: lo }, { yAxis: cat, xAxis: hi }]],
        },
      });
    };
    if (item.player?.p10 != null && item.player?.p90 != null) {
      if (item.player.p10 === item.player.p90) {
        // 集中分布（大量玩家同值，如能量自动回复 1.2 / 基础穿透值）：P10=P90 区间退化为 0 宽，
        // markArea 不可见 → 用贯穿 4 行的虚线竖线 + 底部标签（不伪造区间宽度）
        series.push({
          name: '玩家',
          type: 'line',
          gridIndex: i,
          xAxisIndex: i,
          yAxisIndex: i,
          data: [],
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: COLORS.player, width: 1.5, type: 'dashed' },
            label: {
              show: true,
              position: 'insideEndBottom',
              color: COLORS.player,
              fontSize: 11,
              formatter: `≈ ${item.player.p10.toFixed(1)}`,
            },
            data: [{ xAxis: item.player.p10 }],
          },
        });
      } else {
        areaRow('玩家', item.player.p10, item.player.p90, COLORS.player);
      }
    }
    for (const [k, cat, color] of [['low', '低配', COLORS.low], ['mid', '毕业', COLORS.mid], ['high', '高配', COLORS.high]]) {
      const v = item[k];
      if (v?.median == null) continue;
      const sd = v.sd != null ? v.sd : 0;
      // median-sd 可能为负（sd>median 的小数值属性），面板属性不可能为负，下界钳制到 0
      areaRow(cat, Math.max(0, v.median - sd), v.median + sd, color);
    }
    // 我的值：金色竖线贯穿 4 行 + 顶部百分位标签（markLine；insideEndTop 让标签留在绘图区内侧，
    // 避免越出 grid 顶与子图标题（像素定位在 grid 上方）重叠）
    if (item.mine != null) {
      const pct = item.minePct != null ? `P${Math.round(item.minePct)}` : '';
      series.push({
        name: '我的',
        type: 'line',
        gridIndex: i,
        xAxisIndex: i,
        yAxisIndex: i,
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: COLORS.mine, width: 2 },
          label: {
            show: true,
            position: 'insideEndTop',
            color: COLORS.mine,
            fontSize: 11,
            formatter: pct,
          },
          data: [{ xAxis: +item.mine.toFixed(3) }],
        },
      });
    }
    // 透明辅助系列：为 axisPointer 悬浮竖线 + 数值提示提供数据锚点
    // （markArea/markLine 均为空 data 且 silent，无法触发坐标轴悬浮）
    const auxX = [];
    for (let k = 0; k <= 40; k++) auxX.push(vmin + ((vmax - vmin) * k) / 40);
    series.push({
      name: `${item.attr}|辅助`,
      type: 'line',
      gridIndex: i,
      xAxisIndex: i,
      yAxisIndex: i,
      data: auxX.map((x) => [x, '玩家']),
      symbol: 'none',
      lineStyle: { opacity: 0 },
      itemStyle: { opacity: 0 },
      emphasis: { disabled: true },
      z: 0,
    });
  });
  return {
    title: titles,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (p) => {
        const arr = Array.isArray(p) ? p : [p];
        const f = arr[0];
        if (!f || f.axisValue == null) return '';
        const attr = (f.seriesName || '').split('|')[0];
        const item = items.find((x) => x.attr === attr);
        if (!item) return '';
        return `<b>${item.attr}</b><br>数值 <b>${formatValue(item.attr, f.axisValue)}</b>`;
      },
    },
    series,
  };
}

// ================= 练度图（评分/影画/技能） / 驱动盘图 =================

/** 影画金字塔：每角色 0-6 影占比堆叠横条（ranks 为 7 个占比，合计 ≤100） */
export function rankPyramidOption(rows) {
  // rows: [{name, ranks: [p0..p6]}]
  const RANK_COLORS = [
    '#2f7d7d', // 0 影：深青
    '#5a7d9a', // 1 影：蓝灰
    CHART_COLORS.blue, // 2 影：蓝
    CHART_COLORS.green, // 3 影：绿
    CHART_COLORS.acc, // 4 影：金
    CHART_COLORS.orange, // 5 影：橙
    CHART_COLORS.red, // 6 影：红（冷→暖递进，影画越高越醒目）
  ];
  const series = [0, 1, 2, 3, 4, 5, 6].map((r) => ({
    name: `${r} 影`,
    type: 'bar',
    stack: 'rank',
    data: rows.map((x) => x.ranks[r]),
    barWidth: 16,
    itemStyle: { color: RANK_COLORS[r] },
  }));
  return {
    grid: { left: 90, right: 30, top: 36, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const arr = Array.isArray(params) ? params : [params];
        const name = arr[0]?.name || '';
        const lines = arr
          .filter((p) => p.value > 0)
          .map((p) => `${p.marker}${p.seriesName} <b>${p.value.toFixed(1)}%</b>`);
        return `${name}<br>${lines.join('<br>')}`;
      },
    },
    legend: CHART_LEGEND,
    xAxis: { type: 'value', max: 100, axisLine: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: '{value}%' }, splitLine: SPLIT_LINE },
    // interval: 0 —— 角色名全部显示（默认自动间隔会隔一个显示一个）
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: { ...AXIS_LABEL, interval: 0 } },
    series,
  };
}

/** 全角色装配评分箱线图：盒 = P25-P75、线 = 中位、须 = IQR 1.5 规则（IQR 塌缩时退化为 P10/P90），
 *  悬浮显示分位明细与离群数 */
export function relicBarOption(rows) {
  // rows: [{name, median, p25, p75, whiskerLow, whiskerHigh, outliers, count}]
  return {
    grid: { left: 90, right: 50, top: 30, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const d = p.data?.d || p.data;
        return `<b>${d.name}</b><br>须 ${d.whiskerLow ?? d.p10} ~ ${d.whiskerHigh ?? d.p90}<br>Q1 <b>${d.p25}</b> · 中位 <b>${d.median}</b> · Q3 <b>${d.p75}</b><br>样本 ${d.count}${d.outliers ? `（离群 ${d.outliers}）` : ''}`;
      },
    },
    xAxis: { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series: [
      {
        type: 'boxplot',
        data: rows.map((r) => ({ value: [r.whiskerLow ?? r.p10, r.p25, r.median, r.p75, r.whiskerHigh ?? r.p90], d: r })),
        boxWidth: ['40%', '55%'],
        itemStyle: { color: SOFT.acc, borderColor: CHART_COLORS.acc },
        lineStyle: { color: CHART_COLORS.acc },
      },
    ],
  };
}

/** 影画 × 装配评分：每角色 6 影 median − 0 影 median 的横向条（正=氪影画玩家配装评分更高）。
 *  rows: [{name, gap, r0, r6}] —— 按 gap 排序传入 */
export function rankRelicGapOption(rows) {
  return {
    grid: { left: 90, right: 50, top: 16, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const d = p.data?.d || p.data;
        return `<b>${d.name}</b><br>0 影评分 <b>${d.r0}</b><br>6 影评分 <b>${d.r6}</b><br>差距 <b>${d.gap >= 0 ? '+' : ''}${d.gap}</b>`;
      },
    },
    xAxis: { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series: [
      {
        type: 'bar',
        barWidth: 10,
        data: rows.map((r) => ({ value: r.gap, d: r })),
        itemStyle: { color: (p) => (p.value >= 0 ? CHART_COLORS.acc : CHART_COLORS.dim) },
      },
    ],
  };
}

/** 技能等级分布：每技能一个柱状子图（x=等级、y=玩家数），我的等级所在柱高亮金色。
 *  items: [{label, dist:{level:count}, mine, min?, max?}] —— dist 来自 skillStats 的逐等级计数；
 *  min/max 指定该技能的等级范围（如核心技固定 1-7），缺省用 dist 实际范围。 */
export function skillDistOption(items) {
  const n = items.length;
  if (!n) return {};
  const COLS = 3;
  const rows = Math.ceil(n / COLS);
  const padX = 3.5;
  const padY = 6;
  const gw = (100 - padX * (COLS + 1)) / COLS;
  const gh = (100 - padY * (rows + 1)) / rows;
  // 每技能独立等级范围：item.min/max 优先（如核心技 1-7），否则 dist 实际范围
  const levelOf = (it) => {
    const keys = Object.keys(it.dist || {}).map(Number);
    let lo = it.min != null ? it.min : (keys.length ? Math.min(...keys) : 1);
    let hi = it.max != null ? it.max : (keys.length ? Math.max(...keys) : 12);
    if (lo > hi) [lo, hi] = [hi, lo];
    const out = [];
    for (let l = lo; l <= hi; l++) out.push(l);
    return out;
  };
  const itemLevels = items.map(levelOf);
  const grids = items.map((_, i) => ({
    left: `${padX + (i % COLS) * (gw + padX)}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY)}%`,
    width: `${gw}%`,
    height: `${gh}%`,
    containLabel: true,
  }));
  const titles = items.map((item, i) => ({
    text: item.label,
    left: `${padX + (i % COLS) * (gw + padX) + gw / 2}%`,
    top: `${padY + Math.floor(i / COLS) * (gh + padY) - 2}%`,
    textAlign: 'center',
    ...CHART_SUBTITLE,
  }));
  const xAxes = items.map((_, i) => ({
    gridIndex: i,
    type: 'category',
    data: itemLevels[i],
    axisLine: AXIS_LINE,
    axisLabel: { ...AXIS_LABEL_SMALL, interval: 0 },
    axisTick: { show: false },
  }));
  const yAxes = items.map((_, i) => ({
    gridIndex: i,
    type: 'value',
    axisLine: { show: false },
    axisLabel: AXIS_LABEL_SMALL,
    splitLine: SPLIT_LINE,
  }));
  const series = items.map((item, i) => ({
    name: item.label,
    type: 'bar',
    gridIndex: i,
    xAxisIndex: i,
    yAxisIndex: i,
    barWidth: '60%',
    data: itemLevels[i].map((lv) => {
      const count = item.dist?.[lv] || 0;
      const isMine = item.mine != null && lv === item.mine;
      return {
        value: count,
        itemStyle: {
          color: isMine ? CHART_COLORS.acc : SOFT.blueBar,
          borderColor: isMine ? CHART_COLORS.acc : 'transparent',
          borderWidth: isMine ? 1.5 : 0,
        },
        label: {
          show: isMine && count > 0,
          position: 'top',
          color: CHART_COLORS.acc,
          fontSize: 12,
          fontWeight: 'bold',
          formatter: `${count} 人`,
        },
      };
    }),
  }));
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
        const p = arr[0];
        const lv = p?.name;
        const c = p?.value;
        if (lv == null) return '';
        // 按系列名（子图名 = item.label）定位当前子图，避免多子图下悬停非首图时误取 items[0] 的我的等级
        const it = items.find((x) => x.label === p.seriesName) || items[0];
        const mineMark = it?.mine != null && Number(lv) === it.mine ? '（<b style="color:#ffd400">我的等级</b>）' : '';
        return `等级 <b>${lv}</b>${mineMark}<br>玩家数 <b>${c}</b>`;
      },
    },
    series,
  };
}
// ================= 驱动盘图表（驱动盘决策卡底部卡片区） =================

/** 456 主词条占比堆叠横条：y 轴 = 4/5/6 号位（3 行），每行内按主词条分段堆叠（每行合计 ≈100%）。
 *  detail = discDetails 条目（main456/mainDenom） */
export function discMain456Option(detail) {
  const slots = [4, 5, 6];
  const allMains = [...new Set(slots.flatMap((s) => (detail?.main456?.[s] || []).map((f) => f.name)))];
  const PALETTE = [
    'rgba(255,212,0,0.8)', 'rgba(86,184,255,0.75)', 'rgba(124,231,168,0.75)', 'rgba(255,154,77,0.75)',
    'rgba(178,140,255,0.75)', 'rgba(255,93,93,0.75)', 'rgba(255,233,92,0.75)', 'rgba(145,141,128,0.7)',
    'rgba(79,195,247,0.7)', 'rgba(174,213,129,0.7)',
  ];
  const series = allMains.map((m, mi) => ({
    name: m,
    type: 'bar',
    stack: 'main',
    barWidth: 24,
    itemStyle: { color: PALETTE[mi % PALETTE.length] },
    data: slots.map((s) => {
      const f = (detail?.main456?.[s] || []).find((x) => x.name === m);
      const denom = detail?.mainDenom?.[s] || 1;
      return f ? +((f.count / denom) * 100).toFixed(1) : 0;
    }),
  }));
  return {
    grid: { left: 50, right: 30, top: 36, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      trigger: 'item',
      formatter: (p) => `${p.seriesName}<br>${p.name}：<b>${p.value}%</b>`,
    },
    xAxis: { type: 'value', max: 100, axisLine: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: '{value}%' }, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: slots.map((s) => `${s} 号位`), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series,
  };
}

/** 副词条出现频率横向条（带此词条的盘占比）；subs = discDetails.subs [{name,count}]，total = 盘数 */
export function discSubsOption(subs, total) {
  const rows = (subs || []).slice(0, 12).map((f) => ({
    name: f.name,
    pct: total ? +(((f.count || 0) / total) * 100).toFixed(1) : 0,
    count: f.count,
  }));
  return {
    grid: { left: 90, right: 50, top: 10, bottom: 24, containLabel: true },
    tooltip: { ...DARK_TOOLTIP, formatter: (p) => `${p.name}<br>占比 <b>${p.value}%</b>（${p.data.count} 盘）` },
    xAxis: { type: 'value', max: 100, axisLine: { show: false }, axisLabel: { ...AXIS_LABEL, formatter: '{value}%' }, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name).reverse(), axisLine: { show: false }, axisLabel: AXIS_LABEL_SMALL },
    series: [
      {
        type: 'bar',
        barWidth: 12,
        data: rows.map((r) => ({ value: r.pct, count: r.count })).reverse(),
        itemStyle: { color: SOFT.blueBar70 },
        label: { show: true, position: 'right', color: CHART_COLORS.dim, fontSize: 11, formatter: '{c}%' },
      },
    ],
  };
}

/** 主词条 × 副词条协同热力图（mainSubCross）：4/5/6 槽并排，色 = 条件频率（count / 该槽盘数）。
 *  detail = discDetails 条目（mainSubCross/mainDenom）——「4 号位暴击率 → 暴伤 42%」式配装规律 */
export function mainSubCrossOption(detail) {
  const slots = [4, 5, 6];
  const grids = [];
  const xAxes = [];
  const yAxes = [];
  const series = [];
  const titles = [];
  slots.forEach((slot, i) => {
    const cross = detail?.mainSubCross?.[slot] || {};
    const mains = Object.keys(cross);
    const subs = [...new Set(mains.flatMap((m) => Object.keys(cross[m] || {})))];
    if (!mains.length || !subs.length) return;
    const denom = detail?.mainDenom?.[slot] || 1;
    const data = [];
    mains.forEach((m, mi) => {
      for (const [s, cnt] of Object.entries(cross[m] || {})) {
        data.push({ value: [subs.indexOf(s), mi, +(cnt / denom).toFixed(3)], m, s });
      }
    });
    const left = `${(i % 3) * 32 + 2}%`;
    grids.push({ left, top: '16%', width: '30%', height: '72%', containLabel: true });
    titles.push({ text: `${slot} 号位`, left: `${(i % 3) * 32 + 17}%`, top: '1%', textAlign: 'center', ...CHART_SUBTITLE });
    xAxes.push({
      gridIndex: i,
      type: 'category',
      data: subs,
      axisLine: AXIS_LINE,
      axisLabel: { ...AXIS_LABEL_SMALL, interval: 0, rotate: 40 },
      axisTick: { show: false },
    });
    yAxes.push({ gridIndex: i, type: 'category', data: mains, axisLine: { show: false }, axisLabel: AXIS_LABEL_SMALL });
    series.push({
      name: `${slot}号位`,
      type: 'heatmap',
      gridIndex: i,
      xAxisIndex: i,
      yAxisIndex: i,
      data,
      itemStyle: { borderColor: '#000', borderWidth: 0.5 },
      emphasis: { itemStyle: { borderColor: CHART_COLORS.acc, borderWidth: 1 } },
    });
  });
  if (!series.length) return {};
  return {
    grid: grids,
    title: titles,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => `<b>${p.seriesName}</b><br>主词条 ${p.data.m}<br>副词条 ${p.data.s}<br>条件频率 <b>${(p.value[2] * 100).toFixed(1)}%</b>`,
    },
    visualMap: {
      min: 0,
      max: 1,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 2,
      inRange: { color: ['#232323', '#8a4a1e', CHART_COLORS.acc] },
      textStyle: { color: CHART_COLORS.dim },
      formatter: (v) => (v * 100).toFixed(0) + '%',
    },
    series,
  };
}

/** 工坊副词条组合 Top（横向条）；subCombos = discDetails.subCombos [{combo, count}] */
export function discComboOption(subCombos) {
  const rows = (subCombos || []).slice(0, 8).map((c) => ({ name: c.combo.join('、'), count: c.count }));
  return {
    grid: { left: 90, right: 40, top: 10, bottom: 24, containLabel: true },
    tooltip: { ...DARK_TOOLTIP, formatter: (p) => `${p.name}<br>盘数 <b>${p.value}</b>` },
    xAxis: { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name).reverse(), axisLine: { show: false }, axisLabel: AXIS_LABEL_SMALL },
    series: [
      {
        type: 'bar',
        barWidth: 12,
        data: rows.map((r) => r.count).reverse(),
        itemStyle: { color: SOFT.blueBar70 },
        label: { show: true, position: 'right', color: CHART_COLORS.dim, fontSize: 11 },
      },
    ],
  };
}

/** D9 评分 × 盘毕业度：每角色「工坊评分 relic_point」与「加权词条效率分」的皮尔逊相关横向条。
 *  r 越接近 1 = 该角色的工坊评分基本就是词条效率的另一种写法（可放心当毕业度代理）；
 *  r 偏低 = 评分掺了词条效率之外的东西，看评分会误判毕业度。
 *  rows: [{name, r, n}] —— 按 r **降序**传入（类目轴首项画在底部，故最脱节的落在图顶） */
export function scoreRelicOption(rows) {
  return {
    grid: { left: 90, right: 60, top: 16, bottom: 40, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const d = p.data?.d || p.data;
        return `<b>${d.name}</b><br>相关系数 r = <b>${d.r.toFixed(3)}</b><br>配对样本 ${d.n.toLocaleString()}<br><span style="color:${CHART_COLORS.dim}">${d.r >= 0.9 ? '评分与词条效率高度一致' : d.r >= 0.8 ? '基本一致' : '存在偏离，评分不宜直接当毕业度看'}</span>`;
      },
    },
    xAxis: {
      type: 'value', min: 0, max: 1,
      axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE,
    },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL_SMALL },
    series: [
      {
        type: 'bar',
        barWidth: 10,
        data: rows.map((r) => ({ value: +r.r.toFixed(3), d: r })),
        itemStyle: { color: (p) => (p.value >= 0.9 ? CHART_COLORS.green : p.value >= 0.8 ? CHART_COLORS.acc : CHART_COLORS.orange) },
        label: { show: true, position: 'right', color: CHART_COLORS.dim, fontSize: 11 },
      },
    ],
  };
}
