import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, stripHtml, parseCookies, formatValue, escapeHtml } from '../src/lib/util.js';

test('normalize 去 HTML 与标点，只留中文数字', () => {
  assert.equal(normalize('<p>蕾米埃尔·丹</p>'), '蕾米埃尔丹');
  assert.equal(normalize('星见雅'), '星见雅');
  assert.equal(normalize(null), '');
});

test('stripHtml 去标签并折叠空白', () => {
  assert.equal(stripHtml('<p>攻击力+36%</p>'), '攻击力+36%');
  assert.equal(stripHtml('<b>a</b>&nbsp;<i>b</i>'), 'ab');
  assert.equal(stripHtml(''), '');
});

test('parseCookies 解析与空值', () => {
  assert.deepEqual(parseCookies('a=1; b=2; c=3'), { a: '1', b: '2', c: '3' });
  assert.deepEqual(parseCookies(''), null);
  assert.deepEqual(parseCookies(';;;'), null);
});

test('formatValue 数值展示', () => {
  assert.equal(formatValue('攻击力', 1000), '1,000');
  assert.equal(formatValue('攻击力', 1234.5), '1,234.5');
  assert.equal(formatValue('暴击率', 0.5), '50.0%');
  assert.equal(formatValue('暴击伤害', 1.2), '120.0%');
  assert.equal(formatValue('能量自动回复', 1.2), '1.2');
  assert.equal(formatValue('攻击力', null), '—');
  assert.equal(formatValue('攻击力', 0), '0');
});

test('escapeHtml 转义 & " < （用于 HTML 属性值）', () => {
  assert.equal(escapeHtml('<b>&"x"</b>'), '&lt;b>&amp;&quot;x&quot;&lt;/b>');
  assert.equal(escapeHtml(''), '');
});
