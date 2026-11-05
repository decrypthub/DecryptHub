/** Installed-component handshake smoke; no browser launch or device call is made. */
import { Context } from '@deepseek-ai/cordis'
import { Config, probeServer } from '@deepseek-ai/dsh-mcp-client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const entry = process.env.DECRYPTHUB_WDH_COMPONENT_ENTRY

it.skipIf(entry === undefined)('discovers the installed WDH component through the upstream MCP client', async () => {
  if (entry === undefined) throw new Error('WDH component entry must be configured for this smoke')
  const directory = await mkdtemp(join(tmpdir(), 'decrypthub-wdh-handshake-'))
  const ctx = new Context()
  try {
    const result = await probeServer(ctx, Config({
      transport: 'stdio', serverName: 'wdh', command: process.env.DECRYPTHUB_NODE_EXECUTABLE ?? process.execPath,
      env: process.env.DECRYPTHUB_NODE_EXECUTABLE === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' },
      args: [entry, 'mcp', '--browser', 'system', '--root', directory, '--data-dir', join(directory, 'profile')],
      cwd: directory,
    }), { timeoutMs: 20_000 })
    expect(result).toMatchObject({ ok: true, closeConfirmed: true })
    if (!result.ok) throw new Error(`WDH handshake failed during ${result.stage}`)
    expect(result.toolNames).toContain('browser_open')
    expect(result.toolNames).toContain('discover_tools')
    expect(result.toolNames).not.toContain('wdh_control')
    expect(result.cleanupError).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
