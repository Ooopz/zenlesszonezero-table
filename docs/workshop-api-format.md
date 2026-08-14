# 工坊 API 返回格式与可挖掘字段清单

> 目的：展示 `api.zzzmap.com` 各接口的原始返回格式，逐字段标注「已提取到 workshop.json」vs「未提取（可挖掘）」，
> 供手动确认还有哪些数据可以挖掘。
> 真实样本：`data/raw-v3-sample.json`（2026-08 抓取，uid 13503759「次次」，39 角色，mys + 2025 双源齐全）。

---

## 1. API 总览

| 接口 | 方法 | 用途 | 数据量 |
|---|---|---|---|
| `/api/v1/system_data/public` | GET | 全局字典：角色/音擎/驱动盘套装列表 | 57 角色 + 94 音擎 + 30 套装 |
| `/api/v1/user_relic/ranking` | GET | 排名：按 角色×影画档 拉上榜 uid | 分页 50/次 |
| `/api/v1/user_role/v3` | POST | 单个 uid 的**全部角色**配装（两种 item_json 源） | 每 uid 1 次请求 |
| `/api/v1/role/grad_stat` | GET | 每角色全服音擎/套装占比 | 57 请求 |

签名：`MD5(key + 排序后参数串)`，key 与请求方式见 `src/sync/workshop.js` 的 `makeSign`/`apiGet`/`apiPost`。

---

## 2. `system_data/public`（字典，含可挖掘字段）

### system_roles（57 条）
```json
{
  "role_id": "99218e78e40c43d4a0e15d6bd42732ff",
  "nick_name": "照", "en_name": "Zhao", "short_name": "照",
  "item_id": "1341",
  "element": "bing", "profession": "fanghu", "level": 5, "pool_type": 1,
  "avatar": "https://...png", "role_picture": "https://...png", "draw_picture": "https://...png", "long_avatar": "https://...png",
  "weight_json": {
    "factions": [{
      "name": "默认流派",
      "weights": [{"key": "暴击", "weight": 0.5}, {"key": "暴伤", "weight": 0.5}, {"key": "生命", "weight": 1}, {"key": "能量", "weight": 1}]
    }]
  }
}
```
- ✅ 已用：`item_id`、`nick_name`（写时归一名）、`avatar`（图标 fallback）
- 🔶 **未提取**：`weight_json` —— **工坊自己的有效词条权重定义**（流派 × 属性权重）。可用于复现工坊「有效词条」判定与 relic_point 评分逻辑（比自建权重更贴近工坊口径）

### system_weapons（94 条）
```json
{"weapon_id": "b8324fbc8abd4c6983c02f8324725919", "item_id": "14158",
 "nick_name": "空羽复归之诗", "avatar": "https://...png",
 "pool_type": 1, "profession": "yichang", "level": 5}
```
- ✅ 已用：`item_id`、`nick_name`（音擎名解析）
- 🔶 未提取：`profession`（特性）、`level`（池子等级）、`pool_type`（限定/常驻池标记 → 可分析音擎获取难度）

### system_artifacts（30 条）
```json
{"relic_id": "1a384b054bde43ff9884b99fe0d79355", "name": "棘刺玫瑰",
 "two_effect": "_", "four_effect": "_", "set_id": "34200",
 "avatar": "https://...png", "effect_type": null, "level": 5}
```
- ✅ 已用：`set_id`、`name`（套装名归一）
- 🔶 未提取：`two_effect`/`four_effect`（套装效果文本，工坊版）——library 已有更全，价值低

---

## 3. `user_relic/ranking`（排名）

```json
{"item_id": "1091", "level": 60, "uid": "13503759", "relic_point": "326.500", "rank": 6,
 "user_case": {"uid": "13503759", "nick_name": "次次", "level": 60}}
```
- ✅ 已用：`uid`（收集爬取目标）、`item_id`、`rank`（影画档）
- 🔶 未提取：`relic_point`（排名接口自带评分）、`user_case.nick_name`（可用于玩家昵称分析；同 uid 昵称可跨期追踪）

---

## 4. `user_role/v3`（配装，核心）

### 4.1 顶层 `data`
```json
{"uid": "13503759", "nick_name": "次次", "level": 60,
 "role_total": 0, "status": 0, "updated_at": "2026-08-07T04:59:44.000Z", "update_ids": [],
 "roles": [ ...39 个角色条目... ],
 "abyss_data_json": { ...深渊战绩... }}
```
- ✅ 已用：`nick_name`（写入条目）、`roles`
- 🔶 **未提取**：`abyss_data_json` —— 详见 4.4，**玩家真实战斗成绩**

