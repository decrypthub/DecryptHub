/** The assembled Desktop renderer reads captures from the selected chat's WDH observation. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-decrypthub-components'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'

it('shows a captured response and its initiating stack together in the assembled chat', async () => {
  const mcpOverlay = fileURLToPath(new URL('../../../packages/bundle/mcp-bundle/cordis.patch.yml', import.meta.url))
  const scaffold = await launchWebScaffold({ extraOverlayPath: mcpOverlay })
  try {
    const fixture = createChatScrollFixture({ title: 'WDH capture fixture', markerPrefix: 'WDH_CAPTURE', turns: 1 })
    const session = await seedSession(scaffold, fixture.log, 'wdh-capture-fixture')
    const generation = '8352417c-a9ee-4a72-9217-71faddcdccd1'
    const url = 'https://fixture.test/api/items?visible=1'
    const id = 'r18'
    const calls: unknown[] = []
    scaffold.ctx.decrypthubComponents.observeWdh(session, scaffold.workspaceCwd,
      () => ({ state: 'connected', connectedAt: 1, toolCount: 27 }), () => () => {},
      async (selection) => {
        calls.push(selection)
        const value = selection === null
          ? { generation, requests: [{ id, url, method: 'GET', status: 200 }] }
          : {
            id, headers: 'content-type: application/json', headersTruncated: false,
            body: { text: '{"items":[{"label":"Report"}]}', encoding: null, truncated: false },
            frames: [{ functionName: 'loadItems', url: 'https://fixture.test/src/request.js', line: 14, column: 6 }],
          }
        return { content: [{ type: 'text', text: JSON.stringify(value) }] }
      })
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', colorScheme: 'light' })
      await page.addInitScript(() => { Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } }) })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const search = page.getByRole('button', { name: 'Search sessions' })
      if (await search.getAttribute('aria-expanded') !== 'true') await search.click()
      await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.markers.user(1))
      await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').click()
      await page.getByRole('button', { name: 'Browser connected · Capture' }).click()
      const dialog = page.getByRole('dialog', { name: 'Browser capture' })
      await dialog.getByRole('button', { name: /fixture\.test\/api\/items/ }).click()
      await dialog.getByText('{"items":[{"label":"Report"}]}', { exact: true }).waitFor()
      expect(await dialog.getByText('loadItems', { exact: true }).isVisible()).toBe(true)
      expect(await dialog.getByText('https://fixture.test/src/request.js:14:6', { exact: true }).isVisible()).toBe(true)
      expect(calls).toEqual([null, { generation, id }])
      const evidence = process.env.DSH_WDH_CAPTURE_SCREENSHOT_DIR
      if (evidence) await dialog.screenshot({ path: join(evidence, 'wdh-capture-wide.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 620, height: 680 })
      const bounds = await dialog.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(620)
      if (evidence) await dialog.screenshot({ path: join(evidence, 'wdh-capture-narrow.png'), animations: 'disabled' })
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(true)
      expect(await dialog.getByText('loadItems', { exact: true }).isVisible()).toBe(true)
      if (evidence) await dialog.screenshot({ path: join(evidence, 'wdh-capture-dark.png'), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
}, 90_000)
