/**
 * Product settings surfaces: memory entries and the role definition, over the
 * `product-memory` and `product-persona` namespaces, plus sidebar panels that
 * open them without going through the account menu.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the settings surface's SlotMap entry and its ctx.slots merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `main` panel SlotMap entry.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the `sidebar.panellist` SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.remote Context merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { MemoryIcon, PersonaIcon } from './icons.tsx'
import { MemoryPage } from './MemoryPage.tsx'
import { PersonaPage } from './PersonaPage.tsx'
import { PersonaSource } from './persona-source.ts'
import { MemorySource } from './source.ts'
import { en, zh, personaEn, personaZh, type MemoryKey, type PersonaKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product memory section copy. */
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
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/**
 * Register the memory and role surfaces.
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

  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'memory: dictionaries')
  ctx.effect(() => ctx.locale.register(PERSONA_LOCALE, { en: personaEn, zh: personaZh }), 'persona: dictionaries')
  const t = ctx.locale.bind(NS)
  const pt = ctx.locale.bind(PERSONA_LOCALE)

  const memoryInject = () => ({ hooks: { memory: source.store }, source })
  const personaInject = () => ({ hooks: { persona: personaSource.store }, source: personaSource })
  const memoryPanel = 'decrypthub-memory' as MainPanelId
  const personaPanel = 'decrypthub-persona' as MainPanelId

  // Sidebar entry points: available even where the account launcher is absent.
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: memoryPanel, order: 16, locale: NS, label: () => t('nav'),
  }, MemoryIcon))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: personaPanel, order: 17, locale: PERSONA_LOCALE, label: () => pt('nav'),
  }, PersonaIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: memoryPanel, locale: NS, inject: memoryInject,
  }, MemoryPage))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: personaPanel, locale: PERSONA_LOCALE, inject: personaInject,
  }, PersonaPage))

  // Settings sections: the same surfaces inside the settings panel.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'memory', order: 26, label: () => t('nav'), locale: NS,
    inject: memoryInject,
  }, MemoryPage))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'persona', order: 27, label: () => pt('nav'), locale: PERSONA_LOCALE,
    inject: personaInject,
  }, PersonaPage))
}
