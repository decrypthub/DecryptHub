/** Product memory catalog: search, scope filters, detail editing, and dual creation paths. */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular,
  IconLayersOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular,
  Input, Menu, MenuItemButton, Modal, ReferenceIconRegular, relativeTime, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryEntryView, MemorySnapshot, MemorySource } from './source.ts'
import css from './Page.module.css'

/** Observation, settings writes, and the optional session handoff for agent-authored memories. */
export interface MemoryPageInjected {
  hooks: { memory: HostObservable<MemorySnapshot> }
  source: MemorySource
  /**
   * Start a session so the model can write a memory through its tools.
   * Omitted in settings-only fixtures that only exercise the manual path.
   */
  onAskAgent?: () => void
}

type MemoryPageFace = PropsLocale<'settings.memory'> & InjectFace<MemoryPageInjected>

/** Settings-section props, derived from the slot and its injected data. */
export type MemoryPageProps = PropsRuntime<'settings.section'> & MemoryPageFace
/** Main-panel props, derived from the slot and its injected data. */
export type MemoryMainPageProps = PropsRuntime<'main'> & MemoryPageFace

type ScopeFilter = 'all' | 'user' | 'project'

interface MemoryRow {
  id: string
  entry: MemoryEntryView
}

/**
 * Render the memory section inside the settings panel.
 * @param props - localized copy and memory operations.
 * @returns the section element.
 */
export function MemoryPage(props: MemoryPageProps) {
  return <div className={css.embedded}><MemoryContent {...props} /></div>
}

/**
 * Render the memory surface in the main panel.
 * @param props - main-panel slot properties and memory operations.
 * @returns the full-height main-panel surface.
 */
export function MemoryMainPage(props: MemoryMainPageProps) {
  return <div className={css.shell}><MemoryContent {...props} /></div>
}

type MemoryContentProps = MemoryPageFace & {
  /** Open the product role dialog from the memory header. */
  onSetPersona?: () => void
}

/**
 * Shared catalog: filters, search, list, and a detail pane for create or edit.
 * Reused by the fused memory/role host.
 * @param props - locale, snapshot hook, source, optional agent handoff, and role entry.
 * @returns the catalog layout.
 */
