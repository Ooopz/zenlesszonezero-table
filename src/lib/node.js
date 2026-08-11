// src/lib/node.js —— Node 专属工具（依赖 node:child_process / node:fs 等，不要被浏览器 import）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { warnIfInvalid } from './schema.js';

/** 跨平台打开浏览器（Windows: start / macOS: open / Linux: xdg-open） */
export function openBrowser(url) {
  try {
    if (process.platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch {
    console.log(`  未能自动打开浏览器，请手动访问: ${url}`);
  }
}

// ---------- 同步脚本共用样板（三个 src/sync/* 脚本原各有一份，统一收敛于此） ----------

/** 项目根目录（本文件位于 src/lib/ 下，向上两级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** data/ 数据目录（同步脚本写 data/*.json 用） */
export const DATA_DIR = path.join(ROOT, 'data');

/** ESM 入口判断：仅当直接运行该脚本文件时执行 run()。
 *  用法：isMain(import.meta, () => main())；main 的异常由这里统一捕获并 exit(1)。 */
export function isMain(meta, run) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta.url))
    run().catch((e) => {
      console.error('运行出错:', e.message);
      process.exit(1);
    });
}

/** 校验 + 写入 data/ 下的 JSON 文件（sync 脚本收尾共用）。
 *  validate 提供校验函数时先 warnIfInvalid（strict 为 true 则抛错中断）；
 *  pretty 为 false 时用紧凑格式——library.json 嵌套 5 层，pretty 会膨胀到 ~11MB，紧凑仅 ~3.5MB。 */
export function writeDataFile(file, data, { label = '', validate = null, strict = false, pretty = true } = {}) {
  if (validate) warnIfInvalid(label, validate(data), { strict });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, file), pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf-8');
}
