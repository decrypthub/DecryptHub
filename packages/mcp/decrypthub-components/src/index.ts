/** Official component catalog, verified installation and connection observations. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import Schema from '@deepseek-ai/schemastery'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { componentExecutable, componentIds, ComponentFiles, probeCommandVersion } from './files.ts'
import { defaultHarnessHome, previewHarnessImport, runHarnessImport, type AdoptedGroups, type ImportedWorkspace } from './harness-import.ts'
import { componentFeedBaseUrl, downloadComponent, fetchComponentRelease, fetchFeedRelease, type ComponentRelease } from './releases.ts'
import { extractComponentZip } from './zip.ts'
import type { ComponentId, ComponentOperation, ComponentsSnapshot, ImportItem, ImportKind, ImportResult, InstalledComponent, WdhConnectionView } from './types.ts'
import type { McpConnectionStatus } from '@deepseek-ai/dsh-mcp-client/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-mcp-manager'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { BrowserKernelView } from './types.ts'
import { probeTools } from './tool-probe.ts'
import { parseInventory } from './inventory.ts'
import type { ChatTargetChoice, ChatTargetView, ComponentInventory } from './types.ts'
import { chatTargetDomain, type ChatTargetBinding } from './chat-targets.ts'
import { readWdhCaptureDetail, readWdhCaptureList } from './wdh-capture.ts'
import type { WdhCaptureDetail, WdhCaptureList, WdhCaptureSelection } from './types.ts'
export type { ComponentId, ComponentOperation, ComponentView, ComponentsSnapshot, InstalledComponent, WdhConnectionView } from './types.ts'

/** Deployment-owned directories; no catalog can choose an executable. */
export interface Config {
  /** Absolute directory for component versions and activation pointers. */
  directory: string
  /** Optional verified WDH CLI included in the application. */
  bundledWdhEntry: string
  /** Local Python interpreter used for managed device components. */
  pythonCommand: string
  /** Operator-owned release feed origin; empty keeps the code-owned GitHub repositories. */
  componentFeed: string
  /** Deadline for release metadata and browser file inspection. */
  requestTimeoutMs: number
  /** Deadline for component and browser downloads. */
  downloadTimeoutMs: number
  /** Shutdown grace period for browser maintenance processes. */
  processGraceMs: number
}
/** Validated component deployment configuration. */
export const Config = Schema.object({
  directory: Schema.string().required(), bundledWdhEntry: Schema.string().default(''), pythonCommand: Schema.string().default('python3'),
  componentFeed: Schema.string().default(''),
  requestTimeoutMs: Schema.number().min(1).default(20_000), downloadTimeoutMs: Schema.number().min(1).default(600_000),
  processGraceMs: Schema.number().min(1).default(3000),
})

