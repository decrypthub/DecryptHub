import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';
import { ProjectService } from '../project-service.mjs';
import { ProjectStore } from '../projects.mjs';
import { browserPresentation } from '../settings.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-navigation-'));
  const root = path.join(directory, 'source'), data = path.join(directory, 'data');
  fs.mkdirSync(root); fs.mkdirSync(data);
  const options = { userDataDir: data, getSettings: () => ({ mcpServers: {}, openai: { apiKey: 'fixture', model: 'fixture' } }), broadcast() {}, chromeMod: {}, titleGenerator: async () => '' };
  const manager = new SessionManager(options), service = new ProjectService(manager, grant => grant);
  const createProject = name => { const folder = manager.workspaces.folder(root); return manager.projects.save({ name, folders: [folder], primaryId: folder.id }); };
  t.after(async () => { service.stop(); await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { manager, service, root, data, options, createProject };
}

test('an empty account has zero sessions; creating or deleting a project never creates an unassigned chat', async t => {
  const f = fixture(t);
  assert.equal(f.manager.sessions.size, 0); assert.equal(f.manager.focusedId, null);
  assert.throws(() => f.manager.create(), /选择项目/);
  const project = f.createProject('First project'); assert.equal(f.manager.sessions.size, 0);
  const chat = f.manager.create({ projectId: project.id }); assert.equal(chat.projectId, project.id);
  await f.manager.delete(chat.id); assert.equal(f.manager.sessions.size, 0);
  await f.service.remove(project.id); assert.equal(f.manager.sessions.size, 0);
});

test('project order uses stable anchors, persists and rejects removed anchors without losing entries', t => {
  const f = fixture(t), a = f.createProject('A'), b = f.createProject('B'), c = f.createProject('C');
  assert.deepEqual(f.manager.projects.move(c.id, a.id).map(p => p.name), ['C', 'A', 'B']);
  assert.deepEqual(new ProjectStore(f.data).list().map(p => p.id), [c.id, a.id, b.id]);
  assert.throws(() => f.manager.projects.move(a.id, 'removed'), /不存在/);
  assert.deepEqual(f.manager.projects.move(c.id, null).map(p => p.name), ['A', 'B', 'C']);
});

test('a missing directory retains project membership and history across restart without recreating the path', async t => {
  const f = fixture(t), project = f.createProject('A'), chat = f.manager.create({ projectId: project.id });
  chat.ensureAgent().hist.append({ t: 'user', content: 'keep history' }); chat.agent.persist();
  fs.renameSync(f.root, f.root + '-moved');
  await f.service.checkDirectories();
  assert.equal(chat.info().workspace.availability, 'missing'); assert.equal(chat.projectId, project.id);
  assert.equal(chat.send({ text: 'must not recreate the directory' }).code, 'project-directory-unavailable');
  assert.throws(() => f.manager.create({ projectId: project.id }), /不存在/);
  const restored = new SessionManager(f.options);
  try { assert.equal(restored.get(chat.id).projectId, project.id); assert.ok(restored.get(chat.id).ensureAgent().hist.events.some(e => e.content === 'keep history')); }
  finally { await restored.closeAll(); }
  assert.equal(fs.existsSync(f.root), false);
});

test('directory loss cancels an active run, clears queued work and never resumes it after restoration', async t => {
  const f = fixture(t), project = f.createProject('A'), chat = f.manager.create({ projectId: project.id });
  let ready; const started = new Promise(resolve => ready = resolve);
  chat.ensureAgent().chat = async (_s, _m, _tools, { signal }) => { ready(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { content: '', toolCalls: [] }; };
  chat.send({ text: 'active fixture' }); await started; chat.queue.push({ text: 'must not resume' });
  fs.renameSync(f.root, f.root + '-moved'); await f.service.checkDirectories(); await chat.completion;
  assert.equal(chat.agent.running, false); assert.equal(chat.queue.length, 0);
  const run = chat.runs.latest().id;
  fs.renameSync(f.root + '-moved', f.root); await f.service.checkDirectories();
  assert.equal(chat.info().workspace.availability, 'ready'); assert.equal(chat.runs.latest().id, run); assert.equal(chat.agent.running, false);
});

test('a recreated path requires a new directory grant; relinking preserves all chat identities', async t => {
  const f = fixture(t), project = f.createProject('A'), a = f.manager.create({ projectId: project.id }), b = f.manager.create({ projectId: project.id });
  fs.renameSync(f.root, f.root + '-old'); fs.mkdirSync(f.root);
  await f.service.checkDirectories(); assert.equal(a.info().workspace.availability, 'changed');
  assert.throws(() => f.manager.workspaces.verify(a.workspace), /身份/);
  await f.service.save({ id: project.id, name: project.name, folders: [{ key: 'replacement', grant: f.root }], primaryKey: 'replacement' }, 'test-scope');
  assert.equal(a.projectId, project.id); assert.equal(b.projectId, project.id);
  assert.equal(a.workspace.identity, b.workspace.identity); assert.equal(a.info().workspace.availability, 'ready');
});

test('project deletion requires an explicit decision, rejects busy chats and preserves source files', async t => {
  const f = fixture(t), a = f.createProject('A'), b = f.createProject('B'), chat = f.manager.create({ projectId: a.id });
  fs.writeFileSync(path.join(f.root, 'keep.js'), 'source');
  await assert.rejects(() => f.service.remove(a.id), /迁移/);
  chat.queue.push({ text: 'busy' }); await assert.rejects(() => f.service.remove(a.id, { targetId: b.id }), /停止/); chat.queue = [];
  await f.service.remove(a.id, { targetId: b.id }); assert.equal(chat.projectId, b.id);
  const paused = []; f.manager.onDeleting = id => paused.push(id);
  await f.service.remove(b.id, { deleteSessions: true });
  assert.deepEqual(paused, [chat.id]); assert.equal(f.manager.sessions.size, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'keep.js'), 'utf8'), 'source');
});

test('browser presentation只有显式停靠模式才会在 macOS 打开有头窗口', () => {
  assert.deepEqual(browserPresentation({ headless: false }, 'darwin', {}), { embed: false, headless: true, dock: false });
  assert.deepEqual(browserPresentation({ headless: false, embedMode: 'docked' }, 'darwin', {}), { embed: false, headless: false, dock: true });
  assert.deepEqual(browserPresentation({ headless: false }, 'win32', {}), { embed: true, headless: false, dock: false });
  assert.deepEqual(browserPresentation({ embedMode: 'screencast' }, 'win32', {}), { embed: false, headless: true, dock: false });
});
