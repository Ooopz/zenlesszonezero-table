# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

个人用的《绝区零》角色配装面板：**本地 Node 服务器 + 米游社/工坊数据同步 + 无构建步骤的浏览器端 ESM**。

**零运行时依赖**（`echarts-gl` 仅用于产出 vendor 文件，运行时不读 node_modules），Node ≥ 18（自带 fetch），全 ESM。

四个一级视图：**我的角色**（账号真实角色卡片/汇总）、**数据库**（wiki 属性库）、**统计**（跨角色统计，三子面板）、**模拟**（两个二级子面板：成长极限帕累托前沿 + 驱动盘练度提升概率）。

## 常用命令

```bash
npm start                    # 启动服务器（端口 8719，自动开浏览器）；页面数据来自 /api/data，必须经服务器访问
npm run sync:library         # wiki 属性库 → data/library.json + data/img/（无需 cookie）
npm run sync:characters      # 账号角色 → data/characters.json（需 cookie，交互式粘贴）
npm run sync:plans           # 养成指南推荐方案 → data/plans.json（需 cookie + e_nap_token）
npm run sync:workshop        # 工坊全量爬取（数小时）→ workshop.json + grad/stats/weights
node src/sync/workshop.js 57 300 6 http://127.0.0.1:7890   # 第 5 参 = 代理 URL（IP 被封时换 IP）
npm run rebuild:stats        # 只重算 workshop-stats.json（不重爬，~2-4 分钟）；改聚合逻辑后用它验证
npm run rebuild:stats -- http://127.0.0.1:7890             # 带代理
node scripts/rebuild-weights.mjs  # 单独重跑 workshop-weights 抽取（不爬配装）：拉 system_data → key 映射标准名 → 落盘 weights + 同步 stats.weightJson

# GitHub Pages 部署（release/，构建产物不入 git）
node scripts/publish-release.mjs              # 构建 release/（index.html+collect.js）并发布 GitHub Release → .github/workflows/pages-from-release.yml 自动部署 Pages（需 gh CLI + 仓库 Pages Source 选 GitHub Actions）
node scripts/publish-release.mjs --no-publish # 只构建 release/（本地预览用），不发布
node scripts/publish-release.mjs --no-build   # 跳过构建，只发布已存在的 release/
# 构建期依赖（devDependencies，不影响运行时）：subset-font（字体子集化）、rollup（ESM→IIFE 打包）

npm test                     # 全部单测（node:test）；缺 data/ 时打印 SKIP 横幅并跳过该文件
REQUIRE_DATA=1 npm test      # 缺数据直接判失败（CI 用，防「静默全绿」）
node --test test/calc.test.js   # 单个测试文件
npm run lint                 # ESLint 扁平配置
npm run format               # Prettier
```

同步命令默认 schema 校验只 warn 不中断；`STRICT=1` 前缀让校验异常直接抛错（网页端同步不受影响）。

**同步依赖顺序：library → characters → plans → workshop**。`library.json` 是**标准名权威源**，其余脚本写盘前做「写时归一」；缺 library 不报错，但只 warn 后降级为不归一，得到名称不一致的数据（前端按名匹配会失效）。

## 数据流主线

```
src/sync/*  →  data/*.json  →  server.js /api/data  →  前端 fetch → setData() → render()
```

账号接口 `api-takumi-record.mihoyo.com` 的 CORS 只放行米游社域来源（如 `act.mihoyo.com` / `user.mihoyo.com`，用户登录入口是 `user.mihoyo.com`），普通页面（如 GitHub Pages）fetch 会被拦截——**这是本地版所有同步必须经过本地服务器、静态版必须用采集书签（在已登录的米游社网页版里运行）的根本原因**。

四个数据源，靠 `src/lib/names.js` 统一名称解析（以 library 标准名为准）合并。

## 分层

### `src/lib/` — 双端共享纯模块

**除 `node.js` 外全部模块 Node 与浏览器共用**。硬约定：

