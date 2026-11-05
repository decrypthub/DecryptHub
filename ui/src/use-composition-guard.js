import { useCallback, useLayoutEffect, useRef } from 'react';
import { createCompositionGuard } from './composition-guard.js';

export function useCompositionGuard(identity, forwardedRef) {
  const guard = useRef(null), root = useRef(null);
  if (!guard.current) guard.current = createCompositionGuard();
  const ref = useCallback(node => {
    const previous = root.current, state = guard.current;
    if (previous) {
      previous.removeEventListener('compositionstart', state.start);
      previous.removeEventListener('compositionend', state.end);
      previous.removeEventListener('blur', state.reset);
    }
    state.reset(); root.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
    if (node) {
      node.addEventListener('compositionstart', state.start);
      node.addEventListener('compositionend', state.end);
      node.addEventListener('blur', state.reset);
    }
  }, [forwardedRef]);
  useLayoutEffect(() => { guard.current.reset(); return () => guard.current.reset(); }, [identity]);
  return { ref, isComposing: guard.current.isComposing };
}
