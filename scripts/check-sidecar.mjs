// Smoke the actual packaged payload, not the source entry.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
const nodeHost = process.platform === 'win32' && !process.argv[2];
const binary = path.resolve(process.env.JSRA_SMOKE_NODE || process.argv[2] || (nodeHost ? 'build/resources/node/node.exe' : 'build/jsra-sidecar-linux'));
const entry = path.resolve('build/resources/sidecar/main.mjs');
if (!fs.existsSync(binary)) throw new Error('Build the sidecar first');
const fixtureParent = path.resolve('.tmp'); fs.mkdirSync(fixtureParent, { recursive: true });
const root = fs.mkdtempSync(path.join(fixtureParent, 'agent-payload-')), token = crypto.randomBytes(24).toString('hex');
const marker = path.join(root, 'untrusted-preload-ran');
fs.mkdirSync(path.join(root, 'WebDecryptHub'));
fs.writeFileSync(path.join(root, '.env'), 'JSRA_WS_TOKEN=wrong-token-from-working-directory\n');
fs.writeFileSync(path.join(root, 'preload.cjs'), 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "bad")');
fs.writeFileSync(path.join(root, 'bunfig.toml'), 'preload = ["./preload.cjs"]\n');
const site = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Compiled browser works</h1><button>Example</button><script>const COMPILED_DEBUG_SOURCE = 42;</script>'); });
await new Promise(r => site.listen(0, '127.0.0.1', r));
const child = spawn(binary, nodeHost ? [entry] : [], { cwd: root, windowsHide: true, env: { ...process.env, DECRYPTHUB_DATA_DIR: path.join(root, 'WebDecryptHub'), APPDATA: root, XDG_CONFIG_HOME: root, HOME: root, TEMP: root, TMP: root, TMPDIR: root, JSRA_MODE: 'server', JSRA_WS_PORT: '0', JSRA_WS_TOKEN: token, JSRA_NATIVE_HOST: '0', JSRA_DEV: '0', DECRYPTHUB_WDH_DIR: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', socket, seq = 0; const pending = new Map();
child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
const until = async check => { const end = Date.now() + 45000; while (!check()) { if (child.exitCode !== null) throw new Error('Compiled sidecar exited before ready: ' + stderr.replaceAll(token, '[token]').slice(-6000)); if (Date.now() > end) throw new Error('Compiled sidecar readiness timed out'); await new Promise(r => setTimeout(r, 25)); } };
const invoke = (channel, args = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timeout = setTimeout(() => { pending.delete(id); reject(new Error(channel + ' timed out')); }, 60000);
  pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ type: 'invoke', id, channel, args }));
});
try {
  await until(() => /JSRA_PORT=(\d+)/.test(stdout));
  socket = new WebSocket(`ws://127.0.0.1:${stdout.match(/JSRA_PORT=(\d+)/)[1]}/?token=${token}`);
  socket.on('message', raw => { const msg = JSON.parse(raw), p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); } });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const sessionId = (await invoke('session-list')).focused;
  const state = (await invoke('session-snapshot', { sessionId })).state;
  if (state.workspace.kind !== 'unselected' || fs.existsSync(state.workspace.root)) throw new Error('New chats must wait for a directory decision');
  await invoke('workspace-set', { sessionId, managed: true });
  const tools = await invoke('list-tools', { sessionId });
  if (!tools.some(t => t.name === 'component_list') || tools.some(t => t.name === 'browser_open')) throw new Error('Core must work without WDH');
  if ((await invoke('component-info')).installed) throw new Error('Expected a clean core-only install');
  const opened = await invoke('browser-launch', { sessionId, url: 'https://example.com' });
  if (opened.ok || !opened.error.includes('WDH')) throw new Error('Missing component must produce an actionable error');
  await invoke('session-set-mode', { sessionId, mode: 'full-access' });
  const terminalId = crypto.randomUUID();
  await invoke('terminal-open', { sessionId, id: terminalId, cols: 90, rows: 25 });
  await invoke('terminal-input', { sessionId, id: terminalId, data: process.platform === 'win32' ? "Write-Output ('PACKAGED_' + 'TERMINAL_OK')\r" : "printf 'PACKAGED_%s\\n' 'TERMINAL_OK'\r" });
  let terminalOutput = '';
  const terminalDeadline = Date.now() + 15000;
  while (!terminalOutput.includes('PACKAGED_TERMINAL_OK')) { if (Date.now() > terminalDeadline) throw Error('Packaged PTY input/output failed'); terminalOutput = (await invoke('terminal-snapshot', { sessionId, id: terminalId })).output; await new Promise(r => setTimeout(r, 50)); }
  await invoke('terminal-close', { sessionId, id: terminalId });
  if (fs.existsSync(marker)) throw new Error('Executable loaded untrusted bunfig preload');
  await invoke('browser-close', { sessionId }); await invoke('prepare-exit');
  console.log('Packaged bundle passed: WS, managed workspace, core-only tools, optional component diagnostic, real PTY input/output/close, shutdown, no working-directory preload. Runtime: ' + binary);
} finally {
  socket?.terminate();
  if (child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 12000))]);
  if (child.exitCode === null) { child.kill(); await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 2000))]); }
  site.closeAllConnections(); await new Promise(r => site.close(r));
  // Only remove the exact, freshly-created fixture directory.
  if (path.dirname(root) === fixtureParent && path.basename(root).startsWith('agent-payload-')) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
    catch (e) { console.warn('Fixture cleanup deferred: ' + root + ' (' + e.code + ')'); }
  }
}
