import test from 'node:test';
import assert from 'node:assert/strict';
import { historyEvents, conversationTurns, toolPresentation } from '../../ui/src/conversation.js';
import { sessionReducer, blankSession } from '../../ui/src/state.js';
import { autoReview } from '../policy.mjs';

test('turn presentation keeps progress text interleaved with tools inside the folded process', () => {
  const history = [{ t: 'user', id: 'u', turnId: 'r', content: 'wire text', displayContent: '修改代码', at: 1000 },
    { t: 'assistant', turnId: 'r', phase: 'commentary', content: '读取文件', calls: [{ id: 'call0', itemId: 'i1', name: 'workspace_read', args: { path: 'a.js' } }] },
    { t: 'tool', turnId: 'r', id: 'call0', itemId: 'i1', content: 'first' },
    { t: 'assistant', turnId: 'r', phase: 'commentary', content: '修改文件', calls: [{ id: 'call0', itemId: 'i2', name: 'workspace_edit', args: { path: 'a.js' } }] },
    { t: 'tool', turnId: 'r', id: 'call0', itemId: 'i2', content: 'second', isError: true },
    { t: 'assistant', turnId: 'r', phase: 'final_answer', content: '最终回复' }, { t: 'turn-end', turnId: 'r', stop: 'completed', endedAt: 3000 }];
  const turns = conversationTurns(historyEvents(history));
  assert.equal(turns.length, 1); assert.equal(turns[0].user.content, '修改代码');
  assert.deepEqual(turns[0].tools.map(t => t.result), ['first', 'second']);
  assert.equal(turns[0].process.length, 4); assert.equal(turns[0].failures, 1);
  assert.deepEqual(turns[0].process.map(e => e.type), ['assistant', 'tool', 'assistant', 'tool']);
  assert.deepEqual(turns[0].answers.map(a => a.content), ['最终回复']);
  assert.equal(toolPresentation(turns[0].tools[0]).detail, 'a.js');
});
test('stream updates address a specific message instead of the latest assistant', () => {
  let state = { s: blankSession() };
  for (const id of ['old', 'new']) state = sessionReducer(state, { sid: 's', t: 'assistant-start', v: { id, turnId: id } });
  state = sessionReducer(state, { sid: 's', t: 'delta', v: { id: 'old', text: 'older stream' } });
  assert.equal(state.s.events[0].content, 'older stream'); assert.equal(state.s.events[1].content, '');
  state = sessionReducer(state, { sid: 's', t: 'assistant-end', v: { id: 'old', content: 'canonical text', phase: 'commentary' } });
  assert.equal(state.s.events[0].content, 'canonical text'); assert.equal(state.s.events[0].phase, 'commentary');
});
test('legacy history keeps its tools grouped and internal notes out of user bubbles', () => {
  const events = historyEvents([{ t: 'user', content: 'hello\n\n【当前状态】internal' }, { t: 'assistant', calls: [{ id: 'a', name: 'workspace_list' }] }, { t: 'tool', id: 'a', content: 'files' }, { t: 'user', content: '【系统】预算到达' }, { t: 'assistant', content: 'answer' }]);
  const turns = conversationTurns(events); assert.equal(turns.length, 1); assert.equal(turns[0].user.content, 'hello'); assert.equal(turns[0].answers.length, 1); assert.equal(turns[0].tools.length, 1);
});
test('recovery preserves partial answers and never displays missing results as running forever', () => {
  const events = historyEvents([{ t: 'user', turnId: 'r', content: 'task' }, { t: 'assistant', turnId: 'r', phase: 'commentary', calls: [{ id: 'a', itemId: 'i', name: 'workspace_shell' }] }, { t: 'assistant', id: 'partial', turnId: 'r', phase: 'partial_answer', content: 'saved partial' }, { t: 'turn-end', turnId: 'r', stop: 'interrupted' }]);
  const turn = conversationTurns(events)[0]; assert.equal(turn.status, 'cancelled'); assert.equal(turn.answers[0].content, 'saved partial'); assert.equal(turn.tools[0].cancelled, true);
  assert.equal(historyEvents([], 'stream', { id: 'p', turnId: 'r' })[0].id, 'p');
});
test('automatic review accepts only the trusted isolated npm path', () => {
  const safe = { isolated: true, trustedPurpose: 'dependency-install', network: ['registry.npmjs.org'] };
  assert.equal(autoReview(safe).allow, true);
  for (const request of [{ ...safe, isolated: false }, { ...safe, trustedPurpose: 'shell' }, { ...safe, network: ['other.example'] }, { name: 'external__delete', args: safe }]) assert.equal(autoReview(request).allow, false);
});
