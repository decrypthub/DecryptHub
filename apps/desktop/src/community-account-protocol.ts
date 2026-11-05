/** Community desktop-session protocol; distinct from model provider credentials. */
import { z } from 'zod'
import type { CommunityAccountError } from '@deepseek-ai/dsh-client-ui-settings-decrypthub-account/types'

const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
/** Validated display identity; unknown counters retain their meaning across upgrades. */
export const communityProfile = z.object({
  id: z.string().min(1).max(191), handle: z.string().max(191), nickname: z.string().max(1000),
  points: z.number().int().nonnegative().nullable().default(null),
  experience: z.number().int().nonnegative().nullable().default(null),
})
/** Persisted credentials are native-only and bound to their issuing origin. */
export const communityCredential = z.object({
  origin: z.url(), token: z.string().regex(/^dhd_[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(), profile: communityProfile,
})
/** Native-only stored community grant. */
export type CommunityCredential = z.infer<typeof communityCredential>
const envelope = z.object({ code: z.literal(0), data: z.unknown() })
const issued = z.object({
  access_token: z.string().regex(/^dhd_[A-Za-z0-9_-]{43}$/),
  expires_in: z.number().int().min(1).max(2_592_000),
  scope: z.literal('account:read'), token_type: z.literal('Bearer'),
})

/** A classified native failure; its message contains no wire data. */
export class CommunityAccountFailure extends Error {
  /** @param code - safe client error category. */
  constructor(readonly code: CommunityAccountError) { super(`Community account: ${code}`) }
}

/**
 * Validate the fixed product issuer or an explicit development issuer.
 * @param development - whether unpackaged test origins are permitted.
 * @param override - optional development origin.
 * @returns issuer origin without a path.
 */
export function communityOrigin(development: boolean, override?: string): string {
  if (!development || override === undefined) return 'https://decrypthub.cn'
  const url = new URL(override)
  const allowed = url.origin === 'https://decrypthub.cn' || url.origin === 'https://decrypthub.taisuii.cn'
    || (url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) >= 1024)
  if (!allowed || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new CommunityAccountFailure('protocol')
  }
  return url.origin
}

/**
 * Read a bounded, redirect-free community response.
 * @param origin - validated issuer.
 * @param route - protocol endpoint.
 * @param signal - operation lifetime.
 * @param token - native grant for authenticated endpoints.
 * @param body - optional POST payload.
 * @returns data from a successful protocol envelope.
 */
export async function requestCommunity(origin: string, route: '/auth/desktop/token' | '/auth/desktop/me' | '/auth/desktop/logout',
  signal: AbortSignal, token?: string, body?: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(new URL(route, origin), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    })
  } catch (_error) { throw new CommunityAccountFailure('network') }
  if (!response.ok) {
    await response.body?.cancel()
    throw new CommunityAccountFailure(response.status === 401 || response.status === 403 ? 'expired'
      : response.status === 404 ? 'unavailable' : 'network')
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    if (response.body !== null) {
      const reader = response.body.getReader()
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.length
          if (bytes > 65_536) { await reader.cancel(); throw new CommunityAccountFailure('protocol') }
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
    }
    const result = envelope.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (!result.success) throw new CommunityAccountFailure('protocol')
    return result.data.data
  } catch (error) {
    throw error instanceof CommunityAccountFailure ? error : new CommunityAccountFailure('protocol')
  }
}

/** @param value - token exchange data. @returns a strictly scoped community grant. */
export function parseIssuedCommunityToken(value: unknown): z.infer<typeof issued> {
  const parsed = issued.safeParse(value)
  if (!parsed.success) throw new CommunityAccountFailure('protocol')
  return parsed.data
}

/**
 * Validate a single callback without consuming invalid requests.
 * @param target - HTTP origin-form request target.
 * @param state - native attempt nonce.
 * @returns authorization code, denial, or invalid callback.
 */
export function communityCallback(target: string, state: string): { code: string } | 'denied' | null {
  if (!target.startsWith('/auth/callback?') || target.length > 2048) return null
  const url = new URL(target, 'http://127.0.0.1')
  const params = [...url.searchParams]
  if (url.pathname !== '/auth/callback' || url.hash || params.length !== 2
    || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) return null
  const code = url.searchParams.get('code')
  if (code !== null && secret.safeParse(code).success) return { code }
  return url.searchParams.get('error') === 'access_denied' ? 'denied' : null
}
