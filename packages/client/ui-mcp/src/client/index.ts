/** MCP settings use the existing credentials, revision checks and live manager. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: session handoff for agent-authored skill management.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the Conversation composer dock slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SkillCatalog } from './SkillsMcpPage.tsx'
import { McpSource } from './source.ts'
import { ComponentsSource } from './components-source.ts'
import { ComponentsIcon } from './ComponentsPage.tsx'
import { WdhStatusPill } from './WdhStatusPill.tsx'
import { SkillsMcpMainPage, SkillsMcpPage } from './SkillsMcpPage.tsx'
import { ImportPage } from './ImportPage.tsx'
import { en, zh, type McpKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.mcp': McpKey }
}
/** Required Remote and presentation owners. */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'remote.mcpManager', 'remote.decrypthubComponents', 'remote.skills', 'remoteAccess', 'sessions', 'uiWorkspace']

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
  const official = ctx.remote.decrypthubComponents
  const components = new ComponentsSource({
    async *watch(signal) { yield* official.watch(signal) },
    async *connections(signal) { yield* ctx.remote.mcpManager.watch(signal) },
    snapshot: () => confirmed(official.snapshot()),
    checkUpdates: () => confirmed(official.checkUpdates()),
    install: (id, version) => confirmed(official.installComponent(id, version)),
    cancel: id => confirmed(official.cancelInstall(id)),
    rollback: id => confirmed(official.rollback(id)),
    uninstall: id => confirmed(official.uninstall(id)),
    reconnect: id => confirmed(official.reconnect(id)),
    inspectBrowser: () => confirmed(official.inspectBrowser()),
    installBrowser: accepted => confirmed(official.installBrowser(accepted)),
    measureTools: id => confirmed(official.measureTools(id)),
    configure: async (id, config) => {
      if (id === 'wdh') {
        return confirmed(official.configure(id, config.wdh.enabled, '', [], '', config.wdh.browser, config.revision))
      }
      const device = config[id]
      // One settings write covers the whole device entry, so the device list cannot desync the revision.
      const write = await ctx.remote.settings.mutate('decrypthub-integrations', [
        { op: 'set', path: [id, 'enabled'], value: device.enabled },
        { op: 'set', path: [id, 'command'], value: device.command },
        { op: 'set', path: [id, 'args'], value: device.args },
        { op: 'set', path: [id, 'endpoint'], value: device.endpoint },
        { op: 'set', path: [id, 'devices'], value: device.devices },
      ], config.revision)
      if (!write.ok) throw new Error(write.error.message)
    },
  })
  ctx.effect(() => () => { components.dispose() }, 'Official components: source lifetime')
  ctx.on('connection/reset', () => { components.reset() })
  const skillCatalog = createSnapshotStore<SkillCatalog>({ loaded: false, failed: false, rows: [] })
  let skillTicket = 0
  let lastSkillSessionId: string | undefined
  const refreshSkills = (): void => {
    const sessionId = ctx.sessions.list.getSnapshot().ids[0]
    // The catalog is Session-scoped; a remount with the same newest session
    // must still publish a snapshot, so only skip after a successful load.
    if (sessionId !== undefined && sessionId === lastSkillSessionId && skillCatalog.getSnapshot().loaded) return
    lastSkillSessionId = sessionId
    const ticket = ++skillTicket
    if (sessionId === undefined) {
      skillCatalog.set({ loaded: true, failed: false, rows: [], needsSession: true })
      return
    }
    void ctx.remote.skills.list({ sessionId }, AbortSignal.timeout(20_000)).then((result) => {
      if (ticket !== skillTicket) return
      skillCatalog.set(result.ok
        ? { loaded: true, failed: false, rows: result.value.skills.map(skill => ({ name: skill.name, description: skill.description })) }
        : { loaded: true, failed: true, rows: [] })
    }, () => {
      if (ticket === skillTicket) skillCatalog.set({ loaded: true, failed: true, rows: [] })
    })
  }
  ctx.effect(() => ctx.sessions.list.subscribe(refreshSkills), 'Skills: catalog')
  ctx.on('connection/reset', () => { refreshSkills() })
  refreshSkills()
  const combinedInject = () => ({
    hooks: { components: components.store, mcp: source.store },
    components: { source: components, mcp: source },
    mcpSource: source,
    skillCatalog,
    onManageSkills: () => {
      ctx.uiWorkspace.startSession(undefined, { prompt: t('product.askSkillsPrompt'), whenDraftExists: 'append' })
    },
    onImportSkills: () => {
      ctx.uiWorkspace.startSession(undefined, { prompt: t('product.importSkillsPrompt'), whenDraftExists: 'append' })
    },
  })
  const imports = ctx.remote.decrypthubComponents
  const panel = 'decrypthub-skills-mcp' as MainPanelId
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'harness-import', order: 18, label: () => t('import.title'), locale: 'settings.mcp',
    inject: () => ({
      actions: {
        preview: async (source: string) => {
          const result = await imports.importPreview(source)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        run: async (source: string, kinds: readonly ('sessions')[]) => {
          const result = await imports.importRun(source, [...kinds])
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
      },
    }),
  }, ImportPage))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'skills-mcp', order: 24, label: () => t('product.nav'), locale: 'settings.mcp',
    inject: combinedInject,
  }, SkillsMcpPage))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panel, locale: 'settings.mcp', inject: combinedInject,
  }, SkillsMcpMainPage))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'wdh-status', order: 20, locale: 'settings.mcp',
    inject: () => ({
      hooks: { components: components.store },
      retry: () => { void components.run(ops => ops.reconnect('wdh')).catch(() => {}) },
    }),
  }, WdhStatusPill))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panel, order: 14, locale: 'settings.mcp', label: () => t('product.nav'),
  }, ComponentsIcon))
}
