import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchSessions } from '../session-search.mjs';

async function fixture(t, events) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dh-search-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const session = { id: 's', projectId: 'p', title: '标题', projectDir: directory };
  const sessions = new Map([['s', session]]), projects = [{ id: 'p', name: '项目', folders: [{ root: '/example/project' }] }];
  const file = path.join(directory, '.agent-history.json');
  await fs.writeFile(file, JSON.stringify({ v: 2, events }));
  return { session, sessions, projects, file, directory };
}
test('history search returns visible excerpts and stable ownership without starting an agent', async t => {
  const f = await fixture(t, [{ t: 'user', turnId: 'r', displayContent: '核对 NATIVE_SEARCH 证据', content: 'internal' }]);
  const result = await searchSessions({ ...f, query: 'native_search' });
  assert.deepEqual(result.matches, [{ sessionId: 's', projectId: 'p', excerpt: '核对 NATIVE_SEARCH 证据', turnId: 'r' }]);
  assert.equal(f.session.agent, undefined);
  assert.deepEqual((await searchSessions({ ...f, query: '/example/project' })).matches, []);
});
test('tool payloads, reasoning, attachments and internal context are excluded from search', async t => {
  const f = await fixture(t, [{ t: 'tool', content: 'PRIVATE_TOOL' }, { t: 'assistant', content: '公开回复', reasoning: 'PRIVATE_THOUGHT' }, { t: 'user', content: '用户消息\n\n【当前状态】PRIVATE_CONTEXT', attachments: [{ path: '/PRIVATE_ATTACHMENT' }] }, { t: 'user', content: '【系统】PRIVATE_NOTE' }]);
  for (const query of ['PRIVATE_TOOL', 'PRIVATE_THOUGHT', 'PRIVATE_CONTEXT', 'PRIVATE_ATTACHMENT', 'PRIVATE_NOTE']) assert.deepEqual((await searchSessions({ ...f, query })).matches, []);
  assert.equal((await searchSessions({ ...f, query: '公开回复' })).matches.length, 1);
});
test('loaded histories and saved histories share matching rules, including project + message terms', async t => {
  const f = await fixture(t, []);
  f.session.agent = { hist: { events: [{ t: 'assistant', content: '已找到 FULLWIDTH 证据' }] } };
  assert.equal((await searchSessions({ ...f, query: '项目 ｆｕｌｌｗｉｄｔｈ' })).matches.length, 1);
});
test('cancellation and moving or deleting a session cannot publish stale ownership', async t => {
  const f = await fixture(t, [{ t: 'assistant', content: 'match' }]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchSessions({ ...f, query: 'match', signal: controller.signal }), { name: 'AbortError' });
  const pending = searchSessions({ ...f, query: 'match' }); f.sessions.delete('s');
  assert.deepEqual((await pending).matches, []);
  await assert.rejects(searchSessions({ ...f, query: 'x'.repeat(501) }), /500/);
});
test('linked, oversized and corrupt history files are skipped without reading project files', async t => {
  const f = await fixture(t, [{ t: 'assistant', content: 'match' }]);
  const backup = path.join(f.directory, 'other.json'); await fs.rename(f.file, backup);
  try { await fs.symlink(backup, f.file); assert.equal((await searchSessions({ ...f, query: 'match' })).skipped, 1); await fs.unlink(f.file); }
  catch (error) { if (error.code !== 'EPERM' && error.code !== 'ENOTSUP') throw error; }
  await fs.link(backup, f.file);
  assert.equal((await searchSessions({ ...f, query: 'match' })).skipped, 1);
  await fs.unlink(f.file); await fs.mkdir(f.file);
  assert.equal((await searchSessions({ ...f, query: 'match' })).skipped, 1);
  await fs.rmdir(f.file); await fs.writeFile(f.file, 'bad JSON');
  assert.equal((await searchSessions({ ...f, query: 'match' })).skipped, 1);
  await fs.truncate(f.file, 8 * 1024 * 1024 + 1);
  assert.equal((await searchSessions({ ...f, query: 'match' })).skipped, 1);
});
