# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

个人用的《绝区零》角色配装面板：本地 Node 服务器 + 米游社 wiki/账号数据同步 + 无构建步骤的浏览器端 ESM。三个上级视图：「我的角色」（内部「卡片/统计」二级子页面）、「数据库」、「推荐」（内部「驱动盘/音擎/配队/角色数值」四个子面板）。我的角色展示每个角色的技能等级、影画/潜能觉醒、音擎、驱动盘、最终面板数值与达成率；推荐视图基于推荐方案数据（plans.json）跨角色统计。

**零依赖**：`package.json` 无任何 runtime 依赖（devDependencies 仅 eslint/prettier）。Node 18+ 自带 fetch。ESM，`src/lib/` 下的纯模块 Node 与浏览器共用。

## 常用命令

```bash
npm start                    # 启动本地服务器（端口 8718，自动开浏览器）；页面数据来自 /api/data，必须经服务器访问
npm run sync:library         # 抓取米游社 wiki 属性库 → data/library.json + data/raw-library.json
npm run sync:characters      # 用 cookie 拉取账号角色 → data/characters.json（需粘贴 cookie，交互式）
npm run sync:plans           # 抓取米游社养成指南推荐方案 → data/plans.json
npm test                     # 全部单元测试（node:test；依赖 data/ 数据文件，缺失时提示先更新）
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

- **三个数据源**，靠「去标点归一化」的名字匹配合并：
  1. **wiki 属性库**（`library.json`，无需登录）：角色/音擎/驱动盘/邦布的静态基础数据。
  2. **账号数据**（`characters.json`，需 cookie）：用户真实角色的面板/装备/技能/影画等。
  3. **推荐方案数据**（`plans.json`，`npm run sync:plans`）：每个角色的若干推荐配装方案（驱动盘套装/456 主属性/副词条/面板目标/武器/配队）。
- 账号接口 `api-takumi-record.mihoyo.com` 的 CORS 锁死为 `https://act.mihoyo.com`，浏览器无法直连，所以由本地 `server.js` 代理抓取。**这是所有同步必须经过服务器的根本原因**。

### 推荐方案数据 `data/plans.json`

`src/sync/plans.js` 抓米游社养成指南 → `data/plans.json`（`{ avatarId: { name, plans: [...] } }`，覆盖 57 角色、每角色最多 100 方案）。`extractPlan()`（`plans.js`）把每个方案精简成：

- `sets: [{name, cnt}]` —— 推荐驱动盘套装，cnt 为件数（2 或 4）；2+2+2 / 4+2 组合就是多条同 `name` 的 entry。**驱动盘统计类功能的主数据源**。
- `mainProps: {4,5,6: 属性名}` —— 456 号位推荐主属性（键为字符串，值已用 `mainStatName` 归一化成百分比变体，部分方案缺项）。
- `subStats: [副词条名]` —— 推荐副词条（`攻击力百分比` 已用 `substatKey` 归一化成 `攻击力%`）。
- 其余：`panel`（low/mid/high 三档面板目标，percent 按属性名判定）、`weapon{main,backup}`、`skills[{type,level}]`、`team`（配队全名）、`releasedAt`。

前端消费：`src/web/ui.js` 目标弹窗的方案表渲染与应用流程。套装名与 library 对齐用 `buildIndex`/`lookup` + `normalize`。

### 分层

- **`src/lib/`（双端共享纯模块，Node 与浏览器均可 import）**
  - `constants.js`：固定字符串枚举（属性名 `STAT`/`SUBSTAT`、主/副词条选项、目标字段 `TARGET_KEYS`、456 主词条候选 `MAIN_STAT_OPTIONS`、`mainStatName`、同步类型、视图），各处引用枚举防拼写错误。
  - `util.js`：纯工具。⚠️ **禁止 import 任何 `node:` 模块**（浏览器直接 import 它）；Node 专属函数放 `node.js`。含属性/词条归一（`normalizeStatKey`/`substatName`/`parseNum`）、名字匹配（`normalize`/`buildIndex`/`lookup`）、转义与富文本（`escapeHtml`/`escapeJsAttr`/`renderRichText`/`decodeHtmlEntities`）、展示（`formatValue`）、cookie（`parseCookies`/`serializeCookies`）、排序比较（`compareValues`/`isEmptyVal`）。
  - `sort.js`：表头三态排序（升→降→复位）状态机 `createSort()`（`toggle`/`reset`/`apply`，空值行恒排最后）。wiki/统计表/方案表/驱动盘统计/推荐各表统一走它，表头 ▲/▼ 指示各视图自渲染。
  - `schema.js`：数据键名唯一权威定义（`KEYS`）+ 校验（`validateLibrary` / `validateCharacters` / `validatePlans` / `warnIfInvalid`）。同步脚本写文件前调用校验，**只 warn 不中断**。
  - `calc.js`：计算引擎。纯逻辑无 DOM 依赖，数据经 **`setCalcContext(ctx)` 注入**（浏览器在 `web/main.js`、测试在断言前调用）。含属性常量、副词条成长（`substatGrowthTable`，B 站 wiki 规则）、面板计算（`calculateCharacter`）、达成率（`statProgress`/`resolveStatCurrent`/`targetGap`）。
  - `models.js`：领域模型基类 `Character` / `Wengine` / `Disc`。构造时归一化数据、自动算派生属性（如副词条成长次数 `growth`）、组合关系（角色装备音擎+驱动盘）。浏览器把 wiki 与账号数据都实例化成这些基类。
  - `node.js`：Node 专属（`openBrowser` + 同步脚本样板 `ROOT`/`DATA_DIR`/`isMain`/`writeDataFile`）。
