/** MCP forms render validated configuration and observed connection state. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, IconInfoOutlineRegular, IconPlusOutlineRegular, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpProbeResult } from '@deepseek-ai/dsh-mcp-client/types'
import type { McpSource, McpSnapshot } from './source.ts'
import { parseMcpEntry, parseMcpStrings, reviewMcpImport, validMcpName, OFFICIAL_MCP_NAMES, type McpEntry, type McpImportRow } from './config.ts'
import { McpEmptyIllustration } from './McpEmptyIllustration.tsx'
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

type McpPageFace = PropsLocale<'settings.mcp'> & InjectFace<McpPageInjected>
/** MCP entry in the existing settings navigation. */
export type McpPageProps = PropsRuntime<'settings.section'> & McpPageFace
/** MCP entry in the main panel. */
export type McpMainPageProps = PropsRuntime<'main'> & McpPageFace
type Editor = { name: string; original?: string; config: McpEntry; revision: number }

/** Validate and manage the requested configuration.
 * @param props - localized settings projection and MCP operations.
 * @returns the server manager. */
export function McpPage(props: McpPageProps) {
  return <McpContent {...props} />
}

/** Render the custom MCP manager in the main panel.
 * @param props - main-panel slot properties and MCP operations.
 * @returns the scrollable MCP manager. */
export function McpMainPage(props: McpMainPageProps) {
  return <div className={css.main}><McpContent {...props} /></div>
}

/** A header action that opens add or import inside the embedded manager. */
export interface McpToolbarRequest {
  readonly kind: 'add' | 'import'
  readonly id: number
}

/** Shared custom-MCP body reused by the fused skills/MCP host.
 * @param props - locale, snapshot hook, and MCP operations.
 * @returns the manager layout. */
export function McpContent({ useMcp, source, t, embedded = false, request }: McpPageFace & {
  /** Drop the page title when this list sits under the Skills & MCP heading. */
  embedded?: boolean
  /** Opens add or import from the page heading. Ignored until `id` changes. */
  request?: McpToolbarRequest
}) {
  const snapshot = useMcp(value => value)
  const [editor, setEditor] = useState<Editor>()
  const [importing, setImporting] = useState<{ revision: number }>()
  const [deleting, setDeleting] = useState<{ name: string; revision: number; inherited: boolean }>()
  const [probe, setProbe] = useState<{ name: string; result?: McpProbeResult; failed?: boolean }>()
  const [error, setError] = useState(false)
  const probeSequence = useRef(0)
  useEffect(() => { void source.load() }, [source])
  useEffect(() => () => { probeSequence.current++; source.cancelProbe() }, [source])
  const seenRequest = useRef(request?.id)
  useEffect(() => {
    if (request === undefined || request.id === seenRequest.current) return
    seenRequest.current = request.id
    if (request.kind === 'add') {
      setEditor({ name: '', config: { transport: 'stdio', command: '', args: [], enabled: false }, revision: snapshot.namespace?.revision ?? 0 })
    } else setImporting({ revision: snapshot.namespace?.revision ?? 0 })
  }, [request, snapshot.namespace?.revision])
  const revision = snapshot.namespace?.revision ?? 0
  const openAdd = (): void => {
    setEditor({ name: '', config: { transport: 'stdio', command: '', args: [], enabled: false }, revision })
  }
  const names = [...new Set([...Object.keys(snapshot.entries), ...snapshot.servers.map(row => row.name)])]
    .filter(name => !OFFICIAL_MCP_NAMES.includes(name))
  const action = async (operation: () => Promise<void>): Promise<void> => {
    setError(false)
    try { await operation() }
    catch (_error) { setError(true) }
  }
  return <section className={css.page}>
    {embedded
      ? <div className={css.sectionHead}>
        <h2 className={css.sectionLabel}>{t('nav')}</h2>
        <Button size="sm" onClick={() => { void source.refresh() }}>{t('refresh')}</Button>
      </div>
      : <header className={css.header}><div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
        <Button onClick={() => { void source.refresh() }}>{t('refresh')}</Button>
      </header>}
    {!embedded && <div className={css.actions}>
      <Button variant="primary" disabled={!snapshot.writable || snapshot.busy} onClick={() => { setEditor({
        name: '', config: { transport: 'stdio', command: '', args: [], enabled: false }, revision,
      }) }}>{t('add')}</Button>
      <Button variant="outline" disabled={!snapshot.writable || snapshot.busy} onClick={() => { setImporting({ revision }) }}>{t('import')}</Button>
    </div>}
    {(snapshot.failed || error) && <p role="alert" className={css.error}>{t(snapshot.failed ? 'failed' : 'actionFailed')}</p>}
    {!snapshot.loaded ? <p role="status">{t('loading')}</p> : names.length === 0 ? <div className={css.emptyState} role="status">
      <McpEmptyIllustration className={css.emptyIllustration} />
      <p className={css.emptyTitle}>{t('empty')}</p>
      <p className={css.emptyHint}>{t('emptyHint')}</p>
      <Button variant="outline" size="sm" className={css.emptyAction} icon={<IconPlusOutlineRegular size={13} />} onClick={openAdd}>{t('emptyAction')}</Button>
    </div> :
      <ul className={css.pluginRows}>{names.map((name) => {
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
        const summary = config ? config.transport === 'stdio' ? [config.command, ...(config.args ?? [])].join(' ') : config.url : t('plugin')
        return <li key={name} className={css.pluginItem}>
          <div className={css.pluginRowStatic}>
            <span className={css.pluginIcon} aria-hidden="true"><NameMark name={name} /></span>
            <span className={css.pluginMain}>
              <span className={css.pluginName}>{name}</span>
              <span className={css.pluginDesc}>{summary}</span>
            </span>
            <span className={css.pluginEnd}>
              <span className={css.status} data-state={state}>{t(`state.${state}`)}</span>
              {runtime?.status.state === 'connected' && <span className={css.muted}>{t('toolCount', { count: runtime.status.toolCount })}</span>}
            </span>
          </div>
          {runtime?.status && 'lastError' in runtime.status && runtime.status.lastError && <p className={css.diagnostic}>{runtime.status.lastError}</p>}
          <div className={css.pluginActions}>
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
        </li>
      })}</ul>}
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

const MARK_COLORS = ['#658EFF', '#45C7A4', '#A797FC', '#679EFE', '#E2A15A']

/** First character of a server name, used when the server has no icon. */
function NameMark({ name }: { readonly name: string }) {
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'
  let index = 0
  for (const char of name) index = (index + (char.codePointAt(0) ?? 0)) % MARK_COLORS.length
  return <span className={css.nameMark} style={{ color: MARK_COLORS[index] }}>{letter}</span>
}

function envToLines(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function linesToEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const split = line.indexOf('=')
    if (split <= 0) throw new Error('env')
    result[line.slice(0, split).trim()] = line.slice(split + 1)
  }
  return result
}

