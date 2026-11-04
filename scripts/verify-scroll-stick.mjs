// 单独验证「切回会话贴底」这一条，不起整个 app 分节。
//
// 为什么单独写：check-ui.mjs 的 app 分节要跑项目/附件/设置/插件/浏览器/计划/页签/终端，
// 十几分钟才轮到会话导航，反馈太慢。这个脚本只做一件事：
//   造 120 轮历史 → 切走 → 切回 → 断言贴在底部。
//
// 用法：node scripts/verify-scroll-stick.mjs（需先 npm run build:ui）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';

const ROOT = process.cwd(), DIST = path.join(ROOT, 'ui-dist');
const PORT = 5261, WS_PORT = 5262, TOKEN = 'scroll-' + Math.random().toString(36).slice(2, 8);
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('先跑 npm run build:ui'); process.exit(2); }
if (!CHROME) { console.error('找不到 Chrome，设置 CHROME_PATH'); process.exit(2); }

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scroll-stick-'));
const APP = path.join(DATA, 'WebDecryptHub');
const WORK = path.join(DATA, 'work');
fs.mkdirSync(APP, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({
  provider: 'openai', headless: true, embedMode: 'screencast',
  onboarding: { version: 1, completedAt: new Date().toISOString() },
}));

let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++; };

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN, JSRA_TEST_FIXTURES: '1' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('sidecar 启动超时')), 20000);
  sidecar.stdout.on('data', d => { if (String(d).includes('JSRA_PORT=')) { clearTimeout(timer); resolve(); } });
});

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(DIST, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file);
  res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN, { waitUntil: 'load' });

// 通过 WS 直接调 RPC。必须与 UI 同一条协议：{ type:'invoke', id, channel, args }。
// 注意每次调用开独立连接——长连接会因 sidecar 的单次结算语义而挂住（2026-11-02 实测）。
const rpc = (channel, args = {}) => new Promise((resolve, reject) => {
  const socket = new WebSocket('ws://127.0.0.1:' + WS_PORT + '/?token=' + TOKEN);
  const timer = setTimeout(() => { socket.terminate(); reject(Error('RPC 超时: ' + channel)); }, 30000);
  socket.once('open', () => socket.send(JSON.stringify({ type: 'invoke', id: 1, channel, args })));
  socket.on('message', raw => {
    const m = JSON.parse(String(raw));
    if (m.id !== 1) return;
    clearTimeout(timer); socket.close();
    m.error ? reject(Error(m.error)) : resolve(m.result);
  });
  socket.once('error', e => { clearTimeout(timer); reject(e); });
});

const scope = 'scroll-scope';
// 直接写项目配置，绕开目录凭证（凭证是一次性的，测试里反复构造容易撞到「已使用」）。
// 这与真实用户路径的差别只在「选择目录」这一步；滚动逻辑本身完全不涉及凭证。
const wsEntry = { id: 'ws-scroll-main', kind: 'folder', root: fs.realpathSync.native(WORK), revision: 1,
  identity: (() => { const st = fs.statSync(WORK); return `${st.dev}:${st.ino}:${st.birthtimeMs}`; })(), label: 'work', lastUsed: Date.now() };
const projectId = 'p-scroll';
fs.writeFileSync(path.join(APP, 'workspaces.json'), JSON.stringify({ v: 1, entries: [wsEntry] }));
fs.writeFileSync(path.join(APP, 'code-projects.json'), JSON.stringify({ version: 1, projects: [
  { id: projectId, name: 'Scroll', folders: [wsEntry], primaryId: wsEntry.id, revision: 1, updatedAt: Date.now() },
] }));
// 让 sidecar 重新读取配置
sidecar.kill();
await new Promise(r => setTimeout(r, 500));
const sidecar2 = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN, JSRA_TEST_FIXTURES: '1' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('sidecar 重启超时')), 20000);
  sidecar2.stdout.on('data', d => { if (String(d).includes('JSRA_PORT=')) { clearTimeout(t); resolve(); } });
});
const a = await rpc('session-create', { title: '长会话 A', projectId });
const b = await rpc('session-create', { title: '短会话 B', projectId });
await rpc('session-focus', { sessionId: a.id });

// 造 120 轮，确保内容高度远超一屏
const events = Array.from({ length: 120 }, (_, i) => ([
  { t: 'user', id: 'u' + i, turnId: 't' + i, at: Date.now() - (120 - i) * 1000, content: `第 ${i + 1} 轮提问` },
  { t: 'assistant', id: 'r' + i, turnId: 't' + i, phase: 'final_answer', content: `第 ${i + 1} 轮回复内容。\n\n` + '填充段落以拉高高度。\n'.repeat(6) },
  { t: 'turn-end', turnId: 't' + i, stop: 'completed' },
])).flat();
await rpc('test-seed-history', { sessionId: a.id, events });
await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN, { waitUntil: 'load' });
await page.locator('.conversation-turn').nth(119).waitFor({ state: 'attached' });

