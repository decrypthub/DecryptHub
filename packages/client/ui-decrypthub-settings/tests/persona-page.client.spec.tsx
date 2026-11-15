// @vitest-environment jsdom
/** The role section loads the stored text and writes a revision-checked edit. */
import { fireEvent, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../src/client/index.ts'
import { PersonaPage } from '../src/client/PersonaPage.tsx'
import { personaEn, personaZh } from '../src/client/locales.ts'
import { PersonaSource, type PersonaOperations } from '../src/client/persona-source.ts'

/** One namespace row the fake Remote returns. */
const namespace = {
  ns: 'product-persona',
  autoGenerate: true,
  schema: {},
  value: { persona: '你是分析助手。' },
  applies: 'live' as const,
  secrets: [],
  revision: 5,
}

/**
 * Compose the role section against a fake settings Remote.
 * @returns the runtime and the write spy.
 */
async function fixture(describe?: PersonaOperations['describe']): Promise<{ runtime: SlotTestRuntime; write: ReturnType<typeof vi.fn> }> {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.persona', { en: personaEn, zh: personaZh })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const write = vi.fn(async () => namespace)
  const source = new PersonaSource({
    describe: describe ?? (async () => ({ writable: true, hasDocument: true, namespaces: [namespace] })),
    write,
  })
  onTestFinished(() => { source.dispose() })
  runtime.slots.register({
    name: 'settings.section', id: 'persona-test', label: () => personaZh.nav, locale: 'settings.persona',
    inject: () => ({ hooks: { persona: source.store }, source }),
  }, PersonaPage)
  return { runtime, write }
}

it('shows the stored role text and saves an edit', async () => {
  const { runtime, write } = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect((view.getByPlaceholderText(personaZh.placeholder) as HTMLTextAreaElement).value).toBe('你是分析助手。') })
  const field = view.getByPlaceholderText(personaZh.placeholder) as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: '你是逆向分析专家。' } })
  fireEvent.click(view.getByRole('button', { name: personaZh.save }))
  await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
  const ops = write.mock.calls[0]![0] as { op: string; path: readonly string[]; value?: string }[]
  expect(ops[0]?.op).toBe('set')
  expect(ops[0]?.path).toEqual(['persona'])
  expect(ops[0]?.value).toBe('你是逆向分析专家。')
})

it('prevents editing after a load failure and enables it after retry', async () => {
  const describe = vi.fn<PersonaOperations['describe']>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ writable: true, hasDocument: true, namespaces: [namespace] })
  const { runtime, write } = await fixture(describe)
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText(personaZh.failed)).toBeTruthy() })
  expect(view.getByPlaceholderText(personaZh.placeholder).hasAttribute('disabled')).toBe(true)
  expect(view.getByRole('button', { name: personaZh.save }).hasAttribute('disabled')).toBe(true)
  expect(write).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: personaZh.retry }))
  await waitFor(() => { expect((view.getByPlaceholderText(personaZh.placeholder) as HTMLTextAreaElement).value).toBe('你是分析助手。') })
  expect(view.getByPlaceholderText(personaZh.placeholder).hasAttribute('disabled')).toBe(false)
})
