// 「会话标题前缀」的定向验收。
//
// 单测已锁住纯函数与持久化，但真正危险的是**渲染层把前缀写回存储**：
// 侧栏展示、重命名对话框预填、以及 sessions.json 里的 title。这三条只有真跑浏览器才看得见。
//
// 用法：node scripts/check-title-prefix.mjs（需先 npm run build:ui）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const PORT = 5231, WS_PORT = 5232, TOKEN = 'prefixtest';
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(p => fs.existsSync(p));

let bad = 0;
const ok = (cond, message) => { console.log((cond ? '  ok ' : '  x ') + message); if (!cond) bad++; };

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('先跑 npm run build:ui'); process.exit(2); }
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'title-prefix-'));
const APP = path.join(DATA, 'WebDecryptHub');
fs.mkdirSync(APP, { recursive: true });
// 起点必须是「没有配置前缀」，这样才能证明后面的前缀是用户改设置改出来的。
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({ provider: 'openai', headless: true, embedMode: 'screencast' }));

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'],
});
let sidecarErr = '';
sidecar.stderr.on('data', d => { sidecarErr += String(d); });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('sidecar 未就绪：' + sidecarErr.slice(0, 600))), 25000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } });
});

// 一条长连接发 invoke，按 id 收结果。
const rpc = (channel, args = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:' + WS_PORT + '/?token=' + TOKEN);
  const timer = setTimeout(() => { ws.terminate(); reject(Error('RPC timeout: ' + channel)); }, 30000);
  ws.once('open', () => ws.send(JSON.stringify({ type: 'invoke', id: 1, channel, args })));
  ws.on('message', raw => { const message = JSON.parse(raw); if (message.id !== 1) return; clearTimeout(timer); ws.close(); message.error ? reject(Error(message.error)) : resolve(message.result); });
  ws.once('error', error => { clearTimeout(timer); reject(error); });
});
// 跳过首次引导，避免弹层抢时序。
await rpc('save-settings', { onboarding: { version: 1, completedAt: new Date().toISOString() } }).catch(error => console.error('save onboarding:', error.message));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

const storedTitles = () => {
  const file = path.join(APP, 'sessions.json');
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')).sessions || []).map(s => ({ title: s.title, titleSource: s.titleSource }));
};
const readSettings = () => JSON.parse(fs.readFileSync(path.join(APP, 'settings.json'), 'utf8'));

try {
  await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN);
  await page.locator('.stage-head').waitFor();

  // 造一个真实项目和一个占位会话，避免依赖原生选目录对话框。
  const scope = 'title-prefix-check';
  const root = path.join(DATA, 'project');
  fs.mkdirSync(root);
  const grant = { sessionId: scope, path: root, expiresAt: Date.now() + 60000 };
  grant.signature = folderProof(TOKEN, grant);
  const project = await rpc('project-save', { scope, project: { name: '标题前缀验收', folders: [{ key: 'main', grant }], primaryKey: 'main' } });
  const created = await rpc('session-create', { projectId: project.id });
  await rpc('session-focus', { sessionId: created.id });
  ok(!/^(?:\[)/.test(created.title), '新建会话的 title 必须是干净的占位名（实际 ' + JSON.stringify(created.title) + '）');

  // 未配置前缀时，侧栏显示的就是存储标题本身。
  await page.reload();
  await page.locator('.rail').waitFor();
  const item = page.locator('.session-item', { hasText: created.title }).first();
  await item.waitFor({ timeout: 15000 });
  ok((await item.locator('.session-text strong').innerText()) === created.title, '未配置前缀时侧栏显示原题');

  // 设置 → 运行参数 → 会话标题前缀
  const openRuntime = async () => {
    const already = await page.locator('.settings-nav').count();
    if (!already) {
      await page.locator('.rail-bottom .rail-account').click();
      await page.getByRole('menuitem', { name: /^设置/ }).click();
    }
    await page.locator('.settings-nav').waitFor();
    await page.locator('.settings-nav').getByRole('button', { name: '运行参数', exact: true }).click();
  };
  const saveSettings = async () => {
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.save-bar').waitFor({ state: 'detached', timeout: 10000 });
  };

  await openRuntime();
  const field = page.getByRole('textbox', { name: '会话标题前缀', exact: true });
  await field.waitFor({ timeout: 8000 });
  ok((await field.inputValue()) === '', '前缀默认应为空');
  await field.fill('[分析]');
  await saveSettings();

  ok(readSettings().titlePrefix === '[分析]', '前缀应写入 settings.json（实际 ' + JSON.stringify(readSettings().titlePrefix) + '）');
  // 关键断言：设置里存了前缀，但会话表里的 title 必须一字不变。
  ok(storedTitles().every(s => s.title === created.title), '保存设置不得改写任何 title：' + JSON.stringify(storedTitles()));

  // 回到对话页看展示效果
  await page.locator('.screen-head button').first().click();
  const prefixed = page.locator('.session-item', { hasText: created.title }).first();
  await prefixed.waitFor({ timeout: 10000 });
  const label = await prefixed.locator('.session-text strong').innerText();
  ok(label === '[分析] ' + created.title, '侧栏应显示「前缀 + 原标题」（实际 ' + JSON.stringify(label) + '）');
  ok(storedTitles().every(s => !s.title.includes('[分析]')), '展示前缀不能进入持久化 title');

  // 重命名对话框必须预填「干净标题」，否则每次改名都会叠一层前缀。
  for (let round = 1; round <= 3; round++) {
    await prefixed.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
    const input = page.getByRole('textbox', { name: '会话名称', exact: true });
    await input.waitFor();
    const filled = await input.inputValue();
    ok(filled === created.title, '第 ' + round + ' 次重命名应预填干净标题（实际 ' + JSON.stringify(filled) + '）');
    await page.getByRole('button', { name: '保存名称', exact: true }).click();
    await input.waitFor({ state: 'detached', timeout: 8000 });
    ok(storedTitles().every(s => !s.title.includes('[分析]')), '第 ' + round + ' 次改名后 title 仍无前缀：' + JSON.stringify(storedTitles()));
  }
  // 三次改名之后，展示名仍只带一层前缀
  ok((await prefixed.locator('.session-text strong').innerText()) === '[分析] ' + created.title, '重复改名后展示名不得叠加前缀');

  // 清空前缀后应立刻回到原标题显示。
  await openRuntime();
  await page.getByRole('textbox', { name: '会话标题前缀', exact: true }).fill('');
  await saveSettings();
  ok(readSettings().titlePrefix === '', '清空后 settings.json 应为空串：' + JSON.stringify(readSettings().titlePrefix));
  await page.locator('.screen-head button').first().click();
  await page.locator('.session-item', { hasText: created.title }).first().waitFor({ timeout: 10000 });
  ok((await page.locator('.session-item', { hasText: created.title }).first().locator('.session-text strong').innerText()) === created.title, '清空前缀后应回到原标题');

  ok(pageErrors.length === 0, '页面不应有运行时错误：' + pageErrors.join(' | '));
  await page.screenshot({ path: path.join(ROOT, '.title-prefix-check.png') });
} catch (error) {
  console.error('  x ' + error.message);
  console.error('  页面文本：' + (await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
  bad++;
} finally {
  await context.close(); await browser.close();
  srv.close(); sidecar.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}

console.log(bad ? 'FAIL: ' + bad + ' 项' : 'OK: 会话标题前缀通过');
process.exit(bad ? 1 : 0);
