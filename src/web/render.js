// src/web/render.js —— 渲染层：悬浮提示、卡片/表格视图、拖拽排序、渲染调度
import {
  grid,
  myCharacters,
  userConfig,
  elementColors,
  discIndex,
  statEntries,
  readNote,
  readValidStats,
  readCharTarget,
  readColOrder,
  readRowOrder,
  saveRowOrder,
  saveColOrder,
} from './data.js';
import { resolveEntry, CATEGORY } from '../lib/names.js';
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
  resolveStatCurrent,
} from '../lib/calc.js';
import { escapeHtml, escapeJsAttr, formatValue, renderRichText } from '../lib/util.js';
import { createSort } from '../lib/sort.js';
import { STAT, VIEWS } from '../lib/constants.js';
import { discSetEffectsHtml, richItemHtml, skillIconForType } from './shared.js';
import { renderWiki, toggleWikiSort } from './wiki.js';
import { renderRecommend, toggleRecommendSort, mountRecommendCharts } from './recommend.js';
import { renderSimulate } from './simulate.js';
import { pruneDetachedCharts, mountCharts } from './charts.js';

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
  if (from && from !== to) hideTip();
});
/** 强制隐藏悬浮框。
 *  悬浮框只由 mouseout 收起，而 render() 会整块替换 innerHTML：鼠标下的元素被直接移除时
 *  浏览器不再派发 mouseout，提示框会一直挂在屏幕上（切子面板/切角色后尤为明显）。 */
export function hideTip() {
  tipEl.style.display = 'none';
}

// ---------- 渲染辅助 ----------
/** 音擎展示信息（名称/精炼/图标/基础攻击/副属性/特效），卡片与表格共用 */
function wengineInfo(character, R) {
  const wengine = character.wengine || {};
  const libWengine = R.libWengine;
  const mainStats = statEntries(wengine.mainStats);
  const subStats = statEntries(wengine.subStats);
  return {
    wengine,
    libWengine,
    icon: wengine.icon || libWengine?.icon || '',
    baseAtk: mainStats.find((t) => t.name === '基础攻击力')?.value ?? libWengine?.baseAtk ?? null,
    subStats: subStats.length ? subStats : statEntries(libWengine?.subStats),
    specialEffect: (wengine.specialEffect || libWengine?.specialEffect || '').replace(/<[^>]*>/g, ''),
  };
}
/** 单个驱动盘的悬浮详情：只显示 2/4 件套效果 */
function discTooltip(disc) {
  const discLib = resolveEntry(CATEGORY.DISC, discIndex, disc.set);
  return `<b>${disc.set}</b>` + discSetEffectsHtml(discLib);
}

