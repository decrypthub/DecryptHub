/** Select a mobile device and App for this chat's read-only status queries. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatTargetChoice, ChatTargetView, ComponentInventory } from '@deepseek-ai/dsh-decrypthub-components/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentsState } from './components-source.ts'
import css from './Page.module.css'

type Mobile = ChatTargetChoice['component']
type Header = PropsRuntime<'conversation.session.header.utilities'>
type Row = { choice: ChatTargetChoice; name: string }

/** Inventory and Host-owned selection for the current chat. */
export interface ChatTargetInjected {
  hooks: { components: HostObservable<ComponentsState> }
  readTarget: (sessionId: Header['sessionId'], signal: AbortSignal) => Promise<ChatTargetView | null>
  discover: (component: Mobile, signal: AbortSignal) => Promise<ComponentInventory>
  writeTarget: (sessionId: Header['sessionId'], choice: ChatTargetChoice | null, signal: AbortSignal) => Promise<ChatTargetView | null>
}

type Props = Header & InjectFace<ChatTargetInjected> & PropsLocale<'settings.mcp'>

/** Keep the open picker and its in-flight actions scoped to one chat. */
export function ChatTargetPicker(props: Props) {
  return <ChatTargetControl key={props.sessionId} {...props} />
}

function ChatTargetControl({ sessionId, useSession, useComponents, readTarget, discover, writeTarget, t }: Props) {
  const running = useSession(value => value.running)
  const configuration = useComponents(value => value.value?.configuration)
  const [binding, setBinding] = useState<ChatTargetView | null>(null)
  const [open, setOpen] = useState(false)
  const [component, setComponent] = useState<Mobile>('adh')
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [readError, setReadError] = useState(false)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (running) return
    const request = new AbortController()
    readRequest.current = request
    void readTarget(sessionId, request.signal).then((result) => {
      if (request.signal.aborted) return
      setBinding(result)
      setReadError(false)
    }, () => {
      if (!request.signal.aborted) setReadError(true)
    })
    return () => { request.abort() }
  }, [open, readTarget, refresh, running, sessionId])

  useEffect(() => {
    if (!open) return
    const request = new AbortController()
    setLoading(true)
    setError(false)
    setRows([])
    setSelected('')
    void discover(component, request.signal).then((result) => {
      if (request.signal.aborted) return
      setRows(result.targets.flatMap(target => target.online && target.pid != null
        ? [{ choice: { component, endpoint: target.endpoint, id: target.id, pid: String(target.pid),
          appId: target.bundle ?? target.package ?? target.name }, name: target.name }]
        : []))
      setError(result.error !== null)
      setLoading(false)
    }, () => {
      if (request.signal.aborted) return
      setError(true)
      setLoading(false)
    })
    return () => { request.abort() }
  }, [component, discover, open, refresh])
  useEffect(() => () => { writeRequest.current?.abort() }, [])

  const apply = async (choice: ChatTargetChoice | null): Promise<void> => {
    const request = new AbortController()
    writeRequest.current = request
    readRequest.current?.abort()
    setSaving(true)
    setError(false)
    try {
      const result = await writeTarget(sessionId, choice, request.signal)
      if (request.signal.aborted) return
      setBinding(result)
      setReadError(false)
      setOpen(false)
    } catch (_failed) {
      if (!request.signal.aborted) setError(true)
    } finally {
      if (!request.signal.aborted) setSaving(false)
    }
  }

  const configured = (['adh', 'idh'] as const).filter((id) => {
    const entry = configuration?.[id]
    return entry !== undefined && (entry.devices.length > 0 || entry.endpoint !== '')
  })
  if (binding === null && configured.length === 0) return null
  const working = running || saving
  const choice = selected === '' ? undefined : rows[Number(selected)]?.choice
  const status = readError || binding?.state === 'unavailable'
    ? t('target.unavailable') : binding?.state === 'stale' ? t('target.stale') : null

  return <>
    <button type="button" className={css.chatTargetPill} data-state={status === null ? undefined : 'failed'}
      title={binding === null ? undefined : [binding.name, binding.endpoint, `PID ${binding.pid}`, status].filter(Boolean).join(' · ')}
      onClick={() => {
        setComponent(binding?.component ?? configured[0] ?? 'adh')
        setOpen(true)
      }}>
      {binding === null ? t('target.title') : `${binding.component.toUpperCase()} · ${binding.name}${status ? ` · ${status}` : ''}`}
    </button>
    <Modal className={css.dialog ?? ''} open={open} title={t('target.title')} closeLabel={t('close')}
      onClose={() => { if (!saving) setOpen(false) }}>
      <div className={css.form}>
        <p className={css.muted}>{t('target.hint')}</p>
        {status && <p role="status">{status}</p>}
        <label>
          {t('target.platform')}
          <select value={component} disabled={working} onChange={(event) => {
            setSelected('')
            setComponent(event.target.value === 'idh' ? 'idh' : 'adh')
          }}>
            <option value="adh" disabled={!configured.includes('adh')}>Android · ADH</option>
            <option value="idh" disabled={!configured.includes('idh')}>iOS · IDH</option>
          </select>
        </label>
        <label>
          {t('target.app')}
          <select value={selected} disabled={working || loading || rows.length === 0}
            onChange={(event) => { setSelected(event.target.value) }}>
            <option value="">{t(loading ? 'loading' : rows.length === 0 ? 'target.empty' : 'target.choose')}</option>
            {rows.map(({ choice: row, name }, index) =>
              <option key={JSON.stringify([row.endpoint, row.id, row.pid])} value={index}>
                {`${name} · ${row.endpoint} · PID ${row.pid}`}
              </option>)}
          </select>
        </label>
        {error && <p role="alert">{t('target.error')}</p>}
        <div className={css.actions}>
          <Button disabled={working || loading} onClick={() => { setRefresh(value => value + 1) }}>{t('refresh')}</Button>
          {binding && <Button disabled={working} onClick={() => { void apply(null) }}>{t('target.clear')}</Button>}
          <Button disabled={working || loading || choice === undefined} onClick={() => { if (choice) void apply(choice) }}>
            {t('target.bind')}
          </Button>
        </div>
      </div>
    </Modal>
  </>
}
