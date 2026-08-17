# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本文档是唯一权威项目文档（2026-10 整合自 README.md / docs/*.md，原文件已删除，git 历史可恢复）。

**代码规范（强制）**：`CODING-STANDARDS.md` 是本项目「怎么写代码」的强制规范（分层/命名/注释/数据口径/错误处理/测试/前端/安全/性能），**未来生成或修改的代码一律遵循该文档**，与其冲突时以规范为准；代码导读见 `CODE-GUIDE.md`。本文档只负责数据口径、设计决策与变更记录，不重复规范内容。

## 项目概览

个人用的《绝区零》角色配装面板：本地 Node 服务器 + 米游社 wiki/账号数据同步 + 无构建步骤的浏览器端 ESM。

三个上级视图：
- **「我的角色」**：内部「卡片/汇总」二级子页面，展示每个角色的技能等级、影画/潜能觉醒、音擎、驱动盘、最终面板数值与达成率（实际值为主，推算补齐）。
- **「数据库」**：wiki 属性库（角色/音擎/驱动盘/邦布），表头三态排序、悬浮完整说明。
- **「统计」**：内部「角色面板/驱动盘/全服总览」三个子面板，基于推荐方案数据（plans.json）与工坊配装数据（workshop-grad.json / workshop-stats.json）跨角色统计。

**零依赖**：`package.json` 无任何 runtime 依赖（devDependencies 仅 eslint/prettier）。Node 18+ 自带 fetch。ESM，`src/lib/` 下的纯模块 Node 与浏览器共用。

## 常用命令

```bash
npm start                    # 启动本地服务器（端口 8719，自动开浏览器）；页面数据来自 /api/data，必须经服务器访问
npm run sync:library         # 抓取米游社 wiki 属性库 → data/library.json + data/raw-library.json
npm run sync:characters      # 用 cookie 拉取账号角色 → data/characters.json（需粘贴 cookie，交互式）
npm run sync:plans           # 抓取米游社养成指南推荐方案 → data/plans.json
node src/sync/workshop.js            # 全量爬取工坊配装（workshop.json + workshop-grad.json + workshop-stats.json + workshop-weights.json，一步更新）
node src/sync/workshop.js 57 300 6 http://127.0.0.1:7890   # 第 5 参 = 代理 URL（IP 被封时换 IP；也可用 HTTPS_PROXY/ALL_PROXY 环境变量，见 src/sync/proxy.js）
npm run rebuild:stats        # 只重算 workshop-stats.json（不爬配装；尝试重跑 grad 57 角色，风控失败则用现有 grad）——改聚合后用它验证；IP 被封时第 1 参传代理：npm run rebuild:stats -- http://127.0.0.1:7890（也认 HTTPS_PROXY 等环境变量）
npm run clean:workshop       # 清洗 workshop.json（丢弃乱码/损坏/重复条目）；平时用不到，只在爬取又产出乱码时用
npm test                     # 全部单元测试（node:test；依赖 data/ 数据文件，缺失时**打印 SKIP 横幅并跳过该文件**）
REQUIRE_DATA=1 npm test      # 缺数据不再跳过而直接判失败（CI 用，防止「静默全绿」）
node --test test/calc.test.js   # 跑单个测试文件
npm run lint                 # ESLint（扁平配置，按文件区分 Node/浏览器全局）
npm run format               # Prettier 格式化
```

> 运维脚本统一放 `scripts/`（2026-08 从根目录 `scripts-*.mjs` 迁入），路径一律基于 `src/lib/node.js` 的 `DATA_DIR` 拼接，不依赖「从仓库根目录运行」的 cwd 假设。

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
- **workshop-stats.json**：基于 workshop.json（上榜 uid 池）聚合：`panels`（每角色面板真实样本统计：count/min/max/mean/median/sd/IQR/p10-p99/skew/kurt/whisker/outliers/hist）、`wengines`/`discs`（按配装条目数）、`panelCorr`（属性相关，**7 对**：攻击-防御/攻击-生命/防御-生命/暴击率-暴伤/攻击-暴伤/攻击-暴击率/异常精通-异常掌控）、`panelScatter`（暴击率×暴伤、攻击×暴伤 2D 密度，perRole/global）、`discDetails`（30 盘单盘统计）、`relicStats`/`rankDist`/`skillStats`/`roleDiscStats`/`roleOwnership`（练度指标；**`rankLayers` 已于 2026-08 从产出移除**——无前端消费却占 348 KB/17.7%，函数与测试已于 2026-11 删除）、**2026-10 新增**：`roleCooccurrence`（同 uid 同练角色共现 → 真实配队亲和）、`rankRelic`（每角色×影画档评分 count/mean/median）、`skillCombos`（每角色技能拉满组合模式 Top + 全拉满率，拉满 = 普攻/闪避/支援/特殊/终结 ≥12、核心 =7）、`roleStyles`（**角色流派分析**：面板 k-means 聚类 k=3，**聚类属性池按角色定位（trait）选**——击破含冲击力、异常含精通/掌控、命破/防护含生命防御、支援含攻击生命，由 buildWorkshopStats 经 roleNameMap+library 构造 traits 传入，无定位回退通用池；再数据驱动去噪（cv<0.04 的列剔除，至少保留 3 维），每角色 {attrs, styles:[{share,label,panel(mean/median),main{4,5,6} Top2,suits Top2,wengine Top2}]}，4 号位主词条是强判别信号；⚠️ 暴伤等百分比聚合值为小数（mys "165.2%"→1.652），前端按值 ≤3 判百分比显示）、`weightJson`（工坊权重）、**2026-08 新增**：`rollEfficiency`（每角色加权词条效率分 + 槽位短板 + D9 评分×毕业度相关）、`sourceAudit`（D10 两源面板一致性）。**口径：画像按玩家真实样本统计，不当作全服分布**。
- **浏览器端只加载 workshop-stats.json（≤2 MB）**；一切新聚合在同步脚本完成（流式遍历 358k+ 条，一次 ~2-4 分钟）。⚠️ 2026-08 加入 rollEfficiency/sourceAudit/slotDist 后实测 **1.82 MB**，余量已不多——再加聚合前先量体积，必要时对 role 级明细做 Top-N 截断。
- **副词条口径：强化次数（roll），不是词条个数（2026-08 起）**。`substatRolls(name, value)` 用单次强化基数还原次数：实测 6 万条目 / 144 万副词条中 `value / base` 有 99.9987% 恰为 1-6 的整数（余 19 条异常值靠 `round` + 钳制兜底），因为 2025 源存的就是 `PropertyValue × PropertyLevel`；两源同量纲对齐靠「2025 的百分比按 ×100 存、mys 按显示数存」，`substatRolls` 按 `typeof value` 自判。**旧的「有效词条个数」口径已废弃**——上限 4 且实测 4,979,291 块盘里 99.95% 恒为 4，毫无区分度。次数口径实测分布 1 次 30.97% / 2 次 38.70% / 3 次 22.54% / 4 次 7.03% / 5 次 0.75% / 6 次 0.014%。另注意「单盘总强化次数」几乎无信息量（满级盘恒 8 或 9），有区分度的是**落在该角色有效词条上的次数**——有效集合由 `workshop-weights.json` 的角色默认流派权重（>0）给出，缺权重时退化为「全部合法副词条」。
- **加权词条效率分 `rollEfficiency`**：`Σ 强化次数 × 流派权重`（按整套 6 盘聚合），给了 `workshop-weights.json` 第一个消费方。比 `relic_point` 透明（公式公开、前端能用产出的同一张 `weights` 表对「我的盘」复算，口径必然一致）。产出 `score`/`effRolls` 分布、`slotEff`（每槽有效次数均值，找短板槽）、`scoreVsRelic`（D9 评分×毕业度皮尔逊，配对样本 <30 记 null）。⚠️ 权重表不区分百分比/固定值（`攻击力%` 与 `攻击力` 共用 key「攻击」），沿用工坊原始口径不折算。
- **两源判别 `sourceOf(e)`**：`source` 字段 → **`equips[].rarity` 的类型**（string `"S"`=mys / number `4`=2025）→ skills 数组顺序，逐级兜底。rarity 判源实测 20 万条目可判率 100%、与 `subs[].value` 形态（mys 字符串 / 2025 数字）100% 同构零交叉；旧的数组顺序启发式与它分歧 160 条（0.080%），分歧样本全是 rarity 全 `"S"`（mys）但 skills 恰好呈 ID 升序 `[0,1,2,3,5,6]`——**误判的是数组顺序法**，故降为最后兜底。技能语义归一与 `sourceAudit` 共用此判别，口径必须一致。

### 推荐方案数据 `data/plans.json`

`src/sync/plans.js` 抓米游社养成指南 → `data/plans.json`（`{ avatarId: { name, plans: [...] } }`，覆盖 57 角色、每角色全量方案（feed 翻页直到 end，`MAX_PLANS=5000` 防死循环））。`extractPlan()`（`plans.js`）把每个方案精简成：

- `sets: [{name, cnt}]` —— 推荐驱动盘套装，cnt 为件数（2 或 4）；2+2+2 / 4+2 组合就是多条同 `name` 的 entry。**驱动盘统计类功能的主数据源**。
- `mainProps: {4,5,6: 属性名}` —— 456 号位推荐主属性（键为字符串，值已用 `mainStatName` 归一化成百分比变体，部分方案缺项）。
- `subStats: [副词条名]` —— 推荐副词条（`攻击力百分比` 已用 `substatKey` 归一化成 `攻击力%`）。
- 其余：`panel`（low/mid/high 三档面板目标，percent 按属性名判定）、`weapon{main,backup}`、`skills[{type,level}]`、`team`（配队全名）、`releasedAt`。

