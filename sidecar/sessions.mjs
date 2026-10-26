// Each chat owns private history/browser state and one selected or managed work root.
// 会话之间不共享任何可变状态，因此多个 Agent 可以真正并行；同一会话内的操作由 Agent.running 与 launch 锁串行化。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from './browser.mjs';
import { McpBridge } from './mcp.mjs';
import { Agent } from './agent.mjs';
import { DEFAULT_TOOLS } from './catalog.mjs';
import { wantEmbed } from './settings.mjs';
import { DEFAULT_TODOS, normalizeSteps } from './todos.mjs';
import { normalizeMode, normalizeReview, autoReview } from './policy.mjs';
import { validateAttachments } from './attachments.mjs';
import { workspaceFileSize, killAllJobs } from './workspace.mjs';
import { WorkspaceStore } from './workspaces.mjs';
import { ProjectStore } from './projects.mjs';
import { RunStore } from './runs.mjs';
import { ChangeStore, contentHash } from './changes.mjs';
import { executor } from './executor.mjs';
import { atomicJson, resolveIn } from './paths.mjs';
import { ResearchAgents } from './subagents.mjs';
import { ComponentStore } from './components.mjs';
import { promptTitle, cleanTitle, SessionTitleService } from './session-titles.mjs';

const MAX_SESSIONS = 100;

