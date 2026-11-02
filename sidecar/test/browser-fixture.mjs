// 真实浏览器测试的启动器：需要真实 layout 的断言（滚动、渲染）用它，不要各写一份探测。
//
// 为什么要探测而不是直接 chromium.launch()：patchright 只在装过浏览器之后才能无参启动，
// 而 CI runner（ubuntu-latest / windows-latest）与全新 clone 都没有装。曾经因此让
// 5 个用例在 CI 上是「红」的，而代码完全正常——假红比不测更糟，因为它会训练人忽略红灯。
//
// 优先级：
//   1. WDH_TEST_EXECUTABLE：显式指定，CI 或特殊机器用。
//   2. CHROME_PATH：与 scripts/check-ui.mjs 同一个约定，本机开发保持一致。
//   3. 常见系统 Chrome/Edge 安装位置。
// 都找不到时调用方应跳过用例并说明原因，而不是报失败。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  path.join(os.homedir(), 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** 返回可用的浏览器可执行文件路径；找不到返回 null。 */
export function findBrowser() {
  const explicit = [process.env.WDH_TEST_EXECUTABLE, process.env.CHROME_PATH].filter(Boolean);
  for (const candidate of explicit) if (fs.existsSync(candidate)) return candidate;
  return CANDIDATES.find(candidate => fs.existsSync(candidate)) || null;
}

/**
 * 启动浏览器。返回 { browser, executablePath }；没有可用浏览器时返回 { browser: null, reason }。
 * 调用方用 t.skip(reason) 跳过，让「没装浏览器」表现为 skip 而不是 fail。
 */
export async function launchBrowser({ chromium, ...options } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) {
    return {
      browser: null,
      reason: '找不到 Chrome/Edge，设置 CHROME_PATH 或 WDH_TEST_EXECUTABLE 后重跑（该用例需要真实浏览器）',
    };
  }
  const browser = await chromium.launch({ headless: true, executablePath, ...options });
  return { browser, executablePath };
}
