/**
 * Durable product-memory records: scoped facts the model maintains and the
 * system prompt re-injects on every assembly.
 * @module @deepseek-ai/dsh-product-memory/src/spec
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** Branded identifier of one memory entry; branding has no runtime representation. */
export type MemoryId = string & { readonly __memoryId: unique symbol }

/**
 * One stored memory entry. `scope` decides how widely the fact applies, and
 * the timestamps are ISO-8601 strings stamped by the writing caller.
 */
export const memoryRecord = z.object({
  text: z.string().min(1).max(4000),
  scope: z.enum(['user', 'project']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored memory entry, inferred from {@link memoryRecord}. */
export type MemoryRecord = z.infer<typeof memoryRecord>

/**
 * The product-memory domain: one `entries` table keyed by {@link MemoryId}.
 * The plugin opens it through `ctx.storageDomain`; this spec is the single
 * source of the domain identity, version, and record schema.
 */
export const memoryDomainSpec = defineDomain({
  name: 'product_memory',
  version: 1,
  tables: { entries: domainTable<MemoryId, MemoryRecord>(memoryRecord) },
})
