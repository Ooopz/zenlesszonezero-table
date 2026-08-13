# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

个人用的《绝区零》角色配装面板：本地 Node 服务器 + 米游社 wiki/账号数据同步 + 无构建步骤的浏览器端 ESM。

三个上级视图：
- **「我的角色」**：内部「卡片/汇总」二级子页面，展示每个角色的技能等级、影画/潜能觉醒、音擎、驱动盘、最终面板数值与达成率。
- **「数据库」**：wiki 属性库（角色/音擎/驱动盘/邦布）。
- **「统计」**：内部「角色面板/角色配装/驱动盘/角色配队/角色总览」五个子面板，基于推荐方案数据（plans.json）与工坊配装数据（workshop-grad.json / workshop-stats.json）跨角色统计。

**零依赖**：`package.json` 无任何 runtime 依赖（devDependencies 仅 eslint/prettier）。Node 18+ 自带 fetch。ESM，`src/lib/` 下的纯模块 Node 与浏览器共用。

## 常用命令

```bash
npm start                    # 启动本地服务器（端口 8718，自动开浏览器）；页面数据来自 /api/data，必须经服务器访问
npm run sync:library         # 抓取米游社 wiki 属性库 → data/library.json + data/raw-library.json
npm run sync:characters      # 用 cookie 拉取账号角色 → data/characters.json（需粘贴 cookie，交互式）
npm run sync:plans           # 抓取米游社养成指南推荐方案 → data/plans.json
node src/sync/workshop.js            # 全量爬取工坊配装（workshop.json + workshop-grad.json + workshop-stats.json，一步更新）
npm run migrate:names        # 就地迁移现有 data/*.json 的名称为 library 标准名（纯本地改名，幂等；加 --dry-run 只预览）
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

- **四个数据源**，靠统一名称解析（`src/lib/names.js`，以 `library.json` 为标准名权威源）匹配合并；同步脚本写时已把名称固化到 library 标准名，消费端按标准名精确匹配、resolver 兜底旧数据：
  1. **wiki 属性库**（`library.json`，无需登录）：角色/音擎/驱动盘/邦布的静态基础数据。
  2. **账号数据**（`characters.json`，需 cookie）：用户真实角色的面板/装备/技能/影画等。
  3. **推荐方案数据**（`plans.json`，`npm run sync:plans`）：每个角色的若干推荐配装方案（驱动盘套装/456 主属性/副词条/面板目标/武器/配队）。
  4. **工坊配装数据**（`workshop.json` / `workshop-grad.json` / `workshop-stats.json`，`node src/sync/workshop.js`）：绝区零工坊（`api.zzzmap.com`）的全角色玩家配装实例（workshop.json）+ 全服配装统计（workshop-grad.json）+ 基于前100样本的聚合统计（workshop-stats.json，供统计视图图表面板作玩家样本对标）。三者结构与口径见「已知说明」。
- 账号接口 `api-takumi-record.mihoyo.com` 的 CORS 锁死为 `https://act.mihoyo.com`，浏览器无法直连，所以由本地 `server.js` 代理抓取。**这是所有同步必须经过服务器的根本原因**。

### 推荐方案数据 `data/plans.json`

`src/sync/plans.js` 抓米游社养成指南 → `data/plans.json`（`{ avatarId: { name, plans: [...] } }`，覆盖 57 角色、每角色最多 100 方案）。`extractPlan()`（`plans.js`）把每个方案精简成：

- `sets: [{name, cnt}]` —— 推荐驱动盘套装，cnt 为件数（2 或 4）；2+2+2 / 4+2 组合就是多条同 `name` 的 entry。**驱动盘统计类功能的主数据源**。
- `mainProps: {4,5,6: 属性名}` —— 456 号位推荐主属性（键为字符串，值已用 `mainStatName` 归一化成百分比变体，部分方案缺项）。
- `subStats: [副词条名]` —— 推荐副词条（`攻击力百分比` 已用 `substatKey` 归一化成 `攻击力%`）。
- 其余：`panel`（low/mid/high 三档面板目标，percent 按属性名判定）、`weapon{main,backup}`、`skills[{type,level}]`、`team`（配队全名）、`releasedAt`。

