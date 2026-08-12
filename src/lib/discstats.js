// src/lib/discstats.js —— 驱动盘推荐统计（纯逻辑，Node 与浏览器共用）
// 数据源：data/plans.json（养成指南推荐方案，见 src/sync/plans.js 的 extractPlan）。
// 按驱动盘名聚合全部角色的推荐方案，统计「推荐方案里用到该盘（2件套或4件套）的角色」、
// 这些方案推荐的主/副词条出现频次（出现得越多的词条越通用、越值得留）、以及 4/5/6 号位主属性频次。
// 二件套按「效果」替代：同一 set2 效果的盘可互相替代（如 棘刺玫瑰/灵魂摇滚 都是 防御力0.16），
// 方案推荐二件套效果 X 时计入所有 set2 为 X 的盘（传 discSet2 时启用）。四件套效果无结构化数值，保持按套装名。
// 套装名解析统一走 src/lib/names.js 的 resolver（normalize + 别名，如 荆棘玫瑰→棘刺玫瑰、尾随空格）。
import { buildNameIndex, resolveName, CATEGORY } from './names.js';

/** set2 效果 → 规范化组键：null/空 → null（无二件套效果，自成组不扩展）；否则属性键排序后序列化 */
function set2Key(s2) {
  if (!s2 || typeof s2 !== 'object') return null;
  const entries = Object.entries(s2);
  if (!entries.length) return null;
  return JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Map<词条名, 次数> → 按出现次数降序的频次数组；ratio = 出现次数 / 方案总数（count） */
function freqList(freq, total) {
  return [...freq.entries()]
    .map(([name, count]) => ({ name, count, ratio: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 计算驱动盘统计表。
 *
 * @param {object} plans  { avatarId: { name, plans: [...] } }
 *   plan.sets = [{ name, cnt }]（cnt 为件数，2 或 4；2+2+2 / 4+2 组合就是多条）
 *   plan.subStats = [副词条名]
 *   plan.mainProps = { '4': 主属性名, '5': 名, '6': 名 }（键为字符串，值已百分比归一化）
 * @param {string[]} discNames  驱动盘全名单（library.discs 键），决定返回的行集合与顺序
 * @param {object} [discSet2]  { 规范盘名: set2效果对象 }（可选）。提供时启用二件套效果替代：
 *   方案推荐 2 件套盘时，同 set2 效果的所有盘都计入（该方案作为效果组的替代品）；不传则仅按套装名计入。
 * @returns {{name:string, count:number, alternatives:string[], characters:string[], subCombos:string[][],
 *            subStats:{name:string,count:number,ratio:number}[],
 *            main4:同上, main5:同上, main6:同上}[]}
 *   count：采用该盘（2 件套或其同效替代 / 4 件套）的方案总数，也是各频次的计数分母。
 *   alternatives：与该盘二件套效果相同的其他盘名（不含自己；set2 为 null 或无 discSet2 时为 []）。
 *   characters：匹配角色（去重）。
 *   subCombos：副词条组合（按方案去重，保留每组组合，供悬浮明细）。
 *   subStats / main4..6：词条/主属性出现频次，按出现次数降序（同频按首次出现顺序）。
 *   驱动盘未被任何方案采用时 count 为 0、各数组为空。
 */
export function computeDiscStats(plans, discNames, discSet2) {
  const index = buildNameIndex(discNames || [], CATEGORY.DISC);
  const acc = new Map();
  for (const name of discNames || []) {
    acc.set(name, {
      name,
      count: 0,
      chars: new Set(),
      combos: new Set(),
      subFreq: new Map(),
      mainFreq: { 4: new Map(), 5: new Map(), 6: new Map() },
    });
  }
  // 二件套效果组索引：set2Key → 规范盘名[]（仅 discNames 内、非 null set2 的盘）
  const groupByKey = discSet2 ? new Map() : null;
  if (groupByKey) {
    for (const name of discNames || []) {
      const k = set2Key(discSet2[name]);
      if (k == null) continue;
      if (!groupByKey.has(k)) groupByKey.set(k, []);
      groupByKey.get(k).push(name);
    }
  }
  for (const v of Object.values(plans || {})) {
    if (!v || !v.name || !Array.isArray(v.plans)) continue;
    for (const p of v.plans) {
      if (!p || !Array.isArray(p.sets)) continue;
      // 一个方案推荐的副词条/主属性属于整套配装，对方案里的每个套装都计入
      // 副词条组合去重：先排序再序列化，忽略组内顺序（如 暴击率/暴击伤害/攻击力% 与 暴击伤害/暴击率/攻击力% 视为同一组合）
      const comboKey = Array.isArray(p.subStats) && p.subStats.length ? JSON.stringify([...p.subStats].sort()) : null;
      // 收集本方案「计入口盘」（规范名，Set 去重）：4 件套按套装名；
      // 2 件套按 set2 效果扩展到同效果组。方案级去重避免重复计数：
      // 方案内两个同效果 2 件套只计一次；同一盘被 4 件套 + 2 件套替代同时命中只计一次。
      const hit = new Set();
      for (const s of p.sets) {
        if (!s || typeof s.name !== 'string' || (s.cnt !== 2 && s.cnt !== 4)) continue; // 只统计 2/4 件套
        // 套装名经 resolver 解析为标准盘名（别名/尾随空格/标点差异）；未命中跳过
        const name = resolveName(CATEGORY.DISC, index, s.name)?.name;
        if (!name || !acc.has(name)) continue;
        if (s.cnt === 4 || !groupByKey) {
          hit.add(name);
          continue;
        }
        // 2 件套：set2 为 null（无二件套效果）→ 仅自己；否则扩展到同效果组所有盘
        const k = set2Key(discSet2?.[name]);
        if (k == null) {
          hit.add(name);
          continue;
        }
        for (const other of groupByKey.get(k) || []) hit.add(other);
      }
      for (const hn of hit) {
        const a = acc.get(hn);
        a.count += 1;
        a.chars.add(v.name);
        if (comboKey) a.combos.add(comboKey);
        for (const t of p.subStats || []) a.subFreq.set(t, (a.subFreq.get(t) || 0) + 1);
        for (const k of [4, 5, 6]) {
          const m = p.mainProps?.[k];
          if (m) a.mainFreq[k].set(m, (a.mainFreq[k].get(m) || 0) + 1);
        }
      }
    }
  }
  return [...acc.values()].map((a) => {
    // 同效果二件套替代盘（不含自己；set2 为 null 或无 discSet2 时为 []）
    let alternatives = [];
    if (groupByKey) {
      const k = set2Key(discSet2?.[a.name]);
      if (k != null) alternatives = (groupByKey.get(k) || []).filter((nm) => nm !== a.name);
    }
    return {
      name: a.name, // library 规范名
      alternatives,
      count: a.count,
      characters: [...a.chars],
      subCombos: [...a.combos].map((k) => JSON.parse(k)),
      subStats: freqList(a.subFreq, a.count),
      main4: freqList(a.mainFreq[4], a.count),
      main5: freqList(a.mainFreq[5], a.count),
      main6: freqList(a.mainFreq[6], a.count),
    };
  });
}
