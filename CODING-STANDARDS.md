# 绝区零配装面板 · 代码规范（CODING-STANDARDS）

> 本文档是本项目「**怎么写代码**」的强制规范：分层、命名、注释、数据口径、错误处理、测试、前端、安全、性能。
> **未来生成/修改的代码一律遵循本文档**，与既有代码冲突时以本文档为准（存量代码不强制回改，但新代码不得照抄坏习惯）。
>
> 文档分工（三者互补，不互相重复）：
>
> - `CLAUDE.md` —— 唯一权威项目文档：数据口径、设计决策、变更记录、常用命令；
> - `CODE-GUIDE.md` —— 代码导读：每个文件干什么、整条链路怎么串；
> - **`CODING-STANDARDS.md`（本文档）** —— 编码规范：代码必须长成什么样。
>
> 规范里每一条「必须/禁止」几乎都对应项目里踩过的坑（标注 🔥 = 有实际事故）。放宽某条规范前，先想清楚当初为什么立它。

---

## 1. 总则（项目底线）

- **零 runtime 依赖**：`dependencies` 必须为空。能用 Node 18+ 内置能力（`fetch`/`http`/`crypto`/`zlib`…）就不引第三方；devDependencies 只允许 eslint/prettier 级别的开发工具。新增依赖前先问：内置 API 真的做不到吗？
- **原生 ESM，无构建步骤**：`"type": "module"`，`import` 必须带 `.js` 扩展名。禁止引入打包器、TypeScript、框架、CSS 预处理器。
- **三份文档分工**：写代码涉及「数据口径/设计决策」时查 CLAUDE.md，涉及「代码在哪」查 CODE-GUIDE.md，涉及「怎么写」查本文档。三者冲突时：代码事实 > CLAUDE.md 口径说明 > 本文档措辞。
- **改口径必须同步文档**：任何数据字段、聚合口径、接口行为的变化，同步更新 CLAUDE.md 的对应小节与「变更记录」——项目只有这三份文档，文档过期 = 没有文档。

## 2. 分层与模块边界

```
server.js          唯一入口：http 服务器（页面 + API + 同步代理），无框架
src/lib/           双端共享纯逻辑（Node 与浏览器均可 import）
src/sync/          抓取脚本（Node，可命令行执行，也被 server.js import 复用）
src/web/           浏览器端 ESM（无构建），DOM 只允许出现在这一层
src/vendor/        本地第三方单文件（当前只有 echarts.min.js，禁止新增）
scripts/           运维脚本（*.mjs，路径一律基于 src/lib/node.js 的 DATA_DIR）
test/              node:test 单元测试
```

依赖方向（禁止反向）：

```
src/web ──▶ src/lib        （web 绝不 import sync/scripts；数据只能经 /api 获取）
src/sync ──▶ src/lib
server.js ──▶ src/sync + src/lib
src/lib     内部无循环依赖
```

各层红线：

| 层          | 必须                                                                                                                                                                 | 禁止                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/lib/`  | 纯函数/纯数据容器，无 DOM、无全局状态；固定字符串引用 `constants.js` 枚举；跨源名称匹配走 `names.js` resolver                                                        | 🔥 **import 任何 `node:` 模块**（除 `node.js` 外，浏览器会直接 import 它们）；写业务匹配逻辑绕过 names.js |
| `src/sync/` | 结尾 `isMain(import.meta, () => main())`（可直接运行也可被复用）；写文件统一 `writeDataFile`/`writeJsonAtomic`（含校验 + 原子写）；名字**写时归一**到 library 标准名 | 顶层副作用（模块加载即发请求/写文件——server 复用时会中招）；路径硬编码 cwd                                |
| `src/web/`  | `export let` 活绑定 + `setData` 注入数据；渲染产出 HTML 字符串；事件委托                                                                                             | 直接 fetch 数据文件；`import` 时拷贝数据快照（活绑定会失效）；任何 `node:` import                         |
| `scripts/`  | 路径基于 `DATA_DIR` 拼接，不依赖「从仓库根运行」                                                                                                                     | 整文件读入超大文件（见 §11）                                                                              |
| `server.js` | 同步模块**按需动态 `import()` 并按 mtime 加 `?v=` 破缓存**                                                                                                           | 🔥 启动时静态 import 同步模块（名称索引会冻结在启动那一刻，同步完 library 后新角色解析不出来）            |

## 3. 文件与模块组织

- **一个文件一个主题**。超过 ~600 行且职责可切分时拆模块（`workshopStats.js` 69KB 是聚合库的例外，不是榜样）。
- **文件头注释**（每个文件必有，第 1 行统一格式）：

  ```js
  // src/lib/sort.js —— 表头三态排序（asc → desc → 复位）状态机 + 空值排最后的排序应用
  // 双端共享纯模块（无 node 依赖）。wiki / 统计表 / 方案表 / 驱动盘统计四处原各有一份
  // 同构实现，统一收敛到这里。空值（null/undefined/空串）行恒排最后，不受升降序影响。
  ```

  第 1 行：`// 相对路径 —— 一句话职责`；后续行：关键约束（双端共享？依赖谁？谁消费？有什么坑？）。server.js 这种根文件省略路径前缀，写 `// server.js —— 本地服务器`。

