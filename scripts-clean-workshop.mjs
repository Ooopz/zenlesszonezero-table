// scripts-clean-workshop.mjs —— 正确清洗 workshop.json v3：全字节级处理（彻底清除乱码条目）
// 用法:  node scripts-clean-workshop.mjs
//
// 背景：文件含少量字节级非法 UTF-8（乱码破坏条目内容）。toString('utf8') 对非法字节的
// 解码依赖块边界，导致字符串级检测（includes U+FFFD）结果不稳定。v3 全程字节级：
//   · 整个文件读入 Buffer（外部内存，不占 JS 堆）
//   · UTF-8 校验状态机 → 精确定位每个非法字节的偏移
//   · 按锚点 {"uid": 切段（字节级深度闭合）→ 段范围含非法字节 → 丢弃
//   · 段文本 JSON.parse 验证 + uid:role_id 去重 → Buffer 切片直写输出
// 清洗前自动备份到 data/workshop.json.bak。
import fs from 'node:fs';

const OUT = 'data/workshop.json';
const NEEDLE = Buffer.from('{"uid":'); // 7B 22 75 69 64 22 3A
const QUOTE = 0x22, BACKSLASH = 0x5c, LBRACE = 0x7b, RBRACE = 0x7d;

// ---------- 1. 清理残留 + 备份 ----------
for (const f of ['data/.workshop-part.json', 'data/workshop.json.tmp', 'data/workshop-part.json', 'data/.workshop-part.json.tmp']) {
  try { if (fs.existsSync(f)) fs.rmSync(f); } catch { /* 忽略清理失败 */ }
}
const BAK = `${OUT}.bak`;
if (fs.existsSync(OUT) && !fs.existsSync(BAK)) {
  fs.copyFileSync(OUT, BAK);
  console.log(`已备份: ${BAK}（${(fs.statSync(BAK).size / 1073741824).toFixed(2)} GB）`);
} else if (fs.existsSync(BAK)) console.log(`备份已存在（不覆盖）: ${BAK}`);

const buf = fs.readFileSync(OUT);
const size = buf.length;
console.log(`读取完成: ${(size / 1073741824).toFixed(2)} GB`);

// ---------- 2. UTF-8 校验：定位非法字节偏移 ----------
const badPos = [];
{
  let i = 0;
  while (i < size) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    let len;
    if ((b & 0xe0) === 0xc0) len = 2;
    else if ((b & 0xf0) === 0xe0) len = 3;
    else if ((b & 0xf8) === 0xf0) len = 4;
    else { badPos.push(i); i++; continue; }
    let ok = i + len <= size;
    for (let j = 1; ok && j < len; j++) if ((buf[i + j] & 0xc0) !== 0x80) ok = false;
    if (ok) i += len;
    else { badPos.push(i); i++; }
  }
}
console.log(`非法 UTF-8 字节位置数: ${badPos.length}`);
// 非法偏移 → 二分查找辅助
const firstBadAt = (from, to) => {
  // 返回 [from, to) 内第一个非法偏移，无则 -1（badPos 升序）
  let lo = 0, hi = badPos.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (badPos[mid] < from) lo = mid + 1;
    else { idx = mid; hi = mid - 1; }
  }
  if (idx < 0 || badPos[idx] >= to) return -1;
  return badPos[idx];
};

// ---------- 3. 读旧 meta ----------
let oldMeta = {};
try {
  const m = buf.subarray(0, 8192).toString('utf8').match(/\{"meta":(\{.*?\}),"entries":\[/);
  if (m) oldMeta = JSON.parse(m[1]);
} catch { /* 忽略 */ }

// ---------- 4. 锚点分段提取（全字节级；段只记录起止偏移，闭合时零拷贝切片） ----------
const seen = new Map();
const chunks = []; // 输出条目 Buffer（subarray 零拷贝）
let total = 0, ok = 0, bad = 0, garb = 0, dup = 0;
{
  let i = 0;
  let segStart = -1; // 当前段起点偏移（-1 = 无段）
  let depth = 0;
  let inStr = false;
  let esc = false;
  const isAnchor = (p) => p >= 0 && p + 7 <= size && buf[p] === LBRACE && buf.compare(NEEDLE, 0, 7, p, p + 7) === 0;
  while (i < size) {
    const b = buf[i];
    if (segStart >= 0) {
      // 字符串外遇到新锚点 → 当前段字符串被破坏未闭合，丢弃并重开
      if (!inStr && isAnchor(i) && i > segStart) {
        total++; bad++;
        segStart = i; depth = 1; inStr = false; esc = false;
        i += 7;
        continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (b === BACKSLASH) esc = true;
        else if (b === QUOTE) inStr = false;
        i++;
        continue;
      }
      if (b === QUOTE) { inStr = true; i++; continue; }
      if (b === LBRACE) { depth++; i++; continue; }
      if (b === RBRACE) {
        depth--;
        if (depth === 0) {
          total++;
          const end = i + 1;
          const seg = buf.subarray(segStart, end); // 零拷贝
          if (firstBadAt(segStart, end) >= 0) garb++; // 段含非法字节 → 乱码条目
          else {
            let e = null;
            try { e = JSON.parse(seg.toString('utf8')); } catch { /* 坏段 */ }
            if (!e || e.uid == null || e.role_id == null) bad++;
            else {
              const key = `${e.uid}:${e.role_id}`;
              if (seen.has(key)) dup++;
              else { seen.set(key, true); ok++; chunks.push(seg); }
            }
          }
          segStart = -1;
        }
        i++;
        continue;
      }
      i++;
      continue;
    }
    // 找锚点
    if (isAnchor(i)) {
      segStart = i; depth = 1; inStr = false; esc = false;
      i += 7;
      continue;
    }
    i++;
  }
  if (segStart >= 0) total++, bad++;
}

// ---------- 5. 写回（原子） ----------
const tmp = `${OUT}.tmp`;
{
  const head = Buffer.from(`{"meta":${JSON.stringify({ ...oldMeta, scrapedAt: new Date().toISOString() })},"entries":[`);
  const tail = Buffer.from(']}');
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, head);
    for (let k = 0; k < chunks.length; k++) {
      if (k > 0) fs.writeSync(fd, ',');
      fs.writeSync(fd, chunks[k]);
    }
    fs.writeSync(fd, tail);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, OUT);
}

// ---------- 6. 报告 ----------
console.log('\n========== 清洗报告 v3（字节级） ==========');
console.log(`识别条目:      ${total}`);
console.log(`损坏丢弃:      ${bad}`);
console.log(`乱码丢弃:      ${garb}`);
console.log(`重复丢弃:      ${dup}`);
console.log(`保留条目:      ${ok}`);
console.log(`覆盖 uid 数:   ${new Set([...seen.keys()].map((k) => k.split(':')[0])).size}`);
console.log(`文件大小:      ${(fs.statSync(OUT).size / 1073741824).toFixed(2)} GB`);
console.log('==========================================');
