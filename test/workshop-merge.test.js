// test/workshop-merge.test.js —— workshop.json 分块 gzip 合并写出回归（旧格式曾写坏 2.2GB 落盘文件）
// ① 数组括号重复 `"entries":[[…` ② 跨块 toString('utf8') 截断中文成 U+FFFD——分块 gzip 天然规避两类。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeWorkshopFile, flushPart } from '../src/sync/workshop.js';
import { iterWorkshopFile, readWorkshopHeader } from '../src/lib/node.js';

/** 造一条带中文的真实形状条目；padTo 撑长度以跨越多块 */
function entryOf(uid, padTo = 0) {
  const e = {
    uid,
    role_id: '1091',
    nick: '孤鹜断霞·测试',
    level: 60,
    rank: 2,
    skills: [{ type: 0, level: 12 }],
    weapon: { id: 14109, name: '霰落星殿', level: 60, rarity: 'S', main: [] },
    panel: [{ name: '攻击力', base: '1500', add: '', final: '2600' }],
    equips: [
      {
        id: 32741,
        name: '折枝剑歌',
        level: 15,
        rarity: 'S',
        suit: '折枝剑歌',
        main: [],
        subs: [{ name: '攻击力百分比', value: 600 }],
      },
    ],
    pad: '',
  };
  if (padTo) e.pad = '填'.repeat(Math.max(0, Math.floor(padTo / 3)));
  return e;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zzz-merge-'));
}

test('mergeWorkshopFile：仅 PART（无旧文件）产出合法分块 gzip', () => {
  const dir = tmpDir();
  const partFile = path.join(dir, 'part.json');
  const outFile = path.join(dir, 'workshop.json');
  const entries = [entryOf('u1'), entryOf('u2')];
  const partCount = flushPart(entries, 0, partFile);

  mergeWorkshopFile({ meta: { entryCount: partCount }, oldFile: null, partFile, partCount, outFile, perChunk: 3 });

  const h = readWorkshopHeader(outFile);
  assert.equal(h.meta.entryCount, 2);
  const out = [...iterWorkshopFile(outFile)];
  assert.deepEqual(
    out.map((e) => e.uid),
    ['u1', 'u2']
  );
  assert.equal(out[0].nick, '孤鹜断霞·测试');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeWorkshopFile：旧文件 + PART 合并，顺序保持、中文不坏', () => {
  const dir = tmpDir();
  const partFile = path.join(dir, 'part.json');
  const outFile = path.join(dir, 'workshop.json');

  // 第一轮：写出「旧文件」（小 perChunk 强制多块）
  let count = flushPart([entryOf('old1'), entryOf('old2')], 0, partFile);
  mergeWorkshopFile({ meta: { entryCount: count }, oldFile: null, partFile, partCount: count, outFile, perChunk: 1 });
  fs.rmSync(partFile, { force: true });

  // 第二轮：旧文件 + 新 PART 合并（每块 1 条 → 3 块，均含中文）
  const newCount = flushPart([entryOf('new1')], 0, partFile);
  mergeWorkshopFile({ meta: { entryCount: 3 }, oldFile: outFile, partFile, partCount: newCount, outFile, perChunk: 1 });

  const out = [...iterWorkshopFile(outFile)];
  assert.deepEqual(
    out.map((e) => e.uid),
    ['old1', 'old2', 'new1']
  );
  for (const e of out) assert.ok(e.nick.includes('孤鹜断霞'), '中文必须完整');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeWorkshopFile：大 PART 多块压缩，中文不产生 U+FFFD', () => {
  const dir = tmpDir();
  const partFile = path.join(dir, 'part.json');
  const outFile = path.join(dir, 'workshop.json');

  const entries = [];
  for (let i = 0; i < 40; i++) entries.push(entryOf(`u${i}`, 80_000));
  const partCount = flushPart(entries, 0, partFile);
  assert.ok(fs.statSync(partFile).size > 3 << 20, 'PART 需大于 3MB');

  mergeWorkshopFile({ meta: {}, oldFile: null, partFile, partCount, outFile, perChunk: 5 });

  const out = [...iterWorkshopFile(outFile)];
  assert.equal(out.length, 40);
  for (const e of out) {
    assert.equal(e.nick, '孤鹜断霞·测试');
    assert.ok(/^填+$/.test(e.pad), 'pad 必须全部是完整中文字符');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
