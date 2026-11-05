/** Official component catalog, verified installation and connection observations. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import Schema from '@deepseek-ai/schemastery'
import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { componentExecutable, componentIds, ComponentFiles } from './files.ts'
import { downloadComponent, fetchComponentRelease, type ComponentRelease } from './releases.ts'
import { extractComponentZip } from './zip.ts'
import type { ComponentId, ComponentOperation, ComponentsSnapshot, InstalledComponent, WdhConnectionView } from './types.ts'
import type { McpConnectionStatus } from '@deepseek-ai/dsh-mcp-client/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-mcp-manager'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { BrowserKernelView } from './types.ts'
export type { ComponentId, ComponentOperation, ComponentView, ComponentsSnapshot, InstalledComponent, WdhConnectionView } from './types.ts'

/** Deployment-owned directories; no catalog can choose an executable. */
export interface Config {
  /** Absolute directory for component versions and activation pointers. */
  directory: string
  /** Optional verified WDH CLI included in the application. */
  bundledWdhEntry: string
  /** Local Python interpreter used for managed device components. */
  pythonCommand: string
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

declare module '@deepseek-ai/cordis' {
  interface Context { decrypthubComponents: DecryptHubComponents }
}

/** One owner of official installations; the MCP client remains the transport owner. */
export class DecryptHubComponents extends TypertRemoteService {
  static Config = Config
  static inject = ['settings', 'agents', 'mcpManager', 'subprocess']
  private readonly files: ComponentFiles
  private readonly catalog = new Map<ComponentId, ComponentRelease | null>()
  private readonly catalogErrors = new Map<ComponentId, string>()
  private readonly operations = new Map<ComponentId, ComponentOperation>()
  private readonly jobs = new Map<ComponentId, { controller: AbortController; done: Promise<void> }>()
  private readonly wdh = new Map<string, WdhConnectionView>()
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
    this.files = new ComponentFiles(config.directory, config.bundledWdhEntry)
    ctx.on('settings/document-updated', (ns) => {
      if (ns === 'decrypthub-integrations') { this.browser = { state: 'unchecked', version: null }; this.changed() }
    })
    ctx.effect(() => async () => {
      this.closed = true
      this.lifetime.abort()
      for (const job of this.jobs.values()) job.controller.abort()
      this.changed()
      await Promise.allSettled([...this.jobs.values()].map(job => job.done))
    })
  }

  private assertOwner(): void {
    if (principalOf(this.ctx.invocation) !== undefined) throw new Error('Official component management is available only to the Host owner')
  }

  private changed(): void { this.revision++; for (const listener of this.listeners) listener() }

  /** Read actual local installations without performing network requests.
   * @returns component versions, local CLI availability and observed WDH transports.
   */
  @Remote
  async snapshot(): Promise<ComponentsSnapshot> {
    this.assertOwner()
    const namespace = this.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'decrypthub-integrations')
    const device = z.object({ enabled: z.boolean(), command: z.string(), args: z.array(z.string()), endpoint: z.string().default('') })
    const configuration = z.object({ wdh: z.object({ enabled: z.boolean(), browser: z.enum(['system', 'cloak']) }), adh: device, idh: device }).safeParse(namespace?.value)
    const components = await Promise.all(componentIds.map(async (id) => {
      let installed: InstalledComponent | null = null
      let previousVersion: string | null = null
      let localError: string | null = null
      try { installed = await this.files.resolve(id); previousVersion = await this.files.previous(id) }
      catch (_error) { localError = 'Component metadata or checksum verification failed' }
      return { id, installed, previousVersion, localError,
        localCommand: id === 'wdh' ? null : await componentExecutable(configuration.success ? configuration.data[id].command : id, process.env.PATH ?? ''),
        latestVersion: this.catalog.get(id)?.version ?? null, catalogError: this.catalogErrors.get(id) ?? null,
        operation: this.operations.get(id) ?? null }
    }))
    return { components, wdh: [...this.wdh.values()], browser: this.browser, configuration: namespace && configuration.success
      ? { ...configuration.data, revision: namespace.revision, writable: this.ctx.settings.writable } : null }
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
        this.catalog.set(id, await fetchComponentRelease(id, this.lifetime.signal, this.config.requestTimeoutMs))
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
    const done = this.installOnce(id, expectedVersion, controller.signal).finally(() => { this.jobs.delete(id); this.changed() })
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
      const asset = await fetchComponentRelease(id, bounded, this.config.requestTimeoutMs)
      if (asset === null) throw new Error('No compatible official archive with a published checksum')
      if (asset.version !== expectedVersion) throw new Error('The reviewed component version changed; check updates again')
      const verified = await fetchComponentRelease(id, bounded, this.config.requestTimeoutMs, asset.releaseId)
      if (verified === null || verified.assetId !== asset.assetId || verified.sha256 !== asset.sha256
        || verified.version !== asset.version || verified.name !== asset.name || verified.size !== asset.size) throw new Error('Official release changed; check updates again')
      await fs.mkdir(this.config.directory, { recursive: true })
      stage = await fs.mkdtemp(join(this.config.directory, 'install-'))
      const archive = join(stage, 'component.zip')
      progress({ phase: 'downloading', version: asset.version, total: asset.size })
      await downloadComponent(verified, archive, bounded, (received) =>{  progress({ received }) })
      const extracted = join(stage, 'package')
      await fs.mkdir(extracted)
      progress({ phase: 'verifying' })
      await extractComponentZip(archive, extracted, bounded)
      bounded.throwIfAborted()
      progress({ phase: 'installing' })
      await this.files.install(extracted, id, verified.version, bounded)
      this.catalog.set(id, verified)
      this.ctx.emit('decrypthub-components/activated', id)
      progress({ phase: 'installed' })
    } catch (_error) {
      progress({ phase: signal.aborted ? 'cancelled' : 'failed',
        ...signal.aborted ? {} : { error: 'Official component installation failed; check local component status before retrying' } })
    } finally {
      if (stage !== undefined) await fs.rm(stage, { recursive: true, force: true }).catch((_error: unknown) => {
        progress({ error: 'Temporary installation files could not be cleaned' })
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
    this.ctx.emit('decrypthub-components/activated', id)
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
   * @returns connection-observation disposer.
   */
  observeWdh(agentId: SessionId, workspace: string, read: () => McpConnectionStatus,
    subscribe: (listener: () => void) => () => void): () => void {
    const update = (): void => { this.wdh.set(agentId, { agentId, workspace, status: read() }); this.changed() }
    const stop = subscribe(update)
    update()
    return () => { stop(); this.wdh.delete(agentId); this.changed() }
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
    this.assertOwner(); this.assertIdle()
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
        this.operations.set('wdh', { kind: 'browser', phase: 'installed', received: 0, total: 0 })
        await this.inspectBrowser()
      } catch (_error) {
        this.operations.set('wdh', { kind: 'browser', phase: controller.signal.aborted ? 'cancelled' : 'failed', received: 0, total: 0,
          ...controller.signal.aborted ? {} : { error: 'Browser kernel installation failed; inspect the browser state before retrying' } })
      } finally { this.jobs.delete('wdh'); this.changed() }
    })()
    this.jobs.set('wdh', { controller, done }); this.changed()
  }
}
export default DecryptHubComponents
