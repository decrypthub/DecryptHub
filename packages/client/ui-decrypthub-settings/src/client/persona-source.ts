/** One settings-namespace observation and revision-checked writer for the role definition. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'

/** Settings namespace that stores the role definition. */
export const PERSONA_NS = 'product-persona'

/** Retained role text, independent of transient editor state. */
export interface PersonaSnapshot {
  loaded: boolean
  failed: boolean
  revision: number
  persona: string
}

/** Operations the plugin body supplies. */
export interface PersonaOperations {
  describe(this: void): Promise<SettingsDescribeValue>
  write(this: void, ops: SettingsPathOpView[], revision: number): Promise<SettingsNamespaceView>
}

/** Page lifetime for the role section. */
export class PersonaSource {
  /** Stable framework-observed state. */
  readonly store = createSnapshotStore<PersonaSnapshot>({ loaded: false, failed: false, revision: 0, persona: '' })
  private sequence = 0

  /**
   * Initialize the owned page lifetime.
   * @param operations - authenticated settings Remotes.
   */
  constructor(private readonly operations: PersonaOperations) {}

  /**
   * Read the namespace and publish the role text.
   * @returns after the state settles.
   */
  async load(): Promise<void> {
    const sequence = ++this.sequence
    try {
      const description = await this.operations.describe()
      if (sequence !== this.sequence) return
      const namespace = description.namespaces.find(row => row.ns === PERSONA_NS)
      const value = namespace?.value as { persona?: string } | undefined
      this.store.set({ loaded: true, failed: false, revision: namespace?.revision ?? 0, persona: value?.persona ?? '' })
    } catch {
      if (sequence !== this.sequence) return
      this.store.set({ ...this.store.getSnapshot(), loaded: true, failed: true })
    }
  }

  /**
   * Persist the role text, then re-read the namespace so the revision stays current.
   * @param persona - role text to store.
   * @returns after the namespace reloads.
   */
  async save(persona: string): Promise<void> {
    await this.operations.write([{ op: 'set', path: ['persona'], value: persona }], this.store.getSnapshot().revision)
    await this.load()
  }

  /** Stop publishing into a disposed page. */
  dispose(): void {
    this.sequence += 1
  }
}
