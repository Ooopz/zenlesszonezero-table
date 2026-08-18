// src/web/discProb.js —— 模拟视图 · 「驱动盘模拟」二级子面板
// 驱动盘练度提升概率计算（移植 ZZZ-DDC）：按角色副词条价值权重，计算随机掉落+强化达到目标分的概率。
// 计算逻辑在 src/lib/discProb.js（双端共享纯函数）；本文件只做表单与结果渲染。
// 角色价值权重 = workshop-weights（经 workshop-grad 对齐 wiki 角色名）；词条/主词条名称与 constants 统一。
import { library, myCharacters, workshopGrad, workshopStats } from './data.js';
import {
  DISC_SUBSTATS,
  DISC_SUBSTAT_SPECIAL_WEIGHTS,
  MAIN_STAT_OPTIONS,
  STAT,
  mainStatName,
} from '../lib/constants.js';
import { roleWeightsFromWs, DEFAULT_WEIGHTS, computePosProb, computePosProbKeep } from '../lib/discProb.js';
import { substatGrowthTable, substatType } from '../lib/calc.js';
import { escapeHtml, formatValue } from '../lib/util.js';
import { registerZZZ } from './shared.js';
import { chartBox, registerChart, dpProbBarOption } from './charts.js';
/* global echarts */

/** dpResult / 左列权重图的手动挂载（dpCalc 动态 innerHTML，不走主 render 的 mountCharts） */
const dpCharts = new Map();
function mountDpChart(key, opt) {
  const el = document.querySelector(`.chart-init[data-chart="${key}"]`);
  if (!el || typeof echarts === 'undefined') return;
  const old = echarts.getInstanceByDom(el);
  if (old) old.dispose();
  const chart = echarts.init(el);
  chart.setOption(opt);
  dpCharts.set(key, chart);
}

let dpRole = '';

/** 副词条池 5 行 × 2 列配对顺序（每行两个数值即 DISC_SUBSTATS 下标；固定值在前、百分比在后） */
const DP_ROW_PAIRS = [
  [1, 0], // 生命值   | 生命值%
  [6, 5], // 防御力   | 防御力%
  [3, 2], // 攻击力   | 攻击力%
  [8, 7], // 暴击率   | 暴击伤害
  [9, 4], // 异常精通 | 穿透值
];
/** 副词条下拉展示顺序（配对展平，与权重池一致） */
const DP_SUB_ORDER = DP_ROW_PAIRS.flat();

/** 1-3 号位主词条固定（1=生命值 / 2=攻击力 / 3=防御力） */
const SLOT_FIXED_MAIN = { 1: STAT.HP, 2: STAT.ATK, 3: STAT.DEF };

/** 角色当前装备的 6 盘（按 1-6 号位排序，缺槽为 null） */
function roleDiscs(name) {
  const arr = (myCharacters.find((c) => c.name === name)?.discs || [])
    .filter((d) => d && d.slot != null)
    .sort((a, b) => a.slot - b.slot);
  return [1, 2, 3, 4, 5, 6].map((pos) => arr.find((d) => d.slot === pos) || null);
}

/** 盘主词条名（456 号位固定值名归一化为百分比；无盘返回空） */
function mainOf(d) {
  if (!d) return '';
  const entry = (d.mainStats || []).find((t) => t && t.name != null);
  return entry ? mainStatName(entry.name) : '';
}

/** 盘副词条名列表（0-4 个，已区分 % 与固定值：账号原始名不带 %，按 value 量级经 substatType 归一为标准名） */
function subsOf(d) {
  return (d.subStats || [])
    .filter((t) => t && t.name != null && t.value != null)
    .map((t) => substatType(t.name, t.value));
}

/** 单个驱动盘卡：主词条（123 固定 / 456 下拉）+ 目标主词条（456，默认当前）+ 4 行副词条（词条 | 命中 | 基础值×命中）
 *  + 定向主词条（全部盘，道具：位置+主词条必出，默认不限）+ 定向副词条 ×2（需先定向主词条）。
 *  main/subs 为角色当前装备值（默认选中）；growth 为当前盘各副词条成长信息（默认命中 = 1+强化次数）。 */