前端消费：`src/web/ui.js` 目标弹窗的方案表渲染与应用流程。套装名/音擎名/角色名与 library 对齐统一走 `src/lib/names.js` 的 `resolveEntry`（`buildNameIndex` 建索引）。

### 分层

- **`src/lib/`（双端共享纯模块，Node 与浏览器均可 import）**
  - `constants.js`：固定字符串枚举（属性名 `STAT`/`SUBSTAT`、主/副词条选项、目标字段 `TARGET_KEYS`、456 主词条候选 `MAIN_STAT_OPTIONS`、`mainStatName`、同步类型、视图），各处引用枚举防拼写错误。
  - `util.js`：纯工具。⚠️ **禁止 import 任何 `node:` 模块**（浏览器直接 import 它）；Node 专属函数放 `node.js`。含属性/词条归一（`normalizeStatKey`/`normalizeStatKeys`/`substatName`/`parseNum`）、归一化键（`normalize`/`romanNumeralUnicode`/`normalizeRomanKey`）、转义与富文本（`escapeHtml`/`escapeJsAttr`/`renderRichText`/`decodeHtmlEntities`）、展示（`formatValue`）、cookie（`parseCookies`/`serializeCookies`）、排序比较（`compareValues`/`isEmptyVal`）。`buildIndex`/`lookup` 保留为通用工具，业务名称解析已收敛到 `names.js`。
  - `names.js`：**统一名称解析**（双端共用，禁 import node:）。`library.json` 为标准名权威源；`buildNameIndex(names, category)` 建索引，`resolveName(category, index, name)` 按「精确→别名→归一化键→子串(char 专属)」解析，`resolveEntry`/`canonicalName` 为便捷入口。别名表 `ALIASES` 按类别组织（角色：维琳娜→维琳娜·艾嘉德、星徽·比利→星徽·比利·奇德、提/缇、11号→「11号」；盘：荆棘玫瑰→棘刺玫瑰）；wengine 用 `normalizeRomanKey` 防 Ⅰ/Ⅱ/Ⅲ 碰撞。同步脚本写时固化、消费端统一解析都走这里。新增数据源/新变体只需在 `ALIASES` 或归一化键加一条。
  - `sort.js`：表头三态排序（升→降→复位）状态机 `createSort()`（`toggle`/`reset`/`apply`，空值行恒排最后）。wiki/汇总表/方案表/驱动盘统计/统计视图各表统一走它，表头 ▲/▼ 指示各视图自渲染。
  - `schema.js`：数据键名唯一权威定义（`KEYS`）+ 校验（`validateLibrary` / `validateCharacters` / `validatePlans` / `warnIfInvalid`）。同步脚本写文件前调用校验，**只 warn 不中断**。
  - `calc.js`：计算引擎。纯逻辑无 DOM 依赖，数据经 **`setCalcContext(ctx)` 注入**（浏览器在 `web/main.js`、测试在断言前调用）。含属性常量、副词条成长（`substatGrowthTable`，B 站 wiki 规则）、面板计算（`calculateCharacter`）、达成率（`statProgress`/`resolveStatCurrent`/`targetGap`）。
  - `models.js`：领域模型基类 `Character` / `Wengine` / `Disc`。构造时归一化数据、自动算派生属性（如副词条成长次数 `growth`）、组合关系（角色装备音擎+驱动盘）。浏览器把 wiki 与账号数据都实例化成这些基类。`Disc` 保留 `roundIcon`（圆形光盘图标，卡片/汇总视图驱动盘用）。
  - `workshopStats.js`：工坊配装数据（`workshop.json` entries）汇总纯函数 `computeWorkshopStats`（音擎/驱动盘按配装条目数聚合、角色面板真实样本统计 `computeDist`：count/min/max/range/mean/median/sd/IQR/p10-p99/skew/kurt，百分比统一归一化为小数）+ `computePanelCorrelations`（属性相关，按角色、同条目配对皮尔逊）+ **`computeWorkshopDiscStats`（驱动盘单盘真实统计：物理盘数/使用角色/456 主词条分布/副词条频率 + 有效词条数分布 `effDist`/副词条组合 Top `subCombos`/主词条×副词条协同 `mainSubCross`，供「统计→驱动盘」面板「工坊真实」列）** + `discStatName`（workshop 词条名 → plans/constants 统一名，兼容 2025/mys 两源）+ **`computePanelScatter`（面板属性对 2D 密度网格：暴击率×暴伤、攻击×暴伤，perRole/global 两粒度，供密度散点图）**。`src/sync/workshop.js` 汇总生成（含 panelCorr/panelScatter）与统计视图图表面板共用。
  - `gradStats.js`：`workshop-grad.json`（全服真实占比）聚合纯函数 `computeGradStats`（音擎/单盘套装/套装组合跨角色累加 count 与占比）。「驱动盘」面板（web/discstats.js）消费其 `discs` 作「全服使用」对比列；`wengines` 部分因「音擎」面板已移除不再被统计视图消费（保留模块与测试）。与 `workshopStats.js`（基于前100爬取的真实样本统计）口径不同。
  - `discstats.js`：驱动盘推荐统计纯函数 `computeDiscStats(plans, discNames, discSet2)`——推荐该盘（2/4 件套）的角色、副词条频次、456 主属性、二件套同效果替代（`alternatives`）。「统计」视图「驱动盘」面板聚合层（渲染在 `web/discstats.js`）。
  - `plansStats.js`：方案推荐侧每角色 Top 音擎/套装组合 `computeRoleBuildsFromPlans`（结构与 workshop-grad 一致，供「工坊配装」面板对比）+ `orderComboSets4First`（套装组合名 4 件套在前排序归一，工坊/方案两源组合文本一致）。
  - `teamStats.js`：配队推荐统计纯函数 `computeTeamStats`（plans → 每角色被组队次数/自身方案数，名称解析走 names.js）。「统计」视图「配队」面板共用。
  - `panelBench.js`：面板对标三源合并纯函数 `traitKeyStats`（特性→关键属性模板）+ `computeRecHighStats`（推荐 high 档毕业值聚合）+ `computeRecTierStats`（推荐三档 low/mid/high 的 mean/median/sd/cv，过滤 low=mid=0 占位属性）+ `buildPanelBenchmark`（推荐 high 档 / 玩家真实样本 / 我的 final 合并为每角色全部属性）。统计视图「角色数值」与图表面板共用。
  - `panelRange.js`：角色面板区间纯函数（按 normalize 聚合方案 panel 三档区间，取中位）。当前未被 web 引用，仅测试用。
  - `distStats.js`：分布统计纯函数（`quantile`/`median`/`sd`/`skew`/`kurt`/`pearson`/`computeDist`/`computePowerScore` 综合战力/`computeRatio`/`computeBalance`/`kmeans`/`tierFit` 档位匹配）。workshopStats 聚合与统计视图图表共用。
  - `node.js`：Node 专属（`openBrowser` + 同步脚本样板 `ROOT`/`DATA_DIR`/`isMain`/`writeDataFile`）。
