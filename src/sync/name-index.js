// src/sync/name-index.js —— 读 library.json（标准名权威源）建 char/wengine/disc 三类名称索引，供同步脚本写时归一复用；library 缺失/损坏返回 null（调用方降级为不归一）
import fs from 'node:fs';
import path from 'node:path';
import { buildNameIndex, resolveEntry, CATEGORY } from '../lib/names.js';
import { DATA_DIR } from '../lib/node.js';

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

/** 音擎名解析：工坊名 → library 标准名（workshop/workshop-stats 共用；libWengines 为 loadNameIndexes 的 wengine 索引） */
export function resolveWengineName(libWengines, rawName) {
  return resolveEntry(CATEGORY.WENGINE, libWengines, rawName);
}
