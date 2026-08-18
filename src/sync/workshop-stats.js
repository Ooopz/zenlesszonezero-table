// src/sync/workshop-stats.js —— 工坊数据聚合（从 workshop.js 拆出的聚合职责，2026-10）
// ① buildWorkshopStats：workshop.json → workshop-stats.json（单遍历 13 项聚合，纯逻辑在 lib/workshopStats.js）
// ② fetchWorkshopGrad：grad_stat 接口全服占比 → workshop-grad.json（下载 + 聚合）
// 下载/提取（爬取配装、extractBuild）留在 workshop.js；本模块只依赖 workshop-api.js 的网络层，
// 不与 workshop.js 互相 import（workshop.js 从这里 re-export，scripts/rebuild-stats.mjs 直接从这里取）。
import fs from 'node:fs';
import path from 'node:path';
import { computeAllWorkshopStats } from '../lib/workshopStats.js';
import { orderComboSets4First } from '../lib/plansStats.js';
import { romanNumeralUnicode } from '../lib/util.js';
import { buildNameIndex, resolveEntry, canonicalName, CATEGORY } from '../lib/names.js';
import { iterWorkshopFile, DATA_DIR, pool, writeJsonAtomic } from '../lib/node.js';
import { apiGet } from './workshop-api.js';
import { loadNameIndexes } from './name-index.js';

export const OUT_FILE = path.join(DATA_DIR, 'workshop.json'); // 聚合输入（配装条目，workshop.js 合并写出）
const STATS_FILE = path.join(DATA_DIR, 'workshop-stats.json');
const GRAD_FILE = path.join(DATA_DIR, 'workshop-grad.json');

// 名称索引（统一 resolver，library.json 为权威源）：工坊 nick_name 的 ASCII 罗马数字/括号差异、角色简称
// （维琳娜/星徽·比利）等一律在写时解析回 wiki 标准名，保证三个工坊数据文件与 library/plans 一致。
// ⚠️ 索引**不建在模块顶层**：server.js 用 `?v=mtime` 爆破的只有 workshop.js 的模块缓存，本模块的
// import 路径无 query、相对解析会命中同一缓存 URL——顶层索引会冻结在首次加载，同步完 library 后
// 新角色名解析不出来（正是 ?v= 爆破要防的 bug）。改为每次聚合调用时现读 library.json（一次解析
// 约几毫秒，相对数小时爬取/数分钟聚合可忽略），保证长驻 server 进程始终用最新索引。
// library.json 缺失/损坏时降级为空索引（名称归一退化为原样，不崩——测试可直接 import 本模块）
function loadIndexes() {
  return (
    loadNameIndexes('工坊') ?? {
      char: buildNameIndex({}, CATEGORY.CHAR),
      wengine: buildNameIndex({}, CATEGORY.WENGINE),
      disc: buildNameIndex({}, CATEGORY.DISC),
    }
  );
}

/** 工坊音擎 nick_name → wiki 规范音擎条目（统一 resolver；找不到返回 null） */
function resolveWengine(rawName, libWengines) {
  return resolveEntry(CATEGORY.WENGINE, libWengines, rawName);
}

/** 流式遍历 workshop.json 的 entries（generator）：分块 gzip 按块解压，聚合函数 for...of 天然兼容，不把大数组放内存 */
function* iterWorkshopEntries() {
  yield* iterWorkshopFile(OUT_FILE);
}

