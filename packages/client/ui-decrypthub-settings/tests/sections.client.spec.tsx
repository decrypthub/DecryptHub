// @vitest-environment jsdom
/** The fused memory/role section keeps memory as the host and opens role in a dialog. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../src/client/index.ts'
import { MemoryPersonaPage } from '../src/client/MemoryPersonaPage.tsx'
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
 * Register the fused section against fake settings Remotes.
 * @returns the runtime with the contribution installed.
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
  const t = locale.bind('settings.memory')
  const pt = locale.bind('settings.persona')
  runtime.slots.register({
    name: 'settings.section', id: 'memory-persona', label: () => zh.nav, locale: 'settings.memory',
    inject: () => ({
      hooks: { memory: memory.store, persona: persona.store },
      memory: { source: memory },
      persona: { source: persona },
      memoryT: t,
      personaT: pt,
    }),
  }, MemoryPersonaPage)
  return runtime
}

it('exposes one fused section in the settings nav', async () => {
  const runtime = await fixture()
  expect(runtime.slots.entries('settings.section')).toHaveLength(1)
  const label = runtime.slots.entries('settings.section')[0]?.options.label
  expect(typeof label === 'function' ? label() : label).toBe('记忆与角色')
})

it('opens the role editor in a dialog from Set role and keeps the memory list', async () => {
  const runtime = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText('记住的事实')).toBeTruthy() })
  expect(view.queryByRole('tab', { name: '角色' })).toBeNull()
  expect(screen.queryByRole('dialog', { name: '角色' })).toBeNull()
  expect(view.getByRole('button', { name: '添加记忆' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '设定角色' }))
  const dialog = await screen.findByRole('dialog', { name: '角色' })
  expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toBe('你是中文助手。')
  expect(view.getByText('记住的事实')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: personaZh.close }))
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: '角色' })).toBeNull() })
  expect(view.getByText('记住的事实')).toBeTruthy()
})
