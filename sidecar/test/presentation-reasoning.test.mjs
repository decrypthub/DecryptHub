import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Agent } from '../agent.mjs';
import { completeOpenAI } from '../providers/openai.mjs';
import { completeAnthropic } from '../providers/anthropic.mjs';
import { blankSession, sessionReducer } from '../../ui/src/state.js';
import { historyEvents, conversationTurns } from '../../ui/src/conversation.js';
import { readSessionViews, sessionView, updateSessionView, revealSessionBrowser, SESSION_VIEW_KEY } from '../../ui/src/session-view.js';

function fixture(t, chatFn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-reasoning-')), events = [];
  const agent = new Agent({ projectDir: directory, tools: [], browser: null, mcp: { tools: [], has: () => false },
    getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 1000000 } }),
    emit: (name, value) => events.push({ name, value }), chatFn });
  let done;
  t.after(async () => { agent.interrupt(); await done?.catch(() => {}); assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('dh-reasoning-')); fs.rmSync(directory, { recursive: true, force: true }); });
  return { agent, events, send: () => (done = agent.send('Read sources and verify.')) };
}

test('thinking text streams with message identity, survives snapshots and persists without mixing into the answer', async t => {
  let ready, release;
  const started = new Promise(resolve => ready = resolve);
  const f = fixture(t, async (_settings, _messages, _tools, hooks) => {
    hooks.onReasoning('First inspect the source. '); hooks.onReasoning('Then verify the result.'); ready();
    await new Promise((resolve, reject) => { release = resolve; hooks.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }); });
    return { content: 'Verified answer.', toolCalls: [] };
  });
  const pending = f.send(); await started;
  assert.equal(f.agent.partial, ''); assert.match(f.agent.partialReasoning, /Then verify/);
  const chunks = f.events.filter(e => e.name === 'reasoning');
  assert.equal(chunks.length, 2); assert.equal(chunks[0].value.id, f.agent.currentItem.id);
  assert.equal(chunks[0].value.text, 'First inspect the source. ');
  const live = conversationTurns(historyEvents(f.agent.hist.events, f.agent.partial, f.agent.currentItem, f.agent.partialReasoning));
  assert.equal(live[0].answers.length, 0); assert.equal(live[0].process[0].type, 'reasoning');
  release(); await pending;
  const saved = f.agent.hist.events.find(e => e.t === 'assistant');
  assert.equal(saved.content, 'Verified answer.'); assert.match(saved.reasoning, /Then verify/);
  const ended = f.events.find(e => e.name === 'assistant-end'); assert.equal(ended.value.reasoning, saved.reasoning);
  const restored = conversationTurns(historyEvents(JSON.parse(fs.readFileSync(path.join(f.agent.projectDir, '.agent-history.json'), 'utf8')).events));
  assert.equal(restored[0].answers[0].content, 'Verified answer.'); assert.equal(restored[0].process[0].content, saved.reasoning);
});

