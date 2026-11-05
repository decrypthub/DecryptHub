import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommunityAccount, type CommunityVault } from '../src/community-account.ts'
import { communityCallback, communityOrigin, type CommunityCredential } from '../src/community-account-protocol.ts'
import type { CommunityAccountSnapshot } from '@deepseek-ai/dsh-client-ui-settings-decrypthub-account/types'

const token = `dhd_${'t'.repeat(43)}`
const code = 'c'.repeat(43)
const profile = { id: 'member-1', handle: 'member', nickname: '社区成员', points: 23, experience: 42 }
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture() {
  let saved: CommunityCredential | null = null
  let profileStatus = 200
  let release: (() => void) | undefined
  let hold = false
  const requests: { route: string; authorization: string | undefined; body: Record<string, string> }[] = []
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let raw = ''
    for await (const part of request) raw += String(part)
    const body = raw ? JSON.parse(raw) as Record<string, string> : {}
    requests.push({ route: request.url ?? '', authorization: request.headers.authorization, body })
    if (request.url === '/auth/desktop/me' && hold) await new Promise<void>((resolve) => { release = resolve })
    const status = request.url === '/auth/desktop/me' ? profileStatus : 200
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ code: 0, data: request.url === '/auth/desktop/token'
      ? { access_token: token, expires_in: 3600, scope: 'account:read', token_type: 'Bearer' }
      : request.url === '/auth/desktop/me' ? profile : {} }))
  }
  const issuer = createServer((request, response) => { void handle(request, response) })
  await new Promise<void>((resolve) => { issuer.listen(0, '127.0.0.1', resolve) })
  const address = issuer.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture issuer')
  const origin = `http://127.0.0.1:${address.port}`
  cleanup.push(() => {
    release?.(); issuer.closeAllConnections()
    return new Promise<void>((resolve) => { issuer.close(() => { resolve() }) })
  })
  const vault: CommunityVault = { load: () => saved, save: (value) => { saved = value }, clear: () => { saved = null } }
  const opened = vi.fn(async (_url: string) => {})
  const changed = vi.fn<(state: CommunityAccountSnapshot) => void>()
  const create = (overrides: Partial<CommunityVault> = {}) => {
    const account = new CommunityAccount({ origin, vault: { ...vault, ...overrides }, openBrowser: opened,
      changed, attemptTimeoutMs: 60_000 })
    cleanup.push(() => { account.dispose() })
    return account
  }
  const authorization = () => {
    const url = opened.mock.lastCall?.[0]
    if (url === undefined) throw new Error('Browser was not opened')
    return new URL(url)
  }
  const callback = () => {
    const auth = authorization()
    const target = new URL(auth.searchParams.get('redirect_uri') ?? '')
    target.search = new URLSearchParams({ state: auth.searchParams.get('state') ?? '', code }).toString()
    return target
  }
  return { create, opened, changed, requests, authorization, callback, origin, saved: () => saved,
    seed: (value: CommunityCredential) => { saved = value }, setProfileStatus: (value: number) => { profileStatus = value },
    holdProfile: () => { hold = true }, release: () => { hold = false; release?.() } }
}

