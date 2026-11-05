import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import * as Integration from '../src/index.ts'

const signal = new AbortController().signal

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'decrypthub-mcp-'))
  const first = join(directory, 'first'), second = join(directory, 'second')
  await Promise.all([mkdir(first), mkdir(second)])
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(McpManager)
  const harness = await mountAgentLoopTestHarness(ctx)
  const plugin = ctx.plugin(Integration, {
    wdh: { enabled: true, entry: fileURLToPath(new URL('./fixture-server.ts', import.meta.url)), dataDirectory: join(directory, 'profiles') },
  })
  await plugin.await()
  const agent = await harness.create(SessionId('first-agent'), {}, { cwd: first })
  return { ctx, harness, plugin, agent, first, second }
}

async function step(ctx: Context, agent: Agent): Promise<void> {
  const next = { kind: 'enter' as const, messages: [] }
  const result = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: [], turn: 1, step: 1, signal, modelSelection: { provider: 'fixture', model: 'fixture' },
  }, async () => next)
  expect(result).toBe(next)
}

async function workspace(ctx: Context, agent: Agent) {
  return executeToolFixture(ctx, { signal, agent, callId: ToolCallId('workspace-call'), name: 'mcp__wdh__workspace', arguments: {} })
}

describe('DecryptHub MCP composition', () => {
  it('binds two real stdio processes to their own Agent workspaces and retires them on unload', async () => {
    const { ctx, harness, plugin, agent, first, second } = await setup()
    const other = await harness.create(SessionId('second-agent'), {}, { cwd: second })
    await Promise.all([step(ctx, agent), step(ctx, other)])
    const one = await workspace(ctx, agent), two = await workspace(ctx, other)
    expect(one.isError).toBeFalsy()
    expect(two.isError).toBeFalsy()
    expect(JSON.stringify(one)).toContain(first)
    expect(JSON.stringify(two)).toContain(second)
    await plugin.dispose()
    expect((await workspace(ctx, agent)).isError).toBe(true)
    expect((await workspace(ctx, other)).isError).toBe(true)
  })

  it('denies the old directory immediately and reconnects before the next step', async () => {
    const { ctx, agent, first, second } = await setup()
    await step(ctx, agent)
    expect(JSON.stringify(await workspace(ctx, agent))).toContain(first)
    await ctx.workingDirectory.set(agent, second, signal)
    const stale = await workspace(ctx, agent)
    expect(stale.isError).toBe(true)
    expect(JSON.stringify(stale)).toContain('workspace changed')
    const resource = await executeToolFixture(ctx, { signal, agent, callId: ToolCallId('resource-call'), name: 'read_mcp_resource', arguments: { server: 'wdh', uri: 'file:///old' } })
    expect(resource.isError).toBe(true)
    expect(JSON.stringify(resource)).toContain('workspace changed')
    await step(ctx, agent)
    const current = await workspace(ctx, agent)
    expect(current.isError).toBeFalsy()
    expect(JSON.stringify(current)).toContain(second)
  })

  it('starts no device server unless enabled and rejects an ambiguous WDH installation', async () => {
    const config = Integration.Config({}).get()
    expect(config.adh.enabled).toBe(false)
    expect(config.idh.enabled).toBe(false)
    expect(config.wdh.enabled).toBe(false)
    await expect(Integration.apply(new Context(), Integration.Config({ wdh: { enabled: true } }))).rejects.toThrow('absolute paths')
  })
})
