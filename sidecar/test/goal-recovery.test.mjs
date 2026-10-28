import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { getEventListeners } from 'node:events';
import { Agent } from '../agent.mjs';
import { SessionManager } from '../sessions.mjs';
import { createGoal, restoreGoal, updateGoal, finishGoalRound, GoalDriver } from '../goals.mjs';
import { withModelRetries } from '../model-retry.mjs';
import { post } from '../providers/http.mjs';
import { resolveProvider } from '../providers/index.mjs';
import { completeOpenAI } from '../providers/openai.mjs';
import { completeAnthropic } from '../providers/anthropic.mjs';
import { historyEvents } from '../../ui/src/conversation.js';

const answer = content => ({ content, toolCalls: [], finishReason: 'stop' });
const call = (name, args, id = name) => ({ content: '', toolCalls: [{ id, name, args }], finishReason: 'tool_calls' });
const verified = { criteria: [{ content: '核对源文件的证据', status: 'verified' }], evidence: ['source.txt 包含 VERIFIED_EVIDENCE'] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { const end = Date.now() + 5000; while (!fn()) { assert.ok(Date.now() < end, 'state did not settle'); await wait(5); } }
function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-goal-recovery-')); t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('dh-goal-recovery-')); fs.rmSync(dir, { recursive: true, force: true }); }); return dir; }
function session(t) {
  const dir = root(t), events = [];
  const mgr = new SessionManager({ userDataDir: dir, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } }), broadcast: (name, value, sid) => events.push({ name, value, sid }), chromeMod: {}, titleGenerator: async () => '' });
  const s = mgr.get('main'); s.setWorkspace(null); s.goalDriver.delayMs = 10;
  t.after(() => mgr.closeAll()); return { s, mgr, events, dir };
}
async function server(t, handler) {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => handler(req, res)); });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(async () => { srv.closeAllConnections(); await new Promise(resolve => srv.close(resolve)); });
  return `http://127.0.0.1:${srv.address().port}`;
}
function sse(res, events) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(events.map(e => 'data: ' + (typeof e === 'string' ? e : JSON.stringify(e)) + '\n\n').join('')); }

test('a model request has exactly ten retries, bounded backoff and abortable waits', async () => {
  let attempts = 0; const retries = [], delays = [];
  await assert.rejects(withModelRetries(() => { attempts++; throw Object.assign(Error('unavailable'), { status: 503 }); }, { random: () => .5, wait: async ms => delays.push(ms), onRetry: r => retries.push(r) }), /unavailable/);
  assert.equal(attempts, 11); assert.equal(retries.length, 10); assert.deepEqual(delays.slice(0, 3), [1000, 2000, 4000]); assert.equal(delays.at(-1), 30000);
  assert.equal(retries.at(-1).attempt, 10); assert.equal(retries.at(-1).maxRetries, 10);
  const controller = new AbortController(); let seen = 0;
  await assert.rejects(withModelRetries(() => { seen++; throw Object.assign(Error('ECONNRESET'), { code: 'ECONNRESET' }); }, { signal: controller.signal, onRetry: () => controller.abort() }), { name: 'AbortError' });
  assert.equal(seen, 1);
});

for (const provider of ['openai', 'anthropic']) test(`${provider}: eleven physical failed HTTP requests exhaust one shared budget and release abort listeners`, async t => {
  let requests = 0;
  const url = await server(t, (_req, res) => { requests++; res.writeHead(503); res.end('temporary outage'); });
  const controller = new AbortController(), events = [];
  const settings = { provider, [provider]: { baseUrl: provider === 'openai' ? url + '/v1' : url, apiKey: 'fixture', model: 'fixture', retryBaseMs: 0 } };
  await assert.rejects(resolveProvider(settings).complete([{ role: 'user', content: 'verify' }], [], { signal: controller.signal, onRetry: event => events.push(event) }), e => e.status === 503);
  assert.equal(requests, 11); assert.equal(events.length, 10); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Retry-After is parsed and preferred without exposing the provider body in progress events', async t => {
  const url = await server(t, (_req, res) => { res.writeHead(429, { 'Retry-After': '2' }); res.end('PRIVATE_PROVIDER_RESPONSE'); });
  let error; try { await post(url, {}, {}, () => {}, null); } catch (e) { error = e; }
  assert.equal(error.retryAfterMs, 2000); const values = [];
  await assert.rejects(withModelRetries(() => { throw error; }, { wait: async () => {}, onRetry: value => values.push(value), baseDelayMs: 1 }), /HTTP 429/);
  assert.equal(values[0].delayMs, 2000); assert.ok(!JSON.stringify(values).includes('PRIVATE_PROVIDER_RESPONSE'));
});

