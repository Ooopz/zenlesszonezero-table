// src/lib/node.js —— Node 专属工具（依赖 node:child_process / node:fs 等，不要被浏览器 import）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';
import { warnIfInvalid } from './schema.js';

/** 跨平台打开浏览器（Windows: start / macOS: open / Linux: xdg-open） */
export function openBrowser(url) {
  try {
    if (process.platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch {
    console.log(`  未能自动打开浏览器，请手动访问: ${url}`);
  }
}

// ---------- 同步脚本共用样板（三个 src/sync/* 脚本原各有一份，统一收敛于此） ----------

/** 项目根目录（本文件位于 src/lib/ 下，向上两级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** data/ 数据目录（同步脚本写 data/*.json 用） */
export const DATA_DIR = path.join(ROOT, 'data');

/** ESM 入口判断：仅当直接运行该脚本文件时执行 run()。
 *  用法：isMain(import.meta, () => main())；main 的异常由这里统一捕获并 exit(1)。 */
export function isMain(meta, run) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta.url))
    run().catch((e) => {
      console.error('运行出错:', e.message);
      process.exit(1);
    });
}

/** 并发池：最多 limit 个 worker 并行执行 fn(item, index)；结果按下标对齐返回，单任务失败返回 null（错误已打印）。
 *  onProgress 可选，每个任务结束后回调 (done, total)。library/characters/plans/workshop 四个同步脚本共用。 */
export async function pool(items, limit, fn, onProgress) {
  const ret = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
      while (next < items.length) {
        const i = next++;
        ret[i] = await fn(items[i], i).catch((e) => {
          console.error(`  ✗ 任务 ${i} 失败: ${e.message}`);
          return null;
        });
        done++;
        onProgress?.(done, items.length);
      }
    })
  );
  return ret;
}

/** 原子写 JSON（tmp + rename）：直接覆盖时若进程在写入中途退出/磁盘写满，
 *  会留下被截断的半个文件——这些文件是下游全部统计的输入，损坏后要重爬数小时才能恢复。
 *  工坊三件产物（workshop.json / workshop-grad.json / workshop-stats.json）与权重共用。 */
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** 校验 + 写入 data/ 下的 JSON 文件（sync 脚本收尾共用）。
 *  validate 提供校验函数时先 warnIfInvalid（strict 为 true 则抛错中断）；
 *  pretty 为 false 时用紧凑格式——library.json 嵌套 5 层，pretty 会膨胀到 ~11MB，紧凑仅 ~3.5MB。 */
export function writeDataFile(file, data, { label = '', validate = null, strict = false, pretty = true } = {}) {
  if (validate) warnIfInvalid(label, validate(data), { strict });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf-8');
}

/**
 * 流式读取「JSON 顶层数组」的元素（同步 generator）：每次只读一个文件块、逐字符解析，
 * yield 每个顶层元素的原始 JSON 字符串（调用方自行 JSON.parse）。
 *
 * 用于超大 JSON 数组文件（如 workshop.json 达 90 万+ 条、2.13GB）：一次性 fs.readFileSync +
 * JSON.stringify 会超过 V8 单字符串上限（Invalid string length，约 5.36 亿字符）并撑爆堆，
 * 流式读可处理任意大小。文件形如 `{"meta":{...},"entries":[elem1,elem2,...]}`——
 * 自动跳过 meta 定位 `"entries":[`，只 yield entries 数组内的元素。
 * @param {string} file  文件路径
 * @param {number} [chunkSize]  每次读取的字节数（默认 1MB）
 */
/** 解码 Buffer 前 n 字节到「最后一个完整 UTF-8 字符边界」：
 *  返回 { text, tail }——text 为可安全解码的字符串（无切断），tail 为可能跨块的尾部字节（≤3）交下块拼接。 */
function decodeUtf8Tail(buff, n) {
  let start = n - 1;
  while (start >= 0 && (buff[start] & 0xc0) === 0x80) start--; // 跳过续字节找起始字节
  if (start < 0) return { text: buff.toString('utf8', 0, n), tail: Buffer.alloc(0) };
  const b = buff[start];
  let len;
  if (b < 0x80) len = 1;
  else if ((b & 0xe0) === 0xc0) len = 2;
  else if ((b & 0xf0) === 0xe0) len = 3;
  else if ((b & 0xf8) === 0xf0) len = 4;
  else return { text: buff.toString('utf8', 0, n), tail: Buffer.alloc(0) }; // 非法起始字节：整体解码（toString 处理）
  if (start + len <= n) return { text: buff.toString('utf8', 0, n), tail: Buffer.alloc(0) }; // 最后字符完整
  return { text: buff.toString('utf8', 0, start), tail: Buffer.from(buff.subarray(start, n)) }; // 最后字符跨块 → 推迟
}

