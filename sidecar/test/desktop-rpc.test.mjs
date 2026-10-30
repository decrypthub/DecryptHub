// Actual sidecar + WebSocket + local SSE provider; never calls a real model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { folderProof } from '../grants.mjs';
import { killPidTree } from '../proctree.mjs';

test('real RPC: select folder, write, approve execution, restore history, review changes and enforce read-only', { timeout: 25000 }, async () => {
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-rpc-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-repo-'));
  const token = crypto.randomBytes(24).toString('hex'), events = [], waiting = new Map(); let seq = 0, step = 0, socket, child;
  const replies = [
    { tool_calls: [{ index: 0, id: 'write', type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'main.js', content: 'console.log("HARNESS_OK")' }) } }] },
    { tool_calls: [{ index: 0, id: 'run', type: 'function', function: { name: 'workspace_run', arguments: JSON.stringify({ file: 'main.js' }) } }] },
    { content: '已创建并运行脚本。' },
    { tool_calls: [{ index: 0, id: 'blocked', type: 'function', function: { name: 'workspace_write', arguments: JSON.stringify({ path: 'blocked.txt', content: 'no' }) } }] },
    { content: '当前为只读权限，没有修改文件。' },
    { tool_calls: [{ index: 0, id: 'full-run', type: 'function', function: { name: 'workspace_run', arguments: JSON.stringify({ file: 'main.js' }) } }] },
    { content: '完全访问权限下直接运行。' },
  ];
  const model = http.createServer((req, res) => { let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const request = JSON.parse(body); assert.equal(request.model, 'fixture-model');
    const delta = request.messages[0]?.content?.startsWith('你是会话标题生成器') ? { content: '创建并验证本地脚本' } : replies[step++] || { content: '完成' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  }); });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const until = async check => { const end = Date.now() + 10000; while (!check()) { if (Date.now() > end) throw new Error('等待 RPC 状态超时'); await new Promise(r => setTimeout(r, 20)); } return check(); };
  const invoke = (channel, args = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ type: 'invoke', id, channel, args })); });
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('../index.mjs', import.meta.url))], { env: { ...process.env, APPDATA: appdata, XDG_CONFIG_HOME: appdata, HOME: appdata, JSRA_MODE: 'server', JSRA_TEST_FIXTURES: '1', JSRA_TEST_NO_SANDBOX: '1', JSRA_NATIVE_HOST: '0', JSRA_WS_PORT: '0', JSRA_WS_TOKEN: token, JSRA_OPENAI_BASE: `http://127.0.0.1:${model.address().port}/v1`, JSRA_OPENAI_KEY: 'fixture-private-key', JSRA_OPENAI_MODEL: 'fixture-model' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    await until(() => /JSRA_PORT=(\d+)/.test(stdout)); const port = Number(stdout.match(/JSRA_PORT=(\d+)/)[1]);
    socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
    socket.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'event') events.push(m); else { const p = waiting.get(m.id); if (p) { waiting.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); } } });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const settings = await invoke('get-settings'); assert.ok(!JSON.stringify(settings).includes('fixture-private-key')); assert.equal(settings.openai.hasKey, true);
    assert.equal((await invoke('session-list')).sessions.length, 0);
    await assert.rejects(invoke('session-create', {}), /选择项目/);
    const scope = 'rpc-project-fixture';
    const grant = { sessionId: scope, path: repo, expiresAt: Date.now() + 60000 }; grant.signature = folderProof(token, grant);
    const project = await invoke('project-save', { scope, project: { name: 'RPC fixture', folders: [{ key: 'root', grant }] } });
    const sessionId = (await invoke('session-create', { projectId: project.id })).id;
    assert.ok((await invoke('session-list')).sessions.find(s => s.id === sessionId).projectId);
    await assert.rejects(invoke('project-save', { scope, project: { name: 'duplicate grant', folders: [{ key: 'root', grant }] } }), /已使用/);
    const started = await invoke('agent-send', { sessionId, text: '创建并运行脚本' }); assert.equal(started.ok, true);
    await until(() => events.find(e => e.channel === 'agent-approval'));
    const approval = events.find(e => e.channel === 'agent-approval').payload;
    assert.equal(approval.isolated, false); assert.equal(approval.canRemember, false); assert.equal(approval.cwd, fs.realpathSync.native(repo));
    const snapshot = await invoke('session-snapshot', { sessionId }); assert.equal(snapshot.state.approvals[0].id, approval.id);
    await invoke('agent-approval-reply', { sessionId, id: approval.id, allow: true, always: true });
    await until(() => events.find(e => e.channel === 'run-event' && e.payload.run?.id === started.runId && e.payload.run.status === 'completed'));
    assert.equal(fs.readFileSync(path.join(repo, 'main.js'), 'utf8'), 'console.log("HARNESS_OK")');
    const history = await invoke('agent-history', { sessionId }); assert.ok(history.some(e => e.t === 'tool' && e.content.includes('HARNESS_OK')));
    assert.equal((await invoke('changes-list', { sessionId })).length, 1);
    assert.ok((await invoke('read-file', { sessionId, file: 'workspace/main.js' })).includes('HARNESS_OK'));
    await invoke('session-set-mode', { sessionId, mode: 'read-only' });
    const second = await invoke('agent-send', { sessionId, text: '尝试写入文件' });
    await until(() => events.find(e => e.channel === 'run-event' && e.payload.run?.id === second.runId && e.payload.run.status === 'completed'));
    assert.equal(fs.existsSync(path.join(repo, 'blocked.txt')), false);
    assert.ok((await invoke('agent-history', { sessionId })).some(e => e.t === 'tool' && e.isError && /只读/.test(e.content)));
    const approvalsBefore = events.filter(e => e.channel === 'agent-approval').length;
    await invoke('session-set-mode', { sessionId, mode: 'full-access' });
    const third = await invoke('agent-send', { sessionId, text: '直接运行脚本' });
    await until(() => events.find(e => e.channel === 'run-event' && e.payload.run?.id === third.runId && e.payload.run.status === 'completed'));
    assert.equal(events.filter(e => e.channel === 'agent-approval').length, approvalsBefore);
    const diagnostic = await invoke('session-diagnostics', { sessionId });
    assert.equal(diagnostic.sessionId, sessionId); assert.equal(diagnostic.runId, third.runId); assert.equal(diagnostic.mode, 'full-access');
    assert.ok(!JSON.stringify(diagnostic).includes('fixture-private-key'));
    const directory = await invoke('workspace-directory', { sessionId }); assert.equal(directory.entries[0].path, 'main.js');
    const transcript = await invoke('session-export-markdown', { sessionId });
    assert.equal(transcript.sessionId, sessionId); assert.ok(transcript.markdown.includes('HARNESS_OK')); assert.ok(transcript.markdown.includes('workspace_run')); assert.ok(!transcript.markdown.includes('fixture-private-key'));
    assert.equal(stderr.includes('SyntaxError'), false);
  } finally {
    socket?.terminate(); if (child?.pid) { killPidTree(child.pid); child.kill(); }
    model.closeAllConnections(); await new Promise(r => model.close(r));
  }
});
