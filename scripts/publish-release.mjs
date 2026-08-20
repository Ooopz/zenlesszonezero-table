// scripts/publish-release.mjs —— 本地构建 GitHub Pages 部署包并发布 GitHub Release
// （pages-from-release workflow 监听到 release 发布后自动部署到 Pages）
// 依赖：GitHub CLI（gh）已安装并登录（gh auth login）；构建期依赖 subset-font、rollup（devDependencies）。
// 用法：
//   node scripts/publish-release.mjs              # 构建 release/ + 发布新版本
//   node scripts/publish-release.mjs --no-build   # 跳过构建，只发布已存在的 release/
//   node scripts/publish-release.mjs --no-publish # 只构建 release/（本地预览用），不发布
// 产物：release/index.html（CSS/JS/数据/字体/图标全内联，即 Pages 入口）+ release/collect.js（采集书签）
// ⚠️ 首次使用：仓库 Settings → Pages → Source 选 "GitHub Actions"；否则 workflow 不会部署。
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = join(ROOT, 'release');
const DATA = join(ROOT, 'data');

// ================= 构建 =================
/** 生成 release/index.html + release/collect.js；library 保留 icon 本地路径 + iconUrl 远程链接（前端本地优先、缺图回退远程） */
async function buildRelease() {
  console.log('构建 GitHub Pages 部署包 → release/index.html + release/collect.js');
  rmSync(REL, { recursive: true, force: true });
  mkdirSync(REL, { recursive: true });

  // 1. 数据（plans slim 去 desc/skills）
  const slimPlans = (plans) => {
    const out = {};
    for (const [id, v] of Object.entries(plans || {})) {
      out[id] = { ...v, plans: (v.plans || []).map((p) => { const q = { ...p }; delete q.desc; delete q.skills; return q; }) };
    }
    return out;
  };
  const data = {
    library: JSON.parse(readFileSync(join(DATA, 'library.json'), 'utf8')),
    plans: slimPlans(JSON.parse(readFileSync(join(DATA, 'plans.json'), 'utf8'))),
    workshopGrad: JSON.parse(readFileSync(join(DATA, 'workshop-grad.json'), 'utf8')),
    workshopStats: JSON.parse(readFileSync(join(DATA, 'workshop-stats.json'), 'utf8')),
  };
  const dataJs = 'window.__STATIC_DATA__=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';';
  console.log('  数据: library', Object.keys(data.library.characters || {}).length, '角色 / plans', Object.keys(data.plans || {}).length, '角色');

  // 2. 字体子集化（Noto Sans SC → 仅项目出现的字符；Barlow 拉丁字重小保留原样）
  const collectChars = () => {
    const set = new Set();
    for (let c = 32; c <= 126; c++) set.add(String.fromCharCode(c));
    const roots = [join(ROOT, 'index.html'), join(ROOT, 'style.css'), join(ROOT, 'src')];
    const walk = (p) => {
      if (statSync(p).isDirectory()) {
        for (const f of readdirSync(p)) if (f !== 'vendor') walk(join(p, f));
        return;
      }
      if (!/\.(js|html|css)$/.test(p)) return;
      try { for (const ch of readFileSync(p, 'utf8')) set.add(ch); } catch { /* ignore */ }
    };
    for (const r of roots) walk(r);
    for (const f of ['library.json', 'plans.json', 'workshop-stats.json', 'workshop-grad.json', 'workshop-weights.json']) {
      try { for (const ch of readFileSync(join(DATA, f), 'utf8')) set.add(ch); } catch { /* ignore */ }
    }
    return set;
  };
  {
    const chars = collectChars();
    console.log('  字体子集字符数:', [...chars].length);
    try {
      const subsetFont = (await import('subset-font')).default;
      const src = readFileSync(join(ROOT, 'src/fonts/NotoSansSC-Variable.ttf'));
      const out = await subsetFont(src, [...chars].join(''), { targetFormat: 'truetype' });
      writeFileSync(join(REL, '_noto-subset.ttf'), out);
      console.log('  Noto Sans SC 子集化:', src.length, '→', out.length, 'bytes');
    } catch (e) {
      console.warn('  ⚠️ 字体子集化失败（' + (e && e.message) + '），用原字体（更大）。');
      cpSync(join(ROOT, 'src/fonts/NotoSansSC-Variable.ttf'), join(REL, '_noto-subset.ttf'));
    }
  }

  // 3. rollup 打包前端 ESM → IIFE 经典脚本
  const { rollup } = await import('rollup');
  const bundle = await rollup({ input: join(ROOT, 'src/web/main.js') });
  const { output } = await bundle.generate({ format: 'iife' });
  let appJs = output[0].code;
  await bundle.close();

  // 4. 技能图标 base64 内联（JS 里硬编码 '/src/img/xxx.png' → data URL）
  {
    const ICONS = ['normal', 'dodge', 'support', 'special', 'ultimate', 'passive', 'bangboo-active', 'bangboo-passive', 'bangboo-chain'];
    for (const name of ICONS) {
      const p = join(ROOT, 'src/img', name + '.png');
      if (!existsSync(p)) continue;
      const b64 = readFileSync(p).toString('base64');
      appJs = appJs.split(`'/src/img/${name}.png'`).join(`'data:image/png;base64,${b64}'`);
    }
  }

  // 5. 组装 index.html
  let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
  const FONTS = ['BarlowCondensed-SemiBold.ttf', 'BarlowCondensed-Bold.ttf', 'BarlowCondensed-Black.ttf'];
  const fontB64 = {};
  for (const f of FONTS) fontB64[f] = readFileSync(join(ROOT, 'src/fonts', f)).toString('base64');
  fontB64['NotoSansSC-Variable.ttf'] = readFileSync(join(REL, '_noto-subset.ttf')).toString('base64');
  const cssInline = css.replace(/url\('src\/fonts\/([^']+)'\)/g, (m, f) => `url('data:font/ttf;base64,${fontB64[f] || ''}')`);
  const escScript = (code) => code.replace(/<\/script/gi, '<\\/script');
  const vendor = (f) => escScript(readFileSync(join(ROOT, 'src/vendor', f), 'utf8'));
  const faviconB64 = readFileSync(join(ROOT, 'src/img/logo.webp')).toString('base64');
  html = html
    .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/webp" href="data:image/webp;base64,${faviconB64}" />`)
    // header 左上角 logo（同一文件）也内联：相对路径在 Pages 域名下会 404
    .replace(/src="src\/img\/logo\.webp"/, `src="data:image/webp;base64,${faviconB64}"`)
    .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${cssInline}\n</style>`)
    .replace(/<script src="\/src\/vendor\/echarts\.min\.js"><\/script>/, `<script>\n${vendor('echarts.min.js')}\n</script>`)
    .replace(/<script src="\/src\/vendor\/echarts-gl\.min\.js"><\/script>/, `<script>\n${vendor('echarts-gl.min.js')}\n</script>`)
    .replace('</head>', `  <script>window.__STATIC__ = true;\n${dataJs}</script>\n  </head>`)
    .replace(/<script type="module" src="\/src\/web\/main\.js"><\/script>/, `<script>\n${escScript(appJs)}\n</script>`);
  writeFileSync(join(REL, 'index.html'), html);
  rmSync(join(REL, '_noto-subset.ttf'), { force: true });

  // 6. collect.js（采集书签，独立文件：书签注入需要真实 URL）
  cpSync(join(ROOT, 'src/web/collect.js'), join(REL, 'collect.js'));

  // 7. 使用说明
  writeFileSync(
    join(REL, 'README.md'),
    `# 绝区零配装面板 · 部署包

由 \`node scripts/publish-release.mjs\` 生成（或 --no-publish 只构建）。

## 文件

- \`index.html\` —— 完整应用（数据/脚本/样式/字体全部内联），即 GitHub Pages 入口。
- \`collect.js\` —— 「我的角色」采集书签（与 index.html 同目录部署后由书签注入）。

## 部署（GitHub Release 方式，推荐）

1. 仓库 Settings → Pages → Source 选 \`GitHub Actions\`（一次性）；
2. 本地执行 \`node scripts/publish-release.mjs\`：构建 → \`gh release create\` 把 \`index.html\` 与 \`collect.js\` 作为附件上传；
3. \`.github/workflows/pages-from-release.yml\` 监听到 release 发布 → 下载附件 → 自动部署到 Pages。

之后每次数据更新：重跑 \`node scripts/publish-release.mjs\` 即可，无需提交任何代码。

## 我的角色导入

1. 打开部署后的页面 →「同步数据 → 数据导入」→ 把「采集我的角色」书签拖到书签栏；
2. 打开 \`user.mihoyo.com\`（米游社网页版，已登录）→ 点书签 → 自动抓取角色并复制到剪贴板；
3. 回到页面粘贴 → 导入（数据只存本浏览器 localStorage）。
`
  );

  // 8. 体积统计
  const size = statSync(join(REL, 'index.html')).size;
  console.log('\n构建完成！');
  console.log('  release/index.html:', (size / 1048576).toFixed(1), 'MB');
  console.log('  release/collect.js:', (statSync(join(REL, 'collect.js')).size / 1024).toFixed(1), 'KB');
}

