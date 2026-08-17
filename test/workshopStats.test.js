// test/workshopStats.test.js —— 工坊统计：驱动盘单盘 / 面板散点 / 新指标聚合（评分·影画分层·技能·角色盘）
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  computeWorkshopStats,
  computeWorkshopDiscStats,
  computePanelScatter,
  discStatName,
  computeRelicStats,
  computeRankDist,
  computeSkillStats,
  computeRoleDiscStats,
  computeRoleCooccurrence,
  computeRankRelic,
  computeSkillComboStats,
  substatRolls,
  buildRoleSubstatWeights,
  sourceOf,
  computeRollEfficiency,
  computeSourceAudit,
  computeRoleStyles,
  computeAllWorkshopStats,
  computeRoleOwnership,
  styleLabel,
  styleAttrShort,
  styleMatch,
} from '../src/lib/workshopStats.js';
import { buildNameIndex, CATEGORY } from '../src/lib/names.js';
import { iterWorkshopFile } from '../src/lib/node.js';
import { loadDataFile } from './helpers.js';

test('discStatName：workshop 词条名 → 统一名（全表 + mys 源百分比判定 + 幂等）', () => {
  // mys 源：攻击/生命/防御 百分比形态藏在 value 带 %
  assert.equal(discStatName('攻击力', '6%'), '攻击力%');
  assert.equal(discStatName('生命值', '14.4%'), '生命值%');
  assert.equal(discStatName('防御力', '6%'), '防御力%');
  // mys 源固定值
  assert.equal(discStatName('攻击力', '38'), '攻击力');
  assert.equal(discStatName('生命值', '224'), '生命值');
  // mys 源固有百分比属性（不带 %）
  assert.equal(discStatName('暴击率', '4.8%'), '暴击率');
  assert.equal(discStatName('暴击伤害', '9.6%'), '暴击伤害');
  // 2025 源百分比变体
  assert.equal(discStatName('攻击力百分比', 480), '攻击力%');
  assert.equal(discStatName('暴击率百分比', 480), '暴击率');
  assert.equal(discStatName('暴击伤害百分比', 480), '暴击伤害');
  assert.equal(discStatName('穿透率百分比', 480), '穿透率');
  assert.equal(discStatName('异常掌控百分比', 480), '异常掌控');
  assert.equal(discStatName('能量回复百分比', 480), '能量自动回复');
  assert.equal(discStatName('冲击力百分比', 480), '冲击力');
  assert.equal(discStatName('异常精通', 12), '异常精通');
  assert.equal(discStatName('穿透值', 9), '穿透值');
  // 伤害加成类
  assert.equal(discStatName('物伤加成百分比', 480), '物理伤害加成');
  assert.equal(discStatName('电伤加成百分比', 480), '电属性伤害加成');
  assert.equal(discStatName('冰伤加成百分比', 480), '冰属性伤害加成');
  assert.equal(discStatName('风伤加成百分比', 480), '风属性伤害加成');
  assert.equal(discStatName('以太加伤百分比', 480), '以太伤害加成');
  // 幂等：统一名再跑不变
  assert.equal(discStatName('攻击力%', null), '攻击力%');
  assert.equal(discStatName('暴击率', null), '暴击率');
  // 未知名原样返回
  assert.equal(discStatName('未来新词条', 1), '未来新词条');
  assert.equal(discStatName(null, 1), null);
});

test('computeWorkshopDiscStats：两源混合聚合（主词条/副词条/槽位/角色/别名/幂等）', () => {
  const discIndex = buildNameIndex(['静听嘉音', '荆棘玫瑰'], CATEGORY.DISC);
  const roleNameMap = new Map([
    ['1341', '维琳娜·艾嘉德'],
    ['1361', '艾莲'],
  ]);
  const entries = [
    // —— 2025 源：id 末位=槽，main[0]=真实主词条，subs=副词条 ——
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        {
          id: '33144',
          suit: '静听嘉音',
          main: [{ name: '攻击力百分比', value: 3000 }],
          subs: [
            { name: '攻击力百分比', value: 480 },
            { name: '暴击伤害百分比', value: 480 },
          ],
        },
        {
          id: '33145',
          suit: '静听嘉音',
          main: [{ name: '攻击力', value: 3000 }],
          subs: [{ name: '暴击率百分比', value: 480 }],
        },
      ],
    },
    // —— mys 源：name [N]，与 2025 同构（main=主词条、subs=全部副词条） ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        {
          name: '静听嘉音[5]',
          suit: '静听嘉音',
          main: [{ name: '穿透率', value: '4.8%' }],
          subs: [
            { name: '攻击力', value: '6%' },
            { name: '暴击率', value: '4.8%' },
          ],
        },
      ],
    },
    // —— 套装别名（旧名棘刺玫瑰→荆棘玫瑰）+ 另一角色 ——
    {
      uid: 'u3',
      role_id: '1361',
      equips: [
        {
          name: '棘刺玫瑰[1]',
          suit: '棘刺玫瑰',
          main: [{ name: '防御力', value: '6%' }],
          subs: [{ name: '生命值', value: '224' }],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap });
  assert.equal(out.length, 2, '只含出现的盘');
  const 静听 = out.find((d) => d.name === '静听嘉音');
  const 棘刺 = out.find((d) => d.name === '荆棘玫瑰');
  assert.ok(静听 && 棘刺, '套装别名解析为规范名');
  // 静听嘉音：equips = 2 块 2025 + 1 块 mys = 3（物理盘数）
  assert.equal(静听.equips, 3);
  // 主词条：两源都参与（槽4=攻击力% 2025 扁平经 mainStatName 兜底；槽5=2025 攻击力% + mys 穿透率）
  assert.deepEqual(静听.main456[4], [{ name: '攻击力%', count: 1 }]);
  assert.deepEqual(Object.fromEntries(静听.main456[5].map((f) => [f.name, f.count])), { '攻击力%': 1, 穿透率: 1 });
  assert.deepEqual(静听.main456[6], []);
  // mainDenom：每槽所有盘（槽4:1、槽5:2、槽6:0）
  assert.deepEqual(静听.mainDenom, { 4: 1, 5: 2, 6: 0 });
  // 副词条：两源 subs 全量合并（mys 盘穿透率是主词条不参与；生命值属棘刺盘在下方断言）
  const subMap = Object.fromEntries(静听.subs.map((f) => [f.name, f.count]));
  assert.deepEqual(subMap, { '攻击力%': 2, 暴击伤害: 1, 暴击率: 2 });
  // 角色：两个 entry 同 role_id → 去重 1 个名字
  assert.deepEqual(静听.characters, ['维琳娜·艾嘉德']);
  // 荆棘玫瑰：mys 盘（槽1 主词条防御力% 不在 456 范围），副词条 生命值，角色去重
  assert.equal(棘刺.equips, 1);
  assert.deepEqual(棘刺.main456, { 4: [], 5: [], 6: [] }, '槽1 主词条不在 456 范围');
  assert.deepEqual(Object.fromEntries(棘刺.subs.map((f) => [f.name, f.count])), { 生命值: 1 });
  assert.deepEqual(棘刺.characters, ['艾莲']);
  // 幂等：同 entries 跑两遍深相等
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, { roleNameMap }), out);
});

