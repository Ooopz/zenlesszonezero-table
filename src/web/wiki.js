// src/web/wiki.js —— Wiki 数据库视图：四个子面板（角色 / 驱动盘 / 音擎 / 邦布）平铺展示
import { library } from './data.js';
import { renderRichText, escapeHtml, escapeJsAttr, statEntries, formatValue, isEmptyVal } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { maxLevelStats, panelOrder } from '../lib/calc.js';
import { STAT, SUBSTAT } from '../lib/constants.js';
import { richItemHtml, skillIcon, registerZZZ } from './shared.js';

export let wikiTab = 'characters';
export function setWikiTab(key) {
  wikiTab = key;
  wikiSort.reset(); // 切换子面板时清空排序
}

// ---------- 表头排序（asc → desc → 恢复默认 三态，统一走 src/lib/sort.js） ----------
const wikiSort = createSort();
/** 点击表头切换排序：同列 asc→desc→无；新列从升序开始 */
export function toggleWikiSort(key) {
  wikiSort.toggle(key);
}
const RARITY_RANK = { S: 3, A: 2, B: 1 };
/** 对实体列表应用当前排序（无排序时原样返回；无值行始终排最后，不受升降序影响） */
function sortRows(entities, val) {
  return wikiSort.apply(entities, val);
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
  ...panelOrder.filter((s) => !maxLevelStats.includes(s) && s !== STAT.PEN_VALUE && s !== STAT.PIERCE),
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
  return isEmptyVal(v) ? '' : v;
}
/** 单元格：merge 提供按列名取值的覆盖（如穿透率列合并显示命破角色的贯穿力） */
function statCells(obj, keys, merge) {
  return keys.map((k) => `<td>${fmt(merge?.[k] ? merge[k](obj) : obj?.[k])}</td>`).join('');
}
/** 穿透率列取值：普通角色取穿透率，命破角色（无穿透率）取贯穿力——展示层合并 */
const penCell = (o) => o[STAT.PEN_RATE] ?? o[STAT.PIERCE];
/** 核心技满级提升说明（悬浮在核心技图标上，取自 coreSkillBoost；X% 键为攻击/生命等百分比提升）。
 *  coreSkillBoost 为每档增量数组，满级提升 = 全部档位累计。 */
function coreBoostHtml(c) {
  const labels = {
    [STAT.ATK]: '基础攻击力',
    [STAT.HP]: '基础生命值',
    [STAT.DEF]: '基础防御力',
    [STAT.IMPACT]: '基础冲击力',
    [STAT.ENERGY]: '基础能量自动回复',
    [SUBSTAT.ATK_PCT]: STAT.ATK,
    [SUBSTAT.HP_PCT]: STAT.HP,
    [SUBSTAT.DEF_PCT]: STAT.DEF,
    [`${STAT.IMPACT}%`]: STAT.IMPACT,
    [STAT.CR]: STAT.CR,
    [STAT.CD]: STAT.CD,
    [STAT.PEN_RATE]: STAT.PEN_RATE,
    [STAT.ANOMALY_CTRL]: STAT.ANOMALY_CTRL,
    [STAT.ANOMALY_PROF]: STAT.ANOMALY_PROF,
  };
  const boost = {};
  for (const item of c.coreSkillBoost || []) {
    if (!item) continue; // 该档无基础提升（null 占位）
    for (const [k, v] of Object.entries(item)) boost[k] = (boost[k] || 0) + v;
  }
  const parts = Object.entries(boost).map(([k, v]) => `${labels[k] || k}+${formatValue(k, v)}`);
  return parts.length ? `<div style="color:var(--green)">核心技满级提升：${parts.join('、')}</div>` : '';
}

/** 技能 items → HTML（角色/邦布共用）：name + 富文本 desc（条目结构走 shared.richItemHtml）；
 *  wrap 时每条包一层，否则按 sep 连接 */
function skillItemsHtml(s, { wrap = false, sep = '<div class="tip-hr"></div>' } = {}) {
  return s && s.items?.length
    ? s.items
        .map((it) => {
          const html = richItemHtml(it.name, it.desc);
          return wrap ? `<div class="wiki-list">${html}</div>` : html;
        })
        .join(sep)
    : '';
}

/** 行标签：与列名相同 → 只显数值；以列名结尾 → 去掉该前缀（一段伤害倍率 + 伤害倍率 → 一段）；否则原样 */
function lineLabel(k, groupName) {
  if (k == null) return k;
  if (!groupName) return k;
  if (k === groupName) return '';
  return k.endsWith(groupName) ? k.slice(0, k.length - groupName.length) : k;
}

/** 技能条目每级数值表格：等级为行、详细数据分组（伤害倍率/失衡倍率/基础提升/核心被动…）为列。
 *  分组取所有等级出现过的并集（列数不定，靠弹窗滚动）；格内每行「段次 数值」（列名已在上方，行标签去重）、
 *  纯说明只显示原文、rich（核心技被动详情）按富文本渲染并换行；
 *  某列各等级数值完全相同时加「（固定）」标注（如固定倍率的被动攻击），避免误以为是抓取缺失。 */
