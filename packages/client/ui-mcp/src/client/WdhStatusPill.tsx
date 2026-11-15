/** Per-session WDH link badge shown under the composer. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentsState } from './components-source.ts'
import css from './Page.module.css'

/** The pill only reads the component store; it never starts a connection. */
export interface WdhPillInjected {
  hooks: { components: HostObservable<ComponentsState> }
  /** Restart the WDH client for the failed link of this session. */
  retry: () => void
}

/** Render the live WDH link of the current session, or nothing while it is idle. */
export function WdhStatusPill({ sessionId, useComponents, retry, t }: PropsRuntime<'conversation.composer.dock'> & InjectFace<WdhPillInjected> & PropsLocale<'settings.mcp'>) {
  const state = useComponents(value => value)
  const row = state.value?.wdh.find(connection => connection.agentId === sessionId)
  if (row === undefined) return null
  const failed = row.status.state === 'closed'
  // The workspace explains which cwd owns the browser process when a session is resumed elsewhere.
  return failed
    ? <button type="button" className={css.wdhPill} data-state="failed" title={row.workspace} onClick={retry}>{t('official.pill.retry')}</button>
    : <span className={css.wdhPill} data-state="connected" title={row.workspace}>{t('official.pill.connected')}</span>
}