describe('native community login', () => {
  it('exchanges a PKCE-bound callback, publishes only after persistence, and restores on restart', async () => {
    const f = await fixture()
    const account = f.create()
    expect((await account.start()).phase).toBe('waiting-browser')
    expect((await account.start()).phase).toBe('waiting-browser')
    expect(f.opened).toHaveBeenCalledTimes(1)
    expect((await fetch(f.callback())).status).toBe(200)
    await vi.waitFor(() => { expect(f.saved()?.profile).toEqual(profile) })
    const exchange = f.requests.find(request => request.route === '/auth/desktop/token')
    expect(exchange?.body.redirect_uri).toBe(f.authorization().searchParams.get('redirect_uri'))
    expect(createHash('sha256').update(exchange?.body.code_verifier ?? '').digest('base64url'))
      .toBe(f.authorization().searchParams.get('code_challenge'))
    expect(exchange?.authorization).toBeUndefined()
    const state = await account.get()
    expect(state).toMatchObject({ phase: 'signed-in', profile })
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain(token)
    expect(JSON.stringify(state)).not.toContain('code_verifier')
    account.dispose()
    expect(await f.create().get()).toMatchObject({ phase: 'signed-in', profile })
  })

  it('rejects an invalid callback without consuming the pending authorization', async () => {
    const f = await fixture()
    const account = f.create()
    await account.start()
    const bad = f.callback()
    bad.searchParams.set('state', 'wrong')
    expect((await fetch(bad)).status).toBe(400)
    expect((await account.get()).phase).toBe('waiting-browser')
    expect(f.requests).toHaveLength(0)
    expect((await fetch(f.callback())).status).toBe(200)
    expect((await account.get()).phase).toBe('signed-in')
  })

  it('cancels the callback server and rejects late results while revoking an issued grant', async () => {
    const f = await fixture()
    const account = f.create()
    f.holdProfile()
    await account.start()
    const target = f.callback()
    const callback = fetch(target).catch(() => undefined)
    await vi.waitFor(() => { expect(f.requests.some(request => request.route === '/auth/desktop/me')).toBe(true) })
    expect((await account.cancel()).phase).toBe('signed-out')
    f.release()
    await callback
    await vi.waitFor(() => { expect(f.requests.some(request => request.route === '/auth/desktop/logout')).toBe(true) })
    expect(f.saved()).toBeNull()
    expect((await account.get()).profile).toBeNull()
    await expect(fetch(target)).rejects.toThrow()
  })

  it('does not publish login after a vault write failure and revokes the uncommitted grant', async () => {
    const f = await fixture()
    const account = f.create({ save: () => { throw new Error('vault refused') } })
    await account.start()
    expect((await fetch(f.callback())).status).toBe(400)
    expect(await account.get()).toMatchObject({ phase: 'signed-out', error: 'storage', profile: null })
    expect(f.saved()).toBeNull()
    await vi.waitFor(() => { expect(f.requests.some(request => request.route === '/auth/desktop/logout')).toBe(true) })
  })

  it('retains cached identity on temporary failures, expires rejected grants, and distinguishes reputation counters', async () => {
    const f = await fixture()
    const account = f.create()
    await account.start()
    await fetch(f.callback())
    f.setProfileStatus(503)
    expect(await account.refresh()).toMatchObject({ phase: 'signed-in', error: 'network', profile: { points: 23, experience: 42 } })
    f.setProfileStatus(401)
    expect(await account.refresh()).toMatchObject({ phase: 'signed-out', error: 'expired', profile: null })
    expect(f.saved()).toBeNull()
  })

  it('keeps the logged-in identity if local logout cannot delete its credential', async () => {
    const f = await fixture()
    const account = f.create({ clear: () => { throw new Error('vault refused') } })
    await account.start()
    await fetch(f.callback())
    expect(await account.signOut()).toMatchObject({ phase: 'signed-in', error: 'storage', profile })
    expect(f.saved()).not.toBeNull()
  })

  it('removes local identity before attempting remote logout and does not restore it', async () => {
    const f = await fixture()
    const account = f.create()
    await account.start()
    await fetch(f.callback())
    expect(await account.signOut()).toMatchObject({ phase: 'signed-out', error: null, profile: null })
    expect(f.saved()).toBeNull()
    await vi.waitFor(() => { expect(f.requests.find(request => request.route === '/auth/desktop/logout')?.authorization).toBe(`Bearer ${token}`) })
  })

  it('does not restore expired credentials or credentials issued by a different origin', async () => {
    const f = await fixture()
    f.seed({ origin: f.origin, token, profile, expiresAt: Date.now() - 1 })
    expect((await f.create().get()).phase).toBe('signed-out')
    expect(f.saved()).toBeNull()
    f.seed({ origin: 'https://decrypthub.cn', token, profile, expiresAt: Date.now() + 60_000 })
    expect((await f.create().get()).phase).toBe('signed-out')
  })
})

it('fixes the packaged issuer and validates development origins and callback parameters', () => {
  expect(communityOrigin(false, 'http://127.0.0.1:1234')).toBe('https://decrypthub.cn')
  expect(communityOrigin(true, 'http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234')
  expect(() => communityOrigin(true, 'https://attacker.example')).toThrow()
  for (const suffix of ['&state=nonce', '&extra=1', '#fragment']) {
    expect(communityCallback(`/auth/callback?state=nonce&code=${code}${suffix}`, 'nonce')).toBeNull()
  }
  expect(communityCallback('/auth/callback?state=nonce&error=access_denied', 'nonce')).toBe('denied')
})
