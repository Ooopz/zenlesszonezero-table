// src/sync/workshop-api.js —— 「绝区零工坊」（api.zzzmap.com）API 客户端：签名（MD5(key+参数排序)，无需 token）+ 带重试请求 + 可选代理。
// 只管 zzzmap（与 mihoyo-api.js 分工）；workshop.js 与 workshop-stats.js 共用；模块加载时自动启用代理。
import crypto from 'node:crypto';
import { installProxyFetch, resolveProxyUrl, maskProxyUrl } from './proxy.js';
import { sleep } from './mihoyo-api.js';

// ---------- 签名协议（逆向自工坊 wxapkg） ----------
const KEY = 'VW^)(^*^$$#*%(#)!@VIAI%';
const BASE = 'https://api.zzzmap.com';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function makeSign(data) {
  const params = { key: KEY, ...data };
  const str = Object.entries(params)
    .map(([k, v]) => `${k}=${v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('&')
    .split('&')
    .sort()
    .join('&');
  return md5(str);
}
function filterParams(data) {
  const o = {};
  for (const [k, v] of Object.entries(data || {})) if (v != null) o[k] = v;
  return o;
}

// ---------- 带重试的请求 ----------
/** 非 2xx / 非 JSON（风控返回 HTML 页）/ 网络错误 → 指数退避重试（2s→6s→18s→54s），仍失败才抛错（调用方记 fail 续爬）。 */
const RETRY_MAX = 4; // 重试次数（不含首次）
const RETRY_BASE = 2000; // 初始退避 2s，指数 ×3
async function fetchJson(url, opts, attempt = 0) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    if (attempt < RETRY_MAX) {
      await sleep(RETRY_BASE * 3 ** attempt);
      return fetchJson(url, opts, attempt + 1);
    }
    throw new Error(`网络错误: ${e.message}`, { cause: e });
  }
  const text = await res.text(); // 先取全文：HTML 风控页与 JSON 分开处理
  if (!res.ok) {
    if (attempt < RETRY_MAX) {
      await sleep(RETRY_BASE * 3 ** attempt);
      return fetchJson(url, opts, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 60)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (attempt < RETRY_MAX) {
      await sleep(RETRY_BASE * 3 ** attempt);
      return fetchJson(url, opts, attempt + 1);
    }
    throw new Error(`非 JSON 响应（疑似风控）: ${text.slice(0, 60)}`);
  }
}
export async function apiGet(path, data) {
  const d = filterParams(data);
  const time = Date.now();
  const qs = new URLSearchParams(d).toString();
  return fetchJson(`${BASE}${path}${qs ? '?' + qs : ''}`, {
    headers: {
      'content-type': 'application/json',
      version: '100',
      platform: 'weixin',
      sign: makeSign(d),
      time: String(time),
    },
  });
}
export async function apiPost(path, data) {
  const d = filterParams(data);
  const time = Date.now();
  return fetchJson(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      version: '100',
      platform: 'weixin',
      sign: makeSign(d),
      time: String(time),
    },
    body: JSON.stringify(d),
  });
}

// ---------- 代理（可选）：第 5 参 > HTTPS_PROXY/ALL_PROXY/HTTP_PROXY 环境变量 ----------
// IP 被风控时用代理换 IP；模块加载时启用（server.js 复用同样生效），仅 api.zzzmap.com 走代理（见 proxy.js）。
const proxyUrl = resolveProxyUrl(process.argv[5]);
if (proxyUrl) {
  installProxyFetch(proxyUrl);
  console.log(`🌐 工坊请求走代理: ${maskProxyUrl(proxyUrl)}（仅 api.zzzmap.com，其余请求不受影响）`);
}
