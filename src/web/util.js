// src/web/util.js —— 浏览器端基础工具（无数据层依赖，供 data/ui 复用）
/** 请求本地服务器 API（带超时），服务器不可达返回 null */
export async function apiRequest(url, opts) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 180000);
  try {
    const r = await fetch(url, { ...(opts || {}), signal: controller.signal });
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
