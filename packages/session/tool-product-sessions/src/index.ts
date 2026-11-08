/**
 * Model-facing session history: list recent sessions with their titles and
 * timestamps through the shared `ctx.sessionQuery` service.
 * @module @deepseek-ai/dsh-tool-product-sessions
 */

import type { Context } from '@deepseek-ai/cordis'
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
  updatedAt: string
}

/**
 * Register the session listing tool.
 * @param ctx - context providing the tool registry and session query.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'session_list',
    description: 'List the most recently updated sessions in this workspace with their ids, titles, and update times. Use it when the user refers to earlier work and you need to find which session holds it.',
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
            description: 'Sessions ordered by update time, newest first.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                updatedAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.sessions.length === 0
          ? '(no sessions)'
          : value.sessions.map(row => `${row.updatedAt} ${row.id} ${row.title}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      const records = await ctx.sessionQuery.listSessions(exec.signal)
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
          updatedAt: new Date(record.header.createdAt).toISOString(),
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
      return { sessions }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'session_read',
    description: 'Read the last few messages of one session by id, as role and text pairs. Use it after session_list when the user asks what an earlier conversation concluded.',
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
            description: 'Trailing messages in model-history order.',
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
    async execute(args) {
      const surface = await ctx.sessionQuery.readSurface(args.id as Parameters<typeof ctx.sessionQuery.readSurface>[0])
      const limit = args.limit === undefined ? 10 : Math.max(1, Math.min(50, args.limit))
      const tail = surface.events.slice(-limit)
      return {
        messages: tail.map((event) => {
          const blocks = (event as { content?: readonly { text?: unknown }[] }).content ?? []
          const text = blocks
            .map(block => typeof block.text === 'string' ? block.text : '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_MESSAGE_CHARS)
          return { role: (event as { type: string }).type.split('/')[0] ?? 'event', text }
        }).filter(message => message.text.length > 0),
      }
    },
  }))
}
