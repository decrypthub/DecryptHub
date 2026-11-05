/** Browser input validation and reviewable imports; the Host validates every persisted entry again. */
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const strings = z.record(z.string(), z.string())
const entry = z.object({
  transport: z.enum(['stdio', 'streamable-http']),
  command: z.string().optional(), args: z.array(z.string()).optional(), env: strings.optional(), cwd: z.string().optional(),
  url: z.string().optional(), headers: strings.optional(), enabled: z.boolean().optional(),
  startupTimeoutMs: z.number().int().positive().optional(), toolCallTimeoutMs: z.number().int().positive().optional(),
  closeTimeoutMs: z.number().int().positive().optional(),
  reconnect: z.record(z.string(), z.json()).optional(),
}).strict()
/** Fields accepted by the management editor and preserved on edits. */
export type McpEntry = z.infer<typeof entry>
/** One review row; rejected entries cannot be imported. */
export interface McpImportRow {
  name: string
  config?: McpEntry
  issue?: 'name' | 'unsupported' | 'invalid' | 'conflict'
}
/** Server names reserved for product-owned connections. */
export const OFFICIAL_MCP_NAMES: readonly string[] = ['wdh', 'adh', 'idh']

/** Check whether a name can identify a custom MCP server.
 * @param value - candidate instance name.
 * @returns whether the manager can own this custom name. */
export function validMcpName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) && !OFFICIAL_MCP_NAMES.includes(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value)
}

/**
 * Validate one editor entry, including fields specific to its transport.
 * @param value - parsed editor input.
 * @returns accepted fields, or undefined for incompatible input.
 */
export function parseMcpEntry(value: unknown): McpEntry | undefined {
  const parsed = entry.safeParse(value)
  if (!parsed.success) return undefined
  const config = parsed.data
  if (config.transport === 'stdio') {
    if (!config.command?.trim() || config.url || Object.keys(config.headers ?? {}).length) return undefined
  } else {
    if (config.command || config.args?.length || Object.keys(config.env ?? {}).length || config.cwd) return undefined
    try {
      const url = new URL(config.url ?? '')
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) return undefined
    } catch (_error) { return undefined }
  }
  return config
}

/**
 * Review Claude/Cursor-style JSON without overwriting names or launching imported programs.
 * @param text - complete import document.
 * @param existing - names already configured or contributed by plugins.
 * @returns one row per input server, including explicit incompatibilities.
 */
export function reviewMcpImport(text: string, existing: readonly string[]): McpImportRow[] {
  if (text.length > 1_048_576) throw new Error('import-size')
  const document: unknown = JSON.parse(text)
  const object = z.record(z.string(), z.unknown()).parse(document)
  const servers = z.record(z.string(), z.unknown()).parse(object.mcpServers ?? object['mcp-servers'] ?? object)
  if (Object.keys(servers).length > 100) throw new Error('import-count')
  return Object.entries(servers).map(([name, raw]) => {
    if (!validMcpName(name)) return { name, issue: 'name' }
    const parsed = z.record(z.string(), z.unknown()).safeParse(raw)
    if (!parsed.success) return { name, issue: 'invalid' }
    const { type, disabled: _disabled, ...rest } = parsed.data
    const transport = rest.transport ?? type ?? (rest.url ? 'streamable-http' : 'stdio')
    if (typeof transport !== 'string' || !['stdio', 'http', 'streamable-http'].includes(transport)) return { name, issue: 'unsupported' }
    const config = parseMcpEntry({ ...rest, transport: transport === 'http' ? 'streamable-http' : transport, enabled: false })
    if (config === undefined) return { name, issue: 'invalid' }
    return existing.includes(name) ? { name, config, issue: 'conflict' } : { name, config }
  })
}

/** Convert a validated editor value into the Settings wire's JSON value.
 * @param config - entry accepted by parseMcpEntry.
 * @returns JSON suitable for a path write.
 */
export function mcpEntryJson(config: McpEntry): JsonValue { return JSON.parse(JSON.stringify(config)) as JsonValue }

/** Parse string-valued environment or header fields.
 * @param value - textarea JSON.
 * @returns string-valued environment or headers. */
export function parseMcpStrings(value: string): Record<string, string> { return strings.parse(JSON.parse(value || '{}')) }