function fieldTitle(label: string, hint: string) {
  return <span className={css.fieldTitle}>
    {label}
    <Tooltip label={hint} side="top" portal>
      <button type="button" className={css.info} aria-label={hint}><IconInfoOutlineRegular size={14} /></button>
    </Tooltip>
  </span>
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
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [name, setName] = useState(editor.name)
  const [config, setConfig] = useState(editor.config)
  const [args, setArgs] = useState(JSON.stringify(editor.config.args ?? [], null, 2))
  const [env, setEnv] = useState(envToLines(editor.config.env))
  const [headers, setHeaders] = useState(JSON.stringify(editor.config.headers ?? {}, null, 2))
  const [jsonText, setJsonText] = useState('')
  const [jsonDirty, setJsonDirty] = useState(false)
  const [error, setError] = useState<'invalid' | 'saveError' | 'nameConflict'>()
  const draftJson = (): string => JSON.stringify(config.transport === 'stdio'
    ? { name, transport: 'stdio', command: config.command ?? '', args: JSON.parse(args || '[]') as unknown, ...(config.cwd ? { cwd: config.cwd } : {}), env: linesToEnv(env) }
    : { name, transport: 'streamable-http', url: config.url ?? '', headers: JSON.parse(headers || '{}') as unknown }, null, 2)
  const applyJson = (text: string): boolean => {
    let raw: unknown
    try { raw = JSON.parse(text) } catch { return false }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
    const record = raw as Record<string, unknown>
    const nextName = typeof record.name === 'string' ? record.name : ''
    const { name: _name, ...rest } = record
    const parsed = parseMcpEntry(rest)
    if (parsed === undefined || !validMcpName(nextName)) return false
    setName(nextName)
    setConfig(parsed)
    setArgs(JSON.stringify(parsed.args ?? [], null, 2))
    setEnv(envToLines(parsed.env))
    setHeaders(JSON.stringify(parsed.headers ?? {}, null, 2))
    setJsonDirty(false)
    return true
  }
  const showJson = (): void => {
    if (!jsonDirty) {
      try { setJsonText(draftJson()) } catch { setError('invalid'); return }
    }
    setError(undefined)
    setMode('json')
  }
  const showForm = (): void => {
    if (jsonDirty && !applyJson(jsonText)) { setError('invalid'); return }
    setError(undefined)
    setMode('form')
  }
  const submit = async (): Promise<void> => {
    let nextName = name
    let nextConfig = config
    let nextArgs = args
    let nextEnv = env
    let nextHeaders = headers
    if (mode === 'json') {
      if (!applyJson(jsonText)) { setError('invalid'); return }
      let raw: unknown
      try { raw = JSON.parse(jsonText) } catch { setError('invalid'); return }
      const record = raw as Record<string, unknown>
      nextName = typeof record.name === 'string' ? record.name : ''
      const { name: _name, ...rest } = record
      const parsed = parseMcpEntry(rest)
      if (parsed === undefined) { setError('invalid'); return }
      nextConfig = parsed
      nextArgs = JSON.stringify(parsed.args ?? [])
      nextEnv = JSON.stringify(parsed.env ?? {})
      nextHeaders = JSON.stringify(parsed.headers ?? {})
    }
    if (!editor.original && existing.includes(nextName)) { setError('nameConflict'); return }
    let parsed: McpEntry | undefined
    try {
      if (!validMcpName(nextName)) throw new Error('name')
      const { command: _command, args: _args, cwd: _cwd, env: _env, url: _url, headers: _headers, ...base } = nextConfig
      const parsedArgs: unknown = JSON.parse(nextArgs)
      parsed = parseMcpEntry(nextConfig.transport === 'stdio' ? { ...base, command: nextConfig.command,
        args: parsedArgs, ...(nextConfig.cwd ? { cwd: nextConfig.cwd } : {}), env: mode === 'json' ? (nextConfig.env ?? {}) : linesToEnv(nextEnv) }
        : { ...base, url: nextConfig.url, headers: parseMcpStrings(nextHeaders) })
      if (parsed === undefined) throw new Error('fields')
    } catch (_error) { setError('invalid'); return }
    try { await save(nextName, parsed) }
    catch (_error) { setError('saveError') }
  }
  return <Modal className={css.dialog ?? ''} open title={t(editor.original ? 'edit' : 'add')} closeLabel={t('close')} onClose={() => { if (!busy) close() }}
    footer={<><Button disabled={busy} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => { void submit() }}>{t('save')}</Button></>}>
    <div className={css.form}>
      <div className={`${css.filterTabs} ${css.editorTabs}`} role="tablist" aria-label={t('editor.tabs')}>
        <button type="button" role="tab" className={`${css.filterTab}${mode === 'form' ? ` ${css.filterTabActive}` : ''}`} aria-selected={mode === 'form'} onClick={showForm}>{t('editor.form')}</button>
        <button type="button" role="tab" className={`${css.filterTab}${mode === 'json' ? ` ${css.filterTabActive}` : ''}`} aria-selected={mode === 'json'} onClick={showJson}>{t('editor.json')}</button>
      </div>
      {mode === 'form' ? <>
        <div className={css.formPair}>
          <label>{t('transport')}<select value={config.transport} disabled={busy} onChange={(event) => { setConfig({ ...config, transport: event.target.value === 'stdio' ? 'stdio' : 'streamable-http' }) }}>
            <option value="stdio">{t('stdio')}</option><option value="streamable-http">{t('http')}</option>
          </select></label>
          <label htmlFor={`${id}-name`}>{t('name')}<input id={`${id}-name`} data-modal-autofocus value={name} disabled={!!editor.original || busy} onChange={(event) => { setName(event.target.value) }} /></label>
        </div>
        {config.transport === 'stdio' ? <>
          <label>{t('command')}<input value={config.command ?? ''} onChange={(event) => { setConfig({ ...config, command: event.target.value }) }} /></label>
          <label>{t('args')}<textarea rows={3} value={args} onChange={(event) => { setArgs(event.target.value) }} /></label>
        </> : <label>{t('url')}<input value={config.url ?? ''} onChange={(event) => { setConfig({ ...config, url: event.target.value }) }} /></label>}
        <details><summary>{t('advanced')}</summary>
          {config.transport === 'stdio' ? <label>{fieldTitle(t('env'), t('envHint'))}
            <textarea rows={4} value={env} placeholder={t('envPlaceholder')} spellCheck={false} onChange={(event) => { setEnv(event.target.value) }} />
          </label> : <label>{t('headers')}
            <textarea rows={5} value={headers} onChange={(event) => { setHeaders(event.target.value) }} />
          </label>}
          <p className={css.muted}>{t('secretNote')}</p>
        </details>
      </> : <>
        <p className={css.muted}>{t('editor.jsonHint')}</p>
        <textarea className={css.editorJson} rows={14} value={jsonText} disabled={busy} spellCheck={false}
          onChange={(event) => { setJsonText(event.target.value); setJsonDirty(true) }} />
      </>}
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
