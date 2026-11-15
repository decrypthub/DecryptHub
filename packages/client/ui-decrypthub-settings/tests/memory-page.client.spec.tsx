// @vitest-environment jsdom
/** The memory catalog lists, searches, adds, edits, and removes stored entries. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type {} from '../src/client/index.ts'
import { MemoryPage } from '../src/client/MemoryPage.tsx'
import { en, zh } from '../src/client/locales.ts'
import { MemorySource, type MemoryOperations } from '../src/client/source.ts'

/** One namespace row the fake Remote returns. */
const namespace = {
  ns: 'product-memory',
  autoGenerate: true,
  schema: {},
  value: {
    maxSectionChars: 2000,
    entries: {
      a: { text: '旧事实', scope: 'user', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      b: { text: '项目约定', scope: 'project', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
    },
  },
  applies: 'live' as const,
  secrets: [],
  revision: 3,
}

/**
 * Compose the settings section against a fake settings Remote.
 * @returns the runtime and the write spy.
 */
async function fixture(describe?: MemoryOperations['describe']): Promise<{ runtime: SlotTestRuntime; write: ReturnType<typeof vi.fn> }> {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.memory', { en, zh })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const write = vi.fn(async (_ops: unknown, _revision: number) => namespace)
  const source = new MemorySource({
    describe: describe ?? (async () => ({ writable: true, hasDocument: true, namespaces: [namespace] })),
    write,
  })
  onTestFinished(() => { source.dispose() })
  runtime.slots.register({
    name: 'settings.section', id: 'memory-test', label: () => zh.nav, locale: 'settings.memory',
    inject: () => ({ hooks: { memory: source.store }, source }),
  }, MemoryPage)
  return { runtime, write }
}

it('lists stored memories and writes a manual addition from the detail pane', async () => {
  const { runtime, write } = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText('旧事实')).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: zh['host.create'] }))
  const field = view.getByPlaceholderText(zh['detail.placeholder']) as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: '新事实' } })
  fireEvent.click(view.getByRole('button', { name: zh['detail.save'] }))
  await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
  const ops = write.mock.calls[0]![0] as { op: string; path: readonly string[]; value?: { text?: string } }[]
  expect(ops[0]?.op).toBe('set')
  expect(ops[0]?.path[0]).toBe('entries')
  expect(ops[0]?.value?.text).toBe('新事实')
})

it('filters by scope and search text', async () => {
  const { runtime } = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText('旧事实')).toBeTruthy() })
  expect(view.getByText('项目约定')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: zh['scope.project'] }))
  expect(view.queryByText('旧事实')).toBeNull()
  expect(view.getByText('项目约定')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: zh['scopeFilter.all'] }))
  fireEvent.change(view.getByPlaceholderText(zh['search.placeholder']), { target: { value: '项目' } })
  expect(view.queryByText('旧事实')).toBeNull()
  expect(view.getByText('项目约定')).toBeTruthy()
})

it('opens a row for viewing and removes it through the unset path op', async () => {
  const { runtime, write } = await fixture()
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText('旧事实')).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: '旧事实' }))
  fireEvent.click(view.getByRole('button', { name: zh['detail.delete'] }))
  const dialog = await waitFor(() => screen.getByRole('dialog', { name: zh['detail.deleteConfirmTitle'] }))
  fireEvent.click(screen.getByRole('button', { name: zh['detail.deleteConfirm'] }))
  await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
  expect(dialog).toBeTruthy()
  const ops = write.mock.calls[0]![0] as { op: string; path: readonly string[] }[]
  expect(ops[0]?.op).toBe('unset')
  expect(ops[0]?.path).toEqual(['entries', 'a'])
})

it('prevents writes after a load failure and enables them after retry', async () => {
  const describe = vi.fn<MemoryOperations['describe']>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ writable: true, hasDocument: true, namespaces: [namespace] })
  const { runtime, write } = await fixture(describe)
  const { view } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByText(zh['list.error'])).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: zh['list.retry'] }))
  await waitFor(() => { expect(view.getByText('旧事实')).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: zh['host.create'] }))
  fireEvent.change(view.getByPlaceholderText(zh['detail.placeholder']), { target: { value: '恢复后写入' } })
  fireEvent.click(view.getByRole('button', { name: zh['detail.save'] }))
  await waitFor(() => { expect(write).toHaveBeenCalledTimes(1) })
})
