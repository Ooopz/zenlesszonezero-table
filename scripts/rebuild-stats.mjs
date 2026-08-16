// scripts/rebuild-stats.mjs —— 重算 workshop-stats.json（不爬配装）
// 用法:  npm run rebuild:stats   （等价 node scripts/rebuild-stats.mjs）
// 说明: ① 尝试重跑 workshop-grad.json（57 角色，API 风控时失败则用现有 grad）；
//       ② 用 grad 的 role_id → 角色名映射 + workshop-weights.json 权重，流式重算 workshop-stats.json。
// 注意: role_id → 角色名映射只能来自 grad（library 的 id 是另一套体系，不可用）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/lib/node.js';
import { fetchWorkshopGrad, buildWorkshopStats } from '../src/sync/workshop.js';

// 路径一律基于 DATA_DIR 拼接：脚本移入 scripts/ 后不能再依赖「从仓库根目录运行」的 cwd 假设
const dataPath = (f) => path.join(DATA_DIR, f);

// 1. 尝试重跑 grad（API 恢复时自动补全 57 角色；风控中失败则沿用现有文件）
try {
  const g = await fetchWorkshopGrad();
  console.log(`workshop-grad.json 重跑成功: ${g.stats.roles} 个角色`);
} catch (e) {
  console.log(`grad 重跑失败（工坊 API 风控中）: ${e.message.slice(0, 60)}`);
}
const grad = JSON.parse(fs.readFileSync(dataPath('workshop-grad.json'), 'utf8'));
const roleNameMap = new Map((grad.roles || []).map((r) => [String(r.item_id), r.name]));
console.log(`roleNameMap: ${roleNameMap.size} 个角色（期望 57；不足说明 grad 待补）`);

// 2. weightJson
let weightJson;
try { weightJson = JSON.parse(fs.readFileSync(dataPath('workshop-weights.json'), 'utf8')).weights || null; } catch { weightJson = null; }
console.log(`weightJson: ${weightJson ? Object.keys(weightJson).length : 0} 个角色`);

// 3. 重算 stats（流式遍历，约 2-4 分钟）；totalEntries 从 workshop.json 头部 meta 读取（保持与真实条目数一致）
console.log('重算 workshop-stats.json …');
const t0 = Date.now();
let entryCount = -1;
try {
  // 只读文件头 256 字节：此前用 readFileSync(...,'utf8').slice(0,256) 把整个 2GB 文件读成字符串，
  // 超过 Node 的 2 GiB 单次读取上限直接抛错，被 catch 吞掉 → entryCount 静默保持 -1，
  // 写进 stats 的 meta.entries 也就一直是 -1。改成定长 read，既正确又不占内存。
  const fd = fs.openSync(dataPath('workshop.json'), 'r');
  const buf = Buffer.alloc(256);
  const n = fs.readSync(fd, buf, 0, 256, 0);
  fs.closeSync(fd);
  const m = /"meta":\s*\{[^}]*?"entryCount"\s*:\s*(\d+)/.exec(buf.subarray(0, n).toString('utf8'));
  if (m) entryCount = Number(m[1]);
} catch { /* 读取失败时保持 -1（meta.entries 写 -1） */ }
if (entryCount < 0) console.warn('⚠️  未能从 workshop.json 头部读出 entryCount，meta.entries 将写 -1');
const stats = buildWorkshopStats(roleNameMap, weightJson, entryCount);
console.log(`完成: ${((Date.now() - t0) / 1000).toFixed(1)}s（meta.entries=${entryCount}）`);
console.log(`panels: ${stats.panels.length} 角色 | wengines: ${stats.wengines.length} | discs: ${stats.discs.length} | discDetails: ${stats.discDetails.length}`);
const p = stats.panels[0];
console.log(`抽查 ${p?.name} 样本: ${p ? Object.values(p.stats)[0]?.count : '无'}（对比上次重算 49692 附近；若明显偏离说明 workshop.json 被改动）`);
