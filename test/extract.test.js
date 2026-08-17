import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCharacter } from '../src/sync/characters.js';
import { isMaxedRole } from '../src/sync/workshop.js';
import { validateCharacter } from '../src/lib/schema.js';
import { loadDataFile } from './helpers.js';

// 数据就绪检查：测试依赖 data/ 已同步的原始数据，缺失时提示先更新。
// extractCharacter 的输入是账号接口响应（data/debug-response.json，不入库），其结构不存在于
// raw-library.json / library.json 中，因此提取逻辑用下方内联的最小账号响应 fixture（结构对齐真实响应）。
loadDataFile('raw-library.json', 'npm run sync:library（或网页「更新数据库」）');
const AVATAR_INFO = {
  data: {
    avatar_list: [
      {
        id: 1001,
        full_name_mi18n: '测试角色',
        level: 60,
        role_square_url: 'https://example.com/icon.png',
        role_vertical_painting_url: 'https://example.com/portrait.png',
        rarity: 'S',
        camp_name_mi18n: '测试阵营',
        element_type: 1,
        avatar_profession: 2,
        sub_element_type: 0,
        vertical_painting_color: '#FFFFFF',
        us_full_name: 'TestChar',
        skin_list: [
          {
            skin_id: 1,
            skin_name: '初始',
            skin_vertical_painting_url: '',
            skin_square_url: '',
            skin_hollow_icon_path: '',
            skin_vertical_painting_color: '',
            unlocked: true,
            rarity: 'S',
            is_original: true,
          },
        ],
        rank: 1,
        ranks: [
          { id: 1, name: '影画·一', pos: 1, is_unlocked: true, desc: '第一层效果说明' },
          { id: 2, name: '影画·二', pos: 2, is_unlocked: false, desc: '第二层效果说明' },
        ],
        properties: [
          { property_name: '攻击力', base: '100', add: '20', final: '120' },
          { property_name: '生命值', base: '8000', add: '200', final: '8200' },
          { property_name: '暴击率', base: '0.05', add: '0.1', final: '0.15' },
        ],
        weapon: {
          name: '测试音擎',
          level: 60,
          star: 2,
          icon: 'https://example.com/w.png',
          talent_title: '失乐园',
          talent_content: '提升全队攻击力 10%',
          main_properties: [{ property_name: '基础攻击力', base: '714' }],
          properties: [{ property_name: '攻击力%', base: '0.24' }],
        },
        // 只放一个真实盘，extractCharacter 会把缺槽补到 6
        equip: [
          {
            equip_suit: { name: '测试盘', icon: '' },
            name: '测试盘',
            level: 15,
            rarity: 'S',
            main_properties: [{ property_name: '攻击力%', base: '0.09' }],
            properties: [{ property_name: '暴击率', base: '0.024' }],
          },
        ],
        skills: [
          { skill_type: 0, level: 6, items: [{ title: '普通攻击', text: '普通攻击描述', awaken: false }] },
          { skill_type: 1, level: 6, items: [{ title: '特殊技', text: '特殊技描述', awaken: true }] },
        ],
        skill_awaken: {
          has_awaken_system: true,
          awaken_level: 2,
          awaken_max_level: 6,
          skill_awaken_items: [],
        },
        equip_plan_info: null,
      },
    ],
  },
};

test('extractCharacter 提取当前影画等级与列表', () => {
  const c = extractCharacter(AVATAR_INFO);
  assert.ok(c);
  assert.equal(typeof c.mindscape.rank, 'number');
  assert.ok(Array.isArray(c.mindscape.ranks) && c.mindscape.ranks.length >= 1);
  const first = c.mindscape.ranks[0];
  assert.ok(typeof first.name === 'string' && first.name.length > 0, '影画应有名称');
  assert.ok('isUnlocked' in first && 'desc' in first, '影画应有解锁状态与描述');
});

test('extractCharacter 提取技能等级与标题', () => {
  const c = extractCharacter(AVATAR_INFO);
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
  const c = extractCharacter(AVATAR_INFO);
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
  const c = extractCharacter(AVATAR_INFO);
  assert.deepEqual(validateCharacter(c), []);
});

// ---------- isMaxedRole：爬取过滤（角色/音擎≥60、驱动盘恰 6 块全 15 级且全 R5，兼容 mys/2025 两源） ----------
const mysRole = (level, wpnLevel, discLevels, rarities) => ({
  level,
  item_json: {
    weapon: { level: wpnLevel },
    equip: discLevels.map((lv, i) => ({ level: lv, rarity: rarities?.[i] ?? 5 })),
  },
});
const role2025 = (level, wpnLevel, discLevels, rarities) => ({
  level,
  item_json: {
    Weapon: { Level: wpnLevel },
    EquippedList: discLevels.map((lv, i) =>
      lv == null ? { Equipment: null } : { Equipment: { Level: lv, Rarity: rarities?.[i] ?? 5 } }
    ),
  },
});

test('isMaxedRole：练满角色通过（mys/2025 两源）', () => {
  assert.equal(isMaxedRole(mysRole(60, 60, [15, 15, 15, 15, 15, 15])), true, 'mys 源合格');
  assert.equal(isMaxedRole(role2025(60, 60, [15, 15, 15, 15, 15, 15])), true, '2025 源合格');
});

test('isMaxedRole：角色不满 60 级排除', () => {
  assert.equal(isMaxedRole(mysRole(59, 60, [15, 15, 15, 15, 15, 15])), false);
});

test('isMaxedRole：音擎不满 60 级 / 无音擎排除', () => {
  assert.equal(isMaxedRole(mysRole(60, 59, [15, 15, 15, 15, 15, 15])), false, '音擎 59 级');
  assert.equal(isMaxedRole(role2025(60, null, [15, 15, 15, 15, 15, 15])), false, '2025 无音擎');
  assert.equal(isMaxedRole(mysRole(60, null, [15, 15, 15, 15, 15, 15])), false, 'mys 无音擎');
});

test('isMaxedRole：驱动盘不是 6 块 15 级排除', () => {
  assert.equal(isMaxedRole(mysRole(60, 60, [15, 15, 15, 15, 15])), false, '只 5 块盘');
  assert.equal(isMaxedRole(mysRole(60, 60, [15, 15, 15, 15, 15, 14])), false, '某盘 14 级');
  assert.equal(isMaxedRole(role2025(60, 60, [15, 15, 15, 15, 15, null])), false, '2025 有未装备槽');
});

test('isMaxedRole：驱动盘必须全部 R5（金色盘），混入 R4 排除（R4 上限 +12 非满配）', () => {
  assert.equal(isMaxedRole(mysRole(60, 60, [15, 15, 15, 15, 15, 15], [5, 5, 5, 5, 5, 4])), false, 'mys 混入 R4');
  assert.equal(isMaxedRole(role2025(60, 60, [15, 15, 15, 15, 15, 15], [5, 5, 5, 5, 4, 5])), false, '2025 混入 R4');
  assert.equal(isMaxedRole(role2025(60, 60, [15, 15, 15, 15, 15, 15], [5, 5, 5, 5, 5, 5])), true, '2025 全 R5');
});

test('isMaxedRole：无 item_json / 非角色对象排除', () => {
  assert.equal(isMaxedRole(null), false);
  assert.equal(isMaxedRole({ level: 60 }), false);
  assert.equal(isMaxedRole({ level: 60, item_json: null }), false);
});
