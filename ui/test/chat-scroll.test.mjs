// ChatScroll：滚动的唯一所有者。
//
// 这套重建的目标不是"再修一次"，而是**从结构上消灭互相覆盖的可能**：
//   1. 只有它读写 scrollTop
//   2. 跟随意图是显式状态，不靠几何量反推
//   3. 保存位置用语义锚点（轮次+偏移），不用绝对像素
//
// 最小 DOM 替身按浏览器规则约束滚动范围；实际交互另做可见验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatScroll, BOTTOM_TOLERANCE, normalizeAnchor } from '../src/chat-scroll.js';

/** 造一个可控的滚动容器替身：轮次按固定高度排列。 */
function fakeScroller({ turnCount = 10, turnHeight = 400, viewport = 600 } = {}) {
  const listeners = new Map();
  const el = {
    _top: 0,
    get scrollTop() { return this._top; },
    set scrollTop(value) { this._top = Math.min(Math.max(0, this.scrollHeight - this.clientHeight), Math.max(0, value)); },
    clientHeight: viewport,
    get scrollHeight() { return turnCount * turnHeight; },
    style: {
      map: new Map(),
      getPropertyValue(k) { return this.map.get(k) || ''; },
      getPropertyPriority() { return ''; },
      setProperty(k, v) { this.map.set(k, v); },
      removeProperty(k) { this.map.delete(k); },
    },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect() { return { top: 0, bottom: viewport }; },
    querySelectorAll() {
      return Array.from({ length: turnCount }, (_, i) => ({
        dataset: { turnId: 'turn-' + i },
        getBoundingClientRect: () => ({ top: i * turnHeight - el.scrollTop, bottom: (i + 1) * turnHeight - el.scrollTop }),
      }));
    },
    querySelector(sel) {
      const m = /data-turn-id="([^"]+)"/.exec(sel);
      const id = m?.[1];
      const i = id ? Number(id.replace('turn-', '')) : NaN;
      if (!Number.isFinite(i) || i < 0 || i >= turnCount) return null;
      return {
        dataset: { turnId: id },
        getBoundingClientRect: () => ({ top: i * turnHeight - el.scrollTop, bottom: (i + 1) * turnHeight - el.scrollTop }),
      };
    },
    /** 模拟用户滚动（会派发 scroll 事件） */
    userScrollTo(top) { el.scrollTop = top; listeners.get('scroll')?.(); listeners.get('scrollend')?.(); },
    /** 模拟用户手势 */
    userIntent() { listeners.get('wheel')?.(); },
  };
  return el;
}

test('初始状态跟随尾部', () => {
  const s = new ChatScroll();
  assert.equal(s.isFollowing, true);
  assert.equal(s.currentAnchor, null);
});

test('restore(null) 贴底，并清空锚点', () => {
  const s = new ChatScroll(); const el = fakeScroller();
  s.attach(el);
  const r = s.restore(null);
  assert.equal(r.atBottom, true);
  assert.equal(s.currentAnchor, null, '贴底不该留下锚点');
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight, '必须落到真实底部');
});

test('restore(anchor) 回到锚定的轮次', () => {
  const s = new ChatScroll(); const el = fakeScroller({ turnCount: 20 });
  s.attach(el);
  const r = s.restore({ turnId: 'turn-5', offset: 0 });
  assert.equal(r.atBottom, false);
  // turn-5 顶部在文档 2000 处，offset 0 → scrollTop 2000
  assert.equal(el.scrollTop, 2000);
  assert.deepEqual(s.currentAnchor, { turnId: 'turn-5', offset: 0 });
});

test('内容变长后，锚点仍指向同一轮（这是像素方案做不到的）', () => {
  const s = new ChatScroll();
  const el = fakeScroller({ turnCount: 20, turnHeight: 400 });
  s.attach(el);
  s.restore({ turnId: 'turn-5', offset: 100 });
  const before = el.scrollTop;
  // 前面插入了内容：每轮高度不变但整体位移了（用更大的高度模拟第 0 轮变高）
  const grew = fakeScroller({ turnCount: 20, turnHeight: 600 });
  const s2 = new ChatScroll();
  s2.attach(grew);
  s2.restore({ turnId: 'turn-5', offset: 100 });
  // turn-5 顶部 = 5*600 = 3000，加 offset 100（视口顶部已进入该轮 100px）
  assert.equal(grew.scrollTop, 3100, '锚点必须按新几何重算，而不是回放旧像素');
  assert.notEqual(grew.scrollTop, before, '内容高度变了，像素值必然不同——这正是旧实现的错');
});

