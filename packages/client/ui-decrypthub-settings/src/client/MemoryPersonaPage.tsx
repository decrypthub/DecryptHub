/** Memory catalog as the host view; Set role opens the role editor in a dialog. */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MemoryContent } from './MemoryPage.tsx'
import type { MemoryPageInjected } from './MemoryPage.tsx'
import { PersonaDialog } from './PersonaPage.tsx'
import type { PersonaPageInjected } from './PersonaPage.tsx'
import css from './Page.module.css'

/** Combined inject: both product namespaces stay independently writable. */
export interface MemoryPersonaPageInjected {
  hooks: {
    memory: MemoryPageInjected['hooks']['memory']
    persona: PersonaPageInjected['hooks']['persona']
  }
  memory: Omit<MemoryPageInjected, 'hooks'>
  persona: Omit<PersonaPageInjected, 'hooks'>
  memoryT: PropsLocale<'settings.memory'>['t']
  personaT: PropsLocale<'settings.persona'>['t']
}

type CombinedFace = PropsLocale<'settings.memory'> & InjectFace<MemoryPersonaPageInjected>
/** Settings-section props for the fused memory/role page. */
export type MemoryPersonaPageProps = PropsRuntime<'settings.section'> & CombinedFace
/** Main-panel props for the fused memory/role page. */
export type MemoryPersonaMainPageProps = PropsRuntime<'main'> & CombinedFace

/**
 * Render memory as the settings section; role opens over it.
 * @param props - localized combined chrome and both product inject faces.
 * @returns the settings surface.
 */
export function MemoryPersonaPage(props: MemoryPersonaPageProps) {
  return <div className={css.embedded}><MemoryPersonaContent {...props} /></div>
}

/**
 * Render memory as the main panel; role opens over it.
 * @param props - main-panel slot properties and both product inject faces.
 * @returns the full-height surface.
 */
export function MemoryPersonaMainPage(props: MemoryPersonaMainPageProps) {
  return <div className={css.shell}><MemoryPersonaContent {...props} /></div>
}

/**
 * Memory list, with the role editor in a dialog.
 * @param props - locale, both sources, and both `t` binders.
 * @returns the product host.
 */
function MemoryPersonaContent({
  memoryT, personaT, useMemory, usePersona, memory, persona,
}: CombinedFace) {
  const [personaOpen, setPersonaOpen] = useState(false)
  return <div className={css.combined} data-testid="memory-persona-page">
    <div className={css.combinedPanel}>
      <MemoryContent
        t={memoryT}
        useMemory={useMemory}
        source={memory.source}
        onSetPersona={() => { setPersonaOpen(true) }}
        {...memory.onAskAgent === undefined ? {} : { onAskAgent: memory.onAskAgent }}
      />
    </div>
    <PersonaDialog
      open={personaOpen}
      onClose={() => { setPersonaOpen(false) }}
      t={personaT}
      usePersona={usePersona}
      source={persona.source}
    />
  </div>
}
