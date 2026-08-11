// src/web/render.js —— 渲染层：悬浮提示、卡片/表格视图、拖拽排序、渲染调度
import {
  grid,
  myCharacters,
  userConfig,
  elementColors,
  library,
  discIndex,
  lookup,
  statEntries,
  readNote,
  readValidStats,
  readCharTarget,
  readColOrder,
  readRowOrder,
  saveRowOrder,
  saveColOrder,
} from './data.js';
import {
  progressCell,
  rateColor,
  rateClass,
  panelOrder,
  panelStatMap,
  isDamageBonus,
  targetStats,
  targetPercents,
  targetGap,
} from '../lib/calc.js';
import { escapeHtml, escapeJsAttr, formatValue, renderRichText } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { STAT, VIEWS } from '../lib/constants.js';
import { discSetEffectsHtml, richItemHtml, skillIconForType } from './shared.js';
import { renderWiki, toggleWikiSort } from './wiki.js';
import { renderDiscStats, toggleDiscStatsSort } from './discstats.js';

// ---------- 悬浮提示 ----------
const tipEl = document.createElement('div');
tipEl.className = 'tip';
document.body.appendChild(tipEl);
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest ? e.target.closest('[data-detail]') : null;
  if (t) {
    tipEl.innerHTML = t.dataset.detail;
    tipEl.style.display = 'block';
  }
});
document.addEventListener('mousemove', (e) => {
  if (tipEl.style.display === 'none') return;
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 14,
    y = e.clientY + 14;
  if (x + r.width > innerWidth) x = e.clientX - r.width - 12;
  if (y + r.height > innerHeight) y = e.clientY - r.height - 12;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
});
document.addEventListener('mouseout', (e) => {
  const from = e.target.closest ? e.target.closest('[data-detail]') : null;
  const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-detail]') : null;
  if (from && from !== to) tipEl.style.display = 'none';
});

// ---------- 渲染辅助 ----------
/** 音擎展示信息（名称/精炼/图标/基础攻击/副属性/特效），卡片与表格共用 */
function wengineInfo(character, R) {
  const wengine = character.wengine || {};
  const libWengine = R.libWengine;
  return {
    wengine,
    libWengine,
    icon: wengine.icon || libWengine?.icon || '',
    baseAtk: statEntries(wengine.mainStats).find((t) => t.name === '基础攻击力')?.value ?? libWengine?.baseAtk ?? null,
    subStats: statEntries(wengine.subStats).length ? statEntries(wengine.subStats) : statEntries(libWengine?.subStats),
    specialEffect: (wengine.specialEffect || libWengine?.specialEffect || '').replace(/<[^>]*>/g, ''),
  };
}
/** 单个驱动盘的悬浮详情：只显示 2/4 件套效果 */
function discTooltip(disc) {
  const discLib = lookup(library.discs, discIndex, disc.set);
  return `<b>${disc.set}</b>` + discSetEffectsHtml(discLib);
}

/** 驱动盘详情数据（卡片盘面 / 表格悬浮共用）：库引用、主词条、副词条行、命中数、套装效果 */
function discDetail(d, validSet) {
  const discLib = lookup(library.discs, discIndex, d.set);
  const main =
    statEntries(d.mainStats)
      .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
      .join('　') || '—';
  const subs = (d.growth || []).map((g) => {
    const rolls = 1 + g.growthCount;
    return {
      content: `${g.name} ${formatValue(g.name, g.value)}<span class="rolls">${'>'.repeat(rolls)}</span>`,
      hit: validSet.has(g.type),
    };
  });
  return { discLib, main, subs, discHits: d.getHitCount(validSet), setEffects: discSetEffectsHtml(discLib) };
}

/** 驱动盘悬浮详情（完整版，供表格图标用）：命中 + 主词条 + 副词条(> + 高亮) + 2/4件套 */
function discTooltipFull(d, validSet) {
  const { main, subs, discHits, setEffects } = discDetail(d, validSet);
  const sub = subs.map((s) => (s.hit ? `<span class="hit">${s.content}</span>` : s.content)).join('<br>');
  return (
    `<b>${d.set}</b>　槽位${d.slot}${d.level ? ` +${d.level}` : ''}` +
    (discHits != null ? `<br><span style="color:var(--acc)">副词条命中：${discHits}</span>` : '') +
    `<br><span style="color:var(--dim)">主词条</span> ${main}` +
    (sub ? `<br><span style="color:var(--dim)">副词条</span><br>${sub}` : '') +
    setEffects
  );
}