- **禁止 `import 'node:*'`**（`util.js:2`、`names.js:3` 有注释），禁止 DOM 访问
- 需要数据时靠**依赖注入**：`calc.js` 用 `setCalcContext(ctx)`（浏览器在 `main.js` 注入，测试在断言前注入）；其余走显式 ctx/index 参数
- `node.js` 是唯一用 `fs`/`path`/`zlib`/`child_process` 的模块——隔离出去后浏览器 import 任何其他 lib 不会拉进 Node 内置模块
- `eslint.config.js:38-41` 给 `util.js`/`schema.js`/`calc.js` 同时提供 node+browser 全局

| 模块 | 职责 |
|---|---|
| `constants.js` | 游戏领域枚举单一权威（属性名/顺序/副词条/技能类型映射/驱动盘练度概率的 DISC_*：10 维副词条顺序与抽取权重、456 主词条概率表、主词条禁同类映射、工坊权重 key→副词条）。依赖树叶子，零 import |
| `util.js` | 环境无关纯工具 + **属性名别名表 `STAT_ALIASES`**（跨源归一权威） |
| `names.js` | 名称变体 → 标准名解析器（`buildNameIndex`/`resolveName`/`resolveEntry`） |
| `schema.js` | data/*.json 契约（`KEYS` + `validate*`），作用在 sync 写盘边界 |
| `calc.js` | 计算引擎：局外面板合成、副词条成长、达成率、目标缺口 |
| `models.js` | 领域模型 `Character`/`Wengine`/`Disc`，构造时归一 + 派生 + 缓存 |
| `simCalc.js` | 驱动盘成长极限模拟，帕累托有效前沿（2D/3D） |
| `discRules.js` | **驱动盘领域规则唯一权威**（规则编号 A-H，对照 `docs/disc-rules-audit.md`）：A 词条体系（成长表/形态判定/123 固定主词条）、B 生成模型（ZZZ-DDC：首 4 枚举/强化成长/4-3 占比/主词条加权/位置 1/6/定向道具）、C 分数与命中（discGrowth/substatRolls）、D 权重来源、E 保词条比较（含百分比替代固定值）、H 显示配对。**新增驱动盘逻辑先查这里**；constants.js（叶子）仍是 A 组常量权威，discRules 再导出；calc/discProb/workshopAgg/web 均从 discRules 取规则 |
| `discProb.js` | 驱动盘练度概率的**兼容层**（历史 import 链不变）：re-export discRules 的 B/D/E 组 + 保留评级（GRADE_TABLE/gradeOf）与别名（ENTRY_NAMES/SUBSTAT_SPECIAL_WEIGHTS） |
| `discAdvisor.js` | 驱动盘推荐统计 + 官方/实况双口径决策卡合并 |
| `panelBench.js` | plans 的 low/mid/high 三档面板基准（MAD 去离群） |
| `plansStats.js` | plans 每角色 Top 音擎/套装组合（结构对齐 workshop-grad） |
| `distStats.js` | 通用分布统计（分位/离散/形态/pearson/kmeans） |
| `workshopAgg.js` | 工坊 14 项聚合，**单遍历累加器架构**（最大模块，1168 行） |
| `sort.js` | 表头三态排序状态机（升→降→复位，空值恒排最后） |
| `node.js` | Node 专属 I/O：原子写、并发池、workshop 分块 gzip 存储层、流式 JSON |

### `src/sync/` — 抓取脚本（也被 server.js 复用导出函数）

- `mihoyo-api.js`：米游社统一请求 `requestJson`（cookie 序列化 + retcode 校验 + 重试 `simple`/`backoff`）
- `name-index.js`：共享名称索引加载器，四脚本共用
- `library.js`：抓 180+ wiki 详情页。**角色/音擎/驱动盘/邦布四个阶段串行，每阶段组内并发 6**（不是全局 6）。**解析器对页面结构高度脆弱，改动需谨慎**
- `characters.js`：串行拉账号角色（并发 3 防风控），含 cookie 缓存
- `plans.js`：养成指南方案，feed 翻页到 end
- `workshop.js`：工坊下载/提取主编排（断点续爬、PART 暂存、uid 收集）
- `workshop-api.js`：zzzmap 协议层（签名 `MD5(key+参数排序)`，无需 token；重试 2s→6s→18s→54s；**模块加载时自动装代理**）
- `workshop-panel.js`：2025 源面板复算（复现工坊 `enka_attrs_mapping`），另导出 `propName`（`PropertyId → 属性名` 逆映射）
- `workshop-static.js`：逆向提取的静态数据表（69KB 单行，**在 .prettierignore 里，勿格式化**）
- `workshop-stats.js`：聚合侧。**不 import workshop.js**（反过来由 workshop.js re-export），这样 `rebuild-stats.mjs` 不必加载下载侧 + 69KB 静态表
- `proxy.js`：零依赖代理隧道（HTTP CONNECT / SOCKS5 + 认证）。仅目标主机匹配 `*.zzzmap.com` 走代理，米游社请求不受影响

### `src/web/` — 浏览器端 ESM，无构建

`index.html:218-220` 是唯一脚本入口：两个**经典脚本**（vendor echarts / echarts-gl，挂 `window.echarts`）+ 一个 `type="module"` 的 `main.js`。

```
main.js → data.js → api.js（最底层，零依赖）
        → lib/calc.js（setCalcContext 注入）
        → ui.js → sync.js / urlState.js / render.js
                  render.js → myChars.js / wiki.js / statsView.js / simulate.js
                              statsView.js → discstats.js
                  shared.js（纯 HTML 字符串，零依赖）
```

| 模块 | 职责 |
|---|---|
| `main.js` | 入口（34 行）：设 `--head-h` → `fetch('/api/data')` → `setData()` → `setCalcContext()` → `initUi()` |
| `data.js` | **全局 store**（非响应式，变更后手动 `render()`）。用 **ESM live binding**：`export let` + `setData()` 重新赋值，import 方自动读到新值 |
| `render.js` | 唯一渲染入口 `render()`，按 view 分发 |
| `ui.js` | 交互层：目标/备注/技能弹窗、事件绑定、`initUi()` 编排（迁移 → 恢复 URL 状态 → 绑定 → 首渲染） |
| `myChars.js` | 「我的角色」渲染 + **`myTab` 状态的持有者**（`export let myTab` / `setMyTab`）+ 行列拖拽排序 + `toggleTableSort` |
| `wiki.js` / `statsView.js` / `simulate.js` / `discstats.js` | 各视图渲染（`discstats.js` 由 `statsView.js` 引入，不由 render.js 直接引） |
| `charts.js` | ECharts 辅助：`CHART_COLORS` 主题 + `registerChart`/`mountCharts`/`chartBox` 注册-挂载机制 + 15 个 `*Option()` 纯函数（另有 2 个帕累托前沿 Option 私有于 `simulate.js`） |
| `shared.js` | 纯 HTML 字符串共享辅助，无数据层/DOM 依赖 |
| `api.js` | `notify` / `apiRequest`（带超时）/ `postJSON` |
| `sync.js` | 同步中心弹窗：勾选/新鲜度/cookie/进度轮询 + 四个同步请求的封装（`initSync` / `syncWorkshopData`） |
| `urlState.js` | `?view=&tab=&role=&disc=` 同步（`replaceState`，不产生历史记录），外加 `migrateViewState()`（旧视图值一次性迁移，必须先于 `applyUrlState`）与 `applyUrlState()`（首渲染前恢复） |

**前端四条硬约定**：

1. **模块间禁止反向 import，用 setter 注入回调打破环**：`setMyCharsRerender(render)`、`setSimRerender(render)`。`notify` 放 `api.js` 而非 `ui.js` 也是这个原因（`data.js` 要用它，而 `ui.js → data.js` 已是单向依赖）
2. **`window.ZZZ` 是内联 onclick 的出口**：`innerHTML` 生成的元素无法闭包捕获模块作用域，回调经 `shared.js` 的 `registerZZZ()` 注册。字符串参数一律 `escapeJsAttr()`。⚠️ 两处历史例外未收编：`ui.js:253-254` 的 `window.openNote` / `window.openTargetSettings` 是裸全局，新增回调不要照抄
3. **`pruneDetachedCharts()` 必须由 `render()` 在清空 grid 后无条件调用**：从「统计」切到无图视图时 `render` 提前 return 走不到 `mountCharts`，只靠它清理会让 canvas 永久驻留
4. **`CHART_COLORS` 与 CSS `:root` 是手工同步的两份真相**（canvas 读不到 CSS 变量），改主题色必须两边一起改

**渲染模式**：无框架，模板字符串 → `innerHTML` 一次性替换。悬浮提示统一走 `data-detail` 属性 + document 事件委托（`render()` 开头必须 `hideTip()`，否则 innerHTML 替换后提示框残留）。表头排序走 `th[data-sort]` 委托 + `lib/sort.js`。

**`api.js` 的隐式约定**：`apiRequest` 网络失败/超时/JSON 解析失败一律**返回 null 而不抛**，每个调用点必须 `if (j && j.ok)` 双重检查。`timeout: 0` 关超时，长同步请求专用（默认 180s 会误报失败而服务端仍在跑）。

### `server.js` — 无框架 http 服务器

路由：`POST /api/sync-{base,characters,plans,workshop}`、`GET /api/data`、`/api/config`（读写）、`/api/cookie`、`/api/cookie-status`、`/api/sync-progress`、`/api/sync-status`、`/login?token=`，其余走静态文件。

**安全姿态（勿回退）**：

- 默认只监听 `127.0.0.1`——`data/` 下有明文 cookie 与个人账号数据
- 路径穿越三重防护：`decodeURIComponent` 失败回 400、`path.resolve` + `ROOT+sep` 前缀校验、`fs.realpath` 二次校验防软链逃逸
- `isServable` 白名单：任何以 `.` 开头的路径段全拒（挡 `.cookie.json`/`.git`）；`data/` 下**只放行 `data/img/`**
- 所有 POST 先过 CSRF 来源校验——`text/plain` 是简单请求无预检，恶意页面可静默覆盖 `user-config.json`
- **cookie 明文绝不回传前端**：`/api/cookie-status` 与 `/api/sync-status` 只回 `cached: true/false` + `savedAt`（`.cookie.json` 的 mtime，供前端提示「已保存 + 保存时间」）；需要更换时用户重新粘贴覆盖
- `AUTH_TOKEN` 用 `crypto.timingSafeEqual` 比较
- **`HOST` 非回环且未设 `AUTH_TOKEN` 时 `process.exit(1)`**，不是警告（后台运行时警告没人看）

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8719` | |
| `HOST` | `127.0.0.1` | 设 `0.0.0.0` 时 `AUTH_TOKEN` 必填 |
| `AUTH_TOKEN` | 空 | 优先级：`zzz_token` cookie > `X-Auth-Token` 头 > `?token=`。访问 `/login?token=` 种 cookie，只需一次 |
| `ALLOWED_ORIGINS` | 空 | 逗号分隔的额外放行来源。同域部署**无需设置**（`isCrossSite` 认 Origin 与 Host 头一致即同源）；仅当写请求来自与 Host 不同的域名时才需显式放行 |
| `NO_OPEN` | — | 非空则不自动开浏览器 |
| `STRICT` | — | 同步脚本：schema 校验异常直接抛错而非 warn |
| `REQUIRE_DATA` | — | 测试：缺 `data/` 判失败而非 SKIP |
| `HTTPS_PROXY` 等 | — | `proxy.js` 按 `HTTPS_PROXY`→`https_proxy`→`ALL_PROXY`→`all_proxy`→`HTTP_PROXY`→`http_proxy` 优先级取第一个非空；仅对 `*.zzzmap.com` 生效 |

**两个关键机制**：

- **同步互斥锁**：`busy` 全局单锁，`runSync()` 是四个 handler 的统一骨架。**必须在任何 await 之前抢锁**（`readBody` 是异步的，否则并发请求会双双通过检查同时写文件）。`BUSY_MAX_MS = 6h` 后判定残留锁并强制夺锁
- **同步模块懒加载 + mtime 破缓存**：`import('./src/sync/library.js?v=' + mtime)`。同步模块在**模块加载时**读 library.json 建名称索引，启动时静态 import 会把索引冻结在那一刻，同步完 library 后新角色名解析不出来

**`/api/data`**：五文件合计约 34MB，按 `mtime+size` 签名做进程内缓存，配 ETag 协商 + gzip。`slimPlans` 剥离 `desc`/`skills`（`desc` 是大段攻略正文，占体积一半以上）——前端拿不到攻略正文。（173MB 的 `workshop.json` **不在** `/api/data` 里。）

## data/*.json

**整个 `data/` 不入 git**。克隆后必须自己跑同步脚本才有数据。

| 文件 | 大小 | 结构 |
|---|---|---|
| `library.json` | 5.3MB | `{characters, wengines, discs, bangboos}` 四字典，**key 为中文标准名**。**紧凑无缩进，不要 prettier**（pretty 会膨胀到 ~11MB） |
| `characters.json` | 543KB | 数组。每项含 `panel`（`{属性名:{base,bonus,final}}`）/`discs`（恒 6，空槽补占位）/`skills`/`mindscape`/`equipPlan` |
| `plans.json` | 26.6MB | `{avatarId: {name, plans:[...]}}`，57 角色 |
| `workshop.json` | 173MB | **分块 gzip，不是普通 JSON**：第 0 行 `{meta, perChunk:20000, offsets}` + N 个独立 gzip 块。829,891 条。**必须用 `iterWorkshopFile()`/`readWorkshopHeader()`**，`readFileSync` 会超 V8 单字符串上限 |
| `workshop-stats.json` | 1.66MB | 17 个聚合 key。**浏览器只加载这个，上限 ≤2MB，余量已不多**——新增聚合前先量体积 |
| `workshop-grad.json` | 105KB | 全服累计占比。**是 `role_id → 角色名` 的唯一映射来源** |
| `workshop-weights.json` | 14.7KB | 角色默认流派权重。**key 已是 CONSTANT 标准名**（抽取时经 `WS_KEY_TO_STAT` 映射：精通→异常精通、掌控→异常掌控、生命→生命值、防御→防御力、加伤→伤害加成等，全角色并集 12 key）；`scripts/rebuild-weights.mjs` 可单独重跑 |
| `user-config.json` | 780B | 唯一由前端写入的文件（`POST /api/config` 原子写） |
| `.cookie.json` | 575B | **明文米游社登录态** |

所有关键写入都是**原子写（tmp + rename）**。

## 工坊数据口径（重要）

- **样本定义**：按「角色 × 影画档位（0-6）」取排行榜**全量**（每档 ≈300 去重 uid），再抓这些 uid 的**全部角色**。玩家池 = **高练度标杆池**，比全服平均更强。**画像按玩家真实样本统计，不当作全服分布**
- `workshop-grad.json` 是 `grad_stat` 接口的**全服**累计占比（不受爬取口径影响）；`workshop-stats.json` 基于上榜 uid 池聚合
- **副词条口径是强化次数（roll），不是词条个数**：旧「有效词条个数」上限 4 且 99.95% 恒为 4，毫无区分度。`substatRolls(name, value)` 用单次强化基数还原次数
- **两源判别 `sourceOf(e)`**：`source` 字段 → `equips[].rarity` 的**类型**（string `"S"`=mys / number `4`=2025）→ skills 数组顺序，逐级兜底。数组顺序法误判 0.080%，故降为最后兜底

## 关键约定与坑

### 量纲（全项目最易错）

- **`value <= 1` 即百分比**（0.3 = 30%）。`classifyBonus` 靠这个判形态：`{name:'攻击力', value:0.1}` 是 +10%，`value:19` 是 +19 固定值。同一属性名靠**数值量级**区分形态
- **暴击率/暴击伤害恒按 `%` 处理，不看数值**——体现在 `calc.js` 的 `substatType` 与 `util.js` 的 `formatValue` 两处显式特判。注意 `classifyBonus` **本身没有暴击分支**，它们归 `pct` 只是「非 `MULT_STATS` 一律 pct」的自然结果
- **目标值存整数、内部除 100**：用户填 `60` → 内部 `0.6`
- **workshop 两源量纲不同**：2025 源百分比 ×100 存整数（`480` = 4.8%），mys 源存去掉 % 的字符串。`substatRolls` 按 `typeof value` 自判
- 主/副词条用**数组**保存（同一盘可同时有「攻击力%」和「攻击力」固定值）

### 面板计算

- 内部 key 就是**中文属性名本身**，`STAT` 常量只是代码别名（`STAT.ATK === '攻击力'`）
- 合成公式：`MULT_STATS`（攻/生/防/冲击力/能量回复/异常掌控）走 `base × (1 + Σ%) + Σ固定`；其余属性纯加法。**暴击率/暴伤/穿透率不在 MULT_STATS 里，百分比加成纯累加**
- 取整**仅作用于 `theoretical.final`**：生命值 `ceil`（唯一向上）、攻/防/冲击/异常掌控 `floor`、能量自动回复截断 2 位
- 副词条成长表源自 B 站 wiki；成长次数 = `round(value / growth - 1)`
- **2 件套需同套装 ≥2 件**且每种只计一次；**4 件套条件效果一律不计入推算**（刻意设计，与实际有出入）
- 贯穿力 = `round(0.3×攻击力 + 0.1×生命值)`，仅 `trait === '命破'` 角色，同时穿透率三字段全置 null。注意与取整不同：`applyPiercing` 对 `final` 与 `theoretical` **两套面板都调用**

### 名称与属性归一

- **属性名归一走 `util.js` 的 `normalizeStatKey`**（别名表 `STAT_ALIASES`）：wiki 各角色用词不一（生命/生命力/生命指→生命值、暴击→暴击率等）。新增别名要同步补测试。**刻意不加泛化的「伤害→伤害加成」规则**，以免误伤技能文本
- **名称解析统一走 `names.js`**，链固定为「精确 → 别名 → 别名(归一化键) → 归一化键 → 子串兜底」。子串兜底**只对 CHAR 默认开启**。歧义时取最短规范名，保证确定性
- **音擎必须用 `normalizeRomanKey`** 而非 `normalize`（后者会剥光罗马数字，使「残响-Ⅰ/Ⅱ/Ⅲ」键碰撞）
- 写时归一**关 fuzzy**（plans 是全名），工坊侧**开 fuzzy**（`nick_name` 是简称）

### 技能类型三套编号体系

canonical（`constants.js` 的 `SKILL_TYPES`）= 0普攻/1闪避/2支援/3特殊/4终结/5核心。游戏 2.0 后**无独立「连携」**（与终结同槽共享等级）。

- 官方（账号数据）与**工坊 mys 源** → `OFFICIAL_SKILL_TYPE` 映射
- **工坊 2025 源**（1.x 技能 ID）→ `WS2025_SKILL_TYPE` 映射

**mys 与 2025 语义不同，聚合必须按源区分**。跨源匹配不经映射必错（1↔2 互换、终结/支援错位）。

### `workshopAgg.js` 单遍历架构（最危险的约束）

14 项聚合各拆成 `{add(entry), finish()}` 累加器，`computeAllWorkshopStats` 建好后**只遍历一次**（原来每聚合各跑一遍 = 把 173MB 文件解析十几遍）。

**硬约束：累加器内部 Map/数组必须严格按条目出现顺序写入**，否则输出键序与浮点累加顺序漂移，与旧结果不再逐位相等。`test/workshopAgg.test.js` 有专门用例用 `JSON.stringify` 比对「单遍历 vs 逐个公开函数」逐位相等（同时校验键序）。

由此衍生：`computePanelCorrelations` 与 `computePanelScatter` 属性对不同，**必须各建采集器**，合并会改 key 插入顺序。

每个累加器 `add()` 开头都有 `if (!e) return` 守卫——单条脏数据抛异常 = 全量重算约 4 分钟零产出。

`opts.weightJson`（或 `opts.roleWeights`）**必须在聚合前传入**——`effDist` 与 `rollEfficiency` 都依赖它，缺失会静默退化为「全部合法副词条」。

### 米游社接口

- **`DEVICEFP` / `_MHYUUID` 必须是 cookie 里的真实值**，伪造被 `retcode 10041` 拒；缺失触发 Geetest 风控 `retcode 10035`
- `e_nap_token` 是养成指南专用登录态，可能先于其他 cookie 过期
- 请求头伪装三套（wiki / 米游社 App / 养成指南），App 升级后可能需按新客户端抓包更新
- 并发：library 6、characters 与 plans **3**（防风控）
- 全量失败时**抛错而非写空文件**（plans、grad 都有此保护）

### 工坊爬取

- **断点续爬以 `workshop.json` 实际内容为准**（不用进度文件）：跳过判断 = 文件里已有的 uid 集合，缺的自动重爬。曾因进度先于写文件导致 145830 条覆盖了 9579/63842 uid 的数据丢失
- **全量重爬需手动 `rm data/workshop.json`**
- `.workshop-part.json` 是崩溃残留，下次运行开头直接丢弃，靠自愈重爬，**不要手工去救**
- **不要加串行限速**：排名阶段角色级并发 + 每角色 7 影画组内并行翻页（实测 6.4× 提速）。接口硬性每页 50 条（limit 参数无效）
- 三个硬阈值（改并发/限流前先看）：`PER_RANK = 300`（每档取样上限）、`PART_FLUSH = 10000`（攒够即落 PART 暂存）、**连续失败 20 次 → `sleep(60s)` 后清零**（自适应退避，不是死循环重试）
- IP 被封时用代理换 IP（第 5 参或 `HTTPS_PROXY`/`ALL_PROXY`）
- **永远不要用工坊的图片资源**。所有图片一律用官方 wiki 数据源，本地化到 `data/img/`。工坊图片仅用于参考定位接口/字段

### 测试

- `node --test` 内置，零测试依赖。全部顶层 `test()`，无 `describe`。当前 **198 项全绿，0 skip**
- **测试依赖真实数据文件**（`data/` 不入库）：`test/helpers.js` 的 `loadDataFile()` 缺文件时打印 **SKIP 横幅**后 `exit(0)`。⚠️ `node --test` 把「加载后 exit(0) 的文件」记成 1 个**通过**的测试，与真正全绿肉眼无法区分——CI 用 `REQUIRE_DATA=1 npm test`
- **`package.json` 的 test 脚本是手动逐个列出 22 个文件的**（Node 的 `--test` 不支持 glob，且会把 `test/` 下所有 JS 当测试文件）。**新增测试文件必须手动追加进这个字符串**，否则该文件永远不会被运行且完全无提示。`test/helpers.js` 不在列表里（它不是测试文件）
- 三种 mock 模式：纯内联 fixture / 真实数据依赖 / 混合（内联跑逻辑 + 末尾一个 `test('真实数据冒烟：…')`）。`test/plans.test.js`（`extractPlan`）、`test/workshop-panel.test.js`（`computeEnkaPanel`/`propName`，fixture 取自 `workshop-static.js`）与 `test/discProb.test.js`（驱动盘练度概率，含概率单调性/定向过滤/别名映射断言）属**纯内联**，不依赖 `data/`，永远不会 SKIP
- 断言几乎全带中文说明第三参；浮点用 `1e-9` 容差；键序也要一致的场景用 `JSON.stringify` 比对
- **回归用例显式标注原 bug**，如 `'streamJsonArrayElements：块边界落在条目间隙不丢条目（回归：曾提前 break 丢 85% 条目）'`

### 已在注释中固化的历史 bug（改动时勿回退）

- `server.js` — **ETag 必须是响应内容哈希**，曾误写成 `dataSignature().length`（恒为 132），数据变了也一直 304
- `server.js` — 请求体超限只 `pause` 不 `destroy`，否则 413 响应根本发不出去
- `library.js` — 必须用 `Number.isFinite`：`NaN != null` 为 true 会提前 return 写出 `baseAtk: NaN`，且 `typeof NaN === 'number'` 让 schema 也拦不住
- `node.js` — 流式解析**不能在块边界检查「数组结束」**（`!started && depth===0` 在元素间隙也为真，曾致 60 万条只解析出 9 万）；块边界会切断 UTF-8 多字节字符，必须 `decodeUtf8Tail`。**U+FFFD 是合法 UTF-8 编码，字节级校验抓不到，检测乱码必须直接查字面量 `'�'`**
- `workshop.js` — `flushPart` 必须清空数组，否则 O(n²) 写放大（曾现 870 万虚高计数）
- `workshop.js` — mys 源判定要求数组**非空**，2025 源的空数组是 truthy 会误走 mys 分支返回空面板
- `workshop-panel.js` — 装备属性必须**累加合并**，对象展开会让暴伤被套装覆盖丢失
- `characters.js` — `collectStats` 返回数组而非对象（同一盘可有同名的 % 与固定值两条目）
- `util.js` — `escapeHtml` 用 `??` 而非 `||`，否则 `escapeHtml(0)` 返回空串把合法的 0 从 DOM 抹掉
- `distStats.js` — `pearson` 按较短数组配对，此前越界读 undefined 使结果静默变 NaN
- `workshopAgg.js` — 流派聚类的 `idx` 来自**过滤后**的 `valid` 数组，误索引 `o.samples` 会让被过滤样本之后全部错位一格（实测最坏污染某角色 92.8% 归属）
- `names.js` — 用 `hasOwnProperty` 而非 `in`，防 rawName 为 `"constructor"` 时命中 `Object.prototype`

## 视觉体系（style.css）

「街头硬边」风：炭黑基底 `#0a0a0a` + 警示黄 `#ffd400` + 米白文字，**单主题无切换**。

**全部颜色/字体/尺度由 `:root` 令牌驱动，禁止硬编码色值**。命名分七组：基底 `--bg/--card/--line`、文字 `--txt/--dim`、品牌 `--hazard*`、语义 `--red/--green/...`、稀有度 `--rarity-s*/-a*`、排版 `--font-*/--fs-*`、尺度动效 `--sp-*/--cut/--t`。

⚠️ **别名层**：`--acc` / `--acc2` / `--acc-deep` / `--acc-rgb` / `--grad-gold` 是**旧名别名**（指向 `--hazard*`），存在的唯一目的是让 JS 里大量内联 `style="color:var(--acc)"` 零改动继续工作。新写 CSS 用 `--hazard`。

运行时注入的令牌：`--head-h`（`main.js` 的 ResizeObserver 实时写入——header flex-wrap 换行后高度变化，只算一次会让 sticky 表头错位）、`--i`（卡片入场动画错峰）。

字体本地打包在 `src/fonts/`（Barlow Condensed 西文展示体 + Noto Sans SC 可变体，OFL）；`scripts/fetch-fonts.mjs` 可重下（手写 CONNECT 隧道走本地代理 `127.0.0.1:7897`，绕过 Windows Schannel 沙箱限制——与 `proxy.js` 是两套独立实现，默认端口也不同）。

## 已知技术债

- ⚠️ **前端模块图无任何自动化护栏**（历史教训）：曾因模块拆分把 `myTab`/`setMyTab` 移到 `myChars.js` 而漏改 `ui.js`/`urlState.js` 的导入源，导致**整页白屏**。ESM 具名导入在**链接阶段**校验，一处对不上则整条模块图都不执行，`main.js` 的 try/catch 也救不了（异常在 import 解析期，不在 try 体内）；而 `npm test` 与 `npm run lint` **都抓不到**（前端模块不在测试覆盖内，ESLint 不做跨模块导出校验）。**移动前端模块的 export 后，务必手动验证链接**：`npm start` 后逐个 `curl` 或用 Node 动态 import 走一遍 `src/web/*.js`，看是否只剩 `document is not defined` 这类执行期错误
- **无 CSP**，而项目大量用 `innerHTML` 渲染 wiki 富文本（`renderRichText` 是有意的白名单富文本路径，会清除 `<script>` 与 `on*`）
- **无限流**：`/api/data` 未命中缓存要重读解 33MB + gzip。回环场景可接受，部署场景值得加
- `workshop-panel.js` 的 2025 源面板公式随游戏版本失准会**静默漂移**（原两源一致性审计已删除）。已有 `test/workshop-panel.test.js` 护栏（角色基础/武器/盘成长/套装 2 件套四段公式精确断言）；⚠️ 面板输出按 floor 显示，**亚单位级系数漂移可能被取整吸收而测试抓不到**
- 部分角色接口未返回 `equipPlan`（约 18 个），无游戏推荐默认有效属性，需手动配置