// ---------- 汇总生成（原 workshop-stats.js）：workshop.json → workshop-stats.json ----------
export function buildWorkshopStats(roleNameMap, weightJson, totalEntries) {
  if (!fs.existsSync(OUT_FILE)) return null;
  const { char: libChars, disc: libDiscs } = loadIndexes(); // 现读 library.json（见 loadIndexes 注释）
  // 角色定位表（role_id → 强攻/击破/异常/命破/防护/支援）：流派聚类按定位选属性池（输出面板值小数）
  const traits = {};
  if (roleNameMap) {
    for (const [rid, name] of roleNameMap) {
      const libChar = resolveEntry(CATEGORY.CHAR, libChars, name);
      if (libChar?.trait) traits[rid] = libChar.trait;
    }
  }
  // 流式遍历 entries（90 万+ 条全量进数组 ≈ 7GB 会 OOM）：generator 逐条产出，峰值内存只留聚合 Map。
  // 13 项聚合合并为**一次**遍历（computeAllWorkshopStats）：此前每项各调一次 iterWorkshopEntries，
  // 等于把 2.13GB 文件流式解析 13 遍（每遍 ~27s，白白多花 ~6 分钟）。合并后输出逐位不变（见 workshopStats.js 累加器说明）
  const {
    stats,
    panelCorr, // 属性相关（按角色，同条目配对）
    discDetails, // 驱动盘单盘真实统计（含 D7 套装×槽位 slotDist、有效强化次数 effDist）
    panelScatter, // 面板属性对 2D 密度（暴击率×暴伤、攻击×暴伤，供密度散点图）
    // 练度指标：评分分布 / 影画占比 / 技能练度
    relicStats,
    rankDist,
    skillStats,
    // 2026-10 新增：配队亲和
    roleCooccurrence,
    // 2026-08 新增：加权词条效率分（含 D9 评分×毕业度）
    rollEfficiency,
    // 2026-10 新增：角色流派分析（面板 k-means，每角色 3 流派 + 典型面板）
    roleStyles,
    // 角色拥有率（样本池口径）：{pool, roles}，pool=去重 uid 总数
    roleOwnership,
    sampleCoverage,
    choiceConcentration,
    // weightJson 同时供 effDist 的「按角色区分有效副词条」与 rollEfficiency 使用，必须在聚合前传入
  } = computeAllWorkshopStats(iterWorkshopEntries(), libDiscs, { roleNameMap, weightJson, traits });
  const data = {
    meta: {
      scrapedAt: new Date().toISOString(),
      entries: totalEntries ?? sampleCoverage?.entries ?? -1,
      poolUids: sampleCoverage?.uidCount ?? roleOwnership?.pool ?? 0,
    },
    ...stats,
    discDetails,
    panelCorr,
    panelScatter,
    relicStats,
    rankDist,
    skillStats,
    roleCooccurrence,
    rollEfficiency,
    roleStyles,
    roleOwnership: roleOwnership?.roles || {},
    sampleCoverage,
    choiceConcentration,
  };
  // 工坊有效词条权重（system_data 的角色默认流派权重，供有效词条/评分口径复现；正常非空）
  if (weightJson && Object.keys(weightJson).length) data.weightJson = weightJson;
  writeJsonAtomic(STATS_FILE, data);
  return data;
}

// ---------- 全服配装统计（原 workshop-grad.js）：每角色最常用音擎 + 驱动盘套装 ----------
/** 解析驱动盘 set_info（"32800_4__33100_2" → 组合名），返回 {name, sets:[{set_id,num,name}]} 或 null
 *  libDiscs 由调用方传入（fetchWorkshopGrad 现读的索引，避免模块顶层缓存冻结）。 */
function parseSetInfo(setInfo, artifacts, libDiscs) {
  if (setInfo === 'other') return { name: '其他', sets: [] };
  const parts = String(setInfo).split('__');
  const sets = [];
  for (const p of parts) {
    const [setId, num] = p.split('_');
    const a = artifacts.find((x) => x.set_id === setId);
    // 套装名解析为 wiki 标准盘名（工坊 artifacts 名可能带尾随空格/用词差异）
    const setName = a ? canonicalName(CATEGORY.DISC, libDiscs, a.name) || a.name : `套装${setId}`;
    sets.push({ set_id: setId, num: Number(num), name: setName });
  }
  // 文本顺序统一：4 件套在前、2 件套在后（与方案侧一致），避免同名组合因顺序不同造成显示/对比差异
  const { name, sets: orderedSets } = orderComboSets4First(sets);
  return { name, sets: orderedSets };
}

/** 爬取工坊全服配装统计并写入 data/workshop-grad.json。onProgress({step, done, total}) 供进度轮询。
 *  concurrency 为角色级并发（默认 6，与 workshop.js 爬取并发同源；rebuild-stats.mjs 调用时不传用默认）。 */
