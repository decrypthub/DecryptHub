/** One product surface: title + MCP|Skills tabs; MCP stacks official above custom. */
import { useId, useState, useSyncExternalStore } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconDownloadOutlineRegular, IconEditOutlineRegular,
  IconPlusOutlineRegular, IconSkillOutlineRegular, Menu, MenuItemButton,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ComponentsPage } from './ComponentsPage.tsx'
import type { ComponentsPageInjected } from './ComponentsPage.tsx'
import { McpContent, type McpToolbarRequest } from './Page.tsx'
import type { McpPageInjected } from './Page.tsx'
import css from './Page.module.css'

type Tab = 'mcp' | 'skills'

/** Combined inject for the fused skills/MCP host. */
export interface SkillsMcpPageInjected {
  hooks: {
    components: ComponentsPageInjected['hooks']['components']
    mcp: McpPageInjected['hooks']['mcp']
  }
  components: Omit<ComponentsPageInjected, 'hooks'>
  mcpSource: McpPageInjected['source']
  /**
   * Open a session so the model can create, list, or delete skills.
   * Omitted in settings-only fixtures.
   */
  onManageSkills?: () => void
  /** Ask the agent to import an existing skill. Omitted in settings-only fixtures. */
  onImportSkills?: () => void
  /** Live skill catalog. Omitted in settings-only fixtures. */
  skillCatalog?: SkillCatalogSource
}

/** One skill row: name plus the routing description. */
export interface SkillRow {
  readonly name: string
  readonly description: string
}

/** Snapshot the skills tab renders. */
export interface SkillCatalog {
  readonly loaded: boolean
  readonly failed: boolean
  readonly rows: readonly SkillRow[]
  /** No conversation exists yet, so the page cannot resolve a workspace catalog. */
  readonly needsSession?: boolean
}

/** Store face the page reads without going through slot hooks. */
export interface SkillCatalogSource {
  subscribe(fn: () => void): () => void
  getSnapshot(): SkillCatalog
}

type CombinedFace = PropsLocale<'settings.mcp'> & InjectFace<SkillsMcpPageInjected>
/** Settings-section props for the fused skills/MCP page. */
export type SkillsMcpPageProps = PropsRuntime<'settings.section'> & CombinedFace
/** Main-panel props for the fused skills/MCP page. */
export type SkillsMcpMainPageProps = PropsRuntime<'main'> & CombinedFace

/**
 * Render Skills & MCP as one settings section.
 * @param props - localized product chrome and both inject faces.
 * @returns the tabbed settings surface.
 */
export function SkillsMcpPage(props: SkillsMcpPageProps) {
  return <SkillsMcpContent {...props} />
}

/**
 * Render Skills & MCP as one main panel.
 * @param props - main-panel slot properties and both inject faces.
 * @returns the scrollable tabbed surface.
 */
export function SkillsMcpMainPage(props: SkillsMcpMainPageProps) {
  return <div className={css.main}><SkillsMcpContent {...props} /></div>
}

/**
 * Product chrome: title, MCP|Skills pills, stacked MCP or skills body.
 * @param props - locale and both product sources.
 * @returns the product host.
 */
const EMPTY_SKILLS: SkillCatalog = { loaded: true, failed: false, rows: [] }
const emptySkills = (): SkillCatalog => EMPTY_SKILLS
const noopSubscribe = (): (() => void) => () => {}

