import test from 'node:test';
import assert from 'node:assert/strict';
import { processPresentation } from '../../ui/src/process-presentation.js';

test('every turn folds into one summary line; completed turns start closed', () => {
  const tool = { type: 'tool', result: 'output'.repeat(10000) };
  const turn = { process: [{ type: 'assistant', content: '检查一下文件。' }, tool], tools: [tool], status: 'completed' };
  assert.deepEqual(processPresentation(turn), { foldable: true, defaultOpen: false });
  assert.equal(turn.process[1], tool);
});
test('short reasoning folds too instead of pushing tools into the transcript', () => {
  assert.deepEqual(processPresentation({ process: [{ type: 'reasoning', content: '简短思考' }], status: 'completed' }), { foldable: true, defaultOpen: false });
  assert.equal(processPresentation({ process: [], status: 'completed' }).foldable, true);
});
test('live and interrupted/failed long tasks keep their evidence open by default', () => {
  const turn = { tools: Array(10).fill({ type: 'tool' }) };
  for (const status of ['failed', 'cancelled', 'stopped', 'needs_attention', 'waiting_user', 'waiting_approval']) assert.equal(processPresentation({ ...turn, status }).defaultOpen, true);
  assert.equal(processPresentation({ ...turn, active: true, status: 'running' }).defaultOpen, true);
});
