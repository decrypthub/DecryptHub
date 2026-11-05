/** OS-backed encryption for the native community grant, separate from API keys. */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { communityCredential, CommunityAccountFailure, type CommunityCredential } from './community-account-protocol.ts'
import type { CommunityVault } from './community-account.ts'

/** Electron safeStorage operations; plaintext backends are rejected by the native installer. */
export interface CommunityEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

/**
 * Build an owner-only, atomically replaced encrypted vault.
 * @param filename - application-owned credential file.
 * @param encryption - OS-backed encryption, available after Electron readiness.
 * @returns synchronous persistence; failed writes retain the previous grant.
 */
export function communityVault(filename: string, encryption: CommunityEncryption): CommunityVault {
  const available = (): void => {
    if (!encryption.isEncryptionAvailable()) throw new CommunityAccountFailure('storage')
  }
  return {
    load() {
      let bytes: Buffer
      try { bytes = readFileSync(filename) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw new CommunityAccountFailure('storage')
      }
      available()
      if (bytes.length > 65_536) throw new CommunityAccountFailure('storage')
      const parsed = communityCredential.safeParse(JSON.parse(encryption.decryptString(bytes)))
      if (!parsed.success) throw new CommunityAccountFailure('storage')
      return parsed.data
    },
    save(value: CommunityCredential) {
      available()
      const temporary = `${filename}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, encryption.encryptString(JSON.stringify(value)), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, filename)
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary)
      }
    },
    clear() {
      try { unlinkSync(filename) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CommunityAccountFailure('storage') }
    },
  }
}
