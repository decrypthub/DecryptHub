/** The session tools list one workspace and read real user/assistant message text. */
import { Context } from '@deepseek-ai/cordis'
import { MessageId, ToolCallId, freezeMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { expect, it, onTestFinished, vi } from 'vitest'
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
 * Compose the tool stack with explicit accounts and one ungrouped session.
 * @returns context and the transcript reader.
 */
async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const readSurface = vi.fn(async (id: string) => ({
    session: { cwd: id === 'session-other' ? 'C:\\work\\other' : 'C:\\work\\app' },
    events: [userEvent(1, '上次结论是 A'), assistantEvent(2, '收到')],
  }))
  ctx.provide('workspaceRegistry', {
    list: () => [
      { id: 'workspace-app', sessionIds: ['session-old', 'session-new'] },
      { id: 'workspace-other', sessionIds: ['session-other'] },
    ],
  } as never)
  ctx.provide('sessionQuery', {
    listSessions: async () => [
      { header: { id: 'session-old', createdAt: Date.parse('2026-11-01T10:00:00Z'), cwd: 'C:\\work\\app' }, live: false, persisted: true },
      { header: { id: 'session-new', createdAt: Date.parse('2026-11-05T10:00:00Z'), cwd: 'C:\\work\\app' }, live: false, persisted: true },
      { header: { id: 'session-other', createdAt: Date.parse('2026-11-06T10:00:00Z'), cwd: 'C:\\work\\other' }, live: false, persisted: true },
      { header: { id: 'session-ungrouped', createdAt: Date.parse('2026-11-07T10:00:00Z') }, live: false, persisted: true },
      { header: { id: 'session-detached', createdAt: Date.parse('2026-11-08T10:00:00Z'), cwd: 'C:\\work\\app' }, live: false, persisted: true },
    ],
    readTitleSnapshots: async (ids: readonly string[]) => ids.map(id => ({
      sessionId: id,
      status: 'fulfilled',
      value: { title: id === 'session-new' ? '新会话' : '旧会话' },
    })),
    readSurface,
  } as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(productSessions, { maxSessions: 20 })
  return { ctx, readSurface }
}

const grouped = { id: 'session-old', session: { header: { cwd: 'C:\\work\\app' } } }
const detached = { id: 'session-detached', session: grouped.session }

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
  const { ctx } = await fixture()
  const result = await call(ctx, 'session_list', {}, grouped)
  const value = result.value as { sessions: { id: string; title: string; createdAt: string }[] }
  expect(value.sessions.map(row => row.id)).toEqual(['session-new', 'session-old'])
  expect(value.sessions[0]?.title).toBe('新会话')
  expect(value.sessions[0]?.createdAt).toBe('2026-11-05T10:00:00.000Z')
})

it.each([undefined, detached])('requires a workspace account before listing or opening history', async (agent) => {
  const { ctx, readSurface } = await fixture()
  const expected = { isError: true, error: { info: { code: 'TOOL_CONTEXT_UNAVAILABLE' } } }
  expect(await call(ctx, 'session_list', {}, agent)).toMatchObject(expected)
  expect(await call(ctx, 'session_read', { id: 'session-new' }, agent)).toMatchObject(expected)
  expect(readSurface).not.toHaveBeenCalled()
})

it('honours the requested limit', async () => {
  const { ctx } = await fixture()
  const result = await call(ctx, 'session_list', { limit: 1 }, grouped)
  expect((result.value as { sessions: unknown[] }).sessions).toHaveLength(1)
})

it('reads trailing user and assistant messages from the stored event payload', async () => {
  const { ctx } = await fixture()
  const result = await call(ctx, 'session_read', { id: 'session-new' }, grouped)
  const value = result.value as { messages: { role: string; text: string }[] }
  expect(value.messages.map(message => `${message.role}:${message.text}`)).toEqual(['user:上次结论是 A', 'assistant:收到'])
})

it.each(['session-other', 'session-detached', 'session-ungrouped'])('checks ownership before opening %s', async (id) => {
  const { ctx, readSurface } = await fixture()
  const result = await call(ctx, 'session_read', { id }, grouped)
  expect(result).toMatchObject({ isError: true, error: { info: { code: 'INVALID_ARGS' } } })
  expect(readSurface).not.toHaveBeenCalled()
})
