/** Inspect the response and recorded initiating frames for one selected WDH request. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WdhCaptureDetail, WdhCaptureList, WdhCaptureSelection } from '@deepseek-ai/dsh-decrypthub-components/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WdhPillInjected } from './WdhStatusPill.tsx'
import css from './WdhCapturePanel.module.css'

interface Props extends PropsLocale<'settings.mcp'> {
  sessionId: SessionId
  capture: NonNullable<WdhPillInjected['capture']>
  close: () => void
}

/** Read the owning browser's recent captures while the panel is open.
 * @param props - session-scoped capture operations and dismissal.
 * @returns the request list and the selected request's evidence.
 */
export function WdhCapturePanel({ sessionId, capture, close, t }: Props) {
  const [list, setList] = useState<WdhCaptureList | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [selection, setSelection] = useState<WdhCaptureSelection | null>(null)

  useEffect(() => {
    const request = new AbortController()
    void capture.list(sessionId, request.signal).then((value) => {
      if (request.signal.aborted) return
      setList(value)
      setSelection(current => current?.generation === value.generation
        && value.requests.some(row => row.id === current.id) ? { ...current } : null)
      setLoading(false)
    }, () => {
      if (request.signal.aborted) return
      setFailed(true)
      setLoading(false)
    })
    return () => { request.abort() }
  }, [capture, sessionId, refresh])

  const selected = list?.generation === selection?.generation
    ? list?.requests.find(row => row.id === selection?.id) : undefined
  return <Modal open onClose={close} title={t('official.capture.title')} closeLabel={t('close')}
    className={css.dialog ?? ''} contentClassName={css.content ?? ''}>
    <div className={css.grid}>
      <section className={css.pane} aria-label={t('official.capture.requests')}>
        <div className={css.toolbar}>
          <h3>{t('official.capture.requests')}</h3>
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => {
            setFailed(false)
            setLoading(true)
            setRefresh(value => value + 1)
          }}>{t('refresh')}</Button>
        </div>
        {failed && <p role="alert" className={css.notice}>{t('official.capture.listError')}</p>}
        {loading && list === null && <div role="status" aria-label={t('loading')} className={css.skeleton}>
          <i /><i /><i />
        </div>}
        {list !== null && list.requests.length === 0 && <p className={css.notice}>{t('official.capture.empty')}</p>}
        {list !== null && list.requests.length > 0 && <ul className={css.requests}>
          {list.requests.map(row => <li key={row.id}>
            <button type="button" className={css.row} aria-pressed={row.id === selected?.id} title={row.url}
              onClick={() => { setSelection({ generation: list.generation, id: row.id }) }}>
              <code>{row.method}</code>
              <code>{row.status === 'pending' ? '…' : row.status === 'failed' ? '—' : row.status}</code>
              <span className={css.url}>{row.url}</span>
            </button>
          </li>)}
        </ul>}
      </section>
      <section className={css.pane} aria-label={t('official.capture.detail')}>
        {selected === undefined || selection === null
          ? <p className={css.notice}>{t('official.capture.select')}</p>
          : <>
            <div className={css.selected}>
              <div><code>{selected.method}</code> <code>{selected.status === 'pending' ? '…' : selected.status === 'failed' ? '—' : selected.status}</code> <code>{selected.id}</code></div>
              <div className={css.location}>{selected.url}</div>
            </div>
            <CaptureDetail key={JSON.stringify([selection.generation, selection.id])}
              sessionId={sessionId} selection={selection} capture={capture} t={t} />
          </>}
      </section>
    </div>
  </Modal>
}

function CaptureDetail({ sessionId, selection, capture, t }: Omit<Props, 'close'> & { selection: WdhCaptureSelection }) {
  const [detail, setDetail] = useState<WdhCaptureDetail | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const request = new AbortController()
    setDetail(undefined)
    setFailed(false)
    void capture.detail(sessionId, selection, request.signal).then((value) => {
      if (request.signal.aborted) return
      setFailed(false)
      setDetail(value)
    }, () => {
      if (!request.signal.aborted) setFailed(true)
    })
    return () => { request.abort() }
  }, [capture, sessionId, selection])

  if (failed) return <p role="alert" className={css.notice}>{t('official.capture.detailError')}</p>
  if (detail === undefined) return <p role="status" className={css.notice}>{t('loading')}</p>
  if (detail === null) return <p role="status" className={css.notice}>{t('official.capture.expired')}</p>
  return <div className={css.evidence}>
    <section>
      <h3>{t('official.capture.response')}</h3>
      {detail.headers !== '' && <details>
        <summary>{t('official.capture.headers')}</summary>
        <pre>{detail.headers}</pre>
        {detail.headersTruncated && <p className={css.notice}>{t('official.capture.truncated')}</p>}
      </details>}
      {detail.body === null
        ? <p className={css.notice}>{t('official.capture.noBody')}</p>
        : <>
          {detail.body.encoding === 'base64' && <p className={css.notice}>{t('official.capture.base64')}</p>}
          <pre>{detail.body.text}</pre>
          {detail.body.truncated && <p className={css.notice}>{t('official.capture.truncated')}</p>}
        </>}
    </section>
    <section>
      <h3>{t('official.capture.stack')}</h3>
      {detail.frames.length === 0 ? <p className={css.notice}>{t('official.capture.noStack')}</p>
        : <ol className={css.frames}>
          {detail.frames.map((frame, index) => <li key={index}>
            <code>{frame.functionName || t('official.capture.anonymous')}</code>
            {frame.url !== '' && <span className={css.location}>{`${frame.url}:${frame.line}:${frame.column}`}</span>}
          </li>)}
        </ol>}
    </section>
  </div>
}
