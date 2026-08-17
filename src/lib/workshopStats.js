// src/lib/workshopStats.js —— 工坊配装数据（workshop.json）汇总纯函数（Node 与浏览器共用）
// 输入：workshop.json 的 entries（每条约一个玩家角色的配装：weapon/equips/panel/skills/rank/relic_point）
// 输出（按角色/盘/玩家聚合）：computeWorkshopStats（音擎/驱动盘条目数 + 面板真实样本统计）、
//   computePanelCorrelations（属性相关）、computeWorkshopDiscStats（驱动盘单盘统计）、
//   computePanelScatter（面板 2D 密度）、练度指标（relicStats/rankDist/skillStats/roleDiscStats/roleOwnership）、
//   2026-10 新增（roleCooccurrence/rankRelic/skillCombos）、
//   2026-08 新增（rollEfficiency 加权词条效率分 + D9 评分×毕业度、sourceAudit 两源一致性 D10）、
//   discStatName、substatRolls、buildRoleSubstatWeights、sourceOf、bin2D。
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

/** 面板数值统计（玩家真实样本）：分位/离散/形态（见 distStats.computeDist）；空数组返回空统计 */
function panelStats(arr) {
  return computeDist(arr);
}

// ---------- 累加器（accumulator）拆分说明（2026-08 性能重构） ----------
// 每个聚合原本是「自带 for 循环的独立函数」，于是 buildWorkshopStats 里 13 个聚合 = 13 次全量遍历
// workshop.json（2.13GB，每遍流式解析 ~27s，合计浪费 ~6 分钟）。这里把每个聚合拆成两段：
//   add(entry) —— 逐条累加（原 for 循环体，一字未改）
//   finish()   —— 收尾计算（原循环之后的分位/排序/对象化，一字未改）
// 于是：① 原公开函数 = 建累加器 → 循环 add → finish（签名与输出完全不变，测试与其它调用方无感）；
//       ② computeAllWorkshopStats = 建 13 个累加器 → **一次** for 循环里全部 add → 各自 finish。
// 关键不变量（等价性靠它，不是靠浮点容差）：累加器内部的 Map/数组仍严格按「条目出现顺序」写入，
// 与各自独立遍历时的顺序逐条一致，因此输出的键序、数组元素序、浮点求和/求均值的累加顺序都不变，
// 结果与重构前**逐位相等**。若哪天有人把 add 挪到共享的中间结果上（比如两个盘聚合共用一次
// subNames 解析），必须确认它不改变各自 Map 的首次插入顺序，否则键序会漂移。
// 之所以不共享中间解析：computeWorkshopDiscStats 与 computeRoleDiscStats 的过滤/分组口径虽相近但不同，
// 共享会引入耦合且收益有限（瓶颈是 JSON.parse 与磁盘 IO，不是这几次词条归一）。

/** 通用：把累加器套回「一次性函数」形态（原公开函数的循环体） */
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

/**
 * 汇总工坊配装数据。
 * @param {object[]} entries  workshop.json 的 entries（{uid, role_id, rank, weapon, equips, panel}）
 * @returns {{wengines:{name:string,count:number,characters:string[]}[],
 *            discs:{name:string,count:number,characters:string[]}[],
 *            panels:{name:string,stats:Object<string,Dist>}[]}}
 *   wengines/discs：按配装条目数聚合（同配装同套装只计一次），characters 为去重角色 id。
 *   panels：每角色每属性的真实样本统计（computeDist：count/min/max/range/mean/median/sd/IQR/p10/p25/p50/p75/p90/p95/p99/skew/kurt/whiskerLow/whiskerHigh/outliers/hist，百分比属性已归一化为小数）。
 */
export function computeWorkshopStats(entries) {
  return runAcc(makeWorkshopStatsAcc(), entries);
}

/**
 * 属性相关性（皮尔逊）：按「同一条配装内属性配对」+「按角色分组」计算（pooled 相关被角色混合主导无意义）。
 * @param {object[]} entries  workshop.json 的 entries
 * @param {string[][]} [pairs]  要计算的属性对（默认 攻击-防御/攻击-生命/防御-生命/暴击率-暴伤/攻击-暴伤/攻击-暴击率/异常精通-异常掌控）
 * @returns {Object<string, Object<string, number>>}  角色 id → {`属性A_属性B`: r}
 */
/** 逐条目解析 panel → 每角色 / 全体 的属性对配对样本（computePanelCorrelations 与 computePanelScatter 共用同一份采集逻辑）。
 *  每对累加器自带属性名（无需靠 key 反解）。finish() 返回 {perRole:Map<string,Map<string,{x,y,xv,yv}>>, global:Map<string,{x,y,xv,yv}>}
 *  注意：相关性与散点用的是**不同的属性对集合**，故必须各建一个采集器而非合并成 9 对——
 *  合并会改变 perRole/global 的 key 插入顺序，输出对象键序随之漂移（值虽同，deepStrictEqual 之外的
 *  JSON 文本会变），且给不需要的对白白采样。 */
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

