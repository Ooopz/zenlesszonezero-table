// src/lib/panelRange.js —— 角色面板推荐区间统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json 的 plan.panel [{name, percent, low, mid, high}]（低配/毕业/高配三档目标）。
// 一个角色有多个方案、同一属性目标值不一致时，三档各自取中位作为推荐代表值。
import { normalize } from './util.js';

/** 数值数组中位数：排序取中间；偶数取相邻均值；空返回 null */
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * 计算角色面板推荐区间表。
 *
 * @param {object} plans  { avatarId: { name, plans: [...] } }
 *   plan.panel = [{ name, percent, low, mid, high }]（属性名已归一化）
 * @returns {{name:string, planCount:number, stats:Object<string,{low:number,mid:number,high:number}>}[]}
 *   planCount：该角色方案总数。
 *   stats：属性名 → 三档中位推荐值（某属性在某档缺数据时为 null）。
 *   每个角色一行，未出现在任何方案的属性不列出。
 */
export function computePanelRanges(plans) {
  const acc = new Map();
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    const role = normalize(v.name);
    if (!acc.has(role)) acc.set(role, { name: v.name, planCount: 0, byStat: new Map() });
    const a = acc.get(role);
    a.planCount += v.plans.length;
    for (const p of v.plans) {
      for (const q of p.panel || []) {
        if (!q || q.name == null) continue;
        if (!a.byStat.has(q.name)) a.byStat.set(q.name, { lows: [], mids: [], highs: [] });
        const b = a.byStat.get(q.name);
        if (q.low != null) b.lows.push(q.low);
        if (q.mid != null) b.mids.push(q.mid);
        if (q.high != null) b.highs.push(q.high);
      }
    }
  }
  return [...acc.values()].map((a) => {
    const stats = {};
    for (const [statName, b] of a.byStat) {
      stats[statName] = { low: median(b.lows), mid: median(b.mids), high: median(b.highs) };
    }
    return { name: a.name, planCount: a.planCount, stats };
  });
}
