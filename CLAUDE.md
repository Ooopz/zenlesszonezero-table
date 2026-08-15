# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本文档是唯一权威项目文档（2026-10 整合自 README.md / docs/*.md，原文件已删除，git 历史可恢复）。

## 项目概览

个人用的《绝区零》角色配装面板：本地 Node 服务器 + 米游社 wiki/账号数据同步 + 无构建步骤的浏览器端 ESM。

三个上级视图：
- **「我的角色」**：内部「卡片/汇总」二级子页面，展示每个角色的技能等级、影画/潜能觉醒、音擎、驱动盘、最终面板数值与达成率（实际值为主，推算补齐）。
- **「数据库」**：wiki 属性库（角色/音擎/驱动盘/邦布），表头三态排序、悬浮完整说明。
- **「统计」**：内部「角色面板/驱动盘/全服总览」三个子面板，基于推荐方案数据（plans.json）与工坊配装数据（workshop-grad.json / workshop-stats.json）跨角色统计。

**零依赖**：`package.json` 无任何 runtime 依赖（devDependencies 仅 eslint/prettier）。Node 18+ 自带 fetch。ESM，`src/lib/` 下的纯模块 Node 与浏览器共用。

## 常用命令

```bash
npm start                    # 启动本地服务器（端口 8718，自动开浏览器）；页面数据来自 /api/data，必须经服务器访问
npm run sync:library         # 抓取米游社 wiki 属性库 → data/library.json + data/raw-library.json
npm run sync:characters      # 用 cookie 拉取账号角色 → data/characters.json（需粘贴 cookie，交互式）
npm run sync:plans           # 抓取米游社养成指南推荐方案 → data/plans.json
node src/sync/workshop.js            # 全量爬取工坊配装（workshop.json + workshop-grad.json + workshop-stats.json + workshop-weights.json，一步更新）
node src/sync/workshop.js 57 300 6 http://127.0.0.1:7890   # 第 5 参 = 代理 URL（IP 被封时换 IP；也可用 HTTPS_PROXY/ALL_PROXY 环境变量，见 src/sync/proxy.js）
node scripts-rebuild-stats.mjs       # 只重算 workshop-stats.json（不爬配装；尝试重跑 grad 57 角色，风控失败则用现有 grad）——改聚合后用它验证
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
  1. **wiki 属性库**（`library.json`，无需登录）：角色/音擎/驱动盘/邦布的静态基础数据（含核心技 A-F 档提升、驱动盘圆形图标）。
  2. **账号数据**（`characters.json`，需 cookie）：用户真实角色的面板/装备/技能/影画/潜能觉醒/皮肤/`equipPlan`（游戏推荐有效属性）。
  3. **推荐方案数据**（`plans.json`，`npm run sync:plans`）：每个角色的若干推荐配装方案（驱动盘套装/456 主属性/副词条/面板目标/武器/配队）。
  4. **工坊配装数据**（`workshop.json` / `workshop-grad.json` / `workshop-stats.json` / `workshop-weights.json`，`node src/sync/workshop.js`）：绝区零工坊（`api.zzzmap.com`）全量配装实例 + 全服配装统计 + 基于排行榜全量样本的聚合统计 + 角色默认流派权重。
- 账号接口 `api-takumi-record.mihoyo.com` 的 CORS 锁死为 `https://act.mihoyo.com`，浏览器无法直连，所以由本地 `server.js` 代理抓取。**这是所有同步必须经过服务器的根本原因**。

### 工坊数据口径（重要）

