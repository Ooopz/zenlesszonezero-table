// server.js —— 本地服务器
// 服务页面与前端模块 + 四个同步接口（账号接口 CORS 受限，浏览器直连不了，必须经本地服务器代理）
// + /api/data 读取 data/*.json + cookie 缓存到本地文件。运行：npm start → http://localhost:8719

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './src/lib/node.js';
import { parseCookies } from './src/lib/util.js';
import { SYNC_KINDS } from './src/lib/constants.js';

const PORT = process.env.PORT || 8719;
// 仅监听回环地址：data/ 下有明文 cookie 与个人配置，绝不能暴露到局域网；
// 对外绑定（HOST=0.0.0.0）时必须设 AUTH_TOKEN，否则拒绝启动（见文末校验）
const HOST = process.env.HOST || '127.0.0.1';
/** 绑定地址是否为回环（决定是否强制鉴权 / 是否自动开浏览器） */
const IS_LOOPBACK = HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost';
/** 访问令牌：非回环绑定时必填。请求带 ?token= 或 X-Auth-Token 头或 zzz_token cookie 均可 */
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
/** 额外放行的写请求来源（部署到域名后浏览器会带真实 Origin）。逗号分隔，如 https://zzz.example.com */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
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

/** 静态资源 gzip：只压文本类（字体/图片已压缩，压了白费 CPU）；结果按「路径:mtime」缓存复用 */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.md', '.txt']);
const gzipCache = new Map();
function gzipFor(realPath, mtimeMs, data) {
  const key = realPath + ':' + mtimeMs;
  let gz = gzipCache.get(key);
  if (!gz) {
    gz = zlib.gzipSync(data, { level: 6 });
    // 防缓存无限增长（文件更新时按 mtime 换键，旧键顺手清掉）
    if (gzipCache.size > 200) gzipCache.clear();
    gzipCache.set(key, gz);
  }
  return gz;
}

/** 简易「正在同步」互斥锁，避免两个同步同时写数据文件 */
let busy = null;
/** 抢到锁的时刻（ms），用于残留锁自愈判定 */
let busySince = 0;
/** 锁最长持有时间：工坊全量爬取可达数小时，取 6h 作为「进程已异常」的判定线 */
const BUSY_MAX_MS = 6 * 60 * 60 * 1000;
/** 同步进度（供 /api/sync-progress 轮询），空闲时为 null */
let syncState = null;

// ---------------- 同步模块懒加载 ----------------
// 同步模块在**模块加载时**就读 library.json 建名称索引；启动时静态 import 会把索引冻结在那一刻，
// 更新 library 后新角色名解析不出来，必须重启。故改为每次同步时动态 import 并按 mtime 失效缓存。
let syncModsCache = null;
function libraryMtime() {
  try {
    return fs.statSync(path.join(ROOT, 'data', 'library.json')).mtimeMs;
  } catch {
    return 0;
  }
}
async function loadSyncMods() {
  const mtime = libraryMtime();
  if (syncModsCache && syncModsCache.mtime === mtime) return syncModsCache.mods;
  // library.json 变了就换一个 URL query 强制重新求值模块（ESM 模块缓存按 URL 去重）
  const v = mtime ? `?v=${mtime}` : '';
  const [library, characters, plans, workshop] = await Promise.all([
    import(`./src/sync/library.js${v}`),
    import(`./src/sync/characters.js${v}`),
    import(`./src/sync/plans.js${v}`),
    import(`./src/sync/workshop.js${v}`),
  ]);
  const mods = { library, characters, plans, workshop };
  syncModsCache = { mtime, mods };
  return mods;
}
/** cookie 缓存读写要在同步之外单独用（/api/cookie 等），走同一份懒加载 */
const charactersMod = () => loadSyncMods().then((m) => m.characters);

// ---------------- 静态文件 ----------------

/** 静态资源白名单：data/ 下只放行 data/img/——data/.cookie.json 是明文登录态、data/*.json 是个人数据，
 *  同在 ROOT 下，只查「路径在 ROOT 内」就会被直接下载。 */
