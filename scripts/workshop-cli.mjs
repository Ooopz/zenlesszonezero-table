// scripts/workshop-cli.mjs —— 工坊数据更新命令行入口（函数实现见 src/sync/workshop.js 与 workshop-stats.js，供 server.js 按钮复用）
// 用法（全命名参数）：
//   node scripts/workshop-cli.mjs [--mode=rank|chars|grad|weights|stats|full] [--concurrency=N] [--proxy=URL]
//     rank    只更新 uid：全角色×7影画×300 排名收集 → data/workshop-uids.json（不下载角色信息，快）
//     chars   批量下载角色信息：读 workshop-uids.json（缺则报错提示先跑 --mode=rank）→ workshop.json（断点续爬）
//     grad    只更新全角色配装统计（grad_stat 独立接口）→ workshop-grad.json
//     weights 只更新全角色默认副词条权重 → workshop-weights.json（并同步 stats.weightJson）
//     stats   只重算 workshop-stats.json（读现有 grad/weights，不爬取、不重跑 grad，~2-4 分钟；改聚合代码后验证用）
//     full    默认：grad → weights → rank → chars（chars 末尾自动重算 stats）
//   --proxy 由 workshop-api.js 在模块加载时读取（防封 IP；仅 api.zzzmap.com 走代理；亦可用 HTTPS_PROXY 环境变量）
// 按模式动态 import：stats/grad 只加载聚合侧（不加载 workshop.js 下载侧与 69KB 静态表），其余模式加载下载侧。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writeJsonAtomic } from '../src/lib/node.js';

const argVal = (k) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : undefined;
};
const MODE = argVal('mode') || 'full';
const CONCURRENCY = Number(argVal('concurrency') || 6);
const UIDS_FILE = path.join(DATA_DIR, 'workshop-uids.json');
if (!['rank', 'chars', 'grad', 'weights', 'stats', 'full'].includes(MODE)) {
  throw new Error(`未知 --mode=${MODE}（可选 rank|chars|grad|weights|stats|full）`);
}

async function main() {
  if (MODE === 'rank') {
    // 只更新 uid：全角色 × 7 影画 × 300 排名收集 → 落盘 uid 集合（供 --mode=chars 用），不下载角色信息
    const { collectRankings } = await import('../src/sync/workshop.js');
    const { uidMap } = await collectRankings(undefined, CONCURRENCY);
    writeJsonAtomic(UIDS_FILE, { scrapedAt: new Date().toISOString(), uids: [...uidMap.keys()] });
    console.log(`uid 集合 ${uidMap.size} 个已保存到 ${UIDS_FILE}（--mode=chars 将用它批量下载角色信息）`);
    return;
  }
  if (MODE === 'chars') {
    // 批量下载角色信息：读 workshop-uids.json（必须先跑过 --mode=rank），断点续爬写 workshop.json + 权重 + 汇总
    const { buildCtx, fetchBuilds } = await import('../src/sync/workshop.js');
    const { ctx, roles } = await buildCtx();
    let uidList = null;
    if (fs.existsSync(UIDS_FILE)) {
      try {
        uidList = JSON.parse(fs.readFileSync(UIDS_FILE, 'utf8')).uids;
      } catch { /* 损坏走报错 */ }
    }
    if (!uidList || !uidList.length) {
      throw new Error('缺少 data/workshop-uids.json（或为空）：请先运行 --mode=rank 收集 uid');
    }
    await fetchBuilds(ctx, roles, uidList, undefined, CONCURRENCY);
    return;
  }
  if (MODE === 'grad') {
    // 只更新全角色配装统计（grad_stat 独立接口；仅加载聚合侧）
    const { fetchWorkshopGrad } = await import('../src/sync/workshop-stats.js');
    await fetchWorkshopGrad(undefined, 6);
    return;
  }
  if (MODE === 'weights') {
    // 只更新全角色默认副词条权重（system_data.weight_json）→ weights 文件 + 同步 stats.weightJson
    const { buildCtx, buildWeights, syncStatsWeightJson } = await import('../src/sync/workshop.js');
    const { roles } = await buildCtx();
    const weightJson = buildWeights(roles);
    syncStatsWeightJson(weightJson);
    console.log(`全角色默认副词条权重已更新到 ${path.join(DATA_DIR, 'workshop-weights.json')}`);
    return;
  }
  if (MODE === 'stats') {
    // 只重算 workshop-stats.json（不爬取、不重跑 grad；仅加载聚合侧）
    const { rebuildWorkshopStats } = await import('../src/sync/workshop-stats.js');
    const t0 = Date.now();
    const stats = rebuildWorkshopStats();
    console.log(`workshop-stats.json 重算完成: ${((Date.now() - t0) / 1000).toFixed(1)}s（panels=${stats.panels.length} | wengines=${stats.wengines.length} | discs=${stats.discs.length} | discDetails=${stats.discDetails.length}）`);
    return;
  }
  // full（默认）：grad → weights → rank → chars（chars 末尾自动重算 stats）
  const { fetchWorkshopData } = await import('../src/sync/workshop.js');
  await fetchWorkshopData(undefined, { concurrency: CONCURRENCY });
}

await main();
