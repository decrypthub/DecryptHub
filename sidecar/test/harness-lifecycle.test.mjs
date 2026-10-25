import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionManager } from '../sessions.mjs';
import { Agent } from '../agent.mjs';
import { ResearchAgents } from '../subagents.mjs';
import { HARNESS_TOOLS } from '../harnesstools.mjs';
import { CLASSIFIED } from '../policy.mjs';
import { parseCommand, commandMatches } from '../../ui/src/commands.js';
const result = content => ({ content, toolCalls: [], finishReason: 'stop', usage: null });
const manager = dir => new SessionManager({ userDataDir: dir, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'test', contextWindow: 1000000 } }), broadcast() {}, chromeMod: {} });
function root(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-harness-life-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }
const until = async fn => { const end = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < end, 'state did not settle'); await new Promise(r => setTimeout(r, 15)); } };
test('session identifiers survive restoration and run journals include their session', async t => {
  const dir = root(t), mgr = manager(dir); t.after(() => mgr.closeAll());
  const s = mgr.create({ title: 'ID fixture' }), id = s.id; assert.match(id, /^s[0-9a-f]{32}$/);
  s.ensureAgent().chat = async () => result('done'); s.send({ text: 'ID fixture' }); await s.completion;
  assert.equal(s.runs.latest().sessionId, id); assert.ok(s.runs.events().every(e => e.sessionId === id));
  const restored = manager(dir); t.after(() => restored.closeAll()); assert.equal(restored.get(id).id, id);
  assert.equal(await s.approve({ name: 'browser_click' }, AbortSignal.abort()), false);
  s.setMode('full-access'); assert.equal(await s.approve({ name: 'browser_click' }), true); assert.equal(s.pending.size, 0);
});
test('commands route explicit actions and do not mistake paths for commands', () => {
  assert.deepEqual(commandMatches('/go').map(c => c.name), ['goal']); assert.equal(commandMatches('/goal test').length, 0);
  assert.equal(parseCommand('/goal 验证\n第二行').argument, '验证\n第二行'); assert.equal(parseCommand('/path/to/file'), null);
  assert.equal(parseCommand('/unknown').known, false); for (const tool of HARNESS_TOOLS) assert.ok(CLASSIFIED.has(tool.name), tool.name);
});
test('goal continues only within its bound, persists as paused, and requires explicit completion', async t => {
  const dir = root(t), mgr = manager(dir), s = mgr.get('main'); t.after(() => mgr.closeAll());
  s.ensureAgent().chat = async () => result('已完成一项验证，目标尚未全部实现。');
  assert.equal((await s.startGoal('验证长期目标')).ok, true); s.goal.maxTurns = 2;
  await until(() => s.goal.status === 'paused' && !s.agent.running);
  assert.equal(s.goal.turns, 2); assert.equal(manager(dir).get('main').goal.status, 'paused');
  const complete = s.ensureAgent(); let calls = 0; complete.chat = async () => ++calls === 1 ? { content: '', toolCalls: [{ id: 'complete', name: 'goal_update', args: { status: 'complete', summary: '测试已验证，目标完成。' } }] } : result('目标完成。');
  assert.equal((await s.goalAction('resume')).ok, true); await until(() => s.goal.status === 'complete' && !s.agent.running);
  assert.equal(s.goal.summary, '测试已验证，目标完成。'); assert.equal(s.goal.turns, 1);
  await s.goalAction('clear'); assert.equal(s.goal, null);
});
test('goal interruption cancels future continuation and never replays on startup', async t => {
  const dir = root(t), mgr = manager(dir), s = mgr.get('main'); t.after(() => mgr.closeAll());
  s.ensureAgent().chat = async (_s, _m, _t, { signal }) => { await new Promise(r => { if (signal?.aborted) r(); else signal?.addEventListener('abort', r, { once: true }); }); return result('stopped'); };
  await s.startGoal('可暂停目标'); const restored = manager(dir).get('main'); assert.equal(restored.goal.status, 'paused');
  s.interrupt(); await s.completion; assert.equal(s.goal.status, 'paused'); assert.equal(s.goal.turns, 1);
});
test('goal token budget pauses continuation without claiming completion', async t => {
  const dir = root(t), mgr = manager(dir), s = mgr.get('main'); t.after(() => mgr.closeAll());
  s.ensureAgent().chat = async () => ({ ...result('已消耗本批预算，保留当前进展。'), usage: { prompt_tokens: 200000, completion_tokens: 1 } });
  await s.startGoal('预算边界验证'); s.goal.tokenBudget = 200000; await s.completion;
  assert.equal(s.goal.status, 'paused'); assert.equal(s.goal.turns, 1); assert.equal(s.goal.usedTokens, 200001);
});
test('user steering between automatic turns remains part of the active goal', async t => {
  const dir = root(t), mgr = manager(dir), s = mgr.get('main'); t.after(() => mgr.closeAll());
  s.ensureAgent().chat = async () => result('先记录已有进展。'); await s.startGoal('等待补充要求'); await s.completion;
  let calls = 0; s.agent.chat = async () => ++calls === 1 ? { content: '', toolCalls: [{ id: 'done', name: 'goal_update', args: { status: 'complete', summary: '已结合用户补充验证完成。' } }] } : result('目标完成。');
  assert.equal(s.send({ text: '补充要求：先核对验证证据' }).ok, true); await s.completion;
  assert.equal(s.goal.status, 'complete'); assert.equal(s.goal.turns, 2);
});
test('research agents have independent histories and no write, exec, browser or recursion authority', async t => {
  const directory = root(t), workRoot = path.join(directory, 'workspace'); fs.mkdirSync(workRoot); fs.writeFileSync(path.join(workRoot, 'source.js'), 'const VM_EVIDENCE = 42;');
  const made = [], agents = new ResearchAgents({ directory, context: () => ({ workRoot, workspaceId: 'one', workspaceKind: 'folder', ensureDebugger: () => { throw new Error('must not connect'); } }), settings: () => ({ openai: { apiKey: 'fixture', model: 'test' } }), createAgent: opts => {
    const agent = new Agent({ ...opts, chatFn: async () => { if (!agent.hist.events.some(e => e.t === 'tool')) return { content: '', toolCalls: [{ id: 'read', name: 'workspace_read', args: { path: 'source.js' } }] }; return result('证据 source.js：VM_EVIDENCE = 42'); } }); made.push(agent); return agent;
  } });
  const a = agents.spawn('查找 VM 证据'), b = agents.spawn('独立复查'); const [ra, rb] = await Promise.all([agents.wait(a.id), agents.wait(b.id)]);
  assert.equal(ra.status, 'completed'); assert.match(ra.summary, /VM_EVIDENCE/); assert.notEqual(made[0].projectDir, made[1].projectDir);
  assert.equal(made[0].allTools().some(t => /workspace_write|browser_open|agent_spawn|goal_update/.test(t.name)), false);
  assert.equal(made[0].getToolContext().ensureDebugger, undefined); assert.equal((await made[0].runTool('workspace_shell', { cmd: 'echo no' })).isError, true);
  const restored = new ResearchAgents({ directory, context: () => ({}), settings: () => ({}) }); assert.equal(restored.list().length, 2); assert.equal(rb.status, 'completed');
});
test('research agent concurrency and cancellation are bounded', async t => {
  const directory = root(t), workRoot = path.join(directory, 'workspace'); fs.mkdirSync(workRoot);
  const agents = new ResearchAgents({ directory, context: () => ({ workRoot, workspaceId: 'one' }), settings: () => ({ openai: { apiKey: 'fixture', model: 'test' } }), createAgent: opts => new Agent({ ...opts, chatFn: async (_s, _m, _t, { signal }) => { await new Promise(r => { if (signal?.aborted) r(); else signal?.addEventListener('abort', r, { once: true }); }); return result('cancelled'); } }) });
  const tasks = [agents.spawn('one'), agents.spawn('two'), agents.spawn('three')]; assert.throws(() => agents.spawn('four'), /最多/);
  agents.cancelAll(); const results = await Promise.all(tasks.map(t => agents.wait(t.id))); assert.ok(results.every(r => r.status === 'cancelled')); assert.equal(agents.jobs.size, 0);
});
test('research setup fails before making requests when credentials are missing', t => {
  const agents = new ResearchAgents({ directory: root(t), context: () => ({}), settings: () => ({}) });
  assert.throws(() => agents.spawn('test'), /API Key/); assert.equal(agents.jobs.size, 0);
});
test('research usage counts against the owning goal batch and older batches cannot consume a resumed budget', async t => {
  const dir = root(t), mgr = manager(dir), s = mgr.get('main'); t.after(() => mgr.closeAll());
  s.goal = { id: 'goal', batchId: 'one', status: 'active', tokenBudget: 2, usedTokens: 0 }; s.activeRun = { id: 'run', source: 'goal' };
  s.subagents.createAgent = opts => new Agent({ ...opts, chatFn: async () => ({ ...result('research done'), usage: { prompt_tokens: 2, completion_tokens: 1 } }) });
  const task = s.subagents.spawn('bounded research'), record = await s.subagents.wait(task.id);
  assert.equal(s.goal.usedTokens, 3); assert.equal(s.goal.status, 'paused');
  s.goal.batchId = 'two'; s.goal.usedTokens = 0; s.subagents.onUsage(record); assert.equal(s.goal.usedTokens, 0);
  s.activeRun = null;
});
