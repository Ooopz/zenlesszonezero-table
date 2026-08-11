import test from 'node:test';
import assert from 'node:assert/strict';
import { createSort } from '../src/lib/sort.js';

test('toggle 三态：同列升→降→复位，新列从升序', () => {
  const sort = createSort();
  assert.equal(sort.active, false);

  sort.toggle('名称');
  assert.equal(sort.key, '名称');
  assert.equal(sort.dir, 1, '新列从升序');
  assert.equal(sort.active, true);

  sort.toggle('名称');
  assert.equal(sort.key, '名称');
  assert.equal(sort.dir, -1, '同列再点转降序');

  sort.toggle('名称');
  assert.equal(sort.active, false, '同列第三次复位');

  sort.toggle('稀有度');
  assert.equal(sort.key, '稀有度');
  assert.equal(sort.dir, 1, '切换列后从升序重新开始');
});

test('reset 恢复未排序状态', () => {
  const sort = createSort();
  sort.toggle('攻击');
  sort.toggle('攻击');
  sort.reset();
  assert.equal(sort.active, false);
  assert.equal(sort.key, null);
});

test('apply 未激活时原样返回', () => {
  const sort = createSort();
  const list = [3, 1, 2];
  assert.equal(
    sort.apply(list, (x) => x),
    list,
    '未排序时保持原引用'
  );
});

test('apply 按取值函数排序', () => {
  const sort = createSort();
  const rows = [{ n: '乙' }, { n: '甲' }, { n: '丙' }];
  sort.toggle('n');
  assert.deepEqual(
    sort.apply(rows, (r) => r.n).map((r) => r.n),
    ['丙', '甲', '乙'],
    '升序按 zh locale（拼音序：丙 bing < 甲 jia < 乙 yi）'
  );
  sort.toggle('n');
  assert.deepEqual(
    sort.apply(rows, (r) => r.n).map((r) => r.n),
    ['乙', '甲', '丙'],
    '降序'
  );
});

test('apply 空值行恒排最后（不受升降序影响）', () => {
  const sort = createSort();
  const rows = [{ n: '乙' }, { n: null }, { n: '甲' }, { n: '' }, { n: undefined }];
  sort.toggle('n');
  const asc = sort.apply(rows, (r) => r.n).map((r) => r.n);
  assert.deepEqual(asc.slice(0, 2), ['甲', '乙'], '升序非空在前');
  assert.deepEqual(asc.slice(2).map(String), ['null', '', 'undefined'], '三种空值都排最后');
  sort.toggle('n');
  const desc = sort.apply(rows, (r) => r.n).map((r) => r.n);
  assert.deepEqual(desc.slice(0, 2), ['乙', '甲'], '降序非空在前');
  assert.deepEqual(desc.slice(2).map(String), ['null', '', 'undefined'], '降序时空值依然最后');
});

test('apply 数字按数值比较', () => {
  const sort = createSort();
  const rows = [{ v: 10 }, { v: 2 }, { v: 1 }];
  sort.toggle('v');
  assert.deepEqual(
    sort.apply(rows, (r) => r.v).map((r) => r.v),
    [1, 2, 10],
    '数字按数值而非字典序'
  );
});
