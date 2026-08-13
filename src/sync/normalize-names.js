// src/sync/normalize-names.js —— 就地迁移现有数据文件为 library 标准名（纯本地改名，不重爬）
//
// 用法:  node src/sync/normalize-names.js          # 正式迁移（有改动才写盘）
//        node src/sync/normalize-names.js --dry-run # 只打印改动清单，不写盘
// 幂等：同一份数据跑第二遍 changes 为 0。
//
// 迁移范围：library.json（discs.set2 / wengines.subStats 属性键归一）、workshop.json（音擎/盘/面板属性名）、
//   workshop-grad.json（角色/音擎/盘名 + 组合名按 4 件套在前重组）、workshop-stats.json（由迁移后的 workshop.json 重算）、
//   characters.json（音擎/盘名）、plans.json（角色/音擎/套装/配队名）。
// 名称统一走 src/lib/names.js 的 resolver，library.json 为标准名权威源。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStatKey, normalizeStatKeys } from '../lib/util.js';
import { buildNameIndex, canonicalName, CATEGORY } from '../lib/names.js';
import { orderComboSets4First } from '../lib/plansStats.js';
import { computeWorkshopStats, computePanelCorrelations, computeWorkshopDiscStats, computePanelScatter } from '../lib/workshopStats.js';
import { DATA_DIR } from '../lib/node.js';

const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const WS_FILE = path.join(DATA_DIR, 'workshop.json');
const GRAD_FILE = path.join(DATA_DIR, 'workshop-grad.json');
const STATS_FILE = path.join(DATA_DIR, 'workshop-stats.json');
const CHARS_FILE = path.join(DATA_DIR, 'characters.json');
const PLANS_FILE = path.join(DATA_DIR, 'plans.json');

/** 构建三类名称索引（library 为标准名权威源） */
export function buildNameIndexes(lib) {
  return {
    char: buildNameIndex(lib.characters || {}, CATEGORY.CHAR),
    wengine: buildNameIndex(lib.wengines || {}, CATEGORY.WENGINE),
    disc: buildNameIndex(lib.discs || {}, CATEGORY.DISC),
  };
}

/** 迁移 library.json：discs[].set2 / wengines[].subStats 属性键 → 规范属性名（风属性伤害→风属性伤害加成 等） */
export function migrateLibrary(lib) {
  const data = JSON.parse(JSON.stringify(lib || {}));
  let changes = 0;
  const normKeys = (obj) => {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of Object.keys(obj)) if (k !== normalizeStatKey(k)) changes++;
    return normalizeStatKeys(obj);
  };
  for (const d of Object.values(data.discs || {})) if (d.set2) d.set2 = normKeys(d.set2);
  for (const w of Object.values(data.wengines || {})) if (w.subStats) w.subStats = normKeys(w.subStats);
  return { data, changes };
}

/** 迁移 workshop.json 配装条目：weapon.name→音擎、equips[].suit→盘、panel[].name→规范属性名 */
export function migrateWorkshopEntries(entries, idx) {
  const data = JSON.parse(JSON.stringify(entries || []));
  let changes = 0;
  const cn = (cat, raw) => {
    const n = canonicalName(cat, idx[cat], raw, { fuzzy: false });
    if (n && n !== raw) {
      changes++;
      return n;
    }
    return raw;
  };
  for (const e of data) {
    if (e.weapon?.name && e.weapon.name !== '其他') e.weapon = { ...e.weapon, name: cn(CATEGORY.WENGINE, e.weapon.name) };
    for (const eq of e.equips || []) if (eq?.suit && eq.suit !== '其他') eq.suit = cn(CATEGORY.DISC, eq.suit);
    for (const p of e.panel || []) {
      if (p?.name) {
        const n = normalizeStatKey(p.name);
        if (n !== p.name) {
          p.name = n;
          changes++;
        }
      }
    }
  }
  return { data, changes };
}

