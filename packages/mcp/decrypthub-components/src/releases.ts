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

/** Download and hash one fixed release asset, accepting only GitHub asset redirects.
 * @param asset - reverified immutable asset.
 * @param filename - exclusive temporary output.
 * @param signal - installation lifetime.
 * @param progress - received-byte observation.
 * @returns after exact size and SHA-256 verification.
 */
export async function downloadComponent(asset: ComponentRelease, filename: string, signal: AbortSignal,
  progress: (received: number) => void): Promise<void> {
  let url = new URL(asset.url)
  let response: Response | undefined
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
