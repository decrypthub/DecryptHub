import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TestSessionManager as SessionManager, bindTestProject } from './project-fixture.mjs';
import { readDocument, documentWorkspaceKey } from '../documents.mjs';
import { BrowserTabs } from '../browser-tabs.mjs';
import { addDockTab, closeDockTab, emptyDock, syncBrowserPages } from '../../ui/src/dock-tabs.js';
import { readSessionViews, SESSION_VIEW_KEY } from '../../ui/src/session-view.js';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-tabs-'));
  const manager = new SessionManager({ userDataDir: directory, getSettings: () => ({}), broadcast() {}, chromeMod: {}, titleGenerator: async () => '' });
  const s = manager.create({});
  t.after(async () => { await manager.closeAll(); assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('dh-tabs-')); fs.rmSync(directory, { recursive: true, force: true }); });
  return { s, manager, directory };
}
const wait = async (check, message = 'Terminal verification timed out') => { const end = Date.now() + 20000; while (!check()) { if (Date.now() > end) throw Error(message); await new Promise(r => setTimeout(r, 25)); } };
const waitPrompt = async (s, id) => { if (process.platform !== 'win32') return; await wait(() => /PS [^>\r\n]*>/.test(s.terminals.snapshot(id).output), 'PowerShell prompt timed out'); await new Promise(r => setTimeout(r, 800)); };
const expectOutput = async (check, s, id) => { try { await wait(check); } catch (error) { const tail = s.terminals.snapshot(id).output.slice(-600); throw Error(error.message + '; output tail=' + JSON.stringify(tail)); } };
const runCommand = async (s, id, command) => { s.terminals.input(id, command); await new Promise(r => setTimeout(r, 500)); s.terminals.input(id, '\r'); };
test('work tabs preserve stable IDs and choose a neighbour on close; v1 migrates network into browser', () => {
  let dock = addDockTab(emptyDock(), 'files'), original = dock.activeId; dock = addDockTab(dock, 'document', { path: 'report.md', workspace: 'test' });
  dock = addDockTab(dock, 'terminal'); dock = closeDockTab(dock, dock.activeId); assert.equal(dock.tabs.length, 2); assert.equal(dock.tabs[0].id, original); assert.equal(dock.activeId, dock.tabs[1].id);
  const value = readSessionViews({ getItem: key => key === SESSION_VIEW_KEY ? JSON.stringify({ version: 1, sessions: { main: { side: 'evidence', sideOpen: true } } }) : null });
  assert.equal(value.views.main.dock.tabs[0].mode, 'network'); assert.equal(value.views.main.sideOpen, true);
  const restored = readSessionViews({ getItem: () => JSON.stringify({ version: 2, sessions: { main: { dock } } }) }); assert.deepEqual(restored.views.main.dock, dock);
});
test('browser resources follow stable page IDs, not shifting indexes or titles', () => {
  let dock = addDockTab(emptyDock(), 'files'); const selected = dock.activeId;
  dock = syncBrowserPages(dock, [{ id: 'a', url: 'https://a.test', active: true }, { id: 'b', url: 'https://b.test' }]);
  assert.equal(dock.activeId, selected); const b = dock.tabs.find(t => t.pageId === 'b').id;
  dock = syncBrowserPages(dock, [{ id: 'b', url: 'https://b.test/new', active: true }], true);
  assert.equal(dock.activeId, b); assert.equal(dock.tabs.find(t => t.id === b).title, 'b.test');
});
test('document reads reject old workspaces, outside paths and links while allowing Markdown', t => {
  const { s, directory } = fixture(t); fs.mkdirSync(s.workspace.root, { recursive: true }); fs.writeFileSync(path.join(s.workspace.root, 'report.md'), '# Report');
  const a = { path: 'report.md', workspace: documentWorkspaceKey(s.workspace), root: 'primary' };
  assert.equal(readDocument(s, a).content, '# Report'); assert.equal(readDocument(s, a).markdown, true);
  assert.throws(() => readDocument(s, { ...a, path: path.join(directory, 'sessions.json') }), /越界/);
  assert.throws(() => readDocument(s, { ...a, path: 'javascript:alert(1)' }), /不支持/);
  fs.symlinkSync(directory, path.join(s.workspace.root, 'linked'), 'junction'); assert.throws(() => readDocument(s, { ...a, path: 'linked/sessions.json' }), /链接/);
  s.workspace.revision++; assert.throws(() => readDocument(s, a), /之前/);
});
test('rapid browser selection serializes the latest intent and rejects missing page IDs', async () => {
  const seen = [], s = { browser: { running: true, snapshot: { pages: [{ id: 'a' }, { id: 'b' }] }, selectPage: async (_i, id) => seen.push(id) } };
  const tabs = new BrowserTabs(s); const a = tabs.select('a'), b = tabs.select('b'); await Promise.all([a, b]); assert.deepEqual(seen, ['b']);
  await assert.rejects(tabs.select('missing'), /已关闭/);
});
test('interactive terminal enforces permission, accepts real input and closes with its chat', { timeout: 60000 }, async t => {
  const { s, manager } = fixture(t), id = crypto.randomUUID(); s.setMode('read-only');
  await assert.rejects(s.terminals.open({ id }), /只读/);
  s.setMode('standard'); s.approve = async () => false; await assert.rejects(s.terminals.open({ id }), /未批准/); assert.equal(s.terminals.entries.size, 0);
  s.setMode('full-access'); await s.terminals.open({ id, cols: 90, rows: 28 });
  await waitPrompt(s, id);
  await runCommand(s, id, process.platform === 'win32' ? "Write-Output ('TERMINAL_' + 'VERIFIED')" : "printf 'TERMINAL_%s\\n' 'VERIFIED'");
  await expectOutput(() => s.terminals.snapshot(id).output.includes('TERMINAL_VERIFIED'), s, id);
  const job = s.terminals.get(id).job; await manager.delete(s.id); await job.done; assert.equal(s.terminals.entries.size, 0);
});
test('closing while terminal approval is pending cancels startup without creating a process', async t => {
  const { s } = fixture(t), opening = s.terminals.open({ id: crypto.randomUUID() });
  const rejected = assert.rejects(opening, /未批准|取消|abort/i); await s.terminals.closeAll(); await rejected; assert.equal(s.terminals.entries.size, 0);
});
test('terminal approval never changes an unrelated Agent automation run', async t => {
  const { s } = fixture(t); s.activeRun = { id: 'unrelated', source: 'automation', status: 'running' };
  const opening = s.terminals.open({ id: crypto.randomUUID() }), rejected = assert.rejects(opening, /未批准/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.pending.size, 1); assert.ok(!s.permissionBlocked); assert.equal(s.activeRun.status, 'running');
  s.replyApproval([...s.pending.keys()][0], { allow: false }); await rejected;
});
test('multiple terminals isolate output and closing one keeps its sibling usable', { timeout: 75000 }, async t => {
  const { s } = fixture(t), a = crypto.randomUUID(), b = crypto.randomUUID(); s.setMode('full-access');
  await Promise.all([s.terminals.open({ id: a }), s.terminals.open({ id: b })]);
  await Promise.all([waitPrompt(s, a), waitPrompt(s, b)]);
  const command = suffix => process.platform === 'win32' ? "Write-Output ('ISOLATED_' + '" + suffix + "')" : "printf 'ISOLATED_%s\\n' '" + suffix + "'";
  await runCommand(s, a, command('FIRST')); await runCommand(s, b, command('SECOND'));
  await expectOutput(() => s.terminals.snapshot(a).output.includes('ISOLATED_FIRST') && s.terminals.snapshot(b).output.includes('ISOLATED_SECOND'), s, a);
  assert.ok(!s.terminals.snapshot(a).output.includes('ISOLATED_SECOND'));
  await s.terminals.close(a); await runCommand(s, b, command('STILL_ALIVE'));
  await expectOutput(() => s.terminals.snapshot(b).output.includes('ISOLATED_STILL_ALIVE'), s, b);
});
