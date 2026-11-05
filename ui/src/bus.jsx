// 数据管道：settings / 会话 / 事件流 / 浏览器嵌框 / 动作。
// 界面组件只从这里取状态和动作，不自己发 RPC。
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { toast as notify } from 'sonner';
import { blankSession, sessionReducer, mod, isApi, sessionLabel } from './state.js';
import { askConfirm, askQuestion, DocumentLinks } from './kit.jsx';
import { onConnState, native } from './transport.js';
import { normalizeTargetUrl } from '../../sidecar/url.mjs';
import { scheduleStartupCheck } from './updater.js';
import { historyEvents } from './conversation.js';
import { ChatScroll, BOTTOM_TOLERANCE } from './chat-scroll.js';
import { sessionView } from './session-view.js';
import { rememberPreview } from './attachments.jsx';
import { parseCommand, extensionRequest } from './commands.js';
import { currentPreset, presetLabel, presetKnobs, presetStatusLine, resolvePreset, PRESET_CLI_NAMES } from '../../sidecar/permission-presets.mjs';
import { guessPasteName } from './paste-drop.js';
import { BrowserSurface } from './browser-surface.js';
import { BrowserFrames } from './browser-frames.js';
import { useSessionView } from './use-session-view.jsx';
import { useWorkspaceTabs } from './use-workspace-tabs.jsx';

const api = window.api;
const Ctx = createContext(null);
export const useWorkbench = () => useContext(Ctx);

