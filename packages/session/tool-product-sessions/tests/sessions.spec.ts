/** The session tools list one workspace and read real user/assistant message text. */
import { Context } from '@deepseek-ai/cordis'
import { MessageId, ToolCallId, freezeMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { expect, it, onTestFinished } from 'vitest'
import * as productSessions from '../src/index.ts'

/** One stored user message in the shape the JSONL backend actually returns. */
function userEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: freezeMessage({
      id: MessageId(`user-${seq}`),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
  }
}

/** One stored assistant message in the shape the JSONL backend actually returns. */
function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: freezeMessage({
        id: MessageId(`assistant-${seq}`),
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      stream: [],
    },
  }
}

/**
 * Compose the tool stack over a stub session query with three sessions:
 * two in `C:\work\app` and one in `C:\work\other`.
 * @returns context.
 */
async function fixture(): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('sessionQuery', {
    listSessions: async () => [
      { header: { id: 'session-old', createdAt: Date.parse('2026-11-01T10:00:00Z'), cwd: 'C:\\work\\app' }, live: false, persisted: true },
      { header: { id: 'session-new', createdAt: Date.parse('2026-11-05T10:00:00Z'), cwd: 'C:\\work\\app' }, live: false, persisted: true },
      { header: { id: 'session-other', createdAt: Date.parse('2026-11-06T10:00:00Z'), cwd: 'C:\\work\\other' }, live: false, persisted: true },
    ],
    readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
      sessionId: id,
      status: 'fulfilled',
      value: { title: id === 'session-new' ? '新会话' : '旧会话' },
    })),
    readSurface: async (id: string) => ({
      session: { cwd: id === 'session-other' ? 'C:\\work\\other' : 'C:\\work\\app' },
      events: [userEvent(1, '上次结论是 A'), assistantEvent(2, '收到')],
    }),
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(productSessions, { maxSessions: 20 })
  return ctx
}

/**
 * Call one tool through the selected executor.
 * @param ctx - fixture context.
 * @param name - tool name.
 * @param args - tool arguments.
 * @param agent - optional calling agent whose workspace scopes the call.
 * @returns the settled execution result.
 */
async function call(ctx: Context, name: string, args: unknown, agent?: unknown) {
  return executeModelToolFixture(ctx, {
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent: agent as never },
  })
}

it('lists only the calling workspace, newest created first', async () => {
  const ctx = await fixture()
  const result = await call(ctx, 'session_list', {}, { session: { header: { cwd: 'C:\\work\\app' } } })
  const value = result.value as { sessions: { id: string; title: string; createdAt: string }[] }
  expect(value.sessions.map(row => row.id)).toEqual(['session-new', 'session-old'])
  expect(value.sessions[0]?.title).toBe('新会话')
  expect(value.sessions[0]?.createdAt).toBe('2026-11-05T10:00:00.000Z')
})

it('lists every workspace when the caller has no workspace', async () => {
  const ctx = await fixture()
  const result = await call(ctx, 'session_list', {})
  const value = result.value as { sessions: { id: string }[] }
  expect(value.sessions.map(row => row.id)).toEqual(['session-other', 'session-new', 'session-old'])
})

it('honours the requested limit', async () => {
  const ctx = await fixture()
  const result = await call(ctx, 'session_list', { limit: 1 }, { session: { header: { cwd: 'C:\\work\\app' } } })
  expect((result.value as { sessions: unknown[] }).sessions).toHaveLength(1)
})

it('reads trailing user and assistant messages from the stored event payload', async () => {
  const ctx = await fixture()
  const result = await call(ctx, 'session_read', { id: 'session-new' }, { session: { header: { cwd: 'C:\\work\\app' } } })
  const value = result.value as { messages: { role: string; text: string }[] }
  expect(value.messages.map(message => `${message.role}:${message.text}`)).toEqual(['user:上次结论是 A', 'assistant:收到'])
})

it('refuses to read a session from another workspace', async () => {
  const ctx = await fixture()
  const result = await call(ctx, 'session_read', { id: 'session-other' }, { session: { header: { cwd: 'C:\\work\\app' } } })
  expect(result.isError).toBe(true)
})
