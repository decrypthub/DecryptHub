/**
 * Product memory: durable, scoped facts stored in this plugin's settings
 * namespace, injected as system-prompt sections and editable by the model and
 * by the schema-driven settings page. Cross-project entries are injected
 * globally; workspace entries are injected only into agents of that workspace.
 * @module @deepseek-ai/dsh-product-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'

/** Cordis plugin name; also the settings namespace the product page edits. */
export const name = 'product-memory'
/** Services this plugin contributes to. */
export const inject = ['systemPrompt', 'tools', 'settings', 'agents']

/** One stored memory entry. */
export interface MemoryEntry {
  /** The remembered fact, one sentence. */
  text: string
  /** `user` applies across projects; `project` applies to one workspace. */
  scope: string
  /** Absolute workspace directory a `project` entry belongs to. */
  workspace?: string
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
  maxSectionChars: z.number().default(2000).volatile(),
  entries: z.dict(z.object({
    text: z.string().role('textarea'),
    scope: z.union([z.const('user'), z.const('project')]).default('user'),
    // Legacy entries carry no workspace; they stay visible everywhere until rewritten.
    workspace: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })).default({}).volatile(),
})

/** Read one configuration value that volatile wrapping may hold. */
function plainValue<T>(value: T | { get(): T }): T {
  return isVolatile(value) ? value.get() : value
}

/** Section order: after workspace guidance and before the skill catalog. */
const SECTION_ORDER = 150

/** Canonical form of a workspace directory for comparison across stored spellings. */
function normalizeWorkspace(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Compare two workspace directories the way the host filesystem does. */
function sameWorkspace(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return normalizeWorkspace(left) === normalizeWorkspace(right)
}

/** Whether one entry belongs in the caller's view. */
function visible(entry: MemoryEntry, scope: 'user' | 'project', workspace: string | undefined): boolean {
  if (entry.scope !== scope) return false
  if (scope === 'user') return true
  // Legacy entries carry no workspace; keep them visible instead of dropping data.
  return entry.workspace === undefined || sameWorkspace(entry.workspace, workspace)
}

/**
 * Render one section from the entries that belong to it.
 * @param entries - stored entries.
 * @param budget - injected character budget.
 * @param scope - `user` for the global section, `project` for one workspace.
 * @param workspace - the workspace whose project entries are rendered.
 * @returns the section text, or an empty string when nothing fits.
 */
function renderSection(entries: Record<string, MemoryEntry>, budget: number, scope: 'user' | 'project', workspace?: string): string {
  const lines: string[] = []
  let used = 0
  for (const [id, entry] of Object.entries(entries)) {
    if (!visible(entry, scope, workspace)) continue
    const line = `- (${entry.scope}) ${entry.text} [id: ${id}]`
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) return ''
  const title = scope === 'user' ? '【产品记忆·可由模型与用户维护】' : '【当前工作区记忆·可由模型与用户维护】'
  return `${title}\n${lines.join('\n')}`
}

/**
 * Register the memory sections and the model-facing memory tools.
 * @param ctx - context providing prompt assembly, the tool registry, agents, and settings.
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

  // Cross-project entries are the same for every assembly, including previews
  // without an agent scope.
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'product-memory',
    order: SECTION_ORDER,
    interpolate: false,
    text: () => renderSection(plainValue(live.entries), plainValue(live.maxSectionChars), 'user'),
  }), 'product-memory.section')

  // Workspace entries are registered in the agent's own prompt scope, so an
  // agent only ever sees the memories of its own workspace.
  const installWorkspaceSection = (agent: Agent): void => {
    agent.ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.section({
        name: 'product-memory:workspace',
        order: SECTION_ORDER,
        interpolate: false,
        text: () => renderSection(plainValue(live.entries), plainValue(live.maxSectionChars), 'project', agent.session.header.cwd),
      })
    })
  }
  for (const agent of ctx.agents.list()) installWorkspaceSection(agent)
  ctx.on('agent/created', ({ agent }) => { installWorkspaceSection(agent) })

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

  /** The visible entries for one caller, in storage order. */
  function visibleEntries(workspace: string | undefined): [string, MemoryEntry][] {
    return Object.entries(live.entries).filter(([, entry]) => visible(entry, 'user', undefined) || visible(entry, 'project', workspace))
  }

  ctx.tools.register(defineTool({
    name: 'memory_write',
    description: 'Store one durable fact worth remembering across sessions, such as a user preference or a project constraint. Keep it one sentence. Omit id to create a new entry; pass an existing id to replace it. Project entries are only injected in the current workspace.',
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
    async execute(args, exec) {
      const scope = args.scope === 'project' ? 'project' : 'user'
      const cwd = exec.agent?.session.header.cwd
      if (scope === 'project' && cwd === undefined) throw new Error('memory_write: project scope requires a workspace')
      const now = new Date().toISOString()
      const id = args.id ?? randomUUID()
      const existing = live.entries[id]
      const entry: MemoryEntry = {
        text: args.text,
        scope,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      if (cwd !== undefined && scope === 'project') entry.workspace = cwd
      await put(id, entry)
      return { id, scope }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: 'List stored product memories visible in this workspace with their ids, scopes, and text. Use it before writing to avoid duplicates.',
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
    execute(_args, exec) {
      const workspace = exec.agent?.session.header.cwd
      return Promise.resolve({
        entries: visibleEntries(workspace).map(([id, entry]) => ({ id, scope: entry.scope, text: entry.text })),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_delete',
    description: 'Delete one stored product memory by id. Use it when the user asks to forget a fact or the entry is obsolete. Entries outside this workspace cannot be removed from here.',
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
    async execute(args, exec) {
      const workspace = exec.agent?.session.header.cwd
      const existing = live.entries[args.id]
      const removed = existing !== undefined && (visible(existing, 'user', undefined) || visible(existing, 'project', workspace))
      if (removed) {
        await ctx.settings.mutate(name, [{ op: 'unset', path: ['entries', args.id] }])
        refresh()
      }
      return { removed }
    },
  }))
}
