// src/lib/constants.js —— 固定字符串的单一权威枚举（双端共享，无 node 依赖）
// 各处引用枚举而非魔法字符串，防拼写不一致（拼错得 undefined 而非静默写错数据）。

// ---------- 面板属性名 ----------
/** 面板属性名枚举（数据层与展示层的属性键，贯穿 wiki / 账号 / 推荐方案三方） */
export const STAT = {
  ATK: '攻击力',
  HP: '生命值',
  DEF: '防御力',
  IMPACT: '冲击力',
  CR: '暴击率',
  CD: '暴击伤害',
  ANOMALY_CTRL: '异常掌控',
  ANOMALY_PROF: '异常精通',
  PEN_RATE: '穿透率',
  PIERCE: '贯穿力',
  PEN_VALUE: '穿透值',
  ENERGY: '能量自动回复',
  DMG_BONUS: '伤害加成', // 工坊权重 key「加伤」的标准化名（通用伤害加成）
};
/** 面板属性展示顺序（卡片/表格列序的权威依据） */
export const PANEL_ORDER = [
  STAT.ATK,
  STAT.HP,
  STAT.DEF,
  STAT.IMPACT,
  STAT.CR,
  STAT.CD,
  STAT.ANOMALY_CTRL,
  STAT.ANOMALY_PROF,
  STAT.PEN_RATE,
  STAT.PIERCE,
  STAT.PEN_VALUE,
  STAT.ENERGY,
];

/** 百分比面板属性（值 ≤1 表示百分比，如暴击率 0.3 = 30%） */
export const PERCENT_STATS = new Set([STAT.CR, STAT.CD, STAT.PEN_RATE]);
/** 百分比加成按「基础×(1+Σ%)」计算的属性（其余百分比加成纯累加） */
export const MULT_STATS = new Set([STAT.ATK, STAT.HP, STAT.DEF, STAT.IMPACT, STAT.ENERGY, STAT.ANOMALY_CTRL]);
/** 满级行仅含的基础属性（wiki 成长表「满级」只有这三项） */
export const MAX_LEVEL_STATS = [STAT.HP, STAT.ATK, STAT.DEF];
export const isDamageBonus = (name) => name.endsWith('伤害加成') || name.endsWith('伤害提升');

/** 面板属性 → 对应哪些有效副词条类型（用于按有效属性配置高亮面板行） */
export const PANEL_STAT_MAP = {
  [STAT.ATK]: ['攻击力', '攻击力%'],
  [STAT.HP]: ['生命值', '生命值%'],
  [STAT.DEF]: ['防御力', '防御力%'],
  [STAT.CR]: [STAT.CR],
  [STAT.CD]: [STAT.CD],
  [STAT.PEN_VALUE]: [STAT.PEN_VALUE],
  [STAT.ANOMALY_PROF]: [STAT.ANOMALY_PROF],
};

// ---------- 目标属性（目标设置弹窗可配置的达成目标） ----------
export const TARGET_STATS = [
  STAT.ATK,
  STAT.CR,
  STAT.CD,
  STAT.PEN_RATE,
  STAT.ANOMALY_CTRL,
  STAT.ANOMALY_PROF,
  STAT.IMPACT,
  STAT.ENERGY,
  STAT.HP,
  STAT.DEF,
  '属性伤害加成',
];
/** 目标中按百分比存储的属性（用户填整数，内部 /100） */
export const TARGET_PERCENTS = new Set([STAT.CR, STAT.CD, STAT.PEN_RATE, '属性伤害加成']);
export const TARGET_UNITS = {
  [STAT.CR]: '%',
  [STAT.CD]: '%',
  [STAT.PEN_RATE]: '%',
  属性伤害加成: '%',
};

// ---------- 副词条类型（有效副词条 / 成长表） ----------
/** 副词条类型枚举：攻击/生命/防御有「固定」与「百分比」两种形态，其余为单一形态 */
export const SUBSTAT = {
  ATK: STAT.ATK,
  ATK_PCT: '攻击力%',
  CR: STAT.CR,
  CD: STAT.CD,
  PEN_VALUE: STAT.PEN_VALUE,
  ANOMALY_PROF: STAT.ANOMALY_PROF,
  HP: STAT.HP,
  HP_PCT: '生命值%',
  DEF: STAT.DEF,
  DEF_PCT: '防御力%',
};
export const SUBSTAT_TYPE_SET = new Set(Object.values(SUBSTAT));

// ---------- 驱动盘模拟概率（模拟视图「驱动盘模拟」子面板，discProb.js 消费；名称与 SUBSTAT/MAIN_STAT_OPTIONS 统一） ----------
/** 副词条 10 维顺序（对应游戏 10 种副词条；界面显示按 5 行×2 列配对，见 discProb.js 的 DP_ROW_PAIRS）：
    生命值%/生命值/攻击力%/攻击力/穿透值/防御力%/防御力/暴击伤害/暴击率/异常精通 */
