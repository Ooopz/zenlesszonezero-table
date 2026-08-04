// src/sync/library.js —— 从米游社 wiki API 抓取绝区零「角色 / 音擎 / 驱动盘」基础属性库
//
// 运行:  npm run sync:library    （或 node src/sync/library.js）
// 输出:  ① data/library.json    —— 解析后的属性库
//        ② data/raw-library.json —— 每个 entry_page 的原始响应快照（日后备用）
//
// 依赖 Node 18+（自带 fetch），无需安装任何包。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripHtml } from '../lib/util.js';
import { validateLibrary, warnIfInvalid } from '../lib/schema.js';

// 项目根目录（本文件位于 src/sync/ 下，向上两级）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

const API = 'https://api-takumi-static.mihoyo.com';
const HEADERS = {
  accept: 'application/json, text/plain, */*',
  origin: 'https://baike.mihoyo.com',
  referer: 'https://baike.mihoyo.com/',
  'x-rpc-wiki_app': 'zzz',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
};

// ---------------- 基础工具 ----------------

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

/** 并发池：最多同时 limit 个，结果按下标对齐；onProgress 在每个任务结束后回调 (done, total) */
async function pool(items, limit, fn, onProgress) {
  const ret = new Array(items.length);
  let i = 0,
    done = 0;
  const workers = Array(Math.min(limit, items.length || 1))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        ret[idx] = await fn(items[idx], idx).catch((e) => {
          console.error(`    ✗ ${items[idx].key} 失败: ${e.message}`);
          return null;
        });
        done++;
        onProgress?.(done, items.length);
      }
    });
  await Promise.all(workers);
  return ret;
}

/** 把组件的 data 字段（可能是字符串 JSON）解析成对象，解析失败返回 null */
function parseComponentData(comp) {
  let data = comp?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data || null;
}

/** 从 HTML 文本里抽出「名称：值」对，返回 {名称: 数值}。值带 % 转成小数 */
function parseStatPairs(html) {
  const text = stripHtml(html);
  const out = {};
  const re = /([一-鿿A-Za-z]+)[：:]\s*(-?[\d.]+%?)/g;
  let m;
  while ((m = re.exec(text))) {
    const v = m[2].includes('%') ? parseFloat(m[2]) / 100 : parseFloat(m[2]);
    out[m[1]] = v;
  }
  return out;
}

/** 从「属性+数值」文本（如 基础攻击力+665、攻击力+36%、防御力+16%）解析为 {属性: 数值} */
function parseSignedStat(text) {
  const s = stripHtml(text);
  const m = s.match(/([一-鿿A-Za-z]+)([+-])([\d.]+%?)/);
  if (!m) return null;
  let v = parseFloat(m[3]) / (m[3].includes('%') ? 100 : 1);
  if (m[2] === '-') v = -v;
  return { [m[1]]: v };
}

// ---------------- 数据抓取 ----------------

/** 第一步：内容列表 → {characters: [{key,id}], wengines: [...], discs: [...]} */
async function fetchContentList() {
  const jso = await fetchJSON(`${API}/common/blackboard/zzz_wiki/v1/home/content/list?app_sn=zzz_wiki&channel_id=2`);
  const children = jso.data.list[0].children;
  // 实测分组: [0]=角色 [1]=音擎 [2]=邦布 [3]=驱动盘；用数量+抽样兜底，尽量不写死索引
  const groups = [
    { label: '角色', key: 'characters', idx: 0 },
    { label: '音擎', key: 'wengines', idx: 1 },
    { label: '驱动盘', key: 'discs', idx: 3 },
  ];
  const result = {};
  for (const { label, key, idx } of groups) {
    const lst = children[idx].list;
    result[key] = lst.map((j) => ({
      key: stripHtml(j.title) || `未知-${j.content_id}`,
      id: String(j.content_id),
    }));
    console.log(`  已获取${label}列表: ${result[key].length} 个`);
  }
  return result;
}

