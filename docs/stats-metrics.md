# 统计指标与展示规划（2026-08 数据能力扩展后）

> 基于已实现的提取能力（技能/深渊/权重/驱动盘同构）+ 待聚合维度（评分/影画分层/玩家画像），
> 规划「展示什么、怎么展示、数据从哪来」，并重点设计**驱动盘详细统计指标**。
> 数据口径：工坊排行榜全量样本池（高练度标杆，UI 需标注）。

---

## 1. 数据能力总结

### 1.1 已就绪（重爬后自动获得）

| 数据 | 位置 | 内容 |
|---|---|---|
| 技能等级 | `workshop.json` 条目 `skills` | 6 技能 `{type, level}`；聚合按源归一化为 canonical（mys=官方语义 `OFFICIAL_SKILL_TYPE`、2025=1.x ID 语义 `WS2025_SKILL_TYPE`，见 constants.js；支援仅 mys 源、连携并入终结） |
| 深渊战绩 | `workshop-abyss.json`（uid 级） | 层数/评级/最快通关/实战配队（上场角色+影画+邦布）/通关时间/怪物 |
| 工坊权重 | `workshop-weights.json` + `stats.weightJson` | 角色默认流派权重（有效词条口径） |
| 驱动盘同构 | `workshop.json` 条目 `equips[].main/subs` | 两源一致：主词条 + 全部副词条（含无效词条） |
| 面板分布/相关/散点 | `workshop-stats.json` `panels`/`panelCorr`/`panelScatter` | 已有，继续消费 |
| 盘级统计 | `workshop-stats.json` `discDetails` | main456/mainDenom/subs/effDist/subCombos/mainSubCross（同构后全量样本） |

### 1.2 待聚合（进 `workshop-stats.json`，一次同步产出）

| 聚合 | 数据源 | 内容 |
|---|---|---|
| `relicStats` | 条目 `relic_point` | 每角色评分分布（复用 `computeDist` 含 hist） |
| `rankLayers` | 条目 `rank` | 每角色按影画分层的面板分布（最小样本阈值 ≥30） |
| `playerProfiles` | 条目 `uid` | 角色数/评分均值·max/影画总和/S 音擎数/双队完成度 |
| `skillStats` | 条目 `skills` | 每角色 6 技能等级分布（每技能 count/mean/median + 拉满率） |
| `abyssStats` | `workshop-abyss.json` | 层数分布/评级分布/评分×层数分箱/实战配队共现 |
| `completeness` | 条目 | 音擎 60/盘满级/评分>P50 完成度 |
| `roleDiscStats` | 条目 `equips` | 每角色 456 主词条分布 + 副词条 TOP + 有效词条分布（供角色级画像） |

---

## 2. 展示规划（按视图）

### 2.1 新增「练度总览」子面板（`recommend.js` TABS+PANEL_RENDERERS 各加一项）

| 卡片 | 图表 | 数据 | 说明 |
|---|---|---|---|
| 全角色练度评分 | 小提琴/横向条（每角色一行） | `relicStats` + 我的 | 色=我的百分位；最直观的练度对标 |
| 影画金字塔 | 堆叠条（每角色 0-6 影占比） | 条目 rank | 玩家投入分布（人权卡 vs 0 影多） |
| 影画收益 | 分组条形（每角色 0 影 P50 vs 6 影 P50 关键属性） | `rankLayers` | 量化「补影画的数值收益」→ 抽卡决策 |
| 技能拉满率 | 热力图（角色 × 6 技能，色=拉满占比） | `skillStats` | 「技能普遍拉满没有」 |
| 深渊层数分布 | 直方图 + 我的标记 | `abyssStats` | 玩家池实战水平 |
| 评分 × 层数 | 密度散点（复用 densityScatterOption） | `relicStats`×`abyssStats` 配对 | **练度→实战验证**：高评分是否真能打高层 |
| 玩家生态 | 散点（X=角色数 Y=平均评分，气泡=最高评分） | `playerProfiles` | 我的位置 |
| 属性 trade-off | 热力表（数据已有） | `panelCorr` | 理解配比取舍 |

### 2.2 「角色面板」子面板增强（微观对标 + 结论输出）

