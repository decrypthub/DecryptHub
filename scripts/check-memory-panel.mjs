// 设置 →「记忆与技能」标签页的定向验收。
//
// 只验证这个页面的一条行为链：标签页可进入、列表能读到 sidecar 里真实存在的记忆与技能、
// 系统记忆只显示来源而不显示正文、删除走确认且能真正移除条目。
// 不锁像素长相 —— 那是看出来的，不是断言出来的。
//
// 用法：node scripts/check-memory-panel.mjs（需先 npm run build:ui）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const PORT = 5221, WS_PORT = 5222;
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

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-panel-'));
const APP = path.join(DATA, 'WebDecryptHub');
fs.mkdirSync(APP, { recursive: true });
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({ provider: 'openai', headless: true, embedMode: 'screencast' }));

// 预置两条真实内容：一条全局记忆、一个技能。它们必须能被设置页读到。
const seed = (kind, name, body) => {
  const dir = path.join(APP, 'extensions', 'user', 'global', kind);
  fs.mkdirSync(kind === 'skill' ? path.join(dir, name) : dir, { recursive: true });
  fs.writeFileSync(kind === 'skill' ? path.join(dir, name, 'SKILL.md') : path.join(dir, name + '.md'), body);
};
seed('memory', 'device-adb-fact', '这台手机可以用 adb 直接操作：dump 界面层级后再点击，不要凭屏幕尺寸估算坐标。');
seed('skill', 'check-ui-gate', '---\nname: check-ui-gate\ndescription: 卡在协议页时先用 uiautomator 确认\n---\n\n先读界面层级，再决定是否点击。');

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: 'memptest' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let sidecarErr = '';
sidecar.stderr.on('data', d => { sidecarErr += String(d); });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('sidecar 未就绪：' + sidecarErr.slice(0, 400))), 25000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } });
});

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

try {
  await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=memptest');
  await page.locator('.stage-head').waitFor();
  // 首次运行会先弹引导。按钮不是随页面一起出现的，直接 count() 会读到 0 而跳过，
  // 随后所有断言都会打在引导页上；这里等一小段时间再判断。
  const skip = page.getByRole('button', { name: '稍后', exact: true });
  await skip.waitFor({ timeout: 4000 }).catch(() => {});
  if (await skip.count()) await skip.click();
  await page.locator('.rail-bottom .rail-account').waitFor({ timeout: 15000 });

  await page.locator('.rail-bottom .rail-account').click();
  await page.getByRole('menuitem', { name: /^设置/ }).click();
  await page.locator('.settings-nav').waitFor();

  const memoryTab = page.locator('.settings-nav button', { hasText: '记忆与技能' });
  const tabCount = await memoryTab.count();
  ok(tabCount === 1, '设置页应有一个「记忆与技能」标签（实际 ' + tabCount + '）');
  await memoryTab.first().click();
  await page.getByRole('heading', { name: '记忆与技能', exact: true }).waitFor();

  // 记忆默认可见，且能显示预置的全局条目与它的作用域。
  await page.getByText('device-adb-fact', { exact: true }).waitFor();
  ok(await page.getByText('全局 · 所有项目', { exact: false }).count() >= 1, '全局记忆应标注作用域');
  ok(await page.getByText('这台手机可以用 adb 直接操作', { exact: false }).count() === 1, '应显示记忆摘要');

  // 技能页签只显示技能，不能串到记忆。
  await page.getByRole('button', { name: '技能', exact: true }).click();
  await page.getByText('check-ui-gate', { exact: true }).waitFor();
  ok(await page.getByText('device-adb-fact', { exact: true }).count() === 0, '切到技能后不应再显示记忆条目');

  // 查看内容
  await page.getByRole('button', { name: '查看技能 check-ui-gate', exact: true }).click();
  await page.getByText('先读界面层级', { exact: false }).waitFor();
  ok(true, '技能内容可展开阅读');

  // 系统记忆区：只报告来源与不可编辑状态，不能把正文漏给界面。
  ok(await page.getByText('系统记忆', { exact: true }).count() === 1, '应有系统记忆说明区');
  ok(await page.getByText('产品内置归因纪律', { exact: true }).count() === 1, '应列出内置系统记忆来源');
  ok(await page.getByText('不可编辑', { exact: false }).count() >= 1, '系统记忆必须标注不可编辑');
  ok(await page.getByText('同一个现象通常有平淡的解释', { exact: false }).count() === 0, '系统记忆正文不应出现在设置页');

  // 删除：确认后条目真正消失，作用域目录仍保留。
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: /确认操作/ });
  await dialog.waitFor();
  ok(await dialog.getByText(/无法恢复/).count() === 1, '删除确认要说明不可恢复');
  await dialog.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByText('check-ui-gate', { exact: true }).waitFor({ state: 'detached', timeout: 8000 });
  const skillDir = path.join(APP, 'extensions', 'user', 'global', 'skill', 'check-ui-gate');
  ok(!fs.existsSync(skillDir), '删除后技能目录应被移除');
  ok(fs.existsSync(path.join(APP, 'extensions', 'user', 'global', 'skill')), '作用域根目录必须保留');

  ok(pageErrors.length === 0, '页面不应有运行时错误：' + pageErrors.join(' | '));
  await page.screenshot({ path: path.join(ROOT, '.memory-panel-check.png') });
} catch (error) {
  console.error('  x ' + error.message);
  console.error('  页面文本：' + (await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
  bad++;
} finally {
  await context.close(); await browser.close();
  srv.close(); sidecar.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}

console.log(bad ? 'FAIL: ' + bad + ' 项' : 'OK: 记忆与技能页通过');
process.exit(bad ? 1 : 0);
