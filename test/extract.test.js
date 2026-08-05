import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCharacter } from '../src/sync/characters.js';
import { validateCharacter } from '../src/lib/schema.js';

// 用第一个角色的原始 avatar/info 响应（接口原始数据）作为提取 fixture
const debug = JSON.parse(readFileSync(new URL('../data/debug-response.json', import.meta.url), 'utf-8'));

test('extractCharacter 提取当前影画等级与列表', () => {
  const c = extractCharacter(debug);
  assert.ok(c);
  assert.equal(typeof c.mindscape.rank, 'number');
  assert.ok(Array.isArray(c.mindscape.ranks) && c.mindscape.ranks.length >= 1);
  const first = c.mindscape.ranks[0];
  assert.ok(typeof first.name === 'string' && first.name.length > 0, '影画应有名称');
  assert.ok('isUnlocked' in first && 'desc' in first, '影画应有解锁状态与描述');
});

test('extractCharacter 提取技能等级与标题', () => {
  const c = extractCharacter(debug);
  assert.ok(Array.isArray(c.skills) && c.skills.length > 0, '应有技能列表');
  const types = c.skills.map((s) => s.type);
  assert.ok(types.includes(0), '应含普攻(skill_type=0)');
  assert.ok(types.includes(1), '应含特殊技(skill_type=1)');
  for (const s of c.skills) {
    assert.equal(typeof s.level, 'number', '技能应有等级');
    assert.ok(Array.isArray(s.items) && s.items.length > 0, '技能应有条目');
    assert.ok(typeof s.items[0].title === 'string');
    assert.ok('text' in s.items[0], '技能应有完整描述');
  }
});

test('extractCharacter 提取皮肤 / 元素代码 / 音擎特效标题', () => {
  const c = extractCharacter(debug);
  assert.ok(Array.isArray(c.skins));
  assert.equal(typeof c.elementType, 'number');
  assert.equal(typeof c.profession, 'number');
  assert.equal(typeof c.subElementType, 'number');
  assert.ok(typeof c.verticalPaintingColor === 'string');
  assert.ok(typeof c.usName === 'string');
  assert.equal(c.wengine.specialEffectTitle, '失乐园', '音擎特效标题应提取');
  assert.ok(c.wengine.specialEffect.length > 0);
  assert.ok(c.skillAwaken && typeof c.skillAwaken.hasSystem === 'boolean');
});

test('全量提取结果能通过 schema 校验', () => {
  const c = extractCharacter(debug);
  assert.deepEqual(validateCharacter(c), []);
});
