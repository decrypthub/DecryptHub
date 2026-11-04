// 审批可用性：没有界面在听的时候，approve() 必须立刻拒绝，而不是静默等满 5 分钟。
// 这是纯 MCP/CLI 客户端调用桌面端 Harness 时的致命问题：工具会挂到外层超时，
// 调用方分不清「权限被拒绝」和「命令本身很慢」（实测表现为固定 +15s）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';
import { decideTool } from '../policy.mjs';

function tmpRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { if (path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

const settings = { openai: { apiKey: 'fixture', model: 'test' }, mcpServers: {} };

/** 造一个标准权限、带项目工作区的会话；listeners 决定「有没有界面在听」 */
function fixture(t, { listeners = 0 } = {}) {
  const root = tmpRoot(t, 'dh-approval-'), app = path.join(root, 'app'), work = path.join(root, 'work');
  fs.mkdirSync(work);
  const state = { listeners };
  const mgr = new SessionManager({
    userDataDir: app, getSettings: () => settings, broadcast() {}, chromeMod: {},
    hasApprovalListener: () => state.listeners > 0,
  });
  const entry = mgr.workspaces.folder(work);
  const project = mgr.projects.save({ name: 'Work', folders: [entry], primaryId: entry.id });
  const s = mgr.create({ projectId: project.id, primary: true });
  s.setMode('standard');
  t.after(async () => { await mgr.closeAll(); });
  return { mgr, s, state };
}

/** 等 session 上出现一条待审批请求（避免靠固定 sleep 猜时机） */
async function waitPending(s, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (s.pending.size) return [...s.pending.keys()][0];
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error('等不到待审批请求，pending.size=' + s.pending.size);
}

test('没有确认界面时，代码执行类审批立刻被拒绝并说明原因（不挂起）', async t => {
  const { s } = fixture(t, { listeners: 0 });
  const started = Date.now();
  await assert.rejects(
    () => s.approve({ name: 'workspace_shell', category: 'shell', scopeKey: 'k1', canRemember: true, summary: 'run echo' }),
    error => {
      assert.equal(error.code, 'approval-unavailable');
      // 报错要能让模型自己纠正：说清是「没有界面」，不是「命令失败」
      assert.match(error.message, /没有可用的确认界面/);
      assert.match(error.message, /命令没有执行/);
      assert.match(error.message, /完全访问|打开桌面端/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 2000, '必须立即失败，不能等审批超时；实际耗时 ' + (Date.now() - started) + 'ms');
  assert.equal(s.pending.size, 0, '不能留下悬挂的审批请求');
});

test('有确认界面时审批照常挂起等待用户点击', async t => {
  const { s } = fixture(t, { listeners: 1 });
  let settled = false;
  const waiting = s.approve({ name: 'workspace_shell', category: 'shell', scopeKey: 'k2', canRemember: true, summary: 'run echo' })
    .then(v => { settled = true; return v; });
  const id = await waitPending(s);
  assert.equal(settled, false, '有界面时应当等待用户操作');
  s.replyApproval(id, { allow: true });
  assert.equal(await waiting, true);
  assert.equal(s.pending.size, 0);
});

test('用户拒绝后，后续审批在没有界面时立刻失败而不是继续等', async t => {
  const { s, state } = fixture(t, { listeners: 1 });
  const waiting = s.approve({ name: 'workspace_run', category: 'shell', scopeKey: 'k3', canRemember: true, summary: 'run script' });
  const id = await waitPending(s);
  // 用户点了拒绝（等价于关窗口时 dispose 的 finish(false)）
  s.replyApproval(id, { allow: false });
  assert.equal(await waiting, false);

  // 界面消失后再请求审批：必须立刻拒绝
  state.listeners = 0;
  const started = Date.now();
  await assert.rejects(
    () => s.approve({ name: 'workspace_run', category: 'shell', scopeKey: 'k4', canRemember: true, summary: 'again' }),
    /没有可用的确认界面/,
  );
  assert.ok(Date.now() - started < 2000);
});

test('完全访问权限与已记住的动作不受界面有无影响', async t => {
  const { s, state } = fixture(t, { listeners: 0 });
  // 完全访问：直接放行
  s.setMode('full-access');
  assert.equal(await s.approve({ name: 'workspace_shell', category: 'shell', scopeKey: 'k5' }), true);

  // 标准权限 + 本会话已记住同一动作：直接放行
  s.setMode('standard');
  state.listeners = 1;
  const waiting = s.approve({ name: 'workspace_shell', category: 'shell', scopeKey: 'k6', canRemember: true });
  const id = await waitPending(s);
  s.replyApproval(id, { allow: true, always: true });
  assert.equal(await waiting, true);

  state.listeners = 0;
  assert.equal(await s.approve({ name: 'workspace_shell', category: 'shell', scopeKey: 'k6', canRemember: true }), true,
    '记住过的动作不该再因为「没有界面」被拒');
});

test('standard 权限下 shell/run 确实走审批分支（确认问题出在等待而非策略）', async () => {
  // 纯函数校验：策略层本来就是 approve，没有把它误判成 deny 或 run
  assert.equal(decideTool('standard', 'workspace_shell', { cmd: 'echo hi' }).action, 'approve');
  assert.equal(decideTool('standard', 'workspace_run', { file: 'index.js' }).action, 'approve');
  // 只读与完全访问保持不变
  assert.equal(decideTool('read-only', 'workspace_shell', { cmd: 'echo hi' }).action, 'deny');
  assert.equal(decideTool('full-access', 'workspace_shell', { cmd: 'echo hi' }).action, 'run');
});
