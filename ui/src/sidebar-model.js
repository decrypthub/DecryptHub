import { sessionLabel } from './state.js';

const normalized = value => String(value || '').normalize('NFKC').toLowerCase();
export const searchTerms = query => normalized(query).trim().split(/\s+/).filter(Boolean);
export const sidebarMatches = (value, query) => { const text = normalized(value); return searchTerms(query).every(term => text.includes(term)); };
export function readSidebarView(storage) {
  try { const value = JSON.parse(storage.getItem('wdh_sidebar_view') || '{}'); return { group: value.group === 'flat' ? 'flat' : 'projects', sort: value.sort === 'recent' ? 'recent' : 'manual' }; }
  catch { return { group: 'projects', sort: 'manual' }; }
}
export function orderSidebarSessions(sessions, sort) {
  return [...sessions].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'recent' ? (b.updatedAt || 0) - (a.updatedAt || 0) : 0));
}
export function sidebarResults(projects, sessions, query, history = []) {
  const projectMap = new Map(projects.map(p => [p.id, p])), results = [], found = new Set();
  for (const project of projects) {
    const paths = (project.folders || []).map(f => f.root).join(' ');
    if (sidebarMatches(project.name + ' ' + paths, query)) results.push({ key: 'p:' + project.id, kind: 'project', id: project.id, title: project.name, project, subtitle: paths });
  }
  for (const session of sessions) {
    const project = projectMap.get(session.projectId); if (!project) continue;
    if (sidebarMatches([sessionLabel(session), project.name, ...(project.folders || []).map(f => f.root)].join(' '), query)) {
      found.add(session.id); results.push({ key: 's:' + session.id, kind: 'session', id: session.id, title: sessionLabel(session), project, subtitle: project.name });
    }
  }
  for (const hit of history) {
    const session = sessions.find(s => s.id === hit.sessionId), project = session && projectMap.get(session.projectId);
    if (!session || !project || project.id !== hit.projectId || found.has(session.id)) continue;
    found.add(session.id); results.push({ key: 's:' + session.id, kind: 'session', id: session.id, title: sessionLabel(session), project, subtitle: project.name, excerpt: hit.excerpt, turnId: hit.turnId });
  }
  return results;
}
