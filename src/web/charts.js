// src/web/charts.js —— ECharts 图表辅助：主题色 / 容器注册 / 渲染挂载 + 各图表 option 构建
// 依赖 index.html 引入的 window.echarts（本地 vendor）。视觉匹配项目暗色 + 金色 accent 主题。
/* global echarts */
import { formatValue } from '../lib/util.js';

/** 项目主题色（对应 style.css :root 变量；所有图表统一引用，禁止硬编码色值） */
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

/** 主题色半透明变体（图表大面积填充/条形用；值 = 主题色 + 透明度，保持风格一致） */
const SOFT = {
  blue: 'rgba(89,183,255,0.28)', // 小提琴密度
  blueBar: 'rgba(89,183,255,0.45)', // 玩家生态散点
  blueBar70: 'rgba(89,183,255,0.7)', // 副词条/组合横向条
  acc: 'rgba(247,212,29,0.12)', // 箱线盒体
  accBar: 'rgba(247,212,29,0.7)', // 中位条
  green: 'rgba(127,216,164,0.8)', // 0 影
  purple: 'rgba(180,140,255,0.85)', // 6 影
};

/** 坐标轴/网格/标签（统一引用主题色） */
const AXIS_LINE = { lineStyle: { color: CHART_COLORS.line } };
const AXIS_LABEL = { color: CHART_COLORS.dim, fontSize: 10 };
const AXIS_LABEL_SMALL = { ...AXIS_LABEL, fontSize: 9 }; // 多子图/紧凑图表
const SPLIT_LINE = { lineStyle: { color: CHART_COLORS.line } };
/** 图例统一样式 */
const CHART_LEGEND = { textStyle: { color: CHART_COLORS.dim }, top: 4 };
/** 单图标题（整图居中标题） */
const CHART_TITLE = { textStyle: { color: '#eee', fontSize: 13 } };
/** 多子图的小标题（每个子图上方） */
const CHART_SUBTITLE = { textStyle: { color: CHART_COLORS.dim, fontSize: 11 } };

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
/** 窗口尺寸变化时 resize 所有已挂载图表（页面 resize 自动触发，防抖 150ms；
 *  多子图布局（技能分布/推荐三档等百分比 grid）依赖 resize 重算才能跟随容器宽度） */