/** 第二步：抓 entry_page 详情 */
async function fetchDetail(id) {
  const url = `${API}/hoyowiki/zzz/wapi/entry_page?app_sn=zzz_wiki&entry_page_id=${id}&lang=zh-cn`;
  const jso = await fetchJSON(url);
  return jso.data.page;
}

/** 在页面的所有模块里，找到第一个满足谓词的组件数据 */
function findModule(page, predicate) {
  for (const m of page.modules || []) {
    for (const c of m.components || []) {
      const data = parseComponentData(c);
      if (data && predicate(data)) return data;
    }
  }
  return null;
}

/** 解析 fe_ext（字符串 JSON） */
function parseFe(page) {
  try {
    return JSON.parse(page.ext?.fe_ext || '{}');
  } catch {
    return {};
  }
}

/** 角色：初始/满级基础属性（modules 里成长表的 growth 项） */
function fetchCharacterBaseStats(page) {
  const out = {};
  for (const m of page.modules || []) {
    for (const c of m.components || []) {
      const data = parseComponentData(c);
      const items = data?.list;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        for (const ch of it.children || []) {
          if (!Array.isArray(ch.growth)) continue;
          for (const g of ch.growth) {
            const txt = stripHtml(g.children?.[0]?.row?.[0]?.[0] || '');
            if (g.name === '初始') out.initial = parseStatPairs(txt);
            if (g.name === '满级') out.maxLevel = parseStatPairs(txt);
          }
        }
      }
    }
  }
  return out;
}

/** fe_ext 标签的键名映射（稀有度/属性/特性/阵营 → 英文），角色与音擎共用 */
const TAG_KEY_MAP = { 稀有度: 'rarity', 属性: 'element', 特性: 'trait', 阵营: 'faction' };

/** 角色：fe_ext.c_43 的 稀有度/属性/特性/阵营 */
function fetchCharacterTags(page) {
  const fe = parseFe(page);
  const text = fe.c_43?.filter?.text;
  if (!text) return {};
  const out = {};
  try {
    for (const item of JSON.parse(text)) {
      const [k, v] = item.split('/');
      out[TAG_KEY_MAP[k] || k] = v;
    }
  } catch {
    /* 标签文本解析失败时忽略 */
  }
  return out;
}

/** 音擎：特效效果说明（含各精炼档位数值）。
 *  结构不统一：有的「音擎效果」表单独一行是特效，有的特效与「满级面板」挤在同一格。 */
function fetchWengineEffect(page) {
  for (const m of page.modules || []) {
    for (const c of m.components || []) {
      const data = parseComponentData(c);
      const tables = data?.tables;
      if (!Array.isArray(tables)) continue;
      for (const t of tables) {
        for (const row of t.row || []) {
          for (const cell of row) {
            const txt = stripHtml(cell);
            if (!txt || txt.length < 20) continue;
            // 情形①：同一格同时有「满级面板」和特效 → 取面板数值之后的部分
            const panelMatch = txt.match(/满级面板：[^满]*?(?=(对于|装备者|自身|队伍|触发|发动|获得|进入|造成的|其))/);
            if (panelMatch) return txt.slice(panelMatch.index + panelMatch[0].length);
            // 情形②：纯特效格（含斜杠档位数值 + 效果关键词）
            if (
              /\//.test(txt) &&
              /(提升|触发|造成|伤害|精通|暴击|防御|冲击|异常)/.test(txt) &&
              !/(初始面板|满级面板|获取途径)/.test(txt)
            )
              return txt;
          }
        }
      }
    }
  }
  return null;
}

/** 音擎：满级(Lv60) 基础攻击力 + 副属性 + 特效
 *  注意：attr 表只到 Lv50（最后一次突破），真正的满级数值在「满级面板：…」文本里，
 *  因此优先解析「满级面板」，找不到时回退到 attr 最后一组。 */
