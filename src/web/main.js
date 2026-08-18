// src/web/main.js —— 前端入口：从 /api/data 加载数据 → 注入数据层/计算层 → 初始化交互 → 渲染
import { setData, dataCtx } from './data.js';
import { setCalcContext } from '../lib/calc.js';
import { initUi } from './ui.js';

// header 高度供表格吸顶表头定位（--head-h）：flex-wrap 窄屏换行后会变高，只在加载时算一次会失准，故用 ResizeObserver 实时跟踪（charts.js 的 resize 只负责 ECharts，两者不相干）。
const header = document.querySelector('header');
const syncHeadHeight = () => document.documentElement.style.setProperty('--head-h', header.offsetHeight + 'px');
syncHeadHeight();
new ResizeObserver(syncHeadHeight).observe(header);

// fetch 只在 HTTP 层出错时 reject；服务器没起/连接被拒/离线/JSON 截断都会直接抛——顶层 await 异常无人捕获 = 页面永久空白，故整段包 try
const fail = (msg) => {
  document.getElementById('grid').innerHTML = `<div class="empty">${msg}</div>`;
};
const START_HINT = '请先运行 <b>npm start</b> 启动服务器，再打开本页。';
// 首屏加载反馈：/api/data 约 34MB，解析+渲染需数秒，先给出加载态避免页面长时间空白
document.getElementById('grid').innerHTML =
  '<div class="empty"><span class="loader"></span>正在加载数据…</div>';
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
