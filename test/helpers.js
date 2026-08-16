// test/helpers.js —— 测试共用工具
// data/ 目录不入版本库，依赖真实数据的测试需要先运行同步脚本生成数据文件。
//
// 缺数据时的行为（两种，由 REQUIRE_DATA 环境变量切换）：
//   默认      —— 打印醒目的 SKIP 横幅后 exit(0)，让本地缺数据时仍能跑其余测试文件；
//   REQUIRE_DATA=1 —— exit(1)，缺数据即失败。
//
// ⚠️ 为什么需要 REQUIRE_DATA：node --test 把「加载后直接 exit(0) 的文件」记成 1 个通过的测试，
//    于是 `npm test` 在数据齐全（如 calc.test.js 23 个断言）与数据全缺（1 个空壳）两种情况下
//    都输出全绿，**无法从结果区分「测试通过」与「测试根本没跑」**。横幅让人眼能看见，
//    REQUIRE_DATA=1 让 CI/校验场景能强制要求真跑。
//
// 注：node --test 每个测试文件运行在独立子进程，process.exit 只结束当前文件。

import { readFileSync } from 'node:fs';

/** 缺数据时是否直接失败（CI / 想确认测试真的跑了时设 REQUIRE_DATA=1） */
const REQUIRE_DATA = process.env.REQUIRE_DATA === '1';

/** 读取 data/ 下的 JSON 数据文件；缺失或损坏时打印 SKIP 横幅并结束当前测试文件。 */
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