- **样本定义（2026-08 起）**：按「角色 × 影画档位（0-6）」取排行榜**全量**（每档 ≈300 去重 uid）的 uid，再抓这些 uid 的**全部角色**——玩家池 = 每个角色练度排行的上榜者，是**「高练度标杆池」**（比全服平均更强、更有对标指导意义，UI 各处标注口径）。uid 扩展其他路径已实测不可行（weapon_id/part_index 为榜单子集、type 变体空、uid 自增扫描命中率极低易风控）。
- **workshop-grad.json**：`grad_stat` 接口的全服累计占比（不受爬取口径影响），每角色 Top 音擎/套装组合。当前 57 角色。
- **workshop-stats.json**：基于 workshop.json（上榜 uid 池）聚合：`panels`（每角色面板真实样本统计：count/min/max/mean/median/sd/IQR/p10-p99/skew/kurt/whisker/outliers/hist）、`wengines`/`discs`（按配装条目数）、`panelCorr`（属性相关，**7 对**：攻击-防御/攻击-生命/防御-生命/暴击率-暴伤/攻击-暴伤/攻击-暴击率/异常精通-异常掌控）、`panelScatter`（暴击率×暴伤、攻击×暴伤 2D 密度，perRole/global）、`discDetails`（30 盘单盘统计）、`relicStats`/`rankLayers`/`rankDist`/`skillStats`/`roleDiscStats`（练度指标）、**2026-10 新增**：`roleCooccurrence`（同 uid 同练角色共现 → 真实配队亲和）、`completeness`（音擎60/盘满级/评分≥P75 占比）、`rankRelic`（每角色×影画档评分 count/mean/median）、`skillCombos`（每角色技能拉满组合模式 Top + 全拉满率，拉满 = 普攻/闪避/支援/特殊/终结 ≥12、核心 =7）、`weightJson`（工坊权重）。**口径：画像按玩家真实样本统计，不当作全服分布**。
- **浏览器端只加载 workshop-stats.json（≤2 MB）**；一切新聚合在同步脚本完成（流式遍历 358k+ 条，一次 ~2-4 分钟）。

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
  - `names.js`：**统一名称解析**（双端共用，禁 import node:）。`library.json` 为标准名权威源；`buildNameIndex(names, category)` 建索引，`resolveName(category, index, name)` 按「精确→别名→归一化键→子串(char 专属)」解析，`resolveEntry`/`canonicalName` 为便捷入口。别名表 `ALIASES` 按类别组织（角色：维琳娜→维琳娜·艾嘉德、星徽·比利→星徽·比利·奇德、提/缇、11号→「11号」；盘：棘刺玫瑰→荆棘玫瑰（wiki 2026-10 改名，旧名兼容历史数据））；wengine 用 `normalizeRomanKey` 防 Ⅰ/Ⅱ/Ⅲ 碰撞。同步脚本写时固化、消费端统一解析都走这里。新增数据源/新变体只需在 `ALIASES` 或归一化键加一条。
  - `sort.js`：表头三态排序（升→降→复位）状态机 `createSort()`（`toggle`/`reset`/`apply`，空值行恒排最后）。wiki/汇总表/方案表/驱动盘统计/统计视图各表统一走它，表头 ▲/▼ 指示各视图自渲染。
  - `schema.js`：数据键名唯一权威定义（`KEYS`）+ 校验（`validateLibrary` / `validateCharacters` / `validatePlans` / `warnIfInvalid`）。同步脚本写文件前调用校验，**只 warn 不中断**。
  - `calc.js`：计算引擎。纯逻辑无 DOM 依赖，数据经 **`setCalcContext(ctx)` 注入**（浏览器在 `web/main.js`、测试在断言前调用）。含属性常量、副词条成长（`substatGrowthTable`，B 站 wiki 规则）、面板计算（`calculateCharacter`，返回 `{base, bonus, final, actual, theoretical, sources}`——sources 为每属性加成来源明细，汇总表属性格悬浮「计算详情」消费）、达成率（`statProgress`/`resolveStatCurrent`/`targetGap`）。
  - `models.js`：领域模型基类 `Character` / `Wengine` / `Disc`。构造时归一化数据、自动算派生属性（如副词条成长次数 `growth`）、组合关系（角色装备音擎+驱动盘）。浏览器把 wiki 与账号数据都实例化成这些基类。`Disc` 保留 `roundIcon`（圆形光盘图标，卡片/汇总视图驱动盘用）。
  - `workshopStats.js`：工坊配装数据（`workshop.json` entries）汇总纯函数 `computeWorkshopStats`（音擎/驱动盘按配装条目数聚合、角色面板真实样本统计 `computeDist`：count/min/max/range/mean/median/sd/IQR/p10-p99/skew/kurt + whisker/outliers/hist，百分比统一归一化为小数）+ `computePanelCorrelations`（属性相关，按角色、同条目配对皮尔逊，默认 7 对）+ **`computeWorkshopDiscStats`（驱动盘单盘真实统计：物理盘数/使用角色/456 主词条分布/副词条频率 + 有效词条数分布 `effDist`/副词条组合 Top `subCombos`/主词条×副词条协同 `mainSubCross`，供「统计→驱动盘」决策卡的实况口径）** + `discStatName`（workshop 词条名 → plans/constants 统一名，兼容 2025/mys 两源）+ **`computePanelScatter`（面板属性对 2D 密度网格：暴击率×暴伤、攻击×暴伤，perRole/global 两粒度，供密度散点图）** + **练度指标聚合**：`computeRelicStats`（每角色工坊评分分布，含 hist）、`computeRankLayers`（每角色×影画档关键属性轻量分布，**当前无前端消费，保留**）、`computeRankDist`（每角色 0-6 影占比）、`computeSkillStats`（每角色×技能类型等级分布）、`computeRoleDiscStats`（每角色 456/副词条/有效词条画像）+ **2026-10 新增**：`computeRoleCooccurrence`（同 uid 同练角色共现）、`computeCompleteness`（音擎60/盘满级/评分≥P75 占比，字段缺失不计入分母）、`computeRankRelic`（每角色×影画档评分 count/mean/median）、`computeSkillComboStats`（技能拉满组合模式，源判别同 computeSkillStats）、导出 `bin2D`。`src/sync/workshop.js` 汇总生成与统计视图图表面板共用。
  - `gradStats.js`：`workshop-grad.json`（全服真实占比）聚合纯函数 `computeGradStats`（音擎/单盘套装/套装组合跨角色累加 count 与占比）。「角色配装」对标卡片消费其单角色行（web/recommend.js）；`wengines`/`discs` 跨角色部分不再被统计视图消费（保留模块与测试）。与 `workshopStats.js`（基于排行榜全量样本的真实样本统计）口径不同。
  - `discstats.js`：驱动盘推荐统计纯函数 `computeDiscStats(plans, discNames, discSet2)`——推荐该盘（2/4 件套）的角色、副词条频次、456 主属性、二件套同效果替代（`alternatives`）。「统计」视图「驱动盘」面板聚合层（渲染在 `web/discstats.js`）+ **`computeDiscAdvisor`（驱动盘「决策卡」合并层：官方推荐与工坊实况两口径对齐为统一结构——角色/456 主词条/副词条——按共识判定 keep=双边（保留）/split=单边（分歧）/drop=双边未用（可抛弃，仅 456 候选），实况阈值默认 3%）。
  - `plansStats.js`：方案推荐侧每角色 Top 音擎/套装组合 `computeRoleBuildsFromPlans`（结构与 workshop-grad 一致，供「工坊配装」面板对比）+ `orderComboSets4First`（套装组合名 4 件套在前排序归一，工坊/方案两源组合文本一致）。
  - `teamStats.js`：配队推荐统计纯函数 `computeTeamStats`（plans → 每角色被组队次数/自身方案数，名称解析走 names.js）。原「角色配队」面板已移除，保留模块与测试。
  - `panelBench.js`：面板对标三源合并纯函数 `traitKeyStats`（特性→关键属性模板）+ `computeRecHighStats`（推荐 high 档毕业值聚合）+ `computeRecTierStats`（推荐三档 low/mid/high 的 mean/median/sd/cv，过滤 low=mid=0 占位属性）+ `buildPanelBenchmark`（推荐 high 档 / 玩家真实样本 / 我的 final 合并为每角色全部属性）。统计视图「角色数值」与图表面板共用。
  - `panelRange.js`：角色面板区间纯函数（按 normalize 聚合方案 panel 三档区间，取中位）。当前未被 web 引用，仅测试用。
  - `distStats.js`：分布统计纯函数（`quantile`/`median`/`sd`/`skew`/`kurt`/`pearson`/`computeDist`/`computePowerScore` 综合战力/`computeRatio`/`computeBalance`/`kmeans`/`tierFit` 档位匹配）。workshopStats 聚合与统计视图图表共用。
  - `node.js`：Node 专属（`openBrowser` + 同步脚本样板 `ROOT`/`DATA_DIR`/`isMain`/`writeDataFile`）。`streamJsonArrayElements`（流式读大 JSON 数组）有两个已修的坑：① 块末「数组结束」检查不能做（`!started && depth===0` 在元素间隙也为真，块边界落间隙会提前 break 丢 85% 条目）；② 块边界会切断 UTF-8 多字节字符（中文变 U+FFFD）——必须用 `decodeUtf8Tail` 解码到最后一个完整字符边界，跨块字符交下块拼接。
