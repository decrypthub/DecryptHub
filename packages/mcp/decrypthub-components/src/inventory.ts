/** Versioned CLI status parsing at the subprocess boundary. */
import { z } from 'zod'
import type { ComponentId, ComponentInventory } from './types.ts'

const schema = z.object({
  schemaVersion: z.literal(1), component: z.enum(['wdh', 'adh', 'idh']),
  version: z.string().nullable(), checkedAt: z.string(), error: z.string().nullable().default(null),
  connections: z.array(z.object({ endpoint: z.string(), online: z.boolean(),
    version: z.string().nullable().default(null), error: z.string().nullable().default(null) })).max(256),
  targets: z.array(z.object({ id: z.string(), name: z.string(), endpoint: z.string(), online: z.boolean(),
    pid: z.union([z.string(), z.number()]).nullable().optional(),
    package: z.string().nullable().optional(), bundle: z.string().optional() })).max(4096),
  browser: z.object({ available: z.boolean(), state: z.literal('not-observed') }).optional(),
})

/** Parse one bounded CLI response.
 * @param text - CLI stdout.
 * @param component - requested component identity.
 * @returns validated fresh inventory.
 */
export function parseInventory(text: string, component: ComponentId): ComponentInventory {
  const result = schema.parse(JSON.parse(text))
  if (result.component !== component) throw new Error('Component status identity mismatch')
  return result
}
