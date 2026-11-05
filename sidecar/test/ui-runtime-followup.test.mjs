import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';
import { sessionSnapshot } from '../session-snapshots.mjs';
import { ChangeStore } from '../changes.mjs';
import { lineCounts, turnFiles, turnFileDetail } from '../turn-files.mjs';
import { systemMemorySources, systemMemoryPrompt } from '../system-memory.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-runtime-ui-')), root = path.join(base, 'workspace'); fs.mkdirSync(root);
  const settings = { openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } };
  const managers = [];
  const options = { userDataDir: path.join(base, 'data'), getSettings: () => settings, broadcast() {}, chromeMod: {}, titleGenerator: async () => '' };
  const reopen = () => { const manager = new SessionManager(options); managers.push(manager); return manager; };
  const manager = reopen(), folder = manager.workspaces.folder(root), project = manager.projects.save({ name: 'Fixture', folders: [folder], primaryId: folder.id });
  const session = manager.create({ projectId: project.id });
  t.after(async () => { for (const manager of managers) await manager.closeAll(); fs.rmSync(base, { recursive: true, force: true }); });
  return { base, root, settings, manager, session, reopen };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('restart restores context occupancy without starting or rewriting an Agent; legacy history gets a passive estimate', async t => {
  const f = fixture(t), agent = f.session.ensureAgent();
  agent.chat = async () => ({ content: '记录的回复。'.repeat(100), toolCalls: [], usage: { prompt_tokens: 10000, completion_tokens: 50 } });
  assert.equal(f.session.send({ text: '持久上下文'.repeat(80) }).ok, true); await f.session.completion;
  const previous = sessionSnapshot(f.session).context;
  const id = f.session.id; await f.manager.closeAll();
  const manager = f.reopen(), session = manager.sessions.get(id), file = path.join(session.projectDir, '.agent-history.json');
  const before = fs.readFileSync(file);
  assert.equal(session.agent, null); assert.equal(sessionSnapshot(session).context.used, previous.used);
  assert.equal(session.agent, null); assert.deepEqual(fs.readFileSync(file), before);
  session.contextState = null;
  const legacy = sessionSnapshot(session).context;
  assert.equal(legacy.limit, 1000000); assert.ok(legacy.parts.history > 0); assert.ok(legacy.parts.system > 0); assert.ok(legacy.parts.tools > 0);
  assert.equal(legacy.estimated, true); assert.equal(session.agent, null); assert.deepEqual(fs.readFileSync(file), before);
  fs.rmdirSync(f.root);
  assert.equal(sessionSnapshot(session).context.limit, 1000000, 'missing project folders must not hide readable history pressure');
});

test('a queued item can steer a streaming answer at the next step without starting another turn or losing the original prompt', async t => {
  const f = fixture(t), agent = f.session.ensureAgent(), first = deferred(), entered = deferred(), second = deferred();
  const requests = [];
  agent.chat = async (_settings, messages) => {
    requests.push(structuredClone(messages));
    if (requests.length === 1) { entered.resolve(); await first.promise; return { content: '第一步回复', toolCalls: [] }; }
    second.resolve(); return { content: '已按补充要求继续', toolCalls: [] };
  };
  const started = f.session.send({ text: '原始要求' }); await entered.promise;
  assert.equal(f.session.send({ text: '更具体的补充要求'.repeat(80), enqueue: true }).queued, true);
  const row = f.session.queue[0];
  assert.equal(f.session.steerQueued(row.id, 'old-run').code, 'steer-unavailable');
  assert.equal(f.session.steerQueued(row.id, started.runId).ok, true);
  assert.equal(f.session.steerQueued(row.id, started.runId).ok, true, 'repeated clicks retain one identified row');
  first.resolve(); await second.promise; await f.session.completion;
  const users = agent.hist.events.filter(event => event.t === 'user' && event.turnId === started.runId);
  assert.deepEqual(users.map(user => user.displayContent), ['原始要求', row.text]);
  assert.equal(users[1].id, row.id); assert.equal(f.session.queue.length, 0); assert.equal(requests.length, 2);
  assert.ok(requests[1].some(message => message.role === 'user' && message.content.includes(row.text)));
  assert.equal(agent.hist.events.filter(event => event.t === 'turn-end').length, 1);
  assert.equal(f.session.steerQueued(row.id, started.runId).code, 'queue-item-not-found');
});