- **`src/sync/`（可执行脚本，也被 server.js 复用导出函数）**
  - `http.js`：米游社接口统一请求 `requestJson`（cookie 序列化 + HTTP/retcode 校验 + 可配置重试 `retry.simple/backoff`）、`fetchUid`、`sleep`，三个脚本共用。
  - `library.js`：并发池（6 worker）抓 180+ 个 wiki 详情页，解析出 `library.json`，同时把每个 entry_page 原始响应存 `raw-library.json` 快照。解析器对 wiki 页面结构高度脆弱，改动需谨慎。角色数据含 `coreSkillBoost`（核心技 A-F 档基础面板提升，如「暴击率提升4.8%」→ `{暴击率:0.144}`；开头锚定 + 属性名白名单过滤「额外/最多/造成的伤害」等，百分比攻击/生命归 `X%` 键；数字档核心被动增强不计入），供 wiki 核心技悬浮展示与 calc 百分比词条基准计入。
  - `characters.js`：串行拉取账号角色详情，`extractCharacter()` 做全量提取（面板/装备/技能/影画/皮肤/潜能觉醒/`equipPlan` 等）。含 cookie 缓存（`data/.cookie.json`）。
  - `plans.js`：抓米游社养成指南推荐方案 → `data/plans.json`（结构见「推荐方案数据」小节）。`extractPlan()` 提取 `sets`/`mainProps`/`subStats`/`panel`/`weapon`/`skills`/`team`。
- **`src/web/`（浏览器端 ESM，无构建）**
  - `main.js`：入口，`fetch('/api/data')` → `setData()` → `setCalcContext(dataCtx)` → `initUi()`。
  - `data.js`：数据层。`export let` 活绑定（live binding），`setData` 重新赋值后各 import 方自动读到新值。维护索引、用户配置（目标/有效词条/行列序/视图）。
  - `util.js`：浏览器端工具（`apiRequest` 带超时 / `postJSON`，供 data/ui 复用）。
  - `shared.js`：浏览器端共享渲染辅助（纯 HTML 字符串，无 DOM/数据层依赖）：驱动盘 2/4 件套悬浮 `discSetEffectsHtml`、富文本条目 `richItemHtml`、技能图标 `skillIcon`/`skillIconForType`、全局注册 `registerZZZ`。
  - `render.js`：渲染层。「我的角色」视图容器（卡片/统计二级子页面：`myTab`/`setMyTab`/`myCharsShell`/`resolveView`，兼容旧 `card`/`table` 视图值）+ 卡片/统计表格渲染、悬浮提示（`data-detail` 属性 + 全局 mouseover 委托）、行/列拖拽排序、表头点击排序。**内联 `onclick` 引用的函数必须挂到 `window`**（`ui.js` 里注册 `openNote`/`openTargetSettings`）。
  - `wiki.js`：数据库视图，四个子面板（角色/音擎/驱动盘/邦布），表头三态排序（升→降→默认）。**新增子面板 = `TABS` + `PANEL_RENDERERS` 各加一项**，渲染函数返回 `table(headers, rows, sortable)` 即自动获得排序、`data-detail` 悬浮、`.wiki-table` 样式。排序统一走 `lib/sort.js` 的 `createSort`（与 `render.js` 统计表、`ui.js` 方案表、`discstats.js` 四处同构）。子面板切换走 `window.ZZZ.wikiTab()`（注册在 `ui.js`）。
  - `ui.js`：交互层。同步按钮（经服务器）、目标/有效/备注弹窗、事件绑定、同步进度轮询（300ms 查 `/api/sync-progress`）。
  - `recommend.js`：「推荐」视图容器，四个子面板（驱动盘/音擎/配队/角色数值），仿 `wiki.js` 的 `TABS` + `PANEL_RENDERERS` 键控分发 + 共享排序（`recSort`/`toggleRecommendSort`）。子面板切换走 `window.ZZZ.recommendTab()`（注册在 `ui.js`）。音擎/配队/角色数值聚合分别在 `src/lib/wengineStats.js`（`computeWengineStats`）/`teamStats.js`（`computeTeamStats`）/`panelRange.js`（`computePanelRanges`，纯函数，可测）。**新增推荐子面板 = 上面 `TABS` + `PANEL_RENDERERS` 各加一项**。
  - `discstats.js`：「推荐」视图的「驱动盘」子面板渲染层。聚合逻辑在 `src/lib/discstats.js` 的 `computeDiscStats(plans, discNames, discSet2)`（纯函数，可测），按驱动盘统计匹配角色 / 副词条频次（三档：≥50% 高亮、<5% 灰色）/ 456 主属性 / 二件套同效果替代（`alternatives`）。表头排序委托在 `render.js`。
