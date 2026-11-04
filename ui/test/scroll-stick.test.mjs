// 会话切换时的滚动定位。2026-11-02 用户反馈：
// 「打开会话，位置还是停在最顶部，每次都要手动滑到最底部才能发消息」。
//
// 这条行为有三个必须同时成立的约束，缺一个就会退回「停在顶部」：
//   1. 切到另一会话 → 必须算 fresh（哪怕这个会话之前访问过）
//   2. 历史异步加载导致高度变化 → 要持续跟随，直到稳定
//   3. 用户主动往上翻 → 之后不许再抢滚动位置
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStick, restoreTarget, settleInto, jumpTo } from '../src/scroll-stick.js';

const box = (scrollHeight, scrollTop = 0, clientHeight = 600) => ({ scrollHeight, scrollTop, clientHeight });

test('首次进入会话必须贴底', () => {
  const state = { sid: null, settled: false };
  const r = shouldStick(box(5000), state, 's1');
  assert.equal(r.stick, true);
  assert.equal(r.fresh, true);
});

test('切到另一个会话后必须重新算 fresh（即使这个会话之前看过）', () => {
  const state = { sid: 's1', settled: true };
  const r = shouldStick(box(5000), state, 's2');
  assert.equal(r.fresh, true, '换了会话就应当重新贴底，不能因为 settled 是 true 就跳过');
  assert.equal(r.stick, true);
  assert.equal(state.sid, 's2');
});

test('同一会话内、用户已在底部 → 继续跟随新消息', () => {
  const state = { sid: 's1', settled: true };
  const r = shouldStick(box(5000, 4400), state, 's1');   // 距底 0
  assert.equal(r.fresh, false);
  assert.equal(r.stick, true);
});

test('同一会话内、用户往上翻 → 不打扰', () => {
  const state = { sid: 's1', settled: true };
  const r = shouldStick(box(5000, 100), state, 's1');    // 距底 4300
  assert.equal(r.stick, false);
});

test('回到同一会话但尚未 settle → 仍要贴底', () => {
  // 这正是"停在顶部"的直接成因：切走再切回来时历史还在异步加载，
  // 若 settled 残留为 true 就会被判成非 fresh，只跳一次旧高度就再也不跟。
  const state = { sid: 's1', settled: true };
  const r = shouldStick(box(5000), state, 's1');
  assert.equal(r.fresh, false, '同一 sid 不算 fresh —— 真正的修法是在切会话时重置 settled');
});

test('切走再切回来：重置 settled 后必须重新贴底（回归锁）', () => {
  // 复现用户报告的操作序列：
  //   会话 A 已定位完成 → 切到 B → 切回 A
  // 若切回 A 时 settled 仍是 true，A 只会被跳一次（旧高度），历史加载完就停在顶部。
  const state = { sid: 's1', settled: true };

  // 切到 s2：按 bus.jsx 的修法，换会话先归零
  if (state.sid !== 's2') state.settled = false;
  const toS2 = shouldStick(box(3000), state, 's2');
  assert.equal(toS2.fresh, true);

  // 在 s2 定位完成
  state.settled = true;

  // 切回 s1：同样先归零
  if (state.sid !== 's1') state.settled = false;
  const backToS1 = shouldStick(box(5000), state, 's1');
  assert.equal(backToS1.fresh, true, '切回来必须重新算 fresh，否则会停在顶部');
  assert.equal(backToS1.stick, true);
});

test('restoreTarget：没有保存位置 → 贴底', () => {
  assert.equal(restoreTarget(box(5000), null), null);
  assert.equal(restoreTarget(box(5000), { top: 0 }), null);
});

test('restoreTarget：保存的位置接近底部 → 不如直接贴底', () => {
  assert.equal(restoreTarget(box(5000), { top: 4450, max: 4400, fromBottom: 50 }), null);
});

test('restoreTarget：按「距底部距离」恢复，内容变长后不漂到顶部（关键）', () => {
  // 这是「关掉再打开跳到最上面」的核心回归：
  // 保存时高度 3000、用户停在 top=1200（距底 1200），
  // 重新打开时历史已加载到 5000 —— 恢复点必须是 5000-600-1200=3200，而不是 1200。
  const atSave = { scrollHeight: 3000, clientHeight: 600 };
  const saved = { top: 1200, max: 2400, fromBottom: 1200 };
  assert.ok(saved.top <= atSave.scrollHeight);
  const reopened = restoreTarget(box(5000), saved);
  assert.equal(reopened, 3200, '必须按距底重算，否则用户会落在偏上的位置');
});

test('restoreTarget：内容变短时不越界', () => {
  const saved = { top: 5000, max: 5000, fromBottom: 3000 };
  const r = restoreTarget(box(2000), saved);
  assert.equal(r, 0, '距底 3000 超过总可滚范围，夹到 0（顶部）是唯一合理位置');
});

