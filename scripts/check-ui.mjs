// UI 契约检查：页面能不能正常渲染、文字看不看得清、关键区块在不在。
// 同时检查共享操作按钮的尺寸、实际命中区域和菜单键盘交互。
// 用法：npm run check:ui
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const SHOTS = path.join(ROOT, 'artifacts', 'ui');
const PORT = 5311, WS_PORT = 5312;
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(p => fs.existsSync(p));

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('先跑 npm run build:ui'); process.exit(2); }
if (!CHROME) { console.error('找不到 Chrome/Edge，设置 CHROME_PATH'); process.exit(2); }

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
async function checkWindowDragging(page, selectors, label) {
  // Exercise the real frontend handlers against a recorded native bridge. This
  // checks hit testing; real OS window movement remains a native acceptance item.
  const bridge = 'http://127.0.0.1:' + PORT + '/__ui-window-bridge';
  await page.addScriptTag({ url: bridge });
  const readCalls = () => page.locator('html').getAttribute('data-ui-window-calls').then(value => JSON.parse(value || '[]'));
  try {
    for (const selector of selectors) {
      const before = (await readCalls()).filter(c => c.endsWith('|start_dragging')).length;
      await page.locator(selector).first().dispatchEvent('mousedown', { button: 0, detail: 1 });
      await page.waitForFunction(count => JSON.parse(document.documentElement.getAttribute('data-ui-window-calls') || '[]').filter(c => c.endsWith('|start_dragging')).length > count, before);
    }
    const region = page.locator('[data-window-drag-region]').last();
    await region.dispatchEvent('mousedown', { button: 0, detail: 2 });
    await page.waitForFunction(() => JSON.parse(document.documentElement.getAttribute('data-ui-window-calls') || '[]').some(c => c.endsWith('|toggle_maximize')));
    const before = (await readCalls()).filter(c => c.endsWith('|start_dragging')).length;
    await page.locator('[data-window-drag-region] button').first().dispatchEvent('mousedown', { button: 0, detail: 1 });
    ok((await readCalls()).filter(c => c.endsWith('|start_dragging')).length === before, label + ' 点击控件不应拖动窗口');
  } finally { await page.addScriptTag({ url: bridge + '?restore=1' }); }
}

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-check-'));
const MODEL_BASE = 'http://127.0.0.1:' + PORT + '/__ui-model/v1', modelRequests = [];
fs.mkdirSync(path.join(DATA, 'WebDecryptHub'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'WebDecryptHub', 'settings.json'), JSON.stringify({
  provider: 'openai', headless: true, embedMode: 'screencast', activeProviderId: 'ui-openai', activeModel: 'gpt-4o',
  openai: { baseUrl: MODEL_BASE, model: 'gpt-4o', apiKey: 'ui-fixture-key' },
  providers: [
    { id: 'ui-openai', name: 'OpenAI 兼容', type: 'openai', baseUrl: MODEL_BASE, apiKey: 'ui-fixture-key', models: [{ id: 'gpt-4o', name: 'gpt-4o', contextWindow: 1000000, vision: false }] },
    { id: 'ui-claude', name: 'Claude 原生', type: 'anthropic', baseUrl: 'http://127.0.0.1:' + PORT + '/__ui-model', models: ['claude-sonnet-4-6'] },
  ],
}));
const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: path.join(DATA, 'WebDecryptHub'), JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: 'ui-check', JSRA_TEST_FIXTURES: '1', JSRA_DEV: '1' }, stdio: ['ignore', 'pipe', 'ignore'],
});
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('sidecar 未就绪')), 20000); sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } }); }).catch(e => { console.error(e.message); process.exit(2); });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/__ui-window-bridge')) {
    res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Cache-Control', 'no-store');
    res.end(req.url.includes('restore=1') ? 'if(window.__uiSavedBridge === undefined) delete window.__TAURI_INTERNALS__; else window.__TAURI_INTERNALS__=window.__uiSavedBridge; delete window.__uiSavedBridge; document.documentElement.removeAttribute("data-ui-window-calls");' : 'window.__uiSavedBridge=window.__TAURI_INTERNALS__; document.documentElement.setAttribute("data-ui-window-calls","[]"); window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:"main"}},invoke:async function(command){const root=document.documentElement;const calls=JSON.parse(root.getAttribute("data-ui-window-calls")||"[]");calls.push(command);root.setAttribute("data-ui-window-calls",JSON.stringify(calls));}};'); return;
  }
  if (req.url === '/__ui-model/v1/chat/completions') {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      const input = JSON.parse(body);
      if (input.messages[0]?.content?.startsWith('你是会话标题生成器')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '验证图片与工作区操作' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); return; }
      modelRequests.push(input);
      const latest = input.messages.findLast(m => m.role === 'user'), text = typeof latest?.content === 'string' ? latest.content : latest?.content.find(p => p.type === 'text')?.text || '';
      const fileTask = text.includes('创建一个测试文件');
      let delta = fileTask && input.messages.at(-1)?.role !== 'tool' ? { tool_calls: [
        { index: 0, id: 'ui-write', type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'ui-example.txt', content: 'UI change verified' }) } },
        { index: 1, id: 'ui-tree', type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'src/trace.js', content: 'DIRECTORY_TREE_VERIFIED' }) } },
      ] } : { content: fileTask ? '已创建测试文件。' : '已收到图片，图片发送链路验证完成。' };
      if (text.includes('打开测试浏览器')) delta = input.messages.at(-1)?.role === 'tool' ? { content: '浏览器操控完成。' } : { tool_calls: [
        { index: 0, id: 'ui-open', type: 'function', function: { name: 'browser_open', arguments: JSON.stringify({ url: 'http://127.0.0.1:' + PORT + '/__ui-fixture?delay=800' }) } },
        { index: 1, id: 'ui-snapshot', type: 'function', function: { name: 'browser_snapshot', arguments: '{}' } },
      ] };
      if (text.includes('你是主代理创建的研究子代理')) delta = input.messages.at(-1)?.role === 'tool' ? { content: '研究完成：工作区证据已核对。' } : { tool_calls: [{ index: 0, id: 'child-list', type: 'function', function: { name: 'workspace_list', arguments: '{}' } }] };
      if (text.includes('验证目标机制')) delta = input.messages.at(-1)?.role === 'tool' ? { content: '目标验证完成。' } : { tool_calls: [{ index: 0, id: 'goal-done', type: 'function', function: { name: 'goal_update', arguments: JSON.stringify({ status: 'complete', summary: '目标机制验证通过。' }) } }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    }); return;
  }
  if (req.url === '/__ui-model/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
  // A local target exercises the actual browser/capture path without external traffic.
  if (req.url.startsWith('/__ui-fixture/api')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fixture: true, message: 'UI capture verified' })); return;
  }
  if (req.url.startsWith('/__ui-fixture')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const finish = () => res.end('<!doctype html><html><title>UI 测试页面</title><body><h1>本地 UI 验证</h1><script>setInterval(()=>{window.__uiTick=(window.__uiTick||0)+1},50);fetch("/__ui-fixture/api?sign=ui-test").then(r=>r.json()).then(v=>document.body.append(v.message))</script></body></html>'); if (req.url.includes('delay=')) setTimeout(finish, 800); else finish(); return;
  }
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
fs.mkdirSync(SHOTS, { recursive: true });

