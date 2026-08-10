// src/lib/schema.js —— 数据 schema：集中定义实体结构，并提供校验
// sync 脚本在写回 data/*.json 前调用校验，防止键不一致或结构漂移。
// 无 node 依赖，Node 与浏览器均可 import。

/** 数据键名（唯一权威定义，各文件构造/访问数据时以此为准） */
export const KEYS = Object.freeze({
  // 通用
  NAME: 'name',
  VALUE: 'value',
  ID: 'id',
  ICON: 'icon',
  LEVEL: 'level',
  // 角色（账号接口 / characters.json）
  PORTRAIT: 'portrait',
  RARITY: 'rarity',
  FACTION: 'faction',
  PANEL: 'panel',
  BASE: 'base',
  BONUS: 'bonus',
  FINAL: 'final',
  WENGINE: 'wengine',
  REFINEMENT: 'refinement',
  SPECIAL_EFFECT: 'specialEffect',
  MAIN_STATS: 'mainStats',
  SUB_STATS: 'subStats',
  DISCS: 'discs',
  SET: 'set',
  SLOT: 'slot',
  // 角色附加（账号接口全量）
  SPECIAL_EFFECT_TITLE: 'specialEffectTitle',
  ELEMENT_TYPE: 'elementType',
  PROFESSION: 'profession',
  SUB_ELEMENT_TYPE: 'subElementType',
  VERTICAL_PAINTING_COLOR: 'verticalPaintingColor',
  US_NAME: 'usName',
  SKINS: 'skins',
  MINDSCAPE: 'mindscape',
  SKILLS: 'skills',
  SKILL_AWAKEN: 'skillAwaken',
  EQUIP_PLAN: 'equipPlan',
  // 属性库（library.json）
  ELEMENT: 'element',
  TRAIT: 'trait',
  MAX_LEVEL: 'maxLevel',
  BASE_ATK: 'baseAtk',
  SUB_STATS_TEXT: 'subStatsText',
  SET2: 'set2',
  SET4: 'set4',
  SET2_TEXT: 'set2Text',
  SET4_TEXT: 'set4Text',
  // 用户配置
  CHAR_TARGETS: 'charTargets',
  VALID_STATS: 'validStats',
  NOTES: 'notes',
  ROW_ORDER: 'rowOrder',
  COL_ORDER: 'colOrder',
  VIEW: 'view',
});

/** 词条：{ name: string, value: number } */
function isEntry(e) {
  return !!e && typeof e === 'object' && typeof e.name === 'string' && typeof e.value === 'number';
}
function isEntryList(l) {
  if (l === undefined || l === null) return true;
  if (Array.isArray(l)) return l.every(isEntry);
  // 兼容历史数据：空对象表示无词条（前端 statEntries 同样兼容）
  if (typeof l === 'object' && Object.keys(l).length === 0) return true;
  return false;
}

/** 校验单个角色（characters.json / index.html characters 块条目） */
export function validateCharacter(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['角色应为对象'];
  if (typeof c.name !== 'string' || !c.name) errors.push('缺 name');
  if (c.panel !== undefined && (typeof c.panel !== 'object' || Array.isArray(c.panel))) errors.push('panel 应为对象');
  if (c.wengine && typeof c.wengine === 'object') {
    if (!isEntryList(c.wengine.mainStats)) errors.push('wengine.mainStats 词条格式异常');
    if (!isEntryList(c.wengine.subStats)) errors.push('wengine.subStats 词条格式异常');
  }
  if (Array.isArray(c.discs)) {
    c.discs.forEach((d, i) => {
      if (!d || typeof d !== 'object') return errors.push(`discs[${i}] 非对象`);
      if (typeof d.set !== 'string') errors.push(`discs[${i}] 缺 set`);
      if (!isEntryList(d.mainStats)) errors.push(`discs[${i}].mainStats 词条格式异常`);
      if (!isEntryList(d.subStats)) errors.push(`discs[${i}].subStats 词条格式异常`);
    });
  }
  // 附加字段（可选，存在时才校验类型；旧数据可缺省）
  if (c.mindscape !== undefined && (typeof c.mindscape !== 'object' || typeof c.mindscape.rank !== 'number')) {
    errors.push('mindscape 应为 { rank: number, ranks: [] }');
  }
  if (c.skills !== undefined && !Array.isArray(c.skills)) errors.push('skills 应为数组');
  if (c.skins !== undefined && !Array.isArray(c.skins)) errors.push('skins 应为数组');
  return errors;
}

