// @vitest-environment jsdom
/** The memory section lists stored entries and writes additions and removals. */
import { fireEvent, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../src/client/index.ts'
import { MemoryPage } from '../src/client/MemoryPage.tsx'
import { en, zh } from '../src/client/locales.ts'
import { MemorySource } from '../src/client/source.ts'

/** One namespace row the fake Remote returns. */
const namespace = {
  ns: 'product-memory',
  autoGenerate: true,
  schema: {},
  value: { maxSectionChars: 2000, entries: { a: { text: '旧事实', scope: 'user', createdAt: 't0', updatedAt: 't0' } } },
  applies: 'live' as const,
  secrets: [],
  revision: 3,
}

/**
 * Compose the settings section against a fake settings Remote.
 * @returns the runtime and the write spy.
 */
async function fixture(): Promise<{ runtime: SlotTestRuntime; write: ReturnType<typeof vi.fn> }> {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.memory', { en, zh })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const write = vi.fn(async () => namespace)
  const source = new MemorySource({
    describe: async () => ({ writable: true, hasDocument: true, namespaces: [namespace] }),
    write,
  })
  onTestFinished(() => { source.dispose() })
  runtime.slots.register({
    name: 'settings.section', id: 'memory-test', label: () => zh.nav, locale: 'settings.memory',
    inject: () => ({ hooks: { memory: source.store }, source }),
  }, MemoryPage)
  return { runtime, write }
}

it('lists stored memories and writes an addition', async () => {
  const { runtime, write } = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText('旧事实')).toBeTruthy() })
  fireEvent.change(view.getByPlaceholderText(zh.placeholder), { target: { value: '新事实' } })
  fireEvent.click(view.getByRole('button', { name: zh.add }))
  await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
  const ops = write.mock.calls[0]![0] as { op: string; path: readonly string[]; value?: { text?: string } }[]
  expect(ops[0]?.op).toBe('set')
  expect(ops[0]?.path[0]).toBe('entries')
  expect(ops[0]?.value?.text).toBe('新事实')
})

it('removes an entry through the unset path op', async () => {
  const { runtime, write } = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText('旧事实')).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: zh.remove }))
  await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
  const ops = write.mock.calls[0]![0] as { op: string; path: readonly string[] }[]
  expect(ops[0]?.op).toBe('unset')
  expect(ops[0]?.path).toEqual(['entries', 'a'])
})