/** 单个驱动盘盘面：左上图标 + 套装名/槽位 + 右上命中 + 主词条 + 纵向副词条(> 表示有效词条数) */
function discTile(d, validSet) {
  const { discLib, main, subs, discHits } = discDetail(d, validSet);
  const icon = d.icon || discLib?.icon || '';
  const sub = subs.map((s) => `<div class="${s.hit ? 'hit' : ''}">${s.content}</div>`).join('');
  return `<div class="disc" data-detail="${escapeHtml(discTooltip(d))}" title="悬浮查看详情">
    <div class="disc-top">${icon ? `<img class="d-ico" src="${icon}" alt="">` : ''}<div class="disc-head"><div class="dset">${d.set}</div><div class="dslot">${d.slot}号${d.level ? ' · +' + d.level : ''}</div></div>${discHits != null ? `<span class="d-hit">命中 ${discHits}</span>` : ''}</div>
    <div class="dmain">${main}</div>
    ${sub ? `<div class="dsubs">${sub}</div>` : ''}
  </div>`;
}

/** 三行两列盘序：第一列 1/2/3 号、第二列 4/5/6 号 */
const discOrder = [0, 3, 1, 4, 2, 5];

/** 目标副词条缺口悬浮提示（卡片/表格「副词条命中」共用）。
 *  未配置目标时返回空串（不加悬浮）；已全部达成时提示无需额外副词条。 */
function gapAdviceHtml(character, R) {
  const g = targetGap(character, R);
  if (!g) return '';
  if (!g.items.length) return `<b>${escapeHtml(character.name)}</b><br>目标属性已全部达成，无需额外副词条`;
  const rows = g.items
    .map((it) => {
      const label = it.type || it.name;
      let count;
      if (it.count != null) {
        count = `约 ${it.count} 个`;
        // 攻击/生命/防御有固定值词条形态，作为备选提示（与百分比词条数量不同时才展示）
        if (it.countFlat != null && it.countFlat !== it.count) count += `（固定值约 ${it.countFlat} 个）`;
      } else {
        count = '副词条不可达成';
      }
      return `<span style="color:var(--acc)">${label}</span> ${count}<br><span style="color:var(--dim)">${formatValue(it.name, it.current)} → ${formatValue(it.name, it.target)}</span>`;
    })
    .join('<br>');
  return `<b>${escapeHtml(character.name)}</b><br>还差 <b>${g.total}</b> 个副词条达成目标<br>${rows}`;
}

