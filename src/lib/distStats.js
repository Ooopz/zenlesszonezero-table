// src/lib/distStats.js —— 分布统计纯函数（分位/离散/形态/相关/战力/均衡/聚类/档位匹配），Node 与浏览器共用
// 供 workshopStats 聚合扩展、统计视图图表、个人对标共用。

/** 分位数（线性插值）：对数组排序后取 q 分位（q∈[0,1]）。内部排序，调用方无需预排序 */
export function quantile(arr, q) {
  if (!arr || !arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return hi === lo ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
/** 中位数 */
export function median(sorted) {
  return quantile(sorted, 0.5);
}
/** 标准差（总体）；样本不足 2 返回 null */
export function sd(vals, mean) {
  if (vals.length < 2) return null;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}
/** 偏度（样本≥3）；右偏>0、左偏<0 */
export function skew(vals, mean, s) {
  if (vals.length < 3 || !s) return null;
  return vals.reduce((a, v) => a + (v - mean) ** 3, 0) / vals.length / s ** 3;
}
/** 超额峰度（样本≥4）：>0 尖峰、<0 平峰 */
export function kurt(vals, mean, s) {
  if (vals.length < 4 || !s) return null;
  return vals.reduce((a, v) => a + (v - mean) ** 4, 0) / vals.length / s ** 4 - 3;
}
/** 变异系数 CV = sd/mean（mean=0 或样本不足返回 null）；越小共识越高 */
export function cv(vals, mean) {
  const s = sd(vals, mean);
  return s != null && mean ? s / Math.abs(mean) : null;
}
/** 皮尔逊相关系数（配对数组）；样本不足 2 或方差为 0 返回 null */
export function pearson(a, b) {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den ? num / den : null;
}
/** 值在分布中的百分位（0-100）：返回≤该值的比例 */
export function percentileOf(sorted, v) {
  if (!sorted.length) return null;
  let i = 0;
  while (i < sorted.length && sorted[i] <= v) i++;
  return (i / sorted.length) * 100;
}
/** 玩家分布统计对象：集中/离散/分位/形态 + 离群值排除（箱线图 IQR 1.5 规则）。供 workshopStats panelStats 复用 */
export function computeDist(arr) {
  if (!arr.length) return { count: 0, min: null, max: null, mean: null, median: null };
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, v) => a + v, 0) / n;
  const sdev = sd(s, mean);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  // 离群值阈值：IQR 1.5 规则（Q1-1.5IQR 以下 / Q3+1.5IQR 以上）
  const fenceLow = q1 - 1.5 * iqr;
  const fenceHigh = q3 + 1.5 * iqr;
  // 排除离群值后的箱线须端点：IQR 规则内的最远值；离群值计数
  let whiskerLow = null;
  let whiskerHigh = null;
  let outliers = 0;
  for (let i = 0; i < n; i++) {
    if (s[i] < fenceLow || s[i] > fenceHigh) outliers++;
    if (whiskerLow == null && s[i] >= fenceLow) whiskerLow = s[i];
  }
  for (let i = n - 1; i >= 0; i--) {
    if (s[i] <= fenceHigh) {
      whiskerHigh = s[i];
      break;
    }
  }
  // IQR 塌缩兜底：大量数据集中在同一值（如基础暴伤 0.66，P25=P75）时 IQR≈0、须端缩成一条线，
  // 且 IQR 规则会把真正堆该属性的主流玩家误判为离群。此时退化为分位数规则：
  // 须端用 P10/P90 展示主流区间，离群改为 P5/P95 之外（保留堆属性的玩家）
  if (whiskerLow == null || whiskerHigh == null || iqr <= (s[n - 1] - s[0]) * 0.02) {
    whiskerLow = quantile(s, 0.1);
    whiskerHigh = quantile(s, 0.9);
    const p5 = quantile(s, 0.05);
    const p95 = quantile(s, 0.95);
    outliers = 0;
    for (let i = 0; i < n; i++) if (s[i] < p5 || s[i] > p95) outliers++;
  }
  // 直方图（等宽分箱，供分布形态展示）
  const HIST_BINS = 16;
  const hbins = new Array(HIST_BINS + 1);
  const hcounts = new Array(HIST_BINS).fill(0);
  const hspan = s[n - 1] - s[0] || 1;
  for (let i = 0; i <= HIST_BINS; i++) hbins[i] = s[0] + (hspan / HIST_BINS) * i;
  for (const v of s) {
    const idx = Math.min(HIST_BINS - 1, Math.floor(((v - s[0]) / hspan) * HIST_BINS));
    hcounts[idx]++;
  }
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    range: s[n - 1] - s[0],
    mean,
    median: median(s),
    sd: sdev,
    IQR: iqr,
    p10: quantile(s, 0.1),
    p25: q1,
    p50: median(s),
    p75: q3,
    p90: quantile(s, 0.9),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    skew: skew(s, mean, sdev),
    kurt: kurt(s, mean, sdev),
    // 离群值排除（箱线图用 whiskerLow/whiskerHigh 作须端，outliers 为离群数量）
    whiskerLow,
    whiskerHigh,
    outliers,
    // 分布形态：直方图（bins 为箱边界含两端，counts 为每箱频次）
    hist: { bins: hbins, counts: hcounts },
  };
}
/** 综合战力得分：各属性值相对玩家中位数归一化后加权求和（越高越强） */
export function computePowerScore(attrVals, medianMap, weights) {
  let score = 0;
  for (const [attr, w] of Object.entries(weights || {})) {
    const v = attrVals[attr];
    const m = medianMap[attr];
    if (v == null || m == null || !m) continue;
    score += (v / m) * w;
  }
  return score;
}
/** 属性配比：{属性: 比例}（对总和归一化） */
export function computeRatio(attrVals, attrs) {
  const sum = (attrs || []).reduce((s, a) => s + (attrVals[a] || 0), 0);
  if (!sum) return {};
  const o = {};
  for (const a of attrs || []) o[a] = (attrVals[a] || 0) / sum;
  return o;
}
/** 属性均衡度：多属性值的变异系数（越小越均衡） */
export function computeBalance(attrVals, attrs) {
  const vals = (attrs || []).map((a) => attrVals[a]).filter((x) => x != null && x > 0);
  if (vals.length < 2) return null;
  const m = vals.reduce((s, v) => s + v, 0) / vals.length;
  return cv(vals, m);
}
/** 简单 k-means 聚类（确定性初始化：前 k 个点作质心）。points 为等长数值向量，返回每项簇编号 */
export function kmeans(points, k = 3, maxIter = 50) {
  if (!points.length) return [];
  const dim = points[0].length;
  let centers = points.slice(0, k).map((p) => [...p]);
  const assign = new Array(points.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        let d = 0;
        for (let j = 0; j < dim; j++) d += (points[i][j] - centers[c][j]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => new Array(dim).fill(0));
    const cnts = new Array(centers.length).fill(0);
    for (let i = 0; i < points.length; i++) {
      cnts[assign[i]]++;
      for (let j = 0; j < dim; j++) sums[assign[i]][j] += points[i][j];
    }
    let moved = false;
    for (let c = 0; c < centers.length; c++) {
      if (!cnts[c]) continue;
      for (let j = 0; j < dim; j++) {
        const nc = sums[c][j] / cnts[c];
        if (Math.abs(nc - centers[c][j]) > 1e-9) moved = true;
        centers[c][j] = nc;
      }
    }
    if (!moved) break;
  }
  return assign;
}
/** 推荐档位匹配：个人值落推荐三档的位置 */
export function tierFit(value, rec) {
  if (value == null || !rec || rec.low == null || rec.high == null) return null;
  if (value < rec.low) return { tier: 'below', label: '低于低标' };
  if (value < rec.mid) return { tier: 'low-mid', label: '低标~中标' };
  if (value < rec.high) return { tier: 'mid-high', label: '中标~高标' };
  return { tier: 'above', label: '高于高标' };
}
