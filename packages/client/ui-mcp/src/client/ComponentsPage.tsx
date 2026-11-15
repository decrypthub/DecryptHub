/** Official components: compact status rows; details and install live in the dialog. */
import { useEffect, useRef, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, IconCordisPluginOutlineRegular, IconRefreshOutlineRegular, Menu, Modal, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentId, ComponentView, OfficialConfiguration } from '@deepseek-ai/dsh-decrypthub-components/types'
import { OfficialConfigurationReview } from './config-review.ts'
import type { McpProbeResult } from '@deepseek-ai/dsh-mcp-client/types'
import type { McpSnapshot } from './source.ts'
import type { ComponentsSource, ComponentsState } from './components-source.ts'
import type { McpSource } from './source.ts'
import css from './Page.module.css'

/** Shared actions used by the settings and standalone entries. */
export interface ComponentsPageInjected {
  hooks: { components: HostObservable<ComponentsState>; mcp: HostObservable<McpSnapshot> }
  source: ComponentsSource
  mcp: McpSource
}
/** Locale and observation capabilities are supplied by the slot owner. */
export type ComponentsPageProps = PropsLocale<'settings.mcp'> & InjectFace<ComponentsPageInjected>
type Confirmation = { kind: 'install' | 'rollback' | 'uninstall'; component: ComponentView } | { kind: 'browser' }

