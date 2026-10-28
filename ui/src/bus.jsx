// 数据管道：settings / 会话 / 事件流 / 浏览器嵌框 / 动作。
// 界面组件只从这里取状态和动作，不自己发 RPC。
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { toast as notify } from 'sonner';
import { blankSession, sessionReducer, mod, isApi } from './state.js';
import { askConfirm, askQuestion } from './kit.jsx';
import { onConnState, native } from './transport.js';
import { normalizeTargetUrl } from '../../sidecar/url.mjs';
import { scheduleStartupCheck } from './updater.js';
import { historyEvents } from './conversation.js';
import { rememberPreview } from './attachments.jsx';
import { parseCommand, extensionRequest } from './commands.js';
import { BrowserSurface } from './browser-surface.js';
import { useSessionView } from './use-session-view.jsx';

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
  useEffect(() => api.on('projects', setProjects), []);

  const sid = sessions.focused;
  const session = sessions.sessions.find(s => s.id === sid) || null;
  const cur = (sid && S[sid]) || blankSession();

  const sidRef = useRef(sid); sidRef.current = sid;
  const input = drafts[sid] || '';
  const setInput = useCallback(value => setDrafts(d => ({ ...d, [sidRef.current]: value })), []);
  const viewRef = useRef();       // 浏览器画面容器
  const canvasRef = useRef();     // 画面
  const urlRef = useRef();        // 地址栏
  const inputRef = useRef();      // 输入框
  const chatRef = useRef();       // 消息滚动区
  const [uploads, setUploads] = useState({});
  const [sending, setSending] = useState({});
  const attsRef = useRef(atts); attsRef.current = atts;
  const approvalChain = useRef(Promise.resolve());
  const seen = useRef(new Set());
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const prevRun = useRef({});
  const frameSeq = useRef(0);
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
      // 模型从「字符串数组」升级成对象：{ id, name, contextWindow, vision }
      for (const p of s.providers) {
        p.models = (p.models || []).map(m => typeof m === 'string' ? { id: m, name: m }
          : (m && m.id ? { id: String(m.id), name: m.name || String(m.id), contextWindow: Number(m.contextWindow) || 0, vision: !!m.vision } : null)).filter(Boolean);
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
      const activeKey = s.providers.find(p => p.id === s.activeProviderId)?.hasKey;
      const keyMissing = !(activeKey || (s.provider === 'anthropic' ? s.anthropic.hasKey : s.openai.hasKey));
      if (keyMissing && !window.__JSRA_SKIP_ONBOARD) setFirstRun(true);
      const shot = window.__JSRA_SHOT;
      if (['settings', 'automations'].includes(shot)) setView(shot);
      else if (['browser', 'evidence', 'code'].includes(shot)) { setSide(shot, restoredSessions.focused); setSideOpen(true, restoredSessions.focused); }
    } catch (e) { console.error('boot failed:', e && (e.message || e)); setTimeout(() => location.reload(), 1500); }
  })(); }, []);

  // ---- 画面帧 ----
  const drawFrame = useCallback(f => {
    const cv = canvasRef.current; if (!cv) return;
    const seq = ++frameSeq.current;
    const img = new Image();
    img.onload = () => {
      if (seq !== frameSeq.current) return;
      if (cv.width !== img.width) cv.width = img.width;
      if (cv.height !== img.height) cv.height = img.height;
      try { const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0); } catch {}
    };
    img.src = 'data:image/' + (f.fmt === 'png' ? 'png' : 'jpeg') + ';base64,' + f.data;
  }, []);

  // ---- 事件订阅 ----
  useEffect(() => {
    const on = (ch, fn) => api.on(ch, fn);
    const offs = [
      on('sessions', v => setSessions(v)),
      on('goal', (v, s) => dispatch({ t: 'patch', sid: s, patch: { goal: v } })),
      on('subagents', (v, s) => dispatch({ t: 'patch', sid: s, patch: { subagents: v } })),
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
      on('agent-context', (v, s) => {
        dispatch({ t: 'patch', sid: s, patch: { ctx: v } });
        if (v?.event === 'compressed' || v?.event === 'pruned') {
          dispatch({ t: 'ev', sid: s, v: { type: 'compact', stage: v.event, reason: v.reason, before: v.before, after: v.after, instructions: v.instructions || '', summary: v.summary || '', pruned: v.pruned || 0, summarized: v.summarized || 0, at: Date.now() } });
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
      const patch = { agentRunning: s.agentRunning, mode: s.mode || 'standard', review: s.review || 'manual', run: s.run, queued: s.queued || 0 };
      if (s.running) patch.status = { ...blankSession().status, ...(S[s.id]?.status || {}), running: true, embed: !!s.embed, chromePid: s.chromePid || null };
      dispatch({ t: 'patch', sid: s.id, patch });
    }
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // 首次见到某会话：载入网址、对话记录、已捕获请求
  useEffect(() => {
    for (const s of sessions.sessions) {
      if (seen.current.has(s.id)) continue;
      seen.current.add(s.id);
      const patch = {};
      if (s.url && /^https?:/.test(s.url)) patch.url = s.url;
      dispatch({ t: 'patch', sid: s.id, patch });
      api.invoke('session-snapshot', { sessionId: s.id }).then(v => {
        const events = historyEvents(v.events, v.partial, v.partialItem, v.partialReasoning);
        dispatch({ t: 'patch', sid: s.id, patch: { events, ctx: v.context, mode: v.state.mode, review: v.state.review || 'manual', todos: v.state.todos, approvals: v.state.approvals || [], question: v.state.questions?.[0] || null, run: v.state.run, retry: v.state.modelRetry || null, debuggerPaused: !!v.state.debuggerPaused, goal: v.state.goal, subagents: v.state.subagents || [] } });
      }).catch(() => seen.current.delete(s.id));
      api.invoke('get-requests', { sessionId: s.id }).then(r => r?.list?.length && dispatch({ t: 'requests', sid: s.id, v: r.list })).catch(() => {});
    }
  }, [sessions]);

  useEffect(() => { const el = chatRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight; }, [cur.events]);

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
  }, [sid, runningNow, view, side, sideOpen]);

  // 原生嵌入：把面板矩形报告给 Rust，Chrome 子窗口跟随
  const embedOn = !!(cur.status.running && cur.status.embed && cur.status.chromePid);
  const [embedCovered, setEmbedCovered] = useState(false);
  useEffect(() => {
    if (!embedOn || view !== 'chat' || side !== 'browser' || !sideOpen) { surface.current.hide().catch(() => {}); return; }
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
      if (cov || document.hidden) { if (lastKey !== 'hidden') surface.current.hide().catch(() => {}); lastKey = 'hidden'; return; }
      if (!inset || Date.now() - insetAt > 3000) { inset = await api.invoke('embed-inset', { sessionId: mySid }).catch(() => null) || inset; insetAt = Date.now(); if (dead) return; }
      const r = el.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height, window.devicePixelRatio, JSON.stringify(inset)].join();
      if (key === lastKey && !force) return;
      lastKey = key; force = false;
      try { const result = await surface.current.show({ sessionId: mySid, pid, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, dpr: window.devicePixelRatio || 1, inset }); if (dead || result.state === 'superseded') return; embedTry.current[mySid] = 0; }
      catch (e) {
        if (dead) return;
        const n = (embedTry.current[mySid] || 0) + 1; embedTry.current[mySid] = n;
        if (n < 24) { force = true; clearTimeout(t); t = setTimeout(sync, 250); return; }
        surface.current.hide().catch(() => {}); api.invoke('embed-fallback', { sessionId: mySid, reason: String(e?.message || e) }).catch(() => {});
        toast('原生嵌入失败，已改用画面串流：' + String(e?.message || e), 'warn', 6000);
      }
    };
    let raf = 0; const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
    const ro = new ResizeObserver(kick); ro.observe(el);
    const mo = new MutationObserver(kick); mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', kick); document.addEventListener('visibilitychange', kick);
    const iv = setInterval(() => { force = true; kick(); }, 1500);
    kick();
    return () => { dead = true; clearTimeout(t); clearInterval(iv); cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', kick); document.removeEventListener('visibilitychange', kick); surface.current.hide().catch(() => {}); };
  }, [embedOn, sid, cur.status.chromePid, toast, view, side, sideOpen]);

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
      if (r.code === 'workspace-required' && sidRef.current === target) setWorkspacePrompt(true);
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

  async function newSession() {
    const initialView = { side, sideOpen, manuallyClosed: false };
    try {
      const s = await api.invoke('session-create', projectFilter ? { projectId: projectFilter } : {});
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
    if (s?.agentRunning && !await askConfirm(`「${s.title || '对话'}」的 AI 正在分析，关闭将中断并关闭其浏览器。继续？`, { ok: '关闭', danger: true })) return;
    await api.invoke('session-close', { sessionId: id });
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

  async function send(auto, override) {
    const target = sid, sentDraft = input;
    if (sending[target]) return;
    let text = auto ? '' : String(typeof override === 'string' ? override : input).trim();
    if (!auto && !text && !(atts[sid] || []).length) return;
    if (uploads[sid]) { toast('附件仍在添加，请稍候', 'info'); return; }
    const command = !auto && parseCommand(text);
    const feedback = (state, message) => setCommandFeedback(m => ({ ...m, [target]: { name: command?.name || '', state, text: message } }));
    if (command) {
      const commandAttachments = atts[target] || [];
      if (!command.known) { toast('未知命令。输入 / 查看可用命令。', 'warn'); return; }
      if (command.name === 'help') { setInput('/'); return; }
      if (['skills', 'memories'].includes(command.name)) { setExtensionBrowser(command.name === 'skills' ? 'skill' : 'memory'); setInput(''); return; }
      if (command.name === 'mcp' && !command.argument) { setView('plugins'); setInput(''); return; }
      if (command.name === 'automation' && !command.argument) { setAutomationDraft(true); setView('automations'); setInput(''); return; }
      if (['goal', 'skill', 'memory', 'agent'].includes(command.name) && !command.argument) { setCommandForm({ name: command.name, sessionId: target }); return; }
      const request = extensionRequest(command.name, command.argument);
      if (request) {
        if (session?.workspace?.kind === 'unselected') { setWorkspacePrompt(true); return; }
        text = request;
      } else {
      feedback('running', '正在执行 /' + command.name + '…');
      if (command.name === 'status') { feedback('success', ['会话 ID：' + target, session?.workspace?.kind === 'unselected' ? '尚未选择工作目录' : session?.workspace?.root, '权限：' + cur.mode, cur.goal ? '目标：' + cur.goal.objective : ''].filter(Boolean).join('\n')); }
      else {
        if (command.name === 'compact' && cur.agentRunning) { feedback('error', '请先停止当前任务，再压缩上下文。'); return; }
        if (command.name === 'agent' && session?.workspace?.kind === 'unselected') { setWorkspacePrompt(true); feedback('error', '请选择工作目录后再启动研究任务。'); return; }
        if (command.name === 'goal' && !['pause', 'resume', 'clear'].includes(command.argument) && session?.workspace?.kind === 'unselected') { setWorkspacePrompt(true); feedback('error', '请选择工作目录后再启动目标。'); return; }
        if (['goal', 'agent'].includes(command.name) && !command.argument) { if (command.name === 'goal' && cur.goal) toast(cur.goal.summary || cur.goal.objective, 'info'); else toast(`在 /${command.name} 后填写${command.name === 'goal' ? '目标' : '研究任务'}。`, 'info'); return; }
        setSending(m => ({ ...m, [target]: true }));
        try {
          let r;
          if (command.name === 'goal') r = await api.invoke(['pause', 'resume', 'clear'].includes(command.argument) ? 'goal-action' : 'goal-start', { sessionId: target, action: command.argument, objective: command.argument, attachments: commandAttachments.map(({ key, ...a }) => a) });
          if (command.name === 'compact') r = await api.invoke('agent-compress', { sessionId: target, instructions: command.argument });
          if (command.name === 'agent') { await api.invoke('subagent-start', { sessionId: target, task: command.argument }); r = { ok: true }; }
          if (command.name === 'agents') { dispatch({ t: 'patch', sid: target, patch: { subagents: (await api.invoke('agent-state', { sessionId: target })).subagents || [] } }); toast('研究任务会显示在输入框上方，可展开查看状态和结论。', 'info'); }
          if (command.name === 'stop') await api.invoke('agent-interrupt', { sessionId: target });
          if (command.name === 'new') await newSession();
          if (r?.ok === false) { feedback('error', r.error || '命令未执行'); return; }
          feedback('success', command.name === 'compact' ? `上下文已压缩：${r.before} → ${r.after} tokens` : command.name === 'goal' ? '目标操作已完成，进展显示在输入框上方。' : '/' + command.name + ' 已执行');
          if (command.name === 'goal' && !['pause', 'resume', 'clear'].includes(command.argument)) { const consumed = new Set(commandAttachments.map(a => a.key)); setAtts(m => ({ ...m, [target]: (m[target] || []).filter(a => !consumed.has(a.key)) })); }
        } catch (e) { feedback('error', e.message || '命令执行失败'); return; }
        finally { setSending(m => ({ ...m, [target]: false })); }
      }
      setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m); if (inputRef.current) inputRef.current.style.height = ''; return true;
      }
    }
    if (session?.workspace?.kind === 'unselected') { setWorkspacePrompt(true); return; }
    const list = auto ? [] : (atts[sid] || []);
    let r;
    setSending(m => ({ ...m, [target]: true }));
    try { r = await api.invoke('agent-send', { sessionId: target, text, auto, enqueue: cur.agentRunning, attachments: list.map(({ key, ...a }) => a) }); }
    catch (e) { toast('发送失败：' + e.message, 'err'); return; }
    finally { setSending(m => ({ ...m, [target]: false })); }
    if (!r?.ok) {
      if (r?.code === 'workspace-required') { if (sidRef.current === target) setWorkspacePrompt(true); } else toast(r?.error || '发送失败', 'warn');
      if (sidRef.current === target && /API Key/.test(r?.error || '')) setView('settings');
      return;
    }
    if (r.queued) toast('已加入下一轮队列', 'info');
    if (!auto) {
      const sent = new Set(list.map(a => a.key));
      setAtts(m => ({ ...m, [target]: (m[target] || []).filter(a => !sent.has(a.key)) }));
      setDrafts(m => m[target] === sentDraft ? { ...m, [target]: '' } : m);
      if (sidRef.current === target && inputRef.current) inputRef.current.style.height = '';
    }
    if (sidRef.current === target) setView('chat');
    return true;
  }

  async function compactNow(instructions) {
    setView('chat');
    const r = await inv('agent-compress', { instructions });
    if (!r?.ok) toast(r?.error || '压缩失败', 'warn');
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
    // 上下文窗口 / 图片能力跟着「模型」走，而不是渠道
    out[p.type] = {
      ...(s[p.type] || {}), baseUrl: p.baseUrl, model,
      apiKey: p.apiKey || (s[p.type] || {}).apiKey || '',
      contextWindow: Number(mObj?.contextWindow) || Number(p.contextWindow) || 0,
      vision: !!mObj?.vision,
    };
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

  const pickModel = (pid, m) => saveSettings({ ...settings, activeProviderId: pid, activeModel: m }, true);
  const enableImages = () => saveSettings({ ...settings, providers: (settings.providers || []).map(p => p.id !== settings.activeProviderId ? p : { ...p, models: (p.models || []).map(m => (typeof m === 'string' ? m : m.id) !== settings.activeModel ? m : { ...(typeof m === 'string' ? { id: m, name: m } : m), vision: true }) }) }, true);

  // ---- 快捷键 ----
  useEffect(() => {
    const h = e => {
      if (mod(e) && e.key === 'Enter') { e.preventDefault(); send(false); }
      else if (mod(e) && e.key.toLowerCase() === 'l') { e.preventDefault(); setView('chat'); setSide('browser'); setSideOpen(true); setTimeout(() => { urlRef.current?.focus(); urlRef.current?.select(); }, 60); }
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
    commandFeedback: commandFeedback[sid], clearCommandFeedback: () => setCommandFeedback(m => ({ ...m, [sid]: null })),
    settings, saveSettings, setSettings, firstRun, setFirstRun,
    sessions, sid, session, cur, dispatch, focusSession,
    view, setView, side, setSide, sideOpen, setSideOpen, openSide, panelLayout: presentation.layout, setPanelLayout: presentation.setPanelLayout,
    launching, launch, go, newSession, closeSession, pinSession, cleanRetry,
    input, setInput, atts: atts[sid] || [], addAtt, rmAtt, addFiles, uploading: !!uploads[sid], sending: !!sending[sid], enableImages,
    send, sendInput, compactNow, pickModel, inv,
    setTheme,
    refs: { viewRef, canvasRef, urlRef, inputRef, chatRef },
    embedOn, embedCovered,
    isApi, fmt: { hostOf: undefined },
  };

  return <Ctx.Provider value={value}>
    {children}
  </Ctx.Provider>;
}