function skillGrowthTable(item) {
  const growth = item.growth || [];
  if (!growth.length) return '';
  const groups = [];
  for (const lvl of growth) for (const g of lvl.groups) if (!groups.includes(g.name)) groups.push(g.name);
  const isFixed = (gname) => {
    if (growth.length <= 1) return false;
    const vals = growth.map((l) => {
      const g = l.groups.find((x) => x.name === gname);
      // 缺失该列的等级用空串占位（present 的组 JSON.stringify 永不为空串，不会误判）
      return g ? JSON.stringify(g.lines || g.text || g.rich || '') : '';
    });
    return new Set(vals).size === 1;
  };
  const head =
    `<th>等级</th>` +
    groups
      .map((h) => `<th>${escapeHtml(h)}${isFixed(h) ? '<span class="sd-fixed">（固定）</span>' : ''}</th>`)
      .join('');
  const rows = growth
    .map((lvl) => {
      const cells = groups
        .map((gname) => {
          const g = lvl.groups.find((x) => x.name === gname);
          if (!g) return '<td></td>';
          if (g.rich) return `<td class="sd-rich">${renderRichText(g.rich)}</td>`;
          const lines = g.lines
            ? g.lines
                .map((l) => {
                  if (l.k == null) return escapeHtml(l.v);
                  const label = lineLabel(l.k, gname);
                  return label ? `${escapeHtml(label)} ${escapeHtml(l.v)}` : escapeHtml(l.v);
                })
                .join('<br>')
            : escapeHtml(g.text || '');
          return `<td>${lines}</td>`;
        })
        .join('');
      return `<tr><td class="slv">${escapeHtml(lvl.level)}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="skill-growth"><table class="skill-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** 打开技能每级数值弹窗：列出该技能类型下所有条目（名称 + 说明 + 每级数值表格）。 */
export function openSkillDetail(charKey, type) {
  const c = library.characters?.[charKey];
  const s = (c?.skills || []).find((x) => x.type === type);
  const title = `${c?.name || charKey} · ${type}`;
  const body = s?.items?.length
    ? s.items
        .map(
          (it) =>
            `<div class="skill-detail-item"><b>${escapeHtml(it.name)}</b>${it.desc ? `<div class="sd-desc">${renderRichText(it.desc)}</div>` : ''}${skillGrowthTable(it)}</div>`
        )
        .join('<div class="tip-hr"></div>')
    : `<p style="color:var(--dim)">暂无技能数据</p>`;
  const modal = document.getElementById('skillModal');
  document.getElementById('skillTitle').textContent = title;
  document.getElementById('skillBody').innerHTML = body;
  modal.classList.add('show');
}
// 内联 onclick 引用的函数需挂到全局
registerZZZ({ skill: openSkillDetail });
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
    if (key === STAT.PEN_RATE) return penCell(c); // 展示层合并：命破角色取贯穿力
    return c[key] ?? null;
  };
  const rows = sortRows(Object.entries(library.characters), ([, c], key) => charVal(c, key)).map(([charKey, c]) => {
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
    // 技能：一列横排 6 个图标（复用卡片视图技能图标，图标路径走 shared.skillIcon），悬浮看详情、点击看每级数值
    const skillDefs = [
      { key: 'normal', label: '普攻' },
      { key: 'dodge', label: '闪避' },
      { key: 'support', label: '支援' },
      { key: 'special', label: '特殊' },
      { key: 'ultimate', label: '终结' },
      { key: 'core', label: '核心' },
    ];
    const skillsHtml = skillDefs
      .map(({ key, label }) => {
        const skill = byType[key];
        // 核心被动满级描述替换初始档说明：wiki 标注「此处数据为初始数据」仅指 A 档，满级取末档内嵌详情
        let tip;
        if (key === 'core' && c.corePassiveMax) {
          const name = skill?.items?.[0]?.name || '核心技';
          tip = `<b>${escapeHtml(name)}</b><br>${renderRichText(c.corePassiveMax)}`;
        } else {
          tip = skillItemsHtml(skill) || `<b>${label}</b>（无数据）`;
        }
        if (key === 'core') {
          const boost = coreBoostHtml(c);
          if (boost) tip += `<div class="tip-hr"></div>${boost}`;
        }
        // 仅该技能类型含每级数值数据（growth）时才可点击打开弹窗（核心技 A-F 档也算）
        const clickable = skill?.items?.some((it) => it.growth);
        return `<span class="wiki-icon${clickable ? ' has-skill' : ''}"${clickable ? ` onclick="ZZZ.skill('${escapeJsAttr(charKey)}','${escapeJsAttr(skill.type)}')" title="点击查看每级数值"` : ''} data-detail="${escapeHtml(tip)}"><img class="s-ico" src="${skillIcon(key)}" alt="${label}"><span class="s-lbl">${label}</span></span>`;
      })
      .join('');
    // 影画：一列横排 6 个圆点徽标，悬浮看详情
    const cinemas = c.cinemas || [];
    const cinemasHtml = [0, 1, 2, 3, 4, 5]
      .map((i) => {
        const m = cinemas[i];
        const tip = m ? richItemHtml(m.name, m.desc) : `<b>影画 ${i + 1}</b>`;
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
  const rows = sortRows(Object.values(library.discs), (d, key) => (key === '名称' ? d.name : (d[key] ?? null))).map(
    (d) => {
      return `<tr>
      <td class="wiki-tight">${d.icon ? `<img class="wiki-ico" src="${d.icon}" alt="">` : ''}</td>
      <td class="wiki-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</td>
      <td class="wiki-sub">${d.set2Text ? renderRichText(d.set2Text) : ''}</td>
      <td class="wiki-long">${d.set4Text ? renderRichText(d.set4Text) : ''}</td>
    </tr>`;
    }
  );
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
