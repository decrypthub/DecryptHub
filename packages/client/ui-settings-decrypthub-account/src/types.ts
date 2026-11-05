/** Credential-free community account operations exposed by the native desktop. */

/** Community identity and independent reputation counters. */
export interface CommunityProfile {
  readonly id: string
  readonly handle: string
  readonly nickname: string
  readonly points: number | null
  readonly experience: number | null
}

/** Safe error categories; native exceptions and remote bodies never reach the renderer. */
export type CommunityAccountError = 'network' | 'unavailable' | 'protocol' | 'storage' | 'expired' | 'denied' | 'browser' | 'timeout'

/** Monotonic native state, shared by the account section and sidebar launcher. */
export interface CommunityAccountSnapshot {
  readonly revision: number
  readonly phase: 'signed-out' | 'waiting-browser' | 'exchanging' | 'signed-in'
  readonly profile: CommunityProfile | null
  readonly error: CommunityAccountError | null
}

/** Main-frame-only commands; no command accepts a token or arbitrary destination. */
export interface CommunityAccountBridge {
  /** @returns persisted local identity without a network request. */
  get(this: void): Promise<CommunityAccountSnapshot>
  /** @returns identity after a bounded profile refresh; temporary failures retain it. */
  refresh(this: void): Promise<CommunityAccountSnapshot>
  /** @returns state after opening browser authorization, without waiting for approval. */
  start(this: void): Promise<CommunityAccountSnapshot>
  /** @returns state after retiring the current attempt and its callback server. */
  cancel(this: void): Promise<CommunityAccountSnapshot>
  /** @returns signed-out state only after local credential removal succeeds. */
  signOut(this: void): Promise<CommunityAccountSnapshot>
  /** @param page - a fixed community destination, or the current pending authorization. */
  open(this: void, page: 'community' | 'points' | 'authorize'): Promise<void>
  /** @param listener - safe native state recipient. @returns listener cleanup. */
  subscribe(this: void, listener: (state: CommunityAccountSnapshot) => void): () => void
}
