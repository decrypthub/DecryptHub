// One root session owns its task board. Tasks coordinate work; scopes are advisory, never permissions.
import fs from 'node:fs';
import path from 'node:path';
import { atomicJson } from './paths.mjs';

const statuses = new Set(['pending', 'in_progress', 'completed', 'deleted']);
const text = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${name} 需要 1–${max} 个字符`);
  return value.trim();
};
function strings(value, name) {
  if (!Array.isArray(value) || value.length > 30 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 1000) || new Set(value).size !== value.length) throw Error(`${name} 必须是不重复的文字列表，最多 30 项`);
  return value.map(item => item.trim());
}
function scopes(value) {
  return strings(value, 'write_scopes').map(item => {
    const normalized = item.replace(/\\/g, '/').replace(/\/$/, '');
    if (!normalized || normalized.startsWith('/') || normalized.includes(':') || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw Error('写入范围需要工作区内的相对路径');
    return normalized;
  });
}
function graph(tasks) {
  const live = new Map(tasks.filter(t => t.status !== 'deleted').map(t => [t.id, t]));
  const visiting = new Set(), done = new Set();
  const visit = id => {
    if (visiting.has(id)) throw Error('任务依赖形成循环');
    if (done.has(id)) return;
    const task = live.get(id);
    if (!task) throw Error('依赖的任务不存在或已删除');
    visiting.add(id);
    for (const dependency of strings(task.blockedBy, 'blocked_by')) visit(dependency);
    visiting.delete(id); done.add(id);
  };
  for (const id of live.keys()) visit(id);
}
const unblocked = (tasks, task) => task.blockedBy.every(id => tasks.find(t => t.id === id)?.status === 'completed');
function view(tasks, task) {
  const overlaps = other => task.writeScopes.some(a => other.writeScopes.some(b => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')));
  return { ...structuredClone(task), ready: task.status === 'pending' && unblocked(tasks, task), writeScopeWarnings: tasks.filter(t => t.id !== task.id && t.status === 'in_progress' && overlaps(t)).map(t => `写入范围与 ${t.id} 重叠`) };
}
export class AgentTeam {
  constructor({ directory, context, members, emit = () => {} }) {
    this.file = path.join(directory, '.agent-team.json'); this.context = context; this.members = members; this.emit = emit;
    this.boards = {};
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !saved.boards || typeof saved.boards !== 'object' || Array.isArray(saved.boards)) throw Error('团队数据版本或结构无效');
      for (const board of Object.values(saved.boards)) {
        if (!board || typeof board.root !== 'string' || typeof board.enabled !== 'boolean' || !Number.isSafeInteger(board.nextId) || board.nextId < 1 || !Array.isArray(board.tasks) || board.tasks.length > 200) throw Error('团队任务数据无效');
        const ids = new Set();
        for (const task of board.tasks) {
          if (!task || typeof task.id !== 'string' || !/^task-[1-9][0-9]*$/.test(task.id) || ids.has(task.id) || !Number.isSafeInteger(task.revision) || task.revision < 1 || !statuses.has(task.status)) throw Error('团队任务身份或状态无效');
          if (Number(task.id.slice(5)) >= board.nextId || !Number.isSafeInteger(Number(task.id.slice(5))) || (task.ownerId !== undefined && (typeof task.ownerId !== 'string' || !task.ownerId.trim())) || (['in_progress', 'completed'].includes(task.status) && !task.ownerId)) throw Error('团队任务编号或负责人无效');
          ids.add(task.id); text(task.subject, 'subject', 200); text(task.description, 'description', 16000); scopes(task.writeScopes); strings(task.blockedBy, 'blocked_by');
        }
        graph(board.tasks);
      }
      this.boards = saved.boards;
    } catch (error) { if (error.code !== 'ENOENT') this.failure = '团队数据无法读取：' + error.message; }
  }
  board(ctx = this.context()) {
    const current = this.context();
    if (ctx.workspaceId !== current.workspaceId || ctx.workRoot !== current.workRoot) throw Error('团队属于另一个工作区');
    const board = this.boards[ctx.workspaceId];
    if (board && board.root !== ctx.workRoot) throw Error('团队工作目录已变化');
    return board || { root: ctx.workRoot, enabled: false, nextId: 1, tasks: [] };
  }
  snapshot() {
    const board = this.board();
    return { enabled: board.enabled, tasks: board.tasks.filter(t => t.status !== 'deleted').map(t => view(board.tasks, t)), ...(this.failure ? { failure: this.failure } : {}) };
  }
  commit(ctx, board) {
    if (this.failure) throw Error(this.failure);
    const next = { ...this.boards, [ctx.workspaceId]: board };
    atomicJson(this.file, { version: 1, boards: next }); this.boards = next;
    this.emit(this.snapshot());
  }
  select(enabled) {
    if (typeof enabled !== 'boolean') throw Error('enabled 必须是布尔值');
    const ctx = this.context(); this.commit(ctx, { ...this.board(ctx), enabled }); return this.snapshot();
  }
  access(ctx) {
    if (this.failure) throw Error(this.failure);
    const board = this.board(ctx);
    if (!board.enabled) throw Error('当前尚未建立智能体团队任务');
    if (!this.members().has(ctx.sessionId)) throw Error('调用方不属于当前团队');
    return board;
  }
  list(ctx) { const board = this.access(ctx); return board.tasks.filter(t => t.status !== 'deleted').map(t => view(board.tasks, t)); }
  get(ctx, id) { const board = this.access(ctx), task = board.tasks.find(t => t.id === id); if (!task) throw Error('共享任务不存在'); return view(board.tasks, task); }
  isLead(ctx) { return ctx.sessionId === this.context().sessionId; }
  create(ctx, input) {
    const board = this.isLead(ctx) ? this.board(ctx) : this.access(ctx);
    if (board.tasks.filter(t => t.status !== 'deleted').length >= 100) throw Error('最多保留 100 项共享任务');
    const task = { id: 'task-' + board.nextId, revision: 1, subject: text(input.subject, 'subject', 200), description: text(input.description, 'description', 16000), status: 'pending', blockedBy: strings(input.blocked_by || [], 'blocked_by'), writeScopes: scopes(input.write_scopes || []) };
    const tasks = [...board.tasks.filter(t => t.status !== 'deleted'), ...board.tasks.filter(t => t.status === 'deleted').slice(-99), task];
    graph(tasks); this.commit(ctx, { ...board, enabled: true, nextId: board.nextId + 1, tasks }); return view(tasks, task);
  }
  update(ctx, input) {
    const board = this.access(ctx), current = board.tasks.find(t => t.id === input.task_id);
    if (!current || current.status === 'deleted') throw Error('共享任务不存在或已删除');
    if (input.expected_revision !== current.revision) throw Error('任务 revision 已过期，请重新读取后更新');
    const lead = ctx.sessionId === this.context().sessionId, owner = current.ownerId === ctx.sessionId;
    const requireOwner = () => { if (!lead && !owner) throw Error('只有任务负责人或团队主代理可以修改此任务'); };
    const requireStatus = status => { if (current.status !== status) throw Error('当前任务状态不支持该操作'); };
    const task = { ...current, revision: current.revision + 1 };
    if (input.action === 'claim') {
      if (current.ownerId && !owner) throw Error('任务已由其他成员领取');
      requireStatus('pending'); if (!unblocked(board.tasks, current)) throw Error('任务依赖尚未完成');
      task.ownerId = ctx.sessionId; task.status = 'in_progress';
    } else if (input.action === 'reassign') {
      if (!lead) throw Error('只有团队主代理可以重新分配任务');
      if (!['pending', 'in_progress'].includes(current.status)) throw Error('只能重新分配待处理或进行中的任务');
      if (input.owner !== undefined && !this.members().has(input.owner)) throw Error('负责人不属于当前团队');
      if (input.owner !== undefined && !unblocked(board.tasks, current)) throw Error('任务依赖尚未完成');
      task.status = input.owner === undefined ? 'pending' : 'in_progress'; delete task.ownerId;
      if (input.owner !== undefined) task.ownerId = input.owner;
    } else {
      requireOwner();
      if (input.action === 'complete') { requireStatus('in_progress'); task.status = 'completed'; }
      else if (input.action === 'release' || input.action === 'reopen') { requireStatus(input.action === 'release' ? 'in_progress' : 'completed'); task.status = 'pending'; delete task.ownerId; }
      else if (input.action === 'edit') {
        if (input.subject === undefined && input.description === undefined && input.write_scopes === undefined) throw Error('edit 需要 subject、description 或 write_scopes');
        if (input.subject !== undefined) task.subject = text(input.subject, 'subject', 200);
        if (input.description !== undefined) task.description = text(input.description, 'description', 16000);
        if (input.write_scopes !== undefined) task.writeScopes = scopes(input.write_scopes);
      } else if (input.action === 'set_dependencies') task.blockedBy = strings(input.blocked_by, 'blocked_by');
      else if (input.action === 'delete') task.status = 'deleted';
      else throw Error('未知共享任务操作');
    }
    const tasks = board.tasks.map(t => t.id === task.id ? task : t);
    graph(tasks); this.commit(ctx, { ...board, tasks }); return view(tasks, task);
  }
}

export const TEAM_GUIDANCE = '【智能体团队】\n智能体团队已开启。使用 team_task_list/get/create/update 协作：先读取最新 revision，再领取已就绪的任务，完成后更新状态。主代理用 agent_spawn 创建成员、agent_message 通知；任务状态变化不会自动启动成员。将并行写入拆成不同 write_scopes，重叠警告不是权限或文件锁。主代理必须回收并核验子代理结果。';
