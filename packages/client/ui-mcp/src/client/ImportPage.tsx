/** Choose Harness data to copy into this product home, then show progress and the result. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Page.module.css'

/** One category the preview returned. */
export interface ImportItem {
  readonly id: 'sessions'
  readonly count: number
  readonly seconds: number
  readonly detail: string
}

/** Outcome of one copied category. */
export interface ImportResult {
  readonly id: ImportItem['id']
  readonly status: 'imported' | 'skipped' | 'empty'
  readonly detail: string
}

/** Host calls for the import page. */
export interface HarnessImportActions {
  preview(source: string): Promise<{ source: string; items: readonly ImportItem[] }>
  run(source: string, kinds: readonly ImportItem['id'][]): Promise<{ results: readonly ImportResult[] }>
}

type Phase = 'choose' | 'run' | 'done'

/**
 * Settings section for a one-shot Harness import.
 * @param props - localized copy and host actions.
 * @returns the chooser, progress, or result.
 */
export function ImportPage({ t, actions }: PropsRuntime<'settings.section'> & PropsLocale<'settings.mcp'> & { actions: HarnessImportActions }) {
  const [source, setSource] = useState('')
  const [items, setItems] = useState<readonly ImportItem[]>()
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<Phase>('choose')
  const [cursor, setCursor] = useState(0)
  const [results, setResults] = useState<readonly ImportResult[]>([])
  const [error, setError] = useState('')
  // The Host decides whether tasks can follow imported conversations, so every
  // selected category travels in one request and no local lock models that rule.
  const selected = (items ?? []).filter(item => picked[item.id])
  const total = selected.reduce((sum, item) => sum + item.seconds, 0)
  const done = selected.slice(0, cursor).reduce((sum, item) => sum + item.seconds, 0)
  const current = selected[Math.min(cursor, selected.length - 1)]
  const load = async (): Promise<void> => {
    setError('')
    try {
      const preview = await actions.preview(source)
      setSource(preview.source)
      setItems(preview.items)
      setPicked(Object.fromEntries(preview.items.map(item => [item.id, item.count > 0])))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('import.failed'))
    }
  }
  const start = async (): Promise<void> => {
    if (selected.length === 0) return
    setPhase('run')
    setCursor(0)
    setError('')
    try {
      // One call carries every selected category: the Host needs the whole
      // selection to decide whether tasks may follow their conversations.
      const outcome = await actions.run(source, selected.map(item => item.id))
      setResults(outcome.results)
      setCursor(selected.length)
      setPhase('done')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('import.failed'))
      setPhase('choose')
    }
  }
  return <section className={css.page} data-testid="harness-import-page">
    <header className={css.header}><div><h2>{t('import.title')}</h2><p>{t('import.intro')}</p></div></header>
    {error !== '' && <p role="alert" className={css.error}>{error}</p>}
    {phase === 'choose' && <>
      <label className={css.form}>{t('import.source')}
        <input value={source} placeholder={t('import.sourcePlaceholder')} onChange={(event) => { setSource(event.target.value); setItems(undefined) }} />
      </label>
      {items === undefined ? <Button variant="primary" onClick={() => { void load() }}>{t('import.scan')}</Button> : <>
        <ul className={css.pluginRows}>{items.map(item => (
          <li key={item.id} className={css.pluginItem}>
            <label className={`${css.pluginRowStatic} ${css.importRow}`}>
              <input type="checkbox" checked={Boolean(picked[item.id])} disabled={item.count === 0}
                onChange={(event) => { setPicked(current => ({ ...current, [item.id]: event.target.checked })) }} />
              <span className={css.pluginMain}>
                <span className={css.pluginName}>{t(`import.kind.${item.id}`)}</span>
                <span className={css.pluginDesc}>{item.detail}</span>
              </span>
              <span className={css.pluginEnd}>{formatDuration(item.seconds, t)}</span>
            </label>
          </li>
        ))}</ul>
        <div className={css.sectionHead}>
          <p className={css.muted}>{t('import.estimate', { time: formatDuration(total, t) })}</p>
          <Button variant="primary" disabled={selected.length === 0} onClick={() => { void start() }}>{t('import.run')}</Button>
        </div>
      </>}
    </>}
    {phase === 'run' && <div>
      <p>{t('import.running', { current: current === undefined ? '' : t(`import.kind.${current.id}`), done: String(cursor), total: String(selected.length) })}</p>
      <progress max={Math.max(total, 1)} value={done} />
      <p className={css.muted}>{t('import.remaining', { time: formatDuration(Math.max(0, total - done), t) })}</p>
    </div>}
    {phase === 'done' && <>
      <ul className={css.pluginRows}>{results.map(result => <li key={result.id} className={css.pluginItem}>
        <div className={`${css.pluginRowStatic} ${css.importRow}`}>
          <span className={css.pluginMain}>
            <span className={css.pluginName}>{t(`import.kind.${result.id}`)}</span>
            <span className={css.pluginDesc}>{result.detail}</span>
          </span>
          <span className={css.pluginEnd}>{t(`import.status.${result.status}`)}</span>
        </div>
      </li>)}</ul>
      <Button onClick={() => { setPhase('choose'); setItems(undefined) }}>{t('import.again')}</Button>
    </>}
  </section>
}

function formatDuration(seconds: number, t: PropsLocale<'settings.mcp'>['t']): string {
  const whole = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes === 0) return t('import.duration.seconds', { count: String(rest) })
  if (rest === 0) return t('import.duration.minutes', { count: String(minutes) })
  return t('import.duration.minutesSeconds', { minutes: String(minutes), seconds: String(rest) })
}