export const DISC_SUBSTATS = [
  SUBSTAT.HP_PCT,
  SUBSTAT.HP,
  SUBSTAT.ATK_PCT,
  SUBSTAT.ATK,
  SUBSTAT.PEN_VALUE,
  SUBSTAT.DEF_PCT,
  SUBSTAT.DEF,
  SUBSTAT.CD,
  SUBSTAT.CR,
  SUBSTAT.ANOMALY_PROF,
];
/** 每种副词条的抽取基础权重（词条池加权抽样用） */
export const DISC_SUBSTAT_SPECIAL_WEIGHTS = [10, 10, 9, 9, 8, 10, 10, 8, 8, 8];
/** 456 号位主词条出现概率（key 与 MAIN_STAT_OPTIONS 一致；数值源自游戏实测） */
export const DISC_MAIN_PROB_WEIGHTS = {
  4: { [SUBSTAT.ATK_PCT]: 18, [SUBSTAT.HP_PCT]: 21, [SUBSTAT.DEF_PCT]: 21, [STAT.CR]: 12, [STAT.CD]: 12, [STAT.ANOMALY_PROF]: 15 },
  5: {
    [SUBSTAT.ATK_PCT]: 16.5,
    [SUBSTAT.HP_PCT]: 19.2,
    [SUBSTAT.DEF_PCT]: 19.2,
    [STAT.PEN_RATE]: 9.1,
    物理伤害加成: 6,
    火属性伤害加成: 6,
    冰属性伤害加成: 6,
    电属性伤害加成: 6,
    以太伤害加成: 6,
    风属性伤害加成: 6,
  },
  6: {
    [SUBSTAT.ATK_PCT]: 18,
    [SUBSTAT.HP_PCT]: 21,
    [SUBSTAT.DEF_PCT]: 21,
    [STAT.ANOMALY_CTRL]: 15,
    [STAT.IMPACT]: 15,
    [STAT.ENERGY]: 15,
  },
};
/** 主词条 → 禁用的同类副词条（副词条不得与主词条重复；key 即主词条名，值即 DISC_SUBSTATS 中对应的副词条） */
export const DISC_MAIN_BLOCK = {
  [SUBSTAT.ATK_PCT]: SUBSTAT.ATK_PCT,
  [SUBSTAT.HP_PCT]: SUBSTAT.HP_PCT,
  [SUBSTAT.DEF_PCT]: SUBSTAT.DEF_PCT,
  [STAT.CR]: SUBSTAT.CR,
  [STAT.CD]: SUBSTAT.CD,
  [STAT.ANOMALY_PROF]: SUBSTAT.ANOMALY_PROF,
};
/** 工坊流派权重 key → CONSTANT 属性名（system_data weight_json 抽取/落地时映射，消费端直接按标准名匹配）。
 *  ⚠️ 12 个 key 全映射：暴击/暴伤/攻击/穿透值/能量/冲击/穿透率/加伤 + 生命/防御/精通/掌控（旧抓取曾丢后 4 个）。 */
export const WS_KEY_TO_STAT = {
  攻击: STAT.ATK,
  暴击: STAT.CR,
  暴伤: STAT.CD,
  生命: STAT.HP,
  防御: STAT.DEF,
  精通: STAT.ANOMALY_PROF,
  掌控: STAT.ANOMALY_CTRL,
  穿透值: STAT.PEN_VALUE,
  穿透率: STAT.PEN_RATE,
  能量: STAT.ENERGY,
  冲击: STAT.IMPACT,
  加伤: STAT.DMG_BONUS,
};
/** 副词条维度 → 落地权重 key（% 与固定共享父属性权重：攻击力% 与 攻击力 都取「攻击力」等） */
export const DISC_SUBSTAT_WS_KEY = {
  [SUBSTAT.ATK_PCT]: STAT.ATK,
  [SUBSTAT.ATK]: STAT.ATK,
  [SUBSTAT.HP_PCT]: STAT.HP,
  [SUBSTAT.HP]: STAT.HP,
  [SUBSTAT.DEF_PCT]: STAT.DEF,
  [SUBSTAT.DEF]: STAT.DEF,
  [SUBSTAT.CR]: STAT.CR,
  [SUBSTAT.CD]: STAT.CD,
  [SUBSTAT.PEN_VALUE]: STAT.PEN_VALUE,
  [SUBSTAT.ANOMALY_PROF]: STAT.ANOMALY_PROF,
};
/** 有效副词条选项（目标弹窗「有效」勾选 + 计算命中用） */
export const VALID_STAT_OPTIONS = [
  { type: SUBSTAT.ATK, label: '攻击力（固定）' },
  { type: SUBSTAT.ATK_PCT, label: '攻击力%' },
  { type: SUBSTAT.CR, label: '暴击率' },
  { type: SUBSTAT.CD, label: '暴击伤害' },
  { type: SUBSTAT.PEN_VALUE, label: '穿透值' },
  { type: SUBSTAT.ANOMALY_PROF, label: '异常精通' },
  { type: SUBSTAT.HP, label: '生命值（固定）' },
  { type: SUBSTAT.HP_PCT, label: '生命值%' },
  { type: SUBSTAT.DEF, label: '防御力（固定）' },
  { type: SUBSTAT.DEF_PCT, label: '防御力%' },
];