前端消费：`src/web/ui.js` 目标弹窗的方案表渲染与应用流程。套装名/音擎名/角色名与 library 对齐统一走 `src/lib/names.js` 的 `resolveEntry`（`buildNameIndex` 建索引）。

### 分层

- **`src/lib/`（双端共享纯模块，Node 与浏览器均可 import）**
  - `constants.js`：固定字符串枚举（属性名 `STAT`/`SUBSTAT`、主/副词条选项、目标字段 `TARGET_KEYS`、456 主词条候选 `MAIN_STAT_OPTIONS`、`mainStatName`、同步类型、视图），各处引用枚举防拼写错误。
  - `util.js`：纯工具。⚠️ **禁止 import 任何 `node:` 模块**（浏览器直接 import 它）；Node 专属函数放 `node.js`。含属性/词条归一（`normalizeStatKey`/`normalizeStatKeys`/`substatName`/`parseNum`）、归一化键（`normalize`/`romanNumeralUnicode`/`normalizeRomanKey`）、转义与富文本（`escapeHtml`/`escapeJsAttr`/`renderRichText`/`decodeHtmlEntities`）、展示（`formatValue`）、cookie（`parseCookies`/`serializeCookies`）、排序比较（`compareValues`/`isEmptyVal`）。名称查找统一走 `names.js` 的 resolver。
  - `names.js`：**统一名称解析**（双端共用，禁 import node:）。`library.json` 为标准名权威源；`buildNameIndex(names, category)` 建索引，`resolveName(category, index, name)` 按「精确→别名→归一化键→子串(char 专属)」解析，`resolveEntry`/`canonicalName` 为便捷入口。别名表 `ALIASES` 按类别组织（角色：维琳娜→维琳娜·艾嘉德、星徽·比利→星徽·比利·奇德、提/缇、11号→「11号」；盘：棘刺玫瑰→荆棘玫瑰（wiki 2026-10 改名，旧名兼容历史数据））；wengine 用 `normalizeRomanKey` 防 Ⅰ/Ⅱ/Ⅲ 碰撞。同步脚本写时固化、消费端统一解析都走这里。新增数据源/新变体只需在 `ALIASES` 或归一化键加一条。
  - `sort.js`：表头三态排序（升→降→复位）状态机 `createSort()`（`toggle`/`reset`/`apply`，空值行恒排最后）。wiki/汇总表/方案表/驱动盘统计/统计视图各表统一走它，表头 ▲/▼ 指示各视图自渲染。
  - `schema.js`：数据键名唯一权威定义（`KEYS`）+ 校验（`validateLibrary` / `validateCharacters` / `validatePlans` / `warnIfInvalid`）。同步脚本写文件前调用校验，**只 warn 不中断**。
  - `calc.js`：计算引擎。纯逻辑无 DOM 依赖，数据经 **`setCalcContext(ctx)` 注入**（浏览器在 `web/main.js`、测试在断言前调用）。含属性常量、副词条成长（`substatGrowthTable`，B 站 wiki 规则）、面板计算（`calculateCharacter`，返回 `{base, bonus, final, actual, theoretical, sources}`——sources 为每属性加成来源明细，汇总表属性格悬浮「计算详情」消费）、达成率（`statProgress`/`resolveStatCurrent`/`targetGap`）。
  - `models.js`：领域模型基类 `Character` / `Wengine` / `Disc`。构造时归一化数据、自动算派生属性（如副词条成长次数 `growth`）、组合关系（角色装备音擎+驱动盘）。浏览器把 wiki 与账号数据都实例化成这些基类。`Disc` 保留 `roundIcon`（圆形光盘图标，卡片/汇总视图驱动盘用）。
  - `workshopStats.js`：工坊配装数据（`workshop.json` entries）汇总纯函数 `computeWorkshopStats`（音擎/驱动盘按配装条目数聚合、角色面板真实样本统计 `computeDist`：count/min/max/range/mean/median/sd/IQR/p10-p99/skew/kurt + whisker/outliers/hist，百分比统一归一化为小数）+ `computePanelCorrelations`（属性相关，按角色、同条目配对皮尔逊，默认 7 对）+ **`computeWorkshopDiscStats`（驱动盘单盘真实统计：物理盘数/使用角色/456 主词条分布/副词条频率 + **有效强化次数**分布 `effDist`/槽位分布 `slotDist`（D7）/副词条组合 Top `subCombos`/主词条×副词条协同 `mainSubCross`，供「统计→驱动盘」决策卡的实况口径）** + `discStatName`（workshop 词条名 → plans/constants 统一名，兼容 2025/mys 两源）+ **`substatRolls`（副词条值 → 强化次数，两源自判）/ `buildRoleSubstatWeights`（工坊流派权重 → 每角色有效副词条表）/ `sourceOf`（两源判别，rarity 类型优先）**+ **`computePanelScatter`（面板属性对 2D 密度网格：暴击率×暴伤、攻击×暴伤，perRole/global 两粒度，供密度散点图）** + **练度指标聚合**：`computeRelicStats`（每角色工坊评分分布，含 hist）、`computeRankDist`（每角色 0-6 影占比）、`computeSkillStats`（每角色×技能类型等级分布）、`computeRoleDiscStats`（每角色 456/副词条/有效强化次数画像）、`computeRoleOwnership`（样本池拥有率：去重 uid 中拥有该角色的占比，`meta.poolUids` 记池大小）+ **2026-10 新增**：`computeRoleCooccurrence`（同 uid 同练角色共现）、`computeRankRelic`（每角色×影画档评分 count/mean/median）、`computeSkillComboStats`（技能拉满组合模式，源判别同 computeSkillStats）、`computeRoleStyles`（**角色流派分析**：**聚类属性池按定位（trait）选**（`TRAIT_STYLE_ATTRS`：强攻/命破/防护/击破/异常/支援各一套候选，opts.traits 由 buildWorkshopStats 经 roleNameMap+library 构造，无 trait 回退通用池）+ 数据驱动去噪（cv<0.04 剔除、保底 3 维）+ 面板 z-score + k-means k=3（确定性初始化可复现；k=4 噪声簇故固定 3；每角色样本上限 2 万、<200 不聚类），命名 `styleLabel`（4 号位取向+6 号位取向，同名簇按面板 z 追加「冰伤高」等消歧，消歧排除防御力）、`styleMatch`（我的面板 → 最近流派相对距离，前端联动用）、`styleAttrShort`）、导出 `bin2D`+ **2026-08 新增**：`computeRollEfficiency`（加权词条效率分 + slotEff 短板槽 + D9 scoreVsRelic）、`computeSourceAudit`（D10 两源面板均值对比，任一源 <30 样本不给 diff）。`src/sync/workshop.js` 汇总生成与统计视图图表面板共用。**单遍历总入口 `computeAllWorkshopStats(entries, discIndex, opts)`（2026-08 性能重构）**：内部每个聚合都拆成 `{add(entry), finish()}` 累加器，15 项在**一次** `for` 循环里全部喂完再各自收尾；`buildWorkshopStats` 只调它一次（此前每个聚合各跑一遍 `iterWorkshopEntries()` = 把 2.13GB 文件流式解析十几遍，每遍 ~27s）。原公开函数全部保留且行为不变（自身也改为「建累加器→循环 add→finish」）。**改聚合时的硬约束：累加器内部 Map/数组必须严格按条目出现顺序写入**，否则输出键序与浮点累加顺序漂移，与旧结果不再逐位相等。**`opts.weightJson`（或已构建的 `opts.roleWeights`）必须在聚合前传入**——`effDist` 的「按角色区分有效副词条」与 `rollEfficiency` 都依赖它，缺失会静默退化为「全部合法副词条」。
  - `discstats.js`：驱动盘推荐统计纯函数 `computeDiscStats(plans, discNames, discSet2)`——推荐该盘（2/4 件套）的角色、副词条频次、456 主属性、二件套同效果替代（`alternatives`）。「统计」视图「驱动盘」面板聚合层（渲染在 `web/discstats.js`）+ **`computeDiscAdvisor`（驱动盘「决策卡」合并层：官方推荐与工坊实况两口径对齐为统一结构——角色/456 主词条/副词条——按共识判定 keep=双边（保留）/split=单边（分歧）/drop=双边未用（可抛弃，仅 456 候选），实况阈值默认 3%）。
  - `plansStats.js`：方案推荐侧每角色 Top 音擎/套装组合 `computeRoleBuildsFromPlans`（结构与 workshop-grad 一致，供「工坊配装」面板对比）+ `orderComboSets4First`（套装组合名 4 件套在前排序归一，工坊/方案两源组合文本一致）。
  - `panelBench.js`：推荐方案三档统计纯函数 `computeRecTierStats`（plans → 每角色每属性 low/mid/high 的 mean/median/sd/cv，MAD 排除离群哨兵值，过滤 low=mid=0 占位属性）。供统计视图（推荐三档图/共识度/提升清单/达标热力）消费，结果有缓存（`recommend.js` 的 `recTierStats`）。
  - `distStats.js`：分布统计纯函数（`quantile`/`median`/`sd`/`skew`/`kurt`/`pearson`/`computeDist`/`kmeans`）。workshopStats 聚合与 panelBench 共用；**`kmeans` 由 `computeRoleStyles`（流派聚类）实际消费**。
  - `node.js`：Node 专属（`openBrowser` + 同步脚本样板 `ROOT`/`DATA_DIR`/`isMain`/`writeDataFile`）。`streamJsonArrayElements`（流式读大 JSON 数组）有两个已修的坑：① 块末「数组结束」检查不能做（`!started && depth===0` 在元素间隙也为真，块边界落间隙会提前 break 丢 85% 条目）；② 块边界会切断 UTF-8 多字节字符（中文变 U+FFFD）——必须用 `decodeUtf8Tail` 解码到最后一个完整字符边界，跨块字符交下块拼接。
