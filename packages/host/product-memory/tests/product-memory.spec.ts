/** Product memory scopes entries per workspace, injects them, and exposes model tools. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { expect, it, onTestFinished } from 'vitest'
import * as productMemory from '../src/index.ts'

/** Settings state the stub serves, shaped like the plugin's namespace value. */
interface StubState {
  maxSectionChars: number
  entries: Record<string, productMemory.MemoryEntry>
}

/** One path edit as the settings service receives it. */
interface PathOp {
  op: 'set' | 'unset'
  path: readonly string[]
  value?: unknown
}

/**
 * Compose the prompt and tool stack with a settings stub serving this namespace.
 * @returns Context with the plugin mounted and the stub state.
 */
async function fixture(entries: StubState['entries'] = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const state: StubState = { maxSectionChars: 2000, entries }
  const workspaces = [
    { id: 'workspace-a', path: 'C:\\work\\a', sessionIds: ['chat-a'], createdAt: '2026-11-01T00:00:00Z' },
    { id: 'workspace-b', path: 'C:\\work\\b', sessionIds: ['chat-b'], createdAt: '2026-11-02T00:00:00Z' },
  ]
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  let revision = 1
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [{ ns: 'product-memory', value: state, revision, applies: 'live', autoGenerate: true, schema: {} }],
    mutate: async (_ns: string, ops: readonly PathOp[], expectedRevision?: number) => {
      if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error('Stale settings revision')
      for (const op of ops) {
        const key = op.path[1]
        if (key === undefined) continue
        if (op.op === 'set') state.entries[key] = op.value as StubState['entries'][string]
        else state.entries = Object.fromEntries(Object.entries(state.entries).filter(([entryId]) => entryId !== key))
      }
      revision++
    },
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  const plugin = ctx.plugin(productMemory, { maxSectionChars: 2000, entries })
  await plugin.await()
  return { ctx, state, workspaces, plugin }
}

const agentA = { id: 'chat-a', session: { header: { cwd: 'C:\\work\\a' } } }
const agentB = { id: 'chat-b', session: { header: { cwd: 'C:\\work\\b' } } }
const detached = { id: 'chat-detached', session: agentA.session }

/**
 * Call one memory tool through the selected executor.
 * @param ctx - fixture context.
 * @param name - tool name.
 * @param args - tool arguments.
 * @param agent - calling agent whose membership determines the workspace.
 * @returns the settled execution result.
 */
