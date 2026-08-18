// test/proxy.test.js —— 代理隧道自测（src/sync/proxy.js）
// 用本地 mock 目标服务器 + mock CONNECT/SOCKS5 代理端到端验证：content-length/chunked/gzip/POST/认证/主机过滤全覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { installProxyFetch, resolveProxyUrl, maskProxyUrl } from '../src/sync/proxy.js';

const PAYLOAD = JSON.stringify({ hello: '工坊', n: 42 });

/** 本地目标服务器：/json（content-length）、/chunked、/gzip、其余回显 method+body */
async function startTarget() {
  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      const buf = Buffer.from(PAYLOAD);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': buf.length });
      res.end(buf);
      return;
    }
    if (req.url === '/chunked') {
      res.writeHead(200, { 'transfer-encoding': 'chunked' });
      res.write('chunk-');
      res.write('one-');
      res.end('two');
      return;
    }
    if (req.url === '/gzip') {
      const buf = zlib.gzipSync(PAYLOAD);
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': buf.length });
      res.end(buf);
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const buf = Buffer.from(JSON.stringify({ url: req.url, method: req.method, body }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': buf.length });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

/** 关服务器：closeAllConnections 强制断开存量连接，避免 close 回调挂起 */
const closeServer = (s) =>
  new Promise((r) => {
    s.closeAllConnections?.();
    s.close(r);
  });

/** mock HTTP CONNECT 代理：可选要求 Proxy-Authorization */
async function startHttpProxy({ requireAuth = false } = {}) {
  const server = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let upstream = null;
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buf.subarray(0, idx).toString('latin1');
      buf = buf.subarray(idx + 4);
      const m = /^CONNECT\s+([^:\s]+):(\d+)/.exec(head);
      if (!m) {
        client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      if (requireAuth && !/Proxy-Authorization:\s*Basic\s+\S+/.test(head)) {
        client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        return;
      }
      upstream = net.connect(Number(m[2]), m[1]);
      upstream.on('connect', () => {
        client.off('data', onData); // 隧道已建立，后续字节交给 pipe，不再当 CONNECT 解析
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (buf.length) upstream.write(buf);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
    };
    client.on('data', onData);
    client.on('close', () => upstream?.destroy());
    client.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

/** mock SOCKS5 代理（无认证，支持域名连接） */
async function startSocks5Proxy() {
  const server = net.createServer((client) => {
    let stage = 0;
    let buf = Buffer.alloc(0);
    client.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 2) {
        const nm = buf[1];
        if (buf.length < 2 + nm) return;
        buf = buf.subarray(2 + nm);
        stage = 1;
        client.write(Buffer.from([0x05, 0x00])); // 无认证
        if (buf.length === 0) return;
      }
      if (stage === 1 && buf.length >= 4) {
        const atyp = buf[3];
        let addrLen;
        if (atyp === 0x03) {
          if (buf.length < 5) return;
          addrLen = 1 + buf[4] + 2;
        } else if (atyp === 0x01) addrLen = 4 + 2;
        else if (atyp === 0x04) addrLen = 16 + 2;
        else {
          client.destroy();
          return;
        }
        if (buf.length < 4 + addrLen) return;
        const port = buf.readUInt16BE(4 + addrLen - 2);
        const upstream = net.connect(port, '127.0.0.1');
        upstream.on('connect', () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, (port >> 8) & 0xff, port & 0xff]));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on('error', () => client.destroy());
        client.on('close', () => upstream.destroy());
        stage = 2;
      }
    });
    client.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

test('resolveProxyUrl：参数 > HTTPS_PROXY > ALL_PROXY > HTTP_PROXY', () => {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(resolveProxyUrl('cli'), 'cli');
    assert.equal(resolveProxyUrl(undefined), null);
    process.env.HTTPS_PROXY = 'https://h';
    process.env.ALL_PROXY = 'socks5://a';
    process.env.HTTP_PROXY = 'http://p';
    assert.equal(resolveProxyUrl(undefined), 'https://h');
    assert.equal(resolveProxyUrl('cli'), 'cli');
    delete process.env.HTTPS_PROXY;
    assert.equal(resolveProxyUrl(undefined), 'socks5://a');
    delete process.env.ALL_PROXY;
    assert.equal(resolveProxyUrl(undefined), 'http://p');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('maskProxyUrl 隐藏密码', () => {
  assert.equal(maskProxyUrl('http://user:secret@127.0.0.1:7890'), 'http://user:***@127.0.0.1:7890');
  assert.equal(maskProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
});

test('HTTP CONNECT 代理：JSON(content-length)/chunked/gzip/POST 全通', async () => {
  const target = await startTarget();
  const proxy = await startHttpProxy();
  try {
    installProxyFetch(`http://127.0.0.1:${proxy.port}`, { applyHosts: [/^127\.0\.0\.1$/] });
    const r = await fetch(`http://127.0.0.1:${target.port}/json`);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(await r.text()), JSON.parse(PAYLOAD));
    const c = await fetch(`http://127.0.0.1:${target.port}/chunked`);
    assert.equal(await c.text(), 'chunk-one-two');
    const g = await fetch(`http://127.0.0.1:${target.port}/gzip`);
    assert.deepEqual(JSON.parse(await g.text()), JSON.parse(PAYLOAD));
    const p = await fetch(`http://127.0.0.1:${target.port}/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', sign: 'abc', time: '123' },
      body: JSON.stringify({ a: 1 }),
    });
    const j = JSON.parse(await p.text());
    assert.equal(j.method, 'POST');
    assert.equal(j.body, '{"a":1}');
  } finally {
    await closeServer(target.server);
    await closeServer(proxy.server);
  }
});

test('HTTP 代理认证：缺凭证 407，带凭证通过', async () => {
  const target = await startTarget();
  const proxy = await startHttpProxy({ requireAuth: true });
  try {
    installProxyFetch(`http://127.0.0.1:${proxy.port}`, { applyHosts: [/^127\.0\.0\.1$/] });
    await assert.rejects(fetch(`http://127.0.0.1:${target.port}/json`), /CONNECT 失败: HTTP 407/);
    installProxyFetch(`http://user:pass@127.0.0.1:${proxy.port}`, { applyHosts: [/^127\.0\.0\.1$/] });
    const r = await fetch(`http://127.0.0.1:${target.port}/json`);
    assert.equal(r.ok, true);
  } finally {
    await closeServer(target.server);
    await closeServer(proxy.server);
  }
});

test('SOCKS5 代理（域名连接）', async () => {
  const target = await startTarget();
  const proxy = await startSocks5Proxy();
  try {
    installProxyFetch(`socks5://127.0.0.1:${proxy.port}`, { applyHosts: [/^127\.0\.0\.1$/] });
    const r = await fetch(`http://127.0.0.1:${target.port}/json`);
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(await r.text()), JSON.parse(PAYLOAD));
  } finally {
    await closeServer(target.server);
    await closeServer(proxy.server);
  }
});

test('主机过滤：非目标主机走原生 fetch（死代理无影响）；目标主机走代理（死代理即失败）', async () => {
  const target = await startTarget();
  try {
    // 默认 applyHosts = *.zzzmap.com，127.0.0.1 不匹配 → 原生 fetch 直连成功
    installProxyFetch('http://127.0.0.1:1'); // 代理端口 1 = 必然连不上
    const r = await fetch(`http://127.0.0.1:${target.port}/json`);
    assert.equal(r.ok, true);
    // 匹配目标主机 → 走死代理 → 报错
    installProxyFetch('http://127.0.0.1:1', { applyHosts: [/^127\.0\.0\.1$/] });
    await assert.rejects(fetch(`http://127.0.0.1:${target.port}/json`), /代理连接失败/);
  } finally {
    await closeServer(target.server);
  }
});
