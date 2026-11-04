import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../agent.mjs';
import { History } from '../history.mjs';
import { historyEvents, conversationTurns } from '../../ui/src/conversation.js';

test('a cancelled Agent tool keeps its error receipt but records a distinct stopped outcome', { timeout: 10000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-tool-cancel-'));
  const emitted = [];
  const agent = new Agent({ projectDir: directory, tools: [], browser: null, mcp: { tools: [], has: () => false },
    getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 100000 } }),
    emit: (name, value) => { if (name === 'tool-end') emitted.push(value); },
    chatFn: async () => ({ content: '', toolCalls: [{ id: 'fixture-call', name: 'fixture-wait', args: {} }] }) });
  t.after(() => { agent.hist.close(); assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('dh-tool-cancel-')); fs.rmSync(directory, { recursive: true, force: true }); });
  agent.runTool = async () => { agent.interrupt(); return { text: 'cancelled fixture operation', isError: true }; };
  const result = await agent.send('cancel a waiting tool');
  assert.equal(result.stop, 'interrupted'); assert.equal(emitted.length, 1);
  assert.equal(emitted[0].isError, true); assert.equal(emitted[0].cancelled, true);
  const receipt = agent.hist.events.find(event => event.t === 'tool');
  assert.equal(receipt.isError, true); assert.equal(receipt.cancelled, true);
  const turn = conversationTurns(historyEvents(agent.hist.events))[0];
  assert.equal(turn.failures, 0); assert.equal(turn.tools[0].cancelled, true);
  const restored = History.load(agent.histFile());
  try {
    const replay = conversationTurns(historyEvents(restored.events))[0];
    assert.equal(replay.failures, 0); assert.equal(replay.tools[0].cancelled, true);
  } finally { restored.close(); }
});