### 4.2 角色条目公共字段（两种源一致）
```json
{"uid": "...", "name": "...", "item_id": "1081", "level": 60, "rank": 6,
 "weapon_id": "13108", "weapon_level": 60,
 "relic_point": "257.00", "attack": "0.00", "hp": "0.00",
 "weight_info": null, "source_api": "mys", "status": 0,
 "item_json": { ...源特有... }}
```
- ✅ 已用：`level`、`rank`、`relic_point`、`item_json`
- 🔶 未提取：`source_api`（**源标记，可替代代码内 mys/2025 判定**）、`weapon_id`/`weapon_level`（冗余但可直接用）、`attack`/`hp`（本样本为 "0.00"，疑似废弃字段）、`weight_info`（本样本 null，疑似未启用）

### 4.3a mys 源 `item_json`（工坊格式化，面板现成）

```json
{
  "id": 1081, "level": 60, "rank": 6, "rarity": "S", "ranks": [...], "skills": [...],
  "element_type": 201, "camp_name_mi18n": "白祇重工", "full_name_mi18n": "格莉丝·霍华德",
  "sub_element_type": 0, "avatar_profession": 1, "name_mi18n": "格莉丝",
  "weapon": { "id": 13108, "name": "仿制星徽引擎", "star": 5, "level": 60, "rarity": "A",
              "profession": 1, "talent_title": "骑士光波：改",
              "properties": [{"add": 0, "base": "25%", "level": 0, "valid": false, "property_id": 12102, "property_name": "攻击力"}],
              "main_properties": [{"base": "624", "property_id": 12101, "property_name": "基础攻击力"}] },
  "properties": [ {"add": "2648", "base": "6907", "final": "9555", "final_val": "9555", "property_id": 1, "property_name": "生命值"}, ... ],
  "equip": [ {
    "id": 33541, "icon": "...", "name": "沧浪行歌[1]", "level": 15, "rarity": "S",
    "all_hit": true, "invalid_property_cnt": 0, "equipment_type": 1,
    "equip_suit": {"suit_id": 33500, "name": "沧浪行歌", "own": 2, "cnt": 0,
                   "desc1": "物理伤害+10%。", "desc2": "装备者处于任意[以太帷幕]中时..."},
    "main_properties": [{"base": "2200", "property_id": 11103, "property_name": "生命值"}],
    "properties": [ {"add": 1, "base": "4.8%", "level": 2, "valid": true,  "property_id": 20103, "property_name": "暴击率"},
                    {"add": 0, "base": "15",   "level": 1, "valid": false, "property_id": 13103, "property_name": "防御力"},
                    {"add": 2, "base": "9%",  "level": 3, "valid": true,  "property_id": 12102, "property_name": "攻击力"},
                    {"add": 2, "base": "14.4%", "level": 3, "valid": true, "property_id": 21103, "property_name": "暴击伤害"} ]
  } ]
}
```

| 字段 | 已提取？ | 可挖掘价值 |
|---|---|---|
| `skills`（6 技能 `{level, skill_type}`，如 15/15/5/15/15/7） | ✅（2026-08 起，归一为 `{type, level}`） | **技能练度**（练度五大件之一；已入条目，可聚合分布） |
| `main_properties`（主词条） | ✅（2026-08 修复：存 `main`，与 2025 源同构） | 456 主词条分布全量样本 |
| `properties`（全部副词条，含无效词条） | ✅（2026-08 修复：存 `subs`，不再过滤） | 真实副词条频率（含「歪」的属性） |
| `valid` / `all_hit` / `invalid_property_cnt` | ❌ **有意不提取**（仅 mys 源独有，非两源共有；聚合层按统一口径判定） | 工坊权威有效词条标记（如需可另存） |
| `ranks`（6 影画 `{id, pos, name, is_unlocked}`） | ❌ | 影画解锁详情（含名称），比 rank 数字更细 |
| `weapon.star` | ❌ | 更准的 S/A 判定（rarity 之外） |
| `weapon.talent_title`（如「骑士光波：改」） | ❌ | 音擎特效名；**「改」后缀 = 改造音擎标记** |
| `weapon.properties`（副词条，如 攻击力 25%） | ❌ | 音擎副词条（library 有静态值，但实例级更直接） |
| `weapon.main_properties` | ✅（value） | — |
| `properties[].final_val` / `property_id` | ❌ | 冗余，价值低 |
| `equip.all_hit`（词条全中标记） | ❌ | **驱动盘毕业判定**（工坊已算好的「全有效词条」标记） |
| `equip.invalid_property_cnt` | ❌ | **无效词条数**（工坊权威判定，基于其权重） |
| `equip.properties[].valid` | ❌ | **逐词条有效标记**——比自建「有效词条」推断更权威 |
| `equip.properties[].level`（词条强化等级 1-3） | ❌ | 词条质量（强化次数），可算「词条成长数」 |
| `equip.equip_suit.own`（几件套）/`suit_id` | ❌ | 套装件数、ID |
| `equip.equipment_type`（槽位 1-6） | ❌ | 槽位（name 后缀 [1] 已有，但字段更干净） |
| `element_type`/`camp_name_mi18n`/`avatar_profession`/`rarity` | ❌ | 冗余（library 有），价值低 |

