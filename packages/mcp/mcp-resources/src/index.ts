/**
 * Scoped MCP resource providers and the shared model-facing resource tools.
 *
 * @module @deepseek-ai/dsh-mcp-resources
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { createScope, NamedEntries, ScopedLayers, scopeOf, type ScopeKey, type ScopeLayer } from '@deepseek-ai/dsh-scope'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool, ToolArgsError, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerResourceTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpResources: McpResourceRuntime
  }
}

/** One supported resource operation, with server-owned cursors and URIs. */
export type McpResourceRequest =
  | { method: 'resources/list' | 'resources/templates/list'; cursor?: string }
  | { method: 'resources/read'; uri: string }

type ResourceAvailability = 'resources' | 'no-resources' | 'disconnected'

/** One configured server's resource access, owned by its MCP connection plugin. */
export interface McpResourceProvider {
  /**
   * Describe resource availability for the current connection. Providers
   * without connection negotiation can omit this and advertise resources directly.
   * @returns The live resource capability or the reason it is unavailable.
   */
  availability?(): ResourceAvailability
  /**
   * Subscribe to changes in the negotiated resource capability.
   * @param changed - Refreshes the tools for this provider's scope.
   * @returns Disposer for this subscription.
   */
  onAvailabilityChange?(changed: () => void): () => void

  /**
   * Run an operation against one live connection generation. The resource tools
   * dispatch in parallel, so one provider may receive several concurrent requests;
   * each must settle independently.
   * @param request - MCP resource method and parameters.
   * @param exec - caller identity and cancellation for this invocation.
   * @returns the protocol result as lossless JSON.
   */
  request(request: McpResourceRequest, exec: ToolExecution): Promise<JsonValue>
}

class ResourceLayer implements ScopeLayer {
  readonly servers = new NamedEntries<McpResourceProvider>(name =>
    new Error(`MCP resource server "${name}" is already registered in this scope`))
  disposeTools: (() => void | Promise<void>) | undefined
  toolScope: { ctx: Context; dispose: () => void | Promise<void> } | undefined

  isEmpty(): boolean {
    return this.servers.isEmpty()
  }
}

/** Scoped MCP connection status and resource access. */
export class McpResourceRuntime extends Service {
  /** Tool registry required by the resource consumer. */
  static inject = ['tools']

  private readonly layers = new ScopedLayers(() => new ResourceLayer(), () => undefined)
  /** Shared tool registrations outlive any one server's registering context. */
  private readonly selfCtx: Context

  constructor(ctx: Context) {
    super(ctx, 'mcpResources')
    this.selfCtx = ctx

    ctx.inject(['systemPrompt'], (inner) => {
      inner.systemPrompt.section({
        name: 'mcp-resource-servers',
        order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
        interpolate: false,
        text: ({ scope }) => {
          const providers = this.layers.merge(scope, layer => layer.servers)
          if (providers.size === 0) return ''
          const servers: Record<ResourceAvailability, string[]> = { resources: [], 'no-resources': [], disconnected: [] }
          for (const [name, provider] of providers) {
            servers[provider.availability?.() ?? 'resources'].push(name)
          }
          return '## MCP servers\n\n'
            + `Connected resource servers: ${JSON.stringify(servers.resources.sort())}. `
            + `Connected servers without resources: ${JSON.stringify(servers['no-resources'].sort())}. `
            + `Disconnected servers: ${JSON.stringify(servers.disconnected.sort())}.\n\n`
            + 'For an MCP tool request, use the currently available server-qualified tool. '
            + 'Use mcp_server_status to check MCP connection state when a tool is missing. '
            + 'If a configured server is disconnected, report that it is offline and no lookup ran. Stop work that needs its data. '
            + 'Do not substitute web requests, guessed addresses, other tools, or other servers for a disconnected server. '
            + 'After reconnection, use the currently available tool again when asked. '
            + 'Use resource tools only for a connected resource server and read only a listed URI, an expanded listed template, '
            + 'or an exact URI supplied by the user. Never guess or cycle through alternate URIs after a failure. '
            + 'Report what the matching tool response actually returned. A disconnection, timeout, or request error provides no domain result. '
            + 'Report uncalled or unanswered lookups as unchecked. After an error, make a separate tool call for any requested fallback. '
            + 'Never present examples, expected values, or error codes from the user request as tool results.'
        },
      })
    })
  }

