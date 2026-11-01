// 「AI 在回复里插图」的定向验收。
//
// 单测已锁住「base64 不进历史 / 路径与格式校验 / 正文定位切分」这些纯逻辑。
// 真正只有真跑浏览器才看得见的部分在这里：
//   1) 工具产出的图片在对话里真的渲染出来（不是一句「已截图」）
//   2) 正文 ![](image:<id>) 指到哪就显示在哪，而不是被 sanitize 吃掉
//   3) 历史重载后图片仍在（靠附件 id + attachment-preview，不是内存里的 dataUrl）
//
// 用法：node scripts/check-reply-images.mjs（需先 npm run build:ui）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const PORT = 5233, WS_PORT = 5234, TOKEN = 'replyimg';
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

// 1×1 PNG：够小，且带真实 PNG 文件头，能过附件库的格式嗅探。
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+1cAAAAASUVORK5CYII=', 'base64');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-image-'));
const APP = path.join(DATA, 'WebDecryptHub');
fs.mkdirSync(APP, { recursive: true });
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({ provider: 'openai', headless: true, embedMode: 'screencast' }));

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN, JSRA_TEST_FIXTURES: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let sidecarErr = '';
sidecar.stderr.on('data', d => { sidecarErr += String(d); });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('sidecar 未就绪：' + sidecarErr.slice(0, 600))), 25000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } });
});

const rpc = (channel, args = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:' + WS_PORT + '/?token=' + TOKEN);
  const timer = setTimeout(() => { ws.terminate(); reject(Error('RPC timeout: ' + channel)); }, 30000);
  ws.once('open', () => ws.send(JSON.stringify({ type: 'invoke', id: 1, channel, args })));
  ws.on('message', raw => { const message = JSON.parse(raw); if (message.id !== 1) return; clearTimeout(timer); ws.close(); message.error ? reject(Error(message.error)) : resolve(message.result); });
  ws.once('error', error => { clearTimeout(timer); reject(error); });
});
await rpc('save-settings', { onboarding: { version: 1, completedAt: new Date().toISOString() } }).catch(error => console.error('save onboarding:', error.message));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

