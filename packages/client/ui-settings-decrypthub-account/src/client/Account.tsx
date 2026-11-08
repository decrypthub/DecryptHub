/** Account settings and launcher consume only sanitized native state. */
import { useState } from 'react'
import { Button, Menu, IconUserOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommunityAccountView } from './account-source.ts'
import type { CommunityAccountBridge } from '../types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './Account.module.css'

/** Shared injected observation and narrow user actions. */
export interface AccountInjected {
  hooks: { account: HostObservable<CommunityAccountView> }
  run(command: 'start' | 'refresh' | 'cancel' | 'signOut'): Promise<void>
  open(page: Parameters<CommunityAccountBridge['open']>[0]): Promise<void>
}
/** Native account section in the ordinary settings panel. */
export type AccountSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.decrypthub-account'> & InjectFace<AccountInjected>

/** @param props - localized account observation and commands. @returns community settings. */
export function AccountSection({ useAccount, run, open, t }: AccountSectionProps) {
  const { state, busy, failed } = useAccount(value => value)
  const profile = state?.profile
  const pending = state?.phase === 'waiting-browser' || state?.phase === 'exchanging'
  const name = profile?.nickname || profile?.handle
  const initial = name ? new Intl.Segmenter().segment(name)[Symbol.iterator]().next().value?.segment : undefined
  return <section className={css.section}>
    <header><h2>{t('title')}</h2><p className={css.muted}>{t('description')}</p></header>
    <div className={css.identity}>
      <span className={css.avatar} aria-hidden="true">{initial ?? <IconUserOutlineMedium size={22} />}</span>
      <div className={css.identityText}><strong>{name || t(state === undefined ? 'loading' : 'signedOut')}</strong>
        {profile && <span className={css.muted}>@{profile.handle}</span>}
        {pending && <span className={css.muted} role="status">{t(state.phase === 'exchanging' ? 'exchanging' : 'waiting')}</span>}
      </div>
    </div>
    {profile && <dl className={css.counters}>
      <div><dt>{t('points')}</dt><dd>{profile.points ?? '—'}</dd></div>
      <div><dt>{t('experience')}</dt><dd>{profile.experience ?? '—'}</dd></div>
    </dl>}
    {(failed || state?.error) && <p role="alert" className={css.error}>{failed ? t('transport') : state?.error ? t(`error.${state.error}`) : null}</p>}
    <div className={css.actions}>
      {pending ? <>
        <Button variant="outline" disabled={busy} onClick={() => { void run('cancel') }}>{t('cancel')}</Button>
        <Button disabled={busy} onClick={() => { void open('authorize') }}>{t('reopen')}</Button>
      </> : profile ? <>
        <Button variant="outline" disabled={busy} onClick={() => { void run('refresh') }}>{t('refresh')}</Button>
        <Button disabled={busy} onClick={() => { void run('signOut') }}>{t('signOut')}</Button>
      </> : <Button variant="primary" disabled={busy || (state === undefined && !failed)} onClick={() => { void run('start') }}>{t('signIn')}</Button>}
      <Button onClick={() => { void open(profile ? 'points' : 'community') }}>{t(profile ? 'pointsCenter' : 'community')}</Button>
    </div>
  </section>
}

/** Sidebar launcher replaces the upstream account menu without changing the settings shell. */
export type AccountLauncherProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.decrypthub-account'> & InjectFace<AccountInjected>

/** @param props - sidebar geometry, settings action and native identity. @returns account menu. */
export function AccountLauncher({ wide, settingsShortcut, openSettings, useAccount, t, run, open }: AccountLauncherProps) {
  const { state, busy } = useAccount(value => value)
  const [expanded, setExpanded] = useState(false)
  const name = state?.profile?.nickname || state?.profile?.handle
  return <Menu open={expanded} side="top" portal autoFocus className={css.launcher}
    anchor={<button type="button" className={css.trigger} data-collapsed={!wide} aria-label={t('menu')}
      aria-haspopup="menu" aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
      <IconUserOutlineMedium size={20} />{wide && <span className={css.name}>{name || t('settings')}</span>}
    </button>}
    items={[
      { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
        ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
      ...(state?.profile ? [{ id: 'points', label: t('pointsCenter') }, { id: 'signOut', label: t('signOut'), disabled: busy }]
        : [{ id: 'signIn', label: t('signIn'), disabled: busy }]),
    ]}
    onClose={() => { setExpanded(false) }} onSelect={(id) => {
      setExpanded(false)
      if (id === 'settings') openSettings()
      else if (id === 'points') void open('points')
      else { openSettings(); void run(id === 'signOut' ? 'signOut' : 'start') }
    }} />
}
