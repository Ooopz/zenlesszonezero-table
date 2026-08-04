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
  getFilteredCharacters,
} from './data.js';
import {
  calculateCharacter,
  discGrowth,
  hitCount,
  statProgress,
  progressCell,
  rateColor,
  rateClass,
  panelOrder,
  panelStatMap,
  isDamageBonus,
  targetStats,
  targetPercents,
} from '../lib/calc.js';
import { escapeHtml, formatValue } from '../lib/util.js';

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
  return (
    `<b>${disc.set}</b>` +
    (discLib?.set2Text ? `<br><span style="color:var(--green)">【2件套】${discLib.set2Text}</span>` : '') +
    (discLib?.set4Text ? `<br><span style="color:var(--orange)">【4件套】${discLib.set4Text}</span>` : '')
  );
}

/** 驱动盘悬浮详情（完整版，供表格图标用）：命中 + 主词条 + 副词条(> + 高亮) + 2/4件套 */
function discTooltipFull(d, validSet) {
  const discLib = lookup(library.discs, discIndex, d.set);
  const growths = discGrowth(d, d.rarity);
  const main =
    statEntries(d.mainStats)
      .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
      .join('　') || '—';
  const sub = growths
    .map((g) => {
      const rolls = 1 + g.growthCount;
      const content = `${g.name} ${formatValue(g.name, g.value)}<span class="rolls">${'>'.repeat(rolls)}</span>`;
      return validSet.has(g.type) ? `<span class="hit">${content}</span>` : content;
    })
    .join('<br>');
  const discHits = validSet.size
    ? growths.filter((g) => validSet.has(g.type)).reduce((s, g) => s + 1 + g.growthCount, 0)
    : null;
  return (
    `<b>${d.set}</b>　槽位${d.slot}${d.level ? ` +${d.level}` : ''}` +
    (discHits != null ? `<br><span style="color:var(--acc)">副词条命中：${discHits}</span>` : '') +
    `<br><span style="color:var(--dim)">主词条</span> ${main}` +
    (sub ? `<br><span style="color:var(--dim)">副词条</span><br>${sub}` : '') +
    (discLib?.set2Text ? `<br><span style="color:var(--green)">【2件套】${discLib.set2Text}</span>` : '') +
    (discLib?.set4Text ? `<br><span style="color:var(--orange)">【4件套】${discLib.set4Text}</span>` : '')
  );
}

/** 单个驱动盘盘面：左上图标 + 套装名/槽位 + 右上命中 + 主词条 + 纵向副词条(> 表示有效词条数) */
function discTile(d, validSet) {
  const discLib = lookup(library.discs, discIndex, d.set);
  const icon = d.icon || discLib?.icon || '';
  const main =
    statEntries(d.mainStats)
      .map((t) => `${t.name} ${formatValue(t.name, t.value)}`)
      .join('　') || '—';
  const growths = discGrowth(d, d.rarity);
  const sub = growths
    .map((g) => {
      const rolls = 1 + g.growthCount;
      const content = `${g.name} ${formatValue(g.name, g.value)}<span class="rolls">${'>'.repeat(rolls)}</span>`;
      return `<div class="${validSet.has(g.type) ? 'hit' : ''}">${content}</div>`;
    })
    .join('');
  const discHits = validSet.size
    ? growths.filter((g) => validSet.has(g.type)).reduce((s, g) => s + 1 + g.growthCount, 0)
    : null;
  return `<div class="disc" data-detail="${escapeHtml(discTooltip(d))}" title="悬浮查看详情">
    <div class="disc-top">${icon ? `<img class="d-ico" src="${icon}" alt="">` : ''}<div class="disc-head"><div class="dset">${d.set}</div><div class="dslot">${d.slot}号${d.level ? ' · +' + d.level : ''}</div></div>${discHits != null ? `<span class="d-hit">命中 ${discHits}</span>` : ''}</div>
    <div class="dmain">${main}</div>
    ${sub ? `<div class="dsubs">${sub}</div>` : ''}
  </div>`;
}

/** 三行两列盘序：第一列 1/2/3 号、第二列 4/5/6 号 */
const discOrder = [0, 3, 1, 4, 2, 5];