/** 驱动盘详情数据（卡片盘面 / 表格悬浮共用）：库引用、主词条、副词条行、命中数、套装效果 */
function discDetail(d, validSet) {
  const discLib = resolveEntry(CATEGORY.DISC, discIndex, d.set);
  const main =
    statEntries(d.mainStats)
      .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
      .join('　') || '—';
  const subs = (d.growth || []).map((g) => {
    const rolls = 1 + g.growthCount;
    return {
      content: `${g.name} ${formatValue(g.name, g.value)} <span class="rolls">${'>'.repeat(rolls)}</span>`,
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
  const icon = discLib?.roundIcon || d.icon || discLib?.icon || '';
  const sub = subs.map((s) => `<div class="${s.hit ? 'hit' : ''}">${s.content}</div>`).join('');
  return `<div class="disc" data-detail="${escapeHtml(discTooltip(d))}">
    <div class="disc-top">${icon ? `<img class="d-ico" src="${icon}" alt="">` : ''}<div class="disc-head"><div class="dset">${d.set}</div><div class="dslot">${d.slot}号${d.level ? ' · +' + d.level : ''}</div></div><div class="dmain">${main}</div>${discHits != null ? `<span class="d-hit">命中 ${discHits}</span>` : ''}</div>
    ${sub ? `<div class="dsubs">${sub}</div>` : ''}
  </div>`;
}

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
    // 理论值不再独占一行（display:block 会把每行撑成两行）：仅实测与推算不一致时同行小字标注（定位计算问题）；
    // 其余情况（一致/无实测）行内显示理论值纯属冗余——对比信息移入数值格悬浮 data-detail
    const split = mismatch ? `<span class="break">(理论${formatValue(name, theoFinal)})</span>` : '';
    const valTip =
      actFinal != null && theoFinal != null
        ? `账号实测 ${formatValue(name, actFinal)} · 推算 ${formatValue(name, theoFinal)}${
            mismatch ? '（两者不一致，已标红）' : '（一致）'
          }`
        : actFinal != null
          ? `账号实测 ${formatValue(name, actFinal)}`
          : theoFinal != null
            ? `推算值（wiki 基础 + 装备）：${formatValue(name, theoFinal)}`
            : '';
    // 面板数值金色突出由「配置的有效副词条」决定：有效副词条 → 对应面板属性（如配了攻击力% 则攻击力金色）
    const core = highlighted ? '1' : '';
    mergedRows.push(
      `<tr class="${highlighted ? 'hl' : ''}"><td class="cs-name"${mismatch ? ` style="color:var(--red)"` : ''}>${name}</td><td class="cs-val" data-core="${core}"${mismatch ? ` style="color:var(--red)"` : ''}${valTip ? ` data-detail="${escapeHtml(valTip)}" title="悬浮查看实测/推算对比"` : ''}>${formatValue(name, displayFinal)}${split}</td><td class="cs-rate">${prog ? progressCell(prog.rate) : ''}</td></tr>`
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
  // 右上角达成率大字 + 图章（取代面板标题里的「总 X%」）
  const stamp =
    totalProgress != null
      ? `<div class="stamp-wrap" title="总体达成率（各属性达成率均值）"><span class="rate">${totalProgress}<small>%</small></span><span class="stamp ${totalProgress >= 97 ? 'green' : totalProgress < 60 ? 'red' : ''}">${
          totalProgress >= 97 ? '已毕业' : totalProgress >= 60 ? '达成' : '缺口'
        }</span></div>`
      : '';

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

  // 驱动盘：按槽位 1-6 顺序排列（卡片/汇总展示统一；不依赖接口数组原序，空槽位排最后）
  const discs = (character.discs || [])
    .filter(Boolean)
    .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
    .slice(0, 6);
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
          ${stamp}
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
        <div class="col-title"><span>最终面板</span></div>
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
/** 汇总表属性格悬浮：计算详情——当前/目标达成率 + 基础→加成→最终分解 + 各来源明细 + 账号实测差异 */
function statDetailHtml(R, s, current, targetVal, rate) {
  const fmt = (v) => formatValue(s, v);
  let src = s;
  let base = R.base?.[s];
  let bonus = R.bonus?.[s];
  let final = R.final?.[s];
  // 「属性伤害加成」目标：实际键取 final 首个伤害加成键（来源明细按实际键列）
  if (s === '属性伤害加成') {
    const dbKey = Object.keys(R.final || {}).find((k) => isDamageBonus(k));
    if (dbKey) {
      src = dbKey;
      base = null;
      bonus = null;
      final = R.final[dbKey];
    }
  }
  const parts = [`<b>${s}</b>　当前 <b>${fmt(current)}</b>`];
  if (targetVal != null && rate != null) {
    const targetInternal = targetPercents.has(s) ? Number(targetVal) / 100 : Number(targetVal);
    parts.push(
      `<span style="color:var(--dim)">目标 ${fmt(targetInternal)} → 达成 <span class="${rateClass(rate)}">${(rate * 100).toFixed(0)}%</span></span>`
    );
  }
  if (final != null && base != null) {
    parts.push(`基础 ${fmt(base)} + 加成 ${fmt(bonus)} = 最终 <b>${fmt(final)}</b>`);
  } else if (final != null) {
    parts.push(`合计 <b>${fmt(final)}</b>`);
  }
  const srcs = R.sources?.[src];
  if (srcs?.length) parts.push(srcs.map((t) => `<span style="color:var(--dim)">· ${t}</span>`).join('<br>'));
  // 账号实测与推算差异（实测为展示主值；差异超阈值才提示，避免取整噪音）
  const act = R.actual?.[s]?.final;
  if (act != null && final != null && Math.abs(act - final) > (targetPercents.has(s) ? 0.005 : 1))
    parts.push(`<span style="color:var(--dim);font-size:14px">账号实测 ${fmt(act)}（推算 ${fmt(final)}）</span>`);
  return parts.join('<br>');
}
function cellStats(R, target, s) {
  const current = resolveStatCurrent(R, s);
  if (current == null) return `<td class="tstat">—<div class="tbar tbar-empty"></div></td>`;
  const targetVal = target[s];
  const rate =
    targetVal == null || !Number(targetVal)
      ? null
      : current / (targetPercents.has(s) ? Number(targetVal) / 100 : Number(targetVal));
  const tip = ` data-detail="${escapeHtml(statDetailHtml(R, s, current, targetVal, rate))}" title="悬浮查看计算详情"`;
  if (rate == null)
    return `<td class="tstat"${tip}><span class="tv">${formatValue(s, current)}</span><div class="tbar tbar-empty"></div></td>`;
  const width = Math.min(100, rate * 100).toFixed(0);
  return `<td class="tstat"${tip}><span class="tv">${formatValue(s, current)}</span><span class="tpct ${rateClass(rate)}">${(rate * 100).toFixed(0)}%</span><div class="tbar"><span class="tfill" style="width:${width}%;background:${rateColor(rate)}"></span></div></td>`;
}

function renderTable(list, container) {
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
        ? `<br><span style="color:var(--dim);font-size:14px">${wengineEffect.length > 110 ? wengineEffect.slice(0, 110) + '…' : wengineEffect}</span>`
        : '');
    cell['音擎'] =
      `<td class="twe">${wengineIcon ? `<img class="t-ico" src="${wengineIcon}" data-detail="${escapeHtml(wengineDetail)}">` : wengine.name || '未佩戴'}</td>`;

    // 驱动盘：按槽位 1-6 顺序的紧凑圆形图标（横向排列，悬浮显示完整详情）
    const discIcons = (character.discs || [])
      .filter(Boolean)
      .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
      .slice(0, 6)
      .map((d) => {
        const discLib = resolveEntry(CATEGORY.DISC, discIndex, d.set);
        const icon = discLib?.roundIcon || d.icon || discLib?.icon || '';
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
    for (const s of targetStats) sortVals[s] = resolveStatCurrent(R, s);

    const cells = colOrder.map((c) => cell[c]).join('');
    return { html: `<tr draggable="true" data-char="${escapeHtml(character.name)}">${cells}</tr>`, sortVals };
  });
  if (tableSort.active) {
    rowObjs = tableSort.apply(rowObjs, (row, key) => row.sortVals[key]);
  }
  container.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="统计表">${header}${rowObjs.map((r) => r.html).join('')}</table></div>`;
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
  else if (th.closest('table.rec-table')) toggleRecommendSort(key);
  else return;
  render();
});

// ---------- 我的角色视图（卡片 / 汇总 二级子页面） ----------
let myTab = 'card';
export function setMyTab(key) {
  myTab = key;
}
const MY_TABS = [
  { key: 'card', label: '卡片' },
  { key: 'table', label: '汇总' },
];
/** 我的角色视图外壳：子面板 tabs + 内容容器（bodyContent 可选，放空态提示等） */
function myCharsShell(bodyContent = '') {
  const tabs = MY_TABS.map(
    (t) =>
      `<button class="wiki-tab ${t.key === myTab ? 'on' : ''}" data-tab="${t.key}" onclick="ZZZ.myTab('${t.key}')">${t.label}</button>`
  ).join('');
  return `<div class="wiki"><div class="wiki-tabs">${tabs}</div><div class="mychars-body">${bodyContent}</div></div>`;
}
/** 主视图解析：URL/配置中的 card|table 兼容映射到 mychars（旧配置迁移），legacy 供初始化子页面 tab */
function resolveView() {
  const raw = new URLSearchParams(location.search).get('view') || userConfig.view || VIEWS.MY_CHARS;
  if (raw === VIEWS.CARD || raw === VIEWS.TABLE) return { view: VIEWS.MY_CHARS, legacy: raw };
  return { view: raw, legacy: null };
}

// ---------- 渲染调度 ----------
export function render() {
  const { view, legacy } = resolveView();
  hideTip(); // 旧 DOM 即将被替换，挂在其上的悬浮框不会收到 mouseout
  // 高亮当前视图切换按钮
  document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  grid.innerHTML = '';
  // 清空后旧图表容器全部脱离文档：此处统一回收，覆盖下面所有提前 return 的分支
  // （切到数据库/我的角色时不会走 mountCharts，只靠它清理会漏掉整套统计视图的图）
  pruneDetachedCharts();
  if (view === VIEWS.WIKI) {
    grid.innerHTML = renderWiki();
    return;
  }
  if (view === VIEWS.RECOMMEND || view === 'discstats') {
    // discstats 兼容旧 user-config 存留的视图值
    grid.innerHTML = renderRecommend();
    mountRecommendCharts();
    return;
  }
  if (view === VIEWS.SIMULATE) {
    grid.innerHTML = renderSimulate();
    mountCharts();
    return;
  }
  // 我的角色：卡片 / 汇总 二级子页面
  if (!myCharacters.length) {
    grid.innerHTML = myCharsShell(
      '<div class="empty">还没有「我的角色」数据。<br>推荐：运行 <b>npm start</b> 后打开本页，点右上角 <b>更新我的角色</b> 一键拉取（需粘贴一次 cookie）。<br>或命令行运行 <b>npm run sync:characters</b>（效果相同）。</div>'
    );
    return;
  }
  const list = myCharacters;
  // 兼容旧配置 card/table 视图值 → 初始化子页面 tab
  if (legacy === VIEWS.TABLE) myTab = 'table';
  else if (legacy === VIEWS.CARD) myTab = 'card';
  grid.innerHTML = myCharsShell();
  const body = grid.querySelector('.mychars-body');
  body.className = myTab === 'card' ? 'mychars-body cards' : 'mychars-body';
  if (myTab === 'table') renderTable(list, body);
  else
    list.forEach((character, i) => {
      const card = characterCard(character);
      // 入场动画的错开延迟由 CSS 的 calc(var(--i) * 40ms) 算出；封顶 12 避免长列表末尾等太久
      card.style.setProperty('--i', String(Math.min(i, 12)));
      body.appendChild(card);
    });
}
