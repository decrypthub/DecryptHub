/** One reconnect-safe MCP observation and revision-checked settings writer. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { McpManagedServerView } from '@deepseek-ai/dsh-mcp-manager/types'
import type { McpProbeResult } from '@deepseek-ai/dsh-mcp-client/types'
import { z } from 'zod'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { mcpEntryJson, parseMcpEntry, type McpEntry } from './config.ts'

/** Operations use generated Remotes in the plugin body; components never receive a Context. */
export interface McpOperations {
  describe(this: void): Promise<SettingsDescribeValue>
  write(this: void, ops: SettingsPathOpView[], revision: number): Promise<SettingsNamespaceView>
  credential(this: void, ref: string, value: string): Promise<void>
  watch(this: void, signal: AbortSignal): AsyncIterable<McpManagedServerView[]>
  restart(this: void, name: string): Promise<void>
  probe(this: void, name: string, signal: AbortSignal): Promise<McpProbeResult>
}
/** Retained configuration and runtime observation, independent of transient editor state. */
export interface McpSnapshot {
  loaded: boolean
  writable: boolean
  namespace: SettingsNamespaceView | undefined
  entries: Record<string, McpEntry>
  servers: readonly McpManagedServerView[]
  failed: boolean
  busy: boolean
}

/** Shared page lifetime; late reads never replace newer settings or stream generations. */
export class McpSource {
  /** Stable framework-observed state. */
  readonly store = createSnapshotStore<McpSnapshot>({ loaded: false, writable: false, namespace: undefined,
    entries: {}, servers: [], failed: false, busy: false })
  private live = true
  private sequence = 0
  private stream: AbortController | undefined
  private readonly lifetime = new AbortController()
  private read: Promise<void> | undefined
  private probeLifetime: AbortController | undefined
  /** Initialize the owned management lifetime.
 * @param operations - authenticated settings, credentials and MCP Remotes. */
  constructor(private readonly operations: McpOperations) {}

  /** Load configuration and replace a broken stream on Host reconnect.
 * @returns after configuration refresh. */
  async load(): Promise<void> {
    if (!this.live) return
    if (this.stream === undefined || this.stream.signal.aborted) this.follow()
    if (this.read !== undefined) return this.read
    const sequence = ++this.sequence
    const read = this.operations.describe().then((description) => {
      if (!this.live || sequence !== this.sequence) return
      const namespace = description.namespaces.find(row => row.ns === 'mcp-manager')
      const parsed = z.object({ servers: z.record(z.string(), z.unknown()) }).safeParse(namespace?.value)
      const entries: Record<string, McpEntry> = {}
      if (parsed.success) for (const [name, value] of Object.entries(parsed.data.servers)) {
        const entry = parseMcpEntry(value)
        if (entry !== undefined) entries[name] = entry
      }
      this.store.set({ ...this.store.getSnapshot(), loaded: true, failed: false,
        writable: description.writable && namespace !== undefined, namespace, entries })
    }, () => {
      if (this.live && sequence === this.sequence) this.store.set({ ...this.store.getSnapshot(), loaded: true, failed: true })
    }).finally(() => { if (this.read === read) this.read = undefined })
    this.read = read
    return read
  }

  private follow(): void {
    const lifetime = this.stream = new AbortController()
    void (async () => {
      try {
        for await (const servers of this.operations.watch(lifetime.signal)) {
          if (!this.live || this.stream !== lifetime || lifetime.signal.aborted) break
          this.store.set({ ...this.store.getSnapshot(), servers, failed: false })
        }
        if (!lifetime.signal.aborted) throw new Error('MCP stream ended')
      } catch (_error) {
        if (this.live && this.stream === lifetime && !lifetime.signal.aborted) {
          lifetime.abort()
          this.store.set({ ...this.store.getSnapshot(), failed: true })
        }
      }
    })()
  }

  /** Reconnect the page observation after a transport reset. */
  reset(): void {
    if (this.stream === undefined && this.read === undefined) return
    this.stream?.abort(); this.stream = undefined; void this.refresh()
  }

  /** Discard an obsolete in-flight read, then fetch confirmed settings.
 * @returns after a fresh read. */
  async refresh(): Promise<void> { this.sequence++; await this.read; await this.load() }

  /**
   * Save only the reviewed named entries; literal env/header values are stored as credential references first.
   * @param entries - new or edited entries, keyed by name.
   * @param revision - settings revision captured by the editor.
   * @returns after confirmed persistence and refresh; rejects conflicts without discarding the editor.
   */
  async save(entries: Record<string, McpEntry>, revision: number): Promise<void> {
    await this.mutate(async () => {
      const ops: SettingsPathOpView[] = []
      for (const [name, entry] of Object.entries(entries)) {
        const prepared = { ...entry }
        for (const field of ['env', 'headers'] as const) {
          if (entry[field] === undefined) continue
          const values: [string, string][] = []
          for (const [key, value] of Object.entries(entry[field])) {
            if (value === '' || value.includes('${credential:')) values.push([key, value])
            else {
              const ref = `MCP_${randomUUID().replaceAll('-', '_').toUpperCase()}`
              await this.operations.credential(ref, value)
              values.push([key, `\${credential:${ref}}`])
            }
          }
          prepared[field] = Object.fromEntries(values)
        }
        ops.push({ op: 'set', path: ['servers', name], value: mcpEntryJson(prepared) })
      }
      await this.operations.write(ops, revision)
    })
  }

  /** Persist the requested server enablement.
 * @param name - configured server.
 * @param enabled - persisted intent.
 * @param revision - captured settings revision. */
  async enable(name: string, enabled: boolean, revision: number): Promise<void> {
    await this.mutate(async () => { await this.operations.write([{ op: 'set', path: ['servers', name, 'enabled'], value: enabled }], revision) })
  }

  /** Remove the user override for a server.
 * @param name - user-owned entry; inherited entries are restored, never silently deleted.
 * @param revision - captured revision. */
  async remove(name: string, revision: number): Promise<void> {
    await this.mutate(async () => { await this.operations.write([{ op: 'unset', path: ['servers', name] }], revision) })
  }

  /** Request a fresh server connection.
 * @param name - server whose reconnect budget is reset. */
  async restart(name: string): Promise<void> { await this.mutate(async () => { await this.operations.restart(name) }) }

  /** Inspect the server without registering another tool generation.
 * @param name - server to inspect without registering another tool generation.
 * @returns actual negotiated tools and cleanup outcome. */
  probe(name: string): Promise<McpProbeResult> {
    this.probeLifetime?.abort()
    this.probeLifetime = new AbortController()
    return this.operations.probe(name, AbortSignal.any([this.lifetime.signal, this.probeLifetime.signal]))
  }

  /** Cancel an inspection when its dialog closes. */
  cancelProbe(): void { this.probeLifetime?.abort() }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    if (!this.live || this.store.getSnapshot().busy) throw new Error('mcp-busy')
    this.store.set({ ...this.store.getSnapshot(), busy: true })
    try { await operation(); await this.refresh() }
    finally { if (this.isLive()) this.store.set({ ...this.store.getSnapshot(), busy: false }) }
  }
  private isLive(): boolean { return this.live }
  /** Retire pending reads, probes and the runtime stream. */
  dispose(): void { this.live = false; this.sequence++; this.stream?.abort(); this.lifetime.abort() }
}