test('authentication, malformed requests and in-stream authentication errors do not retry', async t => {
  for (const status of [400, 401, 403, 404]) {
    let count = 0; await assert.rejects(withModelRetries(() => { count++; throw Object.assign(Error('permanent'), { status, retryable: true }); }, { wait: async () => {} })); assert.equal(count, 1);
  }
  let count = 0; const url = await server(t, (_req, res) => { count++; sse(res, [{ error: { type: 'authentication_error', message: 'invalid credential' } }]); });
  await assert.rejects(resolveProvider({ openai: { apiKey: 'fixture', model: 'fixture', baseUrl: url, retryBaseMs: 0 } }).complete([{ role: 'user', content: 'verify' }], [], {}), e => e.status === 401);
  assert.equal(count, 1);
});

test('partial tool input, unfinished streams and empty completions are failures, not executable work', async t => {
  const url = await server(t, (_req, res) => sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'partial', function: { name: 'workspace_write', arguments: '{"path":' } }] } }] }]));
  await assert.rejects(completeOpenAI({ apiKey: 'fixture', model: 'fixture', baseUrl: url }, [], []), e => e.code === 'EMPTY_COMPLETION' && e.retryable);
  const empty = await server(t, (_req, res) => sse(res, [{ choices: [{ delta: {}, finish_reason: 'stop' }] }]));
  await assert.rejects(completeOpenAI({ apiKey: 'fixture', model: 'fixture', baseUrl: empty }, [], []), e => e.code === 'EMPTY_COMPLETION');
  const limited = await server(t, (_req, res) => sse(res, [{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }]));
  await assert.rejects(completeAnthropic({ apiKey: 'fixture', model: 'fixture', baseUrl: limited }, [], []), e => e.retryable === false);
});

test('Agent retries the model step ten times without replaying a completed tool or duplicating display identity', async t => {
  const dir = root(t), events = []; let calls = 0, tools = 0;
  const agent = new Agent({ projectDir: dir, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } }), emit: (name, value) => events.push({ name, value }), retryPolicy: { wait: async () => {} },
    tools: [{ name: 'workspace_read', schema: { type: 'object', properties: {} }, run: async () => { tools++; return { text: 'observed evidence' }; } }],
    chatFn: async (_s, _m, _t, hooks) => { calls++; if (calls === 1) return call('workspace_read', {}); if (calls <= 11) { hooks.onReasoning('discarded partial'); throw Object.assign(Error('temporary'), { status: 503 }); } hooks.onDelta('verified'); return answer('verified'); } });
  t.after(() => agent.interrupt());
  assert.equal((await agent.send('verify')).stop, 'completed'); assert.equal(calls, 12); assert.equal(tools, 1);
  assert.equal(events.filter(e => e.name === 'retry').length, 10);
  const ids = events.filter(e => e.name === 'assistant-start').slice(1).map(e => e.value.id); assert.equal(new Set(ids).size, 1);
  assert.equal(agent.hist.events.filter(e => e.t === 'assistant').length, 2); assert.equal(agent.hist.events.at(-2).reasoning, undefined);
});

test('goal completion needs verified criteria and evidence; no-op progress cannot keep a goal spinning', () => {
  const initial = createGoal('核对证据', 'workspace');
  assert.throws(() => updateGoal(initial, { status: 'complete', summary: 'done' }), /evidence/);
  assert.throws(() => updateGoal(initial, { status: 'complete', summary: 'done', ...verified, criteria: [{ content: '核对', status: 'pending' }] }), /evidence/);
  const progress = updateGoal(initial, { status: 'progress', summary: '已定位证据', ...verified, nextAction: '交叉验证' }, { runId: 'run' });
  assert.equal(updateGoal(progress, { status: 'progress', summary: '增加一项观测' }).nextAction, '交叉验证');
  assert.equal(initial.summary, ''); assert.equal(updateGoal(progress, { status: 'progress', summary: progress.summary, nextAction: progress.nextAction }), progress);
  const completed = updateGoal(progress, { status: 'complete', summary: '证据已复核', ...verified }); assert.equal(completed.status, 'complete'); assert.equal(completed.checkpoints.length, 2);
  const restored = restoreGoal(progress); assert.equal(restored.status, 'paused'); assert.equal(restored.summary, progress.summary); assert.deepEqual(restored.evidence, progress.evidence);
  assert.equal(finishGoalRound(progress, { stop: 'completed' }, { automatic: true }).stopReason, 'no-progress');
});

