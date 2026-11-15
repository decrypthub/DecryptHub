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
  entries: Record<string, { text: string; scope: string; workspace?: string; createdAt: string; updatedAt: string }>
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
async function fixture(): Promise<{ ctx: Context; state: StubState }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const state: StubState = { maxSectionChars: 2000, entries: {} }
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [{ ns: 'product-memory', value: state, revision: 1, applies: 'live', autoGenerate: true, schema: {} }],
    mutate: async (_ns: string, ops: readonly PathOp[]) => {
      for (const op of ops) {
        const key = op.path[1]
        if (key === undefined) continue
        if (op.op === 'set') state.entries[key] = op.value as StubState['entries'][string]
        else state.entries = Object.fromEntries(Object.entries(state.entries).filter(([entryId]) => entryId !== key))
      }
    },
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(productMemory, { maxSectionChars: 2000, entries: {} })
  return { ctx, state }
}

/**
 * Call one memory tool through the selected executor.
 * @param ctx - fixture context.
 * @param name - tool name.
 * @param args - tool arguments.
 * @param cwd - calling workspace, when the test simulates an agent.
 * @returns the settled execution result.
 */
async function call(ctx: Context, name: string, args: unknown, cwd?: string) {
  return executeModelToolFixture(ctx, {
    callId: ToolCallId(`call-${name}-${cwd ?? 'none'}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...cwd === undefined ? {} : { agent: { session: { header: { cwd } } } as never },
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
  await call(ctx, 'memory_write', { text: 'A 工作区约束', scope: 'project' }, 'C:\\work\\a')
  await call(ctx, 'memory_write', { text: '全局偏好', scope: 'user' })
  const text = (await ctx.systemPrompt.assemble({})).sections.map(section => section.text).join('\n')
  expect(text).toContain('全局偏好')
  expect(text).not.toContain('A 工作区约束')
})

it('lists and deletes only memories of the calling workspace', async () => {
  const { ctx } = await fixture()
  await call(ctx, 'memory_write', { text: 'A 工作区约束', scope: 'project' }, 'C:\\work\\a')
  await call(ctx, 'memory_write', { text: 'B 工作区约束', scope: 'project' }, 'C:\\work\\b')

  const inA = await call(ctx, 'memory_list', {}, 'C:\\work\\a')
  expect((inA.value as { entries: { text: string }[] }).entries.map(entry => entry.text)).toEqual(['A 工作区约束'])
  const inB = await call(ctx, 'memory_list', {}, 'C:\\work\\b')
  expect((inB.value as { entries: { text: string }[] }).entries.map(entry => entry.text)).toEqual(['B 工作区约束'])
  const withoutWorkspace = await call(ctx, 'memory_list', {})
  expect((withoutWorkspace.value as { entries: unknown[] }).entries).toHaveLength(0)

  const id = (await call(ctx, 'memory_write', { text: 'A 工作区约束 2', scope: 'project' }, 'C:\\work\\a')).value as { id: string }
  expect((await call(ctx, 'memory_delete', { id: id.id }, 'C:\\work\\b')).value).toEqual({ removed: false })
  expect((await call(ctx, 'memory_delete', { id: id.id }, 'C:\\work\\a')).value).toEqual({ removed: true })
})

it('refuses a project memory when the caller has no workspace', async () => {
  const { ctx } = await fixture()
  const result = await call(ctx, 'memory_write', { text: '没有工作区', scope: 'project' })
  expect(result.isError).toBe(true)
})
