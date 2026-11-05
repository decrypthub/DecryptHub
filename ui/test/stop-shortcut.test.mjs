import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installStopShortcut } from '../src/stop-shortcut.js';

function fixture(t) {
  const dom = new JSDOM('<main><div id="chat"><div data-conversation-region="chat" tabindex="0"></div><div data-conversation-region="composer"><textarea></textarea><div class="xterm"><input></div></div></div><input id="outside"></main>');
  const { window } = dom, document = window.document, root = document.querySelector('#chat'), editor = root.querySelector('textarea');
  let now = 100;
  Object.defineProperty(window.performance, 'now', { value: () => now });
  const state = { sessionId: 'session-a', runId: 'run-a', enabled: true, pendingInteraction: false }, calls = [];
  const dispose = installStopShortcut(root, () => state, (...args) => calls.push(args));
  t.after(() => { dispose(); window.close(); });
  const key = (options = {}, target = editor) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true, ...options }));
  return { window, document, root, editor, state, calls, dispose, key, advance: ms => { now += ms; } };
}

test('two independent Escapes stop only the addressed live turn within 500ms', t => {
  const f = fixture(t);
  assert.equal(f.key(), false); assert.equal(f.calls.length, 0);
  f.advance(499); f.key(); assert.deepEqual(f.calls, [['session-a', 'run-a']]);
  f.key(); assert.equal(f.calls.length, 1, 'the accepted sequence must be cleared');
});

test('expiry, another key and auto-repeat invalidate the first Escape', t => {
  for (const invalidate of [f => f.advance(501), f => f.key({ key: 'a', code: 'KeyA' }), f => f.key({ repeat: true })]) {
    const f = fixture(t); f.key(); invalidate(f); f.key(); assert.equal(f.calls.length, 0);
    f.key(); assert.equal(f.calls.length, 1);
  }
});

test('modifiers, composition and local consumption cannot arm a stop', t => {
  const f = fixture(t);
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    f.key(); f.key(options); f.key(); assert.equal(f.calls.length, 0);
    // Reset the last eligible press before the next case.
    f.key({ key: 'a', code: 'KeyA' });
  }
  const consumed = event => event.preventDefault();
  f.key(); f.editor.addEventListener('keydown', consumed); f.key(); f.editor.removeEventListener('keydown', consumed);
  f.key(); assert.equal(f.calls.length, 0);
  f.key(); assert.equal(f.calls.length, 1);
});

test('focus, pointer, window blur and composition transitions reset the sequence', t => {
  for (const type of ['focusin', 'pointerdown', 'blur', 'compositionstart', 'compositionend']) {
    const f = fixture(t); f.key();
    (type === 'blur' ? f.window : f.editor).dispatchEvent(new f.window.Event(type, { bubbles: true }));
    if (type === 'compositionstart') f.editor.dispatchEvent(new f.window.Event('compositionend', { bubbles: true }));
    f.advance(11); f.key(); assert.equal(f.calls.length, 0, type);
    f.key(); assert.equal(f.calls.length, 1, type);
  }
});

test('menus and dialogs opening then closing still invalidate the earlier press', t => {
  for (const role of ['menu', 'dialog', 'listbox']) {
    const f = fixture(t); f.key();
    const overlay = f.document.createElement('div'); overlay.setAttribute('role', role); f.document.body.append(overlay);
    f.key(); assert.equal(f.calls.length, 0); overlay.remove();
    f.key(); assert.equal(f.calls.length, 0); f.key(); assert.equal(f.calls.length, 1);
  }
});

test('session, turn, region, pending interaction and terminal boundaries cannot share a sequence', t => {
  for (const change of [f => { f.state.sessionId = 'session-b'; }, f => { f.state.runId = 'run-b'; },
    f => { f.state.pendingInteraction = true; }, f => { f.state.enabled = false; }]) {
    const f = fixture(t); f.key(); change(f); f.key(); assert.equal(f.calls.length, 0);
  }
  const f = fixture(t); f.key(); f.key({}, f.root.querySelector('[data-conversation-region="chat"]')); assert.equal(f.calls.length, 0);
  f.key({}, f.root.querySelector('.xterm input')); f.key(); assert.equal(f.calls.length, 0);
  f.key({}, f.document.querySelector('#outside')); f.key(); assert.equal(f.calls.length, 0);
  f.dispose(); f.key(); f.key(); assert.equal(f.calls.length, 0, 'unmount releases the listener');
});

test('a stopped-propagation key breaks a sequence even before its fallback timer runs', t => {
  const f = fixture(t), consume = event => event.stopPropagation();
  f.key(); f.editor.addEventListener('keydown', consume); f.key(); f.editor.removeEventListener('keydown', consume);
  f.key(); assert.equal(f.calls.length, 0); f.key(); assert.equal(f.calls.length, 1);
});