test('goal continuation survives compaction as host state and never invents a user message', async t => {
  const { s, dir } = session(t); fs.writeFileSync(path.join(s.workspace.root, 'source.txt'), 'VERIFIED_EVIDENCE');
  let calls = 0; const prompts = [];
  s.ensureAgent().chat = async (_settings, messages) => {
    prompts.push(messages); calls++;
    if (calls === 1) return call('goal_update', { status: 'progress', summary: '已拆解条件', criteria: [{ content: '核对源文件的证据', status: 'pending' }], nextAction: '读取source.txt' });
    if (calls === 2) return call('workspace_read', { path: 'source.txt' });
    if (calls === 3) return answer('已完成证据读取，接下来交叉核对。');
    if (calls === 4) return call('goal_update', { status: 'complete', summary: '已读取并核对', ...verified });
    return answer('全部验证完成。');
  };
  await s.startGoal('核对源文件证据'); await s.completion;
  s.agent.hist.commitSummary('已读取source.txt，保留证据与完成条件。');
  await until(() => s.goal.status === 'complete' && !s.agent.running);
  assert.equal(s.goal.turns, 2); assert.equal(s.goal.checkpoints.length, 2);
  assert.equal(s.agent.hist.events.filter(e => e.t === 'user').length, 1); assert.equal(s.agent.hist.events.filter(e => e.t === 'continuation').length, 1);
  assert.equal(historyEvents(s.agent.hist.events).filter(e => e.type === 'user').length, 1);
  assert.match(prompts[3][0].content, /读取source.txt/); assert.match(s.agent.wire(true)[0].content, /通用 Agent/);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'projects/default/.agent-state.json'), 'utf8')); assert.equal(state.goal.status, 'complete');
});

test('a text-only goal stops after one automatic audit and retains its progress instead of looping', async t => {
  const { s } = session(t); s.ensureAgent().chat = async () => answer('还需要继续。');
  await s.startGoal('验证无进展边界'); await until(() => s.goal.status === 'needs_attention' && !s.agent.running);
  assert.equal(s.goal.turns, 2); assert.equal(s.goal.stopReason, 'no-progress'); assert.equal(s.agent.hist.events.filter(e => e.t === 'user').length, 1);
  s.interrupt(); await wait(25); assert.equal(s.goal.turns, 2);
});

test('a user message queued during a goal is dispatched before an automatic continuation', async t => {
  const { s } = session(t); let release, ready; const started = new Promise(r => ready = r); let calls = 0;
  s.ensureAgent().chat = async () => { calls++; if (calls === 1) { ready(); await new Promise(r => release = r); return answer('已有阶段性进展'); } if (calls === 2) return call('goal_update', { status: 'complete', summary: '已结合补充核对', ...verified }); return answer('done'); };
  await s.startGoal('核对证据'); await started; assert.equal(s.send({ text: '用户补充：优先核对源文件', enqueue: true }).queued, true); release();
  await until(() => s.goal.status === 'complete' && !s.agent.running);
  assert.equal(s.agent.hist.events.filter(e => e.t === 'user').length, 2); assert.equal(s.agent.hist.events.some(e => e.t === 'continuation'), false);
});

test('GoalDriver cancels stale rounds on pause, replacement, queued input and close', async () => {
  let goal = createGoal('one', 'ws'), idle = true, calls = 0;
  const driver = new GoalDriver({ current: () => goal, idle: () => idle, dispatch: () => { calls++; return { ok: true }; }, delayMs: 5 });
  driver.schedule(); goal.status = 'paused'; await wait(15); assert.equal(calls, 0);
  goal = createGoal('two', 'ws'); driver.schedule(); goal = createGoal('three', 'ws'); await wait(15); assert.equal(calls, 0);
  driver.schedule(); idle = false; await wait(15); assert.equal(calls, 0);
  idle = true; driver.schedule(); driver.cancel(); await wait(15); assert.equal(calls, 0);
  driver.schedule(); await wait(15); assert.equal(calls, 1); driver.cancel();
});

test('a queue item is retained when a model configuration prevents dispatch', t => {
  const { s, mgr } = session(t); s.queue.push({ text: 'retain this user input' }); mgr.getSettings = () => ({ openai: {} });
  assert.equal(s.resumeQueue().ok, false); assert.equal(s.queue.length, 1); assert.equal(s.queue[0].text, 'retain this user input');
});
