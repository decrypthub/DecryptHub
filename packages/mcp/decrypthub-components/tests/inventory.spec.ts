import { expect, it } from 'vitest'
import { parseInventory } from '../src/inventory.ts'

const inventory = { schemaVersion: 1, component: 'adh', version: '0.2.0', checkedAt: '2026-11-15T00:00:00Z',
  connections: [{ endpoint: 'http://127.0.0.1:8088/mcp', online: true }],
  targets: [{ id: 'live-session', name: 'Example', endpoint: 'http://127.0.0.1:8088/mcp', online: false, pid: 42 }] }

it('keeps service liveness and target liveness separate', () => {
  const result = parseInventory(JSON.stringify(inventory), 'adh')
  expect(result.connections[0]?.online).toBe(true)
  expect(result.targets[0]?.online).toBe(false)
  expect(result.error).toBeNull()
})

it('rejects a different component, an unknown protocol and non-boolean online claims', () => {
  expect(() => parseInventory(JSON.stringify(inventory), 'idh')).toThrow('identity')
  expect(() => parseInventory(JSON.stringify({ ...inventory, schemaVersion: 2 }), 'adh')).toThrow()
  expect(() => parseInventory(JSON.stringify({ ...inventory, connections: [{ endpoint: 'test', online: 'true' }] }), 'adh')).toThrow()
})