- **`src/sync/`（可执行脚本，也被 server.js 复用导出函数）**
  - `http.js`：米游社接口统一请求 `requestJson`（cookie 序列化 + HTTP/retcode 校验 + 可配置重试 `retry.simple/backoff`）、`fetchUid`、`sleep`，三个脚本共用。
  - `proxy.js`：零依赖代理隧道（HTTP CONNECT / SOCKS5，支持 user:pass 认证），`installProxyFetch` 包一层全局 fetch——仅目标主机匹配（默认 `*.zzzmap.com`）走代理，其余请求用原生 fetch；`resolveProxyUrl` 按 命令行参数 > HTTPS_PROXY/ALL_PROXY/HTTP_PROXY 取代理地址，`maskProxyUrl` 打码日志。workshop.js 模块加载时自动启用（server 复用 fetchWorkshopData 同样生效）。Node 24+ 也可用原生 `node --use-env-proxy` 替代。
  - `library.js`：并发池（6 worker）抓 180+ 个 wiki 详情页，解析出 `library.json`，同时把每个 entry_page 原始响应存 `raw-library.json` 快照。解析器对 wiki 页面结构高度脆弱，改动需谨慎。角色数据含 `coreSkillBoost`（核心技 A-F 档基础面板提升，如「暴击率提升4.8%」→ `{暴击率:0.144}`；开头锚定 + 属性名白名单过滤「额外/最多/造成的伤害」等，百分比攻击/生命归 `X%` 键；数字档核心被动增强不计入），供 wiki 核心技悬浮展示与 calc 百分比词条基准计入。
  - `characters.js`：串行拉取账号角色详情，`extractCharacter()` 做全量提取（面板/装备/技能/影画/皮肤/潜能觉醒/`equipPlan` 等）。含 cookie 缓存（`data/.cookie.json`）。写边界 `normalizeCharacterOutput` 对音擎名/驱动盘名做 library 标准名归一（占位名保留；`extractCharacter` 保持纯函数）。
  - `plans.js`：抓米游社养成指南推荐方案 → `data/plans.json`（结构见「推荐方案数据」小节）。`extractPlan()` 提取 `sets`/`mainProps`/`subStats`/`panel`/`weapon`/`skills`/`team`。写边界 `normalizePlansOutput` 对角色/音擎/套装/配队名做 library 标准名归一（需先有 library.json，缺失时降级不归一）。
  - `workshop.js`：工坊数据统一脚本（原 workshop.js/grad/panel/stats 合并）。签名协议（MD5(key+参数排序)）+ 并发池 + 全量配装爬取（`fetchWorkshopData`，同时生成 workshop.json / workshop-grad.json / workshop-stats.json / workshop-weights.json）+ 2025 源面板计算（复现工坊 `enka_attrs_mapping`：角色基础/武器/装备成长公式）。`extractBuild` 提取兼容 mys 源（面板现成）与 2025 源（面板按公式计算，mys 判定要求实际数据非空，避免 2025 源带空 properties 误走 mys 返回空面板）。**驱动盘两源提取同构：`main`=主词条、`subs`=全部副词条**（2026-08 起；mys 独有 valid/all_hit 有意不提取）。条目另含 `skills`（技能练度，两源归一 `{type, level}`）；`weightJson`（system_data 角色默认流派权重）落盘 workshop-weights.json 并并入 stats。**断点续爬以 workshop.json 实际内容为准**：跳过判断 = 恢复 entries 覆盖的 uid 集合（文件里没有的 uid 一律重爬，进度领先自动自愈）；**内存安全**：90 万+ 条目不全量驻留内存（曾 OOM）——恢复只收集 uid 集合，本次新增每 1 万条 flush 到 `data/.workshop-part.json` 裸流，结束阶段与旧文件流式合并（`copyEntriesTo` 逐条复制，禁止字符级块切分——中文 UTF-8 多字节会损坏）；`buildWorkshopStats` 用 `iterWorkshopEntries()` generator 流式遍历（聚合函数 for...of 兼容），写文件统一原子写（tmp+rename）。不再使用进度文件（旧 data/.workshop-progress.json 废弃）。依赖 `workshop-static.json`（逆向提取的角色基础/武器/装备/套装静态表）。**写时统一把 nick_name（角色简称/ASCII 罗马数字/括号差异）与套装名解析为 wiki 标准名**（`resolveEntry`/`canonicalName`，角色名开 fuzzy）。导出 `apiGet`/`apiPost`/`pool`/`extractBuild`/`fetchWorkshopData`/`fetchWorkshopGrad` 供 server 复用。