- **`src/sync/`（可执行脚本，也被 server.js 复用导出函数）**
  - `http.js`：米游社接口统一请求 `requestJson`（cookie 序列化 + HTTP/retcode 校验 + 可配置重试 `retry.simple/backoff`）、`fetchUid`、`sleep`，三个脚本共用。
  - `proxy.js`：零依赖代理隧道（HTTP CONNECT / SOCKS5，支持 user:pass 认证），`installProxyFetch` 包一层全局 fetch——仅目标主机匹配（默认 `*.zzzmap.com`）走代理，其余请求用原生 fetch；`resolveProxyUrl` 按 命令行参数 > HTTPS_PROXY/ALL_PROXY/HTTP_PROXY 取代理地址，`maskProxyUrl` 打码日志。workshop.js 模块加载时自动启用（server 复用 fetchWorkshopData 同样生效）。Node 24+ 也可用原生 `node --use-env-proxy` 替代。
  - `library.js`：并发池（6 worker）抓 180+ 个 wiki 详情页，解析出 `library.json`，同时把每个 entry_page 原始响应存 `raw-library.json` 快照。解析器对 wiki 页面结构高度脆弱，改动需谨慎。角色数据含 `coreSkillBoost`（核心技 A-F 档基础面板提升，如「暴击率提升4.8%」→ `{暴击率:0.144}`；开头锚定 + 属性名白名单过滤「额外/最多/造成的伤害」等，百分比攻击/生命归 `X%` 键；数字档核心被动增强不计入），供 wiki 核心技悬浮展示与 calc 百分比词条基准计入。
  - `characters.js`：串行拉取账号角色详情，`extractCharacter()` 做全量提取（面板/装备/技能/影画/皮肤/潜能觉醒/`equipPlan` 等）。含 cookie 缓存（`data/.cookie.json`）。写边界 `normalizeCharacterOutput` 对音擎名/驱动盘名做 library 标准名归一（占位名保留；`extractCharacter` 保持纯函数）。
  - `plans.js`：抓米游社养成指南推荐方案 → `data/plans.json`（结构见「推荐方案数据」小节）。`extractPlan()` 提取 `sets`/`mainProps`/`subStats`/`panel`/`weapon`/`skills`/`team`。写边界 `normalizePlansOutput` 对角色/音擎/套装/配队名做 library 标准名归一（需先有 library.json，缺失时降级不归一）。
  - `workshop.js`：工坊下载/提取主脚本（2026-10 拆分：聚合在 `workshop-stats.js`、API 客户端在 `workshop-api.js`、静态数据在 `workshop-static.js`；本文件 re-export `buildWorkshopStats`/`fetchWorkshopGrad` 保调用方不变）。签名协议（MD5(key+参数排序)，在 workshop-api.js）+ 并发池 + 全量配装爬取（`fetchWorkshopData`，同时生成 workshop.json / workshop-grad.json / workshop-stats.json / workshop-weights.json）+ 2025 源面板计算（复现工坊 `enka_attrs_mapping`：角色基础/武器/装备成长公式，原 workshop-panel.js 的面板计算保留在本文件）。`extractBuild` 提取兼容 mys 源（面板现成）与 2025 源（面板按公式计算，mys 判定要求实际数据非空，避免 2025 源带空 properties 误走 mys 返回空面板）。**驱动盘两源提取同构：`main`=主词条、`subs`=全部副词条**（2026-08 起；mys 独有 valid/all_hit 有意不提取）。条目另含 `skills`（技能练度，两源归一 `{type, level}`）；`weightJson`（system_data 角色默认流派权重）落盘 workshop-weights.json 并并入 stats。**断点续爬以 workshop.json 实际内容为准**：跳过判断 = 恢复 entries 覆盖的 uid 集合（文件里没有的 uid 一律重爬，进度领先自动自愈）；**内存安全**：90 万+ 条目不全量驻留内存（曾 OOM）——恢复只收集 uid 集合，本次新增每 1 万条 flush 到 `data/.workshop-part.json` 裸流，结束阶段与旧文件流式合并（`copyEntriesTo` 逐条复制，禁止字符级块切分——中文 UTF-8 多字节会损坏）；写文件统一原子写（tmp+rename，`writeJsonAtomic` 在 `lib/node.js`）。不再使用进度文件（旧 data/.workshop-progress.json 废弃）。**写时统一把 nick_name（角色简称/ASCII 罗马数字/括号差异）与套装名解析为 wiki 标准名**（`resolveEntry`/`canonicalName`，角色名开 fuzzy）。导出 `fetchWorkshopData`/`extractBuild`/`isMaxedRole`/`mergeWorkshopFile`/`flushPart` 供 server/测试复用。
  - `workshop-api.js`：zzzmap API 客户端（与 `http.js` 的米游社客户端分工）——签名 MD5(key+参数排序)、带重试的 `fetchJson`、`apiGet`/`apiPost`；模块加载时自动启用代理（第 5 参 > 环境变量），workshop.js 与 workshop-stats.js 共用。
  - `workshop-stats.js`：工坊聚合模块（原 workshop-stats.js/grad.js 的聚合职责，2026-10 从 workshop.js 拆出）——`buildWorkshopStats`（workshop.json → workshop-stats.json，用 `iterWorkshopEntries()` generator 流式遍历，聚合函数 for...of 兼容；纯逻辑在 `lib/workshopStats.js` 的 `computeAllWorkshopStats`）+ `fetchWorkshopGrad`（grad_stat 全服占比 → workshop-grad.json，下载+聚合，`concurrency` 参数默认 6，workshop.js 调用时传 CONCURRENCY）。⚠️ 名称索引**每次调用现读 library.json**（`loadIndexes()`），不建在模块顶层——server.js 的 `?v=` 缓存爆破只作用于 workshop.js，本模块顶层索引会冻结在首次加载（同步完 library 新角色名解析不出来）；一次解析几毫秒可忽略。`scripts/rebuild-stats.mjs` 直接从这里取函数（不再经 workshop.js）。
  - `workshop-static.js`：逆向提取的静态数据表（2026-10 由 `workshop-static.json` 并入并裁剪——rolebase 只留 4/14 字段、suits 只留 `SetBonusProps`、weapons 只留 `MainStat`/`SecondaryStat`、items 两字段全用，102KB → 68.5KB），`workshop.js` 加载用；游戏数据更新后需重新提取；数据体已入 `.prettierignore` 保持紧凑单行。
