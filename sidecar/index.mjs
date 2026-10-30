// Sidecar host: Windows Node bundle / Linux executable. Legacy worker modes remain for compatibility.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODE = process.env.JSRA_MODE || 'server';
const { runtimeInfo } = await import('./runtime.mjs');
// 父进程看门狗：父进程（Tauri 外壳 / sidecar）意外退出时自行退出，避免遗留孤儿 sidecar / core / Chrome
const PARENT_PID = process.ppid;
function watchParent(onGone) {
  if (!PARENT_PID || PARENT_PID <= 1) return;
  const t = setInterval(() => { let alive = true; try { process.kill(PARENT_PID, 0); } catch (e) { alive = e.code === 'EPERM'; } if (!alive || process.ppid !== PARENT_PID) { clearInterval(t); onGone(); } }, 3000);
  t.unref?.();
}

await startServer();

async function startServer() {
  const { WebSocketServer } = await import('ws');
  const crypto = await import('node:crypto');
  const { denyReason } = await import('./access.mjs');
  const settingsMod = await import('./settings.mjs');
  const chromeMod = { findChrome: () => [] };
  const git = await import('./git.mjs');
  const windowsRuntime = await import('./windows-runtime.mjs');
  const { SessionManager } = await import('./sessions.mjs');
  const { DEFAULT_TOOLS: LOCAL_TOOLS } = await import('./catalog.mjs');
  const { registryIssues } = await import('./contract.mjs');
  const { resolveIn } = await import('./paths.mjs');
  const { collectArtifacts, groupArtifacts } = await import('./artifacts.mjs');
  const { listWorkspace, listDirectory, readWorkspace } = await import('./workspace.mjs');
  const { executor } = await import('./executor.mjs');
  const { consumeFolderGrant } = await import('./grants.mjs');
  const { selectReadRoot } = await import('./workspaces.mjs');
  const { ProjectService } = await import('./project-service.mjs');
  const { ExtensionStore } = await import('./extensions.mjs');
  const { publicSettings, decryptSecrets, mirrorProvider } = await import('./secrets.mjs');
  const { registerAttachment, attachmentPreview } = await import('./attachments.mjs');
  const { conversationMarkdown } = await import('./transcript.mjs');
  const { searchSessions } = await import('./session-search.mjs');
  const { openFeedback } = await import('./feedback.mjs');
  const { readDocument } = await import('./documents.mjs');
  const consumedGrants = new Map();
  const usedNativeNonces = new Set();

  let settings = settingsMod.load();
  if (!process.env.JSRA_OPENAI_BASE) mirrorProvider(settings);
  const logDir = path.join(settingsMod.userDataDir(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'sidecar-' + new Date().toISOString().slice(0, 10) + '.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  function fileLog(line) { try { logStream.write('[' + new Date().toISOString() + '] ' + line + '\n'); } catch {} }
  fileLog('sidecar 启动 pid=' + process.pid + ' 资源=' + runtimeInfo.source + (runtimeInfo.error ? ' 错误=' + runtimeInfo.error : ''));
  // 工具注册表体检：重名/缺 run/缺 schema 不阻塞启动，但必须留痕
  { const issues = registryIssues(LOCAL_TOOLS); if (issues.length) { fileLog('工具注册表体检：' + issues.join('；')); process.stderr.write('工具注册表体检：' + issues.join('；') + '\n'); } }

  const clients = new Set();
  // 事件信封带 sid（会话 id）；全局事件 sid=null
  function broadcast(channel, payload, sid = null) {
    if (channel === 'log') fileLog((sid ? '[' + sid + '] ' : '') + String(payload));
    if (channel === 'run-event' && ['run-started', 'run-status'].includes(payload.type)) fileLog(`[session=${sid}][run=${payload.runId}] ${payload.type} ${payload.run?.status || ''} ${payload.run?.stop || ''}`);
    const msg = JSON.stringify({ type: 'event', channel, sid, payload });
    for (const c of clients) { try { c.send(msg); } catch {} }
  }
  // 用户接入的 MCP 服务：全局一份，所有会话共享（工具名带服务前缀）
  let plugins;
  const { PluginManager } = await import('./plugins.mjs');
  const { McpHost } = await import('./mcphost.mjs');
  const mcpHost = new McpHost({
    getServers: () => settings.mcpServers || {},
    baseDir: settingsMod.userDataDir(),
    log: m => fileLog(m),
    onChange: status => { broadcast('mcp-status', status); plugins?.notify(); },
  });
  const sessions = new SessionManager({ userDataDir: settingsMod.userDataDir(), getSettings: () => settings, broadcast, chromeMod, mcpHost });
  plugins = new PluginManager({ components:sessions.components, mcpHost, getSettings:()=>settings, saveSettings:()=>settingsMod.save(settings), getSessions:()=>[...sessions.sessions.values()], broadcast });
  sessions.plugins = plugins;
  mcpHost.apply().catch(e => fileLog('MCP 服务启动失败: ' + e.message));
  // 自动化任务：每天定时把一句话交给 AI（新建会话 → 起浏览器 → 发送）
  const { TaskStore } = await import('./tasks.mjs');
  const tasks = new TaskStore({ userDataDir: settingsMod.userDataDir(), getSessions: () => sessions, log: m => fileLog(m), onChange: list => broadcast('tasks-status', list) });
  sessions.onDeleting = id => tasks.pauseForSession(id);
  const extensions = new ExtensionStore({ directory: settingsMod.userDataDir(), getSettings: () => settings,
    saveSettings: () => settingsMod.save(settings), plugins, mcpHost, tasks,
    changed: () => { for (const s of sessions.sessions.values()) s.agent?.emitContext(); broadcast('extensions-changed', true); } });
  sessions.extensions = extensions;
  const projects = new ProjectService(sessions, (grant, sid) => consumeFolderGrant(wsToken, grant, sid, consumedGrants));
  projects.start();
  tasks.start();
  const S = a => { const session = sessions.get(a?.sessionId); if (session.closing) throw Error('会话正在关闭或删除'); return session; };
  const B = a => { const s = S(a); if (!s.browser.running) throw new Error('该会话的浏览器未启动'); return s.browser; };

  let downloading = null;
  const handlers = {
    'get-settings': () => publicSettings(settings),
    'save-settings': s => {
      const previous = settings, old = new Map((settings.providers || []).map(p => [p.id, p]));
      settings = { ...settings, ...s, mcpServers:settings.mcpServers, openai: { ...settings.openai, ...(s?.openai || {}), apiKey: s?.openai?.apiKey || settings.openai.apiKey }, anthropic: { ...settings.anthropic, ...(s?.anthropic || {}), apiKey: s?.anthropic?.apiKey || settings.anthropic.apiKey } };
      if (Array.isArray(s?.providers)) settings.providers = s.providers.map(p => ({ ...p, apiKey: (!nativeKey && p.apiKey) || old.get(p.id)?.apiKey || (!previous.providers?.length && previous[p.type]?.baseUrl === p.baseUrl ? previous[p.type]?.apiKey : '') || (p.type === 'openai' && process.env.JSRA_OPENAI_KEY && settings.openai.baseUrl === p.baseUrl ? process.env.JSRA_OPENAI_KEY : '') || '' }));
      mirrorProvider(settings); settingsMod.save(settings); mcpHost.apply().catch(e => fileLog('MCP 应用失败: ' + e.message));
      for (const x of sessions.sessions.values()) if (x.agent) x.agent.emitContext(); return publicSettings(settings);
    },
    'secrets-sync': a => {
      if (!nativeKey || usedNativeNonces.has(a?.envelope?.nonce)) throw new Error('无效或重复的原生凭据同步');
      const values = decryptSecrets(nativeKey, a.envelope); usedNativeNonces.add(a.envelope.nonce);
      for (const p of settings.providers || []) p.apiKey = values['prov.' + p.id] || (p.type === 'openai' && process.env.JSRA_OPENAI_BASE === p.baseUrl ? process.env.JSRA_OPENAI_KEY || '' : '');
      mirrorProvider(settings); return publicSettings(settings);
    },
    // MCP 服务管理：列表/测试/保存/重启。保存会立即与常驻连接对齐。
    'plugins-list': async () => { await plugins.runtime(); return plugins.status(); },
    'plugins-refresh': a => plugins.refresh(!!a?.force),
    'plugin-install': a => plugins.install(a?.id),
    'plugin-cancel': a => plugins.cancel(a?.id),
    'plugin-toggle': a => plugins.toggle(a?.id,!!a?.enabled),
    'plugin-configure': a => plugins.configure(a?.id,a?.endpoint,a?.enabled!==false),
    'plugin-reconnect': a => plugins.reconnect(a?.id),
    'mcp-status': () => mcpHost.status(),
    'mcp-test': a => mcpHost.test(a || {}),
    'mcp-restart': async a => { await mcpHost.restart(String(a?.name || '')); return mcpHost.status(); },
    'mcp-save': a => extensions.saveMcp(a?.servers || {}, a?.approveNames || []),
    'projects-list': () => sessions.projects.list(),
    'project-save': a => projects.save(a.project || {}, a.scope || a.sessionId),
    'projects-check': () => projects.checkDirectories(),
    'project-attach': a => projects.attach(S(a).id, a.projectId || null),
    'project-remove': a => projects.remove(a.id, a),
    'project-move': a => projects.move(a.id, a.beforeId),
    'extensions-list': a => { const s = S(a); return extensions.list(a.kind, { sessionId: s.id, projectId: s.projectId }); },
    'extension-read': a => { const s = S(a); return extensions.read(a.kind, a, { sessionId: s.id, projectId: s.projectId }); },
    'component-info': () => sessions.components.info(),
    'doctor': async () => ({runtime:runtimeInfo,hostIntegrity:await windowsRuntime.hostIntegrity(),component:sessions.components.info(),chrome:[],chromeOk:sessions.components.info().installed,downloading:!!downloading,version:process.env.JSRA_APP_VERSION||''}),
    'kernel-info': async () => {
      const component=sessions.components.info();
      if(!component.installed||!component.enabled)return {component,hostIntegrity:await windowsRuntime.hostIntegrity(),kernel:settings.kernel};
      const info=await S().browser.control('kernel-info');return {...info,component,hostIntegrity:await windowsRuntime.hostIntegrity(),kernel:settings.kernel,downloading:!!downloading};
    },
    'kernel-repair': async a => {if([...sessions.sessions.values()].some(s=>s.browser.running))return {ok:false,error:'请先关闭所有浏览器再修复内核'};return S().browser.control('kernel-repair',{kind:settingsMod.KERNEL});},
    // 内核固定 CloakBrowser：下载源与仓库不接受调用方覆盖，避免被当成通用内核下载器。
    'download-kernel': async a => {if(downloading)return {ok:false,error:'已有下载正在运行'};const args={repository:'CloakHQ/cloakbrowser',tag:a?.tag||'',asset:a?.asset||''};downloading=S().browser.control('kernel-download',args);try{const result=await downloading;settings.kernel=settingsMod.KERNEL;settingsMod.save(settings);return {ok:true,...result};}catch(e){return {ok:false,error:e.message};}finally{downloading=null;}},
    'probe-kernel': async a => S().browser.control('kernel-probe',{...a,kernel:settingsMod.KERNEL}),
    // 会话（多目标站点并行分析，每个会话独立 Chrome/内核/Agent）
    'session-list': () => sessions.list(),
    'session-search': (a, context) => searchSessions({ sessions: sessions.sessions, projects: sessions.projects.list(), query: a?.query, signal: context?.signal }),
    'feedback-open': () => openFeedback({ nativeHost: !!nativeKey }),
    'session-diagnostics': a => {
      const s = S(a), agent = s.ensureAgent(), run = s.runs.latest(), context = agent.stats();
      const model = (settings.provider === 'anthropic' ? settings.anthropic : settings.openai)?.model;
      return { sessionId: s.id, runId: run?.id || null, status: run?.status || 'idle', stop: run?.stop || null, mode: s.mode, review: s.review, workspace: s.workspace.root, provider: settings.provider, model, context: { used: context.used, limit: context.limit, inferred: context.inferred }, limits: { maxSteps: settings.maxSteps || 0, tokenBudget: settings.tokenBudget || 0 }, usage: run?.usage || null, appVersion: process.env.JSRA_APP_VERSION || 'development', platform: process.platform, node: process.versions.node };
    },
    'session-create': a => { if (!a?.projectId) throw Error('请先选择项目'); return sessions.create({ projectId: a.projectId, title: typeof a.title === 'string' ? a.title.slice(0, 200) : undefined }).info(); },
    'session-close': async a => { await sessions.close(a?.sessionId); return sessions.list(); },
    'session-delete': async a => { await sessions.delete(a?.sessionId); return sessions.list(); },
    'terminal-open': a => S(a).terminals.open(a),
    'terminal-snapshot': a => S(a).terminals.snapshot(a.id),
    'terminal-input': a => S(a).terminals.input(a.id, a.data),
    'terminal-resize': a => S(a).terminals.resize(a.id, a.cols, a.rows),
    'terminal-close': a => S(a).terminals.close(a.id),
    'document-read': a => readDocument(S(a), a),
    'session-rename': a => { S(a).rename(a.title); return true; },
    'session-pin': a => { const s = S(a); s.setPinned(!!a.pinned); return sessions.list(); },
    'session-focus': async a => { await sessions.focus(a?.sessionId); return true; },
    'workspace-recent': () => sessions.workspaces.recent(),
    'executor-status': a => executor.probe(!!a?.refresh),
    'run-events': a => S(a).runs.events(Number(a?.after) || 0),
    'agent-history': a => { const s = S(a); return s.ensureAgent().hist.events; },
    'session-export-markdown': a => {
      const s = S(a), agent = s.ensureAgent(), events = [...agent.hist.events];
      if (agent.currentItem && agent.partial) events.push({ t: 'assistant', ...agent.currentItem, phase: 'partial_answer', content: agent.partial });
      return { sessionId: s.id, markdown: conversationMarkdown({ id: s.id, title: s.title, events }) };
    },
    'changes-list': a => { const s = S(a); return s.changes.list(s.workspace.id); },
    'change-detail': a => { const s = S(a); return s.changes.detail(a.id, s.workspace.id); },
    'change-undo': a => { const s = S(a); if (s.agent?.running) throw new Error('任务运行中，请先停止后撤销'); if (s.mode === 'read-only') throw new Error('只读权限下不能撤销文件改动'); sessions.workspaces.verify(s.workspace); const result = s.changes.undo(a.id, s.workspace); s.emit('changes-updated', { workspaceId: s.workspace.id }); return result; },
    'browser-launch': async a => S(a).launch({url:a?.url,isolated:a?.isolated}),
    'browser-viewport': async a => { const s = S(a); return s.browser.fitViewport(a.width, a.height, a.dpr); },
    'embed-inset': a => S(a).browser.embedInset(),
    'embed-fallback': async a => { const s = S(a); const r = await s.browser.embedFallback(a.reason); sessions.emitList(); return r; },
    'browser-dock': a => S(a).browser.control('dock', a),
    'browser-close': async a => { await S(a).closeBrowser(); return true; },
    'navigate': a => B(a).navigate(a.url),
    'new-page': a => B(a).newPage(a.url),
    'select-page': a => B(a).selectPage(a.index),
    'browser-tab-select': a => S(a).browserTabs.select(String(a.pageId || '')),
    'browser-tab-close': a => S(a).browserTabs.close(String(a.pageId || '')),
    'browser-tab-navigate': a => S(a).browserTabs.navigate(a.pageId, a.url),
    'go-back': a => B(a).goBack(),
    'reload': a => B(a).reload(),
    'clear-requests': a => S(a).browser.clearRequests(),
    'reset-session': async a => S(a).browser.control('reset',{scope:a.scope,reload:a.reload}),
    'restart-fresh': async a => S(a).relaunch({ isolated: true, url: a?.url }),
    'get-requests': async a => { const { summary } = await import('./har.mjs'); const b = S(a).browser; await b.refreshRequests(); return { list: b.requests.slice(-2000).map(summary), paused: b.net.paused }; },
    'net-detail': async a => S(a).browser.control('net-detail',{id:a.id}),
    'net-pause': a => S(a).browser.setCapturePaused(a.paused),
    // 导出 HAR：ids 为空则导出全部；path 由原生保存对话框给出
    'har-export': async a => {
      const { toHar } = await import('./har.mjs'); const b = S(a).browser;
      const ids = Array.isArray(a.ids) ? new Set(a.ids) : null;
      const recs = b.requests.filter(r => !ids || ids.has(r.id));
      const out = String(a.path || ''); if (!out || !/\.har$/i.test(out)) throw new Error('导出路径须以 .har 结尾');
      const har = await b.control('har',{ids: a.ids});
      fs.writeFileSync(out, JSON.stringify(har, null, 1));
      return { ok: true, path: out, entries: har.log.entries.length, bytes: fs.statSync(out).size };
    },
    'get-scripts': a => S(a).browser.scripts.map(s => ({ id: s.id, url: s.url, size: s.size, file: s.file })),
    'read-file': a => { const s = S(a), name = String(a.file || ''); if (name.startsWith('workspace/')) return readWorkspace(selectReadRoot(s.toolCtx(), a.root), name.slice(10)); const p = resolveIn(s.projectDir, name); return fs.readFileSync(p, 'utf8').slice(0, 300000); },
    'list-files': a => { const s = S(a); sessions.workspaces.verify(s.workspace); return listWorkspace(s.toolCtx()).map(f => ({ ...f, name: 'workspace/' + f.name })); },
    'workspace-directory': a => { const s = S(a); sessions.workspaces.verify(s.workspace); return listDirectory(selectReadRoot(s.toolCtx(), a.root), String(a.path || '.')); },
    'git-status': a => git.gitStatus(S(a).toolCtx()),
    'git-diff': a => git.gitDiff(S(a).toolCtx(), a.path),
    'agent-send': a => S(a).send(a),
    'agent-queue-resume': a => S(a).resumeQueue(),
    'agent-queue-remove': a => S(a).removeQueued(a?.id),
    'agent-queue-edit': a => S(a).editQueued(a?.id, a?.text),
    'agent-turn-edit': a => S(a).editTurn(a?.turnId, a?.text),
    'agent-rate': a => S(a).rateMessage(a?.id, a?.rating),
    'agent-queue-clear': a => { const s = S(a); s.queue = []; s.saveState(); sessions.emitList(); return { ok: true }; },
    'agent-state': a => { const s = S(a); s.ensureAgent(); return s.publicState(); },
    'goal-start': a => S(a).startGoal(a.objective, a.attachments),
    'goal-action': a => S(a).goalAction(a.action),
    'subagent-start': a => S(a).subagents.spawn(a.task),
    'subagent-result': a => { const s = S(a); return s.subagents.wait(a.id, { waitMs: 0, workspaceId: s.workspace.id }); },
    'subagent-cancel': a => ({ ok: S(a).subagents.cancel(a.id) }),
    'session-snapshot': a => { const s = S(a), ag = s.ensureAgent(); return { state: s.publicState(), events: ag.hist.events, partial: ag.partial || '', partialReasoning: ag.partialReasoning || '', partialItem: ag.currentItem || null, context: ag.stats() }; },
    'test-seed-history': a => {
      if (process.env.JSRA_TEST_FIXTURES !== '1') throw new Error('disabled');
      const s = S(a), ag = s.ensureAgent(); if (ag.running) throw new Error('busy');
      const { events } = a; if (!Array.isArray(events) || events.length > 1000) throw new Error('invalid fixture');
      if (a.subagents !== undefined) {
        if (!Array.isArray(a.subagents) || a.subagents.length > 30 || a.subagents.some(agent => !agent.id || agent.status === 'running')) throw new Error('invalid subagent fixture');
        s.subagents.records = a.subagents.map(agent => ({ ...agent, workspaceId: s.workspace.id })); s.subagents.save();
      }
      ag.hist.events = events; ag.persist(); return true;
    },
    // UI 验收用：伪造 agent.running，覆盖「运行中改权限」这类界面路径；不启动模型。
    'test-set-running': a => {
      if (process.env.JSRA_TEST_FIXTURES !== '1') throw new Error('disabled');
      const s = S(a); s.agent = s.agent || {}; s.agent.running = !!a.running; sessions.emitList(); return { ok: true, running: s.agent.running };
    },
    // UI 验收用：直接写入待发送队列，不启动模型或后台任务。
    'test-seed-queue': a => {
      if (process.env.JSRA_TEST_FIXTURES !== '1') throw new Error('disabled');
      const s = S(a);
      if (!Array.isArray(a.items) || a.items.length > 10 || a.items.some(item => typeof item?.text !== 'string')) throw new Error('invalid queue fixture');
      s.queue = a.items.map(item => ({ id: crypto.randomUUID(), text: item.text.slice(0, 4000), source: 'user', attachments: item.attachments || [] }));
      s.saveState(); sessions.emitList(); return { ok: true, queued: s.queue.length };
    },
    'session-set-mode': a => S(a).setMode(a?.mode, a?.review),
    'agent-approval-reply': a => ({ ok: S(a).replyApproval(a?.id, { allow: !!a?.allow, always: !!a?.always }) }),
    'agent-answer': a => ({ ok: S(a).answerAsk(a?.id, a?.answer) }),
    'debug-paused': async a => {
      const s = S(a);
      if (!s.browser.running || !s.mcp?.has?.('get_paused_info')) return { paused: false, text: '浏览器分析内核未连接，无法读取断点。' };
      const r = await s.mcp.call('get_paused_info', { includeScopes: true, maxScopeDepth: 2, frameIndex: 0 });
      const paused = !r.isError && /Execution Paused|Call Stack/.test(r.text || '');
      return { paused, text: r.text, isError: !!r.isError };
    },
    'debug-resume': async a => { const s = S(a); if (!s.mcp.client) return { ok: false, error: '调试器没有连接' }; await s.ensureAgent().bindBrowserTarget(); const r = await s.mcp.call('pause_or_resume', { action: 'resume' }); const ok = !r.isError || /already running|not paused/i.test(r.text || ''); if (ok) { s.debuggerPaused = false; s.emit('agent-debugger-state', { paused: false }); } return { ok, error: ok ? '' : r.text }; },
    'agent-interrupt': a => { S(a).interrupt(); return true; },
    'agent-wrapup': a => { S(a).agent?.finishSoon(); return true; },
    'agent-reset': a => { S(a).ensureAgent().reset(); return true; },
    'agent-new-chat': a => { const s = S(a); if (s.agent?.running) return false; s.ensureAgent().newChat(); return true; },
    'agent-context': a => S(a).ensureAgent().stats(),
    // 「AI 写的」：只列工具真实写盘的文件（脚本 / 笔记 / 导出），不是工作区里的所有东西
    'agent-artifacts': a => {
      const s = S(a); s.ensureAgent();
      const list = collectArtifacts(s.agent.hist.events.filter(e => !e.workspaceId || e.workspaceId === s.workspace.id));
      return { list, groups: groupArtifacts(list) };
    },
    // 用户从系统对话框选中的文件（Markdown/代码/图片），登记为附件元信息；内容在 resolveAttachments 里读
    'attach-path': a => {      const p = String(a?.path || '');
      if (!p) throw new Error('缺少文件路径');
      const st = fs.statSync(p);
      if (!st.isFile()) throw new Error('不是文件：' + p);
      if (st.size > 8 * 1024 * 1024) throw new Error('文件太大（超过 8MB）');
      return registerAttachment(S(a).projectDir, { name: path.basename(p), data: fs.readFileSync(p) });
    },
    'attach-upload': a => registerAttachment(S(a).projectDir, { name: a?.name, data: a?.data, mime: String(a?.mime || '') }),
    'attachment-preview': a => attachmentPreview(S(a).projectDir, a?.id),
    // 自动化任务
    'tasks-list': () => tasks.list().map(t => ({ ...t, nextAt: tasks.nextAt(t) })),
    'task-save': a => tasks.upsert(a?.task || {}),
    'task-remove': a => tasks.remove(a?.id),
    'task-run': a => { const id = String(a?.id || ''); if (tasks.busy.has(id)) return { ok: false, error: '任务正在运行' }; if (!tasks.tasks.some(t => t.id === id)) throw new Error('任务不存在'); tasks.run(id, { manual: true }).catch(e => fileLog('自动化运行失败：' + e.message)); return { ok: true }; },
    'agent-compress': async a => { const s = S(a); const ag = s.ensureAgent(); if (ag.running) return { ok: false, error: 'AI 运行中，将在接近上限时自动压缩' }; try { return await ag.compress({ reason: 'manual', instructions: String(a?.instructions || '').slice(0, 500), force: true }); } catch (e) { return { ok: false, error: e.message }; } },
    'test-connection': async (override) => {
      const { testConnection } = await import('./llm.mjs');
      const p = settings.providers?.find(p => p.id === override?.providerId);
      const merged = override ? { ...settings, ...override, openai: { ...settings.openai, ...(override.openai || {}), apiKey: override.openai?.apiKey || (p?.type === 'openai' ? p.apiKey : settings.openai.apiKey) }, anthropic: { ...settings.anthropic, ...(override.anthropic || {}), apiKey: override.anthropic?.apiKey || (p?.type === 'anthropic' ? p.apiKey : settings.anthropic.apiKey) } } : settings;
      return testConnection(merged);
    },
    // 更新前调用：先应答，再关掉浏览器、工作区后台任务和 MCP，然后退出。
    // 外壳会等一段时间；到点仍未退出就按进程树强制结束。
    'prepare-exit': () => { gracefulExit(); return { ok: true }; },
    'export-diagnostics': async () => {
      try {
        const out = path.join(settingsMod.userDataDir(), 'diagnostics-' + Date.now() + '.txt');
        const safe = JSON.parse(JSON.stringify(settings));
        if (safe.openai) safe.openai.apiKey = safe.openai.apiKey ? '***已隐藏***' : '';
        if (safe.anthropic) safe.anthropic.apiKey = safe.anthropic.apiKey ? '***已隐藏***' : '';
        let logTail = ''; try { logTail = fs.readFileSync(logFile, 'utf8').slice(-20000); } catch {}
        const chromes = chromeMod.findChrome(settingsMod.userDataDir(), settings.chromePath);
        const content = ['=== WebDecryptHub 诊断信息 ===', '时间: ' + new Date().toLocaleString('zh-CN'), '平台: ' + process.platform + ' ' + process.arch, '运行时: ' + process.version,
          '运行资源: ' + JSON.stringify(runtimeInfo), '会话: ' + JSON.stringify(sessions.list()),
          '检测到的 Chrome: ' + (chromes.map(c => c.source + ':' + c.path).join(' | ') || '无'), '设置: ' + JSON.stringify(safe, null, 2), '', '=== 最近日志 ===', logTail].join('\n');
        fs.writeFileSync(out, content);
        return { ok: true, path: out };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    'read-report': a => { const p = path.join(S(a).projectDir, 'report.md'); try { return { ok: true, path: p, content: fs.readFileSync(p, 'utf8') }; } catch { return { ok: false, path: p, content: '' }; } },
    // 仅开发/测试：直接运行本地工具（JSRA_DEV=1 时启用）
    'tool-run': async a => { if (process.env.JSRA_DEV !== '1') throw new Error('disabled'); const agent = S(a).ensureAgent(); return agent.runTool(a.name, a.args || {}); },
    'list-tools': a => {
      const s = sessions.get(a?.sessionId, true);
      const local = LOCAL_TOOLS.filter(t => !t.component || (sessions.components.info().installed && sessions.components.info().enabled)).map(t => ({ name: t.name, description: t.description, kind: '本地' }));
      const m = (s?.mcp?.tools || []).map(t => ({ name: t.name, description: t.description, kind: '浏览器' }));
      const ext = (mcpHost.tools?.() || []).map(t => ({ name: t.name, description: t.description, kind: 'MCP' }));
      return [...m, ...ext, ...local];
    },
  };

  const port = Number(process.env.JSRA_WS_PORT || 0);
  // 本次启动的访问票据：只有拿到它的客户端（= Tauri 外壳从 stdout 读走再交给渲染进程）才能连
  const wsToken = process.env.JSRA_WS_TOKEN || crypto.randomBytes(24).toString('hex');
  const nativeKey = process.env.JSRA_NATIVE_HOST === '1' ? crypto.randomBytes(32) : null;
  const wss = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 64 * 1024 * 1024 });
  wss.on('error', e => { fileLog('WS 服务启动失败: ' + e.message); process.stderr.write('WS 服务启动失败: ' + e.message + '\n'); setTimeout(() => process.exit(3), 200); });
  wss.on('listening', () => {
    if (nativeKey) process.stdout.write('JSRA_NATIVE_KEY=' + nativeKey.toString('hex') + '\n');
    const p = wss.address().port;
    process.stdout.write(`JSRA_PORT=${p}\nJSRA_TOKEN=${wsToken}\n`);
    // 开发/自动化用端点文件：设了 JSRA_DEV_ENDPOINT 才写，便于外部脚本（e2e 冒烟测试、
    // 自动化回归）驱动这个正在运行的应用。平时不写，票据不外泄。
    if (process.env.JSRA_DEV_ENDPOINT) {
      try {
        const f = path.join(settingsMod.userDataDir(), 'dev-endpoint.json');
        fs.writeFileSync(f, JSON.stringify({ port: p, token: wsToken, pid: process.pid, projectDir: sessions.sessions.get('main')?.projectDir || '', at: Date.now() }), { mode: 0o600 });
        fileLog('开发端点已写入 ' + f);
      } catch (e) { fileLog('写开发端点失败: ' + e.message); }
    }
  });
  wss.on('connection', (ws, req) => {
    // 1) Origin 白名单（tauri://、http://tauri.localhost、本机 vite）2) 本次启动的 token
    const denied = denyReason(req, wsToken);
    if (denied) { fileLog('拒绝 WS 连接：' + denied + '（origin=' + String(req.headers.origin || '无') + '）'); ws.close(1008, denied); return; }
    clients.add(ws);
    let searchController;
    ws.on('close', () => { clients.delete(ws); searchController?.abort(); });
    ws.on('message', async raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'input') { sessions.focused()?.browser.input(m.payload); return; }
      if (m.type === 'invoke') {
        const h = handlers[m.channel];
        let result, error = null;
        try {
          if (m.channel === 'session-search') { searchController?.abort(); searchController = new AbortController(); }
          result = h ? await h(m.args, m.channel === 'session-search' ? { signal: searchController.signal } : undefined) : undefined;
          if (!h) error = '未知通道: ' + m.channel;
        }
        catch (e) { error = e.message || String(e); }
        try { ws.send(JSON.stringify({ type: 'reply', id: m.id, result, error })); } catch {}
      }
    });
  });
  async function gracefulExit() {
    projects.stop();
    try { await plugins.close(); } catch {}
    try { await mcpHost.close(); } catch {}
    try { await sessions.closeAll(); } catch {}
    fileLog('sidecar 退出');
    process.exit(0);
  }
  process.on('SIGINT', gracefulExit);
  process.on('SIGTERM', gracefulExit);
  watchParent(() => { fileLog('父进程已退出，sidecar 自行关闭'); gracefulExit(); });
  process.on('SIGHUP', gracefulExit);
  process.on('uncaughtException', e => { fileLog('uncaughtException: ' + (e && e.stack || e)); broadcast('log', '内部异常: ' + (e && e.message || e)); });
  process.on('unhandledRejection', e => { fileLog('unhandledRejection: ' + (e && (e.stack||e))); });
}