/** 相关性默认属性对（攻击-防御/攻击-生命/防御-生命/暴击率-暴伤/攻击-暴伤/攻击-暴击率/异常精通-异常掌控） */
const CORR_PAIRS = [
  ['攻击力', '防御力'],
  ['攻击力', '生命值'],
  ['防御力', '生命值'],
  ['暴击率', '暴击伤害'],
  ['攻击力', '暴击伤害'],
  ['攻击力', '暴击率'],
  ['异常精通', '异常掌控'],
];

/** 相关性收尾：perRole 配对样本 → {role: {`A_B`: r}} */
function finishPanelCorrelations(perRole) {
  const out = {};
  for (const [role, pairs_] of perRole) {
    out[role] = {};
    for (const [key, p] of pairs_) out[role][key] = pearson(p.xv, p.yv);
  }
  return out;
}

export function computePanelCorrelations(entries, pairs) {
  const { perRole } = collectPanelPairs(entries, pairs || CORR_PAIRS);
  return finishPanelCorrelations(perRole);
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

// ---------- 副词条强化次数（roll）还原 + 角色有效词条权重 ----------
// 驱动盘每条副词条的数值 = 单次强化基数 × 强化次数（1-6）。两源存法不同但基数同源：
//   2025 源：百分比 ×100 存整数（暴击率 2.4% → 240）、固定值原值（攻击力 19）；value 为 number
//   mys   源：百分比存去掉 % 的数（2.4）、固定值原值（19）；value 为 string
// value 的类型本身就是源标记——实测 20 万条目，`typeof eq.rarity`（"S" / 4）与 `typeof sub.value`
// （string / number）100% 同构，零交叉，故这里按 value 类型自判源，无需外部传参。
//
// 为什么要还原次数：旧口径的「有效词条**个数**」上限只有 4，实测 4,979,291 块盘里 99.95% 都等于 4，
// 完全没有区分度（D4 毕业度因此形同虚设）。而次数口径实测（6 万条目 / 144 万副词条）
// 1 次 30.97% / 2 次 38.70% / 3 次 22.54% / 4 次 7.03% / 5 次 0.75% / 6 次 0.014%，方差充足；
// 且 value/base 有 99.9987% 恰为 1-6 的整数（余 19 条为异常值，靠 round + 钳制兜底），可无损还原。
// 注意「单盘总强化次数」几乎没有信息量（满级盘恒为 8 或 9），有区分度的是**落在角色有效词条上的次数**。

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

/**
 * 还原一条副词条的强化次数（1-6）。源按 value 类型自判（number=2025 需 ÷100 归一百分比、string=mys）。
 * @param {string} name  已归一的副词条名（discStatName 产物）
 * @param {string|number} value  原始值
 * @returns {number} 强化次数；名不在基数表或值非法返回 0（不计入）
 */
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

/**
 * 工坊角色默认流派权重 → 每角色的「副词条 → 权重」表（权重 >0 即视为该角色的有效副词条）。
 * @param {Object<string, {factions:{name:string, weights:{key:string, weight:number}[]}[]}>} weightJson
 *   workshop-weights.json 的 `weights` 段（system_data 的 weight_json，57 角色各一个「默认流派」）
 * @returns {Map<string, Map<string, number>>}  role_id → Map<副词条名, 权重>；无权重的角色不入表
 *   实测 key 覆盖率：攻击 55/57、穿透值 49/57、暴击 41、暴伤 41、精通 18、生命 7、防御 1
 *   —— 缺 key 即该角色不吃这条属性，正是「按角色区分有效词条」所需的信号。
 *   ⚠️ 权重表不区分百分比与固定值（攻击力% 与 攻击力 共用 key「攻击」），加权分沿用工坊原始口径。
 */
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

/**
 * 按驱动盘套装聚合工坊真实配装（workshop.json entries 的单盘级统计）。
 *
 * @param {object[]} entries  workshop.json 的 entries（[{uid, role_id, weapon, equips:[...]}]）
 * @param {object} discIndex  buildNameIndex(library.discs, CATEGORY.DISC) 的产物（或测试 fixture）
 * @param {{roleNameMap?:Map<string,string>}} [opts]  roleNameMap：role_id 字符串 → 角色规范名（未提供时 characters 落回 role_id）
 * @returns {{name:string, equips:number, characters:string[],
 *            main456:{4:{name,count}[],5:{name,count}[],6:{name,count}[]},
 *            mainDenom:{4:number,5:number,6:number}, subs:{name,count}[],
 *            effDist:Object<string,number>, subCombos:{combo:string[],count:number}[],
 *            mainSubCross:{4:{主词条:{副词条:count}},5:{},6:{}}}[]}
 *   name：library 规范盘名；equips：物理盘数（每块盘计一次，不做条目内去重）；
 *   characters：使用角色（去重）；main456：主词条分布（两源同构，已套 mainStatName 兜底）；
 *   mainDenom：每槽盘数（主词条 ratio 分母）；
 *   subs：合法副词条全量（已按 SUBSTAT_TYPE_SET 白名单过滤非法词条；含对角色无效但类型合法的词条，统一名）。
 *   effDist：**有效强化次数**分布（0-9，非旧的「有效词条个数」）——每块盘落在「佩戴角色有效副词条集合」
 *   上的强化次数之和；有效集合由 opts.weightJson/roleWeights 给出，缺失时退化为「全部合法副词条」。
 *   slotDist：{1..6:盘数} 该套装的槽位分布（D7 套装×槽位交叉）。
 *   仅含工坊中出现的盘；未解析到 library 的套装 / '其他' 跳过。
 */
export function computeWorkshopDiscStats(entries, discIndex, opts = {}) {
  return runAcc(makeWorkshopDiscStatsAcc(discIndex, opts), entries);
}

/** computeWorkshopDiscStats 的累加器（add 为原循环体、finish 为原收尾） */
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
            effDist: new Map(), // 有效强化次数(0-9) → 盘数
            slotDist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, // D7 套装×槽位：该套装各槽位盘数
            combos: new Map(), // 副词条组合 key → 盘数
            mainSub: { 4: new Map(), 5: new Map(), 6: new Map() }, // 槽 → 主词条 → Map<副词条,次数>
          })
        );
      a.equips += 1;
      a.chars.add(roleName);
      const slot = slotOf(eq);
      if (slot >= 1 && slot <= 6) a.slotDist[slot] += 1; // D7 套装×槽位交叉
      // 词条名清洗：丢弃含 U+FFFD 的坏名（工坊源头数据的属性名被替换符污染，如「生命值百分���」，
      // 无法归一且会污染图表显示——过滤后这些词的样本少量损失，换来 stats 干净）
      const cleanName = (n) => (n && !n.includes('\uFFFD') ? n : null);
      // 两源同构：subs=全部副词条（含无效词条）、main[0]=主词条
      // 游戏规则白名单清洗：副词条只保留合法副词条（SUBSTAT_TYPE_SET：攻击/生命/防御 固定+%、
      // 暴击率/暴伤/穿透值/异常精通）——工坊 2025 源偶发异常词条（穿透率/冲击力/异常掌控百分比等，
      // 实测 180/605k 件），不合法则丢弃，避免脏词条进入分布。
      // rolls 同时还原（强化次数，见 substatRolls）：effDist 由「词条个数」改为「有效强化次数」口径
      const subPairs = (eq.subs || [])
        .map((s) => {
          const n = s && s.name ? cleanName(discStatName(s.name, s.value)) : null;
          return n && SUBSTAT_TYPE_SET.has(n) ? { name: n, rolls: substatRolls(n, s.value) } : null;
        })
        .filter(Boolean);
      const subNames = subPairs.map((s) => s.name);
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
      // 有效强化次数分布 + 副词条组合（原地排序序列化去重；effRolls/comboKey 各算一次）
      let effRolls = 0;
      for (const s of subPairs) if (!effW || effW.has(s.name)) effRolls += s.rolls;
      a.effDist.set(effRolls, (a.effDist.get(effRolls) || 0) + 1);
      if (subNames.length) {
        subNames.sort();
        const comboKey = JSON.stringify(subNames);
        a.combos.set(comboKey, (a.combos.get(comboKey) || 0) + 1);
      }
      // 副词条频率（跨槽聚合）
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
// 前端拿不到逐条 panel（workshop.json 2.13GB 不下发），散点必须在聚合时降采样为 2D 密度网格。
// 网格内 x/y 均为各自 min-max 归一到 [0,1]（攻击与双暴量纲不同，归一后才同轴可比），
// 原始范围存 xMin/xMax/yMin/yMax 供前端 tooltip 反算实际值。

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