// ---------- 卡片视图 ----------
function characterCard(character) {
  const R = character.calculate();
  const libCharacter = R.libCharacter;
  // 卡片左上角头像：优先立绘大图（wiki tachie），其次小图标/立绘
  const tachie = character.tachie || libCharacter.tachie || '';
  const portrait = tachie || character.icon || libCharacter.icon || character.portrait || libCharacter.portrait || '';
  const rarity = character.rarity || libCharacter.rarity || '';
  const element = libCharacter.element || '';
  const trait = libCharacter.trait || '';
  const faction = character.faction || libCharacter.faction || '';
  const color = elementColors[element] || '#ccc';
  const {
    wengine,
    icon: wengineIcon,
    baseAtk: wengineBaseAtk,
    subStats: wengineSubStats,
    specialEffect: wengineEffect,
  } = wengineInfo(character, R);
  const charValidSet = new Set(readValidStats(character.name));

  // 合并「最终面板 + 达成率」为表格式区块
  const mergedRows = [];
  const displayed = new Set();
  let rateSum = 0,
    rateCount = 0;
  const isHighlighted = (name) => charValidSet.size > 0 && (panelStatMap[name] || []).some((t) => charValidSet.has(t));
  const addRow = (name, displayFinal, displayBase, displayBonus, highlighted) => {
    const prog = character.statProgress(R, name);
    if (prog) {
      rateSum += prog.rate;
      rateCount++;
    }
    // 灰字 = 理论面板（满级基础 + 核心技当前等级 + 音擎 + 驱动盘词条推算），
    // 与主值（账号实际面板）并列，用于对比定位计算问题；无理论值（如伤害加成）则留空。
    // 有账号实际值且与理论不一致时标红（攻击/生命/防御理论已按游戏规则取整）
    const theoFinal = R.theoretical?.final?.[name];
    const actFinal = R.actual?.[name]?.final;
    const mismatch = actFinal != null && theoFinal != null && Math.abs(actFinal - theoFinal) > 1e-6;
    const split = theoFinal != null ? `理论${formatValue(name, theoFinal)}` : '';
    // 面板数值金色突出由「配置的有效副词条」决定：有效副词条 → 对应面板属性（如配了攻击力% 则攻击力金色）
    const core = highlighted ? '1' : '';
    mergedRows.push(
      `<tr class="${highlighted ? 'hl' : ''}"><td class="cs-name"${mismatch ? ` style="color:var(--red)"` : ''}>${name}</td><td class="cs-val" data-core="${core}"${mismatch ? ` style="color:var(--red)"` : ''}>${formatValue(name, displayFinal)}${split ? `<span class="break">(${split})</span>` : ''}</td><td class="cs-rate">${prog ? progressCell(prog.rate) : ''}</td></tr>`
    );
    displayed.add(name);
  };
  for (const s of panelOrder) {
    const base = R.base[s],
      fin = R.final[s],
      act = R.actual?.[s];
    const displayFinal = act?.final ?? fin;
    if (displayFinal == null && base == null) continue;
    addRow(
      s,
      displayFinal,
      act?.base ?? base,
      act?.bonus ?? (displayFinal != null && base != null ? displayFinal - base : null),
      isHighlighted(s)
    );
  }
  for (const name of Object.keys(R.final))
    if (isDamageBonus(name) && !displayed.has(name)) addRow(name, R.final[name], null, null, isHighlighted(name));
  for (const name of Object.keys(character.panel || {})) {
    if (displayed.has(name)) continue;
    const v = character.panel[name]?.final;
    if (v == null) continue;
    addRow(name, v, null, null, isHighlighted(name));
  }
  const totalProgress = rateCount ? Math.round((rateSum / rateCount) * 100) : null;

  // 技能等级：类型图标 + 等级，悬浮图标显示完整详情（兼容旧数据：无 skills 时隐藏）。
  // 图标统一走 shared.skillIconForType（账号数字 type → 路径）
  // 技能显示顺序：普攻, 闪避, 特殊技, 支援, 大招, 被动
  const skillOrder = [0, 2, 1, 6, 3, 5];
  const skillsHtml = skillOrder
    .map((type) => {
      const s = (character.skills || []).find((x) => x.type === type);
      if (!s) return '';
      const icon = skillIconForType(type);
      const detail = (s.items || []).map((it) => richItemHtml(it.title, it.text)).join('<div class="tip-hr"></div>');
      return `<span class="skill-cell"><img class="skill-icon" src="${icon}" alt="技能" data-detail="${escapeHtml(detail)}"><b class="slv">Lv.${s.level}</b></span>`;
    })
    .filter(Boolean)
    .join('');

  // 影画：点阵悬浮显示富文本描述（兼容旧数据：无 mindscape 时隐藏）
  const msRanks = character.mindscape?.ranks || [];
  const msUnlocked = msRanks.filter((r) => r.isUnlocked).length;
  const mindscapeHtml = msRanks
    .map((r) => {
      const nm = r.name || `影画${r.pos}`;
      const st = r.isUnlocked ? '已解锁' : '未解锁';
      const tip = `<b>${escapeHtml(nm)}</b>（${st}）${r.desc ? `<br>${renderRichText(r.desc)}` : ''}`;
      return `<span class="ms-dot ${r.isUnlocked ? 'on' : ''}" data-detail="${escapeHtml(tip)}">${r.pos}</span>`;
    })
    .join('');

  // 潜能觉醒（部分角色有）：6 级点阵，悬浮显示觉醒名与各技能强化说明
  const sa = character.skillAwaken;
  const awakenItems = sa?.items || [];
  const awakenHtml =
    sa && sa.hasSystem && awakenItems.length
      ? Array.from({ length: 6 }, (_, i) => {
          const lv = i + 1;
          const it = awakenItems[i];
          const on = lv <= (sa.level ?? 0);
          const tip = it
            ? `<b>${escapeHtml(it.level_show_name || `觉醒 ${lv}`)}</b>${on ? '（已觉醒）' : ''}` +
              (it.awaken_skill_items || [])
                .map((asi) => {
                  const simple = asi.awaken_simple_info ? renderRichText(asi.awaken_simple_info) : '';
                  const detail = (asi.skill_items || [])
                    .map((si) => richItemHtml(si.title, si.text))
                    .join('<div class="tip-hr"></div>');
                  return simple + (simple && detail ? '<br>' : '') + detail;
                })
                .join('<div class="tip-hr"></div>')
            : `<b>觉醒 ${lv}</b>（未解锁）`;
          return `<span class="ms-dot ${on ? 'on' : ''}" data-detail="${escapeHtml(tip)}">${lv}</span>`;
        }).join('')
      : '';

  // 驱动盘：按槽位顺序排列（第一行 1/2/3 号、第二行 4/5/6 号）
  const discs = (character.discs || []).slice(0, 6);
  const hits = character.hitCount();
  const hitTip = gapAdviceHtml(character, R);
  const discsHtml = discs
    .filter(Boolean)
    .map((d) => discTile(d, charValidSet))
    .join('');

  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.rarity = rarity || ''; // 供 CSS 稀有度头像框 / 角标着色
  card.innerHTML = `
    <div class="upper">
      <div class="upper-left${tachie ? ' has-tachie' : ''}">
        <div class="basic">
          ${portrait ? `<img class="portrait${tachie ? ' portrait-lg' : ''}" src="${portrait}" alt="" loading="lazy" title="点击添加备注" onclick="openNote('${escapeJsAttr(character.name)}')" onerror="this.style.display='none'">` : ''}
          <div class="who">
            <div class="name">${character.name || ''}
              <button class="mini" title="设置/编辑该角色的目标属性与有效副词条" onclick="openTargetSettings('${escapeJsAttr(character.name)}')">目标</button>
            </div>
            ${readNote(character.name) ? `<div class="note">${escapeHtml(readNote(character.name))}</div>` : ''}
            <div class="tags">
              ${rarity ? `<span class="tag ${rarity}">${rarity}</span>` : ''}
              ${element ? `<span class="tag e" style="color:${color};border-color:${color}66">● ${element}</span>` : ''}
              ${trait ? `<span class="tag">${trait}</span>` : ''}
              ${faction ? `<span class="tag">${faction}</span>` : ''}
            </div>
          </div>
        </div>
        ${skillsHtml ? `<div class="block"><div class="col-title"><b>技能等级</b></div><div class="skill-grid">${skillsHtml}</div></div>` : ''}
        ${
          mindscapeHtml || awakenHtml
            ? `<div class="block"><div class="col-title"><b>影画 · 潜能觉醒</b></div><div class="ms-row">
              ${mindscapeHtml ? `<div class="ms-col"><span class="ms-label">影画 ${msUnlocked}/${msRanks.length}</span><div class="ms-dots">${mindscapeHtml}</div></div>` : ''}
              ${awakenHtml ? `<div class="ms-col"><span class="ms-label">觉醒 ${sa?.level ?? 0}/${sa?.maxLevel ?? 6}</span><div class="ms-dots">${awakenHtml}</div></div>` : ''}
            </div></div>`
            : ''
        }
        <div class="block">
          <div class="col-title"><b>音擎</b></div>
          <div class="wengine">
            ${wengineIcon ? `<img src="${wengineIcon}" alt="" onerror="this.style.display='none'"${wengineEffect ? ` data-detail="${escapeHtml(wengineEffect)}" title="悬浮查看音擎特效"` : ''}>` : ''}
            <div class="wmain">
              <div class="wname">${wengine.name || '未佩戴'}<span style="color:var(--acc)">${'★'.repeat(wengine.refinement || 0)}</span></div>
              <div class="wmeta">${wengineBaseAtk != null ? `基础攻击 ${formatValue(STAT.ATK, wengineBaseAtk)}` : ''}${wengineSubStats.length ? `　${wengineSubStats.map((t) => `${t.name} ${formatValue(t.name, t.value)}`).join('　')}` : ''}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="upper-right">
        <div class="col-title"><span>最终面板</span>${totalProgress != null ? `<span class="${rateClass(totalProgress / 100)}">总 ${totalProgress}%</span>` : ''}</div>
        <table class="cs"><tr><th>属性</th><th>数值</th><th>达成率</th></tr>${mergedRows.join('')}</table>
      </div>
    </div>
    <div class="lower">
      <div class="col-title"><b>驱动盘</b>${hits != null ? (hitTip ? `<span class="d-hit" data-detail="${escapeHtml(hitTip)}" title="悬浮查看目标副词条缺口">命中 ${hits}</span>` : `<span>命中 ${hits}</span>`) : ''}</div>
      <div class="discs-vert wide">${discsHtml}</div>
    </div>
  `;
  return card;
}

