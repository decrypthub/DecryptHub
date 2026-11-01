// Presentation belongs to a chat, independently of its Agent or browser process.
import { emptyDock, normalizeDock, selectDockKind, tabSide } from './dock-tabs.js';
export const SESSION_VIEW_KEY = 'decrypthub-session-views-v1';
export const DEFAULT_PANEL_LAYOUT = Object.freeze([56, 44]);
export const DEFAULT_SESSION_VIEW = Object.freeze({ side: 'browser', sideOpen: false, manuallyClosed: false, layout: DEFAULT_PANEL_LAYOUT, dock: emptyDock() });
const validId = id => /^(?:main|s(?:[a-f0-9]{6}|[a-f0-9]{32}))$/.test(id || '');
const sides = new Set(['browser', 'evidence', 'code', 'document', 'terminal']);
// 阅读位置：只有用户主动往上翻过才记录，否则恢复时仍贴底（符合「跟上最新进展」的默认预期）。
// 展开的思考块按消息 id 记，最多保留 200 条，避免长期会话把 localStorage 撑大。
const MAX_OPEN_REASONING = 200;
const normalizeScroll = value => {
  if (!value || typeof value !== 'object') return null;
  const top = Number(value.top);
  if (!Number.isFinite(top) || top < 0) return null;
  return { top: Math.round(top), at: value.at || 0, pinned: false };
};
const normalizeReasoning = value => {
  if (!Array.isArray(value)) return [];
  return value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 120).slice(-MAX_OPEN_REASONING);
};
const normalize = (value, previous = DEFAULT_SESSION_VIEW) => {
  const dock = normalizeDock(value?.dock || previous.dock);
  return ({
  side: sides.has(value?.side) ? value.side : previous.side,
  sideOpen: typeof value?.sideOpen === 'boolean' ? value.sideOpen : previous.sideOpen,
  manuallyClosed: typeof value?.manuallyClosed === 'boolean' ? value.manuallyClosed : previous.manuallyClosed,
  layout: Array.isArray(value?.layout) && value.layout.length === 2 && value.layout.every(n => Number.isFinite(n) && n > 0 && n < 100) && Math.abs(value.layout[0] + value.layout[1] - 100) < .1 ? [...value.layout] : previous.layout,
  dock,
  // 阅读位置与思考块展开状态：都是「用户显式做过选择」才记，缺省不写入。
  scroll: value?.scroll === null ? null : (normalizeScroll(value?.scroll) ?? previous.scroll ?? null),
  reasoningOpen: normalizeReasoning(value?.reasoningOpen ?? previous.reasoningOpen),
  ...(dock.activeId ? { side: tabSide(dock.tabs.find(t => t.id === dock.activeId)) } : {}),
}); };
export function readSessionViews(storage) {
  try {
    const data = JSON.parse(storage.getItem(SESSION_VIEW_KEY));
    if ([1, 2].includes(data?.version) && data.sessions && typeof data.sessions === 'object')
      return { views: Object.fromEntries(Object.entries(data.sessions).filter(([id]) => validId(id)).slice(-200).map(([id, value]) => [id, normalize(data.version === 1 && !value.dock ? { ...value, ...selectDockKind(DEFAULT_SESSION_VIEW, value.side || 'browser') } : value)])), fallback: DEFAULT_SESSION_VIEW };
    return { views: {}, fallback: { ...DEFAULT_SESSION_VIEW, sideOpen: storage.getItem('wdh_side') === 'open' } };
  } catch { return { views: {}, fallback: DEFAULT_SESSION_VIEW }; }
}
export function sessionView(views, id, fallback = DEFAULT_SESSION_VIEW) { return views[id] || fallback; }
export function updateSessionView(views, id, update, fallback = DEFAULT_SESSION_VIEW) {
  if (!validId(id)) return views;
  const previous = sessionView(views, id, fallback);
  const next = normalize(typeof update === 'function' ? update(previous) : update, previous);
  if (views[id] && JSON.stringify(next) === JSON.stringify(previous)) return views;
  return Object.fromEntries(Object.entries({ ...views, [id]: next }).slice(-200));
}
export function revealSessionBrowser(views, id, fallback = DEFAULT_SESSION_VIEW) {
  if (sessionView(views, id, fallback).manuallyClosed) return views;
  return updateSessionView(views, id, view => ({ ...selectDockKind(view, 'browser'), sideOpen: true }), fallback);
}
