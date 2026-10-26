import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';
import { ProjectService } from '../project-service.mjs';
import { folderProof, consumeFolderGrant } from '../grants.mjs';
import { WORKSPACE_TOOLS } from '../workspace.mjs';
import { selectReadRoot, workspacePath } from '../workspaces.mjs';
import { ExtensionStore } from '../extensions.mjs';
import { TaskStore } from '../tasks.mjs';
import { decideTool } from '../policy.mjs';
import { McpHost } from '../mcphost.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-projects-'));
  const app = path.join(root, 'app'), first = path.join(root, 'first'), second = path.join(root, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second); fs.mkdirSync(app);
  const settings = { openai: { apiKey: 'fixture', model: 'test' }, mcpServers: {} }, events = [];
  const mgr = new SessionManager({ userDataDir: app, getSettings: () => settings, broadcast: (...a) => events.push(a), chromeMod: {} });
  const consumed = new Map(), service = new ProjectService(mgr, (grant, id) => consumeFolderGrant('fixture', grant, id, consumed));
  const grant = (directory, id = 'main') => { const g = { path: directory, sessionId: id, expiresAt: Date.now() + 60000 }; g.signature = folderProof('fixture', g); return g; };
  t.after(async () => { await mgr.closeAll(); await mgr.mcpHost?.close(); if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('dh-projects-')) fs.rmSync(root, { recursive: true, force: true }); });
  return { root, app, first, second, settings, mgr, service, grant, events };
}
async function project(f) {
  const a = f.grant(f.first), b = f.grant(f.second);
  return f.service.save({ name: 'Related code', folders: [{ key: 'a', grant: a }, { key: 'b', grant: b }], primaryKey: 'a' }, 'main');
}
test('new chats require an explicit directory decision and do not create the work directory', async t => {
  const f = fixture(t), s = f.mgr.get('main');
  assert.equal(s.workspace.kind, 'unselected'); assert.equal(fs.existsSync(s.workspace.root), false);
  s.ensureAgent().stats(); assert.equal(fs.existsSync(s.workspace.root), false);
  assert.equal(s.send({ text: 'write code' }).code, 'workspace-required');
  assert.equal((await s.launch()).code, 'workspace-required');
  assert.equal(s.runs.latest(), null); assert.equal(fs.existsSync(s.workspace.root), false);
  s.setWorkspace(null); assert.equal(s.workspace.kind, 'managed'); assert.equal(fs.existsSync(s.workspace.root), true);
  f.mgr.extensions = { index() { throw Error('unavailable auxiliary metadata'); } };
  assert.ok(s.ensureAgent().stateNote().includes(s.workspace.root));
  assert.match(s.ensureAgent().stateNote(), /【权限】standard/);
  const restore = new SessionManager({ userDataDir: f.app, getSettings: () => f.settings, broadcast() {}, chromeMod: {} });
  assert.equal(restore.get('main').workspace.kind, 'managed'); await restore.closeAll();
});
test('projects persist multiple authorized roots and keep additional roots read-only', async t => {
  const f = fixture(t), p = await project(f), s = f.mgr.get('main');
  fs.writeFileSync(path.join(f.first, 'main.js'), 'primary code'); fs.writeFileSync(path.join(f.second, 'lib.js'), 'secondary code');
  await f.service.attach(s.id, p.id);
  assert.equal(s.projectId, p.id); assert.equal(s.workspace.root, fs.realpathSync.native(f.first));
  const read = WORKSPACE_TOOLS.find(t => t.name === 'workspace_read');
  assert.match((await read.run({ root: p.folders[1].id, path: 'lib.js' }, s.toolCtx())).text, /secondary code/);
  assert.throws(() => workspacePath(selectReadRoot(s.toolCtx(), p.folders[1].id), 'lib.js', { write: true }), /只供|仅供|附加/);
  assert.throws(() => selectReadRoot(s.toolCtx(), 'unregistered'), /未授权/);
  const badWrite = await s.ensureAgent().runTool('workspace_write', { root: p.folders[1].id, path: 'lib.js', content: 'must not write' });
  assert.equal(badWrite.isError, true); assert.equal(fs.existsSync(path.join(f.first, 'lib.js')), false);
  await assert.rejects(() => read.run({ root: p.folders[1].id, path: '../first/main.js' }, s.toolCtx()), /越界/);
  fs.writeFileSync(path.join(f.second, '.env'), 'fixture secret');
  await assert.rejects(() => read.run({ root: p.folders[1].id, path: '.env' }, s.toolCtx()), /敏感/);
  assert.equal(f.mgr.projects.list()[0].folders.length, 2);
});
test('project changes reject busy sessions, invalidate removed roots and preserve chat history', async t => {
  const f = fixture(t), p = await project(f), s = f.mgr.get('main');
  await f.service.attach(s.id, p.id); const agent = s.ensureAgent();
  agent.hist.append({ t: 'user', content: 'Keep this conversation' }); agent.persist();
  agent.running = true;
  await assert.rejects(() => f.service.save({ id: p.id, name: 'changed', folders: [{ id: p.folders[0].id }] }, s.id), /停止/);
  agent.running = false;
  await f.service.save({ id: p.id, name: 'changed', folders: [{ id: p.folders[0].id }] }, s.id);
  assert.throws(() => selectReadRoot(s.toolCtx(), p.folders[1].id), /未授权/);
  await f.service.attach(s.id, null);
  assert.equal(s.projectId, null); assert.equal(s.workspace.root, fs.realpathSync.native(f.first));
  assert.ok(agent.hist.events.some(e => e.content === 'Keep this conversation'));
});
test('projects accept only signed folder grants and cannot borrow arbitrary paths or ids', async t => {
  const f = fixture(t);
  await assert.rejects(() => f.service.save({ name: 'bad', folders: [{ key: 'x', grant: { path: f.first, sessionId: 'main' } }] }, 'main'), /失效/);
  await assert.rejects(() => f.service.save({ name: 'bad', folders: [{ id: 'invented', root: f.first }] }, 'main'), /未授权/);
  assert.equal(f.mgr.projects.list().length, 0);
  const count = f.mgr.sessions.size;
  assert.throws(() => f.mgr.create({ projectId: 'removed-project' }), /项目不存在/);
  assert.equal(f.mgr.sessions.size, count, 'invalid projects must not leave a half-created chat');
});