class Session {
  constructor(mgr, { id, title, titleSource, primary, lastUrl, updatedAt, pinned }) {
    this.mgr = mgr; this.id = id; this.title = title; this.primary = primary; this.lastUrl = lastUrl || '';
    this.titleSource = titleSource || (/^(?:会话\s*\d+|新对话|新会话)$/.test(title) ? 'placeholder' : 'manual');
    this.titleRevision = 0; this.titleController = null; this.titleJob = null; this.titleAttempted = false;
    this.pinned = !!pinned;
    // 侧栏要显示「19 分钟前」这类相对时间：记录最后一次有活动的时刻并随会话表持久化
    this.updatedAt = Number(updatedAt) || Date.now();
    this.projectDir = path.join(mgr.userDataDir, 'projects', primary ? 'default' : id);
    fs.mkdirSync(this.projectDir, { recursive: true });
    const emit = (ch, p) => mgr.broadcast(ch, p, this.id);
    this.browser = new BrowserManager({ components: mgr.components, getRoot: () => mgr.workspaces.verify(this.workspace), dataDir: this.projectDir, kernelDir: mgr.userDataDir });
    this.mcp = new McpBridge(m => emit('log', String(m)), this.browser);
    this.agent = null; this.launching = null; this.lastGoal = null;
    this.browser.on('status', s => { emit('browser-status', s); mgr.emitList(); });
    this.browser.on('requests', l => emit('requests', l));
    this.browser.on('requests-cleared', () => emit('requests-cleared', true));
    this.browser.on('script', s => emit('script', { id: s.id, url: s.url, size: s.size, file: s.file }));
    this.browser.on('frame', f => { if (mgr.focusedId === this.id) emit('frame', f); });
    this.browser.on('log', m => emit('log', m));
    this.browser.on('download-progress', value => mgr.broadcast('download-progress',value));
    this.browser.on('debugger-state', value => { this.debuggerPaused=!!value.paused; emit('agent-debugger-state',value); });
    this.browser.on('closed', () => { this.debuggerPaused = false; emit('agent-debugger-state', { paused: false }); emit('browser-status', { running: false, pages: [] }); this.mcp.stop(); mgr.emitList(); });
    this.emit = emit;
    this.pending = new Map(); this.apSeq = 0;
    this.askPending = new Map(); this.askSeq = 0;
    const st = this.loadState();
    this.mode = st.mode === 'full-access' ? 'standard' : normalizeMode(st.mode);
    this.review = normalizeReview(st.review);
    this.workspace = mgr.workspaces.restore(st.workspace, id, this.projectDir);
    this.projectId = st.projectId || this.workspace.projectId || null;
    if (this.projectId) {
      try { this.workspace = mgr.projects.workspace(this.projectId); }
      catch { this.projectId = null; delete this.workspace.projectId; delete this.workspace.roots; }
    }
    this.readHashes = new Map(); this.changes = new ChangeStore(this.projectDir);
    this.runs = new RunStore(this.projectDir, event => this.emit('run-event', event), { sessionId: this.id });
    this.activeRun = null; this.queue = Array.isArray(st.queue) ? st.queue.slice(0, 10) : []; this.completion = null; this.closing = false;
    // 「本会话始终允许」只在这次运行的内存里有效。磁盘上的旧 allows 不恢复。
    this.allows = new Set();
    this.todos = this.readTodos(st.todos);
    this.goal = st.goal ? { ...st.goal, ...(st.goal.status === 'active' ? { status: 'paused', summary: '上次运行已中断，可手动继续目标。' } : {}) } : null;
    this.subagents = new ResearchAgents({ directory: this.projectDir, context: () => this.toolCtx(), settings: () => this.mgr.getSettings(), onUsage: record => {
      if (record.goalKey && this.goal && record.goalKey === this.goal.id + ':' + this.goal.batchId) {
        this.goal.usedTokens = (this.goal.usedTokens || 0) + (record.usage?.prompt || 0) + (record.usage?.completion || 0);
        if (this.goal.status === 'active' && this.goal.tokenBudget > 0 && this.goal.usedTokens >= this.goal.tokenBudget) { this.goal.status = 'paused'; this.agent?.finishSoon(); }
        this.saveState(); this.emit('goal', this.goal);
      }
    }, emit: jobs => this.emit('subagents', jobs.filter(j => j.workspaceId === this.workspace.id)) });
  }
  stateFile() { return path.join(this.projectDir, '.agent-state.json'); }
  loadState() { try { return JSON.parse(fs.readFileSync(this.stateFile(), 'utf8')); } catch { return {}; } }
  readTodos(raw) {
    try { if (Array.isArray(raw) && raw.length) return normalizeSteps(raw); } catch {}
    return [];
  }
  saveState() {
    atomicJson(this.stateFile(), { mode: this.mode === 'full-access' ? 'standard' : this.mode, review: this.review, todos: this.todos, workspace: this.workspace, projectId: this.projectId, queue: this.queue, goal: this.goal });
  }
  setTodos(list) { this.todos = list; this.saveState(); this.emit('agent-todos', this.todos); }
  setMode(mode, review) {
    if (this.agent?.running) throw new Error('请先停止当前任务，再切换权限');
    for (const p of this.pending.values()) p.finish(false);
    killAllJobs(this.projectDir);
    this.allows.clear();
    this.mode = normalizeMode(mode);
    this.review = normalizeReview(review);
    this.saveState();
    this.emit('agent-mode', { mode: this.mode, review: this.review });
    this.mgr.emitList();
    return this.publicState();
  }
  setPinned(v) {
    this.pinned = !!v;
    this.mgr.emitList();
    return this.info();
  }
  publicState() { return { mode: this.mode, review: this.review, todos: this.todos, workspace: this.workspace, run: this.runs.latest(), queue: this.queue.length, debuggerPaused: !!this.debuggerPaused, goal: this.goal, subagents: this.subagents?.list(this.workspace.id) || [], approvals: [...this.pending.values()].map(p => p.request), questions: [...this.askPending.values()].map(p => p.request) }; }
  rename(title) {
    const next = Array.from(String(title || '').trim()).slice(0, 40).join('');
    if (!next) throw new Error('会话名称不能为空');
    this.titleRevision++; this.titleController?.abort(); this.title = next; this.titleSource = 'manual'; this.mgr.emitList(); return this.info();
  }
  suggestTitle(prompt) {
    if (!['placeholder', 'prompt'].includes(this.titleSource) || !String(prompt || '').trim()) return this.titleJob;
    this.titlePrompt ||= String(prompt);
    if (this.titleSource === 'placeholder') { this.title = promptTitle(this.titlePrompt); this.titleSource = 'prompt'; this.mgr.emitList(); }
    const settings = this.mgr.getSettings(), cfg = settings.provider === 'anthropic' ? settings.anthropic : settings.openai;
    if (this.titleAttempted || !cfg?.apiKey) return this.titleJob;
    this.titleAttempted = true;
    const revision = ++this.titleRevision, controller = new AbortController(); this.titleController = controller;
    this.titleJob = Promise.resolve().then(() => this.mgr.titleGenerator(settings, this.titlePrompt, { signal: controller.signal })).then(value => {
      const title = cleanTitle(value);
      if (title && !this.closing && this.mgr.sessions.get(this.id) === this && revision === this.titleRevision && !controller.signal.aborted) { this.title = title; this.titleSource = 'model'; this.mgr.emitList(); }
    }).catch(() => { /* A title failure never fails or retries the user's task. */ }).finally(() => { if (this.titleController === controller) this.titleController = null; });
    return this.titleJob;
  }
  setWorkspace(binding) {
    if (this.closing || this.mgr.sessions.get(this.id) !== this) throw new Error('会话已关闭，不能更换目录');
    if (this.browser.client || this.browser.starting) throw new Error('请先关闭浏览器，再更换文件夹');
    if (this.agent?.running) throw new Error('请先停止当前任务，再更换文件夹');
    if (this.subagents.jobs.size) throw new Error('请先等待或取消研究子代理，再更换文件夹');
    if (this.goal?.status === 'active') throw new Error('请先暂停当前目标，再更换文件夹');
    if (this.queue.length) throw new Error('请先完成或清空队列，再更换文件夹');
    const next = binding || this.mgr.workspaces.managed(this.id, this.projectDir);
    this.mgr.workspaces.verify(next);
    for (const p of this.pending.values()) p.finish(false);
    killAllJobs(this.projectDir); this.allows.clear(); this.readHashes.clear();
    this.workspace = next; this.projectId = next.projectId || null; this.saveState(); this.emit('subagents', this.subagents.list(this.workspace.id));
    this.agent?.hist.append({ t: 'user', content: `【工作区已切换】${this.workspace.root}。后续文件操作以此目录为准，旧产出不自动迁移。` });
    this.agent?.persist(); this.emit('workspace', this.workspace); this.mgr.emitList(); return this.publicState();
  }
  async execute(spec, signal) {
    if (this.mode === 'read-only') throw new Error('只读权限禁止执行代码');
    this.mgr.workspaces.verify(this.workspace);
    if (signal?.aborted) throw new Error('任务已取消');
    const network = [...new Set(spec.network || [])];
    if (network.some(h => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?$/i.test(h))) throw new Error('联网范围必须是明确域名，不能使用通配符');
    const capability = await executor.probe(); const isolated = this.mode !== 'full-access' && capability.available;
    const scopeKey = contentHash(JSON.stringify({ file: spec.file, args: spec.args, input: spec.input, guardFiles: spec.guardFiles, cwd: spec.cwd, network, workspace: this.workspace, isolated }));
    if ((!isolated && this.mode !== 'full-access') || (network.length && this.mode !== 'full-access')) {
      const ok = await this.approve({ name: 'process.exec', category: 'shell', scopeKey, canRemember: isolated,
        summary: isolated ? '此命令申请访问以下网络目的地。' : '执行隔离不可用。允许后，此命令将以当前系统用户权限运行，可访问工作文件夹以外的文件和网络。',
        command: [spec.file, ...(spec.args || [])].join('\n'), cwd: spec.cwd, isolated, network,
        code: spec.preview || spec.input || '', trustedPurpose: spec.trustedPurpose }, signal);
      if (!ok) throw new Error('用户未批准执行，命令没有启动');
    }
    if (signal?.aborted) throw new Error('任务已取消');
    this.mgr.workspaces.verify(this.workspace);
    for (const entry of spec.guardFiles || []) {
      resolveIn(this.workspace.root, path.relative(this.workspace.root, entry.file));
      if (contentHash(fs.readFileSync(entry.file, 'utf8')) !== entry.hash) throw new Error('脚本在审批期间已变化，请重新读取并执行');
    }
    const invocationId = crypto.randomUUID();
    if (this.activeRun) this.runs.event(this.activeRun.id, 'process-starting', { invocationId, file: spec.file, args: spec.args, cwd: spec.cwd, isolated, network });
    const job = executor.start(spec, { signal, isolated, workspace: this.workspace, dataDir: this.projectDir, protectedRoot: this.mgr.userDataDir, network });
    if (this.activeRun) { const run = this.activeRun; job.done.then(r => this.runs.event(run.id, 'process-completed', { invocationId, code: r.code, reason: r.reason || null })); }
    return job;
  }
  async approve(req, signal) {
    if (signal?.aborted) return false;
    if (this.mode === 'full-access') return true;
    if (req.canRemember && this.allows.has(req.scopeKey)) return true;
    if (this.review === 'auto') {
      const review = autoReview(req);
      if (this.activeRun) this.runs.event(this.activeRun.id, 'approval-reviewed', { name: req.name, scopeKey: req.scopeKey, review });
      if (review.allow) return true;
    }
    if (this.activeRun?.source === 'automation') { this.permissionBlocked = true; this.runs.event(this.activeRun.id, 'permission-needed', { request: req }); return false; }
    const id = crypto.randomUUID();
    return await new Promise(resolve => {
      let settled = false;
      const finish = (allow) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); this.pending.delete(id); this.emit('approval-resolved', { id, allow: !!allow }); if (this.activeRun) this.runs.status(this.activeRun, 'running'); resolve(!!allow); };
      const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
      const onAbort = () => finish(false);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      timer.unref?.();
      const request = { ...req, id, expiresAt: Date.now() + 5 * 60 * 1000, workspace: this.workspace.root };
      this.pending.set(id, { finish, request });
      if (this.activeRun) this.runs.status(this.activeRun, 'waiting_approval');
      this.emit('agent-approval', request);
    });
  }
  replyApproval(id, { allow, always } = {}) {
    const p = this.pending.get(String(id || ''));
    if (!p) return false;
    if (allow && always && p.request.canRemember && p.request.scopeKey) this.allows.add(p.request.scopeKey);
    p.finish(!!allow);
    return true;
  }
  /** 模型主动向用户提问：等界面回答；用户跳过/超时/中断都返回空串（让模型自行决定） */
  async ask(req, signal) {
    if (signal?.aborted || this.activeRun?.source === 'automation') { this.permissionBlocked = true; return ''; }
    const id = 'q' + (++this.askSeq);
    return await new Promise(resolve => {
      let settled = false;
      const finish = v => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); this.askPending.delete(id); this.emit('question-resolved', { id }); resolve(String(v ?? '')); };
      const timer = setTimeout(() => finish(''), 10 * 60 * 1000);
      const onAbort = () => finish('');
      signal?.addEventListener?.('abort', onAbort, { once: true });
      timer.unref?.();
      this.askPending.set(id, { finish, request: { ...req, id } });
      this.emit('agent-question', { id, question: req.question, detail: req.detail || '', options: req.options || [], kind: req.kind || 'question', todos: this.todos });
    });
  }
  answerAsk(id, answer) {
    const p = this.askPending.get(String(id || ''));
    if (!p) return false;
    p.finish(answer);
    return true;
  }
  info() {
    const live = this.browser.activePage ? safe(() => this.browser.activePage.url()) : '';
    if (/^https?:/.test(live)) this.lastUrl = live;
    const url = live || this.lastUrl;
    return { id: this.id, title: this.title, primary: this.primary, pinned: !!this.pinned, running: this.browser.running, embed: this.browser.embedActive, chromePid: this.browser.embedActive ? this.browser.chromePid : null, agentRunning: !!this.agent?.running, url, projectDir: this.projectDir, mode: this.mode, review: this.review, workspace: this.workspace, projectId: this.projectId, run: this.runs.latest(), queued: this.queue.length, updatedAt: this.updatedAt };
  }
  toolCtx() {
    if (this.mgr.projectsBusy) throw new Error('正在更新项目目录，请稍候');
    this.mgr.workspaces.verify(this.workspace);
    return {
      components: this.mgr.components, plugins:this.mgr.plugins, extensions: this.mgr.extensions, sessionId: this.id, projectId: this.projectId, projectRoots: this.workspace.roots || [], projectDir: this.projectDir, browser: this.browser, mcp: this.mcp, relaunch: o => this.relaunch(o),
      openBrowser: opts => this.browser.running ? this.browser.navigate(opts.url).then(() => ({ ok: true })) : this.launch(opts),
      ensureDebugger: () => this.ensureDebugger(),
      subagents: this.subagents, getGoal: () => this.goal, updateGoal: value => this.updateGoal(value),
      goalBudget: this.activeRun?.source === 'goal' && this.goal ? { key: this.goal.id + ':' + this.goal.batchId, ...(this.goal.tokenBudget > 0 ? { remaining: Math.max(0, this.goal.tokenBudget - (this.goal.usedTokens || 0)) } : {}) } : null,
      workRoot: this.workspace.root, workspaceId: this.workspace.id, workspaceKind: this.workspace.kind, mode: this.mode, protectedRoot: this.mgr.userDataDir,
      changes: this.changes, readHashes: this.readHashes, runId: this.activeRun?.id,
      exec: spec => this.execute(spec, this.agent?.abort?.signal),
      getTodos: () => this.todos, setTodos: list => this.setTodos(list),
      emit: (ev, payload) => this.emit('agent-' + ev, payload),
      ask: req => this.ask(req), compact: opts => this.agent ? this.agent.compress(opts) : { ok: false, error: 'agent 未就绪' },
    };
  }
  profileDir() { return this.primary ? path.join(this.mgr.userDataDir, 'chrome-profile') : path.join(this.mgr.userDataDir, 'profiles', this.id); }

  async ensureDebugger() {
    if (!this.browser.running) throw new Error('请先用 browser_open 打开网站');
    this.mgr.workspaces.verify(this.workspace);
    if (this.mcp.client && this.mcp.opts?.allowedRoot === this.workspace.root && this.mcp.opts?.cdpPort === this.browser.cdpPort) return;
    if (!this.debugStarting) this.debugStarting = this.mcp.start({ cdpPort: this.browser.cdpPort, allowedRoot: this.workspace.root, runtimeDir: path.join(this.projectDir, '.debugger') }).finally(() => { this.debugStarting = null; });
    await this.debugStarting;
  }

  async launch({ isolated, url } = {}) {
    if (this.workspace.kind === 'unselected') return { ok: false, code: 'workspace-required', error: '请先选择工作目录，或选择“不在目录中工作”' };
    if (this.mgr.projectsBusy) return { ok: false, error: '正在更新项目目录，请稍候' };
    if (!this.browser.running && [...this.mgr.sessions.values()].filter(s => s.browser.running).length >= 6) return { ok: false, error: '最多同时打开 6 个浏览器' };
    if (this.launching) return this.launching;
    this.launching = (async () => { try {
      const settings = this.mgr.getSettings();
      const result = await this.browser.launch({ ...settings, profileDir: this.profileDir(), isolated: isolated ?? (this.primary ? settings.isolated : true), embed: wantEmbed(settings), url });
      if (!result.ok) return result;
      this.ensureAgent().localTools = DEFAULT_TOOLS; this.agent.emitContext();
      if (this.mgr.focusedId === this.id) await this.browser.startScreencast().catch(() => {});
      this.mgr.emitList(); return { ...result, toolCount: DEFAULT_TOOLS.length };
    } catch (error) { this.emit('log', 'WDH: ' + error.message); return { ok: false, error: error.message }; }
    finally { this.launching = null; } })(); return this.launching;
  }
  // 对话历史与浏览器解耦：未打开浏览器也能查看用量、压缩、清空（每个会话标签独立，落盘到项目目录）
  ensureAgent() {
    if (!this.agent) {
      this.agent = new Agent({ mcp: this.mcp, mcpHost: this.mgr.mcpHost, browser: this.browser, projectDir: this.projectDir,
        getSettings: this.mgr.getSettings, tools: DEFAULT_TOOLS.filter(tool => !tool.component || (this.mgr.components.info().installed && this.mgr.components.info().enabled)),
        emit: (ev, p) => { if (ev === 'debugger-state') this.debuggerPaused = !!p.paused; this.emit('agent-' + ev, p); if (ev === 'done' || ev === 'user') this.mgr.emitList(); },
        getToolContext: () => this.toolCtx(), getWorkspace: () => this.workspace,
        record: (type, value) => { if (this.activeRun) this.runs.event(this.activeRun.id, type, value); },
        relaunch: o => this.relaunch(o), getMode: () => this.mode, approve: (req, signal) => this.approve(req, signal),
        ask: (req, signal) => this.ask(req, signal), getTodos: () => this.todos, setTodos: list => this.setTodos(list),
        currentUrl: () => { try { return this.browser.activePage?.url() || this.lastUrl || ''; } catch { return ''; } },
        fileSize: rel => workspaceFileSize(this.toolCtx(), rel) }); this.agent.restore();
      const first = this.agent.hist.events.find(e => e.t === 'user' && !String(e.content || '').startsWith('【'));
      if (first) this.suggestTitle(first.displayContent ?? first.content);
    }
    return this.agent;
  }
  async relaunch({ isolated = true, url } = {}) {
    const r = await this.launch({ isolated, url: undefined });
    if (!r.ok) throw new Error(r.error);
    this.emit('log', '已用全新隔离 Profile 重启浏览器：' + this.browser.profileDir);
    if (url && /^https?:/.test(url)) { await this.browser.navigate(url); await new Promise(r => setTimeout(r, 6000)); }
    return { profileDir: this.browser.profileDir, requests: this.browser.requests.length, toolCount: r.toolCount };
  }
  send({ text = '', auto, maxSteps, tokenBudget, attachments, source = 'user', enqueue = false }) {
    if (this.workspace.kind === 'unselected') return { ok: false, code: 'workspace-required', error: '请先选择工作文件夹，或明确选择“不在目录中工作”' };
    if (this.mgr.projectsBusy) return { ok: false, error: '正在更新项目目录，请稍候' };
    if (this.mgr.plugins?.applying) return { ok:false, error:'正在切换插件，请稍后发送任务' };
    if (source === 'user' && this.goal?.status === 'active') source = 'goal';
    const s = this.mgr.getSettings();
    try { attachments = validateAttachments(this.projectDir, attachments || [], { workRoot: this.workspace.root, vision: !!((s.provider === 'anthropic' ? s.anthropic : s.openai) || {}).vision }); }
    catch (e) { return { ok: false, error: e.message }; }
    // 通用 Agent：不依赖浏览器。浏览器只是可选工具，会话里没有页面也能对话。
    const agent = this.ensureAgent();
    if (!agent) return { ok: false, error: '会话未就绪' };
    if (agent.running) {
      if (!enqueue) return { ok: false, code: 'busy', error: '该会话正在运行，可以将消息加入下一轮队列' };
      if (this.queue.length >= 10) return { ok: false, error: '队列最多保留 10 条消息' };
      this.queue.push({ text, auto, maxSteps, tokenBudget, attachments, source }); this.saveState(); this.mgr.emitList(); return { ok: true, queued: true };
    }
    // 前端保存时会把当前渠道镜像进 openai/anthropic；这里再兜一层，避免渠道密钥还没同步时误报
    const active = (s.providers || []).find(p => p.id === s.activeProviderId);
    const key = active?.apiKey || (s.provider === 'anthropic' ? s.anthropic?.apiKey : s.openai?.apiKey);
    if (!key) return { ok: false, code: 'model-required', error: '尚未配置 API Key，请在「设置」页填写' };
    let release; try { release = this.mgr.workspaces.acquire(this.workspace, this.id, this.mode !== 'read-only'); }
    catch (e) { return { ok: false, error: e.message }; }
    if (source === 'goal' && this.goal?.status === 'active') { this.goal.turns++; if (this.goal.tokenBudget > 0) tokenBudget = Math.min(tokenBudget || Infinity, Math.max(1, this.goal.tokenBudget - (this.goal.usedTokens || 0))); this.saveState(); this.emit('goal', this.goal); }
    const goalId = source === 'goal' ? this.goal?.id : null;
    this.permissionBlocked = false;
    const run = this.runs.start({ workspace: this.workspace, mode: this.mode, text, source }); this.activeRun = run;
    this.lastGoal = { text, auto };
    this.suggestTitle(text);
    this.updatedAt = Date.now(); this.mgr.emitList();
    const goalTimer = goalId && this.goal.deadline ? setTimeout(() => agent.finishSoon(), Math.max(1, this.goal.deadline - Date.now())) : null;
    this.completion = agent.send(text, { auto, maxSteps, tokenBudget, attachments, runId: run.id }).then(result => {
      if (goalId && this.goal?.id === goalId) { this.goal.usedTokens = (this.goal.usedTokens || 0) + (result?.usage?.prompt || 0) + (result?.usage?.completion || 0); if (this.goal.status === 'active' && ((this.goal.tokenBudget > 0 && this.goal.usedTokens >= this.goal.tokenBudget) || ['budget', 'time-limit', 'max-steps'].includes(result?.stop))) this.goal.status = 'paused'; }
      const status = this.permissionBlocked || ['max-steps', 'budget', 'time-limit', 'stalled'].includes(result?.stop) ? 'needs_attention' : result?.stop === 'completed' ? 'completed' : result?.stop === 'interrupted' ? 'cancelled' : 'failed';
      this.runs.status(run, status, { stop: result?.stop, usage: result?.usage }); if (goalId && this.goal?.id === goalId && this.goal.status === 'active' && (status !== 'completed' && result?.stop !== 'max-steps')) { this.goal.status = status === 'cancelled' ? 'paused' : 'needs_attention'; } return { ...run };
    }).catch(e => { this.runs.status(run, 'failed', { error: e.message }); if (goalId && this.goal?.id === goalId) this.goal.status = 'needs_attention'; this.emit('agent-error', e.message); return { ...run }; })
      .finally(() => {
        clearTimeout(goalTimer); release(); this.activeRun = null; this.subagents.cancelRun(run.id);
        if (goalId && this.goal?.id === goalId && this.goal.status === 'active' && this.goal.maxTurns > 0 && this.goal.turns >= this.goal.maxTurns) { this.goal.status = 'paused'; this.goal.summary ||= '已到本次自动继续上限，可检查进展后手动继续。'; }
        if (!this.closing) {
          const next = this.queue.shift();
          if (next) setTimeout(() => this.send({ ...next, ...(this.goal?.status === 'active' ? { source: 'goal' } : {}) }), 0);
          else if (goalId && this.goal?.id === goalId && this.goal.status === 'active') setTimeout(() => { if (!this.closing && this.goal?.id === goalId && this.goal.status === 'active' && !this.agent?.running) this.send({ text: '继续完成当前目标。请先核对已有证据和进展，再执行下一项必要工作；确已完成并验证时调用 goal_update(complete)，需要用户输入或权限时调用 goal_update(blocked)。', source: 'goal' }); }, 300);
        }
        this.saveState(); this.emit('goal', this.goal); this.mgr.emitList();
      });
    return { ok: true, runId: run.id };
  }
  async startGoal(objective, attachments = []) {
    if (this.agent?.running) return { ok: false, error: '请先停止当前任务，再启动目标' };
    objective = String(objective || '').trim(); if (!objective || objective.length > 12000) return { ok: false, error: '请在 /goal 后填写目标（最多12000字）' };
    const previous = this.goal;
    this.goal = { id: crypto.randomUUID(), batchId: crypto.randomUUID(), objective, workspaceId: this.workspace.id, status: 'active', turns: 0, maxTurns: 0, limitsVersion: 1, tokenBudget: this.mgr.getSettings().tokenBudget || 0, usedTokens: 0, deadline: null, startedAt: Date.now(), summary: '' };
    const result = await this.send({ text: objective, source: 'goal', attachments });
    if (!result.ok) this.goal = previous;
    this.saveState(); this.emit('goal', this.goal); return result;
  }
  async goalAction(action) {
    if (!this.goal) return { ok: false, error: '当前没有目标。输入 /goal 后填写要完成的任务。' };
    if (action === 'pause' || action === 'clear') { this.interrupt(); if (action === 'clear') this.goal = null; }
    else if (action === 'resume') {
      if (this.agent?.running) return { ok: false, error: '请等待当前任务结束' };
      if (this.goal.workspaceId !== this.workspace.id) return { ok: false, error: '目标绑定的工作区已变化，请切回原工作区或新建目标' };
      if (this.goal.status === 'complete') return { ok: false, error: '此目标已经完成，请新建目标' };
      if (!this.goal.limitsVersion) Object.assign(this.goal, { maxTurns: 0, tokenBudget: this.mgr.getSettings().tokenBudget || 0, limitsVersion: 1 });
      this.goal.status = 'active'; this.goal.batchId = crypto.randomUUID(); this.goal.turns = 0; this.goal.usedTokens = 0; this.goal.deadline = null;
      const r = await this.send({ text: '继续目标：' + this.goal.objective + '\n上次进展：' + this.goal.summary, source: 'goal' });
      if (!r.ok) this.goal.status = 'paused'; this.saveState(); this.emit('goal', this.goal); return r;
    } else return { ok: false, error: '未知目标操作' };
    this.saveState(); this.emit('goal', this.goal); return { ok: true };
  }
  updateGoal({ status, summary }) {
    if (!this.goal || this.goal.status !== 'active' || this.activeRun?.source !== 'goal') throw new Error('只有用户通过 /goal 启动的当前目标可以更新');
    this.goal.summary = String(summary || '').slice(0, 12000);
    this.goal.status = status === 'complete' ? 'complete' : status === 'blocked' ? 'needs_attention' : 'active';
    if (status === 'complete') this.goal.endedAt = Date.now();
    this.saveState(); this.emit('goal', this.goal); return this.goal;
  }
  interrupt() { this.queue = []; if (this.goal?.status === 'active') { this.goal.status = 'paused'; this.emit('goal', this.goal); } this.subagents.cancelAll(); this.saveState(); this.agent?.interrupt(); killAllJobs(this.projectDir); this.mgr.emitList(); }
  resumeQueue() { if (this.agent?.running) throw new Error('任务正在运行'); const next = this.queue.shift(); this.saveState(); return next ? this.send(next) : { ok: false, error: '队列为空' }; }
  async closeBrowser() { this.agent?.interrupt(); await this.mcp.stop(); await this.browser.close(); this.mgr.emitList(); }
  async dispose() { this.closing = true; this.titleRevision++; this.titleController?.abort(); this.subagents.cancelAll(); if (this.goal?.status === 'active') this.goal.status = 'paused'; this.agent?.interrupt(); killAllJobs(this.projectDir); this.saveState(); for (const p of this.pending.values()) p.finish(false); for (const p of this.askPending.values()) p.finish(''); if (this.completion) await Promise.race([this.completion.catch(() => {}), new Promise(r => setTimeout(r, 2500))]); await this.closeBrowser().catch(() => {}); }
}

