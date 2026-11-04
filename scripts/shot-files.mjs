// 给文件面板截图，人眼核对（不做像素断言）。
//
// 断言锁的是「当时那一版长相」，改间距就红，红的是断言不是 bug——
// 所以这里只产出图片：目录树、当前文件高亮、Git 改动、收起态。
// 用法：node scripts/shot-files.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const ROOT = process.cwd(), DIST = path.join(ROOT, 'ui-dist');
const PORT = 5251, WS_PORT = 5252, TOKEN = 'filesshot-' + Math.random().toString(36).slice(2, 8);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(ROOT, 'artifacts', 'ui');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'files-shot-')), APP = path.join(DATA, 'DecryptHub');
fs.mkdirSync(APP, { recursive: true });
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({ provider: 'openai', headless: true, embedMode: 'screencast', onboarding: { version: 1, completedAt: new Date().toISOString() } }));

// 造一个像真项目的树：多层目录、空目录、多个文件类型。
const WORK = path.join(DATA, 'work');
const seed = (relative, content = '') => {
  const full = path.join(WORK, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (content !== null) fs.writeFileSync(full, content);
};
seed('README.md', '# 演示项目\n\n用于核对文件面板。\n');
seed('package.json', '{\n  "name": "demo"\n}\n');
seed('src/main.js', 'export function main() {\n  return 1;\n}\n');
seed('src/signer.js', '// 签名\nexport const sign = x => x;\n');
seed('src/utils/hash.js', 'export const hash = s => s;\n');
seed('src/utils/empty/.keep');
seed('docs/guide.md', '# 指南\n');
seed('assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
seed('fixtures/data.json', '{"a":1}');

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT,
  env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN, JSRA_TEST_FIXTURES: '1' },
  stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('sidecar 未就绪')), 25000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(timer); resolve(); } });
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const call = (channel, args = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:' + WS_PORT + '/?token=' + TOKEN);
  ws.once('open', () => ws.send(JSON.stringify({ type: 'invoke', id: 1, channel, args })));
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id !== 1) return; ws.close(); m.error ? reject(Error(m.error)) : resolve(m.result); });
  ws.once('error', reject);
});

const grant = { sessionId: 'main', path: WORK, expiresAt: Date.now() + 60000 };
grant.signature = folderProof(TOKEN, grant);
await call('project-save', { scope: 'main', project: { name: 'demo', folders: [{ key: 'a', grant }], primaryKey: 'a' } });
const projects = await call('projects-list');
const project = (projects.projects || projects).find(p => p.name === 'demo');
// 文件面板需要会话（工作目录来自会话的工作区）。这里不通过界面点，直接建一个，
// 免得截图脚本去模拟「新建第一个会话」那种依赖空状态的按钮。
const session = await call('session-create', { projectId: project.id }).catch(() => null);
const sessionId = session?.id;
await call('session-focus', { sessionId }).catch(() => {});
console.log('会话：' + sessionId);

const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
try {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    const skip = page.getByRole('button', { name: '稍后' });
    if (await skip.count()) await skip.first().click().catch(() => {});
    await page.waitForTimeout(400);

    // 开文件面板：预置 UI 自己的会话视图（localStorage），比模拟菜单点击可靠。
    // 键名与结构见 session-view.js（SESSION_VIEW_KEY / DEFAULT_SESSION_VIEW）。
    await page.evaluate(id => {
      const KEY = 'decrypthub-session-views-v1';
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      const sessions = raw.sessions || {};
      const view = { ...(sessions[id] || {}) };
      const tabs = Array.isArray(view.dock?.tabs) ? view.dock.tabs : [];
      const existing = tabs.find(tab => tab.kind === 'files');
      const files = existing || { id: 'shot-files', kind: 'files', title: '工作区文件' };
      const dock = { tabs: existing ? tabs : [...tabs, files], activeId: files.id };
      sessions[id] = { ...view, side: 'code', sideOpen: true, dock };
      localStorage.setItem(KEY, JSON.stringify({ version: 2, sessions }));
    }, sessionId);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2600);
    if (!await page.locator('.workspace-files').count()) {
      const labels = await page.evaluate(() => [...document.querySelectorAll('button,[role="tab"],[role="menuitem"]')]
        .map(el => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)).filter(Boolean).slice(0, 70));
      console.log('未打开文件面板；可见控件：' + JSON.stringify(labels));
    }

    // 展开目录，并打开一个文件（会新开文档标签页），再切回文件标签页，
    // 这样既能拍到最后打开的文件被标为当前文件，又能看到树本身。
    const tree = page.locator('.workspace-tree');
    if (await tree.count()) {
      for (const name of ['src', 'utils']) {
        const row = page.locator('.workspace-tree .tree-row').filter({ hasText: name }).first();
        if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(500); }
      }
      const file = page.locator('.workspace-tree .tree-row').filter({ hasText: 'main.js' }).first();
      if (await file.count()) { await file.click().catch(() => {}); await page.waitForTimeout(900); }
      // 切回「工作区文件」标签页（点文件会激活新开的文档页）
      const filesTab = page.getByRole('tab', { name: '工作区文件' }).first();
      if (await filesTab.count()) { await filesTab.click().catch(() => {}); await page.waitForTimeout(900); }
      const current = await page.locator('.workspace-tree .tree-row[aria-current]').count();
      const rows = await page.locator('.workspace-tree .tree-row').count();
      const hints = await page.locator('.workspace-tree .tree-hint').count();
      console.log('  树：' + rows + ' 行，当前文件标记 ' + current + ' 个，提示 ' + hints + ' 条');
    } else console.log('  树没渲染出来');

    // 面板本身在滚动容器里会持续重排，元素截图不稳；直接截整页更可靠。
    await page.screenshot({ path: path.join(OUT, scheme + '-files-tree.png'), animations: 'disabled', caret: 'hide' });

    // Git 改动视图
    const gitTab = page.getByRole('tab', { name: 'Git 改动' });
    if (await gitTab.count()) {
      await gitTab.click().catch(() => {});
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, scheme + '-files-git.png'), animations: 'disabled', caret: 'hide' });
    }

    // 收起态（Escape 语义）
    const back = page.getByRole('tab', { name: '本地文件' });
    if (await back.count()) { await back.click().catch(() => {}); await page.waitForTimeout(400); }
    const row = page.locator('.workspace-tree .tree-row').first();
    if (await row.count()) { await row.focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
    await page.screenshot({ path: path.join(OUT, scheme + '-files-hidden.png'), animations: 'disabled', caret: 'hide' });
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
  sidecar.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}
console.log('已输出 artifacts/ui/*-files-tree.png、*-files-git.png、*-files-hidden.png');
