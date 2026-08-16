// test/workshop-merge.test.js —— workshop.json 合并写出：括号结构合法性 + UTF-8 完整性
// 回归两个曾把 2.2GB 落盘文件写坏的 bug：
//   ① copyEntriesTo 与调用方各写一次 '['，产出 `"entries":[[…` —— 非合法 JSON，
//      仅因 streamJsonArrayElements 解析宽松而长期未暴露；
//   ② appendPartTo 逐 1MB 块 toString('utf8')，跨块的中文字符被截成 U+FFFD。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeWorkshopFile, flushPart } from '../src/sync/workshop.js';

/** 造一条带中文的条目；padTo 用于把序列化长度撑到指定字节数，以跨越 1MB 读块边界 */
function entryOf(uid, padTo = 0) {
  const e = { uid, nick: '孤鹜断霞·测试', role: '维琳娜·艾嘉德', pad: '' };
  if (padTo) e.pad = '填'.repeat(Math.max(0, Math.floor(padTo / 3)));
  return e;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zzz-merge-'));
}

test('mergeWorkshopFile：仅 PART（无旧文件）产出合法 JSON', () => {
  const dir = tmpDir();
  const partFile = path.join(dir, 'part.json');
  const outFile = path.join(dir, 'workshop.json');
  const entries = [entryOf('u1'), entryOf('u2')];
  const partCount = flushPart(entries, 0, partFile);

  mergeWorkshopFile({ meta: { entryCount: partCount }, oldFile: null, partFile, partCount, outFile });

  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8')); // 曾在此抛错
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(
    parsed.entries.map((e) => e.uid),
    ['u1', 'u2']
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeWorkshopFile：旧文件 + PART 合并后仍是合法 JSON（回归双 [ bug）', () => {
  const dir = tmpDir();
  const partFile = path.join(dir, 'part.json');
  const outFile = path.join(dir, 'workshop.json');

  // 第一轮：写出「旧文件」
  let count = flushPart([entryOf('old1'), entryOf('old2')], 0, partFile);
  mergeWorkshopFile({ meta: { entryCount: count }, oldFile: null, partFile, partCount: count, outFile });
  fs.rmSync(partFile, { force: true });

  // 第二轮：旧文件 + 新 PART 合并（这是产生 `[[` 的路径）
  const newCount = flushPart([entryOf('new1')], 0, partFile);
  mergeWorkshopFile({ meta: { entryCount: 3 }, oldFile: outFile, partFile, partCount: newCount, outFile });

  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
  assert.deepEqual(
    parsed.entries.map((e) => e.uid),
    ['old1', 'old2', 'new1']
  );
  const head = fs.readFileSync(outFile, 'utf-8').slice(0, 200);
  assert.ok(!head.includes('"entries":[['), '不得出现重复的数组左括号');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeWorkshopFile：旧文件为空 entries 时不产生 `[,`', () => {
  const dir = tmpDir();
  const outFile = path.join(dir, 'workshop.json');
  const partFile = path.join(dir, 'part.json');
  fs.writeFileSync(outFile, '{"meta":{},"entries":[]}');

  const partCount = flushPart([entryOf('only')], 0, partFile);
  mergeWorkshopFile({ meta: {}, oldFile: outFile, partFile, partCount, outFile });

  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
  assert.deepEqual(
    parsed.entries.map((e) => e.uid),
    ['only']
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeWorkshopFile：PART 跨 1MB 读块边界时中文不被截断（回归 U+FFFD bug）', () => {
  const dir = tmpDir();
  const partFile = path.join(dir, 'part.json');
  const outFile = path.join(dir, 'workshop.json');

  // 造 ~3MB PART，确保跨越多个 1<<20 读块边界，且边界大概率落在多字节字符中间
  const entries = [];
  for (let i = 0; i < 40; i++) entries.push(entryOf(`u${i}`, 80_000));
  const partCount = flushPart(entries, 0, partFile);
  assert.ok(fs.statSync(partFile).size > 3 << 20, 'PART 需大于 3MB 才能跨块');

  mergeWorkshopFile({ meta: {}, oldFile: null, partFile, partCount, outFile });

  const text = fs.readFileSync(outFile, 'utf-8');
  assert.ok(!text.includes('�'), '不得出现替换字符（UTF-8 被块边界截断）');
  const parsed = JSON.parse(text);
  assert.equal(parsed.entries.length, 40);
  for (const e of parsed.entries) {
    assert.equal(e.nick, '孤鹜断霞·测试');
    assert.ok(/^填+$/.test(e.pad), 'pad 内容必须全部是完整的中文字符');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