- **`src/sync/`（可执行脚本，也被 server.js 复用导出函数）**
  - `http.js`：米游社接口统一请求 `requestJson`（cookie 序列化 + HTTP/retcode 校验 + 可配置重试 `retry.simple/backoff`）、`fetchUid`、`sleep`，三个脚本共用。
  - `library.js`：并发池（6 worker）抓 180+ 个 wiki 详情页，解析出 `library.json`，同时把每个 entry_page 原始响应存 `raw-library.json` 快照。解析器对 wiki 页面结构高度脆弱，改动需谨慎。角色数据含 `coreSkillBoost`（核心技 A-F 档基础面板提升，如「暴击率提升4.8%」→ `{暴击率:0.144}`；开头锚定 + 属性名白名单过滤「额外/最多/造成的伤害」等，百分比攻击/生命归 `X%` 键；数字档核心被动增强不计入），供 wiki 核心技悬浮展示与 calc 百分比词条基准计入。
  - `characters.js`：串行拉取账号角色详情，`extractCharacter()` 做全量提取（面板/装备/技能/影画/皮肤/潜能觉醒/`equipPlan` 等）。含 cookie 缓存（`data/.cookie.json`）。写边界 `normalizeCharacterOutput` 对音擎名/驱动盘名做 library 标准名归一（占位名保留；`extractCharacter` 保持纯函数）。
  - `plans.js`：抓米游社养成指南推荐方案 → `data/plans.json`（结构见「推荐方案数据」小节）。`extractPlan()` 提取 `sets`/`mainProps`/`subStats`/`panel`/`weapon`/`skills`/`team`。写边界 `normalizePlansOutput` 对角色/音擎/套装/配队名做 library 标准名归一（需先有 library.json，缺失时降级不归一）。
  - `workshop.js`：工坊数据统一脚本（原 workshop.js/grad/panel/stats 合并）。签名协议（MD5(key+参数排序)）+ 并发池 + 全量配装爬取（`fetchWorkshopData`，同时生成 workshop.json / workshop-grad.json / workshop-stats.json）+ 2025 源面板计算（复现工坊 `enka_attrs_mapping`：角色基础/武器/装备成长公式）。`extractBuild` 提取兼容 mys 源（面板现成）与 2025 源（面板按公式计算，mys 判定要求实际数据非空，避免 2025 源带空 properties 误走 mys 返回空面板）。依赖 `workshop-static.json`（逆向提取的角色基础/武器/装备/套装静态表）。**写时统一把 nick_name（角色简称/ASCII 罗马数字/括号差异）与套装名解析为 wiki 标准名**（`resolveEntry`/`canonicalName`，角色名开 fuzzy）。`buildWorkshopStats` 重算汇总时同时写属性相关 `panelCorr`（`computePanelCorrelations`）。导出 `apiGet`/`apiPost`/`pool`/`extractBuild`/`fetchWorkshopData`/`fetchWorkshopGrad` 供 server 复用。
  - `normalize-names.js`：**就地名称迁移**（`npm run migrate:names`，`--dry-run` 只预览）。纯变换函数 `migrateLibrary`/`migrateWorkshopEntries`/`migrateGradRoles`/`migrateCharacters`/`migratePlans` 把现有 data/*.json 的名称固化为 library 标准名（幂等；workshop.json 原子写、workshop-stats.json 由迁移后 entries 重算并保留 meta.scrapedAt）。`library.json` 缺失时拒绝执行。
- **`src/web/`（浏览器端 ESM，无构建）**
  - `main.js`：入口，`fetch('/api/data')` → `setData()` → `setCalcContext(dataCtx)` → `initUi()`。
  - `data.js`：数据层。`export let` 活绑定（live binding），`setData` 重新赋值后各 import 方自动读到新值。维护索引、用户配置（目标/有效词条/行列序/视图）。
  - `util.js`：浏览器端工具（`apiRequest` 带超时 / `postJSON`，供 data/ui 复用）。
  - `shared.js`：浏览器端共享渲染辅助（纯 HTML 字符串，无 DOM/数据层依赖）：驱动盘 2/4 件套悬浮 `discSetEffectsHtml`、富文本条目 `richItemHtml`、技能图标 `skillIcon`/`skillIconForType`、全局注册 `registerZZZ`。
  - `render.js`：渲染层。「我的角色」视图容器（卡片/汇总二级子页面：`myTab`/`setMyTab`/`myCharsShell`/`resolveView`，兼容旧 `card`/`table` 视图值）+ 卡片/汇总表格渲染、悬浮提示（`data-detail` 属性 + 全局 mouseover 委托）、行/列拖拽排序、表头点击排序。驱动盘图标优先用圆形光盘（`Disc.roundIcon`，wiki 提取，fallback 账号 icon / library icon）。**内联 `onclick` 引用的函数必须挂到 `window`**（`ui.js` 里注册 `openNote`/`openTargetSettings`）。
  - `wiki.js`：数据库视图，四个子面板（角色/音擎/驱动盘/邦布），表头三态排序（升→降→默认）。**新增子面板 = `TABS` + `PANEL_RENDERERS` 各加一项**，渲染函数返回 `table(headers, rows, sortable)` 即自动获得排序、`data-detail` 悬浮、`.wiki-table` 样式。排序统一走 `lib/sort.js` 的 `createSort`（与 `render.js` 统计表、`ui.js` 方案表、`discstats.js` 四处同构）。子面板切换走 `window.ZZZ.wikiTab()`（注册在 `ui.js`）。
  - `ui.js`：交互层。同步按钮（经服务器）、目标/有效/备注弹窗、事件绑定、同步进度轮询（300ms 查 `/api/sync-progress`）。
  - `charts.js`：ECharts 图表辅助（依赖 index.html 引入的本地 vendor `src/vendor/echarts.min.js`，`window.echarts`）。主题色 `CHART_COLORS`（匹配项目暗色+金色）、`registerChart`/`clearCharts`/`mountCharts`/`chartBox` 渲染挂载机制 + 各图表 option 构建函数（棒棒糖/热力/散点/小提琴箱线/雷达/仪表盘/山脊/档位/CDF/双轴/**`densityScatterOption`（2D 密度散点：消费 `computePanelScatter` 密度网格，visualMap 按样本量上色）**/**`tierRangeOption`（推荐三档横向条：低配/毕业/高配 median + 我的值）**）。视觉统一项目主题。
  - `recommend.js`：「统计」视图容器，五个子面板（角色面板/角色配装/驱动盘/角色配队/角色总览），仿 `wiki.js` 的 `TABS` + `PANEL_RENDERERS` 键控分发 + 共享排序（`recSort`/`toggleRecommendSort`）。子面板切换走 `window.ZZZ.recommendTab()`（注册在 `ui.js`）。配队聚合在 `src/lib/teamStats.js`（`computeTeamStats`，纯函数，可测）；「角色配装」为工坊实况 vs 方案推荐对比——`plansStats.computeRoleBuildsFromPlans` 生成方案侧 Top 音擎/套装（组合名经 `orderComboSets4First` 归一 4 件套在前），与 workshop-grad 实况并排 + 差异分析；「角色总览」（达标热力图 + 各属性共识度散点）与「角色面板」（小提琴箱线 + 分布形态 + 推荐三档目标横向条 + 面板属性对密度散点，角色下拉走 `ZZZ.selectRole`）为 ECharts 图表面板，render 后由 `mountRecommendCharts` 挂载（render.js 调用）。**新增统计子面板 = 上面 `TABS` + `PANEL_RENDERERS` 各加一项**。
  - `discstats.js`：「统计」视图的「驱动盘」子面板渲染层（`renderDiscStats`/`resetDiscStatsSort`）。三口径并列：方案推荐（`lib/discstats.js` `computeDiscStats`）+ 全服使用（`gradStats.computeGradStats`）+ 工坊盘数/工坊真实副词条与 456 主词条（`workshopStats.discDetails`）。副词条/456 单元格内上下两行（上=方案推荐、下=工坊真实），456 候选里方案/工坊都没出现的主词条用灰色删除线标「未用主词条」；副词条单元格下加「有效词条数分布」小字，工坊行/456 行悬浮看「工坊词条组合 Top」与「主词条×副词条协同」。表头排序委托在 `render.js`。
