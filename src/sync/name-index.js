// src/sync/name-index.js —— 读取 library.json（标准名权威源）并构建三类名称索引（char/wengine/disc）
// 供同步脚本写时归一（characters / plans）复用；library 缺失/损坏时返回 null（调用方降级为不归一）。
import fs from 'node:fs';
import path from 'node:path';
import { buildNameIndex, CATEGORY } from '../lib/names.js';
import { DATA_DIR } from '../lib/node.js';

/**
 * 加载并构建 char / wengine / disc 三类名称索引。
 * @param {string} [what] 用于 warning 文案的实体描述（如「账号音擎/驱动盘名」「推荐方案名称」）
 * @returns {{char:object, wengine:object, disc:object}|null}  失败返回 null
 */
export function loadNameIndexes(what = '名称') {
  try {
    const lib = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'library.json'), 'utf8'));
    return {
      char: buildNameIndex(lib.characters || {}, CATEGORY.CHAR),
      wengine: buildNameIndex(lib.wengines || {}, CATEGORY.WENGINE),
      disc: buildNameIndex(lib.discs || {}, CATEGORY.DISC),
    };
  } catch {
    console.warn(`⚠️ library.json 缺失/损坏，${what}跳过归一（建议先 npm run sync:library）`);
    return null;
  }
}
