/** Native community login lifetime, callback listener and credential commits. */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { CommunityAccountError, CommunityAccountSnapshot } from '@deepseek-ai/dsh-client-ui-settings-decrypthub-account/types'
import { CommunityAccountFailure, communityCallback, communityProfile,
  parseIssuedCommunityToken, requestCommunity, type CommunityCredential } from './community-account-protocol.ts'

/** Native persistence rejects failed reads and writes rather than reporting a false login. */
export interface CommunityVault {
  load(): CommunityCredential | null
  save(value: CommunityCredential): void
  clear(): void
}
interface Attempt {
  readonly controller: AbortController
  readonly server: Server
  readonly url: string
  readonly timer: ReturnType<typeof setTimeout>
  claimed: boolean
}
/** Explicit native dependencies; tests supply a loopback issuer and in-memory vault. */
export interface CommunityAccountOptions {
  readonly origin: string
  readonly vault: CommunityVault
  readonly openBrowser: (url: string) => Promise<void>
  readonly changed: (state: CommunityAccountSnapshot) => void
  readonly attemptTimeoutMs: number
}

/** Owns community identity only; it has no model-provider credential operation. */
export class CommunityAccount {
  private credential: CommunityCredential | null = null
  private initialized = false
  private pending: Attempt | undefined
  private phase: CommunityAccountSnapshot['phase'] = 'signed-out'
  private error: CommunityAccountError | null = null
  private revision = 0
  private closed = false
  private queue: Promise<void> = Promise.resolve()
  private refreshTask: Promise<CommunityAccountSnapshot> | undefined
  private readonly lifetime = new AbortController()

  /** @param options - native persistence, browser and protocol owners. */
  constructor(private readonly options: CommunityAccountOptions) {}

  private initialize(): void {
    if (this.initialized) {
      if (this.credential !== null && this.credential.expiresAt <= Date.now()) {
        this.clear()
        this.credential = null
        this.phase = 'signed-out'
        this.error = 'expired'
      }
      return
    }
    let stored: CommunityCredential | null
    try { stored = this.options.vault.load() }
    catch (_error) { throw new CommunityAccountFailure('storage') }
    if (stored !== null && (stored.origin !== this.options.origin || stored.expiresAt <= Date.now())) {
      this.clear()
      stored = null
    }
    this.credential = stored
    this.phase = stored === null ? 'signed-out' : 'signed-in'
    this.initialized = true
  }

  private snapshot(): CommunityAccountSnapshot {
    return { revision: this.revision, phase: this.phase,
      profile: this.credential === null ? null : { ...this.credential.profile }, error: this.error }
  }

  private publish(): CommunityAccountSnapshot {
    this.revision++
    const state = this.snapshot()
    if (!this.closed) this.options.changed(state)
    return state
  }

  private mutate(operation: () => void | Promise<void>): Promise<CommunityAccountSnapshot> {
    const work = this.queue.then(async () => {
      if (this.closed) return this.snapshot()
      try { this.initialize(); await operation() }
      catch (error) { this.error = error instanceof CommunityAccountFailure ? error.code : 'protocol' }
      return this.publish()
    })
    this.queue = work.then(() => undefined, () => undefined)
    return work
  }

  private clear(): void {
    try { this.options.vault.clear() }
    catch (_error) { throw new CommunityAccountFailure('storage') }
  }

  private save(credential: CommunityCredential): void {
    try { this.options.vault.save(credential) }
    catch (_error) { throw new CommunityAccountFailure('storage') }
  }

  private retire(force = true): void {
    const pending = this.pending
    if (pending === undefined) return
    this.pending = undefined
    clearTimeout(pending.timer)
    pending.controller.abort()
    pending.server.close()
    if (force) pending.server.closeAllConnections()
  }

  /** @returns local account identity; credentials never leave the native module. */
  get(): Promise<CommunityAccountSnapshot> { return this.mutate(() => {}) }

