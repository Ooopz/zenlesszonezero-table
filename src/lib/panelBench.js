// src/lib/panelBench.js —— 面板对标数据合并（推荐 high 档 / 玩家真实样本 / 我的 三源），纯函数（Node 与浏览器共用）
// 数据源：plans.json（推荐方案 high 档毕业值聚合）、workshop-stats.json（玩家真实样本 min/max/mean/median）、characters.json（我的 final）。
// 思路：每属性展示三组统计——推荐毕业档范围（high 的 min→max，圆点 mean/median）、玩家真实样本范围（min→max，圆点 mean/median）、我的值。
import { sd, median, cv } from './distStats.js';
import { resolveName, CATEGORY, CHAR_ALIASES } from './names.js';

/** 特性 → 关键属性模板（按该特性角色推荐方案里最常出现的面板属性确定，数据验证过） */
export const TRAIT_KEY_STATS = {
  强攻: ['攻击力', '暴击率', '暴击伤害', '穿透率'],
  异常: ['攻击力', '异常精通', '异常掌控'],
  击破: ['冲击力', '暴击率', '暴击伤害'],
  支援: ['攻击力', '能量自动回复'],
  防护: ['生命值', '防御力', '攻击力'],
  命破: ['生命值', '暴击率', '暴击伤害'],
};

/** 特性 → 关键属性模板；未知特性回退通用核心属性 */
export function traitKeyStats(trait) {
  return TRAIT_KEY_STATS[trait] || ['攻击力', '暴击率', '暴击伤害'];
}

/** 兼容旧引用：角色名别名已并入 src/lib/names.js 的统一别名表（维琳娜/星徽·比利/提缇/11号） */
export { CHAR_ALIASES };

/** 数值聚合：min / max / mean / median / count */
function agg(vals) {
  if (!vals.length) return { count: 0, min: null, max: null, mean: null, median: null };
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((acc, v) => acc + v, 0);
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    mean: sum / n,
    median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
  };
}

/**
 * 推荐 high 档（毕业档）统计：对每角色每属性的方案 high 值做 min/max/mean/median 聚合。
 * @param {object} plans  plans.json：{ avatarId: { name, plans: [...] } }，plan.panel = [{name, low, mid, high}]
 * @returns {Object<string, Object<string, {count:number, min:number, max:number, mean:number, median:number}>>}
 *   角色名 → 属性名 → 统计（仅 high 值非空的属性）。
 */
export function computeRecHighStats(plans) {
  const acc = {}; // 角色名 -> {属性: [high 值]}
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name) continue;
    const byAttr = (acc[v.name] ??= {});
    for (const p of v.plans || []) {
      for (const q of p.panel || []) {
        if (!q || q.name == null || q.high == null) continue;
        (byAttr[q.name] ??= []).push(q.high);
      }
    }
  }
  const out = {};
  for (const [name, byAttr] of Object.entries(acc)) {
    out[name] = {};
    for (const [attr, vals] of Object.entries(byAttr)) out[name][attr] = agg(vals);
  }
  return out;
}

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
  return { count: clean.length, mean, median: median(clean), sd: sdv, cv: cv(clean, mean), outliers: s.length - clean.length };
}

/**
 * 推荐三档统计：每角色每属性 low/mid/high 的 mean/median/sd/CV。
 * 过滤 low=mid=0 的占位属性（冲击力/异常掌控/能量自动回复/穿透率等只有 high 有值，三档统计无意义 → 只保留 high）。
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
      // low/mid 恒为 0 的占位属性：三档统计无意义，只保留 high
      if (low && low.median === 0 && mid && mid.median === 0 && high) {
        out[name][attr] = { low: null, mid: null, high };
      } else {
        out[name][attr] = { low, mid, high };
      }
    }
  }
  return out;
}

/**
 * 合并三源面板数据为对标行。
 *
 * @param {object} plans  plans.json（用于推荐 high 档统计 + 方案属性频率 + 方案数）
 * @param {object} [sampleMap]  角色名 → {属性:{count,min,max,mean,median}}（玩家真实样本，来自 workshop-stats.panels）
 * @param {object} [myFinalMap] 角色名 → {属性: final}（账号面板，来自 characters.json）
 * @param {object} [traitMap]   角色名 → 特性（来自 library.characters）
 * @param {object} [nameIndex]  角色名索引（src/lib/names.js buildNameIndex 的产物，可选）。
 *   提供时 sample/mine 的角色名经统一 resolver 对齐到标准名（别名/子串兜底），否则用旧 CHAR_ALIASES + plans 子串逻辑。
 * @returns {{name:string, trait:string, planCount:number, keyAttrs:string[], stats:Object<string,{rec:{count,min,max,mean,median}|null, ws:{count,min,max,mean,median}|null, mine:number|null}>}[]}
 *   rec = 推荐 high 档统计、ws = 玩家真实样本统计、mine = 我的 final（仅账号角色）。
 *   stats 含该角色全部有数据的属性（推荐/样本/账号并集），keyAttrs 为特性模板命中的关键属性（排前）。
 */
export function buildPanelBenchmark(plans, sampleMap, myFinalMap, traitMap, nameIndex) {
  const recHigh = computeRecHighStats(plans);
  const planCount = {};
  const freq = {};
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name) continue;
    planCount[v.name] = (v.plans || []).length;
    const f = (freq[v.name] ??= {});
    for (const p of v.plans || []) for (const q of p.panel || []) if (q && q.name) f[q.name] = (f[q.name] || 0) + 1;
  }
  // 角色名对齐：sample（grad 简称如 11号/维琳娜）与 myFinal（账号名）统一到标准名（「11号」/维琳娜·艾嘉德）。
  // 有 nameIndex 时走统一 resolver（别名/归一化/子串兜底），否则回退旧 CHAR_ALIASES + plans 子串逻辑。
  const planNames = Object.keys(recHigh);
  const alignName = (name) => {
    if (nameIndex) {
      const n = resolveName(CATEGORY.CHAR, nameIndex, name, { fuzzy: true })?.name;
      if (n) return n;
    }
    const a = CHAR_ALIASES[name] || name;
    if (planNames.includes(a)) return a;
    return planNames.find((p) => p.includes(a) || a.includes(p)) || a;
  };
  const normSample = {};
  for (const [k, v] of Object.entries(sampleMap || {})) Object.assign((normSample[alignName(k)] ??= {}), v);
  const normMine = {};
  for (const [k, v] of Object.entries(myFinalMap || {})) Object.assign((normMine[alignName(k)] ??= {}), v);
  const names = [...new Set([...planNames, ...Object.keys(normSample), ...Object.keys(normMine)])];
  return names.map((name) => {
    const trait = traitMap?.[name] || '';
    const sample = normSample[name] || {};
    const mine = normMine[name] || {};
    const f = freq[name] || {};
    // 关键属性（特性模板命中）排前；其余所有有数据的属性按序补全 → 展示全部数值
    const keyCols = traitKeyStats(trait).filter((s) => f[s] || recHigh[name]?.[s]);
    const allAttrs = [...new Set([...Object.keys(recHigh[name] || {}), ...Object.keys(sample), ...Object.keys(mine)])];
    const cols = [...keyCols, ...allAttrs.filter((s) => !keyCols.includes(s))];
    const stats = {};
    for (const s of cols) {
      stats[s] = {
        rec: recHigh[name]?.[s] || null,
        ws: sample[s] || null,
        mine: mine[s] ?? null,
      };
    }
    return { name, trait, planCount: planCount[name] || 0, keyAttrs: keyCols, stats };
  });
}
