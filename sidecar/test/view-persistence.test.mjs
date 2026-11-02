// 页面状态持久化：阅读位置会持久化，思考块展开状态**不会**。
//
// 思考块是「当场点开能看，刷新后收起」：用户主动展开时立刻生效，
// 但刷新、重开会话后一律从收起开始（见 docs/conversation-presentation.md）。
// 阅读位置则相反，重开会话要回到上次读到的地方；从没往上翻过时仍贴底。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readSessionViews, updateSessionView, sessionView, persistedSessionViews, DEFAULT_SESSION_VIEW, SESSION_VIEW_KEY } from '../../ui/src/session-view.js';
import { reasoningOpen, toggleReasoning, restoreTarget, shouldStick } from '../../ui/src/scroll-stick.js';

const storage = initial => {
  const map = new Map(initial ? [[SESSION_VIEW_KEY, JSON.stringify(initial)]] : []);
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
};
const SID = 's' + 'a'.repeat(32);

test('阅读位置会被保存和读回，思考展开状态不会', () => {
  const store = storage();
  let views = readSessionViews(store).views;
  views = updateSessionView(views, SID, () => ({ scroll: { top: 1200, at: 111 }, reasoningOpen: ['a', 'b'] }));
  // 内存里当场展开是生效的
  assert.deepEqual(views[SID].reasoningOpen, ['a', 'b'], '当场展开要立刻生效');
  // 持久化走产品里那一份 persistedSessionViews，而不是在测试里重写一遍
  store.setItem(SESSION_VIEW_KEY, JSON.stringify({ version: 2, sessions: persistedSessionViews(views) }));

  const restored = readSessionViews(store).views[SID];
  assert.deepEqual(restored.scroll, { top: 1200, at: 111, pinned: false });
  assert.deepEqual(restored.reasoningOpen, [], '刷新后思考必须默认收起');
});

test('落盘快照不携带 reasoningOpen，且不改动内存中的视图', () => {
  const views = updateSessionView(readSessionViews(storage()).views, SID, () => ({ reasoningOpen: ['x'] }));
  const persisted = persistedSessionViews(views);
  assert.equal('reasoningOpen' in persisted[SID], false, '持久化版本不应含该字段');
  assert.deepEqual(views[SID].reasoningOpen, ['x'], '内存里的展开状态不受影响');
});

test('回到顶部以外的地方才记录；未记录时默认贴底', () => {
  const views = readSessionViews(storage()).views;
  const fresh = sessionView(views, SID);
  assert.equal(fresh.scroll, undefined, '新会话没有阅读位置');
  // 没有记录 → 交给贴底逻辑
  assert.equal(restoreTarget({ scrollHeight: 5000, clientHeight: 400 }, null), null);
});

test('保存的位置能恢复，但接近底部或超出内容时贴底', () => {
  const box = { scrollHeight: 5000, clientHeight: 400 };
  // 保存 2000：应当恢复
  assert.equal(restoreTarget(box, { top: 2000 }), 2000);
  // 保存 4580（距底 20px）：视为「本来就在底部」，走贴底
  assert.equal(restoreTarget(box, { top: 4580 }), null);
  // 超出内容高度（上下文被压缩后变短）：钳制后就是底部，因此贴底
  assert.equal(restoreTarget({ scrollHeight: 1000, clientHeight: 400 }, { top: 4600 }), null);
  // 内容还没撑满一屏时无从恢复
  assert.equal(restoreTarget({ scrollHeight: 300, clientHeight: 400 }, { top: 100 }), null);
  // 非法值不恢复
  assert.equal(restoreTarget(box, { top: -5 }), null);
  assert.equal(restoreTarget(box, { top: 'x' }), null);
});

test('滚动位置的脏数据不会破坏会话视图', () => {
  const dirty = { version: 2, sessions: { [SID]: { side: 'browser', scroll: { top: 'NaN' }, reasoningOpen: 'not-an-array' } } };
  const view = readSessionViews(storage(dirty)).views[SID];
  assert.equal(view.scroll, null, '非法位置归零为 null');
  assert.deepEqual(view.reasoningOpen, [], '非法列表降级为空');
  assert.equal(view.side, 'browser', '其他字段不受影响');
});

test('思考块逐个记住，互不影响', () => {
  let view = DEFAULT_SESSION_VIEW;
  assert.equal(reasoningOpen(view, { id: 'r1' }), false);

  const afterR1 = toggleReasoning(view, { id: 'r1' });
  view = { ...view, reasoningOpen: afterR1 };
  assert.equal(reasoningOpen(view, { id: 'r1' }), true);
  assert.equal(reasoningOpen(view, { id: 'r2' }), false, '别的思考块不该跟着展开');

  const afterR2 = toggleReasoning(view, { id: 'r2' });
  view = { ...view, reasoningOpen: afterR2 };
  assert.deepEqual(view.reasoningOpen, ['r1', 'r2']);

  // 再点一次收起
  const closed = toggleReasoning(view, { id: 'r1' });
  assert.deepEqual(closed, ['r2'], '收起只影响自己');
});

test('思考展开数量有上限，避免长期会话无限增长', () => {
  let view = { ...DEFAULT_SESSION_VIEW, reasoningOpen: [] };
  for (let i = 0; i < 250; i++) {
    view = { ...view, reasoningOpen: toggleReasoning(view, { id: 'r' + i }, 200) };
  }
  assert.equal(view.reasoningOpen.length, 200);
  assert.equal(view.reasoningOpen.at(-1), 'r249', '保留最近的');
  assert.equal(view.reasoningOpen.includes('r0'), false, '最早的被丢弃');
});

test('没有 id 的事件不写入状态', () => {
  assert.equal(toggleReasoning(DEFAULT_SESSION_VIEW, {}), null);
  assert.equal(reasoningOpen(DEFAULT_SESSION_VIEW, {}), false);
});

test('itemId 可作为 id 兜底', () => {
  const view = { ...DEFAULT_SESSION_VIEW, reasoningOpen: ['item-9'] };
  assert.equal(reasoningOpen(view, { itemId: 'item-9' }), true);
});

test('恢复位置时不改变「是否跟随底部」的判定语义', () => {
  const state = { sid: null, settled: false };
  const box = { scrollHeight: 5000, scrollTop: 0, clientHeight: 400 };
  const first = shouldStick(box, state, SID);
  assert.equal(first.fresh, true);
  assert.equal(first.stick, true, '首次进入即使在上方也要落位');

  // 已 settle 且用户在中间：不打扰
  const second = shouldStick({ scrollHeight: 5000, scrollTop: 2000, clientHeight: 400 }, { sid: SID, settled: true }, SID);
  assert.equal(second.stick, false);
});
