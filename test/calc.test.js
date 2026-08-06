import test from 'node:test';
import assert from 'node:assert/strict';
import { setCalcContext, calculateCharacter, hitCount, discGrowth, targetGap } from '../src/lib/calc.js';
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

test('targetGap 按目标面板估算副词条缺口', () => {
  setCalcContext({ readCharTarget: () => ({ 暴击率: 60 }) });
  const c = characters[0];
  const R = calculateCharacter(c);
  const g = targetGap(c, R);
  setCalcContext({ readCharTarget: () => ({}) });
  const cur = R.final['暴击率'];
  if (cur != null && cur < 0.6) {
    // 目标未达成：应有缺口分析，且暴击率缺口为正整数
    assert.ok(g, '未达成目标应有缺口分析');
    const crit = g.items.find((it) => it.name === '暴击率');
    assert.ok(crit, '缺口应包含暴击率');
    assert.ok(Number.isInteger(crit.count) && crit.count >= 1, `暴击率缺口应为正整数，得到 ${crit.count}`);
    assert.ok(crit.type === '暴击率', '应标注副词条类型');
    assert.ok(g.total >= crit.count, '总缺口应不小于单项缺口');
  } else {
    assert.ok(!g || g.total === 0, '已达标时缺口应为空');
  }
});

test('targetGap 攻击力缺口按满级基础估算，附固定值词条备选', () => {
  setCalcContext({ readCharTarget: () => ({ 攻击力: 9999999 }) }); // 大目标保证必有缺口
  const c = characters[0];
  const R = calculateCharacter(c);
  const g = targetGap(c, R);
  setCalcContext({ readCharTarget: () => ({}) });
  const atk = g?.items.find((it) => it.name === '攻击力');
  assert.ok(atk, '攻击力应产生缺口项');
  assert.equal(atk.type, '攻击力%');
  assert.ok(Number.isInteger(atk.count) && atk.count >= 1, `百分比词条数应为正整数，得到 ${atk.count}`);
  assert.ok(Number.isInteger(atk.countFlat) && atk.countFlat >= 1, `固定值词条数应为正整数，得到 ${atk.countFlat}`);
});

test('全库角色 coreSkillBoost 数据完整（核心技基础面板提升）', () => {
  let count = 0;
  for (const c of Object.values(library.characters)) {
    const b = c.coreSkillBoost;
    if (b) {
      count++;
      for (const [k, v] of Object.entries(b)) {
        assert.ok(Number.isFinite(v) && v > 0, `${c.name} coreSkillBoost.${k} 应为正数，得到 ${v}`);
      }
    }
  }
  assert.ok(count >= 50, `应有 ≥50 个角色含核心技基础提升，实际 ${count}`);
});

test('核心技提升提取：仅 A-F 档无条件基础提升，数字档增强不计入', () => {
  const get = (n) => library.characters[n]?.coreSkillBoost || {};
  assert.equal(get('诺姆·霍洛维尔')['暴击率'], 0.144, '暴击率提升 4.8%×3 → 0.144');
  assert.equal(get('千夏')['攻击力%'], 0.21, '攻击力百分比提升 7%×3 → 0.21');
  assert.equal(get('照')['生命值%'], 0.18, '生命值百分比提升 6%×3 → 0.18');
  assert.equal(get('佩洛伊斯')['暴击率'], 0.144, '暴击率提升');
  assert.equal(get('冯·莱卡恩')['冲击力'], 18, 'A-F 档基础冲击力 6×3 → 18');
  // 数字档（2-6）核心被动增强不是基础面板提升，不得计入 coreSkillBoost
  assert.ok(!('暴击伤害' in get('猫宫又奈')), '猫宫又奈数字档暴击伤害不计入');
  assert.ok(!('暴击伤害' in get('「11号」')), '「11号」数字档暴击伤害不计入');
  assert.ok(!('攻击力%' in get('浅羽悠真')), '浅羽悠真数字档攻击力不计入');
  assert.ok(!('冲击力%' in get('冯·莱卡恩')), '冯·莱卡恩数字档冲击力不计入');
  // 不应存在 coreSkillEnhance 字段
  assert.ok(!('coreSkillEnhance' in library.characters['猫宫又奈']), '不应有 coreSkillEnhance 字段');
});

test('targetGap 未配置目标返回 null；属性伤害加成无法副词条补足', () => {
  setCalcContext({ readCharTarget: () => ({}) });
  assert.equal(targetGap(characters[0], calculateCharacter(characters[0])), null);
  setCalcContext({ readCharTarget: () => ({ 属性伤害加成: 50 }) });
  const R = calculateCharacter(characters[0]);
  const g = targetGap(characters[0], R);
  setCalcContext({ readCharTarget: () => ({}) });
  // 若当前伤害加成低于 50%，缺口项 count 应为 null（副词条不可达成）
  const item = g?.items.find((it) => it.name === '属性伤害加成');
  if (item) assert.equal(item.count, null);
});
