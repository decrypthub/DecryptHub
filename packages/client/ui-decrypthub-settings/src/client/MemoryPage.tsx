import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
/** Product memory settings section: list, add, and remove stored entries. */
import { useEffect, useState } from 'react'
import type { MemorySnapshot, MemorySource } from './source.ts'

/** The section's observation and explicit management actions. */
export interface MemoryPageInjected {
  hooks: { memory: HostObservable<MemorySnapshot> }
  source: MemorySource
}

/** Memory entry surface; used by both the settings section and the main panel. */
export interface MemoryPageProps {
  /** Framework-bound snapshot hook for the memory store. */
  useMemory: <T>(selector: (value: MemorySnapshot) => T) => T
  /** Page operations. */
  source: MemorySource
  /** Localized copy. */
  t: (key: keyof typeof import('./locales.ts').en) => string
}

/**
 * Render the memory section.
 * @param props - localized copy and memory operations.
 * @returns the section element.
 */
export function MemoryPage({ useMemory, source, t }: MemoryPageProps) {
  const snapshot = useMemory(value => value)
  const [text, setText] = useState('')
  const [scope, setScope] = useState('user')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void source.load() }, [source])
  const entries = Object.entries(snapshot.entries)

  /**
   * Run one mutation and restore the form when it succeeds.
   * @param operation - mutation to run.
   * @returns after the mutation settles.
   */
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try { await operation() } finally { setBusy(false) }
  }

  return <section>
    <header>
      <h2>{t('title')}</h2>
      <p>{t('intro')}</p>
    </header>
    {snapshot.failed && <p>{t('failed')}</p>}
    {!snapshot.loaded && <p>{t('pending')}</p>}
    {snapshot.loaded && entries.length === 0 && <p>{t('empty')}</p>}
    <ul>
      {entries.map(([id, entry]) => <li key={id}>
        <span>{entry.text}</span>
        {' '}
        <em>{entry.scope === 'project' ? t('scopeProject') : t('scopeUser')}</em>
        {' '}
        <button type="button" disabled={busy} onClick={() => { void run(() => source.remove(id)) }}>{t('remove')}</button>
      </li>)}
    </ul>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (text.trim() === '') return
      void run(async () => {
        await source.put(text.trim(), scope)
        setText('')
      })
    }}>
      <input
        value={text}
        placeholder={t('placeholder')}
        onChange={(event) => { setText(event.target.value) }}
      />
      <select value={scope} onChange={(event) => { setScope(event.target.value) }}>
        <option value="user">{t('scopeUser')}</option>
        <option value="project">{t('scopeProject')}</option>
      </select>
      <button type="submit" disabled={busy || text.trim() === ''}>{t('add')}</button>
    </form>
  </section>
}
