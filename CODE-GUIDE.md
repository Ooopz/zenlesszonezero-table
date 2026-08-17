# 绝区零配装面板 · 代码导读（CODE-GUIDE）

> 本文档是**代码层**导读：逐个文件说明「这个脚本/模块是干什么的、关键函数是什么、在整条链路里处于什么位置」，
> 并解释项目整体如何运转。面向「代码写到一半失去掌控」的开发者本人，也适合新接手者速查。
>
> 配套文档：`CLAUDE.md` 是唯一权威项目文档（数据口径、设计决策、变更记录），本文档**不重复**其内容，
> 侧重代码结构、函数清单与数据流；`CODING-STANDARDS.md` 是「怎么写代码」的强制规范（写代码时遵循它）。
> 三处文档有冲突时以代码为准（已发现的不一致见 §13）。

---

## 0. 一分钟看懂这个项目

- **它是什么**：个人用的《绝区零》角色配装面板。本地 Node 服务器 + 米游社 wiki/账号数据同步 + 无构建步骤的浏览器端 ESM。
- **技术栈**：Node 18+（自带 fetch）、原生 `http` 服务器、原生 ESM、ECharts 5.5.0（本地 vendor 单文件）。**零 runtime 依赖**（`package.json` 的 dependencies 为空，devDependencies 只有 eslint/prettier）。
- **四个数据源**，全部落到 `data/*.json`，由本地服务器 `server.js` 经 `/api/data` 提供给浏览器：
  1. **wiki 属性库**（`library.json`）——角色/音擎/驱动盘/邦布的静态基础数据，无需登录；
  2. **账号数据**（`characters.json`）——你账号里角色的真实面板/装备/技能，需要 cookie；
  3. **推荐方案**（`plans.json`）——米游社养成指南每角色的配装方案；
  4. **工坊配装**（`workshop.json` 及派生聚合）——绝区零工坊（api.zzzmap.com）全量玩家配装，用于「全服统计」。
- **核心循环**：`npm start` 起服务器 → 网页点「同步数据」→ 服务器代理抓取（账号接口 CORS 锁死，浏览器直连不了）→ 写 `data/*.json` → 前端 `fetch('/api/data')` 渲染。

---

## 1. 整体运转逻辑（主线数据流）

### 1.1 一图流

