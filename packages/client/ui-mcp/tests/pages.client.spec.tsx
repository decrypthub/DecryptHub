// @vitest-environment jsdom
import { fireEvent, waitFor, within, screen } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '../src/client/index.ts'
import { McpPage } from '../src/client/Page.tsx'
import { ComponentsPage } from '../src/client/ComponentsPage.tsx'
import { ChatTargetPicker } from '../src/client/ChatTargetPicker.tsx'
import { WdhStatusPill } from '../src/client/WdhStatusPill.tsx'
import { SkillsMcpPage } from '../src/client/SkillsMcpPage.tsx'
import { en, zh } from '../src/client/locales.ts'
import { McpSource } from '../src/client/source.ts'
import { ComponentsSource } from '../src/client/components-source.ts'
import type { ComponentsState } from '../src/client/components-source.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatTargetChoice, ChatTargetView, ComponentInventory, WdhCaptureDetail, WdhCaptureSelection } from '@deepseek-ai/dsh-decrypthub-components/types'

async function runtime() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.mcp', { en, zh })
  await runtime.declare({
    'settings.section': { kind: 'list', scope: 'root' },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
  })
  return runtime
}

it('opens the chat capture list and reads both sections with the selected request identity', async () => {
  const r = await runtime()
  const id = await r.sessions.add({ id: 'chat-with-browser-capture' })
  const session = r.sessions.retain(id)
  onTestFinished(async () => {
    await r.dispose()
    session[Symbol.dispose]()
  })
  await session.ready
  const components = createSnapshotStore<ComponentsState>({
    busy: false, failed: false, connectionFailed: false, connections: [],
    value: { components: [], wdhTools: 27,
      wdh: [{ agentId: id, workspace: '/fixture/workspace', status: { state: 'connected', toolCount: 27, connectedAt: 12 } }],
      browser: { state: 'unchecked', version: null }, configuration: null },
  })
  const generation = '82041cf7-1e9a-4d52-b24c-3e246d88e8db'
  const first = Promise.withResolvers<WdhCaptureDetail>()
  const evidence = (requestId: string, text: string, functionName: string): WdhCaptureDetail => ({
    id: requestId, headers: 'content-type: text/plain', headersTruncated: false,
    body: { text, encoding: null, truncated: false },
    frames: [{ functionName, url: 'https://fixture.test/page.js', line: 7, column: 3 }],
  })
  const capture = {
    list: vi.fn(async () => ({
      generation, requests: [
        { id: 'r7', url: 'https://fixture.test/first', method: 'GET', status: 200 },
        { id: 'r8', url: 'https://fixture.test/second', method: 'GET', status: 201 },
      ],
    })),
    detail: vi.fn(async (_session: SessionId, selection: WdhCaptureSelection, _signal: AbortSignal) =>
      selection.id === 'r7' ? first.promise : evidence('r8', 'second response', 'secondInitiator')),
  }
  r.slots.register({ name: 'conversation.composer.dock', id: 'fixture-capture', locale: 'settings.mcp',
    inject: () => ({ hooks: { components }, retry: () => {}, capture }),
  }, WdhStatusPill)
  const slot = r.renderSlot('conversation.composer.dock', {}, { session })
  fireEvent.click(slot.view.getByRole('button', { name: '浏览器已连接 · 抓包' }))
  const dialog = within(screen.getByRole('dialog', { name: '浏览器抓包' }))
  fireEvent.click(await dialog.findByRole('button', { name: /fixture.test\/first/ }))
  const firstCall = capture.detail.mock.calls[0]
  fireEvent.click(dialog.getByRole('button', { name: /fixture.test\/second/ }))
  expect(await dialog.findByText('second response')).toBeTruthy()
  expect(dialog.getByText('secondInitiator')).toBeTruthy()
  expect(dialog.getByText('https://fixture.test/page.js:7:3')).toBeTruthy()
  expect(capture.list).toHaveBeenCalledWith(id, expect.any(AbortSignal))
  expect(capture.detail).toHaveBeenLastCalledWith(id, { generation, id: 'r8' }, expect.any(AbortSignal))
  expect(firstCall?.[2].aborted).toBe(true)
  first.resolve(evidence('r7', 'first response', 'firstInitiator'))
  await first.promise
  expect(dialog.queryByText('first response')).toBeNull()
  fireEvent.click(dialog.getByRole('button', { name: zh.close }))
  expect(screen.queryByRole('dialog', { name: '浏览器抓包' })).toBeNull()
})