function slotHtml(pos, main, subs, growth) {
  const mainHtml =
    SLOT_FIXED_MAIN[pos] != null
      ? `<div class="dp-row"><label>主词条</label><div class="dp-slot-main-fixed">${SLOT_FIXED_MAIN[pos]}</div></div>`
      : `<div class="dp-row"><label>主词条</label><select class="dp-slot-main" data-pos="${pos}"><option value=""${main === '' ? ' selected' : ''}>—</option>${(MAIN_STAT_OPTIONS[pos] || [])
          .map((m) => `<option value="${escapeHtml(m)}"${main === m ? ' selected' : ''}>${escapeHtml(m)}</option>`)
          .join('')}</select></div>`;
  const targetMain =
    pos >= 4
      ? `<div class="dp-row"><label>目标主词条</label><select class="dp-target-main" data-pos="${pos}"><option value=""${!main ? ' selected' : ''}>—（不限）</option>${(MAIN_STAT_OPTIONS[pos] || [])
          .map((m) => `<option value="${escapeHtml(m)}"${main === m ? ' selected' : ''}>${escapeHtml(m)}</option>`)
          .join('')}</select></div>`
      : '';
  const subOptions = (sel) =>
    `<option value=""${sel === '' || sel == null ? ' selected' : ''}>—</option>${DP_SUB_ORDER.map(
      (i) => `<option value="${escapeHtml(DISC_SUBSTATS[i])}"${sel === DISC_SUBSTATS[i] ? ' selected' : ''}>${escapeHtml(DISC_SUBSTATS[i])}</option>`
    ).join('')}`;
  const subSelects = [0, 1, 2, 3]
    .map((k) => {
      const name = subs[k] || '';
      const hit = name ? 1 + (growth?.[k]?.growthCount ?? 0) : 1; // 默认命中 = 词条 1 次 + 强化次数
      const base = substatGrowthTable.S[name];
      const val = name && base ? formatValue(name, base * hit) : '';
      return (
        `<div class="dp-row dp-sub-row">` +
        `<select class="dp-slot-sub" data-pos="${pos}" data-sub="${k}" onchange="ZZZ.dpSubChange(this, ${pos}, ${k})">${subOptions(name)}</select>` +
        `<input class="dp-hit-sub" data-pos="${pos}" data-sub="${k}" type="number" min="0" step="1" value="${hit}" oninput="ZZZ.dpHitChange(this, ${pos}, ${k})" title="该词条命中次数（1 + 强化次数）">` +
        `<span class="dp-sub-val" data-pos="${pos}" data-sub="${k}" title="基础值 × 命中次数">${val}</span></div>`
      );
    })
    .join('');
  // 定向主词条（道具：消耗后位置与主词条必出）；123 号位选项 = 固定值（相当于指定位置），456 = 全部主词条
  const dirMainOpts =
    SLOT_FIXED_MAIN[pos] != null
      ? `<option value="" selected>—（不限）</option><option value="${SLOT_FIXED_MAIN[pos]}">${SLOT_FIXED_MAIN[pos]}</option>`
      : `<option value="" selected>—（不限）</option>${(MAIN_STAT_OPTIONS[pos] || [])
          .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
          .join('')}`;
  const dirMain = `<div class="dp-row"><label>定向主词条</label><select class="dp-dir-main" data-pos="${pos}" onchange="ZZZ.dpDirChange(this, ${pos})" title="消耗道具：指定位置且主词条必出">${dirMainOpts}</select></div>`;
  const dirSubs = [0, 1]
    .map(
      (k) =>
        `<div class="dp-row"><label>定向副词条${k + 1}</label><select class="dp-dir-sub" data-pos="${pos}" data-k="${k}" onchange="ZZZ.dpDirChange(this, ${pos})" title="需先定向主词条"><option value="" selected>—（不限）</option>${DP_SUB_ORDER.map(
          (i) => `<option value="${escapeHtml(DISC_SUBSTATS[i])}">${escapeHtml(DISC_SUBSTATS[i])}</option>`
        ).join('')}</select></div>`
    )
    .join('');
  const dirBlock = `<div class="dp-dir-block"><div class="dp-dir-head">定向（消耗道具）</div>${dirMain}${dirSubs}</div>`;
  return `<div class="dp-slot" data-pos="${pos}"><div class="dp-slot-head">${pos}号位</div>${mainHtml}${targetMain}${subSelects}${dirBlock}</div>`;
}

/** 刷新某副词条行的第三列显示值 = 基础值 × 该行命中次数 */
function refreshSubVal(pos, k) {
  const name = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value || '';
  const hit = Number(document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value) || 0;
  const span = document.querySelector(`.dp-sub-val[data-pos="${pos}"][data-sub="${k}"]`);
  if (!span) return;
  const base = name ? substatGrowthTable.S[name] : 0;
  span.textContent = name && base ? formatValue(name, base * hit) : '';
}

/** 副词条下拉切换：更新该行第三列（基础值 × 当前命中次数） */
export function dpSubChange(sel, pos, k) {
  refreshSubVal(pos, k);
}

