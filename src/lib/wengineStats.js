// src/lib/wengineStats.js —— 音擎推荐统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json 的 plan.weapon {main, backup}（推荐音擎 + 备用）。
// 按音擎名聚合全部方案的推荐：被推荐次数（主/备合计）、作主/作备次数、推荐它的角色。
// 名称匹配统一走 src/lib/names.js 的 resolver（wengine 用 normalizeRomanKey，保留 Ⅰ/Ⅱ/Ⅲ 且兼容 ASCII/Unicode 罗马数字）。
import { buildNameIndex, resolveName, CATEGORY } from './names.js';

/**
 * 计算音擎推荐统计表。
 *
 * @param {object} plans  { avatarId: { name, plans: [...] } }
 *   plan.weapon = { main, backup }（音擎名；backup 可能缺失）
 * @param {string[]} wengineNames  音擎全名单（library.wengines 的 name），决定返回的行集合与顺序
 * @returns {{name:string, count:number, mainCount:number, backupCount:number, characters:string[]}[]}
 *   count：被推荐方案数（作为主或备用，一个方案对同一音擎至多计一次）。
 *   mainCount / backupCount：作主推荐 / 作备推荐的方案数。
 *   characters：推荐该音擎的角色（去重）。
 *   未被任何方案推荐的音擎 count 为 0、数组为空。
 */
export function computeWengineStats(plans, wengineNames) {
  const index = buildNameIndex(wengineNames || [], CATEGORY.WENGINE);
  const acc = new Map();
  for (const name of wengineNames || []) {
    acc.set(name, { name, count: 0, mainCount: 0, backupCount: 0, chars: new Set(), roles: new Map() });
  }
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    for (const p of v.plans) {
      if (!p) continue;
      // 主/备音擎解析为标准名；同音擎既作主又作备时 count 仍只计一次
      const main = typeof p.weapon?.main === 'string' ? resolveName(CATEGORY.WENGINE, index, p.weapon.main)?.name : null;
      const backup = typeof p.weapon?.backup === 'string' ? resolveName(CATEGORY.WENGINE, index, p.weapon.backup)?.name : null;
      const hit = new Set([main, backup].filter((k) => k && acc.has(k)));
      for (const k of hit) {
        const a = acc.get(k);
        a.count += 1;
        if (main === k) a.mainCount += 1;
        if (backup === k) a.backupCount += 1;
        a.chars.add(v.name);
        // 每角色推荐次数（同方案主备只计一次）
        a.roles.set(v.name, (a.roles.get(v.name) || 0) + 1);
      }
    }
  }
  return [...acc.values()].map((a) => ({
    name: a.name,
    count: a.count,
    mainCount: a.mainCount,
    backupCount: a.backupCount,
    characters: [...a.chars],
    roleCounts: Object.fromEntries(a.roles), // 角色名 → 推荐该音擎的方案数
  }));
}