test('用户上翻后停止跟随，内容增长不再抢位置', () => {
  const s = new ChatScroll(); const el = fakeScroller();
  s.attach(el);
  s.restore(null);
  el.userIntent(); el.userScrollTo(500);
  assert.equal(s.isFollowing, false);
  const held = el.scrollTop;
  assert.equal(s.contentGrew(), false, '非跟随态不该动');
  assert.equal(el.scrollTop, held);
});

test('显式展开阅读在高度变化前释放贴底，后续内容增长不抢位置', () => {
  const s = new ChatScroll(), el = fakeScroller();
  let saved = null;
  s.attach(el, { onUserMove: () => { saved = s.currentAnchor; } });
  s.follow();
  const top = el.scrollTop;
  s.pauseFollowing();
  assert.equal(s.isFollowing, false);
  assert.ok(saved?.turnId, '阅读意图应保存语义锚点');
  assert.equal(s.contentGrew(), false);
  assert.equal(el.scrollTop, top);
  s.follow(); assert.equal(s.isFollowing, true, '显式回到底部后仍能恢复跟随');
});

test('用户滚回底部后恢复跟随并清空锚点', () => {
  const s = new ChatScroll(); const el = fakeScroller();
  s.attach(el);
  s.restore(null);
  el.userIntent(); el.userScrollTo(500);
  assert.equal(s.isFollowing, false);
  el.userScrollTo(el.scrollHeight - el.clientHeight);   // 回到底部
  assert.equal(s.isFollowing, true);
  assert.equal(s.currentAnchor, null);
});

test('跟随态下内容增长会贴底', () => {
  const s = new ChatScroll();
  let count = 10;
  const listeners = new Map();
  const el = fakeScroller({ turnCount: 10 });
  Object.defineProperty(el, 'scrollHeight', { get: () => count * 400 });
  s.attach(el);
  s.restore(null);
  count = 20;                                  // 新消息进来
  assert.equal(s.contentGrew(), true);
  assert.equal(el.scrollTop, count * 400 - el.clientHeight, '必须跟到新底部');
});

test('jumpToTurn 末轮 = 精确贴底，不留偏移', () => {
  const s = new ChatScroll(); const el = fakeScroller({ turnCount: 10 });
  s.attach(el);
  s.restore({ turnId: 'turn-2', offset: 0 });
  const r = s.jumpToTurn('turn-9', { atBottom: true });
  assert.equal(r.atBottom, true);
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight, '末轮必须精确贴底（旧实现差 12~68px）');
});

test('jumpToTurn 中间轮留 12px 呼吸空间，且不再跟随', () => {
  const s = new ChatScroll(); const el = fakeScroller({ turnCount: 30 });
  s.attach(el);
  const r = s.jumpToTurn('turn-3');
  assert.equal(el.scrollTop, 3 * 400 - 12);
  assert.equal(r.atBottom, false);
  assert.equal(s.isFollowing, false);
});

test('程序化滚动不会被误判成用户上翻', () => {
  const s = new ChatScroll(); const el = fakeScroller();
  s.attach(el);
  s.restore(null);                              // 内部会写 scrollTop
  // 若误判，following 会变 false
  assert.equal(s.isFollowing, true, '自己触发的 scroll 不该改变跟随意图');
});

test('detach 后不再监听，状态复位', () => {
  const s = new ChatScroll(); const el = fakeScroller();
  s.attach(el);
  el.userIntent(); el.userScrollTo(300);
  assert.equal(s.isFollowing, false);
  s.detach();
  assert.equal(s.isFollowing, true, '解绑后回到初始态');
  assert.equal(s.currentAnchor, null);
});

test('normalizeAnchor 只接受语义锚点，拒绝旧像素格式', () => {
  assert.deepEqual(normalizeAnchor({ turnId: 't1', offset: 40 }), { turnId: 't1', offset: 40 });
  // 旧格式（像素）必须被拒绝——这正是"重开跳顶部"的来源之一
  assert.equal(normalizeAnchor({ top: 1200 }), null);
  assert.equal(normalizeAnchor({ top: 0 }), null);
  assert.equal(normalizeAnchor(null), null);
  assert.equal(normalizeAnchor({ turnId: '', offset: 1 }), null);
  assert.equal(normalizeAnchor({ turnId: 'x', offset: -5 }), null);
  assert.equal(normalizeAnchor({ turnId: 'x' }), null);
});

test('BOTTOM_TOLERANCE 足够小，不会把「已上翻但接近底部」误判为贴底', () => {
  assert.ok(BOTTOM_TOLERANCE <= 32, '旧值 160 太宽，会吃掉用户的阅读位置');
});