/** 命中次数输入变化：更新该行第三列 */
export function dpHitChange(inp, pos, k) {
  refreshSubVal(pos, k);
}

/** 该盘所有定向下拉（定向主词条 + 定向副词条） */
function dirSelects(pos) {
  return [
    ...document.querySelectorAll(`.dp-dir-main[data-pos="${pos}"]`),
    ...document.querySelectorAll(`.dp-dir-sub[data-pos="${pos}"]`),
  ];
}

/** 刷新某盘定向状态：①定向副词条必须已定向主词条才可选；②定向系列词条互斥（同盘词条不重复） */
function refreshDirState(pos) {
  const sels = dirSelects(pos);
  const dirMain = document.querySelector(`.dp-dir-main[data-pos="${pos}"]`);
  const mainChosen = !!dirMain?.value;
  for (const s of sels) {
    const taken = new Set(sels.filter((x) => x !== s).map((x) => x.value).filter(Boolean));
    for (const opt of s.options) {
      // 互斥禁用 + 定向副词条需先定向主词条
      opt.disabled = (!!opt.value && taken.has(opt.value)) || (s.classList.contains('dp-dir-sub') && !mainChosen);
    }
  }
}

/** 定向下拉变化：若选中的词条已被本盘其他定向下拉占用则回退为不定向，并刷新禁用状态 */
export function dpDirChange(sel, pos) {
  const sels = dirSelects(pos);
  const others = new Set(sels.filter((x) => x !== sel).map((x) => x.value).filter(Boolean));
  if (sel.value && others.has(sel.value)) sel.value = '';
  refreshDirState(pos);
}

/** 当前角色的 10 维价值权重（workshop-weights，查不到回退默认模板） */
function weightsFor(name) {
  return roleWeightsFromWs(name, workshopStats.weightJson, workshopGrad.roles) ?? DEFAULT_WEIGHTS;
}

/** 渲染驱动盘模拟子面板（simulate.js 的 PANEL_RENDERERS 调用） */
export function renderProbPanel() {
  const roles = Object.keys(library.characters || {}).sort((a, b) => a.localeCompare(b, 'zh'));
  if (!dpRole || !roles.includes(dpRole)) dpRole = roles[0] || '';
  const weights = weightsFor(dpRole);
  const entryHtml = (i) =>
    `<div class="dp-entry"><span class="dp-ename">${DISC_SUBSTATS[i]}</span>` +
    `<label>价值</label><input class="dp-w" data-idx="${i}" type="number" step="0.05" min="0" value="${weights[i]}" title="该词条对本角色的价值权重（0 = 无效词条）"></div>`;
  const rows = DP_ROW_PAIRS.map((pair) => pair.map(entryHtml).join('')).join('');
  const discs = roleDiscs(dpRole);
  const slots = discs
    .map((d, i) => {
      const pos = i + 1;
      return slotHtml(pos, mainOf(d), subsOf(d), d?.growth);
    })
    .join('');
  return `<div class="dp-wrap chart-card" style="grid-column:1/-1">
    <h3>驱动盘模拟</h3>
    <p class="sim-desc">按该角色的副词条价值权重（工坊默认流派口径），计算<b>刷到比当前驱动盘更好的盘的概率</b>：新盘随机掉落 + 强化后，副词条价值分超过当前盘该位置的分数。<b>概率越低 = 当前盘越接近极限、越难提升</b>。<br>目标主词条（456，默认 = 当前主词条）限定比较的主词条；<b>定向主词条</b> = 消耗道具使位置与主词条必出（消除 1/6 与主词条概率）；定向副词条需先定向主词条。
    模型：首 4 副词条按抽取权重枚举（同盘不重复），强化每次从 4 词条中随机一条 +1 层；初始 4 词条盘 20%（成长 5 次）、3 词条盘 80%（首次强化补第 4 词条、之后成长 4 次）；456 号位主词条按出现概率加权。</p>
    <div class="tgrid sim-grid">
      <div class="titem"><label>角色</label><select id="dpRoleSel" onchange="ZZZ.dpSetRole(this.value)">${roles
        .map((r) => `<option value="${escapeHtml(r)}"${r === dpRole ? ' selected' : ''}>${escapeHtml(r)}</option>`)
        .join('')}</select></div>
      <div class="titem"><label>&nbsp;</label><button class="primary" onclick="ZZZ.dpCalc()">计算概率</button></div>
    </div>
    <h4 class="dp-slots-title">当前驱动盘（默认 = 该角色已装备，可调整；定向词条默认不定向）</h4>
    <div class="dp-body">
      <div class="dp-body-left">
        <div class="dp-slots dp-slots-3">${slots}</div>
      </div>
      <div class="dp-body-right">
        <h4>副词条池 · 价值权重</h4>
        <div class="dp-entries">${rows}</div>
        <div id="dpResult" class="dp-result"></div>
      </div>
    </div>
  </div>`;
}

