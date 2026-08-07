// server.js —— 本地服务器
// 作用：① 提供服务页面 index.html 与前端模块；② 提供「更新数据库」「更新我的角色」两个接口，
//       供网页一键更新（账号接口 CORS 受限，浏览器直连不了，必须经本地服务器代理）；
//       ③ 提供 /api/data 让前端读取 data/*.json 数据；
//       ④ cookie 缓存到本地文件，更新时无需反复粘贴。
//
// 运行:  npm start   或   node server.js   →  浏览器打开 http://localhost:8718

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './src/lib/node.js';
import { parseCookies } from './src/lib/util.js';
import { SYNC_KINDS } from './src/lib/constants.js';
import { fetchLibrary } from './src/sync/library.js';
import { fetchMyCharacters, cacheCookies, readCookieCache } from './src/sync/characters.js';
import { fetchAllPlans } from './src/sync/plans.js';

const PORT = process.env.PORT || 8718;
// 项目根目录（server.js 位于根目录）
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 简易「正在同步」互斥锁，避免两个同步同时写数据文件 */
let busy = null;
/** 同步进度（供 /api/sync-progress 轮询），空闲时为 null */
let syncState = null;

// ---------------- 静态文件 ----------------

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------- API ----------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}
function respond(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** 读 data/ 下的 JSON（不存在或非法时返回 fallback） */
function readDataJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf-8'));
  } catch {
    return fallback;
  }
}

// 同步耗时较长（属性库约需几十秒抓 180+ 个详情页），请求期间页面显示「正在同步…」，完成后返回结果再刷新。
async function syncLibraryHandler(req, res) {
  if (busy) return respond(res, 409, { ok: false, error: '已有同步进行中，请稍候' });
  busy = '属性库';
  syncState = { kind: SYNC_KINDS.LIBRARY, step: 'prepare', done: 0, total: 0 };
  try {
    // fetchLibrary 内部已写入 data/library.json 与 data/raw-library.json
    const { stats } = await fetchLibrary((p) => {
      syncState = { kind: SYNC_KINDS.LIBRARY, ...p };
    });
    console.log(`[更新数据库] 完成：角色 ${stats.characters} / 音擎 ${stats.wengines} / 驱动盘 ${stats.discs} / 邦布 ${stats.bangboos}`);
    respond(res, 200, { ok: true, type: 'library', stats });
  } catch (e) {
    console.error('[更新数据库] 失败:', e.message);
    respond(res, 500, { ok: false, error: e.message });
  } finally {
    busy = null;
    syncState = null;
  }
}

async function syncCharactersHandler(req, res) {
  if (busy) return respond(res, 409, { ok: false, error: '已有同步进行中，请稍候' });
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return respond(res, 400, { ok: false, error: e.message });
  }
  busy = '我的角色';
  syncState = { kind: SYNC_KINDS.CHARACTERS, step: 'prepare', done: 0, total: 0 };
  try {
    // cookie 来源：请求体 > 本地缓存
    let cookies = body.cookie && body.cookie.trim() ? parseCookies(body.cookie) : null;
    if (!cookies) cookies = readCookieCache();
    if (!cookies)
      return respond(res, 400, {
        ok: false,
        error: '没有可用的 cookie：请先在页面粘贴，或先运行 node sync-characters.js',
      });
    // fetchMyCharacters 内部已写入 data/characters.json
    const { stats } = await fetchMyCharacters(cookies, (done, total) => {
      syncState = { kind: SYNC_KINDS.CHARACTERS, step: SYNC_KINDS.CHARACTERS, done, total };
    });
    if (body.cookie && body.cookie.trim()) cacheCookies(cookies);
    console.log(`[更新我的角色] 完成：${stats.characters} 个角色`);
    respond(res, 200, { ok: true, type: 'characters', stats });
  } catch (e) {
    console.error('[更新我的角色] 失败:', e.message);
    respond(res, 500, { ok: false, error: e.message });
  } finally {
    busy = null;
    syncState = null;
  }
}

async function syncPlansHandler(req, res) {
  if (busy) return respond(res, 409, { ok: false, error: '已有同步进行中，请稍候' });
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return respond(res, 400, { ok: false, error: e.message });
  }
  busy = '推荐方案';
  syncState = { kind: SYNC_KINDS.PLANS, step: 'prepare', done: 0, total: 0 };
  try {
    // cookie 来源：请求体 > 本地缓存（养成指南登录态 e_nap_token 有效期短，允许弹窗重新粘贴）
    let cookies = body.cookie && body.cookie.trim() ? parseCookies(body.cookie) : null;
    if (!cookies) cookies = readCookieCache();
    if (!cookies)
      return respond(res, 400, { ok: false, error: '没有可用的 cookie：请先在「同步数据」弹窗里粘贴 cookie' });
    // fetchAllPlans 内部已写入 data/plans.json；全部抓取失败会抛错（含 e_nap_token 过期提示）
    const { stats } = await fetchAllPlans(cookies, {}, (done, total) => {
      syncState = { kind: SYNC_KINDS.PLANS, step: SYNC_KINDS.PLANS, done, total };
    });
    if (body.cookie && body.cookie.trim()) cacheCookies(cookies);
    console.log(`[更新推荐方案] 完成：${stats.characters} 角色 / ${stats.plans} 方案`);
    respond(res, 200, { ok: true, type: 'plans', stats });
  } catch (e) {
    console.error('[更新推荐方案] 失败:', e.message);
    respond(res, 500, { ok: false, error: e.message });
  } finally {
    busy = null;
    syncState = null;
  }
}

// ---------------- 路由 ----------------

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    // 路由统一用 ASCII，避免中文路径被浏览器百分号编码后匹配失败
    if (req.method === 'POST' && url === '/api/sync-base') return await syncLibraryHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-characters') return await syncCharactersHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-plans') return await syncPlansHandler(req, res);
    if (req.method === 'GET' && url === '/api/data') {
      return respond(res, 200, {
        ok: true,
        library: readDataJson('library.json', { characters: {}, wengines: {}, discs: {} }),
        characters: readDataJson('characters.json', []),
        plans: readDataJson('plans.json', {}),
      });
    }
    if (req.method === 'GET' && url === '/api/cookie-status')
      return respond(res, 200, { ok: true, cached: !!readCookieCache() });
    if (req.method === 'GET' && url === '/api/sync-progress')
      return respond(res, 200, { ok: true, progress: syncState });
    if (req.method === 'GET' && url === '/api/config') {
      const config = readDataJson('user-config.json', null);
      return respond(res, 200, { ok: true, config: config || { charTargets: {}, validStats: {} } });
    }
    if (req.method === 'POST' && url === '/api/config') {
      const body = await readBody(req);
      const config = body.config || { charTargets: {}, validStats: {} };
      fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'data', 'user-config.json'), JSON.stringify(config, null, 2), 'utf-8');
      return respond(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/cookie') {
      const body = await readBody(req);
      const c = parseCookies(body.cookie || '');
      if (!c) return respond(res, 400, { ok: false, error: 'cookie 为空或格式不对' });
      cacheCookies(c);
      return respond(res, 200, { ok: true, cached: true });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    respond(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (e) {
    console.error('处理请求出错:', e);
    respond(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  绝区零配装面板 本地服务器已启动`);
  console.log(`  浏览器打开: http://localhost:${PORT}`);
  console.log(`  网页上「更新数据库」「更新我的角色」即为一键更新；cookie 会缓存在 data/.cookie.json`);
  console.log(`  按 Ctrl+C 停止\n`);
  openBrowser(`http://localhost:${PORT}`);
});
