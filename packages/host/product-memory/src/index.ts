/**
 * Product memory: durable, scoped facts that the model maintains through tools
 * and that every assembly re-injects as one system-prompt section.
 * @module @deepseek-ai/dsh-product-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { memoryDomainSpec, type MemoryId, type MemoryRecord } from './spec.ts'

/** Cordis plugin name. */
export const name = 'product-memory'
/** Services this plugin contributes to. */
export const inject = ['storageDomain', 'systemPrompt', 'tools']

/** Deployment-varying limits for the injected section. */
export interface Config {
  /** Character budget of the injected memory section; entries beyond it are omitted. */
  maxSectionChars: number
}

/** Validated plugin configuration. */
export const Config = z.object({
  maxSectionChars: z.number().default(2000),
})

/** Section order: after workspace guidance and before the skill catalog. */
const SECTION_ORDER = 150

/**
 * Render the injected section from the current entries.
 * @param table - open entries table.
 * @param budget - injected character budget.
 * @returns the section text, or an empty string when nothing fits.
 */
function renderSection(table: KvTable<MemoryId, MemoryRecord>, budget: number): string {
  const lines: string[] = []
  let used = 0
  for (const [id, record] of table.entries()) {
    const line = `- (${record.scope}) ${record.text} [id: ${id}]`
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
  }
  return lines.length === 0 ? '' : `【产品记忆·可由模型维护】\n${lines.join('\n')}`
}

/**
 * Register the memory section and the model-facing memory tools.
 * @param ctx - context providing storage, prompt assembly, and the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let table: KvTable<MemoryId, MemoryRecord> | undefined
  const opening = ctx.storageDomain.open(memoryDomainSpec)
  const ready = opening.then((domain) => {
    table = domain.table('entries')
  })
  ctx.effect(() => () => {
    void ready.then(async () => {
      const domain = await opening
      domain.close()
    })
  }, 'product-memory.domain')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'product-memory',
    order: SECTION_ORDER,
    text: () => table === undefined ? '' : renderSection(table, config.maxSectionChars),
  }), 'product-memory.section')

  /**
   * Read the open entries table or fail with a startup-race explanation.
   * @returns the entries table.
   */
  async function entries(): Promise<KvTable<MemoryId, MemoryRecord>> {
    await ready
    if (table === undefined) throw new Error('product memory is not available yet')
    return table
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
      const store = await entries()
      const scope = args.scope === 'project' ? 'project' : 'user'
      const now = new Date().toISOString()
      const id = (args.id ?? randomUUID()) as MemoryId
      const existing = store.get(id)
      await store.put(id, {
        text: args.text,
        scope,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
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
    async execute() {
      const store = await entries()
      return {
        entries: Array.from(store.entries(), ([id, record]) => ({ id, scope: record.scope, text: record.text })),
      }
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
      const store = await entries()
      const id = args.id as MemoryId
      const existed = store.get(id) !== undefined
      if (existed) await store.delete(id)
      return { removed: existed }
    },
  }))
}
