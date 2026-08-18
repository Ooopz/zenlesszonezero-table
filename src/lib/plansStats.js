// src/lib/plansStats.js —— 从 plans.json 统计每角色 Top 音擎 / 驱动盘套装（结构与 workshop-grad 一致），纯函数（Node 与浏览器共用）
// 用途：角色面板「角色配装对标」卡片里与 workshop-grad（全服实况）并排对比「方案推荐」侧数据，并分析差异。

/** 组合内套装件数（num/cnt 字段兼容） */
const setCount = (s) => Number(s?.num ?? s?.cnt ?? 0);

/**
 * 套装组合文本顺序归一化：件数降序（4 件套在前、2 件套在后，同件数按名称排序）。
 * 工坊（set_info 顺序不固定）与方案（原件数升序）两源经此归一后同名组合文本一致；sets 输出均带 num 字段。
 */
export function orderComboSets4First(sets) {
  const sorted = [...(sets || [])].sort(
    (a, b) => setCount(b) - setCount(a) || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  );
  return {
    name: sorted.map((s) => `${s.name}${setCount(s)}`).join('+'),
    sets: sorted.map((s) => ({ ...s, num: setCount(s) })),
  };
}

/**
 * 每角色 Top 3 音擎 / 套装组合及占比（按方案出现次数计，percent 保留 1 位小数）。
 * relics 按「套装组合」统计（与 workshop-grad 结构一致，组合内 4 件套在前、2 件套在后）。
 */
export function computeRoleBuildsFromPlans(plans) {
  const out = {};
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name) continue;
    const wCount = {};
    const rCount = {}; // 组合名 -> {count, sets}
    for (const p of v.plans || []) {
      if (p.weapon?.main) wCount[p.weapon.main] = (wCount[p.weapon.main] || 0) + 1;
      if (p.weapon?.backup) wCount[p.weapon.backup] = (wCount[p.weapon.backup] || 0) + 1;
      // 组合顺序归一：同组合不同顺序视为同一
      const sets = (p.sets || []).filter((s) => s && s.name);
      if (!sets.length) continue;
      const { name: comboName, sets: sortedSets } = orderComboSets4First(sets);
      if (!rCount[comboName])
        rCount[comboName] = { count: 0, sets: sortedSets.map((s) => ({ name: s.name, num: s.num })) };
      rCount[comboName].count++;
    }
    const top = (count, n) => {
      const total = Object.values(count).reduce((s, c) => s + c, 0);
      return Object.entries(count)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, c]) => ({ name, percent: total ? Math.round((c / total) * 1000) / 10 : 0 }));
    };
    const topRelics = (n) => {
      const total = Object.values(rCount).reduce((s, r) => s + r.count, 0);
      return Object.entries(rCount)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, n)
        .map(([name, r]) => ({ name, sets: r.sets, percent: total ? Math.round((r.count / total) * 1000) / 10 : 0 }));
    };
    out[v.name] = { wengines: top(wCount, 3), relics: topRelics(3) };
  }
  return out;
}
