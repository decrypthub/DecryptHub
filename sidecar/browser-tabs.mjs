// Serialize user page selection; stale intent never overtakes a newer click.
export class BrowserTabs {
  constructor(session) { this.session = session; this.tail = Promise.resolve(); this.revision = 0; }
  lease() { const s = this.session; return [s.browser.generation, s.workspace?.id, s.workspace?.revision, s.workspace?.projectRevision, s.workspace?.root].join(':'); }
  select(pageId) {
    const revision = ++this.revision, lease = this.lease();
    const task = this.tail.catch(() => {}).then(async () => {
      const s = this.session;
      if (revision !== this.revision || lease !== this.lease() || s.closing) return { superseded: true };
      if (!s.browser.running) throw Error('浏览器尚未启动');
      const index = s.browser.snapshot.pages.findIndex(p => p.id === pageId);
      if (index < 0) throw Error('浏览器标签页已关闭');
      return s.browser.selectPage(index, pageId);
    });
    this.tail = task; return task;
  }
  close(pageId) {
    ++this.revision;
    const lease = this.lease();
    const task = this.tail.catch(() => {}).then(() => this.session.closing || lease !== this.lease() ? { superseded: true } : this.session.browser.closePage(pageId));
    this.tail = task; return task;
  }
  navigate(pageId, url) {
    const revision = ++this.revision, lease = this.lease();
    const task = this.tail.catch(() => {}).then(async () => {
      const s = this.session;
      if (revision !== this.revision || lease !== this.lease() || s.closing) return { superseded: true };
      if (pageId) {
        const index = s.browser.snapshot.pages.findIndex(p => p.id === pageId);
        if (index < 0) throw Error('浏览器标签页已关闭');
        if (!s.browser.snapshot.pages[index].active) await s.browser.selectPage(index, pageId);
        if (revision !== this.revision || lease !== this.lease() || s.closing) return { superseded: true };
        await s.browser.navigate(url);
      } else await s.browser.newPage(url);
      return s.browser.status();
    });
    this.tail = task; return task;
  }
}
