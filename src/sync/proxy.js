// src/sync/proxy.js —— 零依赖代理支持（HTTP CONNECT / SOCKS5 隧道），仅 Node 使用
// Node 内置 fetch 不读代理环境变量（Node 24+ 才有 --use-env-proxy），故手动实现隧道并包全局 fetch：
// 仅目标主机匹配 applyHosts（默认 *.zzzmap.com）走代理，其余走原生 fetch。
// 用法：命令行第 5 参 > HTTPS_PROXY > ALL_PROXY > HTTP_PROXY；http(s) 支持 Basic、socks5 支持 RFC1929 认证；每次请求新建一条隧道。
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { URL } from 'node:url';

const DEFAULT_APPLY_HOSTS = [/(^|\.)zzzmap\.com$/];
const TUNNEL_TIMEOUT = 15000;
const REQUEST_TIMEOUT = 120000; // 单请求整体超时（原生 fetch 无默认超时，这里兜底防代理挂起）
const ORIGINAL = Symbol('proxy.originalFetch'); // 全局 fetch 原文存储位（防二次包装）

/** 取代理地址：cliValue（命令行第 5 参）优先，其次标准环境变量 */
export function resolveProxyUrl(cliValue) {
  return (
    cliValue ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    null
  );
}

/** 日志用：隐藏代理 URL 里的密码 */
export function maskProxyUrl(url) {
  try {
    const p = new URL(url);
    const cred = p.username ? 'user:***@' : '';
    return `${p.protocol}//${cred}${p.hostname}${p.port ? ':' + p.port : ''}`;
  } catch {
    return String(url);
  }
}

// ---------- 顺序读取器（带遗留缓冲） ----------
// 响应头/体可能落在同一 TCP 分片：逐次 readUntil/readN 监听会丢字节，必须统一持有 socket 监听与未消费缓冲。

class Reader {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiting = null; // {kind:'n',n} | {kind:'until',marker}，挂起的读取
    this.endWaiter = null;
    this.closed = false;
    this._onData = (c) => {
      this.buf = Buffer.concat([this.buf, c]);
      this._drain();
    };
    this._onEnd = () => this._finish();
    this._onClose = () => this._finish();
    this._onError = (e) => this._finish(e);
    socket.on('data', this._onData);
    socket.once('end', this._onEnd);
    socket.once('close', this._onClose);
    socket.once('error', this._onError);
  }

  /** 移除本 Reader 的监听（HTTPS 包 TLS 前调用，之后字节归 TLS 层） */
  detach() {
    this.socket.removeListener('data', this._onData);
    this.socket.removeListener('end', this._onEnd);
    this.socket.removeListener('close', this._onClose);
    this.socket.removeListener('error', this._onError);
  }

  _finish(err) {
    if (this.closed) return;
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.reject(err || new Error('连接提前关闭'));
    } else if (this.endWaiter) {
      const w = this.endWaiter;
      this.endWaiter = null;
      const out = this.buf;
      this.buf = Buffer.alloc(0);
      w.resolve(out);
    }
  }

  _drain() {
    for (;;) {
      if (this.waiting) {
        const w = this.waiting;
        if (w.kind === 'n') {
          if (this.buf.length < w.n) return;
          this.waiting = null;
          const out = this.buf.subarray(0, w.n);
          this.buf = this.buf.subarray(w.n);
          w.resolve(out);
        } else {
          const i = this.buf.indexOf(w.marker);
          if (i < 0) return;
          this.waiting = null;
          const out = this.buf.subarray(0, i + w.marker.length);
          this.buf = this.buf.subarray(i + w.marker.length);
          w.resolve(out);
        }
      } else if (this.endWaiter && this.closed) {
        // 数据到齐后连接才关闭：先把缓冲交给 endWaiter
        const w = this.endWaiter;
        this.endWaiter = null;
        const out = this.buf;
        this.buf = Buffer.alloc(0);
        w.resolve(out);
        return;
      } else {
        return;
      }
    }
  }

  _wait(w) {
    if (this.closed) return Promise.reject(new Error('连接提前关闭'));
    if (this.waiting) return Promise.reject(new Error('并发读取不支持'));
    const p = new Promise((resolve, reject) => {
      w.resolve = resolve;
      w.reject = reject;
    });
    this.waiting = w;
    this._drain();
    return p;
  }

  readN(n) {
    if (n === 0) return Promise.resolve(Buffer.alloc(0));
    return this._wait({ kind: 'n', n });
  }

  /** 读到 marker（含 marker）为止 */
  readUntil(marker) {
    return this._wait({ kind: 'until', marker: Buffer.from(marker) });
  }

  /** 读一行（含 \r\n） */
  readLine() {
    return this.readUntil('\r\n');
  }

  /** 读到连接关闭为止（无 content-length 的响应体） */
  readToEnd() {
    if (this.closed) {
      const out = this.buf;
      this.buf = Buffer.alloc(0);
      return Promise.resolve(out);
    }
    if (this.endWaiter) return Promise.reject(new Error('并发读取不支持'));
    const p = new Promise((resolve, reject) => {
      this.endWaiter = { resolve, reject };
    });
    this._drain();
    return p;
  }
}

