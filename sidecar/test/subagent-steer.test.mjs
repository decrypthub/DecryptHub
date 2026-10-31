import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchAgents } from '../subagents.mjs';
import { Agent } from '../agent.mjs';

test('a running subagent receives steer instead of a second send', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-steer-'));
  let release, sendCalls = 0;
  const steers = [];
  const agent = {
    hist: { events: [] }, interrupt() {},
    queueSteer(text) { steers.push(text); return true; },
    send: async () => { sendCalls++; await new Promise(r => { release = r; }); return { stop: 'completed', usage: {} }; },
  };
  const agents = new ResearchAgents({
    directory: dir,
    context: () => ({ workspaceId: 'w', workRoot: dir, projectRoots: [], workspaceKind: 'folder', protectedRoot: dir, runId: 'r', goalBudget: null }),
    settings: () => ({ provider: 'openai', openai: { apiKey: 'fixture' }, anthropic: {}, maxTokens: 4096 }),
    createAgent: () => agent,
  });
  try {
    const { id } = agents.spawn('TASK_MARKER');
    await new Promise(r => setTimeout(r, 10));
    const result = agents.message(id, 'STEER_MARKER');
    assert.equal(result.steered, true);
    assert.deepEqual(steers, ['STEER_MARKER']);
    assert.equal(sendCalls, 1);
    release();
    await agents.wait(id, { waitMs: 1000 });
    assert.equal(agents.list()[0].status, 'completed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('queueSteer refuses when the agent is not running', () => {
  const agent = new Agent({
    tools: [], projectDir: process.cwd(), getSettings: () => ({ provider: 'openai', openai: {}, anthropic: {} }),
    emit: () => {}, getMode: () => 'full-access', getToolContext: () => ({ workRoot: process.cwd() }),
    getTodos: () => [], setTodos: () => {}, currentUrl: () => '', fileSize: () => 0,
    getWorkspace: () => ({ id: 'w', root: process.cwd() }), getGoal: () => null,
    mcp: { tools: [], has: () => false },
  });
  assert.equal(agent.queueSteer('too late'), false);
  assert.equal(agent.steers.length, 0);
});
