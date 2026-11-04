// 输入坞「上下文用量」控件的定向验收。
//
// 只锁「读不读得清」这一条行为契约（对比度、占比、阈值位置），不锁像素长相。
// 全站的 check-ui.mjs 仍然保留并继续在 CI 里跑（它覆盖其余交互面），
// 但那类脚本容易把「当时那一版长什么样」写成断言，改间距就红、反而绊住视觉调整；
// 所以涉及视觉细节的改动优先补这种针对单一控件的验收，而不是往 check-ui 里堆断言。
// 而那正是这次改动的全部理由：原来的 16px 细环 + alpha 灰轨道在深色底上几乎不可见，
// 并且整条分段条恒被用量自身铺满，读不出「占整窗多少」。
//
// 这里量三件事：
//   1) 静止态可见：胶囊有底色/描边，环的两个笔画与数字都不是 alpha 透明的灰；
//   2) 读数可读：数字与背景对比度达标（>=4.5:1），且与 sidecar 报的百分比一致；
//   3) 比例可信：分段条里已用部分占整条的比例 ≈ 用量占窗口的比例，阈值线落在对应位置。
//
// 用法：node scripts/check-context-meter.mjs（需先 npm run build:ui）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { folderProof } from '../sidecar/grants.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');
const PORT = Number(process.env.JSRA_CTX_HTTP_PORT || 5231), WS_PORT = PORT + 1;
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(p => fs.existsSync(p));

let bad = 0;
const ok = (cond, message) => { console.log((cond ? '  ok ' : '  x ') + message); if (!cond) bad++; };

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('先跑 npm run build:ui'); process.exit(2); }
if (!CHROME) { console.error('找不到 Chrome/Edge，设置 CHROME_PATH'); process.exit(2); }

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-meter-'));
const TOKEN = 'ctxtest-' + Math.random().toString(36).slice(2, 10);
const APP = path.join(DATA, 'WebDecryptHub');
fs.mkdirSync(APP, { recursive: true });
// 首启引导要跳过，否则输入坞根本不存在。
fs.writeFileSync(path.join(APP, 'settings.json'), JSON.stringify({
  provider: 'openai', headless: true, embedMode: 'screencast',
  onboarding: { version: 1, completedAt: new Date().toISOString() },
}));
const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, DECRYPTHUB_DATA_DIR: APP, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN, JSRA_TEST_FIXTURES: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let sidecarErr = '';
sidecar.stderr.on('data', d => { sidecarErr += String(d); });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('sidecar 未就绪：' + sidecarErr.slice(0, 400))), 25000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } });
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

const rpc = (channel, args = {}) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:' + WS_PORT + '/?token=' + TOKEN);
  const timer = setTimeout(() => { ws.terminate(); reject(Error('RPC timeout: ' + channel)); }, 30000);
  ws.once('open', () => ws.send(JSON.stringify({ type: 'invoke', id: 1, channel, args })));
  ws.on('message', raw => { const m = JSON.parse(raw); if (m.id !== 1) return; clearTimeout(timer); ws.close(); m.error ? reject(Error(m.error)) : resolve(m.result); });
  ws.once('error', e => { clearTimeout(timer); reject(e); });
});

