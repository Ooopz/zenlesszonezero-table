// src/lib/constants.js —— 固定字符串的单一权威枚举
// 双端共享（Node 与浏览器均可 import，无任何 node 依赖）。
// 用途：属性名 / 词条类型 / 目标字段 / 主词条候选 / 同步类型 / 视图等固定字符串集中定义，
// 各处引用枚举而非魔法字符串，防止拼写不一致（拼错会得 undefined 而非静默写错数据）。

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
/** 伤害加成判定：属性名以「伤害加成」/「伤害提升」结尾 */
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
    '烈霜伤害加成',
    '流明伤害加成',
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
export const VIEWS = {
  CARD: 'card',
  TABLE: 'table',
  WIKI: 'wiki',
  RECOMMEND: 'recommend',
  MY_CHARS: 'mychars',
};

// ---------- 驱动盘槽位 ----------
export const DISC_SLOTS = [1, 2, 3, 4, 5, 6];