/**
 * 每角色 / 全体 的面板属性对 2D 密度网格（供密度散点图）。
 * @param {object[]} entries  workshop.json 的 entries（panel 为 [{name, base, add, final}]）
 * @param {string[][]} [pairs]  属性对（默认 暴击率×暴击伤害、攻击力×暴击伤害；攻击将按粒度 min-max 归一）
 * @returns {{perRole:Object<string,Object<string,Grid>>, global:Object<string,Grid>}}
 *   Grid = {xName,yName,xMin,xMax,yMin,yMax,N,data:[[xi,yi,count]]}
 *   perRole 按 role_id；攻击归一范围随粒度（该角色 / 全体）。
 */
/** 散点默认属性对（暴击率×暴伤、攻击×暴伤） */
const SCATTER_PAIRS = [
  ['暴击率', '暴击伤害'],
  ['攻击力', '暴击伤害'],
];

/** 散点收尾：配对样本 → 2D 密度网格（perRole/global 两粒度，攻击归一范围随粒度） */
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

export function computePanelScatter(entries, pairs) {
  const { perRole, global } = collectPanelPairs(entries, pairs || SCATTER_PAIRS);
  return finishPanelScatter(perRole, global);
}

// ================= 练度指标聚合（全服总览 / 角色画像） =================