// 在页面里量颜色与几何。对比度算式与 check-ui 的 getContrastIssues 保持一致。
const PROBE = () => {
  const parse = c => { const m = String(c).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = c => { const f = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  const bgOf = el => { for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const c = parse(getComputedStyle(a).backgroundColor); if (c && (c[3] === undefined || c[3] > 0.5)) return c; } return parse(getComputedStyle(document.body).backgroundColor) || [24, 25, 29, 1]; };
  const btn = document.querySelector('.ctx-meter');
  if (!btn) return { missing: true };
  const cs = getComputedStyle(btn);
  const num = btn.querySelector('.ctx-meter-num');
  const track = btn.querySelector('.ctx-ring-track');
  const arc = btn.querySelector('.ctx-ring-arc');
  const trackStroke = track && getComputedStyle(track).stroke;
  const arcStroke = arc && getComputedStyle(arc).stroke;
  // 圆环笔画是否带 alpha：alpha 笔画在深色底上会被背景稀释。
  const alphaOf = c => { const v = parse(c); return v && v.length === 4 ? v[3] : 1; };
  const bar = document.querySelector('.ctx-bar');
  const parts = bar ? [...bar.querySelectorAll('i:not(.ctx-rest)')].map(el => el.getBoundingClientRect().width) : [];
  const rest = bar?.querySelector('.ctx-rest')?.getBoundingClientRect().width || 0;
  const barW = bar?.getBoundingClientRect().width || 0;
  const limit = bar?.querySelector('.ctx-limit')?.getBoundingClientRect();
  const barBox = bar?.getBoundingClientRect();
  return {
    label: btn.getAttribute('aria-label'), title: btn.getAttribute('title'),
    text: num?.textContent || '', visible: btn.getBoundingClientRect().width > 0,
    buttonBg: cs.backgroundColor, buttonBorder: cs.borderColor, canvasBg: getComputedStyle(document.querySelector('.app') || document.body).backgroundColor,
    numColor: num && getComputedStyle(num).color, numSize: num && parseFloat(getComputedStyle(num).fontSize),
    numContrast: num ? ratio(parse(getComputedStyle(num).color), bgOf(btn)) : 0,
    trackStroke, arcStroke, trackAlpha: alphaOf(trackStroke), arcAlpha: alphaOf(arcStroke),
    ringStrokeWidth: track && parseFloat(getComputedStyle(track).strokeWidth),
    barWidth: barW, usedWidth: parts.reduce((a, b) => a + b, 0), restWidth: rest,
    limitLeft: limit && barBox ? (limit.left - barBox.left) / barBox.width : null,
    tone: [...btn.classList].find(c => ['ok', 'warn', 'full', 'idle'].includes(c)) || '',
  };
};

const { chromium } = await import('../node_modules/@zhizhuodemao/patchright/index.mjs');
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
let shots = 0;
try {
  for (const scheme of (process.env.JSRA_UI_SCHEME ? [process.env.JSRA_UI_SCHEME] : ['dark', 'light'])) {
    console.log('检查主题：' + scheme);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    // 空仓库首屏是「添加第一个项目」，输入坞根本不存在。所有准备都走 RPC，页面只负责渲染。
    // 项目目录必须带 grants 签名，否则 project-save 会被「目录未授权」挡回来。
    const scope = 'ctx-project-' + scheme;
    const folder = path.join(DATA, 'work-' + scheme);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'README.md'), '# fixture\n');
    const grant = { sessionId: scope, path: folder, expiresAt: Date.now() + 60000 };
    grant.signature = folderProof(TOKEN, grant);
    const project = await rpc('project-save', { scope, project: { name: 'ctx-fixture-' + scheme, folders: [{ key: 'root', grant }], primaryKey: 'root' } });
    let list = await rpc('session-list');
    let sid = list?.focused;
    if (!sid) { list = await rpc('session-create', { projectId: project.id, title: '上下文用量验收' }); sid = list.focused; }
    // 灌一段真实历史，让 sidecar 报出非零用量：零用量时圆环没有弧，量不到弧的可见性。
    const filler = Array.from({ length: 40 }, (_, i) => ({ t: 'tool', name: 'workspace_read', content: 'FIXTURE_LINE_' + i + ' ' + 'x'.repeat(400) }));
    await rpc('test-seed-history', { sessionId: sid, events: filler }).catch(e => console.error('  ! 灌历史失败：' + e.message));

    await page.goto('http://127.0.0.1:' + PORT + '/?port=' + WS_PORT + '&token=' + TOKEN, { waitUntil: 'load' });
    await page.locator('.ctx-meter').waitFor({ timeout: 20000 });

    const p = await page.evaluate(PROBE);
    ok(!p.missing, '[' + scheme + '] 输入坞应有上下文用量控件');
    ok(p.visible, '[' + scheme + '] 控件不应被窄窗口隐藏');
    ok(!!p.label && p.label === '上下文用量', '[' + scheme + '] 控件应有可访问名称');
    ok(p.buttonBg !== 'rgba(0, 0, 0, 0)', '[' + scheme + '] 静止态不能完全透明，否则看不出这里有个控件');
    ok(/^[\d]+%|—$/.test(p.text), '[' + scheme + '] 控件应直接给出百分比读数（实际 "' + p.text + '"）');
    ok(p.numSize >= 11, '[' + scheme + '] 读数不应小于 11px');
    ok(p.numContrast >= 4.5, '[' + scheme + '] 读数对比度应 >= 4.5:1（实际 ' + p.numContrast.toFixed(2) + ':1）');
    ok(p.trackAlpha === 1, '[' + scheme + '] 圆环轨道不能用 alpha 笔画（实际 ' + p.trackStroke + '）');
    ok(p.arcAlpha === 1, '[' + scheme + '] 圆环用量弧不能用 alpha 笔画（实际 ' + p.arcStroke + '）');
    ok(p.ringStrokeWidth >= 2.8, '[' + scheme + '] 圆环笔画应加粗到 2.8px 以上（实际 ' + p.ringStrokeWidth + '）');
    // 轨道与用量弧必须靠颜色区分开；轨道太暗时低用量下整圈会与背景糊在一起。
    const trackLum = (() => { const v = String(p.trackStroke).match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; })();
    const canvasLum = (() => { const c = String(p.canvasBg).match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; })();
    const trackRatio = (Math.max(trackLum, canvasLum) + 0.05) / (Math.min(trackLum, canvasLum) + 0.05);
    ok(trackRatio >= 3, '[' + scheme + '] 轨道相对底色要有 3:1 以上对比（非文本图形要求），否则低用量时看不出是进度环（实际 ' + trackRatio.toFixed(2) + ':1）');

    // 展开浮层：核对读数与 sidecar 一致、分段条按整窗比例。
    await page.locator('.ctx-meter').click();
    await page.getByRole('dialog', { name: '上下文用量' }).or(page.locator('[aria-label="上下文用量"][data-overlay]')).first().waitFor({ timeout: 5000 }).catch(() => {});
    await page.locator('.ctx-bar').waitFor({ timeout: 5000 });
    const snapshot = await rpc('session-snapshot', { sessionId: sid }).catch(() => null);
    const ctx = snapshot?.context;
    const pop = await page.evaluate(PROBE);
    if (ctx?.limit > 0) {
      const shown = parseInt(p.text, 10), actual = Math.round(ctx.pct * 100);
      ok(Math.abs(shown - actual) <= 1, '[' + scheme + '] 控件读数应与 sidecar 一致（显示 ' + shown + '%，实际 ' + actual + '%）');
      const usedRatio = pop.usedWidth / (pop.barWidth || 1);
      ok(Math.abs(usedRatio - ctx.pct) < 0.06, '[' + scheme + '] 分段条已用部分应占整条 ' + Math.round(ctx.pct * 100) + '%，实际 ' + Math.round(usedRatio * 100) + '%');
      ok(pop.limitLeft !== null && Math.abs(pop.limitLeft - ctx.trigger / ctx.limit) < 0.03, '[' + scheme + '] 阈值线应落在 ' + Math.round(ctx.trigger / ctx.limit * 100) + '% 处（实际 ' + (pop.limitLeft === null ? '缺失' : Math.round(pop.limitLeft * 100) + '%') + '）');
      ok(await page.getByText('已用 ' + fmt(ctx.used) + ' / ' + fmt(ctx.limit), { exact: false }).count() >= 1, '[' + scheme + '] 浮层应给出具体 token 数');
    } else {
      console.log('  - 跳过读数一致性：sidecar 未给出窗口容量');
    }
    await page.screenshot({ path: path.join(ROOT, 'artifacts', 'ui', scheme + '-context-meter.png'), clip: await page.locator('.composer').boundingBox() }).then(() => shots++).catch(() => {});
    await page.keyboard.press('Escape');

    ok(errs.length === 0, '[' + scheme + '] 页面不应报错：' + errs.join(' | '));
    await context.close();
  }
} catch (error) {
  console.error('  x ' + error.message);
  bad++;
} finally {
  await browser.close(); srv.close(); sidecar.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}

function fmt(n) {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}

console.log(bad ? 'FAIL: ' + bad + ' 项' : 'OK: 上下文用量控件清晰可读' + (shots ? '（截图 ' + shots + ' 张）' : ''));
process.exit(bad ? 1 : 0);
