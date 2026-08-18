// test/plans.test.js —— extractPlan（推荐方案提取；item 结构在 feed 与 plan_detail 中一致）
// fixture 模拟米游社养成指南的 item 原始结构（含百分比字符串值、固定值主词条名等需归一化的形态）
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlan } from '../src/sync/plans.js';

const P = {
  id: 42,
  name: '测试方案',
  desc: '说明',
  released_at: '2026-01-15',
  item: {
    avatar: [
      { property_name: '攻击力', low: '1000', mid: '1200', high: '1400' },
      { property_name: '暴击率', low: '40', mid: '50', high: '60' },
    ],
    weapon: { main: { name: '音擎甲' }, backup: { name: '音擎乙' } },
    equip: {
      equip: [
        { name: '套装A', cnt: 4 },
        { name: '套装B', cnt: 2 },
      ],
      main_properties_4: [{ property_name: '暴击率' }],
      main_properties_5: [{ property_name: '攻击力' }],
      main_properties_6: [{ property_name: '异常精通' }],
      sub_properties: [{ property_name: '攻击力百分比' }, { property_name: '暴击伤害' }],
    },
    skill: [
      { skill_type: 0, level: 12 },
      { skill_type: 1, level: 11 },
    ],
    team: { main: { avatar_list: [{ full_name_mi18n: '角色A' }, { name_mi18n: '角色B' }] } },
  },
};

test('extractPlan：基础字段与 id 字符串化', () => {
  const r = extractPlan(P);
  assert.equal(r.id, '42');
  assert.equal(r.name, '测试方案');
  assert.equal(r.desc, '说明');
  assert.equal(r.releasedAt, '2026-01-15');
});

test('extractPlan：面板三档 percent 判定与折算（百分比 /100）', () => {
  const r = extractPlan(P);
  assert.deepEqual(r.panel[0], { name: '攻击力', percent: false, low: 1000, mid: 1200, high: 1400 });
  assert.deepEqual(r.panel[1], { name: '暴击率', percent: true, low: 0.4, mid: 0.5, high: 0.6 });
});

test('extractPlan：套装/主词条/副词条/技能/配队提取与归一', () => {
  const r = extractPlan(P);
  assert.deepEqual(r.sets, [
    { name: '套装A', cnt: 4 },
    { name: '套装B', cnt: 2 },
  ]);
  // 456 恒为百分比，固定值名经 mainStatName 转百分比变体
  assert.deepEqual(r.mainProps, { 4: '暴击率', 5: '攻击力%', 6: '异常精通' });
  // 副词条「攻击力百分比」→「攻击力%」
  assert.deepEqual(r.subStats, ['攻击力%', '暴击伤害']);
  assert.deepEqual(r.skills, [
    { type: 0, level: 12 },
    { type: 1, level: 11 },
  ]);
  assert.deepEqual(r.team, ['角色A', '角色B']);
  assert.deepEqual(r.weapon, { main: '音擎甲', backup: '音擎乙' });
});

test('extractPlan：缺项兜底（无 item → 空/null 默认值）', () => {
  const r = extractPlan({ id: 1 });
  assert.equal(r.name, '');
  assert.deepEqual(r.panel, []);
  assert.deepEqual(r.weapon, { main: null, backup: null });
  assert.deepEqual(r.mainProps, { 4: null, 5: null, 6: null });
  assert.deepEqual(r.sets, []);
  assert.deepEqual(r.subStats, []);
  assert.deepEqual(r.skills, []);
  assert.deepEqual(r.team, []);
});