export function* streamJsonArrayElements(file, chunkSize = 1 << 20) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(chunkSize);
  // phase: 'head' 跳过 meta 找 `"entries":[`；'elem' 逐元素解析
  let st = { phase: 'head', headBuf: '', inStr: false, esc: false, depth: 0, started: false, elem: '' };
  let carry = Buffer.alloc(0); // 跨块 UTF-8 字符的尾部字节（与下块拼接后解码，避免切断中文产生 U+FFFD）
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, chunkSize, null);
      if (n <= 0) break;
      const combined = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      const { text, tail } = decodeUtf8Tail(combined, combined.length);
      carry = tail;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (st.phase === 'head') {
          st.headBuf += ch;
          if (st.headBuf.length > 64) st.headBuf = st.headBuf.slice(-64);
          if (st.headBuf.endsWith('"entries":[')) {
            st.phase = 'elem';
            st.headBuf = '';
          }
          continue;
        }
        // ---- phase 'elem'：解析顶层数组元素 ----
        if (st.inStr) {
          if (st.esc) st.esc = false;
          else if (ch === '\\') st.esc = true;
          else if (ch === '"') st.inStr = false;
          if (st.started) st.elem += ch;
          continue;
        }
        if (ch === '"') {
          st.inStr = true;
          if (st.started) st.elem += ch;
          continue;
        }
        if (ch === '{') {
          if (!st.started) {
            st.started = true;
            st.depth = 1;
            st.elem = '';
          } else st.depth++;
          st.elem += ch;
          continue;
        }
        if (ch === '}') {
          st.depth--;
          st.elem += ch;
          if (st.depth === 0 && st.started) {
            yield st.elem;
            st.started = false;
            st.elem = '';
          }
          continue;
        }
        if (ch === '[') {
          st.depth++;
          if (st.started) st.elem += ch;
          continue;
        }
        if (ch === ']') {
          if (!st.started && st.depth === 0) break; // 顶层数组结束（元素之间不会有 ']'，不会误触发）
          st.depth--;
          if (st.started) st.elem += ch;
          continue;
        }
        if (st.started) st.elem += ch;
      }
      // ⚠️ 不能在此检查「数组结束」：`!started && depth===0` 在「元素之间」（},{ 间隙）也为真，
      // 块边界恰好落在间隙时会把后续全部条目丢弃（曾致 60 万条文件只解析出 9 万）。
      // 数组结束已由上面 ']' 分支处理，此处不 break，while 靠 readSync 返回 0 自然结束。
    }
    // 文件末尾残留（≤3 字节，如结尾 `]}`）——正常文件为 ASCII，直接解码处理
    if (carry.length) {
      const text = carry.toString('utf8');
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (st.phase === 'head') {
          st.headBuf += ch;
          if (st.headBuf.endsWith('"entries":[')) {
            st.phase = 'elem';
            st.headBuf = '';
          }
          continue;
        }
        if (st.inStr) {
          if (st.esc) st.esc = false;
          else if (ch === '\\') st.esc = true;
          else if (ch === '"') st.inStr = false;
          if (st.started) st.elem += ch;
          continue;
        }
        if (ch === '"') {
          st.inStr = true;
          if (st.started) st.elem += ch;
          continue;
        }
        if (ch === '{') {
          if (!st.started) {
            st.started = true;
            st.depth = 1;
            st.elem = '';
          } else st.depth++;
          st.elem += ch;
          continue;
        }
        if (ch === '}') {
          st.depth--;
          st.elem += ch;
          if (st.depth === 0 && st.started) {
            yield st.elem;
            st.started = false;
            st.elem = '';
          }
          continue;
        }
        if (ch === '[') {
          st.depth++;
          if (st.started) st.elem += ch;
          continue;
        }
        if (ch === ']') {
          if (!st.started && st.depth === 0) break;
          st.depth--;
          if (st.started) st.elem += ch;
          continue;
        }
        if (st.started) st.elem += ch;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- workshop.json：分块 gzip（非固实）存储 ----------
// 内容仍是普通 JSON（entries 数组），但按固定条目数切成若干块、每块独立 gzip（非固实压缩：
// 任一块可独立解压/定位，读第 N 块无需解压前面的块）。文件布局：
//   第 0 行（JSON，以换行结尾）：{"meta":{...},"perChunk":20000,"offsets":[0,12345,...]}
//     offsets 为各 gzip 块相对「头部行之后」的字节偏移（读时 + 头部行长度即文件内绝对位置）
//   之后：N 个首尾相接的 gzip 流，第 i 块 = gzip(JSON.stringify(entries[i*perChunk .. (i+1)*perChunk)))
// 读取：头部一次解析 → 逐块 readSync 定长读 → gunzipSync → JSON.parse（整块解析，远快于逐字符状态机）。
// 合并：旧文件逐块解码 + PART 逐行解码 → 重新分块压缩写出（merge 只在爬取收尾跑一次，可接受）。
export const WORKSHOP_PER_CHUNK = 20000;

/** 读第 0 行头部（读完即关 fd；Windows 下未关的读句柄会挡住对同一文件的 rename） */
export function readWorkshopHeader(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(64 * 1024);
  try {
    let s = '';
    while (s.indexOf('\n') < 0) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      s += buf.subarray(0, n).toString('utf8');
      if (s.length > 4 * 1024 * 1024) break; // 防御：头不应超 4MB
    }
    const line = s.slice(0, s.indexOf('\n'));
    if (!line) throw new Error('workshop 文件缺少头部行');
    return JSON.parse(line);
  } finally {
    fs.closeSync(fd);
  }
}

