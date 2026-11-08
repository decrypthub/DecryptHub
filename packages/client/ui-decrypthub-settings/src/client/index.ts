/**
 * Product memory settings section: reads and writes the `product-memory`
 * settings namespace so users and the agent edit one durable source.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the settings surface's SlotMap entry (`settings.section`).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.slots Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.remote Context merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
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

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.memory'
/** Role dictionary namespace owned by this plugin. */
export const PERSONA_LOCALE = 'settings.persona'
/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/**
 * Register the memory section in the settings navigation.
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
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'memory: dictionaries')
  ctx.effect(() => ctx.locale.register(PERSONA_LOCALE, { en: personaEn, zh: personaZh }), 'persona: dictionaries')
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
  const pt = ctx.locale.bind(PERSONA_LOCALE)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'persona', order: 27, label: () => pt('nav'), locale: PERSONA_LOCALE,
    inject: () => ({ hooks: { persona: personaSource.store }, source: personaSource }),
  }, PersonaPage))
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'memory', order: 26, label: () => t('nav'), locale: NS,
    inject: () => ({ hooks: { memory: source.store }, source }),
  }, MemoryPage))
}
