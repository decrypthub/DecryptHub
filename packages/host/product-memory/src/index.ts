/**
 * Product memory: durable, scoped facts stored in this plugin's settings
 * namespace, injected as one system-prompt section and editable by the model
 * and by the schema-driven settings page.
 * @module @deepseek-ai/dsh-product-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'

/** Cordis plugin name; also the settings namespace the product page edits. */
export const name = 'product-memory'
/** Services this plugin contributes to. */
export const inject = ['systemPrompt', 'tools', 'settings']

/** One stored memory entry. */
export interface MemoryEntry {
  /** The remembered fact, one sentence. */
  text: string
  /** `user` applies across projects; `project` applies to the current workspace. */
  scope: string
  /** ISO-8601 creation stamp. */
  createdAt: string
  /** ISO-8601 last-write stamp. */
  updatedAt: string
}

/** Deployment-varying limits and stored entries. */
export interface Config {
  /** Character budget of the injected section; entries beyond it are omitted. */
  maxSectionChars: number
  /** Stored entries keyed by id, so one path-addressed edit touches one entry. */
  entries: Record<string, MemoryEntry>
}

/** Validated plugin configuration; the settings page renders this schema. */
export const Config = z.object({
  maxSectionChars: z.number().default(2000),
  entries: z.dict(z.object({
    text: z.string().role('textarea'),
    scope: z.union([z.const('user'), z.const('project')]).default('user'),
    createdAt: z.string(),
    updatedAt: z.string(),
  })).default({}),
})

/** Section order: after workspace guidance and before the skill catalog. */
const SECTION_ORDER = 150

/**
 * Render the injected section from the current entries.
 * @param entries - stored entries.
 * @param budget - injected character budget.
 * @returns the section text, or an empty string when nothing fits.
 */
function renderSection(entries: Record<string, MemoryEntry>, budget: number): string {
  const lines: string[] = []
  let used = 0
  for (const [id, entry] of Object.entries(entries)) {
    const line = `- (${entry.scope}) ${entry.text} [id: ${id}]`
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
  }
  return lines.length === 0 ? '' : `【产品记忆·可由模型与用户维护】\n${lines.join('\n')}`
}

/**
 * Register the memory section and the model-facing memory tools.
 * @param ctx - context providing prompt assembly, the tool registry, and settings.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let live = config

  /** Re-read this namespace after the settings page or another writer changed it. */
  const refresh = (): void => {
    const row = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === name)
    if (row === undefined || typeof row.value !== 'object' || row.value === null) return
    live = row.value as Config
  }
  ctx.on('loader/volatile-update', refresh)

  // Let the settings surface render this namespace from its schema.
  ctx.effect(() => ctx.settings.configure({ auto: true }), 'product-memory.settings')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'product-memory',
    order: SECTION_ORDER,
    text: () => renderSection(live.entries, live.maxSectionChars),
  }), 'product-memory.section')

  /**
   * Write one entry through the settings namespace so the page and the model
   * share one durable source and one revision check.
   * @param id - entry id.
   * @param entry - entry value.
   */
  async function put(id: string, entry: MemoryEntry): Promise<void> {
    await ctx.settings.mutate(name, [{ op: 'set', path: ['entries', id], value: entry }])
    refresh()
  }

  ctx.tools.register(defineTool({
    name: 'memory_write',
    description: 'Store one durable fact worth remembering across sessions, such as a user preference or a project constraint. Keep it one sentence. Omit id to create a new entry; pass an existing id to replace it.',
    parameters: {
      text: { type: 'string', required: true, description: 'The fact to remember, one sentence, in the user language.' },
      scope: { type: 'string', description: 'user for cross-project preferences, project for this workspace only. Defaults to user.' },
      id: { type: 'string', description: 'Existing entry id to replace. Omit to create a new entry.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: 'Stored entry id.' },
          scope: { type: 'string', required: true, description: 'Scope the entry was stored under.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `memory ${value.id} saved (${value.scope})` }],
    },
    async execute(args) {
      const scope = args.scope === 'project' ? 'project' : 'user'
      const now = new Date().toISOString()
      const id = args.id ?? randomUUID()
      const existing = live.entries[id]
      await put(id, { text: args.text, scope, createdAt: existing?.createdAt ?? now, updatedAt: now })
      return { id, scope }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: 'List stored product memories with their ids, scopes, and text. Use it before writing to avoid duplicates.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            description: 'Stored memories in storage order.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                scope: { type: 'string', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? '(no stored memories)'
          : value.entries.map(entry => `${entry.id} (${entry.scope}) ${entry.text}`).join('\n'),
      }],
    },
    execute() {
      return Promise.resolve({
        entries: Object.entries(live.entries).map(([id, entry]) => ({ id, scope: entry.scope, text: entry.text })),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_delete',
    description: 'Delete one stored product memory by id. Use it when the user asks to forget a fact or the entry is obsolete.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id returned by memory_write or memory_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'boolean', required: true, description: 'Whether an entry was removed.' } },
      },
      render: (_args, value) => [{ type: 'text', text: value.removed ? 'memory removed' : 'no such memory' }],
    },
    async execute(args) {
      const existed = live.entries[args.id] !== undefined
      if (existed) {
        await ctx.settings.mutate(name, [{ op: 'unset', path: ['entries', args.id] }])
        refresh()
      }
      return { removed: existed }
    },
  }))
}
