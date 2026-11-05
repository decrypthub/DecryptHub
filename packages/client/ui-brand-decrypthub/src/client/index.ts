/** DecryptHub occupants for the existing sidebar and conversation brand slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ProductBrandMark, ProductBrandName } from './Brand.tsx'

/** Required service for declaration-owned UI contributions. */
export const inject = ['slots']

/**
 * Install identity contributions for each declaration lifetime.
 * @param ctx - Client slot registry owner.
 */
export function apply(ctx: Context): void {
  ctx.inject(['theme'], (scope) => {
    scope.effect(() => scope.theme.overrideTokens('decrypthub.product', {
      '--dsw-alias-brand-primary': { light: '#cc4329', dark: '#e54d2e' },
      '--dsw-alias-brand-primary-new-colorprimary-new-color': { light: '#cc4329', dark: '#e54d2e' },
      '--dsw-alias-button-primary-fill': { light: '#cc4329', dark: '#cc4329' },
      '--dsw-alias-button-primary-hover': { light: '#b83923', dark: '#e54d2e' },
      '--dsw-alias-label-primary-foreground': { light: '#ffffff', dark: '#ffffff' },
      '--dsw-alias-button-info-fill': { light: '#cc4329', dark: '#cc4329' },
      '--dsw-alias-state-business-primary': { light: '#cc4329', dark: '#cc4329' },
      '--dsw-alias-state-business-tertiary': { light: '#fff0ec', dark: '#3b1c16' },
      '--dsw-alias-brand-text': { light: '#b83923', dark: '#ff977d' },
      '--dsw-alias-link': { light: '#b83923', dark: '#ff977d' },
    }))
  })
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ProductBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, ProductBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, ProductBrandMark))
}