- **评分仪表盘**：我的角色评分 → `relicStats` 百分位（沿用 approxPercentile）
- **技能对标**：我的 6 技能 vs `skillStats` 分布 → 每技能百分位 + 「该点哪个技能」建议（等级 < P50 且低于方案推荐）
- **深渊对标**：我的层数/评级 vs `abyssStats` → 「我的练度能打到哪」
- **提升优先级清单**：按 `缺口 = 推荐中档 − 我的值` × `落后度 = 50 − 我的百分位` 排序，归因「装备可解/抽卡可解/养成耗时」

### 2.3 驱动盘展示（详见第 3 节指标）

- 「驱动盘」子面板：现有三口径表格保留，**新增图表卡片区**（盘下拉 → 456 分布/副词条生态/有效词条分布/组合/协同）
- 「角色总览」：我的盘毕业度矩阵（角色 × 6 盘，色=有效词条数，悬浮看分布百分位）

---

## 3. 驱动盘详细统计指标设计（重点）

### 3.1 数据基础（同构后每块盘可用）

```
{ suit, slot(1-6), main:[{name,value}], subs:[{name,value}×4] }
+ 聚合层 discDetails（每盘）：main456{4,5,6}+mainDenom、subs 频率、effDist、subCombos、mainSubCross
+ 方案层 plans：每角色推荐套装/456 主词条/副词条
+ 权重层 weightJson：工坊有效词条口径
```

### 3.2 指标定义

#### D1 主词条共识度（玩家 × 攻略）
- **定义**：每盘每槽主词条占比（`main456[slot].count/mainDenom[slot]`）与方案推荐主词条（plans `mainProps` 最常见项）的对比
- **产出**：①「4 号位带暴击率的玩家占 58%，攻略 67% 推荐」→ 共识度百分比；② 玩家与攻略分歧的主词条（发现被低估/高估的配装）
- **展示**：每盘 456 三槽横向堆叠条 + 攻略推荐标记线；「共识度」列进驱动盘表格
- **消费**：驱动盘图表卡片 + 表格增强

#### D2 我的主词条正确率
- **定义**：我的每块盘主词条是否等于该角色最常见推荐主词条（plans 众数）
- **产出**：「4 号位换暴击率收益最大」式的具体换盘建议
- **展示**：角色总览矩阵（角色 × 456 槽，绿✓/红✗）+ 提升清单第一条
- **消费**：我的角色对标

#### D3 副词条生态（歪词条率）
- **定义**：subs 全量频率（同构后含无效词条！）→ 每盘无效词条期望 = Σ(非有效词条频次)/盘数；有效判定按 `weightJson`（工坊口径）或 SUBSTAT_TYPE_SET
- **产出**：「平均每盘歪 X 个词条」「防御力/生命值占副词条 Y%」→ 养成难度的真实写照
- **展示**：副词条频率 TOP 条形（有效词条金/无效词条灰，双色）+ 「歪词条率」进表格
- **消费**：驱动盘图表卡片

#### D4 有效词条分布（毕业度）
- **定义**：effDist 归一化 → 0-4 有效词条占比；**全中率** = 4 词条有效盘数/总盘数
- **产出**：「全中盘仅占 3%」→ 毕业稀有度；我的每块盘有效词条数 → 分布百分位
- **展示**：堆叠条形（0-4 词条占比）/ 小提琴；我的盘标记
- **消费**：驱动盘卡片 + 角色总览矩阵色阶

#### D5 词条组合分析
- **定义**：subCombos 归一 → **双暴组合占比**（含 暴击率+暴伤 的盘占比）、攻击+双暴占比
- **产出**：「主流玩家词条组合画像」
- **展示**：组合 TOP 横向条形（现有悬浮升级为图表）
- **消费**：驱动盘图表卡片

#### D6 主词条 × 副词条协同
- **定义**：mainSubCross → 给定主词条下副词条条件频率（如 4 号位暴击率 → 暴伤 42%/攻击% 35%）
- **产出**：配装规律（「暴击率头配暴伤尾」）；我的盘是否符合该规律
- **展示**：热力图（主词条 × 副词条，色=条件频率）
- **消费**：驱动盘图表卡片

