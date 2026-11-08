/** MCP settings use the existing credentials, revision checks and live manager. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { McpSource } from './source.ts'
import { ComponentsSource } from './components-source.ts'
import { ComponentsPage, ComponentsIcon } from './ComponentsPage.tsx'
import { McpIcon, McpPage } from './Page.tsx'
import { en, zh, type McpKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.mcp': McpKey }
}
/** Required Remote and presentation owners. */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'remote.mcpManager', 'remote.decrypthubComponents', 'remoteAccess']

/** Validate and manage the requested configuration.
 * @param ctx - client contribution lifetime. */
export function apply(ctx: Context): void {
  ctx.remoteAccess.whenAccess('mcpManager/watch', function* () {
    const child = ctx.plugin(mount)
    yield () => child.dispose()
  })
}

function mount(ctx: Context): void {
  const confirmed = async <T>(request: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>): Promise<T> => {
    const result = await request
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const source = new McpSource({
    describe: async () => {
      const result = await ctx.remote.settings.describe()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    write: async (ops, revision) => {
      const result = await ctx.remote.settings.mutate('mcp-manager', ops, revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    credential: async (ref, value) => {
      const result = await ctx.remote.credentials.set(ref, value)
      if (!result.ok) throw new Error(result.error.message)
    },
    async *watch(signal) {
      yield* ctx.remote.mcpManager.watch(signal)
    },
    restart: async (name) => {
      const result = await ctx.remote.mcpManager.restart(name)
      if (!result.ok) throw new Error(result.error.message)
    },
    probe: async (name, signal) => {
      const result = await ctx.remote.mcpManager.probe(name, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  })
  ctx.effect(() => () => { source.dispose() }, 'MCP: source lifetime')
  ctx.effect(() => ctx.locale.register('settings.mcp', { en, zh }), 'MCP: dictionaries')
  ctx.remote.$on('settings/document-updated', (ns) => { if (ns === 'mcp-manager') void source.refresh() })
  ctx.on('connection/reset', () => { source.reset() })
  const t = ctx.locale.bind('settings.mcp')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mcp', order: 25, label: () => t('nav'), locale: 'settings.mcp',
    inject: () => ({ hooks: { mcp: source.store }, source }),
  }, McpPage))
  const mcpPanel = 'decrypthub-mcp' as MainPanelId
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: mcpPanel, locale: 'settings.mcp',
    inject: () => ({ hooks: { mcp: source.store }, source }),
  }, McpPage as never))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: mcpPanel, order: 14, locale: 'settings.mcp', label: () => t('nav'),
  }, McpIcon))
  const official = ctx.remote.decrypthubComponents
  const components = new ComponentsSource({
    async *watch(signal) { yield* official.watch(signal) },
    async *connections(signal) { yield* ctx.remote.mcpManager.watch(signal) },
    snapshot: () => confirmed(official.snapshot()),
    checkUpdates: () => confirmed(official.checkUpdates()),
    install: (id, version) => confirmed(official.installComponent(id, version)),
    cancel: id => confirmed(official.cancelInstall(id)),
    rollback: id => confirmed(official.rollback(id)),
    reconnect: id => confirmed(official.reconnect(id)),
    inspectBrowser: () => confirmed(official.inspectBrowser()),
    installBrowser: accepted => confirmed(official.installBrowser(accepted)),
    configure: (id, config) => {
      const device = id === 'wdh' ? undefined : config[id]
      return confirmed(official.configure(id, config[id].enabled, device?.command ?? '', device?.args ?? [], device?.endpoint ?? '', config.wdh.browser, config.revision))
    },
  })
  ctx.effect(() => () => { components.dispose() }, 'Official components: source lifetime')
  ctx.on('connection/reset', () => { components.reset() })
  const officialInject = () => ({ hooks: { components: components.store }, source: components, mcp: source })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'official-components', order: 24, label: () => t('official.nav'), locale: 'settings.mcp', inject: officialInject,
  }, ComponentsPage))
  const panelId = 'decrypthub-components' as MainPanelId
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: 'settings.mcp', inject: officialInject,
  }, ComponentsPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 15, locale: 'settings.mcp', label: () => t('official.nav'),
  }, ComponentsIcon))
}
