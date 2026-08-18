// src/lib/workshopAgg.js —— 工坊配装数据（workshop.json）汇总纯函数（Node 与浏览器共用）
// 输入 workshop.json 的 entries（每条约一个玩家角色的配装），按角色/盘/玩家聚合出全部统计；
// 正式入口为 computeAllWorkshopStats 单遍历（见下方累加器说明），各公开单函数为测试/复用保留。
import { computeDist, kmeans, pearson, quantileSorted } from './distStats.js';
import { canonicalName, CATEGORY } from './names.js';
import { normalizeStatKey } from './util.js';
import {
  mainStatName,
  SUBSTAT_TYPE_SET,
  MAIN_STAT_OPTIONS,
  OFFICIAL_SKILL_TYPE,
  WS2025_SKILL_TYPE,
} from './constants.js';

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

function panelStats(arr) {
  return computeDist(arr);
}

// ---------- 累加器（accumulator）拆分说明（2026-08 性能重构） ----------
// 每个聚合拆成 add(entry)（逐条累加）+ finish()（收尾），原公开函数的签名与输出完全不变；
// computeAllWorkshopStats 建全部累加器后**一次** for 循环喂完再各自 finish（原 14 次全量流式遍历，每遍 ~27s）。
// ⚠️ 硬约束：累加器内部 Map/数组必须严格按「条目出现顺序」写入，否则键序/浮点累加顺序漂移，
// 输出与旧结果不再逐位相等；各聚合口径不同，不共享中间解析。

function runAcc(acc, entries) {
  for (const e of entries || []) acc.add(e);
  return acc.finish();
}

/** computeWorkshopStats 的累加器：音擎/套装条目数 + 每角色面板样本 */
function makeWorkshopStatsAcc() {
  const wMap = new Map(); // 音擎名 -> {name, count, chars:Set}
  const dMap = new Map(); // 套装名 -> {name, count, chars:Set}
  const pMap = new Map(); // 角色 id -> {name, stats:{属性:[数值]}}
  return {
    add(e) {
      // 单条脏数据不应中断整轮聚合：computeAllWorkshopStats 把同一条喂给全部累加器，
      // 这里抛异常 = 2.13GB 全量重算（约 4 分钟）零产出。与其余累加器的守卫保持一致。
      if (!e) return;
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
    },
    finish() {
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
    },
  };
}

/** 汇总工坊配装数据：wengines/discs 按配装条目数聚合（同配装同套装只计一次）、panels 为每角色每属性的真实样本统计（百分比属性已归一化为小数）。 */
export function computeWorkshopStats(entries) {
  return runAcc(makeWorkshopStatsAcc(), entries);
}

/** 面板属性对配对样本采集（computePanelCorrelations 与 computePanelScatter 共用）。
 *  ⚠️ 相关性与散点属性对不同，必须各建采集器：合并会改变 perRole/global 的 key 插入顺序，输出键序漂移。 */
function makePanelPairsAcc(pairs) {
  const perRole = new Map(); // role -> Map<key, {x,y,xv,yv}>
  const global = new Map(); // key -> {x,y,xv,yv}
  for (const [x, y] of pairs) global.set(`${x}_${y}`, { x, y, xv: [], yv: [] });
  return {
    add(e) {
      if (!e || !Array.isArray(e.panel)) return;
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
    },
    finish() {
      return { perRole, global };
    },
  };
}

function collectPanelPairs(entries, pairs) {
  return runAcc(makePanelPairsAcc(pairs), entries);
}

const CORR_PAIRS = [
  ['攻击力', '防御力'],
  ['攻击力', '生命值'],
  ['防御力', '生命值'],
  ['暴击率', '暴击伤害'],
  ['攻击力', '暴击伤害'],
  ['攻击力', '暴击率'],
  ['异常精通', '异常掌控'],
];

function finishPanelCorrelations(perRole) {
  const out = {};
  for (const [role, pairs_] of perRole) {
    out[role] = {};
    for (const [key, p] of pairs_) out[role][key] = pearson(p.xv, p.yv);
  }
  return out;
}

/** 属性相关性（皮尔逊）：按「同一条配装内属性配对」+「按角色分组」计算（pooled 相关被角色混合主导无意义）。 */
export function computePanelCorrelations(entries, pairs) {
  const { perRole } = collectPanelPairs(entries, pairs || CORR_PAIRS);
  return finishPanelCorrelations(perRole);
}

// ---------- 驱动盘单盘统计（工坊真实穿戴：主/副词条、槽位、角色） ----------
// 供「统计→驱动盘」面板作「工坊真实」对比列；两源提取已同构（main=主词条、subs=全部副词条）。

/** mys 源按值带 % 判定百分比形态的属性（仅这三项有固定/百分比两形态；暴击率/暴击伤害恒为百分比属性不带 %） */
const MYS_PCT_NAMES = new Set(['攻击力', '生命值', '防御力']);

/** workshop 原始词条名 → 统一名（词条变体映射已并入 util.js 的 `STAT_ALIASES`，normalizeStatKey 单一权威）。
 *  value 仅 mys 源用于判定 攻击/生命/防御 的百分比形态（如 `攻击力`+"6%" → 攻击力%）；未知名原样返回（向前兼容）。 */
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

// ---------- 副词条强化次数（roll）还原 + 角色有效词条权重 ----------
// 每条副词条数值 = 单次强化基数 × 强化次数（1-6）。两源存法不同但基数同源：2025 源百分比 ×100 存整数、
// mys 源存去掉 % 的数；value 类型即源标记（实测与 rarity 判源 100% 同构零交叉），故按类型自判源。
// 为什么还原次数：旧「有效词条个数」99.95% 恒为 4 无区分度；value/base 99.9987% 恰为 1-6 整数（余 19 条异常靠 round+钳制兜底）。
// 注意「单盘总强化次数」恒为 8/9 无信息量，有区分度的是**落在角色有效词条上的次数**。

