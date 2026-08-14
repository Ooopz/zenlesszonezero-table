// test/workshopStats.test.js —— 工坊统计：驱动盘单盘 / 面板散点 / 新指标聚合（评分·影画分层·技能·玩家画像·角色盘·深渊）
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  computeWorkshopDiscStats,
  computePanelScatter,
  discStatName,
  computeRelicStats,
  computeRankLayers,
  computeRankDist,
  computeSkillStats,
  computePlayerProfiles,
  computeRoleDiscStats,
  computeAbyssStats,
  computeAbyssTeamStats,
} from '../src/lib/workshopStats.js';
import { buildNameIndex, CATEGORY } from '../src/lib/names.js';
import { streamJsonArrayElements } from '../src/lib/node.js';
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
  const discIndex = buildNameIndex(['静听嘉音', '棘刺玫瑰'], CATEGORY.DISC);
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
        { id: '33144', suit: '静听嘉音', main: [{ name: '攻击力百分比', value: 3000 }], subs: [{ name: '攻击力百分比', value: 480 }, { name: '暴击伤害百分比', value: 480 }] },
        { id: '33145', suit: '静听嘉音', main: [{ name: '攻击力', value: 3000 }], subs: [{ name: '暴击率百分比', value: 480 }] },
      ],
    },
    // —— mys 源：name [N]，与 2025 同构（main=主词条、subs=全部副词条） ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        { name: '静听嘉音[5]', suit: '静听嘉音', main: [{ name: '穿透率', value: '4.8%' }], subs: [{ name: '攻击力', value: '6%' }, { name: '暴击率', value: '4.8%' }] },
      ],
    },
    // —— 套装别名（荆棘玫瑰→棘刺玫瑰）+ 另一角色 ——
    { uid: 'u3', role_id: '1361', equips: [{ name: '荆棘玫瑰[1]', suit: '荆棘玫瑰', main: [{ name: '防御力', value: '6%' }], subs: [{ name: '生命值', value: '224' }] }] },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap });
  assert.equal(out.length, 2, '只含出现的盘');
  const 静听 = out.find((d) => d.name === '静听嘉音');
  const 棘刺 = out.find((d) => d.name === '棘刺玫瑰');
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
  // 棘刺玫瑰：mys 盘（槽1 主词条防御力% 不在 456 范围），副词条 生命值，角色去重
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
  // workshop.json 可达数百 MB，一次性 readFileSync 会超 V8 字符串上限（Invalid string length），
  // 用流式读抽样前 5 万条验证聚合逻辑（全量聚合在同步脚本 buildWorkshopStats 里做）
  const entries = [];
  try {
    for (const raw of streamJsonArrayElements(fileURLToPath(new URL('../data/workshop.json', import.meta.url)))) {
      entries.push(JSON.parse(raw));
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

test('computeWorkshopDiscStats 新字段：有效词条分布 / 副词条组合 / 主词条×副词条协同', () => {
  const discIndex = buildNameIndex(['静听嘉音', '棘刺玫瑰'], CATEGORY.DISC);
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
          subs: [{ name: '攻击力', value: '6%' }, { name: '暴击率', value: '4.8%' }, { name: '异常掌控', value: '12' }],
        },
      ],
    },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, {});
  const 静听 = out.find((d) => d.name === '静听嘉音');
  assert.ok(静听, '应聚合出盘');
  // 有效词条数分布：2025 盘 4 有效（攻击%/暴伤/暴率/异常精通）、mys 盘 2 有效（攻击%/暴率）
  assert.deepEqual(静听.effDist, { 4: 1, 2: 1 });
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
          subs: [{ name: '攻击力百分比', value: 480 }, { name: '暴击伤害百分比', value: 480 }],
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
  // 有效词条数：2025 盘 2 有效（攻击%+暴伤）、mys 盘 2 有效（暴击率 + 防御力——防御力在 SUBSTAT_TYPE_SET 候选集内）
  assert.deepEqual(静听.effDist, { 2: 2 });
  // 主词条×副词条协同：两源都参与
  assert.deepEqual(静听.mainSubCross[4]['暴击率'], { '攻击力%': 1, 暴击伤害: 1 });
  assert.deepEqual(静听.mainSubCross[4]['暴击伤害'], { 暴击率: 1, 防御力: 1 });
  // 幂等
  assert.deepEqual(computeWorkshopDiscStats(entries, discIndex, {}), out);
});

