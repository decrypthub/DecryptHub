import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from '../sessions.mjs';
import { History } from '../history.mjs';
import { readHistoryStorage } from '../history-store.mjs';
import { openSearchDatabase } from '../session-search-schema.mjs';
import { registerAttachment as saveUpload } from '../attachments.mjs';
import { searchSessions } from '../session-search.mjs';
const settings = { provider: 'openai', openai: { apiKey: 'fixture', model: 'default-model', contextWindow: 100000 }, maxSteps: 0, tokenBudget: 0 };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-index-parity-')), workspace = path.join(root, 'workspace'), data = path.join(root, 'data'); fs.mkdirSync(workspace); fs.mkdirSync(data);
  const managers = [], make = () => { const m = new SessionManager({ userDataDir: data, getSettings: () => settings, broadcast() {}, chromeMod: {}, titleGenerator: async () => '' }); managers.push(m); return m; };
  const manager = make(), folder = manager.workspaces.folder(workspace), project = manager.projects.save({ name: 'Fixture', folders: [folder], primaryId: folder.id });
  const create = title => { const s = manager.create({ projectId: project.id, title }); s.mode = 'full-access'; return s; }, session = create('Caller');
  t.after(async () => { for (const m of managers) await m.closeAll(); assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('dh-index-parity-')); fs.rmSync(root, { recursive: true, force: true }); });
  const save = (target, text, at = 1) => { const h = new History({ events: [{ t: 'user', turnId: 'seed', content: text, at }, { t: 'assistant', turnId: 'seed', content: 'saved answer', reasoning: 'HIDDEN_REASONING', at }, { t: 'turn-end', turnId: 'seed', stop: 'completed', at }] }); assert.equal(h.save(path.join(target.projectDir, '.agent-history.json')), true, h.lastSaveError?.message); };
  return { root, workspace, data, manager, make, project, session, create, save, ctx: () => ({ ...session.toolCtx(), getStepBoundary: () => 1000000 }) };
}
test('FTS uses literal phrases, token boundaries and the upstream match-count ordering', async t => {
  const f = fixture(t), repeated = f.create('Repeated'), short = f.create('Short'), partial = f.create('Substring');
  f.save(repeated, 'needle needle ' + 'longword '.repeat(40)); f.save(short, 'needle'); f.save(partial, 'needles');
  const service = f.manager.sessionQuery, result = await service.search(f.ctx(), { query: 'needle' });
  assert.deepEqual(result.items.map(item => item.sessionId), [repeated.id, short.id]);
  assert.equal((await service.search(f.ctx(), { query: 'needle OR needles' })).items.length, 0);
  assert.equal((await service.search(f.ctx(), { query: 'HIDDEN_REASONING' })).items.length, 0);
  f.save(short, '青鹭-731'); assert.equal((await service.search(f.ctx(), { query: '青鹭-731' })).items[0].sessionId, short.id);
  assert.equal((await service.search(f.ctx(), { query: '鹭' })).items.length, 0);
  await assert.rejects(service.search(f.ctx(), { query: '\0' }));
});
test('desktop search shares the full current-message index without an 8MB cutoff or Agent activation', async t => {
  const f = fixture(t), source = f.create('Large cold source'), file = path.join(source.projectDir, '.agent-history.json');
  fs.writeFileSync(file, JSON.stringify({ v: 3, events: [{ t: 'user', content: 'early task', turnId: 'early', at: 1 }, { t: 'assistant', content: 'x'.repeat(8_400_000) + ' needle-end', turnId: 'early', at: 2 }, { t: 'turn-end', turnId: 'early', stop: 'completed', at: 3 }] }));
  const before = fs.readFileSync(file), result = await f.manager.sessionQuery.searchSidebar({ query: 'needle-end' });
  assert.equal(result.skipped, 0); assert.deepEqual(result.matches.map(hit => [hit.sessionId, hit.seq]), [[source.id, 1]]);
  assert.equal(source.agent, null); assert.deepEqual(fs.readFileSync(file), before); assert.ok(!fs.existsSync(path.join(source.projectDir, '.history')));
  const previous = f.manager.sessionQuery; previous.close(); f.manager.sessionQuery = new previous.constructor(f.manager);
  f.manager.sessionQuery.observe = async () => { throw Error('Unchanged sources must reuse their persisted revision'); };
  assert.deepEqual((await f.manager.sessionQuery.searchSidebar({ query: 'absent-fixture-token' })).matches, []);
  assert.equal((await f.manager.sessionQuery.searchSidebar({ query: 'needle-end' })).matches[0].seq, 1);
  const controller = new AbortController(); controller.abort(); await assert.rejects(f.manager.sessionQuery.searchSidebar({ query: 'needle', signal: controller.signal }));
});
test('index is disposable, cold revisions update and live observations shadow saved documents', async t => {
  const f = fixture(t), source = f.create('Source'); f.save(source, 'persisted-only');
  const service = f.manager.sessionQuery; assert.equal((await service.search(f.ctx(), { query: 'persisted-only' })).items.length, 1);
  f.save(source, 'revised-only'); assert.equal((await service.search(f.ctx(), { query: 'persisted-only' })).items.length, 0);
  const live = source.ensureAgent(); live.hist.onAppend = undefined; live.hist.append({ t: 'user', content: 'live-only', turnId: 'live' });
  assert.equal((await service.search(f.ctx(), { query: 'live-only' })).items[0].sessionId, source.id);
  assert.equal((await service.search(f.ctx(), { query: 'revised-only', availability: ['persisted'] })).items.length, 1);
  service.close(); f.manager.sessionQuery = new (service.constructor)(f.manager);
  assert.equal((await f.manager.sessionQuery.search(f.ctx(), { query: 'live-only' })).items.length, 1);
  await f.manager.closeAll(); fs.unlinkSync(path.join(f.data, '.session-search.sqlite'));
  const cold = f.make(), caller = cold.get(f.session.id), result = await cold.sessionQuery.search({ ...caller.toolCtx(), getStepBoundary: () => 100 }, { query: 'revised-only' });
  assert.equal(result.items.length, 1); assert.equal(cold.get(source.id).agent, null);
});
test('a derived schema refuses foreign databases without changing their tables', async t => {
  const f = fixture(t), file = path.join(f.root, 'foreign.sqlite'), db = new DatabaseSync(file); db.exec('CREATE TABLE important (content TEXT); INSERT INTO important VALUES ("keep")'.replace('"keep"', "'keep'")); db.close();
  await assert.rejects(openSearchDatabase(file, 'wal'), /not an empty|another application/);
  const verify = new DatabaseSync(file); assert.equal(verify.prepare('SELECT content FROM important').get().content, 'keep'); verify.close();
});
test('a self search excludes current-step evidence and indexes survive summary replacement', async t => {
  const f = fixture(t), agent = f.session.ensureAgent(); agent.hist.append({ t: 'user', content: 'needle prior', turnId: 'r' }); agent.hist.append({ t: 'assistant', content: 'needle current', turnId: 'r' });
  const result = await f.manager.sessionQuery.search({ ...f.ctx(), getStepBoundary: () => 1 }, { query: 'needle' }, true); assert.deepEqual(result.items.map(item => item.seq), [0]);
  agent.hist.commitSummary('summary needle', {}, { surfaceOp: { op: 'replace', startSeq: 0, endSeq: 1 }, sourceEventSeqs: [0, 1] });
  const old = await f.manager.sessionQuery.search(f.ctx(), { query: 'prior', surfaces: ['shadowed'] }, true); assert.equal(old.items[0].seq, 0);
  const current = await f.manager.sessionQuery.search(f.ctx(), { query: 'summary', surfaces: ['current'] }, true); assert.equal(current.items[0].seq, 2);
});
test('fork uses the current default model, keeps exact prefix and durably closes pending tools', async t => {
  const f = fixture(t), source = f.session.ensureAgent(); f.session.modelSelection.model = 'older-model';
  source.hist.append({ t: 'user', content: 'task', turnId: 'r', at: 1 }); source.hist.append({ t: 'assistant', turnId: 'r', at: 2, calls: [{ id: 'c', itemId: 'i', name: 'workspace_write', args: {} }] });
  source.hist.append({ t: 'system', id: 'c', itemId: 'i', turnId: 'r', at: 3, source: { kind: 'tool-call-start' } });
  const before = readHistoryStorage(source.histFile()), bytes = fs.readFileSync(before.generation), child = await f.manager.forkSession(f.session.id, 2);
  assert.equal(child.modelSelection.model, 'default-model'); assert.equal(child.inheritedEventCount, 3);
  assert.deepEqual(child.agent.hist.events.slice(0, 3), source.hist.events); assert.deepEqual(fs.readFileSync(before.generation), bytes);
  assert.equal(child.agent.hist.events.find(e => e.t === 'tool').error.code, 'TOOL_OUTCOME_UNKNOWN');
  assert.equal(child.agent.hist.events.at(-1).stop, 'forked'); assert.match(JSON.stringify(child.agent.messages), /不能盲目重放/);
});
test('editing an older tool-using message reuses immutable attachments and keeps the source generation', async t => {
  const f = fixture(t), source = f.session.ensureAgent(), upload = saveUpload(f.session.projectDir, { name: 'evidence.txt', data: Buffer.from('attachment evidence').toString('base64') });
  const attachments = [{ kind: 'attachment', ...upload }];
  source.hist.append({ t: 'user', id: 'u', turnId: 'one', content: 'earlier', attachments });
  source.hist.append({ t: 'assistant', turnId: 'one', calls: [{ id: 'c', itemId: 'i', name: 'workspace_read', args: {} }] });
  source.hist.append({ t: 'tool', id: 'c', itemId: 'i', turnId: 'one', content: 'evidence' }); source.hist.append({ t: 'turn-end', turnId: 'one', stop: 'completed' });
  source.hist.append({ t: 'user', turnId: 'two', content: 'later' }); source.hist.append({ t: 'assistant', turnId: 'two', content: 'later answer' }); source.hist.append({ t: 'turn-end', turnId: 'two', stop: 'completed' });
  const old = readHistoryStorage(source.histFile()), bytes = fs.readFileSync(old.generation), originalCreate = f.manager.create.bind(f.manager);
  f.manager.create = args => { const s = originalCreate(args); s.ensureAgent().chat = async () => ({ content: 'edited answer', toolCalls: [] }); return s; };
  const result = await f.session.editTurn('one', 'edited earlier', undefined, 0); assert.equal(result.ok, true);
  const child = f.manager.get(result.sessionId); await child.completion;
  assert.deepEqual(fs.readFileSync(old.generation), bytes); assert.equal(source.hist.events.length, 7);
  assert.equal(child.agent.hist.events.find(e => e.t === 'user').attachments[0].id, upload.id);
  assert.equal(child.agent.hist.events.filter(e => e.t === 'assistant').at(-1).content, 'edited answer');
});
test('one manager owns the index and more than 100 sessions survive a restart', async t => {
  const f = fixture(t); assert.throws(() => f.make(), error => error.code === 'SESSION_ALREADY_OWNED');
  for (let i = 0; i < 104; i++) f.manager.create({ title: 'Chat ' + i, projectId: f.project.id, quiet: true }); f.manager.emitList();
  assert.equal(f.manager.sessions.size, 105); await f.manager.closeAll(); const cold = f.make(); assert.equal(cold.sessions.size, 105);
});
test('sidebar conversation search reads migrated JSONL histories without creating an Agent', async t => {
  const f = fixture(t), source = f.create('Source'); f.save(source, 'migrated-search-only');
  const result = await searchSessions({ sessions: f.manager.sessions, projects: f.manager.projects.entries, query: 'migrated-search-only' });
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].sessionId, source.id); assert.equal(source.agent, null);
});