/** 副词条单次强化基数（S 级盘，mys 口径：百分比按「去掉 % 的数」计） */
const SUBSTAT_ROLL_BASE = {
  暴击率: 2.4,
  暴击伤害: 4.8,
  '攻击力%': 3,
  '生命值%': 3,
  '防御力%': 4.8,
  攻击力: 19,
  生命值: 112,
  防御力: 15,
  穿透值: 9,
  异常精通: 9,
};

/** 百分比形态副词条（2025 源存值需 ÷100 才与基数同量纲） */
const PCT_SUBSTATS = new Set(['暴击率', '暴击伤害', '攻击力%', '生命值%', '防御力%']);

/** 还原一条副词条的强化次数（1-6）。源按 value 类型自判（number=2025 需 ÷100 归一百分比、string=mys）。 */
export function substatRolls(name, value) {
  const base = SUBSTAT_ROLL_BASE[name];
  if (!base) return 0;
  const raw = parseFloat(String(value));
  if (!Number.isFinite(raw)) return 0;
  const v = typeof value === 'number' && PCT_SUBSTATS.has(name) ? raw / 100 : raw;
  const r = Math.round(v / base);
  return r < 1 ? 0 : r > 6 ? 6 : r; // 钳制：异常值（实测 19/144 万）不至于把分布拉出量程
}

/** 副词条名 → 工坊权重表（workshop-weights.json）的权重 key。
 *  权重表另有 能量/冲击/穿透率/掌控/加伤 四五个 key，它们只可能是主词条，不参与副词条口径。 */
const SUBSTAT_WEIGHT_KEY = {
  暴击率: '暴击',
  暴击伤害: '暴伤',
  '攻击力%': '攻击',
  攻击力: '攻击',
  '生命值%': '生命',
  生命值: '生命',
  '防御力%': '防御',
  防御力: '防御',
  穿透值: '穿透值',
  异常精通: '精通',
};

/** 工坊角色默认流派权重 → 每角色的「副词条 → 权重」表（权重 >0 即有效副词条；缺 key = 该角色不吃这条属性）。
 *  ⚠️ 权重表不区分百分比与固定值（攻击力% 与 攻击力 共用 key「攻击」），加权分沿用工坊原始口径。 */
export function buildRoleSubstatWeights(weightJson) {
  const out = new Map();
  if (!weightJson) return out;
  for (const [rid, r] of Object.entries(weightJson)) {
    const faction = r && Array.isArray(r.factions) ? r.factions[0] : null;
    if (!faction) continue;
    const byKey = new Map();
    for (const it of faction.weights || []) if (it && it.key != null) byKey.set(it.key, Number(it.weight) || 0);
    const m = new Map();
    for (const [sub, key] of Object.entries(SUBSTAT_WEIGHT_KEY)) {
      const w = byKey.get(key);
      if (w > 0) m.set(sub, w);
    }
    if (m.size) out.set(String(rid), m);
  }
  return out;
}

/** opts.weightJson → roleWeights（Map<role_id, Map<副词条,权重>>）。opts 已给 roleWeights 时直接用。
 *  两个盘聚合与效率分聚合都需要它，构建一次即可（纯查表，不影响任何 Map 插入顺序）。 */
function resolveRoleWeights(opts) {
  if (opts && opts.roleWeights instanceof Map) return opts.roleWeights;
  return buildRoleSubstatWeights(opts && opts.weightJson);
}

/** Map<名,次数> → [{name,count}] 按 count 降序（同频按首次出现序） */
function freqPairs(map) {
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** 按驱动盘套装聚合工坊真实配装（单盘级统计）。
 *  effDist 为**有效强化次数**分布（0-9，非旧「有效词条个数」），有效集合由 opts.weightJson/roleWeights 给出，
 *  缺失时退化为「全部合法副词条」；slotDist 为槽位分布（D7）；未解析到 library 的套装 / '其他' 跳过。 */
export function computeWorkshopDiscStats(entries, discIndex, opts = {}) {
  return runAcc(makeWorkshopDiscStatsAcc(discIndex, opts), entries);
}

function makeWorkshopDiscStatsAcc(discIndex, opts = {}) {
  const roleNameMap = opts.roleNameMap || null;
  const roleWeights = resolveRoleWeights(opts);
  const acc = new Map(); // 规范盘名 → 内部聚合
  const resolveSuit = (raw) => canonicalName(CATEGORY.DISC, discIndex, raw, { fuzzy: false });

  const add = (e) => {
    if (!e || !Array.isArray(e.equips)) return;
    const roleName = roleNameMap ? roleNameMap.get(String(e.role_id)) : String(e.role_id);
    if (roleName == null) return;
    // 该角色的有效副词条集合（工坊默认流派权重 >0）；无权重数据时 null = 退化为「全部合法副词条」
    const effW = roleWeights.get(String(e.role_id)) || null;
    for (const eq of e.equips) {
      if (!eq || !eq.suit) continue;
      const suit = resolveSuit(eq.suit);
      if (!suit || suit === '其他') continue;
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
            effDist: new Map(), // 有效强化次数(0-9) → 盘数
            slotDist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, // D7 套装×槽位：该套装各槽位盘数
            combos: new Map(), // 副词条组合 key → 盘数
            mainSub: { 4: new Map(), 5: new Map(), 6: new Map() }, // 槽 → 主词条 → Map<副词条,次数>
          })
        );
      a.equips += 1;
      a.chars.add(roleName);
      const slot = slotOf(eq);
      if (slot >= 1 && slot <= 6) a.slotDist[slot] += 1;
      // 词条名清洗：丢弃含 U+FFFD 的坏名（工坊源头属性名被替换符污染，无法归一且污染图表显示）
      const cleanName = (n) => (n && !n.includes('\uFFFD') ? n : null);
      // 两源同构：subs=全部副词条、main[0]=主词条。白名单清洗：只留合法副词条（SUBSTAT_TYPE_SET）——
      // 2025 源偶发异常词条（实测 180/605k 件）丢弃；rolls 同步还原，effDist 为「有效强化次数」口径
      const subPairs = (eq.subs || [])
        .map((s) => {
          const n = s && s.name ? cleanName(discStatName(s.name, s.value)) : null;
          return n && SUBSTAT_TYPE_SET.has(n) ? { name: n, rolls: substatRolls(n, s.value) } : null;
        })
        .filter(Boolean);
      const subNames = subPairs.map((s) => s.name);
      // 主词条 mn 只算一次，频次与 ×副词条协同共用；仅统计该槽候选内的合法主词条（MAIN_STAT_OPTIONS）
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
      // 有效强化次数分布 + 副词条组合（原地排序序列化去重；effRolls/comboKey 各算一次）
      let effRolls = 0;
      for (const s of subPairs) if (!effW || effW.has(s.name)) effRolls += s.rolls;
      a.effDist.set(effRolls, (a.effDist.get(effRolls) || 0) + 1);
      if (subNames.length) {
        subNames.sort();
        const comboKey = JSON.stringify(subNames);
        a.combos.set(comboKey, (a.combos.get(comboKey) || 0) + 1);
      }
      for (const n of subNames) a.subs.set(n, (a.subs.get(n) || 0) + 1);
    }
  };

  const finish = () =>
    [...acc.values()].map((a) => {
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
        effDist, // {次数:盘数} 有效强化次数分布（落在佩戴角色有效副词条上的强化次数之和，0-9）
        slotDist: a.slotDist, // {1..6:盘数} D7 套装×槽位：看该套装被当 4 件套（1-4 槽多）还是 2 件套（5-6 槽多）用
        subCombos, // [{combo:词条[], count}] 副词条组合 Top8（降序）
        mainSubCross, // {4:{主词条:{副词条:次数}},...} 主词条×副词条协同（两源同构）
      };
    });

  return { add, finish };
}