export function MemoryContent({ useMemory, source, onAskAgent, onSetPersona, t }: MemoryContentProps) {
  const snapshot = useMemory(value => value)
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftScope, setDraftScope] = useState('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const detailRef = useRef<HTMLElement>(null)

  useEffect(() => { void source.load() }, [source])
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [])

  const rows = useMemo((): MemoryRow[] => {
    const query = search.trim().toLowerCase()
    return Object.entries(snapshot.entries)
      .filter(([, entry]) => (scopeFilter === 'all' || entry.scope === scopeFilter)
        && (query === '' || entry.text.toLowerCase().includes(query) || entry.scope.toLowerCase().includes(query)))
      .map(([id, entry]) => ({ id, entry }))
      .toSorted((left, right) => {
        const leftAt = Date.parse(left.entry.updatedAt ?? left.entry.createdAt ?? '') || 0
        const rightAt = Date.parse(right.entry.updatedAt ?? right.entry.createdAt ?? '') || 0
        return rightAt - leftAt
      })
  }, [snapshot.entries, search, scopeFilter])

  const selected = selectedId === null ? undefined : snapshot.entries[selectedId]
  const detailOpen = creating || selected !== undefined
  const emptyTitle = search.trim() !== '' ? 'list.noMatches'
    : scopeFilter === 'user' ? 'list.emptyUser'
      : scopeFilter === 'project' ? 'list.emptyProject'
        : 'list.empty'

  useEffect(() => {
    if (!snapshot.loaded || snapshot.failed) return
    if (selectedId !== null && snapshot.entries[selectedId] === undefined) setSelectedId(null)
  }, [snapshot.loaded, snapshot.failed, snapshot.entries, selectedId])

  useEffect(() => {
    if (detailOpen || deleteConfirm) return
    if (rowRef.current !== null) {
      const target = rowRef.current.isConnected ? rowRef.current : headingRef.current
      target?.focus()
      rowRef.current = null
    }
  }, [detailOpen, deleteConfirm])

  useEffect(() => {
    if (!creating && selected === undefined) return
    detailRef.current?.focus()
  }, [creating, selectedId])

  const formatRelative = (iso: string | undefined): string => {
    if (iso === undefined) return ''
    const at = Date.parse(iso)
    if (!Number.isFinite(at)) return ''
    const bucket = relativeTime(at, now)
    if (bucket.unit === 'now') return t('time.now')
    return t(`time.${bucket.unit}`, { n: bucket.n })
  }

  const closeDetails = (): void => {
    setSelectedId(null)
    setCreating(false)
    setDraftText('')
    setDraftScope('user')
    setError('')
    setDeleteConfirm(false)
  }

  const openCreate = (trigger: HTMLButtonElement | null): void => {
    rowRef.current = trigger
    setSelectedId(null)
    setCreating(true)
    setDraftText('')
    // A new entry has no workspace to bind a project scope to; the agent writes
    // workspace memories inside a conversation.
    setDraftScope('user')
    setError('')
  }

  const openRow = (id: string, trigger: HTMLButtonElement): void => {
    rowRef.current = trigger
    const entry = snapshot.entries[id]
    if (entry === undefined) return
    setCreating(false)
    setSelectedId(id)
    setDraftText(entry.text)
    setDraftScope(entry.scope)
    setError('')
  }

  const askAgent = (): void => {
    onAskAgent?.()
  }

  const save = async (): Promise<void> => {
    const text = draftText.trim()
    if (!snapshot.loaded || snapshot.failed || busy || text === '') return
    setBusy(true)
    setError('')
    try {
      const id = creating ? undefined : selectedId ?? undefined
      const scope = creating && draftScope === 'project' ? 'user' : draftScope
      await source.put(text, scope, id)
      if (creating) {
        setSearch('')
        setScopeFilter('all')
        // After create, select the newest matching text; load() refreshes ids.
        const next = Object.entries(source.store.getSnapshot().entries)
          .find(([, entry]) => entry.text === text && entry.scope === scope)
        setCreating(false)
        setSelectedId(next?.[0] ?? null)
        if (next !== undefined) {
          setDraftText(next[1].text)
          setDraftScope(next[1].scope)
        }
      }
    } catch {
      setError(t('detail.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (selectedId === null || busy) return
    setBusy(true)
    setError('')
    try {
      await source.remove(selectedId)
      setDeleteConfirm(false)
      closeDetails()
    } catch {
      setError(t('detail.deleteError'))
      setDeleteConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={clsx(css.page, detailOpen && css.hasDetails)}
      aria-label={t('title')}
      data-testid="memory-manager-page"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || deleteConfirm || !detailOpen) return
        event.preventDefault()
        event.stopPropagation()
        closeDetails()
      }}
    >
      <div className={css.listPane}>
        <div className={css.pageScroll}>
          <div className={css.pageContent}>
            <div className={css.pageHeading}>
              <h1 ref={headingRef} tabIndex={-1}>{t('title')}</h1>
              <div className={css.creationActions}>
                <span className={css.createGroup} role="group" aria-label={t('host.create')}>
                  <Button
                    variant="primary"
                    size="sm"
                    className={clsx(css.headerAction, onAskAgent !== undefined && css.createPrimary)}
                    icon={<IconPlusOutlineRegular size={13} />}
                    onClick={() => {
                      if (onAskAgent !== undefined) askAgent()
                      else openCreate(null)
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
                      ref={createTriggerRef}
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
                      onSelect={() => { setCreateMenuOpen(false); askAgent() }}
                    >{t('host.chatCreate')}</MenuItemButton>
                    <MenuItemButton
                      icon={<IconEditOutlineRegular size={14} />}
                      onSelect={() => { setCreateMenuOpen(false); openCreate(createTriggerRef.current) }}
                    >{t('host.manualCreate')}</MenuItemButton>
                  </Menu>}
                </span>
                {onSetPersona !== undefined && <Button
                  size="sm"
                  className={css.headerAction}
                  icon={<IconEditOutlineRegular size={13} />}
                  onClick={onSetPersona}
                >{t('host.setPersona')}</Button>}
              </div>
            </div>
            <p className={css.intro}>{t('intro')}</p>
            <div className={css.filters}>
              <div className={css.filterTabs} role="group" aria-label={t('scopeFilter.label')}>
                {(['all', 'user', 'project'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    className={clsx(css.filterTab, scopeFilter === value && css.filterTabActive)}
                    aria-pressed={scopeFilter === value}
                    onClick={() => { setScopeFilter(value) }}
                  >
                    {t(value === 'all' ? 'scopeFilter.all' : `scope.${value}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.searchTools}>
              <div className={css.searchField}>
                <Input
                  type="search"
                  icon={<IconSearchOutlineRegular />}
                  aria-label={t('search.label')}
                  placeholder={t('search.placeholder')}
                  value={search}
                  onChange={(event) => { setSearch(event.target.value) }}
                />
                {search !== '' && <Button size="sm" className={css.searchClear} aria-label={t('search.clear')} onClick={() => { setSearch('') }}>
                  <IconCloseOutlineRegular />
                </Button>}
              </div>
            </div>
            <div className={css.list}>
              {!snapshot.loaded && <div className={css.empty} role="status" aria-label={t('list.loading')}>
                <StateDot state="ongoing" />
              </div>}
              {snapshot.loaded && snapshot.failed && <div className={css.empty}>
                <p role="alert" className={css.error}>{t('list.error')}</p>
                <Button variant="outline" className={css.emptyAction} onClick={() => { void source.load() }}>{t('list.retry')}</Button>
              </div>}
              {snapshot.loaded && !snapshot.failed && rows.length === 0 && <div className={css.empty} role="status">
                <IconLayersOutlineRegular size={24} className={css.emptyGlyph} />
                <h2>{t(emptyTitle)}</h2>
                {onAskAgent === undefined && <Button variant="outline" className={css.emptyAction} onClick={(event) => { openCreate(event.currentTarget) }}>
                  {t('empty.action')}
                </Button>}
              </div>}
              <ul className={css.listRows} aria-label={t('list.label')} aria-busy={!snapshot.loaded}>
                {snapshot.loaded && !snapshot.failed && rows.map(({ id, entry }) => {
                  const updated = formatRelative(entry.updatedAt ?? entry.createdAt)
                  return (
                    <li key={id}>
                      <Button
                        className={clsx(css.row, selectedId === id && css.selectedRow)}
                        aria-label={entry.text}
                        aria-expanded={selectedId === id}
                        onClick={(event) => { openRow(id, event.currentTarget) }}
                      >
                        <IconLayersOutlineRegular className={css.rowGlyph} />
                        <span className={css.rowContent}>
                          <span className={css.rowTitle}>{entry.text}</span>
                          <span className={css.rowSummary}>
                            <span className={css.metadata}>{t(entry.scope === 'project' ? 'scope.project' : 'scope.user')}</span>
                            {updated !== '' && <span className={css.metadata}>{t('list.updated', { time: updated })}</span>}
                          </span>
                        </span>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {detailOpen && <aside
        ref={detailRef}
        className={css.detail}
        tabIndex={-1}
        aria-label={t(creating ? 'host.manualCreate' : 'detail.label')}
      >
        <div className={css.detailTabsBar}>
          <h2 className={css.createTitle}>{t(creating ? 'detail.newTitle' : 'detail.label')}</h2>
          <div className={css.detailActions}>
            {!creating && <Button
              size="sm"
              className={css.detailIconButton}
              aria-label={t('detail.delete')}
              disabled={busy || snapshot.failed}
              onClick={() => { setDeleteConfirm(true) }}
            >
              <IconTrashOutlineRegular />
            </Button>}
            <Button
              size="sm"
              className={css.detailIconButton}
              aria-label={t(creating ? 'host.closeCreate' : 'detail.close')}
              onClick={closeDetails}
            >
              <IconCloseOutlineRegular />
            </Button>
          </div>
        </div>
        <div className={css.detailScroll}>
          {!creating && (selected?.updatedAt !== undefined || selected?.createdAt !== undefined) && <p className={css.detailMeta}>
            {selected.updatedAt !== undefined
              ? t('list.updated', { time: formatRelative(selected.updatedAt) })
              : t('detail.created', { time: formatRelative(selected.createdAt) })}
          </p>}
          <label className={css.editorField}>
            <span>{t('detail.textLabel')}</span>
            <textarea
              className={css.instruction}
              value={draftText}
              placeholder={t('detail.placeholder')}
              disabled={!snapshot.loaded || snapshot.failed || busy}
              onChange={(event) => { setDraftText(event.target.value) }}
            />
          </label>
          <label className={css.editorField}>
            <span>{t('detail.scopeLabel')}</span>
            <select
              className={css.scopeSelect}
              value={draftScope}
              disabled={!snapshot.loaded || snapshot.failed || busy}
              onChange={(event) => { setDraftScope(event.target.value) }}
            >
              <option value="user">{t('scope.user')}</option>
              <option value="project" disabled={creating} title={creating ? t('scope.projectCreateHint') : undefined}>{t('scope.project')}</option>
            </select>
          </label>
        </div>
        <div className={css.saveFooter}>
          {error !== '' && <p role="alert" className={css.saveFailure}>{error}</p>}
          <Button variant="outline" disabled={busy} onClick={closeDetails}>{t('detail.close')}</Button>
          <Button
            variant="primary"
            disabled={!snapshot.loaded || snapshot.failed || busy || draftText.trim() === ''}
            onClick={() => { void save() }}
          >{t(busy ? 'detail.saving' : 'detail.save')}</Button>
        </div>
      </aside>}
      <Modal
        className={css.confirmDialog as string}
        open={deleteConfirm}
        title={t('detail.deleteConfirmTitle')}
        closeLabel={t('detail.deleteCancel')}
        onClose={() => { if (!busy) setDeleteConfirm(false) }}
        footer={<div className={css.confirmActions}>
          <Button variant="outline" disabled={busy} onClick={() => { setDeleteConfirm(false) }}>
            {t('detail.deleteCancel')}
          </Button>
          <Button
            variant="outline"
            className={css.deleteButton}
            aria-disabled={busy}
            onClick={() => { void remove() }}
          >
            {t(busy ? 'detail.deletePending' : 'detail.deleteConfirm')}
          </Button>
        </div>}
      />
    </section>
  )
}
