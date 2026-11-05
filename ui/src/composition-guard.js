// DSH keymap.ts: native IME state, legacy 229, and Safari's late closing keydown.
export function createCompositionGuard(now = Date.now) {
  let composing = false, until = 0;
  return {
    start() { composing = true; until = 0; },
    end() { composing = false; until = now() + 10; },
    reset() { composing = false; until = 0; },
    isComposing(event) {
      const native = event?.nativeEvent || event;
      return composing || !!native?.isComposing || native?.keyCode === 229 || now() < until;
    },
  };
}

export function isSubmitEnter(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey
    && !event.getModifierState?.('AltGraph') && !(event.ctrlKey && event.metaKey) && !event.repeat;
}