// ---------- 面板属性对 2D 密度（暴击率×暴伤、攻击×暴伤 的玩家真实 trade-off） ----------
// 前端拿不到逐条 panel（workshop.json 2.13GB 不下发），聚合时降采样为 2D 密度网格；x/y 各自 min-max
// 归一到 [0,1]（量纲不同，归一后才同轴可比），原始范围存 xMin..yMax 供前端 tooltip 反算实际值。

/** 2D 密度网格：x/y 数组 → {min/max, N, data:[[xi,yi,count]]}（xi/yi 为 [0,N-1] 归一网格坐标；
 *  前端按均匀 bin 反算实际值，故只需存 N 而非 bin 边界数组） */
export function bin2D(xv, yv, N) {
  const n = xv.length;
  if (!n) return null;
  let minX = xv[0],
    maxX = xv[0],
    minY = yv[0],
    maxY = yv[0];
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

const SCATTER_PAIRS = [
  ['暴击率', '暴击伤害'],
  ['攻击力', '暴击伤害'],
];

function finishPanelScatter(perRoleAcc, globalAcc) {
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

/** 每角色 / 全体 的面板属性对 2D 密度网格（供密度散点图）；perRole 按 role_id，攻击归一范围随粒度（该角色/全体）。 */
export function computePanelScatter(entries, pairs) {
  const { perRole, global } = collectPanelPairs(entries, pairs || SCATTER_PAIRS);
  return finishPanelScatter(perRole, global);
}

// ================= 练度指标聚合（全服总览 / 角色画像） =================

/** 轻量分布（无直方图/箱线，防 stats 膨胀）：count/min/max/mean/median/p10/p90。
 *  分位数统一走 quantileSorted（线性插值）——此前用最近秩，与 computeDist 定义不一致，同一份文件里 median 有两种含义。 */
function lightDist(vals) {
  const s = (vals || []).filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { count: 0, min: null, max: null, mean: null, median: null, p10: null, p90: null };
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    mean: s.reduce((a, v) => a + v, 0) / n,
    median: quantileSorted(s, 0.5),
    p10: quantileSorted(s, 0.1),
    p90: quantileSorted(s, 0.9),
  };
}

/** 每角色工坊装配评分（relic_point）分布（computeDist 全量）；0/非法评分排除（0 = 未带驱动盘/2025 源缺失）。 */
export function computeRelicStats(entries) {
  return runAcc(makeRelicStatsAcc(), entries);
}

function makeRelicStatsAcc() {
  const acc = new Map();
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const v = Number(e.relic_point);
      if (!Number.isFinite(v) || v <= 0) return;
      if (!acc.has(e.role_id)) acc.set(e.role_id, []);
      acc.get(e.role_id).push(v);
    },
    finish() {
      const out = {};
      for (const [rid, vals] of acc) out[rid] = panelStats(vals);
      return out;
    },
  };
}

/** 每角色影画档位（rank 0-6）占比：供影画金字塔。 */
export function computeRankDist(entries) {
  return runAcc(makeRankDistAcc(), entries);
}

function makeRankDistAcc() {
  const acc = new Map();
  return {
    add(e) {
      if (!e || e.role_id == null || e.rank == null) return;
      let d = acc.get(e.role_id);
      if (!d) acc.set(e.role_id, (d = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }));
      const r = Number(e.rank);
      if (r >= 0 && r <= 6) d[r]++;
    },
    finish() {
      return Object.fromEntries(acc);
    },
  };
}

/** 角色拥有率：样本池（全部去重 uid）中拥有该角色（该 uid 有该角色条目）的占比。
 *  workshop.json 的 v3 响应含每 uid 的**全部**角色，故「拥有」= uid 集合包含该角色。 */