// ---------- 统计表格视图 ----------
// 表头排序状态（asc → desc → 恢复默认 三态，统一走 src/lib/sort.js）
const tableSort = createSort();
function toggleTableSort(col) {
  tableSort.toggle(col);
}
/** 列当前值（达成率与排序共用）：账号实际值优先，否则 wiki 计算值；属性伤害取首项 */
function statCurrent(R, s) {
  let current = R.actual?.[s]?.final ?? R.final[s];
  if (s === '属性伤害加成') {
    for (const k of Object.keys(R.final))
      if (isDamageBonus(k)) {
        current = R.final[k];
        break;
      }
  }
  return current ?? null;
}
function cellStats(R, target, s) {
  const current = statCurrent(R, s);
  if (current == null) return `<td class="tstat">—<div class="tbar tbar-empty"></div></td>`;
  const targetVal = target[s];
  if (targetVal == null || !Number(targetVal))
    return `<td class="tstat"><span class="tv">${formatValue(s, current)}</span><div class="tbar tbar-empty"></div></td>`;
  let targetInternal = Number(targetVal);
  if (targetPercents.has(s)) targetInternal = targetVal / 100;
  const rate = current / targetInternal;
  const width = Math.min(100, rate * 100).toFixed(0);
  return `<td class="tstat"><span class="tv">${formatValue(s, current)}</span><span class="tpct ${rateClass(rate)}">${(rate * 100).toFixed(0)}%</span><div class="tbar"><span class="tfill" style="width:${width}%;background:${rateColor(rate)}"></span></div></td>`;
}

