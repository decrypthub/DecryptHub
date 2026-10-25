// Shared titlebar hit testing. Interactive descendants keep their own clicks.
const INTERACTIVE = 'button,a,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[contenteditable="true"],[data-no-drag]';
export function handleWindowDrag(event, bridge) {
  if (event.defaultPrevented || event.button !== 0 || event.target?.closest?.(INTERACTIVE)) return;
  event.preventDefault();
  if (event.detail === 2) return bridge.toggleMaximize();
  return bridge.startDragging();
}