function makeRoleOwnershipAcc() {
  const perRole = new Map();
  const pool = new Set();
  return {
    add(e) {
      if (!e || e.role_id == null || e.uid == null) return;
      pool.add(String(e.uid));
      let s = perRole.get(e.role_id);
      if (!s) perRole.set(e.role_id, (s = new Set()));
      s.add(String(e.uid));
    },
    finish() {
      const roles = {};
      for (const [rid, s] of perRole) roles[rid] = pool.size ? s.size / pool.size : 0;
      return { pool: pool.size, roles };
    },
  };
}

/** 角色拥有率（公开函数：与 computeAllWorkshopStats 单遍历逐位相等） */
export function computeRoleOwnership(entries) {
  return runAcc(makeRoleOwnershipAcc(), entries);
}

/** 样本口径：条目、去重 uid、数据源与每角色覆盖。
 *  该统计不代表全体玩家——workshop.json 本身是经过练度门槛筛选的样本池。 */
export function computeSampleCoverage(entries) {
  return runAcc(makeSampleCoverageAcc(), entries);
}

function makeSampleCoverageAcc() {
  const uidSet = new Set();
  const sources = { mys: 0, '2025': 0, unknown: 0 };
  const roles = new Map();
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const rid = String(e.role_id);
      const src = sourceOf(e) || 'unknown';
      const r = roles.get(rid) || { entries: 0, uids: new Set(), sources: { mys: 0, '2025': 0, unknown: 0 } };
      r.entries++;
      r.sources[src] = (r.sources[src] || 0) + 1;
      if (e.uid != null) {
        const uid = String(e.uid);
        uidSet.add(uid);
        r.uids.add(uid);
      }
      sources[src]++;
      roles.set(rid, r);
    },
    finish() {
      const outRoles = {};
      for (const [rid, r] of roles) {
        outRoles[rid] = { entries: r.entries, uids: r.uids.size, sources: { ...r.sources } };
      }
      return { entries: Object.values(outRoles).reduce((s, r) => s + r.entries, 0), uidCount: uidSet.size, sources, roles: outRoles };
    },
  };
}

/** 选择集中度：按角色统计音擎、套装组合与 4/5/6 号位主词条的 Top1/Top3、HHI、熵。
 *  HHI 越高表示玩家选择越集中；effectiveChoices = 1 / HHI 是更直观的等效选择数。
 */
export function computeChoiceConcentration(entries) {
  return runAcc(makeChoiceConcentrationAcc(), entries);
}

function choiceDist(map) {
  const total = [...map.values()].reduce((s, n) => s + n, 0);
  if (!total) return { total: 0, top: [], top1: null, top3: null, hhi: null, entropy: null, effectiveChoices: null };
  const top = [...map.entries()]
    .map(([name, count]) => ({ name, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
    .slice(0, 5);
  const probs = [...map.values()].map((count) => count / total);
  const hhi = probs.reduce((s, p) => s + p * p, 0);
  const entropy = -probs.reduce((s, p) => s + p * Math.log2(p), 0);
  return {
    total,
    top,
    top1: top[0]?.share ?? null,
    top3: top.slice(0, 3).reduce((s, x) => s + x.share, 0),
    hhi,
    entropy,
    effectiveChoices: hhi ? 1 / hhi : null,
  };
}

function makeChoiceConcentrationAcc() {
  const roles = new Map();
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      let r = roles.get(String(e.role_id));
      if (!r)
        roles.set(
          String(e.role_id),
          (r = {
            entries: 0,
            weapons: new Map(),
            suits: new Map(),
            main456: { 4: new Map(), 5: new Map(), 6: new Map() },
          })
        );
      r.entries++;
      const weapon = e.weapon?.name;
      if (weapon && weapon !== '其他') r.weapons.set(weapon, (r.weapons.get(weapon) || 0) + 1);

      const suitCounts = new Map();
      for (const eq of e.equips || []) {
        if (!eq?.suit || eq.suit === '其他') continue;
        suitCounts.set(eq.suit, (suitCounts.get(eq.suit) || 0) + 1);
        const slot = slotOf(eq);
        if (slot < 4 || slot > 6) continue;
        const main = Array.isArray(eq.main) ? eq.main[0] : null;
        const name = main?.name ? mainStatName(discStatName(main.name, main.value)) : null;
        if (name && (MAIN_STAT_OPTIONS[slot] || []).includes(name)) {
          r.main456[slot].set(name, (r.main456[slot].get(name) || 0) + 1);
        }
      }
      if (suitCounts.size) {
        const combo = [...suitCounts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
          .map(([name, count]) => `${name}${count}`)
          .join('+');
        r.suits.set(combo, (r.suits.get(combo) || 0) + 1);
      }
    },
    finish() {
      const out = {};
      for (const [rid, r] of roles) {
        out[rid] = {
          entries: r.entries,
          weapons: choiceDist(r.weapons),
          suits: choiceDist(r.suits),
          main456: { 4: choiceDist(r.main456[4]), 5: choiceDist(r.main456[5]), 6: choiceDist(r.main456[6]) },
        };
      }
      return out;
    },
  };
}

/** 每角色 × 技能类型（canonical 编号，见 constants.SKILL_TYPES）的等级分布。
 *  工坊两源 type 语义不同，聚合前按源归一化：mys 源用 OFFICIAL_SKILL_TYPE、2025 源用 WS2025_SKILL_TYPE（连携/终结并入 canonical 4）。
 *  源判别：`source` 字段 → equips[].rarity 类型（mys "S"/2025 4）→ skills 数组顺序兜底。 */
export function computeSkillStats(entries) {
  return runAcc(makeSkillStatsAcc(), entries);
}

/** equips[].rarity 的**类型**判源：string（"S"）→ mys、number（4）→ 2025；无 rarity 返回 null。
 *  结构性差异而非取值差异（mys 分支透传格式化等级字母、2025 透传原始数值）；实测与 subs[].value 形态 100% 同构零交叉。 */
function is2025ByRarity(e) {
  for (const eq of e.equips || []) {
    if (!eq || eq.rarity == null) continue;
    return typeof eq.rarity === 'number';
  }
  return null;
}

/** 工坊两源判别（'mys' / '2025' / null）：source 字段 → rarity 类型 → skills 数组顺序，逐级兜底。
 *  技能语义归一（skillTypeMapOf）共用此判别，口径必须一致。 */
export function sourceOf(e) {
  if (!e) return null;
  if (e.source === 'mys' || e.source === '2025') return e.source;
  // 旧数据（无 source，实测 15 万采样中 100% 都是）：rarity 类型是最可靠的替代信号
  const byRar = is2025ByRarity(e);
  if (byRar != null) return byRar ? '2025' : 'mys';
  // 末位兜底：连 rarity 都没有才回退数组顺序（mys 第 2 位=2、2025=1）。该启发式在 20 万样本中分歧
  // 160 条（0.080%）——rarity 全 "S" 但 skills 恰呈 ID 升序会误判（1↔2、终结/支援错位），故只作兜底。
  if (e.skills?.length >= 2) return e.skills[1].type !== 2 ? '2025' : 'mys';
  return null;
}

/** 源 → 技能 type 归一表；无法判源返回 null（该条不贡献技能统计）。 */
function skillTypeMapOf(e) {
  const src = sourceOf(e);
  if (!src) return null;
  return src === '2025' ? WS2025_SKILL_TYPE : OFFICIAL_SKILL_TYPE;
}

function makeSkillStatsAcc() {
  const acc = new Map(); // rid -> Map<type -> number[]>
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const map = skillTypeMapOf(e);
      if (!map) return;
      for (const s of e.skills || []) {
        if (s.type == null || s.level == null) continue;
        const t = map[s.type] ?? s.type; // 归一化源 type → canonical
        let byType = acc.get(e.role_id);
        if (!byType) acc.set(e.role_id, (byType = new Map()));
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t).push(s.level);
      }
    },
    finish() {
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
    },
  };
}

