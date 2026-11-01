// 会话恢复后的滚动定位：重新打开 / 切换会话必须停在最后一条，而不是顶部。
//
// 这类问题依赖真实 layout（scrollHeight/clientHeight/scrollTop），假 DOM 测不出来，
// 所以用真实浏览器；判定逻辑直接 import 自 ui/src/scroll-stick.js，
// 确保测试验证的就是产品实际使用的那份代码。
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStick, settleInto, jumpTo } from '../../ui/src/scroll-stick.js';

const { chromium } = await import('@zhizhuodemao/patchright');

/** 复刻 key 变化导致的整容器重建，返回新的 .msgs。 */
const MOUNT_SRC = `(sid, count) => {
  const host = document.getElementById('host');
  host.innerHTML = '';
  const msgs = document.createElement('div');
  msgs.className = 'msgs';
  msgs.style.height = '400px';
  msgs.style.overflowY = 'auto';
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.style.height = '120px';
    d.textContent = sid + ' #' + i;
    msgs.appendChild(d);
  }
  host.appendChild(msgs);
  return msgs;
}`;

const APPEND_SRC = `(count) => {
  const msgs = document.querySelector('.msgs');
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.style.height = '120px';
    d.textContent = 'async #' + i;
    msgs.appendChild(d);
  }
  return msgs.children.length;
}`;

const atBottomOf = el => el.scrollHeight - el.scrollTop - el.clientHeight < 2;

test('重新打开会话时停在最后一条', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.WDH_TEST_EXECUTABLE ? { executablePath: process.env.WDH_TEST_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<div id="host"></div>');

  // 30 条消息，远超 400px 可视区
  const geo = await page.evaluate(({ MOUNT_SRC }) => {
    const msgs = eval(MOUNT_SRC)('session-A', 30);
    return { scrollTop: msgs.scrollTop, scrollHeight: msgs.scrollHeight, clientHeight: msgs.clientHeight };
  }, { MOUNT_SRC });
  assert.equal(geo.scrollTop, 0, '前提：容器初始在顶部');
  assert.ok(geo.scrollHeight > geo.clientHeight * 3, '前提：内容确实远超一屏');

  const state = { sid: null, settled: false };
  const decision = shouldStick(geo, state, 'session-A');
  assert.equal(decision.fresh, true, '首次进入该会话');
  assert.equal(decision.stick, true, '首次进入必须贴底（旧实现会因 scrollTop=0 而放弃）');

  // 落到真实 DOM 上
  const bottom = await page.evaluate(() => {
    const msgs = document.querySelector('.msgs');
    msgs.scrollTop = msgs.scrollHeight;
    return msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight;
  });
  assert.ok(bottom < 2, '贴底后距底部应接近 0，实际 ' + bottom);
});

test('切换会话后也贴底，即使用户在上一个会话里翻到了顶部', async t => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.WDH_TEST_EXECUTABLE ? { executablePath: process.env.WDH_TEST_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<div id="host"></div>');

  const result = await page.evaluate(({ MOUNT_SRC }) => {
    const mount = eval(MOUNT_SRC);
    const a = mount('session-A', 30);
    a.scrollTop = 0;                       // 用户在 A 里读到顶部
    const b = mount('session-B', 25);      // 切到 B：整容器重建
    return { zeroed: b.scrollTop === 0, box: { scrollHeight: b.scrollHeight, scrollTop: b.scrollTop, clientHeight: b.clientHeight } };
  }, { MOUNT_SRC });
  assert.equal(result.zeroed, true, '前提：切换会话时滚动位置归零');

  // A 的状态已 settled，但 B 是全新上下文 → 必须重新强制贴底
  const state = { sid: 'session-A', settled: true };
  const decision = shouldStick(result.box, state, 'session-B');
  assert.equal(decision.fresh, true, '换会话是新上下文');
  assert.equal(decision.stick, true, '切换后必须贴底');
});

test('异步历史分批到达后仍然贴底', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.WDH_TEST_EXECUTABLE ? { executablePath: process.env.WDH_TEST_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<div id="host"></div>');

  // 首屏只有 3 条（未撑满），随后 28 条异步补上 —— 这正是原来失败的场景
  const r = await page.evaluate(({ MOUNT_SRC, APPEND_SRC }) => {
    const mount = eval(MOUNT_SRC);
    const append = eval(APPEND_SRC);
    const msgs = mount('session-C', 3);
    const before = { scrollHeight: msgs.scrollHeight, clientHeight: msgs.clientHeight };
    const total = append(28);
    return { total, before, after: msgs.scrollHeight, box: { scrollHeight: msgs.scrollHeight, scrollTop: msgs.scrollTop, clientHeight: msgs.clientHeight } };
  }, { MOUNT_SRC, APPEND_SRC });
  assert.equal(r.total, 31);
  assert.ok(r.after > r.before.scrollHeight, '前提：异步追加后总高度变大');

  // 首屏时可能"已在底部"，但内容长大后就不再是。fresh 必须仍然强制贴底。
  const state = { sid: null, settled: false };
  const decision = shouldStick(r.box, state, 'session-C');
  assert.equal(decision.stick, true, '历史到达后必须重新贴底，而不是停留在中间');
});

