// scripts/clean-workshop.mjs —— 清洗 workshop.json（丢弃乱码/损坏/重复条目）
// 用法:  npm run clean:workshop   （等价 node scripts/clean-workshop.mjs）
//
// 何时需要它：正常情况下用不到。写入侧的两个 bug（`"entries":[[` 双括号、跨块 UTF-8 截断）
// 已修复并有回归测试（test/workshop-merge.test.js）。只有当某次爬取又产出乱码时才跑这个。
//
// 两处曾经的设计缺陷，本版已修正：
//   ① 旧版用 fs.readFileSync 整文件读入 —— Node 单次读取硬上限 2 GiB，而 workshop.json
//      已达 2.08 GiB，脚本直接 ERR_FS_FILE_TOO_LARGE 崩溃，等于完全不可用。现改为分块流式。
//   ② 旧版只检测「非法 UTF-8 字节」。但实测乱码是**合法编码**的 U+FFFD（EF BF BD）——
//      字符在上游写入时就已被替换掉，字节序列本身完全合法，旧检测一条也抓不到。
//      现在两种信号都查：非法字节 + 字面量 U+FFFD。
//
// 清洗前自动备份到 data/workshop.json.bak（已存在则不覆盖，避免用坏文件盖掉好备份）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/lib/node.js';

// 用法:  npm run clean:workshop            清洗 data/workshop.json
//        node scripts/clean-workshop.mjs <文件路径>   清洗指定文件（便于在小样本上验证）
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DATA_DIR, 'workshop.json');
const BAK = `${OUT}.bak`;
const TMP = `${OUT}.tmp`;
const NEEDLE = Buffer.from('{"uid":');
const QUOTE = 0x22,
  BACKSLASH = 0x5c,
  LBRACE = 0x7b,
  RBRACE = 0x7d;
const CHUNK = 64 * 1024 * 1024;

// ---------- 1. 清理残留 + 备份 ----------
// 残留清理只在处理默认的 data/workshop.json 时做：传了自定义路径（小样本验证）时
// 不应该去动 data/ 下的真实文件。
const isDefaultTarget = OUT === path.join(DATA_DIR, 'workshop.json');
if (isDefaultTarget) {
  for (const f of ['.workshop-part.json', 'workshop.json.tmp', 'workshop-part.json', '.workshop-part.json.tmp']) {
    const p = path.join(DATA_DIR, f);
    try {
      if (fs.existsSync(p)) fs.rmSync(p);
    } catch {
      /* 忽略清理失败 */
    }
  }
}
if (!fs.existsSync(OUT)) {
  console.error(`❌ 找不到 ${OUT}`);
  process.exit(1);
}
if (!fs.existsSync(BAK)) {
  fs.copyFileSync(OUT, BAK);
  console.log(`已备份: ${BAK}（${(fs.statSync(BAK).size / 1073741824).toFixed(2)} GiB）`);
} else console.log(`备份已存在（不覆盖）: ${BAK}`);

const size = fs.statSync(OUT).size;
console.log(`源文件: ${(size / 1073741824).toFixed(2)} GiB`);

