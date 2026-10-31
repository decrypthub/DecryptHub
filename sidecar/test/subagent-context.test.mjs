import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchAgents } from '../subagents.mjs';

test('subagents receive the bounded parent context and the task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-subctx-'));
  let prompt = '';
  const agents = new ResearchAgents({
    directory: dir,
    context: () => ({ workspaceId: 'w', workRoot: dir, projectRoots: [], workspaceKind: 'folder', protectedRoot: dir, runId: 'r', goalBudget: null }),
    settings: () => ({ provider: 'openai', openai: { apiKey: 'fixture' }, anthropic: {}, maxTokens: 4096 }),
    createAgent: () => ({ hist: { events: [] }, interrupt() {}, send: async text => { prompt = text; return { stop: 'completed', usage: {} }; } }),
  });
  try {
    const { id } = agents.spawn('TASK_MARKER', { context: 'CTX_MARKER' });
    await agents.wait(id, { waitMs: 1000 });
    assert.match(prompt, /CTX_MARKER/);
    assert.match(prompt, /TASK_MARKER/);
    assert.match(prompt, /父代理提供的上下文/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
