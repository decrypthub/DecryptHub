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
      for (const s of affected) await s.closeBrowser();
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
    let next;
    if (projectId) next = this.sessions.projects.workspace(projectId);
    else { next = { ...s.workspace }; delete next.projectId; delete next.projectRevision; delete next.roots; }
    if (next.kind !== 'unselected') this.sessions.workspaces.verify(next);
    await s.closeBrowser();
    if (next.kind === 'unselected') { s.projectId = null; s.workspace = next; s.saveState(); this.sessions.emitList(); }
    else s.setWorkspace(next);
    return s.info();
  }
  async remove(id) {
    return this.transaction(async () => {
      const affected = [...this.sessions.sessions.values()].filter(s => s.projectId === id);
      affected.forEach(s => this.assertIdle(s));
      for (const s of affected) await this.attachNow(s.id, null);
      this.sessions.projects.remove(id);
      this.sessions.broadcast('projects', this.sessions.projects.list());
      return this.sessions.projects.list();
    });
  }
  async choose(sessionId, input) {
    return this.transaction(async () => {
      const s = this.sessions.get(sessionId); this.assertIdle(s);
      const next = input.managed ? null : this.sessions.workspaces.folder(this.authorizeFolder(input.grant, s.id));
      await s.closeBrowser(); return s.setWorkspace(next);
    });
  }
}
