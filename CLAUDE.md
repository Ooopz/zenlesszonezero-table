# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

个人用的《绝区零》角色配装面板：本地 Node 服务器 + 米游社 wiki/账号数据同步 + 无构建步骤的浏览器端 ESM。三种视图（卡片 / 统计 / 数据库）展示每个角色的技能等级、影画/潜能觉醒、音擎、驱动盘、最终面板数值与达成率。

**零依赖**：`package.json` 无任何 runtime 依赖（devDependencies 仅 eslint/prettier）。Node 18+ 自带 fetch。ESM，`src/lib/` 下的纯模块 Node 与浏览器共用。

## 常用命令

```bash
npm start                    # 启动本地服务器（端口 8718，自动开浏览器）；页面数据来自 /api/data，必须经服务器访问
npm run sync:library         # 抓取米游社 wiki 属性库 → data/library.json + data/raw-library.json
npm run sync:characters      # 用 cookie 拉取账号角色 → data/characters.json（需粘贴 cookie，交互式）
npm test                     # 全部单元测试（node:test）
node --test test/calc.test.js   # 跑单个测试文件
npm run lint                 # ESLint（扁平配置，按文件区分 Node/浏览器全局）
npm run format               # Prettier 格式化
```
> 同步命令默认「结构校验只警告不中断」；命令行可用 `STRICT=1` 前缀（Git Bash）或 `set STRICT=1 && …`（cmd/PowerShell）让校验异常直接中断，网页端同步不受影响。

## 架构总览

### 数据流（理解全项目的主线）

```
抓取脚本 src/sync/  →  写 data/*.json
server.js /api/data →  读 data/*.json →  前端 fetch
同步完成 → 前端 reload → 重新 fetch /api/data
```

- **两个数据源**，靠「去标点归一化」的名字匹配合并：
  1. **wiki 属性库**（`library.json`，无需登录）：角色/音擎/驱动盘/邦布的静态基础数据。
  2. **账号数据**（`characters.json`，需 cookie）：用户真实角色的面板/装备/技能/影画等。
- 账号接口 `api-takumi-record.mihoyo.com` 的 CORS 锁死为 `https://act.mihoyo.com`，浏览器无法直连，所以由本地 `server.js` 代理抓取。**这是所有同步必须经过服务器的根本原因**。

### 分层

- **`src/lib/`（双端共享纯模块，Node 与浏览器均可 import）**
  - `util.js`：纯工具。⚠️ **禁止 import 任何 `node:` 模块**（浏览器直接 import 它）；Node 专属函数放 `node.js`。
  - `schema.js`：数据键名唯一权威定义（`KEYS`）+ 校验（`validateLibrary` / `validateCharacters` / `warnIfInvalid`）。同步脚本写文件前调用校验，**只 warn 不中断**。
  - `calc.js`：计算引擎。纯逻辑无 DOM 依赖，数据经 **`setCalcContext(ctx)` 注入**（浏览器在 `web/main.js`、测试在断言前调用）。含属性常量、副词条成长（`substatGrowthTable`，B 站 wiki 规则）、面板计算（`calculateCharacter`）、达成率。
  - `models.js`：领域模型基类 `Character` / `Wengine` / `Disc`。构造时归一化数据、自动算派生属性（如副词条成长次数 `growth`）、组合关系（角色装备音擎+驱动盘）。浏览器把 wiki 与账号数据都实例化成这些基类。
  - `node.js`：Node 专属（`openBrowser`）。
- **`src/sync/`（可执行脚本，也被 server.js 复用导出函数）**
  - `library.js`：并发池（6 worker）抓 180+ 个 wiki 详情页，解析出 `library.json`，同时把每个 entry_page 原始响应存 `raw-library.json` 快照。解析器对 wiki 页面结构高度脆弱，改动需谨慎。
  - `characters.js`：串行拉取账号角色详情，`extractCharacter()` 做全量提取（面板/装备/技能/影画/皮肤/潜能觉醒/`equipPlan` 等）。含 cookie 缓存（`data/.cookie.json`）。
