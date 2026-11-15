/**
 * Model-facing session history: list the newest sessions of the calling
 * agent's workspace and read back their user/assistant messages through the
 * shared `ctx.sessionQuery` service. The stored header carries creation time
 * only; the listing says so instead of presenting it as an update time.
 * @module @deepseek-ai/dsh-tool-product-sessions
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import { defineTool } from '@deepseek-ai/dsh-tools'
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

/** Canonical form of a workspace directory for comparison across stored spellings. */
function normalizeWorkspace(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Compare two workspace directories the way the host filesystem does.
 * @param left - one session's stored cwd, when it has one.
 * @param right - the calling agent's cwd, when it has one.
 * @returns whether the sessions belong to the same workspace scope.
 */
function sameWorkspace(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return true
  return normalizeWorkspace(left) === normalizeWorkspace(right)
}

/**
 * Register the session listing and reading tools.
 * @param ctx - context providing the tool registry and session query.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
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
      const cwd = exec.agent?.session.header.cwd
      const records = (await ctx.sessionQuery.listSessions(exec.signal))
        .filter(record => sameWorkspace(record.header.cwd, cwd))
      const titles = await ctx.sessionQuery.readTitleSnapshots(records.map(record => record.header.id), exec.signal)
      const titleById = new Map(titles.flatMap((entry) => {
        if (entry.status !== 'fulfilled') return []
        const raw: unknown = entry.value.title
        const text = typeof raw === 'string' ? raw : (raw as { text?: string } | undefined)?.text ?? ''
        return [[String(entry.sessionId), text] as const]
      }))
      const limit = args.limit === undefined ? config.maxSessions : Math.max(1, Math.min(config.maxSessions, args.limit))
      const sessions: SessionSummary[] = records
        .map(record => ({
          id: String(record.header.id),
          title: titleById.get(String(record.header.id)) ?? '',
          createdAt: new Date(record.header.createdAt).toISOString(),
        }))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
      return { sessions }
    },
  }))

  ctx.tools.register(defineTool({
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
      const id = args.id as Parameters<typeof ctx.sessionQuery.readSurface>[0]
      const surface = await ctx.sessionQuery.readSurface(id)
      const cwd = exec.agent?.session.header.cwd
      if (!sameWorkspace(surface.session.cwd, cwd)) {
        throw new Error(`session_read: session "${args.id}" belongs to another workspace`)
      }
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
  }))
}
