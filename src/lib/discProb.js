// src/lib/discProb.js —— 驱动盘练度提升概率计算（双端共享纯逻辑，Node 与浏览器共用）
// 移植自 qfmyqqx.github.io/ZZZ-DDC（绝区零驱动盘练度提升概率计算器）。
// ⚠️ 自 2026-12 起：生成模型（B 组：首 4 词条枚举/强化成长/4-3 词条占比/主词条加权/位置系数/定向）、
// 权重来源（D 组）、保词条比较（E 组）的权威实现已收敛到 discRules.js（规则 A-H 编号见其顶部注释）。
// 本文件保留：练度评级（GRADE_TABLE/gradeOf，ZZZ-DDC 阈值口径）与历史别名导出（ENTRY_NAMES 等），
// 其余全部 re-export 自 discRules.js，保持既有 import 链（web/discProb.js、test/discProb.test.js）不变。

import { DISC_SUBSTATS, DISC_SUBSTAT_SPECIAL_WEIGHTS } from './discRules.js';

/** 副词条 10 维（名称顺序即 DISC_SUBSTATS）——历史别名 */
export const ENTRY_NAMES = DISC_SUBSTATS;
export { DISC_SUBSTAT_SPECIAL_WEIGHTS as SUBSTAT_SPECIAL_WEIGHTS };

// ---------- 生成模型 / 权重 / 保词条：权威在 discRules.js，此处 re-export ----------
export {
  // B：生成模型
  FOUR_SUB_CHANCE,
  THREE_SUB_CHANCE,
  FOUR_SUB_TIMES,
  THREE_SUB_TIMES,
  passChance,
  buildTypes,
  computeDiscProb,
  computePosProb,
  // D：权重来源
  DEFAULT_WEIGHTS,
  roleWeightsFromWs,
  // E：保词条比较
  computeDiscProbKeep,
  computePosProbKeep,
} from './discRules.js';

// ---------- 练度评级（概率越低 = 目标分越高 = 越接近毕业） ----------
export const GRADE_TABLE = {
  123: [
    [0.003, '完美毕业', 'var(--red)'],
    [0.033, '大毕业', 'var(--hazard)'],
    [0.064, '小毕业', 'var(--purple)'],
    [0.12, '能用', 'var(--blue)'],
    [Infinity, '可提升空间极大', 'var(--dim)'],
  ],
  456: [
    [0.08, '完美毕业', 'var(--red)'],
    [0.17, '大毕业', 'var(--hazard)'],
    [0.24, '小毕业', 'var(--purple)'],
    [0.48, '能用', 'var(--blue)'],
    [Infinity, '可提升空间极大', 'var(--dim)'],
  ],
};
export function gradeOf(prob, pos) {
  const table = pos <= 3 ? GRADE_TABLE['123'] : GRADE_TABLE['456'];
  for (const [th, label, color] of table) {
    if (prob <= th) return { label, color };
  }
  return { label: '可提升空间极大', color: 'var(--dim)' };
}
