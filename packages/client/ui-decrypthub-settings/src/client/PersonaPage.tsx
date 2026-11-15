/** Role definition page: session handoff or inline edit of the product persona. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconEditOutlineRegular,
  IconPlusOutlineRegular, Menu, MenuItemButton, Modal, ReferenceIconRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PersonaSnapshot, PersonaSource } from './persona-source.ts'
import css from './Page.module.css'

/** Observation, settings writes, and the optional session handoff for agent-authored roles. */
export interface PersonaPageInjected {
  hooks: { persona: HostObservable<PersonaSnapshot> }
  source: PersonaSource
  /**
   * Start a session so the model can refine the role definition.
   * Omitted in settings-only fixtures that only exercise the editor.
   */
  onAskAgent?: () => void
}

type PersonaPageFace = PropsLocale<'settings.persona'> & InjectFace<PersonaPageInjected>

/** Settings-section props, derived from the slot and its injected data. */
export type PersonaPageProps = PropsRuntime<'settings.section'> & PersonaPageFace
/** Main-panel props, derived from the slot and its injected data. */
export type PersonaMainPageProps = PropsRuntime<'main'> & PersonaPageFace

/**
 * Render the role section inside the settings panel.
 * @param props - localized copy and role operations.
 * @returns the section element.
 */
export function PersonaPage(props: PersonaPageProps) {
  return <div className={css.embedded}><PersonaContent {...props} /></div>
}

/**
 * Render the role surface in the main panel.
 * @param props - main-panel slot properties and role operations.
 * @returns the full-height main-panel surface.
 */
export function PersonaMainPage(props: PersonaMainPageProps) {
  return <div className={css.shell}><PersonaContent {...props} /></div>
}

/**
 * Edit the role in a dialog over the memory list.
 * @param props - dialog visibility, locale, and the persona source.
 * @returns the dialog, or nothing while it is closed.
 */
export function PersonaDialog({
  open, onClose, usePersona, source, t,
}: PersonaPageFace & { open: boolean; onClose: () => void }) {
  const snapshot = usePersona(value => value)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) void source.load() }, [open, source])
  useEffect(() => { setDraft(snapshot.persona) }, [snapshot.persona])

  const dirty = draft !== snapshot.persona
  const disabled = !snapshot.loaded || snapshot.failed || busy

  return <Modal
    open={open}
    onClose={onClose}
    title={t('title')}
    closeLabel={t('close')}
    description={t('intro')}
    footer={<>
      {error !== '' && <p role="alert" className={css.saveFailure}>{error}</p>}
      <Button
        variant="outline"
        disabled={disabled || !dirty}
        onClick={() => { setDraft(snapshot.persona); setError('') }}
      >{t('revert')}</Button>
      <Button
        variant="primary"
        disabled={disabled || !dirty}
        onClick={() => {
          setBusy(true)
          setError('')
          void source.save(draft)
            .then(() => { onClose() })
            .catch(() => { setError(t('saveError')) })
            .finally(() => { setBusy(false) })
        }}
      >{t(busy ? 'saving' : 'save')}</Button>
    </>}
  >
    {snapshot.failed && <div className={css.notice} role="alert">
      <p className={css.error}>{t('failed')}</p>
      <Button size="sm" variant="outline" onClick={() => { void source.load() }}>{t('retry')}</Button>
    </div>}
    {!snapshot.loaded && <div className={css.empty} role="status" aria-label={t('pending')}>
      <StateDot state="ongoing" />
    </div>}
    {snapshot.loaded && <>
      <label className={css.editorField}>
        <span>{t('label')}</span>
        <textarea
          className={clsx(css.instruction, css.personaInstruction)}
          value={draft}
          rows={8}
          placeholder={t('placeholder')}
          disabled={disabled}
          data-modal-autofocus
          onChange={(event) => { setDraft(event.target.value) }}
        />
      </label>
      <p className={css.personaHint}>{t('emptyHint')}</p>
    </>}
  </Modal>
}

type PersonaContentProps = PersonaPageFace & {
  /** Return to the memory catalog when this editor was opened from Set role. */
  onBack?: () => void
}

/**
 * Shared role editor with the automation-tasks page chrome.
 * Reused by the fused memory/role host.
 * @param props - locale, snapshot hook, source, optional agent handoff, and back action.
 * @returns the role layout.
 */