// ---------- 加权词条效率分（强化次数 × 工坊角色流派权重） ----------
// workshop-weights.json 是工坊官方给每个角色的默认流派属性权重（0.2-1），与还原的强化次数相乘即
// 「加权词条效率分」——比 relic_point 透明（公式公开、前端可用同一张 weights 表对「我的盘」复算）。
// 口径：权重表不区分百分比/固定值（共用 key），沿用工坊原始口径不折算。

/** 每角色「加权词条效率分」分布（按条目 = 一整套驱动盘聚合）。
 *  weights 供前端复算「我的分」用同一张表；slotEff 为每槽有效强化次数均值（找短板槽）；
 *  scoreVsRelic 为 D9「工坊评分 × 盘毕业度」皮尔逊相关（同条目配对，relic_point 缺失/为 0 不配对）。 */
export function computeRollEfficiency(entries, opts = {}) {
  return runAcc(makeRollEfficiencyAcc(opts), entries);
}

function makeRollEfficiencyAcc(opts = {}) {
  const roleWeights = resolveRoleWeights(opts);
  const acc = new Map(); // role_id -> {scores:[], effs:[], slot:Map<slot,{count,sum}>, relicX:[], relicY:[]}
  return {
    add(e) {
      if (!e || e.role_id == null || !Array.isArray(e.equips)) return;
      const w = roleWeights.get(String(e.role_id));
      if (!w) return; // 无权重角色不参与（权重表覆盖 57 角色；新角色在权重表更新前跳过）
      let score = 0;
      let eff = 0;
      let any = false;
      const bySlot = new Map();
      for (const eq of e.equips) {
        if (!eq || !eq.suit) continue;
        any = true;
        let slotEffRolls = 0;
        for (const s of eq.subs || []) {
          const n = s && s.name ? discStatName(s.name, s.value) : null;
          if (!n || n.includes('�') || !SUBSTAT_TYPE_SET.has(n)) continue;
          const wt = w.get(n);
          if (!wt) continue; // 该角色不吃这条属性 → 歪词条，不计分也不计有效次数
          const r = substatRolls(n, s.value);
          score += r * wt;
          slotEffRolls += r;
        }
        eff += slotEffRolls;
        const slot = slotOf(eq);
        if (slot >= 1 && slot <= 6) {
          let o = bySlot.get(slot);
          if (!o) bySlot.set(slot, (o = { count: 0, sum: 0 }));
          o.count += 1;
          o.sum += slotEffRolls;
        }
      }
      if (!any) return; // 空装（未佩戴任何盘）不进样本，否则把分布往 0 拉
      let a = acc.get(e.role_id);
      if (!a) acc.set(e.role_id, (a = { scores: [], effs: [], slot: new Map(), relicX: [], relicY: [] }));
      a.scores.push(score);
      a.effs.push(eff);
      // D9 评分 × 毕业度：同条目配对（relic_point 为 0/缺失 = 2025 源未给评分，不配对）
      const rp = Number(e.relic_point);
      if (Number.isFinite(rp) && rp > 0) {
        a.relicX.push(rp);
        a.relicY.push(score);
      }
      for (const [slot, o] of bySlot) {
        let t = a.slot.get(slot);
        if (!t) a.slot.set(slot, (t = { count: 0, sum: 0 }));
        t.count += o.count;
        t.sum += o.sum;
      }
    },
    finish() {
      const out = {};
      for (const [rid, a] of acc) {
        const slotEff = {};
        for (const [slot, t] of a.slot) slotEff[slot] = { count: t.count, mean: t.sum / t.count };
        out[rid] = {
          weights: Object.fromEntries(roleWeights.get(String(rid)) || []),
          score: panelStats(a.scores),
          effRolls: panelStats(a.effs),
          slotEff,
          scoreVsRelic: a.relicX.length >= 30 ? { n: a.relicX.length, r: pearson(a.relicX, a.relicY) } : null,
        };
      }
      return out;
    },
  };
}

// ---------- 2026-10 新增聚合：配队亲和 ----------

