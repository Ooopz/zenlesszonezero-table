// test/discAdvisor.test.js —— 驱动盘统计聚合逻辑
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscStats, computeDiscAdvisor } from '../src/lib/discAdvisor.js';
import { loadDataFile } from './helpers.js';

// 内联 fixture：两个角色共 3 个方案，覆盖 2 件套/4 件套、同盘多方案、不同副词条组合
const FIXTURE = {
  1011: {
    name: '安比',
    plans: [
      {
        sets: [
          { name: '震星迪斯科', cnt: 4 },
          { name: '摇摆爵士', cnt: 2 },
        ],
        subStats: ['暴击率', '暴击伤害', '攻击力%'],
        mainProps: { 4: '暴击率', 5: '电属性伤害加成', 6: '冲击力' },
      },
      {
        sets: [
          { name: '震星迪斯科', cnt: 4 },
          { name: '摇摆爵士', cnt: 2 },
        ],
        subStats: ['暴击率', '暴击伤害', '攻击力%', '穿透值'],
        mainProps: { 4: '暴击率', 5: '攻击力%', 6: '冲击力' },
      },
    ],
  },
  1012: {
    name: '妮可',
    plans: [
      {
        sets: [{ name: '摇摆爵士', cnt: 4 }],
        subStats: ['能量自动回复', '攻击力%'],
        mainProps: { 4: '攻击力%', 5: '以太属性伤害加成', 6: '能量自动回复' },
      },
    ],
  },
};

test('按驱动盘聚合：方案数 / 匹配角色 / 组合去重 / 456 主属性去重', () => {
  const rows = computeDiscStats(FIXTURE, ['震星迪斯科', '摇摆爵士', '无人用']);
  assert.equal(rows.length, 3);

  const d = rows.find((r) => r.name === '震星迪斯科');
  assert.equal(d.count, 2); // 两个方案都 4 件套用震星
  assert.deepEqual(d.characters, ['安比']); // 只有安比的方案用 4 件套
  assert.equal(d.subCombos.length, 2); // 两个方案的副词条组合不同 → 各保留
  // 组合内已按内容排序规范化（忽略组内顺序）
  assert.deepEqual(d.subCombos[0], ['攻击力%', '暴击伤害', '暴击率']);
  assert.deepEqual(d.subCombos[1], ['攻击力%', '暴击伤害', '暴击率', '穿透值']);
  assert.deepEqual(d.main4, [{ name: '暴击率', count: 2, ratio: 1 }]); // 两方案 4 号位相同 → 频次 2/2
  assert.deepEqual(d.main5, [
    { name: '电属性伤害加成', count: 1, ratio: 0.5 },
    { name: '攻击力%', count: 1, ratio: 0.5 },
  ]);
  assert.deepEqual(d.main6, [{ name: '冲击力', count: 2, ratio: 1 }]);

  const y = rows.find((r) => r.name === '摇摆爵士');
  assert.equal(y.count, 3); // 安比两方案 2 件套 + 妮可 4 件套
  assert.deepEqual(y.characters, ['安比', '妮可']);
  assert.equal(y.subCombos.length, 3); // 安比两方案 + 妮可一方案
  assert.deepEqual(y.main4, [
    { name: '暴击率', count: 2, ratio: 2 / 3 },
    { name: '攻击力%', count: 1, ratio: 1 / 3 },
  ]);

  const n = rows.find((r) => r.name === '无人用');
  assert.equal(n.count, 0);
  assert.deepEqual(n.characters, []);
  assert.deepEqual(n.subCombos, []);
  assert.deepEqual(n.subStats, []);
  assert.deepEqual(n.main4, []);
  assert.deepEqual(n.main5, []);
  assert.deepEqual(n.main6, []);
});

