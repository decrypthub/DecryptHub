// @vitest-environment jsdom
import { fireEvent, waitFor, within, screen } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '../src/client/index.ts'
import { McpPage } from '../src/client/Page.tsx'
import { ComponentsPage } from '../src/client/ComponentsPage.tsx'
import { SkillsMcpPage } from '../src/client/SkillsMcpPage.tsx'
import { en, zh } from '../src/client/locales.ts'
import { McpSource } from '../src/client/source.ts'
import { ComponentsSource } from '../src/client/components-source.ts'
import type { ComponentsState } from '../src/client/components-source.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

async function runtime() {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  locale.register('settings.mcp', { en, zh })
  await runtime.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  return runtime
}
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
    inspectBrowser: async () => {}, installBrowser: async () => {}, measureTools: async () => null,
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

it('shows the live tool count for a per-session WDH connection', async () => {
  const r = await runtime(), mcp = mcpSource()
  const state: ComponentsState = { busy: false, failed: false, connectionFailed: false, connections: [], value: {
    components: [
      { id: 'wdh', installed: { id: 'wdh', version: '0.1.1', source: 'managed', entry: '/fixture/cli.mjs', runtime: 'node' }, localCommand: null, localVersion: null, previousVersion: null, latestVersion: null, catalogError: null, localError: null, operation: null },
    ], wdhTools: null, wdh: [{ agentId: 'session-1' as SessionId, workspace: '/fixture/workspace', status: { state: 'connected', toolCount: 25, connectedAt: 0 } }],
    browser: { state: 'missing', version: null }, configuration: { revision: 1, writable: true,
      wdh: { enabled: true, browser: 'cloak' }, adh: { enabled: false, command: 'adh', args: ['mcp'], endpoint: '', devices: [] }, idh: { enabled: false, command: 'idh', args: ['mcp'], endpoint: '', devices: [] } },
  } }
  const source = new ComponentsSource({ async *watch() {}, async *connections() {}, snapshot: async () => state.value!,
    checkUpdates: async () => {}, install: async () => {}, cancel: async () => {}, rollback: async () => {}, uninstall: async () => {},
    configure: async () => {}, reconnect: async () => {},
    inspectBrowser: async () => {}, installBrowser: async () => {}, measureTools: async () => null,
  })
  onTestFinished(() => { source.dispose(); mcp.dispose() })
  const store = createSnapshotStore(state)
  r.slots.register({ name: 'settings.section', id: 'components-count', label: () => zh['official.nav'], locale: 'settings.mcp',
    inject: () => ({ hooks: { components: store, mcp: mcp.store }, source, mcp }) }, ComponentsPage)
  const { view } = r.renderSlot('settings.section', { close: vi.fn() })
  expect(view.getByText('25 个工具可用')).toBeTruthy()
  expect(view.queryByText('0.1.1')).toBeNull()
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
    inspectBrowser: async () => {}, installBrowser: async () => {}, measureTools: async () => null,
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