test('interrupting a thinking-only response keeps the readable partial thought', async t => {
  let ready;
  const started = new Promise(resolve => ready = resolve);
  const f = fixture(t, async (_s, _m, _t, hooks) => {
    hooks.onReasoning('An observed partial thought.'); ready();
    await new Promise((_, reject) => hooks.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  });
  const pending = f.send(); await started; f.agent.interrupt();
  assert.equal((await pending).stop, 'interrupted');
  const saved = f.agent.hist.events.find(e => e.t === 'assistant');
  assert.equal(saved.content, ''); assert.equal(saved.reasoning, 'An observed partial thought.'); assert.equal(saved.interrupted, true);
  assert.equal(conversationTurns(historyEvents(f.agent.hist.events))[0].process[0].content, saved.reasoning);
});

test('a retried model stream resets the same display item instead of duplicating partial thinking', { timeout: 15000 }, async t => {
  let calls = 0;
  const f = fixture(t, async (_s, _m, _t, hooks) => {
    hooks.onReasoning(++calls === 1 ? 'Discarded attempt.' : 'Successful attempt.');
    if (calls === 1) throw Error('ECONNRESET');
    return { content: 'done', toolCalls: [] };
  });
  await f.send();
  const starts = f.events.filter(e => e.name === 'assistant-start');
  assert.equal(starts.length, 2); assert.equal(starts[0].value.id, starts[1].value.id); assert.equal(starts[1].value.retry, true);
  assert.equal(f.agent.hist.events.find(e => e.t === 'assistant').reasoning, 'Successful attempt.');
});

test('reasoning reducers route chunks by chat and message and reset retries safely', () => {
  let state = { main: blankSession(), sabcdef: blankSession() };
  for (const id of ['first', 'second']) state = sessionReducer(state, { sid: 'main', t: 'assistant-start', v: { id } });
  state = sessionReducer(state, { sid: 'main', t: 'reasoning', v: { id: 'first', text: 'old stream' } });
  assert.equal(state.main.events[0].reasoning, 'old stream'); assert.equal(state.main.events[1].reasoning, undefined); assert.equal(state.sabcdef.events.length, 0);
  state = sessionReducer(state, { sid: 'main', t: 'assistant-start', v: { id: 'first', retry: true } });
  assert.equal(state.main.events.length, 2); assert.equal(state.main.events[0].reasoning, '');
  assert.equal(conversationTurns([{ type: 'assistant', id: 'interrupted', reasoning: 'Saved partial', phase: 'streaming' }, { type: 'turn-end', stop: 'interrupted' }])[0].process[0].finished, true);
  const events = historyEvents([{ t: 'assistant', id: 'a', content: 'answer', reasoning: 'Readable provider text', signature: 'PRIVATE_SIGNATURE', redacted_thinking: 'ENCRYPTED_BLOCK' }]);
  assert.equal(events[0].reasoning, 'Readable provider text'); assert.ok(!JSON.stringify(events).includes('PRIVATE_SIGNATURE')); assert.ok(!JSON.stringify(events).includes('ENCRYPTED_BLOCK'));
});

test('cancelling during model retry backoff promptly preserves the visible partial thought', { timeout: 3000 }, async t => {
  let retryStarted;
  const waiting = new Promise(resolve => retryStarted = resolve);
  const f = fixture(t, async (_s, _m, _t, hooks) => { hooks.onReasoning('Thought before connection loss.'); throw Error('ECONNRESET'); });
  const emit = f.agent.emit;
  f.agent.emit = (name, value) => { emit(name, value); if (name === 'retry') retryStarted(); };
  const pending = f.send(); await waiting; f.agent.interrupt();
  assert.equal((await pending).stop, 'interrupted');
  assert.equal(f.agent.hist.events.find(e => e.t === 'assistant').reasoning, 'Thought before connection loss.');
});

test('browser panel presentation is independent per chat and respects an explicit close', () => {
  let views = updateSessionView({}, 'main', { side: 'code', sideOpen: true });
  views = updateSessionView(views, 'sabcdef', { side: 'evidence', sideOpen: true });
  views = updateSessionView(views, 'main', { sideOpen: false, manuallyClosed: true });
  views = updateSessionView(views, 'sabcdef', { layout: [62, 38] });
  assert.equal(sessionView(views, 'sabcdef').sideOpen, true); assert.equal(sessionView(views, 'sabcdef').side, 'evidence');
  assert.deepEqual(sessionView(views, 'sabcdef').layout, [62, 38]); assert.deepEqual(sessionView(views, 'main').layout, [56, 44]);
  assert.equal(revealSessionBrowser(views, 'main'), views);
  views = revealSessionBrowser(views, 'sabcdef'); assert.equal(sessionView(views, 'sabcdef').side, 'browser'); assert.equal(sessionView(views, 'main').side, 'code');
  const restored = readSessionViews({ getItem: key => key === SESSION_VIEW_KEY ? JSON.stringify({ version: 1, sessions: views }) : null });
  assert.deepEqual(restored.views, views);
  assert.equal(readSessionViews({ getItem: key => key === 'wdh_side' ? 'open' : null }).fallback.sideOpen, true);
  assert.equal(readSessionViews({ getItem: () => { throw Error('unavailable storage'); } }).fallback.sideOpen, false);
  assert.equal(updateSessionView(views, '__proto__', { sideOpen: true }), views);
});

for (const [name, complete, payload] of [
  ['OpenAI', completeOpenAI, { choices: [{ delta: { reasoning_content: 'Visible thinking.' } }] }],
  ['Anthropic', completeAnthropic, { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Visible thinking.' } }],
]) test(name + ' does not silently replay a provider stream after emitting thinking text', async t => {
  let calls = 0; const chunks = [];
  const server = http.createServer((request, response) => {
    calls++; request.resume(); request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('data: ' + JSON.stringify(payload) + '\n\n');
      setTimeout(() => response.destroy(), 20);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await assert.rejects(() => complete({ baseUrl: 'http://127.0.0.1:' + server.address().port, apiKey: 'fixture', model: 'fixture', retryBaseMs: 1 }, [], [], { onReasoning: value => chunks.push(value) }));
  assert.equal(calls, 1); assert.deepEqual(chunks, ['Visible thinking.']);
});
