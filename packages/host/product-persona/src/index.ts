/**
 * User-editable role definition: one settings namespace whose text becomes a
 * system-prompt section, so the product page and the agent share one source.
 * @module @deepseek-ai/dsh-product-persona
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name; also the settings namespace the product page edits. */
export const name = 'product-persona'
/** Services this plugin contributes to. */
export const inject = ['systemPrompt', 'settings']

/** Role definition the deployment or user maintains. */
export interface Config {
  /** Role text prepended to every request. Empty text contributes nothing. */
  persona: string
}

/** Validated plugin configuration; the settings page renders this schema. */
export const Config = z.object({
  persona: z.string().role('textarea').default('').volatile(),
})

/** Read one configuration value that volatile wrapping may hold. */
function plainString(value: unknown): string {
  const raw = isVolatile(value) ? value.get() : value
  return typeof raw === 'string' ? raw : ''
}

/** Section order: after the harness identity, before workspace guidance. */
const SECTION_ORDER = 20

/**
 * Register the persona section.
 * @param ctx - context providing prompt assembly and settings.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let live = config

  /** Re-read this namespace after the product page or another writer changed it. */
  const refresh = (): void => {
    const row = ctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === name)
    if (row === undefined || typeof row.value !== 'object' || row.value === null) return
    live = row.value as Config
  }
  ctx.on('loader/volatile-update', refresh)

  // Let the settings surface render this namespace from its schema.
  ctx.effect(() => ctx.settings.configure({ auto: true }), 'product-persona.settings')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'product-persona',
    order: SECTION_ORDER,
    text: () => plainString(live.persona).trim(),
    interpolate: false,
  }), 'product-persona.section')
}