test('computeWorkshopDiscStats：不传 roleNameMap 时 characters 落回 role_id；同配装 4 件套计 4 块盘', () => {
  const discIndex = buildNameIndex(['如影相随'], CATEGORY.DISC);
  const entries = [
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        { id: '32901', suit: '如影相随', main: [{ name: '生命值', value: 1000 }], subs: [] },
        { id: '32902', suit: '如影相随', main: [{ name: '攻击力', value: 1000 }], subs: [] },
        { id: '32903', suit: '如影相随', main: [{ name: '防御力', value: 1000 }], subs: [] },
        { id: '32904', suit: '如影相随', main: [{ name: '攻击力百分比', value: 3000 }], subs: [] },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  assert.equal(out[0].equips, 4, '同配装 4 件套 = 4 块盘');
  assert.deepEqual(out[0].characters, ['1341'], '无 roleNameMap → role_id');
  assert.deepEqual(out[0].mainDenom, { 4: 1, 5: 0, 6: 0 }, '槽4 是 2025 盘');
  assert.deepEqual(out[0].main456[4], [{ name: '攻击力%', count: 1 }], '扁平 攻击力 经 mainStatName 兜底为 攻击力%');
});

test('真实数据冒烟：workshop.json 全量聚合不抛错、计数合法', () => {
  const lib = loadDataFile('library.json', 'npm run sync:library（或网页「更新数据库」）');
  const grad = loadDataFile('workshop-grad.json', 'node src/sync/workshop.js');
  const discIndex = buildNameIndex(lib.discs, CATEGORY.DISC);
  const roleNameMap = new Map((grad.roles || []).map((r) => [String(r.item_id), r.name]));
  // workshop.json 为分块 gzip（~0.2GB），用流式逐块解压抽样前 5 万条验证聚合逻辑
  const entries = [];
  try {
    for (const e of iterWorkshopFile(fileURLToPath(new URL('../data/workshop.json', import.meta.url)))) {
      entries.push(e);
      if (entries.length >= 50000) break;
    }
  } catch {
    console.error('\n[test] 缺少 data/workshop.json，依赖真实数据的测试无法运行。');
    console.error('  请先更新数据：node src/sync/workshop.js\n');
    process.exit(0);
  }
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap });
  assert.ok(out.length > 0, '应聚合出盘');
  for (const d of out) {
    assert.ok(d.equips > 0);
    assert.ok(d.characters.length > 0);
    for (const k of [4, 5, 6]) {
      const sum = d.main456[k].reduce((s, f) => s + f.count, 0);
      assert.ok(sum <= d.mainDenom[k], `${d.name} 槽${k} 主词条计数不超过分母`);
      for (const f of d.main456[k]) assert.ok(f.count > 0);
    }
    assert.ok(d.subs.length > 0);
  }
});

test('computeWorkshopDiscStats 新字段：有效强化次数分布 / 副词条组合 / 主词条×副词条协同', () => {
  const discIndex = buildNameIndex(['静听嘉音', '荆棘玫瑰'], CATEGORY.DISC);
  const entries = [
    // —— 2025 源盘（id 末位=槽4）：主词条 + 4 个有效副词条 ——
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        {
          id: '11114',
          suit: '静听嘉音',
          main: [{ name: '暴击率百分比', value: 2400 }],
          subs: [
            { name: '攻击力百分比', value: 480 },
            { name: '暴击伤害百分比', value: 480 },
            { name: '暴击率百分比', value: 480 },
            { name: '异常精通', value: 12 },
          ],
        },
      ],
    },
    // —— mys 源盘（name 末尾 [1]，同构：main=主词条、subs=副词条全量，含无效词条 异常掌控） ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        {
          name: '静听嘉音[1]',
          suit: '静听嘉音',
          main: [{ name: '攻击力', value: '6%' }],
          subs: [
            { name: '攻击力', value: '6%' },
            { name: '暴击率', value: '4.8%' },
            { name: '异常掌控', value: '12' },
          ],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  const 静听 = out.find((d) => d.name === '静听嘉音');
  assert.ok(静听, '应聚合出盘');
  // 有效强化次数分布（roll 口径，未传 weightJson → 有效集合退化为全部合法副词条）：
  //   2025 盘 = 攻击% 480/300→2 + 暴伤 480/480→1 + 暴率 480/240→2 + 精通 12/9→1 = 6 次
  //   mys  盘 = 攻击% 6/3→2 + 暴率 4.8/2.4→2（异常掌控不在 SUBSTAT_TYPE_SET，剔除）= 4 次
  assert.deepEqual(静听.effDist, { 4: 1, 6: 1 });
  // 副词条组合：两盘各一个组合（归一名排序去重）
  assert.ok(静听.subCombos.length >= 2);
  assert.equal(静听.subCombos[0].count, 1);
  assert.equal(new Set(静听.subCombos[0].combo).size, 4, '2025 盘组合含 4 词条');
  // 主词条×副词条协同：槽4 盘（主词条 暴击率）；mys 盘槽1 主词条不在 456 范围不参与
  assert.deepEqual(静听.mainSubCross[4]['暴击率'], { '攻击力%': 1, 暴击伤害: 1, 暴击率: 1, 异常精通: 1 });
  assert.ok(!静听.mainSubCross[1], '槽1 无协同（非 456 槽位）');
  // 幂等
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, {}), out);
});

test('computeWorkshopDiscStats：mys 与 2025 同构，主词条/协同统计两源全量参与', () => {
  const discIndex = buildNameIndex(['静听嘉音'], CATEGORY.DISC);
  const entries = [
    // —— 2025 源盘（id 末位=槽4）：主词条 + 副词条 ——
    {
      uid: 'u1',
      role_id: '1341',
      equips: [
        {
          id: '11114',
          suit: '静听嘉音',
          main: [{ name: '暴击率百分比', value: 2400 }],
          subs: [
            { name: '攻击力百分比', value: 480 },
            { name: '暴击伤害百分比', value: 480 },
          ],
        },
      ],
    },
    // —— mys 源盘（name 末尾 [4]）：同构 main=主词条、subs=全部副词条，含无效词条 ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        {
          name: '静听嘉音[4]',
          suit: '静听嘉音',
          main: [{ name: '暴击伤害', value: '9.6%' }],
          subs: [
            { name: '暴击率', value: '4.8%' },
            { name: '防御力', value: '15' }, // 无效副词条（防御力）也应参与统计
          ],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  const 静听 = out.find((d) => d.name === '静听嘉音');
  assert.ok(静听, '应聚合出盘');
  assert.equal(静听.equips, 2, '两块盘都计数');
  // 主词条：两源都参与（槽4：暴击率 1 + 暴击伤害 1），分母为 2
  assert.equal(静听.mainDenom[4], 2, 'mys 盘也计入主词条分母');
  assert.deepEqual(Object.fromEntries(静听.main456[4].map((f) => [f.name, f.count])), { 暴击伤害: 1, 暴击率: 1 });
  // 副词条：mys 的无效词条（防御力）也计入
  const subMap = Object.fromEntries(静听.subs.map((f) => [f.name, f.count]));
  assert.deepEqual(subMap, { '攻击力%': 1, 暴击伤害: 1, 暴击率: 1, 防御力: 1 });
  // 有效强化次数：2025 盘 = 攻击% 480/300→2 + 暴伤 480/480→1 = 3；mys 盘 = 暴率 4.8/2.4→2 + 防御 15/15→1 = 3
  assert.deepEqual(静听.effDist, { 3: 2 });
  // D7 套装×槽位：两块盘都在 4 号位
  assert.deepEqual(静听.slotDist, { 1: 0, 2: 0, 3: 0, 4: 2, 5: 0, 6: 0 });
  // 主词条×副词条协同：两源都参与
  assert.deepEqual(静听.mainSubCross[4]['暴击率'], { '攻击力%': 1, 暴击伤害: 1 });
  assert.deepEqual(静听.mainSubCross[4]['暴击伤害'], { 暴击率: 1, 防御力: 1 });
  // 幂等
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, {}), out);
});

