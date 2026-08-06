import test from 'node:test';
import assert from 'node:assert/strict';
import { setCalcContext, calculateCharacter, hitCount, discGrowth } from '../src/lib/calc.js';
import { buildIndex } from '../src/lib/util.js';
import { loadDataFile } from './helpers.js';

const library = loadDataFile('library.json', 'npm run sync:library（或网页「更新数据库」）');
const characters = loadDataFile('characters.json', 'npm run sync:characters（或网页「更新我的角色」）');

setCalcContext({
  library,
  charIndex: buildIndex(library.characters),
  wengineIndex: buildIndex(library.wengines),
  discIndex: buildIndex(library.discs),
  readCharTarget: () => ({}),
  readValidStats: () => [],
});

test('calculateCharacter 对每个角色计算出有限数值面板', () => {
  for (const c of characters) {
    const R = calculateCharacter(c);
    for (const stat of ['攻击力', '生命值', '防御力', '暴击率']) {
      const v = R.final[stat];
      if (v != null) assert.ok(Number.isFinite(v), `${c.name} ${stat} 应为有限数，得到 ${v}`);
    }
  }
});

test('calculateCharacter 攻击力为正数（首个角色）', () => {
  const c = characters[0];
  const R = calculateCharacter(c);
  assert.ok(Number.isFinite(R.final['攻击力']));
  assert.ok(R.final['攻击力'] > 0, `攻击力应 > 0，得到 ${R.final['攻击力']}`);
  assert.ok(R.libCharacter, '应有 wiki 库角色信息');
});

test('calculateCharacter 实际面板结构完整（base/bonus/final）', () => {
  const c = characters[0];
  const R = calculateCharacter(c);
  assert.ok(Object.keys(R.actual).length > 0, '应有账号实际面板');
  for (const [stat, v] of Object.entries(R.actual)) {
    assert.deepEqual(Object.keys(v).sort(), ['base', 'bonus', 'final']);
    assert.ok(Number.isFinite(v.final), `${stat} 实际最终值应为有限数`);
  }
  // 注：推算 final 与实际 final 可能差异较大（核心被动/等级成长未计入推算模型），
  // 这正是前端「实际值优先显示」的原因，故此处不做数值相等断言。
});

test('hitCount 返回 null 或非负整数', () => {
  for (const c of characters) {
    const h = hitCount(c);
    assert.ok(h === null || (Number.isInteger(h) && h >= 0), `${c.name} hitCount=${h}`);
  }
});

test('discGrowth 返回带 growthCount 的词条数组', () => {
  const c = characters[0];
  for (const d of c.discs || []) {
    const g = discGrowth(d, d.rarity || 'S');
    assert.ok(Array.isArray(g));
    for (const item of g) {
      assert.ok('growthCount' in item && Number.isInteger(item.growthCount));
    }
  }
});
