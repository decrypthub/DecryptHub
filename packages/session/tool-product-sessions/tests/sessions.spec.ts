/** The session listing tool reports recent sessions newest first. */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { expect, it, onTestFinished } from 'vitest'
import * as productSessions from '../src/index.ts'

/** Build one stub session record. */
function record(id: string, _title: string, updatedAt: string) {
  return { header: { id, createdAt: Date.parse(updatedAt) }, live: false, persisted: true }
}

/**
 * Compose the tool stack over a stub session query service.
 * @returns context.
 */
async function fixture(): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('sessionQuery', {
    readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: id === 's-new' ? '新会话' : '旧会话' } })),
    readSurface: async () => ({ events: [
      { type: 'user/message', content: [{ type: 'text', text: '上次结论是 A' }] },
      { type: 'assistant/message', content: [{ type: 'text', text: '收到' }] },
    ] }),
    listSessions: async () => [
      record('s-old', '旧会话', '2026-11-01T10:00:00Z'),
      record('s-new', '新会话', '2026-11-05T10:00:00Z'),
    ],
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(productSessions, { maxSessions: 20 })
  return ctx
}

/**
 * Call the listing tool through the selected executor.
 * @param ctx - fixture context.
 * @param args - tool arguments.
 * @returns the settled value.
 */
async function call(ctx: Context, args: unknown): Promise<unknown> {
  const result = await executeModelToolFixture(ctx, {
    callId: ToolCallId('call-session-list'), name: 'session_list', arguments: args, signal: new AbortController().signal,
  })
  return result.value
}

it('lists sessions newest first', async () => {
  const ctx = await fixture()
  const value = await call(ctx, {}) as { sessions: { id: string; title: string }[] }
  expect(value.sessions.map(row => row.id)).toEqual(['s-new', 's-old'])
  expect(value.sessions[0]?.title).toBe('新会话')
})

it('honours the requested limit', async () => {
  const ctx = await fixture()
  const value = await call(ctx, { limit: 1 }) as { sessions: unknown[] }
  expect(value.sessions).toHaveLength(1)
})

it('reads trailing messages of one session', async () => {
  const ctx = await fixture()
  const result = await executeModelToolFixture(ctx, {
    callId: ToolCallId('call-session-read'), name: 'session_read',
    arguments: { id: 's-new' }, signal: new AbortController().signal,
  })
  const value = result.value as { messages: { role: string; text: string }[] }
  expect(value.messages.map(message => `${message.role}:${message.text}`)).toEqual(['user:上次结论是 A', 'assistant:收到'])
})