export async function fetchWorkshopGrad(onProgress, concurrency = 6) {
  const { char: libChars, wengine: libWengines, disc: libDiscs } = loadIndexes(); // 现读 library.json（见 loadIndexes 注释）
  const sys = await apiGet('/api/v1/system_data/public', {});
  const roles = (sys.data && sys.data.system_roles) || [];
  const weapons = (sys.data && sys.data.system_weapons) || [];
  const artifacts = (sys.data && sys.data.system_artifacts) || [];

  const out = [];
  const failReasons = [];
  let done = 0;
  let failed = 0;
  await pool(roles, concurrency, async (role) => {
    const { item_id, nick_name } = role;
    try {
      const j = await apiGet('/api/v1/role/grad_stat', { item_id, level: 40 });
      const d = j.data || {};
      const ws = d.weapon_stat || [];
      const rs = d.relic_stat || [];

      // 角色名解析为 wiki 标准名（维琳娜→维琳娜·艾嘉德、11号→「11号」、星徽·比利→星徽·比利·奇德）；
      // 图标用解析到的标准条目（官方 wiki 大图 portrait 优先）
      const roleName = canonicalName(CATEGORY.CHAR, libChars, nick_name, { fuzzy: true }) || nick_name;
      const libChar = resolveEntry(CATEGORY.CHAR, libChars, nick_name, { fuzzy: true });
      const roleIcon = libChar?.portrait || libChar?.icon || '';

      // 音擎图标：wiki 源
      const wTotal = ws.reduce((a, x) => a + Number(x.weapon_count || 0), 0);
      const weaponsStat = [];
      for (const w of ws) {
        const sysW = weapons.find((x) => String(x.item_id) === String(w.weapon_id));
        const rawName = sysW ? sysW.nick_name : '';
        const libW = sysW ? resolveWengine(rawName, libWengines) : null;
        const name =
          w.weapon_id === 'other'
            ? '其他'
            : libW
              ? libW.name
              : rawName
                ? romanNumeralUnicode(rawName)
                : `音擎${w.weapon_id}`;
        const icon = w.weapon_id === 'other' ? '' : libW?.icon || '';
        weaponsStat.push({
          id: w.weapon_id,
          name,
          icon,
          count: Number(w.weapon_count || 0),
          percent: wTotal ? Number(((Number(w.weapon_count || 0) / wTotal) * 100).toFixed(1)) : 0,
        });
      }

      // 驱动盘组合：各套装 wiki 图标（套装名已由 parseSetInfo 解析为 wiki 标准名）
      const rTotal = rs.reduce((a, x) => a + Number(x.set_info_count || 0), 0);
      const relicsStat = [];
      for (const r of rs) {
        const info = parseSetInfo(r.set_info, artifacts, libDiscs);
        const sets = [];
        for (const s of info?.sets || []) {
          const libD = resolveEntry(CATEGORY.DISC, libDiscs, s.name);
          sets.push({ ...s, icon: libD?.icon || '' });
        }
        relicsStat.push({
          set_info: r.set_info,
          name: info ? info.name : r.set_info,
          sets,
          count: Number(r.set_info_count || 0),
          percent: rTotal ? Number(((Number(r.set_info_count || 0) / rTotal) * 100).toFixed(1)) : 0,
        });
      }

      out.push({ item_id, name: roleName, icon: roleIcon, weapons: weaponsStat, relics: relicsStat });
    } catch (e) {
      failed++;
      if (failReasons.length < 3) failReasons.push(e.message); // 只记前几个失败原因，供最终报错定位
      console.log(`角色 ${item_id} 失败: ${e.message}`);
    }
    done++;
    onProgress?.({ step: 'grad', done, total: roles.length });
  });

  // 全量失败保护：每角色的 catch 只打日志，风控/断网时 out 会是空数组。
  // 若照写就会把上一份好的 workshop-grad.json 覆盖成 {roles: []}，而 rebuild-stats.mjs 的
  // role_id → 角色名映射**只能**来自 grad —— 一次限流会连累其后所有重算。宁可不写，保留旧文件。
  // 注意条件只判 out 空：system_data 返回空角色表（roles.length===0）时同样不能写，否则一样静默清空。
  if (!out.length) {
    const hint = roles.length
      ? `全部 ${roles.length} 个角色抓取失败（可能被风控或网络不通）；已保留现有 workshop-grad.json 不覆盖`
      : 'system_data 未返回任何角色（接口异常）；已保留现有 workshop-grad.json 不覆盖';
    const firstErr = failReasons[0] ? `首个错误: ${failReasons[0]}` : '无角色级错误';
    console.error(`[工坊全服统计] ${hint}（${firstErr}）`);
    throw new Error(`${hint}；${firstErr}`);
  }
  // 部分失败：仍然写入（有数据总好过没有），但把缺口显式记进 meta 并告警，避免静默减少角色数
  if (failed) console.warn(`[工坊全服统计] ${failed}/${roles.length} 个角色失败，本次仅写入 ${out.length} 个`);
  const data = {
    meta: { scrapedAt: new Date().toISOString(), roles: out.length, failed, expected: roles.length },
    roles: out,
  };
  writeJsonAtomic(GRAD_FILE, data);
  return { stats: { roles: out.length, failed } };
}
