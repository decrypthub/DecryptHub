/** Official component observations share a lifetime with their connection catalog. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentId, ComponentsSnapshot, OfficialConfiguration } from '@deepseek-ai/dsh-decrypthub-components/types'
import type { McpManagedServerView } from '@deepseek-ai/dsh-mcp-manager/types'

/** Authenticated actions assembled from generated Remotes. */
export interface ComponentsOperations {
  watch(signal: AbortSignal): AsyncIterable<ComponentsSnapshot>
  connections(signal: AbortSignal): AsyncIterable<McpManagedServerView[]>
  snapshot(): Promise<ComponentsSnapshot>
  checkUpdates(): Promise<unknown>
  install(id: ComponentId, version: string): Promise<unknown>
  cancel(id: ComponentId): Promise<unknown>
  rollback(id: ComponentId): Promise<unknown>
  configure(id: ComponentId, config: OfficialConfiguration): Promise<unknown>
  reconnect(id: ComponentId): Promise<unknown>
  inspectBrowser(): Promise<unknown>
  installBrowser(accepted: boolean): Promise<unknown>
}
/** Retained state distinguishes observation failures from known installation facts. */
export interface ComponentsState {
  value: ComponentsSnapshot | null
  connections: readonly McpManagedServerView[]
  failed: boolean
  connectionFailed: boolean
  busy: boolean
}
/** One owner for streams and commands across the settings and main-panel entries. */
export class ComponentsSource {
  /** Framework-observed page state. */
  readonly store = createSnapshotStore<ComponentsState>({ value: null, connections: [],
    failed: false, connectionFailed: false, busy: false })
  private lifetime: AbortController | undefined
  private live = true
  /** Create the page source with explicit remote capabilities.
   * @param operations - component and connection Remotes.
   */
  constructor(private readonly operations: ComponentsOperations) {}

  /** Start one component stream and one MCP catalog stream. */
  load(): void {
    if (!this.live || this.lifetime !== undefined) return
    const controller = this.lifetime = new AbortController()
    const active = (): boolean => this.live && this.lifetime === controller && !controller.signal.aborted
    void (async () => {
      try {
        for await (const value of this.operations.watch(controller.signal)) {
          if (!active()) return
          this.store.set({ ...this.store.getSnapshot(), value, failed: false })
        }
        if (active()) throw new Error('Component stream ended')
      } catch (_error) { if (active()) this.store.set({ ...this.store.getSnapshot(), failed: true }) }
    })()
    void (async () => {
      try {
        for await (const connections of this.operations.connections(controller.signal)) {
          if (!active()) return
          this.store.set({ ...this.store.getSnapshot(), connections, connectionFailed: false })
        }
        if (active()) throw new Error('Connection stream ended')
      } catch (_error) { if (active()) this.store.set({ ...this.store.getSnapshot(), connectionFailed: true }) }
    })()
  }

  /** Replace both observations after a transport reset or an explicit retry. */
  reset(): void {
    if (this.lifetime === undefined) return
    this.lifetime.abort(); this.lifetime = undefined; this.load()
  }

  /** Perform a user action without losing previously observed data on failure.
   * @param command - operation selected by the user.
   * @returns after command acceptance; installation progress arrives through watch.
   */
  async run(command: (operations: ComponentsOperations) => Promise<unknown>): Promise<void> {
    if (!this.live || this.store.getSnapshot().busy) throw new Error('Component action already pending')
    this.store.set({ ...this.store.getSnapshot(), busy: true })
    try { await command(this.operations) }
    finally { this.finish() }
  }
  private finish(): void { if (this.live) this.store.set({ ...this.store.getSnapshot(), busy: false }) }

  /** Retire observations when the plugin leaves. */
  dispose(): void { this.live = false; this.lifetime?.abort() }
}
