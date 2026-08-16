// server.js —— 本地服务器
// 作用：① 提供服务页面 index.html 与前端模块；② 提供「数据库/我的角色/推荐方案/工坊配装」四个同步接口，
//       供网页一键更新（账号接口 CORS 受限，浏览器直连不了，必须经本地服务器代理）；
//       ③ 提供 /api/data 让前端读取 data/*.json 数据；
//       ④ cookie 缓存到本地文件，更新时无需反复粘贴。
//
// 运行:  npm start   或   node server.js   →  浏览器打开 http://localhost:8718

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './src/lib/node.js';
import { parseCookies } from './src/lib/util.js';
import { SYNC_KINDS } from './src/lib/constants.js';
import { fetchLibrary, localizeDataFiles } from './src/sync/library.js';
import { fetchMyCharacters, cacheCookies, readCookieCache } from './src/sync/characters.js';
import { fetchAllPlans } from './src/sync/plans.js';
import { fetchWorkshopData } from './src/sync/workshop.js';

const PORT = process.env.PORT || 8719;
// 仅监听回环地址：data/ 下有明文 cookie 与个人配置，绝不能暴露到局域网。
// 如确需局域网访问，显式设 HOST=0.0.0.0（自行承担凭证泄漏风险）。
const HOST = process.env.HOST || '127.0.0.1';
// 项目根目录（server.js 位于根目录）
const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 请求体上限：/api/config 会把请求体原样落盘，不设限等于开放磁盘写入
const MAX_BODY = 4 << 20; // 4 MB

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

/** 是否允许作为静态资源对外提供。
 *  data/ 下只放行 data/img/（library.json 里的图标路径），其余一律拒绝——
 *  data/.cookie.json 是明文米游社登录态，data/*.json 是个人账号数据，
 *  它们与 index.html 同在 ROOT 下，若只做「路径在 ROOT 内」检查就会被直接下载。 */
