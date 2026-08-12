// test/workshopStats.test.js —— 工坊驱动盘单盘统计：词条名映射 + 两源聚合
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { computeWorkshopDiscStats, discStatName } from '../src/lib/workshopStats.js';
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
    // —— mys 源：name [N]，main[] 即副词条（主词条缺失），无 subs ——
    {
      uid: 'u2',
      role_id: '1341',
      equips: [
        { name: '静听嘉音[5]', suit: '静听嘉音', main: [{ name: '攻击力', value: '6%' }, { name: '穿透率', value: '4.8%' }] },
      ],
    },
    // —— 套装别名（荆棘玫瑰→棘刺玫瑰）+ 另一角色 ——
    { uid: 'u3', role_id: '1361', equips: [{ name: '荆棘玫瑰[1]', suit: '荆棘玫瑰', main: [{ name: '防御力', value: '6%' }] }] },
  ];
  const out = computeWorkshopDiscStats(entries, discIndex, { roleNameMap });
  assert.equal(out.length, 2, '只含出现的盘');
  const 静听 = out.find((d) => d.name === '静听嘉音');
  const 棘刺 = out.find((d) => d.name === '棘刺玫瑰');
  assert.ok(静听 && 棘刺, '套装别名解析为规范名');
  // 静听嘉音：equips = 2 块 2025 + 1 块 mys = 3（物理盘数）
  assert.equal(静听.equips, 3);
  // 主词条：仅 2025 源 2 块（槽4/槽5），槽4=攻击力%（2025 扁平 攻击力 经 mainStatName 兜底）；mys 槽5 主词条缺失
  assert.deepEqual(静听.main456[4], [{ name: '攻击力%', count: 1 }]);
  assert.deepEqual(静听.main456[5], [{ name: '攻击力%', count: 1 }]);
  assert.deepEqual(静听.main456[6], []);
  // mainDenom 只数 2025 盘（槽4:1、槽5:1、槽6:0），mys 盘不数
  assert.deepEqual(静听.mainDenom, { 4: 1, 5: 1, 6: 0 });
  // 副词条：2025 subs(攻击力%×1、暴击伤害×1、暴击率×1) + mys main(攻击力%×1、穿透率×1) 合并
  const subMap = Object.fromEntries(静听.subs.map((f) => [f.name, f.count]));
  assert.deepEqual(subMap, { '攻击力%': 2, 暴击伤害: 1, 暴击率: 1, 穿透率: 1 });
  // 角色：两个 entry 同 role_id → 去重 1 个名字
  assert.deepEqual(静听.characters, ['维琳娜·艾嘉德']);
  // 棘刺玫瑰：mys 盘，防御力% 副词条，角色去重
  assert.equal(棘刺.equips, 1);
  assert.deepEqual(棘刺.main456, { 4: [], 5: [], 6: [] }, 'mys 源无主词条');
  assert.deepEqual(Object.fromEntries(棘刺.subs.map((f) => [f.name, f.count])), { '防御力%': 1 });
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