// ---------- 隧道建立 ----------

function httpConnectHandshake(reader, p, host, port) {
  const auth = p.username
    ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password || '')}`).toString('base64')}\r\n`
    : '';
  reader.socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
  return reader.readUntil('\r\n\r\n').then((raw) => {
    const head = raw.toString('latin1');
    const m = /^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(head);
    const status = m ? Number(m[1]) : 0;
    if (status !== 200) {
      throw new Error(
        `代理 CONNECT 失败: HTTP ${status || '响应解析失败'}${status === 407 ? '（代理要求认证，请在代理 URL 里带 user:pass）' : ''}`
      );
    }
  });
}

/** SOCKS5 握手（RFC1929 用户名密码认证，目标地址用域名） */
async function socks5Handshake(reader, p, host, port) {
  const hasAuth = !!(p.username || p.password);
  reader.socket.write(Buffer.from([0x05, 0x01, hasAuth ? 0x02 : 0x00]));
  const g = await reader.readN(2);
  if (g[0] !== 0x05) throw new Error('SOCKS5 握手失败: 版本错误');
  const method = g[1];
  if (method === 0xff) throw new Error('SOCKS5 代理拒绝所有认证方式');
  if (method === 0x02) {
    if (!hasAuth) throw new Error('SOCKS5 代理要求认证，请在代理 URL 里带 user:pass');
    const user = Buffer.from(decodeURIComponent(p.username), 'utf8');
    const pass = Buffer.from(decodeURIComponent(p.password || ''), 'utf8');
    reader.socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
    const a = await reader.readN(2);
    if (a[0] !== 0x01 || a[1] !== 0x00) throw new Error('SOCKS5 认证失败（用户名/密码错误）');
  } else if (method !== 0x00) {
    throw new Error(`SOCKS5 代理要求未知认证方式 ${method}`);
  }
  const hostBuf = Buffer.from(host, 'utf8');
  reader.socket.write(
    Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
      hostBuf,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ])
  );
  const head = await reader.readN(4);
  if (head[0] !== 0x05) throw new Error('SOCKS5 连接失败: 版本错误');
  if (head[1] !== 0x00) throw new Error(`SOCKS5 连接被拒: rep=${head[1]}`);
  const atyp = head[3];
  if (atyp === 0x03) {
    const lenByte = await reader.readN(1);
    await reader.readN(lenByte[0] + 2);
  } else if (atyp === 0x01 || atyp === 0x04) {
    await reader.readN((atyp === 0x01 ? 4 : 16) + 2);
  } else {
    throw new Error(`SOCKS5 未知地址类型 ${atyp}`);
  }
}

/** 连到代理服务器，返回已连通的裸 socket */
function connectToProxy(proxyUrl) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = new URL(proxyUrl);
    } catch (e) {
      reject(new Error(`代理地址无效: ${proxyUrl}（${e.message}）`));
      return;
    }
    let socket;
    try {
      socket = net.connect({ host: p.hostname, port: Number(p.port) || 80 });
    } catch (e) {
      reject(e);
      return;
    }
    let settled = false;
    const fail = (msg) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(msg));
    };
    socket.setTimeout(TUNNEL_TIMEOUT, () => fail(`代理隧道超时: ${maskProxyUrl(proxyUrl)}`));
    socket.once('error', (e) => fail(`代理连接失败: ${e.message}`));
    socket.once('connect', () => {
      socket.setTimeout(0);
      socket.removeListener('error', fail);
      resolve(socket);
    });
  });
}

// ---------- 请求/响应 ----------