function renderTable(list) {
  const allColumns = ['角色', '音擎', '驱动盘', '副词条命中', ...targetStats];
  // 列序：优先用保存的顺序（过滤掉已不存在的列），新列补到末尾
  let colOrder = (readColOrder() || []).filter((c) => allColumns.includes(c));
  colOrder.push(...allColumns.filter((c) => !colOrder.includes(c)));

  // 行序：优先用保存的（新角色排末尾）
  const savedRowOrder = readRowOrder() || [];
  const rowOrder = savedRowOrder.length
    ? [...list].sort((a, b) => {
        const ia = savedRowOrder.indexOf(a.name),
          ib = savedRowOrder.indexOf(b.name);
        return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
      })
    : list;

  const SORTABLE_COLS = new Set(['角色', '音擎', '副词条命中', ...targetStats]);
  const header = `<tr>${colOrder
    .map((c) => {
      const sortable = SORTABLE_COLS.has(c);
      const on = tableSort.key === c;
      return `<th draggable="true" title="拖动可排序" data-col="${c}"${sortable ? ` data-sort="${c}"${on ? ' class="sorted"' : ''}` : ''}>${c}${on ? (tableSort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;
    })
    .join('')}</tr>`;

  let rowObjs = rowOrder.map((character) => {
    const R = character.calculate();
    const target = readCharTarget(character.name);
    const libCharacter = R.libCharacter;
    const {
      wengine,
      icon: wengineIcon,
      baseAtk: wengineBaseAtk,
      subStats: wengineSubStats,
      specialEffect: wengineEffect,
    } = wengineInfo(character, R);
    const charValidSet = new Set(readValidStats(character.name));
    const cell = {};

    // 角色：图标（点击加备注）+ 目标/有效配置按钮
    const charIcon = character.icon || libCharacter?.icon || libCharacter?.portrait || '';
    const charNote = readNote(character.name);
    const charDetail = `<b>${character.name}</b>${character.level ? `<br><span style="color:var(--dim)">Lv.${character.level}</span>` : ''}<br>${[libCharacter?.rarity || '', libCharacter?.element || '', libCharacter?.trait || '', character.faction || libCharacter?.faction || ''].filter(Boolean).join(' · ')}${charNote ? `<br><span style="color:var(--acc)">备注：${charNote}</span>` : ''}`;
    cell['角色'] =
      `<td class="tchar"><span class="t-char-cell">${charIcon ? `<img class="t-ico" src="${charIcon}" loading="lazy" data-detail="${escapeHtml(charDetail)}" title="点击添加备注" onclick="openNote('${escapeJsAttr(character.name)}')">` : escapeHtml(character.name)}<span class="t-actions"><button class="mini" onclick="openTargetSettings('${escapeJsAttr(character.name)}')">目标</button></span></span></td>`;

    // 音擎：图标 + 悬浮详情
    const wengineDetail =
      `<b>${wengine.name || '未佩戴'}</b>${wengine.refinement ? ` ★${wengine.refinement}` : ''}` +
      (wengineBaseAtk != null ? `<br>基础攻击 ${formatValue(STAT.ATK, wengineBaseAtk)}` : '') +
      (wengineSubStats.length
        ? `<br>${wengineSubStats.map((t) => `${t.name} ${formatValue(t.name, t.value)}`).join('　')}`
        : '') +
      (wengineEffect
        ? `<br><span style="color:var(--dim);font-size:12px">${wengineEffect.length > 110 ? wengineEffect.slice(0, 110) + '…' : wengineEffect}</span>`
        : '');
    cell['音擎'] =
      `<td class="twe">${wengineIcon ? `<img class="t-ico" src="${wengineIcon}" data-detail="${escapeHtml(wengineDetail)}">` : wengine.name || '未佩戴'}</td>`;

    // 驱动盘：紧凑图标（两列，第一列 1/2/3 号、第二列 4/5/6 号），悬浮显示完整详情
    const discIcons = discOrder
      .map((i) => (character.discs || [])[i])
      .filter(Boolean)
      .map((d) => {
        const discLib = lookup(library.discs, discIndex, d.set);
        const icon = d.icon || discLib?.icon || '';
        if (!icon) return '<span class="d-ico" style="border-color:#444"></span>';
        return `<img class="d-ico" src="${icon}" data-detail="${escapeHtml(discTooltipFull(d, charValidSet))}">`;
      })
      .join('');
    cell['驱动盘'] = `<td class="tdisc"><div class="tdisc-ico">${discIcons || '未佩戴'}</div></td>`;

    // 副词条命中
    const hits = character.hitCount();
    const hitTip = gapAdviceHtml(character, R);
    cell['副词条命中'] = `<td class="thit">${
      hits != null
        ? `<span class="tv"${hitTip ? ` data-detail="${escapeHtml(hitTip)}" title="悬浮查看目标副词条缺口"` : ''}>${hits}</span>`
        : '—'
    }</td>`;

    // 属性列
    for (const s of targetStats) cell[s] = cellStats(R, target, s);

    // 各列排序取值（点击表头排序用）
    const sortVals = { 角色: character.name, 音擎: wengine.name || R.libWengine?.name || '', 副词条命中: hits };
    for (const s of targetStats) sortVals[s] = statCurrent(R, s);

    const cells = colOrder.map((c) => cell[c]).join('');
    return { html: `<tr draggable="true" data-char="${escapeHtml(character.name)}">${cells}</tr>`, sortVals };
  });
  if (tableSort.active) {
    rowObjs = tableSort.apply(rowObjs, (row, key) => row.sortVals[key]);
  }
  grid.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="统计表">${header}${rowObjs.map((r) => r.html).join('')}</table></div>`;
}

