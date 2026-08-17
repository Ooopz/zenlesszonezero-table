// src/lib/distStats.js —— 分布统计纯函数（分位/离散/形态/相关/战力/聚类/档位匹配），Node 与浏览器共用
// 供 workshopStats 聚合、workshopStats 相关计算与测试使用。

/** 已排序数组的分位数（线性插值）：假设 arr 升序已排序，q∈[0,1]。
 *  computeDist 等已知排序好的场景直接用此函数，避免 quantile 重复排序。
 *  q 会被夹到 [0,1]；非有限 q 返回 null（此前 q=2 会静默返回 undefined）。 */
export function quantileSorted(arr, q) {
  if (!arr || !arr.length) return null;
  if (!Number.isFinite(q)) return null;
  const qq = Math.min(1, Math.max(0, q));
  const pos = qq * (arr.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return hi === lo ? arr[lo] : arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
}
/** 分位数（线性插值）：对数组排序后取 q 分位（q∈[0,1]）。内部排序，调用方无需预排序 */
export function quantile(arr, q) {
  if (!arr || !arr.length) return null;
  return quantileSorted([...arr].sort((a, b) => a - b), q);
}
/** 中位数（内部排序，入参可乱序） */
export function median(sorted) {
  return quantile(sorted, 0.5);
}
/** 标准差（总体）；样本不足 2 或入参非数组返回 null */
export function sd(vals, mean) {
  if (!Array.isArray(vals) || vals.length < 2) return null;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
}
/** 偏度（样本≥3）；右偏>0、左偏<0 */
export function skew(vals, mean, s) {
  if (!Array.isArray(vals) || vals.length < 3 || !s) return null;
  return vals.reduce((a, v) => a + (v - mean) ** 3, 0) / vals.length / s ** 3;
}
/** 超额峰度（样本≥4）：>0 尖峰、<0 平峰 */
export function kurt(vals, mean, s) {
  if (!Array.isArray(vals) || vals.length < 4 || !s) return null;
  return vals.reduce((a, v) => a + (v - mean) ** 4, 0) / vals.length / s ** 4 - 3;
}
/** 变异系数 CV = sd/mean（mean=0 或样本不足返回 null）；越小共识越高 */
export function cv(vals, mean) {
  const s = sd(vals, mean);
  return s != null && mean ? s / Math.abs(mean) : null;
}
/** 皮尔逊相关系数（配对数组）；样本不足 2 或方差为 0 返回 null。
 *  长度不等时按较短者配对——此前只取 a.length，越界读到 undefined 使结果静默变 NaN。 */
export function pearson(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
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
/** computeDist 的空结果：与正常返回**同形**（键齐全、值为 null）。
 *  此前空数组只返回 5 个键，消费端读 .p50/.hist 拿到 undefined 而无任何报错。 */
const EMPTY_DIST = Object.freeze({
  count: 0,
  min: null,
  max: null,
  range: null,
  mean: null,
  median: null,
  sd: null,
  IQR: null,
  p10: null,
  p25: null,
  p50: null,
  p75: null,
  p90: null,
  p95: null,
  p99: null,
  skew: null,
  kurt: null,
  whiskerLow: null,
  whiskerHigh: null,
  outliers: 0,
  hist: null,
});

/** 玩家分布统计对象：集中/离散/分位/形态 + 离群值排除（箱线图 IQR 1.5 规则）。供 workshopStats panelStats 复用。
 *  非有限值（NaN/Infinity/null）会被过滤——否则单个 NaN 会污染 mean/sd/skew/kurt 并被写进 workshop-stats.json。 */
export function computeDist(arr) {
  if (!Array.isArray(arr) || !arr.length) return { ...EMPTY_DIST };
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { ...EMPTY_DIST };
  const n = s.length;
  const mean = s.reduce((a, v) => a + v, 0) / n;
  const sdev = sd(s, mean);
  // 分位数一次性算好（s 已排序，直接用 quantileSorted 避免反复排序）
  const p5 = quantileSorted(s, 0.05);
  const p10 = quantileSorted(s, 0.1);
  const q1 = quantileSorted(s, 0.25);
  const med = quantileSorted(s, 0.5);
  const q3 = quantileSorted(s, 0.75);
  const p90 = quantileSorted(s, 0.9);
  const p95 = quantileSorted(s, 0.95);
  const p99 = quantileSorted(s, 0.99);
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
    whiskerLow = p10;
    whiskerHigh = p90;
    outliers = 0;
    for (let i = 0; i < n; i++) if (s[i] < p5 || s[i] > p95) outliers++;
  }
  // 直方图（等宽分箱，供分布形态展示；细一点更能看出分布峰/谷）
  const HIST_BINS = 32;
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
    median: med,
    sd: sdev,
    IQR: iqr,
    p10,
    p25: q1,
    p50: med,
    p75: q3,
    p90,
    p95,
    p99,
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
