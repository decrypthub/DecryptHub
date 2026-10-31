import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TestSessionManager as SessionManager, bindTestProject } from './project-fixture.mjs';
import { TaskStore } from '../tasks.mjs';
const answer = { content: 'fixture', toolCalls: [] };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-delete-')), data = path.join(root, 'app');
  const mgr = new SessionManager({ userDataDir: data, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } }), broadcast() {}, chromeMod: {}, titleGenerator: async () => '' });
  t.after(async () => { await mgr.closeAll(); assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('dh-delete-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, data, mgr };
}
test('delete removes private chat data and preserves an external project and sibling chat', async t => {
  const { root, data, mgr } = setup(t), external = path.join(root, 'project'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'keep.txt'), 'user project');
  const s = mgr.create({}), sibling = mgr.create({}); bindTestProject(s, mgr.workspaces.folder(external));
  fs.mkdirSync(s.profileDir(), { recursive: true }); fs.writeFileSync(path.join(s.profileDir(), 'Cookies'), 'fixture');
  fs.mkdirSync(sibling.profileDir(), { recursive: true });
  s.ensureAgent().chat = async () => answer; s.send({ text: 'fixture' }); await s.completion;
  assert.ok(fs.existsSync(path.join(s.projectDir, '.agent-history.json')));
  await mgr.delete(s.id);
  assert.equal(fs.existsSync(s.projectDir), false); assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'user project'); assert.ok(fs.existsSync(sibling.projectDir));
  assert.equal(mgr.sessions.has(s.id), false);
  assert.equal(fs.existsSync(s.profileDir()), false); assert.equal(fs.existsSync(sibling.profileDir()), true);
  const restored = new SessionManager({ userDataDir: data, getSettings: mgr.getSettings, broadcast() {}, chromeMod: {}, titleGenerator: async () => '' }); t.after(() => restored.closeAll()); assert.equal(restored.sessions.has(s.id), false);
});
test('deleting the last chat keeps the source directory and does not create a phantom chat', async t => {
  const { mgr } = setup(t), s = mgr.get('main'); fs.writeFileSync(path.join(s.workspace.root, 'temporary.txt'), 'fixture');
  fs.mkdirSync(s.profileDir(), { recursive: true }); fs.writeFileSync(path.join(s.profileDir(), 'Cookies'), 'fixture');
  await mgr.delete('main'); assert.equal(fs.existsSync(s.projectDir), false); assert.equal(mgr.sessions.size, 0); assert.equal(mgr.focusedId, null); assert.equal(fs.readFileSync(path.join(s.workspace.root, 'temporary.txt'), 'utf8'), 'fixture');
  assert.equal(fs.existsSync(s.profileDir()), false);
});
test('deletion waits for cancellation writes and blocks new sends while disposing', async t => {
  const { mgr } = setup(t), s = mgr.create({}); let started;
  const ready = new Promise(resolve => started = resolve);
  s.ensureAgent().chat = async (_s, _m, _t, { signal }) => { started(); await new Promise(resolve => signal.addEventListener('abort', () => setTimeout(resolve, 30), { once: true })); return answer; };
  s.send({ text: 'long fixture' }); await ready; const removing = mgr.delete(s.id); assert.equal(s.send({ text: 'must not start' }).ok, false); await removing;
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(fs.existsSync(s.projectDir), false); assert.equal(s.agent.running, false);
});
test('deletion rejects a replaced session root and never traverses a descendant junction', async t => {
  const { root, mgr } = setup(t), external = path.join(root, 'external'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'sentinel'), 'keep');
  const s = mgr.create({}), saved = s.projectDir + '-saved'; fs.renameSync(s.projectDir, saved); fs.symlinkSync(external, s.projectDir, 'junction');
  await assert.rejects(mgr.delete(s.id), /链接/); assert.equal(fs.readFileSync(path.join(external, 'sentinel'), 'utf8'), 'keep'); assert.equal(mgr.sessions.has(s.id), true);
  assert.equal(fs.existsSync(path.join(external, '.agent-state.json')), false);
  fs.unlinkSync(s.projectDir); fs.renameSync(saved, s.projectDir); fs.symlinkSync(external, path.join(s.projectDir, 'profile-link'), 'junction');
  await mgr.delete(s.id); assert.equal(fs.existsSync(s.projectDir), false); assert.equal(fs.readFileSync(path.join(external, 'sentinel'), 'utf8'), 'keep');
});
test('deletion requires an explicit identity and pauses only associated automations', async t => {
  const { data, mgr } = setup(t), s = mgr.create({});
  const tasks = new TaskStore({ userDataDir: data, getSessions: () => mgr });
  tasks.upsert({ title: 'bound', prompt: 'fixture', sessionId: s.id }); tasks.upsert({ title: 'other', prompt: 'fixture', sessionId: 'main' });
  mgr.onDeleting = id => tasks.pauseForSession(id);
  await assert.rejects(mgr.delete(), /指定/); await mgr.delete(s.id);
  assert.equal(tasks.list().find(t => t.title === 'bound').enabled, false); assert.equal(tasks.list().find(t => t.title === 'other').enabled, true); assert.equal(tasks.list().length, 2);
});

test('a linked legacy browser profile blocks deletion before any shutdown writes', async t => {
  const { root, mgr } = setup(t), external = path.join(root, 'external-profile');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'Cookies'), 'keep');
  const s = mgr.create({}); fs.mkdirSync(path.dirname(s.profileDir()), { recursive: true });
  fs.symlinkSync(external, s.profileDir(), 'junction');
  await assert.rejects(mgr.delete(s.id), /链接/);
  assert.equal(s.closing, false); assert.equal(fs.existsSync(s.projectDir), true);
  assert.equal(fs.readFileSync(path.join(external, 'Cookies'), 'utf8'), 'keep');
});