// ---------- 表格拖拽排序（行/列） ----------
let dragRow = null,
  dragCol = null;
grid.addEventListener('dragstart', (e) => {
  if (!e.target.closest('table.tbl')) return;
  const tr = e.target.closest('tr[data-char]');
  const th = e.target.closest('th[data-col]');
  if (tr) {
    dragRow = tr.dataset.char;
    tr.style.opacity = 0.35;
  } else if (th) {
    dragCol = th.dataset.col;
    th.style.opacity = 0.35;
  }
  if (dragRow || dragCol) e.dataTransfer.effectAllowed = 'move';
});
grid.addEventListener('dragover', (e) => {
  if (!dragRow && !dragCol) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  grid.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  const tr = e.target.closest('tr[data-char]');
  const th = e.target.closest('th[data-col]');
  if (dragRow && tr && tr.dataset.char !== dragRow) tr.classList.add('drag-over');
  if (dragCol && th && th.dataset.col !== dragCol) th.classList.add('drag-over');
});
grid.addEventListener('drop', (e) => {
  if (!e.target.closest('table.tbl')) return;
  const tr = e.target.closest('tr[data-char]');
  const th = e.target.closest('th[data-col]');
  if (dragRow && tr && tr.dataset.char !== dragRow) {
    const order = (readRowOrder() || myCharacters.map((x) => x.name)).filter((n) => n !== dragRow);
    const idx = order.indexOf(tr.dataset.char);
    order.splice(idx < 0 ? order.length : idx, 0, dragRow);
    saveRowOrder(order);
    render();
  } else if (dragCol && th && th.dataset.col !== dragCol) {
    const order = (readColOrder() || ['角色', '音擎', '驱动盘', '副词条命中', ...targetStats]).filter(
      (c) => c !== dragCol
    );
    const idx = order.indexOf(th.dataset.col);
    order.splice(idx < 0 ? order.length : idx, 0, dragCol);
    saveColOrder(order);
    render();
  }
});
grid.addEventListener('dragend', () => {
  grid.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
  grid.querySelectorAll('tr[data-char], th[data-col]').forEach((x) => (x.style.opacity = ''));
  dragRow = null;
  dragCol = null;
});

