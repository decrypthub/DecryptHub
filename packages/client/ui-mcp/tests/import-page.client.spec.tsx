// @vitest-environment jsdom
/** The Harness import page copies conversations and shows the outcome. */
import { fireEvent, waitFor } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ImportItem, ImportResult } from '../src/client/ImportPage.tsx'
import { ImportPage } from '../src/client/ImportPage.tsx'
import { en, zh } from '../src/client/locales.ts'

/** The single conversation category as the Host previews it. */
const PREVIEW: readonly ImportItem[] = [
  { id: 'sessions', count: 3, seconds: 2, detail: '4 条会话；已存在 1 条会跳过。' },
]

/**
 * Render the page over a locale runtime and stub Host actions.
 * @param run - Host-side import outcome for the selected category.
 * @returns rendered view and the stub.
 */
async function render(run: (source: string, kinds: readonly string[]) => Promise<{ results: readonly ImportResult[] }>) {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.mcp', { en, zh })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const actions = {
    preview: vi.fn(async () => ({ source: '/home/.dsh', items: PREVIEW })),
    run: vi.fn(run),
  }
  runtime.slots.register({
    name: 'settings.section', id: 'harness-import-test', label: () => zh['import.title'], locale: 'settings.mcp',
    inject: () => ({ actions }),
  }, ImportPage)
  const { view } = runtime.renderSlot('settings.section', { close: () => {} })
  fireEvent.click(view.getByRole('button', { name: zh['import.scan'] }))
  await waitFor(() => { expect(view.getByText(zh['import.kind.sessions'])).toBeTruthy() })
  return { view, actions }
}

it('sends the conversation category in one request and renders the imported status', async () => {
  const results: ImportResult[] = [
    { id: 'sessions', status: 'imported', detail: '导入 3 条会话，并入 2 个分组' },
  ]
  const { view, actions } = await render(async () => ({ results }))
  fireEvent.click(view.getByRole('button', { name: zh['import.run'] }))
  await waitFor(() => { expect(actions.run).toHaveBeenCalledTimes(1) })
  expect(actions.run.mock.calls[0]?.[1]).toEqual(['sessions'])
  await waitFor(() => { expect(view.getByText(zh['import.status.imported'])).toBeTruthy() })
})

it('renders the skipped outcome when the destination already has the conversations', async () => {
  const results: ImportResult[] = [
    { id: 'sessions', status: 'skipped', detail: '会话均已存在，无需导入。' },
  ]
  const { view } = await render(async () => ({ results }))
  fireEvent.click(view.getByRole('button', { name: zh['import.run'] }))
  await waitFor(() => { expect(view.getByText(zh['import.status.skipped'])).toBeTruthy() })
})
