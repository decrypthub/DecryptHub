// UI 体检：控件长相交给 Radix，这里只查两件框架管不到的事
//   1) 静态：基础控件不覆盖 Radix 内部类，也不恢复旧的自绘控件
//   2) 运行时：列表行 / 菜单项的「可点区域」必须等于可见区域
// 用法：node scripts/audit-ui.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const PORT = 5211, WS_PORT = 5212;
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(p => fs.existsSync(p));

let bad = 0;
const fail = m => { console.log('  x ' + m); bad++; };

// ---------- 1. 静态：不准自己画控件 ----------
const FORBIDDEN = [
  [/className=\{?"btn\b/, '.btn'],
  [/className=\{?"btn-primary/, '.btn-primary'],
  [/className=\{?"icon-btn/, '.icon-btn'],
  [/className=\{?"seg-ctl/, '.seg-ctl'],
  [/className=\{?"dd-btn/, '.dd-btn'],
  [/className=\{?"v2-/, 'v2-*'],
];
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(jsx|js)$/.test(e.name)) files.push(p); } })('ui/src');
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const [re, label] of FORBIDDEN) {
    const m = src.match(re);
    if (m) fail(f + ' 里还有旧的 ' + label + ' 类（第 ' + src.slice(0, m.index).split('\n').length + ' 行）');
  }
}
console.log('静态检查：扫了 ' + files.length + ' 个文件');

// Library upgrades must not depend on private control selectors or duplicated scales.
const css = fs.readFileSync(path.join(ROOT, 'ui/src/app.css'), 'utf8');
const privateControls = css.match(/\.rt-(?:Button|BaseButton|IconButton|SelectTrigger|SelectIcon|SelectItem|TextFieldRoot|TextFieldInput|TextArea|DropdownMenuItem|Card)\b/g) || [];
for (const selector of new Set(privateControls)) fail('app.css 覆盖组件内部类：' + selector);
if (/--(?:font-size-\d|radius-\d|base-button-|icon-button-ghost-|button-ghost-)/.test(css)) fail('app.css 重定义了组件库的尺寸体系');

// ---------- 2. 运行时：可点区域 ----------
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('先跑 npm run build:ui'); process.exit(2); }
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-'));
fs.mkdirSync(path.join(DATA, 'WebDecryptHub'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'WebDecryptHub', 'settings.json'), JSON.stringify({ provider: 'openai', headless: true, embedMode: 'screencast' }));
const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: path.join(DATA, 'WebDecryptHub'), JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: 'audit' }, stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('sidecar 未就绪')), 20000); sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } }); }).catch(e => { console.error(e.message); process.exit(2); });

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=audit', { waitUntil: 'load' });
await page.waitForTimeout(2200);
const skip = page.getByRole('button', { name: '稍后' });
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(300);

// 默认侧栏是收起的：审计需要列表行，先展开
const expandRail = page.getByRole('button', { name: '展开会话列表' });
if (await expandRail.count()) await expandRail.first().click();
await page.waitForTimeout(300);

const ROWS = '.rail-item, .session-focus, .prov-row, .task-row, .file-row, .req-row';
let scanned = 0;
const hit = async label => {
  const r = await page.evaluate(sel => {
    const out = []; let n = 0;
    for (const el of document.querySelectorAll(sel)) {
      const b = el.getBoundingClientRect(); const pr = el.parentElement.getBoundingClientRect();
      if (!b.height || !pr.width) continue;
      n++;
      if (b.width / pr.width < 0.9) out.push((el.textContent || '').trim().slice(0, 12) + ' ' + Math.round(b.width) + '/' + Math.round(pr.width));
    }
    return { n, out };
  }, ROWS);
  scanned += r.n;
  for (const o of r.out) fail(label + ': 可点区域偏小 ' + o);
};

await hit('对话');
await page.locator('.rail button', { hasText: '设置' }).first().click();
await page.waitForTimeout(600);
await hit('设置');
await page.locator('.screen-head button').first().click();
await page.waitForTimeout(300);
await page.locator('.rail button', { hasText: '自动化任务' }).first().click();
await page.waitForTimeout(500);
await hit('自动化');

await browser.close(); srv.close(); sidecar.kill();

console.log('可点区域检查：扫描到 ' + scanned + ' 个行元素');
if (scanned < 3) { console.log('  x 行元素太少（' + scanned + '），选择器可能变了'); bad++; }
if (bad) { console.log('\n共 ' + bad + ' 处问题'); process.exit(1); }
console.log('OK: 基础控件使用 Radix，未覆盖内部样式；列表行点击区域完整');