/** 迁移 workshop-grad.json：roles[].name→角色、weapons[].name→音擎、relics 套装名→盘 + 组合名按 4 件套在前重组 */
export function migrateGradRoles(roles, idx) {
  const data = JSON.parse(JSON.stringify(roles || []));
  let changes = 0;
  const cn = (cat, raw, fuzzy) => {
    const n = canonicalName(cat, idx[cat], raw, { fuzzy });
    if (n && n !== raw) {
      changes++;
      return n;
    }
    return raw;
  };
  for (const r of data) {
    if (r?.name) r.name = cn(CATEGORY.CHAR, r.name, true);
    for (const w of r.weapons || []) if (w?.name && w.name !== '其他') w.name = cn(CATEGORY.WENGINE, w.name, false);
    for (const rel of r.relics || []) {
      if (rel?.sets?.length) {
        for (const s of rel.sets) if (s?.name) s.name = cn(CATEGORY.DISC, s.name, false);
        // 组合名按归一后套装重建（4 件套在前、2 件套在后），与方案侧文本一致
        const { name, sets } = orderComboSets4First(rel.sets);
        if (name && name !== rel.name) {
          rel.name = name;
          changes++;
        }
        if (JSON.stringify(sets.map((s) => [s.name, s.num])) !== JSON.stringify(rel.sets.map((s) => [s.name, s.num]))) {
          rel.sets = sets;
          changes++;
        }
      }
    }
  }
  return { data, changes };
}

/** 迁移 characters.json：wengine.name→音擎、discs[].set→盘（「未佩戴音擎」「未佩戴驱动盘」「未知」占位保留） */
export function migrateCharacters(chars, idx) {
  const data = JSON.parse(JSON.stringify(chars || []));
  let changes = 0;
  const cn = (cat, raw) => {
    const n = canonicalName(cat, idx[cat], raw, { fuzzy: false });
    if (n && n !== raw) {
      changes++;
      return n;
    }
    return raw;
  };
  for (const c of data) {
    if (c?.wengine?.name && c.wengine.name !== '未佩戴音擎') c.wengine.name = cn(CATEGORY.WENGINE, c.wengine.name);
    for (const d of c.discs || []) {
      if (d?.set && d.set !== '未佩戴驱动盘' && d.set !== '未知') d.set = cn(CATEGORY.DISC, d.set);
    }
  }
  return { data, changes };
}

/** 迁移 plans.json：角色名/音擎主备/套装名/配队成员 → 标准名（plans 名均为全名，关 fuzzy 防误匹配） */
export function migratePlans(plans, idx) {
  const data = JSON.parse(JSON.stringify(plans || {}));
  let changes = 0;
  const cn = (cat, raw) => {
    const n = canonicalName(cat, idx[cat], raw, { fuzzy: false });
    if (n && n !== raw) {
      changes++;
      return n;
    }
    return raw;
  };
  for (const v of Object.values(data)) {
    if (v?.name) v.name = cn(CATEGORY.CHAR, v.name);
    for (const p of v.plans || []) {
      if (p?.weapon?.main) p.weapon.main = cn(CATEGORY.WENGINE, p.weapon.main);
      if (p?.weapon?.backup) p.weapon.backup = cn(CATEGORY.WENGINE, p.weapon.backup);
      for (const s of p.sets || []) if (s?.name) s.name = cn(CATEGORY.DISC, s.name);
      if (Array.isArray(p.team)) p.team = p.team.map((t) => cn(CATEGORY.CHAR, t));
    }
  }
  return { data, changes };
}

/** 由迁移后的 workshop.json 重算 workshop-stats.json（保留旧 meta.scrapedAt，避免分布口径变化）。
 *  discIndex 为盘名索引（buildNameIndex），roleNameMap 为 role_id → 角色名（来自 workshop-grad）。 */
