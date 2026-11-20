/** Product naming preserves upstream dictionaries and technical identifiers. */
import { afterEach, expect, it, vi } from 'vitest'
import { SHIPPED_LOCALE_IDS } from '../../../scripts/shipped-locales.ts'
import { productMessages } from '../src/decrypthub-locale.ts'
import { en, resolveDesktopLocale } from '../src/locale.ts'

afterEach(() => { vi.unstubAllEnvs() })

it('keeps the upstream dictionary unchanged without a product title', () => {
  vi.stubEnv('DSH_CLIENT_TITLE', undefined)
  expect(resolveDesktopLocale('en').messages).toBe(en)
})

it('applies product naming without changing provider names, identifiers or placeholders', () => {
  vi.stubEnv('DSH_CLIENT_TITLE', 'DecryptHub')
  const source = { heading: 'DeepSeek Harness', message: 'Restart DSH; keep DSH_HOME and DeepSeek {version}' }
  expect(productMessages(source)).toEqual({ heading: 'DecryptHub', message: 'Restart DecryptHub; keep DSH_HOME and DeepSeek {version}' })
  expect(source.heading).toBe('DeepSeek Harness')
  expect(resolveDesktopLocale('en').messages.welcomeTitle).toBe('DecryptHub')
  for (const id of SHIPPED_LOCALE_IDS) {
    expect(resolveDesktopLocale(id).messages.welcomeKeyDescription).not.toContain('Harness')
  }
})
