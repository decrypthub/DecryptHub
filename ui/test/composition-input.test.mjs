import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, createRef } from 'react';
import { JSDOM } from 'jsdom';
import { useCompositionGuard } from '../src/use-composition-guard.js';
import { isSubmitEnter } from '../src/composition-guard.js';

test('actual React key handling ignores IME confirmation through rerenders, then allows a separate Enter', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const originalNow = Date.now;
  let now = 100, sent = 0;
  Date.now = () => now;
  const { createRoot } = await import('react-dom/client');
  const forwarded = createRef(), root = createRoot(document.getElementById('root'));
  function Input({ identity, rerender }) {
    const composition = useCompositionGuard(identity, forwarded);
    return React.createElement('textarea', { ref: composition.ref, 'data-revision': rerender, onKeyDown: event => {
      if (!composition.isComposing(event) && isSubmitEnter(event)) sent++;
    } });
  }
  const key = extra => forwarded.current.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...extra }));
  try {
    await act(async () => root.render(React.createElement(Input, { identity: 'first', rerender: 0 })));
    const input = forwarded.current;
    input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    await act(async () => root.render(React.createElement(Input, { identity: 'first', rerender: 1 })));
    key({ isComposing: false }); assert.equal(sent, 0, 'a normal rerender must not drop native composition tracking');
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
    key({ isComposing: false }); assert.equal(sent, 0, 'Safari closing Enter follows compositionend');
    now = 111;
    key({ keyCode: 229 }); assert.equal(sent, 0, 'legacy IME events stay inside the editor');
    key({}); assert.equal(sent, 1, 'a separate normal Enter submits');
    input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    await act(async () => root.render(React.createElement(Input, { identity: 'second', rerender: 2 })));
    key({}); assert.equal(sent, 2, 'a different conversation starts with clean input state');
    await act(async () => root.unmount());
    assert.equal(forwarded.current, null);
  } finally {
    Date.now = originalNow;
    dom.window.close();
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
