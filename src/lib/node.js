// src/lib/node.js —— Node 专属工具（依赖 node:child_process，不要被浏览器 import）
import { execSync } from 'node:child_process';

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
