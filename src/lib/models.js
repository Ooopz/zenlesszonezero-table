// src/lib/models.js —— 领域模型：Character / Wengine / Disc 基类
// 抽象的数据容器 + 计算框架：
// - 构造时归一化基础数据（来源可为 characters.json 账号数据 或 library.json wiki 属性库数据）
// - 自动计算派生属性（如驱动盘各副词条的成长次数）
// - 组合关系：角色装备音擎 + 驱动盘
import { calculateCharacter, hitCount, statProgress, discGrowth, ctxVersion } from './calc.js';
import { normalizeStatKeys } from './util.js';

/** 驱动盘基类：名称/位置/等级/稀有度/主词条/副词条 + 各副词条成长次数 */
export class Disc {
  constructor(data = {}) {
    // 账号版：set/slot/level/rarity/mainStats/subStats；wiki 版：name/icon/set2…
    this.name = data.name || '';
    this.set = data.set || data.name || '';
    this.slot = data.slot ?? null;
    this.level = data.level ?? null;
    this.icon = data.icon || '';
    this.roundIcon = data.roundIcon || ''; // 圆形光盘图标（wiki 提取，卡片/汇总视图用）
    this.rarity = data.rarity || 'S';
    this.mainStats = data.mainStats || [];
    this.subStats = data.subStats || [];
    // wiki 版：套装效果
    this.set2 = data.set2 ?? null;
    this.set4 = data.set4 ?? null;
    this.set2Text = data.set2Text || '';
    this.set4Text = data.set4Text || '';
    // wiki 扩展：套装故事/推荐角色/副词条建议/部位主词条
    this.setLore = data.setLore || [];
    this.recommend = data.recommend || [];
    this.substatAdvice = data.substatAdvice || '';
    this.slotMainStats = data.slotMainStats || [];
    // 派生计算：各副词条成长（强化）次数
    this.growth = discGrowth(this, this.rarity);
  }

  /** 该盘落在有效词条上的命中次数（每个词条本身 1 + 成长次数）；未设有效属性返回 null */
  getHitCount(validSet) {
    if (!validSet || !validSet.size) return null;
    return this.growth.filter((g) => validSet.has(g.type)).reduce((s, g) => s + 1 + g.growthCount, 0);
  }
}

/** 音擎基类 */
export class Wengine {
  constructor(data = {}) {
    // 账号版：name/level/refinement/mainStats/subStats；wiki 版：baseAtk/subStatsText…
    this.name = data.name || '未佩戴音擎';
    this.id = data.id ?? null;
    this.level = data.level ?? null;
    this.refinement = data.refinement ?? data.star ?? data.refine ?? 1;
    this.icon = data.icon || '';
    this.rarity = data.rarity || '';
    this.trait = data.trait || '';
    this.baseAtk = data.baseAtk ?? null;
    this.specialEffectTitle = data.specialEffectTitle || '';
    this.specialEffect = data.specialEffect || '';
    this.mainStats = data.mainStats || [];
    this.subStats = data.subStats || [];
    this.subStatsText = data.subStatsText || '';
    // wiki 扩展：外观图/突破材料/推荐代理人/背景故事
    this.appearance = data.appearance || [];
    this.materials = data.materials || [];
    this.recommend = data.recommend || [];
    this.lore = data.lore || '';
  }
}

/** 角色基类：组合音擎 + 驱动盘，提供面板/达成率/命中计算 */
export class Character {
  constructor(data = {}) {
    // 基础字段
    this.name = data.name || '';
    this.id = data.id ?? null;
    this.level = data.level ?? null;
    this.icon = data.icon || '';
    this.portrait = data.portrait || '';
    this.rarity = data.rarity || '';
    this.faction = data.faction || '';
    this.panel = data.panel || {};
    this.skills = data.skills || [];
    this.mindscape = data.mindscape || null;
    this.skillAwaken = data.skillAwaken || null;
    this.equipPlan = data.equipPlan || null;
    // wiki 属性库字段
    this.element = data.element || '';
    this.trait = data.trait || '';
    // 满级属性键名归一化（wiki 页面各角色用词不一：生命/生命力/攻击/防御 → 生命值/攻击力/防御力）
    this.maxLevel = normalizeStatKeys(data.maxLevel);
    // 其余字段（wiki 扁平初始属性 / description / cinemas / appearance / cv 等）统一归一化到实例，
    // 避免 calc/wiki 各自去猜 .extra 里的字段
    // wengine/discs 在下文用基类实例化，此处跳过（避免先拷贝原对象再被覆盖的浪费）
    for (const [k, v] of Object.entries(data)) if (!(k in this) && k !== 'wengine' && k !== 'discs') this[k] = v;
    // 组合：音擎 + 驱动盘（覆盖原始嵌套）
    this.wengine = data.wengine ? new Wengine(data.wengine) : null;
    this.discs = (data.discs || []).map((d) => new Disc(d));
  }

  /** 计算最终面板（数据经 setCalcContext 注入）。
   *  按 ctxVersion 缓存：同一次数据加载内反复渲染（render 每次全量重算）只算一次；
   *  数据源刷新（setCalcContext）或实例重建（setData 创建新实例）时自动失效。 */
  calculate() {
    if (this._calcVersion === ctxVersion && this._calcCache) return this._calcCache;
    this._calcVersion = ctxVersion;
    this._calcCache = calculateCharacter(this);
    return this._calcCache;
  }

  /** 副词条命中次数（基于有效属性） */
  hitCount() {
    return hitCount(this);
  }

  /** 单个属性相对该角色目标的达成率 */
  statProgress(R, name) {
    return statProgress(this, R, name);
  }
}

/** 把 {键: 数据} 集合实例化为对应基类集合 */
export function toInstances(obj, Base) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = new Base(v);
  return out;
}