#### D7 套装 × 槽位交叉
- **定义**：同一套装 456 槽的主词条分布（D1 的套装内版本）
- **产出**：「XX 套 4 号位攻击% vs 暴击率占比」→ 套装定位
- **展示**：盘下拉后 456 三行堆叠（与 D1 合并展示）
- **消费**：驱动盘图表卡片

#### D8 角色级配装画像
- **定义**：每角色 456 分布 + 副词条 TOP + 有效词条分布（`roleDiscStats`）
- **产出**：角色配装生态（与方案推荐对比 → 共识度）；我的同角色对标
- **展示**：角色下拉 → 三图联动（456 堆叠 + 词条 TOP + 有效词条分布）
- **消费**：驱动盘面板角色切换 / 角色面板

#### D9 评分 × 盘毕业度（可选）
- **定义**：relic_point 与有效词条数/主词条正确率的相关性
- **产出**：理解工坊评分构成（权重口径验证）
- **展示**：密度散点（X=有效词条数 Y=评分）

#### D10 两源一致性（数据质量，可选）
- **定义**：mys 与 2025 源同盘分布差异（样本占比/词条分布）
- **产出**：数据可信度报告
- **展示**：不直接展示，作为文档指标

### 3.3 优先级

| 优先级 | 指标 | 理由 |
|---|---|---|
| P0 | D1 主词条共识度、D3 歪词条率、D4 有效词条分布 | 直接回答「怎么配 / 歪多少 / 毕业没有」，全部基于现有 discDetails 零新增聚合 |
| P1 | D2 我的主词条正确率、D6 协同规律、D5 组合占比 | 输出换盘建议与配装规律（消费 weightJson/plans） |
| P2 | D7 套装×槽位、D8 角色画像、D9 评分构成 | 细化生态画像（需要 roleDiscStats 聚合） |
| P3 | D10 两源一致性 | 数据质量审计 |

---

## 4. 实施路线

### ✅ 已完成（2026-08）

**阶段 1（聚合层，`workshopStats.js` + `workshop.js`）**：
- 新增 `computeRelicStats` / `computeRankLayers` / `computeRankDist` / `computeSkillStats` / `computePlayerProfiles` / `computeRoleDiscStats` / `computeAbyssStats` + 导出 `bin2D`
- `relic_point` 写时归一为数字（0/缺失置 null，聚合层过滤）
- `buildWorkshopStats` 组装全部新聚合（含深渊评分×层数配对网格 `relicLayer`）
- 测试：7 个新聚合 fixture 测试 + relic_point 归一测试（全部通过）

**阶段 2（前端）**：
- 新增「练度总览」子面板（`recommend.js` TABS+PANEL_RENDERERS 第 6 项）：评分分布条、影画金字塔、影画收益、技能 P90 热力、深渊层数分布、评分×层数密度散点、玩家生态散点、属性 trade-off 相关表
- 「角色面板」增强：技能对标分布图（我的 6 技能 vs 玩家池逐等级分布，我的等级金色柱高亮；官方 type 经 `OFFICIAL_SKILL_TYPE` 映射 canonical 后匹配，避免 1↔2 互换错位）
- `charts.js` 新增 `rankPyramidOption` / `playerScatterOption` / `relicBarOption` / `layerGainOption`；`heatmapOption` 支持 `reached: null`

**阶段 3（驱动盘）**：
- `charts.js` 新增 `discMain456Option` / `discSubsOption` / `discEffOption` / `discComboOption`
- 「驱动盘」面板底部 Top5 热门盘图表卡片区（456 占比堆叠 / 副词条双色生态 / 有效词条分布 / 组合 Top）
- 「角色总览」新增我的盘毕业度矩阵（每块盘有效词条数 vs 该盘 effDist，优于 x% 玩家）

**验证**：157 测试全过、lint 通过、真实数据重算 stats 全字段产出（relicStats/rankLayers/rankDist/skillStats 57 角色、playerProfiles 41,890 玩家、abyssStats 层数分布+配队 Top20+relicLayer）。

### 数据补全后待办

- `workshop-grad.json` 当前 38 角色（工坊 API 风控中）——风控解除后 `node scripts-rebuild-stats.mjs` 重跑 grad（57 角色）+ 重算 stats，roleDiscStats/discDetails 角色覆盖即补全
- 补爬缺失 ~22k uid（`node src/sync/workshop.js`，自愈续爬）后重算 stats，样本即完整
