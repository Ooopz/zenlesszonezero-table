// src/sync/library.js —— 从米游社 wiki API 抓取「角色 / 音擎 / 驱动盘」基础属性库
// 运行: npm run sync:library（或 node src/sync/library.js）→ 输出 data/library.json
// 依赖 Node 18+（自带 fetch），无需安装任何包。

import fs from 'node:fs';
import path from 'node:path';
import { stripHtml, normalizeStatKey, normalizeStatKeys, parseNum, decodeHtmlEntities } from '../lib/util.js';
import { validateLibrary } from '../lib/schema.js';
import { isMain, writeDataFile, DATA_DIR, pool } from '../lib/node.js';
import { requestJson, retry } from './mihoyo-api.js';

// ---------- 图片本地化（原 library-img.js 合并进来） ----------
const IMG_DIR = path.join(DATA_DIR, 'img');
/** 文件名安全化：保留中文/字母/数字/连字符/下划线/罗马数字（ⅠⅡⅢ…，否则「残响」-Ⅰ/Ⅱ/Ⅲ 型会冲突），其余替换为 _ */
const safe = (n) => String(n || '未知').replace(/[^\w一-龥-ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, '_');
/** 图片下载（或本地路径规范化）：已是 /data/img/ 的引用统一小写扩展名并修正到实际存在的文件 */
const IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
async function img(url, base) {
  if (!url) return url;
  // 已是本地路径：修正扩展名（统一小写 + 用实际存在的文件，兼容历史大小写/扩展名不一致）
  if (url.startsWith('/data/img/')) {
    const f = url.split('/').pop();
    const stem = f.replace(/\.[^.]+$/, '');
    const actual = IMG_EXTS.map((e) => `${stem}.${e}`).find((n) => fs.existsSync(path.join(IMG_DIR, n)));
    if (actual && actual !== f) return `/data/img/${actual}`;
    return url;
  }
  if (!/^https?:\/\//.test(url)) return url;
  const ext = ((url.match(/\.(png|jpg|jpeg|webp|gif)/i) || [])[1] || 'png').toLowerCase();
  const file = `${base}.${ext}`;
  const fp = path.join(IMG_DIR, file);
  if (fs.existsSync(fp)) return `/data/img/${file}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    fs.writeFileSync(fp, Buffer.from(await res.arrayBuffer()));
    return `/data/img/${file}`;
  } catch {
    return url;
  }
}
/** 图片本地化：把 library.json / characters.json 的图片下载到 data/img/ 并替换为本地路径（同步后调用，避免重新抓取后图片回到远程） */
export async function localizeDataFiles() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const stats = {};
  // ---- library.json ----
  const libFile = path.join(DATA_DIR, 'library.json');
  if (fs.existsSync(libFile)) {
    const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
    for (const [name, c] of Object.entries(lib.characters || {})) {
      if (c.portrait) c.portrait = await img(c.portrait, `char-${safe(name)}-portrait`);
      if (c.icon) c.icon = await img(c.icon, `char-${safe(name)}`);
      if (c.tachie) c.tachie = await img(c.tachie, `char-${safe(name)}-tachie`);
    }
    for (const [name, w] of Object.entries(lib.wengines || {}))
      if (w.icon) w.icon = await img(w.icon, `wengine-${safe(name)}`);
    for (const [name, d] of Object.entries(lib.discs || {})) {
      if (d.icon) d.icon = await img(d.icon, `disc-${safe(name)}`);
      if (d.roundIcon) d.roundIcon = await img(d.roundIcon, `disc-${safe(name)}-round`);
    }
    for (const [name, b] of Object.entries(lib.bangboos || {}))
      if (b.icon) b.icon = await img(b.icon, `bangboo-${safe(name)}`);
    fs.writeFileSync(libFile, JSON.stringify(lib));
    stats['library.json'] = (JSON.stringify(lib).match(/\/data\/img\//g) || []).length;
  }
  // ---- characters.json ----
  const charsFile = path.join(DATA_DIR, 'characters.json');
  if (fs.existsSync(charsFile)) {
    const chars = JSON.parse(fs.readFileSync(charsFile, 'utf8'));
    for (const c of chars || []) {
      const nm = safe(c?.name);
      if (c.portrait) c.portrait = await img(c.portrait, `char-${nm}-portrait`);
      if (c.icon) c.icon = await img(c.icon, `char-${nm}`);
      if (c.tachie) c.tachie = await img(c.tachie, `char-${nm}-tachie`);
      if (c.wengine?.icon) c.wengine.icon = await img(c.wengine.icon, `wengine-${safe(c.wengine.name)}`);
      for (const d of c.discs || []) if (d.icon) d.icon = await img(d.icon, `disc-${safe(d.set || d.name)}`);
    }
    fs.writeFileSync(charsFile, JSON.stringify(chars));
    stats['characters.json'] = (JSON.stringify(chars).match(/\/data\/img\//g) || []).length;
  }
  return { stats };
}

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

/** 从 HTML 文本抽出「名称：值」对（值带 % 转小数），键名归一化（页面用词不一：生命/攻击/防御 → 生命值/攻击力/防御力） */
function parseStatPairs(html) {
  const text = stripHtml(html);
  const out = {};
  const re = /([一-鿿A-Za-z]+)[：:]\s*(-?[\d.]+%?)/g;
  let m;
  while ((m = re.exec(text))) {
    out[m[1]] = parseNum(m[2]);
  }
  return normalizeStatKeys(out);
}

/** 从「属性+数值」文本（如 基础攻击力+665）解析为 {属性: 数值}；套装文本可能用全角 ＋－，需同时匹配 */
function parseSignedStat(text) {
  const s = stripHtml(text);
  const m = s.match(/([一-鿿A-Za-z]+)([+\-＋－])([\d.]+%?)/);
  if (!m) return null;
  let v = parseNum(m[3]);
  if (m[2] === '-' || m[2] === '－') v = -v;
  return { [m[1]]: v };
}

// ---------------- 数据抓取 ----------------

/** 第一步：内容列表 → {characters: [{key,id}], wengines: [...], discs: [...]} */
async function fetchContentList() {
  const jso = await requestJson(`${API}/common/blackboard/zzz_wiki/v1/home/content/list?app_sn=zzz_wiki&channel_id=2`, {
    headers: HEADERS,
    retry: retry.simple(),
  });
  const children = jso.data.list[0].children;
  // 实测分组固定：[0]=角色 [1]=音擎 [2]=邦布 [3]=驱动盘（按固定索引取）
  const groups = [
    { label: '角色', key: 'characters', idx: 0 },
    { label: '音擎', key: 'wengines', idx: 1 },
    { label: '邦布', key: 'bangboos', idx: 2 },
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
  const jso = await requestJson(url, { headers: HEADERS, retry: retry.simple() });
  return jso.data.page;
}

function findModule(page, predicate) {
  for (const m of page.modules || []) {
    for (const c of m.components || []) {
      const data = parseComponentData(c);
      if (data && predicate(data)) return data;
    }
  }
  return null;
}

function parseFe(page) {
  try {
    return JSON.parse(page.ext?.fe_ext || '{}');
  } catch {
    return {};
  }
}

/** 解析 fe_ext 某字段的 filter.text（形如 ["稀有度/S","属性/冰"] 的 JSON 数组）；失败返回空数组 */
function parseTagList(fe, field) {
  try {
    return JSON.parse(fe?.[field]?.filter?.text || '[]');
  } catch {
    return [];
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
            // 满级行名称不统一：多数角色为「满级」，个别（如柏妮思·怀特）为「满级数据」
            if (String(g.name).includes('满级')) out.maxLevel = parseStatPairs(txt);
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
  const out = {};
  for (const item of parseTagList(parseFe(page), 'c_43')) {
    const [k, v] = item.split('/');
    out[TAG_KEY_MAP[k] || k] = v;
  }
  return out;
}

/** 在 HTML 里定位特效段落的起点（含特效关键词的 <p>/<div> 标签位置） */
function findEffectStart(html) {
  const m = /(对于|装备者|自身|队伍|触发|发动|获得|进入|造成的)/.exec(html);
  if (!m) return null;
  const before = html.lastIndexOf('<p', m.index);
  return before >= 0 ? before : m.index;
}

/** 音擎特效说明（含各精炼档位数值）；页面结构不统一：特效可能独占一行，也可能与「满级面板」挤同一格 */
function fetchWengineEffect(page) {
  for (const m of page.modules || []) {
    for (const c of m.components || []) {
      const data = parseComponentData(c);
      const tables = data?.tables;
      if (!Array.isArray(tables)) continue;
      for (const t of tables) {
        for (const row of t.row || []) {
          for (const cell of row) {
            const html = String(cell || '');
            const txt = stripHtml(html);
            if (!txt || txt.length < 20) continue;
            // 情形①：同一格同时有「满级面板」和特效 → 返回特效段落的原始 HTML（保留富文本）
            if (txt.includes('满级面板')) {
              const hr = html.indexOf('<hr');
              if (hr >= 0) return html.slice(hr + 4);
              const fxStart = findEffectStart(html);
              if (fxStart != null) return html.slice(fxStart);
              continue;
            }
            // 情形②：纯特效格（档位数值 + 效果关键词）→ 返回原始 HTML；档位可能是百分比（8%/9%）或点数（30/34），
            // 斜杠两侧必须是数字（「特殊技/强化特殊技」这类中文斜杠不误判）
            if (
              /(\d+(\.\d+)?%?\s*\/\s*\d+(\.\d+)?%?)/.test(txt) &&
              /(提升|触发|造成|伤害|精通|暴击|防御|冲击|异常)/.test(txt) &&
              !/(初始面板|满级面板|获取途径)/.test(txt)
            )
              return html;
          }
        }
      }
    }
  }
  return null;
}

/** 音擎满级(Lv60) 基础攻击力 + 副属性 + 特效。
 *  attr 表只到 Lv50（最后一次突破），满级数值在「满级面板：…」文本里——优先解析它，找不到回退 attr 最后一组 */
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
      // ⚠️ 必须用 Number.isFinite：正则不匹配时 parseFloat(undefined) === NaN，而 `NaN != null` 为 true，
      // 会在这里提前 return 并写出 baseAtk: NaN（序列化成 null），下面的 attr 兜底分支永远走不到。
      // schema 也拦不住（typeof NaN === 'number'）。
      const hasAtk = Number.isFinite(baseAtk);
      if (hasAtk || subMatch) {
        return {
          baseAtk: hasAtk ? baseAtk : null,
          subStats: subMatch ? { [normalizeStatKey(subMatch[1])]: parseNum(subMatch[2]) } : null,
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

/** 驱动盘圆形图标：取 modules 中出现次数最多的图片——圆形图有 6 个尺寸变体（出现 6 次），其他图 2 次 */
function fetchDiscRound(page) {
  const s = JSON.stringify(page.modules || '');
  const count = {};
  const urls = {};
  for (const m of s.matchAll(/https:\/\/act-upload\.mihoyo\.com[^\s"\\]+/g)) {
    const h = m[0].match(/[0-9a-f]{32}/)?.[0];
    if (!h) continue;
    count[h] = (count[h] || 0) + 1;
    urls[h] = m[0];
  }
  let best = null,
    bestN = 0;
  for (const [h, n] of Object.entries(count))
    if (n > bestN) {
      bestN = n;
      best = urls[h];
    }
  return bestN >= 3 ? best : null;
}

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
        out.set2 = { [normalizeStatKey(key)]: parsed[key] };
      } else {
        out.set2 = null;
      }
    }
    if (item.key === '4') {
      out.set4Text = item.value;
    }
  }
  // 二/四件套说明优先取套装表格（含富文本 HTML），由前端 renderRichText 渲染
  const setTable = findModule(
    page,
    (d) => Array.isArray(d.tables) && d.tables.some((t) => (t.header || []).join(',') === '二件套,四件套')
  );
  if (setTable) {
    const row = setTable.tables.find((t) => t.header?.join(',') === '二件套,四件套')?.row?.[0];
    if (row?.[0]) out.set2Text = row[0];
    if (row?.[1]) out.set4Text = row[1];
  }
  return out;
}

// ---------------- 全量扩展解析 ----------------

/** 提取推荐角色：header 含「推荐」的表，取 data-entry-name 或首格文本 */
function fetchRecommend(page) {
  const rec = findModule(
    page,
    (d) => Array.isArray(d.tables) && d.tables.some((t) => (t.header || []).some((h) => h.includes('推荐')))
  );
  if (!rec) return [];
  return rec.tables
    .flatMap((t) => t.row || [])
    .map((row) => ({
      name: String(row?.[0] || '').match(/data-entry-name="([^"]+)"/)?.[1] || stripHtml(row?.[0] || ''),
      reason: stripHtml(row?.[1] || ''),
    }))
    .filter((r) => r.name && r.name !== '暂无');
}

/** 提取突破材料：attr 表所在模块的 materials */
function fetchMaterials(page) {
  const found = findModule(
    page,
    (d) => Array.isArray(d.list) && d.list.some((it) => Array.isArray(it.materials) && it.materials.length)
  );
  if (!found) return [];
  return found.list
    .flatMap((it) => (it.materials || []).map((m) => ({ name: m.nickname || '', amount: m.amount ?? null })))
    .filter((m) => m.name);
}

/** 把技能「详细数据」HTML 拆成逐行数值 [{k, v}]（实测每行一段 <p>）。
 *  分隔符规则：冒号后紧跟数值才算——「蓄力伤害倍率：215%炮击伤害倍率：215%」可拆多对；
 *  技能名自身含冒号（「强化特殊技：极寒重碾…」）或值以中文开头视为纯说明（{k:null, v:整段}）。 */
export function parseSkillValueLines(html) {
  const paras = String(html || '')
    .match(/<p[^>]*>([\s\S]*?)<\/p>/gi)
    ?.map((p) => stripHtml(p).trim())
    .filter(Boolean);
  const segs = paras && paras.length ? paras : [stripHtml(html).trim()];
  const lines = [];
  for (const seg of segs) {
    if (!seg) continue;
    const seps = [];
    const sepRe = /[：:](?=\s*[+\-＋－.\d%％])/g;
    let m;
    while ((m = sepRe.exec(seg))) seps.push(m.index);
    if (!seps.length) {
      lines.push({ k: null, v: seg });
      continue;
    }
    let start = 0;
    for (let i = 0; i < seps.length; i++) {
      const ci = seps[i];
      const hasNext = i + 1 < seps.length;
      const nextSep = hasNext ? seps[i + 1] : seg.length;
      const k = seg.slice(start, ci).replace(/[\s:：]+$/, '');
      // 值 = 冒号后的数值 token；多对时下一对紧贴值结束处（其标签即 start）
      const rest = seg.slice(ci + 1, hasNext ? nextSep : undefined);
      const valueMatch = rest.match(/^[\d.]+(?:%[＋+][\d.]+)?(?:%|点\/秒|点)?/);
      let v = valueMatch ? valueMatch[0].trim() : '';
      if (!hasNext && !v) v = rest.trim(); // 末对无数值 token 时整段视为值（兜底）
      lines.push(k && v ? { k, v } : { k: null, v: seg });
      if (!valueMatch) break; // 数值 token 缺失（理论上不会到这），停止解析该段
      start = ci + 1 + valueMatch[0].length;
    }
  }
  return lines;
}

/** 占位分组名（分类1/分类2/强化效果/空）→ 推导有意义列名：取行键公共后缀（轻/重/连续招架失衡倍率 → 招架失衡倍率），单行取该行键 */
function deriveGroupName(lines) {
  const keys = (lines || []).map((l) => l.k).filter((k) => k != null && k);
  if (!keys.length) return '说明';
  if (keys.length === 1) return keys[0];
  let suffix = keys[0];
  for (const k of keys.slice(1)) while (suffix && !k.endsWith(suffix)) suffix = suffix.slice(1);
  if (suffix && suffix.length >= 2) return suffix;
  let prefix = keys[0];
  for (const k of keys.slice(1)) while (prefix && !k.startsWith(prefix)) prefix = prefix.slice(0, -1);
  if (prefix && prefix.length >= 2) return prefix;
  return keys[0];
}
const isJunkGroupName = (n) => /^(分类\d*|强化效果|)$/.test((n || '').trim());

/** 技能每级数值：数字档（1-16）→ {level, groups:[{name, lines}]}；核心技 A-F 档取开头基础提升 + data-name 被动详情。
 *  解析不出 名称：数值 时退化存 text；无档位返回 null。 */
function parseSkillGrowth(ch) {
  const out = [];
  for (const g of ch.growth || []) {
    const level = stripHtml(g.name);
    const isAlpha = /^[A-F]$/.test(level);
    const isNum = /^\d+$/.test(level) && Number(level) >= 1 && Number(level) <= 16;
    if (!isAlpha && !isNum) continue; // 跳过「总计」等越界/杂档位
    const groups = [];
    for (const child of g.children || []) {
      const html = child.row?.[0]?.[0] || '';
      const txt = stripHtml(html).trim();
      if (!txt) continue;
      if (isAlpha) {
        // 核心技档位：可见文本开头「X提升Y」为基础提升；data-name 内嵌完整被动详情（多数角色各档相同，个别随档递增）
        const boostEnd = txt.indexOf('[');
        const boostText = boostEnd > 0 ? txt.slice(0, boostEnd).trim() : '';
        if (boostText) groups.push({ name: '基础提升', text: boostText });
        const dn = String(html).match(/data-name="([^"]*)"/);
        if (dn && decodeHtmlEntities(dn[1])) groups.push({ name: '核心被动', rich: decodeHtmlEntities(dn[1]) });
        continue;
      }
      const lines = parseSkillValueLines(html);
      const hasPairs = lines.some((l) => l.k != null);
      // 占位名分组（分类N/空等）从内容推导有意义的列名，避免「分类1」泄漏到展示层
      const name = isJunkGroupName(stripHtml(child.name)) ? deriveGroupName(lines) : stripHtml(child.name);
      groups.push(hasPairs ? { name, lines } : { name, text: txt });
    }
    if (groups.length) out.push({ level, groups });
  }
  return out.length ? out : null;
}

/** 技能：按 tab_name 分类的条目（children 含 title + 富文本 desc + 每级数值 growth）；requireChildren 时要求 children 非空 */
export function fetchSkills(page, { requireChildren = false } = {}) {
  const skillData = findModule(
    page,
    (d) =>
      Array.isArray(d.list) &&
      d.list.some((it) => Array.isArray(it.children) && it.tab_name && (!requireChildren || it.children.length))
  );
  if (!skillData) return [];
  return skillData.list
    .filter((it) => it.tab_name && (!requireChildren || (Array.isArray(it.children) && it.children.length)))
    .map((it) => ({
      type: stripHtml(it.tab_name),
      items: (it.children || [])
        .map((ch) => {
          const growth = parseSkillGrowth(ch);
          return {
            name: stripHtml(ch.title),
            desc: ch.desc || '',
            ...(growth ? { growth } : {}), // 无每级数值（如部分闪避/被动）不写 growth
          };
        })
        .filter((item) => item.name || item.desc || item.growth),
    }));
}

/** 核心技基础面板提升的属性名 → 规范名（含 基础X 与 百分比X 两类） */
const coreStatAlias = {
  基础攻击力: '攻击力',
  基础生命值: '生命值',
  基础防御力: '防御力',
  基础冲击力: '冲击力',
  基础能量自动回复: '能量自动回复',
  攻击力百分比: '攻击力%',
  生命值百分比: '生命值%',
  防御力百分比: '防御力%',
  冲击力百分比: '冲击力%',
  // 数字档（核心被动增强）可能用不带「基础」的属性名，如「[围猎]状态时冲击力提升5%」
  攻击力: '攻击力',
  生命值: '生命值',
  防御力: '防御力',
  冲击力: '冲击力',
  能量自动回复: '能量自动回复',
  暴击率: '暴击率',
  暴击伤害: '暴击伤害',
  异常精通: '异常精通',
  异常掌控: '异常掌控',
  穿透率: '穿透率',
};

/** 核心技 A-F 档开头的基础面板提升（如「暴击率提升4.8%」），按档存增量数组：第 i 项 = 第 i 档（对应核心技等级 i+2）。
 *  仅匹配开头 + 白名单属性名，天然跳过条件性/招式增强（如「猫又处于[肉球突袭]状态时…」开头即不匹配）；% 除 100。
 *  同时提取各档 data-name 被动详情：数值逐档递增，末档即满级数据存 passiveMax。 */
function fetchCoreSkill(page) {
  const boost = [];
  let passiveMax = null;
  const reAlpha = /^([一-鿿A-Za-z]+)提升(-?[\d.]+)(%|点)?/;
  for (const m of page.modules || []) {
    for (const comp of m.components || []) {
      const data = parseComponentData(comp);
      for (const it of data?.list || []) {
        if (it.tab_name !== '核心技') continue;
        for (const ch of it.children || []) {
          for (const g of ch.growth || []) {
            if (!/^[A-F]$/.test(g.name)) continue;
            const html = g.children?.[0]?.row?.[0]?.[0] || '';
            const txt = stripHtml(html);
            const entry = {};
            const mm = txt.match(reAlpha);
            if (mm) {
              const key = coreStatAlias[mm[1]];
              if (key) {
                let v = parseFloat(mm[2]);
                if (mm[3] === '%') v /= 100;
                entry[key] = Math.round(v * 1e6) / 1e6; // 消除百分比浮点误差
              }
            }
            boost.push(Object.keys(entry).length ? entry : null); // 该档无基础提升存 null 占位，保持档位顺序
            const dn = String(html).match(/data-name="([^"]*)"/);
            if (dn) passiveMax = decodeHtmlEntities(dn[1]);
          }
        }
      }
    }
  }
  return { boost: boost.length ? boost : null, passiveMax };
}

/** 外观图：tab 列表里带 image 且无 children 的条目（角色/音擎共用） */
function fetchAppearance(page) {
  const appearanceData = findModule(
    page,
    (d) => Array.isArray(d.list) && d.list.some((it) => it.image && it.tab_name && !it.children)
  );
  return appearanceData ? appearanceData.list.map((it) => ({ name: it.tab_name, image: it.image })) : null;
}

/** 角色立绘大图（tachie_m：modules 组件 data 嵌套 JSON 里的移动端立绘 URL） */
function fetchCharacterTachie(page) {
  for (const m of page.modules || []) {
    for (const comp of m.components || []) {
      if (typeof comp.data !== 'string' || !comp.data.includes('tachie_m')) continue;
      try {
        const d = JSON.parse(comp.data);
        if (typeof d.tachie_m === 'string' && d.tachie_m) return d.tachie_m;
      } catch { /* 非 JSON 模块，跳过 */ }
    }
  }
  return null;
}

/** 角色扩展：介绍/技能/影画/外观图/CV/立绘大图 */
function fetchCharacterExtended(page) {
  const out = {};
  const intro = findModule(page, (d) => typeof d.rich_text === 'string' && d.rich_text.trim().length > 0);
  if (intro) out.description = intro.rich_text;
  const tachie = fetchCharacterTachie(page);
  if (tachie) out.tachie = tachie;
  const cvData = findModule(page, (d) => typeof d.rich_text === 'string' && d.rich_text.includes('中配'));
  if (cvData) out.cv = stripHtml(cvData.rich_text).replace(/\s+/g, ' ');
  const skills = fetchSkills(page);
  if (skills.length) out.skills = skills;
  const core = fetchCoreSkill(page);
  if (core.boost) out.coreSkillBoost = core.boost;
  if (core.passiveMax) out.corePassiveMax = core.passiveMax;
  const cinemaData = findModule(
    page,
    (d) => Array.isArray(d.tables) && d.tables.some((t) => (t.header || []).some((h) => h.includes('影画')))
  );
  if (cinemaData) {
    const t = cinemaData.tables.find((tt) => (tt.header || []).some((h) => h.includes('影画')));
    out.cinemas = (t?.row || []).map((row) => ({ name: stripHtml(row?.[0] || ''), desc: row?.[1] || '' }));
  }
  const appearance = fetchAppearance(page);
  if (appearance) out.appearance = appearance;
  return out;
}

/** 音擎扩展：外观图/突破材料/推荐代理人/背景故事 */
function fetchWengineExtended(page) {
  const out = {};
  const appearance = fetchAppearance(page);
  if (appearance) out.appearance = appearance;
  out.materials = fetchMaterials(page);
  out.recommend = fetchRecommend(page);
  const lore = findModule(page, (d) => typeof d.rich_text === 'string' && d.rich_text.trim().length > 50);
  if (lore) out.lore = lore.rich_text;
  return out;
}

/** 驱动盘扩展：套装故事/推荐角色/副词条推荐/部位主词条 */
function fetchDiscExtended(page) {
  const out = {};
  const loreData = findModule(page, (d) => Array.isArray(d.tables) && (d.tables?.[0]?.row || []).length >= 3);
  if (loreData) {
    out.setLore = loreData.tables
      .flatMap((t) => t.row || [])
      .map((row) => stripHtml(row?.[0] || ''))
      .filter((s) => s);
  }
  out.recommend = fetchRecommend(page);
  const advice = findModule(page, (d) => typeof d.rich_text === 'string' && d.rich_text.includes('副词条'));
  if (advice) out.substatAdvice = stripHtml(advice.rich_text).replace(/\s+/g, ' ');
  const slots = findModule(page, (d) => Array.isArray(d.disks_name));
  if (slots) {
    out.slotMainStats = (slots.disks_name || []).map((n, i) => ({
      name: n,
      advice: stripHtml(slots.disks_desc?.[i] || ''),
      icon: slots.disks_icon?.[i] || '',
    }));
  }
  return out;
}

/** 邦布：技能（分类型）/初始与满级属性/突破材料/推荐配队 + 属性（wiki 无结构化字段，从技能描述提取）。
 *  注意：wiki 邦布页无阵营字段（菜单筛选仅稀有度），阵营不做强行补全。 */
export function fetchBangboo(page) {
  const out = {};
  // 技能内容在 children 里（title + 富文本 desc），按 tab_name 分类（主动技/被动技/连携技）
  const skills = fetchSkills(page, { requireChildren: true });
  if (skills.length) out.skills = skills;
  out.baseStats = fetchBangbooBaseStats(page);
  out.materials = fetchMaterials(page);
  out.recommend = fetchRecommend(page);
  const element = fetchBangbooElement(skills);
  if (element) out.element = element;
  return out;
}

/** 邦布初始/满级基础属性（role_ascension 组件的 tab 列表）。
 *  页面用词不一（初始等级/初始数据、满级属性/满级数据），部分键带前导空格、幽浮布把「生命值」写「生命指」——统一 trim + normalizeStatKeys */
function fetchBangbooBaseStats(page) {
  const out = {};
  const comp = findModule(page, (d) => Array.isArray(d?.list) && d.list.some((t) => Array.isArray(t.attr)));
  if (!comp) return out;
  for (const tab of comp.list) {
    const tabName = String(tab.tab_name || '');
    if (!tabName.includes('初始') && !tabName.includes('满级')) continue;
    const stats = {};
    for (const a of tab.attr || []) {
      const key = String(a.key || '').trim();
      if (!key) continue;
      const v = parseNum(stripHtml(a.value));
      if (Number.isFinite(v)) stats[key] = v;
    }
    if (!Object.keys(stats).length) continue;
    const normalized = normalizeStatKeys(stats);
    if (tabName.includes('初始')) out.initial = normalized;
    else out.maxLevel = normalized;
  }
  return out;
}

/** 邦布元素：取主动/连携技描述里首个「造成X伤害」命中（雷归一到电）；被动技的「[X属性]角色」是配队条件、非自身属性，不取 */
function fetchBangbooElement(skills) {
  const texts = [];
  for (const s of skills || []) {
    if (String(s.type || '').includes('被动')) continue;
    for (const it of s.items || []) texts.push(stripHtml(it.desc));
  }
  const m = texts.join(' ').match(/(以太|物理|火|冰|雷|电)(?:属性)?伤害/);
  return m ? (m[1] === '雷' ? '电' : m[1]) : '';
}

// ---------------- 主流程 ----------------

/** 抓取并组装属性库写入 data/library.json；onProgress 上报进度 {step, done, total}，strict 时校验异常抛错（STRICT=1） */
export async function fetchLibrary(onProgress, { strict = false } = {}) {
  console.log('① 获取内容列表…');
  const list = await fetchContentList();

  console.log('② 抓取角色详情…');
  const characters = await pool(
    list.characters.map((x) => x),
    6,
    async (x) => {
      const page = await fetchDetail(x.id);
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
        ...fetchCharacterExtended(page),
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
      return {
        name: stripHtml(page.name || x.key),
        key: x.key,
        id: x.id,
        icon: page.icon_url,
        tags: parseTagList(parseFe(page), 'c_45').reduce((o, s) => {
          const [k, v] = s.split('/');
          o[TAG_KEY_MAP[k] || k] = v;
          return o;
        }, {}),
        stats: fetchWengineStats(page),
        ...fetchWengineExtended(page),
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
      return {
        name: stripHtml(page.name || x.key),
        key: x.key,
        id: x.id,
        icon: page.icon_url,
        roundIcon: fetchDiscRound(page),
        setEffects: fetchDiscSet(page),
        ...fetchDiscExtended(page),
      };
    },
    (done, total) => onProgress?.({ step: 'discs', done, total })
  );

  console.log('⑤ 抓取邦布详情…');
  const bangboos = await pool(
    list.bangboos.map((x) => x),
    6,
    async (x) => {
      const page = await fetchDetail(x.id);
      // 稀有度取自 fe_ext.c_44（仅稀有度）
      const rarity =
        parseTagList(parseFe(page), 'c_44')
          .find((t) => t.startsWith('稀有度'))
          ?.split('/')[1] || '';
      return {
        name: stripHtml(page.name || x.key),
        key: x.key,
        id: x.id,
        icon: page.icon_url,
        rarity,
        ...fetchBangboo(page),
      };
    },
    (done, total) => onProgress?.({ step: 'bangboos', done, total })
  );

  // ---------------- 组装 ----------------

  const charLib = {};
  for (const r of characters.filter(Boolean)) {
    const { key, tags, baseStats, ...rest } = r;
    charLib[key] = {
      ...rest,
      ...tags,
      ...(baseStats?.initial || {}),
      maxLevel: baseStats?.maxLevel || {},
    };
  }

  const wengineLib = {};
  for (const w of wengines.filter(Boolean)) {
    const { key, tags, stats, ...rest } = w;
    wengineLib[key] = {
      ...rest,
      ...tags,
      ...(stats || {}),
    };
  }

  const discLib = {};
  for (const s of discs.filter(Boolean)) {
    const { key, setEffects, ...rest } = s;
    discLib[key] = {
      ...rest,
      ...setEffects,
    };
  }

  const bangbooLib = {};
  for (const b of bangboos.filter(Boolean)) {
    const { key, baseStats, ...rest } = b;
    bangbooLib[key] = {
      ...rest,
      ...(baseStats?.initial || {}),
      maxLevel: baseStats?.maxLevel || {},
    };
  }

  const library = { characters: charLib, wengines: wengineLib, discs: discLib, bangboos: bangbooLib };
  const stats = {
    characters: Object.keys(charLib).length,
    wengines: Object.keys(wengineLib).length,
    discs: Object.keys(discLib).length,
    bangboos: Object.keys(bangbooLib).length,
  };

  // library.json 用紧凑格式：技能 growth 嵌套 5 层，pretty 会膨胀到 ~11MB，紧凑仅 ~3.5MB
  writeDataFile('library.json', library, { label: '属性库', validate: validateLibrary, strict, pretty: false });

  // 图片本地化：同步下载 library 图片到 data/img/
  await localizeDataFiles();

  return { library, stats };
}

async function main() {
  const { stats } = await fetchLibrary(null, { strict: !!process.env.STRICT });
  console.log('\n完成！');
  console.log(
    `  角色 ${stats.characters} 个，音擎 ${stats.wengines} 个，驱动盘 ${stats.discs} 个，邦布 ${stats.bangboos} 个`
  );
  console.log('  data/library.json 已生成（含介绍/技能/影画/推荐等扩展字段）');
}

// ESM 入口判断：仅当直接运行本文件时执行 main()
isMain(import.meta, () => main());
