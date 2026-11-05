import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { communityVault } from '../src/community-account-vault.ts'

it('uses native encryption and retains the previous grant when replacement encryption fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'decrypthub-account-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  const filename = join(directory, 'account.enc')
  let plain = ''
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((value: string) => { plain = value; return Buffer.from([4, 8, 15, 16, 23, 42]) }),
    decryptString: vi.fn((_value: Buffer) => plain),
  }
  const vault = communityVault(filename, encryption)
  const credential = { origin: 'https://decrypthub.cn', token: `dhd_${'t'.repeat(43)}`, expiresAt: Date.now() + 60_000,
    profile: { id: 'member-1', handle: 'member', nickname: '成员', points: null, experience: null } }
  expect(vault.load()).toBeNull()
  vault.save(credential)
  expect(vault.load()).toEqual(credential)
  const previous = readFileSync(filename)
  expect(previous.includes(credential.token)).toBe(false)
  encryption.encryptString.mockImplementationOnce(() => { throw new Error('OS vault unavailable') })
  expect(() => { vault.save({ ...credential, expiresAt: Date.now() + 120_000 }) }).toThrow()
  expect(readFileSync(filename)).toEqual(previous)
  vault.clear()
  expect(vault.load()).toBeNull()
})

it('refuses persistence when OS encryption is unavailable', () => {
  const encryption = { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() }
  const vault = communityVault('/unused-account-fixture', encryption)
  expect(() => { vault.save({ origin: 'https://decrypthub.cn', token: `dhd_${'t'.repeat(43)}`, expiresAt: Date.now(),
    profile: { id: 'member-1', handle: 'member', nickname: '成员', points: null, experience: null } }) }).toThrow('storage')
  expect(encryption.encryptString).not.toHaveBeenCalled()
})
