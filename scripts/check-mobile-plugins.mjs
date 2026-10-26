// Opt-in live-device check. Endpoints stay in environment/local settings, never in source.
// This exercises CLI + desktop RPC + verified official packages + Agent tool routing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { findExecutable } from '../sidecar/executor.mjs';

const exec = promisify(execFile), root = process.cwd();
const endpoints = Object.fromEntries(['idh', 'adh'].flatMap(id => {
  const value = process.env['DECRYPTHUB_TEST_' + id.toUpperCase() + '_ENDPOINT'];
  if (!value) return [];
  const address = new URL(value.includes('://') ? value : 'http://' + value);
  if (address.protocol !== 'http:' || address.username || address.password || address.search || address.hash)
    throw Error(id + ': use an HTTP device address without credentials or query parameters');
  return [[id, address.href]];
}));
if (!Object.keys(endpoints).length)
  throw Error('Set DECRYPTHUB_TEST_IDH_ENDPOINT and/or DECRYPTHUB_TEST_ADH_ENDPOINT. Live checks are never run in normal CI.');
fs.mkdirSync(path.resolve('.tmp'), { recursive: true });
const dataDir = process.env.DECRYPTHUB_TEST_DATA_DIR
  ? path.resolve(process.env.DECRYPTHUB_TEST_DATA_DIR)
  : fs.mkdtempSync(path.resolve('.tmp/mobile-plugins-'));
// Explicit data-dir opts into saving the selected plugin connections for later desktop use.
// Model settings and other MCP configurations are preserved by the normal RPC handlers.
const token = crypto.randomBytes(24).toString('hex'), pending = new Map(), evidence = [];
let socket, sequence = 0, diagnosticSession, focused, output = '', stderr = '';
const child = spawn(process.execPath, [path.resolve('sidecar/index.mjs')], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, DECRYPTHUB_DATA_DIR: dataDir, DECRYPTHUB_WDH_DIR: '',
    JSRA_MODE: 'server', JSRA_WS_PORT: '0', JSRA_WS_TOKEN: token,
    JSRA_DEV: '1', JSRA_NATIVE_HOST: '0', JSRA_DEV_ENDPOINT: '',
  },
});
child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
const until = async (check, label, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (child.exitCode !== null) throw Error('Core exited: ' + stderr.replaceAll(token, '[token]').slice(-1000));
    if (Date.now() > end) throw Error('Timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const invoke = (channel, args = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => {
    pending.delete(id); reject(Error('RPC timeout: ' + channel));
  }, 60000);
  pending.set(id, {
    resolve: value => { clearTimeout(timer); resolve(value); },
    reject: error => { clearTimeout(timer); reject(error); },
  });
  socket.send(JSON.stringify({ type: 'invoke', id, channel, args }));
});
const content = (result, label) => {
  if (result?.error) throw Error(label + ': remote protocol error');
  const value = result?.result || result;
  if (value?.isError) throw Error(label + ': remote tool reported an error');
  const text = value?.text || value?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (!text) throw Error(label + ': tool returned no text');
  const parsed = JSON.parse(text);
  if (parsed?.ok === false || parsed?.error) throw Error(label + ': remote operation failed');
  return parsed;
};
const cli = async (id, args) => {
  const { stdout } = await exec(findExecutable(id), args, {
    cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 1024 ** 2,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', IDH_AUTO_UPDATE: 'off' },
  });
  return JSON.parse(stdout);
};
const tool = async (id, name, args = {}) => content(await invoke('tool-run', {
  sessionId: diagnosticSession, name: 'decrypthub_' + id + '__' + name, args,
}), id + '/' + name);

