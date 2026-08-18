// test/helpers.js —— 测试共用工具；data/ 不入版本库，依赖真实数据的测试先运行同步脚本。
// ⚠️ node --test 把「加载后 exit(0) 的文件」记成 1 个通过的测试：缺数据默认打 SKIP 横幅后 exit(0)，
//    与真正全绿无法从结果区分；REQUIRE_DATA=1 时缺数据直接 exit(1)。node --test 每文件独立子进程，exit 只结束当前文件。

import { readFileSync } from 'node:fs';

const REQUIRE_DATA = process.env.REQUIRE_DATA === '1';

export function loadDataFile(name, hint) {
  try {
    return JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf-8'));
  } catch {
    const file = process.argv[1]?.split(/[\\/]/).pop() || '当前测试文件';
    console.error(`\n${'='.repeat(64)}`);
    console.error(`  ⚠️  SKIP: ${file} —— 缺少 data/${name}，本文件的测试【未运行】`);
    console.error(`  请先更新数据：${hint}`);
    if (!REQUIRE_DATA) console.error(`  （想让缺数据直接判失败：REQUIRE_DATA=1 npm test）`);
    console.error(`${'='.repeat(64)}\n`);
    process.exit(REQUIRE_DATA ? 1 : 0);
  }
}