export function resizeCharts() {
  for (const c of instances.values()) c.resize();
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
export function baseYAxis() {
  return { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE };
}
/** 暗色 tooltip（统一悬浮风格） */
export const DARK_TOOLTIP = {
  backgroundColor: CHART_COLORS.card,
  borderColor: CHART_COLORS.acc,
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
        const hit = c.reached == null ? '' : c.reached ? `<span style="color:${CHART_COLORS.green}">✓ 达到推荐中档</span>` : `<span style="color:${CHART_COLORS.orange}">未达推荐中档</span>`;
        return `${attrs[p.value[0]]}<br>${c.label != null ? `${c.label}<br>` : ''}玩家百分位 <b>${Math.round(c.pct)}%</b>${hit ? '<br>' + hit : ''}`;
      },
    },
    xAxis: { ...baseXAxis(attrs), axisLabel: { ...AXIS_LABEL, interval: 0, rotate: 35 } },
    yAxis: { type: 'category', data: data.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    visualMap: {
      min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
      inRange: { color: ['#4a1a1a', '#8a4a1e', '#d4a81e', CHART_COLORS.green] }, // 深红→橙→金→绿，色阶鲜明
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
        label: { show: true, formatter: (p) => p.data[2], position: 'top', color: CHART_COLORS.dim, fontSize: 10 },
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
  items.forEach((item, i) => {
    // 小提琴密度：镜像直方图（dist.hist 存在时；半透明蓝左右对称，箱线居中叠加）
    const hist = item.dist?.hist;
    if (hist?.counts?.length) {
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
        label: { show: true, position: 'top', color: CHART_COLORS.dim },
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
      inRange: { color: ['#333', CHART_COLORS.green, CHART_COLORS.acc] },
      textStyle: { color: CHART_COLORS.dim },
    },
  };
}

/** 推荐三档 × 玩家分布 增强图：每属性一个子图，y 轴 4 行——
 *  玩家 P10-P90 区间 / 低配·毕业·高配 median±sd 区间，我的值用贯穿全图的红色竖线标记（带玩家百分位标签）。
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
        push(item[k].median - item[k].sd);
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
      // 数值轴的 axisPointer 默认不显示（类目轴才默认显示竖线），必须显式在轴上开启
      axisPointer: { show: true, type: 'line', lineStyle: { color: CHART_COLORS.acc, type: 'dashed', width: 1.5 } },
    });
    /** 区间行：空 bar series + markArea 半透明区域（[from, to]，x 为 value 坐标） */
    const areaRow = (cat, from, to, color) => {
      if (from == null || to == null) return;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
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
            color: '#1c1c1e',
            fontSize: 9,
            formatter: `${lo.toFixed(1)} ~ ${hi.toFixed(1)}`,
          },
          data: [[{ yAxis: cat, xAxis: lo }, { yAxis: cat, xAxis: hi }]],
        },
      });
    };
    if (item.player?.p10 != null && item.player?.p90 != null) {
      areaRow('玩家', item.player.p10, item.player.p90, COLORS.player);
    }
    for (const [k, cat, color] of [['low', '低配', COLORS.low], ['mid', '毕业', COLORS.mid], ['high', '高配', COLORS.high]]) {
      const v = item[k];
      if (v?.median == null) continue;
      const sd = v.sd != null ? v.sd : 0;
      areaRow(cat, v.median - sd, v.median + sd, color);
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
            fontSize: 9,
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
      axisPointer: { type: 'line', lineStyle: { color: CHART_COLORS.acc, type: 'dashed', width: 1.5 } },
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

// ================= 练度总览 / 驱动盘新图表 =================

/** 影画金字塔：每角色 0-6 影占比堆叠横条（ranks 为 7 个占比，合计 ≤100） */
export function rankPyramidOption(rows) {
  // rows: [{name, ranks: [p0..p6]}]
  const RANK_COLORS = [
    '#4a4a4a',
    CHART_COLORS.green,
    CHART_COLORS.acc,
    CHART_COLORS.acc2,
    CHART_COLORS.orange,
    CHART_COLORS.red,
    CHART_COLORS.purple,
  ];
  const series = [0, 1, 2, 3, 4, 5, 6].map((r) => ({
    name: `${r} 影`,
    type: 'bar',
    stack: 'rank',
    data: rows.map((x) => x.ranks[r]),
    barWidth: 14,
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
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series,
  };
}

/** 玩家生态散点：X=角色数、Y=平均装配评分（大样本 large 模式；气泡 = 最高评分经 tooltip 展示） */
export function playerScatterOption(points) {
  return {
    grid: CHART_GRID,
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) =>
        `角色数 <b>${p.value[0]}</b><br>平均评分 <b>${p.value[1]}</b><br>最高评分 <b>${p.value[2] ?? '—'}</b>`,
    },
    xAxis: { name: '角色池大小', ...baseYAxis() },
    yAxis: { name: '平均装配评分', ...baseYAxis() },
    series: [
      {
        type: 'scatter',
        large: true,
        symbolSize: 4,
        data: points.map((p) => [p.chars, p.avgRelic, p.maxRelic]),
        itemStyle: { color: SOFT.blueBar },
        emphasis: { itemStyle: { color: CHART_COLORS.acc } },
      },
    ],
  };
}

/** 全角色评分中位条形（p10-p90 区间以 scatter 叠加显示） */
export function relicBarOption(rows) {
  // rows: [{name, median, p10, p90, count}]
  return {
    grid: { left: 90, right: 40, top: 30, bottom: 24, containLabel: true },
    tooltip: {
      ...DARK_TOOLTIP,
      formatter: (p) => {
        const d = p.data?.d || p.data;
        return `${d.name}<br>中位 <b>${d.median}</b><br>P10-P90 <b>${d.p10} ~ ${d.p90}</b><br>样本 ${d.count}`;
      },
    },
    xAxis: { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => ({ value: r.median, d: r })),
        barWidth: 10,
        itemStyle: { color: SOFT.accBar },
        label: { show: true, position: 'right', color: CHART_COLORS.dim, fontSize: 9, formatter: (p) => p.value },
      },
      {
        type: 'scatter',
        symbolSize: 2,
        data: rows.flatMap((r) => [
          { value: [r.p10, r.name], d: r },
          { value: [r.p90, r.name], d: r },
        ]),
        itemStyle: { color: CHART_COLORS.blue },
        silent: true,
      },
    ],
  };
}

/** 影画收益：每角色 0 影 vs 6 影 关键属性 P50 分组横条 */
export function layerGainOption(rows) {
  // rows: [{name, attr, rank0, rank6}]
  return {
    grid: { left: 90, right: 40, top: 36, bottom: 24, containLabel: true },
    tooltip: { ...DARK_TOOLTIP, trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: CHART_LEGEND,
    xAxis: { type: 'value', axisLine: { show: false }, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
    yAxis: { type: 'category', data: rows.map((r) => r.name), axisLine: { show: false }, axisLabel: AXIS_LABEL },
    series: [
      {
        name: '0 影 P50',
        type: 'bar',
        data: rows.map((r) => r.rank0),
        barWidth: 8,
        itemStyle: { color: SOFT.green },
      },
      {
        name: '6 影 P50',
        type: 'bar',
        data: rows.map((r) => r.rank6),
        barWidth: 8,
        itemStyle: { color: SOFT.purple },
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
          fontSize: 10,
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
        const it = items[arr[0]?.dataIndex != null ? 0 : 0];
        const p = arr[0];
        const lv = p?.name;
        const c = p?.value;
        if (lv == null) return '';
        const mineMark = it?.mine != null && Number(lv) === it.mine ? '（<b style="color:#f7d41d">我的等级</b>）' : '';
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
    'rgba(247,212,29,0.8)', 'rgba(89,183,255,0.75)', 'rgba(127,216,164,0.75)', 'rgba(255,155,92,0.75)',
    'rgba(180,140,255,0.75)', 'rgba(229,72,77,0.75)', 'rgba(255,179,0,0.75)', 'rgba(139,138,131,0.7)',
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
        label: { show: true, position: 'right', color: CHART_COLORS.dim, fontSize: 9, formatter: '{c}%' },
      },
    ],
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
        label: { show: true, position: 'right', color: CHART_COLORS.dim, fontSize: 9 },
      },
    ],
  };
}
