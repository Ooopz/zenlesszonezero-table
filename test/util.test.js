import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  stripHtml,
  parseCookies,
  formatValue,
  escapeHtml,
  escapeJsAttr,
  renderRichText,
  compareValues,
  normalizeStatKey,
  normalizeStatKeys,
} from '../src/lib/util.js';

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
  assert.equal(formatValue('能量自动回复', 1.2), '1.20', '能量自动回复截断到 2 位');
  assert.equal(formatValue('能量自动回复', 1.728), '1.72', '能量自动回复截断（不舍入）');
  assert.equal(formatValue('攻击力', null), '—');
  assert.equal(formatValue('攻击力', 0), '0');
});

test('escapeHtml 转义 & " < （用于 HTML 属性值）', () => {
  assert.equal(escapeHtml('<b>&"x"</b>'), '&lt;b>&amp;&quot;x&quot;&lt;/b>');
  assert.equal(escapeHtml(''), '');
});

test('escapeJsAttr 防单引号字符串逃逸与属性闭合', () => {
  // 单引号 → JS 反斜杠转义；双引号/小于号 → HTML 转义（HTML 解码后 JS 字符串内无威胁）
  assert.equal(escapeJsAttr("a'b"), "a\\'b");
  assert.equal(escapeJsAttr('a"b'), 'a&quot;b');
  assert.equal(escapeJsAttr('a<b'), 'a&lt;b');
  assert.equal(escapeJsAttr('a&b'), 'a&amp;b');
  // 反斜杠本身先转义，避免吞掉后续转义
  assert.equal(escapeJsAttr("a\\'b"), "a\\\\\\'b");
  // 综合攻击载荷：无法提前闭合 onclick="fn('...')"
  const payload = "x'; alert(1); 'y";
  assert.equal(escapeJsAttr(payload), "x\\'; alert(1); \\'y");
  assert.ok(!escapeJsAttr('"><script>alert(1)</script>').includes('<'));
  assert.equal(escapeJsAttr(null), '');
});

test('renderRichText 转换游戏富文本并清理危险内容', () => {
  // 游戏标记 <color=#HEX> → 标准 span
  assert.equal(renderRichText('<color=#FFA9DD>流明伤害</color>'), '<span style="color:#FFA9DD">流明伤害</span>');
  // 标准 HTML span 原样保留
  assert.equal(renderRichText('<span style="color: #fff">[虚曜]</span>'), '<span style="color: #fff">[虚曜]</span>');
  // 字面 \n 与真实换行符 → <br>
  assert.equal(renderRichText('第一行\\n第二行'), '第一行<br>第二行');
  assert.equal(renderRichText('甲\n乙'), '甲<br>乙');
  // 移除脚本与事件属性
  assert.ok(!renderRichText('<img src=x onerror=alert(1)>').includes('onerror'));
  assert.ok(!/script/i.test(renderRichText('<script>alert(1)</script>x')));
  assert.equal(renderRichText(''), '');
  assert.equal(renderRichText(null), '');
});

test('compareValues 数字 / 字符串 / null 比较', () => {
  assert.ok(compareValues(10, 2) > 0, '数字按数值');
  assert.ok(compareValues(2, 10) < 0);
  assert.equal(compareValues(5, 5), 0);
  assert.ok(compareValues('a', 'b') < 0, '字符串按 locale');
  assert.equal(compareValues(null, null), 0);
  assert.ok(compareValues(null, 5) > 0, 'null 排最后');
  assert.ok(compareValues(5, null) < 0);
  assert.ok(compareValues(undefined, 1) > 0, 'undefined 也排最后');
});

test('normalizeStatKey 把属性别名映射到规范名', () => {
  assert.equal(normalizeStatKey('生命'), '生命值');
  assert.equal(normalizeStatKey('生命力'), '生命值');
  assert.equal(normalizeStatKey('攻击'), '攻击力');
  assert.equal(normalizeStatKey('防御'), '防御力');
  assert.equal(normalizeStatKey('暴击'), '暴击率', '短名 暴击 → 暴击率');
  assert.equal(normalizeStatKey('暴伤'), '暴击伤害', '短名 暴伤 → 暴击伤害');
  assert.equal(normalizeStatKey('贯穿力'), '贯穿力', '贯穿力独立保留（不归一化成穿透率）');
  assert.equal(normalizeStatKey('贯穿率'), '贯穿力', '命破 贯穿率 → 贯穿力');
  assert.equal(normalizeStatKey('闪能自动积累'), '能量自动回复', '命破 闪能自动积累 → 能量自动回复');
  assert.equal(normalizeStatKey('闪能自动累积'), '能量自动回复', '命破 闪能自动累积 → 能量自动回复');
  assert.equal(normalizeStatKey('闪能自动累计'), '能量自动回复', '命破 闪能自动累计 → 能量自动回复');
  assert.equal(normalizeStatKey('生命值'), '生命值', '规范名原样保留');
  assert.equal(normalizeStatKey('暴击率'), '暴击率', '未知名原样保留');
  assert.equal(normalizeStatKey('暴击伤害'), '暴击伤害', '未知名原样保留');
  assert.equal(normalizeStatKey('能量自动回复'), '能量自动回复', '未知名原样保留');
});

test('normalizeStatKeys 归一化对象键，规范名优先', () => {
  assert.deepEqual(normalizeStatKeys({ 生命: 100, 攻击: 50, 防御: 10 }), {
    生命值: 100,
    攻击力: 50,
    防御力: 10,
  });
  assert.deepEqual(normalizeStatKeys({ 生命力: 7673 }), { 生命值: 7673 });
  // 别名与规范名并存时规范名优先（两种顺序都应成立）
  assert.deepEqual(normalizeStatKeys({ 生命: 90, 生命值: 100 }), { 生命值: 100 });
  assert.deepEqual(normalizeStatKeys({ 生命值: 100, 生命: 90 }), { 生命值: 100 });
  // 未知键原样保留
  assert.deepEqual(normalizeStatKeys({ 暴击率: 0.5, foo: 1 }), { 暴击率: 0.5, foo: 1 });
  // 命破角色专属属性键：贯穿力独立保留，闪能自动* 三个变体归一到能量自动回复
  assert.deepEqual(normalizeStatKeys({ 贯穿力: 105, 闪能自动累积: 2 }), { 贯穿力: 105, 能量自动回复: 2 });
  assert.deepEqual(normalizeStatKeys({ 贯穿力: 94, 闪能自动积累: 0 }), { 贯穿力: 94, 能量自动回复: 0 });
  assert.deepEqual(normalizeStatKeys({ 贯穿率: 100, 闪能自动累计: 1 }), { 贯穿力: 100, 能量自动回复: 1 });
  assert.deepEqual(normalizeStatKeys(null), {});
  assert.deepEqual(normalizeStatKeys(undefined), {});
});
