// A user-operated terminal has a workspace lease and an explicit host permission.
import crypto from 'node:crypto';
const geometry = (n, fallback, max) => Number.isInteger(n) ? Math.max(2, Math.min(n, max)) : fallback;
export class SessionTerminals {
  constructor(session) { this.session = session; this.entries = new Map(); this.pending = new Map(); }
  context() {
    const s = this.session;
    if (s.closing || s.mgr.projectsBusy) throw Error('会话或工作目录正在切换');
    if (s.mode === 'read-only') throw Error('只读权限不能启动或输入终端');
    s.mgr.workspaces.verify(s.workspace);
    return { ...s.workspace };
  }
  get(id) { const item = this.entries.get(id); if (!item) throw Error('终端不存在或已结束，请重新启动'); return item; }
  snapshot(id) { const t = this.get(id); t.flush?.(); return { id, status: t.status, output: t.output, sequence: t.sequence, cwd: t.cwd, exitCode: t.exitCode ?? null }; }
  async open({ id, cols, rows }) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw Error('终端ID无效');
    if (this.entries.get(id)?.status === 'running') return this.snapshot(id);
    if (this.pending.has(id)) return this.pending.get(id).promise;
    if (!this.entries.has(id) && this.entries.size + this.pending.size >= 8) throw Error('每个会话最多打开8个终端');
    const s = this.session, workspace = this.context(), controller = new AbortController(), mode = s.mode;
    const promise = (async () => {
      if (mode !== 'full-access') {
        const allowed = await s.approve({ name: 'terminal.open', category: 'shell', canRemember: false, scopeKey: crypto.randomUUID(), isolated: false,
          summary: '打开由你输入命令的本机交互终端。终端以当前系统用户权限运行，可访问目录外的文件与网络。', command: process.platform === 'win32' ? 'PowerShell（交互式）' : 'Bash（交互式）', cwd: workspace.root }, controller.signal, { detached: true });
        if (!allowed) throw Error('未批准启动终端');
      }
      controller.signal.throwIfAborted(); this.context();
      if (s.mode !== mode || s.workspace.id !== workspace.id || s.workspace.revision !== workspace.revision || s.workspace.root !== workspace.root) throw Error('工作目录或权限已变化，请重新打开终端');
      const { executor } = await import('./executor.mjs');
      controller.signal.throwIfAborted();
      const verify = () => { this.context(); if (s.mode !== mode || s.workspace.id !== workspace.id || s.workspace.revision !== workspace.revision) throw Error('工作目录或权限已变化'); };
      const job = await executor.startTerminal({ cwd: workspace.root, dataDir: s.projectDir, cols: geometry(cols, 80, 500), rows: geometry(rows, 24, 200) }, { signal: controller.signal, verify });
      if (controller.signal.aborted) { job.kill(); await job.done; throw Error('终端启动已取消'); }
      const item = { job, cwd: workspace.root, output: '', buffered: '', timer: null, sequence: 0, status: 'running', workspace };
      this.entries.set(id, item);
      item.flush = () => { clearTimeout(item.timer); item.timer = null; if (!item.buffered || this.entries.get(id) !== item) return; const data = item.buffered; item.buffered = ''; s.emit('terminal-output', { id, sequence: ++item.sequence, data }); };
      job.onData(data => { if (this.entries.get(id) !== item) return; item.output = (item.output + data).slice(-500000); item.buffered = (item.buffered + data).slice(-128000); if (!item.timer) item.timer = setTimeout(item.flush, 40); });
      job.onExit(({ exitCode }) => { item.flush(); item.status = 'exited'; item.exitCode = exitCode; s.emit('terminal-exit', { id, exitCode }); });
      return this.snapshot(id);
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, { controller, promise }); return promise;
  }
  input(id, data) { this.context(); const t = this.get(id); if (t.status !== 'running' || t.workspace.id !== this.session.workspace.id || t.workspace.revision !== this.session.workspace.revision) throw Error('终端已失效'); if (typeof data !== 'string' || data.length > 65536) throw Error('终端输入过长'); t.job.write(data); return true; }
  resize(id, cols, rows) { const t = this.get(id); if (t.status === 'running') t.job.resize(geometry(cols, 80, 500), geometry(rows, 24, 200)); return true; }
  async close(id) { const pending = this.pending.get(id); pending?.controller.abort(); await pending?.promise.catch(() => {}); const t = this.entries.get(id); if (!t) return; clearTimeout(t.timer); this.entries.delete(id); t.job.kill(); await t.job.done; }
  cancelAll() { for (const p of this.pending.values()) p.controller.abort(); for (const t of this.entries.values()) t.job.kill(); }
  async closeAll() { this.cancelAll(); await Promise.allSettled([...this.pending.values()].map(p => p.promise)); await Promise.all([...this.entries.keys()].map(id => this.close(id))); }
}
