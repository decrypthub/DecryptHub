/** Per-session WDH link badge shown under the composer. */
import { useState } from 'react'
import type { WdhCaptureDetail, WdhCaptureList, WdhCaptureSelection } from '@deepseek-ai/dsh-decrypthub-components/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentsState } from './components-source.ts'
import { WdhCapturePanel } from './WdhCapturePanel.tsx'
import css from './Page.module.css'

type Runtime = PropsRuntime<'conversation.composer.dock'>

/** The pill only reads the component store; it never starts a connection. */
export interface WdhPillInjected {
  hooks: { components: HostObservable<ComponentsState> }
  /** Restart the WDH client for the failed link of this session. */
  retry: () => void
  capture?: {
    list: (session: Runtime['sessionId'], signal: AbortSignal) => Promise<WdhCaptureList>
    detail: (session: Runtime['sessionId'], selection: WdhCaptureSelection, signal: AbortSignal) => Promise<WdhCaptureDetail | null>
  }
}

/** Render the live WDH link of the current session, or nothing while it is idle. */
export function WdhStatusPill({ sessionId, useComponents, retry, capture, t }: Runtime & InjectFace<WdhPillInjected> & PropsLocale<'settings.mcp'>) {
  const row = useComponents(state => state.value?.wdh.find(connection => connection.agentId === sessionId))
  if (row === undefined) return null
  if (row.status.state === 'closed') {
    return <button type="button" className={css.wdhPill} data-state="failed" title={row.workspace} onClick={retry}>{t('official.pill.retry')}</button>
  }
  if (row.status.state !== 'connected') {
    return <span className={css.wdhPill} title={row.workspace}>{t('official.waiting')}</span>
  }
  if (capture === undefined) {
    return <span className={css.wdhPill} data-state="connected" title={row.workspace}>{t('official.pill.connected')}</span>
  }
  return <ConnectedCapture key={JSON.stringify([sessionId, row.workspace, row.status.connectedAt])}
    sessionId={sessionId} workspace={row.workspace} capture={capture} t={t} />
}

function ConnectedCapture({ sessionId, workspace, capture, t }: Pick<Runtime, 'sessionId'> & PropsLocale<'settings.mcp'> & {
  workspace: string
  capture: NonNullable<WdhPillInjected['capture']>
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={css.wdhPill} data-state="connected" title={workspace} aria-haspopup="dialog"
      onClick={() => { setOpen(true) }}>{t('official.capture.open')}</button>
    {open && <WdhCapturePanel sessionId={sessionId} capture={capture} t={t} close={() => { setOpen(false) }} />}
  </>
}
