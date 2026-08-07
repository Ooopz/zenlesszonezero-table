import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setCalcContext,
  calculateCharacter,
  hitCount,
  discGrowth,
  targetGap,
  panelBonus,
  classifyBonus,
  atkWhiteValue,
  inBattleAtk,
  coreSkillBoostAt,
} from '../src/lib/calc.js';
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

test('全库角色 coreSkillBoost 数据完整（核心技每档基础面板提升）', () => {
  let count = 0;
  for (const c of Object.values(library.characters)) {
    const b = c.coreSkillBoost;
    if (Array.isArray(b) && b.length) {
      count++;
      for (const item of b) {
        if (!item) continue; // 该档无基础提升（null 占位）
        for (const [k, v] of Object.entries(item)) {
          assert.ok(Number.isFinite(v) && v > 0, `${c.name} coreSkillBoost 档位 ${k} 应为正数，得到 ${v}`);
        }
      }
    }
  }
  assert.ok(count >= 50, `应有 ≥50 个角色含核心技基础提升，实际 ${count}`);
});

test('核心技提升提取：每档增量数组，满级累计 = 各档之和；数字档增强不计入', () => {
  const get = (n) => library.characters[n]?.coreSkillBoost || [];
  // 满级累计 = 各档增量之和（核心技等级 7 = A-F 全升）
  const sum = (list, name) => (Array.isArray(list) ? list.reduce((s, it) => s + (it?.[name] || 0), 0) : list?.[name] || 0);
  const hasStat = (list, name) => (Array.isArray(list) ? list.some((it) => it && name in it) : name in (list || {}));
  const approx = (v, exp) => assert.ok(Math.abs(v - exp) < 1e-9, `期望 ≈${exp}，得到 ${v}`);
  approx(sum(get('诺姆·霍洛维尔'), '暴击率'), 0.144); // 暴击率提升 4.8%×3
  approx(sum(get('千夏'), '攻击力%'), 0.21); // 攻击力百分比提升 7%×3
  approx(sum(get('照'), '生命值%'), 0.18); // 生命值百分比提升 6%×3
  approx(sum(get('佩洛伊斯'), '暴击率'), 0.144); // 暴击率提升
  assert.equal(sum(get('冯·莱卡恩'), '冲击力'), 18, 'A-F 档基础冲击力 6×3 → 18');
  // 数字档（2-6）核心被动增强不是基础面板提升，不得计入 coreSkillBoost
  assert.ok(!hasStat(get('猫宫又奈'), '暴击伤害'), '猫宫又奈数字档暴击伤害不计入');
  assert.ok(!hasStat(get('「11号」'), '暴击伤害'), '「11号」数字档暴击伤害不计入');
  assert.ok(!hasStat(get('浅羽悠真'), '攻击力%'), '浅羽悠真数字档攻击力不计入');
  assert.ok(!hasStat(get('冯·莱卡恩'), '冲击力%'), '冯·莱卡恩数字档冲击力不计入');
  // 不应存在 coreSkillEnhance 字段
  assert.ok(!('coreSkillEnhance' in library.characters['猫宫又奈']), '不应有 coreSkillEnhance 字段');
});