// ---------- 2. 读旧 meta（只读文件头，不整文件加载） ----------
let oldMeta = {};
{
  const fd = fs.openSync(OUT, 'r');
  const head = Buffer.alloc(8192);
  const n = fs.readSync(fd, head, 0, 8192, 0);
  fs.closeSync(fd);
  const m = /\{"meta":(\{.*?\}),"entries":\[/.exec(head.subarray(0, n).toString('utf8'));
  if (m) {
    try {
      oldMeta = JSON.parse(m[1]);
    } catch {
      /* 忽略 */
    }
  }
}

// ---------- 3. 流式分段提取 + 直写输出 ----------
// 分段锚点 = `{"uid":`；段内按 JSON 深度闭合。段跨块时用 carry 累积字节，
// 因此绝不能对块做「字符级」切分（中文 UTF-8 多字节会被截断）——全程字节级。
const seen = new Set();
let total = 0,
  bad = 0,
  garb = 0,
  dup = 0,
  ok = 0;

const inFd = fs.openSync(OUT, 'r');
const outFd = fs.openSync(TMP, 'w');
let wrote = 0;

// entryCount 事后才知道，先写一个「与最终等长」的占位头，结束时原地覆写，
// 免去为改头再复制一遍 2GB。做法：在 meta 闭合 '}' 前补空格（JSON 允许值与 '}' 之间有空白），
// 使不同位数的 entryCount 得到恒定长度的头部——注意 entryCount 必须保持 number 类型，
// 不能用零填充字符串，否则消费端读到的是 "000000829891" 而非 829891。
const PAD = 16;
const headOf = (cnt) => {
  const body = JSON.stringify({ ...oldMeta, entryCount: cnt });
  return `{"meta":${body.slice(0, -1)}${' '.repeat(PAD - String(cnt).length)}},"entries":[`;
};

try {
  fs.writeSync(outFd, Buffer.from(headOf(0)));

  const rbuf = Buffer.alloc(CHUNK);
  let carry = Buffer.alloc(0);
  let inSeg = false,
    depth = 0,
    inStr = false,
    esc = false,
    segBad = false;
  let utf8Need = 0;

  const isAnchorAt = (b, p, end) =>
    p + 7 <= end && b[p] === LBRACE && b.compare(NEEDLE, 0, 7, p, p + 7) === 0;

  const finishSeg = (segBuf) => {
    total++;
    // 字面量 U+FFFD：合法编码但语义已损坏，必须单独查（旧版漏掉的正是这一类）
    if (segBad || segBuf.includes('�')) {
      garb++;
      return;
    }
    let e = null;
    try {
      e = JSON.parse(segBuf.toString('utf8'));
    } catch {
      /* 坏段 */
    }
    if (!e || e.uid == null || e.role_id == null) {
      bad++;
      return;
    }
    const key = `${e.uid}:${e.role_id}`;
    if (seen.has(key)) {
      dup++;
      return;
    }
    seen.add(key);
    ok++;
    if (wrote++) fs.writeSync(outFd, ',');
    fs.writeSync(outFd, segBuf);
  };

  let pos = 0;
  while (pos < size) {
    const n = fs.readSync(inFd, rbuf, 0, CHUNK, pos);
    if (n <= 0) break;
    const b = rbuf.subarray(0, n);
    let segStart = inSeg ? 0 : -1;
    let i = 0;
    while (i < n) {
      const c = b[i];
      // UTF-8 合法性状态机（跨块连续）
      if (utf8Need > 0) {
        if ((c & 0xc0) !== 0x80) {
          if (inSeg) segBad = true;
          utf8Need = 0;
        } else utf8Need--;
      } else if (c >= 0x80) {
        if ((c & 0xe0) === 0xc0) utf8Need = 1;
        else if ((c & 0xf0) === 0xe0) utf8Need = 2;
        else if ((c & 0xf8) === 0xf0) utf8Need = 3;
        else if (inSeg) segBad = true;
      }

      if (inSeg) {
        if (!inStr && isAnchorAt(b, i, n) && !(segStart === i && carry.length === 0)) {
          total++;
          bad++; // 段未闭合就遇到新锚点 → 前段损坏
          carry = Buffer.alloc(0);
          segStart = i;
          depth = 1;
          inStr = esc = segBad = false;
          i += 7;
          continue;
        }
        if (inStr) {
          if (esc) esc = false;
          else if (c === BACKSLASH) esc = true;
          else if (c === QUOTE) inStr = false;
          i++;
          continue;
        }
        if (c === QUOTE) { inStr = true; i++; continue; }
        if (c === LBRACE) { depth++; i++; continue; }
        if (c === RBRACE) {
          depth--;
          if (depth === 0) {
            const part = b.subarray(segStart < 0 ? 0 : segStart, i + 1);
            finishSeg(carry.length ? Buffer.concat([carry, part]) : Buffer.from(part));
            carry = Buffer.alloc(0);
            inSeg = false;
            segBad = false;
            segStart = -1;
          }
          i++;
          continue;
        }
        i++;
        continue;
      }
      if (isAnchorAt(b, i, n)) {
        inSeg = true;
        depth = 1;
        inStr = esc = segBad = false;
        carry = Buffer.alloc(0);
        segStart = i;
        i += 7;
        continue;
      }
      // 块尾可能截断锚点：留 8 字节交给下一块
      if (i > n - 8 && pos + n < size) break;
      i++;
    }
    if (inSeg) carry = Buffer.concat([carry, b.subarray(segStart < 0 ? 0 : segStart, i)]);
    pos += i;
    if (pos % (512 * 1024 * 1024) < CHUNK)
      console.log(`  …已扫描 ${(pos / 1073741824).toFixed(2)} GiB，保留 ${ok}`);
  }
  if (inSeg) { total++; bad++; }

  fs.writeSync(outFd, Buffer.from(']}'));
  // 原地回填真实 entryCount（与占位等长，故可安全覆写文件头）
  fs.writeSync(outFd, Buffer.from(headOf(ok)), 0, Buffer.byteLength(headOf(ok)), 0);
} finally {
  fs.closeSync(inFd);
  fs.closeSync(outFd);
}

fs.renameSync(TMP, OUT);

console.log('\n========== 清洗报告（流式） ==========');
console.log(`识别条目:      ${total}`);
console.log(`损坏丢弃:      ${bad}`);
console.log(`乱码丢弃:      ${garb}`);
console.log(`重复丢弃:      ${dup}`);
console.log(`保留条目:      ${ok}`);
console.log(`覆盖 uid 数:   ${new Set([...seen].map((k) => k.split(':')[0])).size}`);
console.log(`文件大小:      ${(fs.statSync(OUT).size / 1073741824).toFixed(2)} GiB`);
console.log('======================================');
