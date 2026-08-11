// src/sync/workshop.js —— 爬取「绝区零工坊」全角色驱动排名 + 玩家完整配装
// 数据源：api.zzzmap.com（逆向自 wxapkg，签名=MD5(key+参数排序)，无需 token）
// 用法：
//   node src/sync/workshop.js             # 全量 57 角色 × 7 影画 × 每影画 100 条
//   node src/sync/workshop.js --repair    # 补面板：只重拉缺面板的条目（2025 源增量）
//   node src/sync/workshop.js 3           # 只爬前 3 个角色（试跑）
// 输出：data/workshop.json（配装条目）、data/workshop-stats.json（汇总，自动生成）
// 断点续爬：进度存 data/.workshop-progress.json
// 注：本文件整合了面板计算（原 workshop-panel.js）、汇总生成（原 workshop-stats.js）、
//     补面板（原 workshop-repair.js）；workshop-grad.js（全服统计）独立保留。
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeWorkshopStats } from '../lib/workshopStats.js';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = path.join(ROOT, 'data');
const OUT_FILE = path.join(DATA_DIR, 'workshop.json');
const STATS_FILE = path.join(DATA_DIR, 'workshop-stats.json');
const PROGRESS_FILE = path.join(DATA_DIR, '.workshop-progress.json');
// 逆向提取的静态数据表（合并文件）：装备 / 角色基础 / 套装 / 武器
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/sync', 'workshop-static.json'), 'utf8'));
const items = S.items; // 装备 Id → {Rarity, SuitId}
const rolebase = S.rolebase; // 角色 Id → {BaseProps, GrowthProps, PromotionProps, CoreEnhancementProps}
const suits = S.suits; // 套装 Id → {SetBonusProps}
const weapons = S.weapons; // 武器 Id → {MainStat, SecondaryStat}
const GRAD_FILE = path.join(DATA_DIR, 'workshop-grad.json');
// 本地 library.json（官方 wiki 源，图标已本地化）—— 供全服统计（grad）匹配图标
const libraryJson = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'library.json'), 'utf8'));
const libChars = new Map(Object.values(libraryJson.characters || {}).map((c) => [c.name, c]));
const libWengines = new Map(Object.values(libraryJson.wengines || {}).map((w) => [w.name, w]));
const libDiscs = new Map(Object.values(libraryJson.discs || {}).map((d) => [d.name, d]));

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
const isRepair = process.argv.includes('--repair'); // 补面板模式
const MAX_ROLES = Number(process.argv[2] || 57); // 爬几个角色（全量模式）
const PER_RANK = Number(process.argv[3] || 100); // 每影画拉多少条
const CONCURRENCY = 6; // 并发请求数

/** 并发池：limit 个 worker 并行处理 items（library.js 同款） */
export async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array(Math.min(limit, items.length || 1))
      .fill(0)
      .map(async () => {
        while (i < items.length) {
          const idx = i++;
          await fn(items[idx], idx).catch((e) => console.error(`  失败: ${e.message}`));
        }
      })
  );
}

// ---------- 进度（断点续爬：缓存已爬 uid + 已提取的配装条目） ----------
let progress = { cachedUids: {}, entries: [] };
if (fs.existsSync(PROGRESS_FILE)) {
  try {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    progress = { cachedUids: {}, entries: [] };
  }
}
const cachedUids = progress.cachedUids || {};
const saveProgress = (ents) => fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ cachedUids, entries: ents }, null, 2));

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
  const equip = { ...relicCalc(ij.EquippedList), ...setBonusProps(ij.EquippedList) };
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
function buildWorkshopStats() {
  if (!fs.existsSync(OUT_FILE)) return null;
  const entries = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).entries || [];
  const stats = computeWorkshopStats(entries);
  const data = { meta: { scrapedAt: new Date().toISOString(), entries: entries.length }, ...stats };
  fs.writeFileSync(STATS_FILE, JSON.stringify(data));
  return data;
}

