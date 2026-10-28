// 纯逻辑：状态形状、reducer、格式化。没有任何 JSX。

export const blankSession = () => ({
  status: { running: false, pages: [] },
  requests: [], scripts: [], events: [], logs: [],
  usage: null, ctx: null,
  agentRunning: false, thinking: false, retry: null, toolCount: 0,
  url: 'https://', mode: 'standard', review: 'manual', approvals: [], question: null, run: null,
  todos: null,
});

export const FALLBACK_TODOS = [
  { id: 'locate', content: '定位参数', status: 'pending' },
  { id: 'signer', content: '找到签名函数', status: 'pending' },
  { id: 'extract', content: '抠代码 / 补环境', status: 'pending' },
  { id: 'repro', content: '本地复现', status: 'pending' },
  { id: 'compare', content: '与浏览器结果对比', status: 'pending' },
];

export const MODE_LABEL = { 'read-only': '只读查看', standard: '请求批准', 'full-access': '完全访问权限' };

// 每个会话的 UI 状态（事件按 sid 路由，互不干扰）
export function sessionReducer(state, action) {
  const cur = state[action.sid] || blankSession();
  const set = patch => ({ ...state, [action.sid]: { ...cur, ...patch } });
  switch (action.t) {
    case 'drop': { const next = { ...state }; delete next[action.sid]; return next; }
    case 'patch': return set(action.patch);
    case 'approval': return set({ approvals: [...cur.approvals.filter(a => a.id !== action.v.id), action.v] });
    case 'approval-resolved': return set({ approvals: cur.approvals.filter(a => a.id !== action.id) });
    case 'changes-updated': return set({ changesVersion: (cur.changesVersion || 0) + 1 });
    case 'status': return set({ status: action.v, url: (action.v.pages || []).find(p => p.active)?.url || cur.url });
    case 'requests': {
      const idx = new Map(cur.requests.map((r, i) => [r.id, i]));
      const list = cur.requests.slice();
      for (const v of action.v) { const i = idx.get(v.id); if (i != null) list[i] = v; else { idx.set(v.id, list.length); list.push(v); } }
      return set({ requests: list.length > 3000 ? list.slice(-2500) : list });
    }
    case 'request': {
      const list = cur.requests;
      const i = list.findIndex(x => x.id === action.v.id);
      if (i >= 0) { const c = list.slice(); c[i] = action.v; return set({ requests: c }); }
      return set({ requests: [...list.slice(-799), action.v] });
    }
    case 'script': return set({ scripts: [...cur.scripts, action.v] });
    case 'log': return set({ logs: [...cur.logs.slice(-300), action.v] });
    case 'ev': return set({ events: [...cur.events, action.v] });
    case 'assistant-start': return set({ thinking: false, events: cur.events.some(e => e.id === action.v.id) ? action.v.retry ? cur.events.map(e => e.id === action.v.id ? { ...e, ...action.v, content: '', reasoning: '', phase: 'streaming', finished: false } : e) : cur.events : [...cur.events, { type: 'assistant', content: '', phase: 'streaming', ...action.v }] });
    case 'assistant-end': return set({ thinking: false, retry: null, events: cur.events.map(e => e.type === 'assistant' && e.id === action.v.id ? { ...e, ...action.v, finished: true } : e) });
    case 'delta': {
      const events = cur.events.slice();
      for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'assistant' && (typeof action.v === 'string' || events[i].id === action.v.id)) { events[i] = { ...events[i], content: events[i].content + (typeof action.v === 'string' ? action.v : action.v.text) }; break; }
      return set({ events, thinking: false, retry: null });
    }
    case 'reasoning': {
      const events = cur.events.slice();
      for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'assistant' && events[i].id === action.v?.id) { events[i] = { ...events[i], reasoning: (events[i].reasoning || '') + (typeof action.v.text === 'string' ? action.v.text : '') }; break; }
      return set({ events, thinking: true, retry: null });
    }
    // 模型返回的 tool_call id 可能跨步骤重复（如 call_0），只更新最近一个尚未结束的同 id 工具
    case 'tool-end': {
      const events = cur.events.slice();
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.type === 'tool' && (action.v.itemId ? e.itemId === action.v.itemId : e.id === action.v.id) && e.result === undefined) { events[i] = { ...e, result: action.v.text, isError: action.v.isError, ms: action.v.ms }; break; }
      }
      return set({ events });
    }
    default: return state;
  }
}

// ---- 格式化 ----
export const fmtK = n => n == null ? '-' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);
export const fmtSize = n => n == null ? '-' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' kB' : (n / 1048576).toFixed(1) + ' MB';
export const fmtMs = n => n == null ? '-' : n < 1000 ? n + ' ms' : (n / 1000).toFixed(2) + ' s';
export const relTime = ts => {
  const t = Number(ts) || 0; if (!t) return '';
  const d = Date.now() - t;
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return Math.round(d / 60e3) + ' 分钟';
  if (d < 86400e3) return Math.round(d / 3600e3) + ' 小时';
  if (d < 30 * 86400e3) return Math.round(d / 86400e3) + ' 天';
  return new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};
export const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };
export const shortPath = u => { try { const x = new URL(u); return (x.pathname.split('/').filter(Boolean).pop() || x.host).slice(0, 40); } catch { return String(u || '').slice(0, 40); } };
export const isApi = r => r.type === 'xhr' || r.type === 'fetch';
export const argBrief = a => { if (!a) return ''; const v = a.url || a.names || a.expression || a.pattern || a.query || a.file || a.urlPattern || a.code || a.ids || ''; return String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, ' ').slice(0, 70); };
export const sessionLabel = s => {
  if (!s) return '对话';
  return s.title || '对话';
};
export const mod = e => e.ctrlKey || e.metaKey;
