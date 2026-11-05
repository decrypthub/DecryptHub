import test from 'node:test';
import assert from 'node:assert/strict';
import { submitMode } from '../src/submission-policy.js';
import { conversationTurns } from '../src/conversation.js';

test('Enter and its accelerated chord choose opposite delivery only while busy', () => {
  assert.equal(submitMode('queue', true), 'queue');
  assert.equal(submitMode('queue', true, true), 'steer');
  assert.equal(submitMode('steer', true), 'steer');
  assert.equal(submitMode('steer', true, true), 'queue');
  assert.equal(submitMode('steer', false, true), 'queue');
});
test('steering in the same turn preserves the initial user bubble and ordered work', () => {
  const [turn] = conversationTurns([
    { type: 'user', turnId: 'r', id: 'u1', content: 'original' },
    { type: 'assistant', turnId: 'r', id: 'a1', content: 'working', phase: 'commentary' },
    { type: 'user', turnId: 'r', id: 'u2', content: 'correction' },
    { type: 'assistant', turnId: 'r', id: 'a2', content: 'answer', phase: 'final_answer' },
    { type: 'turn-end', turnId: 'r', endedAt: 1, stop: 'completed' },
  ]);
  assert.equal(turn.user.id, 'u1');
  assert.deepEqual(turn.process.map(event => event.id), ['a1', 'u2']);
  assert.equal(turn.answers[0].id, 'a2');
});
