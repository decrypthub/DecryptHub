/** Community account presentation through existing DSH settings slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { CommunityAccountBridge } from '../types.ts'
import { CommunityAccountSource } from './account-source.ts'
import { AccountSection, AccountLauncher, type AccountInjected } from './Account.tsx'
import { en, zh, type CommunityAccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.decrypthub-account': CommunityAccountKey }
}

/** Required locale and declaration-scoped settings contributions. */
export const inject = ['slots', 'locale']

/** @param ctx - client plugin lifetime; browser clients without native login keep their settings launcher. */
export function apply(ctx: Context): void {
  const carrier = (globalThis as typeof globalThis & {
    dshDesktop?: { protocolVersion: number; communityAccount?: CommunityAccountBridge }
  }).dshDesktop
  if (carrier?.protocolVersion !== 1 || carrier.communityAccount === undefined) return
  const source = new CommunityAccountSource(carrier.communityAccount)
  ctx.effect(() => () => { source.dispose() }, 'community account: native subscription')
  ctx.effect(() => ctx.locale.register('settings.decrypthub-account', { en, zh }), 'community account: dictionaries')
  const t = ctx.locale.bind('settings.decrypthub-account')
  const operations: AccountInjected = {
    hooks: { account: source.store }, run: command => source.run(command), open: page => source.open(page),
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'decrypthub-account', order: -10, label: () => t('nav'),
    locale: 'settings.decrypthub-account', inject: () => operations,
  }, AccountSection))
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: 'settings.decrypthub-account', inject: () => operations,
  }, AccountLauncher))
}
