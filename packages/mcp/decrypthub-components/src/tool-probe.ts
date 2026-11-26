/** Count the tools of one installed official component without registering a connection. */
import { probeServer } from '@deepseek-ai/dsh-mcp-client/src/probe.ts'
import type { Context } from '@deepseek-ai/cordis'

/**
 * Run one component's MCP server briefly and list the tools it advertises.
 * @param ctx - service context that owns subprocess access.
 * @param command - executable to start (the bundled Node for managed components).
 * @param cwd - working directory for the child process.
 * @param args - arguments that select the MCP server mode.
 * @param env - environment the real connection would pass to this component.
 * @returns advertised raw tool names, or null when the probe fails.
 */
export async function probeTools(ctx: Context, command: string, cwd: string, args: readonly string[],
  env: Record<string, string> = {}): Promise<string[] | null> {
  const result = await probeServer(ctx, {
    transport: 'stdio', serverName: 'component-probe', command, args: [...args], env, cwd,
    toolCallTimeoutMs: 20_000, closeTimeoutMs: 5_000, expandTemplates: false, failOnStartupError: false,
    startupTimeoutMs: 30_000, toolLoading: 'eager', catalogDescriptionMaxLength: 160,
  })
  return result.ok ? result.toolNames : null
}
