/** Validate capture replies at the WDH stdio boundary. */
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { WdhCaptureDetail, WdhCaptureList } from './types.ts'

const reply = z.object({
  isError: z.literal(false).optional(),
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string().max(1_000_000) })]),
})
const list = z.object({
  generation: z.string().uuid(),
  requests: z.array(z.object({
    id: z.string(), url: z.string(), method: z.string(), status: z.union([z.number(), z.string()]),
  })).max(100),
})
const detail = z.object({
  id: z.string(),
  headers: z.string().max(16_000),
  headersTruncated: z.boolean(),
  body: z.object({
    text: z.string().max(45_000), encoding: z.literal('base64').nullable(), truncated: z.boolean(),
  }).nullable(),
  frames: z.array(z.object({
    functionName: z.string(), url: z.string(), line: z.number().int(), column: z.number().int(),
  })).max(100),
})

function invalidReply(): RemoteError {
  return new RemoteError('gateway/bad-request', 'Could not read capture data. Update WDH or reconnect and retry.', {})
}

function payload(value: unknown): unknown {
  const result = reply.safeParse(value)
  if (!result.success) throw invalidReply()
  try {
    return JSON.parse(result.data.content[0].text)
  } catch (_invalidJson) {
    throw invalidReply()
  }
}

/** Decode the latest capture list.
 * @param value - reply from the owning WDH process.
 * @returns the listed entries and their connection identity.
 */
export function readWdhCaptureList(value: unknown): WdhCaptureList {
  const parsed = list.safeParse(payload(value))
  if (!parsed.success) throw invalidReply()
  return parsed.data
}

/** Decode a response and initiating frames for the selected capture.
 * @param value - reply from the owning WDH process.
 * @param id - requested capture identifier.
 * @returns the matching detail, or null when the capture has expired.
 */
export function readWdhCaptureDetail(value: unknown, id: string): WdhCaptureDetail | null {
  const parsed = detail.nullable().safeParse(payload(value))
  if (!parsed.success || (parsed.data !== null && parsed.data.id !== id)) throw invalidReply()
  return parsed.data
}
