// src/lib/workshopStats.js —— 工坊配装数据（workshop.json）汇总纯函数（Node 与浏览器共用）
// 输入：workshop.json 的 entries（每条约一个玩家角色的配装：weapon/equips/panel）
// 输出：音擎 / 驱动盘按「配装条目数」聚合，角色面板按「真实样本统计」（分位/离散/形态，见 distStats.computeDist）+ 属性相关。
import { computeDist, pearson } from './distStats.js';
import { canonicalName, CATEGORY } from './names.js';
import { normalizeStatKey } from './util.js';
import { mainStatName, SUBSTAT_TYPE_SET, MAIN_STAT_OPTIONS, OFFICIAL_SKILL_TYPE, WS2025_SKILL_TYPE } from './constants.js';

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
// 供「统计→驱动盘」面板作「工坊真实」对比列（与 plans 方案推荐并列）。workshop.json 的盘有两源，
// 2026-08 起提取已同构（main=主词条、subs=全部副词条）：2025 源（main[0]=真实主词条，subs=副词条）
// 与 mys 源（同构）。

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
 *   characters：使用角色（去重）；main456：主词条分布（两源同构，已套 mainStatName 兜底）；
 *   mainDenom：每槽盘数（主词条 ratio 分母）；
 *   subs：副词条全量（含无效词条，统一名）。
 *   仅含工坊中出现的盘；未解析到 library 的套装 / '其他' 跳过。
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
      // 词条名清洗：丢弃含 U+FFFD 的坏名（工坊源头数据的属性名被替换符污染，如「生命值百分���」，
      // 无法归一且会污染图表显示——过滤后这些词的样本少量损失，换来 stats 干净）
      const cleanName = (n) => (n && !n.includes('\uFFFD') ? n : null);
      // 两源同构：subs=全部副词条（含无效词条）、main[0]=主词条
      // 游戏规则白名单清洗：副词条只保留合法副词条（SUBSTAT_TYPE_SET：攻击/生命/防御 固定+%、
      // 暴击率/暴伤/穿透值/异常精通）——工坊 2025 源偶发异常词条（穿透率/冲击力/异常掌控百分比等，
      // 实测 180/605k 件），不合法则丢弃，避免脏词条进入分布
      const subNames = (eq.subs || [])
        .map((s) => (s && s.name ? discStatName(s.name, s.value) : null))
        .filter(Boolean)
        .map(cleanName)
        .filter(Boolean)
        .filter((n) => SUBSTAT_TYPE_SET.has(n));
      // 主词条（main[0]）——mn 只算一次，主词条频次与 ×副词条协同共用；
      // 仅统计该槽候选内的合法主词条（MAIN_STAT_OPTIONS），异常主词条不计入分布
      const main = Array.isArray(eq.main) && eq.main[0];
      const mn = main && main.name ? cleanName(mainStatName(discStatName(main.name, main.value))) : null;
      const mnOk = mn && (MAIN_STAT_OPTIONS[slot] || []).includes(mn);
      if (slot >= 4 && slot <= 6) {
        a.mainDenom[slot] += 1;
        if (mnOk) {
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
      mainSubCross, // {4:{主词条:{副词条:次数}},...} 主词条×副词条协同（两源同构）
    };
  });
}

// ---------- 面板属性对 2D 密度（方案二：暴击率×暴伤、攻击×暴伤 的玩家真实 trade-off） ----------
// 前端拿不到逐条 panel（workshop.json 764MB 不下发），散点必须在聚合时降采样为 2D 密度网格。
// 网格内 x/y 均为各自 min-max 归一到 [0,1]（攻击与双暴量纲不同，归一后才同轴可比），
// 原始范围存 xMin/xMax/yMin/yMax 供前端 tooltip 反算实际值。

/** 2D 密度网格：x/y 数组 → {min/max, N, data:[[xi,yi,count]]}（xi/yi 为 [0,N-1] 归一网格坐标；
 *  前端按均匀 bin 反算实际值，故只需存 N 而非 bin 边界数组） */
export function bin2D(xv, yv, N) {
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

// ================= 新指标聚合（练度总览 / 角色画像 / 深渊） =================

/** 轻量分布（无直方图/箱线，供 rankLayers/skillStats 防 stats 膨胀）：count/min/max/mean/median/p10/p90 */
function lightDist(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    mean: s.reduce((a, v) => a + v, 0) / n,
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
  };
}

/** 每角色工坊装配评分（relic_point）分布（computeDist 全量，含 hist）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, relic_point}）
 *  @returns {Object<string, Dist>}  role_id → 评分分布；0/非法评分排除（0 = 未带驱动盘/2025 源缺失） */
