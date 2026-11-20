/**
 * Product memory: durable, scoped facts stored in this plugin's settings
 * namespace, injected as system-prompt sections and editable by the model and
 * by the schema-driven settings page. Cross-project entries are injected
 * globally; workspace entries are injected only into agents of that workspace.
 * @module @deepseek-ai/dsh-product-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SettingsConflictError, type SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { defineTool, ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { isVolatile } from '@deepseek-ai/cosmokit'
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
  /** `user` applies across projects; `project` applies to one workspace. */
  scope: 'user' | 'project'
  /** Original directory for entries written before workspace ids were stored. */
  workspace?: string
  /** Durable workspace identity for a project-scoped entry. */
  workspaceId?: string
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
    workspace: z.string(),
    workspaceId: z.string(),
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

/** Whether one entry belongs in the caller's view. */
function visible(entry: MemoryEntry, workspace: Workspace | undefined): boolean {
  if (entry.scope === 'user') return true
  if (workspace === undefined) return false
  if (entry.workspaceId !== undefined) return entry.workspaceId === workspace.id
  // A registration created later for the same directory cannot inherit the old record.
  return entry.workspace === workspace.path && Date.parse(entry.createdAt) >= Date.parse(workspace.createdAt)
}

/**
 * Render one section from the entries that belong to it.
 * @param entries - stored entries.
 * @param budget - injected character budget.
 * @param scope - `user` for the global section, `project` for one workspace.
 * @param workspace - the workspace whose project entries are rendered.
 * @returns the section text, or an empty string when nothing fits.
 */
function renderSection(entries: Record<string, MemoryEntry>, budget: number, scope: 'user' | 'project', workspace?: Workspace): string {
  const lines: string[] = []
  let used = 0
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.scope !== scope || !visible(entry, workspace)) continue
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

  const namespace = () => {
    const row = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === name)
    if (row === undefined || typeof row.value !== 'object' || row.value === null) return undefined
    return { config: row.value as Config, revision: row.revision }
  }
  const refresh = (): void => { live = namespace()?.config ?? config }
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

  function workspaceOf(sessionId: SessionId | undefined): Workspace | undefined {
    return sessionId === undefined ? undefined : ctx.get('workspaceRegistry')?.list()
      .find(candidate => candidate.sessionIds.includes(sessionId))
  }
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'product-memory:workspace',
    order: SECTION_ORDER,
    interpolate: false,
    text: ({ agent }) => renderSection(plainValue(live.entries), plainValue(live.maxSectionChars), 'project', workspaceOf(agent?.id)),
  }), 'product-memory.workspace-section')

  function editSnapshot() {
    const snapshot = namespace()
    if (snapshot === undefined) throw new ToolContextUnavailableError('Memory settings are unavailable.')
    return { entries: plainValue(snapshot.config.entries), revision: snapshot.revision }
  }

  async function mutate(op: SettingsPathOp, revision: number): Promise<void> {
    try {
      await ctx.settings.mutate(name, [op], revision)
    } catch (cause) {
      if (cause instanceof SettingsConflictError) {
        throw new HarnessError('Memory changed while this edit was being saved. List the current memories and retry.', 'MEMORY_SETTINGS_CONFLICT', { cause })
      }
      throw cause
    }
    refresh()
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'memory_write',
    description: 'Store one durable fact worth remembering across sessions, such as a user preference or a project constraint. Keep it one sentence. Omit id to create an entry. To update a visible entry, pass its id and keep its scope.',
    parameters: {
      text: { type: 'string', required: true, description: 'The fact to remember, one sentence, in the user language.' },
      scope: { type: 'string', enum: ['user', 'project'], description: 'user for cross-project preferences, project for this workspace only. Defaults to user on creation and to the existing scope on update.' },
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
      const workspace = workspaceOf(exec.agent?.id)
      const { entries, revision } = editSnapshot()
      const existing = args.id !== undefined && Object.hasOwn(entries, args.id) ? entries[args.id] : undefined
      if (args.id !== undefined && (existing === undefined || !visible(existing, workspace))) {
        throw new ToolArgsError(['Choose an existing memory visible in this workspace.'])
      }
      const scope = args.scope ?? existing?.scope ?? 'user'
      if (existing !== undefined && scope !== existing.scope) {
        throw new ToolArgsError(['Keep the existing memory scope when updating an entry.'])
      }
      if (scope === 'project' && workspace === undefined) {
        throw new ToolContextUnavailableError('Open a conversation in the intended workspace to save project memory.')
      }
      const now = new Date().toISOString()
      const id = args.id ?? randomUUID()
      const entry: MemoryEntry = {
        text: args.text,
        scope,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...scope === 'project' && workspace !== undefined ? { workspace: workspace.path, workspaceId: workspace.id } : {},
      }
      await mutate({ op: 'set', path: ['entries', id], value: entry }, revision)
      return { id, scope }
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
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
      const workspace = workspaceOf(exec.agent?.id)
      return Promise.resolve({
        entries: Object.entries(plainValue(live.entries)).filter(([, entry]) => visible(entry, workspace))
          .map(([id, entry]) => ({ id, scope: entry.scope, text: entry.text })),
      })
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
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
      const workspace = workspaceOf(exec.agent?.id)
      const { entries, revision } = editSnapshot()
      const existing = Object.hasOwn(entries, args.id) ? entries[args.id] : undefined
      const removed = existing !== undefined && visible(existing, workspace)
      if (removed) {
        await mutate({ op: 'unset', path: ['entries', args.id] }, revision)
      }
      return { removed }
    },
  })))
}
