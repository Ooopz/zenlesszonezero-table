// src/web/shared.js —— 浏览器端共享渲染辅助（纯 HTML 字符串，无数据层/DOM 依赖）
// 收敛卡片/表格/wiki/驱动盘统计四处重复的片段：驱动盘套装悬浮、富文本条目、技能图标。
import { escapeHtml, renderRichText } from '../lib/util.js';

/** 驱动盘 2/4 件套效果 HTML（卡片盘面悬浮 discTooltip、表格悬浮 discTooltipFull、驱动盘统计 discTipHtml 共用） */
export function discSetEffectsHtml(discLib) {
  return (
    (discLib?.set2Text
      ? `<br><span style="color:var(--green)">【2件套】${renderRichText(discLib.set2Text)}</span>`
      : '') +
    (discLib?.set4Text
      ? `<br><span style="color:var(--orange)">【4件套】${renderRichText(discLib.set4Text)}</span>`
      : '')
  );
}

/** 富文本条目：标题加粗 + 富文本描述（技能/影画/觉醒悬浮共用）。
 *  字段名差异（name/desc 与 title/text）由调用方归一化后传入。 */
export function richItemHtml(title, desc) {
  return `<b>${escapeHtml(title)}</b>${desc ? `<br>${renderRichText(desc)}` : ''}`;
}

// ---------- 技能图标（卡片视图数字 type 与 wiki 视图中文字符串键共用同一路径表） ----------
const SKILL_ICON = {
  normal: '/src/img/normal.png',
  dodge: '/src/img/dodge.png',
  support: '/src/img/support.png',
  special: '/src/img/special.png',
  ultimate: '/src/img/ultimate.png',
  core: '/src/img/passive.png',
};
/** 技能规范键 → 图标路径（未知名回退被动图标） */
export function skillIcon(key) {
  return SKILL_ICON[key] || SKILL_ICON.core;
}
/** 账号技能数字 type（0普攻 1特殊 2闪避 3终结 5核心 6支援）→ 图标路径 */
const TYPE_KEY = { 0: 'normal', 1: 'special', 2: 'dodge', 3: 'ultimate', 5: 'core', 6: 'support' };
export function skillIconForType(type) {
  return SKILL_ICON[TYPE_KEY[type]] || SKILL_ICON.core;
}
/** 账号技能数字 type → 中文标签 */
export const SKILL_LABEL = { 0: '普攻', 1: '特殊技', 2: '闪避', 3: '终结技', 5: '核心技', 6: '支援技' };

/** 把对象合并进 window.ZZZ（内联 onclick 引用的全局注册，wiki/ui 共用） */
export function registerZZZ(obj) {
  window.ZZZ = window.ZZZ || {};
  Object.assign(window.ZZZ, obj);
}