// 文字对比度：前景 vs 最近的不透明背景
const contrast = () => {
  const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
  const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const bgOf = el => { let a = el; while (a && a !== document.documentElement) { const c = parse(getComputedStyle(a).backgroundColor); if (c && c[3] > 0.5) return c; a = a.parentElement; } return parse(getComputedStyle(document.body).backgroundColor) || [17, 17, 19, 1]; };
  const out = [];
  for (const el of document.querySelectorAll('button, .rt-Text, .side-row, .rowx-title, .rowx-sub, .bubble-md, .md code, .md code span, p, li, h1, h2, h3, td, th')) {
    const r = el.getBoundingClientRect();
    if (!r.height || !el.offsetParent) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    if ([...el.children].some(c => (c.textContent || '').trim())) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg || fg[3] < 0.5) continue;
    const L1 = lum(fg), L2 = lum(bgOf(el));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 600;
    const need = size >= 18.66 || (bold && size >= 14) ? 3 : 4.5;
    if (ratio < need) out.push('"' + text.slice(0, 12) + '" ' + ratio.toFixed(2) + ':1 (需要 ' + need + ') ' + cs.color);
  }
  return [...new Set(out)];
};

// Measure both the painted icon and the actual button receiving pointer input.
const actionGeometry = () => {
  const issues = [];
  for (const button of document.querySelectorAll('.action-icon')) {
    let hidden = false;
    for (let el = button; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) hidden = true;
    }
    if (hidden) continue;
    const r = button.getBoundingClientRect(), icon = button.querySelector('svg')?.getBoundingClientRect();
    const label = button.getAttribute('aria-label') || button.title || '未命名';
    if (!label || label === '未命名') issues.push('图标按钮缺少名称');
    if (r.width < (button.hasAttribute('data-compact') ? 24 : 32) || r.height < (button.hasAttribute('data-compact') ? 24 : 32)) issues.push(label + ' 点击区域小于 32px');
    if (!icon || icon.width !== (button.hasAttribute('data-compact') ? 14 : 18) || icon.height !== (button.hasAttribute('data-compact') ? 14 : 18)) issues.push(label + ' 图标不是 18px');
    if (!button.disabled && r.width && r.height) {
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit?.closest('button') !== button) issues.push(label + ' 点击区域被遮挡');
    }
  }
  for (const group of document.querySelectorAll('.row-actions, .composer-bar, .browser-bar')) {
    const controls = [...group.querySelectorAll('button')].map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1) issues.push('操作控件重叠');
    }
  }
  return [...new Set(issues)];
};

const navGeometry = elements => elements.map(el => {
  const r = el.getBoundingClientRect(), icon = el.querySelector('svg').getBoundingClientRect(), label = el.querySelector('span').getBoundingClientRect();
  return { name: el.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height, iconX: icon.x, labelX: label.x };
});
const checkNavSpacing = (rows, label) => rows.forEach((row, i) => {
  ok(row.height >= 40, label + ' 导航行过矮：' + row.name);
  if (i) ok(row.y - rows[i - 1].y - rows[i - 1].height >= 8, label + ' 菜单间距不足：' + row.name);
});

