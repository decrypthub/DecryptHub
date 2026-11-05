import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';

test('scoped stop preserves queued drafts without running them and rejects a stale turn after resumption', { timeout: 10000 }, async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-scoped-stop-')), root = path.join(base, 'workspace'); fs.mkdirSync(root);
  const settings = { openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } };
  const manager = new SessionManager({ userDataDir: path.join(base, 'data'), getSettings: () => settings, broadcast() {}, chromeMod: {}, titleGenerator: async () => '' });
  t.after(async () => { await manager.closeAll(); fs.rmSync(base, { recursive: true, force: true }); });
  const folder = manager.workspaces.folder(root), project = manager.projects.save({ name: 'Fixture', folders: [folder], primaryId: folder.id });
  const session = manager.create({ projectId: project.id }), agent = session.ensureAgent();
  let requests = 0, requested;
  const ready = new Promise(resolve => { requested = resolve; });
  agent.chat = async (_s, _m, _t, { signal }) => {
    requests++;
    requested();
    await new Promise((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    return { content: 'stopped', toolCalls: [] };
  };
  const started = session.send({ text: 'first' }); assert.equal(started.ok, true);
  await ready;
  const queued = session.send({ text: 'keep this draft', enqueue: true }); assert.equal(queued.queued, true);
  const queue = structuredClone(session.queue);
  assert.equal(session.cancelTurn('stale-run'), false); assert.equal(agent.abort.signal.aborted, false);
  assert.equal(session.cancelTurn(started.runId), true);
  await session.completion;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(agent.running, false); assert.equal(session.runs.latest().status, 'cancelled');
  assert.deepEqual(session.queue, queue); assert.equal(requests, 1, 'stop must not automatically execute the saved queue');
  assert.deepEqual(JSON.parse(fs.readFileSync(session.stateFile())).queue, JSON.parse(JSON.stringify(queue)));
  const next = session.resumeQueue(); assert.equal(next.ok, true); assert.notEqual(next.runId, started.runId);
  assert.equal(session.cancelTurn(started.runId), false); assert.equal(agent.abort.signal.aborted, false);
  assert.equal(session.cancelTurn(next.runId), true); await session.completion;
  assert.equal(session.queue.length, 0);
});
