/** Add a reviewed custom MCP server through the live profile settings. */
import { isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'
import { SERVER_NAME_PATTERN } from '@deepseek-ai/dsh-mcp-client/src/config.ts'
import { assertTemplateSyntax } from '@deepseek-ai/dsh-mcp-client/src/templates.ts'
import McpServerManager from '@deepseek-ai/dsh-mcp-manager'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { defineTool, ToolArgsError, ToolContextUnavailableError, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'

const SETTINGS_ENTRY = 'mcp-manager'
const APPROVAL_ID = 'add-mcp-server'
const APPROVE = 'Add and connect'
const REJECT = 'Cancel'
const CONNECTION_WAIT_MS = 45_000
const MAX_REVIEW_BYTES = 4_096
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype', '__jsExpr'])
const OFFICIAL_NAMES = new Set(['wdh', 'adh', 'idh'])
const CREDENTIAL_FIELD = /(?:^authorization$|cookie|(?:^|[-_])(?:token|password|secret|api[-_]?key|access[-_]?key)(?:$|[-_]))/i
const CREDENTIAL_VALUE = /^(?:Bearer |Basic )?\$\{credential:[a-z_][a-z0-9_]*\}$/i

type ConnectionConfig =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string>; cwd: string }
  | { transport: 'streamable-http'; url: string; headers: Record<string, string> }

function safeText(value: string, field: string): string {
  if (/\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}/u.test(value)) throw new ToolArgsError([`${field} contains an invisible control character`])
  try {
    assertTemplateSyntax(value, field)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    throw new ToolArgsError([`${field} contains an invalid credential template`])
  }
  return value
}

function stringFields(input: Record<string, unknown> | undefined, field: string): Record<string, string> {
  const entries = Object.entries(input ?? {}).map(([key, value]): [string, string] => {
    // Settings serializes standalone __jsExpr objects as Loader expressions.
    if (RESERVED_KEYS.has(key) || !/^[A-Za-z0-9_.-]+$/.test(key) || typeof value !== 'string') {
      throw new ToolArgsError([`${field} must be a map of safe names to strings`])
    }
    if (CREDENTIAL_FIELD.test(key) && !CREDENTIAL_VALUE.test(value)) {
      throw new ToolArgsError([`${field}.${key} must reference a stored credential with \${credential:REF}`])
    }
    return [key, safeText(value, `${field}.${key}`)]
  })
  return Object.fromEntries(entries)
}