```
┌───────────────────── 抓取层 src/sync/（Node 脚本，可命令行可被 server 复用）────────────────────┐
│  library.js ──(无 cookie)──▶ data/library.json + data/raw-library.json                           │
│  characters.js ──(cookie)──▶ data/characters.json + data/.cookie.json                            │
│  plans.js ────────(cookie)──▶ data/plans.json                                                    │
│  workshop.js ────(无 cookie)▶ data/workshop.json + workshop-grad.json + workshop-stats.json      │
│                               + workshop-weights.json（一步全出）                                 │
└──────────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                       │ 写文件前经 schema 校验（warn 不中断，STRICT=1 可中断）
                                       ▼
┌────────────────────────────── 服务层 server.js（npm start）─────────────────────────────────────┐
│  GET  /api/data      → 读五个数据文件（mtime+size 签名缓存 + ETag/304 + gzip）                    │
│  POST /api/sync-base / sync-characters / sync-plans / sync-workshop                              │
│                      → runSync() 统一骨架（busy 互斥锁 + 进度上报 + cookie 解析）→ 调 fetch*      │
│  GET  /api/sync-progress / sync-status / cookie-status / config · POST /api/config /api/cookie   │
│  静态文件：index.html / src/** / style.css（拒绝 data/ 非 img 与一切隐藏文件）                     │
└──────────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                       ▼
┌────────────────────────────── 浏览器端 src/web/（ESM，无构建）───────────────────────────────────┐
│  index.html → main.js：fetch('/api/data') → setData()（实例化模型+建索引）                        │
│               → setCalcContext(dataCtx) → initUi() → 渲染                                        │
│  视图：我的角色（卡片/汇总） · 数据库（wiki 四子面板） · 统计（角色面板/驱动盘/全服总览/待定）      │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 三个环节详解

**① 抓取（同步）——两条触发路径，同一份代码**

- 命令行：`npm run sync:library` / `sync:characters` / `sync:plans` / `node src/sync/workshop.js`；
- 网页端：`src/web/ui.js` 的同步中心弹窗 → `POST /api/sync-*` → `server.js` 的 `runSync()` 骨架 → 复用同一个 `fetch*` 函数。
- 所以命令行和网页端的行为天然一致；`server.js` 只是给网页端加了一层互斥锁（`busy`）、进度上报（`syncState`）与 cookie 来源选择（请求体 > 本地缓存）。

**② 存储——`data/*.json` 是唯一中间态**

- 所有同步脚本写文件前调用 `src/lib/schema.js` 的校验（默认只 warn；命令行加 `STRICT=1` 可中断）；
- 所有写文件统一走 `src/lib/node.js` 的 `writeDataFile()`（先校验后写、路径基于 `DATA_DIR`，不依赖 cwd）；
- 数据文件不入 git（`.gitignore` 排除 `data/`）。

**③ 服务与渲染——浏览器永远不直接碰数据文件**

- `server.js` 把五个数据文件（library/characters/plans/workshop-grad/workshop-stats）打包成 `/api/data`；
- 前端 `main.js` 拿到后交给 `data.js`（`setData`），再注入 `calc.js` 的上下文（`setCalcContext`），最后 `initUi()` 渲染；
- 用户配置（目标/有效词条/备注/行列序/视图）经 `/api/config` 读写 `data/user-config.json`。

---

## 2. 目录结构总览

```
zzz/
├── server.js              # 唯一入口：http 服务器（页面 + API + 同步代理）
├── index.html             # 单页壳：header 三视图导航 + 5 个弹窗（帮助/同步/目标/备注/技能）
├── style.css              # 全部样式（2026-10 重构为「街头硬边」视觉，:root 令牌驱动）
├── prototype.html         # 视觉设计稿（静态原型，仅参考）
├── package.json           # 零 runtime 依赖；scripts 见 §12
├── eslint.config.js       # ESLint 扁平配置：按文件区分 Node/浏览器全局
├── CLAUDE.md              # 唯一权威项目文档（数据口径/设计决策/变更记录）
├── CODE-GUIDE.md          # 本文档（代码导读）
├── data/                  # 数据文件（不入库），详见 §3
├── src/
│   ├── lib/               # 双端共享纯逻辑（Node 与浏览器均可 import，禁 node: 依赖）
│   ├── sync/              # 抓取脚本（Node，可执行；也被 server.js 复用）
│   ├── web/               # 浏览器端 ESM（无构建）
│   ├── vendor/echarts.min.js  # 本地 ECharts 5.5.0
│   ├── fonts/             # 本地打包字体（Barlow Condensed + Noto Sans SC）
│   └── img/               # 技能图标等静态图
├── scripts/               # 运维脚本（*.mjs，路径基于 DATA_DIR）
└── test/                  # node:test 单元测试（依赖 data/ 真实数据，缺失时 SKIP）
```

---

## 3. 数据文件（data/*.json）

| 文件                    | 当前大小     | 生产者                                | 结构                                                                                                                                                                                           | 消费方                                                                                                                       |
| ----------------------- | ------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `library.json`          | ~5 MB        | `src/sync/library.js`                 | `{characters, wengines, discs, bangboos}`，**键即标准名**（discs 键=套装名，套装:条目 1:1，6 槽收在 `slotMainStats`）                                                                          | 全前端（wiki 视图、模型实例化、名称索引权威源、calc 基准）                                                                   |
| `raw-library.json`      | ~16 MB       | `library.js`                          | 每个 wiki entry_page 的原始响应快照                                                                                                                                                            | 仅排查/测试（`extract.test.js` 数据就绪检查）                                                                                |
| `characters.json`       | ~0.5 MB      | `src/sync/characters.js`              | 账号角色数组，每角色含 panel/wengine/discs/skills/mindscape/skins/equipPlan                                                                                                                    | 我的角色视图；统计视图「我的」对照                                                                                           |
| `plans.json`            | ~25 MB       | `src/sync/plans.js`                   | `{avatarId: {name, plans: [...]}}`，方案含 sets/mainProps/subStats/panel/weapon/skills/team                                                                                                    | 目标弹窗方案表、统计视图方案侧统计                                                                                           |
| `workshop.json`         | **~0.16 GB** | `src/sync/workshop.js`                | 分块 gzip（非固实）：第 0 行 `{meta, perChunk, offsets}` 索引头 + 每块独立 gzip 的 JSON 数组（2 万条/块）；内容即普通 JSON 条目                                                                | 只被聚合脚本流式读（逐块解压），**前端不加载**；旧 2.08GB JSON 由 `scripts/convert-workshop-gz.mjs` 转换（备份 `.bak-json`） |
| `workshop-grad.json`    | ~0.1 MB      | `workshop.js` 的 `fetchWorkshopGrad`  | `{roles:[{item_id,name,weapons,relics}]}` 全服累计占比（grad_stat 接口）                                                                                                                       | 统计视图「角色配装对标」卡                                                                                                   |
| `workshop-stats.json`   | 1.91 MB      | `workshop.js` 的 `buildWorkshopStats` | 15 项聚合（panels/discDetails/panelCorr/panelScatter/relicStats/rankDist/skillStats/roleDiscStats/roleOwnership/roleCooccurrence/rankRelic/skillCombos/rollEfficiency/sourceAudit/roleStyles） | **浏览器唯一加载的工坊数据**（≤2 MB 红线）                                                                                   |
| `workshop-weights.json` | ~10 KB       | `workshop.js`                         | `{weights: {role_id: 默认流派权重}}`（system_data 的 weight_json）                                                                                                                             | 有效副词条口径 + rollEfficiency（消费方在聚合层）                                                                            |
| `user-config.json`      | 0            | `server.js` `/api/config`             | `{charTargets, validStats, notes, rowOrder, colOrder, view}`                                                                                                                                   | 前端 `data.js` 的 userConfig                                                                                                 |
| `.cookie.json`          | 0            | `characters.js`                       | 米游社 cookie 缓存（**明文，绝不出网**）                                                                                                                                                       | 同步时 cookie 来源                                                                                                           |
| `debug-response.json`   | 40 KB        | `characters.js`                       | 第一个角色的账号接口原始响应                                                                                                                                                                   | 排查用                                                                                                                       |
| `raw-v3-sample.json`    | 0.5 MB       | 手动留存                              | 工坊 user_role/v3 原始样本                                                                                                                                                                     | 排查用                                                                                                                       |
| `img/`                  | —            | `library.js` 的 `localizeDataFiles`   | 本地化图片（所有图片必须来自官方 wiki，禁止用工坊图）                                                                                                                                          | 前端静态资源                                                                                                                 |
| `workshop.json.bak`     | 1.5 GB       | `scripts/clean-workshop.mjs`          | 清洗前备份                                                                                                                                                                                     | 兜底                                                                                                                         |

> **口径提醒**：`workshop-grad` 是全服真实累计占比；`workshop-stats` 基于「排行榜全量上榜 uid 的高练度标杆池」聚合，画像按玩家真实样本统计，**不当作全服分布**（UI 各处标注口径）。

---

## 4. server.js —— 唯一入口

运行 `npm start` 即 `node server.js`：监听 `127.0.0.1:8719`（`PORT`/`HOST` 环境变量可改；**注意代码默认是 8719，CLAUDE.md 写的 8718 已过时**），自动开浏览器。

### 4.1 职责划分（按代码区块）

| 区块             | 内容                                                                                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静态文件         | `serveStatic()`：只放行 ROOT 内路径；`isServable()` 拒绝任何 `.` 开头隐藏文件/目录、拒绝 `data/` 下除 `img/` 外的一切（`.cookie.json`、个人数据不能被抓）；realpath 二次校验防软链逃逸；`Cache-Control: no-store` 防旧 JS 缓存                                                            |
| 请求体           | `readBody()`：Buffer 收集后统一解码（逐块 `toString('utf8')` 会切碎跨分片中文），上限 `MAX_BODY` 4 MB                                                                                                                                                                                     |
| CSRF             | `isCrossSite()`：所有 POST 先查 Origin，非本机来源直接 403（`text/plain` 简单请求无预检，恶意页面可静默写 user-config/cookie）                                                                                                                                                            |
| `/api/data`      | `DATA_FILES` 声明五个文件 + fallback；`slimPlans()` 剥离 plans 的 `desc`/`skills` 字段（占 plans 一半体积，前端不用）；`dataSignature()` 按五文件 mtime+size 组签名 → `buildDataPayload()` 缓存 raw+gzip+etag → 命中 `If-None-Match` 回 304（`no-cache` 而非 `no-store`，仍走 ETag 协商） |
| 同步骨架         | `runSync()`：**在 await 之前抢 `busy` 锁**（防并发写文件）→ 读 body → 解析 cookie → 调 `run(cookies, onProgress)` → 写文件（在 fetch* 内部）→ 报进度/错误。`progressShape: 'step'                                                                                                         | 'count'` 适配两类进度上报格式 |
| 四个同步 handler | `syncLibraryHandler`/`syncCharactersHandler`/`syncPlansHandler`/`syncWorkshopHandler`，分别调 `fetchLibrary`/`fetchMyCharacters`+`localizeDataFiles`/`fetchAllPlans`/`fetchWorkshopData`（全部来自 `src/sync/`，命令行动能与网页完全一致）                                                |
| 其他 API         | `/api/cookie-status`、`/api/sync-status`（文件新鲜度 + 是否缓存 cookie，**绝不回传 cookie 明文**）、`/api/sync-progress`、`/api/config`（GET 读 / POST 原子写 tmp+rename）                                                                                                                |
| 兜底             | `unhandledRejection`/`uncaughtException` 只打日志不杀进程                                                                                                                                                                                                                                 |

### 4.2 路由速查

| 方法+路径                                               | 作用                                    |
| ------------------------------------------------------- | --------------------------------------- |
| `GET /` `GET /index.html` `GET /src/*` `GET /style.css` | 静态页面资源                            |
| `POST /api/sync-base`                                   | 更新数据库（wiki 属性库，含图片本地化） |
| `POST /api/sync-characters`                             | 更新我的角色（需 cookie）               |
| `POST /api/sync-plans`                                  | 更新推荐方案（需 cookie）               |
| `POST /api/sync-workshop`                               | 更新工坊配装（四文件一步更新）          |
| `GET /api/data`                                         | 五个数据文件打包（ETag/gzip）           |
| `GET /api/sync-progress`                                | 同步进度（前端 300ms 轮询）             |
| `GET /api/sync-status`                                  | 数据新鲜度 + cookie 是否已缓存          |
| `GET /api/cookie-status`                                | 只回 `{cached: bool}`                   |
| `GET/POST /api/config`                                  | 读写 user-config.json                   |
| `POST /api/cookie`                                      | 写入 cookie 缓存                        |

---

## 5. src/lib/ —— 双端共享纯逻辑层

**红线**：除 `node.js` 外禁止 import 任何 `node:` 模块（浏览器直接 import 它们）。Node 专属函数全在 `node.js`。

### 5.1 constants.js —— 固定字符串唯一权威枚举

属性名 `STAT`（攻击力/生命值/防御力/冲击力/暴击率/暴击伤害/异常掌控/异常精通/穿透率/贯穿力/穿透值/能量自动回复）、面板展示顺序 `PANEL_ORDER`、百分比属性集 `PERCENT_STATS`（值 ≤1 即百分比）、百分比乘法属性集 `MULT_STATS`、副词条枚举 `SUBSTAT`/`SUBSTAT_TYPE_SET`/`VALID_STAT_OPTIONS`、目标字段 `TARGET_KEYS`、456 主词条候选 `MAIN_STAT_OPTIONS`、`mainStatName()`（固定值名→百分比变体）、同步类型 `SYNC_KINDS`、视图 `VIEWS`、**技能三套编号映射** `SKILL_TYPES`/`OFFICIAL_SKILL_TYPE`/`WS2025_SKILL_TYPE`（详见 §11.2）。拼错字符串会得 undefined，枚举防拼写错误。

### 5.2 util.js —— 纯工具（禁 node:）

- 归一：`normalize()`（去 HTML 只留中文数字）、`normalizeStatKey(s)`（属性别名统一：生命/生命力→生命值、暴击→暴击率…）、`normalizeStatKeys(obj)`、`substatName()`（百分比→`%` 变体）、`parseNum()`（带 % 转小数）；
- 罗马数字：`romanNumeralUnicode()`（II→Ⅱ）、`normalizeRomanKey()`（音擎名匹配键，防 Ⅰ/Ⅱ/Ⅲ 碰撞）；
- 转义/富文本：`escapeHtml()`（⚠️ 用 `??` 不用 `||`，否则 0 会被抹掉）、`escapeJsAttr()`（JS 转义+HTML 转义两层）、`renderRichText()`（游戏 `<color=#HEX>` 标记 → span；清 `<script>`/`on*`）、`decodeHtmlEntities()`；
- 展示：`formatValue(name, value)`（百分比/大数/能量两位小数）；
- cookie：`parseCookies`/`serializeCookies`、`CLIPBOARD_SCRIPT`（控制台取 cookie 脚本，命令行与网页共用）；
- 通用：`statEntries()`（词条统一成 `[{name,value}]`，兼容数组/旧对象格式）、`compareValues`/`isEmptyVal`（排序用）。

### 5.3 names.js —— 统一名称解析（跨数据源匹配的命脉）

- `CATEGORY`（char/wengine/disc/bangboo）+ 手工别名表 `ALIASES`（维琳娜→维琳娜·艾嘉德、星徽·比利→星徽·比利·奇德、棘刺玫瑰→荆棘玫瑰…）；
- `buildNameIndex(names, category)` 建索引（wengine 用 `normalizeRomanKey` 防系列碰撞；别名只在规范名存在于集合内时收录）；
- `resolveName()` 解析链：**精确 → 别名原串 → 别名归一键 → 归一化键 → 子串（char 专属 fuzzy）**，歧义确定（最短规范名优先，同长 zh localeCompare）；
- 便捷入口：`resolveEntry`（返回条目）、`canonicalName`（返回标准名串）、`canonicalize`（标准名或保留原名 + changed 标记，同步写时归一用）。
- 用法分工：**同步脚本写时固化**（characters/plans/workshop 写文件前把名字归一成 library 标准名）、**消费端统一解析**（前端查 library 条目）。新增数据源/新变体只需在 `ALIASES` 或归一化键加一条。

### 5.4 sort.js —— 表头三态排序

`createSort()` 返回 `{key, dir, active, toggle(key), reset(), apply(list, val)}`：同列 升→降→复位，新列从升序开始；`apply` 空值行恒排最后。wiki 表/汇总表/方案表/统计表四处统一走它（表头 ▲/▼ 指示各视图自渲染）。

### 5.5 schema.js —— 数据键名 + 结构校验

`KEYS`（键名唯一权威定义）；`validateCharacter(s)`/`validateLibrary`/`validatePlans` 返回错误数组；`warnIfInvalid(label, errors, {strict})` 默认只 warn，`strict: true` 抛错。**同步脚本写文件前必调**（命令行 `STRICT=1` 开启严格模式，网页同步保持 warn 避免 wiki 解析偶发异常阻断整次同步）。

### 5.6 calc.js —— 计算引擎（纯逻辑，上下文注入）

- `setCalcContext(ctx)` + `ctxVersion`：数据经上下文注入（浏览器 `main.js`、测试断言前），版本号变化使模型计算缓存失效；
- 副词条成长：`substatGrowthTable`（B 站 wiki 规则，S/A/B 稀有度各一张表）、`substatType()`（暴击/暴伤恒 %，其余按值 ≤1 判）、`discGrowth()`（单盘各词条强化次数 = 值/成长值 − 1）、`hitCount()`；
- 面板：`panelBonus()`、`classifyBonus()`、`atkWhiteValue()`、`inBattleAtk()`、`coreSkillBoostAt()`（wiki 核心技 A-F 档提升累计）、**`calculateCharacter(character)`** → `{base, bonus, final, actual, theoretical, sources}`（sources = 每属性加成来源明细，汇总表悬浮「计算详情」消费；actual 优先账号真实值，缺失用推算 `theoretical`）；
- 达成率：`statProgress()`/`resolveStatCurrent()`/`targetGap()`、`rateColor()`（绿 ≥97%/黄 90-97%/红 <90，内联进度条色）、`progressCell()`。

### 5.7 models.js —— 领域模型基类

- `Disc`：构造时归一化 + 自动算 `growth`（各副词条成长次数）；`getHitCount(validSet)` = 落在有效词条上的命中次数（词条本身 1 + 成长次数）；保留 wiki 的 `roundIcon`（圆形光盘图标）；
- `Wengine`：基础字段 + wiki 扩展字段；
- `Character`：组合 wengine + discs（子对象实例化）；`calculate()` 按 `ctxVersion` 缓存（同一次数据加载内 render 每次全量重算只算一次）；`hitCount()`/`statProgress()`；
- `toInstances(obj, Base)`：`{键:数据}` 集合 → 基类实例集合（`data.js` 的 setData 用）。

### 5.8 node.js —— Node 专属（唯一允许 node: 的 lib 文件）

- `openBrowser()`（跨平台）；`ROOT`/`DATA_DIR`（同步脚本样板，路径不依赖 cwd）；
- `isMain(meta, run)`：ESM 入口判断（直接运行才执行 main，异常统一 exit(1)）——所有同步脚本靠它同时可执行/可被 server import；
- `pool(items, limit, fn, onProgress)`：并发池，结果按下标对齐，单任务失败返回 null——四个同步脚本共用；
- `writeDataFile(file, data, {label, validate, strict, pretty})`：校验 + 写 data/（library.json 用紧凑格式防膨胀到 11MB）；
- **`streamJsonArrayElements(file)`**：流式读超大 JSON 顶层数组的 generator（workshop.json 2.13GB 专用）。两个已修的坑：① 块末不能检查「数组结束」（块边界落在元素间隙会提前 break 丢 85% 条目）；② 块边界会切断 UTF-8 多字节字符 → 必须 `decodeUtf8Tail()` 解码到最后一个完整字符边界，跨块尾部字节交下块拼接（否则中文变 U+FFFD）。

### 5.9 workshopStats.js —— 工坊聚合（最大的 lib，69KB）

全部为纯函数（`entries` 流式喂入），消费方 = `src/sync/workshop.js` 的 `buildWorkshopStats` 与统计视图图表面板：

| 函数                                                                                                            | 产出                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `computeWorkshopStats`                                                                                          | 音擎/驱动盘按配装条目数聚合 + `computeDist` 面板真实样本统计（count/min/max/mean/median/sd/IQR/p10-p99/skew/kurt/whisker/outliers/hist，百分比归一化为小数）                                                                                                                                                                               |
| `computePanelCorrelations`                                                                                      | 属性相关（默认 7 对：攻击-防御/攻击-生命/防御-生命/暴击率-暴伤/攻击-暴伤/攻击-暴击率/异常精通-异常掌控），同条目配对皮尔逊                                                                                                                                                                                                                 |
| `discStatName`                                                                                                  | workshop 词条名 → plans/constants 统一名（兼容 2025/mys 两源）                                                                                                                                                                                                                                                                             |
| `substatRolls(name, value)`                                                                                     | 副词条值 → **强化次数**（2025 源值 = 基数×等级、mys 按显示数，`typeof` 自判；`value/base` 99.9987% 恰为 1-6 整数，异常靠 round+钳制兜底）                                                                                                                                                                                                  |
| `buildRoleSubstatWeights`                                                                                       | 工坊流派权重 → 每角色有效副词条表（>0 者）                                                                                                                                                                                                                                                                                                 |
| `computeWorkshopDiscStats`                                                                                      | 驱动盘单盘真实统计：盘数/使用角色/456 主词条分布/副词条频率 + 有效强化次数分布 `effDist` + 槽位分布 `slotDist` + 词条组合 Top `subCombos` + 主词条×副词条协同 `mainSubCross`                                                                                                                                                               |
| `bin2D` / `computePanelScatter`                                                                                 | 面板属性对 2D 密度网格（暴击率×暴伤、攻击×暴伤，perRole/global）                                                                                                                                                                                                                                                                           |
| `computeRelicStats` / `computeRankDist` / `computeSkillStats` / `computeRoleDiscStats` / `computeRoleOwnership` | 练度指标：评分分布（含 hist）/ 影画 0-6 占比 / 技能等级分布（按源归一）/ 每角色 456+副词条画像 / 样本池角色拥有率（meta.poolUids 记池大小）                                                                                                                                                                                                |
| `sourceOf(e)`                                                                                                   | **两源判别**：`source` 字段 → `equips[].rarity` 类型（string "S"=mys / number 4=2025）→ skills 数组顺序（末位兜底）                                                                                                                                                                                                                        |
| `computeRollEfficiency`                                                                                         | 加权词条效率分（Σ强化次数×流派权重）+ `slotEff` 短板槽 + D9 `scoreVsRelic`（评分×毕业度皮尔逊，配对 <30 记 null）                                                                                                                                                                                                                          |
| `computeSourceAudit`                                                                                            | D10 两源面板一致性审计（任一源 <30 样本不给 diff）                                                                                                                                                                                                                                                                                         |
| `computeRoleCooccurrence` / `computeRankRelic` / `computeSkillComboStats`                                       | 同 uid 同练角色共现（配队亲和）/ 每角色×影画档评分 count/mean/median / 技能拉满组合模式 Top + 全拉满率                                                                                                                                                                                                                                     |
| `computeRoleStyles` + `styleBaseName`/`styleSuffix`/`styleLabel`/`styleAttrShort`/`styleMatch`                  | **角色流派分析**：聚类属性池按定位（trait）选（击破含冲击力、异常含精通/掌控…）→ cv<0.04 去噪（保底 3 维）→ z-score + k-means k=3（确定性初始化可复现，样本 <200 不聚类）→ 每簇 share/label/面板 mean+median/456 主词条 Top2/套装 Top2/音擎 Top2；`styleMatch` 供「你的面板最贴近 XX 流」联动                                              |
| **`computeAllWorkshopStats(entries, discIndex, opts)`**                                                         | **单遍历总入口**：15 项聚合各拆成 `{add(entry), finish()}` 累加器，一次 for 循环全部喂完再收尾（此前每项各遍历一遍 2.13GB 文件，每遍 ~27s）。**硬约束：累加器 Map/数组必须按条目出现顺序写入**，否则键序与浮点累加顺序漂移；**`opts.weightJson`/`roleWeights` 必须在聚合前传入**，否则 effDist/rollEfficiency 静默退化为「全部合法副词条」 |

### 5.10 其余纯逻辑模块（小而专）

- `discstats.js`：`computeDiscStats(plans, discNames, discSet2)`（推荐该盘的角色/副词条频次/456 主属性/二件套替代）+ **`computeDiscAdvisor(official, live, mainOptions, threshold=0.03)`**（决策卡合并层：两口径对齐 → keep=双边保留 / split=单边分歧 / drop=双边未用可抛弃）；
- `plansStats.js`：`orderComboSets4First`（套装组合名 4 件套在前排序归一，工坊/方案两源组合文本一致）+ `computeRoleBuildsFromPlans`（方案侧每角色 Top 音擎/套装，与 workshop-grad 结构一致供对比）；
- `panelBench.js`：**`computeRecTierStats`**（推荐三档 low/mid/high 的 mean/median/sd/cv，MAD 排除离群哨兵值，过滤 low=mid=0 占位，统计视图消费，结果有缓存）nal 合并为每角色全属性）；
- `distStats.js`：分布统计（`quantile`/`median`/`sd`/`skew`/`kurt`/`pearson`/`computeDist`/`kmeans`）——workshopStats 与 panelBench 共用；

---

## 6. src/sync/ —— 抓取层

所有脚本：`isMain(import.meta, () => main())` 结尾 → 可直接 `node` 运行，也可被 `server.js` import 复用；写文件统一 `writeDataFile`（含校验）；名字写时归一统一 `name-index.js`。

### 6.1 http.js —— 米游社接口统一请求封装

`requestJson(url, {headers, cookies, retry})`：cookie 序列化 + HTTP 状态 + `retcode` 业务码校验（无 retcode 字段的接口不受影响）+ 可配置重试。`retry.simple`（网络/HTTP 错误，800ms×i）、`retry.backoff`（429/retcode 10041 风控，5s→15s→45s 指数退避）。`fetchUid(cookies, headers)`：取账号绑定 uid（characters 与 plans 共用）。

### 6.2 proxy.js —— 零依赖代理隧道

`resolveProxyUrl(cliValue)`：命令行参数 > HTTPS_PROXY > ALL_PROXY > HTTP_PROXY；`maskProxyUrl()` 打码日志密码；**`installProxyFetch(proxyUrl)`**：手工实现 HTTP CONNECT / SOCKS5（含 user:pass 认证）隧道，包一层全局 fetch——仅目标主机匹配 `applyHosts`（默认 `*.zzzmap.com`）走代理，其余请求原生 fetch 不受影响。`workshop.js` 模块加载时自动启用（server 复用 `fetchWorkshopData` 同样生效）。`Reader` 类负责顺序消费 socket 缓冲（响应头/体同分片会丢字节）。

### 6.3 name-index.js —— 同步写时归一的名字索引

`loadNameIndexes(what)`：读 `library.json` 建 char/wengine/disc 三类索引；library 缺失/损坏返回 null（调用方降级为不归一并 warn）。characters/plans/workshop 模块加载时调用一次；workshop-stats.js 因模块缓存不被 `?v=` 爆破覆盖，改为**每次聚合调用**现读（见 6.7）。

### 6.4 library.js —— wiki 属性库抓取（180+ 页面，对页面结构高度脆弱）

- `fetchLibrary(onProgress, {strict})`：并发池（6 worker）抓 wiki entry_page → 解析出 `library.json`（角色含 `coreSkillBoost` 核心技 A-F 档提升、驱动盘 `roundIcon` 圆形图标等）+ `raw-library.json` 原始快照；
- `fetchSkills(page, {requireChildren})`：技能详情页（每级数值 growth，供 wiki 视图技能数值弹窗）；`parseSkillValueLines(html)`：技能倍率行解析；
- **`localizeDataFiles()`**：图片本地化（下载到 `data/img/` 并替换为本地路径），`sync-library` 后自动跑、`sync-characters` 后也调（防账号图片回到远程）；已本地路径做扩展名修正；
- 解析器对 wiki 页面结构高度脆弱，改动需谨慎（CLAUDE.md 提示）。

### 6.5 characters.js —— 账号角色抓取（需 cookie）

- 命令行交互流：开登录页 → 提示在控制台执行 `CLIPBOARD_SCRIPT` 取 cookie → 粘贴 → `fetchCookie()`；cookie 缓存到 `data/.cookie.json`；
- **`extractCharacter(response)`**：全量提取（纯函数）——面板 `{base,bonus,final}`、音擎、6 槽驱动盘（缺槽补「未佩戴驱动盘」）、影画 `mindscape`（含 ranks 完整描述）、技能 `skills`、皮肤 `skins`、潜能觉醒 `skillAwaken`、`equipPlan`（游戏推荐有效属性，原样存储）、元素/职业代码等；
- `fetchMyCharacters(cookies, onProgress, {strict})`：fetchUid → 角色列表 → 并发 3 拉详情（`pool`）→ `normalizeCharacterOutput`（音擎/驱动盘名写时归一，占位名保留）→ 校验 + 写 `characters.json`；第一个角色原始响应存 `debug-response.json`；
- `cacheCookies`/`readCookieCache`：server 与 plans.js 共用。

### 6.6 plans.js —— 养成指南推荐方案抓取（需 cookie，且要养成指南登录态）

- 关键头：`x-rpc-device_id`/`device_fp` 指纹头——**必须取 cookie 里的真实指纹（`DEVICEFP`/`_MHYUUID`）**，伪造值会被风控 retcode 10041 拒绝；
- `extractPlan(p)`：方案 → 精简结构（`sets`/`mainProps`/`subStats`/`panel`/`weapon`/`skills`/`team`，属性名归一 + 百分比判定按 `PERCENT_STATS`）；
- `fetchAllPlans(cookies, {onlyAccount, strict}, onProgress)`：fetchUid → 角色列表（默认养成指南全部角色；`--account` 只抓 characters.json 里的角色）→ 并发 3，每角色 `fetchPlansFor`：user/feed 分页翻到 end（`MAX_PLANS=5000` 防死循环）+ `avatar_simple_info` 的 plan_id 用 plan_detail 兜底补齐 → `normalizePlansOutput` 写时归一（角色/音擎/套装/配队，关 fuzzy）→ 校验 + 写 `plans.json`；全部失败时明确抛错（e_nap_token 过期提示）。

### 6.7 workshop 系脚本 —— 下载/提取（workshop.js）+ 聚合（workshop-stats.js）+ API 客户端（workshop-api.js）+ 静态数据（workshop-static.js）

2026-10 拆分：workshop.js 只留下载/提取 + 主流程编排（聚合职责自原合并文件拆回 workshop-stats.js，workshop.js re-export 保兼容）。
签名协议（逆向自 wxapkg，workshop-api.js）：`MD5(key + 参数排序)`，无 token，仅部分接口 AES 加密；`fetchJson` 对「非 2xx / 非 JSON（风控返回 HTML）/ 网络错误」指数退避重试（2s→6s→18s→54s）。

**`fetchWorkshopData(onProgress)` 主流程（一步产出 4 个文件）**：

1. `buildCtx()`：`system_data/public` 一次拿 57 角色 + 94 音擎 + 30 套装 + 装备表；
2. **排名收集**：角色级并发，每角色 7 影画档**组内并行**翻页 `fetchRankRows`（接口硬性每页 50，limit 无效）→ 去重 uid 集合（默认每档 300 = 榜单全量）；
3. **断点续爬**：流式扫旧 `workshop.json` 只收集 fileUids（**跳过判断 = 文件实际覆盖的 uid**，文件里没有的 uid 一律重爬，进度领先自动自愈）；
4. **v3 配装爬取**：并发 `CONCURRENCY`（默认 6）POST `user_role/v3` 拉每 uid 全部角色 → `isMaxedRole`（角色≥60/音擎≥60/6 盘 15 级全 R5）过滤 → `extractBuild` 提取（兼容 mys/2025 两源，见下）→ 条目 `{uid, role_id, nick, source, skills, weapon, panel, equips}`；
5. **内存安全**：每 1 万条 `flushPart` 到 `data/.workshop-part.json` 裸逗号流（90 万+ 条全量驻留 ≈7GB 会 OOM），结束 `mergeWorkshopFile` 与旧文件**流式合并**（`copyEntriesTo` 逐条复制，禁止字符级块切分——中文 UTF-8 多字节会损坏；原子写 tmp+rename）；
6. `weightJson`（system_data 角色默认流派权重）→ `workshop-weights.json`；
7. `buildWorkshopStats(roleNameMap, weightJson, totalEntries)`（workshop-stats.js）：构造 traits（role_id→定位）→ `computeAllWorkshopStats` **单遍历**流式聚合 → `workshop-stats.json`；
8. `fetchWorkshopGrad(onProgress, concurrency=6)`（workshop-stats.js）：57 个 `grad_stat` 请求 → `workshop-grad.json`（音擎/套装组合全服累计占比，套装组合名经 `orderComboSets4First` 归一 4 件套在前；workshop.js 调用时传入 CONCURRENCY）。

⚠️ workshop-stats.js 的名称索引**每次调用现读 library.json**（`loadIndexes()`）：server.js 的 `?v=` 缓存爆破只作用于 workshop.js，顶层索引会在长驻 server 进程中冻结（同步完 library 后新角色名解析不出来，正是 `?v=` 爆破要防的 bug）。

**`extractBuild(v3Data, roleId, ctx)` 两源判别**：

- `ij.equip`/`ij.properties` 有实际数据 → **mys 源**（面板现成，`source:'mys'`，技能 type 官方语义；⚠️ 判定要求数据非空，否则 2025 源空数组会误走 mys 返回空面板）；
- `ij.Weapon`/`ij.EquippedList` → **2025 源**（游戏内嵌原始，`source:'2025'`，面板按 `computeEnkaPanel` 复现工坊 `enka_attrs_mapping` 公式计算：角色基础+成长+突破+核心强化档 / 武器 MainStat×(1+0.1568×等级+0.8922×突破) / 驱动盘主属性×等级成长+副属性×词条等级 / 套装 2 件套加成）；
- 驱动盘两源提取**同构**：`main`=主词条、`subs`=全部副词条（mys 独有 valid/all_hit 有意不提取，聚合层统一口径）。

依赖 `src/sync/workshop-static.js`（逆向静态表：角色基础/武器/装备/套装，2026-10 由 workshop-static.json 并入并裁剪为实际消费字段），游戏更新后需重新提取。命令行参数：`node src/sync/workshop.js [角色数=57] [每影画条数=300] [并发=6] [代理URL]`。代理在 workshop-api.js 模块加载时自动启用（`installProxyFetch`），仅 `*.zzzmap.com` 走代理。

---

## 7. src/web/ —— 浏览器端（ESM，无构建）

加载顺序：`index.html`（先 `<script src="/src/vendor/echarts.min.js">` 注入 `window.echarts`，再 `<script type="module" src="/src/web/main.js">`）。

### 7.1 main.js —— 入口（24 行）

`fetch('/api/data')` → 失败显示「请先运行 npm start」→ 成功则 `setData(library, characters, plans, workshopGrad, workshopStats)` → `setCalcContext(dataCtx)` → `initUi()`。另外用 `ResizeObserver` 实时跟踪 header 高度写 `--head-h`（供吸顶表头定位；header 窄屏换行会变高，只算一次会失准）。

### 7.2 data.js —— 数据层

- **活绑定（live binding）**：`export let library/myCharacters/plans/workshopGrad/workshopStats`，`setData` 重新赋值后 import 方自动读到新值；
- `setData`：wiki 数据 `toInstances` 实例化为 Character/Wengine/Disc 基类；账号角色 `new Character(c)`；建 `plansByName`；重建名称索引 `charIndex/wengineIndex/discIndex`；
- 用户配置 `userConfig` + `read/saveCharTarget`（目标）、`readValidStats`（**默认取游戏推荐 `equipPlan.plan_effective_property_list`，手动配置覆盖**，旧版独立 validStats 兼容）、`read/saveNote`（备注）、行列序读写；`saveUserConfig()` → `POST /api/config`；`loadUserConfig()` 原地 Object.assign（render/ui 持有引用）；
- **`dataCtx`**：getter 暴露 library/索引/readCharTarget/readValidStats，供 `calc.js` 注入。

### 7.3 util.js —— 浏览器端工具

`apiRequest(url, opts)`：带超时（默认 180s；**`timeout: 0` = 不超时**，工坊/方案同步可跑数小时，硬超时会误报失败而服务端仍在继续）；失败返回 null。`postJSON(url, body, opts)`。

### 7.4 shared.js —— 共享渲染辅助（纯 HTML 字符串，无数据层依赖）

`discSetEffectsHtml`（2/4 件套悬浮）、`richItemHtml`（富文本条目：技能/影画/觉醒悬浮共用）、`skillIcon`/`skillIconForType`（技能图标；官方语义 type 表，跨源匹配必走 `OFFICIAL_SKILL_TYPE` 映射）、`SKILL_LABEL`、**`registerZZZ(obj)`**（合并进 `window.ZZZ`——内联 `onclick` 引用的函数必须挂 window，见 render.js/wiki.js/ui.js 的注册点）。

### 7.5 render.js —— 渲染层（我的角色视图 + 悬浮系统 + 渲染调度）

- **悬浮提示系统**：全局 `mouseover/mousemove/mouseout` 委托（`data-detail` 属性 → `.tip` 浮层，自动防出界）；`hideTip()` 在 `render()` 换 DOM 后强制收起（元素被移除不再派发 mouseout，否则提示框挂屏）；
- 卡片/汇总二级子页面：`setMyTab('card'|'table')`（兼容旧 view 值）、`myCharsShell`、`resolveView`；卡片右上角达成率大字 + 图章（`.stamp`）；
- 汇总表属性格悬浮「**计算详情**」`statDetailHtml`：当前/目标达成率 + 基础→加成→最终分解 + `R.sources` 来源明细 + 账号实测差异；
- 行/列拖拽排序（存 rowOrder/colOrder）、表头三态排序（`createSort`）；
- 驱动盘图标优先 `Disc.roundIcon`（圆形光盘），fallback 账号 icon / library icon；
- `render()` 总调度：按 view 分发 mychars/wiki/recommend；wiki/统计切换后调 `mountRecommendCharts` 挂图表。

### 7.6 wiki.js —— 数据库视图

`TABS`（角色/音擎/驱动盘/邦布）+ `PANEL_RENDERERS` 键控分发——**新增子面板 = 两处各加一项**；渲染函数返回 `table(headers, rows, sortable)` 即自动获得三态排序、`data-detail` 悬浮、`.wiki-table` 样式；`openSkillDetail`（技能数值弹窗，读 skills[].items[].growth 每级数值）；角色行技能图标可点击；穿透率列合并显示命破角色的贯穿力；核心技悬浮用 `coreSkillBoost` 累计。

### 7.7 ui.js —— 交互层

- `notify` 提示条；同步中心 `openSyncCenter`（`/api/sync-status` 新鲜度 + cookie 状态，**不回显明文**）；`startSyncPolling` 300ms 轮询 `/api/sync-progress` 显示各阶段进度（characters/wengines/discs/bangboos/plans/rank/fetch/grad 分支文案）；`runSync` 用 `timeout: 0` 的 POST；
- 目标弹窗 `openTargetSettings`（目标属性 + 推荐音擎 + 456 主词条 + 有效副词条勾选 + **推荐方案表**：每方案一行，可「应用」一键填入）；备注弹窗 `openNote`；
- 事件绑定 + `initUi()`（同步按钮、视图切换、弹窗开关、cookie 保存等）；`registerZZZ({...})` 注册内联 onclick 用的函数（`openNote`/`openTargetSettings`/`applyPlan`/`selectRole`/`selectDisc`/`wikiTab`/`recommendTab` 等）。

### 7.8 charts.js —— ECharts 图表辅助（依赖 vendor/echarts.min.js 的 `window.echarts`）

- 主题：`CHART_COLORS`（暗色+金）+ `SOFT` 半透明变体 + 公共片段（`AXIS_LINE`/`AXIS_LABEL`/`AXIS_LABEL_SMALL`/`SPLIT_LINE`/`CHART_LEGEND`/`CHART_TITLE`/`CHART_SUBTITLE`/`DARK_TOOLTIP`）——**所有图表统一引用，禁止硬编码色值**；
- 挂载机制：`registerChart(key, option)` → `mountCharts()` 批量实例化；`clearCharts()`（防 ECharts 实例泄漏）；`chartBox(key, height)` 容器；**页面 resize 自动重排已挂载图表（防抖 150ms）**；`attachReadLine`（option 带 `readLine` 标记时启用：小提琴图鼠标位置灰横虚线 + 数值标签 + 空白处密度区间 showTip）；
- option 构建函数：`heatmapOption`（达标热力）、`consensusGridOption`（共识度大图，每属性子图）、`violinBoxOption`（小提琴+箱线）、`densityScatterOption`（2D 密度散点）、`tierRichOption`（推荐三档×玩家分布：每属性 4 行，markArea 区间 + 我的值金色竖线 + 数值轴 axisPointer）、`rankPyramidOption`（影画金字塔）、`relicBarOption`（装配评分箱线）、`skillDistOption`（技能等级分布，我的柱高亮）、`rankRelicGapOption`（6影−0影中位差条）、`scoreRelicOption`（D9 评分×毕业度 r 条，按 r 降序传入——类目轴首项画在底部）、`discMain456Option`/`discSubsOption`/`discComboOption`/`mainSubCrossOption`（驱动盘四图）。

### 7.9 recommend.js —— 统计视图容器（最大 web 文件，56KB）

- 仿 wiki.js：`TABS`（角色面板 detail / 驱动盘 discs / 全服总览 overview / **待定 pending**）+ `PANEL_RENDERERS` + 共享排序 `recSort`；
- `roleKeyedMap`：role_id 键的 stats（relicStats/rankDist/skillStats/roleCooccurrence/rankRelic/skillCombos/rollEfficiency）统一映射到 plans 角色名（grad 名对齐）；WeakMap 缓存；
- 「角色面板」：**流派分析卡**（roleStyles 占比堆叠条 + 典型面板表 + 456/套装/音擎偏好 + `styleMatch` 我的联动）+ 玩家分布小提琴箱线（叠加推荐三档点 + 我的）+ 推荐三档增强图 + 面板属性对密度散点 + 技能对标分布图（`OFFICIAL_SKILL_TYPE` 映射我的等级）+ 技能组合卡 + **角色配装对标卡**（`computeRoleBuildsFromPlans` 方案侧 vs workshop-grad 实况并排 + 差异分析）+ **配队亲和卡**（roleCooccurrence 玩家实配 vs plans team 攻略配队 Top6）；
- 「全服总览」：共识度散点大图 + 影画×装配评分条 + 评分×盘毕业度（D9）；
- 「待定」：**提升清单**（缺口×落后度 Top12）+ **面板达标**（平均落后度重排，悬浮带缺口）+ **驱动盘毕业度**（有效强化次数口径：rollEfficiency.weights → Disc.getHitCount → discDetails.effDist 百分位 + 主词条主流对照 + 替换建议）+ **两源一致性审计**（sourceAudit 表，按每角色最大 |diff| 降序，绿<5%/橙≥5%/红≥10%，本·比格 -41.5% 成因写进悬浮）；
- `mountRecommendCharts()`：render 后由 render.js 调用，统一挂载图表；`setSelectedRole` 角色下拉联动。

### 7.10 discstats.js —— 统计→驱动盘面板

盘为中心的「**决策卡**」：顶部全盘概览条（适配角色/保留主词条/可抛弃主词条/玩家盘数，点击 `ZZZ.selectDisc` 切换），主体为选中盘决策卡——① 适配角色（官方 vs 实况徽章，交集金高亮）② 可抛弃主词条（删除线）③ 456 主词条三列 + 副词条保留清单（对比条：金=官方、蓝=实况，keep/split/drop 标签）④ 槽位分布行（CSS 柱状图 + 16.7% 基准虚线，金色 = 高于基准 3pp 以上；⚠️ 基准线 bottom 必须直接写 `var(--base)`，`calc(var(--base) * 1%)` 会把百分比再乘 0.01 贴底）。判定逻辑在 `lib/discstats.js` 的 `computeDiscAdvisor`。底部图表卡区：456 占比/副词条频率/组合 Top/主词条×副词条协同热力。

---

## 8. scripts/ —— 运维脚本（Node，路径基于 DATA_DIR）

| 脚本                 | 命令                                                   | 干什么                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rebuild-stats.mjs`  | `npm run rebuild:stats`                                | 只重算 `workshop-stats.json`：① 尝试重跑 grad（风控失败用现有）；② 流式重算（2-4 分钟）；⚠️ 读 workshop.json 头部 meta 必须用定长 `fs.readSync`（整文件读会撞 2GiB 上限，曾把 `meta.entries` 静默写成 -1）                  |
| `clean-workshop.mjs` | `npm run clean:workshop`                               | 清洗 workshop.json（丢弃乱码/损坏/重复条目）：分块流式（2.13GB 整读会崩）；乱码检测 = 非法 UTF-8 字节 **+ 字面量 U+FFFD**（U+FFFD 是合法编码，字节级校验抓不到）；清洗前自动备份 `.bak`；entryCount 用等长占位头 + 原地覆写 |
| `fetch-fonts.mjs`    | `node scripts/fetch-fonts.mjs [proxyHost] [proxyPort]` | 下载 OFL 字体（Barlow Condensed + Noto Sans SC 可变体）到 `src/fonts/`：手写 HTTP CONNECT 隧道 + Node OpenSSL 栈（Windows 沙箱 Schannel 拿不到凭据）                                                                        |

---

## 9. test/ —— 单元测试（node:test）

- `helpers.js`：`loadDataFile(name, hint)` 读 `data/` 真实数据；**缺失时打印醒目 SKIP 横幅并 `exit(0)`**；`REQUIRE_DATA=1` 时 `exit(1)`（防「静默全绿」——`node --test` 会把直接退出的文件记成 pass 1，与真全绿肉眼无法区分）；
- 21 个测试文件对应各 lib 模块：`calc`/`discstats`/`distStats`/`extract`（用 raw-library.json 做就绪检查 + 内联账号 fixture）/`gradStats`/`models`/`names`/`node`/`panelBench`/`panelRange`/`plansStats`/`proxy`/`schema`/`skill-growth`/`sort`/`teamStats`/`util`/`wengineStats`/`workshop-extract`（两源提取）/`workshop-merge`（流式合并回归：双括号 `"entries":[[` 与 U+FFFD 两类损坏）/`workshopStats`（最大，46KB，聚合单测）；
- ⚠️ 新增测试文件记得加进 `package.json` 的 test 脚本（Node 20 的 `--test` 不支持 glob，会把 test/ 下所有 JS 当测试文件）。

---

## 10. 其他根文件

- `index.html`：单页壳。header 三视图导航（`data-view="mychars/wiki/recommend"`，斜切分段）；5 个弹窗（使用说明/同步中心/目标设置/角色备注/技能数值，均 `position: sticky` 关闭钮）；末尾两个 script（echarts vendor + main.js 模块）；
- `style.css`：全部样式。「街头硬边」视觉：炭黑+警示黄，`:root` 令牌驱动（`--hazard*` 新名，`--acc*`/`--grad-gold` 旧名保留为别名——JS 内联 style 的 52 处引用零改动）；黄黑警示斜纹带、斜切切角、四角括号、图章贴纸、噪点+扫描线、吸顶压缩体大写表头、分段警示进度条、cardIn/viewIn 动效；
- `prototype.html`：视觉原型（静态设计稿，保留作参考）；
- `eslint.config.js`：ESLint 9 扁平配置，按文件区分全局：`src/web/**`=browser；`server.js`/`src/sync/**`/`src/lib/node.js`/`test/**`=node；`util.js`/`schema.js`/`calc.js`=双端；`*.mjs`/`scripts/**`=node；ignores 含 `data/**`/`src/vendor/**`；
- `.prettierrc.json`/`.prettierignore`/`.gitignore`（data/、.cookie.json 等不入库）。

---

## 11. 关键机制与约定（理解代码的钥匙）

### 11.1 名称解析（跨源匹配的命脉）

library.json 是**标准名权威源**。四条同步链路在写文件时就把名字固化到标准名（`canonicalize`），消费端按标准名精确匹配 + resolver 别名兜底旧数据。解析链：精确 → 别名 → 归一化键 → 子串（char 专属）。wengine 用 `normalizeRomanKey`（防「残响-Ⅰ/Ⅱ/Ⅲ」系列键碰撞）。

### 11.2 技能类型三套编号（统一 canonical）

- **canonical**（constants.SKILL_TYPES）：0普攻/1闪避/2支援/3特殊/4终结/5核心（游戏 2.0 技能槽顺序；**无独立连携**——连携与终结同槽共享等级）；
- **官方**（characters.json、工坊 mys 源）：0普攻/1特殊技/2闪避/3终结+连携/5核心/6支援 → 映射表 `OFFICIAL_SKILL_TYPE`；
- **工坊 2025 源**（游戏内嵌 1.x ID）：0普攻/1闪避/2特殊技/3连携/5核心/6终结 → `WS2025_SKILL_TYPE`（3 连携并入 4 终结）。
- **聚合必须按源区分**：`extractBuild` 写时固化 `source: 'mys'|'2025'`，`computeSkillStats` 优先读它；旧数据回退 skills 数组顺序判别。前端「我的角色」内部用官方语义自洽，但**跨源匹配（统计视图「我的等级」）必走 `OFFICIAL_SKILL_TYPE` 映射**。

### 11.3 工坊两源判别（sourceOf）

`source` 字段 → `equips[].rarity` 类型（string "S"=mys / number 4=2025）→ skills 数组顺序。rarity 判源实测 20 万条目 100% 可判且与值形态零交叉；旧的数组顺序法误判 0.080%（mys 但 skills 恰呈 ID 升序），降为末位兜底。

### 11.4 大文件处理（workshop.json 2.13GB）

- **任何读取必须流式或定长 readSync**：`fs.readFileSync` 对 >2GiB 抛 `ERR_FS_FILE_TOO_LARGE`/`ERR_STRING_TOO_LONG`（曾坑了 clean-workshop 与 rebuild-stats 的 meta 读取）；
- 读取：`streamJsonArrayElements` generator（跨块 UTF-8 用 `decodeUtf8Tail` 拼接）；
- 写入：爬取中 `flushPart` 分批落盘裸逗号流 + 结束 `mergeWorkshopFile` 流式合并（原子写 tmp+rename）；
- 两类历史损坏（有回归测试）：`"entries":[[` 双括号（修的必须是第二个 `[`，读取器靠字面量定位起点）、跨块截断的 U+FFFD（字节级校验抓不到，必须查字面量 `'�'`）。

### 11.5 断点续爬（workshop）

跳过判断 = **旧文件 entries 实际覆盖的 uid 集合**，文件里没有的 uid 一律重爬（进度领先自动自愈，永不静默丢数据）；不再用进度文件（旧 `.workshop-progress.json` 曾致「进度领先数据」覆盖丢失事故）。

### 11.6 单遍历聚合（computeAllWorkshopStats）

14 项聚合拆成 `{add, finish}` 累加器在一次 for 循环喂完（省 ~6 分钟 I/O）；**累加器 Map/数组必须严格按条目出现顺序写入**（键序与浮点累加顺序漂移会破坏与旧结果的逐位相等）；`weightJson` 必须在聚合前传入。

### 11.7 副词条口径：强化次数，不是词条个数

`substatRolls` 用单次强化基数还原次数（2025 源值=基数×等级、mys 按显示数，`typeof` 自判）。旧「有效词条个数」口径 99.95% 恒为 4 已废弃。有效集合 = `workshop-weights.json` 角色默认流派权重（>0），缺权重退化「全部合法副词条」。

### 11.8 安全姿态（2026-08 加固，勿回退）

只监听回环；静态路由拒 `.` 开头隐藏文件 + 拒 data/ 非 img；`/api/cookie-status` 只回 `cached` 不回明文；所有写请求先挡跨站来源（CSRF）；`/api/config` 原子写。

### 11.9 其他约定

- **百分比 = 小数**（0.3 = 30%），`formatValue` 展示；主/副词条用**数组**（同盘可有「攻击力%」与「攻击力固定」）；
- 最终面板：账号真实值优先，缺失用 wiki 基础值+装备推算（未计 4 件套条件效果/核心被动，刻意设计）；
- `equipPlan` 只含有效副词条 `plan_effective_property_list`（约 18 个角色没有，需手动配置）；推荐套装/456 主属性在 plans.json；
- library.discs **键即套装名**（套装:条目 1:1，6 槽收在 `slotMainStats`）；
- 图片：永远用官方 wiki 源（`act-upload.mihoyo.com` 等），本地化到 `data/img/`；**禁止用工坊图片 URL**；
- 路由统一 ASCII（中文路径会被浏览器百分号编码后匹配失败）；
- 内联 onclick 引用的函数必须 `registerZZZ` 挂到 `window.ZZZ`。

---

## 12. 常用命令速查

```bash
npm start                    # 启动本地服务器（127.0.0.1:8719，自动开浏览器）
npm run sync:library         # 抓 wiki 属性库 → library.json + raw-library.json（含图片本地化）
npm run sync:characters      # 用 cookie 拉账号角色 → characters.json（交互式粘贴 cookie）
npm run sync:plans           # 抓养成指南推荐方案 → plans.json（需缓存 cookie）
npm run sync:plans -- --account  # 只抓账号已练角色
node src/sync/workshop.js            # 全量爬工坊（57 角色 × 7 影画 × 300 条，一步更新 4 个文件）
node src/sync/workshop.js 3          # 只爬前 3 个角色（试跑）
node src/sync/workshop.js 57 300 6 http://127.0.0.1:7890   # 第 5 参 = 代理 URL（IP 被封换 IP）
npm run rebuild:stats        # 只重算 workshop-stats.json（不爬配装）
npm run clean:workshop       # 清洗 workshop.json（乱码/损坏/重复）
npm test                     # 全部单测（缺数据打 SKIP 横幅跳过）
REQUIRE_DATA=1 npm test      # 缺数据直接失败（CI）
node --test test/calc.test.js    # 单文件测试
npm run lint / npm run format    # ESLint / Prettier
set STRICT=1 && npm run sync:library   # 同步时结构校验异常直接中断（cmd/PowerShell 写法）
```

---

## 13. 已知坑与文档不一致

1. **端口**：代码 `server.js` 默认 **8719**（`process.env.PORT || 8719`）；CLAUDE.md 写的 8718 已过时。以代码为准，或显式设 `PORT`。
2. **workshop.json 任何读取必须流式/定长**（2GiB 上限），详见 §11.4。
3. **聚合输出键序敏感**：改 workshopStats 累加器时保持条目出现顺序。
4. **U+FFFD 是合法 UTF-8**，乱码检测必须查字面量 `'�'`。
5. **基准线/百分比陷阱**：CSS 里 `calc(var(--base) * 1%)` 会再乘 0.01；`escapeHtml` 用 `??` 而非 `||`。
6. **新增统计子面板** = `TABS` + `PANEL_RENDERERS` 各加一项（wiki.js / recommend.js 同构）。
7. **新增测试文件**必须加进 package.json 的 test 脚本。
8. **workshop-stats.json ≤2MB 红线**：再加聚合前先量体积（当前 1.91MB）。

---

## 14. 建议阅读顺序（按依赖关系）

1. `package.json` + `index.html` → 知道有哪些入口；
2. `server.js` → 服务端全貌（路由/同步骨架/缓存/安全）；
3. `src/lib/constants.js` → `util.js` → `names.js` → `sort.js` → `schema.js`（地基五件套）；
4. `src/lib/calc.js` → `models.js`（计算引擎与领域模型）；
5. `src/sync/http.js` → `name-index.js` → `library.js` → `characters.js` → `plans.js`（四条链路，由简到繁）；
6. `src/sync/workshop.js` → `src/lib/workshopStats.js`（最复杂的部分，配合 §11.4-11.7）；
7. `src/web/main.js` → `data.js` → `shared.js` → `render.js` → `wiki.js` → `ui.js`（前端主干）；
8. `src/web/charts.js` → `recommend.js` → `discstats.js`（统计视图，最花哨的部分）；
9. `scripts/*.mjs` + `test/helpers.js`（运维与测试基建）。

> 数据口径、设计决策与历史变更的完整记录见 `CLAUDE.md`（唯一权威文档）；本文档负责「代码在哪、干什么、怎么串起来」。