/** 校验角色数组 */
export function validateCharacters(arr) {
  if (!Array.isArray(arr)) return ['角色数据应为数组'];
  const errors = [];
  arr.forEach((c, i) => validateCharacter(c).forEach((e) => errors.push(`角色[${i}] ${e}`)));
  return errors;
}

/** 校验 {键: 实体} 集合：非对象 / 缺 name 通用检查 + 每类实体的附加检查 */
function checkEntries(errors, lib, cat, label, extra) {
  for (const [k, obj] of Object.entries(lib[cat] || {})) {
    if (!obj || typeof obj !== 'object') {
      errors.push(`${label} ${k} 非对象`);
      continue;
    }
    if (typeof obj.name !== 'string' || !obj.name) errors.push(`${label} ${k} 缺 name`);
    extra?.(k, obj, errors);
  }
}

/** 校验属性库（library.json） */
export function validateLibrary(lib) {
  const errors = [];
  if (!lib || typeof lib !== 'object') return ['属性库应为对象'];
  for (const cat of ['characters', 'wengines', 'discs']) {
    if (!lib[cat] || typeof lib[cat] !== 'object') errors.push(`缺 ${cat}`);
  }
  // 邦布可选（旧数据可能没有）；存在时校验
  if (lib.bangboos !== undefined && (typeof lib.bangboos !== 'object' || Array.isArray(lib.bangboos)))
    errors.push('bangboos 应为对象');
  checkEntries(errors, lib, 'characters', '角色', (k, c, err) => {
    if (c.maxLevel !== undefined && (typeof c.maxLevel !== 'object' || Array.isArray(c.maxLevel)))
      err.push(`角色 ${k} maxLevel 应为对象`);
    if (c.coreSkillBoost !== undefined && !Array.isArray(c.coreSkillBoost))
      err.push(`角色 ${k} coreSkillBoost 应为数组（每档增量，A-F 顺序）`);
    if (c.corePassiveMax !== undefined && typeof c.corePassiveMax !== 'string')
      err.push(`角色 ${k} corePassiveMax 应为字符串（核心被动满级描述）`);
    if (c.tachie !== undefined && typeof c.tachie !== 'string')
      err.push(`角色 ${k} tachie 应为字符串（立绘大图 URL）`);
    // 技能每级数值：skills[].items[].growth 若存在应为数组（null/缺省 = 无每级数值；结构漂移会被同步脚本静默写坏）
    if (Array.isArray(c.skills))
      for (const s of c.skills)
        for (const it of s.items || [])
          if (it.growth != null && !Array.isArray(it.growth)) err.push(`角色 ${k} 技能「${s.type}」 growth 应为数组`);
  });
  checkEntries(errors, lib, 'wengines', '音擎', (k, w, err) => {
    if (w.baseAtk !== undefined && typeof w.baseAtk !== 'number') err.push(`音擎 ${k} baseAtk 应为数字`);
    if (
      w.subStats !== undefined &&
      w.subStats !== null &&
      (typeof w.subStats !== 'object' || Array.isArray(w.subStats))
    )
      err.push(`音擎 ${k} subStats 应为对象`);
  });
  checkEntries(errors, lib, 'discs', '驱动盘');
  checkEntries(errors, lib, 'bangboos', '邦布', (k, b, err) => {
    if (b.skills !== undefined && !Array.isArray(b.skills)) err.push(`邦布 ${k} skills 应为数组`);
  });
  return errors;
}

/** 校验推荐方案数据（plans.json：{ avatarId: { name, plans: [...] } }） */
export function validatePlans(plans) {
  const errors = [];
  if (!plans || typeof plans !== 'object' || Array.isArray(plans)) return ['推荐方案数据应为对象'];
  for (const [k, v] of Object.entries(plans)) {
    if (!v || typeof v !== 'object') errors.push(`角色 ${k} 应为对象`);
    else if (!Array.isArray(v.plans)) errors.push(`角色 ${k} 缺 plans 数组`);
  }
  return errors;
}

/** 校验失败时打印 warning（不中断写入），供写入前调用。
 *  strict 为 true 时抛错中断——命令行同步可经 STRICT=1 开启（网页同步保持 warn，避免 wiki 解析偶发异常阻断整次同步）。 */
export function warnIfInvalid(label, errors, { strict = false } = {}) {
  if (errors && errors.length) {
    console.warn(`[${label}] 结构校验发现 ${errors.length} 处异常:`);
    console.warn(
      '  - ' + errors.slice(0, 20).join('\n  - ') + (errors.length > 20 ? `\n  … 共 ${errors.length} 条` : '')
    );
    if (strict) throw new Error(`[${label}] 结构校验失败（STRICT 模式），共 ${errors.length} 处异常`);
  }
  return errors;
}
