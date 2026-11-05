import { describe, expect, it, vi } from 'vitest'
import type { SettingsDescribeValue, SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import { McpSource, type McpOperations } from '../src/client/source.ts'
import { ComponentsSource, type ComponentsOperations } from '../src/client/components-source.ts'
import type { ComponentsSnapshot } from '@deepseek-ai/dsh-decrypthub-components/types'

const section: SettingsNamespaceView = { ns: 'mcp-manager', autoGenerate: false, schema: {}, value: { servers: { server: { transport: 'stdio', command: 'node' } } }, applies: 'live', secrets: [], revision: 4 }
const description: SettingsDescribeValue = { writable: true, hasDocument: true, namespaces: [section] }
async function *waiting<T>(signal: AbortSignal): AsyncIterable<T> {
  await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}
function fixture() {
  const ops: McpOperations = { describe: vi.fn(async () => description), write: vi.fn(async () => section), credential: vi.fn(async () => {}), watch: signal => waiting(signal), restart: vi.fn(async () => {}), probe: vi.fn(async () => { throw new Error('fixture') }) }
  return { ops, source: new McpSource(ops) }
}

describe('MCP settings source', () => {
  it('does not open management streams before the page is used', () => {
    const { ops, source } = fixture()
    source.reset()
    expect(ops.describe).not.toHaveBeenCalled()
    source.dispose()
  })
  it('stores new secrets as references and writes the captured revision', async () => {
    const { ops, source } = fixture()
    await source.load()
    await source.save({ server: { transport: 'stdio', command: 'node', env: { API_KEY: 'private-fixture', EXISTING: '${credential:EXISTING}' } } }, 4)
    expect(ops.credential).toHaveBeenCalledOnce()
    const write = vi.mocked(ops.write).mock.calls[0]
    expect(write?.[1]).toBe(4)
    expect(JSON.stringify(write)).not.toContain('private-fixture')
    expect(JSON.stringify(write)).toContain('${credential:EXISTING}')
    source.dispose()
  })
  it('retains settings and releases the busy state when a write conflicts', async () => {
    const { ops, source } = fixture()
    await source.load()
    vi.mocked(ops.write).mockRejectedValueOnce(new Error('revision conflict'))
    await expect(source.enable('server', true, 3)).rejects.toThrow('revision conflict')
    expect(source.store.getSnapshot().entries.server?.command).toBe('node')
    expect(source.store.getSnapshot().busy).toBe(false)
    source.dispose()
  })
  it('ignores late reads after disposal and cancels an inspection', async () => {
    const { ops, source } = fixture()
    let finish!: (value: SettingsDescribeValue) => void
    vi.mocked(ops.describe).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const read = source.load()
    const probe = source.probe('server').catch(() => undefined)
    const signal = vi.mocked(ops.probe).mock.calls[0]?.[1]
    source.cancelProbe()
    expect(signal?.aborted).toBe(true)
    source.dispose(); finish(description); await read; await probe
    expect(source.store.getSnapshot().loaded).toBe(false)
  })
})

describe('official component observations', () => {
  it('retains an observed snapshot on stream failure and closes subscriptions on reset', async () => {
    const value: ComponentsSnapshot = { components: [], wdh: [], configuration: null, browser: { state: 'unchecked', version: null } }
    const signals: AbortSignal[] = []
    const ops: ComponentsOperations = {
      async *watch(signal) { signals.push(signal); yield value; throw new Error('disconnected') },
      connections: signal => waiting(signal), snapshot: async () => value,
      checkUpdates: async () => {}, install: async () => {}, cancel: async () => {}, rollback: async () => {},
      configure: async () => {}, reconnect: async () => {}, inspectBrowser: async () => {}, installBrowser: async () => {},
    }
    const source = new ComponentsSource(ops)
    source.load()
    await vi.waitFor(() => { expect(source.store.getSnapshot().failed).toBe(true) })
    expect(source.store.getSnapshot().value).toEqual(value)
    source.reset()
    expect(signals[0]?.aborted).toBe(true)
    await expect(source.run(async () => { throw new Error('failed action') })).rejects.toThrow('failed action')
    expect(source.store.getSnapshot().busy).toBe(false)
    source.dispose()
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
})