/** 迭代 workshop.json 的全部配装条目（流式按块解压，每块一次性 JSON.parse） */
export function* iterWorkshopFile(file) {
  const h = readWorkshopHeader(file);
  const offsets = h.offsets || [];
  if (!offsets.length) return;
  const headLen = Buffer.byteLength(JSON.stringify(h)) + 1;
  const fd = fs.openSync(file, 'r');
  const size = fs.statSync(file).size;
  try {
    for (let i = 0; i < offsets.length; i++) {
      const start = headLen + offsets[i];
      const end = i + 1 < offsets.length ? headLen + offsets[i + 1] : size;
      const len = end - start;
      if (len <= 0) continue;
      const buf = Buffer.alloc(len);
      let read = 0;
      while (read < len) {
        const n = fs.readSync(fd, buf, read, len - read, start + read);
        if (n <= 0) break;
        read += n;
      }
      const arr = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
      for (const e of arr) yield e;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** 把条目流按 perChunk 分块 gzip 写入 outFile（原子：tmp+rename；头部最后拼装）。
 *  @param {Iterable<object>} entries  条目迭代器（可为 generator，只消费一次）
 *  @param {object|Function} meta  头部 meta；传函数时以实际条数调用 meta(count)（转换场景 entryCount 未知）
 *  @returns {number} 写入的条目数 */
export function writeWorkshopFile(outFile, entries, meta = {}, perChunk = WORKSHOP_PER_CHUNK) {
  const tmp = `${outFile}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  const offsets = [];
  let count = 0;
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    offsets.push(fs.fstatSync(fd).size); // body 相对偏移（tmp 无头部）
    fs.writeSync(fd, zlib.gzipSync(Buffer.from(JSON.stringify(buf)), { level: 6 }));
    buf = [];
  };
  try {
    for (const e of entries) {
      buf.push(e);
      count++;
      if (buf.length >= perChunk) flush();
    }
    flush();
    if (!offsets.length) offsets.push(0); // 空文件也留一个块槽位（读侧空转）
  } finally {
    fs.closeSync(fd);
  }
  // 头部 + body 拼接（meta 为函数时按实际条数生成）
  const finalMeta = typeof meta === 'function' ? meta(count) : meta;
  const head = Buffer.from(JSON.stringify({ meta: finalMeta, perChunk, offsets }) + '\n');
  const bodyFd = fs.openSync(tmp, 'r');
  const outFd = fs.openSync(`${tmp}.head`, 'w');
  try {
    fs.writeSync(outFd, head);
    const buf2 = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(bodyFd, buf2, 0, buf2.length, null)) > 0) fs.writeSync(outFd, buf2, 0, n);
  } finally {
    fs.closeSync(bodyFd);
    fs.closeSync(outFd);
  }
  fs.renameSync(`${tmp}.head`, outFile);
  fs.rmSync(tmp, { force: true });
  return count;
}

/** 通用按行读（供 PART 裸流等 JSON 行文件；\n 字节不可能出现在 UTF-8 多字节字符内，切分安全） */
export function* readLines(file, chunkSize = 1 << 20) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(chunkSize);
  let carry = Buffer.alloc(0);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, chunkSize, null);
      if (n <= 0) break;
      const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) {
          if (i > start) yield chunk.toString('utf8', start, i);
          start = i + 1;
        }
      }
      carry = Buffer.from(chunk.subarray(start));
    }
    if (carry.length) yield carry.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
