import { useCallback, useEffect, useRef, useState } from 'react';
import { readSessionViews, sessionView, updateSessionView, revealSessionBrowser, persistedSessionViews, SESSION_VIEW_KEY } from './session-view.js';
import { selectDockKind } from './dock-tabs.js';

export function useSessionView(sessionId) {
  const [initial] = useState(() => readSessionViews(localStorage));
  const [views, setViews] = useState(initial.views), owner = useRef(sessionId); owner.current = sessionId;
  const update = useCallback((id, value) => setViews(previous => updateSessionView(previous, id, value, initial.fallback)), [initial]);
  useEffect(() => { if (sessionId) setViews(previous => previous[sessionId] ? previous : updateSessionView(previous, sessionId, {}, initial.fallback)); }, [sessionId, initial]);
  useEffect(() => {
    // 落盘前剥掉 reasoningOpen：思考展开是运行期状态，见 persistedSessionViews 的说明。
    try { localStorage.setItem(SESSION_VIEW_KEY, JSON.stringify({ version: 2, sessions: persistedSessionViews(views) })); } catch { /* Unavailable storage does not prevent using the chat. */ }
  }, [views]);
  const setSide = useCallback((value, id = owner.current) => update(id, view => selectDockKind(view, typeof value === 'function' ? value(view.side) : value)), [update]);
  const setSideOpen = useCallback((value, id = owner.current) => update(id, view => {
    const next = typeof value === 'function' ? value(view.sideOpen) : value;
    return { sideOpen: next, manuallyClosed: !next };
  }), [update]);
  const revealBrowser = useCallback(id => setViews(previous => revealSessionBrowser(previous, id, initial.fallback)), [initial]);
  const setPanelLayout = useCallback((layout, id = owner.current) => { if (layout.length === 2) update(id, { layout }); }, [update]);
  // 记录阅读位置：只有用户主动停留过才写，null 表示「回到贴底默认」。
  const setScroll = useCallback((scroll, id = owner.current) => update(id, () => ({ scroll })), [update]);
  // 逐条记住展开的思考块（按消息 id），最多保留 last-N。
  const setReasoningOpen = useCallback((ids, id = owner.current) => update(id, () => ({ reasoningOpen: ids })), [update]);
  const forget = useCallback(id => setViews(previous => { const next = { ...previous }; delete next[id]; return next; }), []);
  return { ...sessionView(views, sessionId, initial.fallback), views, setSide, setSideOpen, setPanelLayout, setScroll, setReasoningOpen, update, revealBrowser, forget };
}
