# 绝区零 · 配装面板

个人用的绝区零角色配装展示工具：双列网格卡片 + 统计表格两种视图，展示每个角色的**音擎 + 驱动盘 + 套装效果 + 最终面板数值 + 达成率**（实际值为主，附计算明细）。

- **卡片视图**（默认）：每个角色一张卡，含音擎效果、驱动盘明细、最终面板、按角色的达成率
- **统计表格**：每个角色一行（角色/音擎/驱动盘/各属性值），属性值下有小进度条显示达成率；可加 `?view=table` 直接打开
- **副词条命中**：卡片头部「有效」按钮为每个角色勾选有效副词条；驱动盘词条旁标 `×n`（按 B 站 wiki 成长规则由词条数值推算的强化次数）

## 快速开始

```bash
npm start        # 启动本地服务器（端口 8718，自动打开浏览器）
```

所有数据存于 `data/` 目录，由服务器经 `/api/data` 提供给前端；**必须通过服务器访问页面**（不再支持双击 index.html）。

在网页上可一键操作：

- **同步属性库** —— 从米游社 wiki 抓取角色/音擎/驱动盘基础数据（约 1 分钟，含进度反馈）
- **同步我的角色** —— 用 cookie 拉取你账号所有角色的真实装备与面板（首次需粘贴一次 cookie，之后自动缓存到 `.cookie.json`）
- **目标设置** —— 填写目标属性值，卡片显示达成率进度条

## 命令

| 命令                      | 作用                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `npm start`               | 启动本地服务器并打开页面                                                        |
| `npm run sync:library`    | 命令行更新属性库（写入 `data/library.json` + 原始快照 `data/raw-library.json`） |
| `npm run sync:characters` | 命令行拉取我的角色（写入 `data/characters.json`，需粘贴 cookie）                |
| `npm test`                | 运行单元测试（node:test）                                                       |

## 文件结构

```
server.js            # 本地服务器入口：静态服务 + API（/api/data、同步、配置、cookie）
index.html           # 页面（无内嵌数据，<script type="module"> 加载前端模块）
src/
  lib/               # 双端共享纯模块（ESM，Node 与浏览器均可 import）
    util.js          #   normalize/stripHtml/parseCookies/escapeHtml/formatValue 等
    node.js          #   openBrowser（Node 专属）
    schema.js        #   数据 schema + 校验（validateLibrary/validateCharacters）
    calc.js          #   计算引擎（calculateCharacter/discGrowth/…，数据经 setCalcContext 注入）
  sync/              # 同步脚本（可执行，也被 server.js 复用）
    library.js       #   抓取 wiki 属性库 → data/library.json + raw-library.json
    characters.js    #   用 cookie 抓角色 → data/characters.json
  web/               # 浏览器端前端模块（ESM）
    main.js          #   入口：fetch /api/data → 注入数据 → 初始化 → 渲染
    data.js          #   数据层：注入数据、索引、用户配置、过滤
    render.js        #   渲染：卡片/表格/悬浮/拖拽
    ui.js            #   交互：同步/弹窗/事件绑定
test/                # 单元测试（node:test）
data/                # 数据文件（library.json / characters.json / raw-library.json / user-config.json / debug-response.json）
```

## 同步原理

账号接口 `api-takumi-record.mihoyo.com` 的 CORS 被锁死为 `https://act.mihoyo.com`，浏览器页面无法直连，
所以由本地服务器（`server.js`）代为抓取并写入 `data/*.json`；前端经 `GET /api/data` 读取。cookie 缓存在本地 `.cookie.json`（已 gitignore）。

数据流：

```
抓取脚本(src/sync) → 写 data/*.json
server.js /api/data → 读 data/*.json → 前端 fetch
同步完成 → 前端 reload → 重新 fetch /api/data（拿到最新）
```

## 数据说明

- **属性库**：米游社 wiki（无需登录）。角色 60 级基础属性、稀有度/属性/特性/阵营、图标；音擎满级基础攻击力 + 副属性 + 特效；驱动盘 2/4 件套效果。
- **我的角色**：米游社账号接口（需 cookie）。当前等级、装备（音擎 + 6 盘主/副词条）、面板数值（base/bonus/final）、精炼、稀有度等。
- **最终面板**：优先展示账号接口真实值；缺失字段用「属性库基础值 + 装备」计算补齐。「计算明细」为推算值，4 件套条件效果/核心被动未计入。
- **原始快照**：`data/raw-library.json` 保存每个 wiki entry_page 的完整原始响应（介绍/技能/影画/CV 等未解析字段），日后可扩展。

## 已知说明

- 角色/音擎名用「去标点归一化」匹配两侧数据；易混淆条目按全名保留 key。
- 属性库中个别新角色 wiki 暂无「满级」行，其面板数值依赖账号接口实际值。
- 百分比与固定值由接口的 `%` 后缀区分；主/副词条用数组保存，同一盘可同时有「攻击力%」和「攻击力固定」。