test('词条频次：副词条按出现次数降序、ratio 以方案总数作分母', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          { sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击率', '暴击伤害'], mainProps: { 4: '暴击率' } },
          { sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击率', '攻击力%'], mainProps: { 4: '暴击率' } },
        ],
      },
      b: {
        name: '角色B',
        plans: [{ sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击率', '暴击伤害'], mainProps: { 4: '攻击力%' } }],
      },
    },
    ['某盘']
  );
  const r = rows[0];
  assert.equal(r.count, 3);
  // 暴击率 3 方案全推荐 → 1；暴击伤害 2/3；攻击力% 1/3；同频词条按首次出现顺序
  assert.deepEqual(r.subStats, [
    { name: '暴击率', count: 3, ratio: 1 },
    { name: '暴击伤害', count: 2, ratio: 2 / 3 },
    { name: '攻击力%', count: 1, ratio: 1 / 3 },
  ]);
  // 主属性同口径
  assert.deepEqual(r.main4, [
    { name: '暴击率', count: 2, ratio: 2 / 3 },
    { name: '攻击力%', count: 1, ratio: 1 / 3 },
  ]);
});

test('副词条组合按内容去重，忽略组内排序', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          { sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击率', '暴击伤害', '攻击力%'], mainProps: {} },
          { sets: [{ name: '某盘', cnt: 4 }], subStats: ['暴击伤害', '暴击率', '攻击力%'], mainProps: {} },
        ],
      },
    },
    ['某盘']
  );
  // 两组内容一致仅排序不同 → 去重为 1 组，展示为排序后的规范顺序
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].subCombos.length, 1);
  assert.deepEqual(rows[0].subCombos[0], ['攻击力%', '暴击伤害', '暴击率']);
  // 三个词条各出现 2 次、同频按首次出现顺序（方案1 的 subStats 顺序）
  assert.deepEqual(rows[0].subStats, [
    { name: '暴击率', count: 2, ratio: 1 },
    { name: '暴击伤害', count: 2, ratio: 1 },
    { name: '攻击力%', count: 2, ratio: 1 },
  ]);
});

test('套装名去标点/空白归一化匹配（plans 侧尾随空格也能命中 library 键）', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '照',
        plans: [{ sets: [{ name: '雪兔梦游仙境 ', cnt: 4 }], subStats: ['暴击率'], mainProps: { 4: '暴击率' } }],
      },
    },
    ['雪兔梦游仙境']
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '雪兔梦游仙境'); // 展示用 library 侧规范名，不带空格
  assert.equal(rows[0].count, 1);
  assert.deepEqual(rows[0].characters, ['照']);
  assert.equal(rows[0].subCombos.length, 1);
  assert.deepEqual(rows[0].subStats, [{ name: '暴击率', count: 1, ratio: 1 }]);
});

test('已知别名也能命中（棘刺玫瑰→荆棘玫瑰，wiki 改名前的旧名兼容）', () => {
  const rows = computeDiscStats(
    { a: { name: '本·比格', plans: [{ sets: [{ name: '棘刺玫瑰', cnt: 4 }], subStats: ['暴击率'], mainProps: {} }] } },
    ['荆棘玫瑰']
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '荆棘玫瑰');
  assert.equal(rows[0].count, 1);
  assert.deepEqual(rows[0].characters, ['本·比格']);
});

test('只统计 cnt 2/4 件套，其他件数忽略', () => {
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          {
            sets: [
              { name: '某盘', cnt: 1 },
              { name: '某盘', cnt: 3 },
            ],
            subStats: ['暴击率'],
            mainProps: { 4: '暴击率' },
          },
        ],
      },
    },
    ['某盘']
  );
  assert.equal(rows[0].count, 0);
  assert.deepEqual(rows[0].characters, []);
  assert.deepEqual(rows[0].subCombos, []);
  assert.deepEqual(rows[0].subStats, []);
  assert.deepEqual(rows[0].main4, []);
});