- **`server.js`**：无框架 http 服务器。路由：`POST /api/sync-base`、`POST /api/sync-characters`、`GET /api/data`、`/api/config`（读写 `user-config.json`）、`/api/cookie`、`/api/cookie-status`、`/api/sync-progress`。`busy` 互斥锁防止两个同步同时写文件；三个同步 handler 共用 `runSync()` 骨架（busy 锁/进度上报/cookie 解析/错误处理）。

### 关键约定与坑

- **属性名归一化**：wiki 页面各角色用词不一（生命/生命力→生命值、攻击→攻击力、防御→防御力；短名 暴击→暴击率、暴伤→暴击伤害；命破角色 贯穿力→穿透率、闪能自动积累/累积/累计→能量自动回复），`util.js` 的 `normalizeStatKey(s)` 统一映射（别名表 `STAT_ALIASES`，新增别名要同步补测试）；`models.js` 构造时对 `maxLevel` 调 `normalizeStatKeys`。改数据读写时注意保持这一约定。
- **名字匹配**：角色/音擎名用 `normalize()`（去 HTML、只留中文数字）在 wiki 与账号两侧匹配；易混淆条目按全名保留 key（`util.js` 的 `buildIndex` / `lookup`）。
- **百分比与固定值**：值 `<= 1` 视为百分比（如 0.3 = 30%），用 `formatValue` 展示；主/副词条用**数组**保存（同一盘可同时有「攻击力%」和「攻击力固定」）。
- **最终面板**：账号接口真实值（`panel`）优先显示；缺失时用「wiki 基础值 + 装备」推算补齐。推算未计 4 件套条件效果/核心被动，与实际可能有出入——这是刻意设计。
- **游戏富文本**：`renderRichText()` 把游戏标记 `<color=#HEX>` 转 `<span style="color">`、字面 `\n` 转 `<br>`，并清除 `<script>` 与 `on*` 属性。所有来自数据的悬浮内容先过 `escapeHtml()` 再放 `data-detail`。
- **有效副词条默认值**：未手动配置时用游戏推荐 `equipPlan.plan_effective_property_list`（`web/data.js` 的 `readValidStats`）；手动保存（含清空）后覆盖默认。
- **测试依赖真实数据文件**：`data/` 不入版本库，测试通过 `test/helpers.js` 的 `loadDataFile()` 读取；数据缺失/损坏时打印「请先更新数据」提示并正常结束（`node --test` 每文件独立子进程，`process.exit(0)` 不影响其他文件）。`extract.test.js` 用 `raw-library.json` 做数据就绪检查，提取逻辑用内联账号响应 fixture。**新增测试文件记得加进 package.json 的 test 脚本**（Node 20 的 `--test` 不支持 glob，且会把 `test/` 下所有 JS 当测试文件）。驱动盘套装统计类逻辑可仿 `test/calc.test.js` 的「2 件套需同套装 ≥2 件才生效」测试：内联假盘 `{set, slot, mainStats, subStats}` 构造 + 顶层 `setCalcContext` 注入上下文。

## 已知说明

- 属性键名统一为 生命值/攻击力/防御力；个别新角色 wiki 无满级行，其面板依赖账号实际值。
- 部分角色接口未返回 `equipPlan`（约 18 个），无游戏推荐默认有效属性，需手动配置。
- 推荐套装与 456 主属性**不在**账号数据的 `equipPlan` 里——`equipPlan`（`a.equip_plan_info` 原样存储）只含有效副词条 `plan_effective_property_list`（消费见 `web/data.js` 的 `readValidStats`：`full_name` 含「百分比」则 `name+'%'`，再过 `SUBSTAT_TYPE_SET`）。推荐套装/主属性在 `plans.json`。
- `library.json` 的 `discs` 区**键即套装名**（条目内 `name === key`），套装:条目 = **1:1**（一个套装 = 一条目，6 个槽位收在 `slotMainStats`，不是每块盘一条）；`set4` 恒为 `null`（四件套只有 `set4Text` HTML，无结构化数值），仅 `set2` 被解析成 `{属性: 数值}`。账号侧每块盘 `set` = `e.equip_suit?.name` + `slot`(1-6)，空槽补 `未佩戴驱动盘`。
- 路由统一用 ASCII，避免中文路径被浏览器百分号编码后匹配失败（server.js 注释）。
- eslint 按文件划分全局：`src/web/**`=browser；`server.js`/`src/sync/**`/`src/lib/node.js`/`test/**`=node；`src/lib/util.js`/`schema.js`/`calc.js`=两者（`sort.js` 纯逻辑无全局，落在基础块）。