function endpointUrl(value: string): string {
  const url = URL.parse(safeText(value, 'config.url'))
  if (url === null || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ToolArgsError(['config.url must be an HTTP(S) MCP endpoint without embedded credentials or a fragment'])
  }
  if (['github.com', 'www.github.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
    throw new ToolArgsError(['Read the GitHub repository documentation and supply its MCP endpoint or documented stdio command'])
  }
  return url.href
}

/** Build the tool that saves one approved, profile-wide MCP server and verifies its live tool discovery.
 * @param ctx - composition with the MCP manager, settings, and user questions.
 * @returns the definition registered by the product integration. */
export function mcpAddTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'mcp_add',
    description: 'Add and enable one custom MCP server when the user asks, with an approval card showing the exact connection configuration. For a GitHub repository or documentation link, use web_fetch to read its setup instructions first, then use the documented Streamable HTTP endpoint or executable and argument list. A repository page is not an MCP endpoint. For pasted MCP JSON, translate the chosen server entry into config. Do not invent a command or run setup scripts yourself. Keep secrets out of tool arguments and use stored credential references. Approval saves the server for all chats in this profile. The tool waits for the live connection to discover its tools. On success, continue the user’s task with the new tools in the next step of this chat.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique server name using 1–32 ASCII letters, digits, underscores or hyphens.' },
      source: { type: 'string', description: 'Repository, package or documentation source shown to the user, if known.' },
      config: { required: true, description: 'One server’s connection settings. Use credential references such as ${credential:MY_TOKEN} for secrets.', oneOf: [
        { type: 'object', additionalProperties: false, properties: {
          transport: { type: 'string', const: 'streamable-http', required: true },
          url: { type: 'string', required: true, description: 'Actual Streamable HTTP MCP URL.' },
          headers: { type: 'object', additionalProperties: true, description: 'Optional string headers. Example authorization value: Bearer ${credential:MY_TOKEN}.' },
        } },
        { type: 'object', additionalProperties: false, properties: {
          transport: { type: 'string', const: 'stdio', required: true },
          command: { type: 'string', required: true, description: 'Executable only, such as npx or uvx. Put each argument in args.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Documented launch arguments as separate strings.' },
          cwd: { type: 'string', description: 'Optional absolute working directory required by the command.' },
          env: { type: 'object', additionalProperties: true, description: 'Optional string environment variables. Use credential references for tokens and passwords.' },
        } },
      ] },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', required: true },
        toolCount: { type: 'integer', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.toolCount === 0
        ? `MCP server "${value.name}" was saved and connected. It advertises no tools.`
        : `MCP server "${value.name}" was saved and connected. Discovered ${value.toolCount} ${value.toolCount === 1 ? 'tool' : 'tools'}. Use the server’s tools from the next step to continue the task.` }],
    },
    async execute({ name, source, config }, exec) {
      if (!SERVER_NAME_PATTERN.test(name) || OFFICIAL_NAMES.has(name.toLowerCase()) || RESERVED_KEYS.has(name)) {
        throw new ToolArgsError(['name must be a custom MCP server name with 1–32 ASCII letters, digits, underscores or hyphens'])
      }
      const reviewed: ConnectionConfig = config.transport === 'streamable-http'
        ? { transport: config.transport, url: endpointUrl(config.url), headers: stringFields(config.headers, 'headers') }
        : { transport: config.transport, command: safeText(config.command.trim(), 'config.command'),
          args: (config.args ?? []).map(value => safeText(value, 'config.args')),
          cwd: safeText(config.cwd ?? '', 'config.cwd'), env: stringFields(config.env, 'env') }
      if (reviewed.transport === 'stdio') {
        if (reviewed.command === '') throw new ToolArgsError(['config.command must name an executable'])
        if (reviewed.cwd !== '' && !isAbsolute(reviewed.cwd)) throw new ToolArgsError(['config.cwd must be an absolute path'])
      }
      const review = JSON.stringify({ name, ...(source === undefined ? {} : { source: safeText(source, 'source') }), ...reviewed }, null, 2)
      if (Buffer.byteLength(review, 'utf8') > MAX_REVIEW_BYTES) throw new ToolArgsError(['connection configuration exceeds the approval size limit'])

      const agent = exec.agent
      const settings = ctx.get('settings')
      const questions = ctx.get('userQuestions')
      const manager = ctx.mcpManager
      if (agent === undefined || settings === undefined || questions === undefined) {
        throw new ToolContextUnavailableError('Adding an MCP server requires a chat with an approval channel and editable settings.')
      }
      const namespace = settings.describe().find(row => row.ns === SETTINGS_ENTRY)
      if (namespace === undefined) throw new ToolContextUnavailableError('Custom MCP settings are unavailable.')
      if (manager.list().some(row => row.name === name)) {
        throw new HarnessError(`MCP server "${name}" already exists. Use its configured tools or choose a different name.`, 'MCP_ADD_NAME_TAKEN')
      }

      const local = reviewed.transport === 'stdio'
      const question = 'Add this MCP server to all chats in this profile?'
      const detail = local ? `This starts a local executable.\n${review}` : review
      const response = await questions.ask({ agent, signal: exec.signal, questions: [{
        id: APPROVAL_ID, question, detail: `${local ? 'This starts a local executable.\n\n' : ''}\`\`\`json\n${review}\n\`\`\``,
        options: [{ label: APPROVE }, { label: REJECT }],
        intent: { kind: 'approval', approve: APPROVE, reject: REJECT,
          display: {
            question: { en: question, zh: '将此 MCP 服务添加到当前配置的所有对话？' },
            detail: { en: detail, zh: local ? `这会运行本地程序。\n${review}` : review },
            approve: { en: APPROVE, zh: '添加并连接' },
          } },
      }] }).catch((error: unknown) => {
        exec.signal.throwIfAborted()
        if (error instanceof UserQuestionError && error.code === 'ASK_CANCELLED') {
          throw new HarnessError(`The user cancelled adding MCP server "${name}".`, 'APPROVAL_CANCELLED', { cause: error })
        }
        throw error
      })
      exec.signal.throwIfAborted()
      const answer = response.answers.find(item => item.id === APPROVAL_ID)
      if (answer?.selected.length !== 1 || answer.selected[0] !== APPROVE || answer.custom !== undefined) {
        throw new HarnessError(`MCP server "${name}" was not approved. No settings were changed.`, 'APPROVAL_REJECTED')
      }

      const entry = { ...reviewed, enabled: true }
      const expected = McpServerManager.Config({ servers: { [name]: entry } }).servers.get()[name]
      try {
        await settings.mutate(SETTINGS_ENTRY, [{ op: 'set', path: ['servers', name], value: entry }], namespace.revision)
      } catch (cause) {
        if (cause instanceof SettingsConflictError) {
          throw new HarnessError('MCP settings changed during approval. Check the current settings before requesting approval again.',
            'MCP_ADD_SETTINGS_CONFLICT', { cause })
        }
        throw new HarnessError(`Could not apply settings for MCP server "${name}". Check Skills & MCP for its current configuration.`,
          'MCP_ADD_SAVE_FAILED', { cause })
      }

      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(CONNECTION_WAIT_MS)])
      for await (const servers of manager.watch(signal)) {
        if (!isDeepStrictEqual(manager.config.servers.get()[name], expected)) {
          throw new HarnessError(`MCP server "${name}" was changed while connecting. Check its current settings.`, 'MCP_ADD_SETTINGS_CONFLICT')
        }
        const status = servers.find(row => row.name === name)?.status
        if (status?.state === 'connected') return { name, toolCount: status.toolCount }
        if (status?.state === 'waiting-credentials') {
          throw new HarnessError(`MCP server "${name}" was saved and needs a stored credential. ${status.lastError}`, 'MCP_ADD_CREDENTIAL_REQUIRED')
        }
        if (status?.state === 'failed') {
          throw new HarnessError(`MCP server "${name}" was saved but tool discovery did not complete. Check its connection in Skills & MCP.`,
            'MCP_ADD_CONNECTION_FAILED')
        }
      }
      exec.signal.throwIfAborted()
      throw new HarnessError(`MCP server "${name}" was saved. Tool discovery has not completed. Check its status in Skills & MCP before using it.`,
        'MCP_ADD_CONNECTION_PENDING')
    },
  })
}
