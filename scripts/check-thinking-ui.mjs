// 「思考强度」的定向验收。
//
// 单测已经锁住发送片段与持久化，但 UI 这条链只有真跑浏览器才看得见：
//   设置页声明的档位 → 输入坞选择器只出现这些档位 → 点一下真的写进 settings.json。
// 这里同时防两类回归：
//   1) 没声明档位的模型不该渲染选择器（那是个按了没反应的控件）；
//   2) 滑块给出的档位不能超出模型声明范围（否则拖到最高会发出模型不支持的参数）。
//
// 用法：node scripts/check-thinking-ui.mjs（需先 npm run build:ui）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const PORT = 5241, WS_PORT = 5242, TOKEN = 'thinkingtest';
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

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'thinking-ui-'));
const APP = path.join(DATA, 'WebDecryptHub');
fs.mkdirSync(APP, { recursive: true });
// 起点：一个声明了五档的模型（gpt-5.1）和一个没有任何声明的模型（gpt-4o）。
// 后者用来证明「未声明就不渲染选择器」，不是靠界面自己判断模型名。
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({
  provider: 'openai', headless: true, embedMode: 'screencast',
  activeProviderId: 'p1', activeModel: 'gpt-5.1',
  onboarding: { version: 1, completedAt: new Date().toISOString() },
  openai: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gpt-5.1', apiKey: 'fixture-key' },
  providers: [{
    id: 'p1', name: '验收渠道', type: 'openai', baseUrl: 'http://127.0.0.1:9/v1',
    models: [
      { id: 'gpt-5.1', name: 'gpt-5.1', thinking: { levels: ['off', 'low', 'medium', 'high'], default: 'medium', transport: 'effort' } },
      { id: 'gpt-4o', name: 'gpt-4o' },
    ],
  }],
}));

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'],
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
const readSettings = () => JSON.parse(fs.readFileSync(path.join(APP, 'settings.json'), 'utf8'));