function fetchWengineStats(page) {
  const specialEffect = fetchWengineEffect(page);
  // ① 优先：满级面板文本
  for (const m of page.modules || []) {
    for (const c of m.components || []) {
      const data = parseComponentData(c);
      const s = JSON.stringify(data || '');
      const i = s.indexOf('满级面板');
      if (i < 0) continue;
      const seg = s.slice(i, i + 250);
      const baseAtk = parseFloat((seg.match(/基础攻击力\+([\d.]+)/) || [])[1]);
      const subMatch = [...seg.matchAll(/([一-鿿A-Za-z]+)[+-]([\d.]+%?)/g)].filter((x) => x[1] !== '基础攻击力')[0];
      if (baseAtk != null || subMatch) {
        return {
          baseAtk: baseAtk != null ? baseAtk : null,
          subStats: subMatch
            ? {
                [damageMapping[subMatch[1]] || subMatch[1]]: subMatch[2].includes('%')
                  ? parseFloat(subMatch[2]) / 100
                  : parseFloat(subMatch[2]),
              }
            : null,
          subStatsText: seg.match(/([一-鿿A-Za-z]+[+-][\d.]+%?)/)?.[0] || null,
          specialEffect,
        };
      }
    }
  }
  // ② 兜底：attr 最后一组 突破后基础 / 突破后高级
  const data = findModule(page, (d) => {
    const lst = d.list;
    return Array.isArray(lst) && lst.some((it) => Array.isArray(it?.attr) && it.attr.length);
  });
  if (!data) return null;
  const attr = data.list.flatMap((it) => (Array.isArray(it.attr) ? it.attr : []));
  const last = attr.slice(-4);
  const baseText = stripHtml(last.find((a) => a.key === '突破后基础')?.value);
  const subStatsText = stripHtml(last.find((a) => a.key === '突破后高级')?.value);
  return {
    baseAtk: parseFloat((baseText.match(/([\d.]+)/) || [])[1]) || null,
    subStats: parseSignedStat(subStatsText) || null,
    subStatsText,
    specialEffect,
  };
}

/** 套装效果里的「X伤害」统一成「X属性伤害加成」，与面板/账号接口的属性名对齐 */
const damageMapping = {
  物理伤害: '物理伤害加成',
  火属性伤害: '火属性伤害加成',
  冰属性伤害: '冰属性伤害加成',
  电属性伤害: '电属性伤害加成',
  雷属性伤害: '电属性伤害加成',
  以太伤害: '以太伤害加成',
  流明伤害: '流明伤害加成',
  虚属性伤害: '虚属性伤害加成',
  物理属性伤害: '物理伤害加成',
};

/** 驱动盘：fe_ext.c_46 的 2/4 件套效果 */
function fetchDiscSet(page) {
  const fe = parseFe(page);
  const list = fe.c_46?.table?.list;
  const out = { set2: null, set4: null, set2Text: null, set4Text: null };
  for (const item of list || []) {
    if (item.key === '2') {
      out.set2Text = stripHtml(item.value);
      const parsed = parseSignedStat(item.value) || null;
      if (parsed) {
        const key = Object.keys(parsed)[0];
        out.set2 = { [damageMapping[key] || key]: parsed[key] };
      } else {
        out.set2 = null;
      }
    }
    if (item.key === '4') {
      out.set4Text = stripHtml(item.value);
    }
  }
  return out;
}

// ---------------- 主流程 ----------------

/** 抓取并组装属性库，写入 data/library.json 与 data/raw-library.json。
 *  onProgress 可选回调，上报 { step, done, total } 供同步进度展示。 */
