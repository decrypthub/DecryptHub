import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSurface } from '../../ui/src/browser-surface.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
test('hiding during an in-flight show is applied last', async () => {
  const wait = deferred(), events = [];
  const surface = new BrowserSurface({ show: async () => { events.push('start'); await wait.promise; events.push('shown'); }, hide: async () => events.push('hidden') });
  const shown = surface.show({ sessionId: 'a' }); await Promise.resolve(); const hidden = surface.hide(); wait.resolve();
  assert.equal((await shown).state, 'superseded'); assert.equal((await hidden).state, 'hidden'); assert.deepEqual(events, ['start', 'shown', 'hidden']);
});
test('rapid switches coalesce stale work and keep native mutations serial', async () => {
  const wait = deferred(), seen = []; let active = 0, peak = 0;
  const surface = new BrowserSurface({ show: async value => { peak = Math.max(peak, ++active); seen.push(value.sessionId); if (value.sessionId === 'a') await wait.promise; active--; } });
  const a = surface.show({ sessionId: 'a' }); await Promise.resolve(); const b = surface.show({ sessionId: 'b' }), c = surface.show({ sessionId: 'c' }); wait.resolve();
  await a; assert.equal((await b).state, 'superseded'); assert.equal((await c).state, 'visible'); assert.deepEqual(seen, ['a', 'c']); assert.equal(peak, 1);
});
test('failed attach cannot poison hide/release and stale failures cannot trigger fallback', async () => {
  const wait = deferred(), events = [], surface = new BrowserSurface({ show: async () => wait.promise, hide: async () => events.push('hide'), release: async id => events.push('release ' + id) });
  const shown = surface.show({ sessionId: 'a' }); await Promise.resolve(); const hidden = surface.hide(); wait.reject(Error('old attach'));
  assert.equal((await shown).state, 'superseded'); await hidden; await surface.release('a'); assert.deepEqual(events, ['hide', 'release a']);
  await assert.rejects(surface.show({ sessionId: 'b' }), /old attach/); await surface.hide(); assert.equal(events.at(-1), 'hide');
});
