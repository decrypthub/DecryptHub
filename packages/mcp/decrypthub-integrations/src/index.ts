/** Product MCP composition; the upstream client owns transports and tool execution. @module */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-manager'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-decrypthub-components'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Volatile } from '@deepseek-ai/cosmokit'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'

/** Configurable executable for an independently installed device integration. */
interface DeviceServer {
  /** Start only after an explicit deployment choice. */
  enabled: boolean
  /** Installed CLI executable; no shell expansion is performed. */
  command: string
  /** Arguments passed directly to the installed CLI. */
  args: string[]
  /** Optional device daemon address, distinct from the local MCP transport. */
  endpoint: string
}

/** Deployment paths and optional device servers; credentials stay in their owning CLIs. */
export interface IntegrationConfig {
  /** Installed browser component and per-Agent profile storage. */
  wdh: {
    /** Start one client for each Agent on its first step. */
    enabled: boolean
    /** Absolute entry path in an installed WDH component. */
    entry: string
    /** Absolute storage root for isolated Agent browser profiles. */
    dataDirectory: string
    /** System browser by default; Cloak requires a separately installed kernel. */
    browser: 'system' | 'cloak'
  }
  /** Optional Android CLI; configuration never installs or roots a device. */
  adh: DeviceServer
  /** Optional iOS CLI; credentials remain owned by that CLI. */
  idh: DeviceServer
  /** Budget for initial MCP negotiation and tool discovery. */
  startupTimeoutMs: number
  /** Budget for confirming transport and process cleanup. */
  closeTimeoutMs: number
  /** Maximum duration of an individual MCP tool call. */
  toolCallTimeoutMs: number
}



const deviceServer = (command: string): z<Partial<DeviceServer>, DeviceServer> => z.object({
  enabled: z.boolean().default(false),
  command: z.string().default(command),
  args: z.array(String).default(['mcp']),
  endpoint: z.string().default(''),
})

/** Product composition schema; no device server starts until explicitly enabled. */
export const Config = z.object({
  wdh: z.object({
    enabled: z.boolean().default(false),
    entry: z.string().default(''),
    dataDirectory: z.string().default(''),
    browser: z.union(['system', 'cloak']).default('system'),
  }),
  adh: deviceServer('adh'),
  idh: deviceServer('idh'),
  startupTimeoutMs: z.number().min(1).default(10_000),
  closeTimeoutMs: z.number().min(1).default(5_000),
  toolCallTimeoutMs: z.number().min(1).default(60_000),
}).default({}).volatile()

/** Live product connection configuration. */
export type Config = Volatile<IntegrationConfig>

/** Product plugin identity. */
export const name = 'decrypthub-integrations'
/** Existing services own MCP lifecycle, dispatch policy and working directories. */
export const inject = ['tools', 'workingDirectory', 'mcpManager']

interface Binding { cwd: string; entry: string; handle: Fiber; unobserve?: () => void }

