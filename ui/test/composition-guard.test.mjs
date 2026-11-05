import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionGuard, isSubmitEnter } from '../src/composition-guard.js';

test('IME candidate confirmation stays in the editor during native composition and legacy 229', () => {
  const guard = createCompositionGuard(() => 100);
  assert.equal(guard.isComposing({ nativeEvent: { isComposing: true } }), true);
  assert.equal(guard.isComposing({ key: 'Enter', keyCode: 229, isComposing: false }), true);
  guard.start();
  assert.equal(guard.isComposing({ key: 'Enter', isComposing: false }), true);
});

test('Safari compositionend followed by a non-composing Enter cannot submit; the next gesture can', () => {
  let clock = 100;
  const guard = createCompositionGuard(() => clock), event = { nativeEvent: { key: 'Enter', isComposing: false, keyCode: 13 } };
  guard.start(); guard.end();
  assert.equal(guard.isComposing(event), true);
  clock = 109; assert.equal(guard.isComposing(event), true);
  clock = 110; assert.equal(guard.isComposing(event), false);
  guard.start(); guard.reset(); assert.equal(guard.isComposing(event), false);
});

test('Enter submission accepts plain and accelerated gestures while preserving line breaks and modifier chords', () => {
  assert.equal(isSubmitEnter({ key: 'Enter' }), true);
  assert.equal(isSubmitEnter({ key: 'Enter', metaKey: true }), true);
  assert.equal(isSubmitEnter({ key: 'Enter', ctrlKey: true }), true);
  for (const flags of [{ shiftKey: true }, { altKey: true }, { repeat: true }, { ctrlKey: true, metaKey: true }, { getModifierState: key => key === 'AltGraph' }]) assert.equal(isSubmitEnter({ key: 'Enter', ...flags }), false);
});