export function computeRelicStats(entries) {
  const acc = new Map();
  for (const e of entries || []) {
    if (!e || e.role_id == null) continue;
    const v = Number(e.relic_point);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!acc.has(e.role_id)) acc.set(e.role_id, []);
    acc.get(e.role_id).push(v);
  }
  const out = {};
  for (const [rid, vals] of acc) out[rid] = panelStats(vals);
  return out;
}

/** 每角色影画档位（rank 0-6）占比：供影画金字塔。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, rank}）
 *  @returns {Object<string, {0:number,...,6:number}>} role_id → 各档条目数 */
export function computeRankDist(entries) {
  const acc = new Map();
  for (const e of entries || []) {
    if (!e || e.role_id == null || e.rank == null) continue;
    let d = acc.get(e.role_id);
    if (!d) acc.set(e.role_id, (d = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }));
    const r = Number(e.rank);
    if (r >= 0 && r <= 6) d[r]++;
  }
  return Object.fromEntries(acc);
}

/** 每角色 × 影画档（rank 0-6）的关键属性分布（轻量，无 hist）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, rank, panel}）
 *  @param {string[]} [attrs]  参与分层的属性（默认 8 个核心属性）
 *  @returns {Object<string, Object<string, Object<string, LightDist>>>} role_id → rank → attr → 分布 */
export function computeRankLayers(entries, attrs) {
  const LAYER_ATTRS = attrs || ['攻击力', '暴击率', '暴击伤害', '异常精通', '冲击力', '生命值', '防御力', '能量自动回复'];
  const acc = new Map(); // rid -> Map<rank -> Map<attr -> number[]>
  for (const e of entries || []) {
    if (!e || e.role_id == null || e.rank == null) continue;
    let byRank = acc.get(e.role_id);
    if (!byRank) acc.set(e.role_id, (byRank = new Map()));
    let byAttr = byRank.get(e.rank);
    if (!byAttr) byRank.set(e.rank, (byAttr = new Map()));
    for (const p of e.panel || []) {
      if (!LAYER_ATTRS.includes(p.name)) continue;
      const v = parsePanelFinal(p.final);
      if (v == null) continue;
      if (!byAttr.has(p.name)) byAttr.set(p.name, []);
      byAttr.get(p.name).push(v);
    }
  }
  const out = {};
  for (const [rid, byRank] of acc) {
    out[rid] = {};
    for (const [rank, byAttr] of byRank) {
      out[rid][rank] = {};
      for (const [attr, vals] of byAttr) out[rid][rank][attr] = lightDist(vals);
    }
  }
  return out;
}

/** 每角色 × 技能类型（canonical 编号，见 constants.SKILL_TYPES）的等级分布（轻量分位 + 逐等级计数 dist，供技能分布柱状图）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, source, skills:[{type,level}]}）
 *  @returns {Object<string, Object<string, LightDist & {dist:Object<number,number>}>>} role_id → 技能类型 → 分布
 *  工坊两源 type 语义不同，聚合前按源归一化为 canonical：mys 源（官方语义）用 OFFICIAL_SKILL_TYPE；
 *  2025 源（1.x ID 语义）用 WS2025_SKILL_TYPE（连携/终结并入 canonical 4）。
 *  源判别：优先读条目 `source` 字段（extractBuild 写时固化）；旧数据（无 source）回退 skills 数组顺序
 *  （mys 按 UI 顺序 [0,2,6,...]、2025 按 ID 顺序 [0,1,2,...]）；数组不足 2 个仍无法判源 → 跳过该条。 */
export function computeSkillStats(entries) {
  const acc = new Map(); // rid -> Map<type -> number[]>
  for (const e of entries || []) {
    if (!e || e.role_id == null) continue;
    let is2025;
    if (e.source === 'mys') is2025 = false;
    else if (e.source === '2025') is2025 = true;
    else if (e.skills?.length >= 2) is2025 = e.skills[1].type !== 2; // 旧数据回退：mys 数组第 2 位=2、2025=1
    else continue; // 无 source 且数组不足 2 个：无法判源，不贡献技能统计
    const map = is2025 ? WS2025_SKILL_TYPE : OFFICIAL_SKILL_TYPE;
    for (const s of e.skills || []) {
      if (s.type == null || s.level == null) continue;
      const t = map[s.type] ?? s.type; // 归一化源 type → canonical
      let byType = acc.get(e.role_id);
      if (!byType) acc.set(e.role_id, (byType = new Map()));
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(s.level);
    }
  }
  const out = {};
  for (const [rid, byType] of acc) {
    out[rid] = {};
    for (const [type, vals] of byType) {
      const dist = {};
      for (const v of vals) dist[v] = (dist[v] || 0) + 1;
      out[rid][type] = { ...lightDist(vals), dist };
    }
  }
  return out;
}

