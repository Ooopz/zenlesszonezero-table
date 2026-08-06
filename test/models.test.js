import test from 'node:test';
import assert from 'node:assert/strict';
import { Character, Wengine, Disc, toInstances } from '../src/lib/models.js';
import { buildIndex } from '../src/lib/util.js';
import { setCalcContext } from '../src/lib/calc.js';
import { loadDataFile } from './helpers.js';

const libraryData = loadDataFile('library.json', 'npm run sync:library（或网页「更新数据库」）');
const charactersData = loadDataFile('characters.json', 'npm run sync:characters（或网页「更新我的角色」）');

const library = {
  characters: toInstances(libraryData.characters, Character),
  wengines: toInstances(libraryData.wengines, Wengine),
  discs: toInstances(libraryData.discs, Disc),
};

setCalcContext({
  library,
  charIndex: buildIndex(library.characters),
  wengineIndex: buildIndex(library.wengines),
  discIndex: buildIndex(library.discs),
  readCharTarget: () => ({}),
  readValidStats: () => [],
});

test('Character 实例化：字段 + 嵌套 Wengine/Disc', () => {
  const c = new Character(charactersData[0]);
  assert.equal(c.name, charactersData[0].name);
  assert.ok(c.wengine instanceof Wengine, '音擎应为 Wengine 实例');
  assert.ok(Array.isArray(c.discs) && c.discs.length === 6);
  assert.ok(c.discs[0] instanceof Disc, '驱动盘应为 Disc 实例');
  assert.ok(c.panel && typeof c.panel === 'object');
});

test('Disc 构造时自动计算各副词条成长次数', () => {
  const c = new Character(charactersData[0]);
  for (const d of c.discs) {
    assert.ok(Array.isArray(d.growth), '应自动计算 growth');
    for (const g of d.growth) {
      assert.ok('type' in g && Number.isInteger(g.growthCount));
    }
  }
  // 未佩戴盘（无副词条）→ growth 为空
  const empty = new Disc({ set: '未佩戴驱动盘' });
  assert.deepEqual(empty.growth, []);
});

test('Disc.getHitCount：命中统计；无有效属性返回 null', () => {
  const c = new Character(charactersData[0]);
  const d = c.discs.find((x) => x.subStats.length);
  if (d) {
    const h = d.getHitCount(new Set(['攻击力%']));
    assert.ok(h === null || (Number.isInteger(h) && h >= 0));
    assert.equal(d.getHitCount(new Set()), null);
  }
});

test('Wengine 实例化：账号版与 wiki 版字段', () => {
  const w = new Wengine(charactersData[0].wengine);
  assert.equal(w.name, charactersData[0].wengine.name);
  const wiki = new Wengine(Object.values(library.wengines)[0]);
  assert.ok(wiki.baseAtk !== undefined, 'wiki 音擎应有 baseAtk');
});

test('Character 归一化 wiki 扩展字段到实例', () => {
  const c = new Character({
    name: 'test',
    description: '介绍',
    skills: [{ type: '普攻', items: [] }],
    cinemas: [{ name: '影画一', desc: '' }],
    cv: '中配：X',
    生命值: 100,
  });
  assert.equal(c.description, '介绍');
  assert.equal(c.cv, '中配：X');
  assert.equal(c.cinemas[0].name, '影画一');
  assert.equal(c.生命值, 100, '扁平初始属性应归一化到实例');
  assert.ok(Array.isArray(c.skills));
});

test('Character 归一化 maxLevel 键名（短形式 → 规范名）', () => {
  const c = new Character({ name: '潘引壶', maxLevel: { 生命: 8453, 攻击: 586, 防御: 712 } });
  assert.deepEqual(c.maxLevel, { 生命值: 8453, 攻击力: 586, 防御力: 712 });
  const c2 = new Character({ name: '希希芙', maxLevel: { 生命力: 7673, 攻击力: 863, 防御力: 606 } });
  assert.equal(c2.maxLevel['生命值'], 7673, '生命力也应映射到 生命值');
});

test('Character 不再保留整份原始数据的 extra 引用', () => {
  const c = new Character({ name: 'test', 生命值: 100 });
  assert.ok(!('extra' in c), '不应再有 .extra 转发通道');
  assert.equal(c.生命值, 100);
});

test('toInstances 把 {键: 数据} 实例化为基类集合', () => {
  const out = toInstances({ a: { name: 'A' }, b: { name: 'B' } }, Character);
  assert.ok(out.a instanceof Character && out.b instanceof Character);
  assert.equal(out.a.name, 'A');
  assert.equal(Object.keys(out).length, 2);
  assert.deepEqual(toInstances(null, Character), {});
});

test('Character.calculate 产出有限数面板，属性库角色为 Character 实例', () => {
  const c = new Character(charactersData[0]);
  const R = c.calculate();
  for (const stat of ['攻击力', '生命值', '暴击率']) {
    const v = R.final[stat];
    if (v != null) assert.ok(Number.isFinite(v), `${stat} 应为有限数`);
  }
  assert.ok(R.libCharacter instanceof Character, '属性库角色应为 Character 实例');
  assert.ok(R.libWengine instanceof Wengine || !R.libWengine, '属性库音擎应为 Wengine 实例');
});
