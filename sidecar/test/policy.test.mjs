import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTool, toolRisk, normalizeMode, MODES, CLASSIFIED } from '../policy.mjs';
import { DEFAULT_TOOLS as LOCAL_TOOLS } from '../catalog.mjs';

test('legacy danger cannot become an implicit host privilege grant', () => {
  assert.deepEqual(MODES, ['read-only', 'standard', 'full-access']);
  for (const mode of ['safe', 'plan', 'danger', 'autonomous', undefined, 'unknown']) assert.equal(normalizeMode(mode), 'standard');
  assert.equal(normalizeMode('read-only'), 'read-only'); assert.equal(normalizeMode('full-access'), 'full-access');
});
test('read-only prevents writes, arbitrary execution and unknown remote effects', () => {
  for (const name of ['workspace_write', 'workspace_edit', 'workspace_shell', 'workspace_run', 'workspace_npm', 'export_code', 'ast_deobfuscate', 'env_iterate', 'remote__delete', 'reset_session']) assert.equal(decideTool('read-only', name, { confirm: true }).action, 'deny', name);
  for (const name of ['workspace_list', 'workspace_read', 'workspace_grep', 'todo_write', 'compact_context', 'ask_user']) assert.equal(decideTool('read-only', name).action, 'run', name);
});
test('all code execution, including self-tests and npm init, needs an execution decision', () => {
  for (const name of ['workspace_shell', 'workspace_run', 'workspace_npm', 'run_node', 'export_code', 'ast_deobfuscate', 'deobfuscate_code', 'env_iterate']) {
    assert.equal(toolRisk(name), 'exec', name);
    assert.equal(decideTool('standard', name, { confirm: true, command: 'init' }, { allows: ['shell', 'npm'] }).action, 'approve', name);
    assert.equal(decideTool('standard', name, {}, { runtimeManaged: true }).action, 'run', name + ' is gated by the actual Executor');
  }
});
test('full access is a standing grant for commands, browser interaction and enabled MCP tools', () => {
  assert.equal(decideTool('standard', 'external__unknown').action, 'approve');
  for (const name of ['external__unknown', 'browser_click', 'browser_fill', 'browser_press', 'evaluate_script', 'page_call', 'get_cookies', 'reset_session', 'workspace_shell']) assert.equal(decideTool('full-access', name).action, 'run', name);
  assert.equal(decideTool('full-access', 'evaluate_script').injectConfirm, true);
  assert.equal(decideTool('standard', 'workspace_write', {}, { existsBytes: 100000 }).action, 'run');
  assert.equal(decideTool('full-access', 'workspace_shell').action, 'run');
});
test('confirm is never authorization and owned-job cleanup is available', () => {
  assert.equal(decideTool('standard', 'reset_session', { confirm: true }).action, 'approve');
  assert.equal(decideTool('read-only', 'workspace_job_kill', { id: 'x' }).action, 'run');
});
test('every local tool has an explicit classification', () => {
  assert.deepEqual(LOCAL_TOOLS.filter(t => !CLASSIFIED.has(t.name)).map(t => t.name), []);
});
