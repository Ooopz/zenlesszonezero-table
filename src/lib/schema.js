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
  return errors;
}

/** 校验角色数组 */
export function validateCharacters(arr) {
  if (!Array.isArray(arr)) return ['角色数据应为数组'];
  const errors = [];
  arr.forEach((c, i) => validateCharacter(c).forEach((e) => errors.push(`角色[${i}] ${e}`)));
  return errors;
}

/** 校验属性库（library.json） */
export function validateLibrary(lib) {
  const errors = [];
  if (!lib || typeof lib !== 'object') return ['属性库应为对象'];
  for (const cat of ['characters', 'wengines', 'discs']) {
    if (!lib[cat] || typeof lib[cat] !== 'object') errors.push(`缺 ${cat}`);
  }
  for (const [k, c] of Object.entries(lib.characters || {})) {
    if (!c || typeof c !== 'object') {
      errors.push(`角色 ${k} 非对象`);
      continue;
    }
    if (typeof c.name !== 'string' || !c.name) errors.push(`角色 ${k} 缺 name`);
    if (c.maxLevel !== undefined && (typeof c.maxLevel !== 'object' || Array.isArray(c.maxLevel)))
      errors.push(`角色 ${k} maxLevel 应为对象`);
  }
  for (const [k, w] of Object.entries(lib.wengines || {})) {
    if (!w || typeof w !== 'object') {
      errors.push(`音擎 ${k} 非对象`);
      continue;
    }
    if (typeof w.name !== 'string' || !w.name) errors.push(`音擎 ${k} 缺 name`);
    if (w.baseAtk !== undefined && typeof w.baseAtk !== 'number') errors.push(`音擎 ${k} baseAtk 应为数字`);
    if (
      w.subStats !== undefined &&
      w.subStats !== null &&
      (typeof w.subStats !== 'object' || Array.isArray(w.subStats))
    )
      errors.push(`音擎 ${k} subStats 应为对象`);
  }
  for (const [k, d] of Object.entries(lib.discs || {})) {
    if (!d || typeof d !== 'object') {
      errors.push(`驱动盘 ${k} 非对象`);
      continue;
    }
    if (typeof d.name !== 'string' || !d.name) errors.push(`驱动盘 ${k} 缺 name`);
  }
  return errors;
}

/** 校验失败时打印 warning（不中断写入），供写入前调用 */
export function warnIfInvalid(label, errors) {
  if (errors && errors.length) {
    console.warn(`[${label}] 结构校验发现 ${errors.length} 处异常:`);
    console.warn(
      '  - ' + errors.slice(0, 20).join('\n  - ') + (errors.length > 20 ? `\n  … 共 ${errors.length} 条` : '')
    );
  }
  return errors;
}