test('stopping before the steering boundary retains the durable queued message', async t => {
  const f = fixture(t), agent = f.session.ensureAgent(), entered = deferred();
  agent.chat = async (_s, _m, _t, { signal }) => { entered.resolve(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
  const started = f.session.send({ text: '等待中' }); await entered.promise;
  assert.equal(f.session.send({ text: '保留这条补充', enqueue: true, delivery: 'steer' }).steered, true);
  const item = structuredClone(f.session.queue[0]); f.session.cancelTurn(started.runId); await f.session.completion;
  assert.deepEqual(f.session.queue[0], item);
  assert.equal(JSON.parse(fs.readFileSync(f.session.stateFile())).queue[0].text, item.text);
  agent.chat = async () => ({ content: '恢复后执行', toolCalls: [] });
  assert.equal(f.session.resumeQueue().ok, true); await f.session.completion;
  assert.equal(agent.hist.events.filter(event => event.t === 'user' && event.id === item.id).length, 1);
});

test('a queued editor receives full content rather than the sidebar preview truncation', t => {
  const f = fixture(t), content = '完整队列内容'.repeat(100);
  f.session.queue.push({ id: 'queue-fixture', text: content, attachments: [] });
  assert.equal(f.session.info().queuedItems[0].text, content);
});

test('turn file summaries use the net captured before/after, survive reopening and ignore failed operations and other workspaces', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-turn-files-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'work'); fs.mkdirSync(root); const file = path.join(root, 'quicksort.py'); const store = new ChangeStore(path.join(base, 'data'));
  store.write(root, file, 'first\n', { workspaceId: 'workspace', runId: 'run' });
  store.write(root, file, 'first\nsecond\n', { workspaceId: 'workspace', runId: 'run' });
  assert.deepEqual(turnFiles(store, 'workspace', 'run').files, [{ path: 'quicksort.py', created: true, removed: false, added: 2, deleted: 0 }]);
  const reopened = new ChangeStore(path.join(base, 'data'));
  assert.equal(turnFileDetail(reopened, 'workspace', 'run', 'quicksort.py').after, 'first\nsecond\n');
  assert.deepEqual(turnFiles(reopened, 'other', 'run').files, []);
  assert.throws(() => turnFileDetail(reopened, 'workspace', 'run', '../outside'), /不可用/);
  const failed = store.write(root, file, 'third\n', { workspaceId: 'workspace', runId: 'failed' }); failed.status = 'conflict';
  assert.deepEqual(turnFiles(store, 'workspace', 'failed').files, []);
});

test('line comparisons count insertions and replacements and omit net-zero changes', () => {
  assert.deepEqual(lineCounts('a\nb\nc\n', 'a\nx\nc\n'), { added: 1, deleted: 1 });
  assert.deepEqual(lineCounts('a\na\nb\n', 'a\nb\n'), { added: 0, deleted: 1 });
  assert.deepEqual(lineCounts('', 'a\n'), { added: 1, deleted: 0 });
  assert.deepEqual(lineCounts('a\n', 'a\n'), { added: 0, deleted: 0 });
});

test('read-only system memory exposes the product text and connected plugin instructions', () => {
  const plugins = [{ name: 'decrypthub_adh', state: 'ready', version: '1', instructions: '设备能力说明' }, { name: 'offline', state: 'error', instructions: '不可用说明' }];
  const value = systemMemorySources(plugins), prompt = systemMemoryPrompt({ plugins: plugins.filter(item => item.state === 'ready') });
  assert.ok(value.sources.every(source => source.editable === false && prompt.includes(source.content)));
  assert.equal(value.pluginInstructions.length, 1); assert.equal(value.pluginInstructions[0].content, '设备能力说明');
  assert.equal(value.pluginInstructions[0].editable, false);
});
