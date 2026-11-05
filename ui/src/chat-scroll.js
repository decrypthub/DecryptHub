// One owner for transcript movement. Reading input is sampled before content
// growth may follow again (DSH use-chat-reading/use-chat-viewport).
export const BOTTOM_TOLERANCE = 24;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const escapeId = value => typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
export class ChatScroll {
  constructor() {
    this.following = true; this.anchor = null; this.el = null; this.pending = false; this.sampleTimer = null;
    this.lastTop = 0; this.programmaticTop = null; this.readerEngaged = false; this.initialized = false;
    this.handleIntent = event => {
      if (event?.type === 'keydown' && (!SCROLL_KEYS.has(event.key) || event.defaultPrevented || event.target?.closest?.('input,textarea,[contenteditable="true"]'))) return;
      this.pending = true; this.readerEngaged = true;
      clearTimeout(this.sampleTimer); this.sampleTimer = setTimeout(() => this.sampleReader(), 500);
    };
    this.handleScroll = () => {
      const box = this.box(); if (!box) return;
      if (!this.pending && this.programmaticTop !== null && Math.abs(box.scrollTop - this.programmaticTop) < 1) { this.programmaticTop = null; return; }
      this.programmaticTop = null;
      if (this.pending || this.readerEngaged) {
        if (Math.abs(box.scrollTop - this.floorOf(box)) < 1) { this.following = true; this.sampleReader(); }
        else { clearTimeout(this.sampleTimer); this.sampleTimer = setTimeout(() => this.sampleReader(), 500); }
      } else if (this.following) this.contentGrew();
      else if (Math.abs(box.scrollTop - this.lastTop) > 0.5) {
        this.pending = true;
        if (this.isAtBottom(box)) this.sampleReader();
        else { clearTimeout(this.sampleTimer); this.sampleTimer = setTimeout(() => this.sampleReader(), 500); }
      }
    };
    this.handleEnd = () => this.sampleReader();
  }
  attach(el, { onUserMove, content } = {}) {
    this.detach(); this.el = el; this.onUserScroll = onUserMove; this.lastTop = el.scrollTop;
    el.addEventListener('scroll', this.handleScroll, { passive: true });
    el.addEventListener('scrollend', this.handleEnd, { passive: true });
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'beforematch']) el.addEventListener(type, this.handleIntent, { passive: true, capture: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { if (this.el === el && this.initialized) this.contentGrew(); });
      this.observer.observe(el);
      if (content) this.observer.observe(content);
    }
  }
  detach() {
    clearTimeout(this.sampleTimer); this.sampleTimer = null; this.observer?.disconnect(); this.observer = null;
    if (this.el) {
      this.el.removeEventListener('scroll', this.handleScroll); this.el.removeEventListener('scrollend', this.handleEnd);
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'beforematch']) this.el.removeEventListener(type, this.handleIntent, true);
    }
    this.el = null; this.onUserScroll = null; this.pending = false; this.readerEngaged = false; this.following = true; this.anchor = null; this.initialized = false;
  }
  sampleReader() {
    clearTimeout(this.sampleTimer); this.sampleTimer = null;
    const box = this.box(); if (!box || !this.pending && !this.readerEngaged) return;
    const moved = Math.abs(box.scrollTop - this.lastTop) > 0.5;
    this.pending = false; this.readerEngaged = false;
    if (moved) this.following = this.isAtBottom(box);
    this.lastTop = box.scrollTop;
    this.anchor = this.following ? null : this.captureAnchor(box);
    this.onUserScroll?.();
    if (this.following) this.contentGrew();
  }
  get isFollowing() { return this.following && !this.pending; }
  get currentAnchor() { return this.anchor; }
  pauseFollowing() {
    clearTimeout(this.sampleTimer); this.sampleTimer = null; this.pending = false; this.readerEngaged = false;
    this.following = false; this.programmaticTop = null; this.anchor = this.captureAnchor(); this.onUserScroll?.();
  }
  box() { return this.el ? { scrollTop: this.el.scrollTop, scrollHeight: this.el.scrollHeight, clientHeight: this.el.clientHeight } : null; }
  floorOf(box) { return Math.max(0, box.scrollHeight - box.clientHeight); }
  isAtBottom(box) { return Math.abs(this.floorOf(box) - box.scrollTop) <= BOTTOM_TOLERANCE; }
  land(top) {
    if (!this.el) return 0;
    const target = Math.max(0, Math.min(this.floorOf(this.box()), top));
    if (Math.abs(this.el.scrollTop - target) > 0.5) this.el.scrollTop = target;
    this.lastTop = this.el.scrollTop; this.programmaticTop = this.lastTop;
    return this.lastTop;
  }
  captureAnchor(box = this.box()) {
    if (!this.el || !box) return null;
    const nodes = [...this.el.querySelectorAll('[data-turn-id]')], edge = this.el.getBoundingClientRect().top;
    const node = nodes.find(item => item.getBoundingClientRect().bottom > edge + 1) || nodes.at(-1);
    return node?.dataset.turnId ? { turnId: node.dataset.turnId, offset: Math.max(0, Math.round(edge - node.getBoundingClientRect().top)) } : null;
  }
  resolveAnchor(anchor) {
    const node = this.el?.querySelector(`[data-turn-id="${escapeId(anchor.turnId)}"]`);
    return node ? node.getBoundingClientRect().top - this.el.getBoundingClientRect().top + this.el.scrollTop + anchor.offset : null;
  }
  follow() {
    clearTimeout(this.sampleTimer); this.sampleTimer = null; this.pending = false; this.readerEngaged = false;
    this.initialized = true; this.following = true; this.anchor = null;
    if (this.el) this.land(this.floorOf(this.box()));
    return this.landing();
  }
  restore(anchor) {
    if (!anchor) return this.follow();
    const top = this.resolveAnchor(anchor); if (top === null) return this.follow();
    this.initialized = true; this.land(top); this.following = this.isAtBottom(this.box()); this.anchor = this.following ? null : anchor;
    return this.landing();
  }
  contentGrew() {
    if (!this.el || !this.initialized || !this.following || this.pending) return false;
    this.land(this.floorOf(this.box())); return true;
  }
  jumpToTurn(turnId, { atBottom = false } = {}) {
    if (atBottom) return this.follow();
    const top = this.resolveAnchor({ turnId, offset: 0 }); if (top === null) return null;
    this.pauseFollowing(); this.land(top - 12); this.anchor = this.captureAnchor(); return this.landing();
  }
  landing() { const box = this.box(); return box ? { top: box.scrollTop, floor: this.floorOf(box), atBottom: this.isAtBottom(box), anchor: this.anchor } : { top: 0, floor: 0, atBottom: true, anchor: null }; }
  metrics() { const box = this.box(); return box ? { ...this.landing(), height: box.clientHeight } : null; }
}
export function normalizeAnchor(value) {
  if (!value || typeof value.turnId !== 'string' || !value.turnId || value.turnId.length > 200 || !Number.isFinite(Number(value.offset)) || Number(value.offset) < 0) return null;
  return { turnId: value.turnId, offset: Math.round(Number(value.offset)) };
}
