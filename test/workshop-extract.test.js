// test/workshop-extract.test.js —— 工坊提取：技能等级（mys/2025 两源）+ 面板/音擎/驱动盘同构
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBuild } from '../src/sync/workshop.js';

// ---------- extractBuild：技能等级提取 ----------

test('extractBuild mys 源：提取 skills 且主/副词条与 2025 源同构（main=主词条、subs=全部副词条）', () => {
  const v3 = {
    data: {
      roles: [
        {
          item_id: '1081',
          level: 60,
          rank: 6,
          relic_point: '257.00',
          item_json: {
            weapon: {
              id: 13108,
              name: '仿制星徽引擎',
              level: 60,
              rarity: 'A',
              main_properties: [{ property_name: '基础攻击力', base: '624' }],
            },
            properties: [{ property_name: '攻击力', base: '1411', add: '1811', final: '3222' }],
            skills: [
              { skill_type: 0, level: 15 },
              { skill_type: 1, level: 15 },
              { skill_type: 5, level: 7 },
            ],
            equip: [
              {
                id: 33541,
                name: '沧浪行歌[1]',
                level: 15,
                rarity: 'S',
                equip_suit: { name: '沧浪行歌' },
                main_properties: [{ property_name: '生命值', base: '2200' }],
                properties: [
                  { property_name: '暴击率', base: '4.8%', valid: true },
                  { property_name: '防御力', base: '15', valid: false }, // 无效副词条也必须保留
                  { property_name: '攻击力', base: '9%', valid: true },
                ],
              },
            ],
          },
        },
      ],
    },
  };
  const build = extractBuild(v3, '1081', { weapons: [], artifacts: [], items: {} });
  assert.ok(build, 'mys 源应提取成功');
  assert.deepEqual(build.skills, [
    { type: 0, level: 15 },
    { type: 1, level: 15 },
    { type: 5, level: 7 },
  ]);
  assert.equal(build.level, 60);
  assert.equal(build.rank, 6);
  assert.equal(build.relic_point, 257, 'relic_point 归一为数字');
  assert.equal(build.weapon.name, '仿制星徽引擎');
  assert.equal(build.panel[0].name, '攻击力');
  assert.equal(build.equips[0].suit, '沧浪行歌');
  // 主词条来自 main_properties
  assert.deepEqual(build.equips[0].main, [{ name: '生命值', value: '2200' }]);
  // 副词条来自 properties 全量（含 valid:false 的防御力），不提取 valid 标记
  assert.deepEqual(build.equips[0].subs, [
    { name: '暴击率', value: '4.8%' },
    { name: '防御力', value: '15' },
    { name: '攻击力', value: '9%' },
  ]);
  assert.equal('valid' in build.equips[0].subs[0], false, 'valid 标记不应提取（非两源共有）');
});

test('extractBuild 2025 源：提取 skills（SkillLevelList Index → type）', () => {
  const v3 = {
    data: {
      roles: [
        {
          item_id: '1431',
          level: 60,
          rank: 6,
          relic_point: '295.90',
          item_json: {
            Id: 1431,
            Level: 60,
            TalentLevel: 6,
            SkillLevelList: [
              { Index: 0, Level: 12 },
              { Index: 1, Level: 12 },
              { Index: 5, Level: 7 },
            ],
            Weapon: { Id: 14143, Level: 60, BreakLevel: 5, UpgradeLevel: 1 },
            EquippedList: [
              {
                Slot: 1,
                Equipment: {
                  Id: 33541,
                  Level: 15,
                  MainPropertyList: [{ PropertyId: 11103, PropertyLevel: 1, PropertyValue: 550 }],
                  RandomPropertyList: [{ PropertyId: 21103, PropertyLevel: 3, PropertyValue: 480 }],
                },
              },
            ],
          },
        },
      ],
    },
  };
  const ctx = {
    weapons: [{ item_id: '14143', nick_name: '云霓孤光' }],
    artifacts: [{ set_id: '33500', name: '沧浪行歌' }],
    items: { 33541: { Rarity: 4, SuitId: 33500 } },
  };
  const build = extractBuild(v3, '1431', ctx);
  assert.ok(build, '2025 源应提取成功');
  assert.deepEqual(build.skills, [
    { type: 0, level: 12 },
    { type: 1, level: 12 },
    { type: 5, level: 7 },
  ]);
  assert.equal(build.weapon.name, '云霓孤光');
  assert.equal(build.equips[0].suit, '沧浪行歌');
});

test('extractBuild：skills 缺失时不崩（旧数据/字段缺失容错）', () => {
  const v3 = {
    data: {
      roles: [
        {
          item_id: '1081',
          level: 60,
          rank: 0,
          relic_point: '100.00',
          item_json: { properties: [{ property_name: '攻击力', base: '1', add: '1', final: '2' }], equip: [] },
        },
      ],
    },
  };
  const build = extractBuild(v3, '1081', { weapons: [], artifacts: [], items: {} });
  assert.ok(build);
  assert.deepEqual(build.skills, []);
  assert.equal(build.relic_point, 100, '字符串评分归一为数字');
});

test('extractBuild：relic_point 0/缺失归一为 null', () => {
  const v3 = {
    data: {
      roles: [
        {
          item_id: '1081',
          level: 60,
          rank: 0,
          relic_point: '0.00',
          item_json: { properties: [{ property_name: '攻击力', base: '1', add: '1', final: '2' }], equip: [] },
        },
      ],
    },
  };
  const build = extractBuild(v3, '1081', { weapons: [], artifacts: [], items: {} });
  assert.ok(build);
  assert.equal(build.relic_point, null, '0 评分视为缺失');
});