it('selects a device and App in the chat header and retains its selection when switching chats', async () => {
  const r = await runtime()
  const firstId = await r.sessions.add({ id: 'fixture-first-chat' })
  const secondId = await r.sessions.add({ id: 'fixture-second-chat' })
  const first = r.sessions.retain(firstId)
  const second = r.sessions.retain(secondId)
  onTestFinished(async () => {
    await r.dispose()
    first[Symbol.dispose]()
    second[Symbol.dispose]()
  })
  await Promise.all([first.ready, second.ready])
  const base = 'http://127.0.0.1:32000'
  const endpoint = base + '/api/mcp'
  const device = { enabled: true, command: 'idh', args: [], endpoint: base, devices: [base] }
  const components = createSnapshotStore<ComponentsState>({
    busy: false, failed: false, connectionFailed: false, connections: [],
    value: { components: [], wdhTools: null, wdh: [], browser: { state: 'unchecked', version: null },
      configuration: { revision: 1, writable: true, wdh: { enabled: false, browser: 'system' },
        adh: { ...device, endpoint: '', devices: [] }, idh: device },
    },
  })
  const targets = new Map<SessionId, ChatTargetView>()
  const discover = vi.fn(async (component: 'adh' | 'idh'): Promise<ComponentInventory> => ({
    schemaVersion: 1, component, version: '1', error: null, checkedAt: new Date().toISOString(),
    connections: [], targets: [{ online: true, name: 'Fixture App', id: 'fixture-app', endpoint, pid: 42 }],
  }))
  const writeTarget = vi.fn(async (session: SessionId, choice: ChatTargetChoice | null): Promise<ChatTargetView | null> => {
    if (choice === null) {
      targets.delete(session)
      return null
    }
    const view = { ...choice, name: 'Fixture App', state: 'bound' as const }
    targets.set(session, view)
    return view
  })
  r.slots.register({ name: 'conversation.session.header.utilities', id: 'fixture-target', locale: 'settings.mcp',
    inject: () => ({ hooks: { components },
      readTarget: async (session: SessionId) => targets.get(session) ?? null, discover, writeTarget }),
  }, ChatTargetPicker)
  const slot = r.renderSlot('conversation.session.header.utilities', {}, { session: first })
  fireEvent.click(slot.view.getByRole('button', { name: '设备目标' }))
  const dialog = within(screen.getByRole('dialog'))
  await dialog.findByRole('option', { name: /Fixture App.*PID 42/ })
  fireEvent.change(dialog.getByLabelText('设备与 App'), { target: { value: '0' } })
  fireEvent.click(dialog.getByRole('button', { name: '绑定到当前聊天' }))
  expect(await slot.view.findByRole('button', { name: 'IDH · Fixture App' })).toBeTruthy()
  expect(writeTarget).toHaveBeenCalledWith(firstId, { component: 'idh', endpoint, id: 'fixture-app', pid: '42', appId: 'Fixture App' }, expect.any(AbortSignal))
  slot.update({}, { session: second })
  expect(slot.view.getByRole('button', { name: '设备目标' })).toBeTruthy()
  slot.update({}, { session: first })
  expect(await slot.view.findByRole('button', { name: 'IDH · Fixture App' })).toBeTruthy()
})
function mcpSource() {
  const namespace = { ns: 'mcp-manager', autoGenerate: false, schema: {}, value: { servers: {} }, applies: 'live' as const, secrets: [], revision: 4 }
  return new McpSource({ describe: async () => ({ writable: true, hasDocument: true, namespaces: [namespace] }),
    write: vi.fn(async () => namespace), credential: async () => {}, async *watch() {}, restart: async () => {},
    probe: async () => { throw new Error('fixture') } })
}