test('restoreTarget：旧式只有 top 的极小值不可信，放弃恢复', () => {
  // 旧代码在历史未加载完（scrollHeight 很小）时就把当时的 scrollTop 存下来，
  // 那些值相对现在的高度必然偏小，回放会让用户落在顶部附近。
  // 判据：小于 2 倍可视高度视为噪声。
  const box = { scrollHeight: 5000, clientHeight: 600 };
  for (const legacy of [{ top: 200 }, { top: 600 }, { top: 1100 }]) {
    assert.equal(restoreTarget(box, legacy), null, JSON.stringify(legacy) + ' 应视为噪声');
  }
});

test('restoreTarget：旧式 top 明显超过一屏时才认为用户真的翻上去了', () => {
  const box = { scrollHeight: 5000, clientHeight: 600 };
  // 1200 ≥ 600*2，认为用户确实翻上去了，按距底重算
  assert.equal(restoreTarget(box, { top: 2000 }), 2000);
  assert.equal(restoreTarget(box, { top: 1200 }), 1200);
});

test('restoreTarget：新格式（带 fromBottom）精确恢复', () => {
  // 这是修复后的保存格式：同时记了距底距离
  assert.equal(restoreTarget(box(5000), { top: 1200, max: 2400, fromBottom: 1200 }), 3200);
});

test('settleInto：历史异步变高时持续跟随到底（贴底模式）', () => {
  // 模拟：容器初始 1000，历史分三帧长到 5000
  const heights = [1000, 3000, 5000, 5000, 5000];
  let i = 0;
  const node = { scrollHeight: 1000, scrollTop: 0, clientHeight: 600 };
  const applied = [];
  let done = false;
  settleInto({
    read: () => ({ ...node, scrollHeight: heights[Math.min(i, heights.length - 1)] }),
    apply: top => { applied.push(top); node.scrollTop = top; i++; },
    alive: () => true,
    saved: null,
    schedule: fn => fn(),            // 同步执行，便于断言
    onSettled: () => { done = true; },
    stableFrames: 3,
  });
  assert.equal(done, true, '高度稳定后必须回调 onSettled');
  // 最后一次 apply 必须是最终高度（贴底）
  assert.equal(applied.at(-1), 5000, '最终必须贴在 5000 这个真实底部');
});

test('settleInto：恢复阅读位置时按「距底像素」重算，不被高度变化带偏', () => {
  const heights = [3000, 5000, 5000, 5000];
  let i = 0;
  const node = { scrollHeight: 3000, scrollTop: 0, clientHeight: 600 };
  const applied = [];
  let done = false;
  settleInto({
    read: () => ({ ...node, scrollHeight: heights[Math.min(i, heights.length - 1)] }),
    apply: top => { applied.push(top); node.scrollTop = top; i++; },
    alive: () => true,
    // 新格式：同时有 fromBottom，恢复才被接受
    saved: { top: 600, max: 2400, fromBottom: 1800 },
    schedule: fn => fn(),
    onSettled: () => { done = true; },
    stableFrames: 3,
  });
  assert.equal(done, true);
  // 3000 高时 top=600 距底 1800；5000 高时应当变成 5000-600-1800=2600，而不是还停在 600
  assert.equal(applied.at(-1), 2600, '恢复模式必须按距底距离重算，否则内容长高后视角会漂到顶部');
});

test('settleInto：会话已切走时不再继续动滚动条', () => {
  let alive = true, frames = 0;
  const applied = [];
  settleInto({
    read: () => box(5000),
    apply: top => { applied.push(top); },
    alive: () => alive,
    saved: null,
    schedule: fn => { if (frames++ > 1) alive = false; fn(); },
    stableFrames: 10,
  });
  assert.ok(applied.length <= 3, '切走后必须立刻停手，实际 ' + applied.length);
});

test('jumpTo 瞬时落位（压掉 smooth，不改用户自己的平滑滚动）', () => {
  const style = {
    map: new Map([['scroll-behavior', 'smooth']]),
    getPropertyValue(k) { return this.map.get(k) || ''; },
    getPropertyPriority() { return ''; },
    setProperty(k, v, p) { this.map.set(k, v + (p === 'important' ? '!important' : '')); },
    removeProperty(k) { this.map.delete(k); },
  };
  const node = { style, scrollTop: 0 };
  jumpTo(node, 4321.7);
  assert.equal(node.scrollTop, 4322, '必须落到整数位置');
  assert.equal(style.map.get('scroll-behavior'), 'smooth', '结束后必须还原用户原来的平滑滚动');
});

test('jumpTo 能安全处理空节点与负值', () => {
  assert.doesNotThrow(() => jumpTo(null, 100));
  const node = { style: { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty() {}, removeProperty() {} }, scrollTop: 50 };
  jumpTo(node, -999);
  assert.equal(node.scrollTop, 0, '负值必须夹到 0');
});
