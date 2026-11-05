/** Official components expose verified installations separately from transport and target facts. */
import { useEffect, useRef, useState } from 'react'
import { Button, IconCordisPluginOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComponentId, ComponentView, OfficialConfiguration } from '@deepseek-ai/dsh-decrypthub-components/types'
import type { McpProbeResult } from '@deepseek-ai/dsh-mcp-client/types'
import type { ComponentsSource, ComponentsState } from './components-source.ts'
import type { McpSource } from './source.ts'
import css from './Page.module.css'

/** Shared actions used by the settings and standalone entries. */
export interface ComponentsPageInjected {
  hooks: { components: HostObservable<ComponentsState> }
  source: ComponentsSource
  mcp: McpSource
}
/** Locale and observation capabilities are supplied by the slot owner. */
export type ComponentsPageProps = PropsLocale<'settings.mcp'> & InjectFace<ComponentsPageInjected>
type Confirmation = { kind: 'install' | 'rollback'; component: ComponentView } | { kind: 'browser' }
const pending = (component: ComponentView): boolean => component.operation !== null && ['checking', 'downloading', 'verifying', 'installing'].includes(component.operation.phase)

/** Sidebar entry uses the existing plugin glyph.
 * @returns the official components navigation icon.
 */
export function ComponentsIcon() { return <IconCordisPluginOutlineRegular /> }

/** Render the product component manager from retained observations.
 * @param props - component source and localized copy.
 * @returns installation cards and explicit connection editors.
 */
