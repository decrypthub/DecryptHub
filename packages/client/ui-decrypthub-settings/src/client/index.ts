/**
 * Product settings surfaces: memory entries and the role definition, over the
 * `product-memory` and `product-persona` namespaces, presented as one sidebar
 * panel and settings section. Set role opens a dialog over the memory list.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the settings surface's SlotMap entry and its ctx.slots merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `main` panel SlotMap entry.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the `sidebar.panellist` SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: session handoff for agent-authored memory and role edits.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.remote Context merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { MemoryIcon } from './icons.tsx'
import { MemoryPersonaMainPage, MemoryPersonaPage } from './MemoryPersonaPage.tsx'
import { PersonaSource } from './persona-source.ts'
import { MemorySource } from './source.ts'
import { en, zh, personaEn, personaZh, type MemoryKey, type PersonaKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product memory section copy (also hosts the fused nav label). */
    'settings.memory': MemoryKey
    /** Product role section copy. */
    'settings.persona': PersonaKey
  }
}

/** Memory dictionary namespace owned by this plugin. */
export const NS = 'settings.memory'
/** Role dictionary namespace owned by this plugin. */
export const PERSONA_LOCALE = 'settings.persona'
/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'uiWorkspace']

/**
 * Register the fused memory and role surface.
 * @param ctx - client contribution lifetime.
 */
export function apply(ctx: Context): void {
  const source = new MemorySource({
    describe: async () => {
      const result = await ctx.remote.settings.describe()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    write: async (ops, revision) => {
      const result = await ctx.remote.settings.mutate('product-memory', ops, revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  })
  ctx.effect(() => () => { source.dispose() }, 'memory: source lifetime')
  const personaSource = new PersonaSource({
    describe: async () => {
      const result = await ctx.remote.settings.describe()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    write: async (ops, revision) => {
      const result = await ctx.remote.settings.mutate('product-persona', ops, revision)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  })
  ctx.effect(() => () => { personaSource.dispose() }, 'persona: source lifetime')

  // The model writes memory and the role through tools; keep the open page in
  // sync so its next save uses the current revision instead of a conflict.
  ctx.remote.$on('settings/document-updated', (ns) => {
    if (ns === 'product-memory') void source.load()
    if (ns === 'product-persona') void personaSource.load()
  })
  ctx.on('connection/reset', () => {
    void source.load()
    void personaSource.load()
  })

  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'memory: dictionaries')
  ctx.effect(() => ctx.locale.register(PERSONA_LOCALE, { en: personaEn, zh: personaZh }), 'persona: dictionaries')
  const t = ctx.locale.bind(NS)
  const pt = ctx.locale.bind(PERSONA_LOCALE)

  const combinedInject = () => ({
    hooks: { memory: source.store, persona: personaSource.store },
    memory: {
      source,
      onAskAgent: () => {
        ctx.uiWorkspace.startSession(undefined, { prompt: t('host.createPrompt'), whenDraftExists: 'append' })
      },
    },
    persona: {
      source: personaSource,
      onAskAgent: () => {
        ctx.uiWorkspace.startSession(undefined, { prompt: pt('host.createPrompt'), whenDraftExists: 'append' })
      },
    },
    memoryT: t,
    personaT: pt,
  })
  const panel = 'decrypthub-memory-persona' as MainPanelId

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panel, order: 16, locale: NS, label: () => t('nav'),
  }, MemoryIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panel, locale: NS, inject: combinedInject,
  }, MemoryPersonaMainPage))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'memory-persona', order: 26, label: () => t('nav'), locale: NS,
    inject: combinedInject,
  }, MemoryPersonaPage))
}
