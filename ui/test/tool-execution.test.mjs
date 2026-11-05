import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalResult, toolState, toolErrorSummary } from '../src/tool-execution.js';
import { conversationTurns, historyEvents, toolPresentation } from '../src/conversation.js';
import { sessionReducer } from '../src/state.js';

test('command summaries retain PowerShell commands and terminal identities', () => {
  assert.deepEqual(toolPresentation({ name: 'pwsh', args: { command: 'Write-Output READY' } }), { title: '运行 PowerShell', detail: 'Write-Output READY' });
  assert.deepEqual(toolPresentation({ name: 'terminal_read', args: { sessionId: 'owned-terminal' } }), { title: '读取终端输出', detail: 'owned-terminal' });
});

test('an explicit failing exit remains visible even when the tool call itself succeeded', () => {
  const event = { name: 'pwsh', args: { command: 'cmd /c exit 7' }, result: 'diagnostic\n[exit code: 7]', isError: false };
  assert.equal(toolState(event), 'err');
  assert.equal(terminalResult(event).label, '退出码 7');
  assert.equal(terminalResult({ name: 'workspace_shell', isError: true, result: 'job fixture exit 3 pid=123 time=1s out=5B\nerror' }).label, '退出码 3');
  assert.equal(terminalResult({ ...event, result: 'plain persistent-shell receipt' }), null);
});

test('terminal quietness and wait timeout never claim command completion or a zero exit', () => {
  for (const waitReason of ['inferred_idle', 'timeout', 'stdin_read']) {
    const event = { name: 'terminal_send', args: { text: 'long-running' }, result: JSON.stringify({ kind: 'foreground', viewport: 'partial output', waitReason, sessionStatus: { kind: 'running' } }) };
    const result = terminalResult(event);
    assert.equal(result.output, 'partial output'); assert.equal(result.failed, false);
    assert.match(result.label, waitReason === 'stdin_read' ? /等待终端输入/ : /未确认结束/);
    assert.doesNotMatch(result.label, /成功|退出码 0|已完成/);
  }
});

test('background launches, unknown exit codes and malformed receipts retain their distinct meanings', () => {
  const event = { name: 'terminal_send', args: { text: 'work' } };
  assert.equal(toolState(event), 'run');
  const background = terminalResult({ ...event, result: JSON.stringify({ kind: 'background', jobId: 'job-owned' }) });
  assert.equal(background.label, '已转入后台'); assert.match(background.output, /job-owned/);
  const exited = terminalResult({ ...event, result: JSON.stringify({ kind: 'foreground', viewport: '', sessionStatus: { kind: 'exited', exitCode: null } }) });
  assert.equal(exited.failed, true); assert.match(exited.label, /未知/);
  for (const result of ['not-json', 'null', '{}', '{"kind":"foreground","viewport":12}', '{"kind":"foreground","viewport":"","sessionStatus":{"kind":"exited"}}'])
    assert.equal(terminalResult({ ...event, result }), null);
  assert.equal(toolState({ ...event, cancelled: true }), 'cancelled');
});

test('live and restored command failures derive identical presentation without rewriting history', () => {
  const call = { id: 'call', itemId: 'item', name: 'pwsh', args: { command: 'cmd /c exit 7' } };
  const history = [{ t: 'user', turnId: 'turn', content: 'run' }, { t: 'assistant', turnId: 'turn', calls: [call] },
    { t: 'tool', turnId: 'turn', ...call, content: '[exit code: 7]', isError: false }, { t: 'turn-end', turnId: 'turn', stop: 'completed' }];
  history[2].content = 'failure\n' + history[2].content;
  const original = JSON.stringify(history);
  const restored = conversationTurns(historyEvents(history));
  const live = conversationTurns([{ type: 'user', turnId: 'turn', content: 'run' }, { type: 'tool', turnId: 'turn', ...call, result: history[2].content, isError: false }]);
  assert.equal(restored[0].failures, 1); assert.equal(live[0].failures, 1);
  assert.equal(toolState(restored[0].tools[0]), toolState(live[0].tools[0]));
  assert.equal(JSON.stringify(history), original);
});

test('user cancellation remains stopped through live updates and history restoration', () => {
  const call = { type: 'tool', id: 'call', itemId: 'item', turnId: 'turn', name: 'pwsh', args: { command: 'wait' } };
  let state = sessionReducer({}, { t: 'ev', sid: 'chat', v: call });
  state = sessionReducer(state, { t: 'tool-end', sid: 'chat', v: { id: 'call', itemId: 'item', text: 'aborted', isError: true, cancelled: true } });
  const live = state.chat.events[0];
  const restored = historyEvents([{ t: 'assistant', turnId: 'turn', calls: [call] },
    { t: 'tool', id: 'call', itemId: 'item', turnId: 'turn', content: 'aborted', isError: true, cancelled: true }])[1];
  assert.equal(toolState(live), 'cancelled'); assert.equal(toolState(restored), 'cancelled');
  assert.equal(conversationTurns([live])[0].failures, 0);
  assert.equal(conversationTurns([restored])[0].failures, 0);
});

test('generic error summaries expose the first reason while cancellation and explicit exits keep their own cues', () => {
  const event = { name: 'workspace_read', args: { path: 'missing.txt' }, result: '文件不存在\n详细诊断', isError: true };
  assert.equal(toolErrorSummary(event), '文件不存在');
  assert.equal(event.result, '文件不存在\n详细诊断');
  assert.equal(toolErrorSummary({ ...event, cancelled: true }), null);
  assert.equal(toolErrorSummary({ ...event, name: 'pwsh', result: 'diagnostic\n[exit code: 7]' }), null);
  assert.equal(toolErrorSummary({ ...event, isError: false }), null);
});