try {
  await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN);
  await page.locator('.stage-head').waitFor();

  const scope = 'thinking-ui-check';
  const root = path.join(DATA, 'project');
  fs.mkdirSync(root);
  const grant = { sessionId: scope, path: root, expiresAt: Date.now() + 60000 };
  grant.signature = folderProof(TOKEN, grant);
  const project = await rpc('project-save', { scope, project: { name: '思考强度验收', folders: [{ key: 'main', grant }], primaryKey: 'main' } });
  const created = await rpc('session-create', { projectId: project.id });
  await rpc('session-focus', { sessionId: created.id });
  await page.reload();
  await page.locator('.composer').waitFor({ timeout: 15000 });

  // 1) 声明了档位的模型：模型座位出现，触发器同时写模型名与默认档（medium → 中）
  const trigger = page.locator('.composer-seat .seat-trigger');
  await trigger.waitFor({ timeout: 8000 });
  const triggerText = (await trigger.innerText()).trim();
  ok(/gpt-5\.1/.test(triggerText), '触发器应写出模型名（实际 ' + JSON.stringify(triggerText) + '）');
  ok(/中/.test(triggerText), '触发器应显示模型默认档「中」（实际 ' + JSON.stringify(triggerText) + '）');

  // 2) 打开浮层：只能看到声明的四个档位，不能出现声明外的 minimal
  await trigger.click();
  const pop = page.locator('.seat-pop');
  await pop.waitFor({ timeout: 8000 });
  const stops = pop.locator('.thinking-stop');
  ok(await stops.count() === 4, '滑块应只有声明的 4 个档位（实际 ' + await stops.count() + '）');
  const ticks = await pop.locator('.thinking-tick').allInnerTexts();
  ok(JSON.stringify(ticks) === JSON.stringify(['关闭', '低', '中', '高']), '刻度应是声明的档位集合（实际 ' + JSON.stringify(ticks) + '）');
  ok(!ticks.includes('最少'), '不能出现未声明的「最少」档');
  // 设计图要求：大号档位名 + 其下带箭头的模型行，两者都在同一个浮层里
  ok((await pop.locator('.thinking-level').innerText()).trim() === '中', '浮层应大字显示当前档位');
  ok(/gpt-5\.1/.test(await pop.locator('.seat-modelrow').innerText()), '档位下方应是可点的模型行');
  // 底部必须如实说出会发什么，而不是只写「更聪明」
  const payload = await pop.locator('.thinking-payload').innerText();
  ok(/reasoning_effort: medium/.test(payload), '应显示实际发送的参数（实际 ' + JSON.stringify(payload) + '）');
  await page.screenshot({ path: path.join(ROOT, '.thinking-ui-pop.png') });

  // 3) 点最高档 → 写入 settings.json，触发器跟着变
  await stops.nth(3).click();
  await page.waitForTimeout(400);
  ok(readSettings().activeThinking === 'high', '选高后应写入 activeThinking=high（实际 ' + JSON.stringify(readSettings().activeThinking) + '）');
  await trigger.waitFor();
  ok(/高/.test((await trigger.innerText()).trim()), '触发器应显示「高」（实际 ' + JSON.stringify((await trigger.innerText()).trim()) + '）');
  const payloadHigh = await pop.locator('.thinking-payload').innerText();
  ok(/reasoning_effort: high/.test(payloadHigh), '高对应 reasoning_effort: high（实际 ' + JSON.stringify(payloadHigh) + '）');
  await page.keyboard.press('Escape');

  // 4) 键盘可达：聚焦滑杆后按 Home/ArrowRight 也能改档
  //    注意必须重新打开浮层——上一步按 Escape 已经把它卸载，对已卸载节点 focus() 不会生效。
  await trigger.click();
  await page.locator('.seat-pop').waitFor({ timeout: 8000 });
  const slider = page.locator('.seat-pop .thinking-slider');
  await slider.focus();
  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  ok(readSettings().activeThinking === 'off', 'Home 应选中第一档关闭（实际 ' + JSON.stringify(readSettings().activeThinking) + '）');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  ok(readSettings().activeThinking === 'low', 'ArrowRight 应前进到下一档（实际 ' + JSON.stringify(readSettings().activeThinking) + '）');
  await page.keyboard.press('Escape');

  // 4b) 模型行是真实入口：从座位里钻取到模型目录并切换模型（不是只显示个名字）
  await trigger.click();
  await page.locator('.seat-pop').waitFor({ timeout: 8000 });
  await page.locator('.seat-pop .seat-modelrow').click();
  await page.locator('.seat-pop .seat-list').waitFor({ timeout: 8000 });
  await page.locator('.seat-pop .seat-item', { hasText: 'gpt-4o' }).click();
  await page.waitForTimeout(600);
  ok(readSettings().activeModel === 'gpt-4o', '从座位里应能切到 gpt-4o（实际 ' + JSON.stringify(readSettings().activeModel) + '）');

  // 5) 切到没有声明的模型：强度那部分必须消失，不能留一个拖了没反应的滑杆
  //    座位本身要留着——它仍然是选模型的唯一入口。
  ok(await page.locator('.seat-trigger').count() === 1, '未声明档位的模型仍应有模型座位');
  ok(await page.locator('.thinking-slider').count() === 0, '未声明档位时不应渲染滑杆');
  await page.locator('.seat-trigger').click();
  await page.locator('.seat-pop').waitFor({ timeout: 8000 });
  ok(await page.locator('.seat-pop .thinking-level').count() === 0, '未声明档位时浮层不应有大号档位名');
  ok(await page.locator('.seat-pop .seat-note').count() === 1, '未声明档位时应说明不发思考参数');
  await page.keyboard.press('Escape');

  // 6) 设置页：模型行显示声明，弹窗能改
  await page.locator('.rail-bottom .rail-account').click();
  await page.getByRole('menuitem', { name: /^设置/ }).click();
  await page.locator('.settings-nav').getByRole('button', { name: 'AI 模型', exact: true }).click();
  await page.locator('.prov-row').first().getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑渠道' }).waitFor();
  const badges = await page.locator('.model-row').allInnerTexts();
  ok(badges.some(text => /思考 关闭 \/ 低 \/ 中 \/ 高/.test(text)), '模型行应显示声明的档位（实际 ' + JSON.stringify(badges) + '）');
  await page.screenshot({ path: path.join(ROOT, '.thinking-ui-settings.png') });

  ok(pageErrors.length === 0, '页面不应有运行时错误：' + pageErrors.join(' | '));
} catch (error) {
  console.error('  x ' + error.message);
  console.error('  页面文本：' + (await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
  bad++;
} finally {
  await context.close(); await browser.close();
  srv.close(); sidecar.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}

console.log(bad ? 'FAIL: ' + bad + ' 项' : 'OK: 思考强度通过');
process.exit(bad ? 1 : 0);