- **`src/web/`（浏览器端 ESM，无构建）**
  - `main.js`：入口，`fetch('/api/data')` → `setData()` → `setCalcContext(dataCtx)` → `initUi()`。
  - `data.js`：数据层。`export let` 活绑定（live binding），`setData` 重新赋值后各 import 方自动读到新值。维护索引、用户配置（目标/有效词条/行列序/视图）。
  - `util.js`：浏览器端工具（`apiRequest` 带超时，`opts.timeout: 0` 关闭超时供数小时的长同步请求用——默认 180s 硬超时会误报失败而服务端仍在继续 / `postJSON`，供 data/ui 复用）。
  - `shared.js`：浏览器端共享渲染辅助（纯 HTML 字符串，无 DOM/数据层依赖）：驱动盘 2/4 件套悬浮 `discSetEffectsHtml`、富文本条目 `richItemHtml`、技能图标 `skillIcon`/`skillIconForType`、全局注册 `registerZZZ`。
  - `render.js`：渲染层。「我的角色」视图容器（卡片/汇总二级子页面：`myTab`/`setMyTab`/`myCharsShell`/`resolveView`，兼容旧 `card`/`table` 视图值）+ 卡片/汇总表格渲染、悬浮提示（`data-detail` 属性 + 全局 mouseover 委托）、行/列拖拽排序、表头点击排序。**汇总表属性格悬浮「计算详情」**（`statDetailHtml`：当前/目标达成率 + 基础→加成→最终分解 + `R.sources` 来源明细 + 账号实测差异）。驱动盘图标优先用圆形光盘（`Disc.roundIcon`，wiki 提取，fallback 账号 icon / library icon）。**内联 `onclick` 引用的函数必须挂到 `window`**（`ui.js` 里注册 `openNote`/`openTargetSettings`）。
  - `wiki.js`：数据库视图，四个子面板（角色/音擎/驱动盘/邦布），表头三态排序（升→降→默认）。**新增子面板 = `TABS` + `PANEL_RENDERERS` 各加一项**，渲染函数返回 `table(headers, rows, sortable)` 即自动获得排序、`data-detail` 悬浮、`.wiki-table` 样式。排序统一走 `lib/sort.js` 的 `createSort`（与 `render.js` 统计表、`ui.js` 方案表、`discstats.js` 四处同构）。子面板切换走 `window.ZZZ.wikiTab()`（注册在 `ui.js`）。
  - `ui.js`：交互层。同步按钮（经服务器）、目标/有效/备注弹窗、事件绑定、同步进度轮询（300ms 查 `/api/sync-progress`）。
  - `charts.js`：ECharts 图表辅助（依赖 index.html 引入的本地 vendor `src/vendor/echarts.min.js`（5.5.0），`window.echarts`）。主题色 `CHART_COLORS`（匹配项目暗色+金色）+ 半透明变体 `SOFT` + 公共片段（`AXIS_LINE`/`AXIS_LABEL`/`AXIS_LABEL_SMALL`/`SPLIT_LINE`/`CHART_LEGEND`/`CHART_TITLE`/`CHART_SUBTITLE`/`DARK_TOOLTIP`）——**所有图表统一引用这些基座，禁止硬编码色值**；`registerChart`/`clearCharts`/`mountCharts`/`chartBox` 渲染挂载机制（**页面 resize 自动重排已挂载图表**，防抖 150ms）+ 各图表 option 构建函数（达标热力/共识度大图（每属性子图）/小提琴箱线/2D 密度散点/**`tierRichOption`（推荐三档 × 玩家分布：每属性 4 行——玩家 P10-P90 / 三档 median±sd 用 markArea 区间、我的值金色竖线+百分位；x 轴显式开启数值轴 axisPointer 竖线（默认样式，与技能分布图一致）+ 透明辅助系列提供悬浮数值锚点）**/**练度图**：`rankPyramidOption`（影画金字塔堆叠，0 影深青 1 蓝灰 2 蓝 3 绿 4 金 5 橙 6 红）、`relicBarOption`（装配评分箱线）、`skillDistOption`（技能等级分布子图，我的等级柱高亮）、`rankRelicGapOption`（影画×评分：每角色 6影 median−0影 median 横向条）/**驱动盘图**：`discMain456Option`（456 堆叠）/`discSubsOption`/`discComboOption`/`mainSubCrossOption`（主词条×副词条协同热力，4/5/6 槽并排，色=条件频率）**/读数参考线 `attachReadLine`（option 带 readLine 标记启用：小提琴图鼠标在子图内任意位置显示灰色横虚线 + y 轴数值标签，空白处 showTip 显示对应密度区间，`graphic` + 原生 DOM mousemove 实现）**。视觉统一项目主题。
  - `recommend.js`：「统计」视图容器，**三个**子面板（角色面板/驱动盘/全服总览），仿 `wiki.js` 的 `TABS` + `PANEL_RENDERERS` 键控分发 + 共享排序（`recSort`/`toggleRecommendSort`）。子面板切换走 `window.ZZZ.recommendTab()`（注册在 `ui.js`）。「全服总览」（原「角色总览」+「练度总览」合并）：**提升清单**（我的角色×落后属性按 缺口×落后度 排序 Top12）+ 达标热力图（按平均落后度重排行序，悬浮带缺口）+ 我的盘毕业度矩阵（含主词条 vs 该角色该槽主流对照 + 替换建议列）+ 共识度散点大图（每属性一子图：玩家分化 sd × 攻略分歧 CV）+ **完成度矩阵**（音擎60/盘满级/评分≥P75）+ **影画×装配评分**（6影−0影中位差条）+ `progressCardsHtml()`（装配评分分布箱线/影画档位金字塔/面板属性相关表（固定 7 列，不包滚动容器直接铺开））；「角色面板」（玩家分布箱线（小提琴+箱线，叠加推荐三档点 + 我的）+ 推荐三档×玩家区间增强图 + 面板属性对密度散点 + **技能对标分布图**（玩家池分布子图 + 我的等级金色柱，官方 type 经 `OFFICIAL_SKILL_TYPE` 映射到 canonical） + **技能组合卡**（玩家拉满模式 Top + 我的对照，B9）+ **角色配装对标卡片**（该角色工坊实况 vs 方案推荐：`plansStats.computeRoleBuildsFromPlans` 方案侧 Top 音擎/套装（组合名经 `orderComboSets4First` 归一 4 件套在前）与 workshop-grad 实况并排 + 差异分析） + **配队亲和卡**（玩家实配队友（roleCooccurrence 同练共现）vs 攻略配队（plans team 同队成员）两口径 Top6 对比，B6），角色下拉走 `ZZZ.selectRole`）为 ECharts 图表面板，render 后由 `mountRecommendCharts` 挂载（render.js 调用）。role_id 键的 stats（relicStats/rankLayers/rankDist/skillStats/roleCooccurrence/completeness/rankRelic/skillCombos）经 `roleKeyedMap` 统一映射到 plans 角色名（grad 名对齐）。**所有图表卡标题用短名，详细说明放 `data-detail` 悬浮**（无原生 title 小框）。**新增统计子面板 = 上面 `TABS` + `PANEL_RENDERERS` 各加一项**。
  - `discstats.js`：「统计」视图的「驱动盘」子面板渲染层（`renderDiscStats`/`resetDiscStatsSort`）。**盘为中心的「决策卡」**：顶部全盘概览条（适配角色/保留主词条/可抛弃主词条/玩家盘数，点击行切换选中盘，走 `ZZZ.selectDisc`），主体为选中盘的决策卡——① 适配角色（官方推荐 vs 玩家实况徽章，交集金色高亮）② 456 号位主词条三列对比条（金=官方、蓝=实况，✅保留/⚠️分歧/❌可抛弃标签）③ 副词条保留清单（对比条 + 实况组合 Top + 有效词条分布）④ 可抛弃主词条（删除线）。判定逻辑在 `lib/discstats.js` 的 `computeDiscAdvisor`（两口径对齐 + 共识判定，实况阈值 3%）。底部图表卡区：456 主词条占比 / 副词条频率 / 组合 Top / **主词条×副词条协同热力（mainSubCrossOption）** / **组合画像（双暴、攻击+双暴占比）**。
