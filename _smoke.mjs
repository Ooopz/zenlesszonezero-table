// 完整 render 流程冒烟：mock DOM 支持查询，模拟视图切换全链路
import fs from 'node:fs';

// ---------- DOM mock（支持 class 查询） ----------
const makeEl = (tag, cls = '') => ({
  tagName: String(tag).toUpperCase(),
  className: cls,
  style: { setProperty() {}, display: '' },
  dataset: {},
  innerHTML: '',
  children: [],
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  addEventListener() {},
  appendChild(c) { this.children.push(c); return c; },
  querySelector(sel) {
    if (sel === '.mychars-body') return makeEl('div', 'mychars-body');
    return null;
  },
  querySelectorAll: () => [],
  closest: () => null,
  getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
  offsetHeight: 0,
  isConnected: true,
});
const grid = makeEl('div');
const tabs = ['mychars', 'wiki', 'stats', 'simulate'].map((v) => {
  const el = makeEl('button', 'view-tab');
  el.dataset.view = v;
  el.clickHandlers = [];
  el.addEventListener = (ev, fn) => { if (ev === 'click') el.clickHandlers.push(fn); };
  return el;
});
globalThis.document = {
  createElement: (t) => makeEl(t),
  body: makeEl('body'),
  addEventListener() {},
  querySelector: () => makeEl('div'),
  querySelectorAll: (sel) => (sel === '.view-tab' ? tabs : sel === '.chart-init' ? [] : []),
  getElementById: (id) => (id === 'grid' ? grid : makeEl('div')),
  documentElement: { style: { setProperty() {} } },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.location = { search: '', pathname: '/', replaceState() {} };
globalThis.history = { replaceState() {} };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} };
globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
globalThis.echarts = { init: () => ({ setOption() {}, dispose() {}, getDom: () => ({ isConnected: true }), on() {} }) };

// ---------- 数据注入 ----------
const lib = JSON.parse(fs.readFileSync('data/library.json', 'utf8'));
const chars = JSON.parse(fs.readFileSync('data/characters.json', 'utf8'));
const plans = JSON.parse(fs.readFileSync('data/plans.json', 'utf8'));
const grad = JSON.parse(fs.readFileSync('data/workshop-grad.json', 'utf8'));
const stats = JSON.parse(fs.readFileSync('data/workshop-stats.json', 'utf8'));
const { setData } = await import('./src/web/data.js');
const { setCalcContext } = await import('./src/lib/calc.js');
setData(lib, chars, plans, grad, stats);
setCalcContext((await import('./src/web/data.js')).dataCtx);

const { render } = await import('./src/web/render.js');
const { userConfig } = await import('./src/web/data.js');
const { initUi } = await import('./src/web/ui.js');

let fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`[OK  ] ${name}`); }
  catch (e) {
    fail++;
    console.log(`[FAIL] ${name} → ${e.constructor.name}: ${String(e.message).slice(0, 160)}`);
    console.log('        stack:', String(e.stack).split('\n').slice(1, 4).join('\n        '));
  }
};

await initUi();
check('初始 render（loadUserConfig 后）', () => render());

// 模拟点击每个一级视图 tab
for (const tab of tabs) {
  check(`点击「${tab.dataset.view}」tab`, () => {
    tab.clickHandlers.forEach((fn) => fn());
  });
}
// 回到我的角色再切卡片/汇总子页
check('点击「mychars」tab 后切汇总', () => {
  tabs[0].clickHandlers.forEach((fn) => fn());
  userConfig.view = 'mychars';
  const myTabBtn = { dataset: { key: 'table' } };
  // 直接调 ZZZ.myTab
  globalThis.ZZZ?.myTab?.('table');
  render();
});
console.log(fail ? `\n${fail} 个失败` : '\n全部通过 ✓');