it('reviews imports, shows conflicts and keeps imported commands disabled', async () => {
  const r = await runtime(), source = mcpSource()
  onTestFinished(() => { source.dispose() })
  r.slots.register({ name: 'settings.section', id: 'mcp-test', label: () => zh.nav, locale: 'settings.mcp',
    inject: () => ({ hooks: { mcp: source.store }, source }) }, McpPage)
  const { view } = r.renderSlot('settings.section', { close: vi.fn() })
  await waitFor(() => { expect(view.getByRole('button', { name: '导入配置' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(view.getByRole('button', { name: '导入配置' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('粘贴 mcpServers JSON 配置'), { target: { value: JSON.stringify({ mcpServers: { example: { command: 'node' }, wdh: { command: 'wdh' }, bad: { type: 'sse' } } }) } })
  expect(dialog.getByRole('button', { name: '导入有效条目' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(dialog.getByRole('button', { name: '预览导入' }))
  expect(dialog.getByText('可导入，默认停用')).toBeTruthy()
  expect(dialog.getByText('名称无效或属于官方组件')).toBeTruthy()
  expect(dialog.getByText('暂不支持此连接方式')).toBeTruthy()
})

it('keeps horizontal status rows compact and opens install or device connect in the dialog', async () => {
  const r = await runtime(), mcp = mcpSource()
  const state: ComponentsState = { busy: false, failed: false, connectionFailed: false, connections: [], value: {
    components: [
      { id: 'wdh', installed: { id: 'wdh', version: '1.0.0', source: 'managed', entry: '/fixture/cli.mjs', runtime: 'node' }, localCommand: null, localVersion: null, previousVersion: null, latestVersion: null, catalogError: null, localError: null,
        operation: { kind: 'component', phase: 'installed', received: 100, total: 100 } },
      { id: 'idh', installed: null, localCommand: '/fixture/idh', localVersion: '0.7.0', previousVersion: null, latestVersion: null, catalogError: null, localError: null, operation: null },
    ], wdhTools: null, wdh: [], browser: { state: 'missing', version: null }, configuration: { revision: 1, writable: true,
      wdh: { enabled: true, browser: 'cloak' }, adh: { enabled: false, command: 'adh', args: ['mcp'], endpoint: '', devices: [] }, idh: { enabled: false, command: 'idh', args: ['mcp'], endpoint: '', devices: [] } },
  } }
  const source = new ComponentsSource({ async *watch() {}, async *connections() {}, snapshot: async () => state.value!,
    checkUpdates: async () => {}, install: async () => {}, cancel: async () => {}, rollback: async () => {}, uninstall: async () => {},
    configure: async () => {}, reconnect: async () => {},
    inspectBrowser: async () => {}, inspectTargets: async () => {}, installBrowser: async () => {}, measureTools: async () => null,
  })
  onTestFinished(() => { source.dispose(); mcp.dispose() })
  const store = createSnapshotStore(state)
  r.slots.register({ name: 'settings.section', id: 'components-test', label: () => zh['official.nav'], locale: 'settings.mcp',
    inject: () => ({ hooks: { components: store, mcp: mcp.store }, source, mcp }) }, ComponentsPage)
  const { view } = r.renderSlot('settings.section', { close: vi.fn() })
  expect(view.queryByText('本机命令可用')).toBeNull()
  const switches = view.getAllByRole('switch')
  expect(switches).toHaveLength(2)
  expect(switches[0]!.getAttribute('aria-checked')).toBe('true')
  expect(switches[1]!.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(view.getByRole('button', { name: 'IDH · iOS 分析 · 打开设置' }))
  const idh = within(screen.getByRole('dialog'))
  expect(idh.getByText('0.7.0')).toBeTruthy()
  expect(idh.getByText('设备')).toBeTruthy()
  expect(idh.getByText('暂无设备')).toBeTruthy()
  expect(idh.queryByPlaceholderText('http://127.0.0.1:8080')).toBeNull()
  expect(idh.getByRole('button', { name: '添加设备' })).toBeTruthy()
  fireEvent.click(idh.getByRole('button', { name: '添加设备' }))
  expect(idh.queryByText('暂无设备')).toBeNull()
  expect(idh.getByPlaceholderText('http://127.0.0.1:8080')).toBeTruthy()
  fireEvent.click(idh.getAllByRole('button', { name: '关闭' })[0]!)
  fireEvent.click(view.getByRole('button', { name: 'WDH · 浏览器分析 · 打开设置' }))
  const wdh = within(screen.getByRole('dialog'))
  expect(wdh.getByText('1.0.0')).toBeTruthy()
  expect(wdh.getByRole('heading', { name: '浏览器内核' })).toBeTruthy()
  expect(wdh.getAllByRole('button', { name: /Cloak/ }).length).toBeGreaterThan(0)
  expect(wdh.queryByRole('button', { name: '验证文件' })).toBeNull()
  expect(wdh.getByRole('button', { name: '移除' })).toBeTruthy()
  expect(wdh.queryByText('安装完成')).toBeNull()
  fireEvent.click(wdh.getByRole('button', { name: '下载 Cloak' }))
  const dialogs = screen.getAllByRole('dialog')
  const license = within(dialogs[dialogs.length - 1]!)
  expect(license.getByRole('button', { name: '安装' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(license.getByRole('checkbox'))
  expect(license.getByRole('button', { name: '安装' }).hasAttribute('disabled')).toBe(false)
})

it.each([true, false])('reports actual WDH connectivity (live: %s)', async (live) => {
  const r = await runtime(), mcp = mcpSource()
  const state: ComponentsState = { busy: false, failed: false, connectionFailed: false, connections: [], value: {
    components: [
      { id: 'wdh', installed: { id: 'wdh', version: '0.1.1', source: 'managed', entry: '/fixture/cli.mjs', runtime: 'node' }, localCommand: null, localVersion: null, previousVersion: null, latestVersion: null, catalogError: null, localError: null, operation: null },
    ], wdhTools: 25, wdh: live ? [{ agentId: 'session-1' as SessionId, workspace: '/fixture/workspace', status: { state: 'connected', toolCount: 25, connectedAt: 0 } }] : [],
    browser: { state: 'missing', version: null }, configuration: { revision: 1, writable: true,
      wdh: { enabled: true, browser: 'cloak' }, adh: { enabled: false, command: 'adh', args: ['mcp'], endpoint: '', devices: [] }, idh: { enabled: false, command: 'idh', args: ['mcp'], endpoint: '', devices: [] } },
  } }
  const source = new ComponentsSource({ async *watch() {}, async *connections() {}, snapshot: async () => state.value!,
    checkUpdates: async () => {}, install: async () => {}, cancel: async () => {}, rollback: async () => {}, uninstall: async () => {},
    configure: async () => {}, reconnect: async () => {},
    inspectBrowser: async () => {}, inspectTargets: async () => {}, installBrowser: async () => {}, measureTools: async () => null,
  })
  onTestFinished(() => { source.dispose(); mcp.dispose() })
  const store = createSnapshotStore(state)
  r.slots.register({ name: 'settings.section', id: 'components-count', label: () => zh['official.nav'], locale: 'settings.mcp',
    inject: () => ({ hooks: { components: store, mcp: mcp.store }, source, mcp }) }, ComponentsPage)
  const { view } = r.renderSlot('settings.section', { close: vi.fn() })
  expect(view.getByText(live ? '25 个工具可用' : '0.1.1').getAttribute('data-state')).toBe(live ? 'connected' : 'idle')
  expect(view.queryByText(live ? '0.1.1' : '25 个工具可用')).toBeNull()
})

it('keeps MCP|Skills pills with official above custom on the MCP tab', async () => {
  const r = await runtime(), mcp = mcpSource()
  const state: ComponentsState = { busy: false, failed: false, connectionFailed: false, connections: [], value: {
    components: [
      { id: 'wdh', installed: null, localCommand: null, localVersion: null, previousVersion: null, latestVersion: null, catalogError: null, localError: null, operation: null },
    ], wdhTools: null, wdh: [], browser: { state: 'missing', version: null }, configuration: { revision: 1, writable: true,
      wdh: { enabled: false, browser: 'cloak' }, adh: { enabled: false, command: 'adh', args: [], endpoint: '', devices: [] }, idh: { enabled: false, command: 'idh', args: [], endpoint: '', devices: [] } },
  } }
  const components = new ComponentsSource({ async *watch() {}, async *connections() {}, snapshot: async () => state.value!,
    checkUpdates: async () => {}, install: async () => {}, cancel: async () => {}, rollback: async () => {}, uninstall: async () => {},
    configure: async () => {}, reconnect: async () => {},
    inspectBrowser: async () => {}, inspectTargets: async () => {}, installBrowser: async () => {}, measureTools: async () => null,
  })
  onTestFinished(() => { components.dispose(); mcp.dispose() })
  const store = createSnapshotStore(state)
  r.slots.register({ name: 'settings.section', id: 'skills-mcp', label: () => zh['product.nav'], locale: 'settings.mcp',
    inject: () => ({
      hooks: { components: store, mcp: mcp.store },
      components: { source: components, mcp },
      mcpSource: mcp,
      onManageSkills: vi.fn(),
    }) }, SkillsMcpPage)
  const { view } = r.renderSlot('settings.section', { close: vi.fn() })
  expect(view.getByRole('heading', { name: '技能与 MCP' })).toBeTruthy()
  expect(view.getByRole('tab', { name: 'MCP' }).getAttribute('aria-selected')).toBe('true')
  expect(view.queryByRole('tab', { name: '官方组件' })).toBeNull()
  await waitFor(() => { expect(view.getByRole('button', { name: 'WDH · 浏览器分析 · 打开设置' })).toBeTruthy() })
  expect(view.getAllByRole('switch')[0]!.getAttribute('aria-checked')).toBe('false')
  expect(view.getByRole('button', { name: '添加 MCP' })).toBeTruthy()
  expect(view.queryByRole('button', { name: '添加服务' })).toBeNull()
  fireEvent.click(view.getByRole('tab', { name: '技能' }))
  expect(view.getByRole('tab', { name: '技能' }).getAttribute('aria-selected')).toBe('true')
  expect(view.getByRole('button', { name: '添加技能' })).toBeTruthy()
  expect(view.queryByRole('button', { name: '添加 MCP' })).toBeNull()
  fireEvent.click(view.getByRole('tab', { name: 'MCP' }))
  await waitFor(() => { expect(view.getByRole('button', { name: '添加 MCP' })).toBeTruthy() })
})