// ---------- 表头点击排序（wiki 与统计表格共用，经 data-sort 委托） ----------
grid.addEventListener('click', (e) => {
  const th = e.target.closest ? e.target.closest('th[data-sort]') : null;
  if (!th) return;
  const key = th.dataset.sort;
  if (th.closest('.wiki-table')) toggleWikiSort(key);
  else if (th.closest('table.tbl')) toggleTableSort(key);
  else if (th.closest('table.discstats-table')) toggleDiscStatsSort(key);
  else return;
  render();
});

// ---------- 渲染调度 ----------
export function render() {
  const view = new URLSearchParams(location.search).get('view') || userConfig.view || VIEWS.CARD;
  // 高亮当前视图切换按钮
  document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  grid.innerHTML = '';
  if (view === VIEWS.WIKI) {
    grid.innerHTML = renderWiki();
    return;
  }
  if (view === VIEWS.DISC_STATS) {
    grid.innerHTML = renderDiscStats();
    return;
  }
  if (!myCharacters.length) {
    grid.innerHTML = `<div class="empty">还没有「我的角色」数据。<br>推荐：运行 <b>npm start</b> 后打开本页，点右上角 <b>更新我的角色</b> 一键拉取（需粘贴一次 cookie）。<br>或命令行运行 <b>npm run sync:characters</b>（效果相同）。</div>`;
    return;
  }
  const list = myCharacters;
  if (!list.length) {
    grid.innerHTML = `<div class="empty">没有匹配的角色。<br>试试调整或清空筛选条件。</div>`;
    return;
  }
  if (view === VIEWS.TABLE) renderTable(list);
  else for (const character of list) grid.appendChild(characterCard(character));
}
