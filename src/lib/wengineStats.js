// src/lib/wengineStats.js —— 音擎推荐统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json 的 plan.weapon {main, backup}（推荐音擎 + 备用）。
// 按音擎名聚合全部方案的推荐：被推荐次数（主/备合计）、作主/作备次数、推荐它的角色。
// 匹配键用「去空白」而非 normalize：normalize 会去掉 Ⅰ/Ⅱ/Ⅲ 等罗马数字，
// 导致「残响-Ⅰ/Ⅱ/Ⅲ 型」三个系列音擎归一化冲突；去空白（保留型号数字）可精确区分。

/** 音擎名匹配键：去空白（含全角空格）与换行，保留型号数字/标点 */
const wengineKey = (n) => String(n || '').replace(/[\s\u3000]/g, '');

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
  const acc = new Map();
  for (const name of wengineNames || []) {
    acc.set(wengineKey(name), { name, count: 0, mainCount: 0, backupCount: 0, chars: new Set() });
  }
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    for (const p of v.plans) {
      if (!p) continue;
      // 主/备音擎归一化；同音擎既作主又作备时 count 仍只计一次
      const main = p.weapon?.main && typeof p.weapon.main === 'string' ? wengineKey(p.weapon.main) : null;
      const backup = p.weapon?.backup && typeof p.weapon.backup === 'string' ? wengineKey(p.weapon.backup) : null;
      const hit = new Set([main, backup].filter((k) => k && acc.has(k)));
      for (const k of hit) {
        const a = acc.get(k);
        a.count += 1;
        if (main === k) a.mainCount += 1;
        if (backup === k) a.backupCount += 1;
        a.chars.add(v.name);
      }
    }
  }
  return [...acc.values()].map((a) => ({
    name: a.name,
    count: a.count,
    mainCount: a.mainCount,
    backupCount: a.backupCount,
    characters: [...a.chars],
  }));
}
