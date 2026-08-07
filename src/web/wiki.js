// src/web/wiki.js —— Wiki 数据库视图：四个子面板（角色 / 驱动盘 / 音擎 / 邦布）平铺展示
import { library } from './data.js';
import { renderRichText, escapeHtml, statEntries, formatValue, compareValues } from '../lib/util.js';
import { maxLevelStats, panelOrder } from '../lib/calc.js';

export let wikiTab = 'characters';
export function setWikiTab(key) {
  wikiTab = key;
  wikiSort = { key: null, dir: 1 }; // 切换子面板时清空排序
}

// ---------- 表头排序（asc → desc → 恢复默认 三态） ----------
let wikiSort = { key: null, dir: 1 };
/** 点击表头切换排序：同列 asc→desc→无；新列从升序开始 */
export function toggleWikiSort(key) {
  if (wikiSort.key === key) {
    if (wikiSort.dir === 1) wikiSort.dir = -1;
    else wikiSort = { key: null, dir: 1 };
  } else {
    wikiSort = { key, dir: 1 };
  }
}
const RARITY_RANK = { S: 3, A: 2, B: 1 };
/** 无值判定：null / undefined / 空字符串（空字符串也不参与正常排序） */
const isEmptyVal = (v) => v == null || v === '';
/** 对实体列表应用当前排序（无排序时原样返回；无值行始终排最后，不受升降序影响） */
function sortRows(entities, val) {
  if (!wikiSort.key) return entities;
  const dir = wikiSort.dir;
  return [...entities].sort((a, b) => {
    const va = val(a, wikiSort.key),
      vb = val(b, wikiSort.key);
    if (isEmptyVal(va) && isEmptyVal(vb)) return 0;
    if (isEmptyVal(va)) return 1;
    if (isEmptyVal(vb)) return -1;
    return compareValues(va, vb) * dir;
  });
}

const TABS = [
  { key: 'characters', label: '角色' },
  { key: 'wengines', label: '音擎' },
  { key: 'discs', label: '驱动盘' },
  { key: 'bangboos', label: '邦布' },
];
/** 子面板 key → 渲染函数（renderWiki 键控分发，避免嵌套三元） */
const PANEL_RENDERERS = {
  characters: renderCharacters,
  wengines: renderWengines,
  discs: renderDiscs,
  bangboos: renderBangboos,
};

// 初始属性展示列：满级三属优先，其余从 calc.panelOrder 派生（排除穿透值/贯穿力——贯穿力在展示层合并到穿透率列）
const INITIAL_STATS = [
  ...maxLevelStats,
  ...panelOrder.filter((s) => !maxLevelStats.includes(s) && s !== '穿透值' && s !== '贯穿力'),
];
const MAX_STATS = maxLevelStats;
// 各子面板可点击排序的表头
const CHAR_SORTABLE = new Set([
  '名称',
  '稀有度',
  '属性',
  '特性',
  '阵营',
  ...INITIAL_STATS,
  ...MAX_STATS.map((s) => `满级${s}`),
]);
const WENGINE_SORTABLE = new Set(['名称', '稀有度', '特性', '基础攻击']);
const DISC_SORTABLE = new Set(['名称']);
const BANG_SORTABLE = new Set(['名称', '稀有度']);

function fmt(v) {
  return v == null || v === '' ? '' : v;
}
/** 单元格：merge 提供按列名取值的覆盖（如穿透率列合并显示命破角色的贯穿力） */
function statCells(obj, keys, merge) {
  return keys.map((k) => `<td>${fmt(merge?.[k] ? merge[k](obj) : obj?.[k])}</td>`).join('');
}
/** 穿透率列取值：普通角色取穿透率，命破角色（无穿透率）取贯穿力——展示层合并 */
const penCell = (o) => o.穿透率 ?? o.贯穿力;
/** 核心技满级提升说明（悬浮在核心技图标上，取自 coreSkillBoost；X% 键为攻击/生命等百分比提升）。
 *  coreSkillBoost 为每档增量数组，满级提升 = 全部档位累计。 */
function coreBoostHtml(c) {
  const labels = {
    攻击力: '基础攻击力',
    生命值: '基础生命值',
    防御力: '基础防御力',
    冲击力: '基础冲击力',
    能量自动回复: '基础能量自动回复',
    '攻击力%': '攻击力',
    '生命值%': '生命值',
    '防御力%': '防御力',
    '冲击力%': '冲击力',
    暴击率: '暴击率',
    暴击伤害: '暴击伤害',
    穿透率: '穿透率',
    异常掌控: '异常掌控',
    异常精通: '异常精通',
  };
  const boost = {};
  for (const item of c.coreSkillBoost || []) {
    if (!item) continue; // 该档无基础提升（null 占位）
    for (const [k, v] of Object.entries(item)) boost[k] = (boost[k] || 0) + v;
  }
  const parts = Object.entries(boost).map(([k, v]) => `${labels[k] || k}+${formatValue(k, v)}`);
  return parts.length ? `<div style="color:var(--green)">核心技满级提升：${parts.join('、')}</div>` : '';
}