/** 玩家级画像（按 uid 聚合）：角色数 / 平均·最高评分 / 有影画角色数。
 *  @param {object[]} entries  workshop.json 的 entries（{uid, role_id, rank, relic_point}）
 *  @returns {{uid:string, chars:number, avgRelic:number|null, maxRelic:number|null, ranked:number}[]} */
export function computePlayerProfiles(entries) {
  const acc = new Map(); // uid -> 聚合
  for (const e of entries || []) {
    if (!e || e.uid == null) continue;
    let p = acc.get(e.uid);
    if (!p) acc.set(e.uid, (p = { chars: new Set(), relicSum: 0, relicN: 0, relicMax: 0, ranked: 0 }));
    p.chars.add(e.role_id);
    const rp = Number(e.relic_point);
    if (Number.isFinite(rp) && rp > 0) {
      p.relicSum += rp;
      p.relicN++;
      if (rp > p.relicMax) p.relicMax = rp;
    }
    if (e.rank > 0) p.ranked++;
  }
  return [...acc.entries()].map(([uid, p]) => ({
    uid,
    chars: p.chars.size,
    avgRelic: p.relicN ? Math.round((p.relicSum / p.relicN) * 10) / 10 : null,
    maxRelic: p.relicMax || null,
    ranked: p.ranked,
  }));
}

/** 每角色驱动盘画像：456 主词条分布 / 副词条频率 / 有效词条数分布（与 computeWorkshopDiscStats 同口径，按角色聚合）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, equips}）
 *  @param {object} discIndex  buildNameIndex(library.discs, CATEGORY.DISC)
 *  @param {{roleNameMap?:Map<string,string>}} [opts]
 *  @returns {{name:string, main456:{4,5,6:{name,count}[]}, mainDenom:{4,5,6}, subs:{name,count}[], effDist:Object}[]} */
export function computeRoleDiscStats(entries, discIndex, opts = {}) {
  const roleNameMap = opts.roleNameMap || null;
  const acc = new Map(); // 角色名 -> 聚合
  for (const e of entries || []) {
    if (!e || e.role_id == null) continue;
    const roleName = roleNameMap ? roleNameMap.get(String(e.role_id)) : String(e.role_id);
    if (roleName == null) continue;
    let a = acc.get(roleName);
    if (!a)
      acc.set(
        roleName,
        (a = { main456: { 4: new Map(), 5: new Map(), 6: new Map() }, mainDenom: { 4: 0, 5: 0, 6: 0 }, subs: new Map(), effDist: new Map() })
      );
    for (const eq of e.equips || []) {
      if (!eq || !eq.suit) continue;
      const slot = slotOf(eq);
      // 词条名清洗：丢弃含 U+FFFD 的坏名（同 computeWorkshopDiscStats 口径）；
      // 副词条只保留合法副词条（SUBSTAT_TYPE_SET），主词条仅统计槽候选内（MAIN_STAT_OPTIONS）——游戏规则白名单
      const cleanName = (n) => (n && !n.includes('\uFFFD') ? n : null);
      const subNames = (eq.subs || [])
        .map((s) => (s && s.name ? discStatName(s.name, s.value) : null))
        .filter(Boolean)
        .map(cleanName)
        .filter(Boolean)
        .filter((n) => SUBSTAT_TYPE_SET.has(n));
      const main = Array.isArray(eq.main) && eq.main[0];
      const mn = main && main.name ? cleanName(mainStatName(discStatName(main.name, main.value))) : null;
      const mnOk = mn && (MAIN_STAT_OPTIONS[slot] || []).includes(mn);
      if (slot >= 4 && slot <= 6) {
        a.mainDenom[slot]++;
        if (mnOk) a.main456[slot].set(mn, (a.main456[slot].get(mn) || 0) + 1);
      }
      const eff = subNames.filter((n) => SUBSTAT_TYPE_SET.has(n)).length;
      a.effDist.set(eff, (a.effDist.get(eff) || 0) + 1);
      for (const n of subNames) a.subs.set(n, (a.subs.get(n) || 0) + 1);
    }
  }
  return [...acc.entries()].map(([name, a]) => ({
    name,
    main456: { 4: freqPairs(a.main456[4]), 5: freqPairs(a.main456[5]), 6: freqPairs(a.main456[6]) },
    mainDenom: a.mainDenom,
    subs: freqPairs(a.subs),
    effDist: Object.fromEntries(a.effDist),
  }));
}

