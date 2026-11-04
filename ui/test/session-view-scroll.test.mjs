// 阅读位置的规范化与持久化。
//
// 2026-11-02 用户反复报告：「关掉再打开，会话又跳到最上面」。
// 根因有两处，都在这里：
//   1) normalizeScroll 只保留 top，丢掉了 fromBottom / max —— 恢复时无法按距底重算，
//      只能回放一个只对旧高度成立的绝对值；
//   2) normalize 里 `?? previous.scroll` 把显式 null（贴底=不记忆）又兜回来了，
//      于是「用户已经回到底部」这个事实永远存不进去，下次打开读到的还是顶部位置。
import test from 'node:test';
import assert from 'node:assert/strict';
import { updateSessionView, readSessionViews, sessionView, persistedSessionViews, SESSION_VIEW_KEY, DEFAULT_SESSION_VIEW } from '../src/session-view.js';

const SID = 's' + '1234567890abcdef1234567890abcdef';
const mem = initial => {
  const map = new Map(initial ? [[SESSION_VIEW_KEY, JSON.stringify(initial)]] : []);
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
};

test('normalizeScroll 保留 fromBottom 与 max（恢复要靠它们重算）', () => {
  const views = updateSessionView({}, SID, { scroll: { top: 1200, max: 2400, fromBottom: 1200, at: 1 } });
  const saved = sessionView(views, SID).scroll;
  assert.equal(saved.top, 1200);
  assert.equal(saved.max, 2400, 'max 必须保留，否则旧的纯 top 记录无法换算');
  assert.equal(saved.fromBottom, 1200, 'fromBottom 必须保留，恢复按距底重算');
});

test('显式 null 必须真的清掉位置（贴底 = 不记忆），不被旧值兜回', () => {
  // 先记一个顶部位置
  let views = updateSessionView({}, SID, { scroll: { top: 800, max: 3000, fromBottom: 2200 } });
  assert.equal(sessionView(views, SID).scroll.top, 800);
  // 用户滚回底部 → 贴底时写入 null
  views = updateSessionView(views, SID, { scroll: null });
  assert.equal(sessionView(views, SID).scroll, null, '贴底后必须清空，否则重开会跳回旧位置');
});

test('未提供 scroll 字段时保留旧位置（切面板不能丢阅读位置）', () => {
  let views = updateSessionView({}, SID, { scroll: { top: 800, max: 3000, fromBottom: 2200 } });
  views = updateSessionView(views, SID, { side: 'code' });          // 只改侧栏
  assert.equal(sessionView(views, SID).scroll.top, 800, '不相关的更新不应清掉阅读位置');
});

test('落盘再读回，位置字段完整存活', () => {
  const storage = mem();
  let views = updateSessionView({}, SID, { scroll: { top: 900, max: 2800, fromBottom: 1900 } });
  storage.setItem(SESSION_VIEW_KEY, JSON.stringify({ version: 2, sessions: persistedSessionViews(views) }));
  const back = readSessionViews(storage);
  const s = sessionView(back.views, SID).scroll;
  assert.equal(s.top, 900);
  assert.equal(s.max, 2800);
  assert.equal(s.fromBottom, 1900);
});

test('落盘再读回，null 位置保持 null（不会复活旧值）', () => {
  const storage = mem();
  let views = updateSessionView({}, SID, { scroll: { top: 900, max: 2800, fromBottom: 1900 } });
  views = updateSessionView(views, SID, { scroll: null });
  storage.setItem(SESSION_VIEW_KEY, JSON.stringify({ version: 2, sessions: persistedSessionViews(views) }));
  const back = readSessionViews(storage);
  assert.equal(sessionView(back.views, SID).scroll, null);
});

test('旧数据（只有 top）仍可读，缺 max/fromBottom 不报错', () => {
  const storage = mem({ version: 2, sessions: { [SID]: { ...DEFAULT_SESSION_VIEW, scroll: { top: 500, at: 1 } } } });
  const back = readSessionViews(storage);
  const s = sessionView(back.views, SID).scroll;
  assert.equal(s.top, 500);
  assert.equal(s.max, undefined, '旧记录没有 max，不能凭空编一个');
  assert.equal(s.fromBottom, undefined);
});

test('非法 scroll 值归一为 null，不污染存储', () => {
  for (const bad of [{ top: -5 }, { top: NaN }, { top: 'abc' }, 'x', 42]) {
    const views = updateSessionView({}, SID, { scroll: bad });
    assert.equal(sessionView(views, SID).scroll, null, JSON.stringify(bad) + ' 应被拒');
  }
});