test('computePanelScatter：每角色/全体 2D 密度网格（攻击归一、幂等）', () => {
  const entries = [
    { role_id: '1011', panel: [{ name: '暴击率', final: '0.5' }, { name: '暴击伤害', final: '1.0' }, { name: '攻击力', final: '3000' }] },
    { role_id: '1011', panel: [{ name: '暴击率', final: '0.6' }, { name: '暴击伤害', final: '1.5' }, { name: '攻击力', final: '3200' }] },
    { role_id: '1011', panel: [{ name: '暴击率', final: '0.7' }, { name: '暴击伤害', final: '1.8' }, { name: '攻击力', final: '3400' }] },
    { role_id: '1031', panel: [{ name: '暴击率', final: '40%' }, { name: '暴击伤害', final: '120%' }, { name: '攻击力', final: '2800' }] },
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
    skills: [{ type: 0, level: 9 }, { type: 1, level: 7 }],
    panel: [
      { name: '攻击力', final: '2000' },
      { name: '暴击率', final: '0.4' },
    ],
    equips: [
      { id: '11114', suit: '静听嘉音', main: [{ name: '暴击率', value: '4.8%' }], subs: [{ name: '攻击力', value: '6%' }, { name: '异常掌控', value: '12' }] },
    ],
  },
  {
    uid: 'u1',
    role_id: '1011',
    source: '2025',
    rank: 6,
    relic_point: 300,
    skills: [{ type: 0, level: 12 }, { type: 1, level: 12 }],
    panel: [
      { name: '攻击力', final: '3000' },
      { name: '暴击率', final: '0.7' },
    ],
    equips: [
      { id: '11114', suit: '静听嘉音', main: [{ name: '暴击率', value: '4.8%' }], subs: [{ name: '暴击伤害', value: '9.6%' }, { name: '攻击力', value: '6%' }] },
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

test('computeRankLayers：每角色×影画档的关键属性分布', () => {
  const out = computeRankLayers(NEW_META_ENTRIES);
  assert.ok(out['1011']);
  assert.ok(out['1011'][0], 'rank 0 有分布');
  assert.ok(out['1011'][6], 'rank 6 有分布');
  assert.equal(out['1011'][0]['攻击力'].median, 2000);
  assert.equal(out['1011'][6]['攻击力'].median, 3000);
  assert.equal(out['1011'][6]['暴击率'].mean, 0.7);
  assert.equal(out['1011'][6]['暴击率'].count, 1);
  // 非关键属性不进入
  assert.equal(out['1011'][0]['防御力'], undefined);
  // 无 rank 条目跳过
  const noRank = computeRankLayers([{ role_id: '1011', rank: null, panel: [{ name: '攻击力', final: '1' }] }]);
  assert.deepEqual(noRank, {});
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
  assert.equal(out['1011'][0].median, 12, 'lightDist 分位取整：排序 [9,12] 的 0.5 分位 = s[1]');
  assert.equal(out['1011'][1].median, 12);
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
        { type: 3, level: 9 },  // 终结+连携 → 4
        { type: 5, level: 7 },  // 核心 → 5
        { type: 6, level: 8 },  // 支援技 → 2
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
        { type: 3, level: 9 },  // 连携 → 4（并入终结）
        { type: 5, level: 7 },  // 核心 → 5
        { type: 6, level: 8 },  // 终结 → 4
      ],
    },
  ]);
  const d = out['1011'];
  assert.equal(d[0].median, 12, '普攻');
  assert.equal(d[1].median, 11, '2025 type1 闪避 → canonical 1');
  assert.equal(d[2], undefined, '2025 无支援技数据');
  assert.equal(d[3].median, 10, '2025 type2 特殊技 → canonical 3');
  assert.equal(d[4].median, 9, '2025 type3 连携 + type6 终结 → canonical 4（排序 [8,9] 的 0.5 分位 = s[1]）');
  assert.equal(d[5].median, 7, '核心');
});

