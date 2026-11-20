/** Durable chat selections and the process identity that was verified when selected. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const binding = z.object({
  view: z.object({
    component: z.enum(['adh', 'idh']),
    endpoint: z.string().min(1),
    id: z.string().min(1),
    pid: z.string().min(1),
    appId: z.string().min(1),
    name: z.string(),
    state: z.enum(['bound', 'stale']),
  }),
  address: z.string().min(1),
  generation: z.string().min(1),
})

/** Selection plus the original configured service and process generation. */
export type ChatTargetBinding = z.infer<typeof binding>

/** One selection per Session id, stored in the runtime's configured backend. */
export const chatTargetDomain = defineDomain({
  name: 'decrypthub_chat_targets',
  version: 1,
  tables: { targets: domainTable<SessionId, ChatTargetBinding>(binding) },
})
