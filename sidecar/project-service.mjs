import { validateProject } from './projects.mjs';

export class ProjectService {
  constructor(sessions, authorizeFolder) { this.sessions = sessions; this.authorizeFolder = authorizeFolder; }
  assertIdle(s) {
    if (s.closing || s.launching) throw Error('会话或浏览器正在切换，请稍候');
    if (s.agent?.running || s.queue.length || s.goal?.status === 'active' || s.subagents.jobs.size)
      throw Error('请先停止任务、暂停目标并清空队列，再变更项目目录');
  }
  async transaction(fn) {
    if (this.sessions.projectsBusy) throw Error('项目正在更新，请稍候');
    this.sessions.projectsBusy = true;
    try { return await fn(); } finally { this.sessions.projectsBusy = false; }
  }
  async save(input, sessionId) {
    return this.transaction(async () => {
      const previous = input.id ? this.sessions.projects.get(input.id) : null;
      const affected = [...this.sessions.sessions.values()].filter(s => s.projectId === input.id && input.id);
      affected.forEach(s => this.assertIdle(s));
      const folders = [], keys = new Map();
      for (const f of input.folders || []) {
        const folder = f.grant
          ? this.sessions.workspaces.folder(this.authorizeFolder(f.grant, sessionId))
          : previous?.folders.find(x => x.id === f.id);
        if (!folder) throw Error('目录未授权，请通过文件夹选择器添加');
        this.sessions.workspaces.verify(folder);
        folders.push(folder); keys.set(f.key || f.id, folder.id);
      }
      if (input.primaryKey && !keys.has(input.primaryKey)) throw Error('主目录不属于当前项目');
      const primaryId = keys.get(input.primaryKey) || folders[0]?.id;
      validateProject({ name: input.name, folders, primaryId });
      for (const s of affected) { await s.terminals.closeAll(); await s.closeBrowser(); }
      for (const folder of folders) this.sessions.workspaces.verify(folder);
      const project = this.sessions.projects.save({ id: input.id, name: input.name, folders, primaryId });
      for (const s of affected) s.setWorkspace(this.sessions.projects.workspace(project.id));
      this.sessions.broadcast('projects', this.sessions.projects.list());
      return project;
    });
  }
  async attach(sessionId, projectId) {
    return this.transaction(() => this.attachNow(sessionId, projectId));
  }
  async attachNow(sessionId, projectId) {
    const s = this.sessions.get(sessionId); this.assertIdle(s);
    if (!projectId) throw Error('每个会话必须归属项目，请选择目标项目');
    const next = this.sessions.projects.workspace(projectId);
    this.sessions.workspaces.verify(next);
    await s.terminals.closeAll(); await s.closeBrowser();
    s.setWorkspace(next);
    return s.info();
  }
  async remove(id, { targetId, deleteSessions = false } = {}) {
    const result = await this.transaction(async () => {
      this.sessions.projects.get(id);
      const affected = [...this.sessions.sessions.values()].filter(s => s.projectId === id);
      affected.forEach(s => this.assertIdle(s));
      if (targetId === id) throw Error('请选择其他项目');
      if (affected.length && !targetId && !deleteSessions) throw Error('请选择迁移会话的项目，或明确删除项目内会话');
      if (targetId) this.sessions.workspaces.verify(this.sessions.projects.workspace(targetId));
      for (const s of affected) {
        if (targetId) await this.attachNow(s.id, targetId);
        else await this.sessions.delete(s.id, { projectRemoval: true });
      }
      this.sessions.projects.remove(id);
      this.sessions.broadcast('projects', this.sessions.projects.list());
      return this.sessions.projects.list();
    });
    return result;
  }
  async move(id, beforeId) {
    return this.transaction(async () => {
      const list = this.sessions.projects.move(id, beforeId);
      this.sessions.broadcast('projects', list);
      return list;
    });
  }
  start() {
    this.stopped = false;
    this.observed = new Map();
    this.timer = setInterval(() => this.checkDirectories().catch(() => {}), 1500);
    this.timer.unref();
  }
  stop() { this.stopped = true; clearInterval(this.timer); }
  async checkDirectories() {
    if (this.stopped || this.checking || this.sessions.projectsBusy) return;
    this.checking = true;
    try { return await this.transaction(async () => {
      let changed = false;
      for (const project of this.sessions.projects.list()) {
        if (this.observed?.get(project.id) === project.availability) continue;
        this.observed ||= new Map(); this.observed.set(project.id, project.availability); changed = true;
        if (project.availability !== 'ready') {
          for (const session of this.sessions.sessions.values()) if (session.projectId === project.id) {
            session.interrupt(); await session.terminals.closeAll(); await session.closeBrowser();
          }
        }
      }
      if (changed) { this.sessions.broadcast('projects', this.sessions.projects.list()); this.sessions.emitList(); }
      return this.sessions.projects.list();
    });
    } finally { this.checking = false; }
  }
}
