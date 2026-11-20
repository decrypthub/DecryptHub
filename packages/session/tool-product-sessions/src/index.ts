/**
 * Model-facing session history: list the newest sessions of the calling
 * agent's workspace and read back their user/assistant messages through the
 * shared `ctx.sessionQuery` service. The stored header carries creation time
 * only; the listing says so instead of presenting it as an update time.
 * @module @deepseek-ai/dsh-tool-product-sessions
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'tool-product-sessions'
/** Services used by the plugin. */
export const inject = ['tools', 'sessionQuery']

/** Listing limits. */
export interface Config {
  /** Maximum sessions returned by one call. */
  maxSessions: number
}

/** Validated plugin configuration. */
export const Config = z.object({
  maxSessions: z.number().step(1).min(1).default(20),
})

/** Longest rendered message text per read. */
const MAX_MESSAGE_CHARS = 500

/** One listed session as the tool renders it. */
interface SessionSummary {
  id: string
  title: string
  createdAt: string
}

/**
 * Register the session listing and reading tools.
 * @param ctx - context providing the tool registry and session query.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  function requireWorkspace(sessionId: SessionId | undefined, expected?: WorkspaceId): Workspace {
    const workspace = sessionId === undefined ? undefined : ctx.get('workspaceRegistry')?.list()
      .find(candidate => candidate.sessionIds.includes(sessionId))
    if (workspace === undefined || (expected !== undefined && workspace.id !== expected)) {
      throw new ToolContextUnavailableError('Open a conversation in the intended workspace to read its history.')
    }
    return workspace
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'session_list',
    description: 'List the most recently created sessions in this workspace with their ids, titles, and creation times. Use it when the user refers to earlier work and you need to find which session holds it.',
    parameters: {
      limit: { type: 'number', description: 'How many sessions to return; defaults to the configured maximum.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessions: {
            type: 'array',
            required: true,
            description: 'Sessions ordered by creation time, newest first.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                createdAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.sessions.length === 0
          ? '(no sessions)'
          : value.sessions.map(row => `${row.createdAt} ${row.id} ${row.title}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      const caller = exec.agent?.id
      const { id: workspaceId } = requireWorkspace(caller)
      const records = await ctx.sessionQuery.listSessions(exec.signal)
      const owned = new Set(requireWorkspace(caller, workspaceId).sessionIds)
      const limit = args.limit === undefined ? config.maxSessions : Math.max(1, Math.min(config.maxSessions, args.limit))
      const headers = records.map(record => record.header).filter(header => owned.has(header.id))
        .sort((left, right) => right.createdAt - left.createdAt).slice(0, limit)
      const titles = await ctx.sessionQuery.readTitleSnapshots(headers.map(header => header.id), exec.signal)
      const stillOwned = new Set(requireWorkspace(caller, workspaceId).sessionIds)
      const titleById = new Map(titles.flatMap((entry) => {
        if (entry.status !== 'fulfilled') return []
        const raw: unknown = entry.value.title
        const text = typeof raw === 'string' ? raw : (raw as { text?: string } | undefined)?.text ?? ''
        return [[String(entry.sessionId), text] as const]
      }))
      const sessions: SessionSummary[] = headers.filter(header => stillOwned.has(header.id))
        .map(header => ({
          id: String(header.id),
          title: titleById.get(String(header.id)) ?? '',
          createdAt: new Date(header.createdAt).toISOString(),
        }))
      return { sessions }
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'session_read',
    description: 'Read the last few user and assistant messages of one session in this workspace by id. Use it after session_list when the user asks what an earlier conversation concluded; tool calls and results are omitted.',
    parameters: {
      id: { type: 'string', required: true, description: 'Session id returned by session_list.' },
      limit: { type: 'number', description: 'How many trailing messages to return; defaults to 10.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          messages: {
            type: 'array',
            required: true,
            description: 'Trailing user and assistant messages in model-history order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                role: { type: 'string', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.messages.length === 0
          ? '(no messages)'
          : value.messages.map(message => `${message.role}: ${message.text}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      const caller = exec.agent?.id
      const workspace = requireWorkspace(caller)
      const id = SessionId(args.id)
      const requireMember = (current: Workspace): void => {
        if (!current.sessionIds.includes(id)) throw new ToolArgsError(['Choose a session listed in the current workspace.'])
      }
      requireMember(workspace)
      const surface = await ctx.sessionQuery.readSurface(id)
      exec.signal.throwIfAborted()
      requireMember(requireWorkspace(caller, workspace.id))
      const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(50, args.limit))
      const messages: { role: string; content: readonly ContentBlock[] }[] = []
      for (const event of surface.events) {
        if (event.type === 'user/message') messages.push({ role: event.data.role, content: event.data.content })
        else if (event.type === 'assistant/message') messages.push({ role: event.data.message.role, content: event.data.message.content })
      }
      const rendered = messages.map(message => ({
        role: message.role,
        text: message.content
          .map(block => block.type === 'text' ? block.text : '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_MESSAGE_CHARS),
      })).filter(message => message.text.length > 0)
      return { messages: rendered.slice(-limit) }
    },
  })))
}