- **模块内分区**用 `// ---------- 分区名 ----------`（如 `// ---------- 签名协议 ----------`），与文件头之间留空行。
- **import 只出现在顶部**，顺序：`node:` 内置 → 相对模块。ESM 相对路径**必须带 `.js` 扩展名**。
- **统一具名导出**（`export function` / `export const` / `export class`），不用 default export；导入方按需具名导入。
- 公开函数（被其他模块 import）才加 JSDoc；模块私有函数注释从简。

## 4. 命名规范

| 对象                   | 风格                                                                                                    | 例                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 变量/函数              | camelCase                                                                                               | `substatRolls`、`tierRichOption`                        |
| 类/构造函数            | PascalCase                                                                                              | `Character`、`Wengine`、`Disc`                          |
| 常量（含模块私有）     | UPPER_SNAKE_CASE                                                                                        | `MAX_BODY`、`RETRY_BASE`、`PERCENT_STATS`               |
| 布尔（变量/函数/常量） | `is`/`has` 前缀                                                                                         | `isMain`、`isEmptyVal`、`isDamageBonus`、`IS_LOOPBACK`  |
| 累加器（单遍历聚合）   | `makeXxxAcc` → `{add(entry), finish()}`                                                                 | `makeRoleStylesAcc`                                     |
| 计算/构建/抓取函数     | 动词前缀：`compute`/`build`/`fetch`/`extract`/`normalize`/`resolve`/`parse`/`render`/`mount`/`register` | `computeWorkshopStats`、`extractBuild`、`canonicalName` |

- **业务固定字符串必须进 `constants.js` 枚举**，禁止魔法字符串。拼错枚举会得 `undefined`（显式报错），拼错字面量会静默写错数据（🔥 曾靠枚举防住属性名拼写不一致）。
- **数据键名唯一权威 = `schema.js` 的 `KEYS`**：新增/改名数据字段必须同步 KEYS 与校验函数。
- **属性名遵循归一口径**（`util.js` 的 `normalizeStatKey`：生命/生命力→生命值、暴击→暴击率…），新增别名要补测试。
- **跨源名称匹配（角色/音擎/驱动盘/套装/配队）一律走 `names.js`** 的 `buildNameIndex` + `resolveName`/`resolveEntry`/`canonicalName`，禁止手写 `===`/`includes` 匹配——wiki 改名、简称、罗马数字、全角空格差异全在 resolver 里兜底。
- **技能类型编号走 `constants.js` 映射表**（`OFFICIAL_SKILL_TYPE`/`WS2025_SKILL_TYPE`），禁止手写映射——官方/工坊 mys/工坊 2025 三套语义，1↔2 互换是真实发生过的错位形态。
- 目录/路由/文件路径一律 ASCII（🔥 中文路径被浏览器百分号编码后匹配失败）。

## 5. 注释规范

- **注释语言：中文**（本项目唯一语言，代码注释、JSDoc、commit 均如此）。
- **导出函数/类的 JSDoc**：说明「用途 + 关键参数/返回值 + 坑/边界」。坑点用 `⚠️` 前缀，别怕啰嗦：

  ```js
  /** 校验 + 写入 data/ 下的 JSON 文件（sync 脚本收尾共用）。
   *  validate 提供校验函数时先 warnIfInvalid（strict 为 true 则抛错中断）；
   *  pretty 为 false 时用紧凑格式——library.json 嵌套 5 层，pretty 会膨胀到 ~11MB，紧凑仅 ~3.5MB。 */
  ```

