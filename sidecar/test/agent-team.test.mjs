import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentTeam } from '../agent-team.mjs';
import { TEAM_TOOLS } from '../team-tools.mjs';
import { Agent } from '../agent.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-team-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let current = { sessionId: 'lead', workspaceId: 'one', workRoot: directory };
  const options = { directory, context: () => current, members: () => new Set(['lead', 'member-a', 'member-b']) };
  const team = new AgentTeam(options); team.select(true);
  return { team, options, ctx: id => ({ ...current, sessionId: id || 'lead' }), switch: () => { current = { ...current, workspaceId: 'two', workRoot: directory + '/two' }; } };
}
const task = (subject, extra = {}) => ({ subject, description: subject + ' 的验收证据', ...extra });
const update = (team, ctx, value, action, extra = {}) => team.update(ctx, { task_id: value.id, expected_revision: value.revision, action, ...extra });

test('claims use compare-and-set and only the owner or lead can settle work', t => {
  const f = fixture(t), created = f.team.create(f.ctx(), task('验证 API'));
  const owned = update(f.team, f.ctx('member-a'), created, 'claim');
  assert.equal(owned.ownerId, 'member-a');
  assert.throws(() => update(f.team, f.ctx('member-b'), created, 'claim'), /revision/);
  assert.throws(() => update(f.team, f.ctx('member-b'), owned, 'complete'), /负责人/);
  assert.throws(() => update(f.team, f.ctx('member-a'), owned, 'reassign', { owner: 'member-b' }), /主代理/);
  assert.throws(() => update(f.team, f.ctx(), owned, 'reassign', { owner: 'outsider' }), /不属于/);
  const assigned = update(f.team, f.ctx(), owned, 'reassign', { owner: 'member-b' });
  const complete = update(f.team, f.ctx('member-b'), assigned, 'complete');
  assert.equal(complete.status, 'completed');
  assert.throws(() => f.team.list(f.ctx('outsider')), /不属于/);
});
test('blocked tasks cannot start; cyclic dependencies and deleting blockers leave storage unchanged', t => {
  const f = fixture(t), first = f.team.create(f.ctx(), task('先实现'));
  const second = f.team.create(f.ctx(), task('再验证', { blocked_by: [first.id] }));
  assert.equal(second.ready, false);
  assert.throws(() => update(f.team, f.ctx('member-a'), second, 'claim'), /依赖/);
  const before = fs.readFileSync(f.team.file, 'utf8');
  assert.throws(() => update(f.team, f.ctx(), first, 'set_dependencies', { blocked_by: [second.id] }), /循环/);
  assert.throws(() => update(f.team, f.ctx(), first, 'delete'), /不存在或已删除/);
  assert.equal(fs.readFileSync(f.team.file, 'utf8'), before);
  const owned = update(f.team, f.ctx(), first, 'claim');
  update(f.team, f.ctx(), owned, 'complete');
  assert.equal(f.team.get(f.ctx(), second.id).ready, true);
  assert.equal(update(f.team, f.ctx('member-a'), second, 'claim').status, 'in_progress');
});
test('scope warnings use path components and never act as write locks', t => {
  const f = fixture(t), first = f.team.create(f.ctx(), task('UI', { write_scopes: ['ui'] }));
  update(f.team, f.ctx('member-a'), first, 'claim');
  const second = f.team.create(f.ctx(), task('UI 组件', { write_scopes: ['ui/src'] }));
  assert.equal(second.writeScopeWarnings.length, 1);
  assert.equal(update(f.team, f.ctx('member-b'), second, 'claim').status, 'in_progress');
  const unrelated = f.team.create(f.ctx(), task('其他', { write_scopes: ['ui-other'] }));
  assert.deepEqual(unrelated.writeScopeWarnings, []);
  assert.throws(() => f.team.create(f.ctx(), task('越界', { write_scopes: ['../private'] })), /相对路径/);
});
test('boards persist by workspace, retain tasks when disabled, and refuse corrupt saved state', t => {
  const f = fixture(t), oldCtx = f.ctx(); f.team.create(oldCtx, task('保留任务')); f.team.select(false);
  const restored = new AgentTeam(f.options); assert.equal(restored.snapshot().enabled, false); assert.equal(restored.snapshot().tasks.length, 1);
  f.switch(); assert.equal(restored.snapshot().tasks.length, 0); restored.select(true);
  assert.throws(() => restored.list(oldCtx), /另一个工作区/);
  fs.writeFileSync(restored.file, '{bad'); const damaged = new AgentTeam(f.options);
  assert.match(damaged.snapshot().failure, /无法读取/); assert.throws(() => damaged.select(true), /无法读取/);
  assert.equal(fs.readFileSync(restored.file, 'utf8'), '{bad');
});
test('the lead creates the first team task without a user mode switch or additional workspace authority', async t => {
  const f = fixture(t); f.team.select(false);
  const agent = new Agent({ projectDir: f.options.directory, tools: TEAM_TOOLS, getSettings: () => ({}), getMode: () => 'read-only', getToolContext: () => ({ ...f.ctx(), team: f.team }), mcp: { tools: [], has: () => false }, emit() {} });
  t.after(() => agent.hist.close());
  assert.equal(agent.allTools().some(t => t.name === 'team_task_create'), true);
  assert.equal(agent.allTools().some(t => t.name === 'team_task_list'), false);
  assert.throws(() => f.team.create(f.ctx('member-a'), task('不能创建首项')), /尚未建立/);
  assert.equal((await agent.runTool('team_task_create', task('可协调任务'))).isError, undefined);
  assert.equal(f.team.snapshot().tasks.length, 1);
  assert.equal(f.team.snapshot().enabled, true);
  assert.equal(agent.allTools().some(t => t.name === 'team_task_list'), true);
});