test('computeSkillStats：旧数据无 source 回退数组顺序判别；无法判源跳过', () => {
  const out = computeSkillStats([
    {
      role_id: '1011',
      // 旧数据无 source：mys 数组按 UI 顺序 [0,2,6,...] → 第 2 位=2 判 mys
      skills: [{ type: 0, level: 12 }, { type: 2, level: 10 }, { type: 6, level: 8 }],
    },
    {
      role_id: '1021',
      // 旧数据无 source：2025 数组按 ID 顺序 [0,1,2,...] → 第 2 位=1 判 2025
      skills: [{ type: 0, level: 12 }, { type: 1, level: 11 }, { type: 6, level: 8 }],
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

test('computePlayerProfiles：uid 聚合（角色数/评分/影画）', () => {
  const out = computePlayerProfiles(NEW_META_ENTRIES);
  const u1 = out.find((p) => p.uid === 'u1');
  assert.ok(u1);
  assert.equal(u1.chars, 1, 'u1 只有一个角色（两条同角色条目）');
  assert.equal(u1.avgRelic, 225);
  assert.equal(u1.maxRelic, 300);
  assert.equal(u1.ranked, 1, 'rank>0 的角色数（rank 6 那条）');
  const u2 = out.find((p) => p.uid === 'u2');
  assert.equal(u2.avgRelic, null, '全 0 评分 → 平均分 null');
});

test('computeRoleDiscStats：每角色 456 主词条/副词条/有效词条', () => {
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
        { id: '33144', suit: '静听嘉音', main: [{ name: '暴击率', value: 480 }], subs: [{ name: '穿透率百分比', value: 600 }, { name: '暴击率百分比', value: 480 }] },
        // 5 号位（id 末位 5）主词条 穿透值（非候选 → 过滤），副词条 攻击力%（合法）
        { id: '33145', suit: '静听嘉音', main: [{ name: '穿透值', value: 9 }], subs: [{ name: '攻击力百分比', value: 480 }] },
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
  for (const c of d.subCombos) assert.ok(c.combo.every((n) => ['暴击率', '攻击力%', '暴击伤害', '穿透值', '异常精通', '攻击力', '防御力', '防御力%', '生命值', '生命值%'].includes(n)));
});

test('computeAbyssStats：层数/评级分布 + 实战配队 Top', () => {
  const abyssEntries = [
    {
      uid: 'u1',
      abyss: {
        max_layer: 7,
        rating_list: [{ times: 4, rating: 'S' }],
        floors: [
          { node_1: { avatars: [{ id: 1091 }, { id: 1311 }] }, node_2: { avatars: [{ id: 1431 }, { id: 1501 }] } },
        ],
      },
    },
    {
      uid: 'u2',
      abyss: {
        max_layer: 5,
        rating_list: [{ times: 2, rating: 'A' }],
        floors: [{ node_1: { avatars: [{ id: 1091 }, { id: 1311 }] }, node_2: null }],
      },
    },
    { uid: 'u3', abyss: null }, // 无深渊
  ];
  const out = computeAbyssStats(abyssEntries);
  assert.deepEqual(out.layerDist, { 7: 1, 5: 1 });
  assert.deepEqual(out.ratingDist, { S: 1, A: 1 });
  assert.equal(out.teams.length, 2);
  // 1091,1311 共现 2 次（u1 node_1 + u2 node_1）→ Top1
  const top = out.teams[0];
  assert.deepEqual(top.team, ['1091', '1311']);
  assert.equal(top.count, 2);
});

test('computeAbyssTeamStats：出场榜 / 双队配队 Top / S 评级 Top / 队友共现', () => {
  const abyssEntries = [
    {
      uid: 'u1',
      abyss: {
        max_layer: 7,
        floors: [
          {
            rating: 'S',
            node_1: { avatars: [{ id: 1091 }, { id: 1311 }, { id: 1011 }] },
            node_2: { avatars: [{ id: 1431 }, { id: 1501 }] },
          },
        ],
      },
    },
    {
      uid: 'u2',
      abyss: {
        max_layer: 5,
        floors: [{ rating: 'A', node_1: { avatars: [{ id: 1091 }, { id: 1311 }] }, node_2: null }],
      },
    },
  ];
  const out = computeAbyssTeamStats(abyssEntries);
  // 出场榜：1091/1311 各 2 次、1011/1431/1501 各 1 次；ratio 合计 = 1
  const usage = new Map(out.charUsage.map((c) => [c.id, c.count]));
  assert.equal(usage.get('1091'), 2);
  assert.equal(usage.get('1011'), 1);
  assert.ok(Math.abs(out.charUsage.reduce((s, c) => s + c.ratio, 0) - 1) < 1e-9);
  // 双队分开：第一队 Top = [1011,1091,1311]（3 人组合）×1 + [1091,1311]×1；第二队 = [1431,1501]
  assert.deepEqual(out.nodeTeams[1][0].chars, ['1011', '1091', '1311']);
  assert.equal(out.nodeTeams[1].length, 2);
  assert.deepEqual(out.nodeTeams[2][0].chars, ['1431', '1501']);
  // S 评级只看 u1 第一队
  assert.deepEqual(out.sTeams[0].chars, ['1011', '1091', '1311']);
  // 队友共现：1091 的队友 = 1311×2、1011×1
  const mates = out.teammates['1091'];
  assert.equal(mates['1311'], 2);
  assert.equal(mates['1011'], 1);
});