test('computePanelScatter：每角色/全体 2D 密度网格（攻击归一、幂等）', () => {
  const entries = [
    {
      role_id: '1011',
      panel: [
        { name: '暴击率', final: '0.5' },
        { name: '暴击伤害', final: '1.0' },
        { name: '攻击力', final: '3000' },
      ],
    },
    {
      role_id: '1011',
      panel: [
        { name: '暴击率', final: '0.6' },
        { name: '暴击伤害', final: '1.5' },
        { name: '攻击力', final: '3200' },
      ],
    },
    {
      role_id: '1011',
      panel: [
        { name: '暴击率', final: '0.7' },
        { name: '暴击伤害', final: '1.8' },
        { name: '攻击力', final: '3400' },
      ],
    },
    {
      role_id: '1031',
      panel: [
        { name: '暴击率', final: '40%' },
        { name: '暴击伤害', final: '120%' },
        { name: '攻击力', final: '2800' },
      ],
    },
  ];
  const out = computePanelScatter(entries);
  // 每角色（含攻击归一的攻击×暴伤）
  const r1011 = out.perRole['1011'];
  assert.ok(r1011, '1011 应有 perRole 数据');
  assert.ok(r1011['暴击率_暴击伤害'].data.length > 0);
  assert.ok(r1011['攻击力_暴击伤害'].data.length > 0);
  assert.equal(r1011['攻击力_暴击伤害'].xName, '攻击力');
  assert.ok(r1011['攻击力_暴击伤害'].xMin <= r1011['攻击力_暴击伤害'].xMax);
  // 全体
  assert.ok(out.global['暴击率_暴击伤害'].data.length > 0);
  assert.ok(out.global['攻击力_暴击伤害'].data.length > 0);
  // 网格坐标合法（xi/yi ∈ [0,23]）
  for (const g of [r1011['暴击率_暴击伤害'], out.global['攻击力_暴击伤害']]) {
    for (const [xi, yi, count] of g.data) {
      assert.ok(xi >= 0 && xi < 24 && yi >= 0 && yi < 24);
      assert.ok(count > 0);
    }
  }
  // 幂等
  assert.deepEqual(computePanelScatter(entries), out);
});

// ---------- 新指标聚合 ----------

const NEW_META_ENTRIES = [
  // 角色 1011：2 条（rank 0 / rank 6），技能与评分各异（source 显式声明，type 按 2025 语义：0普攻/1闪避）
  {
    uid: 'u1',
    role_id: '1011',
    source: '2025',
    rank: 0,
    relic_point: 150,
    skills: [
      { type: 0, level: 9 },
      { type: 1, level: 7 },
    ],
    panel: [
      { name: '攻击力', final: '2000' },
      { name: '暴击率', final: '0.4' },
    ],
    equips: [
      {
        id: '11114',
        suit: '静听嘉音',
        main: [{ name: '暴击率', value: '4.8%' }],
        subs: [
          { name: '攻击力', value: '6%' },
          { name: '异常掌控', value: '12' },
        ],
      },
    ],
  },
  {
    uid: 'u1',
    role_id: '1011',
    source: '2025',
    rank: 6,
    relic_point: 300,
    skills: [
      { type: 0, level: 12 },
      { type: 1, level: 12 },
    ],
    panel: [
      { name: '攻击力', final: '3000' },
      { name: '暴击率', final: '0.7' },
    ],
    equips: [
      {
        id: '11114',
        suit: '静听嘉音',
        main: [{ name: '暴击率', value: '4.8%' }],
        subs: [
          { name: '暴击伤害', value: '9.6%' },
          { name: '攻击力', value: '6%' },
        ],
      },
    ],
  },
  // 角色 1031：1 条（rank 2），评分 0（应被过滤）
  {
    uid: 'u2',
    role_id: '1031',
    source: '2025',
    rank: 2,
    relic_point: 0,
    skills: [{ type: 0, level: 10 }],
    panel: [{ name: '攻击力', final: '2500' }],
    equips: [],
  },
];

test('computeRelicStats：每角色评分分布，0/非法排除', () => {
  const out = computeRelicStats(NEW_META_ENTRIES);
  assert.ok(out['1011']);
  assert.equal(out['1011'].count, 2);
  assert.equal(out['1011'].min, 150);
  assert.equal(out['1011'].max, 300);
  assert.equal(out['1011'].median, 225);
  assert.equal(out['1031'], undefined, '0 评分角色不产出分布');
  // 字符串评分兜底（旧数据）
  const old = computeRelicStats([{ role_id: '1011', relic_point: '188.20' }]);
  assert.equal(old['1011'].mean, 188.2);
});