try { for (const scheme of (process.env.JSRA_UI_SCHEME ? [process.env.JSRA_UI_SCHEME] : ['dark', 'light'])) {
  console.log('检查主题：' + scheme);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => { errs.push(e.message); console.error('UI runtime error: ' + e.message); });
  await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=ui-check', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const skip = page.getByRole('button', { name: '稍后' });
  if (await skip.count()) await skip.first().click();
  await page.waitForTimeout(300);

  // 默认是聊天优先：侧栏与右侧工具面板都收起。回归用例先展开，后续断言覆盖完整工作台。
  await page.screenshot({ path: path.join(SHOTS, scheme + '-boot.png') });
  if (await page.getByText('查看错误详情', { exact: true }).count()) {
    await page.getByText('查看错误详情', { exact: true }).click();
    throw new Error(await page.locator('body').innerText());
  }
  const expandRail = page.getByRole('button', { name: '展开会话列表' });
  if (await expandRail.count()) await expandRail.first().click();
  const expandTools = page.locator('.win-controls button[aria-label="展开工具面板"]');
  if (await expandTools.count()) await expandTools.first().click();
  const panelToggle = await page.locator('.win-controls .tool-panel-toggle').boundingBox();
  ok(panelToggle.x > 1440 - 190, '[' + scheme + '] 工具面板开关应位于窗口右侧');
  await checkWindowDragging(page, ['.stage-identity strong', '.dock-head'], '[' + scheme + '] 标题栏');
  await page.locator('.rail .new-session').click();
  await page.locator('.welcome').waitFor();
  await page.waitForTimeout(300);

  ok(errs.length === 0, '[' + scheme + '] 页面报错: ' + (errs[0] || ''));
  ok(await page.locator('.stage-head').count() > 0, '[' + scheme + '] 找不到对话顶栏 .stage-head');
  ok(await page.locator('.composer').count() > 0, '[' + scheme + '] 找不到输入坞 .composer');
  ok(await page.locator('.dock-tabs').count() > 0, '[' + scheme + '] 找不到右侧面板页签');
  ok(await page.locator('.statusbar').count() === 0, '[' + scheme + '] 底部状态栏没有移除');
  ok(await page.getByRole('textbox', { name: '筛选会话' }).count() === 0, '[' + scheme + '] 多余的会话筛选框没有移除');
  ok(await page.locator('.rail').getByText('会话列表', { exact: true }).count() === 1, '[' + scheme + '] 会话列表标题不正确');
  ok(await page.getByRole('button', { name: '组件样张', exact: true }).count() === 0, '[' + scheme + '] 组件样张入口没有移除');
  ok(await page.locator('.tb').getByRole('button', { name: /搜索/ }).count() === 0, '[' + scheme + '] 标题栏仍有搜索入口');
  checkNavSpacing(await page.locator('.rail-nav .nav-button').evaluateAll(navGeometry), '[' + scheme + '] 主导航');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-chat.png') });

  for (const issue of await page.evaluate(actionGeometry)) ok(false, '[' + scheme + '] ' + issue);
  const attachAction = page.getByRole('button', { name: '添加图片或文件', exact: true });
  await page.mouse.move(1, 1);
  const restBackground = await attachAction.evaluate(el => getComputedStyle(el).backgroundColor);
  ok(restBackground === 'rgba(0, 0, 0, 0)', '[' + scheme + '] 普通图标操作仍有常驻底色');
  const attachBounds = await attachAction.boundingBox();
  await attachAction.hover();
  ok(await attachAction.evaluate(el => getComputedStyle(el).backgroundColor) !== restBackground, '[' + scheme + '] 操作按钮没有悬停反馈');
  const hoverBounds = await attachAction.boundingBox();
  ok(attachBounds.width === hoverBounds.width && attachBounds.height === hoverBounds.height, '[' + scheme + '] 悬停导致按钮尺寸改变');
  await page.mouse.move(1, 1);
  const composerControls = await page.locator('.composer-bar .rt-SelectTrigger').evaluateAll(els => els.map(el => ({ height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) })));
  ok(composerControls.every(c => c.height === 32 && c.font === 14), '[' + scheme + '] 输入栏选择器尺寸不统一');
  await page.getByRole('button', { name: '选择权限', exact: true }).click();
  ok(await page.getByRole('menuitemradio', { name: '请求批准', exact: true }).count() === 1, '[' + scheme + '] 执行模式菜单无法打开');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, scheme + '-permissions.png') });
  await page.getByRole('menuitemradio', { name: '自动批准', exact: true }).click();
  await page.getByRole('button', { name: '选择权限', exact: true }).filter({ hasText: '自动批准' }).waitFor();
  await page.getByRole('button', { name: '选择权限', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '请求批准', exact: true }).click();
  await page.getByRole('combobox', { name: '选择模型' }).click();
  ok(await page.getByRole('option', { name: 'gpt-4o', exact: true }).count() === 1, '[' + scheme + '] 模型菜单无法打开');
  await page.keyboard.press('Escape');

  // File selection, clipboard paste and drag/drop use the same real attachment RPC.
  const imageData = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64; const g = canvas.getContext('2d'); g.fillStyle = '#3478bd'; g.fillRect(0, 0, 96, 64); g.fillStyle = '#fff'; g.font = '24px sans-serif'; g.fillText('UI', 30, 40); return canvas.toDataURL('image/png').split(',')[1]; });
  await page.locator('input[type="file"]').setInputFiles({ name: '图片示例.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
  await page.locator('.composer .attachment-image img').waitFor();
  await page.getByRole('button', { name: '预览图片：图片示例.png', exact: true }).click();
  await page.locator('.image-dialog .image-preview img').waitFor();
  ok((await page.locator('.image-dialog .image-preview img').getAttribute('src')).startsWith('data:image/png;base64,'), '[' + scheme + '] 图片预览未加载原图');
  await page.keyboard.press('Escape');
  await page.locator('.image-dialog').waitFor({ state: 'detached' });
  ok(await page.getByRole('button', { name: '预览图片：图片示例.png', exact: true }).evaluate(el => el === document.activeElement), '[' + scheme + '] 图片预览关闭后没有恢复焦点');
  await page.getByRole('button', { name: '移除附件：图片示例.png', exact: true }).click();
  await page.locator('.composer-input textarea').evaluate((el, data) => { const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], '粘贴图片.png', { type: 'image/png' })); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })); }, imageData);
  await page.locator('.composer .attachment-image img').waitFor();
  await page.locator('.composer').evaluate((el, data) => { const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], '拖入图片.png', { type: 'image/png' })); el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); }, imageData);
  await page.locator('.composer .attachment-tile').nth(1).waitFor();
  ok(await page.getByRole('button', { name: '发送（Enter）', exact: true }).isEnabled(), '[' + scheme + '] 仅图片消息不能发送');
  const enableImages = page.getByRole('button', { name: '启用图片输入', exact: true });
  if (await enableImages.count()) {
    await page.getByRole('button', { name: '发送（Enter）', exact: true }).click();
    ok(await page.locator('.composer .attachment-tile').count() === 2, '[' + scheme + '] 图片模型不兼容时丢失附件');
    await enableImages.click();
    await enableImages.waitFor({ state: 'detached' });
  }
  await page.screenshot({ path: path.join(SHOTS, scheme + '-image-composer.png') });
  await page.getByRole('button', { name: '发送（Enter）', exact: true }).click();
  await page.locator('.msg.assistant').filter({ hasText: '图片发送链路验证完成' }).waitFor();
  const sentImages = modelRequests.at(-1)?.messages.findLast(m => m.role === 'user')?.content.filter(p => p.type === 'image_url') || [];
  ok(sentImages.length === 2 && sentImages.every(p => p.image_url.url.endsWith(imageData)), '[' + scheme + '] 模型没有收到两张真实图片');
  await page.reload();
  await page.locator('.msg.user .attachment-image img').nth(1).waitFor();
  ok(await page.locator('.msg.assistant').filter({ hasText: '图片发送链路验证完成' }).count() === 1, '[' + scheme + '] 图片对话重载后丢失回复');
  const reopenRail = page.getByRole('button', { name: '展开会话列表', exact: true });
  if (await reopenRail.count()) await reopenRail.click();
  await page.getByRole('textbox', { name: '任务指令' }).fill('创建一个测试文件');
  await page.getByRole('button', { name: '发送（Enter）', exact: true }).click();
  await page.locator('.msg.assistant').filter({ hasText: '已创建测试文件。' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.stage-identity strong')?.textContent === '验证图片与工作区操作');
  await page.getByRole('tab', { name: '工作区文件', exact: true }).click();
  ok(await page.locator('.workspace-tree [data-path="src/trace.js"]').count() === 0, '[' + scheme + '] 目录应默认折叠');
  await page.locator('.workspace-tree [data-path="src"]').click();
  await page.locator('.workspace-tree [data-path="src/trace.js"]').waitFor();
  ok(await page.locator('.workspace-tree [data-path="src"]').getAttribute('aria-expanded') === 'true', '[' + scheme + '] 文件夹未展开');
  await page.locator('.workspace-tree [data-path="src/trace.js"]').click();
  await page.waitForFunction(() => document.querySelector('.detail .raw')?.textContent === 'DIRECTORY_TREE_VERIFIED');
  await page.locator('.workspace-tree [data-path="src"]').press('ArrowLeft');
  ok(await page.locator('.workspace-tree [data-path="src/trace.js"]').count() === 0, '[' + scheme + '] 目录方向键折叠失败');
  await page.locator('.file-row').filter({ hasText: 'ui-example.txt' }).click();
  await page.waitForFunction(() => document.querySelector('.detail .raw')?.textContent === 'UI change verified');
  ok(await page.locator('.detail .raw').textContent() === 'UI change verified', '[' + scheme + '] 工作区文件内容错误');
  ok(await page.getByRole('button', { name: '会话信息', exact: true }).count() === 0, '[' + scheme + '] 顶部不应显示会话信息按钮');
  const focusedId = await page.locator('.session-item.on').getAttribute('data-session-id');
  const menuButton = page.locator('.session-item.on button[aria-label="会话操作"]');
  await page.locator('.session-item.on').hover(); await menuButton.click();
  await page.getByRole('menuitem', { name: '复制会话 ID', exact: true }).click();
  await page.getByText('会话 ID 已复制', { exact: true }).waitFor();
  ok(await page.evaluate(() => navigator.clipboard.readText()) === focusedId, '[' + scheme + '] 复制了其他会话的 ID');
  await menuButton.click(); await page.getByRole('menuitem', { name: '复制为 Markdown', exact: true }).click();
  await page.getByText('对话 Markdown 已复制', { exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  ok(copied.includes(focusedId) && copied.includes('UI change verified') && copied.includes('workspace_write'), '[' + scheme + '] Markdown 缺少会话信息或工具结果');
  await page.locator('.session-menu').waitFor({ state: 'hidden' });
  ok(await page.locator('.dock-tabs [role="tab"]').count() === 3, '[' + scheme + '] 工具面板应只保留三个页签');
  ok(await page.locator('.git-changes').count() === 0, '[' + scheme + '] 无 Git 仓库不应显示改动面板');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-real-file-change.png') });
  await page.locator('.rail .new-session').click();
  await page.locator('.welcome').waitFor();

  for (const c of (await page.evaluate(contrast)).slice(0, 10)) ok(false, '[' + scheme + '] 文字对比度不足 ' + c);

  await page.getByRole('button', { name: '了解项目', exact: true }).click();
  ok((await page.getByRole('textbox', { name: '任务指令' }).inputValue()).includes('项目'), '[' + scheme + '] 快捷分析没有填入指令');
  await page.getByRole('textbox', { name: '任务指令' }).fill('');
  await page.keyboard.press('Control+k');
  ok(await page.locator('.session-search-results button').count() === await page.locator('.session-item').count(), '[' + scheme + '] 搜索弹窗包含会话之外的操作');
  await page.getByRole('textbox', { name: '搜索会话' }).fill('网络请求');
  ok(await page.locator('.session-search-results button').count() === 0, '[' + scheme + '] 搜索仍然包含快捷操作');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: /网络请求/ }).click();
  await page.getByRole('tab', { name: /网络请求/ }).press('ArrowRight');
  ok(await page.getByRole('tab', { name: /工作区文件/ }).getAttribute('aria-selected') === 'true', '[' + scheme + '] 工具页签方向键失效');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-files.png') });
  await page.keyboard.press('Control+Alt+2');
  await page.locator('.win-controls button[aria-label="收起工具面板"]').click();
  ok(await page.locator('.dock').count() === 0, '[' + scheme + '] 工具面板不能收起');
  await page.locator('.win-controls button[aria-label="展开工具面板"]').click();
  ok(await page.locator('.dock').count() === 1, '[' + scheme + '] 工具面板不能恢复');
  await page.keyboard.press('Control+l');
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(100);
  ok(await page.getByRole('textbox', { name: '目标网址' }).isVisible(), '[' + scheme + '] 连续 Ctrl+L 关闭了浏览器面板');

  const beforeSessions = await page.locator('.session-item').count();
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(300);
  ok(await page.locator('.session-item').count() === beforeSessions + 1, '[' + scheme + '] Ctrl+T 不能新建会话');
  await page.locator('.session-item.on').hover();
  for (const issue of await page.evaluate(actionGeometry)) ok(false, '[' + scheme + '] 会话操作 ' + issue);
  await page.locator('.session-item.on button[aria-label="会话操作"]').press('Enter');
  ok(await page.getByRole('menuitem', { name: '关闭对话', exact: true }).isVisible(), '[' + scheme + '] 会话菜单缺少关闭操作');
  await page.locator('.session-menu').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
  for (const c of (await page.evaluate(contrast)).slice(0, 5)) ok(false, '[' + scheme + '] 会话菜单对比度不足 ' + c);
  await page.screenshot({ path: path.join(SHOTS, scheme + '-session-menu.png') });
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称' }).fill('UI 回归验证 ' + scheme);
  await page.getByRole('button', { name: '保存名称' }).click();
  await page.waitForTimeout(250);
  ok((await page.locator('.stage-identity').innerText()).includes('UI 回归验证'), '[' + scheme + '] 会话重命名没有更新');
  await page.locator('.session-focus').first().click();
  await page.getByRole('button', { name: '查找会话', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索会话' }).fill('不存在的会话');
  ok(await page.locator('.session-search-results button').count() === 0, '[' + scheme + '] 会话搜索无效');
  await page.getByRole('textbox', { name: '搜索会话' }).fill('UI 回归验证 ' + scheme);
  ok(await page.locator('.session-search-results button').count() === 1, '[' + scheme + '] 搜索没有定位到会话');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-session-search.png') });
  await page.getByRole('textbox', { name: '搜索会话' }).press('Enter');
  await page.waitForTimeout(250);
  ok((await page.locator('.stage-identity').innerText()).includes('UI 回归验证 ' + scheme), '[' + scheme + '] 搜索结果不能切换会话');

  const resize = page.locator('[data-panel-resize-handle-id]');
  const handle = await resize.boundingBox();
  const widthBefore = (await page.locator('.stage').boundingBox()).width;
  await page.mouse.move(handle.x, handle.y + 200);
  await page.mouse.down(); await page.mouse.move(handle.x - 65, handle.y + 200, { steps: 6 }); await page.mouse.up();
  ok(Math.abs((await page.locator('.stage').boundingBox()).width - widthBefore) > 30, '[' + scheme + '] 面板分隔线不能调整宽度');
  await page.mouse.move(handle.x - 65, handle.y + 200); await page.mouse.down(); await page.mouse.move(handle.x, handle.y + 200, { steps: 6 }); await page.mouse.up();

  await page.locator('.rail button', { hasText: '设置' }).first().click();
  await page.waitForTimeout(600);
  ok(await page.locator('.settings-nav button').count() >= 4, '[' + scheme + '] 设置页导航项不足');
  ok(await page.locator('.settings-col').count() > 0, '[' + scheme + '] 设置页没有内容区');
  const settingsNavBefore = await page.locator('.settings-nav .nav-button').evaluateAll(navGeometry);
  await checkWindowDragging(page, ['.screen-head', '.screen-breadcrumb'], '[' + scheme + '] 设置标题栏');
  checkNavSpacing(settingsNavBefore, '[' + scheme + '] 设置导航');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-settings.png') });
  for (const issue of await page.evaluate(actionGeometry)) ok(false, '[' + scheme + '] 模型设置 ' + issue);
  await page.locator('.prov-row').first().getByRole('button', { name: '编辑', exact: true }).click();
  ok(await page.getByRole('dialog', { name: '编辑渠道' }).isVisible(), '[' + scheme + '] 编辑渠道按钮失效');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.rt-DialogOverlay').waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1080, height: 680 });
  for (const issue of await page.evaluate(actionGeometry)) ok(false, '[' + scheme + '] 小窗口模型设置 ' + issue);
  await page.screenshot({ path: path.join(SHOTS, scheme + '-settings-1080.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const c of (await page.evaluate(contrast)).slice(0, 10)) ok(false, '[' + scheme + '] 设置页对比度不足 ' + c);

  for (const name of ['运行参数', '外观', '关于与更新']) {
    await page.locator('.settings-nav').getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(150);
    const settingsNavAfter = await page.locator('.settings-nav .nav-button').evaluateAll(navGeometry);
    ok(settingsNavAfter.every((row, i) => ['x', 'y', 'width', 'height', 'iconX', 'labelX'].every(k => Math.abs(row[k] - settingsNavBefore[i][k]) < 0.5)), '[' + scheme + '] 点击“' + name + '”导致菜单位置变化');
    for (const c of (await page.evaluate(contrast)).slice(0, 5)) ok(false, '[' + scheme + '] ' + name + ' 对比度不足 ' + c);
    if (name === 'WDH 组件') { await page.getByRole('button', { name: '测试所选内核', exact: true }).click(); await page.getByText('浏览器启动与画面检查通过', { exact: true }).waitFor(); }
    await page.screenshot({ path: path.join(SHOTS, scheme + '-settings-' + ({ 'WDH 组件': 'browser', '运行参数': 'runtime', '外观': 'appearance', '关于与更新': 'about' }[name]) + '.png') });
  }
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click();
  const opposite = scheme === 'dark' ? 'light' : 'dark';
  await page.locator('.theme-option').filter({ hasText: opposite === 'dark' ? '深色' : '浅色' }).click();
  await page.locator('html[data-theme="' + opposite + '"]').waitFor({ state: 'attached', timeout: 3000 });
  ok(await page.locator('html').getAttribute('data-theme') === opposite, '[' + scheme + '] 主题切换没有生效');
  await page.locator('.theme-option').filter({ hasText: '跟随系统' }).click();
  await page.locator('html[data-theme="' + scheme + '"]').waitFor({ state: 'attached', timeout: 3000 });
  ok(await page.locator('html').getAttribute('data-theme') === scheme, '[' + scheme + '] 跟随系统没有恢复');

  await page.locator('.screen-head button').first().click();
  await page.waitForTimeout(300);
  await page.locator('.rail button', { hasText: '自动化任务' }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, scheme + '-automations.png') });
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  ok(await page.getByPlaceholder('例如：每天早上看一眼竞品接口').isVisible(), '[' + scheme + '] 新建任务表单不可用');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const notice = page.locator('[data-sonner-toast]').filter({ hasText: '先写清楚要 AI 做什么' });
  await notice.waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-sonner-toast]');
    return el && Math.abs(el.getBoundingClientRect().y - 60) < 1;
  });
  const noticeBounds = await notice.boundingBox();
  ok(noticeBounds.y >= 46 && noticeBounds.y < 90 && noticeBounds.height < 100, '[' + scheme + '] 通知没有在顶部紧凑显示');
  ok(Math.abs(noticeBounds.x + noticeBounds.width / 2 - 720) < 1, '[' + scheme + '] 通知没有水平居中');
  ok(await page.locator('[data-sonner-toaster]').getAttribute('data-sonner-theme') === scheme, '[' + scheme + '] 通知主题不一致');
  ok(await page.locator('.toasts').count() === 0, '[' + scheme + '] 旧通知容器未移除');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-notification.png') });
  await notice.getByRole('button', { name: '关闭通知', exact: true }).click();
  await notice.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.screen-head button').first().click();
  await page.waitForTimeout(300);

  await page.locator('.rail-nav').getByRole('button', { name: '插件', exact: true }).click();
  await page.locator('[data-plugin-id="wdh"]').waitFor();
  ok(await page.locator('.official-plugin').count() === 3, '[' + scheme + '] 官方插件应包含 WDH/IDH/ADH');
  await checkWindowDragging(page, ['.screen-head'], scheme + ' 插件顶部拖动');
  await page.locator('[data-plugin-id="wdh"]').getByRole('button', { name: '配置', exact: true }).click();
  await page.getByRole('button', { name: '测试所选内核', exact: true }).click();
  await page.getByText('浏览器启动与画面检查通过', { exact: true }).waitFor({ timeout: 90000 });
  await page.screenshot({ path: path.join(SHOTS, scheme + '-plugins.png') });
  await page.locator('.screen-head button').first().click();
  await page.getByRole('tab', { name: '浏览器', exact: true }).click();
  // Only use a local page. Browser launch, streaming, capture and detail are real.
  await page.getByRole('textbox', { name: '目标网址' }).fill('http://127.0.0.1:' + PORT + '/__ui-fixture');
  await page.getByRole('textbox', { name: '目标网址' }).press('Enter');
  await page.locator('.screen-canvas').waitFor({ state: 'visible', timeout: 25000 });
  await page.getByRole('button', { name: '前往', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('textbox', { name: '任务指令' }).fill('打开测试浏览器');
  await page.getByRole('button', { name: '发送（Enter）', exact: true }).click();
  await page.locator('.screen.ai-controlled').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(SHOTS, scheme + '-browser-ai-control.png') });
  await page.locator('.msg.assistant').filter({ hasText: '浏览器操控完成。' }).waitFor();
  await page.locator('.screen.ai-controlled').waitFor({ state: 'detached' });
  await page.waitForFunction(() => { const c = document.querySelector('.screen-canvas'); return c?.width > 50 && c.getContext('2d').getImageData(0, 0, 1, 1).data[3] > 0; });
  await page.screenshot({ path: path.join(SHOTS, scheme + '-browser-loaded.png') });
  await page.getByRole('button', { name: '上下文用量', exact: true }).click();
  ok(await page.getByRole('slider').count() === 0, '[' + scheme + '] 不应再显示调整上下文窗口的滑块');
  await page.keyboard.press('Escape');

  const debugUiCdp = await ctx.newCDPSession(page);
  const invokeTool = async (name, args) => {
    const script = '(async () => { const state = await window.api.invoke("session-list"); return window.api.invoke("tool-run", { sessionId: state.focused, name: ' + JSON.stringify(name) + ', args: ' + JSON.stringify(args) + ' }); })()';
    const reply = await debugUiCdp.send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true });
    ok(!reply.exceptionDetails && !reply.result.value?.isError, '[' + scheme + '] 调试工具失败 ' + name);
  };
  await invokeTool('discover_tools', { group: 'debugger' });
  await invokeTool('pause_or_resume', { action: 'pause' });
  await page.waitForTimeout(200);
  await invokeTool('get_paused_info', { includeScopes: false });
  await page.getByRole('button', { name: '恢复网页执行', exact: true }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, scheme + '-browser-paused.png') });
  await page.getByRole('button', { name: '恢复网页执行', exact: true }).click();
  await page.getByRole('button', { name: '恢复网页执行', exact: true }).waitFor({ state: 'detached', timeout: 8000 }).catch(async e => { throw new Error(e.message + '\n通知：' + (await page.locator('[data-sonner-toast]').allTextContents()).join(' | ')); });
  await debugUiCdp.detach();

  await page.keyboard.press('Control+Alt+3');
  const recordNetwork = page.getByRole('button', { name: '开始记录网络', exact: true });
  if (await recordNetwork.count()) {
    await recordNetwork.click();
    await page.keyboard.press('Control+Alt+2');
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.keyboard.press('Control+Alt+3');
  }
  await page.locator('.req-row').filter({ hasText: /api/ }).first().waitFor({ timeout: 15000 });
  await page.locator('.req-row').filter({ hasText: /api/ }).first().click();
  await page.locator('.detail-tabs').getByRole('tab', { name: '响应', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.detail-body')?.textContent.includes('UI capture verified'), { timeout: 10000 });
  ok((await page.locator('.detail-body').innerText()).includes('UI capture verified'), '[' + scheme + '] 请求响应没有正确显示');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-network.png') });
  await page.keyboard.press('Control+Alt+2');
  await page.locator('button[aria-label="关闭此会话的浏览器"]').click();

  await page.locator('.rail .new-session').click();
  await page.locator('.welcome').waitFor();

  const taskInput = page.getByRole('textbox', { name: '任务指令' });
  await taskInput.focus();
  const inputChrome = await page.locator('.composer-input').evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, shadow: getComputedStyle(el).boxShadow }));
  ok(inputChrome.outline === 'none' && inputChrome.shadow === 'none', '[' + scheme + '] 输入框获得焦点时不应出现内框');
  ok(await page.getByRole('button', { name: '输入命令', exact: true }).count() === 0, '[' + scheme + '] 不应保留独立命令按钮');
  await taskInput.fill('/');
  await page.getByRole('listbox', { name: '输入框命令' }).waitFor();
  for (const row of await page.locator('.command-option').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, lines: getComputedStyle(node.querySelector('span')).whiteSpace })))) ok(row.height <= 34 && row.lines === 'nowrap', '[' + scheme + '] 命令列表应为紧凑单行');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-composer-commands.png') });
  await taskInput.press('ArrowDown'); await taskInput.press('Tab');
  ok(await taskInput.inputValue() === '/compact ', '[' + scheme + '] 命令方向键/Tab补全失败');
  await taskInput.fill('/agent 核对工作区证据'); await taskInput.press('Enter');
  await page.locator('.agents-summary').waitFor(); await page.locator('.agents-summary').click();
  await page.locator('.subagent-row').filter({ hasText: '已完成' }).waitFor();
  await page.getByRole('button', { name: '核对工作区证据', exact: true }).click();
  await page.getByText('研究完成：工作区证据已核对。', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await taskInput.fill('/goal 验证目标机制'); await taskInput.press('Enter');
  await page.locator('.harness-goal').filter({ hasText: '已完成' }).waitFor();
  await page.locator('.msg.assistant').filter({ hasText: '目标验证完成。' }).waitFor();
  await page.screenshot({ path: path.join(SHOTS, scheme + '-harness-goal.png') });
  await page.reload(); await page.locator('.harness-goal').filter({ hasText: '目标机制验证通过。' }).waitFor();
  await page.getByRole('button', { name: '结束并收起目标', exact: true }).click();
  await page.locator('.harness-goal').waitFor({ state: 'detached' });
  await page.locator('.rail .new-session').click(); await page.locator('.welcome').waitFor();

  for (const viewport of [{ width: 1280, height: 800 }, { width: 1080, height: 680 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '[' + scheme + '] ' + viewport.width + ' 产生横向溢出');
    for (const issue of await page.evaluate(actionGeometry)) ok(false, '[' + scheme + '] ' + viewport.width + ' ' + issue);
    const inputBox = await page.locator('.composer').boundingBox();
    ok(inputBox.y + inputBox.height < viewport.height - 20, '[' + scheme + '] ' + viewport.width + ' 输入框被裁切');
    const lastSuggestion = await page.locator('.suggestion').last().boundingBox();
    const messageArea = await page.locator('.msgs').boundingBox();
    ok(lastSuggestion.y + lastSuggestion.height <= messageArea.y + messageArea.height + 1, '[' + scheme + '] ' + viewport.width + ' 快捷分析入口被裁切');
    await page.screenshot({ path: path.join(SHOTS, scheme + '-chat-' + viewport.width + '.png') });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  // Saved-history fixture; all displayed data is explicitly labelled as an example.
  // Patchright evaluates in an isolated world; the app bridge lives in the main world.
  const mainWorld = await ctx.newCDPSession(page);
  const focusedResult = await mainWorld.send('Runtime.evaluate', { expression: 'window.api.invoke("session-list").then(s => s.focused)', awaitPromise: true, returnByValue: true });
  const imageResult = await mainWorld.send('Runtime.evaluate', { expression: 'window.api.invoke("attach-upload", ' + JSON.stringify({ sessionId: focusedResult.result.value, name: '图片示例.png', mime: 'image/png', data: imageData }) + ')', awaitPromise: true, returnByValue: true });
  const fixtureImageId = imageResult.result.value.id;
  const fixtureEvents = [
    { t: 'user', id: 'fixture-user', turnId: 'fixture-turn', at: Date.now() - 10000, displayContent: '帮我检查这个项目，修复问题并验证。参考这张图片，把界面收敛得更清楚一些。', content: '帮我检查项目。', attachments: [{ kind: 'attachment', id: fixtureImageId, name: '图片示例.png', image: true }], images: [fixtureImageId] },
    { t: 'assistant', turnId: 'fixture-turn', phase: 'commentary', content: '我先读取入口文件，再搜索相关逻辑，最后运行测试。', calls: [
      {id:'fixture', itemId:'fixture-1', name:'workspace_read', args:{path:'src/main.ts'}},
      {id:'fixture-search', itemId:'fixture-2', name:'workspace_grep', args:{pattern:'TODO'}},
      {id:'fixture-eval', itemId:'fixture-3', name:'workspace_shell', args:{cmd:'npm test'}}
    ] },
    { t: 'tool', turnId:'fixture-turn', id:'fixture', itemId:'fixture-1', name:'workspace_read', content:'export function main() { return true; }', ms:42 },
    { t: 'tool', turnId:'fixture-turn', id:'fixture-search', itemId:'fixture-2', name:'workspace_grep', content:'没有未完成项。', ms:18 },
    { t: 'tool', turnId:'fixture-turn', id:'fixture-eval', itemId:'fixture-3', name:'workspace_shell', content:'Tests: 12 passed', ms:11 },
    { t: 'assistant', turnId:'fixture-turn', phase:'final_answer', content:'已完成这一轮检查。\n\n- 用户输入、执行过程和最终回复已分开。\n- 工具详情默认收起，需要时可以展开查看。\n- 图片保留在原消息中，重新打开对话后仍可预览。\n\n测试通过，可以继续体验。\n\n```ts\nexport function main() {\n  return true;\n}\n```' },
    { t: 'turn-end', turnId:'fixture-turn', stop:'completed', endedAt: Date.now() - 5000 }
  ];
  await mainWorld.send('Runtime.evaluate', { expression: 'window.api.invoke("test-seed-history", ' + JSON.stringify({sessionId:focusedResult.result.value,events:fixtureEvents}) + ')', awaitPromise:true, returnByValue:true });
  await page.reload();
  await page.locator('.tool-group > summary').waitFor();
  await page.locator('.msg.user .attachment-image img').waitFor();
  const skipAgain = page.getByRole('button', { name: '稍后', exact: true });
  if (await skipAgain.count()) await skipAgain.click();
  ok(await page.locator('.todo-strip').count() === 0, '[' + scheme + '] 没有实际任务时仍显示默认清单');
  ok(!await page.locator('.tool-head').first().isVisible(), '[' + scheme + '] 连续工具调用没有默认收起');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-conversation.png') });
  await page.locator('.tool-group > summary').press('Enter');
  await page.locator('.tool-head').nth(2).waitFor({ state: 'visible' });
  ok(await page.locator('.tool-head:visible').count() === 3, '[' + scheme + '] 工具分组不能通过键盘展开');
  await page.locator('.tool-head').first().click();
  ok(await page.locator('.tool-body').isVisible(), '[' + scheme + '] 工具调用记录不能展开');
  ok((await page.locator('.tool-body').innerText()).includes('42 ms'), '[' + scheme + '] 工具调用时长没有显示在详情中');
  ok(await page.locator('.md pre code').count() > 0, '[' + scheme + '] 代码块没有渲染');
  await page.screenshot({ path: path.join(SHOTS, scheme + '-tool-detail.png') });
  await page.locator('.tool-group > summary').press('Enter');
  await page.locator('.tool-head').first().waitFor({ state: 'hidden' });
  ok(!await page.locator('.tool-head').first().isVisible(), '[' + scheme + '] 工具分组不能收起');
  await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: path.join(SHOTS, scheme + '-conversation-code.png') });
  for (const c of (await page.evaluate(contrast)).slice(0, 8)) ok(false, '[' + scheme + '] 对话与代码对比度不足 ' + c);
  const closeTools = page.getByRole('button', { name: '收起工具面板', exact: true });
  if (await closeTools.count()) await closeTools.click();
  const closeRail = page.getByRole('button', { name: '收起会话列表', exact: true });
  if (await closeRail.count()) await closeRail.click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.msgs').evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = 0; });
  await page.screenshot({ path: path.join(SHOTS, scheme + '-conversation-focused.png') });
  ok(errs.length === 0, '[' + scheme + '] 遍历后报错: ' + (errs[0] || ''));
  await ctx.close();
} } finally {
  await browser.close(); srv.close(); sidecar.kill();
}

if (fails.length) {
  console.error('\n✖ UI 契约失败 ' + fails.length + ' 项：');
  for (const f of fails) console.error('  · ' + f);
  console.error('\n截图：' + SHOTS);
  process.exit(1);
}
console.log('✔ UI 契约通过（截图：' + SHOTS + '）');
