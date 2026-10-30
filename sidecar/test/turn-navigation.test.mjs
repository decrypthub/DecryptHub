import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTurns } from '../../ui/src/conversation.js';
import { TURN_PITCH, railWindow, turnPreview, visibleTurnIndex } from '../../ui/src/turn-navigation.js';

test('turn identity survives prepending history and subagents only follow their parent run', () => {
  const events = [{ type: 'user', id: 'u1', content: 'same' }, { type: 'user', id: 'u2', turnId: 'run-2', content: 'same' }];
  const agents = [{ id: 'a', parentRunId: 'run-2' }, { id: 'b', parentRunId: 'absent' }, { id: 'c', parentRunId: null }];
  const old = conversationTurns(events, null, false, agents);
  const fresh = conversationTurns([{ type: 'note', content: 'older' }, ...events], null, false, agents);
  assert.deepEqual(fresh.slice(1).map(t => t.id), old.map(t => t.id));
  assert.deepEqual(old.map(t => t.subagents.map(a => a.id)), [[], ['a']]);
  assert.deepEqual(events[0], { type: 'user', id: 'u1', content: 'same' });
});

test('rail tracks the visible turn and the final short turn at the scroll boundary', () => {
  const offsets = [20, 500, 1800, 2000];
  assert.equal(visibleTurnIndex([], 0, 600, 3000), -1);
  assert.equal(visibleTurnIndex(offsets, 0, 600, 3000), 0);
  assert.equal(visibleTurnIndex(offsets, 490, 600, 3000), 1);
  assert.equal(visibleTurnIndex(offsets, 1740, 600, 3000), 2);
  assert.equal(visibleTurnIndex(offsets, 2400, 600, 3000), 3);
});

test('thousand-turn rail keeps a fixed pitch and a bounded render window', () => {
  assert.equal(TURN_PITCH, 12);
  for (const top of [0, 400, 8000, 11580]) {
    const { start, end } = railWindow(1000, top, 420);
    assert.ok(start >= 0 && end <= 1000 && end - start <= 44);
    assert.ok(start <= Math.floor(top / TURN_PITCH));
  }
});

test('previews distinguish attachment-only, in-progress and completed turns without exposing tool payloads', () => {
  const turn = { user: { attachments: [{}] }, answers: [], active: true, process: [{ args: { private: 'secret' } }] };
  assert.deepEqual(turnPreview(turn), { input: '附件消息', output: '正在回复…' });
  const preview = turnPreview({ ...turn, user: { content: 'a\n b'.repeat(100) }, active: false, answers: [{ content: 'final\n'.repeat(200) }] });
  assert.equal(preview.input.length, 240); assert.equal(preview.output.length, 360);
  assert.ok(!preview.input.includes('\n') && !preview.output.includes('secret'));
});