/** 轻量分布（无直方图/箱线，供 rankLayers/skillStats 防 stats 膨胀）：count/min/max/mean/median/p10/p90。
 *  分位数统一走 quantileSorted（线性插值）——此前用最近秩 `s[floor(p*n)]`，
 *  与 computeDist 的定义不一致，同一份 workshop-stats.json 里 median 有两种含义。 */
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

/** 每角色工坊装配评分（relic_point）分布（computeDist 全量，含 hist）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, relic_point}）
 *  @returns {Object<string, Dist>}  role_id → 评分分布；0/非法评分排除（0 = 未带驱动盘/2025 源缺失） */
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

/** 每角色影画档位（rank 0-6）占比：供影画金字塔。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, rank}）
 *  @returns {Object<string, {0:number,...,6:number}>} role_id → 各档条目数 */
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
 *  workshop.json 的 v3 响应含每 uid 的**全部**角色，故「拥有」= uid 集合包含该角色。
 *  @returns {{ pool:number, roles:Object<string, number> }} pool=池 uid 总数，roles=role_id → 拥有率 */
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

/** 每角色 × 技能类型（canonical 编号，见 constants.SKILL_TYPES）的等级分布（轻量分位 + 逐等级计数 dist，供技能分布柱状图）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, source, skills:[{type,level}]}）
 *  @returns {Object<string, Object<string, LightDist & {dist:Object<number,number>}>>} role_id → 技能类型 → 分布
 *  工坊两源 type 语义不同，聚合前按源归一化为 canonical：mys 源（官方语义）用 OFFICIAL_SKILL_TYPE；
 *  2025 源（1.x ID 语义）用 WS2025_SKILL_TYPE（连携/终结并入 canonical 4）。
 *  源判别：优先读条目 `source` 字段（extractBuild 写时固化）；旧数据（无 source）先看 equips[].rarity
 *  的**类型**（mys 写字符串 "S"、2025 写数字 4），再兜底 skills 数组顺序。 */
export function computeSkillStats(entries) {
  return runAcc(makeSkillStatsAcc(), entries);
}

/** equips[].rarity 的**类型**判源：string（"S"）→ mys、number（4）→ 2025；无 rarity 返回 null。
 *  这是结构性差异而非取值差异——extractBuild 的 mys 分支透传工坊格式化后的等级字母，2025 分支透传
 *  游戏原始数值。实测 20 万条目：rarity 形态与 subs[].value 形态（mys 字符串 "7.2%" / 2025 数字 720）
 *  100% 同构、零交叉，且可判率 100%。 */
function is2025ByRarity(e) {
  for (const eq of e.equips || []) {
    if (!eq || eq.rarity == null) continue;
    return typeof eq.rarity === 'number';
  }
  return null;
}

/** 工坊两源判别（'mys' / '2025' / null）：source 字段 → rarity 类型 → skills 数组顺序，逐级兜底。
 *  技能语义归一（skillTypeMapOf）与两源一致性审计（computeSourceAudit）共用同一判别，口径必须一致。 */