/** 读取完整 HTTP 响应（content-length / chunked / 读到关闭 三种都支持），返回 {status, statusText, headers, text} */
async function readHttpResponse(reader, socket) {
  const timer = setTimeout(() => socket.destroy(), REQUEST_TIMEOUT);
  try {
    const headBuf = await reader.readUntil('\r\n\r\n');
    const headStr = headBuf.toString('latin1');
    const lines = headStr.split('\r\n');
    const m = /^HTTP\/\d(?:\.\d)?\s+(\d+)(?:\s+(.*))?$/.exec(lines[0] || '');
    if (!m) throw new Error(`非 HTTP 响应: ${(lines[0] || '').slice(0, 60)}`);
    const status = Number(m[1]);
    const statusText = m[2] || '';
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
    }
    let body = Buffer.alloc(0);
    const te = (headers['transfer-encoding'] || '').toLowerCase();
    const cl = Number(headers['content-length']);
    if (te.includes('chunked')) {
      for (;;) {
        const sizeLine = (await reader.readLine()).toString('latin1').trim();
        const size = parseInt(sizeLine.split(';')[0], 16);
        if (!Number.isFinite(size)) throw new Error('分块响应解析失败');
        if (size === 0) {
          for (;;) {
            const t = await reader.readLine();
            if (t.length === 2) break; // 空行 = 结束
          }
          break;
        }
        body = Buffer.concat([body, await reader.readN(size)]);
        await reader.readLine(); // 块尾 CRLF
      }
    } else if (Number.isFinite(cl) && cl >= 0) {
      body = await reader.readN(cl);
    } else {
      body = await reader.readToEnd();
    }
    const enc = (headers['content-encoding'] || '').toLowerCase();
    try {
      if (enc.includes('gzip')) body = zlib.gunzipSync(body);
      else if (enc.includes('deflate')) body = zlib.inflateSync(body);
      else if (enc.includes('br')) body = zlib.brotliDecompressSync(body);
    } catch {
      // 解压失败保留原文（与原生 fetch 行为差异可接受，工坊接口正常不压缩）
    }
    return { status, statusText, headers, text: body.toString('utf8') };
  } finally {
    clearTimeout(timer);
    socket.destroy(); // 单请求一隧道，读完即关
  }
}

/** 经代理发一次完整请求（opts 兼容 fetch 的 method/headers/body），返回 {ok, status, statusText, headers, text()} */
async function proxyRequest(proxyUrl, u, opts) {
  const isHttps = u.protocol === 'https:';
  const port = Number(u.port) || (isHttps ? 443 : 80);
  let p;
  try {
    p = new URL(proxyUrl);
  } catch (e) {
    throw new Error(`代理地址无效: ${proxyUrl}（${e.message}）`, { cause: e });
  }
  const socket = await connectToProxy(proxyUrl);
  const reader = new Reader(socket);
  const isSocks = p.protocol === 'socks5:' || p.protocol === 'socks5h:';
  await (isSocks ? socks5Handshake : httpConnectHandshake)(reader, p, u.hostname, port);
  let reqSocket = socket;
  if (isHttps) {
    reader.detach(); // 之后的字节是 TLS 密文，归 TLS 层处理
    reqSocket = tls.connect({ socket, servername: u.hostname });
    await new Promise((resolve, reject) => {
      reqSocket.once('secureConnect', resolve);
      reqSocket.once('error', reject);
    });
  }
  const respReader = isHttps ? new Reader(reqSocket) : reader;
  const body = opts.body != null ? Buffer.from(opts.body) : null;
  let head = `${opts.method || 'GET'} ${u.pathname || '/'}${u.search} HTTP/1.1\r\n`;
  head += `Host: ${u.host}\r\n`;
  for (const [k, v] of Object.entries(opts.headers || {})) head += `${k}: ${v}\r\n`;
  if (body) head += `Content-Length: ${body.length}\r\n`;
  head += '\r\n';
  reqSocket.write(head);
  if (body) reqSocket.write(body);
  const resp = await readHttpResponse(respReader, reqSocket);
  return {
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
    async text() {
      return resp.text;
    },
  };
}

/** 包全局 fetch：目标主机匹配 applyHosts 才走代理，其余用原生 fetch；可重复调用（以真正原生 fetch 为底重新包装），返回原 fetch 便于恢复 */
export function installProxyFetch(proxyUrl, { applyHosts = DEFAULT_APPLY_HOSTS } = {}) {
  const originalFetch = globalThis[ORIGINAL] || globalThis.fetch;
  globalThis[ORIGINAL] = originalFetch;
  globalThis.fetch = function proxyFetch(input, opts = {}) {
    let u;
    try {
      u = input instanceof URL ? input : new URL(String(input));
    } catch {
      return originalFetch(input, opts);
    }
    if (!applyHosts.some((re) => re.test(u.hostname))) return originalFetch(input, opts);
    return proxyRequest(proxyUrl, u, opts);
  };
  return originalFetch;
}
