/** MCP forms render validated configuration and observed connection state. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpProbeResult } from '@deepseek-ai/dsh-mcp-client/types'
import type { McpSource, McpSnapshot } from './source.ts'
import { parseMcpEntry, parseMcpStrings, reviewMcpImport, validMcpName, OFFICIAL_MCP_NAMES, type McpEntry, type McpImportRow } from './config.ts'
import css from './Page.module.css'

/** The page's observation and explicit management actions. */
export interface McpPageInjected {
  hooks: { mcp: HostObservable<McpSnapshot> }
  source: McpSource
}
/** Sidebar icon for the custom MCP panel. */
export function McpIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" />
  </svg>
}

/** MCP entry in the existing settings navigation. */
export type McpPageProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.mcp'> & InjectFace<McpPageInjected>
type Editor = { name: string; original?: string; config: McpEntry; revision: number }

/** Validate and manage the requested configuration.
 * @param props - localized settings projection and MCP operations.
 * @returns the server manager. */
export function McpPage({ useMcp, source, t }: McpPageProps) {
  const snapshot = useMcp(value => value)
  const [editor, setEditor] = useState<Editor>()
  const [importing, setImporting] = useState<{ revision: number }>()
  const [deleting, setDeleting] = useState<{ name: string; revision: number; inherited: boolean }>()
  const [probe, setProbe] = useState<{ name: string; result?: McpProbeResult; failed?: boolean }>()
  const [error, setError] = useState(false)
  const probeSequence = useRef(0)
  useEffect(() => { void source.load() }, [source])
  useEffect(() => () => { probeSequence.current++; source.cancelProbe() }, [source])
  const revision = snapshot.namespace?.revision ?? 0
  const names = [...new Set([...Object.keys(snapshot.entries), ...snapshot.servers.map(row => row.name)])]
    .filter(name => !OFFICIAL_MCP_NAMES.includes(name))
  const action = async (operation: () => Promise<void>): Promise<void> => {
    setError(false)
    try { await operation() }
    catch (_error) { setError(true) }
  }
  return <section className={css.page}>
    <header className={css.header}><div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <Button onClick={() => { void source.refresh() }}>{t('refresh')}</Button>
    </header>
    <div className={css.actions}>
      <Button variant="primary" disabled={!snapshot.writable || snapshot.busy} onClick={() => { setEditor({
        name: '', config: { transport: 'stdio', command: '', args: [], enabled: false }, revision,
      }) }}>{t('add')}</Button>
      <Button variant="outline" disabled={!snapshot.writable || snapshot.busy} onClick={() => { setImporting({ revision }) }}>{t('import')}</Button>
    </div>
    {(snapshot.failed || error) && <p role="alert" className={css.error}>{t(snapshot.failed ? 'failed' : 'actionFailed')}</p>}
    {!snapshot.loaded ? <p role="status">{t('loading')}</p> : names.length === 0 ? <p className={css.empty}>{t('empty')}</p> :
      <div className={css.list}>{names.map((name) => {
        const config = snapshot.entries[name]
        const runtime = snapshot.servers.find(row => row.name === name)
        const state = runtime?.status.state ?? 'unknown'
        const own = snapshot.namespace?.user
        const userServers = own && typeof own === 'object' && !Array.isArray(own) ? own.servers : undefined
        const base = snapshot.namespace?.base
        const inheritedServers = base && typeof base === 'object' && !Array.isArray(base) ? base.servers : undefined
        const inherited = inheritedServers !== undefined && inheritedServers !== null && typeof inheritedServers === 'object'
          && Object.hasOwn(inheritedServers, name)
        const removable = userServers !== undefined && userServers !== null && typeof userServers === 'object'
          && Object.hasOwn(userServers, name)
        return <article key={name} className={css.card}>
          <div className={css.cardHeader}><strong>{name}</strong><span className={css.status} data-state={state}>{t(`state.${state}`)}</span>
            {runtime?.status.state === 'connected' && <span className={css.muted}>{t('toolCount', { count: runtime.status.toolCount })}</span>}
          </div>
          <p className={css.endpoint}>{config ? config.transport === 'stdio' ? [config.command, ...(config.args ?? [])].join(' ') : config.url : t('plugin')}</p>
          {runtime?.status && 'lastError' in runtime.status && runtime.status.lastError && <p className={css.diagnostic}>{runtime.status.lastError}</p>}
          <div className={css.actions}>
            {config && <>
              <Button size="sm" variant="outline" disabled={snapshot.busy || !snapshot.writable} onClick={() => { setEditor({ name, original: name, config, revision }) }}>{t('edit')}</Button>
              <Button size="sm" disabled={snapshot.busy || !snapshot.writable} onClick={() => { void action(() => source.enable(name, config.enabled === false, revision)) }}>{t(config.enabled === false ? 'enable' : 'disable')}</Button>
            </>}
            <Button size="sm" disabled={snapshot.busy || config?.enabled === false} onClick={() => { void action(() => source.restart(name)) }}>{t('restart')}</Button>
            <Button size="sm" disabled={snapshot.busy} onClick={() => {
              const sequence = ++probeSequence.current
              setProbe({ name })
              void source.probe(name).then((result) => { if (sequence === probeSequence.current) setProbe({ name, result }) },
                () => { if (sequence === probeSequence.current) setProbe({ name, failed: true }) })
            }}>{t('tools')}</Button>
            {removable && <Button size="sm" disabled={snapshot.busy} onClick={() => { setDeleting({ name, revision, inherited }) }}>{t(inherited ? 'restore' : 'remove')}</Button>}
          </div>
        </article>
      })}</div>}
    {editor && <McpEditor editor={editor} existing={names} t={t} busy={snapshot.busy} close={() => { setEditor(undefined) }}
      save={async (name, config) => { await source.save({ [name]: config }, editor.revision); setEditor(undefined) }} />}
    {importing && <McpImport t={t} busy={snapshot.busy}
      existing={names.concat(OFFICIAL_MCP_NAMES)} close={() => { setImporting(undefined) }}
      save={async (entries) => { await source.save(entries, importing.revision); setImporting(undefined) }} />}
    <Modal className={css.dialog ?? ''} open={deleting !== undefined} title={t(deleting?.inherited ? 'restore' : 'confirmDelete')} description={t(deleting?.inherited ? 'restoreHint' : 'deleteHint')} closeLabel={t('close')}
      onClose={() => { if (!snapshot.busy) setDeleting(undefined) }} footer={<>
        <Button disabled={snapshot.busy} onClick={() => { setDeleting(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={snapshot.busy} onClick={() => { if (deleting) void action(async () => {
          await source.remove(deleting.name, deleting.revision); setDeleting(undefined)
        }) }}>{t(deleting?.inherited ? 'restore' : 'remove')}</Button>
      </>}><p>{deleting?.name}</p></Modal>
    <Modal className={css.dialog ?? ''} open={probe !== undefined} title={t('toolTitle')} closeLabel={t('close')} onClose={() => { probeSequence.current++; source.cancelProbe(); setProbe(undefined) }}>
      <strong>{probe?.name}</strong>
      {probe?.failed ? <p role="alert">{t('probeFailed')}</p> : probe?.result === undefined ? <p role="status">{t('loading')}</p>
        : !probe.result.ok ? <p role="alert">{probe.result.message}</p> : <>
          <p>{probe.result.serverInfo?.name} {probe.result.serverInfo?.version}</p>
          {probe.result.toolNames.length ? <ul>{probe.result.toolNames.map(name => <li key={name}>{name}</li>)}</ul> : <p>{t('noTools')}</p>}
        </>}
      {probe?.result && (!probe.result.closeConfirmed || probe.result.cleanupError) && <p role="alert">{t('cleanupFailed')}</p>}
    </Modal>
  </section>
}

type T = McpPageProps['t']
/** Editor retains its captured revision and all unedited advanced fields. */
function McpEditor({ editor, existing, t, busy, close, save }: {
  editor: Editor
  existing: readonly string[]
  t: T
  busy: boolean
  close(this: void): void
  save(this: void, name: string, config: McpEntry): Promise<void>
}) {
  const id = useId()
  const [name, setName] = useState(editor.name)
  const [config, setConfig] = useState(editor.config)
  const [args, setArgs] = useState(JSON.stringify(editor.config.args ?? []))
  const [env, setEnv] = useState(JSON.stringify(editor.config.env ?? {}, null, 2))
  const [headers, setHeaders] = useState(JSON.stringify(editor.config.headers ?? {}, null, 2))
  const [error, setError] = useState<'invalid' | 'saveError' | 'nameConflict'>()
  const submit = async (): Promise<void> => {
    let parsed: McpEntry | undefined
    if (!editor.original && existing.includes(name)) { setError('nameConflict'); return }
    try {
      if (!validMcpName(name)) throw new Error('name')
      const { command: _command, args: _args, cwd: _cwd, env: _env, url: _url, headers: _headers, ...base } = config
      const parsedArgs: unknown = JSON.parse(args)
      parsed = parseMcpEntry(config.transport === 'stdio' ? { ...base, command: config.command,
        args: parsedArgs, cwd: config.cwd ?? '', env: parseMcpStrings(env) }
        : { ...base, url: config.url, headers: parseMcpStrings(headers) })
      if (parsed === undefined) throw new Error('fields')
    } catch (_error) { setError('invalid'); return }
    try { await save(name, parsed) }
    catch (_error) { setError('saveError') }
  }
  return <Modal className={css.dialog ?? ''} open title={t(editor.original ? 'edit' : 'add')} closeLabel={t('close')} onClose={() => { if (!busy) close() }}
    footer={<><Button disabled={busy} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => { void submit() }}>{t('save')}</Button></>}>
    <div className={css.form}>
      <label htmlFor={`${id}-name`}>{t('name')}<input id={`${id}-name`} data-modal-autofocus value={name} disabled={!!editor.original || busy} onChange={(event) => { setName(event.target.value) }} /></label>
      <label>{t('transport')}<select value={config.transport} disabled={busy} onChange={(event) => { setConfig({ ...config, transport: event.target.value === 'stdio' ? 'stdio' : 'streamable-http' }) }}>
        <option value="stdio">{t('stdio')}</option><option value="streamable-http">{t('http')}</option>
      </select></label>
      {config.transport === 'stdio' ? <>
        <label>{t('command')}<input value={config.command ?? ''} onChange={(event) => { setConfig({ ...config, command: event.target.value }) }} /></label>
        <label>{t('args')}<textarea rows={3} value={args} onChange={(event) => { setArgs(event.target.value) }} /></label>
        <label>{t('cwd')}<input value={config.cwd ?? ''} onChange={(event) => { setConfig({ ...config, cwd: event.target.value }) }} /></label>
      </> : <label>{t('url')}<input value={config.url ?? ''} onChange={(event) => { setConfig({ ...config, url: event.target.value }) }} /></label>}
      <details><summary>{t('advanced')}</summary><label>{t(config.transport === 'stdio' ? 'env' : 'headers')}
        <textarea rows={5} value={config.transport === 'stdio' ? env : headers} onChange={(event) => { if (config.transport === 'stdio') setEnv(event.target.value); else setHeaders(event.target.value) }} />
      </label><p className={css.muted}>{t('secretNote')}</p></details>
      {error && <p role="alert" className={css.error}>{t(error)}</p>}
    </div>
  </Modal>
}

function McpImport({ t, busy, existing, close, save }: {
  t: T
  busy: boolean
  existing: readonly string[]
  close(this: void): void
  save(this: void, entries: Record<string, McpEntry>): Promise<void>
}) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<McpImportRow[]>()
  const [failed, setFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const entries = Object.fromEntries((rows ?? []).flatMap(row => !row.issue && row.config ? [[row.name, row.config]] : []))
  return <Modal className={css.dialog ?? ''} open title={t('import')} description={t('importHint')} closeLabel={t('close')} onClose={() => { if (!busy) close() }}
    footer={<><Button disabled={busy} onClick={close}>{t('cancel')}</Button>
      <Button variant="outline" disabled={busy} onClick={() => {
        try { setRows(reviewMcpImport(text, existing)); setFailed(false) }
        catch (_error) { setRows(undefined); setFailed(true) }
      }}>{t('review')}</Button>
      <Button variant="primary" disabled={busy || Object.keys(entries).length === 0} onClick={() => {
        void save(entries).catch(() => { setSaveFailed(true) })
      }}>{t('importSave')}</Button></>}>
    <div className={css.form}><label>{t('importText')}<textarea rows={9} value={text} onChange={(event) => { setText(event.target.value); setRows(undefined); setSaveFailed(false) }} /></label>
      {failed && <p role="alert">{t('importInvalid')}</p>}{saveFailed && <p role="alert">{t('saveError')}</p>}
      {rows && <ul className={css.review}>{rows.map(row => <li key={row.name}><strong>{row.name}</strong><span>{row.issue ? t(`issue.${row.issue}`) : t('importReady')}</span></li>)}</ul>}
    </div>
  </Modal>
}