- **`src/web/`（浏览器端 ESM，无构建）**
  - `main.js`：入口，`fetch('/api/data')` → `setData()` → `setCalcContext(dataCtx)` → `initUi()`。
  - `data.js`：数据层。`export let` 活绑定（live binding），`setData` 重新赋值后各 import 方自动读到新值。维护索引、用户配置（目标/有效词条/行列序/视图）。
  - `util.js`：浏览器端工具（`apiRequest` 带超时，`opts.timeout: 0` 关闭超时供数小时的长同步请求用——默认 180s 硬超时会误报失败而服务端仍在继续 / `postJSON`，供 data/ui 复用）。
  - `shared.js`：浏览器端共享渲染辅助（纯 HTML 字符串，无 DOM/数据层依赖）：驱动盘 2/4 件套悬浮 `discSetEffectsHtml`、富文本条目 `richItemHtml`、技能图标 `skillIcon`/`skillIconForType`、全局注册 `registerZZZ`。
  - `render.js`：渲染层。「我的角色」视图容器（卡片/汇总二级子页面：`myTab`/`setMyTab`/`myCharsShell`/`resolveView`，兼容旧 `card`/`table` 视图值）+ 卡片/汇总表格渲染、悬浮提示（`data-detail` 属性 + 全局 mouseover 委托）、行/列拖拽排序、表头点击排序。**汇总表属性格悬浮「计算详情」**（`statDetailHtml`：当前/目标达成率 + 基础→加成→最终分解 + `R.sources` 来源明细 + 账号实测差异）。驱动盘图标优先用圆形光盘（`Disc.roundIcon`，wiki 提取，fallback 账号 icon / library icon）。**内联 `onclick` 引用的函数必须挂到 `window`**（`ui.js` 里注册 `openNote`/`openTargetSettings`）。
  - `wiki.js`：数据库视图，四个子面板（角色/音擎/驱动盘/邦布），表头三态排序（升→降→默认）。**新增子面板 = `TABS` + `PANEL_RENDERERS` 各加一项**，渲染函数返回 `table(headers, rows, sortable)` 即自动获得排序、`data-detail` 悬浮、`.wiki-table` 样式。排序统一走 `lib/sort.js` 的 `createSort`（与 `render.js` 统计表、`ui.js` 方案表、`discstats.js` 四处同构）。子面板切换走 `window.ZZZ.wikiTab()`（注册在 `ui.js`）。
  - `ui.js`：交互层。同步按钮（经服务器）、目标/有效/备注弹窗、事件绑定、同步进度轮询（300ms 查 `/api/sync-progress`）。
  - `charts.js`：ECharts 图表辅助（依赖 index.html 引入的本地 vendor `src/vendor/echarts.min.js`（5.5.0），`window.echarts`）。主题色 `CHART_COLORS`（匹配项目暗色+金色）+ 半透明变体 `SOFT` + 公共片段（`AXIS_LINE`/`AXIS_LABEL`/`AXIS_LABEL_SMALL`/`SPLIT_LINE`/`CHART_LEGEND`/`CHART_TITLE`/`CHART_SUBTITLE`/`DARK_TOOLTIP`）——**所有图表统一引用这些基座，禁止硬编码色值**；`registerChart`/`clearCharts`/`mountCharts`/`chartBox` 渲染挂载机制（**页面 resize 自动重排已挂载图表**，防抖 150ms）+ 各图表 option 构建函数（达标热力/共识度大图（每属性子图）/小提琴箱线/2D 密度散点/**`tierRichOption`（推荐三档 × 玩家分布：每属性 4 行——玩家 P10-P90 / 三档 median±sd 用 markArea 区间、我的值金色竖线+百分位；x 轴显式开启数值轴 axisPointer 竖线（默认样式，与技能分布图一致）+ 透明辅助系列提供悬浮数值锚点）**/**练度图**：`rankPyramidOption`（影画金字塔堆叠，0 影深青 1 蓝灰 2 蓝 3 绿 4 金 5 橙 6 红）、`relicBarOption`（装配评分箱线）、`skillDistOption`（技能等级分布子图，我的等级柱高亮）、`rankRelicGapOption`（影画×评分：每角色 6影 median−0影 median 横向条）、**`scoreRelicOption`（D9 评分×毕业度：每角色 relic_point × 加权效率分皮尔逊 r 横向条，绿 ≥0.90 / 金 ≥0.80 / 橙 <0.80；**按 r 降序传入**——类目轴首项画在底部，最脱节的角色才落在图顶）**/**驱动盘图**：`discMain456Option`（456 堆叠）/`discSubsOption`/`discComboOption`/`mainSubCrossOption`（主词条×副词条协同热力，4/5/6 槽并排，色=条件频率）**（D7 全盘「套装 × 槽位交叉」热力图 `discSlotHeatOption` 已于 2026-10 删除）/读数参考线 `attachReadLine`（option 带 readLine 标记启用：小提琴图鼠标在子图内任意位置显示灰色横虚线 + y 轴数值标签，空白处 showTip 显示对应密度区间，`graphic` + 原生 DOM mousemove 实现）**。视觉统一项目主题。
  - `recommend.js`：「统计」视图容器，**四个**子面板（角色面板/驱动盘/全服总览/待定），仿 `wiki.js` 的 `TABS` + `PANEL_RENDERERS` 键控分发 + 共享排序（`recSort`/`toggleRecommendSort`）。子面板切换走 `window.ZZZ.recommendTab()`（注册在 `ui.js`）。「全服总览」（原「角色总览」+「练度总览」合并）：**共识度散点大图**（每属性一子图：玩家分化 sd × 攻略分歧 CV）+ **影画×装配评分**（6影−0影中位差条）+ **评分 × 盘毕业度**（D9：每角色 `rollEfficiency[role].scoreVsRelic` 的 r 横向条，r 高=工坊评分可当毕业度代理、r 低=该角色须改看有效强化次数）+ `progressCardsHtml()`（装配评分分布箱线/影画档位金字塔/面板属性相关表（固定 7 列，不包滚动容器直接铺开））；「待定」（2026-10 新增，面板名待定）：**提升清单**（我的角色×落后属性按 缺口×落后度 排序 Top12）+ **面板达标**（按平均落后度重排行序，悬浮带缺口）+ **驱动盘毕业度**（**有效强化次数**口径：按 `rollEfficiency[role].weights` 取该角色有效副词条集合 → `Disc.getHitCount` 算我的盘次数 → 对 `discDetails.effDist` 求百分位；含主词条 vs 该角色该槽主流对照 + 替换建议列）+ **两源一致性审计**（D10：`sourceAudit` 表，角色 × 6 属性相对差，按每角色最大 \|diff\| 降序把异常顶到表首，绿 <5% / 橙 ≥5% / 红 ≥10%，表头给判源样本量与 \|diff\| 中位；已知边界「本·比格攻击力 -41.5%」写在悬浮说明里，避免每次看到都当成 bug 重查）——四卡构建在 `upgradeAndHeat`/`discMatrixCard`/`auditCard`（模块顶层），渲染在 `renderPending`；「角色面板」（**流派分析卡**（2026-10：玩家池面板 k-means 流派 + 占比堆叠条 + 典型面板表（mean/中位）+ 456 主词条/套装/音擎偏好 + 我的联动「你的面板最贴近 XX 流」）+ 玩家分布箱线（小提琴+箱线，叠加推荐三档点 + 我的）+ 推荐三档×玩家区间增强图 + 面板属性对密度散点 + **技能对标分布图**（玩家池分布子图 + 我的等级金色柱，官方 type 经 `OFFICIAL_SKILL_TYPE` 映射到 canonical） + **技能组合卡**（玩家拉满模式 Top + 我的对照，B9）+ **角色配装对标卡片**（该角色工坊实况 vs 方案推荐：`plansStats.computeRoleBuildsFromPlans` 方案侧 Top 音擎/套装（组合名经 `orderComboSets4First` 归一 4 件套在前）与 workshop-grad 实况并排 + 差异分析） + **配队亲和卡**（玩家实配队友（roleCooccurrence 同练共现）vs 攻略配队（plans team 同队成员）两口径 Top6 对比，B6），角色下拉走 `ZZZ.selectRole`）为 ECharts 图表面板，render 后由 `mountRecommendCharts` 挂载（render.js 调用）。role_id 键的 stats（relicStats/rankDist/skillStats/roleCooccurrence/rankRelic/skillCombos/rollEfficiency）经 `roleKeyedMap` 统一映射到 plans 角色名（grad 名对齐）。**所有图表卡标题用短名，详细说明放 `data-detail` 悬浮**（无原生 title 小框）。**新增统计子面板 = 上面 `TABS` + `PANEL_RENDERERS` 各加一项**。
  - `discstats.js`：「统计」视图的「驱动盘」子面板渲染层（`renderDiscStats`）。**盘为中心的「决策卡」**：顶部全盘概览条（适配角色/保留主词条/可抛弃主词条/玩家盘数，点击行切换选中盘，走 `ZZZ.selectDisc`），主体为选中盘的决策卡（编号与代码一致）——① 适配角色（官方推荐 vs 玩家实况徽章，交集金色高亮）② 可抛弃主词条（两口径都没用到的 456 候选，删除线）③ 456 号位主词条三列 + 副词条保留清单（对比条：金=官方、蓝=实况，保留/可抛弃标签）④ 槽位分布行（D7 单盘视角：CSS 柱状图 + 16.7% 均匀基准虚线，柱子按实际值域截断起画、不从 0 起，金色 = 高于基准 3 个百分点以上）。判定逻辑在 `lib/discstats.js` 的 `computeDiscAdvisor`（两口径对齐 + 共识判定，实况阈值 3%）。底部图表卡区：456 主词条占比 / 副词条频率 / 组合 Top / **主词条×副词条协同热力（mainSubCrossOption）**。
- **`server.js`**：无框架 http 服务器。路由：`POST /api/sync-base`、`POST /api/sync-characters`、`POST /api/sync-plans`、`POST /api/sync-workshop`、`GET /api/data`、`/api/config`（读写 `user-config.json`）、`/api/cookie`、`/api/cookie-status`、`/api/sync-progress`。`busy` 互斥锁防止两个同步同时写文件；四个同步 handler 共用 `runSync()` 骨架（busy 锁/进度上报/cookie 解析/错误处理）。
  - **安全姿态（2026-08 加固，勿回退）**：① **只监听回环地址** —— `data/` 下有明文米游社 cookie（`.cookie.json`）与个人账号数据，绝不能暴露到局域网；② 静态文件路由**拒绝任何以 `.` 开头的隐藏文件/目录**（`.cookie.json` / `.git` / `.claude`）；③ `/api/cookie-status` **只回 `cached: true/false`，不回传 cookie 明文**；④ 所有写请求先挡跨站来源（CSRF）——`text/plain` 属简单请求、无预检，恶意页面可静默 POST 覆盖 `user-config.json` 或写入 cookie。
  - **部署形态与环境变量（2026-08 新增）**：默认仍绑 `127.0.0.1`，行为与过去完全一致。要对外提供访问才需要改：

    | 变量 | 默认 | 说明 |
    |---|---|---|
    | `PORT` | `8719` | 监听端口 |
    | `HOST` | `127.0.0.1` | 设为 `0.0.0.0` 才对外监听；**此时 `AUTH_TOKEN` 必填，否则进程直接 `exit(1)` 拒绝启动**——「暴露」与「无鉴权」不允许同时发生 |
    | `AUTH_TOKEN` | 空 | 访问令牌。请求带 `zzz_token` cookie / `X-Auth-Token` 头 / `?token=` 均可（优先级同此顺序），比较走 `crypto.timingSafeEqual`。浏览器访问 `/login?token=<令牌>` 写入 cookie，只需一次 |
    | `ALLOWED_ORIGINS` | 空 | 逗号分隔的额外放行写请求来源，如 `https://zzz.example.com`。**部署到域名后必须设**——CSRF 校验原先硬编码 localhost，不设则所有 POST 一律 403 |
    | `NO_OPEN` | 空 | 非空则不自动开浏览器（回环绑定时也生效；非回环绑定本就不开） |

    推荐姿势：反代（Caddy/Nginx）负责 TLS，本服务仍只绑回环，令牌兜底。**`data/` 目录必须在 web 根之外**（本服务的静态路由已拒绝 `.` 开头文件，但反代直接暴露目录就绕过了这层）。
  - **同步脚本按需动态 `import()`（2026-08）**：四个 `src/sync/*` 模块改为首次用到时才加载，并按文件 `mtime` 加 `?v=` 破缓存。原先在 server 启动时静态 import，名称索引会**冻结在启动那一刻**——同步完 library 后新角色名解析不出来，必须重启服务器。
  - **`/api/data` 传输**：按五个数据文件的 `mtime+size` 组成签名做进程内缓存（任一变化即失效），配 `ETag` 协商与 `gzip`。`Cache-Control: no-cache`（不是 `no-store`）——仍走 ETag，数据没变时直接 304 空响应。⚠️ **ETag 必须是响应内容的哈希**（现为 `sha1(raw)`）：曾误写成 `dataSignature().length`，那是个恒为 132 的常数，任何数据变化都命中 304，前端永远拿到旧数据。

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
| D4 有效词条分布（毕业度） | ✅ **口径已改为「有效强化次数」**（旧「有效词条个数」99.95% 恒为 4，无区分度）：决策卡实况组合 Top + effDist；全服总览驱动盘毕业度矩阵（我的盘次数 vs 该盘 effDist 百分位 + 替换建议） |
| D5 词条组合分析 | ✅ 决策卡实况组合 Top（subCombos）；「组合画像」卡（双暴/攻击+双暴占比）已删除（2026-10） |
| D6 主词条 × 副词条协同 | ✅ 驱动盘面板 `mainSubCrossOption` 协同热力图（4/5/6 槽并排，色=条件频率） |
| D7 套装 × 槽位交叉 | ✅ 决策卡「④ 槽位分布」行（CSS 柱状图 + 16.7% 基准虚线，Y 轴按实际值域截断）；全盘「套装 × 槽位交叉」热力图已删除（2026-10） |
| D8 角色级配装画像 | ✅ `roleDiscStats` 消费于毕业度矩阵「主词条 vs 该角色该槽主流」对照 |
| D9 评分 × 盘毕业度 | ✅ 全服总览「评分 × 盘毕业度」横向条（`scoreRelicOption`，每角色 relic_point × 加权效率分皮尔逊 r，绿 ≥0.90 / 金 ≥0.80 / 橙 <0.80；配对 <30 记 null 不入图）。**实测 57 角色全部有值，r 范围 0.735（苍角）~ 0.944，中位 0.899** —— 工坊评分整体可当毕业度代理，个别低 r 角色需改看有效强化次数 |
| D10 两源一致性审计 | ✅ 全服总览「两源一致性审计」表（角色 × 6 属性相对差，按每角色最大 \|diff\| 降序，绿 <5% / 橙 ≥5% / 红 ≥10%，表头给判源样本量与 \|diff\| 中位）——2025 源面板是按复现公式算的，公式随版本失准会静默污染所有跨源聚合，此表是唯一告警面。**2026-08 首跑基线**：83 万条目判源覆盖率 100%（mys 38.1 万 / 2025 44.9 万），342 个「角色×属性」对的 \|diff\| 中位 1.00%（红 9 格 / 橙 25 格 / 绿 308 格）—— 公式整体对齐良好。唯一显著异常是**本·比格（1121）攻击力 -41.5%**：他的核心被动把防御力转化为攻击力，mys 源是游戏内实际面板（含该转化），2025 源按 `enka_attrs_mapping` 复算（**不含角色专属被动**）。这是公式的已知边界而非数据损坏，重跑审计时以此为基线——**新出现的大 diff 才是版本失准信号** |

**面板属性相关**：7 对皮尔逊相关（见「工坊数据口径」），前端「面板属性相关」表（角色 × 7 对，绿=正相关 >0.2 / 红=负相关 <-0.2 / 灰=无关系）。

## 关键约定与坑

- **属性名归一化**：wiki 页面各角色用词不一（生命/生命力→生命值、攻击→攻击力、防御→防御力；短名 暴击→暴击率、暴伤→暴击伤害；命破角色 贯穿力→穿透率、闪能自动积累/累积/累计→能量自动回复），`util.js` 的 `normalizeStatKey(s)` 统一映射（别名表 `STAT_ALIASES`，新增别名要同步补测试）；`models.js` 构造时对 `maxLevel` 调 `normalizeStatKeys`。改数据读写时注意保持这一约定。
- **技能类型编号三套体系（统一 canonical，见 `constants.js` 的 `SKILL_TYPES`）**：canonical = 0普攻/1闪避/2支援/3特殊/4终结/5核心（6 项，游戏 2.0 技能槽顺序；**无独立「连携」**——连携技与终结技同槽共享等级）。① 官方（characters.json 账号数据）与**工坊 mys 源**：0普攻/1特殊技/2闪避/3终结+连携(共享等级)/5核心/6支援技 → `OFFICIAL_SKILL_TYPE`（官方 1→3、2→1、3→4、6→2）；② **工坊 2025 源**（游戏内嵌原始，1.x 技能 ID）：0普攻/1闪避/2特殊技/3连携/5核心/6终结 → `WS2025_SKILL_TYPE`（1→1、2→3、3→4 连携并入终结、6→4）。**mys 与 2025 语义不同，聚合必须按源区分**：`extractBuild` 写时固化 `source: 'mys' | '2025'` 字段，computeSkillStats 优先读它；旧数据（无 source）回退 skills 数组第 2 位 type 判别（mys 数组按 UI 顺序 [0,2,6,...]、2025 按 ID 顺序 [0,1,2,...]），数组不足 2 个仍无法判源则跳过该条（不贡献技能统计）。「我的角色」视图（render.js skillOrder [0,2,1,6,3,5] + shared.skillIconForType）内部用官方语义自洽，但**跨源匹配必须经 OFFICIAL_SKILL_TYPE 映射**（否则 1↔2 互换、终结/支援错位）。plans.json 的 skills type 也是官方语义（目前前端无消费点，未归一化）。
- **图片资源：永远不要用工坊（`api.zzzmap.com`）的图片资源**。所有图片一律用官方 wiki（米游社 `act-upload.mihoyo.com` 等）数据源的图片，本地化到 `data/img/` 后使用。工坊图片仅用于参考定位接口/字段，禁止直接引用其图片 URL 或写入数据。
- **工坊 API 风控与性能**：排名收集阶段角色级 `pool` 并发 + **每角色 7 影画组内并行翻页**（`fetchRankRows`，实测 6.4× 提速）；v3 配装请求默认 6 并发（`pool`，第 4 个命令行参数可调，响应大吃带宽，注意限流），**不要加串行限速**。接口硬性每页 50 条（limit 参数无效）。**IP 被封时用代理换 IP**：`node src/sync/workshop.js 57 300 6 <proxy>`（第 5 参）或设 `HTTPS_PROXY`/`ALL_PROXY` 环境变量（仅 api.zzzmap.com 走代理，其余请求不受影响；实现见 `src/sync/proxy.js`，零依赖，HTTP CONNECT/SOCKS5/认证均支持；Node 24+ 也可用原生 `node --use-env-proxy`）。
- **2025 源面板**：工坊 `user_role/v3` 返回两种玩家数据源——mys（工坊格式化，面板现成）与 2025（游戏内嵌原始数据，面板需按公式计算）。`workshop.js` 复现工坊 `enka_attrs_mapping`：角色基础（BaseProps + GrowthProps×(等级-1)/10000 + 突破档 + 核心强化档）、武器（MainStat×(1+0.1568×等级+0.8922×突破) + Secondary×(1+0.3×突破)）、驱动盘（主属性×等级成长系数 + 副属性×词条等级）、套装 2 件套加成（≥2 件），输出与 mys 源一致的 `panel`（`base/add/final`，百分比为小数）。
- **工坊静态表**：`src/sync/workshop-static.js` 是逆向提取的静态数据（角色基础/武器/装备/套装，2026-10 由 `workshop-static.json` 并入并裁剪为实际消费字段），`workshop.js` 加载用；游戏数据更新后需重新提取。
- **名字匹配**：统一走 `src/lib/names.js` 的 resolver（`buildNameIndex` + `resolveName`/`resolveEntry`），以 `library.json` 为标准名权威源；别名/罗马数字/括号/空白/简称差异（工坊 nick_name、wiki 改名、配队空格等）在**同步写时**已固化到标准名，消费端按标准名精确匹配 + resolver 别名兜底（例：wiki 2026-10 把驱动盘「棘刺玫瑰」改名「荆棘玫瑰」，library 键随之变化，`ALIASES` 存旧名→新名映射兼容历史数据）。
- **百分比与固定值**：值 `<= 1` 视为百分比（如 0.3 = 30%），用 `formatValue` 展示；主/副词条用**数组**保存（同一盘可同时有「攻击力%」和「攻击力固定」）。
- **最终面板**：账号接口真实值（`panel`）优先显示；缺失时用「wiki 基础值 + 装备」推算补齐。推算未计 4 件套条件效果/核心被动，与实际可能有出入——这是刻意设计。
- **游戏富文本**：`renderRichText()` 把游戏标记 `<color=#HEX>` 转 `<span style="color">`、字面 `\n` 转 `<br>`，并清除 `<script>` 与 `on*` 属性。所有来自数据的悬浮内容先过 `escapeHtml()` 再放 `data-detail`。
- **有效副词条默认值**：未手动配置时用游戏推荐 `equipPlan.plan_effective_property_list`（`web/data.js` 的 `readValidStats`）；手动保存（含清空）后覆盖默认。
- **测试依赖真实数据文件**：`data/` 不入版本库，测试通过 `test/helpers.js` 的 `loadDataFile()` 读取；数据缺失/损坏时**打印醒目 SKIP 横幅**说明「本文件的测试未运行」再 `process.exit(0)`（`node --test` 每文件独立子进程，不影响其他文件）。⚠️ 早期只打一行提示就退出，`node --test` 会把这种文件记成 `pass 1`，与真正全绿**肉眼无法区分**——CI 里请用 `REQUIRE_DATA=1 npm test`，缺数据直接 `exit 1`。`extract.test.js` 用 `raw-library.json` 做数据就绪检查，提取逻辑用内联账号响应 fixture。**新增测试文件记得加进 package.json 的 test 脚本**（Node 20 的 `--test` 不支持 glob，且会把 `test/` 下所有 JS 当测试文件）。驱动盘套装统计类逻辑可仿 `test/calc.test.js` 的「2 件套需同套装 ≥2 件才生效」测试：内联假盘 `{set, slot, mainStats, subStats}` 构造 + 顶层 `setCalcContext` 注入上下文。
- **Node 单次读取上限 2 GiB**：`fs.readFileSync` 对 >2 GiB 的文件抛 `ERR_FS_FILE_TOO_LARGE`，即使按 `'utf8'` 读也会先撞 `ERR_STRING_TOO_LONG`——而 `data/workshop.json` 已达 2.08 GiB。**任何针对 workshop.json 的读取都必须流式或定长 `fs.readSync`**。曾因此踩坑两处（均已修）：`scripts/clean-workshop.mjs` 整文件读入直接崩溃、脚本完全不可用；`scripts/rebuild-stats.mjs` 为取头部 256 字符而整文件读入，异常被 `catch` 吞掉导致 `meta.entries` 静默写成 `-1`。
- **workshop.json 的两类损坏（均已修复并有回归测试 `test/workshop-merge.test.js`）**：① 写入侧 `copyEntriesTo` 与调用方各写一次 `[`，落盘成 `"entries":[[…`——**不是合法 JSON**，只因 `streamJsonArrayElements` 解析宽松才长期没暴露（2026-08 已把存量文件的多余 `[` 就地改成空格修复，829,891 条零丢失）。注意修的是**第二个** `[`：读取器靠字面量 `"entries":[` 定位数组起点，改第一个会变成 `"entries": [` 导致读出 0 条。② 跨块 `toString('utf8')` 把中文截成 U+FFFD。**U+FFFD 是合法 UTF-8 编码（EF BF BD）**，字节级合法性校验一条也抓不到，检测乱码必须直接查字面量 `'�'`。

## 已知说明

- 属性键名统一为 生命值/攻击力/防御力；个别新角色 wiki 无满级行，其面板依赖账号实际值。
- 部分角色接口未返回 `equipPlan`（约 18 个），无游戏推荐默认有效属性，需手动配置。
- 推荐套装与 456 主属性**不在**账号数据的 `equipPlan` 里——`equipPlan`（`a.equip_plan_info` 原样存储）只含有效副词条 `plan_effective_property_list`（消费见 `web/data.js` 的 `readValidStats`：`full_name` 含「百分比」则 `name+'%'`，再过 `SUBSTAT_TYPE_SET`）。推荐套装/主属性在 `plans.json`。
- `library.json` 的 `discs` 区**键即套装名**（条目内 `name === key`），套装:条目 = **1:1**（一个套装 = 一条目，6 个槽位收在 `slotMainStats`，不是每块盘一条）；`set4` 恒为 `null`（四件套只有 `set4Text` HTML，无结构化数值），仅 `set2` 被解析成 `{属性: 数值}`。账号侧每块盘 `set` = `e.equip_suit?.name` + `slot`(1-6)，空槽补 `未佩戴驱动盘`。
- 路由统一用 ASCII，避免中文路径被浏览器百分号编码后匹配失败（server.js 注释）。
- eslint 按文件划分全局：`src/web/**`=browser；`server.js`/`src/sync/**`/`src/lib/node.js`/`test/**`=node；`src/lib/util.js`/`schema.js`/`calc.js`=两者；`src/lib/` 其余纯逻辑模块（sort/workshopStats/discstats/plansStats/panelBench/distStats/names）无全局，落在基础块。`eslint.config.js` ignores 含 `src/vendor/**`（本地 ECharts 压缩包）。
- 工坊配装数据：`data/workshop.json`（2.13GB 全角色玩家配装实例，音擎/驱动盘/面板/技能齐全）、`data/workshop-grad.json`（57 角色最常用音擎/驱动盘套装）、`data/workshop-stats.json`（聚合，无 abyssStats/无 playerProfiles）、`data/workshop-weights.json`（角色默认流派权重）。全部由 `node src/sync/workshop.js` 一步同步生成；server「更新工坊配装」调 `fetchWorkshopData` 同样一步更新。**口径：workshop-grad 是全服真实累计占比（工坊 `grad_stat` 接口）；workshop-stats 基于 workshop.json（上榜 uid 池的完整角色池）聚合，画像按玩家真实样本统计 min/max/mean/median，不当作全服分布。**
- 驱动盘圆形图标：`library.discs[name].roundIcon`（wiki 从驱动盘页 modules 提取——出现次数最多的图片即圆形光盘，6 个尺寸变体），「我的角色」卡片/汇总视图优先使用；`icon` 为方形套装图。
- **视觉体系（style.css，2026-10 重构为「街头硬边」风）**：炭黑基底 + 警示黄（绝区零招牌黄黑警示带），无蓝色调。`:root` 令牌统一驱动——新规范名 `--hazard`/`--hazard-lt`/`--hazard-dk`/`--hazard-rgb`/`--grad-hazard`；**旧名 `--acc`/`--acc2`/`--acc-deep`/`--acc-rgb`/`--grad-gold` 保留为别名**（JS 内联 `style="color:var(--acc)"` 等 52 处引用零改动继续工作）。字体：西文/数字展示体 Barlow Condensed（模板字描边标题，`src/fonts/` 本地打包）+ 中文 Noto Sans SC 可变体（17MB，`scripts/fetch-fonts.mjs` 可重下，OFL 许可）。约定：招牌元素 = 黄黑警示斜纹带（header 顶条/卡片顶条/弹窗标题条）、斜切硬边（按钮/分段导航 clip-path 切角）、四角括号（卡片/弹窗框）、图章贴纸（`.stamp` 达成/缺口/已毕业 + 角色卡右上角达成率大字 `.stamp-wrap .rate`）、噪点 + 扫描线全局质感；tab = 斜切分段（header `.seg .view-tab` 带编号、二级 `.wiki-tab`）；表格 = 吸顶压缩体大写表头 + 黄黑底线 + hover 整行从下而上渐渐变淡的黄色渐变高亮（无斑马纹）；进度条 `.tbar/.tfill` = 分段警示条（填充色由 `calc.js` 的 `rateColor` 内联，绿 ≥97%/黄 90-97%/红 <90）；弹窗 = 警示标题条 + 角括号 + 毛玻璃遮罩；悬浮 `.tip` = 左缘警示条；滚动条 = 渐变 thumb（hover 黄）；图表卡标题 = 黄条标签 + 压缩体大写（`.chart-card h3::before`）；动效 = `cardIn`（卡片入场，`--i` 错峰）/`viewIn`（面板淡入）。`charts.js` 的 `CHART_COLORS` 与 CSS 变量保持同色系。视觉原型页 `prototype.html`（仓库根，静态设计稿）保留作设计参考。

## 后续方向（未实现，按价值排序）

- **提升清单归因分级**：现有提升清单加「装备可解/抽卡可解/养成耗时」归因分类（蓝图 P1 完整版）。
- **评分仪表盘**：我的角色评分 → relicStats 百分位（沿用 approxPercentile）。
- **同段位配装学习**（蓝图 P2）：玩家池按评分分 P25/P50/P75 段，展示高段玩家音擎/套装/456 主词条偏好 vs 我的差异。
- **加权效率分卡片**：`rollEfficiency` 目前只被毕业度矩阵用来取「有效副词条集合」、被 D9 卡用来取 `scoreVsRelic`，尚未渲染「我的分 vs 玩家池分布百分位 + 短板槽（slotEff）」这张最有价值的卡。实测 `slotEff` 已有明确结构：1/2/3 槽有效强化次数均值 5.1-5.9，4/5/6 槽仅 4.4-4.8（主词条槽挤占副词条空间）。

## 变更记录（2026-09 ~ 2026-10）

- **2026-08（代码审计整改·第二轮：正确性 + 部署就绪）**：
  - **P0 数据污染 `computeRoleStyles` 下标错位**：簇的 `main`/`suits`/`wengine` 用 `o.samples[i]` 取值，但 `i` 来自 k-means 的 assign，是**过滤后**数组 `valid` 的下标——「首个被过滤样本」之后的全部样本整体错位一格。实测 23/57 角色有样本被过滤，最坏一例污染该角色 92.8% 的归属；且 `label` 由 `main4[0]` 推出 → **簇名也是错的**。修为一律索引 `valid`。⚠️ 代码已修，但**已落盘的 `workshop-stats.json` 里仍是错值，需跑 `npm run rebuild:stats` 重算**。回归测试特意把被过滤样本**插在中间**（追加到末尾时下标会巧合对齐、测不出 bug），并锚定 `st.panel`（由 P/valid 算出，修前修后都对）而非 `st.main`（错值之间彼此自洽，用它反推期望值 = 测试永远绿）。
  - **`fetchWorkshopGrad` 空结果覆盖**：57 个角色全部抓取失败（风控/断网）时仍无条件写文件，把好数据覆盖成空数组。改为全失败则抛错保留原文件、部分失败记 `meta.failed` 并告警；三个产物写入统一改**原子写**（tmp+rename），避免写一半崩溃留下半截 JSON。`fetchWorkshopData` 里的 grad 调用包 try/catch——它是数小时爬取后的最后一步，不该让整轮同步报失败。
  - **`library.js` `parseFloat` NaN 判空**：正则不匹配时 `parseFloat(undefined) === NaN`，而 `NaN != null` 为 **true**，会提前 return 并写出 `baseAtk: NaN`（JSON 序列化成 `null`），下方的 attr 兜底分支永远走不到；schema 也拦不住（`typeof NaN === 'number'`）。改用 `Number.isFinite`。
  - **聚合器脏数据容错**：15 个累加器里有 2 个（`makeWorkshopStatsAcc` / `makeRoleStylesAcc`）缺 null 守卫。单条脏数据抛异常 = 2.13GB 全量重算（约 4 分钟）零产出，与其余累加器的姿态不一致，补齐。
  - **删除 `rankLayers` 死载荷**：无任何前端消费，却占 `workshop-stats.json` 348 KB / 17.7%（1.91 MB → 1.58 MB）。纯函数与测试保留备用。⚠️ 另 4 个模块（panelRange/teamStats/wengineStats/gradStats）本文档记为「保留模块与测试」，**故意未删**。
  - **部署就绪五件**（环境变量表见「安全姿态」小节）：`HOST` / `AUTH_TOKEN`（`timingSafeEqual` 比较 + `/login` 写 cookie，非回环绑定缺令牌则拒绝启动）/ `ALLOWED_ORIGINS`（原 CSRF 校验硬编码 localhost，部署到域名后所有 POST 一律 403）/ `NO_OPEN`；同步模块改按 `mtime` 破缓存的动态 `import()`（原静态 import 把名称索引冻结在启动那一刻，同步完 library 必须重启服务器）；ETag 由恒为 132 的 `dataSignature().length` 改为 `sha1(raw)`（原实现下数据变了也一直 304）；busy 锁加 6h 自愈；SIGTERM/SIGINT 优雅关闭 + 10s 兜底强退。
  - **前端健壮性三项**：① `main.js` 顶层 `await fetch` 包 try/catch（原先服务器没起 = 页面永久空白且无提示，`!res.ok` 覆盖不到连接被拒/离线/JSON 截断），401 单独提示走 `/login`；② `saveUserConfig` 原先**既不 await 也不看返回值**，而 `postJSON` 失败时**返回 null 而不抛**——目标/有效词条/行列序保存失败时毫无提示、刷新即丢；改为 await + 查 `ok` + 失败弹提示，四处「已保存」toast 改为仅在真成功时弹（`notify` 因此从 `ui.js` 上移到 `util.js`：`data.js` 也要用它，而 `ui.js → data.js` 已是单向依赖，反向 import 会成环）；③ ECharts 实例回收 `pruneDetachedCharts` 改由 `render()` 在清空 grid 后**无条件调用**（原先只挂在 `mountCharts` 末尾，从「统计」切到「数据库」/「我的角色」时 render 提前 return 根本走不到，来回切视图 = 每次泄漏一整套 canvas）。
  - **请求体错误码**：非法 JSON / 请求体超 4 MB 原先一律走顶层 catch 回 **500** 并打一条带栈的 `console.error`——这是调用方的错、且**可被外部任意触发**（日志噪音）。改为 `badRequest(status, msg)` 打 `e.status` 标记，顶层按标记回 400/413 且不打栈。另：超限分支原用 `req.destroy()`，socket 立刻拆掉导致 413 响应根本发不出去（客户端只看到连接重置），改为 `req.pause()`。
  - **文档纠错**：端口 8718 → **8719**（代码一直是 8719）；`kmeans` 已被 `computeRoleStyles` 实际消费，不再是「仅测试」；单遍历累加器 14 项 → **15 项**。
  - 单测 187 → **190**（新增：流派簇下标同源、脏条目不中断聚合、`computeAllWorkshopStats` 与逐个公开函数**逐位相等**——该不变式此前只写在文件头注释里、从未被测试覆盖）。`REQUIRE_DATA=1 npm test` 全绿 0 skip，`npm run lint` 干净。

- **2026-10（流派分析）**：新增角色流派聚类聚合 `roleStyles`（workshopStats.js 的 `computeRoleStyles`/`makeRoleStylesAcc`，挂进 computeAllWorkshopStats 单遍历）——**聚类属性池按角色定位（trait）选**（击破含冲击力、异常含精通/掌控、命破/防护含生命防御、支援含攻击生命；traits 由 buildWorkshopStats 经 roleNameMap+library 构造传入，无定位回退通用池）+ **数据驱动去噪**（cv<0.04 的列 = 玩家无分化，剔除；保底 3 维）后 z-score + k-means k=3（确定性初始化可复现；试验验证 k=4 出噪声簇故固定 3；每角色样本上限 2 万、<200 不聚类；4 号位主词条是强判别信号），每簇输出 share/label/面板 mean+median/456 主词条 Top2/套装 Top2/音擎 Top2（实测 57 角色 95.5KB，总文件 1.91MB < 2MB）。命名 `styleLabel`（4 号位取向+6 号位取向，如「暴伤·攻击」「精通·异常」；同名簇按面板 z 追加「冰伤高」等消歧）；`styleMatch` 供前端「我的角色联动」标注最贴近流派。前端「统计 → 角色面板」新增流派分析卡（占比堆叠条 + 典型面板表 + 456/套装/音擎偏好 + 我的对照列）。⚠️ 暴伤等百分比聚合值为小数（mys "165.2%"→1.652），显示按值 ≤3 判百分比。单测 5 项（styleLabel/styleAttrShort/styleMatch/computeRoleStyles ×2，含 trait 属性池与去噪用例）。
- **2026-10（驱动盘面板精简）**：删除决策卡底部「组合画像」卡（A5 双暴/攻击+双暴占比）；subCombos 消费保留在「词条组合 Top」卡。驱动盘面板底部图表卡区现为 456 主词条占比 / 副词条频率 / 词条组合 Top / 主词条×副词条协同。
- **2026-10（统计面板重组「待定」）**：统计视图新增第四子面板「待定」（标签名待定，随时可改），全服总览的 提升清单/面板达标（达标热力）/驱动盘毕业度/两源一致性审计 四张卡移入；全服总览只保留 共识度散点/影画×评分/评分×盘毕业度/练度总览。重构：四卡构建抽为模块顶层函数 `upgradeAndHeat`/`discMatrixCard`/`auditCard`，新面板渲染走 `renderPending`（TABS/PANEL_RENDERERS 各加一项）；达标热力 chartBox key 改 `pending-heat`。
- **2026-10（决策卡与卡片微调轮）**：删除「套装 × 槽位交叉」全盘热力图（`discSlotHeatOption`/`slotCrossCardHtml` 连同 charts.js 函数一并移除，D7 仅保留决策卡④槽位分布）；决策卡④槽位分布由纯文字改为 CSS 柱状图（Y 轴按实际值域截断、不从 0 起，中性 `--dim` 虚线标 16.7% 基准，⚠️ 基准线 bottom 必须直接写 `var(--base)`，`calc(var(--base) * 1%)` 会把百分比再乘 0.01 贴底）；决策卡 h4 小标题 14→17px；弹窗关闭钮改 `position: sticky; float: right`（内容滚动时固定右上）；角色卡高度压缩（主词条并入盘块首行、技能 6 格单行竖排、影画/觉醒横排一行、最终面板「理论值」仅实测≠推算时同行小字、其余移入数值格悬浮，卡片总高约降 40%）。
- **2026-10（视觉体系重构「街头硬边」风）**：抛弃旧灰调+琥珀金表现层，全新风格落地——炭黑 `#0a0a0a` + 警示黄 `#ffd400` + 米白文字；本地打包 Barlow Condensed（西文展示体）+ Noto Sans SC 可变体（`src/fonts/`，OFL）；style.css 全量重写（黄黑警示带/斜切硬边/四角括号/图章贴纸/噪点+扫描线质感/分段警示进度条/压缩体大写表头）；index.html header 重构（警示带 + 模板字品牌区 + 01/02/03 编号斜切导航，`.view-tab` 绑定与全部弹窗 ID 不变）；render.js 角色卡右上角新增达成率大字 + 图章（移除面板区重复「总 X%」）；charts.js 主题换新（CHART_COLORS/SOFT/硬编码色值对齐新调色板）；旧 CSS 变量名 `--acc`/`--acc2`/`--grad-gold` 等保留为别名使 JS 内联样式零改动。数据/逻辑/交互零改动，182 单测全绿。视觉原型 `prototype.html` 保留作设计参考；`scripts/fetch-fonts.mjs` 可重下字体（手写 CONNECT 隧道走本地代理，绕过 Windows Schannel 沙箱限制）。
- **2026-08（D7/D9/D10 前端化）**：三项此前「只有聚合、没有渲染层」的指标补齐——D7 驱动盘面板加「套装 × 槽位交叉」热力图（30 套装 × 6 槽，行内归一）+ 决策卡「④ 槽位分布」行；D9 全服总览加「评分 × 盘毕业度」相关条（57 角色全部有值，r 0.735-0.944 中位 0.899）；D10 全服总览加「两源一致性审计」表（异常排表首，绿/橙/红三级，本·比格 -41.5% 的成因写进悬浮说明）。新增 `discSlotHeatOption`/`scoreRelicOption` 两个 option 构建函数。**热力图色标定标注意**：槽位占比真实离散度只有 16.7%±7 个百分点，visualMap 必须收到 9-24.4 才看得出差异，用 0-100 会整张糊平。

- **2026-08（统计指标去退化整改）**：删除 `completeness` 聚合与「完成度矩阵」卡（三个维度实测全部退化：音擎60 与盘满级在精英池里恒为 1，评分≥P75 占比被分位数定义锁死在 0.2500-0.2517，是恒真式而非统计量）；`effDist` 由「有效**词条个数**」改为「有效**强化次数**」口径（旧口径 99.95% 恒为 4），新增 `substatRolls`/`buildRoleSubstatWeights`，有效集合按角色流派权重区分；源判别 `sourceOf` 改以 `equips[].rarity` 类型为主路径（可判率 100%，旧的 skills 数组顺序法误判 0.080% 降为末位兜底）；新增 `computeRollEfficiency`（加权词条效率分，`workshop-weights.json` 的首个消费方，含 D9 `scoreVsRelic`）与 `computeSourceAudit`（D10 两源审计），`discDetails` 补 `slotDist`（D7）；修 `recommend.js` 两个既存 bug——毕业度矩阵读 `calculateCharacter` 返回值上不存在的 `.discs` 导致该卡从未渲染过、百分位方向写反（越差的盘显示「优于越多玩家」）。

- **2026-08（代码审计整改）**：安全——server 只监听回环、静态路由拒绝 `.` 开头隐藏文件、cookie 明文不再回传、写请求加 CSRF 来源校验；性能——`/api/data` mtime 缓存 + ETag/304 + gzip，`buildWorkshopStats` 由 13 次全文件遍历合并为 `computeAllWorkshopStats` 单遍历（省约 5.8 分钟 I/O），前端修 ECharts 脱离实例泄漏、`roleKeyedMap` 改 WeakMap（原单槽缓存实测命中率 0%）、`computeRecTierStats` 结果缓存（原每次渲染 ~102ms）；正确性——修 `data-detail` 悬浮被内联 `style="…"` 的引号提前截断、驱动盘属性库为空时统计视图白屏、`render()` 换 DOM 后悬浮框不消失；数据——存量 `workshop.json` 的多余 `[` 就地修复为合法 JSON（829,891 条零丢失），写入侧 bug 补回归测试 `test/workshop-merge.test.js`；工程——`test/helpers.js` 缺数据由「静默记 pass」改为 SKIP 横幅 + `REQUIRE_DATA=1` 可判失败，`computeWorkshopStats` 补齐首批单测，根目录 `scripts-*.mjs` 迁入 `scripts/` 并修其 2 GiB 读取崩溃/静默失败。

- **2026-10（第二批可视化）**：新增 4 聚合（roleCooccurrence/completeness/rankRelic/skillCombos）+ 9 张新卡/图——全服总览：提升清单（缺口×落后度排序）、达标热力图按落后度重排+缺口悬浮、驱动盘毕业度矩阵升级（主词条主流对照+替换建议）、完成度矩阵、影画×装配评分条；角色面板：技能组合卡（拉满模式+我的对照）、配队亲和卡（玩家实配 vs 攻略配队两口径）；驱动盘面板：主词条×副词条协同热力图、组合画像（双暴/攻击+双暴）。**（completeness / 完成度矩阵已于 2026-08 整改中删除，见上）**
- **2026-10**：视觉体系全面升级（灰调去蓝 + 琥珀金，见「视觉体系」）；统计视图精简：深渊配队/深渊统计/影画收益图/技能 P90 热力/玩家生态图删除；「角色总览」+「练度总览」合并为「全服总览」；图表标题短名 + 悬浮说明；共识度散点合并为多子图大图；装配评分改箱线图；面板属性相关扩为 7 对；汇总表属性格悬浮计算详情；驱动盘 wiki 改名「棘刺玫瑰→荆棘玫瑰」（names.js ALIASES）；playerProfiles 聚合/产出/数据字段移除。
- **2026-09**：深渊数据（爬取/聚合/workshop-abyss.json/前端面板）全部移除。
- **2026-08**：工坊爬取口径改为排行榜全量 uid（高练度标杆池）；技能练度/驱动盘两源同构提取；练度指标聚合（relicStats/rankLayers/rankDist/skillStats/roleDiscStats）；驱动盘决策卡；统计视图图表面板体系成型。

- **2026-10（成长极限模拟）**：新增「模拟」视图（header 04，`VIEWS.SIMULATE`）：选定角色/音擎/二件套/四件套/456 主词条后，按 S 级满级盘（4 副词条槽、总强化次数 9、单条最多 6 次）把副词条强化次数在任意两个面板属性之间分配，绘制帕累托有效前沿；支持临时叠加多张图、叠加「我的面板」实测点。纯计算在 src/lib/simulate.js（simulateFrontier/simulateFixedPanel，双端共享），渲染在 src/web/simulate.js（复用 charts.js 注册/挂载机制），测试 test/simulate.test.js 加入 npm test。口径：4 件套条件效果与音擎被动不计入面板；其余副词条槽视为废词条，故该前沿是「两属性成长极限」而非三属性同时最优。

- **2026-10（成长极限模拟 · 三维）**：模拟视图新增「添加三维图」按钮；引入 echarts-gl@2.1.0（`src/vendor/echarts-gl.min.js`，index.html 在 echarts 后加载），`src/lib/simulate.js` 增加 `simulateFrontier3D`（三维帕累托曲面，按第一维降序 + 后两维 2D 前沿剪枝，避免全量两两比较），`src/web/simulate.js` 增加 X/Y/Z 三轴选择与 scatter3D 渲染，可拖拽旋转。二维图轴改为 `scale:true` 自适应裁切。全量测试 197 项。
- **2026-10（全服总览角色拥有率）**：全服总览新增「角色拥有率」横向条（roleOwnership 聚合：workshop.json 样本池去重 uid 中拥有该角色的占比，累加器 makeRoleOwnershipAcc 挂进 computeAllWorkshopStats 单遍历，computeRoleOwnership 公开函数 + 逐位相等接线，meta.poolUids 记池大小，workshop-stats.json 重新生成）。

- **2026-11（全仓库精简优化）**：删除全部生产死代码并收紧静态资源传输——
  - **删 4 个「仅测试」模块及测试**：gradStats.js / panelRange.js / teamStats.js / wengineStats.js（2026-08 曾记录「保留模块与测试」，本轮按「全仓库精简」一次性清掉；前端消费均直接读 workshopGrad.roles 等产出，不经这些模块）；package.json test 脚本同步移除 4 个测试文件。
  - **删死函数**：distStats.computePowerScore / tierFit（仅测试）、panelBench 的 traitKeyStats / computeRecHighStats / buildPanelBenchmark（仅测试，保留生产消费的 computeRecTierStats）、util.buildIndex / lookup（业务早已收敛到 names.js）、shared.SKILL_LABEL、data.saveValidStats（并入目标配置）、simulate.SUBSTAT_ROLL_VALUES（从未被引用）。
  - **computeRankLayers 彻底移除**：2026-08 已把 rankLayers 从 workshop-stats.json 产出剥离，但累加器仍留在 computeAllWorkshopStats 单遍历里逐条计算（纯浪费：每次 2.13GB 聚合白算一整套轻量分布）。本轮连函数 + 累加器 + 接线一并删除，聚合峰值内存与耗时下降；其余 15 个累加器输出不变（逐位相等测试通过）。
  - **静态资源协商缓存（server.js）**：静态文件由 Cache-Control: no-store 改为 no-cache + Last-Modified / If-Modified-Since 条件请求——字体/echarts 等约 19MB 静态资源刷新时不再全量重下，未变则回 304；文件一变 Last-Modified 即变，新鲜度与 no-store 等价。/api/data 的 ETag 协商不受影响。
  - **静态资源 gzip（server.js）**：文本类静态文件（JS/CSS/HTML）按 Accept-Encoding 下发 gzip（压缩结果按 path:mtime 缓存），echarts 1MB → ~334KB；字体/图片本身已压缩不重复压。
  - **echarts-gl 按需加载（625KB）**：从 index.html 移除预载脚本，首次「添加三维图」时由 src/web/simulate.js 动态注入（ensureEchartsGl + simAddChart async），不用 3D 的用户页面不再解析这 625KB。
  - **ui.js 方案表 O(n²)→O(1)**：applyPlan 按钮的 plansList.indexOf(p) 改为预建 Map（planIndex）。
  - 测试随死代码删除相应减少；npm test 与 npm run lint 全绿。
