/** Product composition uses normal bundle layers and preserves the user's final overrides. */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, initProfile, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'
import { expect, it, onTestFinished } from 'vitest'

it('keeps product plugins over stable upstream services while user patches win', () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'decrypthub-rc3-composition-')))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  initProfile(home, PROFILE_TEMPLATES.web!.bundles)
  const anchor = fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url))
  const initial = loadProfileDirectory('web', home, anchor)
  const rows = composeEntries(initial.layers.map(layer => layer.patches).concat([initial.patches]))
  const entry = (id: string) => rows.find(row => row.id === id)
  expect(entry('decrypthub-components')?.name).toBe('@deepseek-ai/dsh-decrypthub-components')
  expect(entry('product-memory')?.name).toBe('@deepseek-ai/dsh-product-memory')
  expect(entry('product-persona')?.name).toBe('@deepseek-ai/dsh-product-persona')
  expect(entry('tool-skill-manage')?.name).toBe('@deepseek-ai/dsh-tool-skill-manage')
  expect(entry('tool-product-sessions')?.name).toBe('@deepseek-ai/dsh-tool-product-sessions')
  expect(entry('session-query-sqlite')?.name).toBe('@deepseek-ai/dsh-session-query-sqlite')
  expect(entry('tool-session-query')).toBeUndefined()
  expect(entry('ui-brand-official')?.disabled).toBe(true)
  expect(entry('ui-settings-account')?.disabled).toBe(true)
  expect(entry('ui-account-notifications')?.disabled).toBe(true)
  expect(entry('ui-settings-decrypthub-account')?.disabled).not.toBe(true)
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  writeFileSync(join(home, 'cordis.patch.yml'), '- id: ui-brand-official\n  disabled: false\n')
  const changed = loadProfileDirectory('web', home, anchor)
  const overridden = composeEntries(changed.layers.map(layer => layer.patches).concat([changed.patches]))
  expect(overridden.find(row => row.id === 'ui-brand-official')?.disabled).toBe(false)
})
