import test from 'node:test';
import assert from 'node:assert/strict';
import { readSidebarOpen, saveSidebarOpen } from '../../ui/src/sidebar-state.js';

test('the sidebar opens by default and preserves explicit legacy choices', () => {
  for (const [stored, expected] of [[null, true], ['open', true], ['closed', false], ['unknown', true]]) {
    assert.equal(readSidebarOpen({ getItem: key => { assert.equal(key, 'wdh_rail'); return stored; } }), expected);
  }
});

test('sidebar choices survive reload without requiring available storage', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveSidebarOpen(storage, false); assert.equal(readSidebarOpen(storage), false);
  saveSidebarOpen(storage, true); assert.equal(readSidebarOpen(storage), true);
  const unavailable = { getItem() { throw Error('Unavailable'); }, setItem() { throw Error('Unavailable'); } };
  assert.equal(readSidebarOpen(unavailable), true); assert.doesNotThrow(() => saveSidebarOpen(unavailable, false));
});