export function Workbench({ children }) {
  const [settings, setSettings] = useState(null);
  const [firstRun, setFirstRun] = useState(false);
  const [conn, setConn] = useState('connecting');
  const [sessions, setSessions] = useState({ focused: null, sessions: [] });
  const [S, dispatch] = useReducer(sessionReducer, {});
  const [view, setView] = useState('chat');
  const presentation = useSessionView(sessions.focused);
  const { side, sideOpen, setSide, setSideOpen } = presentation;
  const sideOpenRef = useRef(sideOpen); sideOpenRef.current = sideOpen;
  const [launching, setLaunching] = useState({});
  const [drafts, setDrafts] = useState({});
  const [atts, setAtts] = useState({});
  const [projects, setProjects] = useState([]), [projectFilter, setProjectFilter] = useState(null);
  const [projectEditor, setProjectEditor] = useState(null), [moveSession, setMoveSession] = useState(null), [workspacePrompt, setWorkspacePrompt] = useState(false);
  const [commandForm, setCommandForm] = useState(null), [extensionBrowser, setExtensionBrowser] = useState(null), [commandFeedback, setCommandFeedback] = useState({});
  const [automationDraft, setAutomationDraft] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // { sid, turnId } 编辑已发送消息
  // 项目概念出现之前的历史会话（无 projectId）：只提示、不自动处理，删不删由用户决定。
  const [legacySessions, setLegacySessions] = useState([]);
  useEffect(() => api.on('projects', setProjects), []);

  const sid = sessions.focused;
  const session = sessions.sessions.find(s => s.id === sid) || null;
  const cur = (sid && S[sid]) || blankSession();
  const activityRef = useRef(false), activityKick = useRef(null);
  activityRef.current = !!cur.browserActivity?.active;
  useEffect(() => { activityKick.current?.(); }, [sid, cur.browserActivity?.active]);

  const sidRef = useRef(sid); sidRef.current = sid;
  const input = drafts[sid] || '';
  const setInput = useCallback(value => setDrafts(d => ({ ...d, [sidRef.current]: value })), []);
  const startEdit = useCallback(turn => {
    if (!turn?.user || !turn.user.content && !turn.user.attachments?.length) return;
    setEditTarget({ sid: sidRef.current, turnId: turn.id, atSeq: turn.user.seq });
    setAtts(values => ({ ...values, [sidRef.current]: (turn.user.attachments || []).map(a => ({ ...a, key: a.id || a.path || a.file })) }));
    setDrafts(d => ({ ...d, [sidRef.current]: turn.user.rawContent || turn.user.content }));
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);
  const cancelEdit = useCallback(() => { setEditTarget(null); setDrafts(d => ({ ...d, [sidRef.current]: '' })); }, []);
  const rate = useCallback(async (id, value) => {
    const target = sidRef.current;
    const current = S[target]?.ratings?.[id];
    const next = current === value ? '' : value;
    dispatch({ t: 'patch', sid: target, patch: { ratings: { ...(S[target]?.ratings || {}), [id]: next } } });
    try { const r = await api.invoke('agent-rate', { sessionId: target, id, rating: next }); if (r?.ratings) dispatch({ t: 'patch', sid: target, patch: { ratings: r.ratings } }); }
    catch (e) { toast(e.message, 'err'); }
  }, []);
  const viewRef = useRef();       // 浏览器画面容器
  const [viewElement, setViewElement] = useState(null);
  const bindViewport = useCallback(element => { viewRef.current = element; setViewElement(element); }, []);
  const canvasRef = useRef();     // 画面
  const frames = useRef(null);
  if (!frames.current) frames.current = new BrowserFrames();
  const activePage = cur.status.pages.find(page => page.active);
  const frameTarget = cur.status.running && activePage ? JSON.stringify([sid, cur.status.chromePid, activePage.id, activePage.url]) : null;
  const frameTargetRef = useRef(frameTarget); frameTargetRef.current = frameTarget;
  useLayoutEffect(() => { frames.current.select(frameTarget); }, [frameTarget]);
  const bindCanvas = useCallback(element => { canvasRef.current = element; frames.current.select(frameTarget); frames.current.bind(element); }, [frameTarget]);
  const urlRef = useRef();        // 地址栏
  const inputRef = useRef();      // 输入框
  const chatRef = useRef();       // 消息滚动区
  const [chatElement, setChatElement] = useState(null);
  const [chatContent, bindChatContent] = useState(null);
  const bindChat = useCallback(element => { chatRef.current = element; setChatElement(element); }, []);
  const [uploads, setUploads] = useState({});
  const [sending, setSending] = useState({});
  const attsRef = useRef(atts); attsRef.current = atts;
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const approvalChain = useRef(Promise.resolve());
  const seen = useRef(new Set());
  const hydration = useRef(new Map());
  const hydratedOrder = useRef(new Map());
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const prevRun = useRef({});
  const embedTry = useRef({});
  const surface = useRef(null);
  if (!surface.current) surface.current = new BrowserSurface({ show: native.embedShow, hide: native.embedHide, release: native.embedRelease });

  // ---- toast ----
  const toast = useCallback((msg, kind = 'info', ms = 3600) => {
    const method = { ok: 'success', err: 'error', warn: 'warning', info: 'info' }[kind] || 'info';
    return notify[method](String(msg), { duration: ms });
  }, []);

  const openSide = useCallback(k => {
    if (k === side && sideOpen) { setSideOpen(false); return; }
    setSide(k); setSideOpen(true);
  }, [side, sideOpen]);
  const tabs = useWorkspaceTabs({ presentation, sid, cur, session, api, toast, setWorkspacePrompt, setView });
  function openContentLink(href, options) {
    if (/^https?:\/\//i.test(href || '')) tabs.openWebLink(href);
    else tabs.openDocument(href, { ...options, link: true });
  }

  const addAtt = useCallback((list) => {
    const s = sidRef.current;
    setAtts(m => {
      const curList = m[s] || [];
      const add = (Array.isArray(list) ? list : [list]).filter(a => !curList.some(x => x.key === a.key));
      return { ...m, [s]: [...curList, ...add].slice(0, 8) };
    });
    setView('chat');
    setTimeout(() => inputRef.current?.focus(), 40);
  }, []);
  // 长文本粘贴：内容写成工作区文件，输入框只留一行引用。
  // 不在输入框里塞正文，是因为这条路径的目的就是让长文本不进入消息体。
  const dropPaste = useCallback(async (text) => {
    const target = sidRef.current;
    if (!target) return;
    setUploads(m => ({ ...m, [target]: (m[target] || 0) + 1 }));
    try {
      const saved = await api.invoke('paste-save', { sessionId: target, text, name: guessPasteName(text) });
      const ref = `【粘贴长文本】${saved.path}（${saved.lines} 行 / ${saved.chars} 字符），请读取该文件后再继续。`;
      // setInput 只接受值（见上面 useCallback 的签名），不能传更新函数。
      const prev = draftsRef.current[target] || '';
      setInput(prev ? prev + '\n' + ref : ref);
      toast(`已存为 ${saved.path}（${saved.lines} 行），正文未发送`, 'ok');
    } catch (e) { toast('长文本保存失败：' + e.message, 'err'); }
    finally { setUploads(m => ({ ...m, [target]: Math.max(0, (m[target] || 1) - 1) })); }
  }, []);

  const rmAtt = useCallback(key => setAtts(m => ({ ...m, [sidRef.current]: (m[sidRef.current] || []).filter(x => x.key !== key) })), []);
  async function addFiles(files) {
    const target = sidRef.current, available = 8 - (attsRef.current[target] || []).length;
    const list = Array.from(files || []).slice(0, Math.max(0, available));
    if (!list.length) { toast('每条消息最多添加 8 个附件', 'warn'); return; }
    setUploads(m => ({ ...m, [target]: (m[target] || 0) + 1 }));
    try {
      for (const file of list) {
        try {
          if (file.size > 8 * 1024 * 1024) throw new Error('每个附件最多 8MB');
          const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsDataURL(file); });
          const meta = await api.invoke('attach-upload', { sessionId: target, name: file.name, mime: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
          if (meta.image) rememberPreview(target, meta.id, 'data:' + meta.mime + ';base64,' + dataUrl.slice(dataUrl.indexOf(',') + 1));
          setAtts(m => ({ ...m, [target]: [...(m[target] || []), { ...meta, key: meta.id, kind: 'attachment' }].slice(0, 8) }));
        } catch (e) { toast('无法添加 ' + file.name + '：' + e.message, 'err'); }
      }
    } finally { setUploads(m => ({ ...m, [target]: Math.max(0, (m[target] || 1) - 1) })); }
  }

  // ---- 主题 ----
  const setTheme = useCallback(v => { localStorage.setItem('jsra_theme', v); window.__setTheme?.(v); }, []);

  // ---- 连接状态 / 更新提示 ----
  useEffect(() => onConnState(setConn), []);
  useEffect(() => api.on('credential-store', async request => {
    try { await native.secretStoreEnvelope(request.envelope); await api.invoke('credential-store-ack', { id: request.id, ok: true }); }
    catch (error) { await api.invoke('credential-store-ack', { id: request.id, ok: false, error: error.message }).catch(() => {}); }
  }), []);
  useEffect(() => { if (conn === 'connected') { seen.current.clear(); api.invoke('session-list').then(setSessions).catch(() => {}); } }, [conn]);
  useEffect(() => {
    const s = settingsRef.current;
    if (conn === 'connected' && s && native.isNative()) native.syncSecrets(s.providers.map(p => 'prov.' + p.id), s.activeProviderId).then(envelope => api.invoke('secrets-sync', { envelope })).then(setSettings).catch(e => toast('恢复模型凭据失败：' + e.message, 'err'));
  }, [conn]);
  useEffect(() => {
    if (!settings) return;
    return scheduleStartupCheck(r => toast(`发现新版本 v${r.version}，可在「设置 → 软件更新」中安装`, 'ok', 8000));
  }, [settings, toast]);

  // ---- 启动 ----
  useEffect(() => { (async () => {
    try {
      let s = await api.invoke('get-settings');
      if (!Array.isArray(s.providers) || !s.providers.length) {
        const ps = [];
        try {
          if (s.openai?.baseUrl) ps.push({ id: 'p-openai', name: 'OpenAI 兼容', type: 'openai', baseUrl: s.openai.baseUrl, models: [s.openai.model || 'gpt-4o'], contextWindow: s.openai.contextWindow });
          if (s.anthropic?.baseUrl) ps.push({ id: 'p-anthropic', name: 'Claude 原生', type: 'anthropic', baseUrl: s.anthropic.baseUrl, models: [s.anthropic.model || 'claude-sonnet-4'], contextWindow: s.anthropic.contextWindow });
        } catch (e) { console.error('provider migrate:', e); }
        s.providers = ps.length ? ps : [{ id: 'p-openai', name: 'OpenAI 兼容', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o'] }];
        s.activeProviderId = s.providers[0].id;
        s.activeModel = (s.providers[0].models || [])[0] || '';
      }
      // 模型从「字符串数组」升级成对象：{ id, name, contextWindow, vision, thinking }
      // thinking 必须原样带过：它是用户逐模型声明的思考档位，丢了界面就无从知道该模型支持哪些档。
      for (const p of s.providers) {
        p.models = (p.models || []).map(m => typeof m === 'string' ? { id: m, name: m }
          : (m && m.id ? { ...m, id: String(m.id), name: m.name || String(m.id), contextWindow: Number(m.contextWindow) || 0, vision: !!m.vision, ...(m.thinking ? { thinking: m.thinking } : {}) } : null)).filter(Boolean);
      }
      if (s.activeModel && typeof s.activeModel === 'object') s.activeModel = s.activeModel.id;
      if (!s.activeProviderId || !s.providers.some(x => x.id === s.activeProviderId)) s.activeProviderId = s.providers[0]?.id || '';
      if (!s.activeModel) s.activeModel = (s.providers.find(x => x.id === s.activeProviderId)?.models || [])[0]?.id || '';
      if (typeof s.activeModel === 'object') s.activeModel = s.activeModel.id || '';
      // sidecar 只认 openai/anthropic 两份配置，而且它自己读不到系统密钥库：
      // 启动时把当前渠道的密钥同步过去，否则重启后第一次发消息会误报「尚未配置 API Key」。
      try { s = await api.invoke('save-settings', mirrorActive(s)); if (native.isNative()) { const envelope = await native.syncSecrets(s.providers.map(p => 'prov.' + p.id), s.activeProviderId); s = await api.invoke('secrets-sync', { envelope }); } } catch (e) { console.error('sync provider key:', e); }
      setSettings(s);
      const restoredSessions = await api.invoke('session-list'); setSessions(restoredSessions);
      setProjects(await api.invoke('projects-list'));
      const doc = await api.invoke('doctor');
      const profileDone = !!(s.onboarding?.completedAt || s.onboarding?.skippedAt);
      if (!profileDone && !window.__JSRA_SKIP_ONBOARD) setFirstRun(true);
      const shot = window.__JSRA_SHOT;
      if (['settings', 'automations'].includes(shot)) setView(shot);
      else if (['browser', 'evidence', 'code'].includes(shot)) { setSide(shot, restoredSessions.focused); setSideOpen(true, restoredSessions.focused); }
    } catch (e) { console.error('boot failed:', e && (e.message || e)); setTimeout(() => location.reload(), 1500); }
  })(); }, []);

  // ---- 画面帧 ----
  const drawFrame = useCallback(f => {
    frames.current.receive(frameTargetRef.current, f);
  }, []);

  // 历史会话（无项目归属）在启动时清点一次。它们是本地残留数据，不做任何自动处理。
  useEffect(() => { api.invoke('legacy-sessions').then(v => setLegacySessions(Array.isArray(v) ? v : [])).catch(() => {}); }, []);
  const restoreLegacySessions = useCallback(async ids => {
    try {
      const r = await api.invoke('legacy-sessions-restore', { ids });
      const done = (r?.restored || []).map(x => x.id);
      setLegacySessions(list => list.filter(x => !done.includes(x.id)));
      const skipped = r?.skipped || [];
      if (done.length) toast(`已恢复 ${done.length} 个历史会话`, 'ok');
      // 跳过是逐条原因不同的：一次列出来，别让用户以为全都恢复了。
      if (skipped.length) toast('未恢复：' + skipped.map(x => `${x.title || x.id}（${x.reason}）`).join('；'), 'warn', 9000);
      return r;
    } catch (e) { toast('恢复失败：' + e.message, 'err'); return null; }
  }, []);
  const discardLegacySessions = useCallback(async ids => {
    try {
      const r = await api.invoke('legacy-sessions-discard', { ids });
      setLegacySessions(list => list.filter(x => !(r?.removed || []).includes(x.id)));
      toast('已删除历史会话', 'ok');
      return true;
    } catch (e) { toast('删除失败：' + e.message, 'err'); return false; }
  }, []);

  // ---- 事件订阅 ----
  useEffect(() => {
    const on = (ch, fn) => api.on(ch, (value, sessionId, revision) => {
      const queued = hydration.current.get(sessionId);
      if (queued && (ch.startsWith('agent-') || ['plan', 'model-selection', 'goal', 'subagents', 'run-event', 'approval-resolved', 'question-resolved'].includes(ch))) queued.push({ revision, apply: () => fn(value, sessionId) });
      else fn(value, sessionId);
    });
    const offs = [
      on('sessions', v => setSessions(v)),
      on('goal', (v, s) => dispatch({ t: 'patch', sid: s, patch: { goal: v } })),
      on('subagents', (v, s) => dispatch({ t: 'patch', sid: s, patch: { subagents: v } })),
      on('agent-team', (v, s) => dispatch({ t: 'patch', sid: s, patch: { team: v } })),
      on('subagent-finished', (v, s) => { if (s === sidRef.current) toast(`子代理${v.status === 'completed' ? '已完成' : '已结束'}：${v.title}`, v.status === 'completed' ? 'ok' : 'warn', 5000); }),
      on('agent-debugger-state', (v, s) => dispatch({ t: 'patch', sid: s, patch: { debuggerPaused: !!v.paused } })),
      on('settings-changed', v => setSettings(v)),
      on('browser-status', (v, s) => dispatch({ t: 'status', sid: s, v })),
      on('agent-browser-activity', (v, s) => {
        dispatch({ t: 'patch', sid: s, patch: { browserActivity: v } });
        if (v.active && s === sidRef.current && (v.tool === 'browser_open' || (!sideOpenRef.current && ['browser_click', 'browser_fill', 'browser_press'].includes(v.tool)))) presentation.revealBrowser(s);
      }),
      on('requests', (v, s) => dispatch({ t: 'requests', sid: s, v })),
      on('requests-cleared', (v, s) => dispatch({ t: 'patch', sid: s, patch: { requests: [] } })),
      on('script', (v, s) => dispatch({ t: 'script', sid: s, v })),
      on('log', (v, s) => s && dispatch({ t: 'log', sid: s, v: String(v) })),
      on('frame', (f, s) => { if (s === sidRef.current) drawFrame(f); }),
      on('agent-user', (c, s) => dispatch({ t: 'ev', sid: s, v: { type: 'user', ...(typeof c === 'string' ? { content: c } : c) } })),
      on('agent-continuation', (v, s) => dispatch({ t: 'ev', sid: s, v: { type: 'continuation', ...v } })),
      on('plan', (plan, s) => { dispatch({ t: 'patch', sid: s, patch: { plan } }); setCommandFeedback(values => values[s]?.name === 'plan' ? { ...values, [s]: null } : values); }),
      on('model-selection', (modelSelection, s) => dispatch({ t: 'patch', sid: s, patch: { modelSelection } })),
      on('agent-context', (v, s) => {
        dispatch({ t: 'patch', sid: s, patch: { ctx: v } });
        if (v?.event === 'compressed' || v?.event === 'pruned') {
          dispatch({ t: 'ev', sid: s, v: { type: 'compact', stage: v.event, reason: v.reason, before: v.before, after: v.after, instructions: v.instructions || '', summary: v.summary || '', pruned: v.pruned || 0, summarized: v.summarized || 0, at: Date.now() } });
        }
        // 压缩没提交（摘要比原文还长）也要留痕：否则用户以为压了，下一轮还是满的。
        if (v?.event === 'skipped') {
          dispatch({ t: 'ev', sid: s, v: { type: 'note', content: v.error || '这次压缩没有产生更短的历史，已跳过。' } });
        }
        if (v?.event === 'cancelled') {
          dispatch({ t: 'ev', sid: s, v: { type: 'note', content: '已取消压缩，历史保持不变。' } });
        }
      }),
      on('agent-assistant-start', (v, s) => dispatch({ t: 'assistant-start', sid: s, v })),
      on('agent-delta', (d, s) => dispatch({ t: 'delta', sid: s, v: d })),
      on('agent-reasoning', (v, s) => dispatch({ t: 'reasoning', sid: s, v })),
      on('agent-retry', (v, s) => dispatch({ t: 'patch', sid: s, patch: { retry: v } })),
      on('agent-assistant-end', (v, s) => dispatch({ t: 'assistant-end', sid: s, v })),
      on('agent-usage', (u, s) => dispatch({ t: 'patch', sid: s, patch: { usage: u } })),
      on('agent-tool-start', (t, s) => dispatch({ t: 'ev', sid: s, v: { type: 'tool', ...t } })),
      on('agent-tool-end', (t, s) => dispatch({ t: 'tool-end', sid: s, v: t })),
      on('agent-error', (e, s) => dispatch({ t: 'ev', sid: s, v: { type: 'error', content: e } })),
      on('agent-done', (d, s) => {
        dispatch({ t: 'ev', sid: s, v: { type: 'turn-end', ...d } });
        dispatch({ t: 'patch', sid: s, patch: { agentRunning: false, thinking: false, retry: null, browserActivity: null } });
        if (d?.stop === 'max-steps') dispatch({ t: 'ev', sid: s, v: { type: 'note', content: '已达到你设置的工具轮数预算，进展已保存。运行设置中填 0 可取消此预算。' } });
        if (d?.stop === 'stalled') dispatch({ t: 'ev', sid: s, v: { type: 'note', content: '相同调用连续六轮返回相同错误，Agent 已保存进展并暂停。请查看错误，或补充信息后继续。' } });
      }),
      on('agent-todos', (v, s) => dispatch({ t: 'patch', sid: s, patch: { todos: v } })),
      on('agent-mode', (v, s) => dispatch({ t: 'patch', sid: s, patch: { mode: v?.mode || 'standard', review: v?.review || 'manual' } })),
      on('agent-question', (v, s) => {
        dispatch({ t: 'patch', sid: s, patch: { question: v } });
      }),
      on('agent-approval', (v, s) => {
        dispatch({ t: 'approval', sid: s, v });
      }),
      on('approval-resolved', (v, s) => dispatch({ t: 'approval-resolved', sid: s, id: v.id })),
      on('question-resolved', (v, s) => dispatch({ t: 'patch', sid: s, patch: { question: null } })),
      on('run-event', (v, s) => { if (v.run) dispatch({ t: 'patch', sid: s, patch: { run: v.run } }); }),
      on('changes-updated', (v, s) => dispatch({ t: 'changes-updated', sid: s })),
      on('workspace', (v, s) => { setAtts(m => ({ ...m, [s]: [] })); dispatch({ t: 'patch', sid: s, patch: { approvals: [], question: null } }); }),
    ];
    return () => offs.forEach(f => f && f());
  }, [drawFrame]);

  // 会话列表变化 → 同步运行态（UI 比浏览器晚启动时也要对）
  useEffect(() => {
    for (const s of sessions.sessions) {
      const patch = { agentRunning: s.agentRunning, mode: s.mode || 'standard', review: s.review || 'manual', run: s.run, queued: s.queued || 0, queuedItems: s.queuedItems || [] };
      if (s.running) patch.status = { ...blankSession().status, ...(S[s.id]?.status || {}), running: true, embed: !!s.embed, chromePid: s.chromePid || null };
      dispatch({ t: 'patch', sid: s.id, patch });
    }
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only the selected chat hydrates; listing thousands of rows stays cold.
  useEffect(() => {
    for (const s of sessions.sessions.filter(item => item.id === sessions.focused)) {
      hydratedOrder.current.delete(s.id); hydratedOrder.current.set(s.id, true);
      if (seen.current.has(s.id)) continue;
      seen.current.add(s.id);
      const patch = {};
      if (s.url && /^https?:/.test(s.url)) patch.url = s.url;
      dispatch({ t: 'patch', sid: s.id, patch });
      const updates = []; hydration.current.set(s.id, updates);
      dispatch({ t: 'patch', sid: s.id, patch: { historyLoading: true, historyError: null } });
      api.invoke('session-snapshot', { sessionId: s.id }).then(v => {
        if (hydration.current.get(s.id) !== updates) return;
        const events = historyEvents(v.events, v.partial, v.partialItem, v.partialReasoning, v.startSeq || 0);
        dispatch({ t: 'patch', sid: s.id, patch: { events, historyStart: v.startSeq || 0, historyLoading: false, historyError: null, ctx: v.context, mode: v.state.mode, review: v.state.review || 'manual', modelSelection: v.state.modelSelection, plan: v.state.plan, todos: v.state.todos, approvals: v.state.approvals || [], question: v.state.questions?.[0] || null, run: v.state.run, ratings: v.state.ratings || {}, retry: v.state.modelRetry || null, debuggerPaused: !!v.state.debuggerPaused, goal: v.state.goal, team: v.state.team, subagents: v.state.subagents || [] } });
        const queued = hydration.current.get(s.id) || []; hydration.current.delete(s.id);
        for (const update of queued) if (update.revision == null || update.revision > v.revision) update.apply();
      }).catch(error => {
        if (hydration.current.get(s.id) !== updates) return;
        seen.current.delete(s.id); const queued = hydration.current.get(s.id) || []; hydration.current.delete(s.id);
        dispatch({ t: 'patch', sid: s.id, patch: { historyLoading: false, historyError: error.message } });
        for (const update of queued) update.apply();
      });
      api.invoke('get-requests', { sessionId: s.id }).then(r => r?.list?.length && dispatch({ t: 'requests', sid: s.id, v: r.list })).catch(() => {});
    }
    for (const id of hydratedOrder.current.keys()) {
      if (hydratedOrder.current.size <= 8) break;
      if (id === sessions.focused || sessions.sessions.find(item => item.id === id)?.agentRunning) continue;
      hydratedOrder.current.delete(id); hydration.current.delete(id); seen.current.delete(id); dispatch({ t: 'history-evict', sid: id });
    }
  }, [sessions]);

  const loadEarlierHistory = async () => {
    const target = sidRef.current, beforeSeq = S[target]?.historyStart;
    if (!beforeSeq || S[target]?.historyLoading) return;
    dispatch({ t: 'patch', sid: target, patch: { historyLoading: true } });
    try {
      const page = await api.invoke('session-snapshot', { sessionId: target, beforeSeq });
      dispatch({ t: 'history-prepend', sid: target, events: historyEvents(page.events, '', null, '', page.startSeq), startSeq: page.startSeq });
    } catch (error) { dispatch({ t: 'patch', sid: target, patch: { historyLoading: false, historyError: error.message } }); toast(error.message, 'err'); }
  };

  // 滚动：**全部**交给 ChatScroll（ui/src/chat-scroll.js），这里只做接线。
  //
  // 2026-11-02 重写：旧版本在这里有三段 useEffect 各自读写 scrollTop
  // （贴底 / 兜底跟随 / 保存位置），再加 scroll-stick.js 的纯函数，
  // 任何两处都会互相覆盖——「打开会话停在顶部」改了 6 轮都没修好就是这个原因。
  // 现在只有 ChatScroll 碰 scrollTop；这里只负责：
  //   · attach / detach 容器
  //   · 进入会话时 restore（有锚点回锚点，否则贴底）
  //   · 内容变化时 contentGrew（仅跟随态才动）
  //   · 用户移动后把锚点写进 localStorage
  const scrollRef = useRef(null);
  const viewsRef = useRef(presentation.views); viewsRef.current = presentation.views;
  const setScrollRef = useRef(presentation.setScroll); setScrollRef.current = presentation.setScroll;
  useLayoutEffect(() => {
    if (!chatElement || !chatContent || cur.historyLoading) return;
    const ctrl = new ChatScroll(); scrollRef.current = ctrl;
    ctrl.attach(chatElement, { content: chatContent, onUserMove: () => {
      if (scrollRef.current === ctrl && sidRef.current === sid) setScrollRef.current(ctrl.currentAnchor, sid);
    } });
    ctrl.restore(sessionView(viewsRef.current, sid)?.scroll || null);
    return () => { if (scrollRef.current === ctrl) scrollRef.current = null; ctrl.detach(); };
  }, [sid, chatElement, chatContent, !!cur.historyLoading]);
  useLayoutEffect(() => { scrollRef.current?.contentGrew(); }, [cur.events, commandFeedback[sid], cur.ctx?.compressing]);

  // 画面区尺寸变化 → 通知 sidecar 调整无头视口
  const runningNow = !!cur?.status?.running;
  useEffect(() => {
    const el = viewRef.current; if (!el) return;
    const target = sid;
    let t;
    const push = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const r = el.getBoundingClientRect();
        if (target === sidRef.current && r.width > 50 && r.height > 50) api.invoke('browser-viewport', { sessionId: target, width: r.width, height: r.height, dpr: window.devicePixelRatio || 1 }).catch(() => {});
      }, 250);
    };
    const ro = new ResizeObserver(push); ro.observe(el); push();
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [sid, runningNow, view, side, sideOpen, tabs.activeTab?.id, tabs.browserReady, viewElement]);

  // 原生嵌入：把面板矩形报告给 Rust，Chrome 子窗口跟随
  const embedOn = !!(cur.status.running && cur.status.embed && cur.status.chromePid);
  const [embedCovered, setEmbedCovered] = useState(false);
  // 没拿到 Chrome 工具栏尺寸时绝不能把原生窗口露出来：inset 为全零等于「一点都不裁」，
  // 结果是 Chrome 自带的标签栏/地址栏整条叠在我们的地址栏下面。宁可先不显示，等尺寸到位。
  const [embedPending, setEmbedPending] = useState(false);
  useEffect(() => {
    if (!embedOn || !tabs.browserReady || view !== 'chat' || side !== 'browser' || !sideOpen) { surface.current.hide().catch(() => {}); setEmbedPending(false); return; }
    const el = viewRef.current; if (!el) return;
    const mySid = sid, pid = cur.status.chromePid;
    let dead = false, t = null, inset = null, insetAt = 0, lastKey = '', force = true;
    const covered = () => {
      const r = el.getBoundingClientRect();
      for (const o of document.querySelectorAll('[data-overlay], .rt-DialogOverlay, .rt-PopperContent, [data-sonner-toast]')) {
        const b = o.getBoundingClientRect();
        if (b.width && b.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return true;
      }
      return false;
    };
    const sync = async () => {
      if (dead) return;
      const cov = covered(); setEmbedCovered(cov);
      if (cov || document.hidden) { if (lastKey !== 'hidden') surface.current.hide().catch(() => {}); lastKey = 'hidden'; setEmbedPending(false); return; }
      if (!inset || Date.now() - insetAt > 3000) { inset = await api.invoke('embed-inset', { sessionId: mySid }).catch(() => null) || inset; insetAt = Date.now(); if (dead) return; }
      // 仍然没有尺寸（页面正在导航 / 还没有活动页）：先藏起来，避免露出一整条 Chrome 工具栏。
      // 全零 inset 同样视为无效——那等于「一点都不裁」，Chrome 自带的标签栏和地址栏会整条露出来。
      if (!inset || !(inset.top > 0 || inset.left > 0 || inset.right > 0 || inset.bottom > 0)) {
        if (lastKey !== 'pending') surface.current.hide().catch(() => {});
        lastKey = 'pending'; setEmbedPending(true); return;
      }
      setEmbedPending(false);
      const r = el.getBoundingClientRect();
      const active = activityRef.current;
      const key = [r.left, r.top, r.width, r.height, window.devicePixelRatio, JSON.stringify(inset), active].join();
      if (key === lastKey && !force) return;
      lastKey = key; force = false;
      try { const result = await surface.current.show({ sessionId: mySid, pid, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, dpr: window.devicePixelRatio || 1, inset, active }); if (dead || result.state === 'superseded') return; embedTry.current[mySid] = 0; }
      catch (e) {
        if (dead) return;
        const n = (embedTry.current[mySid] || 0) + 1; embedTry.current[mySid] = n;
        if (n < 24 && !String(e?.message || e).includes('ACTIVITY_OVERLAY_UNAVAILABLE')) { force = true; clearTimeout(t); t = setTimeout(sync, 250); return; }
        surface.current.hide().catch(() => {}); api.invoke('embed-fallback', { sessionId: mySid, reason: String(e?.message || e) }).catch(() => {});
        toast('原生嵌入失败，已改用画面串流：' + String(e?.message || e), 'warn', 6000);
      }
    };
    let raf = 0; const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
    activityKick.current = kick;
    const ro = new ResizeObserver(kick); ro.observe(el);
    const mo = new MutationObserver(kick); mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', kick); document.addEventListener('visibilitychange', kick);
    const iv = setInterval(() => { force = true; kick(); }, 1500);
    kick();
    return () => { dead = true; if (activityKick.current === kick) activityKick.current = null; clearTimeout(t); clearInterval(iv); cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', kick); document.removeEventListener('visibilitychange', kick); surface.current.hide().catch(() => {}); };
  }, [embedOn, sid, cur.status.chromePid, toast, view, side, sideOpen, tabs.activeTab?.id, tabs.browserReady, viewElement]);

  // 会话浏览器关闭 → 释放宿主窗口
  useEffect(() => {
    for (const [id, st] of Object.entries(S)) {
      const running = !!st.status?.running;
      if (prevRun.current[id] && !running) surface.current.release(id).catch(() => {});
      prevRun.current[id] = running;
    }
  }, [S]);

  // ---- 动作 ----
  const inv = useCallback((ch, a = {}) => api.invoke(ch, { sessionId: sidRef.current, ...a }), []);

  async function launch(target = sidRef.current) {
    setLaunching(l => ({ ...l, [target]: true }));
    try {
      const r = await api.invoke('browser-launch', { sessionId: target });
      if (!r.ok) { dispatch({ t: 'patch', sid: target, patch: { browserError: r.error } }); toast(r.error, 'err', 6000); return false; }
      dispatch({ t: 'patch', sid: target, patch: { toolCount: r.toolCount } });
      return true;
    } catch (e) { dispatch({ t: 'patch', sid: target, patch: { browserError: e.message } }); toast('启动失败：' + e.message, 'err'); return false; }
    finally { setLaunching(l => ({ ...l, [target]: false })); }
  }

  async function go(u) {
    const target = sidRef.current;
    if (launching[target] || cur.navigating) return;
    dispatch({ t: 'patch', sid: target, patch: { browserError: '', navigating: true } });
    try {
      const url = normalizeTargetUrl(u ?? cur.url);
      if (!url) return;
      dispatch({ t: 'patch', sid: target, patch: { url } });
      if (!cur.status.running && !(await launch(target))) return;
      await api.invoke('navigate', { sessionId: target, url });
    } catch (e) {
      dispatch({ t: 'patch', sid: target, patch: { browserError: e.message || String(e) } });
      toast(e.message || String(e), 'err', 6000);
    } finally { dispatch({ t: 'patch', sid: target, patch: { navigating: false } }); }
  }

  async function newSession(projectId) {
    const initialView = { side, sideOpen, manuallyClosed: false };
    try {
      const targetProject = typeof projectId === 'string' ? projectId : [projectFilter, session?.projectId].find(id => projects.some(p => p.id === id));
      if (!targetProject) { setWorkspacePrompt('create'); return; }
      const s = await api.invoke('session-create', { projectId: targetProject });
      presentation.update(s.id, initialView);
      await api.invoke('session-focus', { sessionId: s.id });
      setView('chat');
      requestAnimationFrame(() => {
        if (sidRef.current === s.id && !document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) inputRef.current?.focus();
      });
    } catch (e) { toast(e.message, 'warn'); }
  }

  async function closeSession(id) {
    const s = sessions.sessions.find(x => x.id === id);
    if (!s || !await askConfirm(`删除「${sessionLabel(s, settings?.titlePrefix)}」？聊天记录、附件、浏览器数据及会话内的托管工作区会永久删除。外部项目文件保留，关联自动化将暂停。`, { ok: '删除对话', danger: true })) return;
    try { await api.invoke('session-delete', { sessionId: id }); }
    catch (e) { toast('删除失败：' + e.message, 'err'); return; }
    await surface.current.release(id).catch(() => {});
    delete prevRun.current[id];
    dispatch({ t: 'drop', sid: id });
    presentation.forget(id);
    localStorage.removeItem('wdh_ev_' + id);
    seen.current.delete(id);
  }

  const focusSession = id => { api.invoke('session-focus', { sessionId: id }); setView('chat'); };

  async function pinSession(id, pinned) {
    try { await api.invoke('session-pin', { sessionId: id, pinned }); }
    catch (e) { toast('置顶失败：' + e.message, 'err'); }
  }

  function sendInput(e, kind, extra = {}) {
    if (!cur.status.running) return;
    const cv = canvasRef.current; if (!cv) return;
    const rect = cv.getBoundingClientRect();
    // canvas 用 object-fit: contain，换算到实际画面坐标
    const sc = Math.min(rect.width / cv.width, rect.height / cv.height);
    const ox = (rect.width - cv.width * sc) / 2, oy = (rect.height - cv.height * sc) / 2;
    const x = (e.clientX - rect.left - ox) / sc, y = (e.clientY - rect.top - oy) / sc;
    if (x < 0 || y < 0 || x > cv.width || y > cv.height) return;
    api.sendInput({ kind, w: cv.width, x, y, ...extra });
  }

  function followAcceptedSubmission(target) {
    if (sidRef.current !== target) return;
    scrollRef.current?.follow();
    setScrollRef.current(null, target);
  }

  async function send(auto, override, delivery = 'queue') {
    if (!sid) { setProjectEditor({}); return; }
    const target = sid, sentDraft = input;
    if (sending[target]) return;
    let text = auto ? '' : String(typeof override === 'string' ? override : input).trim();
    if (!auto && !text && !(atts[sid] || []).length) return;
    if (uploads[sid]) { toast('附件仍在添加，请稍候', 'info'); return; }
    if (!auto && editTarget && editTarget.sid === target) {
      if (!text && !(atts[target] || []).length) return;
      setSending(m => ({ ...m, [target]: true }));
      try {
        const r = await api.invoke('agent-turn-edit', { sessionId: target, turnId: editTarget.turnId, atSeq: editTarget.atSeq, text, attachments: (atts[target] || []).map(({ key, ...a }) => a) });
        if (!r?.ok) { toast(r?.error || '编辑重发失败', 'warn'); return; }
        const destination = r.sessionId || target;
        setScrollRef.current(null, destination); followAcceptedSubmission(destination);
        setEditTarget(null); setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m); if (inputRef.current) inputRef.current.style.height = '';
        setAtts(values => ({ ...values, [target]: [] }));
        return true;
      } catch (e) { toast('编辑重发失败：' + e.message, 'err'); return; }
      finally { setSending(m => ({ ...m, [target]: false })); }
    }
    const parsedCommand = !auto && parseCommand(text);
    const command = parsedCommand?.known ? parsedCommand : null;
    const commandAt = Date.now();
    const feedback = (state, message) => {
      setCommandFeedback(m => ({ ...m, [target]: { name: command?.name || '', state, text: message, at: commandAt } }));
      if (state === 'running' || state === 'success') followAcceptedSubmission(target);
    };
    if (command) {
      const commandAttachments = atts[target] || [];
      if (!command.known) { toast('未知命令。输入 / 查看可用命令。', 'warn'); return; }
      if (command.name === 'help') { setInput('/'); return; }
      if (['skills', 'memories'].includes(command.name)) { setExtensionBrowser(command.name === 'skills' ? 'skill' : 'memory'); setInput(''); return; }
      if (command.name === 'mcp' && !command.argument) { setView('plugins'); setInput(''); return; }
      if (command.name === 'automation' && !command.argument) { setAutomationDraft(true); setView('automations'); setInput(''); return; }
      if (['goal', 'skill', 'memory', 'agent'].includes(command.name) && !command.argument) { setCommandForm({ name: command.name, sessionId: target }); return; }
      const request = extensionRequest(command.name, command.argument);
      if (command.name === 'permission') {
        // 对齐 DSH 的 /permission：裸调用报告当前预设与可用项，带参直接切换。
        // 带参形式已经是明确同意，所以不弹风险确认框（DSH 的 ui-permission-presets README 明文如此）。
        const preset = command.argument ? resolvePreset(command.argument) : null;
        if (!command.argument) feedback('success', presetStatusLine(currentPreset(cur.mode, cur.review)));
        else if (!preset) feedback('error', `未知预设「${command.argument}」（可用：${PRESET_CLI_NAMES.join('、')}）`);
        else {
          try {
            await api.invoke('session-set-mode', { sessionId: target, ...presetKnobs(preset) });
            feedback('success', `已切换为 ${presetLabel(preset)}`);
          } catch (e) { feedback('error', e.message || '切换失败'); }
        }
        setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m);
        if (inputRef.current) inputRef.current.style.height = '';
        return true;
      }
      if (command.name === 'plan') {
        try {
          const plan = await api.invoke('plan-set', { sessionId: target, active: command.argument !== 'off' });
          dispatch({ t: 'patch', sid: target, patch: { plan } });
          feedback('success', plan.pending !== null ? '计划模式将在下一步切换。' : plan.active ? '计划模式已开启，输入 /plan off 退出。' : '计划模式已关闭。');
        } catch (e) { feedback('error', e.message); return; }
        if (!command.argument || command.argument === 'off') {
          setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m);
          if (inputRef.current) inputRef.current.style.height = '';
          return true;
        }
        text = command.argument;
      } else if (request) {
        if (session?.workspace?.availability !== 'ready') { feedback('error', '项目目录不可用，请重新选择目录。'); return; }
        text = request;
      } else {
      feedback('running', '正在执行 /' + command.name + '…');
      setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m);
      if (inputRef.current) inputRef.current.style.height = '';
      if (command.name === 'status') { feedback('success', ['会话 ID：' + target, session?.workspace?.root, '权限：' + presetLabel(currentPreset(cur.mode, cur.review)), cur.goal ? '目标：' + cur.goal.objective : ''].filter(Boolean).join('\n')); }
      else {
        if (command.name === 'compact' && cur.agentRunning) { feedback('error', '请先停止当前任务，再压缩上下文。'); return; }
        if (['agent', 'goal'].includes(command.name) && !['pause', 'clear'].includes(command.argument) && session?.workspace?.availability !== 'ready') { feedback('error', '项目目录不可用，请重新选择目录。'); return; }
        if (['goal', 'agent'].includes(command.name) && !command.argument) { if (command.name === 'goal' && cur.goal) toast(cur.goal.summary || cur.goal.objective, 'info'); else toast(`在 /${command.name} 后填写${command.name === 'goal' ? '目标' : '研究任务'}。`, 'info'); return; }
        setSending(m => ({ ...m, [target]: true }));
        try {
          let r;
          if (command.name === 'goal') r = await api.invoke(['pause', 'resume', 'clear'].includes(command.argument) ? 'goal-action' : 'goal-start', { sessionId: target, action: command.argument, objective: command.argument, attachments: commandAttachments.map(({ key, ...a }) => a) });
          if (command.name === 'compact') {
            r = await api.invoke('agent-compress', { sessionId: target, instructions: command.argument });
            if (r?.cancelled) { feedback('idle', '已取消压缩，历史保持不变。'); return; }
          }
          if (command.name === 'agent') { await api.invoke('subagent-start', { sessionId: target, task: command.argument }); r = { ok: true }; }
          if (command.name === 'agents') { dispatch({ t: 'patch', sid: target, patch: { subagents: (await api.invoke('agent-state', { sessionId: target })).subagents || [] } }); toast('从对话顶部的子代理入口，或所属轮次的执行过程中查看状态和结论。', 'info'); }
          if (command.name === 'stop') await api.invoke(cur.agentRunning && cur.run?.id ? 'agent-cancel-turn' : 'agent-interrupt', { sessionId: target, runId: cur.run?.id });
          if (command.name === 'new') await newSession();
          if (r?.ok === false) { feedback('error', r.error || '命令未执行'); return; }
          if (command.name === 'goal' && !['pause', 'clear'].includes(command.argument)) followAcceptedSubmission(target);
          if (command.name === 'goal') setCommandFeedback(m => ({ ...m, [target]: null }));
          else feedback('success', command.name === 'compact' ? `上下文已压缩：${r.before} → ${r.after} tokens` : '/' + command.name + ' 已执行');
          if (command.name === 'goal' && !['pause', 'resume', 'clear'].includes(command.argument)) { const consumed = new Set(commandAttachments.map(a => a.key)); setAtts(m => ({ ...m, [target]: (m[target] || []).filter(a => !consumed.has(a.key)) })); }
        } catch (e) { feedback('error', e.message || '命令执行失败'); return; }
        finally { setSending(m => ({ ...m, [target]: false })); }
      }
      setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m); if (inputRef.current) inputRef.current.style.height = ''; return true;
      }
    }
    if (session?.workspace?.availability !== 'ready') { toast('项目目录不可用，请重新选择目录。', 'warn'); return; }
    const list = auto ? [] : (atts[sid] || []);
    let r;
    setSending(m => ({ ...m, [target]: true }));
    // 是否入队交给 sidecar 判断：本地 agentRunning 可能比实际状态晚一拍。
    try { r = await api.invoke('agent-send', { sessionId: target, text, auto, enqueue: true, delivery, attachments: list.map(({ key, ...a }) => a) }); }
    catch (e) { toast('发送失败：' + e.message, 'err'); return; }
    finally { setSending(m => ({ ...m, [target]: false })); }
    if (!r?.ok) {
      toast(r?.error || '发送失败', 'warn');
      if (sidRef.current === target && /API Key/.test(r?.error || '')) setView('settings');
      return;
    }
    if (r.queued && !r.steered) toast('已加入下一轮队列', 'info');
    if (!r.queued || r.steered) followAcceptedSubmission(target);
    if (!auto) {
      const sent = new Set(list.map(a => a.key));
      setAtts(m => ({ ...m, [target]: (m[target] || []).filter(a => !sent.has(a.key)) }));
      setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m);
      if (sidRef.current === target && inputRef.current) inputRef.current.style.height = '';
    }
    if (sidRef.current === target) setView('chat');
    return true;
  }

  // 手动压缩：与 /compact 命令走同一条反馈条，只是入口是按钮。
  // 运行期间反馈条上的 ✕ 会真的取消（agent-compress-cancel）。
  async function compactNow(instructions) {
    setView('chat');
    const target = sidRef.current;
    if (cur.agentRunning) { toast('请先停止当前任务，再压缩上下文。', 'warn'); return; }
    const at = Date.now();
    followAcceptedSubmission(target);
    setCommandFeedback(m => ({ ...m, [target]: { name: 'compact', state: 'running', text: '正在执行 /compact…', at } }));
    try {
      const r = await inv('agent-compress', { instructions });
      if (r?.cancelled) { setCommandFeedback(m => ({ ...m, [target]: { name: 'compact', at, state: 'idle', text: '已取消压缩，历史保持不变。' } })); return; }
      if (!r?.ok) { setCommandFeedback(m => ({ ...m, [target]: { name: 'compact', at, state: 'error', text: r?.error || '压缩失败' } })); return; }
      setCommandFeedback(m => ({ ...m, [target]: { name: 'compact', at, state: 'done', text: `上下文已压缩：${r.before} → ${r.after} tokens` } }));
    } catch (e) {
      setCommandFeedback(m => ({ ...m, [target]: { name: 'compact', at, state: 'error', text: e.message || '压缩失败' } }));
    }
  }

  async function cleanRetry({ fresh = false } = {}) {
    const target = sid;
    if (!await askConfirm(fresh ? '使用新的浏览器配置打开当前网址？原聊天和文件会保留。' : '清除当前站点 Cookie、存储与网络记录并刷新？原聊天和文件会保留。')) return;
    if (target !== sidRef.current) return;
    try {
      if (cur.agentRunning) await api.invoke('agent-interrupt', { sessionId: target });
      if (fresh) await api.invoke('restart-fresh', { sessionId: target, url: cur.url }); else await api.invoke('reset-session', { sessionId: target, scope: 'site', reload: true });
      dispatch({ t: 'patch', sid: target, patch: { requests: [], scripts: [] } });
      if (target === sidRef.current) toast(fresh ? '已用全新 Profile 重启' : '已清空站点数据并刷新', 'ok');
    } catch (err) { toast('干净重试失败：' + (err?.message || err), 'err'); }
  }

  // 把「当前渠道」镜像进供应商字段：侧车仍只认 provider/openai/anthropic
  function mirrorActive(s) {
    const list = s.providers || [];
    const p = list.find(x => x.id === s.activeProviderId) || list[0];
    if (!p) return s;
    const models = (p.models || []).map(m => typeof m === 'string' ? { id: m } : m);
    const requested = typeof s.activeModel === 'object' ? s.activeModel?.id : s.activeModel;
    const model = models.find(m => m.id === requested)?.id || models[0]?.id || requested || '';
    const mObj = models.find(m => m.id === model);
    const out = { ...s, provider: p.type, activeModel: model, providers: list };
    // 上下文窗口 / 图片能力 / 思考声明跟着「模型」走，而不是渠道
    out[p.type] = {
      ...(s[p.type] || {}), baseUrl: p.baseUrl, model,
      apiKey: p.apiKey || (s[p.type] || {}).apiKey || '',
      contextWindow: Number(mObj?.contextWindow) || Number(p.contextWindow) || 0,
      vision: !!mObj?.vision,
    };
    // 只有模型显式声明了档位才镜像；否则删掉，避免把上一个模型的声明带过去。
    if (mObj?.thinking?.levels?.length) out[p.type].thinking = mObj.thinking; else delete out[p.type].thinking;
    out[p.type].api = mObj?.api || p.api || null;
    return out;
  }

  async function saveSettings(s, quiet) {
    try {
    for (const p of s.providers || []) if (p.apiKey) await native.secretSet('prov.' + p.id, p.apiKey);
    const out = mirrorActive(s);
    let saved = await api.invoke('save-settings', out);
    if (native.isNative()) { const envelope = await native.syncSecrets(saved.providers.map(p => 'prov.' + p.id), saved.activeProviderId); saved = await api.invoke('secrets-sync', { envelope }); }
    setSettings(saved);
    if (!quiet) toast('设置已保存', 'ok');
    return true;
    } catch (e) { toast('保存设置失败：' + e.message, 'err'); return false; }
  }

  const setSessionModel = async input => {
    const target = sidRef.current;
    try { const modelSelection = await api.invoke('session-model-set', { sessionId: target, ...input }); dispatch({ t: 'patch', sid: target, patch: { modelSelection } }); return true; }
    catch (e) { toast(e.message || '切换模型失败', 'err'); return false; }
  };
  const pickModel = (pid, m) => setSessionModel({ providerId: pid, model: m });
  // 切换思考强度：与选模型同一条保存通道，立刻对下一次请求生效（settings 是请求时的快照来源）。
  const pickThinking = level => setSessionModel({ thinking: level });
  const enableImages = () => { const selected = cur.modelSelection || session?.modelSelection;
    return saveSettings({ ...settings, providers: (settings.providers || []).map(p => p.id !== (selected?.providerId || settings.activeProviderId) ? p : { ...p, models: (p.models || []).map(m => (typeof m === 'string' ? m : m.id) !== (selected?.model || settings.activeModel) ? m : { ...(typeof m === 'string' ? { id: m, name: m } : m), vision: true }) }) }, true);
  };

  // ---- 快捷键 ----
  useEffect(() => {
    const h = e => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (e.target.closest?.('.terminal-screen') && !e.altKey) return;
      // Submission belongs to the focused composer. A global Cmd/Ctrl+Enter
      // bypasses IME and overlay ownership, and double-submits local gestures.
      if (mod(e) && e.key.toLowerCase() === 'l') { e.preventDefault(); if (!sid) { setWorkspacePrompt('create'); return; } setView('chat'); setSide('browser'); setSideOpen(true); setTimeout(() => { urlRef.current?.focus(); urlRef.current?.select(); }, 60); }
      else if (mod(e) && e.key.toLowerCase() === 't') { e.preventDefault(); newSession(); }
      else if (mod(e) && e.key === ',') { e.preventDefault(); setView(v => v === 'settings' ? 'chat' : 'settings'); }
      else if (mod(e) && /^[1-4]$/.test(e.key) && e.altKey) {
        e.preventDefault();
        const k = ['chat', 'browser', 'evidence', 'code'][+e.key - 1];
        if (k === 'chat') { setView('chat'); setSideOpen(false); }
        else { setView('chat'); if (side === k && sideOpen) setSideOpen(false); else { setSide(k); setSideOpen(true); } }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const value = {
    api, conn, toast,
    projects, setProjects, projectFilter, setProjectFilter, projectEditor, setProjectEditor, moveSession, setMoveSession, workspacePrompt, setWorkspacePrompt,
    isCurrentSession: id => sidRef.current === id,
    commandForm, setCommandForm, extensionBrowser, setExtensionBrowser, automationDraft, setAutomationDraft,
    legacySessions, restoreLegacySessions, discardLegacySessions,
    commandFeedback: commandFeedback[sid], clearCommandFeedback: () => setCommandFeedback(m => ({ ...m, [sid]: null })),
    // 取消正在跑的手动压缩。界面上的 ✕ 走这条，不是只收起提示。
    cancelCompact: async () => {
      try { await api.invoke('agent-compress-cancel', { sessionId: sidRef.current }); }
      catch (e) { toast(e.message || '取消失败', 'err'); }
    },
    settings, saveSettings, setSettings, firstRun, setFirstRun,
    sessions, sid, session, cur, dispatch, focusSession,
    view, setView, side, setSide, sideOpen, setSideOpen, openSide, panelLayout: presentation.layout, setPanelLayout: presentation.setPanelLayout, tabs,
    presentation,
    launching, launch, go, newSession, closeSession, pinSession, cleanRetry,
    input, setInput, editTarget: editTarget?.sid === sid ? editTarget : null, startEdit, cancelEdit, rate,
    atts: atts[sid] || [], addAtt, rmAtt, addFiles, dropPaste, uploading: !!uploads[sid], sending: !!sending[sid], enableImages,
    send, sendInput, compactNow, pickModel, pickThinking, inv, loadEarlierHistory, reloadHistory: () => { seen.current.delete(sidRef.current); setSessions(value => ({ ...value })); },
    setTheme,
    followSubmission: followAcceptedSubmission,
    steerQueue: async () => {
      for (const item of cur.queuedItems || []) {
        const result = await api.invoke('agent-queue-steer', { sessionId: sid, id: item.id, runId: cur.run?.id });
        if (!result.ok) { if (!['queue-item-not-found', 'steer-unavailable'].includes(result.code)) toast(result.error, 'err'); break; }
      }
      followAcceptedSubmission(sid);
    },
    refs: { viewRef: bindViewport, canvasRef: bindCanvas, urlRef, inputRef, chatRef, bindChat, bindChatContent, scrollController: scrollRef },
    embedOn, embedCovered, embedPending,
    isApi, fmt: { hostOf: undefined },
  };

  return <Ctx.Provider value={value}>
    <DocumentLinks.Provider value={openContentLink}>{children}</DocumentLinks.Provider>
  </Ctx.Provider>;
}