- **`server.js`**：无框架 http 服务器。路由：`POST /api/sync-base`、`POST /api/sync-characters`、`GET /api/data`、`/api/config`（读写 `user-config.json`）、`/api/cookie`、`/api/cookie-status`、`/api/sync-progress`。`busy` 互斥锁防止两个同步同时写文件；三个同步 handler 共用 `runSync()` 骨架（busy 锁/进度上报/cookie 解析/错误处理）。

### 关键约定与坑

- **属性名归一化**：wiki 页面各角色用词不一（生命/生命力→生命值、攻击→攻击力、防御→防御力；短名 暴击→暴击率、暴伤→暴击伤害；命破角色 贯穿力→穿透率、闪能自动积累/累积/累计→能量自动回复），`util.js` 的 `normalizeStatKey(s)` 统一映射（别名表 `STAT_ALIASES`，新增别名要同步补测试）；`models.js` 构造时对 `maxLevel` 调 `normalizeStatKeys`。改数据读写时注意保持这一约定。
- **图片资源：永远不要用工坊（`api.zzzmap.com`）的图片资源**。所有图片一律用官方 wiki（米游社 `act-upload.mihoyo.com` 等）数据源的图片，本地化到 `data/img/` 后使用。工坊图片仅用于参考定位接口/字段，禁止直接引用其图片 URL 或写入数据。
- **工坊 API**：`api.zzzmap.com` 请求需签名 `MD5(排序后的 "k=v&k=v" 串)`，固定 key `VW^)(^*^$$#*%(#)!@VIAI%`（`src/sync/workshop.js` 的 `makeSign`）；无需 token，签名通过即可访问。响应仅部分接口加密（AES-256-ECB，key `49A048E375E13EE68C35C0EDB2115F4F`）。爬取一律 6 并发（`pool`），**不要加串行限速**。
- **2025 源面板**：工坊 `user_role/v3` 返回两种玩家数据源——mys（工坊格式化，面板现成）与 2025（游戏内嵌原始数据，面板需按公式计算）。`workshop.js` 复现工坊 `enka_attrs_mapping`：角色基础（BaseProps + GrowthProps×(等级-1)/10000 + 突破档 + 核心强化档）、武器（MainStat×(1+0.1568×等级+0.8922×突破) + Secondary×(1+0.3×突破)）、驱动盘（主属性×等级成长系数 + 副属性×词条等级）、套装 2 件套加成（≥2 件），输出与 mys 源一致的 `panel`（`base/add/final`，百分比为小数）。
- **工坊静态表**：`src/sync/workshop-static.json` 是逆向提取的静态数据（角色基础/武器/装备/套装），`workshop.js` 加载用；游戏数据更新后需重新提取。
- **名字匹配**：统一走 `src/lib/names.js` 的 resolver（`buildNameIndex` + `resolveName`/`resolveEntry`），以 `library.json` 为标准名权威源；别名/罗马数字/括号/空白/简称差异（工坊 nick_name、养成指南 荆棘玫瑰、配队空格等）在**同步写时**已固化到标准名（workshop.js / plans.js / characters.js 写前归一），消费端精确匹配为主、resolver 兜底旧数据。`data/` 已有旧名可跑 `npm run migrate:names` 就地迁移（幂等）。`util.js` 的 `buildIndex`/`lookup` 为通用底层，业务代码不再直接依赖。
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
- eslint 按文件划分全局：`src/web/**`=browser；`server.js`/`src/sync/**`/`src/lib/node.js`/`test/**`=node；`src/lib/util.js`/`schema.js`/`calc.js`=两者；`src/lib/` 其余纯逻辑模块（sort/workshopStats/gradStats/discstats/plansStats/teamStats/panelBench/panelRange/distStats/names）无全局，落在基础块。`eslint.config.js` ignores 含 `src/vendor/**`（本地 ECharts 压缩包）。
- 工坊配装数据：`data/workshop.json`（全角色玩家配装实例，音擎/驱动盘/面板齐全）、`data/workshop-grad.json`（每角色最常用音擎/驱动盘套装）、`data/workshop-stats.json`（音擎/驱动盘按配装条目数、面板真实样本统计：分位 p10-p99/离散 sd、IQR/形态 skew、kurt + 属性相关 `panelCorr` + **驱动盘单盘真实统计 `discDetails`**：每盘物理盘数/使用角色/456 主词条分布/副词条频率 + 有效词条数 `effDist`/组合 Top `subCombos`/主词条×副词条 `mainSubCross`，供「统计→驱动盘」面板工坊真实列 + **面板属性对 2D 密度 `panelScatter`**（暴击率×暴伤、攻击×暴伤，perRole/global，供密度散点图））。三者由 `node src/sync/workshop.js` 一步同步生成（`discDetails`/`panelScatter` 亦可由 `npm run migrate:names` 重算）；server「更新工坊配装」调 `fetchWorkshopData` 同样一步更新。**口径：workshop-grad 是全服真实累计占比（工坊 `grad_stat` 接口）；workshop-stats 基于 workshop.json（各影画档全服前100爬取）聚合，画像按玩家真实样本统计 min/max/mean/median，不当作全服分布。**
- 驱动盘圆形图标：`library.discs[name].roundIcon`（wiki 从驱动盘页 modules 提取——出现次数最多的图片即圆形光盘，6 个尺寸变体），「我的角色」卡片/汇总视图优先使用；`icon` 为方形套装图。
