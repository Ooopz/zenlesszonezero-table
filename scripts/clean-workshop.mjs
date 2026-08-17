// scripts/clean-workshop.mjs —— 清洗 workshop.json（丢弃乱码/损坏/重复条目）
// 用法:  npm run clean:workshop   （等价 node scripts/clean-workshop.mjs）
//
// 何时需要它：正常情况下用不到。写入侧 bug 已有回归测试（test/workshop-merge.test.js）。
// 只有当某次爬取又产出损坏条目时才跑这个。
//
// workshop.json 为分块 gzip（每块独立压缩）：清洗 = 逐块解压 → 校验（U+FFFD / uid / role_id / 重复）
// → 重新分块压缩写出，全程流式、不驻留全量。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, readWorkshopHeader, iterWorkshopFile, writeWorkshopFile } from '../src/lib/node.js';

// 用法:  npm run clean:workshop            清洗 data/workshop.json
//        node scripts/clean-workshop.mjs <文件路径>   清洗指定文件（便于在小样本上验证）
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(DATA_DIR, 'workshop.json');
const BAK = `${OUT}.bak`;

// ---------- 1. 清理残留 + 备份 ----------
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

// ---------- 2. 读旧头部（meta 保留，entryCount 清洗后更新） ----------
let oldMeta = {};
try {
  oldMeta = readWorkshopHeader(OUT).meta || {};
} catch {
  /* 头部损坏：按空处理 */
}

// ---------- 3. 流式逐条清洗 → 重新分块压缩 ----------
const seen = new Set();
let total = 0,
  garb = 0,
  bad = 0,
  dup = 0,
  ok = 0;
const cleaned = (function* () {
  for (const e of iterWorkshopFile(OUT)) {
    total++;
    // 字面量 U+FFFD：合法编码但语义已损坏（理论上新写入路径不会产生，防历史坏数据）
    if (JSON.stringify(e).includes('�')) {
      garb++;
      continue;
    }
    if (!e || e.uid == null || e.role_id == null) {
      bad++;
      continue;
    }
    const key = `${e.uid}:${e.role_id}`;
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    ok++;
    yield e;
  }
})();
writeWorkshopFile(OUT, cleaned, { ...oldMeta, entryCount: ok });

console.log('\n========== 清洗报告（分块 gzip 流式） ==========');
console.log(`识别条目:      ${total}`);
console.log(`乱码丢弃:      ${garb}`);
console.log(`损坏丢弃:      ${bad}`);
console.log(`重复丢弃:      ${dup}`);
console.log(`保留条目:      ${ok}`);
console.log(`覆盖 uid 数:   ${new Set([...seen].map((k) => k.split(':')[0])).size}`);
console.log(`文件大小:      ${(fs.statSync(OUT).size / 1073741824).toFixed(2)} GiB`);
console.log('======================================');