test('未知套装名（不在 discNames 内）跳过；无方案数据返回全空行', () => {
  const rows = computeDiscStats(
    {
      a: { name: '角色A', plans: [{ sets: [{ name: '不存在', cnt: 4 }], subStats: ['暴击率'], mainProps: {} }] },
    },
    ['已知盘']
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 0);
  assert.deepEqual(rows[0].characters, []);

  const empty = computeDiscStats({}, ['盘1', '盘2']);
  assert.equal(empty.length, 2);
  assert.equal(empty[0].count, 0);
  assert.deepEqual(empty[0].subCombos, []);
  assert.deepEqual(empty[0].subStats, []);
});

test('二件套同效果替代：方案推荐 A 的二件套时计入同效果组所有盘', () => {
  const discSet2 = { 岩卫盘: { 防御力: 0.16 }, 钢壁盘: { 防御力: 0.16 }, 锐攻盘: { 攻击力: 0.1 } };
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          {
            sets: [
              { name: '震鼓盘', cnt: 4 },
              { name: '岩卫盘', cnt: 2 },
            ],
            subStats: ['暴击率'],
            mainProps: { 4: '暴击率' },
          },
        ],
      },
    },
    ['岩卫盘', '钢壁盘', '锐攻盘'],
    discSet2
  );
  const A = rows.find((r) => r.name === '岩卫盘');
  const B = rows.find((r) => r.name === '钢壁盘');
  const C = rows.find((r) => r.name === '锐攻盘');
  // A 被直接推荐；B 因同效果（防御力0.16）作为替代品也被计入
  assert.equal(A.count, 1);
  assert.deepEqual(A.characters, ['角色A']);
  assert.equal(B.count, 1);
  assert.deepEqual(B.characters, ['角色A']);
  assert.deepEqual(B.subStats, [{ name: '暴击率', count: 1, ratio: 1 }]); // 与 A 频次一致
  assert.equal(C.count, 0); // 效果（攻击力0.1）不同，不计入
  assert.deepEqual(A.alternatives, ['钢壁盘']);
  assert.deepEqual(B.alternatives, ['岩卫盘']);
  assert.deepEqual(C.alternatives, []);
});

test('方案内去重：4 件套 + 2 件套替代同时命中同盘只计一次', () => {
  const discSet2 = { 岩卫盘: { 防御力: 0.16 }, 钢壁盘: { 防御力: 0.16 }, 锐攻盘: { 攻击力: 0.1 } };
  const rows = computeDiscStats(
    {
      a: {
        name: '角色A',
        plans: [
          {
            sets: [
              { name: '岩卫盘', cnt: 4 },
              { name: '钢壁盘', cnt: 2 },
              { name: '锐攻盘', cnt: 2 },
            ],
            subStats: ['暴击率'],
            mainProps: {},
          },
        ],
      },
    },
    ['岩卫盘', '钢壁盘', '锐攻盘'],
    discSet2
  );
  const A = rows.find((r) => r.name === '岩卫盘');
  const B = rows.find((r) => r.name === '钢壁盘');
  // A 被 4 件套直接计入 + B 的 2 件套替代扩展 → 方案级去重后只计 1 次
  assert.equal(A.count, 1);
  assert.equal(A.characters.length, 1);
  assert.equal(B.count, 1);
});

test('set2 为 null 的二件套不扩展替代（无效果不可替代）', () => {
  const discSet2 = { 无华盘: null, 虚空盘: null };
  const rows = computeDiscStats(
    { a: { name: '角色A', plans: [{ sets: [{ name: '无华盘', cnt: 2 }], subStats: ['暴击率'], mainProps: {} }] } },
    ['无华盘', '虚空盘'],
    discSet2
  );
  const N = rows.find((r) => r.name === '无华盘');
  const M = rows.find((r) => r.name === '虚空盘');
  assert.equal(N.count, 1);
  assert.equal(M.count, 0); // null 效果不成组，不扩展
  assert.deepEqual(N.alternatives, []);
  assert.deepEqual(M.alternatives, []);
});

