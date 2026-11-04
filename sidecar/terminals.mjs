// A user-operated terminal has a workspace lease and an explicit host permission.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolveIn } from './paths.mjs';
import { TerminalSanitizer } from './terminal-sanitize.mjs';
import { BoundedTextBuffer } from './terminal-buffer.mjs';
import { readTerminalPage } from './terminal-output.mjs';
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
  snapshot(id) { const t = this.get(id); t.flush?.(); return { id, status: t.status, output: t.output, outputOffset: (t.totalOutput || t.output.length) - t.output.length, sequence: t.sequence, cwd: t.cwd, pid: t.job.pid, exitCode: t.exitCode ?? null }; }
  agentSnapshot(id) { const t = this.get(id), clean = t.transcript.snapshot(); return { id, status: t.status, output: clean.text, outputOffset: t.cleanTotal - clean.text.length, truncated: clean.truncated, cwd: t.cwd, pid: t.job.pid, exitCode: t.exitCode ?? null, protocolPending: t.job.protocolPending === true, inputWaiting: t.job.foreground?.inputWaiting === true, foreground: t.job.foreground || null }; }
  inspectForeground(id) { const t=this.get(id); if(t.status==='running'&&!t.job.protocolPending)return t.job.inspectForeground?.(); }
  async signalForeground(id, signal) { const t=this.get(id); if(t.status!=='running')throw Error('终端已退出'); if(process.platform==='win32'&&['SIGKILL','SIGTSTP','SIGHUP'].includes(signal))throw Error('此 Windows 后端不支持该信号；结束 shell 请关闭终端'); const target=await t.job.signalForeground(signal); return {delivered:true,mechanism:process.platform==='win32'?'windows-console':'posix-foreground',targetPgid:target?.processGroupId||(process.platform==='win32'?t.job.pid:null)}; }
  read(id, options = {}) { return readTerminalPage(this.get(id).transcript.snapshot(), options); }
  async open({ id, cols, rows, cwd, agentOwned = false, name, signal }) {
    signal?.throwIfAborted();
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw Error('终端ID无效');
    if (this.entries.get(id)?.status === 'running') return this.snapshot(id);
    if (this.pending.has(id)) return this.pending.get(id).promise;
    if (!this.entries.has(id) && this.entries.size + this.pending.size >= 8) throw Error('每个会话最多打开8个终端');
    const s = this.session, workspace = this.context(), controller = new AbortController(), mode = s.mode;
    const directory = resolveIn(workspace.root, cwd || '.');
    if (!fs.statSync(directory).isDirectory()) throw Error('终端工作目录不是文件夹');
    const onAbort = () => controller.abort(signal.reason); signal?.addEventListener('abort', onAbort, { once: true });
    const promise = (async () => {
      if (mode !== 'full-access') {
        const allowed = await s.approve({ name: 'terminal.open', category: 'shell', canRemember: false, scopeKey: crypto.randomUUID(), isolated: false,
          summary: agentOwned ? '为 Agent 打开本机持久终端。后续命令会单独检查授权。' : '打开由你输入命令的本机交互终端。终端以当前系统用户权限运行，可访问目录外的文件与网络。', command: process.platform === 'win32' ? 'PowerShell（交互式）' : 'Bash（交互式）', cwd: directory }, controller.signal, { detached: !agentOwned });
        if (!allowed) throw Error('未批准启动终端');
      }
      controller.signal.throwIfAborted(); this.context();
      if (s.mode !== mode || s.workspace.id !== workspace.id || s.workspace.revision !== workspace.revision || s.workspace.root !== workspace.root) throw Error('工作目录或权限已变化，请重新打开终端');
      const { executor } = await import('./executor.mjs');
      controller.signal.throwIfAborted();
      const verify = () => { this.context(); if (s.mode !== mode || s.workspace.id !== workspace.id || s.workspace.revision !== workspace.revision) throw Error('工作目录或权限已变化'); };
      const job = await executor.startTerminal({ cwd: directory, dataDir: s.projectDir, cols: geometry(cols, agentOwned ? 160 : 80, 500), rows: geometry(rows, agentOwned ? 40 : 24, 200), agentOwned }, { signal: controller.signal, verify });
      if (controller.signal.aborted) { job.kill(); await job.done; throw Error('终端启动已取消'); }
      const item = { job, cwd: directory, name, agentOwned, output: '', totalOutput: 0, buffered: '', timer: null, sequence: 0, status: 'running', workspace, sanitizer: new TerminalSanitizer(256 * 1024), transcript: new BoundedTextBuffer(4 * 1024 * 1024, 10000), cleanTotal: 0 };
      this.entries.set(id, item);
      item.flush = () => { clearTimeout(item.timer); item.timer = null; if (!item.buffered || this.entries.get(id) !== item) return; const data = item.buffered; item.buffered = ''; s.emit('terminal-output', { id, sequence: ++item.sequence, data }); };
      job.onData(data => { if (this.entries.get(id) !== item) return; const clean = item.sanitizer.push(data).text; item.cleanTotal += clean.length; item.transcript.append(clean); item.totalOutput += data.length; item.output = (item.output + data).slice(-500000); item.buffered = (item.buffered + data).slice(-128000); if (!item.timer) item.timer = setTimeout(item.flush, 40); });
      job.onExit(({ exitCode }) => { const clean = item.sanitizer.flush(); item.cleanTotal += clean.length; item.transcript.append(clean); item.flush(); item.status = 'exited'; item.exitCode = exitCode; s.emit('terminal-exit', { id, exitCode }); });
      return this.snapshot(id);
    })().finally(() => { this.pending.delete(id); signal?.removeEventListener('abort', onAbort); });
    this.pending.set(id, { controller, promise }); return promise;
  }
  input(id, data) { this.verifyInput(id, data); const t = this.get(id); if (t.agentOwned) throw Error('Agent 终端需要经命令授权入口输入'); t.job.write(data).catch(error => this.session.emit('terminal-error', { id, message: error.message })); return true; }
  verifyInput(id, data) { this.context(); const t = this.get(id); if (t.status !== 'running' || t.workspace.id !== this.session.workspace.id || t.workspace.revision !== this.session.workspace.revision) throw Error('终端已失效'); if (typeof data !== 'string' || data.length > 65536) throw Error('终端输入过长'); return t; }
  async writeAgent(id, data, signal, command = data) {
    signal?.throwIfAborted(); const t = this.verifyInput(id, data), mode = this.session.mode;
    if (!t.agentOwned) throw Error('不能驱动其他所有者的终端');
    if (mode !== 'full-access') {
      const allowed = await this.session.approve({ name: 'terminal.send', category: 'shell', scopeKey: crypto.randomUUID(), canRemember: false, isolated: false,
        summary: '在 Agent 的本机持久终端中执行以下输入。', command, code: data, cwd: t.cwd }, signal);
      if (!allowed) throw Error('未批准终端输入，命令没有执行');
    }
    signal?.throwIfAborted(); if (this.session.mode !== mode || this.verifyInput(id, data) !== t) throw Error('终端或权限已变化');
    await t.job.write(data);
  }
  async interrupt(id) { const t = this.get(id); if (t.status === 'running') await (t.job.interrupt ? t.job.interrupt() : t.job.write('\x03')); }
  resize(id, cols, rows) { const t = this.get(id); if (t.status === 'running') t.job.resize(geometry(cols, 80, 500), geometry(rows, 24, 200)); return true; }
  async close(id) { const pending = this.pending.get(id); pending?.controller.abort(); await pending?.promise.catch(() => {}); const t = this.entries.get(id); if (!t) return; clearTimeout(t.timer); this.entries.delete(id); t.job.kill(); await t.job.done; }
  cancelAll() { for (const p of this.pending.values()) p.controller.abort(); for (const t of this.entries.values()) t.job.kill(); }
  async closeAll() { this.cancelAll(); await Promise.allSettled([...this.pending.values()].map(p => p.promise)); await Promise.all([...this.entries.keys()].map(id => this.close(id))); }
}
