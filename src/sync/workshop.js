// src/sync/workshop.js —— 爬取「绝区零工坊」全角色驱动排名 + 玩家完整配装
// 数据源：api.zzzmap.com（逆向自 wxapkg，签名=MD5(key+参数排序)，无需 token）
// 用法：
//   node src/sync/workshop.js                    # 全量 57 角色 × 7 影画 × 每影画 300 条（榜单全量）
//   node src/sync/workshop.js 3                  # 只爬前 3 个角色（试跑）
//   node src/sync/workshop.js 57 300 8           # 第 4 参 = v3 配装并发（默认 6，调高加速但注意限流）
// 排名收集：角色级并发 + 每角色 7 影画组内并行翻页（实测 6.4× 提速）。
// 输出：data/workshop.json（配装条目）、data/workshop-stats.json（汇总，自动生成）
// 断点续爬：进度存 data/.workshop-progress.json
// 注：本文件整合了面板计算（原 workshop-panel.js）、汇总生成（原 workshop-stats.js）；
//     workshop-grad.js（全服统计）独立保留。提取兼容 mys 源（面板现成）与 2025 源（面板按公式计算）。
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { computeWorkshopStats, computePanelCorrelations, computeWorkshopDiscStats, computePanelScatter } from '../lib/workshopStats.js';
import { orderComboSets4First } from '../lib/plansStats.js';
import { romanNumeralUnicode, normalizeStatKey } from '../lib/util.js';
import { buildNameIndex, resolveEntry, canonicalName, CATEGORY } from '../lib/names.js';
import { streamJsonArrayElements, ROOT, DATA_DIR, isMain, pool } from '../lib/node.js';

const OUT_FILE = path.join(DATA_DIR, 'workshop.json');
const STATS_FILE = path.join(DATA_DIR, 'workshop-stats.json');
const ABYSS_FILE = path.join(DATA_DIR, 'workshop-abyss.json'); // uid 级深渊战绩（裁剪后；前端不加载，聚合层消费）
const WEIGHTS_FILE = path.join(DATA_DIR, 'workshop-weights.json'); // 角色默认流派权重（工坊有效词条口径）
const PROGRESS_FILE = path.join(DATA_DIR, '.workshop-progress.json');
// 逆向提取的静态数据表（合并文件）：装备 / 角色基础 / 套装 / 武器
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/sync', 'workshop-static.json'), 'utf8'));
const items = S.items; // 装备 Id → {Rarity, SuitId}
const rolebase = S.rolebase; // 角色 Id → {BaseProps, GrowthProps, PromotionProps, CoreEnhancementProps}
const suits = S.suits; // 套装 Id → {SetBonusProps}
const weapons = S.weapons; // 武器 Id → {MainStat, SecondaryStat}
const GRAD_FILE = path.join(DATA_DIR, 'workshop-grad.json');
// 名称索引（统一 resolver，library.json 为权威源）：工坊 nick_name 的 ASCII 罗马数字/括号差异、角色简称
// （维琳娜/星徽·比利）等一律在写时解析回 wiki 标准名，保证三个工坊数据文件与 library/plans 一致。
// library.json 缺失/损坏时降级为空索引（名称归一退化为原样，不崩——与 plans/characters 一致，测试可直接 import 本模块）
let libChars = buildNameIndex({}, CATEGORY.CHAR);
let libWengines = buildNameIndex({}, CATEGORY.WENGINE);
let libDiscs = buildNameIndex({}, CATEGORY.DISC);
try {
  const libraryJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'library.json'), 'utf8'));
  libChars = buildNameIndex(libraryJson.characters || {}, CATEGORY.CHAR);
  libWengines = buildNameIndex(libraryJson.wengines || {}, CATEGORY.WENGINE);
  libDiscs = buildNameIndex(libraryJson.discs || {}, CATEGORY.DISC);
} catch {
  console.warn('⚠️ library.json 缺失/损坏，工坊名称归一降级（建议先 npm run sync:library）');
}
/** 工坊音擎 nick_name → wiki 规范音擎条目（统一 resolver；找不到返回 null） */
function resolveWengine(rawName) {
  return resolveEntry(CATEGORY.WENGINE, libWengines, rawName);
}

