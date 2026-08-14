// src/sync/characters.js —— 通过米游社账号 cookie，拉取你账号里所有角色的当前真实数据
//
// 运行:  npm run sync:characters   （或 node src/sync/characters.js）
// 流程:  ① 自动打开 user.mihoyo.com 登录页
//        ② 按提示在浏览器控制台执行一段脚本，把 cookie 复制到剪贴板
//        ③ 在终端粘贴 cookie 回车，自动拉取全部角色
// 输出:  ① data/characters.json     —— 全部角色数据
//        ② data/debug-response.json —— 第一个角色的原始响应（供排查）
//        ③ data/.cookie.json        —— 缓存 cookie

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DATA_DIR, isMain, writeDataFile, openBrowser, pool } from '../lib/node.js';
import { parseCookies, parseNum, CLIPBOARD_SCRIPT } from '../lib/util.js';
import { canonicalize, CATEGORY } from '../lib/names.js';
import { validateCharacters } from '../lib/schema.js';
import { requestJson, fetchUid } from './http.js';
import { loadNameIndexes } from './name-index.js';

const COOKIE_FILE = path.join(DATA_DIR, '.cookie.json');

// ---------- 名称权威（写时归一） ----------
// library.json 为标准名权威源；缺失/损坏时降级为不归一（名称保持接口原样），并在同步时提示。
const libNameIndex = loadNameIndexes('账号音擎/驱动盘名');

/** 账号角色写时归一：音擎名 / 驱动盘套装名统一解析为 library 标准名（「未佩戴音擎」「未佩戴驱动盘」「未知」占位保留）。
 *  extractCharacter 保持纯函数，此层只在写 data/characters.json 前对已提取角色做名称固化。 */
function normalizeCharacterOutput(c) {
  if (!libNameIndex || !c) return c;
  const wengine =
    c.wengine && c.wengine.name !== '未佩戴音擎'
      ? { ...c.wengine, name: canonicalize(CATEGORY.WENGINE, libNameIndex.wengine, c.wengine.name, { fuzzy: false }).name }
      : c.wengine;
  const discs = (c.discs || []).map((d) =>
    d.set === '未佩戴驱动盘' || d.set === '未知'
      ? d
      : { ...d, set: canonicalize(CATEGORY.DISC, libNameIndex.disc, d.set, { fuzzy: false }).name }
  );
  return { ...c, wengine, discs };
}

