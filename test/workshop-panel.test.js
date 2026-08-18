// test/workshop-panel.test.js —— 2025 源面板计算（computeEnkaPanel，复现工坊 enka_attrs_mapping）
// fixture 用 workshop-static.js 静态表（不入 data/，无 SKIP 依赖）：
//   角色 1011：BaseProps 生命603/攻击95/防御49/冲击118/暴击率500/暴伤5000/能量120/精通93/掌控94；
//             GrowthProps 生命818426/攻击54230/防御66882；突破档 PromotionProps[3]={1242,102,101}
//   武器 12001：MainStat 攻击32、Secondary 攻击%800
//   盘 31021：Rarity2 → 成长系数 0.3，SuitId 31000；套装 31000 SetBonusProps {20103(暴击率):800}
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEnkaPanel, propName } from '../src/sync/workshop-panel.js';

test('无武器无装备：面板 = 角色基础值（Level 1 时成长/突破/核心均为 0）', () => {
  const p = computeEnkaPanel({ Id: 1011, Level: 1, PromotionLevel: 0, CoreSkillEnhancement: 0, Weapon: null, EquippedList: [] });
  const by = Object.fromEntries(p.map((x) => [x.name, x]));
  assert.equal(by['生命值'].base, '603');
  assert.equal(by['生命值'].final, '603');
  assert.equal(by['攻击力'].final, '95');
  assert.equal(by['防御力'].final, '49');
  assert.equal(by['冲击力'].final, '118');
  assert.equal(by['暴击率'].final, '0.05'); // 基础 500/10000
  assert.equal(by['暴击伤害'].final, '0.5'); // 基础 5000/10000
  assert.equal(by['能量自动回复'].final, '1.2'); // 基础 120/100
  assert.equal(by['异常精通'].final, '93');
  assert.equal(by['异常掌控'].final, '94');
});

test('等级成长 + 突破档生效（Level 60 / 突破 4）', () => {
  const p = computeEnkaPanel({ Id: 1011, Level: 60, PromotionLevel: 4, CoreSkillEnhancement: 0, Weapon: null, EquippedList: [] });
  const by = Object.fromEntries(p.map((x) => [x.name, x]));
  // 攻击 = floor(95 + 54230×59/10000 + 突破档102) = floor(516.957) = 516
  assert.equal(by['攻击力'].base, '516');
  // 生命 = floor(603 + 818426×59/10000 + 1242) = floor(6673.713) = 6673
  assert.equal(by['生命值'].base, '6673');
  // 防御 = floor(49 + 66882×59/10000 + 101) = floor(544.604) = 544
  assert.equal(by['防御力'].base, '544');
});

test('武器 + 2 盘 + 套装 2 件套：主/副属性与套装加成合并', () => {
  const p = computeEnkaPanel({
    Id: 1011, Level: 60, PromotionLevel: 4, CoreSkillEnhancement: 0,
    Weapon: { Id: 12001, Level: 60, BreakLevel: 5 },
    EquippedList: [
      { Equipment: { Id: 31021, Level: 15, MainPropertyList: [{ PropertyId: 12101, PropertyValue: 150 }], RandomPropertyList: [{ PropertyId: 12101, PropertyValue: 19, PropertyLevel: 2 }] } },
      { Equipment: { Id: 31021, Level: 15, MainPropertyList: [{ PropertyId: 13101, PropertyValue: 150 }], RandomPropertyList: [{ PropertyId: 21101, PropertyValue: 480, PropertyLevel: 3 }] } },
    ],
  });
  const by = Object.fromEntries(p.map((x) => [x.name, x]));
  // 武器主攻击 = 32×(1+0.1568167×60+0.8922×5) = 475.84 → base 攻击 = 516+floor(475.84) = 991
  assert.equal(by['攻击力'].base, '991');
  // final = floor(991 + 武器副攻击% 2000/10000×991.957 + 盘主 825 + 盘副词条 38) = floor(2052.39) = 2052
  assert.equal(by['攻击力'].final, '2052');
  // 防御 final = 544 + 盘主 825 = 1369
  assert.equal(by['防御力'].final, '1369');
  // 暴击率 = (基础 500 + 套装 20103 的 800)/10000 = 0.13（2 件套生效）
  assert.equal(by['暴击率'].final, '0.13');
  // 暴伤 = (基础 5000 + 盘副词条 480×3)/10000 = 0.644
  assert.equal(by['暴击伤害'].final, '0.644');
});

test('propName：属性 id 映射（未知 id 带前缀）', () => {
  assert.equal(propName(11101), '生命值');
  assert.equal(propName(12101), '攻击力');
  assert.equal(propName(21101), '暴击伤害百分比');
  assert.equal(propName(99999), '未知99999');
});
