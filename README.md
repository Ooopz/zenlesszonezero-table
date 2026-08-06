# 绝区零 · 配装面板

个人用的绝区零角色配装展示工具：**卡片 / 统计 / 数据库**三种视图，展示每个角色的**技能等级、影画/潜能觉醒、音擎、驱动盘、最终面板数值、达成率**（实际值为主）。

- **三种视图一键切换**：header 上的分段控件（**卡片 / 统计 / 数据库**）独立成组，随时切换并高亮当前视图；刷新后停留当前视图，也可用 `?view=card/table/wiki` 直接打开
- **卡片视图**（默认），分上下两部分：
  - **上部分左侧**：角色基础信息（头像/名字/标签）、**技能等级**（类型图标 + Lv，悬浮图标看完整技能描述）、**影画 · 潜能觉醒**（6 级点阵，悬浮看富文本描述）、音擎（悬浮图标看特效）
  - **上部分右侧**：最终面板（属性 / 数值 / 达成率进度条）
  - **下部分**：驱动盘详情（6 盘按 123/456 排列，悬浮看套装效果与副词条）
- **统计表格**：每个角色一行（角色/音擎/驱动盘/各属性值），属性值下有小进度条显示达成率；**表头点击排序**（升序 → 降序 → 恢复默认），列/行仍可拖动重排
- **数据库（wiki）**：平铺浏览属性库，四个子面板（**角色 / 驱动盘 / 音擎 / 邦布**）均支持表头点击排序；角色的**技能 / 影画列以 6 个图标横排展示**、悬浮图标看完整说明，另含 CV、突破材料、推荐配队、套装故事等全量信息
- **副词条命中**：卡片头部「有效」按钮为每个角色勾选有效副词条（**未手动配置时默认使用游戏推荐** `equipPlan.plan_effective_property_list`）；驱动盘词条旁标 `×n`（按 B 站 wiki 成长规则推算的强化次数）

## 快速开始

```bash
npm start        # 启动本地服务器（端口 8718，自动打开浏览器）
```

所有数据存于 `data/` 目录，由服务器经 `/api/data` 提供给前端；**必须通过服务器访问页面**（不支持双击 index.html）。

在网页上可一键操作：

- **更新数据库** —— 从米游社 wiki 抓取角色/音擎/驱动盘/邦布基础数据（含介绍、技能、影画、CV、突破材料、推荐配队等全量字段，约 1 分钟，含进度反馈）
- **更新我的角色** —— 用 cookie 拉取你账号所有角色的真实装备与面板（首次需粘贴一次 cookie，之后自动缓存到 `data/.cookie.json`）
- **目标设置** —— 填写目标属性值，卡片显示达成率进度条
- **有效副词条** —— 勾选视为有效的副词条类型（未配置时默认用游戏推荐，手动保存后覆盖）

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
  img/               # 技能类型静态图标（normal/special/dodge/ultimate/passive/support.png）
  lib/               # 双端共享纯模块（ESM，Node 与浏览器均可 import）
    util.js          #   normalize/stripHtml/parseCookies/escapeHtml/formatValue/renderRichText/compareValues 等
    node.js          #   openBrowser（Node 专属）
    schema.js        #   数据 schema + 校验（validateLibrary/validateCharacters）
    calc.js          #   计算引擎（calculateCharacter/discGrowth/…，数据经 setCalcContext 注入）
    models.js        #   领域模型：Character/Wengine/Disc 基类（含属性键归一化）
  sync/              # 同步脚本（可执行，也被 server.js 复用）
    library.js       #   抓取 wiki 属性库 → data/library.json + raw-library.json
    characters.js    #   用 cookie 抓角色 → data/characters.json（全量提取）
  web/               # 浏览器端前端模块（ESM）
    main.js          #   入口：fetch /api/data → 注入数据 → 初始化 → 渲染
    data.js          #   数据层：注入数据、索引、用户配置（含默认有效属性）
    render.js        #   渲染：卡片/统计/悬浮/拖拽/表头排序
    wiki.js          #   Wiki 数据库视图（四个子面板平铺展示）
    ui.js            #   交互：同步/弹窗/事件绑定
test/                # 单元测试（node:test：util/schema/calc/extract/models）
data/                # 数据文件（library.json / characters.json / raw-library.json / user-config.json / debug-response.json）
```

## 同步原理

账号接口 `api-takumi-record.mihoyo.com` 的 CORS 被锁死为 `https://act.mihoyo.com`，浏览器页面无法直连，
所以由本地服务器（`server.js`）代为抓取并写入 `data/*.json`；前端经 `GET /api/data` 读取。cookie 缓存在本地 `data/.cookie.json`（已 gitignore）。

数据流：

```
抓取脚本(src/sync) → 写 data/*.json
server.js /api/data → 读 data/*.json → 前端 fetch
同步完成 → 前端 reload → 重新 fetch /api/data（拿到最新）
```

## 数据说明

- **属性库**：米游社 wiki（无需登录）。角色（初始/满级属性、稀有度/属性/特性/阵营、介绍、技能、影画、CV）；音擎（基础攻击、副属性、特效、外观图、突破材料、推荐角色）；驱动盘（2/4 件套效果、套装故事、副词条与部位主词条建议）；邦布（技能、属性成长、突破材料、推荐配队）。
- **我的角色**：米游社账号接口（需 cookie），`characters.js` 做**全量提取**——除面板/装备外，还包含：
  - 当前影画（`mindscape.rank` + 6 个影画名称/解锁状态/描述）
  - 技能等级（`skills`：普攻/特殊技/闪避/连携/核心被动/支援，含完整描述）
  - 潜能觉醒（`skillAwaken`：当前觉醒等级 + 各技能强化说明）
  - 皮肤列表、元素/职业代码、立绘主色、音擎特效标题、装备规划（`equipPlan`，含游戏推荐有效属性 `plan_effective_property_list`）
- **最终面板**：优先展示账号接口真实值；缺失字段用「属性库基础值 + 装备」计算补齐。推算值未计 4 件套条件效果/核心被动，可能与实际略有出入。
- **原始快照**：`data/raw-library.json` 保存每个 wiki entry_page 的完整原始响应（介绍/技能/影画/CV 等未解析字段），日后可扩展。

## 已知说明

- 角色/音擎名用「去标点归一化」匹配两侧数据；易混淆条目按全名保留 key。
- 属性库中个别新角色 wiki 暂无「满级」行，其面板数值依赖账号接口实际值。
- 属性键名统一：wiki 来源页面对不同角色用词不一（生命/生命力/攻击/防御），同步脚本与前端加载时归一化为 生命值/攻击力/防御力，确保满级属性正常展示与参与计算。
- 百分比与固定值由接口的 `%` 后缀区分；主/副词条用数组保存，同一盘可同时有「攻击力%」和「攻击力固定」。
- 部分角色接口未返回 `equipPlan` 数据（约 18 个），这些角色无游戏推荐默认有效属性，需要时可在「有效副词条」中手动配置。
