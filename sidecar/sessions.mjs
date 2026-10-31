// Each chat owns private history/browser state and belongs to one project.
// 会话之间不共享任何可变状态，因此多个 Agent 可以真正并行；同一会话内的操作由 Agent.running 与 launch 锁串行化。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from './browser.mjs';
import { McpBridge } from './mcp.mjs';
import { Agent } from './agent.mjs';
import { DEFAULT_TOOLS } from './catalog.mjs';
import { browserPresentation, KERNEL } from './settings.mjs';
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
import { restoreGoal, createGoal, updateGoal, finishGoalRound, GoalDriver } from './goals.mjs';
import { deleteSessionData, waitForSessionWriters, sessionDataPaths } from './session-data.mjs';
import { SessionTerminals } from './terminals.mjs';
import { BrowserTabs } from './browser-tabs.mjs';

const MAX_SESSIONS = 100;
const GOAL_CONTINUATION = Symbol('internal-goal-continuation');

class Session {
  constructor(mgr, { id, title, titleSource, primary, lastUrl, updatedAt, pinned, projectId }) {
    this.mgr = mgr; this.id = id; this.title = title; this.primary = primary; this.lastUrl = lastUrl || '';
    this.terminals = new SessionTerminals(this);
    this.browserTabs = new BrowserTabs(this);
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
    this.projectId = projectId;
    this.workspace = mgr.projects.workspace(projectId);
    this.readHashes = new Map(); this.changes = new ChangeStore(this.projectDir);
    this.runs = new RunStore(this.projectDir, event => this.emit('run-event', event), { sessionId: this.id });
    this.activeRun = null; this.queue = Array.isArray(st.queue) ? st.queue.slice(0, 10).map(q => ({ ...q, id: q.id || crypto.randomUUID() })) : []; this.completion = null; this.closing = false;
    this.ratings = st.ratings && typeof st.ratings === 'object' && !Array.isArray(st.ratings) ? { ...st.ratings } : {};
    // 「本会话始终允许」只在这次运行的内存里有效。磁盘上的旧 allows 不恢复。
    this.allows = new Set();
    this.subagentNotices = [];
    this.todos = this.readTodos(st.todos);
    this.goal = restoreGoal(st.goal);
    this.goalDriver = new GoalDriver({ current: () => this.goal,
      idle: () => !this.closing && !this.agent?.running && !this.activeRun && !this.queue.length && !this.pending.size && !this.askPending.size && this.goal?.workspaceId === this.workspace.id,
      dispatch: () => this.send({ text: '', source: 'goal' }, GOAL_CONTINUATION),
      failed: reason => { if (this.goal?.status === 'active') { this.goal = { ...this.goal, status: 'needs_attention', stopReason: 'dispatch-failed', resumeNote: reason }; this.saveState(); this.emit('goal', this.goal); this.mgr.emitList(); } } });
    this.subagents = new ResearchAgents({ directory: this.projectDir, context: () => this.toolCtx(), settings: () => this.mgr.getSettings(), onSettled: record => this.subagentSettled(record), onUsage: record => {
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
    atomicJson(this.stateFile(), { mode: this.mode === 'full-access' ? 'standard' : this.mode, review: this.review, todos: this.todos, workspace: this.workspace, projectId: this.projectId, queue: this.queue, ratings: this.ratings, goal: this.goal });
  }
  setTodos(list) { this.todos = list; this.saveState(); this.emit('agent-todos', this.todos); }
  setMode(mode, review) {
    const next = normalizeMode(mode), nextReview = normalizeReview(review), running = !!this.agent?.running;
    // 任务运行中也允许切换权限：只改判定依据，不杀终端和后台任务。
    // Agent 每次工具调用都会重新读取 getMode()，因此下一次操作即按新权限判定。
    if (!running) {
      this.terminals.cancelAll();
      for (const p of this.pending.values()) p.finish(false);
      killAllJobs(this.projectDir);
      this.allows.clear();
    }
    this.mode = next;
    this.review = nextReview;
    // 升到完全访问时，等待中的批准按新权限直接放行；降级仍保留逐次确认。
    if (running && next === 'full-access') for (const p of [...this.pending.values()]) p.finish(true);
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
  publicState() { return { mode: this.mode, review: this.review, todos: this.todos, workspace: this.workspace, run: this.runs.latest(), queue: this.queue.length, ratings: this.ratings, modelRetry: this.agent?.retry || null, debuggerPaused: !!this.debuggerPaused, goal: this.goal, subagents: this.subagents?.list(this.workspace.id) || [], approvals: [...this.pending.values()].map(p => p.request), questions: [...this.askPending.values()].map(p => p.request) }; }
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
    this.terminals.cancelAll();
    if (this.closing || this.mgr.sessions.get(this.id) !== this) throw new Error('会话已关闭，不能更换目录');
    if (this.browser.client || this.browser.starting) throw new Error('请先关闭浏览器，再更换文件夹');
    if (this.agent?.running) throw new Error('请先停止当前任务，再更换文件夹');
    if (this.subagents.jobs.size) throw new Error('请先等待或取消研究子代理，再更换文件夹');
    if (this.goal?.status === 'active') throw new Error('请先暂停当前目标，再更换文件夹');
    if (this.queue.length) throw new Error('请先完成或清空队列，再更换文件夹');
    if (!binding?.projectId) throw Error('会话必须使用项目目录');
    this.mgr.projects.get(binding.projectId);
    const next = binding;
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
  async approve(req, signal, { detached = false } = {}) {
    const run = detached ? null : this.activeRun;
    if (signal?.aborted) return false;
    if (this.mode === 'full-access') return true;
    if (req.canRemember && this.allows.has(req.scopeKey)) return true;
    if (this.review === 'auto') {
      const review = autoReview(req);
      if (run && this.activeRun === run) this.runs.event(run.id, 'approval-reviewed', { name: req.name, scopeKey: req.scopeKey, review });
      if (review.allow) return true;
    }
    if (run?.source === 'automation') { this.permissionBlocked = true; this.runs.event(run.id, 'permission-needed', { request: req }); return false; }
    const id = crypto.randomUUID();
    return await new Promise(resolve => {
      let settled = false;
      const finish = (allow) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); this.pending.delete(id); this.emit('approval-resolved', { id, allow: !!allow }); if (run && this.activeRun === run) this.runs.status(run, 'running'); resolve(!!allow); };
      const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
      const onAbort = () => finish(false);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      timer.unref?.();
      const request = { ...req, id, expiresAt: Date.now() + 5 * 60 * 1000, workspace: this.workspace.root };
      this.pending.set(id, { finish, request });
      if (run && this.activeRun === run) this.runs.status(run, 'waiting_approval');
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
    return { id: this.id, title: this.title, primary: this.primary, pinned: !!this.pinned, running: this.browser.running, embed: this.browser.embedActive, chromePid: this.browser.embedActive ? this.browser.chromePid : null, agentRunning: !!this.agent?.running, url, projectDir: this.projectDir, mode: this.mode, review: this.review, workspace: { ...this.workspace, ...this.mgr.workspaces.availability(this.workspace) }, projectId: this.projectId, run: this.runs.latest(), queued: this.queue.length, queuedItems: this.queue.map(q => ({ id: q.id, text: String(q.text || '').slice(0, 160), attachments: (q.attachments || []).length })), updatedAt: this.updatedAt };
  }
  subagentSettled(record) {
    const label = record.status === 'completed' ? '已完成' : record.status === 'limited' ? '达到上限' : record.status === 'cancelled' ? '已取消' : '已结束';
    const notice = `子代理「${record.title}」${label}（id=${record.id}）。用 agent_wait("${record.id}") 读取完整结论，核验后再采纳；需要继续研究时用 agent_message 追加要求。`;
    if (this.agent?.running) this.agent.queueNotice(notice);
    else { this.subagentNotices.push(notice); if (this.subagentNotices.length > 10) this.subagentNotices.shift(); }
    this.emit('subagent-finished', { id: record.id, status: record.status, title: record.title });
  }
  contextForSubagent(limit = 6000) {
    const parts = [];
    if (this.goal) parts.push(`当前目标：${this.goal.objective}\n已记录进展：${this.goal.summary || '暂无'}\n下一步：${this.goal.nextAction || '未记录'}`);
    const recent = (this.agent?.hist?.events || []).filter(e => (e.t === 'user' && e.content) || (e.t === 'assistant' && e.content && !e.calls?.length)).slice(-8);
    for (const e of recent) parts.push(`${e.t === 'user' ? '用户' : '助手'}：${String(e.content).replace(/\s+/g, ' ').slice(0, 700)}`);
    if (this.workspace?.root) parts.push(`工作目录：${this.workspace.root}`);
    return parts.join('\n').slice(0, limit);
  }
  toolCtx() {
    if (this.mgr.projectsBusy) throw new Error('正在更新项目目录，请稍候');
    this.mgr.workspaces.verify(this.workspace);
    return {
      components: this.mgr.components, plugins:this.mgr.plugins, extensions: this.mgr.extensions, sessionId: this.id, projectId: this.projectId, projectRoots: this.workspace.roots || [], projectDir: this.projectDir, browser: this.browser, mcp: this.mcp, relaunch: o => this.relaunch(o),
      openBrowser: opts => this.browser.running ? this.browser.navigate(opts.url).then(() => ({ ok: true })) : this.launch(opts),
      ensureDebugger: () => this.ensureDebugger(),
      subagents: this.subagents, getGoal: () => this.goal, updateGoal: value => this.updateGoal(value), parentContext: () => this.contextForSubagent(),
      goalBudget: this.activeRun?.source === 'goal' && this.goal ? { key: this.goal.id + ':' + this.goal.batchId, ...(this.goal.tokenBudget > 0 ? { remaining: Math.max(0, this.goal.tokenBudget - (this.goal.usedTokens || 0)) } : {}) } : null,
      workRoot: this.workspace.root, workspaceId: this.workspace.id, workspaceKind: this.workspace.kind, mode: this.mode, protectedRoot: this.mgr.userDataDir,
      changes: this.changes, readHashes: this.readHashes, runId: this.activeRun?.id,
      exec: spec => this.execute(spec, this.agent?.callSignal || this.agent?.abort?.signal),
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
    if (this.closing) return { ok: false, error: '会话正在关闭或删除' };
    if (this.mgr.projectsBusy) return { ok: false, error: '正在更新项目目录，请稍候' };
    if (!this.browser.running && [...this.mgr.sessions.values()].filter(s => s.browser.running).length >= 6) return { ok: false, error: '最多同时打开 6 个浏览器' };
    if (this.launching) return this.launching;
    this.launching = (async () => { try {
      const settings = this.mgr.getSettings();
      const presentation = browserPresentation(settings);
      const result = await this.browser.launch({ ...settings, kernel: KERNEL, ...presentation, profileDir: this.profileDir(), isolated: isolated ?? (this.primary ? settings.isolated : true), url });
      if (this.closing) return { ok: false, error: '会话正在关闭或删除' };
      if (!result.ok) return result;
      this.ensureAgent().localTools = DEFAULT_TOOLS; this.agent.emitContext();
      if (!presentation.dock && this.mgr.focusedId === this.id) await this.browser.startScreencast().catch(() => {});
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
        getToolContext: () => this.toolCtx(), getWorkspace: () => this.workspace, getGoal: () => this.goal,
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
  send({ text = '', auto, maxSteps, tokenBudget, attachments, source = 'user', enqueue = false }, continuationKey) {
    if (this.closing) return { ok: false, error: '会话正在关闭或删除' };
    const continuation = continuationKey === GOAL_CONTINUATION && this.goal?.status === 'active';
    if (continuationKey === GOAL_CONTINUATION && !continuation) return { ok: false, error: '目标已暂停或结束' };
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
      if (!enqueue) return { ok: false, code: 'busy', error: '该会话正在运行，可以将消息加入待发送队列' };
      if (this.queue.length >= 10) return { ok: false, error: '队列最多保留 10 条消息' };
      this.queue.push({ id: crypto.randomUUID(), text, auto, maxSteps, tokenBudget, attachments, source }); this.saveState(); this.mgr.emitList(); return { ok: true, queued: true };
    }
    // 前端保存时会把当前渠道镜像进 openai/anthropic；这里再兜一层，避免渠道密钥还没同步时误报
    const active = (s.providers || []).find(p => p.id === s.activeProviderId);
    const key = active?.apiKey || (s.provider === 'anthropic' ? s.anthropic?.apiKey : s.openai?.apiKey);
    if (!key) return { ok: false, code: 'model-required', error: '尚未配置 API Key，请在「设置」页填写' };
    let release; try { release = this.mgr.workspaces.acquire(this.workspace, this.id, this.mode !== 'read-only'); }
    catch (e) { return { ok: false, code: e.code, error: e.message }; }
    this.goalDriver.cancel(); clearTimeout(this.queueTimer);
    if (source === 'goal' && this.goal?.status === 'active') { this.goal.turns++; if (this.goal.tokenBudget > 0) tokenBudget = Math.min(tokenBudget || Infinity, Math.max(1, this.goal.tokenBudget - (this.goal.usedTokens || 0))); this.saveState(); this.emit('goal', this.goal); }
    const goalId = source === 'goal' ? this.goal?.id : null;
    const goalRevision = this.goal?.revision || 0;
    this.permissionBlocked = false;
    const run = this.runs.start({ workspace: this.workspace, mode: this.mode, text: continuation ? this.goal.objective : text, source }); this.activeRun = run;
    this.lastGoal = { text, auto };
    if (!continuation) this.suggestTitle(text);
    this.updatedAt = Date.now(); this.mgr.emitList();
    const goalTimer = goalId && this.goal.deadline ? setTimeout(() => agent.finishSoon(), Math.max(1, this.goal.deadline - Date.now())) : null;
    if (this.subagentNotices.length) for (const notice of this.subagentNotices.splice(0)) agent.queueNotice(notice);
    this.completion = agent.send(text, { auto, maxSteps, tokenBudget, attachments, runId: run.id, continuation }).then(result => {
      if (goalId && this.goal?.id === goalId) {
        const hasWork = (this.goal.revision || 0) !== goalRevision || agent.hist.events.some(e => e.t === 'tool' && e.turnId === run.id && !e.isError && !['goal_update', 'goal_get', 'todo_write', 'agent_list'].includes(e.name));
        this.goal = finishGoalRound(this.goal, result, { automatic: continuation, hasWork });
      }
      const status = this.permissionBlocked || ['max-steps', 'budget', 'time-limit', 'stalled'].includes(result?.stop) ? 'needs_attention' : result?.stop === 'completed' ? 'completed' : result?.stop === 'interrupted' ? 'cancelled' : 'failed';
      this.runs.status(run, status, { stop: result?.stop, usage: result?.usage }); if (goalId && this.goal?.id === goalId && this.goal.status === 'active' && (status !== 'completed' && result?.stop !== 'max-steps')) { this.goal.status = status === 'cancelled' ? 'paused' : 'needs_attention'; } return { ...run };
    }).catch(e => { this.runs.status(run, 'failed', { error: e.message }); if (goalId && this.goal?.id === goalId) this.goal.status = 'needs_attention'; this.emit('agent-error', e.message); return { ...run }; })
      .finally(() => {
        clearTimeout(goalTimer); release(); this.activeRun = null; this.subagents.cancelRun(run.id);
        if (!this.closing) {
          if (this.queue.length) this.queueTimer = setTimeout(() => { if (!this.closing && !this.agent?.running) this.resumeQueue(); }, 0);
          else if (goalId && this.goal?.id === goalId) this.goalDriver.schedule();
        }
        this.saveState(); this.emit('goal', this.goal); this.mgr.emitList();
      });
    return { ok: true, runId: run.id };
  }
  async startGoal(objective, attachments = []) {
    if (this.agent?.running) return { ok: false, error: '请先停止当前任务，再启动目标' };
    objective = String(objective || '').trim(); if (!objective || objective.length > 12000) return { ok: false, error: '请在 /goal 后填写目标（最多12000字）' };
    const previous = this.goal;
    this.goalDriver.cancel(); this.goal = createGoal(objective, this.workspace.id, this.mgr.getSettings().tokenBudget || 0);
    const result = await this.send({ text: objective, source: 'goal', attachments });
    if (!result.ok) { this.goal = previous; this.goalDriver.schedule(); }
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
      this.goalDriver.cancel(); this.goal.status = 'active'; this.goal.batchId = crypto.randomUUID(); this.goal.turns = 0; this.goal.usedTokens = 0; this.goal.deadline = null; this.goal.stopReason = null; this.goal.resumeNote = '';
      const r = await this.send({ text: '', source: 'goal' }, GOAL_CONTINUATION);
      if (!r.ok) this.goal.status = 'paused'; this.saveState(); this.emit('goal', this.goal); return r;
    } else return { ok: false, error: '未知目标操作' };
    this.saveState(); this.emit('goal', this.goal); return { ok: true };
  }
  updateGoal(value) {
    if (!this.goal || this.goal.status !== 'active' || this.activeRun?.source !== 'goal') throw new Error('只有用户通过 /goal 启动的当前目标可以更新');
    if (value.status === 'complete' && this.subagents.jobs.size) throw new Error('请先等待或取消研究子代理，并核验其结果，再完成目标');
    this.goal = updateGoal(this.goal, value, { runId: this.activeRun.id });
    if (this.goal.status !== 'active') this.goalDriver.cancel();
    this.saveState(); this.emit('goal', this.goal); return this.goal;
  }
  interrupt() { this.goalDriver.cancel(); clearTimeout(this.queueTimer); this.queue = []; if (this.goal?.status === 'active') { this.goal.status = 'paused'; this.emit('goal', this.goal); } this.subagents.cancelAll(); this.saveState(); this.agent?.interrupt(); killAllJobs(this.projectDir); this.mgr.emitList(); }
  resumeQueue() { if (this.agent?.running) throw new Error('任务正在运行'); const next = this.queue.shift(); const result = next ? this.send(next) : { ok: false, error: '队列为空' }; if (next && !result.ok) this.queue.unshift(next); this.saveState(); this.mgr.emitList(); return result; }
  removeQueued(id) {
    const index = this.queue.findIndex(q => q.id === String(id || ''));
    if (index < 0) return { ok: false, error: '这条消息已不在队列中' };
    this.queue.splice(index, 1); this.saveState(); this.mgr.emitList(); return { ok: true };
  }
  editQueued(id, text) {
    const item = this.queue.find(q => q.id === String(id || ''));
    if (!item) return { ok: false, error: '这条消息已不在队列中' };
    const value = String(text ?? '').trim();
    if (!value) return { ok: false, error: '消息不能为空' };
    item.text = value; this.saveState(); this.mgr.emitList(); return { ok: true };
  }
  // 只允许重发“最后一条、且之后没有工具调用”的用户消息，避免悄悄丢掉已有执行记录。
  editTurn(turnId, text) {
    if (this.agent?.running) return { ok: false, error: '任务正在运行，停止后才能编辑已发送消息' };
    const events = this.agent?.hist?.events || [];
    const indexes = events.map((e, i) => (e.t === 'user' && !String(e.content || '').startsWith('【') ? i : -1)).filter(i => i >= 0);
    const index = events.findIndex(e => e.t === 'user' && e.turnId === turnId);
    if (index < 0 || index !== indexes.at(-1)) return { ok: false, error: '只能编辑最后一条消息' };
    const tail = events.slice(index);
    if (tail.some(e => e.t === 'tool' || (e.t === 'assistant' && e.calls?.length))) return { ok: false, error: '这条消息之后已有工具调用，不能直接重发' };
    const value = String(text ?? '').trim();
    if (!value) return { ok: false, error: '消息不能为空' };
    events.splice(index); this.agent.persist();
    return this.send({ text: value });
  }
  rateMessage(id, rating) {
    const key = String(id || '');
    if (!key) return { ok: false, error: '缺少消息 ID' };
    if (rating === 'up' || rating === 'down') this.ratings[key] = rating;
    else delete this.ratings[key];
    this.saveState(); this.emit('agent-ratings', this.ratings); this.mgr.emitList();
    return { ok: true, ratings: this.ratings };
  }
  async closeBrowser() { this.agent?.interrupt(); await this.mcp.stop(); await this.browser.close(); this.mgr.emitList(); }
  async dispose() { this.closing = true; this.goalDriver.cancel(); clearTimeout(this.queueTimer); this.titleRevision++; this.titleController?.abort(); this.subagents.cancelAll(); if (this.goal?.status === 'active') this.goal.status = 'paused'; this.agent?.interrupt(); killAllJobs(this.projectDir); this.saveState(); for (const p of this.pending.values()) p.finish(false); for (const p of this.askPending.values()) p.finish(''); if (this.completion) await Promise.race([this.completion.catch(() => {}), new Promise(r => setTimeout(r, 2500))]); await this.terminals.closeAll(); await this.closeBrowser().catch(() => {}); }
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
      for (const x of saved.sessions.slice(0, MAX_SESSIONS)) {
        if (!/^(?:main|s(?:[0-9a-f]{6}|[0-9a-f]{32}))$/.test(x.id) || !!x.primary !== (x.id === 'main')) throw Error('会话索引身份无效');
        const state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'projects', x.primary ? 'default' : x.id, '.agent-state.json'), 'utf8'));
        if (!state.projectId) throw Error('开发数据包含无项目会话，请先清理开发数据');
        this.create({ id: x.id, title: x.title, titleSource: x.titleSource, primary: x.primary, lastUrl: x.url, updatedAt: x.updatedAt, pinned: x.pinned, quiet: true, projectId: state.projectId });
      }
      if (saved.focused && this.sessions.has(saved.focused)) this.focusedId = saved.focused;
      this.seq = Math.max(this.seq, saved.seq || 0);
    }
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
  create({ title, titleSource, primary, id: wantId, lastUrl, updatedAt, pinned, quiet, projectId = this.focused()?.projectId } = {}) {
    if (this.projectsBusy) throw new Error('正在更新项目目录，请稍候创建会话');
    if (!projectId) throw Error('请先选择项目');
    const projectWorkspace = this.projects.workspace(projectId);
    if (!quiet) this.workspaces.verify(projectWorkspace);
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`最多保留 ${MAX_SESSIONS} 个会话，请关闭不再需要的会话`);
    let id = primary ? 'main' : (wantId && /^s(?:[0-9a-f]{6}|[0-9a-f]{32})$/.test(wantId) ? wantId : 's' + crypto.randomUUID().replaceAll('-', ''));
    if (this.sessions.has(id)) throw new Error('会话 ID 重复：' + id);
    this.seq++;
    const s = new Session(this, { id, title: title || `会话 ${this.seq}`, titleSource, primary: !!primary, lastUrl, updatedAt, pinned, projectId });
    this.sessions.set(id, s);
    s.saveState();
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
    if (s.browser.running && !browserPresentation(this.mgr.getSettings()).dock) await s.browser.startScreencast().catch(() => {});
    this.emitList();
  }
  async close(id) {
    if (this.projectsBusy) throw new Error('正在更新项目目录，请稍候关闭会话');
    const s = this.get(id);
    this.sessions.delete(id);
    if (this.focusedId === id) { const next = this.sessions.values().next().value; this.focusedId = next?.id || null; if (next) await this.focus(next.id).catch(() => {}); }
    await s.dispose();
    this.emitList();
  }
  async delete(id, { projectRemoval = false } = {}) {
    if (!id || !this.sessions.has(id)) throw Error('请指定要删除的会话');
    if (this.projectsBusy && !projectRemoval) throw Error('正在更新项目目录，请稍后删除对话');
    const s = this.get(id);
    if (s.deleting) throw Error('正在删除此对话');
    sessionDataPaths(this.userDataDir, s);
    s.deleting = true;
    try {
      this.onDeleting?.(id);
      s.interrupt(); await s.dispose(); await waitForSessionWriters(s);
      await deleteSessionData(this.userDataDir, s);
      this.sessions.delete(id);
      if (this.focusedId === id) { this.focusedId = null; const next = this.sessions.values().next().value; if (next) await this.focus(next.id).catch(() => {}); }
      this.emitList();
    } finally { s.deleting = false; }
  }
  async closeAll() { await Promise.all([...this.sessions.values()].map(s => s.dispose())); }
}
function safe(f) { try { return f(); } catch { return ''; } }