- **注释解释「为什么」和「边界」，不解释「是什么」**（代码自明的 `list.sort(...)` 不写注释；写「为什么这里必须 `??` 而不是 `||`」）。
- **踩过的坑必须在代码注释里留痕**（⚠️ + 一句原因），防止后人「清理」掉防御代码：

  ```js
  // ⚠️ 必须直接写 var(--base)，calc(var(--base) * 1%) 会把百分比再乘 0.01 贴底
  // ⚠️ 块边界会切断 UTF-8 多字节字符，必须 decodeUtf8Tail 到最后一个完整字符边界
  ```

- 文件头、分区、JSDoc 三层注释是项目标配，新文件照抄格式。

## 6. 数据与口径约定

- **百分比一律存小数**（值 ≤1，如 0.3 = 30%），展示用 `util.js` 的 `formatValue`；暴伤等聚合值为小数（mys "165.2%" → 1.652），前端按值 ≤3 判百分比显示。禁止混存「显示数」。
- **主/副词条用数组保存**（同一盘可同时有「攻击力%」和「攻击力固定」），词条形态统一成 `[{name, value}]`（`statEntries` 兼容旧格式）。
- **写文件前必须 schema 校验**（`warnIfInvalid`）：默认 warn 不中断（网页同步不被 wiki 解析偶发问题打断），命令行 `STRICT=1` 可中断。
- **写时归一 + 消费端兜底**：同步脚本写文件前把名字 `canonicalize` 成 library 标准名；消费端按标准名精确匹配，resolver 别名兜底旧数据。新增数据源/新名称变体只需在 `names.js` 的 `ALIASES` 或归一化键加一条。
- **两源数据必须显式判别**：工坊 mys/2025 源写时固化 `source` 字段，聚合优先读它；旧数据回退启发式（`sourceOf`）。禁止无差别混算。
- **大 JSON 写文件一律原子写**（`writeJsonAtomic`：tmp + rename），🔥 写一半崩溃会留下半截 JSON 污染下游全部统计。
- **数据文件不入 git**（`data/` 在 `.gitignore`）；测试读数据走 `test/helpers.js`。

## 7. 错误处理与健壮性

- **网络请求不裸 fetch**：米游社走 `src/sync/http.js` 的 `requestJson`（cookie 序列化 + HTTP/retcode 校验 + 重试），工坊走 `workshop-api.js` 的 `fetchJson`（指数退避 2s→6s→18s→54s）。新增接口调用复用这两处封装。
- **并发池失败降级**：`pool(items, limit, fn, onProgress)` 单任务失败返回 `null` 不中断整体（结果按下标对齐）；但**整轮全失败要显式抛错保护旧文件**（🔥 `fetchWorkshopGrad` 曾全失败仍覆盖好数据，已修为「全失败抛错保留原文件、部分失败记 `meta.failed`」）。
- **禁止静默吞错**：`catch` 里必须有动作——打印、降级、标记、重试之一。能静默退化出「看起来正常但口径错了」的分支要显式防住（如聚合缺 `weightJson` 时静默退化为全部合法副词条，须在调用处强制传入）。
- **server 请求体错误**：非法 JSON/超限用 `badRequest(status, msg)` 打标记，顶层按标记回 400/413 且不打栈——调用方的错不许变成 500 日志噪音（🔥 曾被外部任意触发）。超限分支用 `req.pause()` 而非 `req.destroy()`（🔥 destroy 会让 413 响应根本发不出去）。
- **唯一入口脚本**：同步脚本异常统一 `isMain` 捕获并 `exit(1)`；server 的 `unhandledRejection`/`uncaughtException` 只打日志不杀进程。
- **返回 null 而非抛错的 API**（如 `postJSON`）：调用方必须 await 并查 `ok`/返回值，失败要提示（🔥 曾不 await 不查值，保存失败刷新即丢且毫无提示）。

## 8. 测试规范

- **node:test + `node:assert/strict`**；一个 lib 模块对应一个 `test/<module>.test.js`。
- **中文 test 名描述行为与期望**，断言带中文 message 说明（如 `'升序按 zh locale（拼音序）'`）。
- **🔥 新增测试文件必须加进 `package.json` 的 test 脚本**（Node 的 `--test` 不支持 glob，会把 test/ 下所有 JS 当测试文件）。
- **数据依赖**：经 `helpers.js` 的 `loadDataFile()` 读 `data/`；数据缺失时打印醒目 SKIP 横幅再 `exit(0)`（`node --test` 每文件独立子进程）；CI 用 `REQUIRE_DATA=1 npm test`（缺数据直接 `exit 1`，防「静默全绿」）。
- **回归测试要复现坑的形态**，不是理想形态：
  - 聚合器的脏数据用例把被过滤样本**插在数组中间**（追加末尾会下标巧合对齐、测不出 bug）；
  - 断言锚定「修前修后都对」的中间量（如 `st.panel`），别锚定错值之间彼此自洽的产出（如 `st.main`）；
  - 流式合并回归测试覆盖 `"entries":[[` 双括号与跨块 U+FFFD 两类损坏；
  - 上下文注入型逻辑（calc/models）测试前调 `setCalcContext`，构造内联假数据而非依赖真实数据形态。
