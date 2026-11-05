import { describe, expect, it } from 'vitest'
import { parseMcpEntry, reviewMcpImport, validMcpName } from '../src/client/config.ts'

describe('MCP configuration review', () => {
  it('imports common formats disabled and reports conflicting or unsupported entries', () => {
    const rows = reviewMcpImport(JSON.stringify({ mcpServers: {
      local: { command: 'node', args: ['server.mjs'], enabled: true },
      remote: { type: 'http', url: 'https://example.test/mcp' },
      existing: { command: 'server' }, sse: { type: 'sse', url: 'https://example.test' },
      wdh: { command: 'wdh' }, bad: { command: 'server', unexpected: true },
    } }), ['existing'])
    expect(rows.map(row => [row.name, row.issue ?? row.config?.enabled])).toEqual([
      ['local', false], ['remote', false], ['existing', 'conflict'], ['sse', 'unsupported'], ['wdh', 'name'], ['bad', 'invalid'],
    ])
    expect(rows[1]?.config?.transport).toBe('streamable-http')
  })
  it('rejects malformed, oversized and dangerous configurations', () => {
    expect(() => reviewMcpImport('[]', [])).toThrow()
    expect(() => reviewMcpImport(' '.repeat(1_048_577), [])).toThrow()
    expect(() => reviewMcpImport(JSON.stringify(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`s${i}`, {}]))), [])).toThrow()
    for (const name of ['__proto__', 'constructor', 'prototype', 'adh', 'idh', '../a', 'a b']) expect(validMcpName(name)).toBe(false)
    for (const value of [{ transport: 'stdio', command: '' }, { transport: 'stdio', command: 'node', url: 'https://example.test' },
      { transport: 'streamable-http', url: 'file:///a' }, { transport: 'streamable-http', url: 'https://user:pass@example.test' },
      { transport: 'streamable-http', url: 'https://example.test', env: { X: 'value' } }]) expect(parseMcpEntry(value)).toBeUndefined()
  })
})