function isServable(relPath) {
  const parts = relPath.split(path.sep).filter(Boolean);
  // 任意一段以 . 开头的隐藏文件/目录（.cookie.json / .git 等）
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
    // 协商缓存：no-cache + Last-Modified 条件请求——未变时回 304 空响应；
    // 字体/echarts 等静态资源合计 ~19MB，no-store 下每次刷新都全量重下
    fs.stat(realPath, (sErr, st) => {
      if (sErr) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      const lastMod = st.mtime.toUTCString();
      if (req.headers['if-modified-since'] === lastMod) {
        res.writeHead(304, { 'Last-Modified': lastMod, 'Cache-Control': 'no-cache' });
        return res.end();
      }
      fs.readFile(realPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          return res.end('Not Found');
        }
        const headers = {
          'Content-Type': MIME[path.extname(realPath)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Last-Modified': lastMod,
        };
        // 文本类静态资源按 Accept-Encoding gzip 下发，减少首屏传输
        // Content-Encoding/Length 必须在 writeHead 之前设好（writeHead 发送的是调用时刻的快照）
        const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        if (wantsGzip && COMPRESSIBLE.has(path.extname(realPath))) {
          const gz = gzipFor(realPath, st.mtimeMs, data);
          headers['Content-Encoding'] = 'gzip';
          headers['Content-Length'] = gz.length;
          res.writeHead(200, headers);
          return res.end(gz);
        }
        headers['Content-Length'] = data.length;
        res.writeHead(200, headers);
        res.end(data);
      });
    });
  });
}

// ---------------- API ----------------

/** 客户端错误：带 status 标记，顶层 catch 映射成 4xx——回 500 会误导排查方向，
 *  且每个畸形请求都会打带栈日志（可被外部触发刷屏）。 */
