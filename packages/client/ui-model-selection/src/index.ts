/**
 * Publish application-owned model-picker presentation to its browser half.
 * Supported models and reasoning capabilities still come from the Host catalog.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { type Config, MODEL_PRESENTATION_GLOBAL } from './presentation.ts'

export { Config } from './presentation.ts'

/**
 * Publish presentation before the browser registers its picker.
 * @param ctx Host plugin context.
 * @param config Validated application presentation.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: MODEL_PRESENTATION_GLOBAL, value: config })
  })
}