- **`server.js`**：无框架 http 服务器。路由：`POST /api/sync-base`、`POST /api/sync-characters`、`GET /api/data`、`/api/config`（读写 `user-config.json`）、`/api/cookie`、`/api/cookie-status`、`/api/sync-progress`。`busy` 互斥锁防止两个同步同时写文件；三个同步 handler 共用 `runSync()` 骨架（busy 锁/进度上报/cookie 解析/错误处理）。

## 工坊 API 参考（api.zzzmap.com）

| 接口 | 方法 | 用途 |
|---|---|---|
| `/api/v1/system_data/public` | GET | 全局字典：57 角色（含 `weight_json` 默认流派权重）+ 94 音擎 + 30 套装 |
| `/api/v1/user_relic/ranking` | GET | 排名：按 角色×影画档 拉上榜 uid（分页硬性 50/次，limit 无效） |
| `/api/v1/user_role/v3` | POST | 单个 uid 的**全部角色**配装（mys / 2025 两种 item_json 源） |
| `/api/v1/role/grad_stat` | GET | 每角色全服音擎/套装占比（57 请求） |

签名：`MD5(key + 排序后参数串)`（`makeSign`）；无需 token；仅部分接口响应加密（AES-256-ECB）。

**提取状态（extractBuild）**：
- ✅ 已提取：角色 `level`/`rank`(影画)/`relic_point`(评分)/`skills`(两源归一 `{type, level}`，mys=官方语义、2025=1.x ID)；音擎 id/name/level/rarity/main；面板（mys 现成 / 2025 公式计算）；驱动盘 `main`=主词条 + `subs`=全部副词条（两源同构）；`weightJson`（system_data → workshop-weights.json + stats.weightJson）。
- ❌ **有意不提取**：mys 源独有 `valid`/`all_hit`/`invalid_property_cnt`（非两源共有；聚合层统一按 `SUBSTAT_TYPE_SET` 判定有效词条，两源口径一致）；深渊战绩 `abyss_data_json`（2026-09 已移除）。
- 🔶 未提取（可挖掘，已评估价值）：`TalentToggleList`（2025 源手动关闭影画效果 = 降配打榜行为）、`weapon.talent_title`（「改」后缀 = 改造音擎标记）/`star`、`ObtainmentTimestamp`（角色获取时间）、音擎/驱动盘 `BreakLevel`/`UpgradeLevel`（突破/改造）、`equip.properties[].level`（mys 词条强化等级，2025 源 PropertyLevel 已有等价信息已乘算）、`source_api`（role 级源标记，代码已自判）、`profession`/`pool_type`（特性/池子类型）。