// ---------- 目标配置特殊字段（存于 charTargets[name]） ----------
/** 目标配置里的非属性字段：推荐音擎 + 4/5/6 号位主词条 + 有效副词条 */
export const TARGET_KEYS = {
  WENGINE: '推荐音擎',
  MAIN4: '4号位主词条',
  MAIN5: '5号位主词条',
  MAIN6: '6号位主词条',
  VALID_STATS: '有效副词条',
};

// ---------- 驱动盘 4/5/6 号位主词条候选（对应各槽位推荐） ----------
/** 4/5/6 号位主词条候选。注意：只有 1/2/3 号盘才有数值型攻击/防御/生命主词条，
 *  4/5/6 号位的攻击/防御/生命恒为百分比——故候选只含百分比变体与各槽位特有词条。 */
export const MAIN_STAT_OPTIONS = {
  4: [STAT.CR, STAT.CD, STAT.ANOMALY_PROF, SUBSTAT.ATK_PCT, SUBSTAT.DEF_PCT, SUBSTAT.HP_PCT],
  5: [
    STAT.PEN_RATE,
    SUBSTAT.ATK_PCT,
    SUBSTAT.DEF_PCT,
    SUBSTAT.HP_PCT,
    '物理伤害加成',
    '火属性伤害加成',
    '冰属性伤害加成',
    '电属性伤害加成',
    '以太伤害加成',
    '风属性伤害加成',
  ],
  6: [STAT.IMPACT, STAT.ENERGY, STAT.ANOMALY_CTRL, SUBSTAT.ATK_PCT, SUBSTAT.DEF_PCT, SUBSTAT.HP_PCT],
};

/** 4/5/6 号位主词条名归一化：接口/旧数据可能返回固定值名（攻击力/防御力/生命值），
 *  但 456 号位主词条恒为百分比，统一转百分比变体；其余原样返回（幂等，可安全套用）。 */
export function mainStatName(name) {
  if (name === STAT.ATK) return SUBSTAT.ATK_PCT;
  if (name === STAT.HP) return SUBSTAT.HP_PCT;
  if (name === STAT.DEF) return SUBSTAT.DEF_PCT;
  return name;
}

// ---------- 同步类型（server 的 syncState.kind + 前端进度轮询） ----------
export const SYNC_KINDS = {
  LIBRARY: 'library',
  CHARACTERS: 'characters',
  PLANS: 'plans',
  WORKSHOP: 'workshop',
};

// ---------- 视图 ----------
// 持久化值（URL ?view= 与 user-config 的 view 字段）：2026-11 起仅保留四个当前视图值，
// 历史值 recommend/discstats/card/table 已由 ui.js 的 migrateViewState 一次性迁移，不再兼容。
export const VIEWS = {
  WIKI: 'wiki',
  STATS: 'stats',
  MY_CHARS: 'mychars',
  SIMULATE: 'simulate',
};
/** 合法 view 值集合。⚠️ 校验必须查这里，不能写 `VIEWS[raw]`——VIEWS 的键是 WIKI/STATS/…，
 *  持久化的值是 wiki/stats/…，用值当键查恒为 undefined，四个视图会全部被判非法回退 mychars。 */
export const VIEW_VALUES = new Set(Object.values(VIEWS));

// ---------- 技能类型（统一 canonical 编号，双源映射后消费） ----------
/** 统一技能类型（canonical，游戏 2.0 槽顺序：普攻/闪避/支援/特殊/终结/核心；无独立「连携」——连携与终结同槽共享等级）。
 *  ⚠️ 双源 type 编号体系不同，消费前必须经 OFFICIAL_SKILL_TYPE / WS2025_SKILL_TYPE 映射；判别优先读 source 字段，旧数据回退 skills 数组顺序。 */
export const SKILL_TYPES = [
  { key: 0, label: '普攻' },
  { key: 1, label: '闪避' },
  { key: 2, label: '支援' },
  { key: 3, label: '特殊' },
  { key: 4, label: '终结' },
  { key: 5, label: '核心' },
];
/** 官方（米游社账号）与工坊 mys 源技能 type → canonical（特殊技↔闪避互换；官方 3 终结/连携→4 终结；官方 6 支援→2 支援） */
export const OFFICIAL_SKILL_TYPE = { 0: 0, 1: 3, 2: 1, 3: 4, 5: 5, 6: 2 };
/** 工坊 2025 源（游戏内嵌 1.x 技能 ID）type → canonical（1 闪避→1、2 特殊技→3、3 连携→4 终结、6 终结→4） */
export const WS2025_SKILL_TYPE = { 0: 0, 1: 1, 2: 3, 3: 4, 5: 5, 6: 4 };
