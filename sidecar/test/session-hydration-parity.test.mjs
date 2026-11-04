import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../agent.mjs';
import { historyEvents, conversationTurns } from '../../ui/src/conversation.js';
import { sessionReducer } from '../../ui/src/state.js';

test('hydrating a real Agent before its first token retains the active reply and its final answer', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-hydration-parity-'));
  let state = {}, agent, captured, ready, release;
  const entered = new Promise(resolve => ready = resolve), response = new Promise(resolve => release = resolve);
  const dispatch = action => { state = sessionReducer(state, { sid: 'fork', ...action }); };
  agent = new Agent({ projectDir: directory, tools: [], browser: null, mcp: { tools: [], has: () => false },
    getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 100000 } }),
    emit(name, value) {
      if (name === 'user') dispatch({ t: 'ev', v: { type: 'user', ...value } });
      if (name === 'assistant-start') dispatch({ t: 'assistant-start', v: value });
      if (['delta', 'reasoning', 'assistant-end'].includes(name)) dispatch({ t: name, v: value });
      if (name === 'done') dispatch({ t: 'ev', v: { type: 'turn-end', ...value } });
    },
    chatFn: async (_settings, _messages, _tools, hooks) => {
      captured = historyEvents(agent.hist.events, agent.partial, agent.currentItem, agent.partialReasoning);
      dispatch({ t: 'patch', patch: { events: captured } }); ready(); await response;
      hooks.onDelta('新分支标记 B'); return { content: '新分支标记 B', toolCalls: [] };
    },
  });
  const pending = agent.send('只回复新分支标记 B');
  t.after(async () => { release(); agent.interrupt(); await pending; agent.hist.close(); assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('dh-hydration-parity-')); fs.rmSync(directory, { recursive: true, force: true }); });
  await entered;
  const empty = captured.find(event => event.type === 'assistant'); assert.equal(empty.id, agent.currentItem.id); assert.equal(empty.content, '');
  release(); await pending;
  const turns = conversationTurns(state.fork.events); assert.equal(turns.length, 1); assert.equal(turns[0].answers.length, 1); assert.equal(turns[0].answers[0].content, '新分支标记 B');
  assert.equal(state.fork.events.filter(event => event.type === 'assistant').length, 1);
});

test('canonical completion recovers a missing message without duplicating an existing reply', () => {
  const complete = { t: 'assistant-end', sid: 'fork', v: { id: 'reply', turnId: 'run', phase: 'final_answer', content: 'canonical answer', reasoning: 'verified thought' } };
  let state = sessionReducer({}, complete); state = sessionReducer(state, complete);
  assert.equal(state.fork.events.length, 1);
  assert.equal(conversationTurns(state.fork.events)[0].answers[0].content, 'canonical answer');
});
