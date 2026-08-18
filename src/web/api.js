// src/web/api.js —— 浏览器端基础工具：apiRequest/postJSON（网络请求）+ notify（提示条），无数据层依赖，供 data/ui 复用

// ---------- 提示条 ----------
// 放这里而非 ui.js：data.js 也要用，反向 import ui.js 会成环。
let statusTimer = null;
/** 页面右下提示条；DOM 未就绪时降级为 console（模块脚本 defer，正常路径下 #status 已存在） */
export function notify(msg, seconds = 4) {
  const el = document.getElementById('status');
  if (!el) return void console.warn(msg);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000);
}

/** 请求本地服务器 API（带超时），不可达/超时返回 null。
 *  opts.timeout：默认 180000ms；传 0 = 不超时（长同步请求专用——180s 硬超时会误报失败而服务端仍在继续）。 */
export async function apiRequest(url, opts) {
  const timeout = opts?.timeout == null ? 180000 : opts.timeout;
  const controller = new AbortController();
  const t = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const r = await fetch(url, { ...(opts || {}), signal: controller.signal });
    return await r.json();
  } catch {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

/** POST JSON（统一 Content-Type 头 + 序列化），返回解析后的响应；opts 透传 apiRequest（如 {timeout: 0}） */
export async function postJSON(url, body, opts) {
  return apiRequest(url, {
    ...(opts || {}),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