/**
 * Mount one WDH client per Agent and optional device clients in the upstream manager.
 * Directory changes retire the old client before replacement; a final dispatch guard
 * refuses calls admitted against an older directory. Unconfirmed cleanup blocks replacement.
 * @param ctx - product plugin context; unloading it drains its child clients.
 * @param config - validated deployment settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const settings = ctx.get('settings')
  if (settings !== undefined) ctx.effect(() => settings.configure({ auto: false }, ctx.fiber))
  let child: Fiber | undefined
  let previous = ''
  let stopped = false
  let tail: Promise<void> = Promise.resolve()
  const reconcile = async (): Promise<void> => {
    if (stopped) return
    const next = config.get()
    const key = JSON.stringify(next)
    if (key === previous) return
    await child?.dispose()
    if (isStopped()) return
    const plain: IntegrationConfig = { ...next, adh: { ...next.adh, args: [...next.adh.args] },
      idh: { ...next.idh, args: [...next.idh.args] } }
    child = ctx.plugin(mountIntegration, plain)
    await child.await()
    previous = key
  }
  const isStopped = (): boolean => stopped
  ctx.on('loader/volatile-update', () => {
    tail = tail.then(reconcile, reconcile)
    void tail.catch((error: unknown) => { ctx.logger.error(error) })
  })
  ctx.effect(() => async () => { stopped = true; await tail.catch(() => undefined); await child?.dispose() })
  await reconcile()
}

async function mountIntegration(ctx: Context, config: IntegrationConfig): Promise<void> {
  const { wdh } = config
  if (wdh.enabled && (!isAbsolute(wdh.entry) || !isAbsolute(wdh.dataDirectory))) {
    throw new Error('DecryptHub WDH: entry and dataDirectory must be absolute paths; configure the installed component first.')
  }
  const devices = new Map<'adh' | 'idh', () => Promise<void>>()
  for (const serverName of ['adh', 'idh'] as const) {
    const server = config[serverName]
    if (!server.enabled) continue
    const components = ctx.get('decrypthubComponents')
    const connect = async (): Promise<void> => {
      const runtime = components === undefined ? { command: server.command,
        args: [...server.args, ...(server.endpoint ? ['--endpoint', server.endpoint] : [])], env: {} }
        : await components.runtime(serverName, server.command, server.args, server.endpoint)
      await devices.get(serverName)?.()
      const dispose = ctx.effect(() => ctx.mcpManager.register(serverName, {
        transport: 'stdio', ...runtime,
        startupTimeoutMs: config.startupTimeoutMs, closeTimeoutMs: config.closeTimeoutMs,
        toolCallTimeoutMs: config.toolCallTimeoutMs,
      }))
      devices.set(serverName, async () => { await dispose() })
    }
    await connect()
    if (components !== undefined) ctx.effect(() => components.registerReconnect(serverName, connect))
  }
  if (!wdh.enabled) return

  const bindings = new Map<Agent, Binding>()
  const operations = new Map<Agent, Promise<void>>()
  let stopped = false

  const retire = async (binding: Binding): Promise<void> => {
    await binding.handle.dispose()
    const closure = McpClient.connectionStatusOf(binding.handle)?.closure()
    if (closure !== undefined && (!closure.closeConfirmed || closure.cleanupError !== undefined)) {
      throw new Error('DecryptHub WDH: the previous connection did not close cleanly. Restart this application before reconnecting.')
    }
    binding.unobserve?.()
  }

  const bind = async (agent: Agent): Promise<void> => {
    if (stopped) return
    const cwd = ctx.workingDirectory.get(agent.session)
    const components = ctx.get('decrypthubComponents')
    const entry = components === undefined ? wdh.entry : await components.wdhEntry(wdh.entry)
    const previous = bindings.get(agent)
    if (previous?.cwd === cwd && previous.entry === entry) return
    if (previous !== undefined) await retire(previous)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Teardown may set stopped while transport closure is awaited.
    if (stopped) return
    const directoryKey = createHash('sha256').update(`${agent.id}\0${cwd}`).digest('hex')
    const handle = agent.ctx.plugin(McpClient, {
      transport: 'stdio', serverName: 'wdh', command: process.execPath,
      args: [entry, 'mcp', '--browser', wdh.browser, '--root', cwd,
        '--data-dir', join(wdh.dataDirectory, directoryKey), '--kernel-dir', wdh.dataDirectory],
      env: {}, cwd, startupTimeoutMs: config.startupTimeoutMs,
      closeTimeoutMs: config.closeTimeoutMs, toolCallTimeoutMs: config.toolCallTimeoutMs,
    })
    const binding: Binding = { cwd, entry, handle }
    bindings.set(agent, binding)
    await handle.await()
    const status = McpClient.connectionStatusOf(handle)
    if (components !== undefined && status !== undefined) {
      binding.unobserve = components.observeWdh(agent.id, cwd, () => status.current(), listener => status.onChange(listener))
    }
  }

  const components = ctx.get('decrypthubComponents')
  if (components !== undefined) ctx.effect(() => components.registerReconnect('wdh', async () => {
    for (const [agent, binding] of bindings) {
      await operations.get(agent)
      await retire(binding)
      bindings.delete(agent)
      await bind(agent)
    }
  }))

  ctx.tools.guard((exec) => {
    const resourceCall = ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(exec.name)
      && typeof exec.arguments === 'object' && exec.arguments !== null
      && 'server' in exec.arguments && exec.arguments.server === 'wdh'
    if (!exec.name.startsWith('mcp__wdh__') && !resourceCall) return undefined
    const binding = exec.agent === undefined ? undefined : bindings.get(exec.agent)
    if (stopped || exec.agent === undefined || binding === undefined
      || McpClient.connectionStatusOf(binding.handle)?.current().state !== 'connected'
      || binding.cwd !== ctx.workingDirectory.get(exec.agent.session)) {
      return 'The WDH workspace changed or its connection is unavailable. Retry in the next step after reconnection.'
    }
    return undefined
  })

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || stopped) return decision
    signal.throwIfAborted()
    // Both continuations serialize a new attempt after the prior caller has observed its own failure.
    const operation = (operations.get(agent) ?? Promise.resolve()).then(() => bind(agent), () => bind(agent))
    operations.set(agent, operation)
    try {
      await operation
      signal.throwIfAborted()
      return decision
    } finally {
      if (operations.get(agent) === operation) operations.delete(agent)
    }
  })
  // oxlint-disable-next-line typescript/no-misused-promises -- AgentRegistry awaits these lifecycle observers through Cordis parallel().
  ctx.on('agent/disposed', async ({ agent }) => {
    await operations.get(agent)
    const binding = bindings.get(agent)
    if (binding !== undefined) {
      await retire(binding)
      bindings.delete(agent)
    }
  })
  ctx.effect(() => async () => {
    stopped = true
    await Promise.allSettled(operations.values())
    const results = await Promise.allSettled([...bindings.values()].map(retire))
    bindings.clear()
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map(result => new Error(String(result.reason))), 'DecryptHub WDH cleanup failed; restart the application.')
  })
}