async function call(ctx: Context, name: string, args: unknown, agent?: typeof agentA) {
  return executeModelToolFixture(ctx, {
    callId: ToolCallId(`call-${name}-${agent?.id ?? 'none'}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent: agent as never },
  })
}

it('writes a memory into the settings namespace and lists it', async () => {
  const { ctx, state } = await fixture()
  const result = await call(ctx, 'memory_write', { text: '用户偏好中文回答', scope: 'user' })
  const written = result.value as { id: string; scope: string }
  expect(written.scope).toBe('user')
  expect(state.entries[written.id]?.text).toBe('用户偏好中文回答')
  const listed = await call(ctx, 'memory_list', {})
  expect((listed.value as { entries: unknown[] }).entries).toHaveLength(1)
})

it('injects cross-project memories without interpolating braces', async () => {
  const { ctx } = await fixture()
  await call(ctx, 'memory_write', { text: '模板 {{unknown}} 保持原样', scope: 'user' })
  const assembly = await ctx.systemPrompt.assemble({})
  expect(assembly.sections.map(section => section.text).join('\n')).toContain('模板 {{unknown}} 保持原样')
})

it('keeps project memories out of the cross-project section', async () => {
  const { ctx } = await fixture()
  await call(ctx, 'memory_write', { text: 'A 工作区约束', scope: 'project' }, agentA)
  await call(ctx, 'memory_write', { text: '全局偏好', scope: 'user' })
  const text = (await ctx.systemPrompt.assemble({})).sections.map(section => section.text).join('\n')
  expect(text).toContain('全局偏好')
  expect(text).not.toContain('A 工作区约束')
})

it('lists and deletes only memories of the calling workspace', async () => {
  const { ctx } = await fixture()
  await call(ctx, 'memory_write', { text: 'A 工作区约束', scope: 'project' }, agentA)
  await call(ctx, 'memory_write', { text: 'B 工作区约束', scope: 'project' }, agentB)

  const inA = await call(ctx, 'memory_list', {}, agentA)
  expect((inA.value as { entries: { text: string }[] }).entries.map(entry => entry.text)).toEqual(['A 工作区约束'])
  const inB = await call(ctx, 'memory_list', {}, agentB)
  expect((inB.value as { entries: { text: string }[] }).entries.map(entry => entry.text)).toEqual(['B 工作区约束'])
  const withoutWorkspace = await call(ctx, 'memory_list', {})
  expect((withoutWorkspace.value as { entries: unknown[] }).entries).toHaveLength(0)

  const id = (await call(ctx, 'memory_write', { text: 'A 工作区约束 2', scope: 'project' }, agentA)).value as { id: string }
  expect((await call(ctx, 'memory_delete', { id: id.id }, agentB)).value).toEqual({ removed: false })
  expect((await call(ctx, 'memory_delete', { id: id.id }, agentA)).value).toEqual({ removed: true })
})

it.each([undefined, detached])('requires workspace membership for project writes', async (agent) => {
  const { ctx } = await fixture()
  const result = await call(ctx, 'memory_write', { text: '没有工作区', scope: 'project' }, agent)
  expect(result).toMatchObject({ isError: true, error: { info: { code: 'TOOL_CONTEXT_UNAVAILABLE' } } })
})

it('keeps project ownership on update and rejects writes from other accounts', async () => {
  const { ctx, state } = await fixture()
  const result = await call(ctx, 'memory_write', { text: 'A 约束', scope: 'project' }, agentA)
  const { id } = result.value as { id: string }
  const denied = { isError: true, error: { info: { code: 'INVALID_ARGS' } } }
  expect(await call(ctx, 'memory_write', { id, text: 'B 的修改' }, agentB)).toMatchObject(denied)
  expect(await call(ctx, 'memory_write', { id, text: '已改为全局', scope: 'user' }, agentA)).toMatchObject(denied)
  expect(await call(ctx, 'memory_write', { id, text: 'A 的修改' }, agentA)).toMatchObject({ value: { id, scope: 'project' } })
  expect(state.entries[id]).toMatchObject({ text: 'A 的修改', workspaceId: 'workspace-a' })
})

it('keeps earlier project records only when their original account can be identified', async () => {
  const stamp = { scope: 'project' as const, createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z' }
  const { ctx, state, workspaces } = await fixture({
    orphan: { ...stamp, text: '未分配' },
    previous: { ...stamp, text: '旧工作区', workspace: 'C:\\work\\b', createdAt: '2026-10-01T00:00:00Z' },
    existing: { ...stamp, text: '已分配', workspace: 'C:\\work\\a' },
  })
  expect(await call(ctx, 'memory_list', {}, agentA)).toMatchObject({ value: { entries: [{ id: 'existing', text: '已分配' }] } })
  expect(await call(ctx, 'memory_list', {}, agentB)).toMatchObject({ value: { entries: [] } })
  expect(await call(ctx, 'memory_list', {}, detached)).toMatchObject({ value: { entries: [] } })
  await call(ctx, 'memory_write', { id: 'existing', text: '已更新' }, agentA)
  expect(state.entries.existing?.workspaceId).toBe('workspace-a')
  expect(state.entries.orphan?.text).toBe('未分配')
  workspaces[0]!.id = 'workspace-a-recreated'
  expect(await call(ctx, 'memory_list', {}, agentA)).toMatchObject({ value: { entries: [] } })
})

it('injects project memory only for its member sessions and removes contributions on disposal', async () => {
  const { ctx, plugin } = await fixture()
  await call(ctx, 'memory_write', { text: '工作区记录', scope: 'project' }, agentA)
  const text = async (agent: typeof agentA) => (await ctx.systemPrompt.assemble({ agent: agent as never })).sections.map(section => section.text).join('\n')
  expect(await text(agentA)).toContain('工作区记录')
  expect(await text(agentB)).not.toContain('工作区记录')
  expect(await text(detached)).not.toContain('工作区记录')
  await plugin.dispose()
  expect(ctx.tools.get('memory_list')).toBeUndefined()
  expect(await text(agentA)).not.toContain('工作区记录')
})
