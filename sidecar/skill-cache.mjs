// Bounded root observations with stable-write invalidation and owned teardown.
import chokidar from 'chokidar';
export class SkillCatalogCache {
  constructor(changed = () => {}) { this.roots = new Map(); this.changed = changed; }
  read(root, scan) {
    let entry = this.roots.get(root);
    if (!entry) {
      entry = { value: null, healthy: false };
      entry.watcher = chokidar.watch(root, { persistent: false, ignoreInitial: true, depth: 1, followSymlinks: false, atomic: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 } });
      entry.watcher.on('ready', () => { entry.healthy = true; entry.value = null; });
      entry.watcher.on('all', () => { entry.value = null; this.changed(); });
      entry.watcher.on('error', () => { entry.healthy = false; entry.value = null; this.changed(); });
    }
    this.roots.delete(root); this.roots.set(root, entry);
    while (this.roots.size > 128) { const [key, old] = this.roots.entries().next().value; this.roots.delete(key); void old.watcher.close(); }
    if (!entry.healthy || !entry.value) entry.value = scan();
    return entry.value.map(value => ({ ...value }));
  }
  invalidate() { for (const entry of this.roots.values()) entry.value = null; }
  async close() { const entries = [...this.roots.values()]; this.roots.clear(); await Promise.all(entries.map(entry => entry.watcher.close())); }
}
