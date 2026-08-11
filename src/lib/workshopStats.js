// src/lib/workshopStats.js —— 工坊配装数据（workshop.json）汇总纯函数（Node 与浏览器共用）
// 输入：workshop.json 的 entries（每条约一个玩家角色的配装：weapon/equips/panel）
// 输出：音擎 / 驱动盘按「配装条目数」聚合，角色面板按「分位分布」（P25/P50/P75）。

/** 面板 final 值归一化：百分比字符串（"31.4%" → 0.314）与数值字符串/数字统一为数字 */
function parsePanelFinal(v) {
  if (v == null) return null;
  if (typeof v === 'string' && v.endsWith('%')) return parseFloat(v) / 100;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 分位数（线性插值）：排序后取 q 分位；空数组返回 null */
function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return hi === lo ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * 汇总工坊配装数据。
 * @param {object[]} entries  workshop.json 的 entries（{uid, role_id, rank, weapon, equips, panel}）
 * @returns {{wengines:{name:string,count:number,characters:string[]}[],
 *            discs:{name:string,count:number,characters:string[]}[],
 *            panels:{name:string,stats:Object<string,number[]>}[]}}
 *   wengines/discs：按配装条目数聚合（同配装同套装只计一次），characters 为去重角色 id。
 *   panels：每角色每属性的 [P25, P50, P75] 分位（百分比属性已归一化为小数）。
 */
export function computeWorkshopStats(entries) {
  const wMap = new Map(); // 音擎名 -> {name, count, chars:Set}
  const dMap = new Map(); // 套装名 -> {name, count, chars:Set}
  const pMap = new Map(); // 角色 id -> {name, stats:{属性:[数值]}}

  for (const e of entries || []) {
    // 音擎：每配装计一次
    if (e.weapon?.name && e.weapon.name !== '其他') {
      if (!wMap.has(e.weapon.name)) wMap.set(e.weapon.name, { name: e.weapon.name, count: 0, chars: new Set() });
      const w = wMap.get(e.weapon.name);
      w.count++;
      w.chars.add(e.role_id);
    }
    // 驱动盘套装：同配装同套装去重（4 件套 = 4 块同名盘只计一次）
    const seenSuits = new Set();
    for (const s of e.equips || []) {
      if (!s?.suit || s.suit === '其他' || seenSuits.has(s.suit)) continue;
      seenSuits.add(s.suit);
      if (!dMap.has(s.suit)) dMap.set(s.suit, { name: s.suit, count: 0, chars: new Set() });
      const d = dMap.get(s.suit);
      d.count++;
      d.chars.add(e.role_id);
    }
    // 面板：按角色收集各属性最终值
    for (const p of e.panel || []) {
      const v = parsePanelFinal(p.final);
      if (v == null) continue;
      if (!pMap.has(e.role_id)) pMap.set(e.role_id, { name: e.role_id, stats: {} });
      const r = pMap.get(e.role_id);
      if (!r.stats[p.name]) r.stats[p.name] = [];
      r.stats[p.name].push(v);
    }
  }

  const panels = [...pMap.values()].map((r) => {
    const stats = {};
    for (const [k, vals] of Object.entries(r.stats))
      stats[k] = [quantile(vals, 0.25), quantile(vals, 0.5), quantile(vals, 0.75)];
    return { name: r.name, stats };
  });

  return {
    wengines: [...wMap.values()].map((w) => ({ name: w.name, count: w.count, characters: [...w.chars] })),
    discs: [...dMap.values()].map((d) => ({ name: d.name, count: d.count, characters: [...d.chars] })),
    panels,
  };
}