## 统计视图指标实现状态（源自原 stats-metrics 蓝图 D1-D10）

| 指标 | 状态 |
|---|---|
| D1 主词条共识度（玩家 × 攻略） | ✅ 驱动盘决策卡（computeDiscAdvisor keep/split/drop） |
| D2 我的主词条正确率 | ✅ 决策卡「可抛弃主词条」列（删除线标注） |
| D3 副词条生态（歪词条率） | ✅ 决策卡副词条保留清单（对比条 + 实况频率） |
| D4 有效词条分布（毕业度） | ✅ 决策卡实况组合 Top + effDist；全服总览驱动盘毕业度矩阵（我的盘 vs 该盘 effDist 百分位 + 替换建议） |
| D5 词条组合分析 | ✅ 决策卡实况组合 Top（subCombos）+ 驱动盘面板「组合画像」（双暴/攻击+双暴占比） |
| D6 主词条 × 副词条协同 | ✅ 驱动盘面板 `mainSubCrossOption` 协同热力图（4/5/6 槽并排，色=条件频率） |
| D7 套装 × 槽位交叉 | ❌ 未做 |
| D8 角色级配装画像 | ✅ `roleDiscStats` 消费于毕业度矩阵「主词条 vs 该角色该槽主流」对照 |
| D9 评分 × 盘毕业度 | ❌ 未做 |
| D10 两源一致性审计 | ❌ 未做 |