test('同属性不同数值的 set2 不算同效果', () => {
  const discSet2 = { 甲盘: { 防御力: 0.16 }, 乙盘: { 防御力: 0.1 } };
  const rows = computeDiscStats(
    { a: { name: '角色A', plans: [{ sets: [{ name: '甲盘', cnt: 2 }], subStats: [], mainProps: {} }] } },
    ['甲盘', '乙盘'],
    discSet2
  );
  const 甲 = rows.find((r) => r.name === '甲盘');
  const 乙 = rows.find((r) => r.name === '乙盘');
  assert.equal(甲.count, 1);
  assert.equal(乙.count, 0);
  assert.deepEqual(甲.alternatives, []);
  assert.deepEqual(乙.alternatives, []);
});

test('真实数据冒烟：plans.json 每套驱动盘都有聚合行且去重/频次/替代不报错', () => {
  const plans = loadDataFile('plans.json', 'npm run sync:plans');
  const lib = loadDataFile('library.json', 'npm run sync:library');
  const discSet2 = Object.fromEntries(Object.values(lib.discs || {}).map((d) => [d.name, d.set2]));
  const rows = computeDiscStats(plans, Object.keys(lib.discs || {}), discSet2);
  assert.equal(rows.length, Object.keys(lib.discs).length);
  for (const r of rows) {
    assert.ok(Number.isInteger(r.count) && r.count >= 0);
    assert.ok(Array.isArray(r.alternatives));
    assert.ok(!r.alternatives.includes(r.name));
    assert.ok(Array.isArray(r.characters));
    assert.ok(Array.isArray(r.subCombos));
    // 副词条组合本身无重复
    const keys = new Set(r.subCombos.map((c) => JSON.stringify(c)));
    assert.equal(keys.size, r.subCombos.length);
    for (const f of [...r.subStats, ...r.main4, ...r.main5, ...r.main6]) {
      assert.ok(Number.isInteger(f.count) && f.count >= 1 && f.count <= r.count);
      assert.ok(f.ratio >= 0 && f.ratio <= 1);
    }
  }
  // 同效果组（荆棘玫瑰/灵魂摇滚 = 防御力0.16 二件套）替代互指
  const j = rows.find((r) => r.name === '荆棘玫瑰');
  const l = rows.find((r) => r.name === '灵魂摇滚');
  assert.ok(j.alternatives.includes('灵魂摇滚'));
  assert.ok(l.alternatives.includes('荆棘玫瑰'));
});

// ---------- computeDiscAdvisor：两口径对齐 + 保留/分歧/可抛弃判定 ----------

const MAIN_OPTS = {
  4: ['暴击率', '暴击伤害', '攻击力%', '防御力%', '生命值%'],
  5: ['攻击力%', '防御力%', '生命值%', '电属性伤害加成'],
  6: ['冲击力', '能量自动回复', '攻击力%', '防御力%'],
};

const OFFICIAL = {
  count: 10,
  characters: ['安比', '妮可'],
  main4: [
    { name: '暴击率', count: 8, ratio: 0.8 },
    { name: '攻击力%', count: 2, ratio: 0.2 },
  ],
  main5: [{ name: '电属性伤害加成', count: 10, ratio: 1 }],
  main6: [{ name: '冲击力', count: 10, ratio: 1 }],
  subStats: [
    { name: '暴击率', count: 9, ratio: 0.9 },
    { name: '攻击力%', count: 7, ratio: 0.7 },
    { name: '穿透值', count: 1, ratio: 0.1 },
  ],
  alternatives: [],
};

const LIVE = {
  equips: 100,
  characters: ['安比', '星见雅'],
  main456: {
    4: [
      { name: '暴击率', count: 80 },
      { name: '暴击伤害', count: 15 },
      { name: '防御力%', count: 2 }, // <3% → 不算共识
    ],
    5: [{ name: '电属性伤害加成', count: 90 }],
    6: [{ name: '冲击力', count: 95 }],
  },
  mainDenom: { 4: 100, 5: 100, 6: 100 },
  subs: [
    { name: '暴击率', count: 85 },
    { name: '攻击力%', count: 60 },
    { name: '能量自动回复', count: 40 },
  ],
  effDist: { 2: 20, 3: 60, 4: 20 },
  subCombos: [{ combo: ['暴击率', '攻击力%'], count: 30 }],
};