export function sourceOf(e) {
  if (!e) return null;
  if (e.source === 'mys' || e.source === '2025') return e.source;
  // 旧数据（无 source，实测 15 万采样中 100% 都是）：rarity 类型是最可靠的替代信号
  const byRar = is2025ByRarity(e);
  if (byRar != null) return byRar ? '2025' : 'mys';
  // 末位兜底：连 rarity 都没有时才回退数组顺序（mys 按 UI 顺序第 2 位=2、2025 按 ID 顺序=1）。
  // 该启发式与 rarity 判别在 20 万样本中分歧 160 条（0.080%），分歧样本全部是 rarity 全 "S"（mys）
  // 但 skills 恰好呈 ID 升序 [0,1,2,3,5,6] —— 即数组顺序法误判（会把 1↔2、终结/支援全部错位），
  // 故降为最后兜底而非主路径。
  if (e.skills?.length >= 2) return e.skills[1].type !== 2 ? '2025' : 'mys';
  return null; // 三种信号都拿不到：无法判源
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

/** 每角色驱动盘画像：456 主词条分布 / 副词条频率 / 有效强化次数分布（与 computeWorkshopDiscStats 同口径，按角色聚合）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, equips}）
 *  @param {object} discIndex  buildNameIndex(library.discs, CATEGORY.DISC)
 *  @param {{roleNameMap?:Map<string,string>, weightJson?:object, roleWeights?:Map}} [opts]
 *  @returns {{name:string, main456:{4,5,6:{name,count}[]}, mainDenom:{4,5,6}, subs:{name,count}[], effDist:Object}[]} */
export function computeRoleDiscStats(entries, discIndex, opts = {}) {
  return runAcc(makeRoleDiscStatsAcc(opts), entries);
}

/** computeRoleDiscStats 的累加器（add 为原循环体、finish 为原收尾）。
 *  不收 discIndex：本聚合按角色分组、不解析套装名（公开函数的 discIndex 形参是历史签名，一直未被使用）。 */
function makeRoleDiscStatsAcc(opts = {}) {
  const roleNameMap = opts.roleNameMap || null;
  const roleWeights = resolveRoleWeights(opts);
  const acc = new Map(); // 角色名 -> 聚合
  const add = (e) => {
    if (!e || e.role_id == null) return;
    const roleName = roleNameMap ? roleNameMap.get(String(e.role_id)) : String(e.role_id);
    if (roleName == null) return;
    const effW = roleWeights.get(String(e.role_id)) || null; // 该角色有效副词条集合；无权重则退化为全部合法副词条
    let a = acc.get(roleName);
    if (!a)
      acc.set(
        roleName,
        (a = {
          main456: { 4: new Map(), 5: new Map(), 6: new Map() },
          mainDenom: { 4: 0, 5: 0, 6: 0 },
          subs: new Map(),
          effDist: new Map(),
        })
      );
    for (const eq of e.equips || []) {
      if (!eq || !eq.suit) continue;
      const slot = slotOf(eq);
      // 词条名清洗：丢弃含 U+FFFD 的坏名（同 computeWorkshopDiscStats 口径）；
      // 副词条只保留合法副词条（SUBSTAT_TYPE_SET），主词条仅统计槽候选内（MAIN_STAT_OPTIONS）——游戏规则白名单
      const cleanName = (n) => (n && !n.includes('\uFFFD') ? n : null);
      const subPairs = (eq.subs || [])
        .map((s) => {
          const n = s && s.name ? cleanName(discStatName(s.name, s.value)) : null;
          return n && SUBSTAT_TYPE_SET.has(n) ? { name: n, rolls: substatRolls(n, s.value) } : null;
        })
        .filter(Boolean);
      const subNames = subPairs.map((s) => s.name);
      const main = Array.isArray(eq.main) && eq.main[0];
      const mn = main && main.name ? cleanName(mainStatName(discStatName(main.name, main.value))) : null;
      const mnOk = mn && (MAIN_STAT_OPTIONS[slot] || []).includes(mn);
      if (slot >= 4 && slot <= 6) {
        a.mainDenom[slot]++;
        if (mnOk) a.main456[slot].set(mn, (a.main456[slot].get(mn) || 0) + 1);
      }
      let effRolls = 0; // 有效强化次数（口径同 computeWorkshopDiscStats）
      for (const s of subPairs) if (!effW || effW.has(s.name)) effRolls += s.rolls;
      a.effDist.set(effRolls, (a.effDist.get(effRolls) || 0) + 1);
      for (const n of subNames) a.subs.set(n, (a.subs.get(n) || 0) + 1);
    }
  };
  const finish = () =>
    [...acc.entries()].map(([name, a]) => ({
      name,
      main456: { 4: freqPairs(a.main456[4]), 5: freqPairs(a.main456[5]), 6: freqPairs(a.main456[6]) },
      mainDenom: a.mainDenom,
      subs: freqPairs(a.subs),
      effDist: Object.fromEntries(a.effDist),
    }));
  return { add, finish };
}

// ---------- 加权词条效率分（强化次数 × 工坊角色流派权重） ----------
// workshop-weights.json 落盘后一直没有任何消费方。它是工坊官方给每个角色的默认流派属性权重（0.2-1），
// 与还原出的强化次数相乘即得「加权词条效率分」——比 relic_point 更透明（公式公开、前端可用同一张
// weights 表对「我的盘」复算），能直接回答「我在这个角色的玩家池里排第几、是哪个槽位拖后腿」。
// 口径：权重表不区分百分比/固定值（攻击力% 与 攻击力 共用 key「攻击」），此处沿用工坊原始口径不折算。

/** 每角色「加权词条效率分」分布（按条目 = 一整套驱动盘聚合）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, equips}）
 *  @param {{weightJson?:object, roleWeights?:Map}} [opts]  工坊权重；缺失时返回空对象（本聚合整体跳过）
 *  @returns {Object<string, {weights:Object<string,number>, score:Dist, effRolls:Dist,
 *            slotEff:Object<string,{count:number,mean:number}>,
 *            scoreVsRelic:{n:number, r:number}|null}>}  role_id → 统计
 *    weights：该角色有效副词条→权重（前端复算「我的分」用同一张表，保证口径一致）；
 *    score：加权分分布；effRolls：整套有效强化次数分布；slotEff：每槽有效强化次数均值（找短板槽）；
 *    scoreVsRelic：D9「工坊评分 × 盘毕业度」皮尔逊相关（同条目配对，relic_point 缺失/为 0 不配对）。 */
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

// ---------- D10 两源一致性审计（mys 现成面板 vs 2025 公式复算面板） ----------
// workshop.json 的面板有两个来源：mys 源直接透传工坊格式化好的数值；2025 源是我们在 src/sync/workshop.js
// 里复现工坊 enka_attrs_mapping 公式**算出来的**（角色基础 + 武器 + 驱动盘 + 2 件套）。公式一旦因游戏版本
// 更新而失准，2025 源的面板会静默漂移，而所有跨源聚合（panels/panelCorr/panelScatter）都会被污染且无人察觉。
// 本审计按「同角色、同属性」对比两源的样本量与均值：同一个高练度玩家池里，两源应当统计同分布，
// 相对差长期应在个位数百分比内；若某属性 |diff| 明显偏大，就是公式该重新对齐的信号。

/** 参与两源审计的属性（覆盖基础三围 + 双暴 + 异常，公式各分支都能照到） */
const AUDIT_ATTRS = ['攻击力', '生命值', '防御力', '暴击率', '暴击伤害', '异常精通'];

/** 两源面板一致性审计。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, source, equips, panel}）
 *  @returns {Object<string, {counts:{mys:number,'2025':number},
 *            attrs:Object<string,{mys:number|null,'2025':number|null,diff:number|null}>}>}
 *    role_id → 两源样本量与各属性均值；diff = (2025 − mys) / |mys|，任一源样本 <30 时该属性 diff 记 null。 */
export function computeSourceAudit(entries) {
  return runAcc(makeSourceAuditAcc(), entries);
}

function makeSourceAuditAcc() {
  const acc = new Map(); // rid -> {counts:{mys,2025}, sums:Map<attr, {mys:{n,sum}, 2025:{n,sum}}>}
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const src = sourceOf(e);
      if (!src) return;
      let a = acc.get(e.role_id);
      if (!a) acc.set(e.role_id, (a = { counts: { mys: 0, 2025: 0 }, sums: new Map() }));
      a.counts[src] += 1;
      for (const p of e.panel || []) {
        if (!AUDIT_ATTRS.includes(p.name)) continue;
        const v = parsePanelFinal(p.final);
        if (v == null) continue;
        let t = a.sums.get(p.name);
        if (!t) a.sums.set(p.name, (t = { mys: { n: 0, sum: 0 }, 2025: { n: 0, sum: 0 } }));
        t[src].n += 1;
        t[src].sum += v;
      }
    },
    finish() {
      const out = {};
      for (const [rid, a] of acc) {
        const attrs = {};
        for (const [name, t] of a.sums) {
          const mMean = t.mys.n ? t.mys.sum / t.mys.n : null;
          const wMean = t['2025'].n ? t['2025'].sum / t['2025'].n : null;
          // 小样本的均值噪声会淹没真实漂移，故两源各需 ≥30 才给 diff（否则只留均值供人工看）
          const ok = t.mys.n >= 30 && t['2025'].n >= 30 && mMean !== 0;
          attrs[name] = { mys: mMean, 2025: wMean, diff: ok ? (wMean - mMean) / Math.abs(mMean) : null };
        }
        out[rid] = { counts: a.counts, attrs };
      }
      return out;
    },
  };
}

