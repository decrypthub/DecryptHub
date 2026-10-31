import test from 'node:test';
import assert from 'node:assert/strict';
import { toolTimeoutMs } from '../agent.mjs';

test('script and command budgets follow timeoutMs and the documented caps', () => {
  assert.equal(toolTimeoutMs('workspace_run', {}), 75000);
  assert.equal(toolTimeoutMs('workspace_run', { timeoutMs: 120000 }), 135000);
  assert.equal(toolTimeoutMs('workspace_run', { timeoutMs: 999999 }), 315000);
  assert.equal(toolTimeoutMs('workspace_shell', {}), 75000);
  assert.equal(toolTimeoutMs('workspace_shell', { timeoutMs: 600000 }), 315000);
  assert.equal(toolTimeoutMs('workspace_shell', { background: true }), 30000);
  assert.equal(toolTimeoutMs('workspace_npm', {}), 195000);
});

test('read-only, browser and interactive tools have bounded defaults; ask_user is exempt', () => {
  assert.equal(toolTimeoutMs('workspace_read', {}), 60000);
  assert.equal(toolTimeoutMs('browser_open', {}), 120000);
  assert.equal(toolTimeoutMs('browser_click', {}), 90000);
  assert.equal(toolTimeoutMs('ask_user', {}), 0);
  assert.equal(toolTimeoutMs('custom_tool', {}), 90000);
});
