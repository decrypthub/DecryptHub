// 把上下文用量控件放大截图，人眼核对清晰度（不做断言，只产出图片）。
//
// 与 check-context-meter.mjs 分工：那个锁行为契约（对比度、占比、阈值位置），
// 这个只负责「给人和 Agent 看」。视觉好坏由人判断，不写成像素断言 ——
// 固定像素只锁住当时那一版长相，改间距就红，红的是断言不是 bug。
//
// 输出 4 倍图的三个视角：控件本身、它在输入坞里的存在感、展开后的浮层。
// 用法：node scripts/shot-context-meter.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const ROOT = process.cwd(), DIST = path.join(ROOT, 'ui-dist');
const PORT = 5241, WS_PORT = 5242, TOKEN = 'ctxshot-' + Math.random().toString(36).slice(2, 8);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-shot-')), APP = path.join(DATA, 'WebDecryptHub');
fs.mkdirSync(APP, { recursive: true });
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({ provider: 'openai', headless: true, embedMode: 'screencast', onboarding: { version: 1, completedAt: new Date().toISOString() } }));
const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN, JSRA_TEST_FIXTURES: '1' }, stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise((res, rej) => { const t = setTimeout(() => rej(Error('sidecar 未就绪')), 25000); sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } }); });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
const rpc = (channel, args = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:' + WS_PORT + '/?token=' + TOKEN);
  ws.once('open', () => ws.send(JSON.stringify({ type: 'invoke', id: 1, channel, args })));
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id !== 1) return; ws.close(); m.error ? reject(Error(m.error)) : resolve(m.result); });
  ws.once('error', reject);
});
const folder = path.join(DATA, 'work'); fs.mkdirSync(folder, { recursive: true });
const grant = { sessionId: 'shot', path: folder, expiresAt: Date.now() + 60000 }; grant.signature = folderProof(TOKEN, grant);
const project = await rpc('project-save', { scope: 'shot', project: { name: 'shot', folders: [{ key: 'root', grant }], primaryKey: 'root' } });
const sid = (await rpc('session-list')).focused || (await rpc('session-create', { projectId: project.id })).focused;
// 分批灌到接近压缩阈值，确认高用量下环、数字、阈值线都还读得出来。
const seedTo = async (events) => {
  for (let i = 0; i < events.length; i += 200) await rpc('test-seed-history', { sessionId: sid, events: events.slice(i, i + 200) }).catch(e => console.error('seed: ' + e.message));
};
// 工具结果会被「视图期裁剪」收起（只保留最近 6 条），灌不出高用量；
// 用大段 user 事件才能把窗口堆到接近阈值。
const big = Array.from({ length: 40 }, (_, i) => ({ t: 'user', content: 'FIXTURE_TURN_' + i + ' ' + 'y'.repeat(9000) }));
await seedTo(big);
const after = await rpc('session-snapshot', { sessionId: sid }).catch(e => ({ error: e.message }));
console.log('灌入后用量：' + JSON.stringify(after?.context?.used) + ' / ' + JSON.stringify(after?.context?.limit) + ' pct=' + after?.context?.pct + (after?.error ? ' err=' + after.error : ''));
const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
try {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 4 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN, { waitUntil: 'load' });
    await page.locator('.ctx-meter').waitFor({ timeout: 20000 });
    await page.locator('.ctx-meter').screenshot({ path: path.join(ROOT, 'artifacts', 'ui', scheme + '-ctx-meter-zoom.png') });
    // 整个输入坞也留一张：确认它在栏里的存在感与相邻控件协调。
    await page.locator('.composer-bar').screenshot({ path: path.join(ROOT, 'artifacts', 'ui', scheme + '-ctx-bar-zoom.png') });
    // 浮层：分段条 + 阈值线 + 明细。
    await page.locator('.ctx-meter').click();
    await page.locator('.ctx-bar').waitFor({ timeout: 5000 });
    await page.locator('[data-overlay]').filter({ has: page.locator('.ctx-bar') }).first().screenshot({ path: path.join(ROOT, 'artifacts', 'ui', scheme + '-ctx-popover-zoom.png') });
    await ctx.close();
  }
} finally { await browser.close(); srv.close(); sidecar.kill(); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} }
console.log('已输出 artifacts/ui/*-ctx-meter-zoom.png 与 *-ctx-bar-zoom.png');
