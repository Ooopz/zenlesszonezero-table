// scripts/convert-workshop-gz.mjs —— 把旧版 workshop.json（普通 JSON 数组）转成分块 gzip（非固实）
// 用法:  node scripts/convert-workshop-gz.mjs
//
// 旧格式: {"meta":{...},"entries":[{...},...]}（2.08GB 文本）
// 新格式: 第 0 行 {"meta":{...},"perChunk":20000,"offsets":[...]} + 每块独立 gzip 的 JSON 数组
// 转换流式完成（旧文件不整读）；已是分块 gzip 则直接退出（幂等）。
import fs from 'node:fs';
import path from 'node:path';
import { streamJsonArrayElements, writeWorkshopFile, readWorkshopHeader, DATA_DIR } from '../src/lib/node.js';

const OUT = path.join(DATA_DIR, 'workshop.json');
if (!fs.existsSync(OUT)) {
  console.error('❌ 找不到 data/workshop.json');
  process.exit(1);
}

// ---------- 幂等检测 ----------
{
  try {
    const h = readWorkshopHeader(OUT);
    if (h && Array.isArray(h.offsets)) {
      console.log('✓ 已是分块 gzip 格式，无需转换');
      process.exit(0);
    }
  } catch {
    /* 旧格式（头部行不是 JSON 或解析失败）→ 继续转换 */
  }
}

// ---------- 备份（硬链接零拷贝；失败则复制） ----------
const BAK = `${OUT}.bak-json`;
if (!fs.existsSync(BAK)) {
  try {
    fs.linkSync(OUT, BAK);
    console.log(`已备份（硬链接）: ${BAK}`);
  } catch {
    console.log('硬链接不可用，整文件复制备份…');
    fs.copyFileSync(OUT, BAK);
    console.log(`已备份（复制）: ${BAK}`);
  }
} else console.log(`备份已存在: ${BAK}`);

// ---------- 流式转换：旧 entries → 分块压缩（entryCount 未知 → meta 用函数按实际条数生成） ----------
const t0 = Date.now();
const entries = (function* () {
  let n = 0;
  for (const raw of streamJsonArrayElements(OUT)) {
    yield JSON.parse(raw);
    if (++n % 100000 === 0) console.log(`  …已读取 ${n} 条`);
  }
})();
const count = writeWorkshopFile(OUT, entries, (c) => ({ entryCount: c }));
const oldSize = fs.statSync(BAK).size;
const newSize = fs.statSync(OUT).size;
console.log('\n========== 转换完成 ==========');
console.log(`条目:   ${count}`);
console.log(
  `体积:   ${(oldSize / 1073741824).toFixed(2)} GiB → ${(newSize / 1073741824).toFixed(2)} GiB（-${(100 - (newSize / oldSize) * 100).toFixed(0)}%）`
);
console.log(`耗时:   ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`备份:   ${BAK}（确认无问题后可删除；另有 .bak-jsonl 为上一版 JSONL 格式备份）`);
console.log('================================');
