// src/lib/discstats.js —— 驱动盘推荐统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json（养成指南推荐方案，见 src/sync/plans.js 的 extractPlan）。
// 按驱动盘名聚合全部角色的推荐方案，统计「推荐方案里用到该盘（2件套或4件套）的角色」、
// 这些方案推荐的主/副词条出现频次（出现得越多的词条越通用、越值得留）、以及 4/5/6 号位主属性频次。
import { normalize } from './util.js';

// 已知套装名别名（养成指南与 wiki 用词差异），键为 normalized 变体 → library 侧规范名。
// 例：米游社养成指南个别方案把「棘刺玫瑰」写作「荆棘玫瑰」（同一张防御力套装）。
const DISC_ALIASES = { 荆棘玫瑰: '棘刺玫瑰' };

/** Map<词条名, 次数> → 按出现次数降序的频次数组；ratio = 出现次数 / 方案总数（count） */
function freqList(freq, total) {
  return [...freq.entries()]
    .map(([name, count]) => ({ name, count, ratio: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 计算驱动盘统计表。
 *
 * @param {object} plans  { avatarId: { name, plans: [...] } }
 *   plan.sets = [{ name, cnt }]（cnt 为件数，2 或 4；2+2+2 / 4+2 组合就是多条）
 *   plan.subStats = [副词条名]
 *   plan.mainProps = { '4': 主属性名, '5': 名, '6': 名 }（键为字符串，值已百分比归一化）
 * @param {string[]} discNames  驱动盘全名单（library.discs 键），决定返回的行集合与顺序
 * @returns {{name:string, count:number, characters:string[], subCombos:string[][],
 *            subStats:{name:string,count:number,ratio:number}[],
 *            main4:同上, main5:同上, main6:同上}[]}
 *   count：采用该盘（2/4 件套）的方案总数，也是各频次的计数分母。
 *   characters：匹配角色（去重）。
 *   subCombos：副词条组合（按方案去重，保留每组组合，供悬浮明细）。
 *   subStats / main4..6：词条/主属性出现频次，按出现次数降序（同频按首次出现顺序）。
 *   驱动盘未被任何方案采用时 count 为 0、各数组为空。
 */
export function computeDiscStats(plans, discNames) {
  const acc = new Map();
  for (const name of discNames || []) {
    acc.set(normalize(name), {
      name,
      count: 0,
      chars: new Set(),
      combos: new Set(),
      subFreq: new Map(),
      mainFreq: { 4: new Map(), 5: new Map(), 6: new Map() },
    });
  }
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    for (const p of v.plans) {
      if (!p || !Array.isArray(p.sets)) continue;
      // 一个方案推荐的副词条/主属性属于整套配装，对方案里的每个套装都计入
      // 副词条组合去重：先排序再序列化，忽略组内顺序（如 暴击率/暴击伤害/攻击力% 与 暴击伤害/暴击率/攻击力% 视为同一组合）
      const comboKey = Array.isArray(p.subStats) && p.subStats.length ? JSON.stringify([...p.subStats].sort()) : null;
      for (const s of p.sets) {
        if (!s || typeof s.name !== 'string' || (s.cnt !== 2 && s.cnt !== 4)) continue; // 只统计 2/4 件套
        // 套装名去标点归一化匹配（plans 与 library 名称可能有空白/标点差异，如「雪兔梦游仙境 」尾随空格）；
        // 归一化后仍未命中的再查已知别名（如 荆棘玫瑰→棘刺玫瑰）
        const key = DISC_ALIASES[normalize(s.name)] || normalize(s.name);
        const a = acc.get(key);
        if (!a) continue; // 未知套装名（不在库内）跳过
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
  return [...acc.values()].map((a) => ({
    name: a.name, // 用 library 侧规范名，避免 normalize 键（如去尾随空格）污染展示
    count: a.count,
    characters: [...a.chars],
    subCombos: [...a.combos].map((k) => JSON.parse(k)),
    subStats: freqList(a.subFreq, a.count),
    main4: freqList(a.mainFreq[4], a.count),
    main5: freqList(a.mainFreq[5], a.count),
    main6: freqList(a.mainFreq[6], a.count),
  }));
}