export function ComponentsPage({ useComponents, source, mcp, t }: ComponentsPageProps) {
  const state = useComponents(value => value)
  const [error, setError] = useState(false)
  const [editor, setEditor] = useState<{ id: ComponentId; config: OfficialConfiguration }>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const [accepted, setAccepted] = useState(false)
  const [probe, setProbe] = useState<{ name: string; result?: McpProbeResult; failed?: boolean }>()
  const sequence = useRef(0)
  useEffect(() => { source.load(); return () => { sequence.current++; mcp.cancelProbe() } }, [source, mcp])
  const action = async (operation: () => Promise<void>): Promise<void> => {
    setError(false)
    try { await operation() } catch (_error) { setError(true) }
  }
  const value = state.value
  const config = value?.configuration
  const installing = value?.components.some(pending) ?? false
  const disabled = state.busy || installing
  return <section className={css.official}>
    <header className={css.header}><div><h2>{t('official.title')}</h2><p>{t('official.intro')}</p></div>
      <div className={css.actions}><Button disabled={disabled} onClick={() => { void action(() => source.run(ops => ops.checkUpdates())) }}>{t('official.check')}</Button>
        <Button disabled={state.busy} onClick={() => { source.reset() }}>{t('refresh')}</Button></div>
    </header>
    {(error || state.failed) && <p role="alert" className={css.error}>{t(state.failed ? 'official.failed' : 'official.actionFailed')}</p>}
    {state.connectionFailed && <p role="alert">{t('official.connectionFailed')}</p>}
    {!value ? <p role="status">{t('loading')}</p> : <>
      {!config && <p role="alert">{t('official.configurationMissing')}</p>}
      <div className={css.list}>{value.components.map((component) => {
        const id = component.id
        const enabled = config?.[id].enabled ?? false
        const connection = state.connections.find(row => row.name === id)
        const status = connection?.status.state ?? 'unknown'
        return <article key={id} className={css.card}>
          <div className={css.cardHeader}><strong className={css.componentName}>{id.toUpperCase()}</strong><span>{t(`official.${id}`)}</span>
            <span className={css.status}>{t(enabled ? 'official.enabled' : 'official.disabled')}</span></div>
          <p className={css.muted}>{t(`official.${id}Description`)}</p>
          <dl className={css.facts}>
            <dt>{t('official.installed')}</dt><dd>{component.localError ? t('official.unavailable') : component.installed
              ? <>{component.installed.version} · {t(component.installed.source === 'bundled' ? 'official.bundled' : 'official.managed')}</>
              : component.localCommand ? <>{t('official.local')}<code>{component.localCommand}</code></> : t('official.missing')}</dd>
            {component.latestVersion && <><dt>{t('official.latest')}</dt><dd>{component.latestVersion}</dd></>}
            <dt>{t('official.connection')}</dt><dd>{!enabled ? t('state.disabled') : id === 'wdh' ? value.wdh.length
              ? <ul className={css.connections}>{value.wdh.map(row => <li key={row.agentId}><span className={css.status} data-state={row.status.state}>{t(`state.${row.status.state}`)}</span><code>{row.workspace}</code></li>)}</ul>
              : t('official.waiting') : <span className={css.status} data-state={status}>{t(`state.${status}`)}</span>}</dd>
            {id === 'wdh' ? <><dt>{t('official.browser')}</dt><dd>{config && t(`official.browser.${config.wdh.browser}`)} · {t(`official.kernel.${value.browser.state}`)} {value.browser.version}</dd></>
              : <><dt>{t('official.target')}</dt><dd>{t('official.targetUnknown')}</dd></>}
          </dl>
          {component.catalogError && <p role="alert" className={css.muted}>{t('official.catalogFailed')}</p>}
          {component.operation && <div className={css.operation} role="status">
            <span>{t(`official.progress.${component.operation.phase}`)}</span>
            {component.operation.total > 0 && <progress aria-label={t(`official.progress.${component.operation.phase}`)} max={component.operation.total} value={component.operation.received} />}
            {pending(component) && <Button size="sm" disabled={state.busy} onClick={() => { void action(() => source.run(ops => ops.cancel(id))) }}>{t('cancel')}</Button>}
          </div>}
          <div className={css.actions}>
            <Button variant="outline" size="sm" disabled={disabled || !config?.writable} onClick={() => { if (config) setEditor({ id, config }) }}>{t('official.configure')}</Button>
            <Button size="sm" disabled={disabled || !enabled} onClick={() => { void action(() => source.run(ops => ops.reconnect(id))) }}>{t('official.reconnect')}</Button>
            {id !== 'wdh' && <Button size="sm" disabled={disabled || !enabled || !connection} onClick={() => {
              const ticket = ++sequence.current
              setProbe({ name: id })
              void mcp.probe(id).then((result) => { if (sequence.current === ticket) setProbe({ name: id, result }) },
                () => { if (sequence.current === ticket) setProbe({ name: id, failed: true }) })
            }}>{t('tools')}</Button>}
            {component.latestVersion && component.latestVersion !== component.installed?.version && <Button variant="primary" size="sm" disabled={disabled} onClick={() => { setConfirmation({ kind: 'install', component }) }}>{t(component.installed ? 'official.update' : 'official.install')}</Button>}
            {component.previousVersion && <Button size="sm" disabled={disabled} onClick={() => { setConfirmation({ kind: 'rollback', component }) }}>{t('official.rollback')} · {component.previousVersion}</Button>}
            {id === 'wdh' && <><Button size="sm" disabled={disabled || !component.installed} onClick={() => { void action(() => source.run(ops => ops.inspectBrowser())) }}>{t('official.inspect')}</Button>
              {config?.wdh.browser === 'cloak' && value.browser.state !== 'found' && <Button size="sm" disabled={disabled || !component.installed} onClick={() => { setAccepted(false); setConfirmation({ kind: 'browser' }) }}>{t('official.downloadBrowser')}</Button>}</>}
          </div>
        </article>
      })}</div>
      <p className={css.muted}>{t('official.versionHint')}</p>
    </>}
    {editor && <ConnectionEditor id={editor.id} initial={editor.config} busy={state.busy} t={t} close={() => { setEditor(undefined) }}
      save={async (next) => { await source.run(ops => ops.configure(editor.id, next)); setEditor(undefined) }} />}
    <Modal className={css.dialog ?? ''} open={confirmation !== undefined} title={t(confirmation?.kind === 'browser' ? 'official.licenseTitle' : confirmation?.kind === 'rollback' ? 'official.rollbackTitle' : 'official.installTitle')}
      closeLabel={t('close')} onClose={() => { if (!state.busy) setConfirmation(undefined) }} footer={<>
        <Button disabled={state.busy} onClick={() => { setConfirmation(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={state.busy || (confirmation?.kind === 'browser' && !accepted)} onClick={() => { if (confirmation) void action(async () => {
          const choice = confirmation
          await source.run(ops => choice.kind === 'browser' ? ops.installBrowser(accepted) : choice.kind === 'rollback'
            ? ops.rollback(choice.component.id) : ops.install(choice.component.id, choice.component.latestVersion ?? ''))
          setConfirmation(undefined)
        }) }}>{t(confirmation?.kind === 'rollback' ? 'official.rollback' : 'official.install')}</Button>
      </>}>
      {confirmation?.kind === 'browser' ? <div className={css.form}><p>{t('official.licenseHint')}</p>
        <a href="https://github.com/CloakHQ/cloakbrowser/blob/main/BINARY-LICENSE.md" target="_blank" rel="noreferrer">{t('official.license')}</a>
        <label className={css.checkbox}><input type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked) }} />{t('official.acceptLicense')}</label></div>
        : <><p>{t(confirmation?.kind === 'rollback' ? 'official.rollbackHint' : 'official.installHint')}</p><p>{confirmation?.component.id.toUpperCase()} · {confirmation?.kind === 'rollback' ? confirmation.component.previousVersion : confirmation?.component.latestVersion}</p></>}
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

function ConnectionEditor({ id, initial, busy, t, close, save }: { id: ComponentId; initial: OfficialConfiguration; busy: boolean; t: ComponentsPageProps['t']; close(this: void): void; save(this: void, next: OfficialConfiguration): Promise<void> }) {
  const [next, setNext] = useState(initial)
  const [args, setArgs] = useState(JSON.stringify(id === 'wdh' ? [] : initial[id].args))
  const [error, setError] = useState<'official.invalid' | 'saveError'>()
  const device = id === 'wdh' ? null : next[id]
  const submit = async (): Promise<void> => {
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
    try { await save(config) } catch (_error) { setError('saveError') }
  }
  return <Modal className={css.dialog ?? ''} open title={`${id.toUpperCase()} · ${t('official.configure')}`} closeLabel={t('close')} onClose={() => { if (!busy) close() }}
    footer={<><Button disabled={busy} onClick={close}>{t('cancel')}</Button><Button variant="primary" disabled={busy} onClick={() => { void submit() }}>{t('save')}</Button></>}>
    <div className={css.form}><p className={css.muted}>{t('official.configHint')}</p>
      <label className={css.checkbox}><input type="checkbox" checked={next[id].enabled} disabled={busy} onChange={(event) => { setNext({ ...next, [id]: { ...next[id], enabled: event.target.checked } }) }} />{t('official.enabled')}</label>
      {id === 'wdh' ? <label>{t('official.browser')}<select value={next.wdh.browser} disabled={busy} onChange={(event) => { setNext({ ...next, wdh: { ...next.wdh, browser: event.target.value === 'system' ? 'system' : 'cloak' } }) }}>
        <option value="system">{t('official.browser.system')}</option><option value="cloak">{t('official.browser.cloak')}</option></select></label>
        : device && <><label>{t('official.endpoint')}<input value={device.endpoint} disabled={busy} placeholder={t('official.endpointPlaceholder')} onChange={(event) => { setNext({ ...next, [id]: { ...device, endpoint: event.target.value } }) }} /></label>
          <p className={css.muted}>{t('official.endpointHint')}</p>
          <details><summary>{t('advanced')}</summary><label>{t('command')}<input value={device.command} disabled={busy} onChange={(event) => { setNext({ ...next, [id]: { ...device, command: event.target.value } }) }} /></label>
            <label>{t('args')}<textarea value={args} disabled={busy} rows={3} onChange={(event) => { setArgs(event.target.value) }} /></label></details></>}
      {error && <p className={css.error} role="alert">{t(error)}</p>}
    </div>
  </Modal>
}