function isServable(relPath) {
  const parts = relPath.split(path.sep).filter(Boolean);
  // 任意一段以 . 开头的隐藏文件/目录（.cookie.json / .git / .claude 等）
  if (parts.some((p) => p.startsWith('.'))) return false;
  if (parts[0] === 'data') return parts[1] === 'img' && parts.length > 2;
  return true;
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    // 非法百分号编码：decodeURIComponent 会抛 URIError，按 400 处理而非 500
    res.writeHead(400);
    return res.end('Bad Request');
  }
  if (urlPath === '/') urlPath = '/index.html';
  // path.resolve + ROOT+sep 前缀：避免同级目录前缀匹配（ROOT 为 …/worker 时 …/worker-evil 不应放行）
  const filePath = path.resolve(ROOT, '.' + path.posix.normalize(urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!isServable(path.relative(ROOT, filePath))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  // 软链可能指向 ROOT 外：解析真实路径后再校验一次
  fs.realpath(filePath, (rErr, realPath) => {
    if (rErr) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    if (realPath !== ROOT && !realPath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(realPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      // no-store：彻底禁止缓存，任何改动强刷后必然加载最新资源（如 JS 修复不生效的常见原因）
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(realPath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });
}

// ---------------- API ----------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Buffer 收集后统一解码：逐块 toString('utf8') 会把跨 TCP 分片的中文切成乱码
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        return reject(new Error('请求体过大'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 拒绝跨站发起的写请求。
 *  简单请求（text/plain）无需预检，恶意页面可静默 POST 覆盖 user-config.json 或写入 cookie；
 *  攻击者读不到响应，但写入已经发生。同源请求的 Origin 要么缺失，要么是本机地址。 */
function isCrossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false; // 非浏览器发起（curl / 同源导航）
  try {
    const { hostname } = new URL(origin);
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]' && hostname !== '::1';
  } catch {
    return true;
  }
}
function respond(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** 数据文件最后修改时间（ms；不存在返回 null），供同步中心展示数据新鲜度 */
function mtimeOf(name) {
  try {
    return fs.statSync(path.join(ROOT, 'data', name)).mtimeMs;
  } catch {
    return null;
  }
}

/** 读 data/ 下的 JSON（不存在或非法时返回 fallback） */
function readDataJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf-8'));
  } catch {
    return fallback;
  }
}

// ---------- /api/data 负载（mtime 缓存 + gzip） ----------

const DATA_FILES = {
  library: ['library.json', { characters: {}, wengines: {}, discs: {} }],
  characters: ['characters.json', []],
  plans: ['plans.json', {}],
  workshopGrad: ['workshop-grad.json', { roles: [] }],
  workshopStats: ['workshop-stats.json', { wengines: [], discs: [], panels: [], discDetails: [] }],
};

/** plans.json 里前端从不读取的字段——desc 是大段攻略正文，占 plans 体积的一多半。
 *  剥离后 /api/data 负载显著变小，前端消费点（ui.js 方案表 / plansStats / panelBench）不受影响。 */
const PLAN_DROP_FIELDS = ['desc', 'skills'];

function slimPlans(plans) {
  const out = {};
  for (const [id, v] of Object.entries(plans || {})) {
    out[id] = {
      ...v,
      plans: (v.plans || []).map((p) => {
        const q = { ...p };
        for (const f of PLAN_DROP_FIELDS) delete q[f];
        return q;
      }),
    };
  }
  return out;
}

/** 缓存：{ sig, raw, gzip, etag }。sig 由五个数据文件的 mtime+size 组成，任一变化即失效。 */
let dataCache = null;

function dataSignature() {
  return Object.values(DATA_FILES)
    .map(([f]) => {
      try {
        const s = fs.statSync(path.join(ROOT, 'data', f));
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return '-';
      }
    })
    .join('|');
}

function buildDataPayload() {
  const obj = { ok: true };
  for (const [key, [file, fallback]] of Object.entries(DATA_FILES)) {
    obj[key] = readDataJson(file, fallback);
  }
  obj.plans = slimPlans(obj.plans);
  const raw = Buffer.from(JSON.stringify(obj), 'utf-8');
  return { raw, gzip: zlib.gzipSync(raw, { level: 6 }), etag: `W/"${dataSignature().length}-${raw.length}"` };
}

/** /api/data：解析结果按 mtime 缓存，命中 ETag 直接 304。
 *  原实现每次请求都同步读解 ~33MB（约 270ms 阻塞事件循环）并全量重新序列化。 */
function sendData(req, res) {
  const sig = dataSignature();
  if (!dataCache || dataCache.sig !== sig) {
    dataCache = { sig, ...buildDataPayload() };
  }
  if (req.headers['if-none-match'] === dataCache.etag) {
    res.writeHead(304, { ETag: dataCache.etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = wantsGzip ? dataCache.gzip : dataCache.raw;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ETag: dataCache.etag,
    // no-cache（而非 no-store）：仍走 ETag 协商，数据没变时 304 空响应
    'Cache-Control': 'no-cache',
    ...(wantsGzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(body);
}

// ---------- 同步 handler 统一骨架（busy 互斥锁 / 进度 syncState / cookie 解析 / try-catch-finally） ----------

/** 跑一次同步：互斥锁 + 进度上报 + 错误处理 + cookie 来源统一（请求体 > 本地缓存）。
 *  runSync(cookies, onProgress) 负责调用 fetch* 并返回 { stats }；内部自行写入 data/*.json。
 *  progressShape：'step' 表示 fetch* 上报 {step,done,total}（library/workshop）；'count' 表示上报 (done,total)（characters/plans）。 */
async function runSync(
  req,
  res,
  {
    kind,
    label,
    needBody = false,
    resolveCookies = () => ({}),
    run,
    progressShape = 'step',
    cacheOnBodyCookie = false,
    emptyCookieError = '',
  }
) {
  if (busy) return respond(res, 409, { ok: false, error: '已有同步进行中，请稍候' });
  // 必须在任何 await 之前抢锁：readBody 是异步的，若在其之后置位，
  // 两个并发同步请求会双双通过上面的检查，同时写 data/*.json。
  busy = label;
  syncState = { kind, step: 'prepare', done: 0, total: 0 };
  let body = null;
  if (needBody) {
    try {
      body = await readBody(req);
    } catch (e) {
      busy = null;
      syncState = null;
      return respond(res, 400, { ok: false, error: e.message });
    }
  }
  try {
    const cookies = resolveCookies(body);
    if (cookies === null) return respond(res, 400, { ok: false, error: emptyCookieError });
    const onProgress =
      progressShape === 'count'
        ? (done, total) => {
            syncState = { kind, step: kind, done, total };
          }
        : (p) => {
            syncState = { kind, ...p };
          };
    const { stats } = await run(cookies, onProgress);
    if (cacheOnBodyCookie && body?.cookie && body.cookie.trim()) cacheCookies(cookies);
    console.log(`[更新${label}] 完成`);
    respond(res, 200, { ok: true, type: kind, stats });
  } catch (e) {
    console.error(`[更新${label}] 失败:`, e.message);
    respond(res, 500, { ok: false, error: e.message });
  } finally {
    busy = null;
    syncState = null;
  }
}

/** cookie 来源：请求体 > 本地缓存；两者都没有返回 null（调用方回 400）。 */
const cookieFromBodyOrCache = (body) => {
  const c = body?.cookie && body.cookie.trim() ? parseCookies(body.cookie) : null;
  return c || readCookieCache();
};

// 四个同步动作（同步耗时较长，请求期间页面显示「正在同步…」）。fetch* 内部已写入 data/*.json。
const syncLibraryHandler = (req, res) =>
  runSync(req, res, {
    kind: SYNC_KINDS.LIBRARY,
    label: '数据库',
    run: (_, onProgress) => fetchLibrary(onProgress), // fetchLibrary 内部已做图片本地化（与 wiki 更新绑定）
  });

const syncCharactersHandler = (req, res) =>
  runSync(req, res, {
    kind: SYNC_KINDS.CHARACTERS,
    label: '我的角色',
    needBody: true,
    progressShape: 'count',
    cacheOnBodyCookie: true,
    resolveCookies: cookieFromBodyOrCache,
    emptyCookieError: '没有可用的 cookie：请先在页面粘贴，或先运行 node sync-characters.js',
    run: async (cookies, onProgress) => {
      const s = await fetchMyCharacters(cookies, onProgress);
      await localizeDataFiles(); // 图片本地化，避免账号角色图片回到远程
      return s;
    },
  });

const syncWorkshopHandler = (req, res) =>
  runSync(req, res, {
    kind: SYNC_KINDS.WORKSHOP,
    label: '工坊配装',
    run: (_, onProgress) => fetchWorkshopData(onProgress),
  });

const syncPlansHandler = (req, res) =>
  runSync(req, res, {
    kind: SYNC_KINDS.PLANS,
    label: '推荐方案',
    needBody: true,
    progressShape: 'count',
    cacheOnBodyCookie: true,
    resolveCookies: cookieFromBodyOrCache,
    emptyCookieError: '没有可用的 cookie：请先在「同步数据」弹窗里粘贴 cookie',
    run: (cookies, onProgress) => fetchAllPlans(cookies, {}, onProgress),
  });

// ---------------- 路由 ----------------

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    // 所有写请求先挡跨站来源（CSRF）：读接口不含敏感数据，无需拦截
    if (req.method === 'POST' && isCrossSite(req)) return respond(res, 403, { ok: false, error: '跨站请求已拒绝' });
    // 路由统一用 ASCII，避免中文路径被浏览器百分号编码后匹配失败
    if (req.method === 'POST' && url === '/api/sync-base') return await syncLibraryHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-characters') return await syncCharactersHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-plans') return await syncPlansHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-workshop') return await syncWorkshopHandler(req, res);
    if (req.method === 'GET' && url === '/api/data') return sendData(req, res);
    if (req.method === 'GET' && url === '/api/cookie-status')
      return respond(res, 200, { ok: true, cached: !!readCookieCache() });
    if (req.method === 'GET' && url === '/api/sync-progress')
      return respond(res, 200, { ok: true, progress: syncState });
    if (req.method === 'GET' && url === '/api/sync-status') {
      // 不回传 cookie 明文：任何能访问本服务的进程都能读到它，等同泄漏米游社登录态。
      // 前端只需要知道「是否已缓存」，需要更换时重新粘贴即可。
      return respond(res, 200, {
        ok: true,
        cached: !!readCookieCache(),
        files: {
          library: mtimeOf('library.json'),
          characters: mtimeOf('characters.json'),
          plans: mtimeOf('plans.json'),
          workshop: mtimeOf('workshop.json'),
          workshopGrad: mtimeOf('workshop-grad.json'),
        },
      });
    }
    if (req.method === 'GET' && url === '/api/config') {
      const config = readDataJson('user-config.json', null);
      return respond(res, 200, { ok: true, config: config || { charTargets: {}, validStats: {} } });
    }
    if (req.method === 'POST' && url === '/api/config') {
      const body = await readBody(req);
      const config = body.config || { charTargets: {}, validStats: {} };
      if (typeof config !== 'object' || Array.isArray(config))
        return respond(res, 400, { ok: false, error: 'config 必须是对象' });
      // 原子写：直接覆盖时若进程在写入中途退出，会截断用户的目标/备注配置
      const dir = path.join(ROOT, 'data');
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, 'user-config.json.tmp');
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8');
      fs.renameSync(tmp, path.join(dir, 'user-config.json'));
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

// 进程级兜底：同步任务里的异步抛错若逃出 per-request try，会直接杀掉服务器
process.on('unhandledRejection', (e) => console.error('未处理的 Promise 拒绝:', e));
process.on('uncaughtException', (e) => console.error('未捕获异常:', e));

server.listen(PORT, HOST, () => {
  console.log(`\n  绝区零配装面板 本地服务器已启动`);
  console.log(`  浏览器打开: http://localhost:${PORT}`);
  console.log(`  网页上「更新数据库/我的角色/推荐方案/工坊配装」即为一键更新；cookie 会缓存在 data/.cookie.json`);
  console.log(`  按 Ctrl+C 停止\n`);
  openBrowser(`http://localhost:${PORT}`);
});
