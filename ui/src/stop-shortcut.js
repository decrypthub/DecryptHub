// Read against DSH stop-shortcut.ts, stop-sequence.ts and shortcuts/client/dom.ts.
// Observe after local controls; a consumed Escape must never arm cancellation.
const OVERLAY = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-composer-overlay]';

export function installStopShortcut(root, readState, cancel) {
  const document = root.ownerDocument, window = document.defaultView;
  let first = null, expiry, pending, composing = false, compositionUntil = 0;
  const reset = () => { first = null; window.clearTimeout(expiry); };
  const modalChanged = records => {
    if (records.some(record => record.type === 'attributes'
      ? ['dialog', 'alertdialog', 'menu', 'listbox', 'true'].includes(record.oldValue) || record.target.matches(OVERLAY)
      : [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches(OVERLAY) || node.querySelector(OVERLAY))))) reset();
  };
  const observer = new window.MutationObserver(modalChanged);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['role', 'aria-modal'] });
  const capture = () => {
    // If a control stops propagation, its key still invalidates the sequence.
    if (pending !== undefined) reset();
    window.clearTimeout(pending);
    modalChanged(observer.takeRecords());
    pending = window.setTimeout(() => { pending = undefined; reset(); }, 0);
  };
  const keydown = event => {
    window.clearTimeout(pending); pending = undefined;
    modalChanged(observer.takeRecords());
    const target = event.composedPath().find(node => node instanceof window.Element);
    const state = readState();
    const region = target?.closest('[data-conversation-region]');
    if (event.code !== 'Escape' || event.repeat || event.defaultPrevented || event.isComposing || event.keyCode === 229
      || composing || window.performance.now() < compositionUntil || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
      || !state?.enabled || !state.sessionId || !state.runId || state.pendingInteraction
      || !target || !region || !root.contains(region) || !root.contains(target)
      || target.closest('.xterm, iframe, [inert], [data-approval-key]') || document.querySelector(OVERLAY)) { reset(); return; }
    event.preventDefault();
    const previous = first, now = window.performance.now();
    reset();
    if (previous && now <= previous.until && previous.sessionId === state.sessionId && previous.runId === state.runId && previous.region === region) {
      cancel(state.sessionId, state.runId);
      return;
    }
    first = { sessionId: state.sessionId, runId: state.runId, region, until: now + 500 };
    expiry = window.setTimeout(reset, 501);
  };
  const compositionStart = () => { composing = true; reset(); };
  const compositionEnd = () => { composing = false; compositionUntil = window.performance.now() + 10; reset(); };
  const blur = () => { composing = false; reset(); };
  document.addEventListener('compositionstart', compositionStart, true);
  document.addEventListener('compositionend', compositionEnd, true);
  document.addEventListener('focusin', reset, true);
  document.addEventListener('pointerdown', reset, true);
  window.addEventListener('blur', blur);
  window.addEventListener('keydown', capture, true);
  window.addEventListener('keydown', keydown);
  return () => {
    reset(); window.clearTimeout(pending); observer.disconnect();
    document.removeEventListener('compositionstart', compositionStart, true);
    document.removeEventListener('compositionend', compositionEnd, true);
    document.removeEventListener('focusin', reset, true);
    document.removeEventListener('pointerdown', reset, true);
    window.removeEventListener('blur', blur);
    window.removeEventListener('keydown', capture, true);
    window.removeEventListener('keydown', keydown);
  };
}
