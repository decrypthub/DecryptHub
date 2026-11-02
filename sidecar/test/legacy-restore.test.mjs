// 历史会话（项目概念之前创建、没有 projectId）的恢复：
// 这些数据在界面上既不可见也不能删，只能靠 legacy-sessions 系列 RPC 处理。
// 恢复必须做到：不丢记录、不改坏索引、逐条独立失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';

function tmpRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

/** 造一份「项目概念之前」的数据：索引里有条目，但 .agent-state.json 没有 projectId */
function seedLegacy(app, { id, title, workspace, history = [{ t: 'user', content: 'old conversation' }], projectId = null }) {
  const dir = path.join(app, 'projects', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.agent-state.json'), JSON.stringify({ mode: 'standard', review: 'manual', todos: [], workspace, projectId }));
  fs.writeFileSync(path.join(dir, '.agent-history.json'), JSON.stringify({ v: 2, events: history }));
  const file = path.join(app, 'sessions.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { focused: null, seq: 0, sessions: [] };
  saved.sessions.push({ id, title, primary: false, updatedAt: 1793000000000, pinned: false });
  fs.writeFileSync(file, JSON.stringify(saved));
  return dir;
}

const settings = { openai: { apiKey: 'fixture', model: 'test' }, mcpServers: {} };
function manager(app) { return new SessionManager({ userDataDir: app, getSettings: () => settings, broadcast() {}, chromeMod: {} }); }

test('托管工作区的历史会话：恢复后重新出现在索引里，对话记录原样保留', async t => {
  const root = tmpRoot(t, 'dh-legacy-managed-'), app = path.join(root, 'app');
  // 旧版本会把工作区记成另一个安装路径；恢复时必须改指当前数据目录，而不是继续指向那个不存在的路径
  const staleRoot = path.join(root, 'old-checkout', 'projects', 'saa0001', 'workspace');
  seedLegacy(app, { id: 'saa0001', title: '老的小红书分析', workspace: { id: 'managed-saa0001', kind: 'managed', root: staleRoot, revision: 1, label: '会话工作区' } });

  const first = manager(app);
  try {
    assert.equal(first.sessions.size, 0, '无 projectId 的历史会话不应被自动载入');
    assert.equal(first.legacySessions().length, 1);
    assert.equal(first.legacySessions()[0].kind, 'managed');
    assert.equal(first.legacySessions()[0].restorable, true);

    const result = await first.restoreLegacySessions(['saa0001']);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.restored.length, 1);
    assert.equal(first.sessions.size, 1, '恢复后应立刻回到会话表');
    assert.equal(first.legacySessions().length, 0, '恢复过的不该继续算历史会话');
    // 工作区必须落在当前数据目录下，并真的建出来
    assert.equal(first.get('saa0001').workspace.root, path.join(app, 'projects', 'saa0001', 'workspace'));
    assert.equal(fs.existsSync(first.get('saa0001').workspace.root), true);
    // 对话事件没被碰过
    const hist = JSON.parse(fs.readFileSync(path.join(app, 'projects', 'saa0001', '.agent-history.json'), 'utf8'));
    assert.equal(hist.events[0].content, 'old conversation');
  } finally { await first.closeAll(); }

  // 重启后仍然可见：证明 write 的是持久状态，不是只在内存里恢复
  const second = manager(app);
  try {
    assert.equal(second.sessions.size, 1);
    assert.equal(second.get('saa0001').projectId, first.projects.list()[0].id);
    assert.equal(second.legacySessions().length, 0);
  } finally { await second.closeAll(); }
});

test('用户文件夹工作区的历史会话：文件夹还在就恢复，已删除则明确跳过且不动数据', async t => {
  const root = tmpRoot(t, 'dh-legacy-folder-'), app = path.join(root, 'app');
  const alive = path.join(root, 'DH_Project'), gone = path.join(root, 'deleted-folder');
  fs.mkdirSync(alive);
  seedLegacy(app, { id: 'sbb0001', title: '武汉游泳馆', workspace: { id: 'f-1', kind: 'folder', root: alive, revision: 1, label: 'DH_Project' } });
  seedLegacy(app, { id: 'sbb0002', title: '已删目录的会话', workspace: { id: 'f-2', kind: 'folder', root: gone, revision: 1, label: 'gone' } });

  const mgr = manager(app);
  try {
    const result = await mgr.restoreLegacySessions(['sbb0001', 'sbb0002']);
    assert.equal(result.restored.length, 1);
    assert.equal(result.restored[0].id, 'sbb0001');
    // Windows 上同一个目录有 8.3 短路径（RUNNER~1）与长路径两种写法，
    // 直接比字符串会把「同一目录」判成不同。比较前统一取一次真实路径。
    assert.equal(fs.realpathSync.native(mgr.get('sbb0001').workspace.root), fs.realpathSync.native(alive));
    // 失败的必须给出可读原因，并且原样留在历史会话里等用户处理
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].id, 'sbb0002');
    assert.match(result.skipped[0].reason, /不存在/);
    assert.equal(mgr.legacySessions().length, 1);
    assert.equal(mgr.legacySessions()[0].id, 'sbb0002');
    // 跳过的那条状态文件不能被写脏（projectId 仍为空）
    const state = JSON.parse(fs.readFileSync(path.join(app, 'projects', 'sbb0002', '.agent-state.json'), 'utf8'));
    assert.equal(state.projectId, null);
  } finally { await mgr.closeAll(); }
});

