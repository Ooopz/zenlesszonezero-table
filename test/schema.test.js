import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLibrary, validateCharacters, validateCharacter, KEYS } from '../src/lib/schema.js';

function readData(name) {
  return JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf-8'));
}

test('KEYS 键名定义完整', () => {
  assert.equal(KEYS.NAME, 'name');
  assert.equal(KEYS.MAIN_STATS, 'mainStats');
  assert.equal(KEYS.MAX_LEVEL, 'maxLevel');
  assert.equal(KEYS.CHAR_TARGETS, 'charTargets');
});

test('validateLibrary 对现有属性库通过', () => {
  const errors = validateLibrary(readData('library.json'));
  assert.deepEqual(errors, []);
});

test('validateCharacters 对现有角色数据通过', () => {
  const errors = validateCharacters(readData('characters.json'));
  assert.deepEqual(errors, []);
});

test('validateCharacter 能发现缺 name 的异常', () => {
  assert.notEqual(validateCharacter({ id: '1' }).length, 0);
  assert.deepEqual(validateCharacter(null), ['角色应为对象']);
});

test('validateCharacters 拒绝非数组', () => {
  assert.deepEqual(validateCharacters({}), ['角色数据应为数组']);
});