/** 每角色「同 uid 玩家同练角色」共现（真实配队亲和性）：角色 A → 队友 B 出现次数降序。 */
export function computeRoleCooccurrence(entries) {
  return runAcc(makeRoleCooccurrenceAcc(), entries);
}

/** 共现累加器：add 只收集「uid → 角色集合」，配对全在 finish。
 *  注意内存：这是唯一必须驻留「全体 uid × 角色集合」的聚合。 */
function makeRoleCooccurrenceAcc() {
  const uidRoles = new Map(); // uid -> Set(role_id)
  return {
    add(e) {
      if (!e || e.uid == null || e.role_id == null) return;
      let s = uidRoles.get(e.uid);
      if (!s) uidRoles.set(e.uid, (s = new Set()));
      s.add(String(e.role_id));
    },
    finish() {
      const co = new Map(); // roleA -> Map(roleB -> count)
      for (const roles of uidRoles.values()) {
        const arr = [...roles];
        for (const a of arr) {
          let m = co.get(a);
          if (!m) co.set(a, (m = new Map()));
          for (const b of arr) if (b !== a) m.set(b, (m.get(b) || 0) + 1);
        }
      }
      const out = {};
      for (const [a, m] of co) out[a] = [...m.entries()].sort((x, y) => y[1] - x[1]);
      return out;
    },
  };
}

// 【已移除】computeCompleteness（音擎60/盘满级/评分≥P75 占比）——2026-08 实测三个维度全部退化：
// 样本池是上榜 uid（高练度标杆池），音擎 60 级与盘满级是入场券（57 角色 w60/discMax 全为 1.0000），
// relicTop 是定义上的恒等式（全落 0.2500-0.2517），连同前端「完成度矩阵」卡一并删除。

// ---------- 单遍历总入口（2026-08 性能重构） ----------

/** 一次遍历 entries 完成全部 13 项聚合；每个 key 与对应公开函数**逐位相同**（见文件顶部累加器说明）。
 *  ⚠️ opts.weightJson 必须传入：驱动盘 effDist 与 rollEfficiency 都依赖它，缺失时 effDist 退化为
 *  「全部合法副词条」、rollEfficiency 返回空对象。entries 仅消费一次（可为 generator）。 */
// ---------- 角色流派分析（2026-10 新增） ----------
// 流派 = 玩家在面板上的配置取向分化，k-means 把这些取向聚成簇（每簇 = 一个流派）。
// ⚠️ 聚类属性必须按角色定位（trait）选：击破核心是**冲击力**、异常是**精通/掌控**、命破/防护是**生命/防御**、
// 支援只有 攻击/生命——固定 6 维会让核心维度缺失、无关维度（双暴）成判别信号；候选池按 trait 选后
// 再做**数据驱动去噪**（归一化 sd 过低的列剔除，至少保留 3 维）。试验 k=3 出稳定流派、k=4 出现噪声簇，故固定 k=3。
const STYLE_K = 3;
const STYLE_MAX_SAMPLES = 20000; // 每角色样本上限（2 万 × ≤7 维已足够稳定；截断保序无随机性）
/** 角色定位 → 聚类候选属性池（定位语义：只聚玩家真正会分化的属性） */
const TRAIT_STYLE_ATTRS = {
  强攻: ['攻击力', '暴击率', '暴击伤害', '生命值', '防御力'],
  命破: ['生命值', '攻击力', '暴击率', '暴击伤害', '防御力'],
  防护: ['生命值', '防御力', '攻击力', '暴击率', '暴击伤害'],
  击破: ['冲击力', '攻击力', '暴击率', '暴击伤害', '生命值'],
  异常: ['攻击力', '异常精通', '异常掌控', '暴击率', '暴击伤害'],
  支援: ['攻击力', '生命值', '防御力', '暴击率', '暴击伤害'],
};
/** 无定位信息时回退通用池 */
const STYLE_FALLBACK_ATTRS = ['攻击力', '防御力', '生命值', '暴击率', '暴击伤害'];
/** 去噪阈值：归一化 sd（cv = sd/|mean|）低于此值 = 玩家无分化，剔除该维 */
const STYLE_MIN_CV = 0.04;

/** 归一主词条名 → 流派基名（4 号位取向） */
export function styleBaseName(main4) {
  switch (main4) {
    case '暴击伤害':
      return '暴伤';
    case '暴击率':
      return '暴击率';
    case '异常精通':
      return '精通';
    case '攻击力%':
    case '攻击力':
      return '攻击';
    case '冲击力':
      return '冲击';
    default:
      return '均衡';
  }
}
/** 归一主词条名 → 流派后缀（6 号位取向；空 = 不标注） */
export function styleSuffix(main6) {
  switch (main6) {
    case '攻击力%':
    case '攻击力':
      return '攻击';
    case '异常掌控':
    case '异常精通':
      return '异常';
    case '能量自动回复':
      return '回能';
    case '冲击力':
      return '冲击';
    default:
      return '';
  }
}
/** 流派标签 = 4 号位取向 + 6 号位取向（如「暴伤·攻击」「精通·异常」；两段相同时只留一段） */
export function styleLabel(main4Top, main6Top) {
  const base = styleBaseName(main4Top);
  const suffix = styleSuffix(main6Top);
  return suffix && suffix !== base ? `${base}·${suffix}` : base;
}
/** 属性短名（面板档位后缀用；伤害加成「冰属性伤害加成」→「冰伤」） */
export function styleAttrShort(attr) {
  const m = /^(.+?)(?:属性)?伤害加成$/.exec(attr);
  if (m) return `${m[1].replace(/^物理$/, '物')}伤`;
  return (
    { 攻击力: '攻击', 暴击率: '暴击率', 暴击伤害: '暴伤', 异常精通: '精通', 异常掌控: '掌控', 冲击力: '冲击' }[attr] ||
    attr
  );
}

/** 我的面板 → 各流派距离（按属性相对差平方和 ÷ 参与属性数，缺失属性跳过；dist 越小越贴近）。
 *  供前端「我的角色联动」标注用户配置偏向哪个流派。 */
