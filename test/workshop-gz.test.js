// test/workshop-gz.test.js —— workshop.json 分块 gzip（非固实）存储层：写入/头部/逐块读取往返
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { writeWorkshopFile, iterWorkshopFile, readWorkshopHeader } from '../src/lib/node.js';

function entryOf(uid, chinese = '孤鹜断霞·测试') {
  return {
    uid,
    role_id: '1091',
    nick: chinese,
    level: 60,
    rank: 2,
    skills: [{ type: 0, level: 12 }],
    panel: [{ name: '攻击力', base: '1500', add: '', final: '2600' }],
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zzz-gz-'));
}

test('writeWorkshopFile + iterWorkshopFile：多块往返一致（含中文）', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'workshop.json');
  const entries = [];
  for (let i = 0; i < 10; i++) entries.push(entryOf('u' + i));
  const count = writeWorkshopFile(f, entries, { entryCount: 10 }, 3);
  assert.equal(count, 10);

  const out = [...iterWorkshopFile(f)];
  assert.equal(out.length, 10);
  assert.deepEqual(
    out.map((e) => e.uid),
    entries.map((e) => e.uid)
  );
  assert.equal(out[0].nick, '孤鹜断霞·测试');
  assert.equal(out[0].panel[0].name, '攻击力');
  const h = readWorkshopHeader(f);
  assert.equal(h.meta.entryCount, 10);
  assert.equal(h.perChunk, 3);
  assert.equal(h.offsets.length, 4, '10 条 / 每块 3 → 4 块');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeWorkshopFile：空条目 → 合法头部 + 0 条', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'workshop.json');
  writeWorkshopFile(f, [], { entryCount: 0 }, 3);
  const h = readWorkshopHeader(f);
  assert.equal(h.meta.entryCount, 0);
  assert.equal([...iterWorkshopFile(f)].length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('每块独立 gzip：直接 gunzipSync 单块可还原该块 JSON', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'workshop.json');
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push(entryOf('u' + i));
  writeWorkshopFile(f, entries, {}, 2); // 3 块
  const h = readWorkshopHeader(f);
  const bodyStart = Buffer.byteLength(JSON.stringify({ meta: h.meta, perChunk: h.perChunk, offsets: h.offsets })) + 1;
  // 读第 2 块（非固实：无需解压前面块）
  const start = bodyStart + h.offsets[1];
  const end = bodyStart + h.offsets[2];
  const len = end - start;
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(f, 'r');
  fs.readSync(fd, buf, 0, len, start);
  fs.closeSync(fd);
  const arr = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  assert.equal(arr.length, 2);
  assert.equal(arr[0].uid, 'u2');
  fs.rmSync(dir, { recursive: true, force: true });
});
