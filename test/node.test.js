// test/node.test.js —— Node 专属工具测试（streamJsonArrayElements 块边界回归）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { streamJsonArrayElements } from '../src/lib/node.js';

/** 写一个带 meta 的条目数组文件并返回路径 */
function writeFixture(entries) {
  const f = path.join(os.tmpdir(), `zzz-stream-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(
    f,
    `{"meta":{"n":${entries.length}},"entries":[${entries.map((e) => JSON.stringify(e)).join(',')}]}`
  );
  return f;
}

test('streamJsonArrayElements：正常解析全部条目', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ uid: 'u' + i, role_id: String(1000 + i) }));
  const f = writeFixture(entries);
  try {
    const out = [...streamJsonArrayElements(f)].map((raw) => JSON.parse(raw));
    assert.equal(out.length, 100);
    assert.deepEqual(out[0], entries[0]);
    assert.deepEqual(out[99], entries[99]);
  } finally {
    fs.rmSync(f, { force: true });
  }
});

test('streamJsonArrayElements：块边界落在条目间隙不丢条目（回归：曾提前 break 丢 85% 条目）', () => {
  // 极小 chunkSize（3 字节）强制块边界反复落在 `},{` 间隙——
  // 旧实现块末检查 `!started && depth===0` 在间隙也为真 → 提前 break 丢弃后续全部条目
  const entries = Array.from({ length: 50 }, (_, i) => ({ uid: 'u' + i, pad: 'x'.repeat(20) }));
  const f = writeFixture(entries);
  try {
    const out = [...streamJsonArrayElements(f, 3)];
    assert.equal(out.length, 50, '块边界在间隙时不得丢条目');
    // 顺序与内容完整
    for (let i = 0; i < 50; i++) assert.equal(JSON.parse(out[i]).uid, 'u' + i);
  } finally {
    fs.rmSync(f, { force: true });
  }
});

test('streamJsonArrayElements：条目含中文（多字节 UTF-8）跨块正常', () => {
  const entries = [
    { uid: 'u1', nick: '孤鹜断霞·測試中文字符串' },
    { uid: 'u2', nick: '河豚电音[4]' },
  ];
  const f = writeFixture(entries);
  try {
    const out = [...streamJsonArrayElements(f, 5)].map((raw) => JSON.parse(raw)); // 5 字节块强制切中文字符
    assert.equal(out.length, 2);
    assert.equal(out[0].nick, '孤鹜断霞·測試中文字符串');
    assert.equal(out[1].nick, '河豚电音[4]');
  } finally {
    fs.rmSync(f, { force: true });
  }
});
