// src/lib/teamStats.js —— 配队推荐统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json 的 plan.team（方案配队成员全名列表，含方案角色自身）。
// 按角色聚合「被其他角色的方案组进队」的次数（排除自身，反映真实配队价值），
// 另计自身方案数做参考。角色名解析统一走 src/lib/names.js 的 resolver（normalize + 别名 + 子串兜底）。
import { buildNameIndex, resolveName, CATEGORY } from './names.js';

/**
 * 计算配队推荐统计表。
 *
 * @param {object} plans  { avatarId: { name, plans: [...] } }
 *   plan.team = [配队成员全名]（含方案角色自身，统计时排除）
 * @param {string[]} charNames  角色全名单（library.characters 的 name），决定返回的行集合与顺序
 * @returns {{name:string, selfCount:number, mateCount:number, characters:string[]}[]}
 *   selfCount：该角色作为主C的方案数。
 *   mateCount：被其他角色的方案组进队的次数（方案内去重，排除自身）。
 *   characters：把它组进队的角色（去重）。
 *   从未被组队的角色 mateCount 为 0。
 */
export function computeTeamStats(plans, charNames) {
  const index = buildNameIndex(charNames || [], CATEGORY.CHAR);
  const acc = new Map();
  for (const name of charNames || []) {
    acc.set(name, { name, selfCount: 0, mateCount: 0, chars: new Set() });
  }
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    const selfName = resolveName(CATEGORY.CHAR, index, v.name)?.name; // 方案主C角色名
    for (const p of v.plans) {
      if (!p || !Array.isArray(p.team)) continue;
      const self = selfName ? acc.get(selfName) : null;
      if (self) self.selfCount += 1; // 该角色作为主C的方案
      // 配队：成员解析为标准名后去重（避免同一成员两种写法重复计），排除自身，统计被引用的队友
      const members = new Set(
        (p.team || []).map((m) => resolveName(CATEGORY.CHAR, index, m)?.name).filter(Boolean)
      );
      for (const member of members) {
        if (member === selfName) continue;
        const a = acc.get(member);
        if (!a) continue; // 未知成员名（不在库内）跳过
        a.mateCount += 1;
        a.chars.add(v.name);
      }
    }
  }
  return [...acc.values()].map((a) => ({
    name: a.name,
    selfCount: a.selfCount,
    mateCount: a.mateCount,
    characters: [...a.chars],
  }));
}
