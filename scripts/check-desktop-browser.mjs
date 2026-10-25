// Regression for the real native -> Node -> Chromium launch chain, including Windows MIC.
// The hidden native window and fresh app data never reuse the user's chat or browser profiles.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from 'ws';
import { fileIntegrity } from '../sidecar/windows-runtime.mjs';
const root = process.cwd(), binary = path.resolve('src-tauri/target/debug/jsra-tauri.exe');
if (process.platform !== 'win32') throw new Error('Native Windows regression only');
if (!(await fileIntegrity(binary)).normal) throw new Error('Run node scripts/prepare-windows-runtime.mjs desktop first');
const parent = path.resolve('.tmp'); fs.mkdirSync(parent, { recursive: true }); const data = fs.mkdtempSync(path.join(parent, 'native-browser-'));
if (process.env.JSRA_SMOKE_CLOAK) {
  const distribution = path.join(data, 'WebDecryptHub/kernels/legacy-cloak/browser');
  fs.mkdirSync(distribution, { recursive: true }); fs.cpSync(path.dirname(process.env.JSRA_SMOKE_CLOAK), distribution, { recursive: true });
  fs.writeFileSync(path.join(data, 'WebDecryptHub/kernels/cloak.json'), JSON.stringify({ kind: 'cloak', repository: 'CloakHQ/cloakbrowser', relativePath: 'legacy-cloak/browser/' + path.basename(process.env.JSRA_SMOKE_CLOAK), version: 'native-regression-fixture' }));
  execFileSync(path.join(process.env.SystemRoot, 'System32/icacls.exe'), [distribution, '/setintegritylevel', '(OI)(CI)L', '/T', '/Q'], { windowsHide: true, stdio: 'pipe' });
}
const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url.startsWith('/api') ? 'application/json' : 'text/html'); res.end(req.url.startsWith('/api') ? '{"nativeCapture":true}' : '<h1>Native browser verified</h1><script>const NATIVE_SOURCE_PROOF = 42;fetch("/api?sign=native")</script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(binary, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, DECRYPTHUB_DATA_DIR: path.join(data, 'WebDecryptHub'), JSRA_SIDECAR_NODE: path.resolve('sidecar/index.mjs'), JSRA_UI_DEV_URL: '', JSRA_DESKTOP_SMOKE: '1', JSRA_DEV: '1', JSRA_DEV_ENDPOINT: '1', JSRA_WS_PORT: '0' } });
const endpointFile = path.join(data, 'WebDecryptHub/dev-endpoint.json'); let socket, seq = 0; const pending = new Map(); const evidence = [];
const until = async fn => { const end = Date.now() + 30000; while (!(await fn())) { if (child.exitCode !== null) throw new Error('Native host exited: ' + child.exitCode); if (Date.now() > end) throw new Error('Native regression timed out'); await new Promise(resolve => setTimeout(resolve, 40)); } };
const invoke = (channel, args = {}) => new Promise((resolve, reject) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(channel + ' timeout')); }, 60000); pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } }); socket.send(JSON.stringify({ type: 'invoke', id, channel, args })); });
try {
  await until(() => fs.existsSync(endpointFile)); const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
  socket = new WebSocket(`ws://127.0.0.1:${endpoint.port}/?token=${endpoint.token}`);
  socket.on('message', raw => { const msg = JSON.parse(raw); const item = pending.get(msg.id); if (item) { pending.delete(msg.id); msg.error ? item.reject(new Error(msg.error)) : item.resolve(msg.result); } });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const doctor = await invoke('doctor'); if (!doctor.hostIntegrity.normal) throw new Error('Native sidecar inherited low integrity');
  console.log('Native -> Node integrity: ' + doctor.hostIntegrity.level);
  const sid = (await invoke('session-list')).focused;
  const kernels = [['system', '']]; if (process.env.JSRA_SMOKE_CLOAK) kernels.push(['cloak', '']);
  for (const [kernel, chromePath] of kernels) {
    const settings = await invoke('get-settings'); await invoke('save-settings', { ...settings, kernel, chromePath, headless: false, embedMode: 'auto' });
    if (kernel === 'cloak') {
      const blocked = await invoke('browser-launch', { sessionId: sid }); if (blocked.ok || !blocked.error.includes('低完整性')) throw new Error('Legacy low-integrity kernel must fail with a clear diagnostic');
      const repaired = await invoke('kernel-repair', { kind: 'cloak' }); if (!repaired.ok) throw new Error(repaired.error);
      console.log('Legacy CloakBrowser repair: passed (code files only)');
    }
    const opened = await invoke('browser-launch', { sessionId: sid }); if (!opened.ok) throw new Error(opened.error);
    await invoke('navigate', { sessionId: sid, url: `http://127.0.0.1:${server.address().port}` });
    const snapshot = await invoke('tool-run', { sessionId: sid, name: 'browser_snapshot', args: {} }); if (!snapshot.text.includes('Native browser verified')) throw new Error('Native DOM snapshot failed');
    await until(async () => (await invoke('get-requests', { sessionId: sid })).list.some(r => r.url.includes('/api') && r.bodyState === 'ok'));
    const debug = await invoke('tool-run', { sessionId: sid, name: 'discover_tools', args: { group: 'debugger' } }); if (debug.isError) throw new Error(debug.text);
    const source = await invoke('tool-run', { sessionId: sid, name: 'search_in_sources', args: { query: 'NATIVE_SOURCE_PROOF' } }); if (source.isError || !source.text.includes('NATIVE_SOURCE_PROOF')) throw new Error('Native debugger source search failed');
    const session = (await invoke('session-list')).sessions.find(s => s.id === sid); if (!session.chromePid) throw new Error('Headed Chrome PID missing');
    const commandLine = execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `[Console]::Write((Get-CimInstance Win32_Process -Filter "ProcessId=${Number(session.chromePid)}").CommandLine)`], { encoding: 'utf8', windowsHide: true });
    if (/--no-sandbox|--disable-gpu-sandbox|--in-process-gpu/.test(commandLine)) throw new Error('Browser isolation was weakened');
    evidence.push({ kernel, hostIntegrity: doctor.hostIntegrity.level, headed: true, snapshot: true, capture: true, debugger: true, chromiumSandbox: true });
    await invoke('browser-close', { sessionId: sid }); console.log('Native browser passed: ' + (kernel === 'system' ? 'system Chrome/Edge' : 'CloakBrowser') + ' (headed, DOM, capture, debugger)');
  }
  fs.writeFileSync(path.join(data, 'results.json'), JSON.stringify(evidence, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) await invoke('browser-close', { sessionId: (await invoke('session-list')).focused }).catch(() => {});
  socket?.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // This exact process was created above; no process-name or system-wide termination.
  if (child.exitCode === null) { child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]); }
  console.log('Native regression evidence: ' + data);
}
