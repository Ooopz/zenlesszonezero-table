// src/sync/plans.js —— 抓取米游社「养成指南」推荐方案（推荐面板 + 装备 + 词条）
//
// 运行:  npm run sync:plans              （默认抓养成指南全部角色）
//        npm run sync:plans -- --account （只抓账号 characters.json 里已练的角色）
// 输出:  data/plans.json —— { avatarId: { name, plans: [...] } }
//
// 数据源: act.mihoyo.com 的「养成指南」H5（character-builder）背后接口
//   nap_cultivate_tool 的 user/feed（「切换方案」长列表，分页）+ avatar_simple_info /
//   plan_detail（补齐非列表方案）。feed 每角色可返回大量方案，按顺序取前 50 个。
//   每个方案含：推荐面板(low/mid/high 三档)、推荐音擎(主+备)、驱动盘套装、
//   4/5/6 号位主词条、副词条推荐、技能等级、配队。
//
// ⚠️ 请求头必须带 x-rpc-device_id / x-rpc-device_fp 指纹头，否则 plan_detail /
//   search_plan 等端点会触发 Geetest 验证码风控（retcode 10035）。
//   设备头优先取 cookie 里的真实指纹（DEVICEFP / _MHYUUID，从养成指南页面导出）——
//   写死的伪造指纹会被风控以 retcode 10041 直接拒绝（实测），务必用真实值。
//   feed 端点域为 act-api-takumi.mihoyo.com，参数用下划线（page_size/next_id/follow_end）。

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, isMain, writeDataFile } from '../lib/node.js';
import { readCookieCache } from './characters.js';
import { pool } from './library.js';
import { normalizeStatKey, substatName, parseNum } from '../lib/util.js';
import { buildNameIndex, canonicalName, CATEGORY } from '../lib/names.js';
import { PERCENT_STATS, mainStatName } from '../lib/constants.js';
import { validatePlans } from '../lib/schema.js';
import { requestJson, retry, fetchUid } from './http.js';

const ACCOUNT_FILE = path.join(DATA_DIR, 'characters.json');

// ---------- 名称权威（写时归一） ----------
// library.json 为标准名权威源；缺失/损坏时降级为不归一（名称保持接口原样），并在同步时提示。
let libNameIndex = null;
try {
  const lib = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'library.json'), 'utf8'));
  libNameIndex = {
    char: buildNameIndex(lib.characters || {}, CATEGORY.CHAR),
    wengine: buildNameIndex(lib.wengines || {}, CATEGORY.WENGINE),
    disc: buildNameIndex(lib.discs || {}, CATEGORY.DISC),
  };
} catch {
  console.warn('⚠️ library.json 缺失/损坏，推荐方案名称跳过归一（建议先 npm run sync:library）');
}

/** 方案写时归一：角色名 / 音擎主备 / 套装名 / 配队成员统一解析为 library 标准名。
 *  extractPlan 保持纯函数，此层只在写 data/plans.json 前对已提取方案做名称固化。 */
function normalizePlansOutput(entry) {
  if (!libNameIndex) return entry;
  // 写时归一一律关 fuzzy（plans 名是全名，精确/别名/归一化键已足够，避免子串误匹配）
  const cn = (cat, idx, raw) => (raw ? canonicalName(cat, idx, raw, { fuzzy: false }) || raw : raw);
  return {
    ...entry,
    name: cn(CATEGORY.CHAR, libNameIndex.char, entry.name),
    plans: (entry.plans || []).map((p) => ({
      ...p,
      weapon: {
        main: cn(CATEGORY.WENGINE, libNameIndex.wengine, p.weapon?.main ?? null),
        backup: cn(CATEGORY.WENGINE, libNameIndex.wengine, p.weapon?.backup ?? null),
      },
      sets: (p.sets || []).map((s) => ({ ...s, name: cn(CATEGORY.DISC, libNameIndex.disc, s.name) })),
      team: (p.team || []).map((t) => cn(CATEGORY.CHAR, libNameIndex.char, t)),
    })),
  };
}

const UA =
  'Mozilla/5.0 (Linux; Android 9; 23113RKC6C Build/PQ3A.190605.06200901; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36 miHoYoBBS/2.75.2';

