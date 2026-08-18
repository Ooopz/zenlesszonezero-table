// scripts/fetch-fonts.mjs —— 下载 OFL 开源字体（Barlow Condensed 西文展示体 + Noto Sans SC 中文可变体）到 src/fonts/
// 用法：node scripts/fetch-fonts.mjs [proxyHost] [proxyPort]；默认走本地代理 127.0.0.1:7897
// （Windows 沙箱 Schannel 拿不到凭据、undici 不认环境代理，故手写 HTTP CONNECT 隧道 + OpenSSL 栈，最稳）
import net from 'node:net';
import tls from 'node:tls';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'src', 'fonts');
const PROXY_HOST = process.argv[2] || '127.0.0.1';
const PROXY_PORT = Number(process.argv[3] || 7897);

const FILES = [
  { n: 'BarlowCondensed-SemiBold.ttf', u: 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/BarlowCondensed-SemiBold.ttf' },
  { n: 'BarlowCondensed-Bold.ttf', u: 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/BarlowCondensed-Bold.ttf' },
  { n: 'BarlowCondensed-Black.ttf', u: 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/BarlowCondensed-Black.ttf' },
  { n: 'NotoSansSC-Variable.ttf', u: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf' },
  { n: 'OFL-BarlowCondensed.txt', u: 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/OFL.txt' },
  { n: 'OFL-NotoSansSC.txt', u: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt' },
];

/** 经 HTTP CONNECT 代理做一次 HTTPS GET，返回 { status, body(Buffer) } */
function httpsGetViaProxy(host, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PROXY_PORT, PROXY_HOST, () => {
      socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
    });
    let headBuf = '';
    let done = false;
    const fail = (e) => { if (!done) { done = true; socket.destroy(); reject(e); } };
    socket.setTimeout(30000, () => fail(new Error('socket timeout')));
    socket.on('error', fail);
    // TLS 客户端先行：代理在收到 ClientHello 前不会回传任何隧道字节，
    // 所以 CONNECT 响应头之外的字节不会在挂 TLS 前到达，可直接丢弃响应头。
    socket.on('data', (chunk) => {
      headBuf += chunk.toString('latin1');
      const idx = headBuf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const statusLine = headBuf.split('\r\n')[0];
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) return fail(new Error('CONNECT failed: ' + statusLine));
      socket.removeAllListeners('data');
      const tlsSock = tls.connect({ socket, servername: host });
      tlsSock.on('error', fail);
      tlsSock.on('secureConnect', () => {
        tlsSock.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });
      let res = Buffer.alloc(0);
      tlsSock.on('data', (d) => { res = Buffer.concat([res, d]); });
      tlsSock.on('end', () => {
        if (done) return;
        done = true;
        const sep = res.indexOf(Buffer.from('\r\n\r\n'));
        const head = res.subarray(0, sep).toString('latin1');
        const status = Number(head.split(' ')[1]);
        let body = res.subarray(sep + 4);
        const te = /transfer-encoding:\s*chunked/i.exec(head);
        if (te) {
          const out = [];
          let i = 0;
          while (i < body.length) {
            const nl = body.indexOf(Buffer.from('\r\n'), i);
            if (nl < 0) break;
            const size = parseInt(body.subarray(i, nl).toString('latin1').trim(), 16);
            if (!size || Number.isNaN(size)) break;
            out.push(body.subarray(nl + 2, nl + 2 + size));
            i = nl + 2 + size + 2;
          }
          body = Buffer.concat(out);
        }
        resolve({ status, body });
      });
    });
  });
}

function parseUrl(u) {
  const m = /^https:\/\/([^/]+)(\/.*)?$/.exec(u);
  return { host: m[1], path: m[2] || '/' };
}

await mkdir(DIR, { recursive: true });
for (const f of FILES) {
  const { host, path } = parseUrl(f.u);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      process.stdout.write(`downloading ${f.n} (attempt ${attempt}) ... `);
      const { status, body } = await httpsGetViaProxy(host, path);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      await writeFile(join(DIR, f.n), body);
      process.stdout.write(`${(body.length / 1024).toFixed(1)} KiB\n`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      process.stdout.write(`failed: ${e.message}\n`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (lastErr) throw lastErr;
}
console.log('done');