export function rebuildStats(entries, prevMeta, discIndex, roleNameMap) {
  const stats = computeWorkshopStats(entries);
  const panelCorr = computePanelCorrelations(entries);
  const discDetails = computeWorkshopDiscStats(entries, discIndex, { roleNameMap }); // 驱动盘单盘真实统计
  const panelScatter = computePanelScatter(entries); // 面板属性对 2D 密度（供密度散点图）
  return {
    meta: { scrapedAt: prevMeta?.scrapedAt || new Date().toISOString(), entries: entries.length },
    ...stats,
    discDetails,
    panelCorr,
    panelScatter,
  };
}

// ---------- 写盘（大文件原子写：临时文件 + rename） ----------
function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(LIBRARY_FILE)) {
    console.error('缺少 library.json（标准名权威源），请先 npm run sync:library');
    process.exit(1);
  }
  const idx = buildNameIndexes(readJSON(LIBRARY_FILE));
  const total = [];
  const apply = (label, file, { data, changes }, prevMeta) => {
    total.push([label, changes]);
    console.log(`${changes ? '' : '✓ '}${label}: ${changes} 处改动`);
    if (changes && !dryRun) {
      if (label === 'workshop-stats.json') writeAtomic(file, rebuildStats(data.entries, prevMeta));
      else writeAtomic(file, data);
    }
  };

  // library.json（set2/subStats 属性键归一）
  apply('library.json', LIBRARY_FILE, migrateLibrary(readJSON(LIBRARY_FILE)));

  // workshop.json → 迁移后重算 workshop-stats.json
  const ws = readJSON(WS_FILE);
  const wsMigrated = migrateWorkshopEntries(ws.entries || [], idx);
  const prevStatsMeta = fs.existsSync(STATS_FILE) ? readJSON(STATS_FILE).meta : null;
  // workshop.json 本体写盘（entries）；workshop-stats.json 由 apply 在非 dry-run 时重算
  total.push(['workshop-stats.json', 0]);
  console.log(`${wsMigrated.changes ? '' : '✓ '}workshop.json: ${wsMigrated.changes} 处改动`);
  if (wsMigrated.changes && !dryRun) writeAtomic(WS_FILE, { ...ws, entries: wsMigrated.data });
  if (!dryRun && (wsMigrated.changes || ws.entries.length)) {
    // 角色 id → 规范名（grad roles[].item_id ↔ name 一一对应）
    const gradForRoles = readJSON(GRAD_FILE);
    const roleNameMap = new Map((gradForRoles.roles || []).map((r) => [String(r.item_id), r.name]));
    const statsData = rebuildStats(wsMigrated.data, prevStatsMeta, idx.disc, roleNameMap);
    writeAtomic(STATS_FILE, statsData);
    console.log(`workshop-stats.json: 由迁移后的 workshop.json 重算（${wsMigrated.data.length} 条）`);
  }

  // workshop-grad.json（文件结构为 {meta, roles}，只迁移 roles，保留 meta）
  {
    const gradFile = readJSON(GRAD_FILE);
    const migrated = migrateGradRoles(gradFile.roles, idx);
    total.push(['workshop-grad.json', migrated.changes]);
    console.log(`${migrated.changes ? '' : '✓ '}workshop-grad.json: ${migrated.changes} 处改动`);
    if (migrated.changes && !dryRun) writeAtomic(GRAD_FILE, { ...gradFile, roles: migrated.data });
  }

  // characters.json / plans.json
  apply('characters.json', CHARS_FILE, migrateCharacters(readJSON(CHARS_FILE), idx));
  apply('plans.json', PLANS_FILE, migratePlans(readJSON(PLANS_FILE), idx));

  console.log('\n汇总：');
  for (const [label, n] of total) console.log(`  ${label}: ${n}`);
  console.log(dryRun ? '\n（--dry-run：仅预览，未写盘）' : '\n完成。');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('错误:', e);
    process.exit(1);
  });
}
