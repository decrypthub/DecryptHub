// 对话滚动：**唯一**一处读写 .msgs 滚动位置的地方。
//
// 为什么要重写（2026-11-02）：旧实现把滚动散在 bus.jsx(20 处) + scroll-stick.js(28 处)
// + turn-navigator.jsx(7 处)，多个 useEffect 同时抢着写 scrollTop，互相覆盖。
// 「打开会话停在顶部」改了 6 轮都没修好，因为每修一层就被另一层改回去——
// 这是典型的屎山结构：不是某一行写错，是**没有所有权**。
//
// 设计参考 DSH `ui-chat/chat/use-chat-viewport.ts` + `use-chat-reading.ts`：
//   1. **单一所有者**：所有滚动动作都是本类的方法；外部只调方法，不直接碰 scrollTop。
//   2. **跟随意图是显式状态**（following），不靠「距底像素」反推——几何量会被内容高度变化骗到。
//   3. **保存位置用语义锚点**（第几轮 + 该轮内偏移），不用绝对 scrollTop。
//      内容变长/压缩后仍能回到同一处；像素值必然漂。
//   4. **贴底时清空位置**：跟随尾部意味着"我不需要记住任何位置"。
//
// 与 DSH 的取舍：DSH 的 921 行里约 400 行在处理折叠动画的逐帧补偿（spacer / fold driver），
// 那套是为它自己的「输入折叠」交互服务的。我们没有那个交互，不需要照搬——
// 但**所有权、显式意图、语义锚点**这三条是结构性的，必须一致。

/** 判为「已在底部」的容差。比旧实现（160）小得多：160 会把「已上翻但接近底部」误判成贴底。 */
export const BOTTOM_TOLERANCE = 24;

/** CSS.escape 的兜底：turnId 只含安全字符时也走这里，避免老内核没有 CSS.escape。 */
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

/**
 * 一个滚动容器的唯一控制器。
 *
 * 生命周期：
 *   attach(el)     → 绑定容器与事件
 *   restore(anchor)→ 进入会话时落位（有锚点回锚点，否则贴底）
 *   contentGrew()  → 内容变化后调用（仅跟随态才动）
 *   jumpToTurn()   → 用户点索引
 *   detach()       → 解绑
 *
 * 外部**不应该**再直接写 el.scrollTop。
 */
export class ChatScroll {
  constructor() {
    this.el = null;
    /** 是否跟随尾部。唯一决定「内容长高要不要跟着滚」的状态。 */
    this.following = true;
    /** 已提交的阅读锚点；null 表示"在底部，无需记忆"。 */
    this.anchor = null;
    /** 程序化滚动期间忽略自身触发的 scroll 事件，避免把贴底动作误判成用户上翻。 */
    /** 用户是否已经主动介入（滚轮/触摸/键盘）。介入后不再自动抢位置。 */
    this.readerEngaged = false;
    this.onUserScroll = null;
    /** 最近一次程序化写入的目标位置；scrollTop 仍等于它时，说明那次事件是自己触发的。 */
    this.programmaticTop = null;
    this.handleScroll = () => {
      const box = this.box();
      if (!box) return;
      // 忽略自己触发的那一次：位置仍停在我写入的值上。
      if (this.programmaticTop !== null && Math.abs(box.scrollTop - this.programmaticTop) < 1) {
        this.programmaticTop = null;
        return;
      }
      this.programmaticTop = null;
      if (this.isAtBottom(box)) {
        // 回到/停在底部：恢复跟随，并清空锚点（贴底不需要记忆位置）。
        this.following = true;
        this.anchor = null;
        this.readerEngaged = false;
      } else if (this.readerEngaged) {
        // 用户把视图挪离了底部：停止跟随，记下他从哪一轮开始读。
        this.following = false;
        this.anchor = this.captureAnchor(box);
      }
      this.onUserScroll?.();
    };
    this.handleIntent = () => { this.readerEngaged = true; };
  }

  /** 绑定滚动容器；会接管滚动事件。 */
  attach(el, { onUserMove } = {}) {
    this.detach();
    this.el = el;
    this.onUserScroll = onUserMove ?? null;
    el.addEventListener('scroll', this.handleScroll, { passive: true });
    // 用户的真实手势：一旦发生，就说明他要自己控制视口。
    for (const type of ['wheel', 'touchstart', 'keydown']) {
      el.addEventListener(type, this.handleIntent, { passive: true, capture: true });
    }
  }

  detach() {
    const el = this.el;
    if (el) {
      el.removeEventListener('scroll', this.handleScroll);
      for (const type of ['wheel', 'touchstart', 'keydown']) {
        el.removeEventListener(type, this.handleIntent, true);
      }
    }
    this.el = null;
    this.onUserScroll = null;
    this.readerEngaged = false;
    this.following = true;
    this.anchor = null;
  }

  /** 当前是否跟随尾部（外部据此决定内容变化后要不要调 contentGrew）。 */
  get isFollowing() { return this.following; }

  /** 当前锚点（null 表示贴底）。供持久化读取。 */
  get currentAnchor() { return this.anchor; }