test('用户往上翻时新消息不打扰阅读', () => {
  // 已 settle、且明显不在底部
  const box = { scrollHeight: 5000, scrollTop: 200, clientHeight: 400 };
  const state = { sid: 'session-C', settled: true };
  const decision = shouldStick(box, state, 'session-C');
  assert.equal(decision.fresh, false);
  assert.equal(decision.stick, false, '用户正在阅读旧内容时不该拽回底部');
});

test('用户停在底部时新消息继续跟随', () => {
  const box = { scrollHeight: 5000, scrollTop: 4620, clientHeight: 400 }; // 距底 20px
  const state = { sid: 'session-C', settled: true };
  assert.equal(shouldStick(box, state, 'session-C').stick, true, '贴着底部时应当跟随新消息');
});

test('settleInto 在高度稳定后才回调 settled', () => {
  let height = 1000;
  let settled = false;
  const queue = [];
  settleInto({
    read: () => ({ scrollHeight: height, clientHeight: 400, scrollTop: 0 }),
    apply: () => {},
    alive: () => true,
    saved: null,
    schedule: fn => queue.push(fn),
    onSettled: () => { settled = true; },
    stableFrames: 3,
  });
  // 高度持续变化（历史仍在到达）时不应急于认定
  queue.shift()(); height = 1400;
  assert.equal(settled, false, '高度还在变，不能提前 settled');
  queue.shift()(); height = 1800;
  assert.equal(settled, false);
  // 连续 3 帧高度不变才认定
  queue.shift()();
  queue.shift()();
  queue.shift()();
  assert.equal(settled, true, '高度稳定后应 settled');
});

test('settleInto 在会话已切换时停止', () => {
  let calls = 0;
  let settled = false;
  const queue = [];
  settleInto({
    read: () => { calls++; return { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 }; },
    apply: () => {},
    alive: () => false,          // 已切走
    saved: null,
    schedule: fn => queue.push(fn),
    onSettled: () => { settled = true; },
    stableFrames: 3,
  });
  queue.shift()();
  assert.equal(settled, false, '切走后不该继续 settle');
  assert.equal(calls, 1, '切走后不该再读 DOM（首次读取一次）');
});

test('jumpTo 在 scroll-behavior: smooth 下瞬时落位', { timeout: 120000 }, async t => {
  // 回归：.msgs 带 smooth，直接写 scrollTop 会被当作平滑滚动请求，
  // 用户看到整段对话从顶部一路滚到底部（内容越长动画越久）。
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.WDH_TEST_EXECUTABLE ? { executablePath: process.env.WDH_TEST_EXECUTABLE } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<div id="host"></div>');

  await page.evaluate(({ MOUNT_SRC }) => {
    const msgs = eval(MOUNT_SRC)('session-smooth', 40);
    msgs.style.scrollBehavior = 'smooth';
  }, { MOUNT_SRC });

  // 先证明直接赋值确实会动画（否则这条回归测试就没有意义）
  const direct = await page.evaluate(async () => {
    const msgs = document.querySelector('.msgs');
    msgs.scrollTop = msgs.scrollHeight;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return msgs.scrollTop;
  });
  assert.ok(direct < 100, '前提：smooth 下直接赋值会从顶部开始动画，实际 scrollTop=' + direct);

  const jumped = await page.evaluate(async ({ src }) => {
    const jumpTo = new Function('return (' + src + ')')();
    const msgs = document.querySelector('.msgs');
    msgs.scrollTop = 0;
    const style = getComputedStyle(msgs);
    jumpTo(msgs, msgs.scrollHeight);
    const immediate = msgs.scrollTop;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { immediate, later: msgs.scrollTop, bottom: msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight, behaviorKept: getComputedStyle(msgs).scrollBehavior === style.scrollBehavior };
  }, { src: jumpTo.toString() });

  assert.ok(jumped.immediate > 1000, 'jumpTo 必须立刻落到目标位置，实际 ' + jumped.immediate);
  assert.ok(jumped.later > 1000, '落位后不应再继续动画，实际 ' + jumped.later);
  assert.ok(Math.abs(jumped.bottom) < 2, '应停在与目标一致的位置，距底 ' + jumped.bottom);
  assert.equal(jumped.behaviorKept, true, '落位后应恢复原来的 scroll-behavior，不能改掉作者的样式');
});