/** 技能 items → HTML（角色/邦布共用）：name + 富文本 desc；wrap 时每条包一层，否则按 sep 连接 */
function skillItemsHtml(s, { wrap = false, sep = '<div class="tip-hr"></div>' } = {}) {
  return s && s.items?.length
    ? s.items
        .map((it) => {
          const html = `<b>${escapeHtml(it.name)}</b>${it.desc ? `<br>${renderRichText(it.desc)}` : ''}`;
          return wrap ? `<div class="wiki-list">${html}</div>` : html;
        })
        .join(sep)
    : '';
}
/** 渲染表格；sortable 集合内的列头可点击排序（当前列加 data-sort 与 ▲/▼ 指示） */
function table(headers, rows, sortable = new Set()) {
  const head = headers
    .map((h) => {
      if (!sortable.has(h)) return `<th>${h}</th>`;
      const on = wikiSort.key === h;
      return `<th data-sort="${h}"${on ? ' class="sorted"' : ''}>${h}${on ? (wikiSort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
    .join('');
  return `<div class="wiki-wrap"><table class="wiki-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderCharacters() {
  const headers = [
    '图标',
    '名称',
    '稀有度',
    '属性',
    '特性',
    '阵营',
    '技能',
    '影画',
    ...INITIAL_STATS,
    ...MAX_STATS.map((s) => `满级${s}`),
  ];
  const charVal = (c, key) => {
    if (key === '名称') return c.name;
    if (key === '稀有度') return RARITY_RANK[c.rarity] ?? 0;
    if (key === '属性') return c.element;
    if (key === '特性') return c.trait;
    if (key === '阵营') return c.faction;
    if (key.startsWith('满级')) return c.maxLevel?.[key.slice(2)] ?? null;
    if (key === '穿透率') return penCell(c); // 展示层合并：命破角色取贯穿力
    return c[key] ?? null;
  };
  const rows = sortRows(Object.values(library.characters), charVal).map((c) => {
    // 技能按类型分组：普攻/闪避/支援技/特殊技/终结技/核心技
    const byType = { normal: '', dodge: '', support: '', special: '', ultimate: '', core: '' };
    for (const s of c.skills || []) {
      const t = s.type || '';
      if (t.includes('普攻')) byType.normal = s;
      else if (t.includes('闪避')) byType.dodge = s;
      else if (t.includes('支援')) byType.support = s;
      else if (t.includes('特殊')) byType.special = s;
      else if (t.includes('终结')) byType.ultimate = s;
      else byType.core = s;
    }
    // 技能：一列横排 6 个图标（复用卡片视图技能图标），悬浮看详情
    const skillDefs = [
      { key: 'normal', label: '普攻', icon: '/src/img/normal.png' },
      { key: 'dodge', label: '闪避', icon: '/src/img/dodge.png' },
      { key: 'support', label: '支援', icon: '/src/img/support.png' },
      { key: 'special', label: '特殊', icon: '/src/img/special.png' },
      { key: 'ultimate', label: '终结', icon: '/src/img/ultimate.png' },
      { key: 'core', label: '核心', icon: '/src/img/passive.png' },
    ];
    const skillsHtml = skillDefs
      .map(({ key, label, icon }) => {
        // 核心被动满级描述替换初始档说明：wiki 标注「此处数据为初始数据」仅指 A 档，满级取末档内嵌详情
        let tip;
        if (key === 'core' && c.corePassiveMax) {
          const name = byType[key]?.items?.[0]?.name || '核心技';
          tip = `<b>${escapeHtml(name)}</b><br>${renderRichText(c.corePassiveMax)}`;
        } else {
          tip = skillItemsHtml(byType[key]) || `<b>${label}</b>（无数据）`;
        }
        if (key === 'core') {
          const boost = coreBoostHtml(c);
          if (boost) tip += `<div class="tip-hr"></div>${boost}`;
        }
        return `<span class="wiki-icon" data-detail="${escapeHtml(tip)}"><img class="s-ico" src="${icon}" alt="${label}"><span class="s-lbl">${label}</span></span>`;
      })
      .join('');
    // 影画：一列横排 6 个圆点徽标，悬浮看详情
    const cinemas = c.cinemas || [];
    const cinemasHtml = [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const m = cinemas[i];
        const tip = m
          ? `<b>${escapeHtml(m.name)}</b>${m.desc ? `<br>${renderRichText(m.desc)}` : ''}`
          : `<b>影画 ${i + 1}</b>`;
        return `<span class="wiki-ms-dot" data-detail="${escapeHtml(tip)}">${i + 1}</span>`;
      })
      .join('');
    return `<tr>
      <td class="wiki-tight">${c.icon ? `<img class="wiki-ico" src="${c.icon}" alt="">` : ''}</td>
      <td class="wiki-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
      <td class="wiki-tight">${escapeHtml(c.rarity)}</td>
      <td class="wiki-tight">${escapeHtml(c.element)}</td>
      <td class="wiki-tight">${escapeHtml(c.trait)}</td>
      <td class="wiki-tight">${escapeHtml(c.faction)}</td>
      <td class="wiki-icons">${skillsHtml}</td>
      <td class="wiki-icons">${cinemasHtml}</td>
      ${statCells(c, INITIAL_STATS, { 穿透率: penCell })}
      ${statCells(c.maxLevel, MAX_STATS)}
    </tr>`;
  });
  return table(headers, rows, CHAR_SORTABLE);
}

function renderWengines() {
  const headers = ['图标', '名称', '稀有度', '特性', '基础攻击', '副属性', '特效'];
  const wengineVal = (w, key) => {
    if (key === '名称') return w.name;
    if (key === '稀有度') return RARITY_RANK[w.rarity] ?? 0;
    if (key === '特性') return w.trait;
    if (key === '基础攻击') return w.baseAtk;
    return w[key] ?? null;
  };
  const rows = sortRows(Object.values(library.wengines), wengineVal).map((w) => {
    const sub = statEntries(w.subStats)
      .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
      .join('、');
    return `<tr>
      <td class="wiki-tight">${w.icon ? `<img class="wiki-ico" src="${w.icon}" alt="">` : ''}</td>
      <td class="wiki-name wiki-tight" title="${escapeHtml(w.name)}">${escapeHtml(w.name)}</td>
      <td class="wiki-tight">${escapeHtml(w.rarity)}</td>
      <td class="wiki-tight">${escapeHtml(w.trait)}</td>
      <td class="wiki-tight">${fmt(w.baseAtk)}</td>
      <td class="wiki-sub">${sub}</td>
      <td class="wiki-long">${w.specialEffect ? renderRichText(w.specialEffect) : ''}</td>
    </tr>`;
  });
  return table(headers, rows, WENGINE_SORTABLE);
}

function renderDiscs() {
  const headers = ['图标', '名称', '二件套', '四件套'];
  const rows = sortRows(Object.values(library.discs), (d, key) => (key === '名称' ? d.name : d[key] ?? null)).map(
    (d) => {
    return `<tr>
      <td class="wiki-tight">${d.icon ? `<img class="wiki-ico" src="${d.icon}" alt="">` : ''}</td>
      <td class="wiki-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</td>
      <td class="wiki-sub">${d.set2Text ? renderRichText(d.set2Text) : ''}</td>
      <td class="wiki-long">${d.set4Text ? renderRichText(d.set4Text) : ''}</td>
    </tr>`;
  });
  return table(headers, rows, DISC_SORTABLE);
}

function renderBangboos() {
  const headers = ['图标', '名称', '稀有度', '主动技', '连携技', '被动技'];
  const bangVal = (b, key) => {
    if (key === '名称') return b.name;
    if (key === '稀有度') return RARITY_RANK[b.rarity] ?? 0;
    return b[key] ?? null;
  };
  const rows = sortRows(Object.values(library.bangboos), bangVal).map((b) => {
    // 技能按类型分为 主动/连携/被动 三列
    const byType = {};
    for (const s of b.skills || []) {
      const t = s.type || '';
      if (t.includes('主动')) byType.active = s;
      else if (t.includes('连携')) byType.chain = s;
      else byType.passive = s;
    }
    const itemCell = (s) => skillItemsHtml(s, { wrap: true, sep: '' });
    return `<tr>
      <td class="wiki-tight">${b.icon ? `<img class="wiki-ico" src="${b.icon}" alt="">` : ''}</td>
      <td class="wiki-name" title="${escapeHtml(b.name)}">${escapeHtml(b.name)}</td>
      <td class="wiki-tight">${escapeHtml(b.rarity)}</td>
      <td class="wiki-long">${itemCell(byType.active)}</td>
      <td class="wiki-long">${itemCell(byType.chain)}</td>
      <td class="wiki-long">${itemCell(byType.passive)}</td>
    </tr>`;
  });
  return table(headers, rows, BANG_SORTABLE);
}

/** 渲染整个 wiki 视图（tab + 当前子面板表格） */
export function renderWiki() {
  const tabs = TABS.map(
    (t) =>
      `<button class="wiki-tab ${t.key === wikiTab ? 'on' : ''}" data-tab="${t.key}" onclick="ZZZ.wikiTab('${t.key}')">${t.label}</button>`
  ).join('');
  const body = PANEL_RENDERERS[wikiTab] ? PANEL_RENDERERS[wikiTab]() : '';
  return `<div class="wiki"><div class="wiki-tabs">${tabs}</div>${body}</div>`;
}