test('project transactions cannot race session close, launch or research startup', async t => {
  const f = fixture(t), s = f.mgr.get('main');
  const closeBrowser = s.closeBrowser;
  let release;
  s.closeBrowser = () => new Promise(resolve => { release = resolve; });
  const changing = f.service.choose(s.id, { managed: true });
  await assert.rejects(() => f.mgr.close(s.id), /更新项目目录/);
  assert.throws(() => s.subagents.spawn('read the new directory'), /更新项目目录/);
  assert.equal((await s.launch()).ok, false);
  release(); await changing; s.closeBrowser = closeBrowser;
  assert.equal(s.workspace.kind, 'managed'); assert.equal(f.mgr.projectsBusy, false);
  s.launching = Promise.resolve();
  await assert.rejects(() => f.service.choose(s.id, { managed: true }), /浏览器正在切换/);
  s.launching = null;
});
test('completed research does not permanently prevent choosing a new work directory', async t => {
  const f = fixture(t), s = f.mgr.get('main');
  s.subagents.records.push({ id: 'finished', status: 'completed' });
  s.setWorkspace(f.mgr.workspaces.folder(f.first)); assert.equal(s.workspace.root, fs.realpathSync.native(f.first));
});
test('skill and memory stores enforce scope, names, checksums and ordinary files', t => {
  const f = fixture(t), store = new ExtensionStore({ directory: f.app, getSettings: () => f.settings });
  const ctx = { sessionId: 'main', projectId: 'project-one' }, other = { sessionId: 'second', projectId: 'project-two' };
  const note = store.write('memory', { name: 'verified-fact', content: 'A verified fixture', scope: 'project' }, ctx);
  assert.equal(store.list('memory', ctx).length, 1); assert.equal(store.list('memory', other).length, 0);
  assert.throws(() => store.write('memory', { name: '../escape', content: 'x' }, ctx), /名称/);
  assert.throws(() => store.write('memory', { name: 'verified-fact', content: 'stale', scope: 'project' }, ctx), /expectedHash/);
  store.write('memory', { name: 'verified-fact', content: 'Updated fact', expectedHash: note.hash, scope: 'project' }, ctx);
  assert.match(store.index(ctx), /Updated fact/);
  assert.throws(() => store.write('skill', { name: 'workflow', content: 'missing metadata' }, ctx), /frontmatter/);
  store.write('skill', { name: 'workflow', content: '---\nname: workflow\ndescription: fixture workflow\n---\n\nRead and verify.', scope: 'user' }, ctx);
  assert.ok(store.list('skill', other).some(s => s.name === 'workflow'));
  const location = store.file('memory', 'project', 'linked', ctx);
  fs.symlinkSync(f.first, path.dirname(location.file) + '/bad-link', process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(store.list('memory', ctx).length, 1);
});
test('persistent extension changes require standard approval and are denied in read-only mode', () => {
  for (const name of ['skill_manage', 'memory_manage', 'automation_manage', 'mcp_manage']) {
    assert.equal(decideTool('standard', name, { action: 'list' }).action, 'run');
    assert.equal(decideTool('read-only', name, { action: 'write' }).action, 'deny');
    assert.equal(decideTool('standard', name, { action: 'write' }).action, 'approve');
    assert.equal(decideTool('full-access', name, { action: 'write' }).action, 'run');
  }
});
test('invalid automation updates leave saved and in-memory state intact and interrupted runs recover', t => {
  const f = fixture(t), tasks = new TaskStore({ userDataDir: f.app, getSessions: () => f.mgr });
  const first = tasks.upsert({ title: 'fixture', prompt: 'read files', time: '09:30', days: [1], sessionId: 'main' })[0];
  const before = JSON.stringify(tasks.list());
  assert.throws(() => tasks.upsert({ id: first.id, title: 'bad', time: '99:99' }), /时间/);
  assert.equal(JSON.stringify(tasks.list()), before);
  tasks.tasks[0].lastStatus = 'running'; tasks.save();
  const restored = new TaskStore({ userDataDir: f.app, getSessions: () => f.mgr });
  assert.equal(restored.list()[0].lastStatus, 'error'); assert.match(restored.list()[0].lastError, /中断/);
});

test('Agent extension tools enforce approval before persisting and can connect a real custom MCP', { timeout: 60000 }, async t => {
  const f = fixture(t), s = f.mgr.get('main'); s.setWorkspace(null);
  const host = new McpHost({ getServers: () => f.settings.mcpServers, baseDir: f.app });
  f.mgr.mcpHost = host;
  const tasks = new TaskStore({ userDataDir: f.app, getSessions: () => f.mgr });
  const store = new ExtensionStore({ directory: f.app, getSettings: () => f.settings, saveSettings() {}, plugins: { preserveManagedServers: x => x }, mcpHost: host, tasks });
  f.mgr.extensions = store;
  const agent = s.ensureAgent(), input = { action: 'write', name: 'approved-note', content: 'An explicitly saved fact' };
  const declined = agent.runTool('memory_manage', input);
  assert.equal(s.pending.size, 1); s.replyApproval([...s.pending.keys()][0], { allow: false });
  assert.equal((await declined).isError, true); assert.equal(store.list('memory', s.toolCtx()).length, 0);
  s.setMode('full-access'); assert.equal((await agent.runTool('memory_manage', input)).isError, undefined);
  f.settings.mcpServers['private-offline'] = { command: process.execPath, enabled: false, env: { TOKEN: 'fixture-private-token' } };
  const name = 'fixture-agent-mcp';
  const result = await agent.runTool('mcp_manage', { action: 'save', name, config: { command: process.execPath, args: [path.resolve('sidecar/test/fixtures/mcp-demo-server.mjs')], enabled: true } });
  assert.equal(result.isError, undefined); await host.start(name);
  assert.ok(!result.text.includes('fixture-private-token'), 'MCP management replies must not expose other servers credentials');
  assert.equal(host.status().find(x => x.name === name).state, 'ready');
  assert.ok(f.settings.mcpServers[name].approvedFingerprint);
  s.setMode('read-only'); assert.equal((await agent.runTool('memory_manage', { ...input, name: 'denied' })).isError, true);
  assert.equal(store.list('memory', s.toolCtx()).length, 1);
});
test('automation tools require a schedule and cannot bind another chat', async t => {
  const f = fixture(t), s = f.mgr.get('main'); s.setWorkspace(null);
  const tasks = new TaskStore({ userDataDir: f.app, getSessions: () => f.mgr });
  const store = new ExtensionStore({ directory: f.app, tasks });
  const other = f.mgr.create();
  tasks.upsert({ title: 'Private other task', prompt: 'unrelated', sessionId: other.id });
  await assert.rejects(() => store.manage('automation', { action: 'save', title: 'No schedule', prompt: 'read sources' }, s.toolCtx()), /时间/);
  const list = await store.manage('automation', { action: 'save', title: 'Scheduled', prompt: 'read sources', time: '09:00', days: [1], enabled: false }, s.toolCtx());
  assert.equal(list[0].sessionId, s.id); assert.equal(tasks.list().find(x => x.id === list[0].id).enabled, false);
  assert.equal(list.length, 1, 'save replies must not include tasks from other chats');
  await assert.rejects(() => store.manage('automation', { action: 'remove', id: list[0].id }, { sessionId: 'another' }), /当前会话/);
  assert.deepEqual(await store.manage('automation', { action: 'remove', id: list[0].id }, s.toolCtx()), []);
});
test('automation pending work directories become actionable and scheduling never overlaps a busy run', async t => {
  const f = fixture(t), changes = [], tasks = new TaskStore({ userDataDir: f.app, getSessions: () => f.mgr, onChange: list => changes.push(list) });
  const task = tasks.upsert({ title: 'Bound task', prompt: 'read sources', sessionId: 'main', time: '09:00', days: [0,1,2,3,4,5,6] })[0];
  await assert.rejects(() => tasks.run(task.id), /选择目录/);
  assert.equal(tasks.list()[0].lastStatus, 'needs_attention'); assert.equal(tasks.list()[0].runs[0].status, 'needs_attention');
  assert.ok(changes.some(list => list[0].lastStatus === 'running'));
  const originalNow = Date.now;
  try {
    const now = new Date(2026, 9, 26, 12).getTime(); Date.now = () => now;
    tasks.tasks[0].lastAt = new Date(2026, 9, 25, 12).getTime(); let starts = 0;
    tasks.tasks[0].createdAt = tasks.tasks[0].lastAt;
    tasks.run = async id => { starts++; tasks.busy.add(id); };
    tasks.schedulingFrom = now; await tasks.tick(); assert.equal(starts, 0, 'a restart must not replay a missed schedule');
    tasks.schedulingFrom = new Date(2026, 9, 25, 12).getTime();
    await tasks.tick(); await tasks.tick(); assert.equal(starts, 1);
  } finally { Date.now = originalNow; }
});
