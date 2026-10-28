// Presentation-only identities. Browser page and terminal process IDs are separate resources.
export const emptyDock = () => ({ tabs: [], activeId: null });
export const workspaceKey = ws => [ws?.id, ws?.revision, ws?.projectRevision, ws?.root].join(':');
const kinds = new Set(['browser', 'files', 'document', 'terminal']);
export function normalizeDock(value) {
  const seen = new Set();
  const tabs = (Array.isArray(value?.tabs) ? value.tabs : []).filter(t => t && /^[\w-]{1,80}$/.test(t.id) && kinds.has(t.kind) && !seen.has(t.id) && seen.add(t.id)).slice(0, 32).map(t => ({
    id: t.id, kind: t.kind, title: String(t.title || ({ browser: '浏览器', files: '工作区文件', terminal: '终端', document: '文档' })[t.kind]).slice(0, 120),
    ...(t.kind === 'browser' ? { pageId: typeof t.pageId === 'string' ? t.pageId : null, mode: t.mode === 'network' ? 'network' : 'page', network: { query: String(t.network?.query || '').slice(0, 512), type: ['all', 'api', 'js', 'doc', 'other'].includes(t.network?.type) ? t.network.type : 'api' } } : {}),
    ...(t.kind === 'document' ? { path: String(t.path || '').slice(0, 4096), root: String(t.root || 'primary'), workspace: String(t.workspace || '').slice(0, 4096) } : {}),
  }));
  return { tabs, activeId: tabs.some(t => t.id === value?.activeId) ? value.activeId : tabs.at(-1)?.id || null };
}
export function tabSide(tab) { return tab?.kind === 'files' ? 'code' : tab?.kind === 'browser' ? tab.mode === 'network' ? 'evidence' : 'browser' : tab?.kind || 'browser'; }
export function addDockTab(dock, kind, options = {}) {
  const tab = { id: crypto.randomUUID(), kind, ...options };
  return normalizeDock({ tabs: [...dock.tabs, tab], activeId: tab.id });
}
export function closeDockTab(dock, id) {
  const index = dock.tabs.findIndex(t => t.id === id), tabs = dock.tabs.filter(t => t.id !== id);
  return { tabs, activeId: dock.activeId === id ? tabs[Math.min(index, tabs.length - 1)]?.id || null : dock.activeId };
}
export function selectDockKind(view, side) {
  const kind = side === 'code' ? 'files' : side === 'evidence' ? 'browser' : side;
  const dock = view.dock || emptyDock(), found = dock.tabs.find(t => t.id === dock.activeId && t.kind === kind) || dock.tabs.find(t => t.kind === kind);
  const next = found ? { tabs: dock.tabs, activeId: found.id } : addDockTab(dock, kind);
  if (kind === 'browser') next.tabs = next.tabs.map(t => t.id === next.activeId ? { ...t, mode: side === 'evidence' ? 'network' : 'page' } : t);
  return { dock: next, side };
}
export function syncBrowserPages(dock, pages, follow = false) {
  if (!pages.length) return dock;
  let tabs = dock.tabs.map(t => t.kind === 'browser' && t.pageId && !pages.some(p => p.id === t.pageId) ? { ...t, pageId: null, title: '浏览器' } : t);
  for (const page of pages) {
    let tab = tabs.find(t => t.kind === 'browser' && t.pageId === page.id);
    if (!tab) tab = tabs.find(t => t.id === dock.activeId && t.kind === 'browser' && !t.pageId) || tabs.find(t => t.kind === 'browser' && !t.pageId);
    const title = page.title && page.title !== 'about:blank' ? page.title : page.url && page.url !== 'about:blank' ? page.url.replace(/^https?:\/\//, '') : '新标签页';
    if (tab) tabs = tabs.map(t => t.id === tab.id ? { ...t, pageId: page.id, title } : t);
    else if (tabs.length < 32) tabs.push({ id: crypto.randomUUID(), kind: 'browser', pageId: page.id, title, mode: 'page' });
  }
  const active = pages.find(p => p.active), activeTab = tabs.find(t => t.kind === 'browser' && t.pageId === active?.id);
  return normalizeDock({ tabs, activeId: follow && activeTab ? activeTab.id : dock.activeId });
}
