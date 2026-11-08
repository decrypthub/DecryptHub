/** Product memory stores entries in its settings namespace, injects them, and exposes model tools. */
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
  entries: Record<string, { text: string; scope: string; createdAt: string; updatedAt: string }>
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
  ctx.provide('settings', {
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
 * @returns the settled result value.
 */
async function call(ctx: Context, name: string, args: unknown): Promise<unknown> {
  const result = await executeModelToolFixture(ctx, {
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
  return result.value
}

it('writes a memory into the settings namespace and lists it', async () => {
  const { ctx, state } = await fixture()
  const written = await call(ctx, 'memory_write', { text: '用户偏好中文回答', scope: 'user' }) as { id: string; scope: string }
  expect(written.scope).toBe('user')
  expect(state.entries[written.id]?.text).toBe('用户偏好中文回答')
  const listed = await call(ctx, 'memory_list', {}) as { entries: { id: string; text: string }[] }
  expect(listed.entries).toHaveLength(1)
})

it('injects stored memories into the assembled prompt', async () => {
  const { ctx } = await fixture()
  await call(ctx, 'memory_write', { text: '项目要求提交信息用中文', scope: 'project' })
  const assembly = await ctx.systemPrompt.assemble({})
  const sections = assembly.sections.map(section => section.text).join('\n')
  expect(sections).toContain('项目要求提交信息用中文')
})

it('deletes a memory from the settings namespace', async () => {
  const { ctx, state } = await fixture()
  const written = await call(ctx, 'memory_write', { text: '临时事实' }) as { id: string }
  const removed = await call(ctx, 'memory_delete', { id: written.id }) as { removed: boolean }
  expect(removed.removed).toBe(true)
  expect(state.entries[written.id]).toBeUndefined()
})