function confirmationTitle(kind: Confirmation['kind'], t: ComponentsPageProps['t']): string {
  switch (kind) {
    case 'browser': return t('official.licenseTitle')
    case 'rollback': return t('official.rollbackTitle')
    case 'uninstall': return t('official.removeTitle')
    case 'install': return t('official.installTitle')
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function confirmationAction(kind: Confirmation['kind'], t: ComponentsPageProps['t']): string {
  switch (kind) {
    case 'browser': return t('official.install')
    case 'rollback': return t('official.rollback')
    case 'uninstall': return t('official.remove')
    case 'install': return t('official.install')
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
type Selected = { id: ComponentId; config: OfficialConfiguration }
function sameEndpoint(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/\/(?:api\/)?mcp\/?$/, '').replace(/\/$/, '')
  return normalize(left) === normalize(right)
}
const pending = (component: ComponentView): boolean => component.operation !== null && ['checking', 'downloading', 'verifying', 'installing'].includes(component.operation.phase)

/** Prefer managed install version, then `cli --version`, never an executable filename. */
function componentVersionLabel(component: ComponentView, missing: string): string {
  return component.installed?.version ?? component.localVersion ?? missing
}

/** Browser, Android, and Apple marks for the three official rows. */
function officialArtwork(id: ComponentId) {
  if (id === 'wdh') return <BrowserMark />
  if (id === 'adh') return <AndroidMark />
  return <AppleMark />
}

function BrowserMark() {
  return <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
    <rect x="6" y="8" width="24" height="18" rx="3" fill="none" stroke="#658EFF" strokeWidth="2" />
    <path d="M6 13h24" stroke="#658EFF" strokeWidth="2" />
    <circle cx="10" cy="10.5" r="1" fill="#658EFF" />
  </svg>
}

function AndroidMark() {
  return <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
    <svg x="5" y="4" width="26" height="26" viewBox="0 0 24 24">
      <path fill="#3DDC84" d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84 1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C13.85 1.23 12.95 1 12 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.47-4.84z" />
      <circle cx="9.5" cy="4.5" r="0.7" fill="#07381F" />
      <circle cx="14.5" cy="4.5" r="0.7" fill="#07381F" />
    </svg>
  </svg>
}

function AppleMark() {
  return <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
    <path d="M20.2 11.2c.7-1 1.8-1.6 2.8-1.7-.1 1.1-.5 2.1-1.2 2.8-.7.8-1.7 1.4-2.7 1.3.1-1 .4-1.6 1.1-2.4z" fill="#111111" />
    <path d="M22.6 14.2c-1.5-.1-2.8.9-3.5.9s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.3 2.9 2.3 1.1 0 1.6-.7 3-.7s1.8.7 3 .7 2-.1 2.9-2.3c.6-1 1.1-2 1.4-3.1-3.6-1.4-3-6.4.1-7.6-.9-1.2-2.2-1.9-3.2-2z" fill="#111111" />
  </svg>
}

/** Sidebar entry uses the existing plugin glyph.
 * @returns the official components navigation icon.
 */
export function ComponentsIcon() { return <IconCordisPluginOutlineRegular /> }

/** Per-session WDH connections, which never pass through the shared MCP manager. */
function wdhRows(state: ComponentsState) {
  return state.value?.wdh ?? []
}

/** Whether enabling this component right now can start something real. */
function usable(component: ComponentView): boolean {
  return component.installed !== null || component.localCommand !== null
}

/** Tools the WDH component reported the last time a session connected it. */
function wdhKnownTools(state: ComponentsState): number | null {
  const value = state.value
  if (value === null) return null
  const live = Math.max(0, ...value.wdh.map(row => row.status.state === 'connected' ? row.status.toolCount : 0))
  return live > 0 ? live : value.wdhTools
}

/** Devices are enabled by picking an address, so a configured device counts as usable. */
function deviceConfigured(state: ComponentsState, id: ComponentId): boolean {
  const configuration = state.value?.configuration
  return configuration !== null && configuration !== undefined && configuration[id].enabled
}

/** Whether the component's tools are registered in a live connection right now. */
function managedServer(state: ComponentsState, id: ComponentId) {
  return state.connections.find(row => row.name === id)
}

function managedConnected(state: ComponentsState, id: ComponentId): boolean {
  return managedServer(state, id)?.status.state === 'connected'
}

function managedToolCount(state: ComponentsState, id: ComponentId): number {
  const status = managedServer(state, id)?.status
  return status?.state === 'connected' ? status.toolCount : 0
}


function componentConnected(state: ComponentsState, snapshot: McpSnapshot, id: ComponentId): boolean {
  if (id === 'wdh') return wdhRows(state).some(row => row.status.state === 'connected')
  return snapshot.servers.find(row => row.name === id)?.status.state === 'connected'
}

/** Registered tool count of the live generation; zero until it connects. */
function componentToolCount(state: ComponentsState, snapshot: McpSnapshot, id: ComponentId): number {
  if (id === 'wdh') {
    // Every session runs its own WDH client against the same component build, so the largest live set is the tool surface.
    return Math.max(0, ...wdhRows(state).map(row => row.status.state === 'connected' ? row.status.toolCount : 0))
  }
  const status = snapshot.servers.find(row => row.name === id)?.status
  return status?.state === 'connected' ? status.toolCount : 0
}

/** Render the product component manager from retained observations.
 * @param props - component source and localized copy.
 * @returns horizontal status rows that open a configuration dialog.
 */
export function ComponentsPage({ useComponents, useMcp, source, mcp, t, embedded = false }: ComponentsPageProps & {
  /** Drop the page title when this list sits under the Skills & MCP heading. */
  embedded?: boolean
}) {
  const state = useComponents(value => value)
  const mcpState = useMcp(value => value)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<Selected>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [accepted, setAccepted] = useState(false)
  const [probe, setProbe] = useState<{ name: string; result?: McpProbeResult; failed?: boolean }>()
  const sequence = useRef(0)
  const checked = useRef(false)
  useEffect(() => {
    source.load()
    return () => { sequence.current++; mcp.cancelProbe() }
  }, [source, mcp])
  useEffect(() => {
    if (checked.current || state.value === null || state.busy) return
    checked.current = true
    void source.run(ops => ops.checkUpdates()).catch(() => { setError(true) })
  }, [source, state.value, state.busy])
  // The card needs a real tool count even before any session connects WDH, so measure once on load.
  useEffect(() => {
    const wdh = state.value?.components.find(row => row.id === 'wdh')
    if (state.busy || wdh?.installed === null || wdh === undefined) return
    if (state.value?.wdhTools !== null) return
    void source.observe(ops => ops.measureTools('wdh')).catch(() => {})
  }, [source, state.busy, state.value])
  const action = async (operation: () => Promise<unknown>): Promise<void> => {
    setError(false)
    try { await operation() } catch (_error) { setError(true) }
  }
  const value = state.value
  const config = value?.configuration
  const installing = value?.components.some(pending) ?? false
  const disabled = state.busy || installing
  const selectedComponent = selected && value?.components.find(row => row.id === selected.id)
  return <section className={css.official}>
    <div className={css.componentHeaderRow}>
      {embedded
        ? <h2 className={css.sectionLabel}>{t('official.nav')}</h2>
        : <header className={css.header}><div><h2>{t('official.title')}</h2><p>{t('official.intro')}</p></div></header>}
      <Tooltip label={t('official.refresh')}>
        <Button size="sm" variant="ghost" className={css.refreshButton} aria-label={t('official.refresh')} disabled={state.busy}
          icon={<IconRefreshOutlineRegular size={14} />} onClick={() => { source.reset() }} />
      </Tooltip>
    </div>
    {(error || state.failed) && <p role="alert" className={css.error}>{t(state.failed ? 'official.failed' : 'official.actionFailed')}</p>}
    {state.connectionFailed && <p role="alert">{t('official.connectionFailed')}</p>}
    {!value ? <p role="status">{t('loading')}</p> : <>
      {!config && <p role="alert">{t('official.configurationMissing')}</p>}
      <ul className={css.pluginRows}>{value.components.map((component) => {
        const id = component.id
        const enabled = config?.[id].enabled ?? false
        return <li key={id}>
          <div className={css.componentRow}>
            <button type="button" className={css.pluginRow} disabled={!config}
              aria-label={`${id.toUpperCase()} · ${t(`official.${id}`)} · ${t('official.configure')}`}
              onClick={() => { if (config) setSelected({ id, config }) }}>
              <span className={css.pluginIcon} aria-hidden="true">{officialArtwork(id)}</span>
              <span className={css.pluginMain}>
                <span className={css.pluginName}>{id.toUpperCase()}</span>
                <span className={css.pluginDesc}>{t(`official.${id}`)}</span>
              </span>
              <span className={css.pluginEnd}>
                <span className={css.cardRuntime} data-state={componentConnected(state, mcpState, id) || managedConnected(state, id) || (id === 'wdh' && enabled && wdhKnownTools(state) !== null) ? 'connected' : 'idle'}>
                  <span className={css.cardDot} aria-hidden="true" />
                  {componentConnected(state, mcpState, id)
                    ? t('official.tools', { count: String(componentToolCount(state, mcpState, id)) })
                    : managedConnected(state, id)
                      ? t('official.tools', { count: String(managedToolCount(state, id)) })
                      : id === 'wdh' && component.installed !== null && enabled && wdhKnownTools(state) !== null
                        ? t('official.tools', { count: String(wdhKnownTools(state)) })
                        : (() => {
                          const server = managedServer(state, id)
                          return server !== undefined
                            ? t(`state.${server.status.state}`)
                            : component.installed || component.localCommand || deviceConfigured(state, id)
                              ? componentVersionLabel(component, t('official.missing'))
                              : t('official.missing')
                        })()}
                </span>
                {component.operation && pending(component) && <span className={css.muted} role="status">{t(`official.progress.${component.operation.phase}`)}</span>}
              </span>
            </button>
            <Switch checked={enabled} disabled={disabled || !config?.writable} label={`${t('official.enableLabel')} ${id.toUpperCase()}`}
              onChange={(next) => {
                // Nothing to start yet: send the user to install or pick a device instead of failing the write.
                const ready = usable(component) && (id === 'wdh' || (value.configuration?.[id].devices ?? []).length > 0)
                const configuration = value.configuration
                if (next && !ready) {
                  if (!configuration) return
                  setSelected({ id, config: configuration })
                  return
                }
                void action(async () => {
                  const current = value.configuration
                  if (!current) return
                  await source.run(ops => ops.configure(id, { ...current, [id]: { ...current[id], enabled: next } }))
                })
              }} />
          </div>
        </li>
      })}</ul>
    </>}
    {selected && selectedComponent && config && <ComponentEditor
      id={selected.id} component={selectedComponent} initial={selected.config}
      state={state} value={value} busy={disabled} t={t} close={() => { setSelected(undefined) }}
      save={async (next) => { await source.run(ops => ops.configure(selected.id, next)) }}
      onConfirm={(choice) => {
        if (choice.kind === 'browser') setAccepted(false)
        // Installing is additive and reversible: start it on the click instead of a second confirmation.
        if (choice.kind === 'install') {
          void action(() => source.run(ops => ops.install(choice.component.id, choice.component.latestVersion ?? '')))
          return
        }
        setConfirmation(choice)
      }}
      cancelInstall={() => { void action(() => source.run(ops => ops.cancel(selected.id))) }}
      inspectBrowser={() => { void action(() => source.observe(ops => ops.inspectBrowser())) }}
      measure={async target => await source.observe(ops => ops.measureTools(target)) ?? null}
      inspectTargets={async (target) => { await source.observe(ops => ops.inspectTargets(target)) }}
      closeAfterSave={() => { setSelected(undefined) }} />}
    <Modal className={css.confirmDialog ?? ''} open={confirmation !== undefined} title={confirmation ? confirmationTitle(confirmation.kind, t) : ''}
      closeLabel={t('close')} onClose={() => { if (!state.busy) setConfirmation(undefined) }} footer={<>
        <Button disabled={state.busy} onClick={() => { setConfirmation(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={state.busy || (confirmation?.kind === 'browser' && !accepted)} onClick={() => { if (confirmation) void action(async () => {
          const choice = confirmation
          await source.run((ops) => {
            if (choice.kind === 'browser') return ops.installBrowser(accepted)
            if (choice.kind === 'rollback') return ops.rollback(choice.component.id)
            if (choice.kind === 'uninstall') return ops.uninstall(choice.component.id)
            return ops.install(choice.component.id, choice.component.latestVersion ?? '')
          })
          setConfirmation(undefined)
        }) }}>{confirmation ? confirmationAction(confirmation.kind, t) : t('official.install')}</Button>
      </>}>
      {confirmation?.kind === 'browser' ? <div className={css.form}><p>{t('official.licenseHint')}</p>
        <a href="https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md" target="_blank" rel="noreferrer">{t('official.license')}</a>
        <label className={css.checkbox}><input type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked) }} />{t('official.acceptLicense')}</label></div>
        : confirmation ? <><p>{t(confirmation.kind === 'rollback' ? 'official.rollbackHint' : confirmation.kind === 'uninstall' ? 'official.removeHint' : 'official.installHint')}</p>
          <p>{confirmation.component.id.toUpperCase()}{confirmation.kind === 'rollback' ? ` · ${confirmation.component.previousVersion}` : confirmation.kind === 'install' ? ` · ${confirmation.component.latestVersion}` : confirmation.component.installed ? ` · ${confirmation.component.installed.version}` : ''}</p></> : null}
      {error && <p role="alert">{t('official.actionFailed')}</p>}
    </Modal>
    <Modal className={css.dialog ?? ''} open={probe !== undefined} title={t('toolTitle')} closeLabel={t('close')} onClose={() => { sequence.current++; mcp.cancelProbe(); setProbe(undefined) }}>
      <strong>{probe?.name.toUpperCase()}</strong>
      {probe?.failed ? <p role="alert">{t('probeFailed')}</p> : probe?.result === undefined ? <p role="status">{t('loading')}</p> : !probe.result.ok
        ? <p role="alert">{probe.result.message}</p> : <><p>{probe.result.serverInfo?.name} {probe.result.serverInfo?.version}</p><ul>{probe.result.toolNames.map(name => <li key={name}>{name}</li>)}</ul></>}
      {probe?.result && (!probe.result.closeConfirmed || probe.result.cleanupError) && <p role="alert">{t('cleanupFailed')}</p>}
    </Modal>
  </section>
}

function ComponentEditor({
  id, component, initial, state, value, busy, t, close, save,
  onConfirm, cancelInstall, inspectBrowser, closeAfterSave, measure, inspectTargets,
}: {
  id: ComponentId
  component: ComponentView
  initial: OfficialConfiguration
  state: ComponentsState
  value: NonNullable<ComponentsState['value']>
  busy: boolean
  t: ComponentsPageProps['t']
  close(this: void): void
  save(this: void, next: OfficialConfiguration): Promise<void>
  onConfirm(this: void, confirmation: Confirmation): void
  cancelInstall(this: void): void
  inspectBrowser(this: void): void
  closeAfterSave(this: void): void
  measure(this: void, id: ComponentId): Promise<unknown>
  inspectTargets(this: void, id: ComponentId): Promise<void>
}) {
  const [next, setNext] = useState(initial)
  const [args] = useState(JSON.stringify(id === 'wdh' ? [] : initial[id].args))
  const [error, setError] = useState<'official.invalid' | 'saveError' | 'official.targetsFailed'>()
  const inspected = useRef(false)
  const device = id === 'wdh' ? null : next[id]
  const writable = value.configuration?.writable ?? false
  const [kernelOpen, setKernelOpen] = useState(false)
  const kernelState = value.browser.state
  const kernelLabel = next.wdh.browser === 'system' ? t('official.browser.system') : t('official.browser.cloak')
  const kernelStatus = next.wdh.browser === 'system'
    ? t('official.kernel.systemHint')
    : !component.installed ? t('official.missing')
      : `${t(`official.kernel.${kernelState}`)}${value.browser.version ? ` · ${value.browser.version}` : ''}`
  const kernelNeedsDownload = next.wdh.browser === 'cloak' && kernelState !== 'found' && kernelState !== 'unchecked'
  const kernelItems: MenuItem[] = [
    { id: 'system', label: <span className={css.kernelOption}><span>{t('official.browser.system')}</span><span className={css.kernelOptionHint}>{t('official.kernel.systemHint')}</span></span> },
    { id: 'cloak', label: <span className={css.kernelOption}><span>{t('official.browser.cloak')}</span><span className={css.kernelOptionHint} data-state={kernelState === 'found' ? 'connected' : kernelState === 'missing' || kernelState === 'failed' ? 'failed' : undefined}>{component.installed ? `${t(`official.kernel.${kernelState}`)}${value.browser.version ? ` · ${value.browser.version}` : ''}` : t('official.missing')}</span></span> },
  ]
  const canInstall = component.latestVersion !== null && component.latestVersion !== component.installed?.version
  const canRemove = component.installed?.source === 'managed'
  useEffect(() => {
    if (id !== 'wdh' || !component.installed || inspected.current || busy) return
    inspected.current = true
    inspectBrowser()
  }, [id, component.installed, busy, inspectBrowser])
  const persist = async (config: OfficialConfiguration, then?: () => void): Promise<boolean> => {
    try {
      await save(config)
      then?.()
      return true
    } catch (_error) {
      setError('saveError')
      return false
    }
  }
  // Configurations written before the device list existed have no array yet.
  const savedDevices = device?.devices ?? []
  const inventory = value.inventories?.[id]
  const [checkingTargets, setCheckingTargets] = useState(false)
  const refreshTargets = async (): Promise<void> => {
    if (checkingTargets) return
    setCheckingTargets(true)
    try { await inspectTargets(id) } catch (_error) { setError('official.targetsFailed') }
    finally { setCheckingTargets(false) }
  }
  const [tools, setTools] = useState<string[] | null>(null)
  const [toolsFailed, setToolsFailed] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false)
  useEffect(() => {
    if (component.installed === null && component.localCommand === null) return
    let live = true
    void measure(id).then((names) => {
      if (!live) return
      if (Array.isArray(names)) setTools(names as string[])
      else setToolsFailed(true)
    }, () => { if (live) setToolsFailed(true) })
    return () => { live = false }
  }, [component.installed, component.localCommand, id, measure])
  // Collapsed by default so async tool probing does not jump the dialog height.
  const toolsSection = () => {
    if (component.installed === null && component.localCommand === null) return null
    if (toolsFailed) return null
    const summaryExtra = tools === null
      ? t('official.toolsLoading')
      : tools.length === 0 ? t('official.toolsNone') : t('official.tools', { count: String(tools.length) })
    return (
      <section className={css.editorSection} aria-label={t('official.toolsTitle')}>
        <details className={css.toolsDetails}>
          <summary className={css.toolsSummary}>
            <span>{t('official.toolsTitle')}</span>
            <span className={css.muted}> · {summaryExtra}</span>
          </summary>
          {tools !== null && tools.length > 0
            && <ul className={css.toolList}>{tools.map(name => <li key={name}><code>{name}</code></li>)}</ul>}
        </details>
      </section>
    )
  }
  const [raw, setRaw] = useState(false)
  const [jsonText, setJsonText] = useState('')
  // The JSON view is scoped to this component's own entry: WDH shows wdh only, ADH shows adh only.
  const ownEntry = (): Record<string, unknown> => {
    const { revision: _revision, writable: _writable, ...entries } = next
    return entries[id] as Record<string, unknown>
  }
  const draftJson = (): string => JSON.stringify(ownEntry(), null, 2)
  const applyJson = (input: string): boolean => {
    let entry: unknown
    try { entry = JSON.parse(input) } catch { return false }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
    // Validate through the full namespace shape so cross-component edits are caught, then keep only this entry.
    const review = OfficialConfigurationReview.safeParse({ ...next, [id]: entry })
    if (!review.success) return false
    setNext(review.data)
    return true
  }
  const [draft, setDraft] = useState('')
  const saveDevices = async (devices: string[], endpoint: string): Promise<void> => {
    // Picking a device is the connection: the daemon starts as soon as the component is enabled.
    const configured = { ...next, [id]: { ...next[id], devices, endpoint, enabled: devices.length > 0 } }
    setNext(configured)
    await persist(configured)
  }
  const addDevice = async (): Promise<void> => {
    if (device === null) return
    const address = draft.trim()
    if (address === '') return
    try {
      const url = new URL(address)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('endpoint')
    } catch (_error) { setError('official.invalid'); return }
    if (savedDevices.includes(address)) { setDraft(''); return }
    // Selecting the first device is the whole connect step: the daemon starts on save.
    await saveDevices([...savedDevices, address], device.endpoint === '' ? address : device.endpoint)
    setDraft('')
    setAddingDevice(false)
  }
  const removeDevice = async (address: string): Promise<void> => {
    if (device === null) return
    const devices = savedDevices.filter((row: string) => row !== address)
    await saveDevices(devices, device.endpoint === address ? (devices[0] ?? '') : device.endpoint)
  }
  const chooseDevice = async (address: string): Promise<void> => { if (device !== null) await saveDevices(savedDevices, address) }
  const submit = async (): Promise<void> => {
    if (raw && !applyJson(jsonText)) { setError('official.invalid'); return }
    let config = next
    if (id !== 'wdh') {
      try {
        const parsed: unknown = JSON.parse(args)
        if (!Array.isArray(parsed) || !parsed.every((value: unknown) => typeof value === 'string')) throw new Error('args')
        const current = next[id]
        if (!current.command.trim() || (current.enabled && !current.endpoint.trim())) throw new Error('fields')
        if (current.endpoint) {
          const url = new URL(current.endpoint)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('endpoint')
        }
        config = { ...next, [id]: { ...current, args: parsed } }
      } catch (_error) { setError('official.invalid'); return }
    }
    if (await persist(config)) closeAfterSave()
  }
  return <Modal className={css.dialog ?? ''} open title={`${id.toUpperCase()} · ${t(`official.${id}`)}`} closeLabel={t('close')} onClose={() => { if (!busy) close() }}
    footer={id === 'wdh'
      ? <><Button disabled={busy} onClick={close}>{t('close')}</Button><Button variant="primary" disabled={busy || !writable} onClick={() => { void submit() }}>{t('save')}</Button></>
      : <Button disabled={busy} onClick={close}>{t('close')}</Button>}>
    <div className={css.form}>
      <div className={css.filterTabs} role="tablist" aria-label={t('editor.tabs')}>
        <button type="button" role="tab" className={`${css.filterTab}${raw ? '' : ` ${css.filterTabActive}`}`} aria-selected={!raw} onClick={() => { setRaw(false) }}>{t('editor.form')}</button>
        <button type="button" role="tab" className={`${css.filterTab}${raw ? ` ${css.filterTabActive}` : ''}`} aria-selected={raw} onClick={() => { if (!raw) { setJsonText(draftJson()); setRaw(true) } }}>{t('editor.json')}</button>
      </div>
      {raw && <label className={css.rawJson}>
        <textarea value={jsonText} disabled={busy || !writable} rows={12} spellCheck={false}
          onChange={(event) => { setJsonText(event.target.value) }} aria-label={t('editor.json')} />
        <span className={css.muted}>{t('editor.jsonHint')}</span>
      </label>}
      {!raw && <>
        {id === 'wdh' ? <>
          <section className={css.editorSection} aria-label={t('official.sectionStatus')}>
            <div className={css.componentHeader}>
              <span className={css.muted}>{t('official.version')}</span>
              <strong className={css.componentVersion}>{component.installed?.version ?? t('official.missing')}</strong>
              <div className={css.componentActions}>
                {canInstall && <Button size="sm" variant={component.installed ? 'outline' : 'primary'} disabled={busy} onClick={() => { onConfirm({ kind: 'install', component }) }}>{t(component.installed ? 'official.update' : 'official.install')}</Button>}
                {component.previousVersion && <Button size="sm" variant="outline" disabled={busy} onClick={() => { onConfirm({ kind: 'rollback', component }) }}>{t('official.rollback')} · {component.previousVersion}</Button>}
                {canRemove && <Button size="sm" variant="outline" disabled={busy} onClick={() => { onConfirm({ kind: 'uninstall', component }) }}>{t('official.remove')}</Button>}
                {pending(component) && <Button size="sm" disabled={state.busy} onClick={cancelInstall}>{t('cancel')}</Button>}
              </div>
            </div>
            {component.catalogError && <p role="alert" className={css.muted}>{t('official.catalogFailed')}</p>}
            {(pending(component) || component.operation?.phase === 'failed') && component.operation && <div className={css.operation} role="status">
              <span>{t(`official.progress.${component.operation.phase}`)}</span>
              {component.operation.total > 0 && pending(component) && <progress aria-label={t(`official.progress.${component.operation.phase}`)} max={component.operation.total} value={component.operation.received} />}
              {component.operation.error && <span className={css.error}>{component.operation.error}</span>}
            </div>}
          </section>
          {toolsSection()}
          <section className={css.editorSection} aria-label={t('official.sectionKernel')}>
            <h3 className={css.editorSectionTitle}>{t('official.sectionKernel')}</h3>
            <Menu
              open={kernelOpen}
              onClose={() => { setKernelOpen(false) }}
              items={kernelItems}
              selectedId={next.wdh.browser}
              align="start"
              portal
              minWidthFromAnchor
              onSelect={(id) => { setKernelOpen(false); setNext({ ...next, wdh: { ...next.wdh, browser: id === 'system' ? 'system' : 'cloak' } }) }}
              anchor={<button type="button" className={css.kernelTrigger} aria-haspopup="menu"
                aria-expanded={kernelOpen} disabled={busy || !writable}
                onClick={() => { setKernelOpen(open => !open) }}>
                <span className={css.kernelOption}>
                  <span>{kernelLabel}</span>
                  <span className={css.kernelOptionHint}>{kernelStatus}</span>
                </span>
                <IconChevronDownOutlineRegular />
              </button>} />
            {kernelNeedsDownload && <div className={css.actions}>
              <Button variant="primary" size="sm" disabled={busy || !component.installed} onClick={() => { onConfirm({ kind: 'browser' }) }}>{t('official.downloadBrowser')}</Button>
            </div>}
          </section>
        </> : <>
          <div className={css.editorBlock}>
            <div className={css.componentHeader}>
              <span className={css.muted}>{t('official.version')}</span>
              <strong className={css.componentVersion}>{componentVersionLabel(component, t('official.missing'))}</strong>
              <div className={css.componentActions}>
                {canInstall && <Button size="sm" variant={component.installed ? 'outline' : 'primary'} disabled={busy} onClick={() => { onConfirm({ kind: 'install', component }) }}>{t(component.installed ? 'official.update' : 'official.install')}</Button>}
                {component.previousVersion && <Button size="sm" variant="outline" disabled={busy} onClick={() => { onConfirm({ kind: 'rollback', component }) }}>{t('official.rollback')} · {component.previousVersion}</Button>}
                {canRemove && <Button size="sm" variant="outline" disabled={busy} onClick={() => { onConfirm({ kind: 'uninstall', component }) }}>{t('official.remove')}</Button>}
                {pending(component) && <Button size="sm" disabled={state.busy} onClick={cancelInstall}>{t('cancel')}</Button>}
              </div>
            </div>
            {component.catalogError && <p role="alert" className={css.muted}>{t('official.catalogFailed')}</p>}
            {(pending(component) || component.operation?.phase === 'failed') && component.operation && <div className={css.operation} role="status">
              <span>{t(`official.progress.${component.operation.phase}`)}</span>
              {component.operation.total > 0 && pending(component) && <progress aria-label={t(`official.progress.${component.operation.phase}`)} max={component.operation.total} value={component.operation.received} />}
            </div>}
          </div>
          {toolsSection()}
          {device && <section className={css.editorSection} aria-label={t('official.devices')}>
            <div className={css.editorSectionHeader}>
              <h3 className={css.editorSectionTitle}>{t('official.devices')}</h3>
              <Button size="sm" variant="outline" disabled={checkingTargets}
                onClick={() => { void refreshTargets() }}>{t('official.refreshTargets')}</Button>
              {!addingDevice && <Button size="sm" variant="outline" className={css.deviceHeaderAction} disabled={busy || !writable}
                onClick={() => { setAddingDevice(true) }}>{t('official.addDevice')}</Button>}
            </div>
            {savedDevices.length === 0
              ? (!addingDevice && <p className={css.muted}>{t('official.noDevices')}</p>)
              : <ul className={css.deviceList}>{savedDevices.map((address: string) => <li key={address}>
                <label className={css.deviceRow}>
                  <input type="radio" name={`${id}-device`} checked={device.endpoint === address} disabled={busy || !writable}
                    onChange={() => { void chooseDevice(address) }} />
                  <code className={css.deviceAddress}>{address}</code>
                  <span className={css.muted}>{t(inventory === undefined ? 'official.targetsUnchecked'
                    : inventory.error !== null ? 'official.targetsFailed'
                      : inventory.connections.some(connection => connection.online && sameEndpoint(connection.endpoint, address))
                        ? 'official.serviceOnline' : 'official.serviceOffline')}</span>
                </label>
                <Button size="sm" variant="ghost" disabled={busy || !writable} onClick={() => { void removeDevice(address) }}>{t('official.removeDevice')}</Button>
              </li>)}</ul>}
            {inventory && <div className={css.muted} role="status">
              {inventory.error !== null ? t('official.targetsFailed') : <>
                {t('official.onlineTargets', { count: String(inventory.targets.filter(target => target.online).length) })}
                <ul>{inventory.targets.filter(target => target.online).map(target => <li key={`${target.endpoint}:${target.id}`}>
                  {target.name} · <code>{target.id}</code>{target.pid == null ? '' : ` · PID ${String(target.pid)}`}
                </li>)}</ul>
              </>}
              <small>{t('official.observedAt', { time: new Date(inventory.checkedAt).toLocaleTimeString() })}</small>
            </div>}
            {addingDevice && <div className={css.deviceAdd}>
              <input value={draft} disabled={busy || !writable} placeholder={t('official.endpointPlaceholder')} autoFocus
                onChange={(event) => { setDraft(event.target.value) }}
                onKeyDown={(event) => { if (event.key === 'Enter') void addDevice() }} />
              <Button size="sm" variant="outline" disabled={busy || !writable || draft.trim() === ''} onClick={() => { void addDevice() }}>{t('official.addDevice')}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setAddingDevice(false); setDraft('') }}>{t('cancel')}</Button>
            </div>}
          </section>}
        </>}
      </>}
      {error && <p className={css.error} role="alert">{t(error)}</p>}
    </div>
  </Modal>
}
