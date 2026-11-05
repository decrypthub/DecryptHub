// @vitest-environment jsdom
import { fireEvent, waitFor, within, screen } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '../src/client/index.ts'
import { McpPage } from '../src/client/Page.tsx'
import { ComponentsPage } from '../src/client/ComponentsPage.tsx'
import { en, zh } from '../src/client/locales.ts'
import { McpSource } from '../src/client/source.ts'
import { ComponentsSource } from '../src/client/components-source.ts'
import type { ComponentsState } from '../src/client/components-source.ts'

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

it('keeps installation, MCP and device facts separate and guards a browser download with license consent', async () => {
  const r = await runtime(), mcp = mcpSource()
  const state: ComponentsState = { busy: false, failed: false, connectionFailed: false, connections: [], value: {
    components: [
      { id: 'wdh', installed: { id: 'wdh', version: '1.0.0', source: 'bundled', entry: '/fixture/cli.mjs', runtime: 'node' }, localCommand: null, previousVersion: null, latestVersion: null, catalogError: null, localError: null, operation: null },
      { id: 'idh', installed: null, localCommand: '/fixture/idh', previousVersion: null, latestVersion: null, catalogError: null, localError: null, operation: null },
    ], wdh: [], browser: { state: 'missing', version: null }, configuration: { revision: 1, writable: true,
      wdh: { enabled: true, browser: 'cloak' }, adh: { enabled: false, command: 'adh', args: ['mcp'], endpoint: '' }, idh: { enabled: false, command: 'idh', args: ['mcp'], endpoint: '' } },
  } }
  const source = new ComponentsSource({ async *watch() {}, async *connections() {}, snapshot: async () => state.value!,
    checkUpdates: async () => {}, install: async () => {}, cancel: async () => {}, rollback: async () => {},
    configure: async () => {}, reconnect: async () => {}, inspectBrowser: async () => {}, installBrowser: async () => {},
  })
  onTestFinished(() => { source.dispose(); mcp.dispose() })
  const store = createSnapshotStore(state)
  r.slots.register({ name: 'settings.section', id: 'components-test', label: () => zh['official.nav'], locale: 'settings.mcp',
    inject: () => ({ hooks: { components: store }, source, mcp }) }, ComponentsPage)
  const { view } = r.renderSlot('settings.section', { close: vi.fn() })
  expect(view.getByText('已找到本机命令，版本尚未验证')).toBeTruthy()
  expect(view.getByText('尚未确认，MCP 连接成功不代表设备已连接')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '下载 Cloak' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('button', { name: '安装' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(dialog.getByRole('checkbox'))
  expect(dialog.getByRole('button', { name: '安装' }).hasAttribute('disabled')).toBe(false)
})
