import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TestSessionManager } from './project-fixture.mjs';
import { Agent } from '../agent.mjs';
import { inspectSubagent, subagentAddress, subagentOwner, teamMemberIds } from '../subagent-inspection.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-child-view-'));
  const manager = new TestSessionManager({ userDataDir: dir, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } }), broadcast() {}, chromeMod: {}, titleGenerator: async () => '' });
  t.after(async () => { await manager.closeAll(); fs.rmSync(dir, { recursive: true, force: true }); });
  const session = manager.get('main');
  session.subagents.createAgent = options => new Agent({ ...options, chatFn: async () => ({ content: '已核对真实文件的证据。', toolCalls: [] }) });
  return { manager, session };
}
test('viewing a child returns its full history and never starts or restores an Agent', async t => {
  const { session } = fixture(t), child = session.subagents.spawn('核对文件');
  await session.subagents.wait(child.id);
  const live = await inspectSubagent(session, [child.id]);
  assert.ok(live.events.some(e => e.t === 'assistant' && e.content.includes('真实文件')));
  assert.equal(live.agent.status, 'completed'); assert.equal(session.agent, null);
  session.subagents.cancelAll();
  const cold = await inspectSubagent(session, [child.id]);
  assert.equal(cold.events.length, live.events.length); assert.equal(session.subagents.resumable.size, 0); assert.equal(session.subagents.jobs.size, 0);
});
test('a sibling root cannot inspect or message another root’s child even in the same folder', async t => {
  const { session, manager } = fixture(t), child = session.subagents.spawn('只属于父会话'); await session.subagents.wait(child.id);
  const other = manager.create({ projectId: session.projectId });
  assert.throws(() => subagentAddress(other, [child.id]), /不属于/);
  assert.throws(() => subagentOwner(other, [child.id]), /不属于/);
  assert.throws(() => subagentAddress(session, ['../private']), /无效/);
  assert.equal(teamMemberIds(other).has(child.id), false); assert.equal(teamMemberIds(session).has(child.id), true);
});
test('a child can be continued through its owning manager and cancelled children stay readable', async t => {
  const { session } = fixture(t), child = session.subagents.spawn('第一轮'); await session.subagents.wait(child.id);
  const owner = subagentOwner(session, [child.id]); owner.manager.message(owner.id, '第二轮', { fromUser: true }); await owner.manager.wait(owner.id);
  const next = await inspectSubagent(session, [child.id]);
  assert.equal(next.events.filter(e => e.t === 'turn-end').length, 2);
  assert.equal(next.events.filter(e => e.t === 'user').at(-1).content, '第二轮');
  session.subagents.records.find(r => r.id === child.id).cancelled = true;
  assert.ok((await inspectSubagent(session, [child.id])).events.length);
  assert.throws(() => owner.manager.message(owner.id, '不能重新启动'), /已取消/);
});
test('nested children are addressed by the complete parent chain', async t => {
  const { session } = fixture(t), parent = session.subagents.spawn('父代理'); await session.subagents.wait(parent.id);
  const parentAgent = session.subagents.resumable.get(parent.id), nested = parentAgent.delegatedChildren;
  nested.createAgent = options => new Agent({ ...options, chatFn: async () => ({ content: '第二层结果', toolCalls: [] }) });
  const child = nested.spawn('第二层'); await nested.wait(child.id);
  assert.equal((await inspectSubagent(session, [parent.id, child.id])).agent.id, child.id);
  assert.throws(() => subagentAddress(session, [child.id]), /不属于/);
  assert.equal(teamMemberIds(session).has(child.id), true);
  session.subagents.cancelAll();
  const cold = await inspectSubagent(session, [parent.id, child.id]); assert.equal(cold.agent.status, 'completed');
  assert.equal(session.subagents.resumable.size, 0);
  const owner = subagentOwner(session, [parent.id, child.id]); assert.equal(owner.id, child.id); assert.equal(owner.manager.jobs.size, 0);
});
test('restored-history eviction never closes a running child or an ancestor with running descendants', t => {
  const { session } = fixture(t), manager = session.subagents, closed = [];
  const agent = (id, running = false, descendants = false) => ({ running, hist: { close: () => closed.push(id) }, delegatedChildren: { jobs: new Map(descendants ? [['nested', {}]] : []), cancelAll() {} } });
  manager.resumable.set('active', agent('active', true)); manager.resumable.set('ancestor', agent('ancestor', false, true));
  for (let i = 0; i < 9; i++) manager.resumable.set('idle-' + i, agent('idle-' + i));
  manager.trimResumable('idle-8');
  assert.equal(manager.resumable.size, 10); assert.deepEqual(closed, ['idle-0']);
  assert.ok(manager.resumable.has('active')); assert.ok(manager.resumable.has('ancestor')); assert.ok(manager.resumable.has('idle-8'));
  manager.resumable.clear();
});