export function styleMatch(roleStyle, myPanel) {
  if (!roleStyle || !roleStyle.styles?.length) return null;
  const scored = roleStyle.styles
    .map((st) => {
      let d = 0;
      let cnt = 0;
      for (const a of roleStyle.attrs) {
        const my = myPanel[a];
        const m = st.panel?.[a]?.mean;
        if (my == null || m == null || m === 0) continue;
        d += ((my - m) / m) ** 2;
        cnt++;
      }
      return { label: st.label, share: st.share, dist: cnt ? d / cnt : Infinity };
    })
    .sort((a, b) => a.dist - b.dist);
  return { best: scored[0] ?? null, scored };
}

/** 流派聚类累加器（挂进 computeAllWorkshopStats 单遍历）；traits 缺省回退通用属性池。 */
function makeRoleStylesAcc(traits) {
  const perRole = new Map(); // role_id -> {dmg: Map<键,count>, samples: [{panel,mains,suit,wep,dmg}]}
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const pm = {};
      for (const p of e.panel || []) {
        const v = parsePanelFinal(p.final);
        if (v != null) pm[p.name] = v;
      }
      // 攻击力是所有角色的面板基座：缺失视为面板不全，不入样（完整属性过滤在 finish 按候选集做）
      if (pm['攻击力'] == null) return;
      // 属性伤害键：含「伤害」且排除「暴击伤害」（角色级众数在 finish 定，先按样本收集）
      const dmg = {};
      for (const k of Object.keys(pm)) {
        if (k.includes('伤害') && k !== '暴击伤害') dmg[k] = pm[k];
      }
      let o = perRole.get(e.role_id);
      if (!o) perRole.set(e.role_id, (o = { dmg: new Map(), samples: [] }));
      for (const k of Object.keys(dmg)) o.dmg.set(k, (o.dmg.get(k) || 0) + 1);
      if (o.samples.length >= STYLE_MAX_SAMPLES) return;
      const mains = {};
      for (const eq of e.equips || []) {
        const slot = slotOf(eq);
        if (slot < 4 || slot > 6) continue;
        const mn = eq.main?.[0]?.name ? normalizeStatKey(eq.main[0].name) : null;
        if (mn) mains[slot] = mn;
      }
      o.samples.push({
        panel: pm,
        dmg: Object.keys(dmg).length ? dmg : null,
        mains,
        suit: (e.equips || []).find((x) => x.suit)?.suit || null,
        wep: e.weapon?.name || null,
      });
    },
    finish() {
      const out = {};
      for (const [rid, o] of perRole) {
        if (o.samples.length < 200) continue; // 样本太少不聚类（流派无统计意义）
        // 伤害加成键 = 该角色出现次数最多的「属性伤害」键（如 冰属性伤害加成）
        let dmgKey = null;
        let best = 0;
        for (const [k, c] of o.dmg)
          if (c > best) {
            best = c;
            dmgKey = k;
          }
        // 候选属性池：按角色定位（trait）选；无定位回退通用池；伤害加成键动态并入
        const trait = traits?.[rid];
        const cand = (trait && TRAIT_STYLE_ATTRS[trait]) || STYLE_FALLBACK_ATTRS;
        let attrs = dmgKey ? [...cand, dmgKey] : [...cand];
        // 样本过滤：缺任一候选属性 → 跳过（面板不全）
        const valid = o.samples.filter((s) => attrs.every((a) => s.panel[a] != null));
        if (valid.length < 200) continue;
        // 数据驱动去噪：cv = sd/|mean| 过低的列 = 玩家无分化 = 无流派判别力，剔除（至少保留 3 维）
        const dim0 = attrs.length;
        const mu0 = new Array(dim0).fill(0);
        const sd0 = new Array(dim0).fill(0);
        for (const s of valid) for (let j = 0; j < dim0; j++) mu0[j] += s.panel[attrs[j]];
        for (let j = 0; j < dim0; j++) mu0[j] /= valid.length;
        for (const s of valid) for (let j = 0; j < dim0; j++) sd0[j] += (s.panel[attrs[j]] - mu0[j]) ** 2;
        for (let j = 0; j < dim0; j++) sd0[j] = Math.sqrt(sd0[j] / valid.length);
        let keep = attrs.map((_, j) => mu0[j] !== 0 && sd0[j] / Math.abs(mu0[j]) >= STYLE_MIN_CV);
        if (keep.filter(Boolean).length < 3) {
          const order = sd0
            .map((v, j) => (mu0[j] === 0 ? 0 : v / Math.abs(mu0[j])))
            .map((v, j) => [v, j])
            .sort((a, b) => b[0] - a[0]);
          keep = attrs.map((_, j) => order.slice(0, 3).some(([, jj]) => jj === j));
        }
        attrs = attrs.filter((_, j) => keep[j]);
        const dim = attrs.length;
        const P = valid.map((s) => attrs.map((a) => s.panel[a]));
        // 列标准化（z-score；sd=0 的列退化为 1 避免除零——退化列无区分度，不影响聚类）
        const mu = new Array(dim).fill(0);
        const sd = new Array(dim).fill(0);
        for (const p of P) for (let j = 0; j < dim; j++) mu[j] += p[j];
        for (let j = 0; j < dim; j++) mu[j] /= P.length;
        for (const p of P) for (let j = 0; j < dim; j++) sd[j] += (p[j] - mu[j]) ** 2;
        for (let j = 0; j < dim; j++) sd[j] = Math.sqrt(sd[j] / P.length) || 1;
        const Z = P.map((p) => p.map((v, j) => (v - mu[j]) / sd[j]));
        const assign = kmeans(Z, STYLE_K);
        const clusters = Array.from({ length: STYLE_K }, () => ({ idx: [], sum: new Array(dim).fill(0) }));
        assign.forEach((c, i) => {
          clusters[c].idx.push(i);
          for (let j = 0; j < dim; j++) clusters[c].sum[j] += P[i][j];
        });
        const topN = (items, get, n = 2) => {
          const m = new Map();
          for (const i of items) {
            const x = get(i);
            if (!x) continue;
            m.set(x, (m.get(x) || 0) + 1);
          }
          return [...m.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([k]) => k);
        };
        const styles = [];
        for (let c = 0; c < STYLE_K; c++) {
          const { idx } = clusters[c];
          if (!idx.length) continue; // 空簇防御（确定性初始化 + z-score 下基本不会出现）
          const n = idx.length;
          const center = clusters[c].sum.map((s) => s / n);
          const panel = {};
          attrs.forEach((a, j) => {
            const sorted = idx.map((i) => P[i][j]).sort((x, y) => x - y);
            panel[a] = {
              mean: +center[j].toFixed(4),
              median: +quantileSorted(sorted, 0.5).toFixed(4),
            };
          });
          // ⚠️ 必须索引 valid 而非 o.samples：idx 来自 assign/P（以过滤后的 valid 为基准），索引 o.samples
          // 会让被过滤样本之后的全部样本错位一格（实测 23/57 角色有过滤，最坏污染该角色 92.8% 归属且簇名也错）。
          const main4 = topN(idx, (i) => valid[i].mains[4]);
          const main6 = topN(idx, (i) => valid[i].mains[6]);
          styles.push({
            share: +(n / valid.length).toFixed(4),
            label: styleLabel(main4[0], main6[0]),
            panel,
            main: { 4: main4, 5: topN(idx, (i) => valid[i].mains[5]), 6: main6 },
            suits: topN(idx, (i) => valid[i].suit),
            wengine: topN(idx, (i) => valid[i].wep),
          });
        }
        styles.sort((a, b) => b.share - a.share);
        // 同名流派消歧：同 label 的簇按面板判别属性（z 绝对值最大、排除低判别属性）追加档位后缀，
        // 如「暴伤·攻击」两簇 → 「暴伤·攻击·冰伤高」「暴伤·攻击·攻击高」
        const labelCount = new Map();
        for (const st of styles) labelCount.set(st.label, (labelCount.get(st.label) || 0) + 1);
        if (labelCount.size < styles.length) {
          const LOW_DISC = new Set(['防御力']); // 防御对各定位都低判别；生命对命破/防护是核心，不排除
          for (const st of styles) {
            if (labelCount.get(st.label) < 2) continue;
            let bestA = null;
            let bestZ = 0;
            attrs.forEach((a, j) => {
              if (LOW_DISC.has(a)) return;
              const z = (st.panel[a].mean - mu[j]) / sd[j];
              if (Math.abs(z) > Math.abs(bestZ)) {
                bestZ = z;
                bestA = a;
              }
            });
            if (bestA && Math.abs(bestZ) > 0.4)
              st.label = `${st.label}·${styleAttrShort(bestA)}${bestZ > 0 ? '高' : '低'}`;
          }
        }
        if (styles.length >= 2) out[rid] = { attrs, styles };
      }
      return out;
    },
  };
}

