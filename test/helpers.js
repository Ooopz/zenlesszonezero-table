// test/helpers.js —— 测试共用工具
// data/ 目录不入版本库，依赖真实数据的测试需要先运行同步脚本生成数据文件；
// 数据缺失/损坏时打印「先更新数据」提示并结束当前测试文件。
// 注：node --test 每个测试文件运行在独立子进程，process.exit 不影响其他测试文件。

import { readFileSync } from 'node:fs';

/** 读取 data/ 下的 JSON 数据文件；缺失或损坏时打印提示（含更新命令）并结束当前测试文件。 */
export function loadDataFile(name, hint) {
  try {
    return JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf-8'));
  } catch {
    console.error(`\n[test] 缺少 data/${name}，依赖真实数据的测试无法运行。`);
    console.error(`  请先更新数据：${hint}\n`);
    process.exit(0);
  }
}