/** 深渊战绩聚合：层数分布 / 评级分布 / 实战配队 Top（按上场角色 id 组合计数）。
 *  @param {object[]} abyssEntries  workshop-abyss.json 的 entries（{uid, abyss:{max_layer, rating_list, floors}}）
 *  @returns {{layerDist:Object<number,number>, ratingDist:Object<string,number>, teams:{team:string[],count:number}[]}} */
export function computeAbyssStats(abyssEntries) {
  const layerDist = {};
  const ratingDist = {};
  const teams = new Map();
  for (const a of abyssEntries || []) {
    if (!a || !a.abyss) continue;
    const ab = a.abyss;
    if (ab.max_layer != null) layerDist[ab.max_layer] = (layerDist[ab.max_layer] || 0) + 1;
    for (const r of ab.rating_list || []) ratingDist[r.rating] = (ratingDist[r.rating] || 0) + 1;
    for (const f of ab.floors || []) {
      for (const node of [f.node_1, f.node_2]) {
        if (!node) continue;
        const ids = (node.avatars || []).map((v) => String(v.id)).sort();
        if (ids.length < 2) continue;
        const key = ids.join(',');
        teams.set(key, (teams.get(key) || 0) + 1);
      }
    }
  }
  const teamTop = [...teams.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 20)
    .map(([k, count]) => ({ team: k.split(','), count }));
  return { layerDist, ratingDist, teams: teamTop };
}

/** 深渊配队聚合（「深渊配队」面板）：角色出场榜 / 双队配队 Top / 队友共现 / S 评级配队 Top。
 *  @param {object[]} abyssEntries  workshop-abyss.json 的 entries（{abyss:{floors:[{node_1,node_2,rating}]}}）
 *  @returns {{
 *    charUsage:{id:string,count:number,ratio:number}[]       角色出场榜（按出场次数降序，ratio=占全部出场）
 *    nodeTeams:{1:{chars:string[],count:number}[],2:{...}[]} 第一/第二队的配队组合 Top10（组合内 id 排序去重）
 *    sTeams:{chars:string[],count:number}[]                  S/SS 评级配队组合 Top10
 *    teammates:Object<string, Object<string, number>>        角色 id → 队友 id → 共现次数（Top12）
 *  }} */
export function computeAbyssTeamStats(abyssEntries) {
  const usage = new Map(); // id -> 出场次数
  const nodeTeams = { 1: new Map(), 2: new Map() }; // 组合 key -> 次数
  const sTeams = new Map();
  const teammates = new Map(); // id -> Map<队友id, 次数>
  for (const a of abyssEntries || []) {
    const ab = a?.abyss;
    if (!ab) continue;
    for (const f of ab.floors || []) {
      for (const [nk, node] of [['1', f.node_1], ['2', f.node_2]]) {
        if (!node) continue;
        const ids = (node.avatars || []).map((v) => String(v.id)).filter(Boolean);
        if (ids.length < 2) continue;
        const sorted = [...ids].sort();
        const key = sorted.join(',');
        nodeTeams[nk].set(key, (nodeTeams[nk].get(key) || 0) + 1);
        if (f.rating === 'S' || f.rating === 'SS') sTeams.set(key, (sTeams.get(key) || 0) + 1);
        for (const id of ids) usage.set(id, (usage.get(id) || 0) + 1);
        for (const id of ids) {
          let m = teammates.get(id);
          if (!m) teammates.set(id, (m = new Map()));
          for (const o of ids) if (o !== id) m.set(o, (m.get(o) || 0) + 1);
        }
      }
    }
  }
  const toTop = (map, n = 10) =>
    [...map.entries()]
      .map(([key, count]) => ({ chars: key.split(','), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);
  const total = [...usage.values()].reduce((a, b) => a + b, 0) || 1;
  return {
    charUsage: [...usage.entries()]
      .map(([id, count]) => ({ id, count, ratio: count / total }))
      .sort((a, b) => b.count - a.count),
    nodeTeams: { 1: toTop(nodeTeams[1]), 2: toTop(nodeTeams[2]) },
    sTeams: toTop(sTeams),
    teammates: Object.fromEntries(
      [...teammates.entries()].map(([id, m]) => [
        id,
        Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
      ])
    ),
  };
}
