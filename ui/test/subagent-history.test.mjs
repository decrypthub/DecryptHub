import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSubagentWindow } from '../src/subagent-history.js';
const page = (startSeq, endSeq, status, totalEvents = endSeq) => ({ startSeq, endSeq, hasEarlier: startSeq > 0, totalEvents, agent: { status }, events: Array.from({ length: endSeq - startSeq }, (_, index) => startSeq + index) });
test('an older page cannot roll back status or discard newer events that arrived while loading', () => {
  const live = page(20, 45, 'running'), older = page(0, 20, 'completed', 40);
  const next = mergeSubagentWindow(live, older);
  assert.equal(next.agent.status, 'running'); assert.equal(next.endSeq, 45); assert.equal(next.totalEvents, 45);
  assert.deepEqual(next.events, Array.from({ length: 45 }, (_, index) => index));
});
test('a fresh tail retains previously loaded history and replaces the overlapping live window', () => {
  const before = page(0, 40, 'running'), tail = page(25, 50, 'completed');
  const next = mergeSubagentWindow(before, tail);
  assert.equal(next.agent.status, 'completed'); assert.equal(next.startSeq, 0); assert.equal(next.hasEarlier, false);
  assert.deepEqual(next.events, Array.from({ length: 50 }, (_, index) => index));
});
