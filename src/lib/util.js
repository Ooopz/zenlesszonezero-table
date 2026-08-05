// src/lib/util.js —— 环境无关的纯工具函数（Node 与浏览器共用）
// 注意：本文件不能 import 任何 node: 模块（浏览器会直接 import 它）。
// Node 专属函数（如 openBrowser）放在 ./node.js。

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

/** 数值格式化展示（百分比 / 大数 / 特殊属性） */
export function formatValue(name, value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (name === '能量自动回复') return value.toFixed(1);
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
