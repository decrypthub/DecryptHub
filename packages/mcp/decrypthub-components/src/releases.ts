/** Code-owned GitHub releases and bounded archive downloads. */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { repositories } from './files.ts'
import type { ComponentId } from './types.ts'

/** Immutable release asset selected for the current platform. */
export interface ComponentRelease {
  id: ComponentId
  releaseId: number
  assetId: number
  name: string
  version: string
  size: number
  sha256: string
  url: string
}
const releaseSchema = z.object({
  id: z.number().int().positive(), draft: z.boolean(), published_at: z.string().nullable(),
  assets: z.array(z.object({ id: z.number().int().positive(), name: z.string(), size: z.number().int().positive().max(256 * 1024 ** 2),
    digest: z.string().nullable().optional(), browser_download_url: z.string() })),
})

/** Choose only platform-compatible, checksummed assets from the fixed repository.
 * @param id - component identity.
 * @param value - GitHub release response.
 * @returns compatible release, or null.
 */
export function selectComponentRelease(id: ComponentId, value: unknown): ComponentRelease | null {
  const releases = z.array(z.unknown()).parse(value)
    .flatMap((raw) => { const parsed = releaseSchema.safeParse(raw); return parsed.success ? [parsed.data] : [] })
    .filter(row => !row.draft).toSorted((a, b) => Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? ''))
  const suffix = id === 'wdh' ? `${process.platform}-${process.arch}` : 'any'
  const pattern = new RegExp(`^${id}-(\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?)-${suffix}\\.zip$`)
  for (const release of releases) for (const asset of release.assets) {
    const match = pattern.exec(asset.name)
    if (!match?.[1] || !asset.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) continue
    let url: URL
    try { url = new URL(asset.browser_download_url) } catch (_error) { continue }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password
      || !url.pathname.startsWith(`/${repositories[id]}/releases/download/`)) continue
    return { id, releaseId: release.id, assetId: asset.id, name: asset.name, version: match[1], size: asset.size,
      sha256: asset.digest.slice(7), url: url.href }
  }
  return null
}

/** Fetch bounded public release metadata without forwarding credentials or redirects.
 * @param id - component identity.
 * @param signal - request lifetime.
 * @param timeoutMs - bounded metadata request duration.
 * @param releaseId - optional immutable release to recheck.
 * @returns selected checksummed asset, or null.
 */
export async function fetchComponentRelease(id: ComponentId, signal: AbortSignal,
  timeoutMs: number, releaseId?: number): Promise<ComponentRelease | null> {
  const endpoint = releaseId === undefined ? 'releases?per_page=30' : `releases/${releaseId}`
  const response = await fetch(`https://api.github.com/repos/${repositories[id]}/${endpoint}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'DecryptHub' }, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Official release lookup failed (${response.status})`) }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty official release response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 4 * 1024 ** 2) { await reader.cancel(); throw new Error('Official release response is too large') }
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return selectComponentRelease(id, releaseId === undefined ? value : [value])
}

const feedEntrySchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  name: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/u),
  size: z.number().int().positive().max(256 * 1024 ** 2),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
})
const feedIndexSchema = z.object({ version: z.literal(1), components: z.record(z.string(), feedEntrySchema) })

/**
 * Validate an operator-owned component feed base URL: HTTPS anywhere, HTTP only on a private address.
 * @param value - configured feed base URL, optionally carrying a path such as `/components`.
 * @returns base URL ending in `/`; `index.json` and archives resolve against it.
 * @throws {Error} When the value is not an allowed base URL.
 */
export function componentFeedBaseUrl(value: string): URL {
  let base: URL
  try { base = new URL(value) } catch { throw new Error('Component feed must be an absolute URL') }
  const privateHostPattern = String.raw`^(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|` +
    String.raw`172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|127(?:\.\d{1,3}){3}|localhost)$`
  const privateHost = new RegExp(privateHostPattern, 'u').test(base.hostname)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && privateHost)) {
    throw new Error('Component feed must use HTTPS, or HTTP on a private address')
  }
  if (base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
    throw new Error('Component feed must not carry credentials, query, or fragment')
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return base
}

/**
 * Read one component entry from an operator-owned index.json.
 * @param base - verified feed base URL.
 * @param id - component identity.
 * @param signal - request lifetime.
 * @param timeoutMs - bounded metadata request duration.
 * @returns selected entry, or null when the feed does not offer this component.
 * @throws {Error} When the feed is unreachable or malformed.
 */
export async function fetchFeedRelease(base: URL, id: ComponentId, signal: AbortSignal,
  timeoutMs: number): Promise<ComponentRelease | null> {
  const response = await fetch(new URL('index.json', base), {
    headers: { accept: 'application/json', 'user-agent': 'DecryptHub' }, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Component feed lookup failed (${response.status})`) }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty component feed response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 1024 ** 2) { await reader.cancel(); throw new Error('Component feed response is too large') }
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const parsed = feedIndexSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (!parsed.success) throw new Error('Component feed index is malformed')
  const entry = parsed.data.components[id]
  if (entry === undefined) return null
  const url = new URL(entry.name, base)
  if (!url.href.startsWith(base.href)) throw new Error('Component feed entry escapes the feed base URL')
  return { id, releaseId: 0, assetId: 0, name: entry.name, version: entry.version, size: entry.size, sha256: entry.sha256, url: url.href }
}

/** Download and hash one fixed release asset, accepting only the selected source.
 * @param asset - reverified immutable asset.
 * @param filename - exclusive temporary output.
 * @param signal - installation lifetime.
 * @param progress - received-byte observation.
 * @param allowedBase - operator feed base URL; omit for the code-owned GitHub repository.
 * @returns after exact size and SHA-256 verification.
 */
export async function downloadComponent(asset: ComponentRelease, filename: string, signal: AbortSignal,
  progress: (received: number) => void, allowedBase?: URL): Promise<void> {
  let url = new URL(asset.url)
  let response: Response | undefined
  if (allowedBase !== undefined) {
    if (!url.href.startsWith(allowedBase.href)) throw new Error('Untrusted component download base URL')
    response = await fetch(url, { redirect: 'error', signal })
  } else {
    for (let redirect = 0; redirect < 6; redirect++) {
      if (url.protocol !== 'https:' || url.port || url.username || url.password
        || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) {
        throw new Error('Untrusted component download redirect')
      }
      response = await fetch(url, { redirect: 'manual', signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Invalid component download redirect')
      url = new URL(location, url)
    }
  }
  if (!response?.ok || !response.body) { await response?.body?.cancel(); throw new Error('Component download failed') }
  const output = await fs.open(filename, 'wx', 0o600)
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let bytes = 0
  let last = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > asset.size || bytes > 256 * 1024 ** 2) { await reader.cancel(); throw new Error('Component download exceeds its published size') }
      hash.update(value)
      await output.writeFile(value)
      if (Date.now() - last > 120) { progress(bytes); last = Date.now() }
    }
    if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Component archive checksum mismatch')
    progress(bytes)
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); await output.close() }
}
