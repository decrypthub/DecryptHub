import test from 'node:test';
import assert from 'node:assert/strict';
import { profilePrompt } from '../profile.mjs';

test('no onboarding means no added prompt', () => {
  assert.equal(profilePrompt({}), '');
  assert.equal(profilePrompt(null), '');
});

test('profile prompt carries domains, level and depth guidance', () => {
  const text = profilePrompt({ onboarding: { domains: ['web', 'android'], level: 'novice' } });
  assert.match(text, /Web 安全/);
  assert.match(text, /Android 逆向/);
  assert.match(text, /小白/);
  assert.match(text, /基础概念/);
  assert.doesNotMatch(text, /iOS/);
});

test('unknown ids are ignored instead of producing empty labels', () => {
  assert.equal(profilePrompt({ onboarding: { domains: ['unknown'], level: 'novice' } }), '');
  assert.equal(profilePrompt({ onboarding: { domains: ['web'], level: 'unknown' } }), '');
});
