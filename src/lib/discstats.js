// src/lib/discstats.js —— 驱动盘推荐统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json（养成指南推荐方案，见 src/sync/plans.js 的 extractPlan）。
// 按驱动盘名聚合全部角色的推荐方案，统计「推荐方案里用到该盘（2件套或4件套）的角色」、
// 这些方案推荐的副词条组合（去重）、以及 4/5/6 号位推荐主属性（去重）。
import { normalize } from './util.js';

// 已知套装名别名（养成指南与 wiki 用词差异），键为 normalized 变体 → library 侧规范名。
// 例：米游社养成指南个别方案把「棘刺玫瑰」写作「荆棘玫瑰」（同一张防御力套装）。
const DISC_ALIASES = { 荆棘玫瑰: '棘刺玫瑰' };

/**
 * 计算驱动盘统计表。
 *
 * @param {object} plans  { avatarId: { name, plans: [...] } }
 *   plan.sets = [{ name, cnt }]（cnt 为件数，2 或 4；2+2+2 / 4+2 组合就是多条）
 *   plan.subStats = [副词条名]
 *   plan.mainProps = { '4': 主属性名, '5': 名, '6': 名 }（键为字符串，值已百分比归一化）
 * @param {string[]} discNames  驱动盘全名单（library.discs 键），决定返回的行集合与顺序
 * @returns {{name:string, characters:string[], subCombos:string[][], main4:string[], main5:string[], main6:string[]}[]}
 *   每行：匹配角色（去重）、副词条组合（按方案去重，保留每组组合）、456 号位主属性（去重）。
 *   驱动盘未被任何方案采用时行内各数组为空。
 */
export function computeDiscStats(plans, discNames) {
  const acc = new Map();
  for (const name of discNames || []) {
    acc.set(normalize(name), {
      name,
      chars: new Set(),
      combos: new Set(),
      main4: new Set(),
      main5: new Set(),
      main6: new Set(),
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
        a.chars.add(v.name);
        if (comboKey) a.combos.add(comboKey);
        if (p.mainProps?.[4]) a.main4.add(p.mainProps[4]);
        if (p.mainProps?.[5]) a.main5.add(p.mainProps[5]);
        if (p.mainProps?.[6]) a.main6.add(p.mainProps[6]);
      }
    }
  }
  return [...acc.values()].map((a) => ({
    name: a.name, // 用 library 侧规范名，避免 normalize 键（如去尾随空格）污染展示
    characters: [...a.chars],
    subCombos: [...a.combos].map((k) => JSON.parse(k)),
    main4: [...a.main4],
    main5: [...a.main5],
    main6: [...a.main6],
  }));
}