// ---------- 2026-10 新增聚合：配队亲和 / 影画×评分 / 技能组合 ----------

/** 每角色「同 uid 玩家同练角色」共现（真实配队亲和性）：角色 A → 队友 B 出现次数降序。
 *  @param {object[]} entries  workshop.json 的 entries（{uid, role_id}）
 *  @returns {Object<string, [string, number][]>}  role_id → [[队友 role_id, 共现次数], ...]（按次数降序） */
export function computeRoleCooccurrence(entries) {
  return runAcc(makeRoleCooccurrenceAcc(), entries);
}

/** 共现累加器：add 只做「uid → 角色集合」收集，配对全在 finish（原实现也是两段式，顺序天然一致）。
 *  注意内存：这是唯一一个必须驻留「全体 uid × 角色集合」的聚合，与合并遍历无关（原本也如此）。 */
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
// 样本池是排行榜上榜 uid（高练度标杆池），音擎 60 级与驱动盘满级是入场券而非差异点，
// 57 个角色的 w60 与 discMax **无一例外全为 1.0000**；relicTop「评分 ≥ 该角色 P75 的占比」
// 更是定义上的恒等式，实测 57 个角色全部落在 0.2500-0.2517。三列都测不出任何东西，
// 连同前端「完成度矩阵」卡一并删除。若将来要做完成度，须选在精英池里真有方差的维度
// （影画档位 rankDist / 是否专武 / 6 号位主词条是否踩中主流）。

/** 每角色 × 影画档（rank 0-6）的装配评分分布（轻量 count/mean/median，无 hist）。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, rank, relic_point}）
 *  @returns {Object<string, Object<string, {count:number, mean:number, median:number}>>} role_id → rank → 评分统计 */