/** 角色切换：重置 6 盘默认值（该角色已装备：词条 + 命中次数）+ 词条价值权重；定向下拉复位为不定向 */
export function dpSetRole(name) {
  dpRole = name;
  const w = weightsFor(name);
  document.querySelectorAll('.dp-w').forEach((inp) => {
    inp.value = w[Number(inp.dataset.idx)] || 0;
  });
  roleDiscs(name).forEach((d, i) => {
    const pos = i + 1;
    const mainSel = document.querySelector(`.dp-slot-main[data-pos="${pos}"]`);
    if (mainSel) mainSel.value = mainOf(d);
    const subs = subsOf(d);
    for (let k = 0; k < 4; k++) {
      const s = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`);
      if (s) s.value = subs[k] || '';
      const hitInp = document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`);
      if (hitInp) hitInp.value = subs[k] ? 1 + (d?.growth?.[k]?.growthCount ?? 0) : 1;
      refreshSubVal(pos, k);
    }
    const targetSel = document.querySelector(`.dp-target-main[data-pos="${pos}"]`);
    if (targetSel) targetSel.value = mainOf(d); // 目标主词条默认 = 当前主词条（456；123 无此下拉）
    const dirMainSel = document.querySelector(`.dp-dir-main[data-pos="${pos}"]`);
    if (dirMainSel) dirMainSel.value = ''; // 定向主词条默认不定向（道具，未消耗）
    for (let k = 0; k < 2; k++) {
      const ds = document.querySelector(`.dp-dir-sub[data-pos="${pos}"][data-k="${k}"]`);
      if (ds) ds.value = '';
    }
    refreshDirState(pos); // 重置互斥与「先定向主词条」禁用
  });
}

/** 该位置当前盘的副词条价值分：Σ 每行 命中次数(输入值) × 价值权重。
 *  词条与命中次数均为表单可调值（默认 = 角色当前盘），命中 0 或空词条不计分。 */
function curScoreOf(pos, pool) {
  let base = 0;
  for (let k = 0; k < 4; k++) {
    const name = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value || '';
    const hit = Number(document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value) || 0;
    if (!name || !hit) continue;
    const idx = DISC_SUBSTATS.indexOf(name);
    base += hit * (pool[idx]?.score || 0);
  }
  return base;
}

/** 该位置当前盘每词条的最低命中次数（typeIndex → hit，0 = 无约束），供保词条版概率用。
 *  只收集「价值权重 > 0」的词条（无效词条不要求新盘包含/保持）；
 *  比较按词条类型匹配（新盘副词条槽位顺序与当前盘无关）。 */