- **纯函数优先**：可测性来自纯函数（数据进、结果出），测试才不用起服务器/爬数据。
- 提交前 `npm test` 必须全绿（`REQUIRE_DATA=1 npm test` 更严格）。

## 9. 前端规范（src/web/）

- **无构建 ESM**：index.html 只引本地 vendor echarts + `main.js`；`window` 上只允许 `echarts` 与 `registerZZZ` 注册的全局函数。
- **内联 `onclick` 引用的函数必须 `registerZZZ` 挂到 `window.ZZZ`**（ui.js 统一注册点：`openNote`/`openTargetSettings`/`applyPlan`/`selectRole`/`selectDisc`/`wikiTab`/`recommendTab`）。
- **一切来自数据的悬浮内容先 `escapeHtml` 再放 `data-detail`**；富文本（游戏 `<color=#HEX>`/`\n`）过 `renderRichText`（会清 `<script>`/`on*`）。禁止把数据原样拼进 HTML。
- **图表统一主题，禁止硬编码色值**：色板用 `CHART_COLORS`/`SOFT`，轴/图例/标题/工具提示用公共片段（`AXIS_LINE`/`AXIS_LABEL`/`CHART_LEGEND`/`DARK_TOOLTIP`…）；新图表 = `registerChart(key, option)` + `mountCharts()` 挂载，option 带 `readLine` 标记可启用读数参考线。
- **新增统计/数据库子面板 = `TABS` + `PANEL_RENDERERS` 各加一项**（wiki.js / recommend.js 同构），渲染函数返回 `table(headers, rows, sortable)` 即自动获得三态排序与悬浮。
- **样式统一 `:root` 令牌**（`--hazard*` 新名；`--acc*` 旧名保留为别名），JS 内联 `style` 引用令牌而非裸色值；视觉风格（黄黑警示带/斜切硬边/图章/压缩体大写表头）见 CLAUDE.md「视觉体系」。
- **数据层用 `export let` 活绑定**：`setData` 重新赋值后 import 方自动读新值；禁止在 import 处拷贝快照（会拿到旧数据）。
- **图表实例防泄漏**：`render()` 清空 grid 后**无条件**调用 `pruneDetachedCharts`（🔥 原先只挂在 mountCharts 末尾，切走视图时 render 提前 return 就泄漏整套 canvas）。
- **排序统一 `lib/sort.js` 的 `createSort`**（wiki/汇总/方案/统计四处同构），表头 ▲/▼ 指示各视图自渲染；空值行恒排最后。

## 10. 安全规范（server.js 红线，勿回退）

- **默认只监听回环 `127.0.0.1`**：`data/` 下有明文 cookie 与个人数据。对外监听（`HOST=0.0.0.0`）时**必须设 `AUTH_TOKEN`，否则进程拒绝启动**——「暴露」与「无鉴权」不允许同时发生；令牌比较用 `crypto.timingSafeEqual`。
- **静态路由拒绝一切 `.` 开头的隐藏文件/目录**，且 `data/` 除 `img/` 外一律不服务（`.cookie.json`、账号数据不能被抓）；realpath 校验防软链逃逸。
- **cookie 明文只在本地文件**：`/api/cookie-status` 只回 `{cached: bool}`，任何 API 不回传 cookie 明文。
- **所有写请求先挡跨站来源（CSRF）**：`text/plain` 是简单请求无预检，恶意页面可静默 POST 覆盖 `user-config.json`；`ALLOWED_ORIGINS` 放行部署域名。
- **请求体上限**：`MAX_BODY` 4MB（`/api/config` 会把请求体原样落盘，不设限等于开放磁盘写入）。
- 新增任何「数据 → HTML」路径时复查 §9 的转义要求。

## 11. 性能与大数据红线