export function PersonaContent({ usePersona, source, onAskAgent, onBack, t }: PersonaContentProps) {
  const snapshot = usePersona(value => value)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { void source.load() }, [source])
  useEffect(() => { setDraft(snapshot.persona) }, [snapshot.persona])

  const dirty = draft !== snapshot.persona
  const focusEditor = (): void => {
    editorRef.current?.focus()
  }

  return (
    <section className={css.page} aria-label={t('title')} data-testid="persona-manager-page">
      <div className={css.listPane}>
        <div className={css.pageScroll}>
          <div className={css.personaBody}>
            <div className={css.pageHeading}>
              <div className={css.personaTitleRow}>
                {onBack !== undefined && <Button
                  size="sm"
                  className={css.headerAction}
                  icon={<IconChevronLeftOutlineRegular size={13} />}
                  aria-label={t('back')}
                  onClick={onBack}
                >{t('back')}</Button>}
                <h1 ref={headingRef} tabIndex={-1}>{t('title')}</h1>
              </div>
              {onBack === undefined && <div className={css.creationActions}>
                <span className={css.createGroup} role="group" aria-label={t('host.create')}>
                  <Button
                    variant="primary"
                    size="sm"
                    className={clsx(css.headerAction, onAskAgent !== undefined && css.createPrimary)}
                    icon={<IconPlusOutlineRegular size={13} />}
                    onClick={() => {
                      if (onAskAgent !== undefined) onAskAgent()
                      else focusEditor()
                    }}
                  >{t('host.create')}</Button>
                  {onAskAgent !== undefined && <Menu
                    open={createMenuOpen}
                    onClose={() => { setCreateMenuOpen(false) }}
                    align="end"
                    portal
                    autoFocus
                    listClassName={css.createMenu}
                    anchor={<Button
                      variant="primary"
                      size="sm"
                      className={css.createMore}
                      aria-label={t('host.createMethod')}
                      aria-haspopup="menu"
                      aria-expanded={createMenuOpen}
                      onClick={() => { setCreateMenuOpen(value => !value) }}
                    >
                      <IconChevronDownOutlineRegular size={12} />
                    </Button>}
                  >
                    <MenuItemButton
                      icon={<ReferenceIconRegular kind="session" size={14} />}
                      onSelect={() => { setCreateMenuOpen(false); onAskAgent() }}
                    >{t('host.chatCreate')}</MenuItemButton>
                    <MenuItemButton
                      icon={<IconEditOutlineRegular size={14} />}
                      onSelect={() => { setCreateMenuOpen(false); focusEditor() }}
                    >{t('host.manualEdit')}</MenuItemButton>
                  </Menu>}
                </span>
              </div>}
            </div>
            <p className={css.intro}>{t('intro')}</p>
            {snapshot.failed && <div className={css.notice} role="alert">
              <p className={css.error}>{t('failed')}</p>
              <Button size="sm" variant="outline" onClick={() => { void source.load() }}>{t('retry')}</Button>
            </div>}
            {!snapshot.loaded && <div className={css.empty} role="status" aria-label={t('pending')}>
              <StateDot state="ongoing" />
            </div>}
            {snapshot.loaded && <>
              <label className={css.editorField}>
                <span>{t('label')}</span>
                <textarea
                  ref={editorRef}
                  className={clsx(css.instruction, css.personaInstruction)}
                  value={draft}
                  rows={10}
                  placeholder={t('placeholder')}
                  disabled={!snapshot.loaded || snapshot.failed || busy}
                  onChange={(event) => { setDraft(event.target.value) }}
                />
              </label>
              <p className={css.personaHint}>{t('emptyHint')}</p>
              <div className={css.personaFooter}>
                {onBack !== undefined && onAskAgent !== undefined && <Button
                  size="sm"
                  className={css.personaAsk}
                  disabled={busy}
                  onClick={onAskAgent}
                >{t('host.chatCreate')}</Button>}
                {error !== '' && <p role="alert" className={css.saveFailure}>{error}</p>}
                <Button
                  variant="outline"
                  disabled={!snapshot.loaded || snapshot.failed || busy || !dirty}
                  onClick={() => { setDraft(snapshot.persona); setError('') }}
                >{t('revert')}</Button>
                <Button
                  variant="primary"
                  disabled={!snapshot.loaded || snapshot.failed || busy || !dirty}
                  onClick={() => {
                    setBusy(true)
                    setError('')
                    void source.save(draft)
                      .catch(() => { setError(t('saveError')) })
                      .finally(() => { setBusy(false) })
                  }}
                >{t(busy ? 'saving' : 'save')}</Button>
              </div>
            </>}
          </div>
        </div>
      </div>
    </section>
  )
}
