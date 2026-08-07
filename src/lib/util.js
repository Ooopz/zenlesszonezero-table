// src/lib/util.js —— 环境无关的纯工具函数（Node 与浏览器共用）
// 注意：本文件不能 import 任何 node: 模块（浏览器会直接 import 它）。
// Node 专属函数（如 openBrowser）放在 ./node.js。
import { STAT } from './constants.js';

/** 去 HTML 标签，折叠空白 */
export function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '');
}

/** 归一化键名：去 HTML、只保留中文和数字（wiki 与账号接口两侧匹配 / 前端搜索） */
export function normalize(text) {
  return stripHtml(text).replace(/[^一-鿿0-9]/g, '');
}

/** cookie 字符串 → 对象；空返回 null */
export function parseCookies(cookieText) {
  const cookies = {};
  for (const kv of cookieText.split(';')) {
    const [k, ...v] = kv.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  }
  return Object.keys(cookies).length ? cookies : null;
}

/** 复制 cookie 用的剪贴板脚本（浏览器控制台执行），命令行与网页共用 */
export const CLIPBOARD_SCRIPT =
  "var cookie=document.cookie;var ask=confirm('Cookie:'+cookie+'\\n\\nDo you want to copy the cookie to the clipboard?');if(ask==true){copy(cookie);msg=cookie}else{msg='Cancel'}";

/** 转义用于 data-detail 属性（dataset 读取时还原，内嵌 HTML 照常渲染） */
export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** 把用户数据安全嵌入 HTML 属性内的 JS 字符串（onclick="fn('...')"）。
 *  先 JS 转义 \ 与 '（防止提前终止字符串），再 HTML 转义 & " <（防止闭合属性或实体注入）；
 *  HTML 解码发生在 JS 执行前，故两层缺一不可。 */
export function escapeJsAttr(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/** 数值格式化展示（百分比 / 大数 / 特殊属性） */
export function formatValue(name, value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (name === STAT.ENERGY) return (Math.trunc(value * 100) / 100).toFixed(2);
  if (name.endsWith('加成') || name.includes('暴击')) return (value * 100).toFixed(1) + '%';
  if (Math.abs(value) <= 1) return (value * 100).toFixed(1) + '%';
  return (Math.round(value * 10) / 10).toLocaleString('zh-CN');
}

/** 构建归一化索引 {归一化名: 原名} */
export function buildIndex(lib) {
  const idx = {};
  for (const k in lib) idx[normalize(k)] = k;
  return idx;
}

/** 按名称查条目：先精确匹配，再按去标点归一化匹配 */
export function lookup(lib, index, name) {
  return name ? lib[name] || lib[index[normalize(name)]] || null : null;
}

/** 把「词条」统一成 [{name, value}]：兼容数组（新格式）与对象（旧格式/套装加成） */
export function statEntries(data) {
  if (Array.isArray(data)) return data.filter((t) => t && t.name != null && t.value != null);
  return Object.entries(data || {}).map(([name, value]) => ({ name, value }));
}

/** 表头排序通用比较：数字按数值、其余按中文 locale；null 排最后 */
export function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh');
}

// ---------- 属性名归一化 ----------
/** 属性名别名 → 规范名（wiki 来源页面对不同角色用词不一：生命/生命力→生命值、攻击→攻击力、防御→防御力；
 *  部分页面用短名：暴击→暴击率、暴伤→暴击伤害；
 *  命破角色把标准面板后两项换成专属名：穿透率→贯穿力（或贯穿率）、能量自动回复→闪能自动积累/累积/累计） */
const STAT_ALIASES = {
  生命: STAT.HP,
  生命力: STAT.HP,
  攻击: STAT.ATK,
  防御: STAT.DEF,
  暴击: STAT.CR,
  暴伤: STAT.CD,
  // 贯穿力是命破角色独立面板属性（wiki 与账号均为本名），不归一化成穿透率；展示层合并
  贯穿率: STAT.PIERCE,
  闪能自动积累: STAT.ENERGY,
  闪能自动累积: STAT.ENERGY,
  闪能自动累计: STAT.ENERGY,
};
/** 单个属性名归一化为规范名（未知名原样返回） */
export function normalizeStatKey(k) {
  return STAT_ALIASES[k] || k;
}
/** 把对象的键按属性别名归一化为规范名（未知键原样保留，别名与规范名并存时规范名优先） */
export function normalizeStatKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const name = normalizeStatKey(k);
    if (k === name || !(name in out)) out[name] = v; // 规范键直接采用；别名仅在规范键缺席时采用
  }
  return out;
}

/** 游戏富文本 → 可渲染 HTML：把游戏标记 <color=#HEX> 转成 <span style="color">，
 *  把字面 \n 转成 <br>，保留标准 <span style>，移除 <script> 与事件属性（on*）。 */
export function renderRichText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\n/g, '<br>') // 字面反斜杠+n（游戏数据的换行）
    .replace(/\n/g, '<br>') // 真实换行符（兜底）
    .replace(/<color=([#\w]+)>/gi, (_m, color) => `<span style="color:${color}">`)
    .replace(/<\/color>/gi, '</span>')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}
