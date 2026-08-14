// scripts-rebuild-stats.mjs —— 重算 workshop-stats.json（不爬配装）
// 用法:  node scripts-rebuild-stats.mjs
// 说明: ① 尝试重跑 workshop-grad.json（57 角色，API 风控时失败则用现有 grad）；
//       ② 用 grad 的 role_id → 角色名映射 + workshop-weights.json 权重，流式重算 workshop-stats.json。
// 注意: role_id → 角色名映射只能来自 grad（library 的 id 是另一套体系，不可用）。
import fs from 'node:fs';
import { fetchWorkshopGrad, buildWorkshopStats } from './src/sync/workshop.js';

// 1. 尝试重跑 grad（API 恢复时自动补全 57 角色；风控中失败则沿用现有文件）
try {
  const g = await fetchWorkshopGrad();
  console.log(`workshop-grad.json 重跑成功: ${g.stats.roles} 个角色`);
} catch (e) {
  console.log(`grad 重跑失败（工坊 API 风控中）: ${e.message.slice(0, 60)}`);
}
const grad = JSON.parse(fs.readFileSync('data/workshop-grad.json', 'utf8'));
const roleNameMap = new Map((grad.roles || []).map((r) => [String(r.item_id), r.name]));
console.log(`roleNameMap: ${roleNameMap.size} 个角色（期望 57；不足说明 grad 待补）`);

// 2. weightJson
let weightJson;
try { weightJson = JSON.parse(fs.readFileSync('data/workshop-weights.json', 'utf8')).weights || null; } catch { weightJson = null; }
console.log(`weightJson: ${weightJson ? Object.keys(weightJson).length : 0} 个角色`);

// 3. 重算 stats（流式遍历，约 2-4 分钟）
console.log('重算 workshop-stats.json …');
const t0 = Date.now();
const stats = buildWorkshopStats(roleNameMap, weightJson, 605665);
console.log(`完成: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`panels: ${stats.panels.length} 角色 | wengines: ${stats.wengines.length} | discs: ${stats.discs.length} | discDetails: ${stats.discDetails.length}`);
const p = stats.panels.find((x) => x.name === '1091');
console.log(`抽查 1091 攻击力样本: ${p?.stats['攻击力']?.count}（完整数据应为 33851 附近）`);
