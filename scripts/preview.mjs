// 预览：把打包好的前端（ui-dist）用静态服务跑起来，并拉起真正的 sidecar。
// 用途：不需要重编 Rust 也能完整看一遍界面与抓包面板。
// 用法：node scripts/preview.mjs [--port 5333] [--appdata <dir>]
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 5333));
const WS_PORT = PORT + 1;
const TOKEN = 'preview-' + Math.random().toString(36).slice(2, 10);
const APPDATA = arg('appdata', '') || path.join(os.tmpdir(), 'wdh-preview');
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'ui-dist');

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('✖ 先跑 npm run build:ui'); process.exit(2); }
fs.mkdirSync(path.join(APPDATA, 'WebDecryptHub'), { recursive: true });
const settingsFile = path.join(APPDATA, 'WebDecryptHub', 'settings.json');
if (!fs.existsSync(settingsFile)) {
  fs.writeFileSync(settingsFile, JSON.stringify({ provider: 'openai', headless: false, embedMode: 'screencast', antiDebug: true }, null, 2));
}

const sidecar = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], {
  cwd: ROOT,
  env: { ...process.env, APPDATA, JSRA_WS_PORT: String(WS_PORT), JSRA_WS_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const ready = new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('sidecar 20s 内没起来')), 20000);
  sidecar.stdout.on('data', d => { if (/JSRA_PORT=/.test(String(d))) { clearTimeout(t); res(); } });
});
await ready.catch(e => { console.error('✖ ' + e.message); sidecar.kill(); process.exit(2); });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(p));
});
srv.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/?port=${WS_PORT}&token=${TOKEN}`;
  console.log('预览地址：' + url);
  console.log('数据目录：' + APPDATA);
  console.log('关闭：Ctrl+C（或结束本进程）');
});

const bye = () => { try { sidecar.kill(); } catch {} srv.close(); process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