  box() {
    const el = this.el;
    if (!el) return null;
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, style: el.style };
  }

  isAtBottom(box) {
    return box.scrollHeight - box.scrollTop - box.clientHeight <= BOTTOM_TOLERANCE;
  }

  floorOf(box) {
    return Math.max(0, box.scrollHeight - box.clientHeight);
  }

  /** 瞬时落位：压掉 scroll-behavior:smooth，避免"从顶部一路演到底"的观感。 */
  land(top) {
    const el = this.el;
    if (!el) return 0;
    const target = Math.min(Math.max(0, el.scrollHeight - el.clientHeight), Math.max(0, Math.round(top)));
    const style = el.style;
    const before = style.getPropertyValue('scroll-behavior');
    const priority = style.getPropertyPriority('scroll-behavior');
    // 记下"这次是我写的、写到了哪"，而不是靠计时器窗口。
    // 用 setTimeout 归零会有两个问题：同步代码里后续事件被误吞；
    // 而真实浏览器里 scroll 事件可能跨越多个宏任务才派发完。
    // 比对 scrollTop 是否仍等于我写入的值，天然只吞掉自己那一次。
    this.programmaticTop = target;
    style.setProperty('scroll-behavior', 'auto', 'important');
    try { el.scrollTop = target; this.programmaticTop = el.scrollTop; }
    finally {
      if (before) style.setProperty('scroll-behavior', before, priority);
      else style.removeProperty('scroll-behavior');
    }
    return el.scrollTop;
  }

  /** 把当前视口顶部对应的轮次与偏移记下来。 */
  captureAnchor(box = this.box()) {
    const el = this.el;
    if (!el || !box) return null;
    const turns = el.querySelectorAll('[data-turn-id]');
    if (!turns.length) return null;
    const viewportTop = el.getBoundingClientRect().top;
    // 第一个「底部仍在视口顶部之下」的轮次，就是当前正在读的那一轮。
    let chosen = null;
    for (const node of turns) {
      if (node.getBoundingClientRect().bottom > viewportTop + 1) { chosen = node; break; }
    }
    if (!chosen) chosen = turns[turns.length - 1];
    const id = chosen.dataset.turnId;
    if (!id) return null;
    const offset = Math.max(0, Math.round(viewportTop - chosen.getBoundingClientRect().top));
    return { turnId: id, offset };
  }

  /** 把某个锚点换算成 scrollTop。 */
  resolveAnchor(anchor) {
    const el = this.el;
    if (!el) return null;
    const node = el.querySelector(`[data-turn-id="${cssEscape(anchor.turnId)}"]`);
    if (!node) return null;
    const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    return Math.max(0, Math.round(delta - anchor.offset));
  }

  /** 贴底。跟随意图置真并清空锚点。 */
  follow() {
    const el = this.el;
    if (!el) return { top: 0, floor: 0, atBottom: true, anchor: null };
    this.following = true;
    this.anchor = null;
    this.readerEngaged = false;
    this.land(el.scrollHeight);
    const box = this.box();
    return { top: box.scrollTop, floor: this.floorOf(box), atBottom: this.isAtBottom(box), anchor: null };
  }

  /**
   * 进入会话时落位：有锚点回锚点，否则贴底。
   * @param {object|null|undefined} anchor 上次保存的阅读锚点；空表示上次在底部
   */
  restore(anchor) {
    const el = this.el;
    if (!el) return { top: 0, floor: 0, atBottom: true, anchor: null };
    if (!anchor) return this.follow();
    const target = this.resolveAnchor(anchor);
    if (target === null) return this.follow();
    this.land(target);
    const box = this.box();
    const atBottom = this.isAtBottom(box);
    this.following = atBottom;
    this.anchor = atBottom ? null : anchor;
    return { top: box.scrollTop, floor: this.floorOf(box), atBottom, anchor: this.anchor };
  }

  /** 内容高度变化后调用。只有跟随态才贴底——用户上翻过就不打扰。 */
  contentGrew() {
    if (!this.following) return false;
    const el = this.el;
    if (!el) return false;
    this.land(el.scrollHeight);
    return true;
  }

  /**
   * 跳到某一轮。
   * @param {string} turnId 目标轮的 data-turn-id
   * @param {{atBottom?:boolean}} options 该轮是否就是最后一轮（是则精确贴底）
   */
  jumpToTurn(turnId, { atBottom = false } = {}) {
    const el = this.el;
    if (!el) return null;
    if (atBottom) {
      const landing = this.follow();
      this.readerEngaged = false;
      return landing;
    }
    const anchor = { turnId, offset: 12 };
    const target = this.resolveAnchor(anchor);
    if (target === null) return null;
    this.following = false;
    this.anchor = anchor;
    this.readerEngaged = true;
    this.land(target);
    const box = this.box();
    const atBottomNow = this.isAtBottom(box);
    if (atBottomNow) { this.following = true; this.anchor = null; }
    return { top: box.scrollTop, floor: this.floorOf(box), atBottom: atBottomNow, anchor: this.anchor };
  }

  /** 当前滚动几何，便于外部断言或调试。 */
  metrics() {
    const box = this.box();
    if (!box) return null;
    return { top: box.scrollTop, floor: this.floorOf(box), height: box.clientHeight, atBottom: this.isAtBottom(box) };
  }
}

/** 锚点的持久化形状校验（读 localStorage 时用；旧数据里的像素值一律拒绝）。 */
export function normalizeAnchor(value) {
  if (!value || typeof value !== 'object') return null;
  const turnId = value.turnId;
  const offset = Number(value.offset);
  if (typeof turnId !== 'string' || !turnId || turnId.length > 200) return null;
  if (!Number.isFinite(offset) || offset < 0) return null;
  return { turnId, offset: Math.round(offset) };
}
