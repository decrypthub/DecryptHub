// @vitest-environment jsdom
/** Both product settings sections register and render side by side. */
import { waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../src/client/index.ts'
import { MemoryPage } from '../src/client/MemoryPage.tsx'
import { PersonaPage } from '../src/client/PersonaPage.tsx'
import { en, zh, personaEn, personaZh } from '../src/client/locales.ts'
import { MemorySource } from '../src/client/source.ts'
import { PersonaSource } from '../src/client/persona-source.ts'

/** Memory namespace row. */
const memoryNamespace = {
  ns: 'product-memory',
  autoGenerate: true,
  schema: {},
  value: { maxSectionChars: 2000, entries: { a: { text: '记住的事实', scope: 'user', createdAt: 't0', updatedAt: 't0' } } },
  applies: 'live' as const,
  secrets: [],
  revision: 2,
}

/** Role namespace row. */
const personaNamespace = {
  ns: 'product-persona',
  autoGenerate: true,
  schema: {},
  value: { persona: '你是中文助手。' },
  applies: 'live' as const,
  secrets: [],
  revision: 4,
}

/**
 * Register both sections against fake settings Remotes.
 * @returns the runtime with both contributions installed.
 */
async function fixture(): Promise<SlotTestRuntime> {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.memory', { en, zh })
  locale.register('settings.persona', { en: personaEn, zh: personaZh })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const describe = async () => ({ writable: true, hasDocument: true, namespaces: [memoryNamespace, personaNamespace] })
  const memory = new MemorySource({ describe, write: vi.fn(async () => memoryNamespace) })
  const persona = new PersonaSource({ describe, write: vi.fn(async () => personaNamespace) })
  onTestFinished(() => { memory.dispose(); persona.dispose() })
  runtime.slots.register({
    name: 'settings.section', id: 'memory', label: () => zh.nav, locale: 'settings.memory',
    inject: () => ({ hooks: { memory: memory.store }, source: memory }),
  }, MemoryPage)
  runtime.slots.register({
    name: 'settings.section', id: 'persona', label: () => personaZh.nav, locale: 'settings.persona',
    inject: () => ({ hooks: { persona: persona.store }, source: persona }),
  }, PersonaPage)
  return runtime
}

it('exposes both sections in the settings nav', async () => {
  const runtime = await fixture()
  const entries = runtime.slots.entries('settings.section')
  expect(entries).toHaveLength(2)
})

it('renders each section independently', async () => {
  const runtime = await fixture()
  const memoryView = runtime.renderSlot('settings.section', { close: vi.fn() }, { only: 'memory' })
  await waitFor(() => { expect(memoryView.view.getByText('记住的事实')).toBeTruthy() })
  const personaView = runtime.renderSlot('settings.section', { close: vi.fn() }, { only: 'persona' })
  const field = personaView.view.getByPlaceholderText(personaZh.placeholder) as HTMLTextAreaElement
  await waitFor(() => { expect(field.value).toBe('你是中文助手。') })
})
