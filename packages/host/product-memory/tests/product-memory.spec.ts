/** Product memory stores entries, injects them into the prompt, and exposes model tools. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import * as productMemory from '../src/index.ts'

/**
 * Compose the storage, prompt, and tool stack the plugin needs.
 * @returns Context with the plugin mounted.
 */
async function fixture(): Promise<Context> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-product-memory-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(productMemory, { maxSectionChars: 2000 })
  return ctx
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

it('stores a written memory and lists it', async () => {
  const ctx = await fixture()
  const written = await call(ctx, 'memory_write', { text: '用户偏好中文回答', scope: 'user' }) as { id: string; scope: string }
  expect(written.scope).toBe('user')
  const listed = await call(ctx, 'memory_list', {}) as { entries: { id: string; text: string }[] }
  expect(listed.entries).toHaveLength(1)
  expect(listed.entries[0]?.text).toBe('用户偏好中文回答')
})

it('injects stored memories into the assembled prompt', async () => {
  const ctx = await fixture()
  await call(ctx, 'memory_write', { text: '项目要求提交信息用中文', scope: 'project' })
  const assembly = await ctx.systemPrompt.assemble({})
  const sections = assembly.sections.map(section => section.text).join('\n')
  expect(sections).toContain('项目要求提交信息用中文')
})

it('deletes a stored memory', async () => {
  const ctx = await fixture()
  const written = await call(ctx, 'memory_write', { text: '临时事实' }) as { id: string }
  const removed = await call(ctx, 'memory_delete', { id: written.id }) as { removed: boolean }
  expect(removed.removed).toBe(true)
  const listed = await call(ctx, 'memory_list', {}) as { entries: unknown[] }
  expect(listed.entries).toHaveLength(0)
})
