// src/lib/discAdvisor.js —— 驱动盘推荐统计（纯逻辑，Node 与浏览器共用）
// 按盘名聚合 data/plans.json（见 src/sync/plans.js）全部推荐方案：推荐用到该盘（2/4 件套）的角色、
// 主/副词条出现频次与 456 主属性。二件套按「效果」替代（同 set2 效果的盘互替，如 荆棘玫瑰/灵魂摇滚 都是 防御力0.16），
// 四件套效果无结构化数值保持按套装名；套装名解析走 src/lib/names.js 的 resolver。
import { buildNameIndex, resolveName, CATEGORY } from './names.js';
import { SUBSTAT_TYPE_SET } from './constants.js';

/** set2 效果 → 规范化组键：null/空 → null（无二件套效果，自成组不扩展）；否则属性键排序后序列化 */
function set2Key(s2) {
  if (!s2 || typeof s2 !== 'object') return null;
  const entries = Object.entries(s2);
  if (!entries.length) return null;
  return JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Map<词条名, 次数> → 按出现次数降序的频次数组；ratio = 出现次数 / 方案总数（count） */
function freqList(freq, total) {
  return [...freq.entries()]
    .map(([name, count]) => ({ name, count, ratio: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 计算驱动盘统计表：按盘聚合全部方案 → 采用角色（去重）、副词条组合（按方案去重）、
 * 词条/456 主属性频次（降序；ratio = 次数/count）。count = 采用该盘的方案总数（含 2 件套同效替代），
 * 作频次分母；传 discSet2 时 2 件套按同效果组扩展，alternatives 为同效果其他盘；未被采用时 count=0、数组为空。
 */
export function computeDiscStats(plans, discNames, discSet2) {
  const index = buildNameIndex(discNames || [], CATEGORY.DISC);
  const acc = new Map();
  for (const name of discNames || []) {
    acc.set(name, {
      name,
      count: 0,
      chars: new Set(),
      combos: new Set(),
      subFreq: new Map(),
      mainFreq: { 4: new Map(), 5: new Map(), 6: new Map() },
    });
  }
  // 二件套效果组索引：set2Key → 规范盘名[]（仅 discNames 内、非 null set2 的盘）
  const groupByKey = discSet2 ? new Map() : null;
  if (groupByKey) {
    for (const name of discNames || []) {
      const k = set2Key(discSet2[name]);
      if (k == null) continue;
      if (!groupByKey.has(k)) groupByKey.set(k, []);
      groupByKey.get(k).push(name);
    }
  }
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    for (const p of v.plans) {
      if (!p || !Array.isArray(p.sets)) continue;
      // 副词条/主属性属整套配装，对方案里每个套装都计入；组合去重 = 排序后序列化（忽略组内顺序）
      const comboKey = Array.isArray(p.subStats) && p.subStats.length ? JSON.stringify([...p.subStats].sort()) : null;
      // 计入口盘（Set 去重）：4 件套按套装名、2 件套按 set2 效果组扩展；
      // 同方案内两个同效果 2 件套或 4+2 双命中只计一次（方案级去重防重复计数）
      const hit = new Set();
      for (const s of p.sets) {
        if (!s || typeof s.name !== 'string' || (s.cnt !== 2 && s.cnt !== 4)) continue;
        // 套装名经 resolver 解析为标准盘名（别名/尾随空格）；未命中跳过
        const name = resolveName(CATEGORY.DISC, index, s.name)?.name;
        if (!name || !acc.has(name)) continue;
        if (s.cnt === 4 || !groupByKey) {
          hit.add(name);
          continue;
        }
        // 2 件套：set2 为 null（无二件套效果）→ 仅自己；否则扩展到同效果组所有盘
        const k = set2Key(discSet2?.[name]);
        if (k == null) {
          hit.add(name);
          continue;
        }
        for (const other of groupByKey.get(k) || []) hit.add(other);
      }
      for (const hn of hit) {
        const a = acc.get(hn);
        a.count += 1;
        a.chars.add(v.name);
        if (comboKey) a.combos.add(comboKey);
        for (const t of p.subStats || []) a.subFreq.set(t, (a.subFreq.get(t) || 0) + 1);
        for (const k of [4, 5, 6]) {
          const m = p.mainProps?.[k];
          if (m) a.mainFreq[k].set(m, (a.mainFreq[k].get(m) || 0) + 1);
        }
      }
    }
  }
  return [...acc.values()].map((a) => {
    // 同效果二件套替代盘（不含自己；set2 为 null 或无 discSet2 时为 []）
    let alternatives = [];
    if (groupByKey) {
      const k = set2Key(discSet2?.[a.name]);
      if (k != null) alternatives = (groupByKey.get(k) || []).filter((nm) => nm !== a.name);
    }
    return {
      name: a.name,
      alternatives,
      count: a.count,
      characters: [...a.chars],
      subCombos: [...a.combos].map((k) => JSON.parse(k)),
      subStats: freqList(a.subFreq, a.count),
      main4: freqList(a.mainFreq[4], a.count),
      main5: freqList(a.mainFreq[5], a.count),
      main6: freqList(a.mainFreq[6], a.count),
    };
  });
}

/**
 * 驱动盘「决策卡」合并层：官方（computeDiscStats 行）与工坊实况（discDetails 行）两口径对齐后按共识判定——
 * keep = 官方或实况任一占比 ≥ threshold（默认 0.03）；drop = 双口径都 < threshold（仅 456 候选主词条，副词条 drop 直接过滤不返回）。
 * 副词条先按 SUBSTAT_TYPE_SET 过滤脏词条；占比口径：官方 = count/方案数，实况 = 副词条用盘数、456 用该槽 mainDenom。
 * 角色交集 = 两口径都出现（最适配）。
 * ⚠️ combos/effDist 目前只透传（web/discstats.js 尚未渲染）；effDist 自 2026-08 起是有效**强化次数**分布（0-9），非旧「有效词条个数」（上限 4 无区分度）。
 */
export function computeDiscAdvisor(official, live, mainOptions, threshold = 0.03) {
  const t = threshold;
  const oChars = new Set((official?.characters || []).map(String));
  const lChars = new Set((live?.characters || []).map(String));
  const both = [...oChars].filter((c) => lChars.has(c));
  // ---- 456 主词条：候选全集（候选 ∪ 两口径出现过的），逐槽判定 ----
  const SLOT_KEY = { 4: 'main4', 5: 'main5', 6: 'main6' };
  const mains = {};
  for (const slot of [4, 5, 6]) {
    const oMap = new Map((official?.[SLOT_KEY[slot]] || []).map((f) => [f.name, f.ratio || 0]));
    const lDenom = live?.mainDenom?.[slot] || 0;
    const lMap = new Map((live?.main456?.[slot] || []).map((f) => [f.name, lDenom ? f.count / lDenom : 0]));
    const names = new Set([...(mainOptions?.[slot] || []), ...oMap.keys(), ...lMap.keys()]);
    const items = [];
    for (const n of names) {
      const or = oMap.get(n) || 0;
      const lr = lMap.get(n) || 0;
      const verdict = or >= t || lr >= t ? 'keep' : 'drop';
      if (verdict === 'keep' || (mainOptions?.[slot] || []).includes(n))
        items.push({ name: n, official: or, live: lr, verdict });
    }
    items.sort((a, b) => (a.verdict === b.verdict ? b.live - a.live : a.verdict === 'keep' ? -1 : 1));
    mains[slot] = items;
  }
  // ---- 副词条：SUBSTAT_TYPE_SET 过滤后判定，drop 不返回 ----
  const oSub = new Map((official?.subStats || []).map((f) => [f.name, f.ratio || 0]));
  const lDenomS = live?.equips || 0;
  const lSub = new Map((live?.subs || []).map((f) => [f.name, lDenomS ? f.count / lDenomS : 0]));
  const subNames = new Set([...oSub.keys(), ...lSub.keys()]);
  const subs = [...subNames]
    .filter((n) => SUBSTAT_TYPE_SET.has(n))
    .map((n) => {
      const or = oSub.get(n) || 0;
      const lr = lSub.get(n) || 0;
      return { name: n, official: or, live: lr, verdict: or >= t || lr >= t ? 'keep' : 'drop' };
    })
    .filter((s) => s.verdict === 'keep')
    .sort((a, b) => b.live - a.live);
  return {
    roles: { official: [...oChars], live: [...lChars], both },
    mains,
    subs,
    combos: live?.subCombos || [],
    effDist: live?.effDist || null,
    equips: live?.equips || 0,
    alternatives: official?.alternatives || [],
  };
}