function badRequest(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Buffer 收集后统一解码：逐块 toString('utf8') 会把跨 TCP 分片的中文切成乱码
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // 只 pause 不 destroy：destroy 会拆掉 socket，413 响应发不出去，客户端看到的是连接重置
        req.pause();
        return reject(badRequest(413, '请求体过大'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(badRequest(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 拒绝跨站写请求：简单请求（text/plain）无预检，恶意页面可静默 POST 覆盖 user-config.json 或写入 cookie；
 *  攻击者读不到响应，但写入已经发生。 */
function isCrossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false; // 非浏览器发起（curl / 同源导航）
  if (ALLOWED_ORIGINS.has(origin)) return false; // 部署到域名后由 ALLOWED_ORIGINS 显式放行
  try {
    const { hostname, host } = new URL(origin);
    // 本机开发：回环地址一律放行（端口任意）
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1')
      return false;
    // 部署形态：Origin 与 Host 头一致即为同源（原实现一律判跨站 → 部署后所有 POST 全 403）
    return host !== req.headers.host;
  } catch {
    return true;
  }
}

/** 访问令牌校验（仅在设了 AUTH_TOKEN 时生效）。令牌来源：Cookie > 请求头 > query。
 *  用 timingSafeEqual 防逐字节比较的时序侧信道。 */
function tokenOf(req) {
  const c = req.headers.cookie || '';
  const m = /(?:^|;\s*)zzz_token=([^;]+)/.exec(c);
  if (m) return decodeURIComponent(m[1]);
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']);
  const q = req.url.split('?')[1];
  if (q) {
    const t = new URLSearchParams(q).get('token');
    if (t) return t;
  }
  return '';
}
function isAuthed(req) {
  if (!AUTH_TOKEN) return true; // 未配置令牌（回环本机使用）= 不鉴权，行为与此前完全一致
  const got = Buffer.from(tokenOf(req));
  const want = Buffer.from(AUTH_TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function respond(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** 数据文件最后修改时间（ms；不存在返回 null） */
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

/** 前端不读的 plans 字段：desc 是大段攻略正文，占体积一多半，剥离后 /api/data 负载显著变小 */
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
  // ⚠️ ETag 必须是响应内容的哈希：原实现误用 dataSignature().length（恒为 132 的常数），
  // 数据变化也命中 304，前端永远拿到旧数据
  const etag = `W/"${crypto.createHash('sha1').update(raw).digest('base64url')}"`;
  return { raw, gzip: zlib.gzipSync(raw, { level: 6 }), etag };
}

/** /api/data：解析结果按 mtime 缓存，命中 ETag 直接 304（原实现每请求同步读解 ~33MB、阻塞事件循环） */
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
 *  progressShape：'step' = {step,done,total}（library/workshop）；'count' = (done,total)（characters/plans）。 */
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
  if (busy) {
    // 死锁自愈：busy 只在 finally 里清，进程若在同步中途被 uncaughtException 兜住（不退出进程），
    // 锁会永远留着，此后所有同步都 409，只能重启。超过阈值视为上一轮已经死了，放行并夺锁。
    const heldFor = Date.now() - busySince;
    if (heldFor < BUSY_MAX_MS) return respond(res, 409, { ok: false, error: '已有同步进行中，请稍候' });
    console.warn(`[同步锁] 「${busy}」已持有 ${(heldFor / 60000).toFixed(0)} 分钟，判定为残留锁，强制释放`);
  }
  // 必须在任何 await 之前抢锁：readBody 是异步的，若在其之后置位，
  // 两个并发同步请求会双双通过上面的检查，同时写 data/*.json。
  busy = label;
  busySince = Date.now();
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
    const cookies = await resolveCookies(body);
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
    if (cacheOnBodyCookie && body?.cookie && body.cookie.trim()) (await charactersMod()).cacheCookies(cookies);
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
const cookieFromBodyOrCache = async (body) => {
  const c = body?.cookie && body.cookie.trim() ? parseCookies(body.cookie) : null;
  return c || (await charactersMod()).readCookieCache();
};

// 四个同步动作：fetch* 内部已写入 data/*.json；run 统一走 loadSyncMods()（按 library mtime 失效缓存，见上）
const syncLibraryHandler = (req, res) =>
  runSync(req, res, {
    kind: SYNC_KINDS.LIBRARY,
    label: '数据库',
    run: async (_, onProgress) => (await loadSyncMods()).library.fetchLibrary(onProgress), // 内部已做图片本地化（与 wiki 更新绑定）
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
      const mods = await loadSyncMods();
      const s = await mods.characters.fetchMyCharacters(cookies, onProgress);
      await mods.library.localizeDataFiles(); // 图片本地化，避免账号角色图片回到远程
      return s;
    },
  });

const syncWorkshopHandler = (req, res) =>
  runSync(req, res, {
    kind: SYNC_KINDS.WORKSHOP,
    label: '工坊配装',
    run: async (_, onProgress) => (await loadSyncMods()).workshop.fetchWorkshopData(onProgress),
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
    run: async (cookies, onProgress) => (await loadSyncMods()).plans.fetchAllPlans(cookies, {}, onProgress),
  });

// ---------------- 路由 ----------------

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    // /login：把 ?token= 写进 cookie 后跳首页（只需一次）。
    // 必须在鉴权判定之前处理：token 在 query 里时 isAuthed 已为真，放后面会直接跳转而不种 cookie
    if (req.method === 'GET' && url === '/login') {
      const t = new URLSearchParams(req.url.split('?')[1] || '').get('token') || '';
      const headers = { Location: '/' };
      // 只在令牌正确时种 cookie；错误令牌静默跳首页（由首页请求回 401），不做区分提示以免成为探测口
      if (AUTH_TOKEN && t === AUTH_TOKEN) {
        headers['Set-Cookie'] =
          `zzz_token=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
      }
      res.writeHead(302, headers);
      return res.end();
    }
    // 鉴权（仅设了 AUTH_TOKEN 时生效）：未通过的请求连静态资源都拿不到
    if (!isAuthed(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('需要访问令牌：请访问 /login?token=<AUTH_TOKEN>');
    }
    // 所有写请求先挡跨站来源（CSRF）：读接口不含敏感数据，无需拦截
    if (req.method === 'POST' && isCrossSite(req)) return respond(res, 403, { ok: false, error: '跨站请求已拒绝' });
    // 路由统一用 ASCII，避免中文路径被浏览器百分号编码后匹配失败
    if (req.method === 'POST' && url === '/api/sync-base') return await syncLibraryHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-characters') return await syncCharactersHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-plans') return await syncPlansHandler(req, res);
    if (req.method === 'POST' && url === '/api/sync-workshop') return await syncWorkshopHandler(req, res);
    if (req.method === 'GET' && url === '/api/data') return sendData(req, res);
    if (req.method === 'GET' && url === '/api/cookie-status')
      return respond(res, 200, {
        ok: true,
        cached: !!(await charactersMod()).readCookieCache(),
        savedAt: mtimeOf('.cookie.json'),
      });
    if (req.method === 'GET' && url === '/api/sync-progress')
      return respond(res, 200, { ok: true, progress: syncState });
    if (req.method === 'GET' && url === '/api/sync-status') {
      // 不回传 cookie 明文：任何能访问本服务的进程都能读到它，等同泄漏米游社登录态。
      // 前端只需要知道「是否已缓存 + 保存时间」，需要更换时重新粘贴即可。
      return respond(res, 200, {
        ok: true,
        cached: !!(await charactersMod()).readCookieCache(),
        cookieSavedAt: mtimeOf('.cookie.json'),
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
      (await charactersMod()).cacheCookies(c);
      return respond(res, 200, { ok: true, cached: true });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    respond(res, 405, { ok: false, error: 'Method Not Allowed' });
  } catch (e) {
    // 客户端错误（非法 JSON / 体过大）回 4xx 且不打栈：外部可随意触发，不该刷屏日志
    if (e.status) return respond(res, e.status, { ok: false, error: e.message });
    console.error('处理请求出错:', e);
    respond(res, 500, { ok: false, error: e.message });
  }
});

// 进程级兜底：同步任务里的异步抛错若逃出 per-request try，会直接杀掉服务器
process.on('unhandledRejection', (e) => console.error('未处理的 Promise 拒绝:', e));
process.on('uncaughtException', (e) => console.error('未捕获异常:', e));

// 「对外暴露」与「无鉴权」不允许同时成立：data/ 下是明文米游社 cookie 与个人账号数据。
// 拒绝启动而不是打印警告——警告在后台运行时没人会看到。
if (!IS_LOOPBACK && !AUTH_TOKEN) {
  console.error(
    `\n  拒绝启动：HOST=${HOST} 会把服务暴露到本机之外，但未设置 AUTH_TOKEN。\n` +
      `  data/ 下有明文米游社 cookie 与个人账号数据，必须加访问令牌：\n` +
      `      AUTH_TOKEN=$(openssl rand -hex 16) HOST=${HOST} npm start\n` +
      `  然后浏览器访问 http://<地址>:${PORT}/login?token=<令牌> 写入 cookie（只需一次）。\n` +
      `  若部署在域名后，另设 ALLOWED_ORIGINS=https://你的域名 放行写请求。\n`
  );
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  绝区零配装面板 服务器已启动`);
  console.log(`  监听: http://${HOST}:${PORT}${IS_LOOPBACK ? '' : '（对外可访问）'}`);
  if (AUTH_TOKEN) console.log(`  已启用访问令牌，首次访问: /login?token=<AUTH_TOKEN>`);
  console.log(`  网页上「更新数据库/我的角色/推荐方案/工坊配装」即为一键更新；cookie 会缓存在 data/.cookie.json`);
  console.log(`  按 Ctrl+C 停止\n`);
  // 服务器环境（非回环绑定 / 无桌面 / 显式 NO_OPEN）不弹浏览器：headless 下 openBrowser
  // 会留下僵尸进程或直接报错
  if (IS_LOOPBACK && !process.env.NO_OPEN) openBrowser(`http://localhost:${PORT}`);
});

// 优雅退出：SIGTERM（systemd/docker stop）若直接终止，正在写 data/*.json 会留下半个文件；
// 这里停止收新连接并给在途请求 10s 收尾。
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (shuttingDown) return; // 连按两次 Ctrl+C 直接走默认行为
    shuttingDown = true;
    console.log(`\n收到 ${sig}，停止接收新请求…${busy ? `（正在同步「${busy}」，等待收尾）` : ''}`);
    server.close(() => {
      console.log('已关闭');
      process.exit(0);
    });
    setTimeout(() => {
      console.warn('超时未收尾，强制退出');
      process.exit(1);
    }, 10_000).unref();
  });
}