function SkillsMcpContent({
  t, useComponents, useMcp, components, mcpSource, onManageSkills, onImportSkills, skillCatalog,
}: CombinedFace) {
  const [tab, setTab] = useState<Tab>('mcp')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mcpRequest, setMcpRequest] = useState<McpToolbarRequest>()
  const writable = useMcp(value => value.writable && !value.busy)
  const skills = useSyncExternalStore(
    skillCatalog?.subscribe ?? noopSubscribe,
    skillCatalog?.getSnapshot ?? emptySkills,
    () => EMPTY_SKILLS,
  )
  const id = useId()
  const mcpPanel = `${id}-mcp`
  const skillsPanel = `${id}-skills`
  return <div className={css.combined} data-testid="skills-mcp-page">
    <div className={css.pageHeading}>
      <h1>{t('product.nav')}</h1>
      <span className={css.addGroup} role="group" aria-label={tab === 'mcp' ? t('product.addMcp') : t('product.addSkill')}>
        <Button
          variant="primary"
          size="sm"
          className={css.addPrimary}
          icon={<IconPlusOutlineRegular size={13} />}
          disabled={tab === 'mcp' && !writable}
          aria-label={tab === 'mcp' ? t('product.addMcp') : t('product.addSkill')}
          onClick={() => {
            setMenuOpen(false)
            if (tab === 'mcp') setMcpRequest(current => ({ kind: 'add', id: (current?.id ?? 0) + 1 }))
            else onManageSkills?.()
          }}
        >{t('product.add')}</Button>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          align="end"
          portal
          autoFocus
          listClassName={css.addMenu}
          anchor={<Button
            variant="primary"
            size="sm"
            className={css.addMore}
            disabled={tab === 'mcp' && !writable}
            aria-label={t('product.addMethod')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <IconChevronDownOutlineRegular size={12} />
          </Button>}
        >
          {tab === 'mcp' ? <>
            <MenuItemButton icon={<IconEditOutlineRegular size={14} />} onSelect={() => {
              setMenuOpen(false)
              setMcpRequest(current => ({ kind: 'add', id: (current?.id ?? 0) + 1 }))
            }}>
              <span className={css.addMenuItem}><span>{t('product.addMcp')}</span><span className={css.addMenuHint}>{t('product.addMcpHint')}</span></span>
            </MenuItemButton>
            <MenuItemButton icon={<IconDownloadOutlineRegular size={14} />} onSelect={() => {
              setMenuOpen(false)
              setMcpRequest(current => ({ kind: 'import', id: (current?.id ?? 0) + 1 }))
            }}>
              <span className={css.addMenuItem}><span>{t('product.importMcp')}</span><span className={css.addMenuHint}>{t('product.importMcpHint')}</span></span>
            </MenuItemButton>
          </> : <>
            <MenuItemButton icon={<IconEditOutlineRegular size={14} />} onSelect={() => { setMenuOpen(false); onManageSkills?.() }}>
              <span className={css.addMenuItem}><span>{t('product.addSkill')}</span><span className={css.addMenuHint}>{t('product.addSkillHint')}</span></span>
            </MenuItemButton>
            <MenuItemButton icon={<IconDownloadOutlineRegular size={14} />} onSelect={() => { setMenuOpen(false); onImportSkills?.() }}>
              <span className={css.addMenuItem}><span>{t('product.importSkill')}</span><span className={css.addMenuHint}>{t('product.importSkillHint')}</span></span>
            </MenuItemButton>
          </>}
        </Menu>
      </span>
    </div>
    <p className={css.intro}>{t('product.intro')}</p>
    <div className={css.filters}>
      <div className={css.filterTabs} role="tablist" aria-label={t('product.tabs')}>
        <button
          type="button"
          role="tab"
          id={`${id}-mcp-tab`}
          className={`${css.filterTab}${tab === 'mcp' ? ` ${css.filterTabActive}` : ''}`}
          aria-selected={tab === 'mcp'}
          aria-controls={mcpPanel}
          onClick={() => { setTab('mcp') }}
        >{t('product.tabMcp')}</button>
        <button
          type="button"
          role="tab"
          id={`${id}-skills-tab`}
          className={`${css.filterTab}${tab === 'skills' ? ` ${css.filterTabActive}` : ''}`}
          aria-selected={tab === 'skills'}
          aria-controls={skillsPanel}
          onClick={() => { setTab('skills') }}
        >{t('product.tabSkills')}</button>
      </div>
    </div>
    <div
      id={mcpPanel}
      role="tabpanel"
      aria-labelledby={`${id}-mcp-tab`}
      hidden={tab !== 'mcp'}
      className={css.combinedPanel}
    >
      {tab === 'mcp' && <>
        <ComponentsPage
          embedded
          t={t}
          useComponents={useComponents}
          useMcp={useMcp}
          source={components.source}
          mcp={components.mcp}
        />
        <div className={css.stackDivider} aria-hidden="true" />
        <McpContent embedded t={t} useMcp={useMcp} source={mcpSource} {...mcpRequest === undefined ? {} : { request: mcpRequest }} />
      </>}
    </div>
    <div
      id={skillsPanel}
      role="tabpanel"
      aria-labelledby={`${id}-skills-tab`}
      hidden={tab !== 'skills'}
      className={css.combinedPanel}
    >
      {tab === 'skills' && <section className={css.skillsView} aria-label={t('product.skillsTitle')}>
        <h2 className={css.sectionLabel}>{t('product.skillsTitle')}</h2>
        {skills.failed && <p role="alert" className={css.error}>{t('product.skillsFailed')}</p>}
        {!skills.loaded ? <p role="status">{t('loading')}</p>
          : skills.rows.length === 0 ? <p className={css.empty}>{t(skills.needsSession === true ? 'product.skillsNeedsSession' : 'product.skillsEmpty')}</p>
            : <ul className={css.pluginRows}>{skills.rows.map(skill => (
              <li key={skill.name} className={css.pluginItem}>
                <div className={css.pluginRowStatic}>
                  <span className={css.pluginIcon} aria-hidden="true"><IconSkillOutlineRegular size={22} /></span>
                  <span className={css.pluginMain}>
                    <span className={css.pluginName}>{skill.name}</span>
                    <span className={css.pluginDesc}>{skill.description}</span>
                  </span>
                </div>
              </li>
            ))}</ul>}
      </section>}
    </div>
  </div>
}
