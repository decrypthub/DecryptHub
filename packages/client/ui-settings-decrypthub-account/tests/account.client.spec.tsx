// @vitest-environment jsdom
import { act, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { CommunityAccountSource } from '../src/client/account-source.ts'
import type { CommunityAccountBridge, CommunityAccountSnapshot } from '../src/types.ts'

afterEach(() => { vi.unstubAllGlobals() })
const signedOut: CommunityAccountSnapshot = { revision: 1, phase: 'signed-out', profile: null, error: null }
const signedIn: CommunityAccountSnapshot = { revision: 3, phase: 'signed-in', error: null,
  profile: { id: 'member-1', handle: 'member', nickname: '社区成员', points: 23, experience: 42 } }

function bridge() {
  let listener: ((state: CommunityAccountSnapshot) => void) | undefined
  const stop = vi.fn(() => { listener = undefined })
  const native: CommunityAccountBridge = {
    get: vi.fn(async () => signedOut), refresh: vi.fn(async () => signedIn),
    start: vi.fn(async () => ({ ...signedOut, revision: 2, phase: 'waiting-browser' as const })),
    cancel: vi.fn(async () => ({ ...signedOut, revision: 4 })), signOut: vi.fn(async () => ({ ...signedOut, revision: 5 })),
    open: vi.fn(async () => {}), subscribe: vi.fn<CommunityAccountBridge['subscribe']>((next) => { listener = next; return stop }),
  }
  return { native, stop, publish: (state: CommunityAccountSnapshot) => listener?.(state) }
}

it('renders the native login lifecycle through the settings slot and disposes its subscription', async () => {
  const f = bridge()
  vi.stubGlobal('dshDesktop', { protocolVersion: 1, communityAccount: f.native })
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const plugin = await runtime.mount({ inject: [...inject], apply })
  const { view, container } = runtime.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByRole('button', { name: '通过浏览器登录' }).hasAttribute('disabled')).toBe(false) })
  expect(container.textContent).toMatchSnapshot('signed out')
  fireEvent.click(view.getByRole('button', { name: '通过浏览器登录' }))
  await waitFor(() => { expect(view.getByRole('status').textContent).toBe('等待浏览器授权') })
  expect(f.native.start).toHaveBeenCalledTimes(1)
  await act(async () => { f.publish(signedIn) })
  expect(container.textContent).toMatchSnapshot('signed in with independent points and experience')
  fireEvent.click(view.getByRole('button', { name: '积分中心' }))
  await waitFor(() => { expect(f.native.open).toHaveBeenCalledWith('points') })
  await plugin.dispose()
  expect(f.stop).toHaveBeenCalledTimes(1)
  expect(runtime.slots.entries('settings.section')).toHaveLength(0)
})

it('ignores stale reads and late native results after disposal', async () => {
  const f = bridge()
  let resolve!: (state: CommunityAccountSnapshot) => void
  f.native.get = () => new Promise((next) => { resolve = next })
  const source = new CommunityAccountSource(f.native)
  f.publish(signedIn)
  resolve(signedOut)
  await Promise.resolve()
  expect(source.store.getSnapshot().state).toEqual(signedIn)
  source.dispose()
  f.publish({ ...signedOut, revision: 10 })
  expect(source.store.getSnapshot().state).toEqual(signedIn)
  expect(f.stop).toHaveBeenCalledTimes(1)
})

it('retains identity on an IPC failure and exposes retryable command feedback', async () => {
  const f = bridge()
  const source = new CommunityAccountSource(f.native)
  f.publish(signedIn)
  f.native.refresh = vi.fn(async () => { throw new Error('transport closed') })
  await source.run('refresh')
  expect(source.store.getSnapshot()).toMatchObject({ state: signedIn, busy: false, failed: true })
  source.dispose()
})