try {
  await until(() => /JSRA_PORT=(\d+)/.test(output), 'core ready');
  socket = new WebSocket(`ws://127.0.0.1:${output.match(/JSRA_PORT=(\d+)/)[1]}/?token=${token}`);
  socket.on('message', raw => {
    const message = JSON.parse(raw), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(Error(message.error)) : request.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  focused = (await invoke('session-list')).focused;
  for (const [id, endpoint] of Object.entries(endpoints)) {
    if (id === 'idh') {
      const devices = await cli(id, ['--no-auto-update', 'devices', '--json', '--no-saved', '--endpoint', endpoint]);
      const apps = (devices.devices || []).flatMap(device => device.apps || []).filter(app => app.properties?.status === 'online');
      if (apps.length !== 1) throw Error('IDH: expected one online app at the explicit endpoint');
      content(await cli(id, ['--no-auto-update', 'call', 'get_capabilities', '--json', '--no-saved', '--endpoint', endpoint]), 'IDH CLI capabilities');
      const stats = content(await cli(id, ['--no-auto-update', 'call', 'get_stats', '--json', '--no-saved', '--endpoint', endpoint]), 'IDH CLI stats');
      if (!(stats.process?.pid > 0)) throw Error('IDH CLI did not reach a live process');
    } else {
      const sessions = content(await cli(id, ['call', 'process_list', '--json', '--endpoint', endpoint]), 'ADH CLI process_list');
      if (!Array.isArray(sessions) || !sessions.some(s => s.online)) throw Error('ADH CLI: no connected device agent');
    }
    let local = (await invoke('plugins-list')).official.find(p => p.id === id);
    if (!local.installed) {
      await invoke('plugin-install', { id });
      await until(async () => {
        local = (await invoke('plugins-list')).official.find(p => p.id === id);
        if (local.operation?.phase === 'error') throw Error(id + ': ' + local.operation.error);
        return local.installed && local.operation?.phase === 'installed';
      }, id + ' download and verification', 300000);
    }
    // A repeated check exercises persisted startup, without rewriting a healthy connection.
    if (!local.enabled || local.endpoint !== endpoint)
      await invoke('plugin-configure', { id, endpoint });
    await until(async () => {
      const entry = (await invoke('mcp-status')).find(s => s.name === 'decrypthub_' + id);
      if (entry?.state === 'error') throw Error(id + ': ' + entry.error);
      return entry?.state === 'ready';
    }, id + ' desktop MCP connection');
  }
  diagnosticSession = (await invoke('session-create', { title: '设备连接验收', managed: true })).id;
  // The caller opts into these specific read-only live checks. Permission changes affect
  // only this new diagnostic session and are reset before it is closed.
  await invoke('session-set-mode', { sessionId: diagnosticSession, mode: 'full-access' });
  const discovery = await invoke('tool-run', {
    sessionId: diagnosticSession, name: 'discover_tools', args: { group: 'mcp' },
  });
  if (discovery.isError) throw Error('Could not discover the connected MCP tool group');
  for (const id of Object.keys(endpoints)) {
    const status = (await invoke('mcp-status')).find(s => s.name === 'decrypthub_' + id);
    const plugin = (await invoke('plugins-list')).official.find(p => p.id === id);
    if (id === 'idh') {
      const capabilities = await tool(id, 'get_capabilities');
      const stats = await tool(id, 'get_stats');
      if (!(stats.process?.pid > 0) || stats.process.pid !== capabilities.process?.pid)
        throw Error('IDH process changed during the check; retry against the intended live app');
      evidence.push({ id, packageVersion: plugin.version, serverVersion: status.version, toolCount: status.toolCount,
        checks: ['cli-discovery', 'cli-capabilities', 'cli-stats', 'desktop-config', 'agent-capabilities', 'agent-stats'],
        processVerified: true });
    } else {
      const sessions = await tool(id, 'process_list');
      const packageName = process.env.DECRYPTHUB_TEST_ADH_PACKAGE;
      const candidates = sessions.filter(s => s.online && (!packageName || s.package === packageName));
      if (candidates.length !== 1) throw Error('ADH: choose one online target using DECRYPTHUB_TEST_ADH_PACKAGE');
      const target = candidates[0], session = target.sessionId;
      const capabilities = await tool(id, 'capabilities', { session });
      const ping = await tool(id, 'agent_ping', { session });
      if (!capabilities || !ping) throw Error('ADH: empty response from the device');
      const current = await tool(id, 'process_list');
      if (!current.some(s => s.sessionId === session && s.online && s.pid === target.pid))
        throw Error('ADH target disconnected or changed during the check');
      evidence.push({ id, packageVersion: plugin.version, serverVersion: status.version, toolCount: status.toolCount,
        checks: ['cli-process-list', 'desktop-config', 'agent-process-list', 'agent-capabilities', 'agent-ping'],
        processVerified: true });
    }
    console.log(id.toUpperCase() + ': live CLI, saved desktop configuration and Agent tool calls passed (' + status.toolCount + ' tools).');
  }
  const report = path.join(dataDir, 'mobile-validation.json');
  fs.writeFileSync(report, JSON.stringify({ at: new Date().toISOString(), evidence }, null, 2));
  console.log('Local validation report: ' + report);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    if (diagnosticSession) {
      await invoke('session-set-mode', { sessionId: diagnosticSession, mode: 'standard' }).catch(() => {});
      await invoke('session-close', { sessionId: diagnosticSession }).catch(() => {});
    }
    if (focused) await invoke('session-focus', { sessionId: focused }).catch(() => {});
    await invoke('prepare-exit').catch(() => {});
  }
  socket?.terminate();
  for (const request of pending.values()) request.reject(Error('Diagnostic closed'));
  pending.clear();
  if (child.exitCode === null) await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 12000)),
  ]);
  // This child is owned by the current diagnostic; never stop a user-owned application.
  if (child.exitCode === null) child.kill();
}
