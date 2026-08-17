// src/web/main.js —— 前端入口：从 /api/data 加载数据 → 注入数据层/计算层 → 初始化交互 → 渲染
import { setData, dataCtx } from './data.js';
import { setCalcContext } from '../lib/calc.js';
import { initUi } from './ui.js';

// 记录页面头部高度，供表格冻结表头（吸顶）定位与 main/.wiki-wrap 的 max-height 计算。
// header 是 flex-wrap: wrap，窄屏换行后会变高——只在加载时算一次会让 max-height 常年失准，
// 所以用 ResizeObserver 实时跟踪（charts.js 的 resize 监听只负责 ECharts 重排，两者不相干）。
const header = document.querySelector('header');
const syncHeadHeight = () => document.documentElement.style.setProperty('--head-h', header.offsetHeight + 'px');
syncHeadHeight();
new ResizeObserver(syncHeadHeight).observe(header);

// 数据源为 server 提供的 /api/data（读取 data/*.json）
// 整段包 try：fetch 只在 HTTP 层出错时 reject，而 !res.ok 只覆盖「服务器答了但状态码非 2xx」。
// 服务器没起、连接被拒、离线、JSON 截断都会直接抛，顶层 await 的异常无人捕获 =
// 页面永久空白且控制台之外没有任何提示。
const fail = (msg) => {
  document.getElementById('grid').innerHTML = `<div class="empty">${msg}</div>`;
};
const START_HINT = '请先运行 <b>npm start</b> 启动服务器，再打开本页。';
try {
  const res = await fetch('/api/data');
  if (!res.ok) {
    fail(
      res.status === 401
        ? `未通过访问令牌校验（HTTP 401）。<br>请访问 <b>/login?token=&lt;AUTH_TOKEN&gt;</b> 后重试。`
        : `无法加载数据（HTTP ${res.status}）。<br>${START_HINT}`
    );
  } else {
    const { library, characters, plans, workshopGrad, workshopStats } = await res.json();
    setData(library, characters, plans, workshopGrad, workshopStats);
    setCalcContext(dataCtx);
    initUi();
  }
} catch (e) {
  console.error('加载 /api/data 失败:', e);
  fail(`无法连接服务器（${e.message}）。<br>${START_HINT}`);
}