### 4.3b 2025 源 `item_json`（游戏内嵌原始数据，面板按公式计算）

```json
{
  "Id": 1431, "Exp": 0, "Level": 60, "SkinId": 3114311, "IsFavorite": true,
  "TalentLevel": 6, "PromotionLevel": 6, "CoreSkillEnhancement": 6,
  "SkillLevelList": [{"Index": 0, "Level": 12}, {"Index": 1, "Level": 12}, {"Index": 2, "Level": 7}, {"Index": 3, "Level": 12}, {"Index": 5, "Level": 7}, {"Index": 6, "Level": 12}],
  "TalentToggleList": [false, false, false, true, true, true],
  "ClaimedRewardList": [1, 3, 5],
  "WeaponEffectState": 1, "IsUpgradeUnlocked": false,
  "ObtainmentTimestamp": 1767061349,
  "Weapon": {"Id": 14143, "Exp": 0, "Level": 60, "BreakLevel": 5, "UpgradeLevel": 1, "IsLocked": true},
  "EquippedList": [ {"Slot": 1, "Equipment": {
      "Id": 33541, "Level": 15, "BreakLevel": 5, "IsTrash": false, "IsLocked": true,
      "MainPropertyList": [{"PropertyId": 11103, "PropertyLevel": 1, "PropertyValue": 550}],
      "RandomPropertyList": [{"PropertyId": 21103, "PropertyLevel": 3, "PropertyValue": 480}, ...]
  }} ]
}
```

| 字段 | 已提取？ | 可挖掘价值 |
|---|---|---|
| `SkillLevelList`（6 技能等级，12/12/7/12/7/12） | ✅（2026-08 起，归一为 `{type, level}`） | **技能练度**（同 mys.skills） |
| `TalentLevel`（影画 6） | ❌（rank 已取，冗余） | — |
| `TalentToggleList`（影画开关 [f,f,f,t,t,t]） | ❌ | **手动关闭影画效果的玩家行为**（罕见高价值：关了 4/5/6 号影画 = 降配打榜/压练度） |
| `PromotionLevel`（突破 6） | ❌ | 突破等级（等级之外的另一维度；本样本全 6，区分度低） |
| `CoreSkillEnhancement`（核心技强化 6） | ✅（面板计算用） | 未存条目；核心技练度 |
| `ObtainmentTimestamp`（获取时间） | ❌ | **角色获取时间 → 持有时长/新角色识别** |
| `SkinId` | ❌ | 皮肤（练度无关，价值低） |
| `Weapon.BreakLevel`（突破 5）/`UpgradeLevel`（改造 1） | ❌ | 音擎突破/改造 |
| `EquippedList[].Equipment.BreakLevel`（盘突破 5） | ❌ | **驱动盘突破等级**（新版驱动盘玩法） |
| `EquippedList[].Equipment.MainPropertyList` | ✅（仅 [0]） | 主词条（单主词条盘，[0] 已够） |
| `RandomPropertyList[].PropertyLevel` | ✅（乘算进 value） | 词条等级（已用于价值计算，未单独存） |
| `Slot`（槽位 1-6） | ❌ | 槽位 |

### 4.4 `abyss_data_json`（深渊战绩 —— 全新维度）

```json
{
  "uid": "13503759", "has_data": true, "max_layer": 7,
  "rating_list": [{"times": 4, "rating": "S"}],
  "fast_layer_time": 39, "battle_time_47": 368,
  "begin_time": 1760040000, "end_time": 1761249599, "schedule_id": 62032,
  "hadal_begin_time": "...", "hadal_end_time": {"day": 24, "hour": 3, "year": 2025, "month": 10, "minute": 59, "second": 59},
  "all_roles": [1301, 1021, 1041, ...],
  "all_floor_detail": [ {
    "layer_id": "...", "layer_index": 0, "zone_name": "...", "rating": "S",
    "challenge_time": 0, "floor_challenge_time": 0,
    "buffs": [{"text": "...", "title": "赤海巡鲨"}],
    "node_1": { "buddy": {"id": 54019, "level": 60, "rarity": "S", "bangboo_rectangle_url": "..."},
                "avatars": [{"id": 1381, "rank": 2, "level": 60, "rarity": "S", "element_type": 203, "avatar_profession": 1, ...}],
                "battle_time": 76, "monster_info": {...}, "element_type_list": [...] },
    "node_2": { ...同 node_1... }
  } ]
}
```