  /** @returns state after browser launch, retaining one active attempt on repeated clicks. */
  start(): Promise<CommunityAccountSnapshot> {
    return this.mutate(async () => {
      if (this.credential !== null || this.pending !== undefined) return
      const state = randomBytes(32).toString('base64url')
      const verifier = randomBytes(32).toString('base64url')
      const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
        const parsed = communityCallback(request.url ?? '', state)
        const hosts = request.rawHeaders.filter((_value, index, headers) => index % 2 === 1 && headers[index - 1]?.toLowerCase() === 'host')
        if (request.method !== 'GET' || hosts.length !== 1 || hosts[0] !== new URL(redirect).host || parsed === null) {
          this.reply(response, 400); return
        }
        if (this.pending !== attempt || attempt.claimed) { this.reply(response, 410); return }
        attempt.claimed = true
        if (parsed === 'denied') {
          this.reply(response, 200)
          void this.finish(attempt, 'denied')
          return
        }
        this.phase = 'exchanging'
        this.publish()
        void this.exchange(attempt, parsed.code, verifier, redirect, response)
      })
      server.keepAliveTimeout = 1000
      const controller = new AbortController()
      let redirect = ''
      let attempt: Attempt
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
        })
        const address = server.address()
        if (address === null || typeof address === 'string') throw new CommunityAccountFailure('protocol')
        redirect = `http://127.0.0.1:${address.port}/auth/callback`
        const url = new URL('/desktop/authorize', this.options.origin)
        url.search = new URLSearchParams({ redirect_uri: redirect, state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
        attempt = { server, controller, url: url.href, claimed: false,
          timer: setTimeout(() => { void this.finish(attempt, 'timeout') }, this.options.attemptTimeoutMs) }
        this.pending = attempt
        this.phase = 'waiting-browser'
        this.error = null
        server.on('error', (_error) => { void this.finish(attempt, 'network') })
        try {
          void this.options.openBrowser(url.href).catch((_error: unknown) => { void this.finish(attempt, 'browser') })
        }
        catch (_error) { throw new CommunityAccountFailure('browser') }
      } catch (error) {
        this.retire()
        server.close()
        this.phase = 'signed-out'
        throw error
      }
    })
  }

  private reply(response: ServerResponse, status: number): void {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' })
    response.end('<!doctype html><meta charset="utf-8"><title>DecryptHub</title><p>请返回 DecryptHub 查看登录状态。 Return to DecryptHub to view sign-in status.</p>')
  }

  private async exchange(attempt: Attempt, code: string, verifier: string, redirect: string, response: ServerResponse): Promise<void> {
    let token: string | undefined
    let committed = false
    try {
      const issued = parseIssuedCommunityToken(await requestCommunity(this.options.origin, '/auth/desktop/token', attempt.controller.signal,
        undefined, { code, code_verifier: verifier, redirect_uri: redirect }))
      token = issued.access_token
      const expiresAt = Date.now() + issued.expires_in * 1000
      const profile = communityProfile.safeParse(await requestCommunity(this.options.origin, '/auth/desktop/me', attempt.controller.signal, token))
      if (!profile.success) throw new CommunityAccountFailure('protocol')
      const credential: CommunityCredential = { origin: this.options.origin, token, expiresAt, profile: profile.data }
      committed = await this.commit(attempt, credential)
      if (!committed) throw new CommunityAccountFailure('denied')
      this.reply(response, 200)
      await this.finish(attempt, null)
    } catch (error) {
      this.reply(response, 400)
      await this.finish(attempt, error instanceof CommunityAccountFailure ? error.code : 'protocol')
    } finally {
      if (token !== undefined && !committed) this.revoke(token)
    }
  }

  private commit(attempt: Attempt, credential: CommunityCredential): Promise<boolean> {
    const work = this.queue.then(() => {
      if (this.closed || this.pending !== attempt || attempt.controller.signal.aborted) return false
      this.save(credential)
      this.credential = credential
      this.phase = 'signed-in'
      this.error = null
      this.publish()
      return true
    })
    this.queue = work.then(() => undefined, () => undefined)
    return work
  }

  private finish(attempt: Attempt, error: CommunityAccountError | null): Promise<CommunityAccountSnapshot> {
    return this.mutate(() => {
      if (this.pending !== attempt) return
      this.retire(false)
      this.phase = this.credential === null ? 'signed-out' : 'signed-in'
      this.error = error
    })
  }

  /** @returns state after invalidating pending browser authorization. */
  cancel(): Promise<CommunityAccountSnapshot> {
    return this.mutate(() => {
      this.retire()
      this.phase = this.credential === null ? 'signed-out' : 'signed-in'
      this.error = null
    })
  }

  /** @returns local logout after persistence succeeds; remote revocation is best effort. */
  signOut(): Promise<CommunityAccountSnapshot> {
    return this.mutate(() => {
      this.clear()
      const token = this.credential?.token
      this.retire()
      this.credential = null
      this.phase = 'signed-out'
      this.error = null
      if (token !== undefined) this.revoke(token)
    })
  }

  private revoke(token: string): void {
    void requestCommunity(this.options.origin, '/auth/desktop/logout', this.lifetime.signal, token, {}).catch((_error: unknown) => {
      // Remote failures cannot restore a locally removed or uncommitted grant.
    })
  }

  /** @returns refreshed profile, retaining cached identity on temporary failures. */
  refresh(): Promise<CommunityAccountSnapshot> {
    if (this.refreshTask !== undefined) return this.refreshTask
    const work = this.readProfile().finally(() => { if (this.refreshTask === work) this.refreshTask = undefined })
    this.refreshTask = work
    return work
  }

  private async readProfile(): Promise<CommunityAccountSnapshot> {
    await this.get()
    const credential = this.credential
    if (credential === null || this.closed) return this.snapshot()
    let result: unknown
    let failure: CommunityAccountError | undefined
    try { result = await requestCommunity(this.options.origin, '/auth/desktop/me', this.lifetime.signal, credential.token) }
    catch (error) { failure = error instanceof CommunityAccountFailure ? error.code : 'network' }
    return this.mutate(() => {
      if (this.credential !== credential) return
      if (failure === 'expired') {
        this.clear()
        this.credential = null
        this.phase = 'signed-out'
      } else if (failure === undefined) {
        const parsed = communityProfile.safeParse(result)
        if (!parsed.success) throw new CommunityAccountFailure('protocol')
        const updated = { ...credential, profile: parsed.data }
        this.save(updated)
        this.credential = updated
      }
      this.error = failure ?? null
    })
  }

  /** @param page - fixed community page or active authorization; arbitrary URLs are not accepted. */
  async open(page: 'community' | 'points' | 'authorize'): Promise<void> {
    const target = page === 'authorize' ? this.pending?.url
      : new URL(page === 'points' ? '/points' : '/', this.options.origin).href
    if (target !== undefined && !this.closed) await this.options.openBrowser(target)
  }

  /** Stop callback and network work; persisted identity remains available on restart. */
  dispose(): void { this.closed = true; this.retire(); this.lifetime.abort() }
}