// ---------- 签名协议（逆向自工坊 wxapkg） ----------
const KEY = 'VW^)(^*^$$#*%(#)!@VIAI%';
const BASE = 'https://api.zzzmap.com';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function makeSign(data) {
  const params = { key: KEY, ...data };
  const str = Object.entries(params)
    .map(([k, v]) => `${k}=${v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('&')
    .split('&')
    .sort()
    .join('&');
  return md5(str);
}
function filterParams(data) {
  const o = {};
  for (const [k, v] of Object.entries(data || {})) if (v != null) o[k] = v;
  return o;
}
async function apiGet(path, data) {
  const d = filterParams(data);
  const time = Date.now();
  const qs = new URLSearchParams(d).toString();
  const res = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, {
    headers: {
      'content-type': 'application/json',
      version: '100',
      platform: 'weixin',
      sign: makeSign(d),
      time: String(time),
    },
  });
  return res.json();
}
async function apiPost(path, data) {
  const d = filterParams(data);
  const time = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      version: '100',
      platform: 'weixin',
      sign: makeSign(d),
      time: String(time),
    },
    body: JSON.stringify(d),
  });
  return res.json();
}

// 供 workshop-grad.js（全服统计）复用
export { apiGet, apiPost, filterParams, makeSign };

// ---------- 参数 ----------
const MAX_ROLES = Number(process.argv[2] || 57); // 爬几个角色（全量模式）
// 每影画拉多少条：实测每角色×影画档的排行榜上限 ≈298 去重 uid（offset≥300 返回空），
// 故默认 300 = 榜单全量（旧默认 100 只拿 1/3）；排名无 total 字段，无法预知精确上限。
// 扩大 uid 集合的其他路径均已实测无效：weapon_id/part_index 为榜单子集/被忽略，
// type 变体（weapon/relic/player/all）返回空；uid 自增扫描不可行（uid 空间 10^7~1.5×10^9，
// 无效 uid 也返回 code:0 data:null 需完整请求才能判定，命中率极低且易触发风控）。
const PER_RANK = Number(process.argv[3] || 300); // 每影画拉多少条（默认 300 = 榜单全量）
// v3 配装请求并发（默认 6）：排名收集阶段每个角色 7 影画组内并行，不占此并发；
// 调高可加速配装爬取（响应大、吃带宽，注意工坊 API 限流，默认 6 稳妥）
const CONCURRENCY = Number(process.argv[4] || 6);

// ---------- 进度（断点续爬：缓存已爬 uid + 已提取的配装条目） ----------
// 防 import 本模块时 OOM：进度文件过大（异常/旧口径遗留）时不读取，忽略断点；改爬取口径后旧进度本就作废，应全量重爬
let progress = { cachedUids: {}, entries: [] };
// workshop.json 不存在（数据已清空/首次爬取）时进度作废：cachedUids 若沿用会导致所有 uid 被跳过而空爬
if (fs.existsSync(OUT_FILE) && fs.existsSync(PROGRESS_FILE)) {
  try {
    const size = fs.statSync(PROGRESS_FILE).size;
    if (size > 200 * 1024 * 1024) {
      console.warn(`⚠️ 进度文件过大（${(size / 1e6).toFixed(0)}MB），已忽略断点，将全量重爬（可删除 data/.workshop-progress.json 避免干扰）`);
    } else {
      progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch {
    progress = { cachedUids: {}, entries: [] };
  }
}
const cachedUids = progress.cachedUids || {};

/** 分批写「对象头 + 大数组」为 JSON 文件：每次只 JSON.stringify 一批（防条目过多时一次性序列化
 *  超过 V8 字符串上限 Invalid string length）。prefix 形如 `{"cachedUids":{...},"entries":[`，函数补上分批数组与 `]}`。 */
function writeJsonArrayStream(file, prefix, arr, batchSize = 5000) {
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, prefix);
  for (let i = 0; i < arr.length; i += batchSize) {
    if (i > 0) fs.writeSync(fd, ',');
    // 去 [ ] 只留元素（逗号分隔），分批发序列化
    fs.writeSync(fd, JSON.stringify(arr.slice(i, i + batchSize)).slice(1, -1));
  }
  fs.writeSync(fd, ']}');
  fs.closeSync(fd);
}
// 进度只存 cachedUids（entries 可达数十万条，存它会撑爆 progress 文件 / 加载 / 序列化；
// 续爬时 entries 从已写好的 workshop.json 流式恢复，见 fetchWorkshopData）
const saveProgress = () => fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ cachedUids }));

// ---------- 属性映射（get_prop_desc：PropertyId → 属性名，逆向自工坊） ----------
const PROP_DESC = {
  11101: '生命值',
  11102: '生命值百分比',
  11103: '生命值',
  12101: '攻击力',
  12102: '攻击力百分比',
  12103: '攻击力',
  12201: '冲击力',
  12202: '冲击力百分比',
  13101: '防御力',
  13102: '防御力百分比',
  13103: '防御力',
  20101: '暴击率百分比',
  20103: '暴击率百分比',
  21101: '暴击伤害百分比',
  21103: '暴击伤害百分比',
  23101: '穿透率百分比',
  23103: '穿透率百分比',
  23201: '穿透值',
  23203: '穿透值',
  30501: '能量回复',
  30502: '能量回复百分比',
  30503: '能量回复',
  31201: '异常精通',
  31203: '异常精通',
  31401: '异常掌控',
  31402: '异常掌控百分比',
  31403: '异常掌控',
  31501: '物伤加成百分比',
  31503: '物伤加成百分比',
  31601: '火伤加成百分比',
  31603: '火伤加成百分比',
  31701: '冰伤加成百分比',
  31703: '冰伤加成百分比',
  31801: '电伤加成百分比',
  31803: '电伤加成百分比',
  31901: '以太加伤百分比',
  31903: '以太加伤百分比',
  32301: '风伤加成百分比',
  32303: '风伤加成百分比',
};
const propName = (id) => PROP_DESC[id] || `未知${id}`;

// ---------- 2025 源面板计算（复现工坊 enka_attrs_mapping，原 workshop-panel.js） ----------
/** 驱动盘主属性按稀有度的等级成长系数（工坊 relic_calculate） */
const RARITY_GROWTH = { 4: 0.2, 3: 0.25, 2: 0.3 };

/** 角色基础属性：BaseProps + GrowthProps×(等级-1)/10000 + 突破档 + 核心强化档 */
function calcBaseTotalValue(ij) {
  const stat = rolebase[String(ij.Id)];
  if (!stat) return {};
  const { BaseProps = {}, GrowthProps = {}, PromotionProps = [], CoreEnhancementProps = {} } = stat;
  const lvl = ij.Level,
    prom = ij.PromotionLevel,
    core = ij.CoreSkillEnhancement;
  const d = {};
  for (const u in BaseProps) {
    const p =
      (BaseProps[u] || 0) +
      ((GrowthProps[u] || 0) * (lvl - 1)) / 10000 +
      ((PromotionProps[prom - 1] && PromotionProps[prom - 1][u]) || 0) +
      ((CoreEnhancementProps[core] && CoreEnhancementProps[core][u]) || 0);
    d[u] = (d[u] || 0) + p;
  }
  return d;
}

/** 武器属性：MainStat×(1+0.1568×等级+0.8922×突破) + Secondary×(1+0.3×突破) */
function calcWeaponProperties(wpn) {
  if (!wpn) return {};
  const w = weapons[String(wpn.Id)];
  if (!w) return {};
  const s = {};
  if (w.MainStat)
    s[w.MainStat.PropertyId] =
      w.MainStat.PropertyValue * (1 + 0.1568166666666667 * wpn.Level + 0.8922 * wpn.BreakLevel);
  if (w.SecondaryStat) s[w.SecondaryStat.PropertyId] = w.SecondaryStat.PropertyValue * (1 + 0.3 * wpn.BreakLevel);
  return s;
}

/** 驱动盘主副词条属性：主属性按等级成长，副属性 ×词条等级 */
function relicCalc(equippedList) {
  const i = {};
  for (const slot of equippedList || []) {
    const eq = slot && slot.Equipment;
    if (!eq) continue;
    const item = items[String(eq.Id)];
    const growth = RARITY_GROWTH[item ? item.Rarity : 4] || 0.2;
    for (const m of eq.MainPropertyList || []) {
      i[m.PropertyId] = (i[m.PropertyId] || 0) + m.PropertyValue + m.PropertyValue * eq.Level * growth;
    }
    for (const m of eq.RandomPropertyList || []) {
      i[m.PropertyId] = (i[m.PropertyId] || 0) + m.PropertyValue * m.PropertyLevel;
    }
  }
  return i;
}

/** 套装加成：同套装 ≥2 件 → SetBonusProps（工坊只算 2 件套加成，4 件套为条件效果不计） */
function setBonusProps(equippedList) {
  const cnt = {};
  for (const slot of equippedList || []) {
    const item = slot && slot.Equipment && items[String(slot.Equipment.Id)];
    if (!item) continue;
    cnt[item.SuitId] = (cnt[item.SuitId] || 0) + 1;
  }
  const bonus = {};
  for (const [suitId, n] of Object.entries(cnt)) {
    if (n >= 2) {
      const st = suits[suitId];
      if (st && st.SetBonusProps) for (const k in st.SetBonusProps) bonus[k] = (bonus[k] || 0) + st.SetBonusProps[k];
    }
  }
  return bonus;
}

/** 百分比/固定值汇总：各属性 Final = 固定 + 基础×百分比/10000 + 固定（复现工坊 sumAttrFinalValue） */
function sumAttrFinalValue(e, o) {
  return {
    HpFinal: (e[11101] || 0) + (o.hpBase * (e[11102] || 0)) / 10000 + (e[11103] || 0),
    AtkFinal: (e[12101] || 0) + (o.atkBase * (e[12102] || 0)) / 10000 + (e[12103] || 0),
    DefFinal: (e[13101] || 0) + (o.defBase * (e[13102] || 0)) / 10000 + (e[13103] || 0),
    BreakStunFinal: (e[12201] || 0) + (o.breakStunBase * (e[12202] || 0)) / 10000,
    CritRateFinal: (e[20101] || 0) + (e[20103] || 0),
    CritDamageFinal: (e[21101] || 0) + (e[21103] || 0),
    PenetrationRateFinal: (e[23101] || 0) + (e[23103] || 0),
    PenetrationValueFinal: (e[23201] || 0) + (e[23203] || 0),
    EnergyRecoverFinal: (e[30501] || 0) + (o.energyBase * (e[30502] || 0)) / 10000 + (e[30503] || 0),
    AnomalyMasteryFinal: (e[31401] || 0) + (o.anomalyMasteryBase * (e[31402] || 0)) / 10000 + (e[31403] || 0),
    AnomalyProficiencyFinal: (e[31201] || 0) + (e[31203] || 0),
  };
}

/** 计算 2025 源玩家的面板（复现工坊 enka_attrs_mapping），返回与 mys 源 panel 一致的格式 */
function computeEnkaPanel(ij) {
  const base = calcBaseTotalValue(ij);
  const wpn = calcWeaponProperties(ij.Weapon);
  // 装备属性 = 驱动盘主/副词条 + 套装 2 件套加成（必须累加合并；对象展开会覆盖同键属性，如暴伤被套装覆盖丢失）
  const equip = {};
  for (const [k, v] of Object.entries(relicCalc(ij.EquippedList))) equip[k] = (equip[k] || 0) + v;
  for (const [k, v] of Object.entries(setBonusProps(ij.EquippedList))) equip[k] = (equip[k] || 0) + v;
  const o = {
    hpBase: base[11101] || 0,
    atkBase: (base[12101] || 0) + Math.floor(wpn[12101] || 0),
    defBase: base[13101] || 0,
    breakStunBase: base[12201] || 0,
    energyBase: base[30501] || 0,
    anomalyMasteryBase: base[31401] || 0,
  };
  const wpnNoAtk = { ...wpn };
  delete wpnNoAtk[12101]; // 武器主攻击已计入 atkBase
  const c = sumAttrFinalValue(wpnNoAtk, o); // 武器其他属性
  const l = sumAttrFinalValue(equip, o); // 装备属性

  const hpBase = Math.floor(base[11101] || 0);
  const atkBase = Math.floor(base[12101] || 0) + Math.floor(wpn[12101] || 0);
  const defBase = Math.floor(base[13101] || 0);
  const brkBase = Math.floor(base[12201] || 0);
  const panel = [
    {
      name: '生命值',
      base: String(hpBase),
      add: '',
      final: String(Math.round(hpBase + (c.HpFinal || 0) + (l.HpFinal || 0))),
    },
    {
      name: '攻击力',
      base: String(atkBase),
      add: '',
      final: String(Math.floor(atkBase + (c.AtkFinal || 0) + (l.AtkFinal || 0))),
    },
    {
      name: '防御力',
      base: String(defBase),
      add: '',
      final: String(Math.floor(defBase + (c.DefFinal || 0) + (l.DefFinal || 0))),
    },
    {
      name: '冲击力',
      base: String(brkBase),
      add: '',
      final: String(Math.floor(brkBase + (c.BreakStunFinal || 0) + (l.BreakStunFinal || 0))),
    },
    {
      name: '暴击率',
      base: '',
      add: '',
      final: String(
        Number((((base[20101] || 0) + (c.CritRateFinal || 0) + (l.CritRateFinal || 0)) / 10000).toFixed(3))
      ),
    },
    {
      name: '暴击伤害',
      base: '',
      add: '',
      final: String(
        Number((((base[21101] || 0) + (c.CritDamageFinal || 0) + (l.CritDamageFinal || 0)) / 10000).toFixed(3))
      ),
    },
    {
      name: '穿透率',
      base: '',
      add: '',
      final: String(
        Number(
          (((base[23101] || 0) + (c.PenetrationRateFinal || 0) + (l.PenetrationRateFinal || 0)) / 10000).toFixed(3)
        )
      ),
    },
    {
      name: '能量自动回复',
      base: '',
      add: '',
      final: String(
        Number((((base[30501] || 0) + (c.EnergyRecoverFinal || 0) + (l.EnergyRecoverFinal || 0)) / 100).toFixed(2))
      ),
    },
    {
      name: '异常精通',
      base: '',
      add: '',
      final: String(
        Math.floor((base[31201] || 0) + (c.AnomalyProficiencyFinal || 0) + (l.AnomalyProficiencyFinal || 0))
      ),
    },
    {
      name: '异常掌控',
      base: '',
      add: '',
      final: String(Math.floor((base[31401] || 0) + (c.AnomalyMasteryFinal || 0) + (l.AnomalyMasteryFinal || 0))),
    },
  ];
  return panel.filter((p) => p.final !== '0' && p.final !== '');
}

// ---------- 汇总生成（原 workshop-stats.js）：workshop.json → workshop-stats.json ----------
function buildWorkshopStats(roleNameMap, weightJson) {
  if (!fs.existsSync(OUT_FILE)) return null;
  // 流式读 entries：大文件（数十万条/数百 MB）一次 readFileSync 会超 V8 字符串上限 Invalid string length
  const entries = [];
  for (const raw of streamJsonArrayElements(OUT_FILE)) entries.push(JSON.parse(raw));
  const stats = computeWorkshopStats(entries);
  const panelCorr = computePanelCorrelations(entries); // 属性相关（按角色，同条目配对）
  const discDetails = computeWorkshopDiscStats(entries, libDiscs, { roleNameMap }); // 驱动盘单盘真实统计（供统计→驱动盘面板）
  const panelScatter = computePanelScatter(entries); // 面板属性对 2D 密度（暴击率×暴伤、攻击×暴伤，供密度散点图）
  const data = { meta: { scrapedAt: new Date().toISOString(), entries: entries.length }, ...stats, discDetails, panelCorr, panelScatter };
  // 工坊有效词条权重（system_data 的角色默认流派权重，供有效词条/评分口径复现；正常非空）
  if (weightJson && Object.keys(weightJson).length) data.weightJson = weightJson;
  fs.writeFileSync(STATS_FILE, JSON.stringify(data));
  return data;
}

// ---------- 全服配装统计（原 workshop-grad.js）：每角色最常用音擎 + 驱动盘套装 ----------
/** 解析驱动盘 set_info（"32800_4__33100_2" → 组合名），返回 {name, sets:[{set_id,num,name}]} 或 null */
function parseSetInfo(setInfo, artifacts) {
  if (setInfo === 'other') return { name: '其他', sets: [] };
  const parts = String(setInfo).split('__');
  const sets = [];
  for (const p of parts) {
    const [setId, num] = p.split('_');
    const a = artifacts.find((x) => x.set_id === setId);
    // 套装名解析为 wiki 标准盘名（工坊 artifacts 名可能带尾随空格/用词差异）
    const setName = a ? canonicalName(CATEGORY.DISC, libDiscs, a.name) || a.name : `套装${setId}`;
    sets.push({ set_id: setId, num: Number(num), name: setName });
  }
  // 文本顺序统一：4 件套在前、2 件套在后（与方案侧一致），避免同名组合因顺序不同造成显示/对比差异
  const { name, sets: orderedSets } = orderComboSets4First(sets);
  return { name, sets: orderedSets };
}

/** 爬取工坊全服配装统计并写入 data/workshop-grad.json。onProgress({step, done, total}) 供进度轮询。 */
export async function fetchWorkshopGrad(onProgress) {
  const sys = await apiGet('/api/v1/system_data/public', {});
  const roles = (sys.data && sys.data.system_roles) || [];
  const weapons = (sys.data && sys.data.system_weapons) || [];
  const artifacts = (sys.data && sys.data.system_artifacts) || [];

  const out = [];
  let done = 0;
  await pool(roles, CONCURRENCY, async (role) => {
    const { item_id, nick_name } = role;
    try {
      const j = await apiGet('/api/v1/role/grad_stat', { item_id, level: 40 });
      const d = j.data || {};
      const ws = d.weapon_stat || [];
      const rs = d.relic_stat || [];

      // 角色名解析为 wiki 标准名（维琳娜→维琳娜·艾嘉德、11号→「11号」、星徽·比利→星徽·比利·奇德）；
      // 图标用解析到的标准条目（官方 wiki 大图 portrait 优先）
      const roleName = canonicalName(CATEGORY.CHAR, libChars, nick_name, { fuzzy: true }) || nick_name;
      const libChar = resolveEntry(CATEGORY.CHAR, libChars, nick_name, { fuzzy: true });
      const roleIcon = libChar?.portrait || libChar?.icon || '';

      // 音擎图标：wiki 源
      const wTotal = ws.reduce((a, x) => a + Number(x.weapon_count || 0), 0);
      const weaponsStat = [];
      for (const w of ws) {
        const sysW = weapons.find((x) => String(x.item_id) === String(w.weapon_id));
        const rawName = sysW ? sysW.nick_name : '';
        const libW = sysW ? resolveWengine(rawName) : null;
        const name = w.weapon_id === 'other' ? '其他' : libW ? libW.name : rawName ? romanNumeralUnicode(rawName) : `音擎${w.weapon_id}`;
        const icon = w.weapon_id === 'other' ? '' : libW?.icon || '';
        weaponsStat.push({
          id: w.weapon_id,
          name,
          icon,
          count: Number(w.weapon_count || 0),
          percent: wTotal ? Number(((Number(w.weapon_count || 0) / wTotal) * 100).toFixed(1)) : 0,
        });
      }

      // 驱动盘组合：各套装 wiki 图标（套装名已由 parseSetInfo 解析为 wiki 标准名）
      const rTotal = rs.reduce((a, x) => a + Number(x.set_info_count || 0), 0);
      const relicsStat = [];
      for (const r of rs) {
        const info = parseSetInfo(r.set_info, artifacts);
        const sets = [];
        for (const s of info?.sets || []) {
          const libD = resolveEntry(CATEGORY.DISC, libDiscs, s.name);
          sets.push({ ...s, icon: libD?.icon || '' });
        }
        relicsStat.push({
          set_info: r.set_info,
          name: info ? info.name : r.set_info,
          sets,
          count: Number(r.set_info_count || 0),
          percent: rTotal ? Number(((Number(r.set_info_count || 0) / rTotal) * 100).toFixed(1)) : 0,
        });
      }

      out.push({ item_id, name: roleName, icon: roleIcon, weapons: weaponsStat, relics: relicsStat });
    } catch (e) {
      console.log(`角色 ${item_id} 失败: ${e.message}`);
    }
    done++;
    onProgress?.({ step: 'grad', done, total: roles.length });
  });

  const data = { meta: { scrapedAt: new Date().toISOString(), roles: out.length }, roles: out };
  fs.writeFileSync(GRAD_FILE, JSON.stringify(data));
  return { stats: { roles: out.length } };
}

// ---------- 提取玩家某角色的配装（兼容 mys 源 / 2025 源两种 item_json） ----------
// ctx = { weapons: system_weapons, artifacts: system_artifacts, items: 装备表 }

/** 角色是否「练满」：角色 ≥60 级、音擎 ≥60 级、6 块驱动盘全部 15 级。爬取时过滤未毕业角色。
 *  role 为 user_role/v3 的 role（含 item_json；mys 源用 ij.weapon/ij.equip，2025 源用 ij.Weapon/ij.EquippedList）。 */
export function isMaxedRole(role) {
  if (!role || !role.item_json) return false;
  if ((role.level ?? 0) < 60) return false;
  const ij = role.item_json;
  // 音擎等级（mys: ij.weapon.level；2025: ij.Weapon.Level）
  const wpnLv = ij.weapon ? ij.weapon.level : ij.Weapon ? ij.Weapon.Level : null;
  if (!(wpnLv >= 60)) return false;
  // 驱动盘：恰 6 块且每块 15 级（mys: ij.equip[]；2025: ij.EquippedList[].Equipment）
  const discs =
    Array.isArray(ij.equip) && ij.equip.length ? ij.equip : Array.isArray(ij.EquippedList) ? ij.EquippedList : null;
  if (!discs || discs.length !== 6) return false;
  for (const d of discs) {
    const lv = d && d.level != null ? d.level : d && d.Equipment ? d.Equipment.Level : null;
    if (lv !== 15) return false;
  }
  return true;
}

export function extractBuild(v3Data, roleId, ctx) {
  const roles = (v3Data.data && v3Data.data.roles) || [];
  const role = roles.find((x) => String(x.item_id) === String(roleId));
  if (!role || !role.item_json) return null;
  const ij = role.item_json;
  const base = { level: role.level, rank: role.rank, relic_point: role.relic_point };
  // mys 源判定要「有实际数据」（数组非空）：2025 源若带空的 properties/equip 数组（[] 为 truthy）
  // 会误走 mys 分支返回空面板，必须落到 2025 分支按公式算 enka 面板。
  if ((ij.equip && ij.equip.length) || (ij.properties && ij.properties.length)) {
    // mys 源：工坊格式化结构（名称统一解析回 wiki 标准名 / 属性键归一）
    return {
      ...base,
      skills: (ij.skills || []).map((s) => ({ type: s.skill_type, level: s.level })), // 技能练度（6 技能 {type 0-6, level}）
      weapon: ij.weapon && {
        id: ij.weapon.id,
        name: ij.weapon.name ? resolveWengine(ij.weapon.name)?.name || romanNumeralUnicode(ij.weapon.name) : null,
        level: ij.weapon.level,
        rarity: ij.weapon.rarity,
        main: (ij.weapon.main_properties || []).map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
      },
      panel: (ij.properties || []).map((p) => ({
        name: normalizeStatKey(p.property_name),
        base: p.base,
        add: p.add,
        final: p.final,
      })),
      equips: (ij.equip || []).map((e) => {
        const suitName = e.equip_suit && e.equip_suit.name
          ? canonicalName(CATEGORY.DISC, libDiscs, e.equip_suit.name) || e.equip_suit.name
          : undefined;
        // 主/副词条与 2025 源同构：main=主词条（main_properties）、subs=全部副词条（properties）。
        // 不提取 mys 独有的 valid/all_hit/invalid_property_cnt（两源结构需一致，聚合层按统一口径判定）。
        return {
          id: e.id,
          name: e.name,
          level: e.level,
          rarity: e.rarity,
          suit: suitName,
          main: (e.main_properties || [])
            .filter((p) => p.property_name)
            .map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
          subs: (e.properties || [])
            .filter((p) => p.property_name)
            .map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
        };
      }),
    };
  }
  if (ij.Weapon || ij.EquippedList) {
    // 2025 源：游戏内嵌原始数据（面板经 enka_attrs_mapping 计算；音擎/驱动盘经装备表+系统字典映射）
    const w = ij.Weapon;
    const sysW = w && ctx.weapons.find((x) => String(x.item_id) === String(w.Id));
    const libW = sysW ? resolveWengine(sysW.nick_name) : null;
    const weapon = w && {
      id: w.Id,
      name: sysW ? (libW ? libW.name : romanNumeralUnicode(sysW.nick_name)) : null,
      level: w.Level,
      rarity: sysW ? sysW.level : null,
      main: [],
    };
    const equips = (ij.EquippedList || [])
      .map((slot) => {
        const eq = slot && slot.Equipment;
        if (!eq) return null;
        const item = ctx.items[String(eq.Id)];
        const suit = item && ctx.artifacts.find((x) => x.set_id === String(item.SuitId));
        // 套装名解析为 wiki 标准盘名（工坊 artifacts 名可能带尾随空格）
        const suitName = suit ? canonicalName(CATEGORY.DISC, libDiscs, suit.name) || suit.name : null;
        const main = eq.MainPropertyList && eq.MainPropertyList[0];
        return {
          id: eq.Id,
          name: suitName,
          level: eq.Level,
          rarity: item ? item.Rarity : null,
          suit: suitName,
          main: main ? [{ name: propName(main.PropertyId), value: main.PropertyValue }] : [],
          subs: (eq.RandomPropertyList || []).map((p) => ({
            name: propName(p.PropertyId),
            value: p.PropertyValue * p.PropertyLevel,
          })),
        };
      })
      .filter(Boolean);
    return {
      ...base,
      skills: (ij.SkillLevelList || []).map((s) => ({ type: s.Index, level: s.Level })), // 技能练度（与 mys 源同构 {type, level}）
      weapon,
      panel: computeEnkaPanel(ij),
      equips,
    };
  }
  return null;
}

/** 裁剪 abyss_data_json（深渊战绩）：去掉图片 URL 与长文本，保留可分析的结构化字段。
 *  原始单条 ~23KB（图片 URL/buffs 文本占大头），25k+ uid 全量落盘会膨胀数百 MB；裁剪后 ~1-2KB/条。
 *  保留：层数/评级/最快通关/实战配队（上场角色+影画+邦布）/通关时间/怪物 id+名/buff 标题/参战角色。 */
export function extractAbyss(ab) {
  if (!ab) return null;
  const node = (n) => {
    if (!n) return null;
    return {
      battle_time: n.battle_time,
      buddy: n.buddy ? { id: n.buddy.id, level: n.buddy.level, rarity: n.buddy.rarity } : null,
      avatars: (n.avatars || []).map((a) => ({
        id: a.id,
        rank: a.rank,
        level: a.level,
        rarity: a.rarity,
        element_type: a.element_type,
        avatar_profession: a.avatar_profession,
      })),
      monsters: ((n.monster_info && n.monster_info.list) || []).map((m) => ({ id: m.id, name: m.name })),
    };
  };
  return {
    max_layer: ab.max_layer,
    rating_list: ab.rating_list || [],
    fast_layer_time: ab.fast_layer_time,
    battle_time_47: ab.battle_time_47,
    schedule_id: ab.schedule_id,
    begin_time: ab.begin_time,
    end_time: ab.end_time,
    all_roles: ab.all_roles || [],
    floors: (ab.all_floor_detail || []).map((f) => ({
      layer_id: f.layer_id,
      layer_index: f.layer_index,
      zone_name: f.zone_name,
      rating: f.rating,
      challenge_time: f.challenge_time,
      floor_challenge_time: f.floor_challenge_time,
      buffs: (f.buffs || []).map((b) => ({ title: b.title })),
      node_1: node(f.node_1),
      node_2: node(f.node_2),
    })),
  };
}

// ---------- 主流程 ----------
/** 构建字典 ctx（音擎/驱动盘/装备表，供 2025 源配装映射）+ 角色列表（一次请求返回） */
async function buildCtx() {
  const sys = await apiGet('/api/v1/system_data/public', {});
  return {
    ctx: {
      weapons: (sys.data && sys.data.system_weapons) || [],
      artifacts: (sys.data && sys.data.system_artifacts) || [],
      items,
    },
    roles: (sys.data && sys.data.system_roles) || [],
  };
}

/** 拉单个「角色 × 影画档」的排名行（最多 PER_RANK 条）：offset 串行翻页（每页 50，rows<50 即拉完）。
 *  接口硬性每页 50 条（limit 参数无效），无法一次拿更多。 */
async function fetchRankRows(itemId, rank) {
  const rows = [];
  let offset = 0;
  while (rows.length < PER_RANK) {
    const j = await apiGet('/api/v1/user_relic/ranking', {
      limit: 50,
      offset,
      type: 'role',
      role_id: itemId,
      part_index: null,
      role_level: null,
      role_rank: rank,
      weapon_id: null,
    });
    const page = (j.data && j.data.rows) || [];
    rows.push(...page);
    if (page.length < 50) break; // 拉完
    offset += 50;
  }
  return rows;
}

/** 全量爬取（排名 + 配装） */
/** 全量更新：排名 + 配装（workshop.json）+ 全服统计（workshop-grad.json）+ 汇总（workshop-stats.json）。
 *  onProgress({step, done, total}) 供 server 进度轮询。 */
export async function fetchWorkshopData(onProgress) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`开始爬取：前 ${MAX_ROLES} 角色 × 7 影画 × 每影画 ${PER_RANK} 条收集 uid，随后爬取每个 uid 下所有练满角色（≥60级 / 音擎≥60 / 6×15级盘）\n`);
  const { ctx, roles } = await buildCtx();
  const targets = roles.slice(0, MAX_ROLES);
  console.log(`角色总数 ${roles.length}，本次爬 ${targets.length} 个\n`);

  // 收集排名（角色级并发；每角色 7 影画组内并行翻页——排名请求轻量，原 7×页数 串行往返 → 一轮并行）
  const uidMap = new Map(); // uid -> [{role_id, rank}]
  let rankFetch = 0,
    roleDone = 0;
  await pool(targets, CONCURRENCY, async (t) => {
    const { item_id } = t;
    const pages = await Promise.all(
      Array.from({ length: 7 }, (_, rank) => fetchRankRows(item_id, rank))
    );
    let fetched = 0;
    pages.forEach((rows, rank) => {
      for (const r of rows) {
        if (!uidMap.has(r.uid)) uidMap.set(r.uid, []);
        uidMap.get(r.uid).push({ role_id: String(item_id), rank });
      }
      fetched += rows.length;
    });
    rankFetch += fetched;
    roleDone++;
    if (roleDone % 5 === 0 || roleDone === targets.length) console.log(`  排名收集 ${roleDone}/${targets.length}`);
    onProgress?.({ step: 'rank', done: roleDone, total: targets.length });
  });
  console.log(`\n排名条目 ${rankFetch}，去重 uid ${uidMap.size}\n`);

  // 每个 uid 拉完整配装（并发；断点续爬：已爬 uid 跳过，entries 从已写好的 workshop.json 流式恢复）
  let entries = [];
  if (fs.existsSync(OUT_FILE)) {
    for (const raw of streamJsonArrayElements(OUT_FILE)) entries.push(JSON.parse(raw));
  }
  const abyssList = []; // 本次新爬 uid 的深渊战绩（裁剪后）
  let fail = 0,
    done = 0;
  await pool([...uidMap], CONCURRENCY, async ([uid]) => {
    if (cachedUids[uid]) return; // 已爬过（entries 已在缓存里）
    try {
      const j = await apiPost('/api/v1/user_role/v3', { uid, refresh: false, type: 'ranking' });
      const nick = j.data && j.data.nick_name;
      // 深渊战绩（uid 级，响应顶层）：裁剪掉图片 URL/长文本后落盘，供「练度 → 实战成绩」对标
      abyssList.push({ uid, nick, abyss: extractAbyss(j.data && j.data.abyss_data_json) });
      // 爬该 uid 下所有角色（不只排名上榜的角色），每角色一条；排除未毕业（角色<60 / 音擎<60 / 驱动盘非 6 块 15 级）
      const roles = (j.data && j.data.roles) || [];
      for (const role of roles) {
        if (!isMaxedRole(role)) continue;
        const build = extractBuild(j, role.item_id, ctx);
        if (build) entries.push({ uid, role_id: String(role.item_id), nick, ...build });
      }
      cachedUids[uid] = true;
    } catch {
      fail++;
    }
    done++;
    onProgress?.({ step: 'fetch', done, total: uidMap.size });
    if (done % 100 === 0) {
      saveProgress();
      console.log(`  uid 进度 ${done}/${uidMap.size}，配装条目 ${entries.length}，失败 ${fail}`);
    }
  });
  saveProgress();

  // 分批写 workshop.json（entries 可达十万级，一次性 JSON.stringify 会超 V8 字符串上限）
  const outMeta = {
    scrapedAt: new Date().toISOString(),
    roles: targets.length,
    ranks: 7,
    perRank: PER_RANK,
    uidCount: uidMap.size,
    entryCount: entries.length,
  };
  writeJsonArrayStream(OUT_FILE, `{"meta":${JSON.stringify(outMeta)},"entries":[`, entries);

  // 深渊战绩落盘（断点续爬合并：旧文件已有条目 + 本次新增，uid 去重）
  const prevAbyss = [];
  if (fs.existsSync(ABYSS_FILE)) {
    for (const raw of streamJsonArrayElements(ABYSS_FILE)) prevAbyss.push(JSON.parse(raw));
  }
  const abyssMap = new Map(prevAbyss.map((a) => [a.uid, a]));
  for (const a of abyssList) abyssMap.set(a.uid, a);
  const abyssMerged = [...abyssMap.values()];
  writeJsonArrayStream(
    ABYSS_FILE,
    `{"meta":${JSON.stringify({ scrapedAt: new Date().toISOString(), uidCount: abyssMerged.length })},"entries":[`,
    abyssMerged
  );

  // 角色默认流派权重（system_data 的 weight_json）独立落盘 + 并入 stats（供有效词条/评分口径复现）
  const weightJson = {};
  for (const r of roles) {
    if (r && r.weight_json) weightJson[String(r.item_id)] = r.weight_json;
  }
  fs.writeFileSync(
    WEIGHTS_FILE,
    JSON.stringify({ meta: { scrapedAt: new Date().toISOString(), roles: Object.keys(weightJson).length }, weights: weightJson })
  );

  // 角色 id → 规范名（grad 名已对齐 plans；供 discDetails 输出角色名）
  const roleNameMap = new Map(
    roles.map((r) => [String(r.item_id), canonicalName(CATEGORY.CHAR, libChars, r.nick_name, { fuzzy: true }) || r.nick_name])
  );
  buildWorkshopStats(roleNameMap, weightJson); // 配装数据更新后自动生成汇总（含 weightJson）
  const g = await fetchWorkshopGrad(onProgress); // 同时更新全服配装统计（workshop-grad.json）
  console.log(`\n完成：${entries.length} 条配装写入 ${OUT_FILE}，深渊 ${abyssMerged.length} 条写入 ${ABYSS_FILE}`);
  return { stats: { entries: entries.length, roles: g.stats.roles } };
}

async function main() {
  await fetchWorkshopData();
}

isMain(import.meta, () => main());
