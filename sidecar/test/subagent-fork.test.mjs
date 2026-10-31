import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchAgents } from '../subagents.mjs';

function make(dir, overrides = {}) {
  return new ResearchAgents({
    directory: dir,
    context: () => ({ workspaceId: 'w', workRoot: dir, projectRoots: [], workspaceKind: 'folder', protectedRoot: dir, runId: 'r', goalBudget: null }),
    settings: () => ({ provider: 'openai', openai: { apiKey: 'fixture' }, anthropic: {}, maxTokens: 4096, subagentMaxActive: 3, ...overrides }),
    createAgent: overrides.createAgent,
  });
}

test('fork mode seeds the child history with parent turns', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fork-'));
  let prompt = '';
  const agent = { hist: { events: [] }, interrupt() {}, queueSteer() { return true; }, send: async text => { prompt = text; return { stop: 'completed', usage: {} }; } };
  const agents = make(dir, { createAgent: () => agent });
  try {
    const seed = [{ t: 'user', content: 'PARENT_QUESTION' }, { t: 'assistant', content: 'PARENT_ANSWER' }];
    agents.spawn('FORK_TASK', { forkEvents: seed });
    await agents.wait(agents.list()[0].id, { waitMs: 1000 });
    assert.match(prompt, /fork/);
    assert.match(prompt, /FORK_TASK/);
    assert.deepEqual(agent.hist.events.slice(0, 2).map(e => e.content), ['PARENT_QUESTION', 'PARENT_ANSWER']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('concurrency limit follows the setting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-limit-'));
  let release;
  const agent = { hist: { events: [] }, interrupt() {}, queueSteer() { return true; }, send: async () => { await new Promise(r => { release = r; }); return { stop: 'completed', usage: {} }; } };
  const agents = make(dir, { subagentMaxActive: 1, createAgent: () => agent });
  try {
    agents.spawn('FIRST');
    assert.throws(() => agents.spawn('SECOND'), /最多同时运行 1 个/);
    release();
    await new Promise(r => setTimeout(r, 20));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