// ---------- 卡片视图 ----------
function characterCard(character) {
  const R = calculateCharacter(character);
  const libCharacter = R.libCharacter;
  const portrait = character.icon || libCharacter.icon || character.portrait || libCharacter.portrait || '';
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
    const prog = statProgress(character, R, name);
    if (prog) {
      rateSum += prog.rate;
      rateCount++;
    }
    const split =
      (displayBase != null ? `基础${formatValue(name, displayBase)}` : '') +
      (displayBonus != null && displayBonus !== 0 ? ` +${formatValue(name, displayBonus)}` : '');
    mergedRows.push(
      `<tr class="${highlighted ? 'hl' : ''}"><td class="cs-name">${name}</td><td class="cs-val">${formatValue(name, displayFinal)}${split ? `<span class="break">(${split})</span>` : ''}</td><td class="cs-rate">${prog ? progressCell(prog.rate) : ''}</td></tr>`
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

  // 驱动盘：三行两列，第一列 1/2/3 号、第二列 4/5/6 号
  const discs = (character.discs || []).slice(0, 6);
  const hits = hitCount(character);
  const discsHtml = discOrder
    .map((i) => discs[i])
    .filter(Boolean)
    .map((d) => discTile(d, charValidSet))
    .join('');

  // 计算明细
  const detailRows = [];
  for (const s of ['攻击力', '生命值', '防御力', '暴击率', '暴击伤害', '异常精通', '穿透率']) {
    const computed = R.final[s];
    if (computed == null) continue;
    const actualFinal = R.actual?.[s]?.final;
    const annotation =
      actualFinal != null && Math.abs(actualFinal - computed) > 0.001 ? `　实际 ${formatValue(s, actualFinal)}` : '';
    const srcs = (R.sources[s] || []).join('；');
    detailRows.push(
      `<tr><td class="src">${s}</td><td class="val">${formatValue(s, computed)}${annotation}</td><td class="src">${srcs || '—'}</td></tr>`
    );
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head">
      ${portrait ? `<img class="portrait" src="${portrait}" alt="" loading="lazy" title="点击添加备注" onclick="openNote('${character.name.replace(/'/g, "\\'")}')" onerror="this.style.display='none'">` : ''}
      <div class="who">
        <div class="name">${character.name || ''}
          <button class="mini" title="设置/编辑该角色的目标属性" onclick="openTargetSettings('${character.name.replace(/'/g, "\\'")}')">目标</button>
          <button class="mini" title="设置该角色视为「有效」的副词条属性" onclick="openValidStats('${character.name.replace(/'/g, "\\'")}')">有效</button>
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
    <div class="section"><b>音擎</b></div>
    <div class="wengine">
      ${wengineIcon ? `<img src="${wengineIcon}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="wmain">
        <div class="wname">${wengine.name || '未佩戴'}<span style="color:var(--acc)">${'★'.repeat(wengine.refinement || 0)}</span></div>
        <div class="wmeta">${wengineBaseAtk != null ? `基础攻击 ${formatValue('攻击力', wengineBaseAtk)}` : ''}${wengineSubStats.length ? `　${wengineSubStats.map((t) => `${t.name} ${formatValue(t.name, t.value)}`).join('　')}` : ''}</div>
      </div>
      ${wengineEffect ? `<div class="wfx" title="点击展开/收起" onclick="this.classList.toggle('open')">${wengineEffect}</div>` : ''}
    </div>
    <div class="midlayout">
      <div class="col-left">
        <div class="col-title"><b>驱动盘</b>${hits != null ? `<span>命中 ${hits}</span>` : ''}</div>
        <div class="discs-vert">${discsHtml}</div>
      </div>
      <div class="col-right">
        <div class="col-title"><span>最终面板 / 达成率</span>${totalProgress != null ? `<span class="${rateClass(totalProgress / 100)}">总 ${totalProgress}%</span>` : ''}</div>
        <table class="cs"><tr><th>属性</th><th>数值</th><th>达成率</th></tr>${mergedRows.join('')}</table>
        ${detailRows.length ? `<details class="detail" style="margin:4px 0 0"><summary>计算明细</summary><table>${detailRows.join('')}</table><div class="footnote">推算值按基础+装备汇总，未计 4 件套条件效果/核心被动，可能与实际面板有出入；实际值以游戏为准。</div></details>` : ''}
      </div>
    </div>
  `;
  return card;
}

// ---------- 统计表格视图 ----------
function cellStats(R, target, s) {
  let current = R.actual?.[s]?.final ?? R.final[s];
  if (s === '属性伤害加成') {
    for (const k of Object.keys(R.final))
      if (isDamageBonus(k)) {
        current = R.final[k];
        break;
      }
  }
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

  const header = `<tr>${colOrder.map((c) => `<th draggable="true" title="拖动可排序" data-col="${c}">${c}</th>`).join('')}</tr>`;

  const rows = rowOrder
    .map((character) => {
      const R = calculateCharacter(character);
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
        `<td class="tchar"><span class="t-char-cell">${charIcon ? `<img class="t-ico" src="${charIcon}" data-detail="${escapeHtml(charDetail)}" title="点击添加备注" onclick="openNote('${character.name.replace(/'/g, "\\'")}')">` : character.name}<span class="t-actions"><button class="mini" onclick="openTargetSettings('${character.name.replace(/'/g, "\\'")}')">目标</button><button class="mini" onclick="openValidStats('${character.name.replace(/'/g, "\\'")}')">有效</button></span></span></td>`;

      // 音擎：图标 + 悬浮详情
      const wengineDetail =
        `<b>${wengine.name || '未佩戴'}</b>${wengine.refinement ? ` ★${wengine.refinement}` : ''}` +
        (wengineBaseAtk != null ? `<br>基础攻击 ${formatValue('攻击力', wengineBaseAtk)}` : '') +
        (wengineSubStats.length
          ? `<br>${wengineSubStats.map((t) => `${t.name} ${formatValue(t.name, t.value)}`).join('　')}`
          : '') +
        (wengineEffect
          ? `<br><span style="color:var(--dim);font-size:11px">${wengineEffect.length > 110 ? wengineEffect.slice(0, 110) + '…' : wengineEffect}</span>`
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
      const hits = hitCount(character);
      cell['副词条命中'] = `<td class="thit">${hits != null ? `<span class="tv">${hits}</span>` : '—'}</td>`;

      // 属性列
      for (const s of targetStats) cell[s] = cellStats(R, target, s);

      const cells = colOrder.map((c) => cell[c]).join('');
      return `<tr draggable="true" data-char="${escapeHtml(character.name)}">${cells}</tr>`;
    })
    .join('');
  grid.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="统计表">${header}${rows}</table></div>`;
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
    const order = (readRowOrder() || getFilteredCharacters().map((x) => x.name)).filter((n) => n !== dragRow);
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

// ---------- 渲染调度 ----------
export function render() {
  const view = new URLSearchParams(location.search).get('view') || userConfig.view || 'card';
  document.getElementById('viewBtn').textContent = view === 'card' ? '统计视图' : '卡片视图';
  grid.innerHTML = '';
  if (!myCharacters.length) {
    grid.innerHTML = `<div class="empty">还没有「我的角色」数据。<br>推荐：运行 <b>npm start</b> 后打开本页，点右上角 <b>同步我的角色</b> 一键拉取（需粘贴一次 cookie）。<br>或命令行运行 <b>npm run sync:characters</b>（效果相同）。</div>`;
    return;
  }
  const list = getFilteredCharacters();
  if (!list.length) {
    grid.innerHTML = `<div class="empty">没有匹配的角色。<br>试试调整或清空筛选条件。</div>`;
    document.getElementById('counts').textContent = `共 0 / ${myCharacters.length} 个角色`;
    return;
  }
  if (view === 'table') renderTable(list);
  else for (const character of list) grid.appendChild(characterCard(character));
  document.getElementById('counts').textContent =
    list.length === myCharacters.length
      ? `共 ${myCharacters.length} 个角色`
      : `共 ${list.length} / ${myCharacters.length} 个角色`;
}