export function computeRankRelic(entries) {
  return runAcc(makeRankRelicAcc(), entries);
}

function makeRankRelicAcc() {
  const acc = new Map(); // rid -> Map(rank -> number[])
  return {
    add(e) {
      if (!e || e.role_id == null || e.rank == null) return;
      const rp = Number(e.relic_point);
      if (!Number.isFinite(rp) || rp <= 0) return;
      let m = acc.get(e.role_id);
      if (!m) acc.set(e.role_id, (m = new Map()));
      if (!m.has(e.rank)) m.set(e.rank, []);
      m.get(e.rank).push(rp);
    },
    finish() {
      const out = {};
      for (const [rid, m] of acc) {
        out[rid] = {};
        for (const [rank, vals] of m) {
          vals.sort((x, y) => x - y); // 就地排序 + quantileSorted，避免 quantile 内部再复制排序一次
          out[rid][rank] = {
            count: vals.length,
            mean: +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1),
            median: quantileSorted(vals, 0.5),
          };
        }
      }
      return out;
    },
  };
}

/** 每角色技能组合模式：按源归一 canonical 后统计「哪些技能拉满」的组合 Top + 全拉满率。
 *  拉满定义：普攻/闪避/支援/特殊/终结 ≥12 级，核心 =7 级。
 *  @param {object[]} entries  workshop.json 的 entries（{role_id, source, skills:[{type,level}]}）
 *  @returns {Object<string, {count:number, fullPct:number, top:{pattern:string, count:number}[]}>}
 *  源判别与 computeSkillStats 相同（source 字段 → rarity 类型 → skills 顺序，见 sourceOf）。 */
export function computeSkillComboStats(entries) {
  return runAcc(makeSkillComboStatsAcc(), entries);
}

function makeSkillComboStatsAcc() {
  const FULL = { 0: 12, 1: 12, 2: 12, 3: 12, 4: 12, 5: 7 };
  const LABEL = ['普攻', '闪避', '支援', '特殊', '终结', '核心'];
  const acc = new Map(); // rid -> {n, full, combos: Map(pattern -> count)}
  return {
    add(e) {
      if (!e || e.role_id == null) return;
      const map = skillTypeMapOf(e);
      if (!map) return; // 无 source 且数组不足 2 个：无法判源，不贡献
      const levels = {};
      for (const s of e.skills || []) {
        if (s.type == null || s.level == null) continue;
        const t = map[s.type] ?? s.type;
        if (FULL[t] != null) levels[t] = s.level;
      }
      if (!Object.keys(levels).length) return;
      // 全拉满 = 条目包含的所有技能都达阈值（真实数据 6 技能齐全时即全部拉满）
      const allFull = Object.keys(levels).every((t) => levels[t] >= FULL[t]);
      const names = Object.keys(levels)
        .filter((t) => levels[t] >= FULL[t])
        .map((t) => LABEL[t])
        .join('+');
      const pattern = allFull ? '全拉满' : names || '无满级';
      let a = acc.get(e.role_id);
      if (!a) acc.set(e.role_id, (a = { n: 0, full: 0, combos: new Map() }));
      a.n++;
      if (allFull) a.full++;
      a.combos.set(pattern, (a.combos.get(pattern) || 0) + 1);
    },
    finish() {
      const out = {};
      for (const [rid, a] of acc) {
        out[rid] = {
          count: a.n,
          fullPct: +(a.full / a.n).toFixed(4),
          top: [...a.combos.entries()]
            .sort((x, y) => y[1] - x[1])
            .slice(0, 5)
            .map(([pattern, count]) => ({ pattern, count })),
        };
      }
      return out;
    },
  };
}

// ---------- 单遍历总入口（2026-08 性能重构） ----------

/**
 * 一次遍历 entries 完成全部 14 项聚合（原 buildWorkshopStats 逐个调用 = 逐项全量流式解析 2.13GB）。
 * 每个 key 的值与对应公开函数**逐位相同**（累加顺序、Map 插入顺序完全一致，见文件顶部累加器说明）。
 * @param {Iterable<object>} entries  workshop.json 的 entries（可为 generator，仅消费一次）
 * @param {object} discIndex  buildNameIndex(library.discs, CATEGORY.DISC)
 * @param {{roleNameMap?:Map<string,string>, weightJson?:object, roleWeights?:Map}} [opts]
 *   weightJson：工坊角色流派权重（workshop-weights.json 的 weights 段）。驱动盘 effDist 的「有效副词条」
 *   与 rollEfficiency 都依赖它；缺失时 effDist 退化为「全部合法副词条」、rollEfficiency 返回空对象。
 * @returns {{stats, panelCorr, discDetails, panelScatter, relicStats, rankLayers, rankDist,
 *            skillStats, roleDiscStats, roleCooccurrence, rankRelic, skillCombos,
 *            rollEfficiency, sourceAudit}}
 */