// 参考 ZenlessZoneZero-Extractor/main.py 的请求头（未改动，保持原样可用）
const baseHeaders = {
  Host: 'api-takumi.mihoyo.com',
  Connection: 'keep-alive',
  Accept: 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 9; 23113RKC6C Build/PQ3A.190605.06200901; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36 miHoYoBBS/2.75.2',
  Origin: 'https://act.mihoyo.com',
  'X-Requested-With': 'com.mihoyo.hyperion',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://act.mihoyo.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// 米游社客户端模拟头：随客户端版本变化，接口可能校验。App 升级后若接口拒绝访问，
// 需按新客户端抓包出的实际请求头更新这几个值。
const CLIENT = {
  'x-rpc-app_version': '2.75.2',
  'x-rpc-device_id': '06770e63-c0e8-38da-89bd-1a1e504b6bfd',
  'x-rpc-device_name': 'Redmi%2023113RKC6C',
  'x-rpc-device_fp': '38d7fe73b1032',
  'x-rpc-sys_version': '9',
};

const recordHeaders = {
  Host: 'api-takumi-record.mihoyo.com',
  Connection: 'keep-alive',
  ...CLIENT,
  'x-rpc-platform': '2',
  'x-rpc-geetest_ext': '{"viewUid":"0","gameId":8,"page":"v1.1.4_#/zzz/roles/all","isHost":1}',
  'x-rpc-language': 'zh-cn',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 9; 23113RKC6C Build/PQ3A.190605.06200901; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36 miHoYoBBS/2.75.2',
  Accept: 'application/json, text/plain, */*',
  'x-rpc-page': 'v1.1.4_#/zzz/roles/all',
  'x-rpc-lang': 'zh-cn',
  Origin: 'https://act.mihoyo.com',
  'X-Requested-With': 'com.mihoyo.hyperion',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://act.mihoyo.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ---------------- 交互：获取 cookie ----------------

function ask(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(promptText, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function fetchCookie() {
  console.log('\n① 将自动打开米游社登录页，请先登录（登录过会自动跳转）。');
  openBrowser('http://user.mihoyo.com/');
  console.log('② 在打开的页面上按 F12 → 控制台(Console)，粘贴下面这段代码并回车：\n');
  console.log('   ' + CLIPBOARD_SCRIPT + '\n');
  console.log('   脚本会把 cookie 复制到剪贴板并弹出确认框。');
  const text = await ask('③ 请在这里粘贴 cookie 后回车: ');
  if (!text) throw new Error('未输入 cookie');
  return parseCookies(text) || {};
}

// ---------------- API 调用 ----------------

async function fetchCharacterList(cookies, uid) {
  const j = await requestJson(
    `https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/avatar/basic?server=prod_gf_cn&role_id=${uid}`,
    { headers: recordHeaders, cookies }
  );
  const list = j.data?.avatar_list || [];
  console.log(`   角色列表: ${list.length} 个`);
  return list.map((x) => ({
    id: String(x.id),
    name: x.full_name_mi18n || x.name || String(x.id),
    icon: x.icon || '',
  }));
}

async function fetchCharacterDetail(cookies, uid, charId, page) {
  const headers = {
    ...recordHeaders,
    'x-rpc-page': page,
    'x-rpc-geetest_ext': `{"viewUid":"0","gameId":8,"page":"v1.1.4_#/zzz/roles/${charId}/detail","isHost":1}`,
  };
  const url = `https://api-takumi-record.mihoyo.com/event/game_record_zzz/api/zzz/avatar/info?id_list[]=${charId}&need_wiki=true&server=prod_gf_cn&role_id=${uid}`;
  return requestJson(url, { headers, cookies });
}

// ---------------- 数据提取 ----------------

/** 把 {property_name, base} 数组整理成 [{name, value}]。
 *  用数组而非对象：同一盘可能同时有「攻击力%」和「攻击力固定」两条同名词条，对象会互相覆盖。
 *  数值解析统一走 util.parseNum（带 % 转小数、非法/空 → null）。 */
function collectStats(arr) {
  const out = [];
  for (const p of arr || []) {
    const name = p?.property_name;
    if (!name) continue;
    const n = parseNum(p?.base);
    if (n == null) continue;
    out.push({ name, value: n });
  }
  return out;
}

/** 从 avatar/info 响应提取角色的全部可获取数据。
 *  除面板/装备外，还包括当前影画(rank/ranks)、技能等级(skills)、皮肤、元素/职业代码、
 *  立绘主色、音擎特效标题、技能觉醒与装备规划等。 */
export function extractCharacter(response) {
  const a = response?.data?.avatar_list?.[0];
  if (!a) return null;
  const panel = {};
  for (const p of a.properties || []) {
    const name = p.property_name;
    if (!name) continue;
    panel[name] = { base: parseNum(p.base), bonus: parseNum(p.add), final: parseNum(p.final) };
  }
  const w = a.weapon || {};
  const wengine = {
    name: w.name || '未佩戴音擎',
    level: w.level ?? null,
    refinement: w.star ?? w.refine_level ?? w.refine ?? 1,
    icon: w.icon || '',
    specialEffectTitle: w.talent_title || '',
    specialEffect: w.talent_content || '',
    mainStats: collectStats(w.main_properties),
    subStats: collectStats(w.properties),
  };
  const discs = (a.equip || []).map((e, i) => ({
    set: e.equip_suit?.name || e.name || '未知',
    slot: i + 1,
    level: e.level ?? null,
    icon: e.equip_suit?.icon || e.icon || '',
    rarity: e.rarity || 'S',
    mainStats: collectStats(e.main_properties),
    subStats: collectStats(e.properties),
  }));
  // 保留前 6 槽，缺失的槽位补空（防止某些角色没带满 6 盘）
  while (discs.length < 6)
    discs.push({ set: '未佩戴驱动盘', slot: discs.length + 1, level: null, mainStats: [], subStats: [] });
  return {
    name: (a.full_name_mi18n || a.name_mi18n || String(a.id)).replace(/\s+/g, ''),
    id: String(a.id),
    level: a.level ?? null,
    icon: a.role_square_url || a.group_icon_path || a.hollow_icon_path || a.icon || '',
    portrait: a.role_vertical_painting_url || '',
    rarity: a.rarity || '',
    faction: a.camp_name_mi18n || '',
    panel,
    wengine,
    discs: discs.slice(0, 6),
    // ---------- 全量附加数据 ----------
    elementType: a.element_type ?? null, // 元素代码
    profession: a.avatar_profession ?? null, // 职业代码
    subElementType: a.sub_element_type ?? null, // 副元素代码
    verticalPaintingColor: a.vertical_painting_color || '', // 立绘主色
    usName: a.us_full_name || '', // 英文名
    skins: (a.skin_list || []).map((s) => ({
      id: s.skin_id,
      name: s.skin_name || '',
      portrait: s.skin_vertical_painting_url || '',
      square: s.skin_square_url || '',
      icon: s.skin_hollow_icon_path || '',
      color: s.skin_vertical_painting_color || '',
      unlocked: !!s.unlocked,
      rarity: s.rarity || '',
      isOriginal: !!s.is_original,
    })),
    mindscape: {
      rank: a.rank ?? 0, // 当前影画等级
      ranks: (a.ranks || []).map((r) => ({
        id: r.id,
        name: r.name || '',
        pos: r.pos,
        isUnlocked: !!r.is_unlocked,
        desc: r.desc || '', // 影画完整描述
      })),
    },
    skills: (a.skills || []).map((s) => ({
      type: s.skill_type, // 0普攻 1特殊技 2闪避 3连携 5核心被动 6支援
      level: s.level,
      items: (s.items || []).map((it) => ({
        title: it.title || '',
        text: it.text || '', // 技能完整描述
        awaken: !!it.awaken,
      })),
    })),
    skillAwaken: a.skill_awaken
      ? {
          hasSystem: !!a.skill_awaken.has_awaken_system,
          level: a.skill_awaken.awaken_level ?? 0,
          maxLevel: a.skill_awaken.awaken_max_level ?? 0,
          items: a.skill_awaken.skill_awaken_items || [],
        }
      : null,
    equipPlan: a.equip_plan_info || null, // 装备规划/配装评分
  };
}

// ---------------- 主流程 ----------------

/** 缓存 cookie 到本地文件（不通过命令行时也可用），gitignore 已排除 */
export function cacheCookies(cookies) {
  fs.mkdirSync(DATA_DIR, { recursive: true }); // data/ 目录存在性兜底
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2), 'utf-8');
}
export function readCookieCache() {
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/** 用 cookie 抓取全部角色数据并写入 data/characters.json，供命令行与 server.js 复用。
 *  onProgress 可选回调，上报 (done, total) 供同步进度展示。
 *  opts.strict 为 true 时校验异常直接抛错（命令行 STRICT=1 开启）。 */
export async function fetchMyCharacters(cookies, onProgress, { strict = false } = {}) {
  console.log('\n④ 获取 UID…');
  const uid = await fetchUid(cookies, baseHeaders);
  console.log(`   绑定角色 uid: ${uid}`);

  console.log('⑤ 获取角色列表…');
  const charList = await fetchCharacterList(cookies, uid);

  console.log('⑥ 并发拉取角色详情…（并发 3，避免触发接口风控）');
  // 复用 library.js 的并发池：结果按下标对齐，顺序与角色列表一致；失败项为 null，最后过滤
  const results = (
    await pool(
      charList,
      3,
      async (it, i) => {
        try {
          const response = await fetchCharacterDetail(cookies, uid, it.id, `v1.1.4_#/zzz/roles/${it.id}/detail`);
          const extracted = extractCharacter(response);
          if (extracted) {
            extracted.icon = extracted.icon || it.icon;
            // 保留第一个角色的原始响应供排查
            if (i === 0) {
              fs.mkdirSync(DATA_DIR, { recursive: true });
              fs.writeFileSync(path.join(DATA_DIR, 'debug-response.json'), JSON.stringify(response, null, 2), 'utf-8');
            }
            console.log(`   ${i + 1}/${charList.length} ${extracted.name}（等级${extracted.level}）`);
            return extracted;
          }
          console.error(`   ${i + 1}/${charList.length} ${it.name}: 提取失败`);
        } catch (e) {
          console.error(`   ${i + 1}/${charList.length} ${it.name}: 失败 ${e.message}`);
        }
        return null;
      },
      (done, total) => onProgress?.(done, total)
    )
  ).filter(Boolean);

  if (!results.length) throw new Error('一个角色都没拉到，请检查 cookie 是否过期');

  const data = results.map(normalizeCharacterOutput);
  const stats = { characters: results.length };

  // 校验 + 写入 data/characters.json
  writeDataFile('characters.json', data, { label: '我的角色', validate: validateCharacters, strict });

  return { data, stats, uid };
}

async function main() {
  const cookies = await fetchCookie();
  cacheCookies(cookies); // 缓存，下次可直接用
  const { stats } = await fetchMyCharacters(cookies, null, { strict: !!process.env.STRICT });
  console.log(`\n完成！共 ${stats.characters} 个角色。`);
  console.log('  data/characters.json 已生成；data/debug-response.json 保留第一个角色的原始响应');
}

// ESM 入口判断：仅当直接运行本文件时执行 main()
isMain(import.meta, () => main());
