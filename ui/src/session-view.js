// Presentation belongs to a chat, independently of its Agent or browser process.
import { emptyDock, normalizeDock, selectDockKind, tabSide } from './dock-tabs.js';
export const SESSION_VIEW_KEY = 'decrypthub-session-views-v1';
export const DEFAULT_PANEL_LAYOUT = Object.freeze([56, 44]);
export const DEFAULT_SESSION_VIEW = Object.freeze({ side: 'browser', sideOpen: false, manuallyClosed: false, layout: DEFAULT_PANEL_LAYOUT, dock: emptyDock() });
const validId = id => /^(?:main|s(?:[a-f0-9]{6}|[a-f0-9]{32}))$/.test(id || '');
const sides = new Set(['browser', 'evidence', 'code', 'document', 'terminal']);
// 阅读位置：只有用户主动往上翻过才记录，否则恢复时仍贴底（符合「跟上最新进展」的默认预期）。
// 思考块的展开状态则是**纯运行期状态**，刻意不落盘：刷新、重开会话后一律收起，
// 与 docs/conversation-presentation.md 的「思考过程默认收起」一致。用户当场点开照样能看，
// 只是不跨刷新记住——否则页面会一进来就把整段推理摊开，把对话顶走。
const MAX_OPEN_REASONING = 200;
// 阅读位置的规范化。除 top 外还要保留 fromBottom / max：
//   · fromBottom —— 距底部像素，恢复时按它重算，内容变长也不会漂到顶部
//   · max        —— 保存时的可滚动高度，用于把旧的纯 top 记录换算成 fromBottom
// 只留 top 会让「关掉再打开」回放一个对旧高度才成立的绝对值——历史加载完高度变了，
// 那个值就落在偏上甚至顶部（2026-11-02 用户反复报告的正是这个）。
const normalizeScroll = value => {
  if (!value || typeof value !== 'object') return null;
  const top = Number(value.top);
  if (!Number.isFinite(top) || top < 0) return null;
  const out = { top: Math.round(top), at: value.at || 0, pinned: false };
  const max = Number(value.max), fromBottom = Number(value.fromBottom);
  if (Number.isFinite(max) && max >= 0) out.max = Math.round(max);
  if (Number.isFinite(fromBottom) && fromBottom >= 0) out.fromBottom = Math.round(fromBottom);
  return out;
};
const normalizeReasoning = value => {
  if (!Array.isArray(value)) return [];
  return value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 120).slice(-MAX_OPEN_REASONING);
};
const normalize = (value, previous = DEFAULT_SESSION_VIEW) => {
  const dock = normalizeDock(value?.dock || previous.dock);
  return ({
  side: sides.has(value?.side) ? value.side : previous.side,
  sideOpen: typeof value?.sideOpen === 'boolean' ? value.sideOpen : previous.sideOpen,
  manuallyClosed: typeof value?.manuallyClosed === 'boolean' ? value.manuallyClosed : previous.manuallyClosed,
  layout: Array.isArray(value?.layout) && value.layout.length === 2 && value.layout.every(n => Number.isFinite(n) && n > 0 && n < 100) && Math.abs(value.layout[0] + value.layout[1] - 100) < .1 ? [...value.layout] : previous.layout,
  dock,
  // 阅读位置是「用户显式做过选择」才记，缺省不写入。
  // 思考展开状态在内存里照常记录（当场点开立刻生效），但永不写进 localStorage，
  // 所以刷新/重开会话后一定从收起开始——由 use-session-view 的持久化处剥离。
  // 阅读位置：显式 null 表示「贴底，不记忆位置」，必须真的清掉，
  // 不能被 previous.scroll 兜回来——否则用户回到底部后重开，读到的仍是
  // 之前那个顶部位置，表现就是「关掉再打开又跳到最上面」。
  scroll: value?.scroll === null ? null
    : (value?.scroll !== undefined ? (normalizeScroll(value.scroll) ?? null) : (previous.scroll ?? null)),
  reasoningOpen: normalizeReasoning(value?.reasoningOpen ?? previous.reasoningOpen),
  ...(dock.activeId ? { side: tabSide(dock.tabs.find(t => t.id === dock.activeId)) } : {}),
}); };
export function readSessionViews(storage) {
  try {
    const data = JSON.parse(storage.getItem(SESSION_VIEW_KEY));
    if ([1, 2].includes(data?.version) && data.sessions && typeof data.sessions === 'object')
      return { views: Object.fromEntries(Object.entries(data.sessions).filter(([id]) => validId(id)).slice(-200).map(([id, value]) => [id, normalize(data.version === 1 && !value.dock ? { ...value, ...selectDockKind(DEFAULT_SESSION_VIEW, value.side || 'browser') } : value)])), fallback: DEFAULT_SESSION_VIEW };
    return { views: {}, fallback: { ...DEFAULT_SESSION_VIEW, sideOpen: storage.getItem('wdh_side') === 'open' } };
  } catch { return { views: {}, fallback: DEFAULT_SESSION_VIEW }; }
}
export function sessionView(views, id, fallback = DEFAULT_SESSION_VIEW) { return views[id] || fallback; }
export function updateSessionView(views, id, update, fallback = DEFAULT_SESSION_VIEW) {
  if (!validId(id)) return views;
  const previous = sessionView(views, id, fallback);
  const next = normalize(typeof update === 'function' ? update(previous) : update, previous);
  if (views[id] && JSON.stringify(next) === JSON.stringify(previous)) return views;
  return Object.fromEntries(Object.entries({ ...views, [id]: next }).slice(-200));
}
export function revealSessionBrowser(views, id, fallback = DEFAULT_SESSION_VIEW) {
  if (sessionView(views, id, fallback).manuallyClosed) return views;
  return updateSessionView(views, id, view => ({ ...selectDockKind(view, 'browser'), sideOpen: true }), fallback);
}
/**
 * 落盘前的视图快照：剥掉 reasoningOpen。
 *
 * 思考块的展开状态是运行期状态——内存里记录，所以当场点开立刻生效；
 * 一旦写进 localStorage 就会跨刷新存活，页面一进来就把整段推理摊开、把对话顶走，
 * 与 docs/conversation-presentation.md 的「思考过程默认收起」冲突。
 * 所以持久化版本里恒缺该字段，读回来自然就是收起的。
 */
export function persistedSessionViews(views) {
  return Object.fromEntries(Object.entries(views).map(([id, view]) => {
    const { reasoningOpen, ...rest } = view;
    return [id, rest];
  }));
}
