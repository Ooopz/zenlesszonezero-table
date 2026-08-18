// src/sync/plans.js —— 抓取米游社「养成指南」推荐方案 → data/plans.json（{ avatarId: { name, plans: [...] } }）
// 运行: npm run sync:plans（--account 只抓账号已练角色）；数据源 nap_cultivate_tool 的 user/feed（翻页到 end 全量爬取，MAX_PLANS=5000 防死循环）+ avatar_simple_info/plan_detail 补齐
// ⚠️ 请求头必须带 x-rpc-device_id / x-rpc-device_fp 指纹头，否则触发 Geetest 风控（retcode 10035）；
//   设备头优先取 cookie 真实指纹（DEVICEFP / _MHYUUID），伪造指纹会被 retcode 10041 拒绝（实测）。feed 端点域 act-api-takumi.mihoyo.com，参数用下划线

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, isMain, writeDataFile, pool } from '../lib/node.js';
import { readCookieCache } from './characters.js';
import { normalizeStatKey, substatName, parseNum } from '../lib/util.js';
import { canonicalize, CATEGORY } from '../lib/names.js';
import { PERCENT_STATS, mainStatName } from '../lib/constants.js';
import { validatePlans } from '../lib/schema.js';
import { requestJson, retry, fetchUid } from './mihoyo-api.js';
import { loadNameIndexes } from './name-index.js';

const ACCOUNT_FILE = path.join(DATA_DIR, 'characters.json');

// ---------- 名称权威（写时归一） ----------
// library.json 为标准名权威源；缺失/损坏时降级为不归一（名称保持接口原样），并在同步时提示。
const libNameIndex = loadNameIndexes('推荐方案名称');

/** 方案写时归一：角色/音擎主备/套装/配队成员统一解析为 library 标准名（extractPlan 保持纯函数，此层在写文件前固化名称） */
function normalizePlansOutput(entry) {
  if (!libNameIndex) return entry;
  // 写时归一一律关 fuzzy（plans 名是全名，精确/别名/归一化键已足够，避免子串误匹配）
  const cn = (cat, idx, raw) => canonicalize(cat, idx, raw, { fuzzy: false }).name;
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

// 请求头：nap_cultivate_tool 接口的鉴权组合。x-rpc-device_*（设备指纹）是关键——缺了触发 Geetest 风控；
// device_id/device_fp 由 deviceHeaders() 按 cookie 真实指纹动态注入，这里不写死。
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
const MAX_PLANS = 5000; // 每角色方案安全上限（feed 正常以 end 标记自然终止；仅防接口异常时死循环，实际爬取全部）
const FEED_PAGE = 10; // feed 每页数量（与 H5 一致）

/** 设备指纹头：优先取 cookie 里的真实指纹（DEVICEFP / _MHYUUID，随 cookie 导出），缺失才回退内置值；
 *  伪造指纹会被风控 retcode 10041 拒绝（实测），务必用真实值 */
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

/** 按属性名判定百分比：暴击/暴伤/穿透率恒为百分比（方案 show_percent 字段不可靠，同角色不同方案标 1/0 不一，值都是「45」式百分比） */
const isPercentPanel = (name) => PERCENT_STATS.has(normalizeStatKey(name));

/** 解析方案面板数值：百分比属性转内部小数（/100），无效返回 null；解析统一走 util.parseNum */
function parseValue(v, percent) {
  const n = parseNum(v);
  return n == null ? null : percent ? n / 100 : n;
}

/** 副词条推荐名 → 项目词条名体系：「攻击力百分比」→「攻击力%」（走 util.substatName），再按属性别名归一化 */
function substatKey(name) {
  return normalizeStatKey(substatName(name));
}

/** 单个方案 → 精简结构（item 结构在 feed 与 plan_detail 中一致） */
export function extractPlan(p) {
  const item = p.item || {};
  const mainProps = item.equip || {};
  return {
    id: String(p.id),
    name: p.name || '',
    desc: p.desc || '',
    releasedAt: p.released_at || '',
    // 推荐面板：low/mid/high 三档（低配/毕业/高配）。percent 按属性名判定（见 PERCENT_STATS）
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
    sets: (item.equip?.equip || []).map((e) => ({ name: e.name, cnt: e.cnt })),
    // 4/5/6 号位主词条（部分方案缺项）；456 恒为百分比，接口可能返回固定值名，用 mainStatName 统一转百分比
    mainProps: {
      4: mainStatName(mainProps.main_properties_4?.[0]?.property_name) || null,
      5: mainStatName(mainProps.main_properties_5?.[0]?.property_name) || null,
      6: mainStatName(mainProps.main_properties_6?.[0]?.property_name) || null,
    },
    subStats: (item.equip?.sub_properties || []).map((s) => substatKey(s.property_name)),
    skills: (item.skill || []).map((s) => ({ type: s.skill_type, level: s.level })),
    // 配队推荐（成员全名）
    team: (item.team?.main?.avatar_list || []).map((t) => t.full_name_mi18n || t.name_mi18n || ''),
  };
}

// ---------------- 抓取 ----------------

/** 单个角色的方案：user/feed 长列表分页爬取全部（直到 end）+ avatar_simple_info 的 plan_id 兜底补齐。 */
async function fetchPlansFor(cookies, uid, avatarId) {
  const R = `uid=${uid}&region=prod_gf_cn`;
  // user/feed 分页（参数用下划线，order=0 综合排序），翻页直到 end（全量爬取不截断；MAX_PLANS 仅防死循环）
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

  // avatar_simple_info 返回关联 plan_id（官方/使用中方案），未出现在 feed 时用 plan_detail 补上
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

/** 拉取全部角色推荐方案写入 data/plans.json；onlyAccount 只抓账号角色，strict 时校验异常抛错（STRICT=1） */
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

  // 校验 + 写入 data/plans.json（与 fetchMyCharacters 同模式，供 server 端复用）
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