- **`workshop-stats.json` ≤ 2MB**（浏览器唯一加载的工坊数据，当前 1.91MB）：再加聚合前先量体积，必要时对 role 级明细做 Top-N 截断。
- **🔥 `workshop.json`（2.13GB）任何读取必须流式或定长 `fs.readSync`**：`fs.readFileSync` 对 >2GiB 抛 `ERR_FS_FILE_TOO_LARGE`（整文件读入曾让 clean-workshop 崩溃、rebuild-stats 的 `meta.entries` 静默写成 -1）。读取用 `streamJsonArrayElements`（generator），写入用 `flushPart` 分批裸逗号流 + `mergeWorkshopFile` 流式合并。
- **禁止字符级块切分**（🔥 跨块 toString 把中文截成 U+FFFD；U+FFFD 是合法 UTF-8 编码，字节级校验抓不到，检测乱码必须查字面量 `'�'`）。`copyEntriesTo` 逐条复制，不按块切。
- **聚合必须单遍历**：新聚合 = 在 `computeAllWorkshopStats` 里加一个 `{add, finish}` 累加器，一次 for 循环喂完（🔥 此前每聚合各遍历一遍 2.13GB 文件，每遍 ~27s）。
- **🔥 累加器内部 Map/数组必须严格按条目出现顺序写入**——否则键序与浮点累加顺序漂移，与旧结果不再逐位相等。
- 大 JSON 写文件：`writeJsonAtomic`（tmp+rename）；`library.json` 用紧凑格式（pretty 会膨胀到 ~11MB）。
- 浏览器端只加载 `workshop-stats.json`，**任何新聚合数据不得让前端直接读 workshop.json**。
- 服务器 `/api/data`：`mtime+size` 签名缓存 + ETag（**必须是内容哈希**，🔥 曾写成常数导致数据变化也 304）+ gzip；`Cache-Control: no-cache`（仍走 ETag 协商）。

## 12. 工具链与提交前检查

- **Prettier**（`.prettierrc.json`）：`semi`、`singleQuote`、`printWidth: 120`、`trailingComma: "es5"`、`endOfLine: "auto"`。写完后 `npm run format` 或至少对齐这些设置。
- **ESLint**（扁平配置）：新文件注意全局归属——`src/web/**` = browser；`server.js`/`src/sync/**`/`src/lib/node.js`/`test/**` = node；`src/lib/util.js`/`schema.js`/`calc.js` = 双端；`src/lib/` 其余纯逻辑模块无全局。`src/vendor/**` 在 ignores。
- 提交前三条：`npm run lint` 干净 → `npm test` 全绿（有数据时 `REQUIRE_DATA=1 npm test`）→ 数据/口径变更更新 CLAUDE.md。
- 数据文件改动（新增字段/改口径/删产出）同步更新 `schema.js` 的 `KEYS` 与校验。

---

## 13. 新增/修改代码检查清单

写代码时逐条过一遍：

- [ ] **分层**：放对目录（lib/sync/web/scripts/test）？依赖方向正确？lib 里没 import `node:`？web 没 import sync？
- [ ] **命名与常量**：固定字符串进 `constants.js` 枚举？属性名归一口径？跨源名称走 `names.js`？技能类型走映射表？数据键名同步 `schema.js` KEYS？
- [ ] **注释**：文件头三行式注释？导出函数 JSDoc（含 ⚠️ 坑点）？注释解释「为什么」而非「是什么」？
- [ ] **数据**：百分比存小数？写文件前校验？写文件原子写？名字写时归一？两源判别显式？
- [ ] **错误处理**：网络请求走重试封装？失败降级不静默？全失败保护旧文件？调用方 await 并查返回值？
- [ ] **测试**：新增/修改逻辑有对应单测？中文 test 名 + 断言 message？新测试文件加进 package.json？`npm test` 全绿？
- [ ] **前端**（涉及 web 时）：数据先 `escapeHtml` 再进 HTML？内联 onclick 挂 `window.ZZZ`？图表用统一色板与片段？子面板走 TABS + PANEL_RENDERERS？样式用 `:root` 令牌？
- [ ] **性能**（涉及聚合/大文件时）：单遍历累加器？按条目出现顺序写？流式读？体积红线（≤2MB）？
- [ ] **安全**（涉及 server 时）：回环监听/token 强制？CSRF 校验？cookie 不回显？隐藏文件拒绝？
- [ ] **收尾**：`npm run lint` 干净；文档同步（CLAUDE.md 变更记录、CODE-GUIDE 如有结构性变化）。
