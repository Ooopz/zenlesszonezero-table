# 绝区零配装面板（Zenless Zone Zero Build Panel）

个人向的《绝区零》角色配装分析工具：**本地 Node 服务器 + 米游社/工坊数据同步 + 浏览器端零构建 ESM**。数据来自你真实的游戏账号与全服玩家配装，提供面板达成率、跨角色统计、成长模拟与驱动盘练度概率分析。

## 功能

- **我的角色**：账号真实角色卡片 / 汇总表格，面板合成、目标达成率、副词条命中统计、备注与排序
- **数据库**：wiki 属性库（角色 / 音擎 / 驱动盘 / 邦布），含技能数值、套装效果、推荐方案
- **统计**：跨角色统计（面板分布、副词条成长、流派聚类、全服配装对标），基于工坊高练度玩家样本
- **模拟**：成长极限帕累托有效前沿（2D/3D）+ 驱动盘练度提升概率（ZZZ-DDC 模型，含定向道具模拟）

## 快速开始

```bash
npm install        # 安装（零运行时依赖；构建期依赖 subset-font/rollup/jimp 仅部署用）
npm start          # 启动服务器（http://127.0.0.1:8719，自动开浏览器）
```

页面数据来自 `/api/data`，**必须通过服务器访问**。首次使用先同步数据（见下）。

## 数据同步

数据源顺序：**library → characters → plans → workshop**（`library.json` 是角色标准名的权威源）。

```bash
npm run sync:library       # wiki 属性库 → data/library.json + data/img/（无需 cookie）
npm run sync:characters    # 账号角色 → data/characters.json（需米游社 cookie，交互式粘贴）
npm run sync:plans         # 养成指南推荐方案 → data/plans.json（需 cookie + e_nap_token）
npm run sync:workshop      # 工坊全量更新（数小时）→ workshop.json + grad/stats/weights（等价 CLI full）
```

也可以在页面右上角「同步数据」弹窗中一键操作（会自动引导粘贴 cookie）。

### 工坊数据（全服配装）CLI

```bash
node scripts/workshop-cli.mjs                       # full（默认）：grad → weights → rank → chars（chars 末尾自动重算 stats）
node scripts/workshop-cli.mjs --mode=rank           # 只更新 uid：全角色×7影画×300 排名收集 → data/workshop-uids.json
node scripts/workshop-cli.mjs --mode=chars          # 批量下载角色信息（读 workshop-uids.json，断点续爬）→ workshop.json
node scripts/workshop-cli.mjs --mode=grad           # 只更新全角色配装统计 → workshop-grad.json
node scripts/workshop-cli.mjs --mode=weights        # 只更新全角色默认副词条权重 → workshop-weights.json
node scripts/workshop-cli.mjs --mode=stats          # 只重算统计聚合 → workshop-stats.json（不爬取，~2-4 分钟）
node scripts/workshop-cli.mjs --concurrency=6 --proxy=http://127.0.0.1:7890   # 并发 / 代理（IP 被封时换 IP）
```

> 爬取为「角色 × 影画档 × 每影画 300 条」的排行榜全量，随后抓取每个 uid 的全部毕业角色配装，可断点续爬。被风控时用 `--proxy` 或 `HTTPS_PROXY` 环境变量走代理（仅 `api.zzzmap.com` 请求走代理）。

## GitHub Pages 部署（单文件版）

构建产物全内联进一个 `index.html`（CSS/JS/数据/图片/字体，离线可打开），通过 GitHub Release 自动部署：

```bash
node scripts/publish-release.mjs                # 构建 release/ 并发布 Release → Actions 自动部署 Pages
node scripts/publish-release.mjs --no-publish   # 只构建（本地预览用）
node scripts/publish-release.mjs --no-build     # 跳过构建，只发布
```

**一次性配置**：仓库 Settings → Pages → Source 选 **GitHub Actions**；Settings → Environments → github-pages → Deployment branches 选 **All branches and tags**。

**我的角色导入（静态版无后端）**：

1. 电脑上安装采集书签：打开页面「同步数据 → 数据导入」，把「采集我的角色」链接拖到书签栏（或右键 → 添加到书签栏）
2. 打开 `user.mihoyo.com`（米游社网页版，需已登录）→ 点书签 → 自动抓取角色并**复制到剪贴板 + 下载 `zzz-chars.json`**
3. 电脑直接粘贴导入；**手机**：把 `zzz-chars.json` 传到手机 → 数据导入 →「选择 JSON 文件」（手机端无法运行书签/控制台，用文件导入）

> 静态版数据只存**本浏览器 localStorage**，不会上传。数据更新后重新构建发布即可。

## 测试与代码质量

```bash
npm test          # 全部单测（node:test；缺 data/ 时跳过，CI 用 REQUIRE_DATA=1 npm test 防静默全绿）
npm run lint      # ESLint
npm run format    # Prettier
```

## 目录结构

```
├── server.js            # 无框架 http 服务器（/api/data、同步接口、静态文件）
├── index.html           # 页面入口（模板，部署时内联构建）
├── style.css            # 「街头硬边」视觉体系（CSS 令牌驱动 + 移动端断点）
├── src/
│   ├── lib/             # 双端共享纯逻辑（无 node:* 依赖）：计算引擎/领域模型/驱动盘规则/聚合
│   ├── sync/            # 抓取脚本（米游社/工坊/wiki），同时被 server.js 复用
│   └── web/             # 浏览器端 ESM（无构建）：数据层/渲染/交互/图表
├── scripts/             # 命令行工具：workshop-cli（工坊数据更新）、publish-release（构建部署）
├── test/                # node:test 单测（22 文件）
└── data/                # 同步产物（不入 git）：library/characters/plans/workshop-*.json + img/
```

## 数据来源与免责

- 账号角色 / 养成指南：米游社官方接口（`user.mihoyo.com` 登录）
- 全服配装：绝区零工坊（`api.zzzmap.com`，公开接口）
- 属性库 / 技能数值：官方数据（wiki 详情页）

仅供个人学习与配装参考，数据版权归原平台所有。
