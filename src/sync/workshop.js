// src/sync/workshop.js —— 爬取「绝区零工坊」全角色排名+玩家配装（下载/提取侧）：api.zzzmap.com，签名=MD5(key+参数排序)，无需 token
// 用法：node src/sync/workshop.js [角色数=57] [每影画条数=300] [v3并发=6] [代理URL]（IP 被封时换 IP；亦可用 HTTPS_PROXY/ALL_PROXY 环境变量，仅 api.zzzmap.com 走代理）
// 断点续爬以 workshop.json 实际内容为准（文件里没有的 uid 一律重爬，写文件原子 tmp+rename，不再用进度文件）；聚合/API/静态表/2025 源面板拆在 workshop-stats.js 等模块
import fs from 'node:fs';
import path from 'node:path';
import { romanNumeralUnicode, normalizeStatKey } from '../lib/util.js';
import { buildNameIndex, canonicalName, CATEGORY } from '../lib/names.js';
import {
  iterWorkshopFile,
  readLines,
  writeWorkshopFile,
  DATA_DIR,
  isMain,
  pool,
  writeJsonAtomic,
} from '../lib/node.js';
import { apiGet, apiPost } from './workshop-api.js';
import { buildWorkshopStats, fetchWorkshopGrad, OUT_FILE } from './workshop-stats.js';
import { computeEnkaPanel, propName } from './workshop-panel.js';
import { items } from './workshop-static.js'; // 装备表（buildCtx 的 ctx.items 供 2025 源配装映射）
import { loadNameIndexes, resolveWengineName } from './name-index.js';
import { sleep } from './mihoyo-api.js';

const WEIGHTS_FILE = path.join(DATA_DIR, 'workshop-weights.json'); // 角色默认流派权重（工坊有效词条口径）
// 名称索引（统一 resolver，library.json 为权威源）：工坊 nick_name 差异在写时解析回 wiki 标准名，保证与 library/plans 一致；
// library.json 缺失/损坏时降级为空索引（不归一、不崩——测试可直接 import 本模块）
const {
  char: libChars,
  wengine: libWengines,
  disc: libDiscs,
} = loadNameIndexes('工坊') ?? {
  char: buildNameIndex({}, CATEGORY.CHAR),
  wengine: buildNameIndex({}, CATEGORY.WENGINE),
  disc: buildNameIndex({}, CATEGORY.DISC),
};
// ---------- 参数 ----------
const MAX_ROLES = Number(process.argv[2] || 57); // 爬几个角色（全量模式）
// 每影画排行榜上限 ≈298 去重 uid（offset≥300 返回空），故 300 = 榜单全量（旧默认 100 只拿 1/3）；扩大 uid 集合的其他路径均实测无效
const PER_RANK = Number(process.argv[3] || 300);
// v3 配装请求并发（默认 6）：排名收集阶段每角色 7 影画组内并行，不占此并发；调高加速但响应大吃带宽，注意工坊 API 限流
const CONCURRENCY = Number(process.argv[4] || 6);

// ---------- 断点续爬：以文件实际内容为准（不再用进度文件） ----------
// 曾用 .workshop-progress.json 缓存「已爬 uid」，进度先于写文件 → 中断后跳过大量 uid 且残缺 entries 覆盖旧文件
// （实测 145830 条覆盖 9579/63842 uid 的数据丢失事故）。现改为跳过判断 = 文件实际覆盖的 uid 集合，缺的自动重爬（自愈），写文件原子化（tmp+rename）
// 崩溃续爬 = 旧文件断点：写入文件后爬的 uid 不在文件里 → 自动重爬，永不静默丢数据。

// ---------- 大文件流式处理（防 OOM：90 万+ 条全量进内存 ≈ 7GB，超 Node 默认 4GB 堆） ----------
/** 本次新增配装条目的暂存文件（每行一条完整 JSON，无 [ ] 头尾）：爬取中分批落盘，结束时与旧文件流式合并；崩溃残留直接删除（自愈重爬） */
const PART_FILE = path.join(DATA_DIR, '.workshop-part.json');
const PART_FLUSH = 10000; // 内存条目达该数即落盘一批（常驻 ~60MB + 序列化临时 ~30MB）

/** 把 entries 追加写进 PART 并**清空数组**（partCount 累计已落盘条数）。
 *  ⚠️ 不清空会每个 build 都触发 flush 重写全部条目，partCount 虚高（O(n²)）与写放大（曾现 870 万虚高计数）。 */
