/** Role definition settings section: edit the text injected as the product persona. */
import { useEffect, useState } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { PersonaSnapshot, PersonaSource } from './persona-source.ts'

/** The section's observation and explicit save action. */
export interface PersonaPageInjected {
  hooks: { persona: HostObservable<PersonaSnapshot> }
  source: PersonaSource
}

/** Role surface; used by both the settings section and the main panel. */
export interface PersonaPageProps {
  /** Framework-bound snapshot hook for the role store. */
  usePersona: <T>(selector: (value: PersonaSnapshot) => T) => T
  /** Page operations. */
  source: PersonaSource
  /** Localized copy. */
  t: (key: keyof typeof import('./locales.ts').personaEn) => string
}

/**
 * Render the role section.
 * @param props - localized copy and role operations.
 * @returns the section element.
 */
export function PersonaPage({ usePersona, source, t }: PersonaPageProps) {
  const snapshot = usePersona(value => value)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void source.load() }, [source])
  useEffect(() => { setDraft(snapshot.persona) }, [snapshot.persona])
  const dirty = draft !== snapshot.persona
  return <section>
    <header>
      <h2>{t('title')}</h2>
      <p>{t('intro')}</p>
    </header>
    {snapshot.failed && <p>{t('failed')}</p>}
    {error === '' ? null : <p role="alert">{error}</p>}
    {!snapshot.loaded && <p>{t('pending')}</p>}
    <textarea
      value={draft}
      rows={8}
      placeholder={t('placeholder')}
      onChange={(event) => { setDraft(event.target.value) }}
    />
    <div>
      <button type="button" disabled={busy || !dirty} onClick={() => {
        setBusy(true)
        setError('')
        void source.save(draft)
          .catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) })
          .finally(() => { setBusy(false) })
      }}>{t('save')}</button>
      <button type="button" disabled={busy || !dirty} onClick={() => { setDraft(snapshot.persona) }}>{t('revert')}</button>
    </div>
  </section>
}