let browser, context, page;
const cleanup = async () => {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await new Promise(r => srv.close(r));
  sidecar.kill();
};
try {
  const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
  browser = await chromium.launch({ headless: true, executablePath: CHROME });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN);
  await page.locator('.stage-head').waitFor();

  // 造真实项目 + 会话，并把一张 PNG 放进工作区，模拟「AI 手上有一张图」。
  const scope = 'reply-image-check';
  const root = path.join(DATA, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'captures-login.png'), PNG);
  const grant = { sessionId: scope, path: root, expiresAt: Date.now() + 60000 };
  grant.signature = folderProof(TOKEN, grant);
  const project = await rpc('project-save', { scope, project: { name: '回复图片验收', folders: [{ key: 'main', grant }], primaryKey: 'main' } });
  const created = await rpc('session-create', { projectId: project.id });
  await rpc('session-focus', { sessionId: created.id });
  await page.reload();
  await page.locator('.msgs').waitFor();

  // 1) 走真实 RPC：先登记附件，再把「工具产出图片」写进历史（等价于截图/reply_image 的结果）。
  const uploaded = await rpc('attach-path', { path: path.join(root, 'captures-login.png') });
  ok(uploaded?.id && uploaded.image === true, '附件登记成功且被识别为图片（id=' + uploaded?.id + '）');
  const preview = await rpc('attachment-preview', { sessionId: created.id, id: uploaded.id });
  ok(/^data:image\/png;base64,/.test(preview?.dataUrl || ''), 'attachment-preview 能按 id 取回 dataUrl');

  // 直接注入一条「本会话已完成的工具事件」，模拟截图工具产出图片。
  await rpc('test-seed-history', {
    sessionId: created.id,
    events: [
      { t: 'user', id: 'u1', turnId: 'turn-img', displayContent: '给我看下截图', content: '给我看下截图' },
      { t: 'assistant', id: 'a1', turnId: 'turn-img', phase: 'commentary', content: '我截了一张图。', calls: [{ id: 'c1', itemId: 'i1', name: 'take_screenshot', args: {} }] },
      { t: 'tool', id: 'c1', itemId: 'i1', turnId: 'turn-img', name: 'take_screenshot', content: 'Took a screenshot of the current page viewport.', images: [{ id: uploaded.id, name: uploaded.name, mime: uploaded.mime, width: uploaded.width, height: uploaded.height }] },
      { t: 'assistant', id: 'a2', turnId: 'turn-img', phase: 'final_answer', content: '截图如下：\n\n![登录页](image:' + uploaded.id + ')\n\n按钮在右下角。' },
      { t: 'turn-end', turnId: 'turn-img', stop: 'completed', startedAt: Date.now() - 5000, endedAt: Date.now(), usage: {} },
    ],
  }).catch(error => console.error('seed:', error.message));

  await page.reload();
  await page.locator('.msgs').first().waitFor({ timeout: 15000 });

  // 2) 正文里的 ![](image:<id>)：指到哪显示在哪，且不被 sanitize 吃掉。
  const inline = page.locator('.reply-md .reply-images img').first();
  await inline.waitFor({ timeout: 15000 });
  ok(await inline.isVisible(), '正文 image:<id> 占位被渲染成真实图片');
  ok((await inline.getAttribute('src'))?.startsWith('data:image/'), '正文图片按附件 id 取回 dataUrl，不是坏链');
  const bubbleText = await page.locator('.msg.assistant .bubble').last().innerText();
  ok(!bubbleText.includes('image:'), '正文里不残留 image: 语法（实际 ' + JSON.stringify(bubbleText.slice(0, 120)) + '）');
  ok(bubbleText.includes('截图如下') && bubbleText.includes('按钮在右下角'), '图片前后文字都保留');

  // 3) 展开执行过程后，工具产出的图片也要看得见（截图不该只剩一句「已截图」）。
  await page.locator('.turn-process > summary').first().click();
  const toolImg = page.locator('.tool-images img').first();
  await toolImg.waitFor({ timeout: 10000 });
  ok(await toolImg.isVisible(), '展开执行过程后能看到工具产出的图片');
  // 4) AI 提供的图片必须带来源标记，避免和用户自己的附件混淆（防钓鱼面）。
  ok((await page.locator('.reply-image-source').first().innerText()).includes('AI'), '回复图片标注了「AI 提供」');

  // 5) 历史重载后仍在：这条路径证明图片靠附件 id 恢复，而不是内存里的 dataUrl。
  await page.reload();
  await page.locator('.msg.assistant .bubble').last().waitFor({ timeout: 15000 });
  ok(await page.locator('.reply-images img').first().isVisible({ timeout: 15000 }), '重载后图片仍然可见');

  // 6) 图片不得把 base64 写进持久化历史。历史落在会话数据目录（projects/<id>），不是项目目录。
  const histFiles = [];
  const walkHist = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkHist(full);
      else if (entry.name === '.agent-history.json') histFiles.push(full);
    }
  };
  walkHist(APP);
  ok(histFiles.length > 0, '找到落盘的历史文件（' + histFiles.length + ' 个）');
  const b64 = PNG.toString('base64');
  const dirty = histFiles.filter(f => fs.readFileSync(f, 'utf8').includes(b64));
  ok(dirty.length === 0, '历史文件里没有 base64' + (dirty.length ? '：' + dirty.join(', ') : ''));
  ok(histFiles.some(f => fs.readFileSync(f, 'utf8').includes(uploaded.id)), '历史里以附件 id 引用图片');

  ok(pageErrors.length === 0, '前端无 pageerror' + (pageErrors.length ? '：' + pageErrors[0] : ''));
} finally {
  await cleanup();
  fs.rmSync(DATA, { recursive: true, force: true });
}

console.log(bad ? `\n失败 ${bad} 项` : '\n全部通过');
process.exit(bad ? 1 : 0);