**面板属性相关**：7 对皮尔逊相关（见「工坊数据口径」），前端「面板属性相关」表（角色 × 7 对，绿=正相关 >0.2 / 红=负相关 <-0.2 / 灰=无关系）。

## 关键约定与坑

- **属性名归一化**：wiki 页面各角色用词不一（生命/生命力→生命值、攻击→攻击力、防御→防御力；短名 暴击→暴击率、暴伤→暴击伤害；命破角色 贯穿力→穿透率、闪能自动积累/累积/累计→能量自动回复），`util.js` 的 `normalizeStatKey(s)` 统一映射（别名表 `STAT_ALIASES`，新增别名要同步补测试）；`models.js` 构造时对 `maxLevel` 调 `normalizeStatKeys`。改数据读写时注意保持这一约定。
- **技能类型编号三套体系（统一 canonical，见 `constants.js` 的 `SKILL_TYPES`）**：canonical = 0普攻/1闪避/2支援/3特殊/4终结/5核心（6 项，游戏 2.0 技能槽顺序；**无独立「连携」**——连携技与终结技同槽共享等级）。① 官方（characters.json 账号数据）与**工坊 mys 源**：0普攻/1特殊技/2闪避/3终结+连携(共享等级)/5核心/6支援技 → `OFFICIAL_SKILL_TYPE`（官方 1→3、2→1、3→4、6→2）；② **工坊 2025 源**（游戏内嵌原始，1.x 技能 ID）：0普攻/1闪避/2特殊技/3连携/5核心/6终结 → `WS2025_SKILL_TYPE`（1→1、2→3、3→4 连携并入终结、6→4）。**mys 与 2025 语义不同，聚合必须按源区分**：`extractBuild` 写时固化 `source: 'mys' | '2025'` 字段，computeSkillStats 优先读它；旧数据（无 source）回退 skills 数组第 2 位 type 判别（mys 数组按 UI 顺序 [0,2,6,...]、2025 按 ID 顺序 [0,1,2,...]），数组不足 2 个仍无法判源则跳过该条（不贡献技能统计）。「我的角色」视图（render.js skillOrder [0,2,1,6,3,5] + shared.skillIconForType/SKILL_LABEL）内部用官方语义自洽，但**跨源匹配必须经 OFFICIAL_SKILL_TYPE 映射**（否则 1↔2 互换、终结/支援错位）。plans.json 的 skills type 也是官方语义（目前前端无消费点，未归一化）。
- **图片资源：永远不要用工坊（`api.zzzmap.com`）的图片资源**。所有图片一律用官方 wiki（米游社 `act-upload.mihoyo.com` 等）数据源的图片，本地化到 `data/img/` 后使用。工坊图片仅用于参考定位接口/字段，禁止直接引用其图片 URL 或写入数据。
- **工坊 API 风控与性能**：排名收集阶段角色级 `pool` 并发 + **每角色 7 影画组内并行翻页**（`fetchRankRows`，实测 6.4× 提速）；v3 配装请求默认 10 并发（`pool`，第 4 个命令行参数可调，响应大吃带宽，注意限流），**不要加串行限速**。接口硬性每页 50 条（limit 参数无效）。**IP 被封时用代理换 IP**：`node src/sync/workshop.js 57 300 6 <proxy>`（第 5 参）或设 `HTTPS_PROXY`/`ALL_PROXY` 环境变量（仅 api.zzzmap.com 走代理，其余请求不受影响；实现见 `src/sync/proxy.js`，零依赖，HTTP CONNECT/SOCKS5/认证均支持；Node 24+ 也可用原生 `node --use-env-proxy`）。
- **2025 源面板**：工坊 `user_role/v3` 返回两种玩家数据源——mys（工坊格式化，面板现成）与 2025（游戏内嵌原始数据，面板需按公式计算）。`workshop.js` 复现工坊 `enka_attrs_mapping`：角色基础（BaseProps + GrowthProps×(等级-1)/10000 + 突破档 + 核心强化档）、武器（MainStat×(1+0.1568×等级+0.8922×突破) + Secondary×(1+0.3×突破)）、驱动盘（主属性×等级成长系数 + 副属性×词条等级）、套装 2 件套加成（≥2 件），输出与 mys 源一致的 `panel`（`base/add/final`，百分比为小数）。
- **工坊静态表**：`src/sync/workshop-static.json` 是逆向提取的静态数据（角色基础/武器/装备/套装），`workshop.js` 加载用；游戏数据更新后需重新提取。
- **名字匹配**：统一走 `src/lib/names.js` 的 resolver（`buildNameIndex` + `resolveName`/`resolveEntry`），以 `library.json` 为标准名权威源；别名/罗马数字/括号/空白/简称差异（工坊 nick_name、wiki 改名、配队空格等）在**同步写时**已固化到标准名，消费端按标准名精确匹配 + resolver 别名兜底（例：wiki 2026-10 把驱动盘「棘刺玫瑰」改名「荆棘玫瑰」，library 键随之变化，`ALIASES` 存旧名→新名映射兼容历史数据）。`util.js` 的 `buildIndex`/`lookup` 为通用底层，业务代码不再直接依赖。
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
- 工坊配装数据：`data/workshop.json`（2.13GB 全角色玩家配装实例，音擎/驱动盘/面板/技能齐全）、`data/workshop-grad.json`（57 角色最常用音擎/驱动盘套装）、`data/workshop-stats.json`（聚合，无 abyssStats/无 playerProfiles）、`data/workshop-weights.json`（角色默认流派权重）。全部由 `node src/sync/workshop.js` 一步同步生成；server「更新工坊配装」调 `fetchWorkshopData` 同样一步更新。**口径：workshop-grad 是全服真实累计占比（工坊 `grad_stat` 接口）；workshop-stats 基于 workshop.json（上榜 uid 池的完整角色池）聚合，画像按玩家真实样本统计 min/max/mean/median，不当作全服分布。**
- 驱动盘圆形图标：`library.discs[name].roundIcon`（wiki 从驱动盘页 modules 提取——出现次数最多的图片即圆形光盘，6 个尺寸变体），「我的角色」卡片/汇总视图优先使用；`icon` 为方形套装图。
- **视觉体系（style.css，2026-10 全面升级）**：暗色灰调 + 琥珀金，无蓝色调。`:root` 变量统一驱动——灰阶基底（`--bg`/`--card`/`--card2`/`--card3`/`--line`）、文字（`--txt`/`--dim`）、琥珀金（`--acc`/`--acc2`/`--acc-deep` + `--grad-gold` 渐变）、语义色（`--red`/`--blue`/`--green`/`--purple`/`--orange`）、圆角（`--radius` 12px/`--radius-sm` 6px）、阴影（`--shadow`/`--shadow-lg`/`--glow`）、过渡 `--t`。约定：卡片/图卡 = 顶部内高光渐变 + hover 抬升金边光晕；按钮 = hover 琥珀渐变 + 斜向光扫伪元素（小型控件 `.view-tab`/`.sync-dropdown button`/`.modal-box .close` 排除）；tab = 胶囊（`.view-switch`/`.wiki-tab`）；表格 = 表头渐变 + 底部金线 + hover 整行从下而上渐渐变淡的金色渐变高亮（`linear-gradient(0deg, …)`，无斑马纹、无竖条）；弹窗/悬浮 = 玻璃拟态（backdrop-filter）；滚动条 = 渐变 thumb（hover 金色）；图表卡片标题 = 金色左竖线；动效 = `cardIn`（卡片入场）/`viewIn`（面板渲染淡入）。`charts.js` 的 `CHART_COLORS` 与 CSS 变量保持同色系。