/** Trusted in-process command resolution for an official MCP connection. */
export interface ComponentRuntime {
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

const idhIdentity = z.object({
  isError: z.literal(false).optional(),
  structuredContent: z.object({
    processGeneration: z.string().min(1),
    process: z.object({ pid: z.union([z.number(), z.string()]), bundleId: z.string().min(1) }),
  }),
})

function endpointKey(component: ChatTargetChoice['component'], value: string): string | undefined {
  const url = URL.parse(value)
  if (url === null || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
  // The CLI defaults differ, and URL.port drops an explicitly supplied port 80 or 443.
  const authority = value.match(/^https?:\/\/([^/]+)/i)?.[1]
  const port = Number(authority?.match(/:(\d+)$/)?.[1] ?? (component === 'adh' ? 8088 : 80))
  const path = url.pathname.replace(/\/(?:api\/)?mcp\/?$/, '').replace(/\/$/, '')
  return `${url.protocol}//${url.hostname}:${port}${path}`
}

function appId(target: ComponentInventory['targets'][number]): string {
  return target.bundle ?? target.package ?? target.name
}

declare module '@deepseek-ai/cordis' {
  interface Context { decrypthubComponents: DecryptHubComponents }
}

type WdhCaptureReader = (selection: WdhCaptureSelection | null, signal: AbortSignal) => Promise<unknown>
type ObservedWdh = { view: WdhConnectionView; readCapture: WdhCaptureReader | undefined }

/** One owner of official installations; the MCP client remains the transport owner. */
export class DecryptHubComponents extends TypertRemoteService {
  static Config = Config
  static inject = ['settings', 'agents', 'mcpManager', 'subprocess', 'storageDomain']
  private readonly files: ComponentFiles
  private readonly feed: URL | undefined
  private readonly catalog = new Map<ComponentId, ComponentRelease | null>()
  private readonly catalogErrors = new Map<ComponentId, string>()
  private readonly operations = new Map<ComponentId, ComponentOperation>()
  private readonly jobs = new Map<ComponentId, { controller: AbortController; done: Promise<void> }>()
  private readonly wdh = new Map<SessionId, ObservedWdh>()
  private readonly inventories = new Map<ComponentId, ComponentInventory>()
  private chatTargets?: KvTable<SessionId, ChatTargetBinding>
  private readonly targetWrites = new Set<SessionId>()
  /** Last measured WDH tool count; measured on demand, not tied to a live session. */
  private wdhTools: number | null = null
  private readonly measuring = new Map<ComponentId, Promise<string[] | null>>()
  /** Cached `command --version` tokens keyed by absolute executable path. */
  private readonly localVersions = new Map<string, string | null>()
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private revision = 0
  private checking: Promise<ComponentsSnapshot> | undefined
  private closed = false
  private readonly reconnectors = new Map<ComponentId, () => Promise<void>>()
  private browser: BrowserKernelView = { state: 'unchecked', version: null }

  /** Initialize the owned management lifetime.
 * @param ctx - component service lifetime.
 * @param config - application-owned storage and runtime choices. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'decrypthubComponents', { namespace: 'decrypthubComponents' })
    if (!isAbsolute(config.directory) || (config.bundledWdhEntry && !isAbsolute(config.bundledWdhEntry))) throw new Error('Component directories must be absolute')
    this.feed = config.componentFeed.trim() === '' ? undefined : componentFeedBaseUrl(config.componentFeed.trim())
    this.files = new ComponentFiles(config.directory, config.bundledWdhEntry)
    ctx.on('decrypthub-components/activated', (id) => { this.inventories.delete(id); this.changed() })
    ctx.on('settings/document-updated', (ns) => {
      if (ns === 'decrypthub-integrations') {
        this.browser = { state: 'unchecked', version: null }
        this.inventories.clear()
        this.changed()
      }
    })
    ctx.effect(() => async () => {
      this.closed = true
      this.lifetime.abort()
      for (const job of this.jobs.values()) job.controller.abort()
      this.changed()
      await Promise.allSettled([...this.jobs.values()].map(job => job.done))
    })
  }

  /** Open verified selections before exposing the component service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(chatTargetDomain)
    this.chatTargets = domain.table('targets')
    this.ctx.effect(() => () => domain.close(), 'decrypthub.chatTargets')
  }

  private targetTable(): KvTable<SessionId, ChatTargetBinding> {
    if (this.chatTargets === undefined) throw new RemoteError('gateway/bad-request', 'Chat target storage is unavailable.', {})
    return this.chatTargets
  }

  private async writeTarget<T>(sessionId: SessionId, write: () => Promise<T>): Promise<T> {
    if (this.targetWrites.has(sessionId)) throw new RemoteError('gateway/bad-request', 'Wait for the chat target change to finish.', {})
    this.targetWrites.add(sessionId)
    try {
      return await write()
    } finally {
      this.targetWrites.delete(sessionId)
    }
  }

  private assertOwner(): void {
    if (principalOf(this.ctx.invocation) !== undefined) throw new Error('Official component management is available only to the Host owner')
  }

  private changed(): void { this.revision++; for (const listener of this.listeners) listener() }

  private async notifyActivation(id: ComponentId): Promise<void> {
    try {
      await this.ctx.parallel('decrypthub-components/activated', id)
    } catch (error) {
      this.ctx.logger.error('Component activation committed, but a connection observer failed', error)
    }
  }

  /** Describe official Harness data that can be copied into this product home.
   * @param source - harness home; empty uses `~/.dsh`.
   * @returns counts and a planning duration for each category.
   */
  @Remote
  async importPreview(source: string): Promise<{ source: string; items: ImportItem[] }> {
    this.assertOwner()
    const from = source.trim() === '' ? defaultHarnessHome() : source
    const destination = process.env.DSH_HOME
    if (destination === undefined || destination.trim() === '') throw new Error('DSH_HOME is not set')
    return { source: from, items: [...await previewHarnessImport(from, destination)] }
  }

  /** Copy the selected categories. Existing rows in this product home stay.
   * @param source - harness home; empty uses `~/.dsh`.
   * @param kinds - categories the user selected.
   * @returns one outcome per selected category.
   */
  @Remote
  async importRun(source: string, kinds: ImportKind[]): Promise<{ results: ImportResult[] }> {
    this.assertOwner()
    const from = source.trim() === '' ? defaultHarnessHome() : source
    const destination = process.env.DSH_HOME
    if (destination === undefined || destination.trim() === '') throw new Error('DSH_HOME is not set')
    return { results: [...await runHarnessImport(from, destination, kinds, records => this.adoptWorkspaces(records))] }
  }

  /** Recreate workspace accounts through the live registry so imported sessions stay grouped.
   * @param records - workspace accounts read from the source home.
   * @returns how many groups and session memberships were added.
   */
  private async adoptWorkspaces(records: readonly ImportedWorkspace[]): Promise<AdoptedGroups | undefined> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    let workspaces = 0
    let sessions = 0
    let skipped = 0
    let unattached = 0
    for (const record of records) {
      try {
        const info = await fs.stat(record.path)
        if (!info.isDirectory()) {
          skipped += 1
          continue
        }
      } catch (error) {
        skipped += 1
        this.ctx.logger.warn(`decrypthub-components: workspace "${record.title}" path unavailable: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const existing = registry.list().find((item: { path: string }) => item.path === record.path)
      let workspace: { sessionIds: readonly string[]; attachSession(sessionId: string): Promise<void> }
      try {
        workspace = existing ?? await registry.create(record.path, record.title)
      } catch (error) {
        skipped += 1
        this.ctx.logger.warn(`decrypthub-components: workspace "${record.title}" not created: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (existing === undefined) workspaces += 1
      const have = new Set(workspace.sessionIds)
      for (const sessionId of record.sessionIds) {
        if (have.has(sessionId)) continue
        try {
          await workspace.attachSession(sessionId)
          sessions += 1
        } catch (error) {
          unattached += 1
          this.ctx.logger.warn(`decrypthub-components: session ${sessionId} not attached to "${record.title}": ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return { workspaces, sessions, ...skipped > 0 ? { skipped } : {}, ...unattached > 0 ? { unattached } : {} }
  }

  /** Read actual local installations without performing network requests.
   * @returns component versions, local CLI availability and observed WDH transports.
   */
  @Remote
  async snapshot(): Promise<ComponentsSnapshot> {
    this.assertOwner()
    const namespace = this.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'decrypthub-integrations')
    const device = z.object({ enabled: z.boolean(), command: z.string(), args: z.array(z.string()), endpoint: z.string().default(''), devices: z.array(z.string()).default([]) })
    const configuration = z.object({ wdh: z.object({ enabled: z.boolean(), browser: z.enum(['system', 'cloak']) }), adh: device, idh: device }).safeParse(namespace?.value)
    const components = await Promise.all(componentIds.map(async (id) => {
      let installed: InstalledComponent | null = null
      let previousVersion: string | null = null
      let localError: string | null = null
      try { installed = await this.files.resolve(id); previousVersion = await this.files.previous(id) }
      catch (_error) { localError = 'Component metadata or checksum verification failed' }
      const localCommand = id === 'wdh' ? null
        : await componentExecutable(configuration.success ? configuration.data[id].command : id, process.env.PATH ?? '')
      let localVersion: string | null = null
      if (localCommand !== null) {
        if (!this.localVersions.has(localCommand)) this.localVersions.set(localCommand, await probeCommandVersion(localCommand))
        localVersion = this.localVersions.get(localCommand) ?? null
      }
      return { id, installed, previousVersion, localError, localCommand, localVersion,
        latestVersion: this.catalog.get(id)?.version ?? null, catalogError: this.catalogErrors.get(id) ?? null,
        operation: this.operations.get(id) ?? null }
    }))
    return {
      components,
      inventories: Object.fromEntries(this.inventories),
      wdhTools: this.wdhTools,
      wdh: [...this.wdh.values()].map(connection => connection.view),
      browser: this.browser,
      configuration: namespace && configuration.success
        ? { ...configuration.data, revision: namespace.revision, writable: this.ctx.settings.writable }
        : null,
    }
  }

  /** Query configured services through the verified CLI without changing a target.
   * @param id - official component to inspect.
   * @param signal - caller lifetime.
   * @returns fresh service and target facts, including an explicit query failure.
   */
  @Remote
  async inspectTargets(id: ComponentId, signal: AbortSignal): Promise<ComponentInventory> {
    this.assertOwner()
    signal.throwIfAborted()
    const lifetime = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    let inventory: ComponentInventory
    try {
      const namespace = this.ctx.settings.describe().find(row => row.ns === 'decrypthub-integrations')
      let text: string
      if (id === 'wdh') {
        const config = z.object({ wdh: z.object({ browser: z.enum(['system', 'cloak']) }) }).parse(namespace?.value)
        text = await this.browserCommand(['status', '--json', '--browser', config.wdh.browser], lifetime)
      } else {
        const { command, addresses } = this.deviceConfiguration(id)
        text = await this.readDeviceInventory(id, command, addresses, lifetime)
      }
      inventory = parseInventory(text, id)
    } catch (error) {
      signal.throwIfAborted()
      this.lifetime.signal.throwIfAborted()
      inventory = { schemaVersion: 1, component: id, version: null, checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Component status query failed', connections: [], targets: [] }
    }
    this.inventories.set(id, inventory)
    this.changed()
    return inventory
  }

  private deviceConfiguration(id: 'adh' | 'idh'): { command: string; addresses: string[] } {
    const namespace = this.ctx.settings.describe().find(row => row.ns === 'decrypthub-integrations')
    const entry = z.record(z.string(), z.unknown()).parse(namespace?.value)[id]
    const config = z.object({
      command: z.string(),
      endpoint: z.string().default(''),
      devices: z.array(z.string()).max(32).default([]),
    }).parse(entry)
    return { command: config.command, addresses: [...new Set([...config.devices, config.endpoint].filter(Boolean))] }
  }

  private async readDeviceCommand(id: 'adh' | 'idh', command: string, args: string[], signal: AbortSignal): Promise<string> {
    const runtime = await this.runtime(id, command, args)
    const handle = this.ctx.subprocess.spawn({
      argv: [runtime.command, ...runtime.args], env: runtime.env,
      cwd: runtime.cwd ?? this.config.directory, graceMs: this.config.processGraceMs, signal,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 4096 } },
    })
    const result = await handle.done
    if (!await handle.waitForExit(AbortSignal.timeout(this.config.processGraceMs))) throw new Error('Component status cleanup was not confirmed')
    signal.throwIfAborted()
    if (result.exitCode !== 0) throw new Error('Device status command failed. Check the component version and connection.')
    return handle.collected.stdout?.readFrom(0).text ?? ''
  }

  private readDeviceInventory(id: 'adh' | 'idh', command: string, addresses: readonly string[], signal: AbortSignal): Promise<string> {
    const args = ['status', '--json', '--timeout', '2', ...(id === 'idh' ? ['--no-saved'] : [])]
    for (const address of addresses) args.push('--endpoint', address)
    return this.readDeviceCommand(id, command, args, signal)
  }

  private async observeChatTarget(choice: ChatTargetChoice, address: string, signal: AbortSignal): Promise<ChatTargetBinding | 'stale' | 'unavailable'> {
    const { component, endpoint, id, pid } = choice
    const lifetime = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    const config = this.deviceConfiguration(component)
    if (!config.addresses.includes(address)) return 'stale'
    const raw = await this.readDeviceInventory(component, config.command, [address], lifetime)
    const inventory = parseInventory(raw, component)
    const service = endpointKey(component, endpoint)
    if (!inventory.connections.some(row => row.online && endpointKey(component, row.endpoint) === service)) return 'unavailable'
    const target = inventory.targets.find(row =>
      row.online && row.id === id && row.endpoint === endpoint && row.pid != null
      && String(row.pid) === pid && appId(row) === choice.appId)
    if (target === undefined) return 'stale'
    let generation = target.id
    if (component === 'idh') {
      // Only this fixed metadata operation is used. The selected App or the model cannot supply a tool name.
      const result = await this.readDeviceCommand('idh', config.command,
        ['call', '--json', '--no-saved', '--endpoint', address, '--', id, 'get_capabilities'], lifetime)
      const identity = idhIdentity.safeParse(JSON.parse(result))
      if (!identity.success) return 'unavailable'
      const { process, processGeneration } = identity.data.structuredContent
      if (String(process.pid) !== pid || process.bundleId !== target.bundle) return 'stale'
      generation = processGeneration
    }
    return { view: { component, endpoint, id, pid, appId: choice.appId, name: target.name, state: 'bound' }, address, generation }
  }

  /** Whether a chat has an explicit scope, including a pending change or a selection that needs to be renewed.
   * @param sessionId - owning chat.
   * @returns true while a selection exists or a change is in progress.
   */
  hasChatTarget(sessionId: SessionId): boolean {
    return this.targetWrites.has(sessionId) || this.targetTable().get(sessionId) !== undefined
  }

  /** Read only this chat's chosen device and verify the original process identity.
   * @param sessionId - owning chat.
   * @param signal - caller lifetime.
   * @returns fresh scoped status, or null for an unbound chat.
   */
  @Remote
  async chatTarget(sessionId: SessionId, signal: AbortSignal): Promise<ChatTargetView | null> {
    this.assertOwner()
    signal.throwIfAborted()
    const table = this.targetTable()
    const binding = table.get(sessionId)
    if (binding === undefined) return null
    if (this.targetWrites.has(sessionId)) return { ...binding.view, state: 'unavailable' }
    if (binding.view.state === 'stale') return binding.view
    const observed = await this.observeChatTarget(binding.view, binding.address, signal).catch(() => {
      signal.throwIfAborted()
      this.lifetime.signal.throwIfAborted()
      return 'unavailable' as const
    })
    signal.throwIfAborted()
    // A response for the old selection must never be delivered as a response for the new one.
    if (this.targetWrites.has(sessionId) || table.get(sessionId) !== binding) return { ...binding.view, state: 'unavailable' }
    if (observed === 'unavailable') return { ...binding.view, state: 'unavailable' }
    if (observed === 'stale' || observed.generation !== binding.generation) {
      const stale: ChatTargetBinding = { ...binding, view: { ...binding.view, state: 'stale' } }
      await this.writeTarget(sessionId, () => table.put(sessionId, stale))
      return stale.view
    }
    return binding.view
  }

  /** Bind a chat to a process from an explicitly configured device, or clear the binding.
   * @param sessionId - owning chat.
   * @param choice - exact device and App observation, or null to clear it.
   * @param signal - caller lifetime.
   * @returns the selection or null for a clear, after the durable write.
   */
  @Remote
  async setChatTarget(sessionId: SessionId, choice: ChatTargetChoice | null, signal: AbortSignal): Promise<ChatTargetView | null> {
    this.assertOwner()
    signal.throwIfAborted()
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined || agent.status === 'running') {
      throw new RemoteError('gateway/bad-request', 'Open an idle chat before changing its device target.', {})
    }
    const table = this.targetTable()
    return this.writeTarget(sessionId, async () => {
      if (choice === null) {
        await table.delete(sessionId)
        return null
      }
      const { addresses } = this.deviceConfiguration(choice.component)
      const selection = endpointKey(choice.component, choice.endpoint)
      const address = selection === undefined ? undefined : addresses.find(value => endpointKey(choice.component, value) === selection)
      if (address === undefined) throw new RemoteError('gateway/bad-request', 'Choose an App on a configured device.', {})
      const observed = await this.observeChatTarget(choice, address, signal)
      signal.throwIfAborted()
      if (typeof observed === 'string') {
        throw new RemoteError('gateway/bad-request', 'The selected process cannot be verified. Refresh the App list.', {})
      }
      const active = this.ctx.agents.get(sessionId)
      if (active !== agent || active.status === 'running') {
        throw new RemoteError('gateway/bad-request', 'The chat changed. Refresh the App list.', {})
      }
      if (!this.deviceConfiguration(choice.component).addresses.includes(address)) {
        throw new RemoteError('gateway/bad-request', 'The selected device was removed.', {})
      }
      await table.put(sessionId, observed)
      return observed.view
    })
  }

  /** Start one installed component once and list its tools without keeping a connection.
   * @param id - component whose runtime is started.
   * @returns the advertised raw tool names, or null when the component cannot start.
   */
  @Remote
  async measureTools(id: ComponentId): Promise<string[] | null> {
    this.assertOwner()
    const running = this.measuring.get(id)
    if (running !== undefined) return running
    const work = (async (): Promise<string[] | null> => {
      const home = join(this.config.directory, 'data', id)
      await fs.mkdir(home, { recursive: true })
      // A device gateway may be a local CLI, so only WDH needs a managed installation.
      const installed = id === 'wdh' ? await this.files.resolve(id) : null
      if (id === 'wdh') {
        if (installed === null) return null
        const names = await probeTools(this.ctx, process.execPath, home, [installed.entry, 'mcp', '--root', home,
          '--data-dir', home, '--kernel-dir', dirname(home)], {})
        if (names !== null && names.length !== this.wdhTools) { this.wdhTools = names.length; this.changed() }
        return names
      }
      const namespace = this.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'decrypthub-integrations')
      const entry = z.object({ command: z.string(), args: z.array(z.string()), endpoint: z.string().default('') }).safeParse(
        (namespace?.value as Record<string, unknown> | undefined)?.[id])
      if (!entry.success) return null
      const runtime = await this.runtime(id, entry.data.command || id, entry.data.args, entry.data.endpoint)
      return probeTools(this.ctx, runtime.command, runtime.cwd ?? home, runtime.args, runtime.env)
    })().finally(() => { this.measuring.delete(id) })
    this.measuring.set(id, work)
    return work
  }

  /** Observe version, installation and WDH state changes with a complete initial snapshot.
   * @param signal - subscription lifetime.
 * @returns credential-free component observations.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<ComponentsSnapshot> {
    this.assertOwner()
    let seen = -1
    let wake: (() => void) | undefined
    const notify = (): void => { wake?.() }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted && !this.closed) {
        if (seen !== this.revision) { seen = this.revision; yield await this.snapshot(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally { this.listeners.delete(notify); signal.removeEventListener('abort', notify) }
  }

  /** Explicitly query code-owned official repositories; installed components remain usable on failure.
   * @returns updated catalog observations, including per-component lookup failures.
   */
  @Remote
  checkUpdates(): Promise<ComponentsSnapshot> {
    this.assertOwner()
    if (this.checking !== undefined) return this.checking
    const work = Promise.all(componentIds.map(async (id) => {
      try {
        this.catalog.set(id, this.feed === undefined
          ? await fetchComponentRelease(id, this.lifetime.signal, this.config.requestTimeoutMs)
          : await fetchFeedRelease(this.feed, id, this.lifetime.signal, this.config.requestTimeoutMs))
        this.catalogErrors.delete(id)
      } catch (_error) { this.catalogErrors.set(id, 'Unable to check the official release catalog') }
    })).then(async () => { this.changed(); return this.snapshot() })
      .finally(() => { if (this.checking === work) this.checking = undefined })
    this.checking = work
    return work
  }

  /** Start one reviewed official installation; no post-install program executes.
   * @param id - fixed product component.
 * @param expectedVersion - version the user reviewed.
   * @returns once its cancellable transaction is registered.
   */
  @Remote
  installComponent(id: ComponentId, expectedVersion: string): void {
    this.assertOwner()
    if (this.closed || this.jobs.size > 0) throw new Error('Wait for the current component operation to finish')
    const controller = new AbortController()
    this.operations.set(id, { kind: 'component', phase: 'checking', received: 0, total: 0 })
    const done = this.installOnce(id, expectedVersion, controller.signal).finally(() => {
      this.jobs.delete(id)
      // Terminal success/cancel must not keep a sticky progress row in the product UI.
      const phase = this.operations.get(id)?.phase
      if (phase === 'installed' || phase === 'cancelled') this.operations.delete(id)
      this.changed()
    })
    this.jobs.set(id, { controller, done })
    this.changed()
  }

  private async installOnce(id: ComponentId, expectedVersion: string, signal: AbortSignal): Promise<void> {
    let stage: string | undefined
    const progress = (patch: Partial<ComponentOperation>): void => {
      const previous = this.operations.get(id) ?? { phase: 'checking' as const, received: 0, total: 0 }
      this.operations.set(id, { ...previous, ...patch }); this.changed()
    }
    try {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.config.downloadTimeoutMs)])
      const asset = this.feed === undefined
        ? await fetchComponentRelease(id, bounded, this.config.requestTimeoutMs)
        : await fetchFeedRelease(this.feed, id, bounded, this.config.requestTimeoutMs)
      if (asset === null) throw new Error('No compatible official archive with a published checksum')
      if (asset.version !== expectedVersion) throw new Error('The reviewed component version changed; check updates again')
      const verified = this.feed === undefined
        ? await fetchComponentRelease(id, bounded, this.config.requestTimeoutMs, asset.releaseId)
        : await fetchFeedRelease(this.feed, id, bounded, this.config.requestTimeoutMs)
      if (verified === null || verified.sha256 !== asset.sha256
        || verified.version !== asset.version || verified.name !== asset.name || verified.size !== asset.size) throw new Error('Official release changed; check updates again')
      await fs.mkdir(this.config.directory, { recursive: true })
      stage = await fs.mkdtemp(join(this.config.directory, 'install-'))
      const archive = join(stage, 'component.zip')
      progress({ phase: 'downloading', version: asset.version, total: asset.size })
      await downloadComponent(verified, archive, bounded, (received) =>{  progress({ received }) }, this.feed)
      const extracted = join(stage, 'package')
      await fs.mkdir(extracted)
      progress({ phase: 'verifying' })
      await extractComponentZip(archive, extracted, bounded)
      bounded.throwIfAborted()
      progress({ phase: 'installing' })
      await this.files.install(extracted, id, verified.version, bounded)
      this.catalog.set(id, verified)
      await this.notifyActivation(id)
      // Drop the progress row immediately; a sticky `installed` phase left the dialog looking unfinished.
      this.operations.delete(id)
      this.changed()
    } catch (_error) {
      if (signal.aborted) {
        this.operations.delete(id)
        this.changed()
      } else {
        progress({ phase: 'failed', error: 'Official component installation failed; check local component status before retrying' })
      }
    } finally {
      if (stage !== undefined) await fs.rm(stage, { recursive: true, force: true }).catch((_error: unknown) => {
        const current = this.operations.get(id)
        if (current?.phase === 'failed') progress({ error: 'Temporary installation files could not be cleaned' })
      })
    }
  }

  /** Cancel only the named installation; activation already committed is not undone.
   * @param id - component operation.
 * @returns after its cleanup settles.
   */
  @Remote
  async cancelInstall(id: ComponentId): Promise<void> {
    this.assertOwner()
    const job = this.jobs.get(id)
    job?.controller.abort()
    await job?.done
  }

  /** Restore the prior verified version; current MCP clients switch at their next safe rebind.
   * @param id - component identity.
 * @returns updated local state.
   */
  @Remote
  async rollback(id: ComponentId): Promise<ComponentsSnapshot> {
    this.assertOwner()
    if (this.jobs.size) throw new Error('A component installation is still running')
    await this.files.rollback(id)
    await this.notifyActivation(id)
    this.changed()
    return this.snapshot()
  }

  /** Remove a managed official installation; packaged WDH remains when the deployment ships one.
   * @param id - component identity.
   * @returns updated local state after the activation pointer moves.
   */
  @Remote
  async uninstall(id: ComponentId): Promise<ComponentsSnapshot> {
    this.assertOwner()
    if (this.jobs.size) throw new Error('A component installation is still running')
    const installed = await this.files.resolve(id)
    if (installed === null || installed.source !== 'managed') throw new Error('Only a downloaded component can be removed')
    await this.files.uninstall(id)
    if (id === 'wdh') this.browser = { state: 'unchecked', version: null }
    try {
      const namespace = this.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'decrypthub-integrations')
      const enabled = z.object({ [id]: z.object({ enabled: z.boolean() }).loose() }).loose().safeParse(namespace?.value)
      if (namespace && enabled.success && enabled.data[id]?.enabled === true) {
        await this.ctx.settings.mutate('decrypthub-integrations', [{ op: 'set', path: [id, 'enabled'], value: false }], namespace.revision)
      }
    } catch (_error) {
      // Settings may be unavailable; the installation pointer is already cleared.
    }
    await this.notifyActivation(id)
    this.changed()
    return this.snapshot()
  }

  /** Resolve the verified WDH entry or the deployment fallback.
   * @param fallback - explicitly configured local WDH entry.
 * @returns installed entry for the next Agent step.
   */
  async wdhEntry(fallback: string): Promise<string> { return (await this.files.resolve('wdh'))?.entry ?? fallback }

  /** Resolve a managed Python gateway or an explicitly configured local CLI.
   * @param id - device integration.
 * @param command - configured local fallback.
 * @param args - reviewed MCP arguments.
   * @param endpoint - optional device-daemon address.
 * @returns actual invocation without shell expansion.
   */
  async runtime(id: 'adh' | 'idh', command: string, args: readonly string[], endpoint: string = ''): Promise<ComponentRuntime> {
    const installed = await this.files.resolve(id)
    const resolvedArgs = [...args]
    if (endpoint) {
      const url = new URL(endpoint)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid device service endpoint')
      if (resolvedArgs.includes('--endpoint')) throw new Error('Configure the device endpoint in only one field')
      resolvedArgs.push('--endpoint', url.href)
    }
    const cwd = join(this.config.directory, 'data', id)
    await fs.mkdir(cwd, { recursive: true })
    const env = { [`${id.toUpperCase()}_CONFIG_PATH`]: join(cwd, 'connections.json'),
      ...(id === 'idh' ? { IDH_SETTINGS_PATH: join(cwd, 'settings.json'), IDH_AUTO_UPDATE: 'off' } : {}),
      PYTHONIOENCODING: 'utf-8' }
    if (installed === null) return { command, args: resolvedArgs, env, cwd }
    const python = await componentExecutable(this.config.pythonCommand, process.env.PATH ?? '')
      ?? await componentExecutable('python', process.env.PATH ?? '')
    if (python === null) throw new Error('Python 3.10 or newer is required for the installed device gateway')
    const result = await promisify(execFile)(python, ['-I', '-c', 'import sys,json; print(json.dumps(list(sys.version_info[:3])))'],
      { timeout: 5000, maxBuffer: 1024, windowsHide: true, signal: this.lifetime.signal })
    const version = z.tuple([z.number().int(), z.number().int(), z.number().int()]).parse(JSON.parse(result.stdout.trim()))
    if (version[0] !== 3 || version[1] < 10) throw new Error('Python 3.10 or newer is required for the installed device gateway')
    return { command: python, args: ['-I', '-B', '-X', 'utf8', installed.entry,
      ...(id === 'idh' ? ['--no-auto-update'] : []), ...resolvedArgs], env, cwd }
  }

  /** Publish one real Agent-owned connection; disposing it removes the observation.
   * @param agentId - owning Agent identity.
 * @param workspace - current working directory.
   * @param read - live connection state.
   * @param subscribe - underlying MCP observation.
   * @param readCapture - optional capture reader owned by this exact connection.
   * @returns connection-observation disposer.
   */
  observeWdh(agentId: SessionId, workspace: string, read: () => McpConnectionStatus,
    subscribe: (listener: () => void) => () => void, readCapture?: WdhCaptureReader): () => void {
    const connection = { view: { agentId, workspace, status: read() }, readCapture }
    const update = (): void => {
      const status = read()
      if (status.state === 'connected' && status.toolCount > 0) this.wdhTools = status.toolCount
      connection.view = { agentId, workspace, status }
      this.changed()
    }
    this.wdh.set(agentId, connection)
    const stop = subscribe(update)
    update()
    return () => {
      stop()
      if (this.wdh.get(agentId) !== connection) return
      this.wdh.delete(agentId)
      this.changed()
    }
  }

  private async wdhCaptureResult(sessionId: SessionId, selection: WdhCaptureSelection | null, signal: AbortSignal): Promise<unknown> {
    this.assertOwner()
    const connection = this.wdh.get(sessionId)
    if (connection?.view.status.state !== 'connected' || connection.readCapture === undefined) {
      throw new RemoteError('gateway/bad-request', 'This chat has no live WDH connection. Reconnect WDH and retry.', {})
    }
    const lifetime = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    const result = await connection.readCapture(selection, lifetime)
    lifetime.throwIfAborted()
    if (this.wdh.get(sessionId) !== connection || connection.view.status.state !== 'connected') {
      throw new RemoteError('gateway/bad-request', 'The WDH connection changed. Refresh the capture list.', {})
    }
    return result
  }

  /** List recent requests from the browser already bound to the chat.
   * @param sessionId - chat owning the WDH connection.
   * @param signal - caller lifetime.
   * @returns a capture list scoped to the connection.
   */
  @Remote({ resources: { session: sessionId => sessionId } })
  async wdhCaptureList(sessionId: SessionId, signal: AbortSignal): Promise<WdhCaptureList> {
    return readWdhCaptureList(await this.wdhCaptureResult(sessionId, null, signal))
  }

  /** Read the selected capture's response and initiating stack together.
   * @param sessionId - chat owning the WDH connection.
   * @param selection - identifier and connection generation from the list.
   * @param signal - caller lifetime.
   * @returns selected details, or null if the capture expired.
   */
  @Remote({ resources: { session: sessionId => sessionId } })
  async wdhCaptureDetail(sessionId: SessionId, selection: WdhCaptureSelection, signal: AbortSignal): Promise<WdhCaptureDetail | null> {
    return readWdhCaptureDetail(await this.wdhCaptureResult(sessionId, selection, signal), selection.id)
  }

  /** Bind the integration's actual connection replacement operation.
   * @param id - component identity.
 * @param reconnect - integration-owned replacement.
   * @returns disposer that cannot remove a newer binding.
   */
  registerReconnect(id: ComponentId, reconnect: () => Promise<void>): () => void {
    this.reconnectors.set(id, reconnect)
    return () => { if (this.reconnectors.get(id) === reconnect) this.reconnectors.delete(id) }
  }

  private assertIdle(): void {
    if (this.ctx.agents.list().some(agent => agent.status === 'running')) throw new Error('Wait for running tasks to finish before changing official connections')
  }

  /** Reconnect an enabled integration using the currently verified component version.
   * @param id - component identity.
 * @returns after replacement is requested.
   */
  @Remote
  async reconnect(id: ComponentId): Promise<void> {
    this.assertOwner(); this.assertIdle()
    if (this.jobs.size) throw new Error('A component operation is still running')
    const reconnect = this.reconnectors.get(id)
    if (reconnect === undefined) throw new Error('Enable this component and start a task before reconnecting')
    await reconnect()
    this.changed()
  }

  /** Persist reviewed official connection choices without replacing unrelated settings.
   * @param id - component identity.
 * @param enabled - persisted enablement choice.
   * @param command - local fallback CLI, unused for WDH.
 * @param args - local MCP arguments, unused for WDH.
   * @param endpoint - device daemon address, or empty.
 * @param browser - WDH browser choice.
   * @param expectedRevision - configuration revision captured by the editor.
   * @returns after a revision-checked Settings commit.
   */
  @Remote
  async configure(id: ComponentId, enabled: boolean, command: string, args: string[], endpoint: string,
    browser: 'system' | 'cloak', expectedRevision: number): Promise<void> {
    // Enabling only changes what the next session loads; running sessions keep their connections.
    this.assertOwner()
    if (this.jobs.size) throw new Error('A component operation is still running')
    if (endpoint) {
      const url = new URL(endpoint)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid device service endpoint')
    }
    if (id !== 'wdh' && !command.trim()) throw new Error('A local device gateway command is required')
    if (id !== 'wdh' && enabled && !endpoint.trim()) throw new Error('Configure the device service address before enabling this gateway')
    await this.ctx.settings.mutate('decrypthub-integrations', id === 'wdh'
      ? [{ op: 'set', path: ['wdh', 'enabled'], value: enabled }, { op: 'set', path: ['wdh', 'browser'], value: browser }]
      : [{ op: 'set', path: [id, 'enabled'], value: enabled }, { op: 'set', path: [id, 'command'], value: command },
        { op: 'set', path: [id, 'args'], value: args }, { op: 'set', path: [id, 'endpoint'], value: endpoint }], expectedRevision)
    this.changed()
  }

  private async browserCommand(args: string[], signal: AbortSignal): Promise<string> {
    const entry = await this.files.resolve('wdh')
    if (entry === null) throw new Error('WDH is not installed')
    const namespace = this.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'decrypthub-integrations')
    const config = z.object({ wdh: z.object({ dataDirectory: z.string() }) }).parse(namespace?.value)
    await fs.mkdir(config.wdh.dataDirectory, { recursive: true })
    const handle = this.ctx.subprocess.spawn({
      argv: [process.execPath, entry.entry, ...args, '--data-dir', config.wdh.dataDirectory, '--kernel-dir', config.wdh.dataDirectory],
      cwd: config.wdh.dataDirectory, graceMs: this.config.processGraceMs, signal,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 4096 } },
    })
    const result = await handle.done
    if (!await handle.waitForExit(AbortSignal.timeout(this.config.processGraceMs))) throw new Error('Browser operation cleanup was not confirmed')
    signal.throwIfAborted()
    if (result.exitCode !== 0) throw new Error('Browser kernel command failed')
    return handle.collected.stdout?.readFrom(0).text ?? ''
  }

  /** Inspect installed browser files without starting a browser or connecting a device.
   * @returns the selected kernel's file-discovery state.
   */
  @Remote
  async inspectBrowser(): Promise<BrowserKernelView> {
    this.assertOwner()
    try {
      const raw = await this.browserCommand(['doctor'], AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]))
      const data = z.object({ system: z.union([z.string(), z.array(z.object({ path: z.string() }))]).nullable(),
        cloak: z.object({ version: z.string().optional() }).nullable() }).parse(JSON.parse(raw))
      const namespace = this.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'decrypthub-integrations')
      const config = z.object({ wdh: z.object({ browser: z.enum(['system', 'cloak']) }) }).parse(namespace?.value)
      this.browser = { state: (config.wdh.browser === 'cloak' ? data.cloak !== null : (Array.isArray(data.system) ? data.system.length > 0 : data.system !== null)) ? 'found' : 'missing',
        version: config.wdh.browser === 'cloak' ? data.cloak?.version ?? null : null }
    } catch (_error) { this.browser = { state: 'failed', version: null } }
    this.changed()
    return this.browser
  }

  /** Download the browser through WDH's maintained official kernel installer.
   * @param acceptedLicense - explicit acknowledgement from the download confirmation.
   * @returns once the cancellable operation is registered.
   */
  @Remote
  installBrowser(acceptedLicense: boolean): void {
    this.assertOwner(); this.assertIdle()
    if (!acceptedLicense) throw new Error('Review the browser binary license before downloading')
    if (this.jobs.size) throw new Error('A component operation is still running')
    const controller = new AbortController()
    this.operations.set('wdh', { kind: 'browser', phase: 'downloading', received: 0, total: 0 })
    const done = (async () => {
      try {
        await this.browserCommand(['kernel', 'install', 'cloak'], AbortSignal.any([controller.signal, this.lifetime.signal, AbortSignal.timeout(this.config.downloadTimeoutMs)]))
        await this.inspectBrowser()
        this.operations.delete('wdh')
      } catch (_error) {
        this.operations.set('wdh', { kind: 'browser', phase: controller.signal.aborted ? 'cancelled' : 'failed', received: 0, total: 0,
          ...controller.signal.aborted ? {} : { error: 'Browser kernel installation failed; inspect the browser state before retrying' } })
        if (controller.signal.aborted) this.operations.delete('wdh')
      } finally { this.jobs.delete('wdh'); this.changed() }
    })()
    this.jobs.set('wdh', { controller, done }); this.changed()
  }
}
export default DecryptHubComponents
