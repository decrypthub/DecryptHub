// Presentation belongs to a chat, independently of its Agent or browser process.
export const SESSION_VIEW_KEY = 'decrypthub-session-views-v1';
export const DEFAULT_PANEL_LAYOUT = Object.freeze([56, 44]);
export const DEFAULT_SESSION_VIEW = Object.freeze({ side: 'browser', sideOpen: false, manuallyClosed: false, layout: DEFAULT_PANEL_LAYOUT });
const validId = id => /^(?:main|s(?:[a-f0-9]{6}|[a-f0-9]{32}))$/.test(id || '');
const sides = new Set(['browser', 'evidence', 'code']);
const normalize = (value, previous = DEFAULT_SESSION_VIEW) => ({
  side: sides.has(value?.side) ? value.side : previous.side,
  sideOpen: typeof value?.sideOpen === 'boolean' ? value.sideOpen : previous.sideOpen,
  manuallyClosed: typeof value?.manuallyClosed === 'boolean' ? value.manuallyClosed : previous.manuallyClosed,
  layout: Array.isArray(value?.layout) && value.layout.length === 2 && value.layout.every(n => Number.isFinite(n) && n > 0 && n < 100) && Math.abs(value.layout[0] + value.layout[1] - 100) < .1 ? [...value.layout] : previous.layout,
});
export function readSessionViews(storage) {
  try {
    const data = JSON.parse(storage.getItem(SESSION_VIEW_KEY));
    if (data?.version === 1 && data.sessions && typeof data.sessions === 'object')
      return { views: Object.fromEntries(Object.entries(data.sessions).filter(([id]) => validId(id)).slice(-200).map(([id, value]) => [id, normalize(value)])), fallback: DEFAULT_SESSION_VIEW };
    return { views: {}, fallback: { ...DEFAULT_SESSION_VIEW, sideOpen: storage.getItem('wdh_side') === 'open' } };
  } catch { return { views: {}, fallback: DEFAULT_SESSION_VIEW }; }
}
export function sessionView(views, id, fallback = DEFAULT_SESSION_VIEW) { return views[id] || fallback; }
export function updateSessionView(views, id, update, fallback = DEFAULT_SESSION_VIEW) {
  if (!validId(id)) return views;
  const previous = sessionView(views, id, fallback);
  const next = normalize(typeof update === 'function' ? update(previous) : update, previous);
  if (views[id] && next.side === previous.side && next.sideOpen === previous.sideOpen && next.manuallyClosed === previous.manuallyClosed && next.layout.every((n, i) => n === previous.layout[i])) return views;
  return Object.fromEntries(Object.entries({ ...views, [id]: next }).slice(-200));
}
export function revealSessionBrowser(views, id, fallback = DEFAULT_SESSION_VIEW) {
  if (sessionView(views, id, fallback).manuallyClosed) return views;
  return updateSessionView(views, id, { side: 'browser', sideOpen: true }, fallback);
}