/** 角色流派分析（独立入口，测试用；生产走 computeAllWorkshopStats 单遍历）。 */
export function computeRoleStyles(entries, opts = {}) {
  const acc = makeRoleStylesAcc(opts.traits);
  for (const e of entries || []) acc.add(e);
  return acc.finish();
}

export function computeAllWorkshopStats(entries, discIndex, opts = {}) {
  // 相关性与散点属性对不同，各建采集器：合并会改 key 插入顺序（见 makePanelPairsAcc 注释）
  const corrAcc = makePanelPairsAcc(CORR_PAIRS);
  const scatterAcc = makePanelPairsAcc(SCATTER_PAIRS);
  const wsAcc = makeWorkshopStatsAcc();
  // 权重表只解析一次，两个盘聚合与效率分共用（纯查表，不影响任何 Map 插入顺序）
  const accOpts = { ...opts, roleWeights: resolveRoleWeights(opts) };
  const discAcc = makeWorkshopDiscStatsAcc(discIndex, accOpts);
  const relicAcc = makeRelicStatsAcc();
  const rankDistAcc = makeRankDistAcc();
  const skillAcc = makeSkillStatsAcc();
  const coAcc = makeRoleCooccurrenceAcc();
  const rollEffAcc = makeRollEfficiencyAcc(accOpts);
  const styleAcc = makeRoleStylesAcc(opts.traits);
  const ownAcc = makeRoleOwnershipAcc();
  const coverageAcc = makeSampleCoverageAcc();
  const concentrationAcc = makeChoiceConcentrationAcc();

  // 唯一一次遍历：每条目喂给全部累加器。add 之间互不共享中间态，故顺序无副作用
  for (const e of entries || []) {
    wsAcc.add(e);
    corrAcc.add(e);
    discAcc.add(e);
    scatterAcc.add(e);
    relicAcc.add(e);
    rankDistAcc.add(e);
    skillAcc.add(e);
    coAcc.add(e);
    rollEffAcc.add(e);
    styleAcc.add(e);
    ownAcc.add(e);
    coverageAcc.add(e);
    concentrationAcc.add(e);
  }

  const scatter = scatterAcc.finish();
  return {
    stats: wsAcc.finish(),
    panelCorr: finishPanelCorrelations(corrAcc.finish().perRole),
    discDetails: discAcc.finish(),
    panelScatter: finishPanelScatter(scatter.perRole, scatter.global),
    relicStats: relicAcc.finish(),
    rankDist: rankDistAcc.finish(),
    skillStats: skillAcc.finish(),
    roleCooccurrence: coAcc.finish(),
    rollEfficiency: rollEffAcc.finish(),
    roleStyles: styleAcc.finish(),
    roleOwnership: ownAcc.finish(),
    sampleCoverage: coverageAcc.finish(),
    choiceConcentration: concentrationAcc.finish(),
  };
}
