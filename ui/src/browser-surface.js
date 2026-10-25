// Native presentation has one owner. A late show cannot overtake the hide/new
// session after it. CDP control and browser processes are independent of this view.
export class BrowserSurface {
  constructor(adapter) { this.adapter = adapter; this.revision = 0; this.tail = Promise.resolve(); this.desired = null; }
  enqueue(operation) { const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result; }
  show(spec) {
    const revision = ++this.revision; this.desired = spec;
    return this.enqueue(async () => {
      if (revision !== this.revision) return { state: 'superseded' };
      try { await this.adapter.show(spec); }
      catch (error) { if (revision !== this.revision) return { state: 'superseded' }; throw error; }
      return { state: revision === this.revision ? 'visible' : 'superseded' };
    });
  }
  hide() {
    const revision = ++this.revision; this.desired = null;
    return this.enqueue(async () => { if (revision !== this.revision) return { state: 'superseded' }; await this.adapter.hide(); return { state: 'hidden' }; });
  }
  release(sessionId) {
    if (this.desired?.sessionId === sessionId) { this.revision++; this.desired = null; }
    return this.enqueue(() => this.adapter.release(sessionId));
  }
}