export async function fetchLibrary(onProgress) {
  console.log('① 获取内容列表…');
  const list = await fetchContentList();

  // 原始响应快照：{ characters: {名字: page}, wengines: {...}, discs: {...} }
  const raw = { characters: {}, wengines: {}, discs: {} };

  console.log('② 抓取角色详情…');
  const characters = await pool(
    list.characters.map((x) => x),
    6,
    async (x) => {
      const page = await fetchDetail(x.id);
      raw.characters[x.key] = page;
      return {
        name: stripHtml(page.name || x.key),
        key: x.key,
        id: x.id,
        icon: page.icon_url,
        portrait: (() => {
          const d = findModule(page, (d) => d.tachie_pc);
          return d?.tachie_pc || null;
        })(),
        tags: fetchCharacterTags(page),
        baseStats: fetchCharacterBaseStats(page),
      };
    },
    (done, total) => onProgress?.({ step: 'characters', done, total })
  );

  console.log('③ 抓取音擎详情…');
  const wengines = await pool(
    list.wengines.map((x) => x),
    6,
    async (x) => {
      const page = await fetchDetail(x.id);
      raw.wengines[x.key] = page;
      return {
        name: stripHtml(page.name || x.key),
        key: x.key,
        id: x.id,
        icon: page.icon_url,
        tags: parseFe(page).c_45?.filter?.text
          ? JSON.parse(parseFe(page).c_45.filter.text).reduce((o, s) => {
              const [k, v] = s.split('/');
              o[TAG_KEY_MAP[k] || k] = v;
              return o;
            }, {})
          : {},
        stats: fetchWengineStats(page),
      };
    },
    (done, total) => onProgress?.({ step: 'wengines', done, total })
  );

  console.log('④ 抓取驱动盘详情…');
  const discs = await pool(
    list.discs.map((x) => x),
    6,
    async (x) => {
      const page = await fetchDetail(x.id);
      raw.discs[x.key] = page;
      return {
        name: stripHtml(page.name || x.key),
        key: x.key,
        id: x.id,
        icon: page.icon_url,
        setEffects: fetchDiscSet(page),
      };
    },
    (done, total) => onProgress?.({ step: 'discs', done, total })
  );

  // ---------------- 组装 ----------------

  const charLib = {};
  for (const r of characters.filter(Boolean)) {
    charLib[r.key] = {
      name: r.name,
      id: r.id,
      icon: r.icon,
      portrait: r.portrait,
      ...r.tags,
      ...(r.baseStats.initial || {}),
      maxLevel: r.baseStats.maxLevel || {},
    };
  }

  const wengineLib = {};
  for (const w of wengines.filter(Boolean)) {
    wengineLib[w.key] = {
      name: w.name,
      id: w.id,
      icon: w.icon,
      ...w.tags,
      ...(w.stats || {}),
    };
  }

  const discLib = {};
  for (const s of discs.filter(Boolean)) {
    discLib[s.key] = {
      name: s.name,
      id: s.id,
      icon: s.icon,
      ...s.setEffects,
    };
  }

  const library = { characters: charLib, wengines: wengineLib, discs: discLib };
  const stats = {
    characters: Object.keys(charLib).length,
    wengines: Object.keys(wengineLib).length,
    discs: Object.keys(discLib).length,
  };

  // 校验 + 写入 data/
  warnIfInvalid('属性库', validateLibrary(library));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'library.json'), JSON.stringify(library, null, 2), 'utf-8');
  // 原始响应快照（含全部未解析字段：介绍/技能/影画/CV/推荐角色等），日后备用
  fs.writeFileSync(path.join(DATA_DIR, 'raw-library.json'), JSON.stringify(raw), 'utf-8');

  return { library, stats };
}

async function main() {
  const { stats } = await fetchLibrary();
  console.log('\n完成！');
  console.log(`  角色 ${stats.characters} 个，音擎 ${stats.wengines} 个，驱动盘 ${stats.discs} 个`);
  console.log('  data/library.json 已生成');
  console.log('  data/raw-library.json 已生成（原始响应快照）');
}

// ESM 入口判断：仅当直接运行本文件时执行 main()
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error('运行出错:', e);
    process.exit(1);
  });
}