- **`src/web/`（浏览器端 ESM，无构建）**
  - `main.js`：入口，`fetch('/api/data')` → `setData()` → `setCalcContext(dataCtx)` → `initUi()`。
  - `data.js`：数据层。`export let` 活绑定（live binding），`setData` 重新赋值后各 import 方自动读到新值。维护索引、用户配置（目标/有效词条/行列序/视图）。
  - `render.js`：渲染层。卡片/统计表格视图、悬浮提示（`data-detail` 属性 + 全局 mouseover 委托）、行/列拖拽排序、表头点击排序。**内联 `onclick` 引用的函数必须挂到 `window`**（`ui.js` 里注册 `openNote`/`openTargetSettings`/`openValidStats`）。
  - `wiki.js`：数据库视图，四个子面板，表头排序。子面板切换走 `window.ZZZ.wikiTab()`。
  - `ui.js`：交互层。同步按钮（经服务器）、目标/有效/备注弹窗、事件绑定、同步进度轮询（300ms 查 `/api/sync-progress`）。
- **`server.js`**：无框架 http 服务器。路由：`POST /api/sync-base`、`POST /api/sync-characters`、`GET /api/data`、`/api/config`（读写 `user-config.json`）、`/api/cookie`、`/api/cookie-status`、`/api/sync-progress`。`busy` 互斥锁防止两个同步同时写文件。

### 关键约定与坑

- **属性名归一化**：wiki 页面各角色用词不一（生命/生命力→生命值、攻击→攻击力、防御→防御力；短名 暴击→暴击率、暴伤→暴击伤害；命破角色 贯穿力→穿透率、闪能自动积累/累积/累计→能量自动回复），`util.js` 的 `normalizeStatKey(s)` 统一映射（别名表 `STAT_ALIASES`，新增别名要同步补测试）；`models.js` 构造时对 `maxLevel` 调 `normalizeStatKeys`。改数据读写时注意保持这一约定。
- **名字匹配**：角色/音擎名用 `normalize()`（去 HTML、只留中文数字）在 wiki 与账号两侧匹配；易混淆条目按全名保留 key（`util.js` 的 `buildIndex` / `lookup`）。
- **百分比与固定值**：值 `<= 1` 视为百分比（如 0.3 = 30%），用 `formatValue` 展示；主/副词条用**数组**保存（同一盘可同时有「攻击力%」和「攻击力固定」）。
- **最终面板**：账号接口真实值（`panel`）优先显示；缺失时用「wiki 基础值 + 装备」推算补齐。推算未计 4 件套条件效果/核心被动，与实际可能有出入——这是刻意设计。
- **游戏富文本**：`renderRichText()` 把游戏标记 `<color=#HEX>` 转 `<span style="color">`、字面 `\n` 转 `<br>`，并清除 `<script>` 与 `on*` 属性。所有来自数据的悬浮内容先过 `escapeHtml()` 再放 `data-detail`。
- **有效副词条默认值**：未手动配置时用游戏推荐 `equipPlan.plan_effective_property_list`（`web/data.js` 的 `readValidStats`）；手动保存（含清空）后覆盖默认。
- **测试依赖真实数据文件**：`calc.test.js` / `models.test.js` 直接读 `data/library.json`、`data/characters.json`；`extract.test.js` 读 `data/debug-response.json` 作为提取 fixture。**测试假设这些文件存在且结构合理**。

## 已知说明

- 属性键名统一为 生命值/攻击力/防御力；个别新角色 wiki 无满级行，其面板依赖账号实际值。
- 部分角色接口未返回 `equipPlan`（约 18 个），无游戏推荐默认有效属性，需手动配置。
- 路由统一用 ASCII，避免中文路径被浏览器百分号编码后匹配失败（server.js 注释）。
- eslint 按文件划分全局：`src/web/**`=browser；`server.js`/`src/sync/**`/`src/lib/node.js`/`test/**`=node；`src/lib/util.js`/`schema.js`/`calc.js`=两者。
