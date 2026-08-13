// src/lib/workshopStats.js —— 工坊配装数据（workshop.json）汇总纯函数（Node 与浏览器共用）
// 输入：workshop.json 的 entries（每条约一个玩家角色的配装：weapon/equips/panel）
// 输出：音擎 / 驱动盘按「配装条目数」聚合，角色面板按「真实样本统计」（分位/离散/形态，见 distStats.computeDist）+ 属性相关。
import { computeDist, pearson } from './distStats.js';
import { canonicalName, CATEGORY } from './names.js';
import { normalizeStatKey } from './util.js';
import { mainStatName, SUBSTAT_TYPE_SET } from './constants.js';

/** 面板 final 值归一化：百分比字符串（"31.4%" → 0.314）与数值字符串/数字统一为数字；空串/纯空白 → null（缺失，不污染 min/count） */
function parsePanelFinal(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null; // 工坊接口非攻击三围常返回空串，视为缺失
    if (t.endsWith('%')) {
      const n = parseFloat(t);
      return Number.isFinite(n) ? n / 100 : null;
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 面板数值统计（玩家真实样本）：分位/离散/形态（见 distStats.computeDist）；空数组返回空统计 */
function panelStats(arr) {
  return computeDist(arr);
}

/**
 * 汇总工坊配装数据。
 * @param {object[]} entries  workshop.json 的 entries（{uid, role_id, rank, weapon, equips, panel}）
 * @returns {{wengines:{name:string,count:number,characters:string[]}[],
 *            discs:{name:string,count:number,characters:string[]}[],
 *            panels:{name:string,stats:Object<string,Dist>}[]}}
 *   wengines/discs：按配装条目数聚合（同配装同套装只计一次），characters 为去重角色 id。
 *   panels：每角色每属性的真实样本统计（computeDist：count/min/max/range/mean/median/sd/IQR/p10-p99/skew/kurt，百分比属性已归一化为小数）。
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
    for (const [k, vals] of Object.entries(r.stats)) stats[k] = panelStats(vals);
    return { name: r.name, stats };
  });

  return {
    wengines: [...wMap.values()].map((w) => ({ name: w.name, count: w.count, characters: [...w.chars] })),
    discs: [...dMap.values()].map((d) => ({ name: d.name, count: d.count, characters: [...d.chars] })),
    panels,
  };
}

/**
 * 属性相关性（皮尔逊）：按「同一条配装内属性配对」+「按角色分组」计算（pooled 相关被角色混合主导无意义）。
 * @param {object[]} entries  workshop.json 的 entries
 * @param {string[][]} [pairs]  要计算的属性对（默认 攻击-防御/攻击-生命/防御-生命/暴击率-暴击伤害）
 * @returns {Object<string, Object<string, number>>}  角色 id → {`属性A_属性B`: r}
 */
/** 逐条目解析 panel → 每角色 / 全体 的属性对配对样本（computePanelCorrelations 与 computePanelScatter 共用一次遍历）。
 *  每对累加器自带属性名（无需靠 key 反解）。@returns {{perRole:Map<string,Map<string,{x,y,xv,yv}>>, global:Map<string,{x,y,xv,yv}>}} */
function collectPanelPairs(entries, pairs) {
  const perRole = new Map(); // role -> Map<key, {x,y,xv,yv}>
  const global = new Map(); // key -> {x,y,xv,yv}
  for (const [x, y] of pairs) global.set(`${x}_${y}`, { x, y, xv: [], yv: [] });
  for (const e of entries || []) {
    if (!e || !Array.isArray(e.panel)) continue;
    const vals = {};
    for (const p of e.panel) {
      if (!p || p.name == null) continue;
      const v = parsePanelFinal(p.final);
      if (v != null) vals[p.name] = v;
    }
    const role = String(e.role_id);
    for (const [x, y] of pairs) {
      if (vals[x] == null || vals[y] == null) continue;
      const key = `${x}_${y}`;
      let r = perRole.get(role);
      if (!r) perRole.set(role, (r = new Map()));
      let pr = r.get(key);
      if (!pr) r.set(key, (pr = { x, y, xv: [], yv: [] }));
      pr.xv.push(vals[x]);
      pr.yv.push(vals[y]);
      global.get(key).xv.push(vals[x]);
      global.get(key).yv.push(vals[y]);
    }
  }
  return { perRole, global };
}

export function computePanelCorrelations(entries, pairs) {
  const PAIRS = pairs || [
    ['攻击力', '防御力'],
    ['攻击力', '生命值'],
    ['防御力', '生命值'],
    ['暴击率', '暴击伤害'],
  ];
  const { perRole } = collectPanelPairs(entries, PAIRS);
  const out = {};
  for (const [role, pairs_] of perRole) {
    out[role] = {};
    for (const [key, p] of pairs_) out[role][key] = pearson(p.xv, p.yv);
  }
  return out;
}

// ---------- 驱动盘单盘统计（工坊真实穿戴：主/副词条、槽位、角色） ----------
// 供「统计→驱动盘」面板作「工坊真实」对比列（与 plans 方案推荐并列）。workshop.json 的盘有两源：
// 2025 源（eq.subs 数组，main[0]=真实主词条）与 mys 源（无 subs，main[] 即副词条，主词条丢失）。

/** mys 源按值带 % 判定百分比形态的属性（仅这三项有固定/百分比两形态；暴击率/暴击伤害恒为百分比属性不带 %） */
const MYS_PCT_NAMES = new Set(['攻击力', '生命值', '防御力']);

/**
 * workshop 原始词条名 → 统一名（plans/constants 体系）。词条变体映射已并入 util.js 的 `STAT_ALIASES`（normalizeStatKey 单一权威）。
 * value 仅 mys 源用于判定 攻击/生命/防御 的百分比形态（如 `攻击力`+"6%" → 攻击力%，`攻击力`+"38" → 攻击力）。
 * 未知名原样返回（向前兼容）。
 * @param {string} rawName  workshop 原始词条名
 * @param {string|number} [value]  词条值（mys 源百分比是 "6%" 字符串）
 * @returns {string|null}
 */
export function discStatName(rawName, value) {
  if (!rawName) return null;
  if (MYS_PCT_NAMES.has(rawName) && String(value ?? '').includes('%')) return `${rawName}%`;
  return normalizeStatKey(rawName);
}

/** 盘槽位：优先 mys name 末尾 [N]，兜底 id 末位数字（1-6）；无法判定返回 0 */
function slotOf(eq) {
  const m = /\[(\d)\]$/.exec(eq.name || '');
  if (m) return Number(m[1]);
  const n = Number(String(eq.id ?? '').slice(-1));
  return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 0;
}

/** Map<名,次数> → [{name,count}] 按 count 降序（同频按首次出现序） */
function freqPairs(map) {
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/**
 * 按驱动盘套装聚合工坊真实配装（workshop.json entries 的单盘级统计）。
 *
 * @param {object[]} entries  workshop.json 的 entries（[{uid, role_id, weapon, equips:[...]}]）
 * @param {object} discIndex  buildNameIndex(library.discs, CATEGORY.DISC) 的产物（或测试 fixture）
 * @param {{roleNameMap?:Map<string,string>}} [opts]  roleNameMap：role_id 字符串 → 角色规范名（未提供时 characters 落回 role_id）
 * @returns {{name:string, equips:number, characters:string[],
 *            main456:{4:{name,count}[],5:{name,count}[],6:{name,count}[]},
 *            mainDenom:{4:number,5:number,6:number}, subs:{name,count}[]}[]}
 *   name：library 规范盘名；equips：物理盘数（每块盘计一次，不做条目内去重）；
 *   characters：使用角色（去重）；main456：仅 2025 源盘有主词条（mys 主词条丢失），已套 mainStatName 兜底；
 *   mainDenom：每槽 2025 源盘数（主词条 ratio 分母，避免 mys 无主词条导致 456 频次系统性低估）；
 *   subs：副词条（2025 subs + mys main[] 合并，统一名）。仅含工坊中出现的盘；未解析到 library 的套装 / '其他' 跳过。
 */
export function computeWorkshopDiscStats(entries, discIndex, opts = {}) {
  const roleNameMap = opts.roleNameMap || null;
  const acc = new Map(); // 规范盘名 → 内部聚合
  const resolveSuit = (raw) => canonicalName(CATEGORY.DISC, discIndex, raw, { fuzzy: false });
  const isEff = (n) => SUBSTAT_TYPE_SET.has(n); // 有效副词条判定（统一名 ∈ SUBSTAT 集合）

  for (const e of entries || []) {
    if (!e || !Array.isArray(e.equips)) continue;
    const roleName = roleNameMap ? roleNameMap.get(String(e.role_id)) : String(e.role_id);
    if (roleName == null) continue;
    for (const eq of e.equips) {
      if (!eq || !eq.suit) continue;
      const suit = resolveSuit(eq.suit);
      if (!suit || suit === '其他') continue; // 未解析/占位跳过
      let a = acc.get(suit);
      if (!a)
        acc.set(
          suit,
          (a = {
            name: suit,
            equips: 0,
            chars: new Set(),
            main456: { 4: new Map(), 5: new Map(), 6: new Map() },
            mainDenom: { 4: 0, 5: 0, 6: 0 },
            subs: new Map(),
            effDist: new Map(), // 有效词条数(0-4) → 盘数
            combos: new Map(), // 副词条组合 key → 盘数
            mainSub: { 4: new Map(), 5: new Map(), 6: new Map() }, // 槽 → 主词条 → Map<副词条,次数>
          })
        );
      a.equips += 1;
      a.chars.add(roleName);
      const slot = slotOf(eq);
      const is2025 = Array.isArray(eq.subs);
      // 归一化的副词条列表（2025 源 subs；mys 源 main[] 即副词条）
      const subNames = (is2025 ? eq.subs : eq.main || [])
        .map((s) => (s && s.name ? discStatName(s.name, s.value) : null))
        .filter(Boolean);
      // 主词条（2025 源 main[0]；mys 源主词条丢失）——mn 只算一次，主词条频次与 ×副词条协同共用
      const main = is2025 && Array.isArray(eq.main) && eq.main[0];
      const mn = main && main.name ? mainStatName(discStatName(main.name, main.value)) : null;
      if (is2025 && slot >= 4 && slot <= 6) {
        a.mainDenom[slot] += 1;
        if (mn) {
          a.main456[slot].set(mn, (a.main456[slot].get(mn) || 0) + 1);
          let bySub = a.mainSub[slot].get(mn);
          if (!bySub) a.mainSub[slot].set(mn, (bySub = new Map()));
          for (const n of subNames) bySub.set(n, (bySub.get(n) || 0) + 1);
        }
      }
      // 有效词条数分布 + 副词条组合（原地排序序列化去重；effCount/comboKey 各算一次）
      const effCount = subNames.filter(isEff).length;
      a.effDist.set(effCount, (a.effDist.get(effCount) || 0) + 1);
      if (subNames.length) {
        subNames.sort();
        const comboKey = JSON.stringify(subNames);
        a.combos.set(comboKey, (a.combos.get(comboKey) || 0) + 1);
      }
      // 副词条频率（跨槽聚合）
      for (const n of subNames) a.subs.set(n, (a.subs.get(n) || 0) + 1);
    }
  }
  return [...acc.values()].map((a) => {
    const effDist = {};
    for (const [k, v] of a.effDist) effDist[k] = v;
    const subCombos = [...a.combos.entries()]
      .map(([k, count]) => ({ combo: JSON.parse(k), count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 8);
    const mainSubCross = {};
    for (const slot of [4, 5, 6]) {
      const s = {};
      for (const [mn, bySub] of a.mainSub[slot]) {
        s[mn] = Object.fromEntries([...bySub.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6));
      }
      if (Object.keys(s).length) mainSubCross[slot] = s;
    }
    return {
      name: a.name,
      equips: a.equips,
      characters: [...a.chars].sort(),
      main456: { 4: freqPairs(a.main456[4]), 5: freqPairs(a.main456[5]), 6: freqPairs(a.main456[6]) },
      mainDenom: a.mainDenom,
      subs: freqPairs(a.subs),
      effDist, // {0:n,1:n,2:n,3:n,4:n} 有效词条数分布
      subCombos, // [{combo:词条[], count}] 副词条组合 Top8（降序）
      mainSubCross, // {4:{主词条:{副词条:次数}},...} 主词条×副词条协同（仅 2025 源）
    };
  });
}

// ---------- 面板属性对 2D 密度（方案二：暴击率×暴伤、攻击×暴伤 的玩家真实 trade-off） ----------
// 前端拿不到逐条 panel（workshop.json 764MB 不下发），散点必须在聚合时降采样为 2D 密度网格。
// 网格内 x/y 均为各自 min-max 归一到 [0,1]（攻击与双暴量纲不同，归一后才同轴可比），
// 原始范围存 xMin/xMax/yMin/yMax 供前端 tooltip 反算实际值。

/** 2D 密度网格：x/y 数组 → {min/max, N, data:[[xi,yi,count]]}（xi/yi 为 [0,N-1] 归一网格坐标；
 *  前端按均匀 bin 反算实际值，故只需存 N 而非 bin 边界数组） */
function bin2D(xv, yv, N) {
  const n = xv.length;
  if (!n) return null;
  let minX = xv[0], maxX = xv[0], minY = yv[0], maxY = yv[0];
  for (let i = 1; i < n; i++) {
    if (xv[i] < minX) minX = xv[i];
    if (xv[i] > maxX) maxX = xv[i];
    if (yv[i] < minY) minY = yv[i];
    if (yv[i] > maxY) maxY = yv[i];
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const xi = Math.min(N - 1, Math.floor(((xv[i] - minX) / spanX) * N));
    const yi = Math.min(N - 1, Math.floor(((yv[i] - minY) / spanY) * N));
    const k = xi * N + yi;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  return {
    xMin: +minX.toFixed(4),
    xMax: +maxX.toFixed(4),
    yMin: +minY.toFixed(4),
    yMax: +maxY.toFixed(4),
    N,
    data: [...grid.entries()].map(([k, count]) => [Math.floor(k / N), k % N, count]),
  };
}

/**
 * 每角色 / 全体 的面板属性对 2D 密度网格（供密度散点图）。
 * @param {object[]} entries  workshop.json 的 entries（panel 为 [{name, base, add, final}]）
 * @param {string[][]} [pairs]  属性对（默认 暴击率×暴击伤害、攻击力×暴击伤害；攻击将按粒度 min-max 归一）
 * @returns {{perRole:Object<string,Object<string,Grid>>, global:Object<string,Grid>}}
 *   Grid = {xName,yName,xMin,xMax,yMin,yMax,N,data:[[xi,yi,count]]}
 *   perRole 按 role_id；攻击归一范围随粒度（该角色 / 全体）。
 */
export function computePanelScatter(entries, pairs) {
  const PAIRS = pairs || [
    ['暴击率', '暴击伤害'],
    ['攻击力', '暴击伤害'],
  ];
  const { perRole: perRoleAcc, global: globalAcc } = collectPanelPairs(entries, PAIRS);
  const N = 24;
  const toGrid = (g) => {
    const b = bin2D(g.xv, g.yv, N);
    return b ? { xName: g.x, yName: g.y, ...b } : null;
  };
  const perRole = {};
  for (const [role, pairs_] of perRoleAcc) {
    const o = {};
    for (const [key, g] of pairs_) {
      const grid = toGrid(g);
      if (grid) o[key] = grid;
    }
    if (Object.keys(o).length) perRole[role] = o;
  }
  const global = {};
  for (const [key, g] of globalAcc) {
    const grid = toGrid(g);
    if (grid) global[key] = grid;
  }
  return { perRole, global };
}