test('全库角色核心被动满级数据 corePassiveMax 完整（末档内嵌详情）', () => {
  // corePassiveMax = 核心技 A-F 档中末档（最高档）data-name 解码后的核心被动完整说明，
  // 即满级数据；wiki 说明标注「此处数据为初始数据」仅指 A 档（核心被动 1 级）。
  let count = 0;
  for (const c of Object.values(library.characters)) {
    if (c.corePassiveMax === undefined) continue;
    count++;
    assert.equal(typeof c.corePassiveMax, 'string', `${c.name} corePassiveMax 应为字符串`);
    assert.ok(c.corePassiveMax.length > 50, `${c.name} corePassiveMax 过短（应为完整描述）`);
    assert.ok(/<p|<span|\[/.test(c.corePassiveMax), `${c.name} corePassiveMax 应为富文本/游戏标记描述`);
  }
  assert.ok(count >= 50, `应有 ≥50 个角色含核心被动满级数据，实际 ${count}`);

  // 抽查：满级描述应与初始档（核心技 desc，标注「初始数据」）不同——数值逐档提升
  const lm = library.characters['蕾米埃尔·丹'];
  const lmInitial = lm.skills?.find((s) => s.type === '核心技')?.items?.[0]?.desc || '';
  assert.ok(lmInitial.length > 0, '蕾米埃尔应有核心技初始说明');
  assert.notEqual(lm.corePassiveMax, lmInitial, '蕾米埃尔满级核心被动描述应不同于初始档');
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

test('局外面板公式：panelBonus 单一属性合成', () => {
  // multStats（攻击力）：基础×(1+Σ%)+Σ固定
  assert.deepEqual(panelBonus('攻击力', 1000, 0.1, 50), { bonus: 150, final: 1150 });
  assert.deepEqual(panelBonus('生命值', 8000, 0.05, 0), { bonus: 400, final: 8400 });
  // 非 multStats（暴击率）：纯加法（值为小数；浮点容差比较）
  const crit = panelBonus('暴击率', 0.05, 0.1, 0);
  assert.equal(crit.bonus, 0.1);
  assert.ok(Math.abs(crit.final - 0.15) < 1e-9, `final 应≈0.15，得到 ${crit.final}`);
  // base 为空返回 null
  assert.equal(panelBonus('攻击力', null), null);
});

test('局外面板公式：classifyBonus 加成分类', () => {
  assert.equal(classifyBonus('冰属性伤害加成', 0.1).kind, 'damage');
  assert.equal(classifyBonus('穿透值', 9).kind, 'pen');
  assert.equal(classifyBonus('攻击力', 0.1).kind, 'pct'); // multStats 且 ≤1 → 百分比
  assert.equal(classifyBonus('攻击力', 19).kind, 'flat'); // multStats 且 >1 → 固定
  assert.equal(classifyBonus('暴击率', 0.024).kind, 'pct'); // 非 multStats → 百分比
  assert.equal(classifyBonus('攻击力', null), null); // 无效值
  assert.equal(classifyBonus(null, 5), null);
});

test('局外面板公式：atkWhiteValue / inBattleAtk', () => {
  assert.equal(atkWhiteValue(784, 624), 1408); // 无核心技提升
  assert.equal(atkWhiteValue(784, 624, 75), 1483); // 含核心技满级攻击提升
  assert.equal(inBattleAtk(3087), 3087); // 无局内加成恒等
  assert.equal(inBattleAtk(3087, { inPct: 0.25 }), 3087 * 1.25);
  assert.equal(inBattleAtk(3087, { inPct: 0.2, inFlat: 100 }), 3087 * 1.2 + 100);
});

test('calculateCharacter 基础攻击含核心技提升且账号路径不重复计算', () => {
  const lib = library.characters['星徽·比利·奇德'];
  // ① wiki 推算路径（无 panel）：base.攻击力 = 满级攻击 + 音擎基础攻击 + 核心技攻击提升
  const c = {
    name: '星徽·比利·奇德',
    wengine: { name: '青溟笼舍', level: 60, mainStats: [{ name: '基础攻击力', value: 620 }] },
    discs: [],
    panel: null,
  };
  const R = calculateCharacter(c);
  // 无 skills → coreLevel 默认满级 7，核心技基础攻击提升 75（25×3）
  assert.equal(R.base.攻击力, lib.maxLevel.攻击力 + 620 + 75, 'wiki 推算应计入核心技满级攻击提升');
  // ② 账号 panel 路径：直接用账号 base，不额外加 coreAtk
  const c2 = {
    name: '星徽·比利·奇德',
    wengine: { name: '青溟笼舍', level: 60 },
    discs: [],
    panel: { 攻击力: { base: 1500, bonus: 100, final: 1600 } },
  };
  const R2 = calculateCharacter(c2);
  assert.equal(R2.base.攻击力, 1500, '账号路径直接取面板 base');
  assert.equal(R2.actual.攻击力.final, 1600);
});

test('coreSkillBoostAt 按核心技等级累计基础面板提升', () => {
  const lib = library.characters['蕾米埃尔·丹']; // A/C/E 档异常精通+18，B/D/F 档攻击力+25
  assert.equal(coreSkillBoostAt(lib, '异常精通', 1), 0, 'lv1 无档位加成');
  assert.equal(coreSkillBoostAt(lib, '异常精通', 2), 18, 'lv2 = A 档');
  assert.equal(coreSkillBoostAt(lib, '攻击力', 3), 25, 'lv3 = A+B 的攻击力档');
  assert.equal(coreSkillBoostAt(lib, '异常精通', 4), 36, 'lv4 = A+C');
  assert.equal(coreSkillBoostAt(lib, '异常精通', 7), 54, 'lv7 满级 = A+C+E');
  assert.equal(coreSkillBoostAt(lib, '攻击力', 7), 75, 'lv7 满级 = B+D+F');
  // 旧结构（满级累计对象）兼容
  assert.equal(coreSkillBoostAt({ coreSkillBoost: { 攻击力: 75 } }, '攻击力', 3), 75);
  assert.equal(coreSkillBoostAt({ coreSkillBoost: { 攻击力: 75 } }, '异常精通', 7), 0);
  // 缺核心技数据返回 0
  assert.equal(coreSkillBoostAt({}, '攻击力', 7), 0);
});

test('calculateCharacter 理论面板按核心技当前等级计算', () => {
  const lib = library.characters['蕾米埃尔·丹'];
  const base = {
    name: '蕾米埃尔·丹',
    wengine: { name: '青溟笼舍', level: 60, mainStats: [{ name: '基础攻击力', value: 620 }] },
    discs: [],
    panel: null,
  };
  // 核心技 5 级 = A-D 四档：攻击力档 B/D = 25×2 = 50
  const R5 = calculateCharacter({ ...base, skills: [{ type: 5, level: 5 }] });
  assert.equal(R5.theoretical.base.攻击力, lib.maxLevel.攻击力 + 620 + 50, 'lv5 理论基础攻击 = 满级+音擎+核心技50');
  // 核心技 7 级满 = A-F：攻击力 B/D/F = 25×3 = 75
  const R7 = calculateCharacter({ ...base, skills: [{ type: 5, level: 7 }] });
  assert.equal(R7.theoretical.base.攻击力, lib.maxLevel.攻击力 + 620 + 75, 'lv7 理论基础攻击 = 满级+音擎+核心技75');
  // 核心技数值类加成（异常精通 A/C/E 档 18×3=54）计入理论基础值，不只是攻击力
  assert.equal(R7.theoretical.base.异常精通, lib.异常精通 + 54, 'lv7 理论异常精通基础 = wiki基础 + 核心技54');
  // 无 skills → coreLevel 默认满级 7
  const Rdef = calculateCharacter(base);
  assert.equal(Rdef.theoretical.base.攻击力, lib.maxLevel.攻击力 + 620 + 75);
  // 理论面板装备词条与最终面板一致（无盘时 bonus 一致）
  assert.equal(R7.theoretical.final.攻击力, R7.theoretical.base.攻击力 + (R7.theoretical.bonus.攻击力 || 0));
});

test('穿透值理论面板：无基础值，final = 装备词条累加', () => {
  const c = {
    name: '蕾米埃尔·丹',
    skills: [{ type: 5, level: 7 }],
    wengine: null,
    discs: [
      { set: '啄木鸟电音', slot: 5, level: 15, mainStats: [], subStats: [{ name: '穿透值', value: 18 }] },
      { set: '啄木鸟电音', slot: 6, level: 15, mainStats: [], subStats: [{ name: '穿透值', value: 36 }] },
    ],
    panel: null,
  };
  const R = calculateCharacter(c);
  assert.equal(R.theoretical.base.穿透值, 0, '穿透值无基础值（基础记为 0）');
  assert.equal(R.theoretical.final.穿透值, 54, '理论穿透值 = 装备词条之和（18+36）');
});

test('命破角色贯穿力独立派生（0.3×攻击 + 0.1×生命），穿透率置空', () => {
  const lib = library.characters['仪玄'];
  assert.equal(lib.trait, '命破', '仪玄应为命破角色');
  assert.ok('贯穿力' in lib && !('穿透率' in lib), 'wiki 数据贯穿力独立、无穿透率');
  const c = { name: '仪玄', skills: [{ type: 5, level: 7 }], wengine: null, discs: [], panel: null };
  const R = calculateCharacter(c);
  const expected = Math.round(0.3 * R.final.攻击力 + 0.1 * R.final.生命值);
  assert.equal(R.final.贯穿力, expected, '命破最终贯穿力 = 0.3×攻击+0.1×生命');
  assert.equal(R.theoretical.final.贯穿力, expected, '命破理论贯穿力同为派生值');
  assert.equal(R.theoretical.base.贯穿力, Math.round(0.3 * R.theoretical.base.攻击力 + 0.1 * R.theoretical.base.生命值), '贯穿力基础值同派生');
  // 命破角色无穿透率
  assert.equal(R.final.穿透率, null, '命破角色无穿透率');
  assert.equal(R.theoretical.final.穿透率, null);
  // 非命破角色：贯穿力为 null，穿透率保持普通属性
  const c2 = { name: '蕾米埃尔·丹', skills: [], wengine: null, discs: [], panel: null };
  const R2 = calculateCharacter(c2);
  assert.ok(R2.final.贯穿力 == null, '非命破角色无贯穿力');
  assert.ok(R2.final.穿透率 != null && R2.final.穿透率 <= 1, '非命破穿透率是百分比（≤1）');
});

test('理论面板取整规则：攻击/防御向下取整，生命向上取整', () => {
  const lib = library.characters['蕾米埃尔·丹'];
  // 攻击力% 0.1 + 生命值% 0.05，产生小数理论值
  const c = {
    name: '蕾米埃尔·丹',
    skills: [{ type: 5, level: 7 }],
    wengine: { name: '测试音擎', level: 60, mainStats: [{ name: '基础攻击力', value: 620 }] },
    discs: [
      // 驱动盘词条名用「攻击力/生命值」，value≤1 表示百分比
      { set: '测试盘', slot: 5, level: 15, mainStats: [{ name: '攻击力', value: 0.1 }], subStats: [] },
      { set: '测试盘', slot: 6, level: 15, mainStats: [{ name: '生命值', value: 0.05 }], subStats: [] },
    ],
    panel: null,
  };
  const R = calculateCharacter(c);
  const atkRaw = (lib.maxLevel.攻击力 + 620 + 75) * 1.1;
  const hpRaw = lib.maxLevel.生命值 * 1.05;
  assert.ok(!Number.isInteger(atkRaw), '测试前提：攻击原始值应为小数');
  assert.ok(!Number.isInteger(hpRaw), '测试前提：生命原始值应为小数');
  assert.equal(R.theoretical.final.攻击力, Math.floor(atkRaw), `攻击向下取整（原始 ${atkRaw}）`);
  assert.equal(R.theoretical.final.生命值, Math.ceil(hpRaw), `生命向上取整（原始 ${hpRaw}）`);
  assert.equal(R.theoretical.final.防御力, Math.floor(lib.maxLevel.防御力), '防御向下取整');
});

test('驱动盘 2 件套需同套装 ≥2 件才生效', () => {
  // 月光骑士颂 set2 能量自动回复 20%（百分比）；蕾米埃尔核心技无能量回复，基础 1.2
  const mk = (discs) => ({ name: '蕾米埃尔·丹', skills: [{ type: 5, level: 7 }], wengine: null, discs, panel: null });
  const R1 = calculateCharacter(mk([{ set: '月光骑士颂', slot: 1, level: 15, mainStats: [], subStats: [] }]));
  const R2 = calculateCharacter(
    mk([
      { set: '月光骑士颂', slot: 1, level: 15, mainStats: [], subStats: [] },
      { set: '月光骑士颂', slot: 2, level: 15, mainStats: [], subStats: [] },
    ])
  );
  assert.equal(R1.theoretical.final.能量自动回复, 1.2, '仅 1 件套装：set2 不生效');
  assert.ok(Math.abs(R2.theoretical.final.能量自动回复 - 1.2 * 1.2) < 0.01, '同套装 2 件：set2 生效（×20%）');
});
