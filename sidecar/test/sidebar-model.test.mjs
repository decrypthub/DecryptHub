import test from 'node:test';
import assert from 'node:assert/strict';
import { readSidebarView, orderSidebarSessions, sidebarResults } from '../../ui/src/sidebar-model.js';
const projects = [{ id: 'a', name: 'ＡＰＰ', folders: [{ root: '/code/alpha' }] }, { id: 'b', name: 'Empty', folders: [] }];
const sessions = [{ id: 's', projectId: 'a', title: '检查接口', updatedAt: 1 }, { id: 't', projectId: 'a', title: '运行测试', updatedAt: 9, pinned: true }];
test('project names and paths find their project and chats, including empty projects', () => {
  assert.deepEqual(sidebarResults(projects, sessions, 'app').map(r => r.key), ['p:a', 's:s', 's:t']);
  assert.deepEqual(sidebarResults(projects, sessions, '/alpha').map(r => r.key), ['p:a', 's:s', 's:t']);
  assert.deepEqual(sidebarResults(projects, sessions, 'Empty').map(r => r.key), ['p:b']);
});
test('content hits are deduplicated and cannot resurrect deleted or moved chats', () => {
  const hits = [{ sessionId: 's', projectId: 'a', excerpt: 'hit' }, { sessionId: 's', projectId: 'a', excerpt: 'again' }, { sessionId: 'deleted', projectId: 'a' }, { sessionId: 't', projectId: 'b' }];
  assert.deepEqual(sidebarResults(projects, sessions, 'hit', hits).map(r => r.key), ['s:s']);
  assert.equal(sidebarResults(projects, sessions, '检查', hits).filter(r => r.id === 's').length, 1);
});
test('sidebar preferences and recent sorting preserve membership and manual order', () => {
  assert.deepEqual(readSidebarView({ getItem() { throw Error(); } }), { group: 'projects', sort: 'manual' });
  assert.deepEqual(readSidebarView({ getItem: () => '{bad' }), { group: 'projects', sort: 'manual' });
  const sample = [...sessions, { id: 'u', updatedAt: 20 }];
  assert.deepEqual(orderSidebarSessions(sample, 'recent').map(s => s.id), ['t', 'u', 's']);
  assert.deepEqual(sample.map(s => s.id), ['s', 't', 'u']);
});
