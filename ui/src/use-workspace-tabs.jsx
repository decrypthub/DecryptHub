import { useEffect, useRef, useState } from 'react';
import { addDockTab, closeDockTab, syncBrowserPages, workspaceKey } from './dock-tabs.js';
import { normalizeTargetUrl } from '../../sidecar/url.mjs';
export function useWorkspaceTabs({ presentation, sid, cur, session, api, toast, setWorkspacePrompt, setView }) {
  const current = useRef(); current.current = { presentation, sid, cur, session };
  const sequence = useRef(0), switching = useRef(null), [pending, setPending] = useState(null);
  const terminalStarts = useRef(new Set());
  const dock = presentation.dock, activeTab = dock.tabs.find(t => t.id === dock.activeId);
  const pageIdentity = JSON.stringify(cur.status.pages.map(p => [p.id, p.url, p.active]));
  useEffect(() => { presentation.update(sid, view => ({ dock: syncBrowserPages(view.dock, cur.status.pages, !!cur.browserActivity?.active && switching.current?.sid !== sid) })); }, [sid, pageIdentity]);
  useEffect(() => { if (!cur.status.running) presentation.update(sid, view => ({ dock: { ...view.dock, tabs: view.dock.tabs.map(t => t.kind === 'browser' ? { ...t, pageId: null, title: '浏览器' } : t) } })); }, [sid, cur.status.running]);
  function updateTab(id, patch, owner = sid) { presentation.update(owner, view => ({ dock: { ...view.dock, tabs: view.dock.tabs.map(t => t.id === id ? { ...t, ...patch } : t) } })); }
  function selectTab(id) {
    ++sequence.current;
    presentation.update(sid, view => ({ dock: { ...view.dock, activeId: id } }));
  }
  useEffect(() => {
    if (!cur.status.running || activeTab?.kind !== 'browser' || !activeTab.pageId || cur.browserActivity?.active || cur.status.pages.some(p => p.id === activeTab.pageId && p.active)) return;
    const id = activeTab.id, intent = ++sequence.current;
    switching.current = { sid, intent }; setPending({ sid, id });
    api.invoke('browser-tab-select', { sessionId: sid, pageId: activeTab.pageId }).catch(e => { if (current.current.sid === sid && intent === sequence.current) toast(e.message, 'err'); }).finally(() => { if (switching.current?.intent === intent) { switching.current = null; setPending(null); } });
  }, [sid, cur.status.running, activeTab?.id, activeTab?.pageId, activeTab?.mode]);
  function newTab(kind) {
    if (!session) { setWorkspacePrompt('create'); return; }
    ++sequence.current; setView('chat');
    if (dock.tabs.length >= 32) { toast('每个会话最多打开32个工作标签页', 'warn'); return; }
    const next = addDockTab(dock, kind);
    if (kind === 'terminal') terminalStarts.current.add(next.activeId);
    presentation.update(sid, { dock: next, sideOpen: true, manuallyClosed: false });
  }
  async function closeTab(tab) {
    ++sequence.current;
    terminalStarts.current.delete(tab.id);
    try {
      if (tab.kind === 'terminal') await api.invoke('terminal-close', { sessionId: sid, id: tab.id });
      if (tab.kind === 'browser' && tab.pageId) await api.invoke('browser-tab-close', { sessionId: sid, pageId: tab.pageId });
      presentation.update(sid, view => ({ dock: closeDockTab(view.dock, tab.id) }));
    } catch (e) { toast(e.message, 'err'); }
  }
  function openDocument(path, { root = 'primary', basePath, link = false } = {}) {
    if (!path || /^(?:javascript|data|vbscript):/i.test(path)) { toast('不支持的链接', 'warn'); return; }
    try { if (link && !path.startsWith('file:')) path = decodeURIComponent(path.replace(/[?#].*$/, '')); } catch { toast('文档路径无效', 'warn'); return; }
    if (basePath && !/^(?:[a-z]:[\\/]|\/|file:)/i.test(path)) path = basePath.replace(/[^/]*$/, '') + path;
    const workspace = workspaceKey(session?.workspace);
    ++sequence.current; setView('chat');
    if (dock.tabs.length >= 32 && !dock.tabs.some(t => t.kind === 'document' && t.path === path && t.root === root && t.workspace === workspace)) { toast('请先关闭一些工作标签页', 'warn'); return; }
    presentation.update(sid, view => { const found = view.dock.tabs.find(t => t.kind === 'document' && t.path === path && t.root === root && t.workspace === workspace); return { dock: found ? { ...view.dock, activeId: found.id } : addDockTab(view.dock, 'document', { path, root, workspace, title: path.split(/[\\/]/).pop() }), sideOpen: true, manuallyClosed: false }; });
  }
  async function navigate(url, requestedTab) {
    url = normalizeTargetUrl(url); if (!url) return;
    const intent = ++sequence.current, tab = requestedTab || activeTab;
    if (!tab || tab.kind !== 'browser') return;
    if (!session) { setWorkspacePrompt('create'); return; }
    updateTab(tab.id, { mode: 'page' });
    setPending({ sid, id: tab.id }); switching.current = { sid, intent };
    try {
      let status;
      if (!cur.status.running) { const result = await api.invoke('browser-launch', { sessionId: sid, url }); if (!result.ok) throw Error(result.error); status = result; }
      else status = await api.invoke('browser-tab-navigate', { sessionId: sid, pageId: tab.pageId, url });
      if (status?.superseded) return;
      presentation.update(sid, view => ({ dock: syncBrowserPages(view.dock, status.pages || current.current.cur.status.pages, current.current.sid === sid && intent === sequence.current) }));
    } catch (e) { toast(e.message, 'err', 6000); }
    finally { if (switching.current?.intent === intent) { switching.current = null; setPending(null); } }
  }
  function openWebLink(url) {
    if (dock.tabs.length >= 32) { toast('请先关闭一些工作标签页', 'warn'); return; }
    if (!session) { setWorkspacePrompt('create'); return; }
    const next = addDockTab(dock, 'browser'); setView('chat');
    presentation.update(sid, { dock: next, sideOpen: true, manuallyClosed: false });
    navigate(url, next.tabs.find(t => t.id === next.activeId));
  }
  const browserReady = activeTab?.kind === 'browser' && activeTab.mode !== 'network' && (!cur.status.running || !!activeTab.pageId && cur.status.pages.some(p => p.id === activeTab.pageId && p.active));
  return { dock, activeTab, browserReady, pending: pending?.sid === sid ? pending.id : null, newTab, selectTab, closeTab, updateTab, openDocument, openWebLink, navigate, consumeTerminalStart: id => terminalStarts.current.delete(id) };
}
