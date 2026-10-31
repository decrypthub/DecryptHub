import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ResearchAgents } from '../subagents.mjs';

test('subagents receive the bounded parent context and the task', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-subctx-'));
  const prompts = [];
  const agents = new ResearchAgents({
    directory: dir,
    context: () => ({ workspaceId: 'w', workRoot: dir, projectRoots: [], workspaceKind: 'folder', protectedRoot: dir, runId: 'r', goalBudget: null }),
    settings: () => ({ provider: 'openai', openai: { apiKey: 'fixture' }, anthropic: {}, maxTokens: 4096 }),
    createAgent: () => ({ hist: { events: [] }, interrupt() {}, send: async text => { prompts.push(text); return { stop: 'completed', usage: {} }; } }),
  });
  try {
    const { id } = agents.spawn('TASK_MARKER', { context: 'CTX_MARKER' });
    await agents.wait(id, { waitMs: 1000 });
    assert.match(prompts[0], /CTX_MARKER/);
    assert.match(prompts[0], /TASK_MARKER/);
    assert.match(prompts[0], /父代理提供的上下文/);
    // 已结束的子代理可以继续追加要求，复用同一份只读上下文。
    agents.message(id, 'MORE_MARKER');
    await agents.wait(id, { waitMs: 1000 });
    assert.match(prompts[1], /MORE_MARKER/);
    assert.equal(agents.list()[0].turns, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
