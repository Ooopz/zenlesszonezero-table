// test/workshop-extract.test.js —— 工坊提取扩展：技能等级（mys/2025 两源）+ 深渊战绩裁剪（extractAbyss）
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBuild, extractAbyss } from '../src/sync/workshop.js';

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

// ---------- extractAbyss：深渊战绩裁剪 ----------

const RAW_ABYSS = {
  uid: '13503759',
  max_layer: 7,
  rating_list: [{ times: 4, rating: 'S' }],
  fast_layer_time: 39,
  battle_time_47: 368,
  schedule_id: 62032,
  begin_time: 1760040000,
  end_time: 1761249599,
  all_roles: [1301, 1021, 1041],
  all_floor_detail: [
    {
      layer_id: 'l1',
      layer_index: 0,
      zone_name: '层一',
      rating: 'S',
      challenge_time: 0,
      floor_challenge_time: 0,
      buffs: [{ title: '赤海巡鲨', text: '很长很长的buff描述文本……' }],
      node_1: {
        buddy: { id: 54019, level: 60, rarity: 'S', bangboo_rectangle_url: 'https://example.com/buddy.png' },
        battle_time: 76,
        avatars: [
          { id: 1381, rank: 2, level: 60, rarity: 'S', element_type: 203, avatar_profession: 1, role_square_url: 'https://example.com/a.png' },
          { id: 1361, rank: 1, level: 60, rarity: 'S', element_type: 203, avatar_profession: 2, role_square_url: 'https://example.com/b.png' },
        ],
        monster_info: {
          list: [{ id: 930169, name: '秽息蚀者·阿瓦鲁斯', icon_url: 'https://example.com/m.png', bg_icon: 'https://example.com/bg.png' }],
        },
      },
      node_2: null,
    },
  ],
};

test('extractAbyss：保留可分析字段、去掉图片 URL 与长文本、明显瘦身', () => {
  const out = extractAbyss(RAW_ABYSS);
  assert.ok(out);
  assert.equal(out.max_layer, 7);
  assert.deepEqual(out.rating_list, [{ times: 4, rating: 'S' }]);
  assert.equal(out.fast_layer_time, 39);
  assert.deepEqual(out.all_roles, [1301, 1021, 1041]);
  const floor = out.floors[0];
  assert.equal(floor.zone_name, '层一');
  assert.equal(floor.rating, 'S');
  // buffs 只留标题
  assert.deepEqual(floor.buffs, [{ title: '赤海巡鲨' }]);
  // node 保留实战配队（无图片 URL）
  assert.deepEqual(floor.node_1.avatars, [
    { id: 1381, rank: 2, level: 60, rarity: 'S', element_type: 203, avatar_profession: 1 },
    { id: 1361, rank: 1, level: 60, rarity: 'S', element_type: 203, avatar_profession: 2 },
  ]);
  assert.deepEqual(floor.node_1.buddy, { id: 54019, level: 60, rarity: 'S' });
  assert.deepEqual(floor.node_1.monsters, [{ id: 930169, name: '秽息蚀者·阿瓦鲁斯' }]);
  assert.equal(floor.node_1.battle_time, 76);
  // 空 node 保留 null
  assert.equal(floor.node_2, null);
  // 瘦身有效性：裁剪后体积不增，且不再包含图片 URL 与 buff 长文本
  const outStr = JSON.stringify(out);
  assert.ok(outStr.length <= JSON.stringify(RAW_ABYSS).length, '裁剪后体积不应增大');
  assert.ok(!outStr.includes('https://'), '裁剪后不应残留图片 URL');
  assert.ok(!outStr.includes('buff描述'), '裁剪后不应残留 buff 长文本');
});

test('extractAbyss：无数据（null/undefined）返回 null', () => {
  assert.equal(extractAbyss(null), null);
  assert.equal(extractAbyss(undefined), null);
});