**价值**：玩家**真实战斗成绩**（式舆防卫战/危局强袭战）——
- `max_layer` / 每层 `rating`（S/A/B）：强度验证的最终标准（面板强不强看深渊）
- `fast_layer_time` / `node.battle_time`：通关速度
- `node.avatars`（含每队实际上场角色 + 影画档）+ `buddy`（邦布）：**实战配队**（比攻略配队/持有共现更真实——「过深渊的队伍长什么样」）
- `all_roles`：参战角色集合
- 同 uid 的深渊数据与 workshop.json 条目可关联：**面板/评分 → 实战成绩的因果链**（高练度是否真能打高层）

> ✅ 已提取（2026-08 起）：爬取时经 `extractAbyss` 裁剪后落盘 `data/workshop-abyss.json`（uid 级，去图片 URL/长文本；真实样本 23 KB → 4.8 KB）。

---

## 5. 可挖掘字段汇总（按价值排序）

| 优先级 | 字段 | 源 | 可视化价值 |
|---|---|---|---|
| ★★★ | `skills` / `SkillLevelList` | mys / 2025 | **技能练度**（✅ 已提取）：练度五大件（等级/影画/音擎/驱动盘/技能）中此前唯一缺失的一件；「技能是否拉满」是最常见的提升项 |
| ★★★ | `abyss_data_json` | v3.data | **深渊战绩**（✅ 已提取，裁剪落盘）：层数/评级/实战配队/通关时间 → 玩家强度验证 + 实战配队生态 |
| ★★★ | `main_properties` + 全部 `properties` | mys | **主/副词条全量**（✅ 2026-08 修复）：456 主词条统计样本翻倍；副词条频率含无效词条（真实分布） |
| ★★☆ | `weight_json` | system_data | 工坊有效词条权重定义（✅ 已提取，入 stats.weightJson） |
| ★★☆ | `valid` / `all_hit` | mys | 工坊权威有效词条标记（❌ 有意不提取——非两源共有；如需可另存独立字段） |
| ★★☆ | `TalentToggleList` | 2025 | 手动关影画的玩家行为（降配打榜/压练度） |
| ★★☆ | `weapon.talent_title`（「改」后缀）/ `star` | mys | 改造音擎标记、S 判定 |
| ★★☆ | `ObtainmentTimestamp` | 2025 | 角色获取时间 → 持有时长 |
| ★★☆ | `equip.properties[].level`（词条强化等级） | mys | 词条质量/成长次数（2025 源 RandomPropertyList.PropertyLevel 已有等价信息） |
| ★☆☆ | `Weapon.BreakLevel`/`UpgradeLevel`、盘 `BreakLevel` | 2025 | 音擎突破/改造、驱动盘突破（新玩法维度） |
| ★☆☆ | `PromotionLevel`/`CoreSkillEnhancement` | 2025 | 突破/核心技（样本区分度低） |
| ★☆☆ | `source_api` | role | 源标记（替代代码判定） |
| ★☆☆ | `weapon.properties`/`profession`/`pool_type` | mys / system | 音擎副词条、池子类型 |

> 注：mys 源的 `weight_info`（role 级）与 `attack`/`hp` 在本样本为 null/"0.00"，疑似废弃字段，暂不挖掘。

---

## 6. 提取现状与扩展建议

`workshop.js` 的 `extractBuild` 当前从条目提取：`level`/`rank`/`relic_point` + **`skills`（技能练度，两种源归一为 `{type, level}`）** + 音擎（id/name/level/rarity/main）+ 面板 + 驱动盘（**两源同构：`main`=主词条、`subs`=全部副词条**，2026-08 修复 mys 源主词条丢失/副词条过滤问题）。

不提取的字段（有意取舍）：mys 源独有的 `valid`/`all_hit`/`invalid_property_cnt`（非两源共有，聚合层统一按 SUBSTAT 集合判定有效词条，两源口径一致）。

聚合层 `computeWorkshopDiscStats` 直接按同构结构处理（`subs`=全部副词条、`main[0]`=主词条），456 主词条/副词条频率/协同统计两源全量参与（不再兼容旧格式）。

已新增落盘（2026-08）：
- **`data/workshop-abyss.json`** —— uid 级深渊战绩（`extractAbyss` 裁剪：去掉图片 URL/buff 长文本，保留层数/评级/最快通关/实战配队/通关时间/怪物 id+名/buff 标题；真实样本 23 KB → 4.8 KB，缩至 1/5；断点续爬时与旧条目按 uid 合并去重）。
- **`data/workshop-weights.json`** —— 角色默认流派权重（system_data 的 `weight_json`，57 条）；`buildWorkshopStats` 并入 `workshop-stats.json` 的 `weightJson` 字段。

技能等级 / 深渊战绩 / 权重三者现已在原始层与聚合层可用；下一步可在聚合层新增「技能练度分布」「深渊层数/评级分布」「实战配队共现」等统计。