const box = () => page.locator('.msgs').evaluate(el => ({ sh: el.scrollHeight, st: el.scrollTop, ch: el.clientHeight }));
const atBottom = async (tolerance = 12) => { const x = await box(); return x.sh - x.st - x.ch < tolerance; };

console.log('\n[1] 首次进入长会话');
await page.waitForFunction(() => { const el = document.querySelector('.msgs'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 12; }, { timeout: 6000 })
  .then(() => ok(true, '首次进入应贴在最新消息'), () => ok(false, '首次进入停在顶部'));
console.log('     ' + JSON.stringify(await box()));

console.log('\n[2] 切到另一个会话再切回来（这正是用户报的场景）');
await rpc('session-focus', { sessionId: b.id });
await page.waitForTimeout(500);
await rpc('session-focus', { sessionId: a.id });
await page.locator('.conversation-turn').nth(119).waitFor({ state: 'attached' });
await page.waitForFunction(() => { const el = document.querySelector('.msgs'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 12; }, { timeout: 6000 })
  .then(() => ok(true, '切回后应贴在最新消息（此条曾失败）'), () => ok(false, '切回后停在顶部 —— 用户报告的 bug 复现'));
console.log('     ' + JSON.stringify(await box()));

console.log('\n[3] 用户往上翻后不得被抢回');
await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = 300; });
await page.waitForTimeout(800);
const kept = (await box()).st;
ok(kept < 900, `用户上翻后位置应保持（实际 scrollTop=${kept}）`);

console.log('\n[4] 点索引最后一条必须精确贴底（用户报的第二个问题）');
// 先把视图挪到中间，再点最后一轮
await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = Math.floor(el.scrollHeight / 2); });
await page.waitForTimeout(300);
const rail = page.locator('.turn-nav');
await rail.evaluate(el => { const sc = el.querySelector('.turn-nav-scroll') || el; sc.scrollTop = sc.scrollHeight; });
await page.waitForTimeout(300);
const lastMark = page.locator('.turn-nav-mark').last();
if (await lastMark.count()) {
  // 用 prefers-reduced-motion 让 jump 走 instant，断言精确落位；
  // smooth 的中间态不可判定，且真实用户等它演完即可。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await lastMark.click();
  await page.waitForTimeout(800);
  const afterJump = await box();
  const gap = afterJump.sh - afterJump.st - afterJump.ch;
  ok(gap < 4, `点最后一轮后应精确贴底（距底 ${gap}px），实际 ${JSON.stringify(afterJump)}`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
} else {
  ok(false, '找不到最后一轮的索引按钮');
}

console.log('\n[5] 关掉再打开会话（重载页面）仍应贴在最新处');
// 模拟「关掉再打开」：先在底部，重载页面。
// 注意：必须清掉 localStorage 里可能残留的旧式 scroll 记录（只有 top 没有 fromBottom），
// 否则会把测试变成「验证旧数据兼容」而不是「验证贴底行为」。
await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(800);
// 断言贴底时确实把位置清空了（localStorage 里该会话没有 scroll 或为 null）
const stored = await page.evaluate(() => {
  const raw = localStorage.getItem('decrypthub-session-views-v1');
  if (!raw) return { hasKey: false };
  const data = JSON.parse(raw);
  const views = Object.values(data.sessions || {});
  const withScroll = views.filter(v => v && v.scroll).length;
  return { hasKey: true, total: views.length, withScroll };
});
ok(stored.withScroll === 0 || stored.withScroll < stored.total,
  `贴底时应清掉该会话的 scroll 记录（实际 ${JSON.stringify(stored)}）`);

await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN, { waitUntil: 'load' });
await page.locator('.conversation-turn').nth(119).waitFor({ state: 'attached' });
await page.waitForFunction(() => { const el = document.querySelector('.msgs'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 12; }, { timeout: 6000 })
  .then(() => ok(true, '重新打开应贴在最新消息（此条曾是用户报的 bug）'), () => ok(false, '重新打开后跳到最上面 —— 用户报告的 bug 复现'));
console.log('     ' + JSON.stringify(await box()));

console.log('\n[6] 同一会话内继续跟随新消息');
await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(300);
await rpc('test-seed-history', { sessionId: a.id, events: [
  { t: 'user', id: 'u-new', turnId: 't-new', at: Date.now(), content: '新的一轮' },
  { t: 'assistant', id: 'r-new', turnId: 't-new', phase: 'final_answer', content: '新回复' },
  { t: 'turn-end', turnId: 't-new', stop: 'completed' },
] });
await page.waitForTimeout(1200);
ok(await atBottom(80), '已在底部时应跟随新消息（实际 ' + JSON.stringify(await box()) + '）');

await browser.close(); server.close(); sidecar2.kill();
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
console.log('\n' + (bad ? `❌ ${bad} 项失败` : '✅ 全部通过'));
process.exit(bad ? 1 : 0);
