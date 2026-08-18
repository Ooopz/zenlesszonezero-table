// scripts/rebuild-weights.mjs —— 单独重跑 workshop-weights 抽取（不跑全量爬取）
// 拉 system_data/public 的 weight_json → 工坊 key 映射为 CONSTANT 标准名（WS_KEY_TO_STAT）→
// 落盘 data/workshop-weights.json，并同步更新 data/workshop-stats.json 的 weightJson 字段（前端经 /api/data 读它）。
// 用法：node scripts/rebuild-weights.mjs [代理URL]（代理同 workshop.js 第 5 参，见 proxy.js）
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writeJsonAtomic } from '../src/lib/node.js';
import { apiGet } from '../src/sync/workshop-api.js';
import { WS_KEY_TO_STAT } from '../src/lib/constants.js';

const WEIGHTS_FILE = path.join(DATA_DIR, 'workshop-weights.json');
const STATS_FILE = path.join(DATA_DIR, 'workshop-stats.json');

/** 工坊 weight_json → 落地结构（factions.weights 的 key 映射为 CONSTANT 标准名，未知 key 原样保留） */
function normalizeWeightJson(wj) {
  if (!wj || !Array.isArray(wj.factions)) return wj;
  return {
    ...wj,
    factions: wj.factions.map((f) => ({
      ...f,
      weights: (f.weights || []).map((it) => ({ key: WS_KEY_TO_STAT[it.key] || it.key, weight: it.weight })),
    })),
  };
}

const r = await apiGet('/api/v1/system_data/public');
const roles = r?.data?.system_roles || [];
if (!roles.length) throw new Error('system_data 返回空（风控/接口变更？）');

const weightJson = {};
for (const role of roles) {
  if (role?.weight_json) weightJson[String(role.item_id)] = normalizeWeightJson(role.weight_json);
}

// 统计落地后的标准名 key 集合
const keys = new Set();
for (const wj of Object.values(weightJson)) {
  for (const f of wj?.factions || []) for (const it of f.weights || []) keys.add(it.key);
}
const statKeys = new Set(['攻击力', '暴击率', '暴击伤害', '生命值', '防御力', '异常精通', '异常掌控', '穿透值', '穿透率', '能量自动回复', '冲击力', '伤害加成']);
const missing = [...statKeys].filter((k) => !keys.has(k));

writeJsonAtomic(WEIGHTS_FILE, {
  meta: { scrapedAt: new Date().toISOString(), roles: Object.keys(weightJson).length },
  weights: weightJson,
});
console.log(`✅ workshop-weights.json 已更新：${Object.keys(weightJson)} 角色`);
console.log(`  落地 key（${keys.size}）: ${[...keys].join(' / ')}`);
console.log(missing.length ? `  ⚠️ 缺标准名: ${missing.join(', ')}` : '  标准名齐全 ✓（含 精通→异常精通、掌控→异常掌控、生命→生命值、防御→防御力、加伤→伤害加成）');

// 同步更新 workshop-stats.json 的 weightJson（保留其他聚合字段，不重算）
if (fs.existsSync(STATS_FILE)) {
  const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  stats.weightJson = weightJson;
  writeJsonAtomic(STATS_FILE, stats);
  console.log(`✅ workshop-stats.json 的 weightJson 已同步（${(fs.statSync(STATS_FILE).size / 1024 / 1024).toFixed(2)} MB）`);
} else {
  console.warn('⚠️ 未找到 workshop-stats.json（先跑 workshop.js 全量爬取或 rebuild-stats）');
}
