import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentFeedBaseUrl, fetchFeedRelease } from '../src/releases.ts'

const base = new URL('http://192.168.200.195:18080/components/')

function respond(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('component feed base URL', () => {
  it('accepts HTTPS anywhere and HTTP on a private address, keeping a path', () => {
    expect(componentFeedBaseUrl('https://updates.example.com').href).toBe('https://updates.example.com/')
    expect(componentFeedBaseUrl('http://192.168.200.195:18080/components').href).toBe('http://192.168.200.195:18080/components/')
  })

  it('rejects public HTTP, credentials, and query strings', () => {
    expect(() => componentFeedBaseUrl('http://updates.example.com')).toThrow(/HTTPS, or HTTP on a private address/u)
    expect(() => componentFeedBaseUrl('https://user:pass@updates.example.com')).toThrow(/credentials/u)
    expect(() => componentFeedBaseUrl('https://updates.example.com/?token=1')).toThrow(/credentials, query/u)
  })
})

describe('component feed index', () => {
  it('returns the matching entry under the feed base URL', async () => {
    respond({ version: 1, components: { wdh: { version: '0.1.1', name: 'wdh-0.1.1-win32-x64.zip', size: 31_840_966, sha256: 'd48472f76b4599d4ca1d1ef915484f75a3b542e1f724c76f7803d66144b49784' } } })
    await expect(fetchFeedRelease(base, 'wdh', new AbortController().signal, 5_000)).resolves.toMatchObject({
      id: 'wdh', version: '0.1.1', url: 'http://192.168.200.195:18080/components/wdh-0.1.1-win32-x64.zip',
    })
  })

  it('returns null when the feed does not offer the component', async () => {
    respond({ version: 1, components: {} })
    await expect(fetchFeedRelease(base, 'wdh', new AbortController().signal, 5_000)).resolves.toBeNull()
  })

  it('rejects a malformed index and an HTTP error', async () => {
    respond({ version: 2, components: {} })
    await expect(fetchFeedRelease(base, 'wdh', new AbortController().signal, 5_000)).rejects.toThrow(/malformed/u)
    vi.unstubAllGlobals()
    respond({}, 503)
    await expect(fetchFeedRelease(base, 'wdh', new AbortController().signal, 5_000)).rejects.toThrow(/lookup failed \(503\)/u)
  })
})
