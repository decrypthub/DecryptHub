import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../agent.mjs';

test('a hung tool returns a timeout result instead of stalling the run', async () => {
  const hanging = { name: 'slow_tool', description: 'test fixture', group: 'core', timeoutMs: 80, schema: { type: 'object', properties: {}, additionalProperties: false }, run: () => new Promise(() => {}) };
  const agent = new Agent({
    tools: [hanging], projectDir: process.cwd(), getSettings: () => ({ provider: 'openai', openai: {}, anthropic: {} }),
    emit: () => {}, getMode: () => 'full-access', getToolContext: () => ({ workRoot: process.cwd() }),
    getTodos: () => [], setTodos: () => {}, currentUrl: () => '', fileSize: () => 0,
    getWorkspace: () => ({ id: 'w', root: process.cwd() }), getGoal: () => null,
    mcp: { tools: [], has: () => false },
  });
  const started = Date.now();
  const result = await agent.runTool('slow_tool', {});
  assert.equal(result.isError, true);
  assert.match(result.text, /超时/);
  assert.ok(Date.now() - started < 3000);
  assert.equal(agent.callSignal, null);
});
