/** One settings-namespace observation and revision-checked writer for product memory. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** Settings namespace that stores product memory entries. */
export const MEMORY_NS = 'product-memory'

/** One stored entry as the page renders it. */
export interface MemoryEntryView {
  text: string
  scope: string
  /** ISO-8601 creation stamp owned by the namespace; preserved on rewrite. */
  createdAt?: string
  /** ISO-8601 last-write stamp owned by the namespace. */
  updatedAt?: string
}

/** Retained memory configuration, independent of transient editor state. */
export interface MemorySnapshot {
  loaded: boolean
  failed: boolean
  revision: number
  entries: Record<string, MemoryEntryView>
}

/** Operations the plugin body supplies; components never receive a Context. */
export interface MemoryOperations {
  describe(this: void): Promise<SettingsDescribeValue>
  write(this: void, ops: SettingsPathOpView[], revision: number): Promise<SettingsNamespaceView>
}

/** Page lifetime for one mounted settings section. */
export class MemorySource {
  /** Stable framework-observed state. */
  readonly store = createSnapshotStore<MemorySnapshot>({ loaded: false, failed: false, revision: 0, entries: {} })
  private live = true
  private sequence = 0

  /**
   * Initialize the owned page lifetime.
   * @param operations - authenticated settings Remotes.
   */
  constructor(private readonly operations: MemoryOperations) {}

  /**
   * Read the namespace and publish its entries.
   * @returns after the state settles.
   */
  async load(): Promise<void> {
    if (!this.live) return
    const sequence = ++this.sequence
    try {
      const description = await this.operations.describe()
      if (sequence !== this.sequence) return
      const namespace = description.namespaces.find(row => row.ns === MEMORY_NS)
      const value = namespace?.value as { entries?: Record<string, MemoryEntryView> } | undefined
      this.store.set({
        loaded: true,
        failed: false,
        revision: namespace?.revision ?? 0,
        entries: value?.entries ?? {},
      })
    } catch {
      if (sequence !== this.sequence) return
      this.store.set({ ...this.store.getSnapshot(), loaded: true, failed: true })
    }
  }

  /**
   * Store one entry, then re-read the namespace so revisions stay authoritative.
   * @param text - remembered fact.
   * @param scope - `user` or `project`.
   * @param id - existing entry id to replace; a new id is minted when omitted.
   * @returns after the namespace reloads.
   */
  async put(text: string, scope: string, id?: string): Promise<void> {
    const now = new Date().toISOString()
    const key = id ?? randomUUID()
    const existing = this.store.getSnapshot().entries[key]
    await this.operations.write([{
      op: 'set',
      path: ['entries', key],
      value: { text, scope, createdAt: existing?.createdAt ?? now, updatedAt: now },
    }], this.store.getSnapshot().revision)
    await this.load()
  }

  /**
   * Delete one entry and re-read the namespace.
   * @param id - entry id to remove.
   * @returns after the namespace reloads.
   */
  async remove(id: string): Promise<void> {
    await this.operations.write([{ op: 'unset', path: ['entries', id] }], this.store.getSnapshot().revision)
    await this.load()
  }

  /** Stop publishing into a disposed page. */
  dispose(): void {
    this.live = false
    this.sequence += 1
  }
}