  /**
   * Register one server's status and expose resource tools for connected providers that support resources.
   * @param server - configured server name, unique in this scope.
   * @param provider - connection-owned resource operations.
   * @returns the effect disposer for this exact registration.
   */
  register(server: string, provider: McpResourceProvider): () => void {
    const ctx = this.ctx
    const scope = scopeOf(ctx)
    const dispose = ctx.effect(function* (this: McpResourceRuntime) {
      let disposal: Promise<void> | undefined
      // Tools disappear synchronously; Cordis owns any pending scoped-fiber teardown.
      yield () => disposal
      yield this.layers.effect(ctx, (layer) => {
        const first = layer.servers.isEmpty()
        const remove = layer.servers.insert(server, provider)
        const retainDisposal = (pending: void | Promise<void>): void => {
          if (pending !== undefined) disposal = Promise.all([disposal, pending]).then(() => undefined)
        }
        const disposeScope = (): void => {
          retainDisposal(layer.toolScope?.dispose())
          layer.toolScope = undefined
        }
        const reconcile = (): void => {
          const needed = [...layer.servers.values()].some(entry => (entry.availability?.() ?? 'resources') === 'resources')
          if (needed && layer.disposeTools === undefined && layer.toolScope !== undefined) {
            layer.disposeTools = registerResourceTools(layer.toolScope.ctx,
              (server, request, exec) => this.provider(server, exec).request(request, exec))
          } else if (!needed && layer.disposeTools !== undefined) {
            const disposeTools = layer.disposeTools
            layer.disposeTools = undefined
            retainDisposal(disposeTools())
          }
        }
        try {
          if (first) layer.toolScope = this.createToolScope(scope)
          reconcile()
        } catch (error) {
          remove()
          if (first) disposeScope()
          throw error
        }
        const unsubscribe = provider.onAvailabilityChange?.(reconcile)
        return () => {
          unsubscribe?.()
          remove()
          reconcile()
          if (layer.servers.isEmpty()) disposeScope()
        }
      }, { label: `mcpResources.provider(${server})` })
    }.bind(this), `mcpResources.register(${server})`)
    // oxlint-disable-next-line typescript/no-misused-promises -- visibility cleanup is synchronous; Cordis retains pending fiber disposal
    return dispose
  }

  /** Own one scope's tools independently of its configured server plugins. */
  private createToolScope(scope: ScopeKey | undefined): { ctx: Context; dispose: () => void | Promise<void> } {
    const ctx = this.selfCtx
    let toolCtx = ctx
    const dispose = ctx.effect(function* (this: McpResourceRuntime) {
      if (scope !== undefined) {
        const owned = createScope(ctx, scope)
        yield owned.rawDispose
        toolCtx = owned.ctx
      }
      yield toolCtx.tools.register(defineTool({
        name: 'mcp_server_status',
        description: 'Check the connection of a configured MCP server when its tool is missing or a call fails. This check does not run a server tool.',
        parameters: { server: { type: 'string', required: true, description: 'Configured MCP server name.' } },
        output: {
          schema: { type: 'json' },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        isConcurrencySafe: () => true,
        execute: async ({ server }, exec) => {
          const availability = this.provider(server, exec).availability?.() ?? 'resources'
          return {
            server,
            connected: availability !== 'disconnected',
            resources: availability === 'resources',
            ...availability === 'disconnected' ? {
              message: 'MCP server is disconnected. No lookup was run, and no data was returned. Report the disconnection now and stop until the server is reconnected.',
            } : {},
          }
        },
      }))
    }.bind(this), 'mcpResources.toolScope')
    return { ctx: toolCtx, dispose }
  }

  /** Resolve the caller-visible server before starting any network operation. */
  private provider(server: string, exec: ToolExecution): McpResourceProvider {
    const provider = this.layers.merge(exec.agent, layer => layer.servers).get(server)
    if (!provider) throw new ToolArgsError([`server: MCP resource server "${server}" is unavailable in this agent's scope`])
    return provider
  }
}

export default McpResourceRuntime