export class SessionManager {
  constructor({ userDataDir, getSettings, broadcast, chromeMod, mcpHost, titleGenerator }) {
    Object.assign(this, { userDataDir, getSettings, broadcast, chromeMod, mcpHost });
    const titleService = new SessionTitleService();
    this.titleGenerator = titleGenerator || titleService.generate.bind(titleService);
    this.components = new ComponentStore(userDataDir);
    this.workspaces = new WorkspaceStore(userDataDir);
    this.projects = new ProjectStore(userDataDir);
    this.sessions = new Map(); this.focusedId = null; this.seq = 0;
    this.stateFile = path.join(userDataDir, 'sessions.json');
    // 恢复上次的会话标签（标题、最后访问的网址、对话上下文；浏览器按需再启动）
    let saved = null; try { saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch {}
    if (saved?.sessions?.length) {
      for (const x of saved.sessions.slice(0, MAX_SESSIONS)) this.create({ id: x.id, title: x.title, titleSource: x.titleSource, primary: x.primary, lastUrl: x.url, updatedAt: x.updatedAt, pinned: x.pinned, quiet: true });
      if (saved.focused && this.sessions.has(saved.focused)) this.focusedId = saved.focused;
      this.seq = Math.max(this.seq, saved.seq || 0);
    } else this.create({ title: '会话 1', primary: true });
  }
  list() {
    // 置顶优先；同组内保持原有顺序（sort 稳定）
    const all = [...this.sessions.values()];
    const sorted = [...all].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return { focused: this.focusedId, sessions: sorted.map(s => s.info()) };
  }
  emitList() {
    const l = this.list(); this.broadcast('sessions', l);
    atomicJson(this.stateFile, { focused: l.focused, seq: this.seq, sessions: l.sessions.map(s => ({ id: s.id, title: s.title, titleSource: this.sessions.get(s.id).titleSource, primary: s.primary, url: s.url, updatedAt: s.updatedAt, pinned: s.pinned })) });
  }
  create({ title, titleSource, primary, id: wantId, lastUrl, updatedAt, pinned, quiet, managed = false, projectId } = {}) {
    if (this.projectsBusy) throw new Error('正在更新项目目录，请稍候创建会话');
    const projectWorkspace = projectId ? this.projects.workspace(projectId) : null;
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`最多保留 ${MAX_SESSIONS} 个会话，请关闭不再需要的会话`);
    let id = primary ? 'main' : (wantId && /^s(?:[0-9a-f]{6}|[0-9a-f]{32})$/.test(wantId) ? wantId : 's' + crypto.randomUUID().replaceAll('-', ''));
    if (this.sessions.has(id)) throw new Error('会话 ID 重复：' + id);
    this.seq++;
    const s = new Session(this, { id, title: title || `会话 ${this.seq}`, titleSource, primary: !!primary, lastUrl, updatedAt, pinned });
    this.sessions.set(id, s);
    if (managed) s.workspace = this.workspaces.managed(s.id, s.projectDir);
    if (projectWorkspace) { s.workspace = projectWorkspace; s.projectId = projectId; }
    if (managed || projectId) s.saveState();
    if (!this.focusedId) this.focusedId = id;
    if (!quiet) this.emitList();
    return s;
  }
  get(id, soft) {
    const s = id ? this.sessions.get(id) : (this.sessions.get(this.focusedId) || this.sessions.values().next().value);
    if (!s && !soft) throw new Error('会话不存在或已关闭：' + id);
    return s;
  }
  focused() { return this.sessions.get(this.focusedId); }
  async focus(id) {
    const s = this.get(id); const prev = this.focused();
    this.focusedId = id;
    if (prev && prev !== s) await prev.browser.stopScreencast().catch(() => {});
    if (s.browser.running) await s.browser.startScreencast().catch(() => {});
    this.emitList();
  }
  async close(id) {
    if (this.projectsBusy) throw new Error('正在更新项目目录，请稍候关闭会话');
    const s = this.get(id);
    this.sessions.delete(id);
    if (this.focusedId === id) { const next = this.sessions.values().next().value; this.focusedId = next?.id || null; if (next) await this.focus(next.id).catch(() => {}); }
    await s.dispose();
    if (!this.sessions.size) this.create({});
    this.emitList();
  }
  async closeAll() { await Promise.all([...this.sessions.values()].map(s => s.dispose())); }
}
function safe(f) { try { return f(); } catch { return ''; } }
