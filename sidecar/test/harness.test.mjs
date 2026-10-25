import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore, workspacePath } from '../workspaces.mjs';
import { ChangeStore } from '../changes.mjs';
import { RunStore } from '../runs.mjs';
import { SessionManager } from '../sessions.mjs';
import { folderProof, consumeFolderGrant } from '../grants.mjs';
import { WORKSPACE_TOOLS } from '../workspace.mjs';
import { executor, findNode } from '../executor.mjs';
import { TaskStore } from '../tasks.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-harness-'));
const manager = dir => new SessionManager({ userDataDir: dir, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'test', contextWindow: 1000000 } }), broadcast() {}, chromeMod: {} });
const done = { content: '完成', toolCalls: [], usage: null, finishReason: 'stop' };

test('optional folder, external folder and chat state survive restart without polluting a repository', async () => {
  const dir = tmp(), repo = tmp(), mgr = manager(dir), s = mgr.get('main');
  assert.equal(s.workspace.kind, 'managed'); assert.equal(fs.existsSync(s.workspace.root), false);
  s.setWorkspace(mgr.workspaces.folder(repo));
  const result = await s.ensureAgent().runTool('workspace_write', { path: 'hello.js', content: 'console.log(1)' });
  assert.equal(result.isError, undefined); assert.equal(fs.readFileSync(path.join(repo, 'hello.js'), 'utf8'), 'console.log(1)');
  assert.equal(fs.existsSync(path.join(repo, '.agent-history.json')), false);
  const restored = manager(dir).get('main'); assert.equal(restored.workspace.root, fs.realpathSync.native(repo));
  assert.equal(restored.mode, 'standard'); s.setMode('full-access'); assert.equal(manager(dir).get('main').mode, 'standard');
});
test('folder identity changes and missing folders require reselection', () => {
  const dir = tmp(), repo = path.join(dir, 'repo'); fs.mkdirSync(repo);
  const store = new WorkspaceStore(path.join(dir, 'app')), ws = store.folder(repo);
  fs.renameSync(repo, repo + '-moved');
  assert.throws(() => store.verify(ws), /不存在/); assert.equal(fs.existsSync(repo), false);
  fs.mkdirSync(repo); assert.throws(() => store.verify(ws), /身份/);
});
test('folder selection grants are signed, scoped, expiring and single-use', () => {
  const grant = { sessionId: 's1', path: tmp(), expiresAt: Date.now() + 60000 };
  grant.signature = folderProof('test-key', grant); const used = new Map();
  assert.throws(() => consumeFolderGrant('test-key', { ...grant, path: 'other' }, 's1', used), /无效/);
  assert.throws(() => consumeFolderGrant('test-key', grant, 's2', used), /失效/);
  assert.equal(consumeFolderGrant('test-key', grant, 's1', used), grant.path);
  assert.throws(() => consumeFolderGrant('test-key', grant, 's1', used), /已使用/);
});
test('file tools reject links and sensitive files, including recursive searches', async () => {
  const root = tmp(), outside = tmp(), ctx = { projectDir: tmp(), workRoot: root, workspaceKind: 'folder' };
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'DO_NOT_READ'); fs.writeFileSync(path.join(root, '.env'), 'DO_NOT_READ');
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => workspacePath(ctx, 'linked/secret.txt'), /链接|联接/);
  assert.throws(() => workspacePath(ctx, '.env'), /敏感/);
  const result = await WORKSPACE_TOOLS.find(t => t.name === 'workspace_grep').run({ pattern: 'DO_NOT_READ' }, ctx);
  assert.equal(result.text, '无匹配');
});
test('edits retain reviewable before/after versions and never undo a later user change', async () => {
  const root = tmp(), ctx = { projectDir: tmp(), workRoot: root, workspaceId: 'repo', mode: 'standard', readHashes: new Map() };
  ctx.changes = new ChangeStore(ctx.projectDir);
  const write = WORKSPACE_TOOLS.find(t => t.name === 'workspace_write'), read = WORKSPACE_TOOLS.find(t => t.name === 'workspace_read');
  await write.run({ path: 'a.txt', content: 'one' }, ctx); await read.run({ path: 'a.txt' }, ctx);
  await write.run({ path: 'a.txt', content: 'two' }, ctx);
  const e = ctx.changes.list('repo').at(-1); assert.equal(ctx.changes.detail(e.id, 'repo').before, 'one');
  fs.writeFileSync(path.join(root, 'a.txt'), 'user edit');
  assert.throws(() => ctx.changes.undo(e.id, { id: 'repo', root }), /后续/);
  await assert.rejects(() => write.run({ path: 'a.txt', content: 'lost edit' }, ctx), /变化/);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'user edit');
});
test('Run recovery marks unfinished work interrupted instead of replaying it', () => {
  const dir = tmp(), store = new RunStore(dir), run = store.start({ workspace: { id: 'repo', revision: 1 }, mode: 'standard', text: 'test' });
  store.status(run, 'waiting_approval'); store.event(run.id, 'tool-starting', { name: 'external__write' });
  const next = new RunStore(dir); assert.equal(next.latest().status, 'interrupted'); assert.equal(next.events().at(-1).type, 'tool-starting');
});
test('general agent exposes one workspace and browser entry, without reverse workflows', async () => {
  const s = manager(tmp()).get('main'), agent = s.ensureAgent();
  assert.ok(agent.allTools().some(t => t.name === 'workspace_write'));
  assert.ok(!agent.allTools().some(t => t.name === 'export_code'));
  assert.ok(!agent.allTools().some(t => t.name === 'browser_open')); assert.ok(agent.allTools().some(t => t.name === 'component_list'));
  assert.equal((await agent.runTool('discover_tools', { group: 'reverse' })).isError, true);
  assert.ok(!agent.allTools().some(t => t.name === 'export_code'));
});
test('read-only is enforced at the tool boundary before mutation or self-test', async () => {
  const s = manager(tmp()).get('main'); s.setMode('read-only'); const agent = s.ensureAgent();
  await agent.runTool('discover_tools', { group: 'reverse' });
  assert.equal((await agent.runTool('export_code', { language: 'js', code: 'throw 1' })).isError, true);
  assert.equal((await agent.runTool('workspace_write', { path: 'x.txt', content: 'x' })).isError, true);
  assert.equal(fs.existsSync(path.join(s.workspace.root, 'x.txt')), false);
});
test('a declined real process has no effects; one grant does not allow the next command', async () => {
  const s = manager(tmp()).get('main'); const oldProbe = executor.probe; executor.probe = async () => ({ available: false });
  const target = path.join(s.workspace.root, 'sentinel.txt');
  try {
    const request = s.execute({ file: findNode(), args: ['-e', `require('fs').writeFileSync(${JSON.stringify(target)},'x')`], cwd: s.workspace.root });
    await new Promise(r => setTimeout(r, 10)); const req = [...s.pending.values()][0].request;
    assert.equal(req.canRemember, false); s.replyApproval(req.id, { allow: false, always: true });
    await assert.rejects(request, /未批准/); assert.equal(fs.existsSync(target), false);
    const second = s.execute({ file: findNode(), args: ['-e', 'console.log("APPROVED")'], cwd: s.workspace.root });
    await new Promise(r => setTimeout(r, 10)); const req2 = [...s.pending.values()][0].request; s.replyApproval(req2.id, { allow: true, always: true });
    assert.match((await (await second).done).out, /APPROVED/); assert.equal(s.allows.size, 0);
  } finally { executor.probe = oldProbe; }
});
test('automation waits for the actual Run and does not launch or focus a browser', async () => {
  const dir = tmp(), mgr = manager(dir), s = mgr.get('main'); let finish;
  s.ensureAgent().chat = async () => new Promise(r => { finish = () => r(done); });
  s.launch = () => { throw new Error('browser must stay optional'); }; mgr.focus = () => { throw new Error('focus must stay unchanged'); };
  const tasks = new TaskStore({ userDataDir: dir, getSessions: () => mgr });
  const t = tasks.upsert({ title: 'code', prompt: 'test', time: '09:00', sessionId: s.id })[0];
  const pending = tasks.run(t.id); await new Promise(r => setTimeout(r, 10)); assert.equal(tasks.tasks[0].lastStatus, 'running');
  finish(); await pending; assert.equal(tasks.tasks[0].lastStatus, 'ok'); assert.equal(s.runs.latest().status, 'completed');
});
test('a shared folder has one writer lease, and different folders are independent', () => {
  const store = new WorkspaceStore(tmp()), a = store.folder(tmp()), b = store.folder(tmp()), release = store.acquire(a, 'one');
  assert.throws(() => store.acquire(a, 'two'), /另一个任务/); store.acquire(b, 'two')(); release(); store.acquire(a, 'two')();
});
test('a script changed while waiting for approval is not executed', async () => {
  const s = manager(tmp()).get('main'), oldProbe = executor.probe; executor.probe = async () => ({ available: false });
  s.mgr.workspaces.verify(s.workspace); const file = path.join(s.workspace.root, 'test.js'); fs.writeFileSync(file, 'console.log("old")');
  s.approve = async req => { assert.match(req.code, /old/); fs.writeFileSync(file, 'console.log("changed")'); return true; };
  try { await assert.rejects(() => s.ensureAgent().runTool('workspace_run', { file: 'test.js' }), /审批期间已变化/); }
  finally { executor.probe = oldProbe; }
});
test('run recovery replays durable status records after a snapshot loss', () => {
  const dir = tmp(), store = new RunStore(dir), r = store.start({ workspace: { id: 'repo', revision: 1 }, mode: 'standard', text: 'test' });
  store.status(r, 'completed'); const seq = store.seq; fs.writeFileSync(path.join(dir, '.runs.json'), 'invalid');
  const recovered = new RunStore(dir); assert.equal(recovered.latest().status, 'completed'); assert.equal(recovered.seq, seq);
});
test('approval review persists separately from sandbox mode and never auto-approves host execution', async () => {
  const dir = tmp(), mgr = manager(dir), s = mgr.get('main'); s.setMode('standard', 'auto');
  assert.equal(s.publicState().review, 'auto');
  const reloaded = manager(dir).get('main'); assert.equal(reloaded.review, 'auto'); assert.equal(reloaded.mode, 'standard');
  const run = reloaded.runs.start({ workspace: reloaded.workspace, mode: 'standard', text: 'test', source: 'automation' }); reloaded.activeRun = run;
  assert.equal(await reloaded.approve({ name: 'process.exec', isolated: true, trustedPurpose: 'dependency-install', network: ['registry.npmjs.org'] }), true);
  assert.equal(await reloaded.approve({ name: 'process.exec', isolated: false, trustedPurpose: 'dependency-install', network: ['registry.npmjs.org'] }), false);
  assert.equal(reloaded.permissionBlocked, true); assert.equal(reloaded.pending.size, 0);
  reloaded.setMode('full-access'); assert.equal(manager(dir).get('main').mode, 'standard');
});
test('changing permissions or workspace revokes approvals, and invalid folder changes preserve the old binding', async () => {
  const mgr = manager(tmp()), s = mgr.get('main');
  const first = s.approve({ name: 'process.exec', isolated: false }); assert.equal(s.pending.size, 1);
  s.setMode('read-only'); assert.equal(await first, false); assert.equal(s.pending.size, 0);
  s.setMode('standard'); const second = s.approve({ name: 'external__write' });
  s.setWorkspace(mgr.workspaces.folder(tmp())); assert.equal(await second, false);
  const binding = s.workspace; assert.throws(() => s.setWorkspace({ ...binding, root: path.join(tmp(), 'missing') }), /不存在/);
  assert.equal(s.workspace, binding);
});