export function flushPart(entries, partCount, file = PART_FILE) {
  if (!entries.length) return partCount;
  const fd = fs.openSync(file, 'a');
  try {
    // 每条约一行（完整 JSON）：合并按行读取，跨块 UTF-8 天然安全（\n 不出现在多字节字符内）
    for (const e of entries) fs.writeSync(fd, JSON.stringify(e) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  const n = entries.length;
  entries.length = 0;
  return partCount + n;
}

/** 合并写出 workshop.json（分块 gzip，原子 tmp+rename）：旧文件逐块解码 + PART 逐行解码 → 重新分块压缩（收尾跑一次，全量重压 ~2 分钟可接受）。
 *  perChunk 可选（默认 WORKSHOP_PER_CHUNK），测试用小值强制多块。 */
export function mergeWorkshopFile({ meta, oldFile, partFile, partCount, outFile, perChunk }) {
  const entries = (function* () {
    // 旧文件已是分块 gzip：iterWorkshopFile 逐块解压
    if (oldFile && fs.existsSync(oldFile)) {
      for (const e of iterWorkshopFile(oldFile)) yield e;
    }
    if (partCount > 0 && partFile && fs.existsSync(partFile)) {
      for (const line of readLines(partFile)) {
        if (!line) continue;
        try {
          yield JSON.parse(line);
        } catch {
          /* 坏行丢弃（自愈：缺的 uid 下次自动重爬） */
        }
      }
    }
  })();
  writeWorkshopFile(outFile, entries, meta, perChunk);
}

// ---------- 聚合（buildWorkshopStats / fetchWorkshopGrad 已拆分到 workshop-stats.js，原样透传供调用方复用） ----------
export { buildWorkshopStats, fetchWorkshopGrad } from './workshop-stats.js';

// ---------- 提取玩家某角色的配装（兼容 mys 源 / 2025 源两种 item_json） ----------
// ctx = { weapons: system_weapons, artifacts: system_artifacts, items: 装备表 }

/** 角色是否「练满」：角色≥60 / 音擎≥60 / 6 块驱动盘全 15 级且全 R5（R4 盘上限 +12，R5 才是满配）；爬取时过滤未毕业角色。
 *  role 为 user_role/v3 的 role；mys 源字段 ij.weapon/ij.equip，2025 源 ij.Weapon/ij.EquippedList（大小写不同）。 */
export function isMaxedRole(role) {
  if (!role || !role.item_json) return false;
  if ((role.level ?? 0) < 60) return false;
  const ij = role.item_json;
  // 音擎等级（mys: ij.weapon.level；2025: ij.Weapon.Level）
  const wpnLv = ij.weapon ? ij.weapon.level : ij.Weapon ? ij.Weapon.Level : null;
  if (!(wpnLv >= 60)) return false;
  // 驱动盘：恰 6 块且每块 15 级 + R5（mys: ij.equip[]；2025: ij.EquippedList[].Equipment）
  const discs =
    Array.isArray(ij.equip) && ij.equip.length ? ij.equip : Array.isArray(ij.EquippedList) ? ij.EquippedList : null;
  if (!discs || discs.length !== 6) return false;
  for (const d of discs) {
    const lv = d && d.level != null ? d.level : d && d.Equipment ? d.Equipment.Level : null;
    if (lv !== 15) return false;
    const rar = d && d.rarity != null ? d.rarity : d && d.Equipment ? d.Equipment.Rarity : null;
    if (rar !== 5) return false;
  }
  return true;
}

export function extractBuild(v3Data, roleId, ctx) {
  const roles = (v3Data.data && v3Data.data.roles) || [];
  const role = roles.find((x) => String(x.item_id) === String(roleId));
  if (!role || !role.item_json) return null;
  const ij = role.item_json;
  // relic_point 写时归一为数字（工坊返回字符串如 "294.30"；0/缺失 = 未带驱动盘或 2025 源无评分，置 null 由聚合层过滤）
  const rp = Number(role.relic_point);
  const base = { level: role.level, rank: role.rank, relic_point: Number.isFinite(rp) && rp > 0 ? rp : null };
  // mys 源判定要「有实际数据」（数组非空）：2025 源的空 properties/equip 数组（[] 为 truthy）会误走 mys 分支返回空面板
  if ((ij.equip && ij.equip.length) || (ij.properties && ij.properties.length)) {
    // mys 源：工坊格式化结构（名称统一解析回 wiki 标准名 / 属性键归一）
    return {
      ...base,
      source: 'mys', // 源标记（技能 type 为官方语义：0普攻/1特殊技/2闪避/3终结+连携/5核心/6支援技）
      skills: (ij.skills || []).map((s) => ({ type: s.skill_type, level: s.level })),
      weapon: ij.weapon && {
        id: ij.weapon.id,
        name: ij.weapon.name ? resolveWengineName(libWengines, ij.weapon.name)?.name || romanNumeralUnicode(ij.weapon.name) : null,
        level: ij.weapon.level,
        rarity: ij.weapon.rarity,
        main: (ij.weapon.main_properties || []).map((p) => ({
          name: normalizeStatKey(p.property_name),
          value: p.base,
        })),
      },
      panel: (ij.properties || []).map((p) => ({
        name: normalizeStatKey(p.property_name),
        base: p.base,
        add: p.add,
        final: p.final,
      })),
      equips: (ij.equip || []).map((e) => {
        const suitName =
          e.equip_suit && e.equip_suit.name
            ? canonicalName(CATEGORY.DISC, libDiscs, e.equip_suit.name) || e.equip_suit.name
            : undefined;
        // 主/副词条与 2025 源同构（main=主词条、subs=全部副词条）；不提取 mys 独有 valid/all_hit 等——两源结构需一致
        return {
          id: e.id,
          name: e.name,
          level: e.level,
          rarity: e.rarity,
          suit: suitName,
          main: (e.main_properties || [])
            .filter((p) => p.property_name)
            .map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
          subs: (e.properties || [])
            .filter((p) => p.property_name)
            .map((p) => ({ name: normalizeStatKey(p.property_name), value: p.base })),
        };
      }),
    };
  }
  if (ij.Weapon || ij.EquippedList) {
    // 2025 源：游戏内嵌原始数据（面板经 enka_attrs_mapping 计算；音擎/驱动盘经装备表+系统字典映射）
    const w = ij.Weapon;
    const sysW = w && ctx.weapons.find((x) => String(x.item_id) === String(w.Id));
    const libW = sysW ? resolveWengineName(libWengines, sysW.nick_name) : null;
    const weapon = w && {
      id: w.Id,
      name: sysW ? (libW ? libW.name : romanNumeralUnicode(sysW.nick_name)) : null,
      level: w.Level,
      rarity: sysW ? sysW.level : null,
      main: [],
    };
    const equips = (ij.EquippedList || [])
      .map((slot) => {
        const eq = slot && slot.Equipment;
        if (!eq) return null;
        const item = ctx.items[String(eq.Id)];
        const suit = item && ctx.artifacts.find((x) => x.set_id === String(item.SuitId));
        // 套装名解析为 wiki 标准盘名（工坊 artifacts 名可能带尾随空格）
        const suitName = suit ? canonicalName(CATEGORY.DISC, libDiscs, suit.name) || suit.name : null;
        const main = eq.MainPropertyList && eq.MainPropertyList[0];
        return {
          id: eq.Id,
          name: suitName,
          level: eq.Level,
          rarity: item ? item.Rarity : null,
          suit: suitName,
          main: main ? [{ name: propName(main.PropertyId), value: main.PropertyValue }] : [],
          subs: (eq.RandomPropertyList || []).map((p) => ({
            name: propName(p.PropertyId),
            value: p.PropertyValue * p.PropertyLevel,
          })),
        };
      })
      .filter(Boolean);
    return {
      ...base,
      source: '2025', // 源标记（技能 type 为 1.x 游戏 ID 语义：0普攻/1闪避/2特殊技/3连携/5核心/6终结）
      skills: (ij.SkillLevelList || []).map((s) => ({ type: s.Index, level: s.Level })), // 与 mys 源同构 {type, level}
      weapon,
      panel: computeEnkaPanel(ij),
      equips,
    };
  }
  return null;
}

// ---------- 主流程 ----------
/** 构建字典 ctx（音擎/驱动盘/装备表，供 2025 源配装映射）+ 角色列表（一次请求返回） */
async function buildCtx() {
  const sys = await apiGet('/api/v1/system_data/public', {});
  return {
    ctx: {
      weapons: (sys.data && sys.data.system_weapons) || [],
      artifacts: (sys.data && sys.data.system_artifacts) || [],
      items,
    },
    roles: (sys.data && sys.data.system_roles) || [],
  };
}

/** 拉单个「角色 × 影画档」的排名行（最多 PER_RANK 条）：offset 串行翻页；接口硬性每页 50（limit 无效，rows<50 即拉完） */
async function fetchRankRows(itemId, rank) {
  const rows = [];
  let offset = 0;
  while (rows.length < PER_RANK) {
    const j = await apiGet('/api/v1/user_relic/ranking', {
      limit: 50,
      offset,
      type: 'role',
      role_id: itemId,
      part_index: null,
      role_level: null,
      role_rank: rank,
      weapon_id: null,
    });
    const page = (j.data && j.data.rows) || [];
    rows.push(...page);
    if (page.length < 50) break; // 拉完
    offset += 50;
  }
  return rows;
}

/** 全量更新：排名 + 配装（workshop.json）+ 全服统计（workshop-grad.json）+ 汇总（workshop-stats.json）+ 权重（workshop-weights.json）。
 *  onProgress({step, done, total}) 供 server 进度轮询。 */
export async function fetchWorkshopData(onProgress) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(
    `开始爬取：前 ${MAX_ROLES} 角色 × 7 影画 × 每影画 ${PER_RANK} 条收集 uid，随后爬取每个 uid 下所有练满角色（≥60级 / 音擎≥60 / 6×15级盘且全 R5）\n`
  );
  const { ctx, roles } = await buildCtx();
  const targets = roles.slice(0, MAX_ROLES);
  console.log(`角色总数 ${roles.length}，本次爬 ${targets.length} 个\n`);

  // 收集排名（角色级并发；每角色 7 影画组内并行翻页——排名请求轻量，串行往返改一轮并行）
  const uidMap = new Map(); // uid -> [{role_id, rank}]
  let rankFetch = 0,
    roleDone = 0;
  await pool(targets, CONCURRENCY, async (t) => {
    const { item_id } = t;
    const pages = await Promise.all(Array.from({ length: 7 }, (_, rank) => fetchRankRows(item_id, rank)));
    let fetched = 0;
    pages.forEach((rows, rank) => {
      for (const r of rows) {
        if (!uidMap.has(r.uid)) uidMap.set(r.uid, []);
        uidMap.get(r.uid).push({ role_id: String(item_id), rank });
      }
      fetched += rows.length;
    });
    rankFetch += fetched;
    roleDone++;
    if (roleDone % 5 === 0 || roleDone === targets.length) console.log(`  排名收集 ${roleDone}/${targets.length}`);
    onProgress?.({ step: 'rank', done: roleDone, total: targets.length });
  });
  console.log(`\n排名条目 ${rankFetch}，去重 uid ${uidMap.size}\n`);

  // 每个 uid 拉完整配装（并发）；内存安全：恢复只收集 fileUids，本次新增分批落盘 PART（90 万+ 条全量进数组 ≈ 7GB 会 OOM）
  fs.rmSync(PART_FILE, { force: true }); // 清残留：上次崩溃的 PART 丢弃（缺失 uid 由自愈机制重爬）
  const fileUids = new Set(); // 旧文件实际覆盖的 uid（跳过判断唯一依据：文件里没有的 uid 一律重爬，自愈进度领先）
  let oldEntryCount = 0;
  if (fs.existsSync(OUT_FILE)) {
    for (const e of iterWorkshopFile(OUT_FILE)) {
      oldEntryCount++;
      if (e && e.uid) fileUids.add(e.uid);
    }
  }
  const newUids = [...uidMap.keys()].filter((u) => !fileUids.has(u));
  const skippedCount = uidMap.size - newUids.length;
  console.log(
    `断点续爬：${uidMap.size} 个目标 uid 中 ${skippedCount} 个已存在于 workshop.json（跳过），` +
      `本次实际爬取 ${newUids.length} 个` +
      (newUids.length ? '' : '；如需全量重爬请删除 data/workshop.json')
  );
  onProgress?.({ step: 'fetch', done: 0, skipped: skippedCount, total: newUids.length }); // 初始进度：前端从第一秒就显示跳过数
  let fail = 0,
    done = 0,
    consecutiveFail = 0; // 连续失败计数（防加剧风控：连续失败过多时暂停 60s）
  let entries = []; // 内存中未落盘的本次新增条目（达到 PART_FLUSH 即写入 PART）
  let partCount = 0;
  await pool(newUids, CONCURRENCY, async (uid) => {
    try {
      const j = await apiPost('/api/v1/user_role/v3', { uid, refresh: false, type: 'ranking' });
      const nick = j.data && j.data.nick_name;
      // 爬该 uid 下所有角色（不只排名上榜的角色），每角色一条；未毕业的跳过（见 isMaxedRole）
      const roles = (j.data && j.data.roles) || [];
      for (const role of roles) {
        if (!isMaxedRole(role)) continue;
        const build = extractBuild(j, role.item_id, ctx);
        if (build) {
          entries.push({ uid, role_id: String(role.item_id), nick, ...build });
          if (entries.length >= PART_FLUSH) partCount = flushPart(entries, partCount);
        }
      }
      consecutiveFail = 0;
    } catch (e) {
      fail++;
      consecutiveFail++;
      if (fail <= 5) console.log(`  ✗ uid ${uid} 失败: ${e.message.slice(0, 90)}`); // 前几个失败打印原因（多为风控 HTML）
      if (consecutiveFail >= 20) {
        // 连续失败 = 风控激活中：暂停让限流缓解，避免无效请求加剧封禁
        console.log(`  ⚠ 连续失败 ${consecutiveFail} 个，疑似风控/限流，暂停 60 秒…`);
        await sleep(60000);
        consecutiveFail = 0;
      }
    }
    done++;
    onProgress?.({ step: 'fetch', done, skipped: skippedCount, total: newUids.length });
    if (done % 100 === 0) {
      console.log(
        `  uid 进度 ${done}/${newUids.length}，配装条目 ${oldEntryCount + partCount + entries.length}，失败 ${fail}`
      );
    }
  });
  partCount = flushPart(entries, partCount); // 最后一批落盘（此后 entries 为空）

  // 合并写 workshop.json（原子：tmp + rename）：meta + 旧文件 entries（流式复制）+ PART 裸流
  const totalCount = oldEntryCount + partCount;
  const outMeta = {
    scrapedAt: new Date().toISOString(),
    roles: targets.length,
    ranks: 7,
    perRank: PER_RANK,
    uidCount: uidMap.size,
    entryCount: totalCount,
  };
  mergeWorkshopFile({ meta: outMeta, oldFile: OUT_FILE, partFile: PART_FILE, partCount, outFile: OUT_FILE });
  fs.rmSync(PART_FILE, { force: true }); // 合并完成，清理暂存

  // 角色默认流派权重（system_data 的 weight_json）独立落盘 + 并入 stats（供有效词条/评分口径复现）
  const weightJson = {};
  for (const r of roles) {
    if (r && r.weight_json) weightJson[String(r.item_id)] = r.weight_json;
  }
  writeJsonAtomic(WEIGHTS_FILE, {
    meta: { scrapedAt: new Date().toISOString(), roles: Object.keys(weightJson).length },
    weights: weightJson,
  });

  // 角色 id → 规范名（grad 名已对齐 plans；供 discDetails 输出角色名）
  const roleNameMap = new Map(
    roles.map((r) => [
      String(r.item_id),
      canonicalName(CATEGORY.CHAR, libChars, r.nick_name, { fuzzy: true }) || r.nick_name,
    ])
  );
  buildWorkshopStats(roleNameMap, weightJson, totalCount); // 配装数据更新后自动生成汇总（含 weightJson，流式遍历防 OOM）
  // grad 是收尾步骤：此时配装与 stats 都已落盘，且本函数的 roleNameMap 来自 system_data 而非 grad——失败只告警不抛，避免数小时爬取整体报失败
  let gradRoles = null;
  try {
    const g = await fetchWorkshopGrad(onProgress, CONCURRENCY); // 同时更新全服配装统计（workshop-grad.json）
    gradRoles = g.stats.roles;
  } catch (e) {
    console.warn(`[工坊全服统计] 更新失败（保留现有 workshop-grad.json）: ${e.message}`);
  }
  console.log(
    `\n完成：本次新爬 ${done} 个 uid（跳过 ${skippedCount} 个已缓存，失败 ${fail}），` +
      `配装条目共 ${totalCount} 条写入 ${OUT_FILE}`
  );
  return { stats: { entries: totalCount, roles: gradRoles } };
}

async function main() {
  await fetchWorkshopData();
}

isMain(import.meta, () => main());
