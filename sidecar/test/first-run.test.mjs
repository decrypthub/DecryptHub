// 首次启动：全新的数据目录里没有项目、没有会话，但全局内核管理必须仍然可用。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

test('first run: kernel management works before any project or session exists', { timeout: 20000 }, async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-first-run-'));
  const token = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../index.mjs', import.meta.url))], {
    env: { ...process.env, APPDATA: data, XDG_CONFIG_HOME: data, HOME: data, DECRYPTHUB_DATA_DIR: path.join(data, 'WebDecryptHub'), JSRA_MODE: 'server', JSRA_TEST_FIXTURES: '1', JSRA_NATIVE_HOST: '0', JSRA_WS_PORT: '0', JSRA_WS_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
  t.after(() => { try { child.kill(); } catch {} fs.rmSync(data, { recursive: true, force: true }); });

  const until = async (check, label) => { const end = Date.now() + 15000; while (!check()) { if (child.exitCode !== null) throw new Error('sidecar exited: ' + stderr.slice(-800)); if (Date.now() > end) throw new Error('timeout: ' + label); await new Promise(r => setTimeout(r, 25)); } };
  await until(() => /JSRA_PORT=(\d+)/.test(stdout), 'ws port');
  const port = Number(stdout.match(/JSRA_PORT=(\d+)/)[1]);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  let seq = 0; const waiting = new Map();
  const invoke = (channel, args = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ type: 'invoke', id, channel, args })); });
  socket.on('message', raw => { const m = JSON.parse(raw); const p = waiting.get(m.id); if (p) { waiting.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); } });
  t.after(() => socket.terminate());
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });

  const sessions = await invoke('session-list');
  assert.equal(sessions.sessions.length, 0);
  assert.equal(sessions.focused, null);
  assert.deepEqual(await invoke('projects-list'), []);

  // 内核信息是全局能力：没有会话也不能报“会话不存在”。
  const info = await invoke('kernel-info');
  assert.equal(typeof info, 'object');
  assert.ok('component' in info);
  assert.doesNotMatch(JSON.stringify(info), /会话不存在/);
});
