/** One native account observation shared by Settings and its sidebar launcher. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CommunityAccountBridge, CommunityAccountSnapshot } from '../types.ts'

/** Transient command state is separate from authoritative native identity. */
export interface CommunityAccountView {
  readonly state?: CommunityAccountSnapshot
  readonly busy: boolean
  readonly failed: boolean
}
/** Native subscription with monotonic snapshots and disposal-safe command settlement. */
export class CommunityAccountSource {
  /** Stable account observation used by the renderer's bound hooks. */
  readonly store = createSnapshotStore<CommunityAccountView>({ busy: false, failed: false })
  private live = true
  private readonly unsubscribe: () => void

  /** @param bridge - credential-free, main-frame-only native operations. */
  constructor(private readonly bridge: CommunityAccountBridge) {
    this.unsubscribe = bridge.subscribe((state) => { this.receive(state) })
    void bridge.get().then((state) => { this.receive(state) }, () => {
      if (this.store.getSnapshot().state === undefined) this.fail()
    })
  }

  private receive(state: CommunityAccountSnapshot): void {
    const current = this.store.getSnapshot()
    if (!this.live || (current.state !== undefined && state.revision < current.state.revision)) return
    this.store.set({ ...current, state, failed: false })
  }

  private fail(): void {
    if (this.live) this.store.set({ ...this.store.getSnapshot(), failed: true })
  }

  /** Run one native command while retaining the last confirmed identity.
   * @param command - fixed native account operation. @returns after native state settles.
   */
  async run(command: 'start' | 'refresh' | 'cancel' | 'signOut'): Promise<void> {
    if (!this.live || this.store.getSnapshot().busy) return
    this.store.set({ ...this.store.getSnapshot(), busy: true, failed: false })
    try { this.receive(await this.bridge[command]()) }
    catch (_error) { this.fail() }
    finally { if (this.isLive()) this.store.set({ ...this.store.getSnapshot(), busy: false }) }
  }

  /** Open a native-owned community destination and report launch failure locally.
   * @param page - fixed community destination. @returns after native browser launch.
   */
  async open(page: 'community' | 'points' | 'authorize'): Promise<void> {
    try { await this.bridge.open(page) }
    catch (_error) { this.fail() }
  }

  /** Detach native events and ignore late reads. */
  dispose(): void { this.live = false; this.unsubscribe() }

  private isLive(): boolean { return this.live }
}