function curMinHitsOf(pos, pool) {
  const mh = new Array(DISC_SUBSTATS.length).fill(0);
  for (let k = 0; k < 4; k++) {
    const name = document.querySelector(`.dp-slot-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value || '';
    const hit = Number(document.querySelector(`.dp-hit-sub[data-pos="${pos}"][data-sub="${k}"]`)?.value) || 0;
    if (!name || !hit) continue;
    const idx = DISC_SUBSTATS.indexOf(name);
    if (!(pool[idx]?.score > 0)) continue; // 只考虑权重 > 0 的词条
    mh[idx] = Math.max(mh[idx], hit);
  }
  return mh;
}

/** 读取表单 → 计算 6 位置「比当前盘更好」概率 → 渲染结果 */
export function dpCalc() {
  const pool = DISC_SUBSTATS.map((_, i) => ({
    typeIndex: i,
    score: Number(document.querySelector(`.dp-w[data-idx="${i}"]`)?.value) || 0,
    rest: 1, // 同盘副词条不重复（库存固定 1，不再提供编辑）
    specialWeight: DISC_SUBSTAT_SPECIAL_WEIGHTS[i],
  }));
  let tot1 = 0;
  let tot2 = 0;
  const rows = [];
  const detailRows = [];
  const chartItems = [];
  for (const pos of [1, 2, 3, 4, 5, 6]) {
    const goal = curScoreOf(pos, pool);
    const minHits = curMinHitsOf(pos, pool);
    // 目标主词条（456，默认 = 当前主词条）：计算「超过」时主词条限定，未选 = 全部主词条加权
    const target = document.querySelector(`.dp-target-main[data-pos="${pos}"]`)?.value;
    const mains = target ? [target] : [];
    // 定向主词条（道具，全部盘，默认不限）：选定时位置与主词条必出（消除 1/6 与主词条概率）
    const dirMain = document.querySelector(`.dp-dir-main[data-pos="${pos}"]`)?.value;
    const opts = dirMain ? { posFixed: dirMain } : {};
    // 定向副词条（每盘 ≤2，需先定向主词条，默认不定向）：要求新盘首 4 词条必须包含
    const dirSubs = [0, 1]
      .map((k) => document.querySelector(`.dp-dir-sub[data-pos="${pos}"][data-k="${k}"]`)?.value)
      .filter(Boolean)
      .map((n) => DISC_SUBSTATS.indexOf(n));
    // 概率①：新盘总分超过当前盘；概率②：当前盘权重>0 的副词条在新盘中命中不缩水 且 总分超过
    // 未定向：已含「位置随机 1/6」与 456 主词条概率加权；定向后两者均消除
    const { prob, hitMain, p4, p3 } = computePosProb(pos, mains, pool, goal, dirSubs, opts);
    const { prob: probKeep } = computePosProbKeep(pos, mains, pool, goal, minHits, dirSubs, opts);
    tot1 += prob;
    tot2 += probKeep;
    chartItems.push({ pos, prob, probKeep });
    rows.push(
      `<tr><td>${pos}号位</td><td class="dp-cur">${goal.toFixed(2)}</td>` +
        `<td class="dp-prob">${(prob * 100).toFixed(4)}%</td>` +
        `<td class="dp-prob dp-prob-keep">${(probKeep * 100).toFixed(4)}%</td></tr>`
    );
    detailRows.push(
      `<tr><td>${pos}号位</td><td class="dp-prob">${(hitMain * 100).toFixed(2)}%</td>` +
        `<td class="dp-prob">${(p4 * 100).toFixed(4)}%</td>` +
        `<td class="dp-prob">${(p3 * 100).toFixed(4)}%</td></tr>`
    );
  }
  // 总计：随机掉落一个盘（位置 1-6 等概率 1/6），比当前对应位置盘更好的总概率
  rows.push(
    `<tr class="dp-total"><td>总计（随机位置）</td><td>—</td>` +
      `<td class="dp-prob">${(tot1 * 100).toFixed(4)}%</td>` +
      `<td class="dp-prob dp-prob-keep">${(tot2 * 100).toFixed(4)}%</td></tr>`
  );
  const tip =
    '<b>结果说明</b><br><span style="color:var(--dim)">每位置两个概率：<br>① 超过：新掉落驱动盘（随机掉落 + 强化）副词条价值分<b>超过当前盘</b>的概率；<br>② 保词条：新盘<b>包含当前盘全部权重>0 的副词条（按类型匹配，槽位顺序无关）且各自命中数不低</b>、同时总分超过的概率（更严格，通常更低）。<br>未定向时已含<b>位置随机 1/6</b> 与 456 目标主词条概率加权；<b>定向主词条</b>（道具）= 位置与主词条必出，两者消除；定向副词条需先定向主词条。<br><b>中间输出</b>：抽中号位主词条（未定向；定向 = 100%）；初始 4/3 词条升满超过为<b>纯条件概率</b>（不含抽中号位主词条、不含分支占比），总概率 = 抽中号位主词条 × (0.2×4词条 + 0.8×3词条)。</span>';
  document.getElementById('dpResult').innerHTML =
    `<h4 data-detail="${escapeHtml(tip)}">各位置刷到更好盘的概率</h4>` +
    `<div class="dp-result-table"><table class="rec-table"><thead><tr><th>位置</th><th>当前分</th><th>超过</th><th>保词条超过</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` +
    `<h4 class="dp-detail-title">中间输出（4/3 词条为纯条件概率，不含抽中号位主词条与分支占比）</h4>` +
    `<div class="dp-result-table"><table class="rec-table"><thead><tr><th>位置</th><th>抽中号位主词条</th><th>初始4词条升满超过</th><th>初始3词条升满超过</th></tr></thead><tbody>${detailRows.join('')}</tbody></table></div>` +
    `<div class="dp-result-chart">${chartBox('dp-prob', 320)}</div>`;
  // 概率对比柱状图（dpResult 内手动挂载）
  registerChart('dp-prob', dpProbBarOption(chartItems));
  mountDpChart('dp-prob', dpProbBarOption(chartItems));
}

registerZZZ({ dpSetRole, dpCalc, dpSubChange, dpHitChange, dpDirChange });