// ---------- 角色流派分析（2026-10 新增） ----------
// 流派 = 玩家在面板上的配置取向分化：同一角色的面板资源零和，玩家在「堆攻击 / 堆双暴 / 堆精通」等
// 取向间分化，k-means 把这些取向聚成簇（每簇 = 一个流派）。
// ⚠️ 聚类属性必须按角色定位（trait）选：输出看 攻击/双暴/属性伤害、击破核心是**冲击力**、
//    异常核心是**精通/掌控**、命破/防护核心是**生命/防御**、支援只有 攻击/生命——固定 6 维会让
//    击破/异常角色的核心维度缺失、支援角色把无关维度（双暴）当判别信号。
//    故：候选池按 trait 选 → 样本过滤 → **数据驱动去噪**（归一化 sd 过低的列 = 玩家无分化 =
//    无流派判别力，剔除；至少保留 3 维）。
// 试验验证（排行榜全量 uid 池）：星见雅/艾莲 k=3 出「暴伤/暴击率/攻击」三流、苍角出「精通异常/双暴/
// 攻击」三流，4 号位主词条是强判别信号（簇内 Top1 占比 >50%）；k=4 出现噪声簇，故固定 k=3。
// 输出体积受控：每簇只存 share/label/面板 mean+median/456 主词条 Top2/套装 Top2/音擎 Top2。
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

/** 流派聚类累加器（挂进 computeAllWorkshopStats 单遍历；见文件头累加器约定）。
 *  @param {Object<string,string>} [traits]  role_id → 定位（强攻/击破/异常/命破/防护/支援）；缺省回退通用属性池 */
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
          // ⚠️ 必须索引 valid 而非 o.samples：idx 来自 assign/P，二者都以过滤后的 valid 为基准。
          // 索引 o.samples 会让「首个被过滤样本」之后的全部样本整体错位一格（实测 23/57 角色
          // 有样本被过滤，最坏一例污染该角色 92.8% 的归属，且 label 由 main4[0] 推出 → 簇名也错）。
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

/** 角色流派分析（独立入口，测试用；buildWorkshopStats 走 computeAllWorkshopStats 单遍历）。
 *  @param {Object} [opts]  {traits: {role_id → 定位}} */
export function computeRoleStyles(entries, opts = {}) {
  const acc = makeRoleStylesAcc(opts.traits);
  for (const e of entries || []) acc.add(e);
  return acc.finish();
}

export function computeAllWorkshopStats(entries, discIndex, opts = {}) {
  // 相关性与散点属性对不同（7 对 vs 2 对），各建一个采集器：合并成 9 对会改 key 插入顺序（见 makePanelPairsAcc 注释）
  const corrAcc = makePanelPairsAcc(CORR_PAIRS);
  const scatterAcc = makePanelPairsAcc(SCATTER_PAIRS);
  const wsAcc = makeWorkshopStatsAcc();
  // 权重表只解析一次，两个盘聚合与效率分共用（纯查表，不影响任何 Map 插入顺序）
  const accOpts = { ...opts, roleWeights: resolveRoleWeights(opts) };
  const discAcc = makeWorkshopDiscStatsAcc(discIndex, accOpts);
  const relicAcc = makeRelicStatsAcc();
  const rankDistAcc = makeRankDistAcc();
  const skillAcc = makeSkillStatsAcc();
  const roleDiscAcc = makeRoleDiscStatsAcc(accOpts);
  const coAcc = makeRoleCooccurrenceAcc();
  const rankRelicAcc = makeRankRelicAcc();
  const comboAcc = makeSkillComboStatsAcc();
  const rollEffAcc = makeRollEfficiencyAcc(accOpts);
  const auditAcc = makeSourceAuditAcc();
  const styleAcc = makeRoleStylesAcc(opts.traits);
  const ownAcc = makeRoleOwnershipAcc();

  // 唯一一次遍历：每条目喂给全部累加器。add 之间互不共享中间态，故顺序无副作用
  for (const e of entries || []) {
    wsAcc.add(e);
    corrAcc.add(e);
    discAcc.add(e);
    scatterAcc.add(e);
    relicAcc.add(e);
    rankDistAcc.add(e);
    skillAcc.add(e);
    roleDiscAcc.add(e);
    coAcc.add(e);
    rankRelicAcc.add(e);
    comboAcc.add(e);
    rollEffAcc.add(e);
    auditAcc.add(e);
    styleAcc.add(e);
    ownAcc.add(e);
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
    roleDiscStats: roleDiscAcc.finish(),
    roleCooccurrence: coAcc.finish(),
    rankRelic: rankRelicAcc.finish(),
    skillCombos: comboAcc.finish(),
    rollEfficiency: rollEffAcc.finish(),
    sourceAudit: auditAcc.finish(),
    roleStyles: styleAcc.finish(),
    roleOwnership: ownAcc.finish(),
  };
}