test('索引里存在且 projectId 合法时会话正常加载，不会被当成历史会话', async t => {
  const root = tmpRoot(t, 'dh-legacy-hasproject-'), app = path.join(root, 'app');
  const folder = path.join(root, 'code'); fs.mkdirSync(folder);
  const setup = new SessionManager({ userDataDir: app, getSettings: () => settings, broadcast() {}, chromeMod: {} });
  const entry = setup.workspaces.folder(folder);
  const projectId = setup.projects.save({ name: '既有项目', folders: [entry], primaryId: entry.id }).id;
  await setup.closeAll();

  seedLegacy(app, { id: 'scc0001', title: '控制我的浏览器', workspace: { ...entry }, projectId });

  const mgr = manager(app);
  try {
    // 关键区分：这类会话不需要「恢复」，构造时就应该直接回到会话表
    assert.equal(mgr.sessions.size, 1);
    assert.equal(mgr.get('scc0001').projectId, projectId);
    assert.equal(mgr.legacySessions().length, 0, '能正常加载的会话不该出现在历史会话提示里');
    const result = await mgr.restoreLegacySessions(['scc0001']);
    assert.deepEqual(result, { restored: [], skipped: [] }, '没有待恢复项，也不能凭空新建项目');
  } finally { await mgr.closeAll(); }
});

test('磁盘上有对话但索引里没有的孤儿会话也会被列出来（否则用户永远看不到它）', async t => {
  const root = tmpRoot(t, 'dh-legacy-orphan-'), app = path.join(root, 'app');
  const folder = path.join(root, 'code'); fs.mkdirSync(folder);
  const setup = new SessionManager({ userDataDir: app, getSettings: () => settings, broadcast() {}, chromeMod: {} });
  const entry = setup.workspaces.folder(folder);
  const projectId = setup.projects.save({ name: '既有项目', folders: [entry], primaryId: entry.id }).id;
  await setup.closeAll();

  // 有完整数据目录与合法 projectId，但 sessions.json 里没有它 —— 索引丢失的真实情形
  const dir = path.join(app, 'projects', 'sff0001');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.agent-state.json'), JSON.stringify({ mode: 'standard', workspace: { ...entry }, projectId }));
  fs.writeFileSync(path.join(dir, '.agent-history.json'), JSON.stringify({ v: 2, events: [{ t: 'user', content: '帮我查一下武汉游泳馆的票价 【当前状态（应用自动附加）】…' }] }));
  // 只有空壳目录、没有对话记录的不该被当成会话
  fs.mkdirSync(path.join(app, 'projects', 'sff0002'), { recursive: true });
  fs.writeFileSync(path.join(app, 'projects', 'sff0002', '.agent-state.json'), JSON.stringify({ mode: 'standard' }));
  fs.writeFileSync(path.join(app, 'sessions.json'), JSON.stringify({ focused: null, seq: 1, sessions: [] }));

  const mgr = manager(app);
  try {
    const list = mgr.legacySessions();
    assert.equal(list.length, 1, '只有带对话记录的目录才算历史会话');
    const [orphan] = list;
    assert.equal(orphan.id, 'sff0001');
    // 没有索引条目就没有标题，用第一条用户消息代替裸 id
    assert.match(orphan.title, /武汉游泳馆/);
    assert.ok(!orphan.title.includes('【'), '应用自动附加的状态块不该混进标题');
    assert.ok(orphan.updatedAt > 0, '没有索引时间戳时用对话文件的修改时间');

    const result = await mgr.restoreLegacySessions(['sff0001']);
    assert.equal(result.restored.length, 1);
    assert.equal(mgr.get('sff0001').projectId, projectId);
    assert.equal(mgr.legacySessions().length, 0);
  } finally { await mgr.closeAll(); }

  // 恢复后必须写进索引，重启仍在
  const again = manager(app);
  try { assert.equal(again.sessions.size, 1); assert.equal(again.legacySessions().length, 0); }
  finally { await again.closeAll(); }
});

test('恢复空列表或未知 id 时不产生任何写入', async t => {
  const root = tmpRoot(t, 'dh-legacy-noop-'), app = path.join(root, 'app');
  seedLegacy(app, { id: 'sdd0001', title: '留着', workspace: { id: 'managed-sdd0001', kind: 'managed', root: path.join(app, 'projects', 'sdd0001', 'workspace'), revision: 1 } });
  const mgr = manager(app);
  try {
    const projectsBefore = mgr.projects.list().length;
    assert.deepEqual(await mgr.restoreLegacySessions([]), { restored: [], skipped: [] });
    assert.deepEqual(await mgr.restoreLegacySessions(['does-not-exist']), { restored: [], skipped: [] });
    assert.equal(mgr.projects.list().length, projectsBefore);
    assert.equal(mgr.legacySessions().length, 1, '没点名的历史会话必须原样留着');
  } finally { await mgr.closeAll(); }
});

test('状态文件缺失的历史会话被跳过而不是让整个恢复失败', async t => {
  const root = tmpRoot(t, 'dh-legacy-missing-'), app = path.join(root, 'app');
  seedLegacy(app, { id: 'see0001', title: '正常', workspace: { id: 'managed-see0001', kind: 'managed', root: path.join(app, 'projects', 'see0001', 'workspace'), revision: 1 } });
  // 索引里有、但状态文件被删掉：不能因此抛异常，也不能悄悄当成成功
  fs.mkdirSync(path.join(app, 'projects', 'see0002'), { recursive: true });
  const file = path.join(app, 'sessions.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.sessions.push({ id: 'see0002', title: '状态丢失', primary: false, updatedAt: 1793000000000, pinned: false });
  fs.writeFileSync(file, JSON.stringify(saved));

  const mgr = manager(app);
  try {
    const result = await mgr.restoreLegacySessions(['see0001', 'see0002']);
    assert.equal(result.restored.length, 1);
    assert.equal(result.restored[0].id, 'see0001');
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].id, 'see0002');
    assert.match(result.skipped[0].reason, /缺失|无法确认/);
  } finally { await mgr.closeAll(); }
});