// ---------- 全服配装统计（原 workshop-grad.js）：每角色最常用音擎 + 驱动盘套装 ----------
/** 解析驱动盘 set_info（"32800_4__33100_2" → 组合名），返回 {name, sets:[{set_id,num,name}]} 或 null */
function parseSetInfo(setInfo, artifacts) {
  if (setInfo === 'other') return { name: '其他', sets: [] };
  const parts = String(setInfo).split('__');
  const sets = [];
  let name = '';
  for (const p of parts) {
    const [setId, num] = p.split('_');
    const a = artifacts.find((x) => x.set_id === setId);
    const setName = a ? a.name : `套装${setId}`;
    sets.push({ set_id: setId, num: Number(num), name: setName });
    name += `${setName}${num}+`;
  }
  return { name: name.slice(0, -1), sets };
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

      // 角色图标：官方 wiki 大图（portrait）优先
      const libChar = libChars.get(nick_name);
      const roleIcon = libChar?.portrait || libChar?.icon || '';

      // 音擎图标：wiki 源
      const wTotal = ws.reduce((a, x) => a + Number(x.weapon_count || 0), 0);
      const weaponsStat = [];
      for (const w of ws) {
        const sysW = weapons.find((x) => String(x.item_id) === String(w.weapon_id));
        const name = w.weapon_id === 'other' ? '其他' : sysW ? sysW.nick_name : `音擎${w.weapon_id}`;
        const libW = libWengines.get(name);
        const icon = w.weapon_id === 'other' ? '' : libW?.icon || '';
        weaponsStat.push({
          id: w.weapon_id,
          name,
          icon,
          count: Number(w.weapon_count || 0),
          percent: wTotal ? Number(((Number(w.weapon_count || 0) / wTotal) * 100).toFixed(1)) : 0,
        });
      }

      // 驱动盘组合：各套装 wiki 图标
      const rTotal = rs.reduce((a, x) => a + Number(x.set_info_count || 0), 0);
      const relicsStat = [];
      for (const r of rs) {
        const info = parseSetInfo(r.set_info, artifacts);
        const sets = [];
        for (const s of info?.sets || []) {
          const libD = libDiscs.get(s.name);
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

      out.push({ item_id, name: nick_name, icon: roleIcon, weapons: weaponsStat, relics: relicsStat });
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
export function extractBuild(v3Data, roleId, ctx) {
  const roles = (v3Data.data && v3Data.data.roles) || [];
  const role = roles.find((x) => String(x.item_id) === String(roleId));
  if (!role || !role.item_json) return null;
  const ij = role.item_json;
  const base = { level: role.level, rank: role.rank, relic_point: role.relic_point };
  if (ij.equip || ij.properties) {
    // mys 源：工坊格式化结构
    return {
      ...base,
      weapon: ij.weapon && {
        id: ij.weapon.id,
        name: ij.weapon.name,
        level: ij.weapon.level,
        rarity: ij.weapon.rarity,
        main: (ij.weapon.main_properties || []).map((p) => ({ name: p.property_name, value: p.base })),
      },
      panel: (ij.properties || []).map((p) => ({ name: p.property_name, base: p.base, add: p.add, final: p.final })),
      equips: (ij.equip || []).map((e) => ({
        id: e.id,
        name: e.name,
        level: e.level,
        rarity: e.rarity,
        suit: e.equip_suit && e.equip_suit.name,
        main: (e.properties || [])
          .filter((p) => p.valid !== false && p.property_name)
          .map((p) => ({ name: p.property_name, value: p.base })),
      })),
    };
  }
  if (ij.Weapon || ij.EquippedList) {
    // 2025 源：游戏内嵌原始数据（面板经 enka_attrs_mapping 计算；音擎/驱动盘经装备表+系统字典映射）
    const w = ij.Weapon;
    const sysW = w && ctx.weapons.find((x) => String(x.item_id) === String(w.Id));
    const weapon = w && {
      id: w.Id,
      name: sysW ? sysW.nick_name : null,
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
        const main = eq.MainPropertyList && eq.MainPropertyList[0];
        return {
          id: eq.Id,
          name: suit ? suit.name : null,
          level: eq.Level,
          rarity: item ? item.Rarity : null,
          suit: suit ? suit.name : null,
          main: main ? [{ name: propName(main.PropertyId), value: main.PropertyValue }] : [],
          subs: (eq.RandomPropertyList || []).map((p) => ({
            name: propName(p.PropertyId),
            value: p.PropertyValue * p.PropertyLevel,
          })),
        };
      })
      .filter(Boolean);
    return { ...base, weapon, panel: computeEnkaPanel(ij), equips };
  }
  return null;
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

/** 补面板（--repair）：对缺面板的条目（2025 源）重拉 user_role/v3 算 enka 面板 */
async function repairPanel() {
  if (!fs.existsSync(OUT_FILE)) {
    console.error('没有 workshop.json，先跑全量');
    return;
  }
  const data = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
  const entries = data.entries || [];
  const { ctx } = await buildCtx();
  const needs = entries.filter((e) => !e.panel || !e.panel.length);
  console.log(`缺面板条目: ${needs.length} / ${entries.length}`);
  if (!needs.length) {
    console.log('无需补面板');
    return;
  }
  const needMap = new Map();
  for (const e of needs) {
    if (!needMap.has(e.uid)) needMap.set(e.uid, new Set());
    needMap.get(e.uid).add(e.role_id);
  }
  console.log(`去重 uid: ${needMap.size}\n`);
  let done = 0,
    fail = 0,
    updated = 0;
  await pool([...needMap], CONCURRENCY, async ([uid, roleIds]) => {
    try {
      const j = await apiPost('/api/v1/user_role/v3', { uid, refresh: false, type: 'ranking' });
      for (const roleId of roleIds) {
        const build = extractBuild(j, roleId, ctx);
        if (build) {
          for (const e of entries) if (e.uid === uid && e.role_id === roleId) Object.assign(e, build);
          updated++;
        }
      }
    } catch {
      fail++;
    }
    done++;
    if (done % 100 === 0) console.log(`  uid 进度 ${done}/${needMap.size}，更新 ${updated}，失败 ${fail}`);
  });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data));
  buildWorkshopStats(); // 汇总同步更新
  console.log(`\n完成：补面板 ${updated} 条，共 ${entries.length} 条`);
}

/** 全量爬取（排名 + 配装） */
/** 全量更新：排名 + 配装（workshop.json）+ 全服统计（workshop-grad.json）+ 汇总（workshop-stats.json）。
 *  onProgress({step, done, total}) 供 server 进度轮询。 */
export async function fetchWorkshopData(onProgress) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`开始爬取：前 ${MAX_ROLES} 角色 × 7 影画 × 每影画 ${PER_RANK} 条\n`);
  const { ctx, roles } = await buildCtx();
  const targets = roles.slice(0, MAX_ROLES);
  console.log(`角色总数 ${roles.length}，本次爬 ${targets.length} 个\n`);

  // 收集排名（并发角色，每角色内部 7 影画拉排名）
  const uidMap = new Map(); // uid -> [{role_id, rank}]
  let rankFetch = 0,
    roleDone = 0;
  await pool(targets, CONCURRENCY, async (t) => {
    const { item_id } = t;
    let fetched = 0;
    for (let rank = 0; rank <= 6; rank++) {
      let offset = 0,
        got = 0;
      while (got < PER_RANK) {
        const j = await apiGet('/api/v1/user_relic/ranking', {
          limit: 50,
          offset,
          type: 'role',
          role_id: item_id,
          part_index: null,
          role_level: null,
          role_rank: rank,
          weapon_id: null,
        });
        const rows = (j.data && j.data.rows) || [];
        for (const r of rows) {
          if (!uidMap.has(r.uid)) uidMap.set(r.uid, []);
          uidMap.get(r.uid).push({ role_id: String(item_id), rank });
        }
        fetched += rows.length;
        got += rows.length;
        if (rows.length < 50) break; // 拉完
        offset += 50;
      }
    }
    rankFetch += fetched;
    roleDone++;
    if (roleDone % 5 === 0 || roleDone === targets.length) console.log(`  排名收集 ${roleDone}/${targets.length}`);
    onProgress?.({ step: 'rank', done: roleDone, total: targets.length });
  });
  console.log(`\n排名条目 ${rankFetch}，去重 uid ${uidMap.size}\n`);

  // 每个 uid 拉完整配装（并发；断点续爬：已爬 uid 从缓存恢复 entries）
  let entries = progress.entries || [];
  let fail = 0,
    done = 0;
  await pool([...uidMap], CONCURRENCY, async ([uid, marks]) => {
    if (cachedUids[uid]) return; // 已爬过（entries 已在缓存里）
    try {
      const j = await apiPost('/api/v1/user_role/v3', { uid, refresh: false, type: 'ranking' });
      const needRoles = [...new Set(marks.map((m) => m.role_id))];
      for (const roleId of needRoles) {
        const build = extractBuild(j, roleId, ctx);
        if (build) {
          for (const m of marks.filter((x) => x.role_id === roleId)) {
            entries.push({ uid, role_id: roleId, rank: m.rank, nick: j.data && j.data.nick_name, ...build });
          }
        }
      }
      cachedUids[uid] = true;
    } catch {
      fail++;
    }
    done++;
    onProgress?.({ step: 'fetch', done, total: uidMap.size });
    if (done % 100 === 0) {
      saveProgress(entries);
      console.log(`  uid 进度 ${done}/${uidMap.size}，配装条目 ${entries.length}，失败 ${fail}`);
    }
  });
  saveProgress(entries);

  const out = {
    meta: {
      scrapedAt: new Date().toISOString(),
      roles: targets.length,
      ranks: 7,
      perRank: PER_RANK,
      uidCount: uidMap.size,
      entryCount: entries.length,
    },
    entries,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  buildWorkshopStats(); // 配装数据更新后自动生成汇总
  const g = await fetchWorkshopGrad(onProgress); // 同时更新全服配装统计（workshop-grad.json）
  console.log(`\n完成：${entries.length} 条配装写入 ${OUT_FILE}`);
  return { stats: { entries: entries.length, roles: g.stats.roles } };
}

async function main() {
  if (isRepair) await repairPanel();
  else await fetchWorkshopData();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  });
}