// 请求头：nap_cultivate_tool 接口的鉴权组合。
// x-rpc-device_*（设备指纹）是关键——缺了会触发 Geetest 风控；device_id / device_fp
// 由 deviceHeaders() 按 cookie 里的真实指纹动态注入（见下），这里不写死。
const planHeaders = {
  Host: 'api-takumi.mihoyo.com',
  'User-Agent': UA,
  'x-rpc-app_version': '2.75.2',
  'x-rpc-device_name': 'Redmi%2023113RKC6C',
  'x-rpc-platform': '2',
  'x-rpc-client_type': '5',
  'x-rpc-language': 'zh-cn',
  'x-rpc-lrsag': '1',
  'x-rpc-cultivate_source': 'pc',
  Origin: 'https://act.mihoyo.com',
  'X-Requested-With': 'com.mihoyo.hyperion',
  Referer: 'https://act.mihoyo.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  Accept: 'application/json, text/plain, */*',
};

const API = 'https://api-takumi.mihoyo.com/event/nap_cultivate_tool';
const API_USER = 'https://act-api-takumi.mihoyo.com/event/nap_cultivate_tool/user'; // feed 端点域
const MAX_PLANS = 500; // 每个角色方案上限（「切换方案」列表前 500 个）
const FEED_PAGE = 10; // feed 每页数量（与 H5 一致）

/** 设备指纹头：优先取 cookie 里养成指南会话的真实指纹（DEVICEFP / _MHYUUID，随 cookie 一起导出），
 *  缺失才回退到内置值。写死的伪造指纹会被风控以 retcode 10041 拒绝（实测 avatar_basic_list），
 *  务必用 cookie 里的真实值。 */
function deviceHeaders(cookies) {
  return {
    'x-rpc-device_id': cookies?._MHYUUID || '06770e63-c0e8-38da-89bd-1a1e504b6bfd',
    'x-rpc-device_fp': cookies?.DEVICEFP || '38d7fe73b1032',
  };
}

/** 养成指南接口请求：指纹头 + 瞬时风控（429 / retcode 10041）指数退避重试（5s → 15s → 45s） */
const req = (url, cookies) =>
  requestJson(url, {
    headers: { ...planHeaders, ...deviceHeaders(cookies) },
    cookies,
    retry: retry.backoff(),
  });

// ---------------- 数据提取 ----------------

/** 按属性名判定百分比：暴击/暴伤/穿透率恒为百分比（方案数据的 show_percent 字段不可靠，
 *  同一角色不同方案对暴击率有的标 1 有的标 0，但值都是「45」这种百分比数值）。集合见 constants.PERCENT_STATS */
const isPercentPanel = (name) => PERCENT_STATS.has(normalizeStatKey(name));

/** 解析方案面板数值：百分比属性（如暴击率 45）转内部小数（/100）；无效返回 null。
 *  基础解析统一走 util.parseNum（值通常为整数如 "45"，不带 % 符号）。 */
function parseValue(v, percent) {
  const n = parseNum(v);
  return n == null ? null : percent ? n / 100 : n;
}

/** 副词条推荐名 → 项目词条名体系：「攻击力百分比」→「攻击力%」，其余归一化。
 *  百分比→% 规则统一走 util.substatName，再按属性别名归一化。 */
function substatKey(name) {
  return normalizeStatKey(substatName(name));
}

/** 单个方案 → 精简结构。item 结构在 beta_plan_list 与 plan_detail 返回中一致。 */
export function extractPlan(p) {
  const item = p.item || {};
  const mainProps = item.equip || {};
  return {
    id: String(p.id),
    name: p.name || '',
    desc: p.desc || '',
    releasedAt: p.released_at || '',
    // 推荐面板：low/mid/high 三档（低配/毕业/高配）。percent 按属性名判定（见 PERCENT_PANEL）
    panel: (item.avatar || []).map((a) => {
      const name = normalizeStatKey(a.property_name);
      const percent = isPercentPanel(name);
      return {
        name,
        percent,
        low: parseValue(a.low, percent),
        mid: parseValue(a.mid, percent),
        high: parseValue(a.high, percent),
      };
    }),
    // 推荐音擎（主选 + 备选）
    weapon: {
      main: item.weapon?.main?.name || null,
      backup: item.weapon?.backup?.name || null,
    },
    // 驱动盘套装
    sets: (item.equip?.equip || []).map((e) => ({ name: e.name, cnt: e.cnt })),
    // 4/5/6 号位主词条推荐（部分方案可能缺某项）；456 号位恒为百分比，
    // 接口可能返回固定值名（攻击力/防御力/生命值），用 mainStatName 统一转百分比
    mainProps: {
      4: mainStatName(mainProps.main_properties_4?.[0]?.property_name) || null,
      5: mainStatName(mainProps.main_properties_5?.[0]?.property_name) || null,
      6: mainStatName(mainProps.main_properties_6?.[0]?.property_name) || null,
    },
    // 副词条推荐
    subStats: (item.equip?.sub_properties || []).map((s) => substatKey(s.property_name)),
    // 技能等级推荐
    skills: (item.skill || []).map((s) => ({ type: s.skill_type, level: s.level })),
    // 配队推荐（成员全名）
    team: (item.team?.main?.avatar_list || []).map((t) => t.full_name_mi18n || t.name_mi18n || ''),
  };
}

// ---------------- 抓取 ----------------

/** 单个角色的方案：user/feed 长列表分页取前 MAX_PLANS 个 + avatar_simple_info 的 plan_id 兜底补齐。 */
async function fetchPlansFor(cookies, uid, avatarId) {
  const R = `uid=${uid}&region=prod_gf_cn`;
  // 「切换方案」长列表：user/feed 分页（参数用下划线，order=0 综合排序），
  // 直到 end 或凑满 MAX_PLANS 个方案
  const plans = [];
  let nextId = 0;
  while (plans.length < MAX_PLANS) {
    const q = `${R}&order=0&page_size=${FEED_PAGE}&next_id=${nextId}&follow_end=true&lang_end=false&avatar_id=${avatarId}`;
    const j = await req(`${API_USER}/feed?${q}`, cookies);
    const list = j.data?.list || [];
    for (const it of list) plans.push(it.plan);
    const { end, next_id } = j.data || {};
    if (!list.length || end || !next_id || next_id === nextId) break;
    nextId = next_id;
  }

  // avatar_simple_info 返回该角色在养成指南里关联的 plan_id（官方/使用中方案），
  // 未出现在 feed 列表时用 plan_detail 补上
  const info = await req(`${API}/avatar_simple_info?avatar_id=${avatarId}&${R}`, cookies);
  const pid = info.data?.plan_id;
  if (pid && pid !== '0' && !plans.some((p) => String(p.id) === String(pid))) {
    try {
      const det = await req(`${API}/plan_detail?plan_id=${pid}&${R}`, cookies);
      if (det.data?.plan) plans.push(det.data.plan);
    } catch (e) {
      console.error(`   ${avatarId} plan_detail(${pid}) 失败: ${e.message}`);
    }
  }
  return plans.slice(0, MAX_PLANS);
}

/** 拉取全部角色的推荐方案并写入 data/plans.json。
 *  onlyAccount 为 true 时只抓 data/characters.json 里的账号角色；否则抓养成指南全部角色。
 *  strict 为 true 时校验异常抛错（命令行 STRICT=1 开启，网页同步保持 warn）。 */
export async function fetchAllPlans(cookies, { onlyAccount = false, strict = false } = {}, onProgress) {
  const uid = await fetchUid(cookies, { ...planHeaders, ...deviceHeaders(cookies) }, { retry: retry.backoff() });
  console.log(`uid: ${uid}`);

  let list;
  if (onlyAccount) {
    const chars = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf-8'));
    list = chars.map((c) => ({ id: String(c.id), name: c.name }));
    console.log(`仅账号角色 ${list.length} 个`);
  } else {
    const ab = await req(`${API}/avatar_basic_list?uid=${uid}&region=prod_gf_cn`, cookies);
    // name 去空格，与 characters.json 的角色名对齐（星见 雅 → 星见雅），供前端按名匹配推荐方案
    list = (ab.data?.list || []).map((x) => ({
      id: String(x.avatar.id),
      name: (x.avatar.full_name_mi18n || '').replace(/\s+/g, ''),
    }));
    console.log(`养成指南全部角色 ${list.length} 个`);
  }

  const results = await pool(
    list,
    3,
    async (it, i) => {
      try {
        const plans = await fetchPlansFor(cookies, uid, it.id);
        console.log(`   ${i + 1}/${list.length} ${it.name}(${it.id}) ${plans.length} 个方案`);
        return { id: it.id, name: it.name, plans: plans.map(extractPlan) };
      } catch (e) {
        console.error(`   ${i + 1}/${list.length} ${it.name}: 失败 ${e.message}`);
        return null;
      }
    },
    (done, total) => onProgress?.(done, total)
  );

  const success = results.filter(Boolean);
  // 全部角色抓取失败（如 e_nap_token 过期 → feed 全部 -100 未登录）时明确抛错，避免静默写入空 plans.json
  if (!success.length)
    throw new Error(
      '推荐方案抓取全部失败：养成指南登录态（e_nap_token）可能已过期，请从养成指南页面重新导出 cookie 后重试'
    );
  const out = {};
  for (const r of success) out[r.id] = normalizePlansOutput({ name: r.name, plans: r.plans });
  const stats = { characters: Object.keys(out).length, plans: 0 };
  for (const r of Object.values(out)) stats.plans += r.plans.length;

  // 校验 + 写入 data/plans.json（与 characters.js 的 fetchMyCharacters 同模式，供 server 端复用）
  writeDataFile('plans.json', out, { label: '推荐方案', validate: validatePlans, strict });

  return { data: out, uid, stats };
}

async function main() {
  const cookies = readCookieCache();
  if (!cookies) {
    throw new Error(
      '未找到缓存 cookie（data/.cookie.json）。请先运行 npm run sync:characters 粘贴 cookie，或手动准备 cookie 缓存。'
    );
  }
  const onlyAccount = process.argv.includes('--account');
  const { uid, stats } = await fetchAllPlans(cookies, { onlyAccount, strict: !!process.env.STRICT });

  console.log(`\n完成！uid ${uid}，共 ${stats.characters} 角色、${stats.plans} 个方案。`);
  console.log('  data/plans.json 已生成');
  return { uid, stats };
}

isMain(import.meta, () => main());