test('computeRankDist：每角色影画档位占比', () => {
  const out = computeRankDist(NEW_META_ENTRIES);
  assert.deepEqual(out['1011'], { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1 });
  assert.deepEqual(out['1031'], { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
});

test('computeSkillStats：每角色×技能类型的等级分布', () => {
  const out = computeSkillStats(NEW_META_ENTRIES);
  assert.ok(out['1011']);
  assert.equal(out['1011'][0].count, 2);
  assert.equal(out['1011'][0].median, 10.5, 'lightDist 分位与 computeDist 统一：排序 [9,12] 线性插值 = 10.5');
  assert.equal(out['1011'][1].median, 9.5, '排序 [7,12] 线性插值 = 9.5');
  assert.equal(out['1031'][0].count, 1);
  assert.equal(out['1031'][0].mean, 10);
});

test('computeSkillStats：mys 源按官方语义归一化（1特殊技→3、2闪避→1、3终结→4、6支援→2）', () => {
  const out = computeSkillStats([
    {
      role_id: '1011',
      source: 'mys',
      skills: [
        { type: 0, level: 12 }, // 普攻 → 0
        { type: 1, level: 11 }, // 特殊技 → 3
        { type: 2, level: 10 }, // 闪避 → 1
        { type: 3, level: 9 }, // 终结+连携 → 4
        { type: 5, level: 7 }, // 核心 → 5
        { type: 6, level: 8 }, // 支援技 → 2
      ],
    },
  ]);
  const d = out['1011'];
  assert.equal(d[0].median, 12, '普攻');
  assert.equal(d[1].median, 10, 'mys type2 闪避 → canonical 1');
  assert.equal(d[2].median, 8, 'mys type6 支援 → canonical 2');
  assert.equal(d[3].median, 11, 'mys type1 特殊技 → canonical 3');
  assert.equal(d[4].median, 9, 'mys type3 终结/连携 → canonical 4');
  assert.equal(d[5].median, 7, '核心');
});

test('computeSkillStats：2025 源按 1.x ID 语义归一化（1闪避→1、2特殊技→3、3连携→4、6终结→4）', () => {
  const out = computeSkillStats([
    {
      role_id: '1011',
      source: '2025',
      skills: [
        { type: 0, level: 12 }, // 普攻 → 0
        { type: 1, level: 11 }, // 闪避 → 1
        { type: 2, level: 10 }, // 特殊技 → 3
        { type: 3, level: 9 }, // 连携 → 4（并入终结）
        { type: 5, level: 7 }, // 核心 → 5
        { type: 6, level: 8 }, // 终结 → 4
      ],
    },
  ]);
  const d = out['1011'];
  assert.equal(d[0].median, 12, '普攻');
  assert.equal(d[1].median, 11, '2025 type1 闪避 → canonical 1');
  assert.equal(d[2], undefined, '2025 无支援技数据');
  assert.equal(d[3].median, 10, '2025 type2 特殊技 → canonical 3');
  assert.equal(d[4].median, 8.5, '2025 type3 连携 + type6 终结 → canonical 4（排序 [8,9] 线性插值 = 8.5）');
  assert.equal(d[5].median, 7, '核心');
});

test('computeSkillStats：旧数据无 source 回退数组顺序判别；无法判源跳过', () => {
  const out = computeSkillStats([
    {
      role_id: '1011',
      // 旧数据无 source：mys 数组按 UI 顺序 [0,2,6,...] → 第 2 位=2 判 mys
      skills: [
        { type: 0, level: 12 },
        { type: 2, level: 10 },
        { type: 6, level: 8 },
      ],
    },
    {
      role_id: '1021',
      // 旧数据无 source：2025 数组按 ID 顺序 [0,1,2,...] → 第 2 位=1 判 2025
      skills: [
        { type: 0, level: 12 },
        { type: 1, level: 11 },
        { type: 6, level: 8 },
      ],
    },
    {
      role_id: '1031',
      // 无 source 且 skills 不足 2 个 → 无法判源，跳过
      skills: [{ type: 0, level: 12 }],
    },
  ]);
  assert.equal(out['1011'][0].median, 12, 'mys 判别');
  assert.equal(out['1011'][2].median, 8, 'mys type6 支援 → canonical 2');
  assert.equal(out['1021'][1].median, 11, '2025 type1 闪避 → canonical 1');
  assert.equal(out['1021'][4].median, 8, '2025 type6 终结 → canonical 4');
  assert.equal(out['1031'], undefined, '无法判源条目不贡献');
});

test('computeRoleDiscStats：每角色 456 主词条/副词条/有效强化次数', () => {
  const discIndex = buildNameIndex(['静听嘉音'], CATEGORY.DISC);
  const roleNameMap = new Map([['1011', '安比·德玛拉']]);
  const out = computeRoleDiscStats(NEW_META_ENTRIES, discIndex, { roleNameMap });
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.name, '安比·德玛拉');
  assert.equal(r.mainDenom[4], 2);
  assert.deepEqual(Object.fromEntries(r.main456[4].map((f) => [f.name, f.count])), { 暴击率: 2 });
  // 副词条：异常掌控不是合法副词条（SUBSTAT_TYPE_SET 外）→ 白名单过滤，剩 攻击力% ×2 + 暴击伤害 ×1
  assert.deepEqual(Object.fromEntries(r.subs.map((f) => [f.name, f.count])), { '攻击力%': 2, 暴击伤害: 1 });
  // 有效词条（SUBSTAT 集合内）：攻击力% 有效，暴击伤害也有效 → 两盘各 1-2 个
  assert.ok(r.effDist['2'] >= 1);
});

test('computeWorkshopDiscStats / computeRoleDiscStats：游戏规则白名单清洗（非法副词条/异常主词条过滤）', () => {
  const discIndex = buildNameIndex(['静听嘉音'], CATEGORY.DISC);
  const entries = [
    {
      uid: 'u1',
      role_id: '1011',
      equips: [
        // 2025 源脏装备：4 号位（id 末位 4）副词条含 穿透率百分比（非法），主词条 暴击率（合法）
        {
          id: '33144',
          suit: '静听嘉音',
          main: [{ name: '暴击率', value: 480 }],
          subs: [
            { name: '穿透率百分比', value: 600 },
            { name: '暴击率百分比', value: 480 },
          ],
        },
        // 5 号位（id 末位 5）主词条 穿透值（非候选 → 过滤），副词条 攻击力%（合法）
        {
          id: '33145',
          suit: '静听嘉音',
          main: [{ name: '穿透值', value: 9 }],
          subs: [{ name: '攻击力百分比', value: 480 }],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap: new Map([['1011', '安比']]) });
  const d = out[0];
  // 副词条：穿透率百分比 被过滤，只剩 暴击率（+攻击力%）
  assert.deepEqual(Object.fromEntries(d.subs.map((f) => [f.name, f.count])), { 暴击率: 1, '攻击力%': 1 });
  // 主词条：4 号位只统计候选内（暴击率 计入）；5 号位 穿透值 不在候选 → 不统计
  assert.deepEqual(Object.fromEntries(d.main456[4].map((f) => [f.name, f.count])), { 暴击率: 1 });
  assert.deepEqual(d.main456[5], []);
  assert.equal(d.mainDenom[4], 1);
  assert.equal(d.mainDenom[5], 1, '分母仍按物理盘数');
  // 组合也过滤：脏词条不参与
  for (const c of d.subCombos)
    assert.ok(
      c.combo.every((n) =>
        [
          '暴击率',
          '攻击力%',
          '暴击伤害',
          '穿透值',
          '异常精通',
          '攻击力',
          '防御力',
          '防御力%',
          '生命值',
          '生命值%',
        ].includes(n)
      )
    );
});

// ---------- 2026-10 新增聚合：配队亲和 / 影画×评分 / 技能组合 ----------

test('computeRoleCooccurrence：同 uid 角色共现（配队亲和）', () => {
  const out = computeRoleCooccurrence([
    { uid: 'u1', role_id: '1011' },
    { uid: 'u1', role_id: '1031' },
    { uid: 'u2', role_id: '1011' },
    { uid: 'u2', role_id: '1031' },
    { uid: 'u3', role_id: '1011' },
    { uid: 'u3', role_id: '1051' },
  ]);
  const pair = out['1011'].find(([rid]) => rid === '1031');
  assert.deepEqual(pair, ['1031', 2], '1011 与 1031 同现 2 次');
  const pair2 = out['1011'].find(([rid]) => rid === '1051');
  assert.deepEqual(pair2, ['1051', 1]);
  assert.ok(out['1011'][0][1] >= out['1011'][1][1], '按次数降序');
});

test('computeRankRelic：每角色×影画档评分统计', () => {
  const out = computeRankRelic(NEW_META_ENTRIES);
  assert.ok(out['1011']);
  assert.equal(out['1011'][0].median, 150);
  assert.equal(out['1011'][6].median, 300);
  assert.equal(out['1011'][6].count, 1);
  assert.equal(out['1031'], undefined, '评分 0 的角色无档位分布');
});

test('computeSkillComboStats：技能拉满组合（源归一 + 全拉满率）', () => {
  const out = computeSkillComboStats(NEW_META_ENTRIES);
  const r = out['1011'];
  assert.ok(r);
  assert.equal(r.count, 2, '两条目均可判源');
  assert.equal(r.fullPct, 0.5, 'u1 第二条全拉满（普攻/闪避 12 级）');
  assert.ok(r.top.some((t) => t.pattern === '全拉满' && t.count === 1));
  assert.ok(
    r.top.some((t) => t.count === 1),
    '另一条为部分拉满组合'
  );
});

// ---------- computeWorkshopStats（顶层聚合，统计视图全部数据的入口） ----------
// 此前无任何测试覆盖：音擎/套装的「按配装条目计数」与「4 件套只计一次」去重口径、
// 面板百分比归一（'70%' → 0.7）、空串视为缺失，全靠 2.2GB 真实数据跑一遍才能发现问题。

test('computeWorkshopStats：音擎按配装条目计数，characters 去重', () => {
  const out = computeWorkshopStats([
    { role_id: '1011', weapon: { name: '玖歌' }, panel: [], equips: [] },
    { role_id: '1011', weapon: { name: '玖歌' }, panel: [], equips: [] },
    { role_id: '1031', weapon: { name: '玖歌' }, panel: [], equips: [] },
    { role_id: '1041', weapon: { name: '其他' }, panel: [], equips: [] }, // 占位名不计入
    { role_id: '1051', panel: [], equips: [] }, // 无音擎
  ]);
  const w = out.wengines.find((x) => x.name === '玖歌');
  assert.equal(w.count, 3, '按配装条目数累加');
  assert.deepEqual(w.characters.sort(), ['1011', '1031'], '角色去重');
  assert.equal(
    out.wengines.some((x) => x.name === '其他'),
    false,
    '「其他」占位不进统计'
  );
});

test('computeWorkshopStats：同配装内同套装只计一次（4 件套不重复计数）', () => {
  const out = computeWorkshopStats([
    {
      role_id: '1011',
      panel: [],
      // 4 块「静听嘉音」+ 2 块「河豚电音」：应各计 1
      equips: [
        { suit: '静听嘉音' },
        { suit: '静听嘉音' },
        { suit: '静听嘉音' },
        { suit: '静听嘉音' },
        { suit: '河豚电音' },
        { suit: '河豚电音' },
      ],
    },
  ]);
  assert.equal(out.discs.find((d) => d.name === '静听嘉音').count, 1, '4 件套只计一次');
  assert.equal(out.discs.find((d) => d.name === '河豚电音').count, 1, '2 件套只计一次');
});

test('computeWorkshopStats：面板百分比归一为小数，空串/非法值视为缺失', () => {
  const out = computeWorkshopStats([
    {
      role_id: '1011',
      equips: [],
      panel: [
        { name: '暴击率', final: '70%' },
        { name: '攻击力', final: '3000' },
      ],
    },
    {
      role_id: '1011',
      equips: [],
      panel: [
        { name: '暴击率', final: '50%' },
        { name: '攻击力', final: '' },
      ],
    },
    { role_id: '1011', equips: [], panel: [{ name: '暴击率', final: null }] },
  ]);
  const s = out.panels.find((p) => p.name === '1011').stats;
  assert.equal(s['暴击率'].count, 2, '空串与 null 不计入样本');
  assert.equal(s['暴击率'].min, 0.5, '百分比归一为小数');
  assert.equal(s['暴击率'].max, 0.7);
  assert.equal(s['攻击力'].count, 1, '空串 final 被丢弃');
});

test('computeWorkshopStats：空输入返回同形空结果，不抛错', () => {
  for (const input of [[], null, undefined]) {
    const out = computeWorkshopStats(input);
    assert.deepEqual(out.wengines, []);
    assert.deepEqual(out.discs, []);
    assert.deepEqual(out.panels, []);
  }
});

// ---------- 2026-08 新增：强化次数口径 / 角色权重 / 源判别 / 加权效率分 / 两源审计 ----------

test('substatRolls：两源同一词条还原同一次数（2025 数值 ×100、mys 字符串带 %）', () => {
  // 2025 源（number，百分比按 ×100 存）：480/240 → 2 次暴击率
  assert.equal(substatRolls('暴击率', 480), 2);
  assert.equal(substatRolls('暴击伤害', 480), 1); // 480/100/4.8
  assert.equal(substatRolls('攻击力%', 900), 3); // 900/100/3
  // mys 源（string，百分比就是显示数）：同一块盘还原出同样的次数
  assert.equal(substatRolls('暴击率', '4.8%'), 2);
  assert.equal(substatRolls('暴击伤害', '4.8%'), 1);
  assert.equal(substatRolls('攻击力%', '9%'), 3);
  // 固定值两源同量纲，不做 ÷100
  assert.equal(substatRolls('攻击力', 57), 3);
  assert.equal(substatRolls('攻击力', '57'), 3);
  assert.equal(substatRolls('异常精通', 27), 3);
  assert.equal(substatRolls('生命值', 112), 1);
  // 钳制与兜底：>6 收到 6、<1 归 0、未知名/非法值归 0
  assert.equal(substatRolls('暴击率', 99999), 6, '异常大值钳到量程上限');
  assert.equal(substatRolls('暴击率', 1), 0, '不足一次强化不计入');
  assert.equal(substatRolls('异常掌控', 480), 0, '不在基数表（非合法副词条）');
  assert.equal(substatRolls('攻击力', 'abc'), 0);
  assert.equal(substatRolls('攻击力', null), 0);
  // 非整数商靠 round 兜底（实测 19/144 万条异常值）
  assert.equal(substatRolls('暴击率', 500), 2, '500/100/2.4=2.08 → 2');
});

test('buildRoleSubstatWeights：权重 key → 副词条名展开，0/缺失 key 不入表', () => {
  const weightJson = {
    1011: {
      factions: [
        {
          name: '默认流派',
          weights: [
            { key: '攻击', weight: 1 },
            { key: '暴击', weight: 0.9 },
            { key: '暴伤', weight: 0.9 },
            { key: '生命', weight: 0 },
            { key: '能量', weight: 1 },
          ],
        },
      ],
    },
    1021: { factions: [{ name: '默认流派', weights: [{ key: '精通', weight: 1 }] }] },
    1031: { factions: [] }, // 无流派 → 不入表
    1041: { factions: [{ name: '默认流派', weights: [{ key: '能量', weight: 1 }] }] }, // 只有主词条 key → 不入表
  };
  const m = buildRoleSubstatWeights(weightJson);
  assert.deepEqual([...m.keys()], ['1011', '1021'], '无可映射副词条的角色不入表');
  const a = m.get('1011');
  // 「攻击」一个 key 同时展开到 攻击力% 与 攻击力（权重表不区分百分比/固定值）
  assert.deepEqual(Object.fromEntries(a), { 暴击率: 0.9, 暴击伤害: 0.9, '攻击力%': 1, 攻击力: 1 });
  assert.equal(a.has('生命值'), false, 'weight=0 视为不吃该属性');
  assert.equal(a.has('异常精通'), false, '缺 key 即不吃');
  assert.deepEqual(Object.fromEntries(m.get('1021')), { 异常精通: 1 });
  // 空输入不抛错
  assert.equal(buildRoleSubstatWeights(null).size, 0);
  assert.equal(buildRoleSubstatWeights({}).size, 0);
});

test('sourceOf：source 字段 → rarity 类型 → skills 顺序 三级兜底', () => {
  // ① source 字段最优先（即使 rarity 反着写）
  assert.equal(sourceOf({ source: 'mys', equips: [{ rarity: 4 }] }), 'mys');
  assert.equal(sourceOf({ source: '2025', equips: [{ rarity: 'S' }] }), '2025');
  // ② 无 source：rarity 类型判别（number=2025、string=mys），跳过 rarity 缺失的空盘
  assert.equal(sourceOf({ equips: [{ rarity: 4 }] }), '2025');
  assert.equal(sourceOf({ equips: [{ rarity: 'S' }] }), 'mys');
  assert.equal(sourceOf({ equips: [{}, { rarity: 'S' }] }), 'mys', 'rarity 缺失的盘跳过继续找');
  // ③ 连 rarity 都没有才回退 skills 数组顺序（mys 第 2 位=2、2025=1）
  assert.equal(sourceOf({ equips: [], skills: [{ type: 0 }, { type: 2 }] }), 'mys');
  assert.equal(sourceOf({ equips: [], skills: [{ type: 0 }, { type: 1 }] }), '2025');
  // rarity 与 skills 顺序冲突时以 rarity 为准（实测分歧 160/20 万，全是数组顺序法误判）
  assert.equal(sourceOf({ equips: [{ rarity: 'S' }], skills: [{ type: 0 }, { type: 1 }] }), 'mys');
  // 三种信号都拿不到 → null（该条不贡献技能统计/两源审计）
  assert.equal(sourceOf({ equips: [], skills: [{ type: 0 }] }), null);
  assert.equal(sourceOf({}), null);
  assert.equal(sourceOf(null), null);
});

test('computeRollEfficiency：加权分 = Σ 次数×权重，歪词条不计分，槽均值与 D9 相关', () => {
  const weightJson = {
    1011: {
      factions: [
        {
          name: '默认流派',
          weights: [
            { key: '暴击', weight: 1 },
            { key: '暴伤', weight: 1 },
            { key: '攻击', weight: 0.75 },
          ],
        },
      ],
    },
  };
  const entries = [
    {
      role_id: '1011',
      relic_point: 100,
      equips: [
        // 槽4：暴击率 2 次(×1) + 攻击力% 3 次(×0.75) + 生命值% 2 次（角色不吃 → 不计分也不计有效次数）
        {
          id: '11114',
          suit: '静听嘉音',
          subs: [
            { name: '暴击率百分比', value: 480 },
            { name: '攻击力百分比', value: 900 },
            { name: '生命值百分比', value: 600 },
          ],
        },
        // 槽5：暴击伤害 1 次(×1)
        { id: '11115', suit: '静听嘉音', subs: [{ name: '暴击伤害百分比', value: 480 }] },
      ],
    },
    // 未佩戴任何盘 → 不进样本（否则把分布往 0 拉）
    { role_id: '1011', relic_point: 50, equips: [{ id: '11114' }] },
    // 无权重角色整体跳过
    { role_id: '9999', equips: [{ id: '99994', suit: '静听嘉音', subs: [{ name: '暴击率百分比', value: 480 }] }] },
  ];
  const out = computeRollEfficiency(entries, { weightJson });
  assert.deepEqual(Object.keys(out), ['1011'], '无权重角色不产出');
  const r = out['1011'];
  // 权重表随统计一起产出，供前端用同一张表复算「我的盘」
  assert.deepEqual(r.weights, { 暴击率: 1, 暴击伤害: 1, '攻击力%': 0.75, 攻击力: 0.75 });
  assert.equal(r.score.count, 1, '空装条目不进样本');
  assert.equal(r.score.mean, 2 * 1 + 3 * 0.75 + 1 * 1, '歪词条（生命值%）不计分');
  assert.equal(r.effRolls.mean, 6, '有效强化次数 = 2 + 3 + 1（生命值% 不计）');
  assert.deepEqual(r.slotEff, { 4: { count: 1, mean: 5 }, 5: { count: 1, mean: 1 } });
  assert.equal(r.scoreVsRelic, null, '配对样本 <30 不给相关系数');
  // 样本足量时才产出 D9 相关：构造 40 条评分与词条数同步递增的条目 → 强正相关
  const many = Array.from({ length: 40 }, (_, i) => ({
    role_id: '1011',
    relic_point: 10 + i,
    equips: [{ id: '11114', suit: '静听嘉音', subs: [{ name: '暴击率百分比', value: 240 * ((i % 6) + 1) }] }],
  }));
  const out2 = computeRollEfficiency(many, { weightJson });
  assert.equal(out2['1011'].scoreVsRelic.n, 40);
  assert.ok(Number.isFinite(out2['1011'].scoreVsRelic.r));
});

test('computeSourceAudit：两源分别计数取均值，任一源 <30 时 diff 记 null', () => {
  const mk = (src, atk) => ({
    role_id: '1011',
    equips: [{ rarity: src === 'mys' ? 'S' : 4 }],
    panel: [{ name: '攻击力', final: String(atk) }],
  });
  // 小样本：只给均值不给 diff
  const small = computeSourceAudit([mk('mys', 3000), mk('2025', 3300)]);
  assert.deepEqual(small['1011'].counts, { mys: 1, 2025: 1 });
  assert.equal(small['1011'].attrs['攻击力'].mys, 3000);
  assert.equal(small['1011'].attrs['攻击力']['2025'], 3300);
  assert.equal(small['1011'].attrs['攻击力'].diff, null, '样本 <30 不给 diff');
  // 两源各 30 条：diff = (2025 均值 − mys 均值) / |mys 均值|
  const big = [];
  for (let i = 0; i < 30; i++) big.push(mk('mys', 3000), mk('2025', 3300));
  const out = computeSourceAudit(big);
  assert.deepEqual(out['1011'].counts, { mys: 30, 2025: 30 });
  assert.ok(Math.abs(out['1011'].attrs['攻击力'].diff - 0.1) < 1e-12);
  // 非审计属性不进表；无法判源的条目整条跳过
  const skip = computeSourceAudit([{ role_id: '1011', equips: [], panel: [{ name: '攻击力', final: '3000' }] }]);
  assert.deepEqual(skip, {}, '判不出源的条目不参与审计');
});

// ---------- 角色流派分析（computeRoleStyles / styleLabel / styleMatch） ----------

test('styleLabel：4 号位取向 + 6 号位取向组合命名，同段去重', () => {
  assert.equal(styleLabel('暴击伤害', '攻击力%'), '暴伤·攻击');
  assert.equal(styleLabel('暴击率', '能量自动回复'), '暴击率·回能');
  assert.equal(styleLabel('异常精通', '异常掌控'), '精通·异常');
  assert.equal(styleLabel('攻击力%', '攻击力'), '攻击', '4/6 号位同为攻击取向时只留一段');
  assert.equal(styleLabel('冲击力', '冲击力'), '冲击');
  assert.equal(styleLabel('暴击伤害', undefined), '暴伤', '无 6 号位信息不加后缀');
  assert.equal(styleLabel('未知词条', '攻击力%'), '均衡·攻击', '未知名归「均衡」');
});

test('styleAttrShort：属性短名（伤害加成归元素短名）', () => {
  assert.equal(styleAttrShort('攻击力'), '攻击');
  assert.equal(styleAttrShort('暴击伤害'), '暴伤');
  assert.equal(styleAttrShort('冰属性伤害加成'), '冰伤');
  assert.equal(styleAttrShort('电属性伤害加成'), '电伤');
  assert.equal(styleAttrShort('以太伤害加成'), '以太伤');
  assert.equal(styleAttrShort('物理伤害加成'), '物伤');
});

test('styleMatch：我的面板 → 相对距离最小的流派', () => {
  const roleStyle = {
    attrs: ['攻击力', '暴击率', '暴击伤害'],
    styles: [
      {
        label: '暴伤·攻击',
        share: 0.5,
        panel: { 攻击力: { mean: 2800 }, 暴击率: { mean: 0.6 }, 暴击伤害: { mean: 1.8 } },
      },
      {
        label: '暴击率·攻击',
        share: 0.5,
        panel: { 攻击力: { mean: 2800 }, 暴击率: { mean: 0.8 }, 暴击伤害: { mean: 1.3 } },
      },
    ],
  };
  const m1 = styleMatch(roleStyle, { 攻击力: 2750, 暴击率: 0.62, 暴击伤害: 1.75 });
  assert.equal(m1.best.label, '暴伤·攻击');
  const m2 = styleMatch(roleStyle, { 攻击力: 2850, 暴击率: 0.81, 暴击伤害: 1.28 });
  assert.equal(m2.best.label, '暴击率·攻击');
  // 缺失属性跳过（不因缺属性判无穷远）；无数据返回 null
  assert.ok(styleMatch(roleStyle, { 攻击力: 2800 }).best);
  assert.equal(styleMatch(null, {}), null);
  assert.equal(styleMatch({ styles: [] }, {}), null);
});

test('computeRoleStyles：面板 k-means 分出两流派（攻击高 vs 暴击高），输出结构完整', () => {
  const mk = (atk, cr, cd, main4, main6, suit, wep) => ({
    role_id: '1011',
    panel: [
      { name: '攻击力', final: String(atk) },
      { name: '防御力', final: '800' },
      { name: '生命值', final: '10000' },
      { name: '暴击率', final: String(cr) },
      { name: '暴击伤害', final: String(cd) },
      { name: '冰属性伤害加成', final: '0.3' },
    ],
    equips: [
      { id: '11114', name: `[4]`, suit, main: [{ name: main4, value: '24%' }] },
      { id: '11115', name: `[5]`, suit, main: [{ name: '冰属性伤害加成', value: '30%' }] },
      { id: '11116', name: `[6]`, suit, main: [{ name: main6, value: '30%' }] },
    ],
    weapon: { name: wep },
  });
  // 200 条：100 条高攻击低暴击（4号攻击盘）+ 100 条高暴击（4号暴击率盘）→ k-means 应分两簇
  const entries = [];
  for (let i = 0; i < 100; i++)
    entries.push(mk(3300 + (i % 20) * 10, 0.45, 1.1, '攻击力百分比', '攻击力百分比', '攻套', '攻擎'));
  for (let i = 0; i < 100; i++)
    entries.push(mk(2400 + (i % 20) * 10, 0.85, 1.7, '暴击率百分比', '攻击力百分比', '暴套', '暴擎'));
  const out = computeRoleStyles(entries);
  assert.deepEqual(Object.keys(out), ['1011']);
  const r = out['1011'];
  // 去噪语义：恒定的属性（防御/生命/伤害加成在此构造中无分化）会被剔除，
  // 攻击力/暴击率/暴伤有强分化必须保留
  assert.ok(
    r.attrs.includes('攻击力') && r.attrs.includes('暴击率') && r.attrs.includes('暴击伤害'),
    '分化属性入 attrs'
  );
  assert.ok(r.styles.length >= 2, '可分两簇以上');
  // share 归一（可能有极小簇被丢弃，容差放宽到 ≤1）
  const shareSum = r.styles.reduce((s, st) => s + st.share, 0);
  assert.ok(shareSum > 0.9 && shareSum <= 1.0001);
  for (const st of r.styles) {
    assert.ok(st.label && st.label.length > 0, 'label 非空');
    assert.ok(st.share > 0 && st.share <= 1);
    for (const a of r.attrs) {
      assert.ok(Number.isFinite(st.panel[a].mean), `${a} mean 有限`);
      assert.ok(Number.isFinite(st.panel[a].median), `${a} median 有限`);
    }
    assert.ok(st.main['4']?.length >= 1, '4号位主词条 Top 非空');
    assert.ok(Array.isArray(st.suits) && st.suits.length >= 1, '套装 Top 非空');
    assert.ok(Array.isArray(st.wengine) && st.wengine.length >= 1, '音擎 Top 非空');
  }
  // 面板不全的条目不入样
  const incomplete = computeRoleStyles([{ role_id: '1011', panel: [{ name: '攻击力', final: '3000' }], equips: [] }]);
  assert.deepEqual(incomplete, {}, '面板不全不聚类');
  // 样本太少不聚类
  const few = computeRoleStyles([mk(3000, 0.6, 1.5, '暴击率百分比', '攻击力百分比', '套', '擎')]);
  assert.deepEqual(few, {}, '样本 <200 不聚类');
});

test('computeRoleStyles：聚类属性池按角色定位（trait）选——击破含冲击力、异常含精通/掌控', () => {
  // 击破角色：玩家在 冲击力 vs 攻击 间分化（无双暴分化），trait=击破 → attrs 应含 冲击力
  const stun = [];
  for (let i = 0; i < 100; i++) {
    stun.push({
      role_id: '2011',
      panel: [
        { name: '攻击力', final: String(2400 + i * 3) },
        { name: '防御力', final: '900' },
        { name: '生命值', final: '11000' },
        { name: '暴击率', final: '0.3' },
        { name: '暴击伤害', final: '0.9' },
        { name: '冲击力', final: String(140 + (i % 2) * 30) }, // 冲击力两极分化
        { name: '电属性伤害加成', final: '0.2' },
      ],
      equips: [{ id: '11114', name: '[4]', suit: '套', main: [{ name: '冲击力', value: '18%' }] }],
      weapon: { name: '擎' },
    });
  }
  const outStun = computeRoleStyles([...stun, ...stun], { traits: { 2011: '击破' } });
  assert.ok(outStun['2011'].attrs.includes('冲击力'), '击破角色 attrs 含冲击力');
  assert.ok(!outStun['2011'].attrs.includes('暴击率'), '无分化的双暴不入 attrs（去噪）');
  // 异常角色：玩家在 精通 vs 攻击 间分化 → attrs 应含 异常精通/异常掌控
  const anomaly = [];
  for (let i = 0; i < 100; i++) {
    anomaly.push({
      role_id: '3011',
      panel: [
        { name: '攻击力', final: String(2600 + i * 3) },
        { name: '防御力', final: '800' },
        { name: '生命值', final: '10500' },
        { name: '暴击率', final: '0.25' },
        { name: '暴击伤害', final: '0.8' },
        { name: '异常精通', final: String(80 + (i % 2) * 100) }, // 精通两极分化
        { name: '异常掌控', final: String(120 + (i % 2) * 40) },
        { name: '电属性伤害加成', final: '0.25' },
      ],
      equips: [{ id: '11114', name: '[4]', suit: '套', main: [{ name: '异常精通', value: '72' }] }],
      weapon: { name: '擎' },
    });
  }
  const outAnom = computeRoleStyles([...anomaly, ...anomaly], { traits: { 3011: '异常' } });
  assert.ok(outAnom['3011'].attrs.includes('异常精通'), '异常角色 attrs 含异常精通');
  assert.ok(outAnom['3011'].attrs.includes('异常掌控'), '异常角色 attrs 含异常掌控');
  // 无 trait → 回退通用池（攻击/防御/生命/暴击率/暴伤）
  const outFallback = computeRoleStyles([...stun, ...stun], {});
  assert.ok(!outFallback['2011'].attrs.includes('冲击力'), '无定位时回退通用池，不含冲击力');
});

test('computeRoleStyles：簇的 main/suits/wengine 必须与该簇面板同源（下标以 valid 为基准）', () => {
  // 回归：曾用 o.samples[i] 索引（i 来自过滤后的 valid），只要有样本被过滤，
  // 其后全部样本整体错位一格 → main/suits/wengine 张冠李戴，且 label 由 main4[0] 推出故簇名也错。
  // 关键在于把「被过滤样本」**交错**插入：若全部追加在末尾，两种写法的下标恰好重合，测不出来。
  const P = (o) => Object.entries(o).map(([name, final]) => ({ name, final }));
  const mk = (atk, cr, cd, m4, suit, wep, drop) => ({
    role_id: 'T1',
    // drop=true 缺「暴击伤害」等候选属性 → 被 valid 过滤掉
    panel: P(drop ? { 攻击力: atk, 暴击率: cr } : { 攻击力: atk, 暴击率: cr, 暴击伤害: cd, 生命值: 8000, 防御力: 700 }),
    equips: [{ name: 'D[4]', suit, main: [{ name: m4 }] }],
    weapon: { name: wep },
  });
  const es = [];
  for (let i = 0; i < 600; i++) {
    if (i === 50 || i === 120 || i === 300) es.push(mk(3000, 0.5, 1.5, '暴击伤害', 'SetBad', 'WepBad', true));
    // 两个可分离子群：高暴伤低攻 / 高攻低暴伤，各自的主词条·套装·音擎一一对应
    es.push(
      i % 2 === 0
        ? mk(2800 + (i % 17), 0.3, 2.4, '暴击伤害', 'SetHi', 'WepHi', false)
        : mk(4200 + (i % 17), 0.62, 1.1, '攻击力%', 'SetAtk', 'WepAtk', false)
    );
  }
  const out = computeRoleStyles(es);
  assert.ok(out.T1, '应产出流派');
  for (const st of out.T1.styles) {
    // 锚点必须是 st.panel：它由 P/valid 算出，在「修复前」与「修复后」都是对的。
    // 若改用 st.main['4'] 反推期望值，main/suits/wengine 会一起错、彼此仍自洽 → 测不出 bug。
    const isCdHigh = st.panel['暴击伤害'].mean > 1.7; // 高暴伤子群（攻击 2800 / 暴伤 2.4）
    const [wantMain, wantSuit, wantWep] = isCdHigh ? ['暴击伤害', 'SetHi', 'WepHi'] : ['攻击力%', 'SetAtk', 'WepAtk'];
    assert.equal(
      st.main['4'][0],
      wantMain,
      `簇「${st.label}」(暴伤均值 ${st.panel['暴击伤害'].mean}) 主词条应与其面板同源`
    );
    assert.equal(st.suits[0], wantSuit, `簇「${st.label}」套装应与其面板同源`);
    assert.equal(st.wengine[0], wantWep, `簇「${st.label}」音擎应与其面板同源`);
    // 被过滤样本的套装/音擎绝不该出现（它们根本不在 valid 里）
    assert.ok(!st.suits.includes('SetBad'), '被过滤样本不应泄漏进结果');
    assert.ok(!st.wengine.includes('WepBad'), '被过滤样本不应泄漏进结果');
  }
});

test('聚合入口：脏条目（null/空对象）不应中断整轮聚合', () => {
  // computeAllWorkshopStats 把同一条喂给全部 15 个累加器，任一处抛异常 = 2.13GB 全量重算零产出
  const ok = {
    role_id: '1011',
    uid: 'u1',
    rank: 0,
    relic_point: 100,
    weapon: { name: '擎' },
    equips: [{ id: '11114', name: '[4]', suit: '套', main: [{ name: '攻击力', value: '30%' }], subs: [] }],
    panel: [{ name: '攻击力', final: '3000' }],
    skills: [],
  };
  const dirty = [null, undefined, {}, ok];
  assert.doesNotThrow(() => computeWorkshopStats(dirty), 'computeWorkshopStats 应容忍脏条目');
  assert.doesNotThrow(() => computeRoleStyles(dirty), 'computeRoleStyles 应容忍脏条目');
  assert.doesNotThrow(() => computeAllWorkshopStats(dirty, {}), 'computeAllWorkshopStats 应容忍脏条目');
  // 且脏条目被跳过后，正常条目仍被统计
  const s = computeWorkshopStats(dirty);
  assert.ok(
    s.wengines.some((w) => w.name === '擎'),
    '脏条目之后的正常条目仍应入统计'
  );
});

test('computeAllWorkshopStats：单遍历结果与逐个公开函数逐位相等', () => {
  // 文件头断言两条路径「逐位相等」（累加顺序/Map 插入顺序一致），此前无测试守护。
  // 生产走的是单遍历路径，一旦某个累加器被改得与公开函数不同步，只有这里能发现。
  const mkEntry = (i) => ({
    role_id: String(1011 + (i % 3)),
    uid: `u${i % 7}`,
    rank: i % 7,
    level: 60,
    relic_point: 100 + (i % 50),
    source: i % 2 ? 'mys' : '2025',
    weapon: { name: `擎${i % 4}`, level: 60 },
    equips: [4, 5, 6, 1, 2, 3].map((slot) => ({
      id: `1111${slot}`,
      name: `[${slot}]`,
      suit: `套${i % 5}`,
      main: [{ name: slot === 4 ? '暴击率' : '攻击力', value: i % 2 ? '24%' : 2400 }],
      subs: [
        { name: '攻击力', value: i % 2 ? '9.6' : 960 },
        { name: '暴击伤害', value: i % 2 ? '9.6' : 960 },
      ],
    })),
    panel: [
      { name: '攻击力', final: String(2400 + (i % 300)) },
      { name: '暴击率', final: String(0.3 + (i % 20) / 100) },
      { name: '暴击伤害', final: String(1.2 + (i % 30) / 100) },
      { name: '生命值', final: String(9000 + (i % 500)) },
      { name: '防御力', final: String(700 + (i % 90)) },
      { name: '异常精通', final: String(100 + (i % 40)) },
      { name: '异常掌控', final: String(100 + (i % 25)) },
      { name: '冲击力', final: String(110 + (i % 20)) },
    ],
    skills: [
      { type: 0, level: 10 + (i % 3) },
      { type: 1, level: 9 + (i % 4) },
      { type: 2, level: 8 + (i % 5) },
    ],
  });
  const entries = Array.from({ length: 400 }, (_, i) => mkEntry(i));
  const discIndex = {};
  const all = computeAllWorkshopStats(entries, discIndex);
  // 每项与对应公开函数逐位比对（JSON 序列化同时校验键序）
  const eq = (a, b, name) =>
    assert.equal(JSON.stringify(a), JSON.stringify(b), `${name} 单遍历结果应与公开函数逐位相等`);
  eq(all.stats, computeWorkshopStats(entries), 'stats');
  eq(all.discDetails, computeWorkshopDiscStats(entries, discIndex), 'discDetails');
  eq(all.panelScatter, computePanelScatter(entries), 'panelScatter');
  eq(all.relicStats, computeRelicStats(entries), 'relicStats');
  eq(all.rankDist, computeRankDist(entries), 'rankDist');
  eq(all.skillStats, computeSkillStats(entries), 'skillStats');
  eq(all.roleDiscStats, computeRoleDiscStats(entries), 'roleDiscStats');
  eq(all.roleCooccurrence, computeRoleCooccurrence(entries), 'roleCooccurrence');
  eq(all.rankRelic, computeRankRelic(entries), 'rankRelic');
  eq(all.skillCombos, computeSkillComboStats(entries), 'skillCombos');
  eq(all.rollEfficiency, computeRollEfficiency(entries), 'rollEfficiency');
  eq(all.sourceAudit, computeSourceAudit(entries), 'sourceAudit');
  eq(all.roleStyles, computeRoleStyles(entries), 'roleStyles');
  eq(all.roleOwnership, computeRoleOwnership(entries), 'roleOwnership');
});

test('computeRoleOwnership：拥有率 = 拥有该角色的去重 uid 数 / 样本池去重 uid 总数', () => {
  const entries = [
    { role_id: '1011', uid: 'a' },
    { role_id: '1011', uid: 'b' },
    { role_id: '1022', uid: 'a' },
    { role_id: '1022', uid: 'b' },
    { role_id: '1022', uid: 'c' },
    { role_id: '1033', uid: 'a' },
    { role_id: null, uid: 'd' }, // 脏条目不计
    { role_id: '1011' }, // 无 uid 不计
  ];
  const { pool, roles } = computeRoleOwnership(entries);
  assert.equal(pool, 3, '样本池 = 去重 uid 总数（a/b/c）');
  assert.equal(roles['1011'], 2 / 3, 'a/b 拥有 1011 → 2/3');
  assert.equal(roles['1022'], 1, 'a/b/c 都拥有 1022 → 100%');
  assert.equal(roles['1033'], 1 / 3, '仅 a 拥有 1033 → 1/3');
});
