// src/sync/workshop-panel.js —— 2025 源面板计算（复现工坊 enka_attrs_mapping，Node 专属）
// 2025 源条目面板无现成数值，需按公式复算（mys 源面板现成）；公式随游戏版本失准会静默漂移（原两源一致性审计已删除），重算口径变化时留意。
import { items, rolebase, suits, weapons } from './workshop-static.js';

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
/** 属性 id → 属性名（extractBuild 的 2025 源装备词条用） */
export const propName = (id) => PROP_DESC[id] || `未知${id}`;

// ---------- 2025 源面板计算（复现工坊 enka_attrs_mapping） ----------
/** 驱动盘主属性按稀有度的等级成长系数（工坊 relic_calculate） */
const RARITY_GROWTH = { 4: 0.2, 3: 0.25, 2: 0.3 };

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

/** 套装加成：同套装 ≥2 件 → SetBonusProps（4 件套为条件效果，工坊不计） */
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

/** 复现工坊 sumAttrFinalValue */
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

/** 计算 2025 源玩家的面板，返回与 mys 源 panel 一致的格式 */
export function computeEnkaPanel(ij) {
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
