// 记忆与技能的删除与跨作用域管理。
//
// 设置页可以管理「AI 自己写的记忆和技能」，系统记忆不在这里（见 system-memory.mjs）。
// 删除是最危险的动作：必须明确作用域，不能按名字猜；技能按目录删，记忆按文件删。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExtensionStore } from '../extensions.mjs';
import { decideTool } from '../policy.mjs';

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-ext-'));
  t.after(() => { if (path.basename(dir).startsWith('dh-ext-')) fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, store: new ExtensionStore({ directory: dir, getSettings: () => ({}), saveSettings() {}, plugins: {}, mcpHost: {}, tasks: {} }) };
}

test('remove requires an explicit scope and never guesses which copy to delete', t => {
  const { store: s } = store(t);
  const ctx = { sessionId: 'main', projectId: 'project-one' };
  const fact = '用户这台手机可以用 adb 操作';
  s.write('memory', { name: 'device-fact', content: fact, scope: 'project' }, ctx);
  s.write('memory', { name: 'device-fact', content: fact, scope: 'user' }, ctx);
  assert.equal(s.list('memory', ctx).length, 2);

  assert.throws(() => s.remove('memory', { name: 'device-fact' }, ctx), /scope/);
  s.remove('memory', { name: 'device-fact', scope: 'user' }, ctx);
  // 删掉全局那份之后，项目那份必须还在。
  const left = s.list('memory', ctx);
  assert.equal(left.length, 1);
  assert.equal(left[0].scope, 'project');
});

test('removing a stale hash is refused so a concurrent AI edit is not lost', t => {
  const { store: s } = store(t);
  const ctx = { sessionId: 'main', projectId: null };
  const first = s.write('memory', { name: 'fact', content: 'v1', scope: 'user' }, ctx);
  s.write('memory', { name: 'fact', content: 'v2', scope: 'user', expectedHash: first.hash }, ctx);
  assert.throws(() => s.remove('memory', { name: 'fact', scope: 'user', expectedHash: first.hash }, ctx), /已变化/);
  assert.equal(s.read('memory', { name: 'fact', scope: 'user' }, ctx).content.trim(), 'v2');
});

test('a skill is removed as its own directory, not as an unrelated file tree', t => {
  const { store: s, dir } = store(t);
  const ctx = { sessionId: 'main', projectId: null };
  s.write('skill', { name: 'adb-flow', content: '---\nname: adb-flow\ndescription: 用 adb 确认界面状态\n---\n\n先 dump 再点击。', scope: 'user' }, ctx);
  assert.equal(s.list('skill', ctx).length, 1);
  s.remove('skill', { name: 'adb-flow', scope: 'user' }, ctx);
  assert.equal(s.list('skill', ctx).length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'extensions/user/global/skill/adb-flow')), false);
  // 作用域根目录本身必须保留，删除只能到条目这一层。
  assert.equal(fs.existsSync(path.join(dir, 'extensions/user/global/skill')), true);
});

test('admin scope addressing lets settings manage entries outside the current session', t => {
  const { store: s } = store(t);
  s.write('memory', { name: 'elsewhere', content: 'belongs to another project', scope: 'project' }, { sessionId: 's1', projectId: 'project-two' });
  const current = { sessionId: 'main', projectId: 'project-one' };
  assert.equal(s.list('memory', current).length, 0, 'another project must stay invisible to this session');
  assert.equal(s.list('memory', { ...current, admin: true, scopeId: 'project-two' }).length, 1);
  // 管理面不能借 admin 跳到未声明的路径。
  assert.throws(() => s.list('memory', { ...current, admin: true, scopeId: '../escape' }), /名称|越界|可用/);
});

test('admin listings carry scopeId so a later read/remove can address the same entry', t => {
  // 设置页先 list 再 read/remove。list 的条目若不含 scopeId，后续调用只能传 undefined，
  // 会被管理面的 scope/scopeId 校验拒绝——这是一个真实发生过的缺陷。
  const { store: s } = store(t);
  s.write('memory', { name: 'a', content: 'project copy', scope: 'project' }, { sessionId: 's1', projectId: 'proj-1' });
  const ctx = { admin: true, scopeId: 'proj-1', sessionId: 'admin', projectId: 'proj-1' };
  const listed = s.list('memory', ctx);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].updatedAt > 0, true, 'list must expose updatedAt for ordering');
  // 与 index.mjs 的 extensions-admin 指定 scope 分支相同的补全方式。
  const item = { ...listed[0], scope: 'project', scopeId: 'proj-1' };
  assert.equal(s.read('memory', { name: item.name, scope: item.scope }, { ...ctx, scopeId: item.scopeId }).content.trim(), 'project copy');
  s.remove('memory', { name: item.name, scope: item.scope }, { ...ctx, scopeId: item.scopeId });
  assert.equal(s.list('memory', ctx).length, 0);
});

test('persistent memory writes stay approval-gated, and removal is treated as a mutation', () => {
  for (const action of ['write', 'remove']) {
    assert.equal(decideTool('read-only', 'memory_manage', { action }).action, 'deny');
    assert.equal(decideTool('standard', 'memory_manage', { action }).action, 'approve');
    assert.equal(decideTool('full-access', 'memory_manage', { action }).action, 'run');
  }
  assert.equal(decideTool('standard', 'memory_manage', { action: 'list' }).action, 'run');
});
