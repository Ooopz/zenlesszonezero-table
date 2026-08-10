import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSkills, parseSkillValueLines } from '../src/sync/library.js';
import { validateLibrary } from '../src/lib/schema.js';

// 技能 growth 解析（src/sync/library.js）——用内联页面 fixture，不依赖网络/数据文件。

/** 构造一个只含技能列表的 wiki 页面（fetchSkills 的 findModule 取第一个满足的模块） */
function skillPage(list) {
  return { modules: [{ components: [{ data: { list } }] }] };
}
/** 构造一个技能条目（children）：title/desc + 可选 growth */
function item(title, growth) {
  const ch = { title, desc: '<p>技能说明</p>', tab_name: '' };
  if (growth) ch.growth = growth;
  return ch;
}
/** 构造某级 growth：{ 分组名: 行 html } */
function level(no, groups) {
  return {
    name: String(no),
    children: Object.entries(groups).map(([name, html]) => ({ name, row: [[html]] })),
  };
}

test('fetchSkills 提取数字档每级数值（普攻 16 级 / 无 growth 条目不带 growth）', () => {
  const levels = Array.from({ length: 16 }, (_, i) =>
    level(i + 1, {
      伤害倍率: `<p>一段伤害倍率：${(30 + i * 3).toFixed(1)}%</p>`,
      失衡倍率: `<p>一段失衡倍率：${(12 + i * 0.6).toFixed(1)}%</p>`,
    })
  );
  const skills = fetchSkills(
    skillPage([{ tab_name: '普攻', children: [item('普通攻击：测试', levels), item('闪避说明', [])] }])
  );
  assert.equal(skills.length, 1);
  assert.equal(skills[0].type, '普攻');
  const [atk, dodge] = skills[0].items;
  assert.ok(atk.growth && atk.growth.length === 16, '应有 16 级数值');
  assert.deepEqual(atk.growth[0].groups[0].lines, [{ k: '一段伤害倍率', v: '30.0%' }]);
  assert.equal(atk.growth[15].level, '16');
  assert.ok(dodge.growth == null, '无 growth 的条目不应带 growth 字段');
});

test('核心技 A-F 档提取为 growth：基础提升 + data-name 被动详情（rich）', () => {
  const coreItem = {
    title: '核心技',
    desc: '<p>核心被动说明</p>',
    tab_name: '',
    growth: [
      {
        name: 'A',
        children: [
          {
            name: '分类1',
            row: [
              [
                '<p>异常精通提升18点</p><p>[核心被动：测试]技能等级+1</p><span data-name="&lt;p&gt;核心被动数值为0.12%&lt;/p&gt;">详情</span>',
              ],
            ],
          },
        ],
      },
      {
        name: 'B',
        children: [
          {
            name: '分类1',
            row: [
              [
                '<p>基础攻击力提升25点</p><p>[核心被动：测试]技能等级+1</p><span data-name="&lt;p&gt;核心被动数值为0.14%&lt;/p&gt;">详情</span>',
              ],
            ],
          },
        ],
      },
    ],
  };
  const skills = fetchSkills(skillPage([{ tab_name: '核心技', children: [coreItem] }]));
  const core = skills[0].items[0];
  assert.ok(core.growth && core.growth.length === 2, '核心技 A-F 档应进入 growth');
  assert.equal(core.growth[0].level, 'A');
  assert.deepEqual(
    core.growth[0].groups.map((g) => g.name),
    ['基础提升', '核心被动']
  );
  assert.equal(core.growth[0].groups[0].text, '异常精通提升18点');
  assert.match(core.growth[0].groups[1].rich, /核心被动数值为0.12%/);
  assert.match(core.growth[1].groups[1].rich, /核心被动数值为0.14%/);
});

test('占位分组名（分类N/空）从内容推导有意义列名', () => {
  const skills = fetchSkills(
    skillPage([
      {
        tab_name: '支援技',
        children: [
          item('招架支援', [
            level('1', {
              分类1: '<p>轻招架失衡倍率：320.7%</p><p>重招架失衡倍率：405.2%</p><p>连续招架失衡倍率：197.2%</p>',
            }),
            level('2', {
              分类1: '<p>轻招架失衡倍率：335%</p><p>重招架失衡倍率：420%</p><p>连续招架失衡倍率：200%</p>',
            }),
          ]),
        ],
      },
    ])
  );
  const g = skills[0].items[0].growth[0].groups[0];
  assert.equal(g.name, '招架失衡倍率', '多行键取公共后缀');
  // 空名 + 单行键 → 取该行键
  const skills2 = fetchSkills(
    skillPage([{ tab_name: '闪避', children: [item('闪避', [level('1', { '': '<p>失衡倍率：95.3%</p>' })])] }])
  );
  assert.equal(skills2[0].items[0].growth[0].groups[0].name, '失衡倍率');
});

test('「总计」等杂档位不被收入 growth', () => {
  const skills = fetchSkills(
    skillPage([
      {
        tab_name: '普攻',
        children: [
          item('普通攻击', [
            { name: '1', children: [{ name: '伤害倍率', row: [['<p>一段伤害倍率：31.2%</p>']] }] },
            { name: '总计', children: [] },
          ]),
        ],
      },
    ])
  );
  const it = skills[0].items[0];
  assert.equal(it.growth.length, 1);
  assert.equal(it.growth[0].level, '1');
});

test('parseSkillValueLines 段内多对值 / 技能名含冒号 / 复合值 / 纯说明', () => {
  assert.deepEqual(parseSkillValueLines('<p>蓄力伤害倍率：215%炮击伤害倍率：215%</p>'), [
    { k: '蓄力伤害倍率', v: '215%' },
    { k: '炮击伤害倍率', v: '215%' },
  ]);
  assert.deepEqual(parseSkillValueLines('<p>强化特殊技：极寒重碾伤害倍率：1007.6%</p>'), [
    { k: '强化特殊技：极寒重碾伤害倍率', v: '1007.6%' },
  ]);
  assert.deepEqual(parseSkillValueLines('<p>攻击力提升：13.8%+44</p>'), [{ k: '攻击力提升', v: '13.8%+44' }]);
  assert.deepEqual(parseSkillValueLines('<p>简触发[强击]时，其暴击伤害额外提升15%。</p>'), [
    { k: null, v: '简触发[强击]时，其暴击伤害额外提升15%。' },
  ]);
});

test('validateLibrary 对 growth 结构异常给出 warning', () => {
  const ok = {
    characters: {
      甲: { name: '甲', skills: [{ type: '普攻', items: [{ name: 'x', growth: [{ level: '1', groups: [] }] }] }] },
    },
    wengines: {},
    discs: {},
  };
  assert.equal(validateLibrary(ok).length, 0, '合法的 growth 数组不应报错');
  const bad = {
    characters: { 甲: { name: '甲', skills: [{ type: '普攻', items: [{ name: 'x', growth: 'oops' }] }] } },
    wengines: {},
    discs: {},
  };
  assert.ok(
    validateLibrary(bad).some((e) => e.includes('growth')),
    'growth 非数组应报错'
  );
});
