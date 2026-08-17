// src/lib/panelBench.js —— 推荐方案三档（low/mid/high）统计纯函数（Node 与浏览器共用）
// 数据源：plans.json 的 plan.panel [{name, low, mid, high}]。
// 消费方：src/web/recommend.js（统计视图「推荐三档 × 玩家分布」等图表）。
import { sd, median, cv } from './distStats.js';

/** 一档值的统计：MAD 排除离群（哨兵值/异常方案）后算 mean/median/sd/cv；排除后样本 <3 视为该档不可靠返回 null */
function tierStat(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = median(s);
  // MAD（中位数绝对偏差）离群排除：|v-median| > 3×1.4826×MAD 视为离群（对偏态稳健，可排除哨兵如生命 100000/攻击 10000）
  const absDev = s.map((v) => Math.abs(v - m));
  const mad = median(absDev) * 1.4826;
  const threshold = mad ? 3 * mad : Infinity;
  const clean = s.filter((v) => Math.abs(v - m) <= threshold);
  // 排除后样本不足 3 → 该档位不具代表性（如个别方案的异常档值），标记不可靠
  if (clean.length < 3) return null;
  const mean = clean.reduce((a, v) => a + v, 0) / clean.length;
  const sdv = sd(clean, mean);
  return {
    count: clean.length,
    mean,
    median: median(clean),
    sd: sdv,
    cv: cv(clean, mean),
    outliers: s.length - clean.length,
  };
}

/**
 * 推荐三档统计：每角色每属性 low/mid/high 的 mean/median/sd/CV。
 * 过滤 low=mid=0 的占位属性（冲击力/异常掌控/能量自动回复/穿透率等方案里只有 high 有值或无值，
 * 三档统计无意义 → low/mid 置 null，前端只显示有信息的区间）。
 * @param {object} plans  plans.json：{ avatarId: { name, plans: [...] } }，plan.panel = [{name, low, mid, high}]
 * @returns {Object<string, Object<string, {low:Stat|null, mid:Stat|null, high:Stat|null}>}
 *   Stat = {count, mean, median, sd, cv}；cv 用于「共识度」（推荐体系指标）。
 */
export function computeRecTierStats(plans) {
  const acc = {}; // 角色名 -> {属性: {low:[], mid:[], high:[]}}
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name) continue;
    const byAttr = (acc[v.name] ??= {});
    for (const p of v.plans || []) {
      for (const q of p.panel || []) {
        if (!q || q.name == null) continue;
        const t = (byAttr[q.name] ??= { low: [], mid: [], high: [] });
        if (q.low != null) t.low.push(q.low);
        if (q.mid != null) t.mid.push(q.mid);
        if (q.high != null) t.high.push(q.high);
      }
    }
  }
  const out = {};
  for (const [name, byAttr] of Object.entries(acc)) {
    out[name] = {};
    for (const [attr, tiers] of Object.entries(byAttr)) {
      const low = tierStat(tiers.low);
      const mid = tierStat(tiers.mid);
      const high = tierStat(tiers.high);
      // low/mid 恒为 0 的占位属性：三档统计无意义（无论 high 是否存在）→ low/mid 置 null
      if (low && low.median === 0 && mid && mid.median === 0) {
        out[name][attr] = { low: null, mid: null, high };
      } else {
        out[name][attr] = { low, mid, high };
      }
    }
  }
  return out;
}
