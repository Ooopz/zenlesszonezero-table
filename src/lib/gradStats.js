// src/lib/gradStats.js —— 从 workshop-grad.json 聚合的全服真实使用统计（纯函数，Node 与浏览器共用）
// 数据源：data/workshop-grad.json（工坊 grad_stat 接口，全服累计占比）。
// 与 workshopStats.js（基于 workshop.json 排行榜全量上榜 uid 的高练度标杆池）口径不同，本模块是「全服真实」视角。
// 注意：前端「角色配装对标」卡片直接读 workshopGrad.roles（不经本模块）；computeGradStats 保留模块与测试。

/** 可用的音擎/套装/组合名：非空、非'其他'（'其他' 只计入总量分母，不单独成行） */
const usable = (name) => typeof name === 'string' && name.trim() !== '' && name !== '其他';

/**
 * 聚合 grad roles 为全服榜（音擎 / 单盘套装 / 套装组合）。
 *
 * @param {object[]} roles  workshop-grad.json 的 roles
 *   role.weapons = [{ name, count, percent }]（该角色 Top 音擎，count=全服累计次数，'其他' 为兜底条目）
 *   role.relics  = [{ name, sets:[{name,num}], count, percent }]（套装组合，count=全服次数；组合内 sets 拆成单盘）
 * @returns {{wengines:Entry[], discs:Entry[], combos:Entry[]}}
 *   Entry = { name, count, roles:string[], ratio }
 *   count：全服累计次数（跨角色累加；discs 为组合次数按套装拆分累加）
 *   roles：使用它的角色名（去重）；ratio：count / 对应总量（含'其他'，接近全服占比）
 *   返回按 count 降序。'其他' 条目不进入榜单。
 */
export function computeGradStats(roles) {
  const wMap = new Map(); // 音擎名 -> {count, roles:Set}
  const dMap = new Map(); // 套装名 -> {count, roles:Set}
  const cMap = new Map(); // 组合名 -> {count, roles:Set}
  let wTotal = 0; // 音擎全服总次数（含'其他'）
  let dTotal = 0; // 套装全服总次数（含'其他'）
  let cTotal = 0; // 组合全服总次数（含'其他'）

  for (const role of roles || []) {
    const roleName = role?.name;
    if (!roleName) continue;
    for (const w of role.weapons || []) {
      const c = Number(w.count) || 0;
      wTotal += c; // 总量含'其他'
      if (!usable(w.name)) continue;
      let a = wMap.get(w.name);
      if (!a) wMap.set(w.name, (a = { count: 0, roles: new Set() }));
      a.count += c;
      a.roles.add(roleName);
    }
    for (const rel of role.relics || []) {
      const c = Number(rel.count) || 0;
      cTotal += c; // 组合总量含'其他'
      if (!usable(rel.name) || !Array.isArray(rel.sets) || !rel.sets.length) continue;
      dTotal += c; // 单盘总量只计有效组合（含'其他'组合时其套装拆不出来，忽略——占比为近似）
      let cm = cMap.get(rel.name);
      if (!cm) cMap.set(rel.name, (cm = { count: 0, roles: new Set() }));
      cm.count += c;
      cm.roles.add(roleName);
      for (const s of rel.sets) {
        if (!usable(s.name)) continue;
        let d = dMap.get(s.name);
        if (!d) dMap.set(s.name, (d = { count: 0, roles: new Set() }));
        d.count += c; // 组合内每个套装都累加该组合次数
        d.roles.add(roleName);
      }
    }
  }

  const toEntry = (m, total) =>
    [...m.entries()]
      .map(([name, a]) => ({ name, count: a.count, roles: [...a.roles], ratio: total ? a.count / total : 0 }))
      .sort((a, b) => b.count - a.count);

  return { wengines: toEntry(wMap, wTotal), discs: toEntry(dMap, dTotal), combos: toEntry(cMap, cTotal) };
}