## 后续方向（未实现，按价值排序）

- **提升清单归因分级**：现有提升清单加「装备可解/抽卡可解/养成耗时」归因分类（蓝图 P1 完整版）。
- **评分仪表盘**：我的角色评分 → relicStats 百分位（沿用 approxPercentile）。
- **同段位配装学习**（蓝图 P2）：玩家池按评分分 P25/P50/P75 段，展示高段玩家音擎/套装/456 主词条偏好 vs 我的差异。
- **D7 套装×槽位 / D9 评分×盘毕业度 / D10 两源一致性**：驱动盘指标蓝图剩余项。
- **完成度深化**：completeness 已有矩阵；可加「我的角色 vs 玩家池完成度」对照。

## 变更记录（2026-09 ~ 2026-10）

- **2026-10（第二批可视化）**：新增 4 聚合（roleCooccurrence/completeness/rankRelic/skillCombos）+ 9 张新卡/图——全服总览：提升清单（缺口×落后度排序）、达标热力图按落后度重排+缺口悬浮、驱动盘毕业度矩阵升级（主词条主流对照+替换建议）、完成度矩阵、影画×装配评分条；角色面板：技能组合卡（拉满模式+我的对照）、配队亲和卡（玩家实配 vs 攻略配队两口径）；驱动盘面板：主词条×副词条协同热力图、组合画像（双暴/攻击+双暴）。
- **2026-10**：视觉体系全面升级（灰调去蓝 + 琥珀金，见「视觉体系」）；统计视图精简：深渊配队/深渊统计/影画收益图/技能 P90 热力/玩家生态图删除；「角色总览」+「练度总览」合并为「全服总览」；图表标题短名 + 悬浮说明；共识度散点合并为多子图大图；装配评分改箱线图；面板属性相关扩为 7 对；汇总表属性格悬浮计算详情；驱动盘 wiki 改名「棘刺玫瑰→荆棘玫瑰」（names.js ALIASES）；playerProfiles 聚合/产出/数据字段移除。
- **2026-09**：深渊数据（爬取/聚合/workshop-abyss.json/前端面板）全部移除。
- **2026-08**：工坊爬取口径改为排行榜全量 uid（高练度标杆池）；技能练度/驱动盘两源同构提取；练度指标聚合（relicStats/rankLayers/rankDist/skillStats/roleDiscStats）；驱动盘决策卡；统计视图图表面板体系成型。
