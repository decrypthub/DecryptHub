// Each chat owns private history/browser state and belongs to one project.
// 会话之间不共享任何可变状态，因此多个 Agent 可以真正并行；同一会话内的操作由 Agent.running 与 launch 锁串行化。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from './browser.mjs';
import { McpBridge } from './mcp.mjs';
import { Agent } from './agent.mjs';
import { steerQueued } from './queued-steering.mjs';
import { DEFAULT_TOOLS } from './catalog.mjs';
import { browserPresentation, KERNEL } from './settings.mjs';
import { DEFAULT_TODOS, normalizeSteps, applyTodos } from './todos.mjs';
import { normalizeMode, normalizeReview, autoReview } from './policy.mjs';
import { validateAttachments } from './attachments.mjs';
import { PASTE_LIMIT, savePastedText, pasteNotice } from './paste-drop.mjs';
import { workspaceFileSize, killAllJobs } from './workspace.mjs';
import { WorkspaceStore } from './workspaces.mjs';
import { ProjectStore } from './projects.mjs';
import { RunStore } from './runs.mjs';
import { ChangeStore, contentHash } from './changes.mjs';
import { executor } from './executor.mjs';
import { atomicJson, resolveIn, pathKey } from './paths.mjs';
import { ResearchAgents } from './subagents.mjs';
import { AgentTeam } from './agent-team.mjs';
import { teamMemberIds } from './subagent-inspection.mjs';
import { ComponentStore } from './components.mjs';
import { promptTitle, cleanTitle, SessionTitleService } from './session-titles.mjs';
import { chat } from './llm.mjs';
import { restoreGoal, createGoal, updateGoal, finishGoalRound, GoalDriver } from './goals.mjs';
import { deleteSessionData, waitForSessionWriters, sessionDataPaths } from './session-data.mjs';
import { SessionTerminals } from './terminals.mjs';
import { BrowserTabs } from './browser-tabs.mjs';
import { PlanMode } from './plan-mode.mjs';
import { applyGoalOperation, goalValue } from './goal-tools.mjs';
import { captureSelection, selectionSettings, updateSelection } from './model-selection.mjs';
import { SessionQuery } from './session-query.mjs';
import { copyForkResources } from './fork-resources.mjs';
import { WriterLease } from './writer-lease.mjs';
import { History } from './history.mjs';
import { closeHistoryTail } from './history-repair.mjs';

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
    this.eventRevision = 0;
    const emit = (ch, p) => {
      if (ch === 'agent-context' && p && this.workspace) {
        this.contextState = { workspaceId: this.workspace.id, selection: JSON.stringify(this.modelSelection), stats: structuredClone(p) };
        try { this.saveState(); } catch { /* A display sample cannot change task completion. */ }
      }
      mgr.broadcast(ch, p, this.id, ++this.eventRevision);
    };
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
    this.parentSessionId = st.parentSessionId || null;
    this.inheritedEventCount = Number.isSafeInteger(st.inheritedEventCount) ? st.inheritedEventCount : 0;
    this.createdAt = Number(st.createdAt) || null;
    this.modelSelection = st.modelSelection || captureSelection(mgr.getSettings());
    this.contextState = st.contextState || null;
    // 完全权限随会话保存（对齐 DSH：预设是会话的持久事实，重启后仍生效）。
    // 历史原因：旧版本会把磁盘上的 full-access 主动降级成 standard，「仅本次运行有效」。
    // 那条边界已由用户决定取消，所以这里直接恢复原值；只有脏值才回落到 standard。
    this.mode = normalizeMode(st.mode);
    this.review = normalizeReview(st.review);
    this.projectId = projectId;
    this.workspace = mgr.projects.workspace(projectId);
    this.readHashes = new Map(); this.changes = new ChangeStore(this.projectDir);
    this.runs = new RunStore(this.projectDir, event => this.emit('run-event', event), { sessionId: this.id });
    this.activeRun = null; this.queue = Array.isArray(st.queue) ? st.queue.slice(0, 10).map(q => ({ ...q, id: q.id || crypto.randomUUID() })) : []; this.completion = null; this.closing = false;
    this.ratings = st.ratings && typeof st.ratings === 'object' && !Array.isArray(st.ratings) ? { ...st.ratings } : {};
    // 「本会话始终允许」只在这次运行的内存里有效。磁盘上的旧 allows 不恢复。
    this.allows = new Set();
    // 域名组授权：{ key: { host, until, ports } }。按主机（含端口）记住，避免扫几百个目标时逐域弹窗。
    // 同样只存在内存，切权限/换工作区/退出应用即失效。
    this.netGrants = new Map();
    this.todos = this.readTodos(st.todos);
    this.subagentNotices = Array.isArray(st.notices) ? st.notices.slice(-10) : [];
    this.goal = restoreGoal(st.goal);
    this.hasSavedPlan = !!st.plan;
    this.planMode = new PlanMode(st.plan, (state, committed) => {
      if (committed) this.agent?.hist.append({ t: 'system', source: { kind: 'plan-mode' }, active: state.active, planRevision: state.revision, content: '' });
      this.hasSavedPlan = true;
      this.saveState(); this.emit('plan', state);
    });
    this.goalDriver = new GoalDriver({ current: () => this.goal,
      idle: () => !this.closing && !this.agent?.running && !this.activeRun && !this.queue.length && !this.pending.size && !this.askPending.size && this.goal?.workspaceId === this.workspace.id,
      dispatch: () => this.send({ text: '', source: 'goal' }, GOAL_CONTINUATION),
      failed: reason => { if (this.goal?.status === 'active') { this.goal = { ...this.goal, status: 'needs_attention', stopReason: 'dispatch-failed', resumeNote: reason }; this.saveState(); this.emit('goal', this.goal); this.mgr.emitList(); } } });
    this.subagents = new ResearchAgents({ directory: this.projectDir, context: () => this.toolCtx(), settings: () => this.requestSettings(), onSettled: record => this.subagentSettled(record), onUsage: record => {
      if (record.goalKey && this.goal && record.goalKey === this.goal.id + ':' + this.goal.batchId) {
        this.goal.usedTokens = (this.goal.usedTokens || 0) + (record.usage?.prompt || 0) + (record.usage?.completion || 0);
        if (this.goal.status === 'active' && this.goal.tokenBudget > 0 && this.goal.usedTokens >= this.goal.tokenBudget) { this.goal.status = 'paused'; this.agent?.finishSoon(); }
        this.saveState(); this.emit('goal', this.goal);
      }
    }, emit: jobs => this.emit('subagents', jobs.filter(j => j.workspaceId === this.workspace.id)) });
    this.team = new AgentTeam({ directory: this.projectDir, context: () => ({ sessionId: this.id, workspaceId: this.workspace.id, workRoot: this.workspace.root }), members: () => teamMemberIds(this), emit: team => this.emit('agent-team', team) });
  }
  stateFile() { return path.join(this.projectDir, '.agent-state.json'); }
  loadState() { try { return JSON.parse(fs.readFileSync(this.stateFile(), 'utf8')); } catch { return {}; } }
  readTodos(raw) {
    try { if (Array.isArray(raw) && raw.length) return normalizeSteps(raw); } catch {}
    return [];
  }
  saveState() {
    if (this.mgr.closed) return;
    // 权限随会话持久化：mode 与 review 都是持久事实，写入磁盘的就是当前生效值。
    atomicJson(this.stateFile(), { mode: this.mode, review: this.review, modelSelection: this.modelSelection, todos: this.todos, workspace: this.workspace, projectId: this.projectId, queue: this.queue, contextState: this.contextState, ratings: this.ratings, goal: this.goal, plan: this.planMode?.snapshot(), notices: this.subagentNotices, parentSessionId: this.parentSessionId, inheritedEventCount: this.inheritedEventCount, createdAt: this.createdAt });
  }
  requestSettings() { return selectionSettings(this.mgr.getSettings(), this.modelSelection); }
  setModel(input) {
    const next = updateSelection(this.mgr.getSettings(), this.modelSelection, input), previous = this.modelSelection;
    this.modelSelection = next;
    try { this.saveState(); } catch (error) { this.modelSelection = previous; throw error; }
    this.emit('model-selection', next); this.agent?.emitContext(); return next;
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
      this.netGrants.clear();
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
  publicState() { return { mode: this.mode, review: this.review, modelSelection: this.modelSelection, plan: this.planMode.snapshot(), todos: this.todos, workspace: this.workspace, run: this.runs.latest(), queue: this.queue.length, ratings: this.ratings, modelRetry: this.agent?.retry || null, debuggerPaused: !!this.debuggerPaused, goal: this.goal, team: this.team?.snapshot(), subagents: this.subagents?.list(this.workspace.id) || [], approvals: [...this.pending.values()].map(p => p.request), questions: [...this.askPending.values()].map(p => p.request) }; }
  setPlan(active) { this.ensureAgent(); return this.planMode.select(active, { running: !!this.agent?.running }); }
  rename(title) {
    const next = Array.from(String(title || '').trim()).slice(0, 40).join('');
    if (!next) throw new Error('会话名称不能为空');
    this.titleRevision++; this.titleController?.abort(); this.title = next; this.titleSource = 'manual'; this.mgr.emitList(); return this.info();
  }
  suggestTitle(prompt) {
    if (!['placeholder', 'prompt'].includes(this.titleSource) || !String(prompt || '').trim()) return this.titleJob;
    this.titlePrompt ||= String(prompt);
    if (this.titleSource === 'placeholder') { this.title = promptTitle(this.titlePrompt); this.titleSource = 'prompt'; this.mgr.emitList(); }
    const settings = this.requestSettings(), cfg = settings.provider === 'anthropic' ? settings.anthropic : settings.openai;
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
    killAllJobs(this.projectDir); this.allows.clear(); this.netGrants.clear(); this.readHashes.clear();
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
    // 联网审批按「域名」而非「本次命令的全部域名集合」判定：
    // 扫几百个目标时，每个主机都不该因为域名列表变了就重批一次。已授权的域名直接放行，
    // 只把还没授权的域名一次性列给用户，并可选择「记住这些域名」在本会话内复用。
    const ungranted = network.filter(h => !this.netGranted(h));
    if ((!isolated && this.mode !== 'full-access') || (ungranted.length && this.mode !== 'full-access')) {
      const canRemember = isolated && !ungranted.length ? true : (network.length > 0 && (isolated || !ungranted.length));
      const ok = await this.approve({ name: 'process.exec', category: 'shell', scopeKey, canRemember,
        summary: isolated
          ? (ungranted.length ? '此命令申请访问以下网络目的地。' : '此命令申请访问以下网络目的地。')
          : '执行隔离不可用。允许后，此命令将以当前系统用户权限运行，可访问工作文件夹以外的文件和网络。',
        command: [spec.file, ...(spec.args || [])].join('\n'), cwd: spec.cwd, isolated, network: ungranted.length ? ungranted : network,
        code: spec.preview || spec.input || '', trustedPurpose: spec.trustedPurpose }, signal);
      if (!ok) {
        const hint = ungranted.length
          ? `需要授权的域名：${ungranted.join('、')}。在批准卡片上选择「本对话允许相同动作」后，这些域名在本会话内不再重复询问；也可以让我缩小扫描范围，或改用不需要联网的步骤。`
          : '这个命令需要以系统用户权限运行（执行隔离不可用）。选择「本对话允许相同动作」可在本会话内复用，或让我改用工作区内的只读步骤。';
        throw new Error('用户未批准执行，命令没有启动。' + hint);
      }
      if (ungranted.length) for (const host of ungranted) this.grantNet(host);
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
  /** 域名是否已在本次会话中获得联网授权（按主机+端口精确匹配，不做通配） */
  netGranted(host) {
    const grant = this.netGrants.get(String(host || '').toLowerCase());
    if (!grant) return false;
    if (grant.until && grant.until < Date.now()) { this.netGrants.delete(String(host).toLowerCase()); return false; }
    return true;
  }
  /** 记录一个域名授权；默认随会话结束失效，不落盘 */
  grantNet(host) {
    const key = String(host || '').toLowerCase();
    if (!key) return false;
    this.netGrants.set(key, { host: key, until: null, grantedAt: Date.now() });
    return true;
  }
  netGrantList() { for (const key of [...this.netGrants.keys()]) if (!this.netGranted(key)) this.netGrants.delete(key); return [...this.netGrants.values()].map(g => g.host); }

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
    // 没有界面在听：审批永远等不到答复。立刻拒绝并说明原因，不要让调用方
    // 以为命令只是慢——纯 MCP/CLI 客户端会因此静默挂到外层超时（实测 +15s 规律）。
    if (this.mgr.hasApprovalListener && !this.mgr.hasApprovalListener()) {
      this.auditApproval(run, 'approval-asked', { name: req.name, category: req.category, scopeKey: req.scopeKey });
      this.auditApproval(run, 'approval-decided', { name: req.name, scopeKey: req.scopeKey, outcome: 'unavailable' });
      this.emit('approval-unavailable', { name: req.name, category: req.category });
      throw Object.assign(new Error(
        `${req.name} 需要用户批准，但当前没有可用的确认界面（没有打开的 DecryptHub 窗口）。` +
        '命令没有执行。请打开桌面端窗口后重试，或在设置里把本会话切换为「完全访问」权限。'
      ), { code: 'approval-unavailable' });
    }
    const id = crypto.randomUUID();
    // 成对审计：asked 在请求发出前写，decided 在结算时写。参考 DSH 的
    // approval/asked + approval/decided——崩溃后必须能复盘"当时问了没、结果是什么"。
    // 任一写入失败都不能吞掉决定本身：决定已经做出，日志只是记录。
    this.auditApproval(run, 'approval-asked', { id, name: req.name, category: req.category, scopeKey: req.scopeKey });
    return await new Promise(resolve => {
      let settled = false;
      const finish = (allow, outcome) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort);
        this.pending.delete(id);
        this.auditApproval(run, 'approval-decided', { id, name: req.name, scopeKey: req.scopeKey, outcome: outcome || (allow ? 'allowed-once' : 'rejected') });
        this.emit('approval-resolved', { id, allow: !!allow });
        if (run && this.activeRun === run) this.runs.status(run, 'running');
        resolve(!!allow);
      };
      const timer = setTimeout(() => finish(false, 'timed-out'), 5 * 60 * 1000);
      const onAbort = () => finish(false, 'cancelled');
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
    if (allow && always && p.request.scopeKey) {
      if (p.request.canRemember) this.allows.add(p.request.scopeKey);
      // 联网审批记的是域名而不是整条命令：这样下一次扫描换一批目标时不必重批。
      if (Array.isArray(p.request.network)) for (const host of p.request.network) this.grantNet(host);
    }
    p.finish(!!allow, allow ? 'allowed-once' : 'rejected');
    return true;
  }
  /** 审批审计：日志写入失败不能吞掉决定本身（决定已经做出）。 */
  auditApproval(run, type, payload) {
    if (!run) return;
    try { this.runs.event(run.id, type, payload); } catch {}
  }
  /**
   * 模型主动向用户提问：等界面回答。
   *
   * 「没有答案」有三种完全不同的原因，必须分开返回，否则模型会把
   * 「用户明确跳过」当成「用户授权我自己决定」（参考 DSH skippedAnswerGuidance）：
   *   answered   —— 用户选了选项或输入了文字
   *   skipped    —— 用户明确点了「跳过」：不要复用这条信息，不要重复问，更不是授权
   *   timed-out  —— 等不到回答：可以继续做互不影响的工作，用户之后仍可回答
   *   cancelled  —— 任务被中断或本身是自动化：不要沿这一支继续
   */
  async ask(req, signal) {
    const outcome = (status, answer = '') => ({ status, answer, question: String(req.question || ''), options: Array.isArray(req.options) ? req.options : [] });
    if (signal?.aborted) return outcome('cancelled');
    if (this.activeRun?.source === 'automation') { this.permissionBlocked = true; return outcome('cancelled'); }
    const id = 'q' + (++this.askSeq);
    return await new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        this.askPending.delete(id);
        this.emit('question-resolved', { id });
        // 兼容旧调用方：仍然接受纯字符串，但不再把它当成唯一形态。
        if (value && typeof value === 'object') resolve(value);
        else resolve(outcome(value ? 'answered' : 'skipped', String(value ?? '')));
      };
      const timer = setTimeout(() => finish(outcome('timed-out')), 10 * 60 * 1000);
      const onAbort = () => finish(outcome('cancelled'));
      signal?.addEventListener?.('abort', onAbort, { once: true });
      timer.unref?.();
      this.askPending.set(id, { finish, request: { ...req, id } });
      this.emit('agent-question', { id, question: req.question, detail: req.detail || '', options: req.options || [], kind: req.kind || 'question', todos: this.todos });
    });
  }
  answerAsk(id, answer, { skipped = false } = {}) {
    const p = this.askPending.get(String(id || ''));
    if (!p) return false;
    const text = String(answer ?? '').trim();
    // UI 的「跳过」按钮明确标记 skipped；没有标记但内容为空，也按跳过处理。
    // 原问题一并带回，模型才知道跳过的是哪一条，避免重复问同一件事。
    p.finish({
      status: skipped || !text ? 'skipped' : 'answered',
      answer: text,
      question: String(p.request?.question || ''),
      options: Array.isArray(p.request?.options) ? p.request.options : [],
    });
    return true;
  }
  info() {
    const live = this.browser.activePage ? safe(() => this.browser.activePage.url()) : '';
    if (/^https?:/.test(live)) this.lastUrl = live;
    const url = live || this.lastUrl;
    return { id: this.id, title: this.title, primary: this.primary, pinned: !!this.pinned, running: this.browser.running, embed: this.browser.embedActive, chromePid: this.browser.embedActive ? this.browser.chromePid : null, agentRunning: !!this.agent?.running, url, projectDir: this.projectDir, mode: this.mode, review: this.review, modelSelection: this.modelSelection, workspace: { ...this.workspace, ...this.mgr.workspaces.availability(this.workspace) }, projectId: this.projectId, run: this.runs.latest(), queued: this.queue.length, queuedItems: this.queue.map(q => ({ id: q.id, text: String(q.text || ''), delivery: q.delivery || 'queue', attachments: (q.attachments || []).length })), updatedAt: this.updatedAt };
  }
  subagentSettled(record) {
    const label = record.status === 'completed' ? '已完成' : record.status === 'limited' ? '达到上限' : record.status === 'cancelled' ? '已取消' : '已结束';
    const notice = `子代理「${record.title}」${label}（id=${record.id}）。用 agent_wait("${record.id}") 读取完整结论，核验后再采纳；需要继续研究时用 agent_message 追加要求。`;
    if (this.agent?.running) this.agent.queueNotice(notice);
    else { this.subagentNotices.push(notice); if (this.subagentNotices.length > 10) this.subagentNotices.shift(); this.saveState(); }
    this.emit('subagent-finished', { id: record.id, status: record.status, title: record.title });
  }
  forkSeedForSubagent() {
    // A fork is an exact balanced prefix, not a lossy synopsis. Keep v2 events
    // (including compaction checkpoints and tool responses) through turn-end.
    const completeEvents = this.agent?.hist?.events || [];
    const boundary = completeEvents.findLastIndex(e => e.t === 'turn-end');
    return boundary < 0 ? [] : structuredClone(completeEvents.slice(0, boundary + 1));
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
      pendingSteering: () => this.queue.filter(item => item.delivery === 'steer'),
      ackSteering: id => { this.queue = this.queue.filter(item => item.id !== id); this.saveState(); this.mgr.emitList(); },
      components: this.mgr.components, plugins:this.mgr.plugins, extensions: this.mgr.extensions, sessionId: this.id, projectId: this.projectId, projectRoots: this.workspace.roots || [], projectDir: this.projectDir, browser: this.browser, mcp: this.mcp, relaunch: o => this.relaunch(o),
      openBrowser: opts => this.browser.running ? this.browser.navigate(opts.url).then(() => ({ ok: true })) : this.launch(opts),
      ensureDebugger: () => this.ensureDebugger(),
      subagents: this.subagents, team: this.team, getGoal: () => this.goal, updateGoal: (value, options) => this.updateGoal(value, options), parentContext: () => this.contextForSubagent(), forkSeed: () => this.forkSeedForSubagent(),
      goalOperation: input => {
        if (!this.activeRun || !this.agent?.running) throw Error('目标工具需要当前正在运行的顶级 Agent');
        if (input.action === 'complete' && this.subagents.jobs.size) throw Error('请先等待或取消子代理并核验其结果，再完成目标');
        this.goal = applyGoalOperation(this.goal, input, { directHuman: !!this.activeRun.directHuman, goalRound: this.activeRun.source === 'goal', workspaceId: this.workspace.id, tokenBudget: this.mgr.getSettings().tokenBudget || 0 });
        if (input.operation === 'create') this.activeRun.source = 'goal';
        if (this.goal.status !== 'active') this.goalDriver.cancel();
        this.saveState(); this.emit('goal', this.goal); return goalValue(this.goal);
      },
      getPlan: () => this.planMode.snapshot(), planMode: this.planMode, planBoundary: () => this.planMode.boundary(),
      goalBudget: this.activeRun?.source === 'goal' && this.goal ? { key: this.goal.id + ':' + this.goal.batchId, ...(this.goal.tokenBudget > 0 ? { remaining: Math.max(0, this.goal.tokenBudget - (this.goal.usedTokens || 0)) } : {}) } : null,
      workRoot: this.workspace.root, workspaceId: this.workspace.id, workspaceKind: this.workspace.kind, mode: this.mode, protectedRoot: this.mgr.userDataDir,
      delegationDepth: this.delegationDepth || 0, terminals: this.terminals, sessionId: this.id,
      sessionQuery: this.mgr.sessionQuery, getStepBoundary: () => this.agent?.stepStartSeq ?? 0,
      mcpHost: this.mgr.mcpHost, workspaceRevision: this.workspace.revision,
      changes: this.changes, readHashes: this.readHashes, runId: this.activeRun?.id,
      exec: spec => this.execute(spec, this.agent?.callSignal || this.agent?.abort?.signal),
      getTodos: () => this.todos, setTodos: list => this.setTodos(list),
      emit: (ev, payload) => this.emit('agent-' + ev, payload),
      ask: req => this.ask(req), compact: opts => this.compactWith(opts),
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
  // 手动/工具触发的压缩走这里：给它一个属于本次压缩的 signal，界面上的「取消」才有地方落。
  // 与 agent 自己的 abort 分开——按取消不该顺手中断正在跑的任务（手动压缩本来就只在空闲时允许）。
  compactWith(opts = {}) {
    if (!this.agent) return { ok: false, error: 'agent 未就绪' };
    this.compactController?.abort();
    const controller = new AbortController();
    this.compactController = controller;
    const done = () => { if (this.compactController === controller) this.compactController = null; };
    return this.agent.compress({ ...opts, signal: controller.signal }).finally(done);
  }
  cancelCompact() {
    if (!this.compactController) return false;
    this.compactController.abort(); this.compactController = null;
    return true;
  }

  ensureAgent() {
    if (!this.agent) {
      const restoredAgent = new Agent({ mcp: this.mcp, mcpHost: this.mgr.mcpHost, browser: this.browser, projectDir: this.projectDir,
        getSettings: () => this.requestSettings(), tools: DEFAULT_TOOLS.filter(tool => !tool.component || (this.mgr.components.info().installed && this.mgr.components.info().enabled)),
        emit: (ev, p) => { if (ev === 'debugger-state') this.debuggerPaused = !!p.paused; this.emit('agent-' + ev, p); if (ev === 'done' || ev === 'user') this.mgr.emitList(); },
        getToolContext: () => this.toolCtx(), getWorkspace: () => this.workspace, getGoal: () => this.goal,
        hasApprovalListener: () => this.mgr.hasApprovalListener?.() ?? true,
        getPlan: () => this.planMode.snapshot(),
        record: (type, value) => { if (this.activeRun) this.runs.event(this.activeRun.id, type, value); },
        relaunch: o => this.relaunch(o), getMode: () => this.mode, getReview: () => this.review, approve: (req, signal) => this.approve(req, signal),
        ask: (req, signal) => this.ask(req, signal), getTodos: () => this.todos, setTodos: list => this.setTodos(list),
        currentUrl: () => { try { return this.browser.activePage?.url() || this.lastUrl || ''; } catch { return ''; } },
        fileSize: rel => workspaceFileSize(this.toolCtx(), rel) });
      restoredAgent.restore(); this.agent = restoredAgent;
      const loggedPlan = this.agent.hist.events.findLast(e => e.t === 'system' && e.source?.kind === 'plan-mode' && typeof e.active === 'boolean');
      if (loggedPlan && (!this.hasSavedPlan || (loggedPlan.planRevision || 0) > this.planMode.revision)) {
        this.planMode.active = loggedPlan.active;
        this.planMode.pending = null;
        this.planMode.revision = loggedPlan.planRevision || 0;
        this.planMode.entered ||= this.agent.hist.events.some(e => e.t === 'system' && e.source?.kind === 'plan-mode' && e.active);
      }
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
  send({ text = '', auto, maxSteps, tokenBudget, attachments, source = 'user', enqueue = false, delivery = 'queue', id: messageId }, continuationKey) {
    if (this.closing) return { ok: false, error: '会话正在关闭或删除' };
    const continuation = continuationKey === GOAL_CONTINUATION && this.goal?.status === 'active';
    if (continuationKey === GOAL_CONTINUATION && !continuation) return { ok: false, error: '目标已暂停或结束' };
    if (this.mgr.projectsBusy) return { ok: false, error: '正在更新项目目录，请稍候' };
    if (this.mgr.plugins?.applying) return { ok:false, error:'正在切换插件，请稍后发送任务' };
    if (source === 'user' && this.goal?.status === 'active') source = 'goal';
    // 长文本守门：UI 已经在粘贴时落盘，这里兜住绕过 UI 的路径（脚本、恢复、队列重发）。
    // 正文写成工作区文件，消息只保留引用，避免一条 100 万字符的消息再次撑爆上下文与渲染。
    if (!continuation && typeof text === 'string' && text.length > PASTE_LIMIT) {
      try {
        const saved = savePastedText(this.toolCtx(), text);
        text = pasteNotice(saved);
      } catch (e) { return { ok: false, error: '长文本保存失败：' + e.message }; }
    }
    const s = this.requestSettings();
    if (s.selectionError) return { ok: false, code: 'model-required', error: s.selectionError };
    try { attachments = validateAttachments(this.projectDir, attachments || [], { workRoot: this.workspace.root, vision: !!((s.provider === 'anthropic' ? s.anthropic : s.openai) || {}).vision }); }
    catch (e) { return { ok: false, error: e.message }; }
    // 通用 Agent：不依赖浏览器。浏览器只是可选工具，会话里没有页面也能对话。
    const agent = this.ensureAgent();
    if (!agent) return { ok: false, error: '会话未就绪' };
    if (agent.running) {
      if (!enqueue) return { ok: false, code: 'busy', error: '该会话正在运行，可以将消息加入待发送队列' };
      if (this.queue.length >= 10) return { ok: false, error: '队列最多保留 10 条消息' };
      const item = { id: crypto.randomUUID(), text, auto, maxSteps, tokenBudget, attachments, source };
      this.queue.push(item);
      const steered = delivery === 'steer' && steerQueued(this, item.id).ok;
      this.saveState(); this.mgr.emitList(); return { ok: true, queued: true, steered };
    }
    // 前端保存时会把当前渠道镜像进 openai/anthropic；这里再兜一层，避免渠道密钥还没同步时误报
    const active = (s.providers || []).find(p => p.id === s.activeProviderId);
    const key = active?.apiKey || (s.provider === 'anthropic' ? s.anthropic?.apiKey : s.openai?.apiKey);
    if (!key) return { ok: false, code: 'model-required', error: '尚未配置 API Key，请在「设置」页填写' };
    // A working folder can host several sessions; run ownership belongs to
    // each Agent, and durable history ownership belongs to its private log.
    try { this.mgr.workspaces.verify(this.workspace); }
    catch (e) { return { ok: false, code: e.code, error: e.message }; }
    this.goalDriver.cancel(); clearTimeout(this.queueTimer);
    if (source === 'goal' && this.goal?.status === 'active') { this.goal.turns++; if (this.goal.tokenBudget > 0) tokenBudget = Math.min(tokenBudget || Infinity, Math.max(1, this.goal.tokenBudget - (this.goal.usedTokens || 0))); this.saveState(); this.emit('goal', this.goal); }
    let goalId = source === 'goal' ? this.goal?.id : null;
    const goalRevision = this.goal?.revision || 0;
    this.permissionBlocked = false;
    const run = this.runs.start({ workspace: this.workspace, mode: this.mode, text: continuation ? this.goal.objective : text, source }); this.activeRun = run;
    run.directHuman = !continuation && source !== 'automation';
    this.lastGoal = { text, auto };
    if (!continuation) this.suggestTitle(text);
    this.updatedAt = Date.now(); this.mgr.emitList();
    const goalTimer = goalId && this.goal.deadline ? setTimeout(() => agent.finishSoon(), Math.max(1, this.goal.deadline - Date.now())) : null;
    if (this.subagentNotices.length) { for (const notice of this.subagentNotices.splice(0)) agent.queueNotice(notice); this.saveState(); }
    this.completion = agent.send(text, { auto, maxSteps, tokenBudget, attachments, messageId, runId: run.id, directHuman: run.directHuman, continuation, ...(continuation ? { continuationSource: { kind: 'goal' }, continuationNotice: { objective: this.goal.objective, turns: this.goal.turns || 0, summary: this.goal.summary || '', nextAction: this.goal.nextAction || '', status: this.goal.status } } : {}) }).then(result => {
      if (!goalId && run.source === 'goal') goalId = this.goal?.id;
      if (goalId && this.goal?.id === goalId) {
        const hasWork = (this.goal.revision || 0) !== goalRevision || agent.hist.events.some(e => e.t === 'tool' && e.turnId === run.id && !e.isError && !['goal_update', 'goal_get', 'todo_write', 'agent_list'].includes(e.name));
        this.goal = finishGoalRound(this.goal, result, { automatic: continuation, hasWork });
      }
      const status = this.permissionBlocked || ['max-steps', 'budget', 'time-limit', 'stalled'].includes(result?.stop) ? 'needs_attention' : result?.stop === 'completed' ? 'completed' : result?.stop === 'interrupted' ? 'cancelled' : 'failed';
      this.runs.status(run, status, { stop: result?.stop, usage: result?.usage }); if (goalId && this.goal?.id === goalId && this.goal.status === 'active' && (status !== 'completed' && result?.stop !== 'max-steps')) { this.goal.status = status === 'cancelled' ? 'paused' : 'needs_attention'; } return { ...run };
    }).catch(e => { this.runs.status(run, 'failed', { error: e.message }); if (goalId && this.goal?.id === goalId) this.goal.status = 'needs_attention'; this.emit('agent-error', e.message); return { ...run }; })
      .finally(() => {
        clearTimeout(goalTimer); this.activeRun = null; this.subagents.cancelRun(run.id);
        if (!this.closing) {
          if (this.queue.length && this.stoppedRun !== run) this.queueTimer = setTimeout(() => { if (!this.closing && !this.agent?.running) this.resumeQueue(); }, 0);
          else if (goalId && this.goal?.id === goalId) this.goalDriver.schedule();
        }
        if (this.stoppedRun === run) this.stoppedRun = null;
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
  async goalAction(action, { revision } = {}) {
    if (!this.goal) return { ok: false, error: '当前没有目标。输入 /goal 后填写要完成的任务。' };
    if (revision !== undefined && revision !== null && Number(revision) !== (Number(this.goal.revision) || 0)) return { ok: false, error: '目标已在别处更新，请刷新后重试' };
    if (action === 'pause' || action === 'clear') { this.interrupt(); if (action === 'clear') this.goal = null; }
    else if (action === 'resume') {
      if (this.agent?.running) return { ok: false, error: '请等待当前任务结束' };
      if (this.goal.workspaceId !== this.workspace.id) return { ok: false, error: '目标绑定的工作区已变化，请切回原工作区或新建目标' };
      if (this.goal.status === 'complete') return { ok: false, error: '此目标已经完成，请新建目标' };
      if (!this.goal.maxTurns) this.goal.maxTurns = 256;
      if (this.goal.turns >= this.goal.maxTurns) return { ok: false, error: '目标轮次已达上限，请明确要求增加 max_goal_rounds 后再继续' };
      if (this.goal.tokenBudget > 0 && this.goal.usedTokens >= this.goal.tokenBudget) return { ok: false, error: '目标 token 预算已用尽，请调整目标预算后再继续' };
      this.goalDriver.cancel(); this.goal.status = 'active'; this.goal.batchId = crypto.randomUUID(); this.goal.revision = (Number(this.goal.revision) || 0) + 1; this.goal.deadline = null; this.goal.stopReason = null; this.goal.resumeNote = '';
      const r = await this.send({ text: '', source: 'goal' }, GOAL_CONTINUATION);
      if (!r.ok) this.goal.status = 'paused'; this.saveState(); this.emit('goal', this.goal); return r;
    } else return { ok: false, error: '未知目标操作' };
    this.saveState(); this.emit('goal', this.goal); return { ok: true };
  }
  updateGoal(value, { revision } = {}) {
    // 三种失败原因差别很大，分开报：否则模型会把「目标已 blocked」误读成「你不是 /goal 启动的」。
    if (!this.goal) throw new Error('当前没有长期目标。目标只能由用户用 /goal 启动，我不能自行创建。可以直接继续做当前任务，或用 goal_update 之外的普通回复汇报进展。');
    if (this.goal.status !== 'active') {
      const label = { paused: '已暂停', needs_attention: '需要你处理', complete: '已完成' }[this.goal.status] || this.goal.status;
      throw new Error(`当前目标状态是 ${label}，不在执行中；请先点「继续目标」再更新进展${this.goal.stopReason ? '（' + this.goal.stopReason + '）' : ''}`);
    }
    if (this.activeRun?.source !== 'goal') throw new Error('当前这一轮不是目标续跑轮次，不能更新目标。等本轮结束后目标会自动接续，届时再记录进展。');
    if (revision !== undefined && revision !== null && Number(revision) !== (Number(this.goal.revision) || 0)) throw new Error('目标已在别处更新，请刷新后重试');
    if (value.status === 'complete' && this.subagents.jobs.size) throw new Error('请先等待或取消研究子代理，并核验其结果，再完成目标');
    this.goal = updateGoal(this.goal, value, { runId: this.activeRun.id });
    if (this.goal.status !== 'active') this.goalDriver.cancel();
    this.saveState(); this.emit('goal', this.goal); return this.goal;
  }
  cancelTurn(runId) {
    // A delayed click/shortcut addresses the observed turn, never its successor.
    if (!runId || this.activeRun?.id !== runId || !this.agent?.running) return false;
    this.stoppedRun = this.activeRun;
    this.interrupt({ preserveQueue: true });
    return true;
  }
  interrupt({ preserveQueue = false } = {}) { this.goalDriver.cancel(); clearTimeout(this.queueTimer); if (!preserveQueue) this.queue = []; this.compactController?.abort(); this.compactController = null; if (this.goal?.status === 'active') { this.goal.status = 'paused'; this.goal.revision = (Number(this.goal.revision) || 0) + 1; this.emit('goal', this.goal); } this.subagents.cancelAll(); this.saveState(); this.agent?.interrupt(); killAllJobs(this.projectDir); this.mgr.emitList(); }
  steerQueued(id, runId) { return steerQueued(this, id, runId); }
  resumeQueue() { if (this.agent?.running) throw new Error('任务正在运行'); const history = this.ensureAgent().hist.events; this.queue = this.queue.filter(item => !history.some(event => event.t === 'user' && event.id === item.id)); const next = this.queue.shift(); const result = next ? this.send(next) : { ok: false, error: '队列为空' }; if (next && !result.ok) this.queue.unshift(next); this.saveState(); this.mgr.emitList(); return result; }
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
  // Rewriting a prompt forks before its exact event; source results and files
  // remain intact. Inherited tool calls are never replayed by the host.
  async editTurn(turnId, text, attachments, atSeq) {
    if (this.agent?.running) return { ok: false, error: '任务正在运行，停止后才能编辑已发送消息' };
    const events = this.ensureAgent().hist.events;
    const index = atSeq === undefined ? events.findIndex(e => e.t === 'user' && e.turnId === turnId) : atSeq;
    if (!Number.isSafeInteger(index) || index < 0 || events[index]?.t !== 'user' || turnId && events[index].turnId && events[index].turnId !== turnId) return { ok: false, error: '原消息位置已变化，请重新选择' };
    const value = String(text ?? '').trim();
    const selectedAttachments = attachments ?? events[index].attachments ?? [];
    if (!value && !selectedAttachments.length) return { ok: false, error: '消息不能为空' };
    const config = selectionSettings(this.mgr.getSettings(), captureSelection(this.mgr.getSettings()));
    validateAttachments(this.projectDir, selectedAttachments, { workRoot: this.workspace.root, vision: !!config[config.provider]?.vision });
    const child = await this.mgr.forkSession(this.id, index - 1, { focus: false, allowEmpty: true });
    try {
      copyForkResources(this.projectDir, child.projectDir, [{ attachments: selectedAttachments }]);
      const result = child.send({ text: value, attachments: selectedAttachments });
      if (!result.ok) { await this.mgr.delete(child.id); return result; }
      await this.mgr.focus(child.id);
      return { ...result, sessionId: child.id, parentSessionId: this.id };
    } catch (error) { await this.mgr.delete(child.id); throw error; }
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
  async dispose() { this.closing = true; this.goalDriver.cancel(); clearTimeout(this.queueTimer); this.titleRevision++; this.titleController?.abort(); this.subagents.dispose(); if (this.goal?.status === 'active') this.goal.status = 'paused'; this.agent?.interrupt(); killAllJobs(this.projectDir); this.saveState(); for (const p of this.pending.values()) p.finish(false); for (const p of this.askPending.values()) p.finish({ status: 'cancelled', answer: '' }); if (this.completion) await Promise.race([this.completion.catch(() => {}), new Promise(r => setTimeout(r, 2500))]); await this.terminals.closeAll(); await this.closeBrowser().catch(() => {}); this.agent?.hist.close(); }
}

export class SessionManager {
  constructor({ userDataDir, getSettings, broadcast, chromeMod, mcpHost, titleGenerator, hasApprovalListener }) {
    Object.assign(this, { userDataDir, getSettings, broadcast, chromeMod, mcpHost, hasApprovalListener });
    this.dataLease = new WriterLease(userDataDir, '.data-write-lease.sqlite');
    try {
    // 模型入口在这里注入：session-titles.mjs 对 UI 保持零 Node 依赖，不自己 import providers。
    const titleService = new SessionTitleService({ complete: chat });
    this.titleGenerator = titleGenerator || titleService.generate.bind(titleService);
    this.components = new ComponentStore(userDataDir);
    this.workspaces = new WorkspaceStore(userDataDir);
    this.projects = new ProjectStore(userDataDir);
    this.sessions = new Map(); this.focusedId = null; this.seq = 0;
    this.sessionQuery = new SessionQuery(this);
    this.stateFile = path.join(userDataDir, 'sessions.json');
    // 无项目归属的历史会话：不恢复、不自动迁移，也不从索引里抹掉。
    // 它们属于「项目」概念出现之前的数据；是否恢复或删除由用户在界面上明确决定
    // （见 UI 的 legacy-sessions 提示与下面的 restoreLegacySessions / discardLegacySessions）。
    // 这里只是把它们原样留在索引里，避免 emitList 写盘时顺手把用户数据写成「已删除」。
    this.legacyEntries = [];
    // 恢复上次的会话标签（标题、最后访问的网址、对话上下文；浏览器按需再启动）
    let saved = null; try { saved = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch {}
    const indexed = new Set();
    if (saved?.sessions?.length) {
      for (const x of saved.sessions) {
        if (!/^(?:main|s(?:[0-9a-f]{6}|[0-9a-f]{32}))$/.test(x.id) || !!x.primary !== (x.id === 'main')) throw Error('会话索引身份无效');
        indexed.add(x.id);
        const stateFile = path.join(userDataDir, 'projects', x.primary ? 'default' : x.id, '.agent-state.json');
        let state = null; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
        if (!state?.projectId) { this.legacyEntries.push({ ...x }); continue; }
        this.create({ id: x.id, title: x.title, titleSource: x.titleSource, primary: x.primary, lastUrl: x.url, updatedAt: x.updatedAt, pinned: x.pinned, quiet: true, projectId: state.projectId });
      }
      if (saved.focused && this.sessions.has(saved.focused)) this.focusedId = saved.focused;
      if (!this.focusedId) this.focusedId = this.sessions.values().next().value?.id || null;
      this.seq = Math.max(this.seq, saved.seq || 0);
    }
    this.adoptOrphans(indexed);
    } catch (error) { this.dataLease.close(); throw error; }
  }
  /**
   * 把「磁盘上有数据目录、索引里却没有」的会话收进历史会话列表。
   * 这类会话比没有 projectId 的更隐蔽：它不在索引里，所以既不会被恢复，
   * 也不会出现在删除提示里——用户完全看不到它存在。只收有 .agent-history.json
   * （真有对话）的目录，避免把空壳目录也列出来。
   */
  adoptOrphans(indexed) {
    let names = [];
    try { names = fs.readdirSync(path.join(this.userDataDir, 'projects'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return; }
    for (const name of names) {
      if (indexed.has(name) || this.legacyEntries.some(x => x.id === name)) continue;
      if (!/^(?:main|s(?:[0-9a-f]{6}|[0-9a-f]{32}))$/.test(name)) continue;
      const dir = path.join(this.userDataDir, 'projects', name);
      if (!fs.existsSync(path.join(dir, '.agent-history.json'))) continue;
      let state = null; try { state = JSON.parse(fs.readFileSync(path.join(dir, '.agent-state.json'), 'utf8')); } catch {}
      this.legacyEntries.push({
        id: name, title: '', primary: name === 'main', updatedAt: 0, pinned: false, orphan: true,
      });
    }
  }
  /** 等待用户决定如何处理的历史会话（项目概念之前创建、没有 projectId）。 */
  legacySessions() {
    return this.legacyEntries.map(x => {
      // restorable 只表示「结构上能接回当前模型」，不代表一定能成功；真正裁决在 restoreLegacySessions。
      const stateFile = path.join(this.userDataDir, 'projects', x.primary ? 'default' : x.id, '.agent-state.json');
      let state = null; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
      const ws = state?.workspace || {};
      const hasProject = !!(state?.projectId && this.projects.entries.some(p => p.id === state.projectId));
      return {
        id: x.id,
        title: String(x.title || this.orphanTitle(x.id) || x.id || ''),
        primary: !!x.primary,
        updatedAt: Number(x.updatedAt) || this.historyMtime(x.id),
        url: String(x.url || ''),
        kind: ws.kind === 'managed' ? 'managed' : 'folder',
        hasProject,
        restorable: hasProject || !!(ws.kind === 'managed' ? ws.id : ws.root),
      };
    });
  }
  /** 没有索引条目的孤儿会话没有标题，用第一条用户消息代替 id，至少让人认得出是哪段对话。 */
  orphanTitle(id) {
    try {
      const first = History.load(path.join(this.userDataDir, 'projects', id, '.agent-history.json'), '').events.find(e => e?.t === 'user' && typeof e.content === 'string' && e.content.trim() && !e.content.startsWith('【'));
      const text = String(first?.content || '').replace(/【[^】]*】[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 40);
    } catch {}
    return '';
  }
  historyMtime(id) {
    try { return fs.statSync(path.join(this.userDataDir, 'projects', id, '.agent-history.json')).mtimeMs; } catch { return 0; }
  }
  /**
   * 把用户明确要求保留的历史会话接回当前模型（不删除任何东西）。
   * 两条路径：
   *  - 已有合法 projectId 且项目还在 → 只把会话补回索引（原先"关闭的标签"重新出现）。
   *  - 没有 projectId → 为它建一个只含单个目录的项目：
   *      托管工作区改指当前数据目录下的同名目录（旧版本可能记着另一个安装路径）；
   *      用户文件夹必须仍然存在，否则拒绝并报告原因。
   * 逐条独立处理：一条失败不影响其它，也绝不写坏已成功的索引。
   */
  async restoreLegacySessions(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    const restored = [], skipped = [];
    for (const entry of this.legacyEntries) {
      if (!wanted.has(entry.id)) continue;
      const stateFile = path.join(this.userDataDir, 'projects', entry.primary ? 'default' : entry.id, '.agent-state.json');
      let state = null; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
      if (!state) { skipped.push({ id: entry.id, title: entry.title, reason: '会话状态文件缺失，无法确认工作区' }); continue; }
      try {
        const projectId = this.ensureProjectFor(entry, state);
        atomicJson(stateFile, { ...state, projectId });
        this.create({ id: entry.id, title: entry.title, updatedAt: entry.updatedAt, pinned: entry.pinned, quiet: true, projectId });
        this.legacyEntries = this.legacyEntries.filter(x => x.id !== entry.id);
        restored.push({ id: entry.id, title: entry.title, projectId });
      } catch (error) { skipped.push({ id: entry.id, title: entry.title, reason: error.message }); }
    }
    if (restored.length) this.emitList();
    return { restored, skipped };
  }
  /** 历史会话要接回当前模型，必须先有一个项目；已有合法项目就复用。 */
  ensureProjectFor(entry, state) {
    if (state.projectId && this.projects.entries.some(p => p.id === state.projectId)) return state.projectId;
    const ws = state.workspace || {};
    const managed = ws.kind === 'managed';
    // 托管工作区永远是数据目录下的 projects/<会话 id>/workspace：跟着数据目录走，不保留旧安装路径。
    const root = managed ? path.join(this.userDataDir, 'projects', entry.id, 'workspace') : ws.root;
    if (!root) throw Error('会话缺少工作区信息，无法恢复');
    if (managed) fs.mkdirSync(root, { recursive: true });
    else {
      let st = null; try { st = fs.statSync(root); } catch {}
      if (!st?.isDirectory()) throw Error('原工作文件夹已不存在：' + root);
      if (pathKey(fs.realpathSync.native(this.userDataDir)) === pathKey(fs.realpathSync.native(root)) || root.startsWith(this.userDataDir + path.sep))
        throw Error('工作区位于应用数据目录内，不能作为代码工作区');
    }
    const folder = { id: ws.id || crypto.randomUUID(), kind: managed ? 'managed' : 'folder', root, revision: 1, label: ws.label || '恢复的会话' };
    const title = String(entry.title || entry.id || '').trim() || entry.id;
    const project = this.projects.save({ name: ('恢复：' + title).slice(0, 80), folders: [folder], primaryId: folder.id });
    return project.id;
  }
  /**
   * 删除用户明确要求清理的历史会话。
   * 只删这些会话自己的数据目录：共享的 chrome-profile 不清空，
   * 因为新建的主会话仍然使用同一个 browser profile 路径。
   */
  async discardLegacySessions(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    const targets = this.legacyEntries.filter(x => wanted.has(x.id));
    if (!targets.length) return { removed: [] };
    const root = fs.realpathSync.native(this.userDataDir);
    const parent = path.join(root, 'projects');
    const removed = new Set();
    for (const x of targets) {
      const target = path.join(parent, x.primary ? 'default' : x.id);
      const info = fs.lstatSync(target, { throwIfNoEntry: false });
      // 与正常删除同一条底线：不跟随被链接替换的目录。
      if (info && !info.isSymbolicLink() && pathKey(fs.realpathSync.native(target)) === pathKey(target)) {
        await fs.promises.rm(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
      } else if (info) {
        throw Error('拒绝删除被链接替换的会话目录');
      }
      removed.add(x.id);
    }
    this.legacyEntries = this.legacyEntries.filter(x => !removed.has(x.id));
    this.emitList();
    return { removed: [...removed] };
  }
  list() {
    // 置顶优先；同组内保持原有顺序（sort 稳定）
    const all = [...this.sessions.values()];
    const sorted = [...all].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return { focused: this.focusedId, sessions: sorted.map(s => s.info()) };
  }
  emitList() {
    if (this.closed) return this.list();
    const l = this.list(); this.broadcast('sessions', l);
    // 历史会话（无项目归属）原样写回索引：它们没被恢复，但也没有被用户删除。
    atomicJson(this.stateFile, { focused: l.focused, seq: this.seq, sessions: [...l.sessions.map(s => ({ id: s.id, title: s.title, titleSource: this.sessions.get(s.id).titleSource, primary: s.primary, url: s.url, updatedAt: s.updatedAt, pinned: s.pinned })), ...this.legacyEntries] });
  }
  create({ title, titleSource, primary, id: wantId, lastUrl, updatedAt, pinned, quiet, projectId = this.focused()?.projectId } = {}) {
    if (this.projectsBusy) throw new Error('正在更新项目目录，请稍候创建会话');
    if (!projectId) throw Error('请先选择项目');
    const projectWorkspace = this.projects.workspace(projectId);
    if (!quiet) this.workspaces.verify(projectWorkspace);
    if (this.closed) throw Error('会话管理器已关闭');
    let id = primary ? 'main' : (wantId && /^s(?:[0-9a-f]{6}|[0-9a-f]{32})$/.test(wantId) ? wantId : 's' + crypto.randomUUID().replaceAll('-', ''));
    if (this.sessions.has(id)) throw new Error('会话 ID 重复：' + id);
    this.seq++;
    const s = new Session(this, { id, title: title || `会话 ${this.seq}`, titleSource, primary: !!primary, lastUrl, updatedAt, pinned, projectId });
    this.sessions.set(id, s);
    if (s.createdAt === null && !fs.existsSync(path.join(s.projectDir, '.agent-history.json'))) s.createdAt = Date.now();
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
  async forkSession(id, atSeq, { focus = true, allowEmpty = false } = {}) {
    const source = this.get(id); this.workspaces.verify(source.workspace);
    if (this.projectsBusy || source.closing) throw Error('会话或工作区正在变化，暂不能创建分支');
    const history = source.ensureAgent().hist.events;
    const boundary = atSeq ?? history.findLastIndex(event => event.t === 'turn-end');
    if (!Number.isSafeInteger(boundary) || boundary < (allowEmpty ? -1 : 0) || boundary >= history.length) throw Error('没有可用的分支位置');
    const prefix = structuredClone(history.slice(0, boundary + 1));
    let number = 2, title; const titles = new Set([...this.sessions.values()].map(session => session.title));
    do { title = source.title + ' (' + number++ + ')'; } while (titles.has(title));
    const child = this.create({ title, titleSource: 'manual', projectId: source.projectId, quiet: true });
    try {
      child.parentSessionId = source.id; child.inheritedEventCount = prefix.length;
      child.mode = source.mode; child.review = source.review; child.modelSelection = captureSelection(this.getSettings());
      const loggedPlan = prefix.findLast(event => event.t === 'system' && event.source?.kind === 'plan-mode');
      child.planMode.active = loggedPlan?.active === true; child.planMode.pending = null;
      child.planMode.entered = prefix.some(event => event.source?.kind === 'plan-mode' && event.active);
      child.planMode.revision = loggedPlan?.planRevision || 0;
      const calls = new Map();
      for (const event of prefix) {
        if (event.t === 'assistant') for (const call of event.calls || []) if (call.name === 'todo_write') { try { calls.set(call.id, typeof call.args === 'string' ? JSON.parse(call.args) : call.args); } catch { calls.delete(call.id); } }
        if (event.t === 'tool' && !event.isError && calls.has(event.id)) { const args = calls.get(event.id); child.todos = applyTodos(child.todos, args.steps, args.merge); }
      }
      copyForkResources(source.projectDir, child.projectDir, prefix);
      child.saveState(); const agent = child.ensureAgent(); agent.hist.events = prefix;
      const closers = closeHistoryTail(prefix, 'forked');
      prefix.push({ t: 'system', at: prefix.at(-1)?.at || Date.now(), source: { kind: 'fork-seed' }, inheritedEventCount: child.inheritedEventCount }, ...closers);
      agent.persist();
      if (focus) await this.focus(child.id); else this.emitList();
      return child;
    } catch (error) { await this.delete(child.id); throw error; }
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
      this.sessionQuery.forget(id);
      this.sessions.delete(id);
      if (this.focusedId === id) { this.focusedId = null; const next = this.sessions.values().next().value; if (next) await this.focus(next.id).catch(() => {}); }
      this.emitList();
    } finally { s.deleting = false; }
  }
  async closeAll() { try { await Promise.all([...this.sessions.values()].map(s => s.dispose())); } finally { this.closed = true; this.sessionQuery.close?.(); this.dataLease.close(); } }
}
function safe(f) { try { return f(); } catch { return ''; } }