test('computeDiscAdvisor：两口径对齐 + 保留/可抛弃判定（阈值 3%，任一 ≥3% 即保留）', () => {
  const c = computeDiscAdvisor(OFFICIAL, LIVE, MAIN_OPTS, 0.03);
  // 角色：交集 = 安比
  assert.deepEqual(c.roles.both, ['安比']);
  assert.deepEqual(c.roles.official.sort(), ['妮可', '安比']); // 码元序：'妮'(22958) < '安'(23433)
  assert.deepEqual(c.roles.live.sort(), ['安比', '星见雅']);
  // 4 号位：暴击率 双边 → 保留；暴击伤害 实况 15% 官方无 → 保留（任一 ≥3%）；防御力% 2% 官方无 → 可抛弃
  const m4 = new Map(c.mains[4].map((m) => [m.name, m.verdict]));
  assert.equal(m4.get('暴击率'), 'keep');
  assert.equal(m4.get('暴击伤害'), 'keep', '实况 15% ≥3% → 保留');
  assert.equal(m4.get('防御力%'), 'drop', '官方 0% + 实况 2% 都 <3% → 可抛弃');
  assert.equal(m4.get('生命值%'), 'drop', '两口径都未出现的候选 → 可抛弃');
  assert.equal(m4.get('攻击力%'), 'keep', '官方 20% ≥3% → 保留（实况无也保留）');
  // 排序：keep 在 drop 前
  const order = c.mains[4].map((m) => m.verdict);
  assert.ok(order.indexOf('drop') > order.indexOf('keep'));
  // 5/6 号位：双边 → 保留
  assert.equal(c.mains[5][0].verdict, 'keep');
  assert.equal(c.mains[6][0].verdict, 'keep');
  // 副词条：只返回保留（任一 ≥3%），脏词条（伤害加成/能量回复/穿透率）被过滤
  const subs = new Map(c.subs.map((s) => [s.name, s.verdict]));
  assert.equal(subs.get('暴击率'), 'keep');
  assert.equal(subs.get('攻击力%'), 'keep');
  assert.equal(subs.get('能量自动回复'), undefined, '脏词条（非法副词条）被过滤');
  assert.equal(subs.get('穿透值'), 'keep', '合法副词条，官方 10% ≥3% → 保留');
  // 组合/有效词条透传
  assert.equal(c.combos[0].count, 30);
  assert.equal(c.effDist[4], 20);
});

test('computeDiscAdvisor：单口径缺失（无官方数据 / 无实况数据）不报错', () => {
  const c1 = computeDiscAdvisor(null, LIVE, MAIN_OPTS);
  assert.deepEqual(c1.roles.official, []);
  assert.deepEqual(c1.roles.both, []);
  assert.equal(c1.mains[4].find((m) => m.name === '暴击率').verdict, 'keep', '仅实况高频 → 保留');
  assert.equal(c1.mains[4].find((m) => m.name === '暴击伤害').verdict, 'keep');
  assert.equal(c1.mains[4].find((m) => m.name === '生命值%').verdict, 'drop');
  const c2 = computeDiscAdvisor(OFFICIAL, null, MAIN_OPTS);
  assert.deepEqual(c2.roles.live, []);
  assert.equal(c2.mains[4].find((m) => m.name === '暴击率').verdict, 'keep', '官方 80% ≥3% → 保留');
  assert.equal(c2.mains[4].find((m) => m.name === '攻击力%').verdict, 'keep', '官方 20% ≥3% → 保留');
  assert.equal(c2.equips, 0);
});
