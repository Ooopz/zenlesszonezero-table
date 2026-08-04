// src/web/main.js —— 前端入口：从 /api/data 加载数据 → 注入数据层/计算层 → 初始化交互 → 渲染
import { setData, dataCtx } from './data.js';
import { setCalcContext } from '../lib/calc.js';
import { initUi } from './ui.js';

// 记录页面头部高度，供表格冻结表头（吸顶）定位
document.documentElement.style.setProperty('--head-h', document.querySelector('header').offsetHeight + 'px');

// 数据源为 server 提供的 /api/data（读取 data/*.json）
const res = await fetch('/api/data');
if (!res.ok) {
  document.getElementById('grid').innerHTML =
    `<div class="empty">无法加载数据（HTTP ${res.status}）。<br>请先运行 <b>npm start</b> 启动本地服务器，再打开本页。</div>`;
} else {
  const { library, characters } = await res.json();
  setData(library, characters);
  setCalcContext(dataCtx);
  initUi();
}