// ================= 发布 =================
async function main() {
  if (!process.argv.includes('--no-build')) {
    console.log('① 构建 release/ …');
    await buildRelease();
  } else {
    console.log('① 跳过构建（--no-build）');
  }

  for (const f of ['index.html', 'collect.js']) {
    if (!existsSync(join(REL, f))) {
      console.error('缺少 release/' + f + '，请先构建（去掉 --no-build 或先跑一次完整命令）');
      process.exit(1);
    }
  }

  if (process.argv.includes('--no-publish')) {
    console.log('\n② 跳过发布（--no-publish）。release/ 已生成，可直接用本地 http 服务预览：cd release && npx serve');
    return;
  }

  // ② 打版本号：日期标签；同一天重复发布则加序号
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let tag = 'v' + date;
  try {
    execSync('gh release view ' + tag + ' --json tagName', { stdio: 'pipe' });
    let i = 2;
    while (true) {
      tag = 'v' + date + '-' + i;
      try {
        execSync('gh release view ' + tag + ' --json tagName', { stdio: 'pipe' });
        i++;
      } catch {
        break;
      }
    }
  } catch { /* 该 tag 不存在，直接用 */ }

  console.log('② 发布 Release ' + tag + ' …');
  execSync(
    `gh release create ${tag} "${join(REL, 'index.html')}" "${join(REL, 'collect.js')}" ` +
      `--title "配装面板 ${tag}" --notes "GitHub Pages 自动部署已触发（pages-from-release workflow）。"`,
    { cwd: ROOT, stdio: 'inherit' }
  );

  console.log('\n完成！Release ' + tag + ' 已发布，等待 Actions 自动部署到 Pages。');
  console.log('页面地址：https://<用户名>.github.io/<仓库名>/');
  console.log('采集书签：打开页面 →「同步数据 → 数据导入」→ 拖书签（collect.js 已随本次部署提供）。');
}
await main();
