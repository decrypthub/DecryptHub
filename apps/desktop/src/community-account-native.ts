/** Electron-owned community identity; Host and model tools cannot obtain its grant. */
import { app, ipcMain, safeStorage, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { CommunityAccount } from './community-account.ts'
import { communityOrigin } from './community-account-protocol.ts'
import { communityVault } from './community-account-vault.ts'
import { COMMUNITY_ACCOUNT_IPC } from './community-account-ipc.ts'

/**
 * Install main-frame-only account commands after Electron readiness.
 * @param assertSender - verifies the current application window and top-level frame.
 * @param window - current primary window; browser guests never receive state.
 * @returns disposal of listeners and pending authorization.
 */
export function installCommunityAccount(assertSender: (event: IpcMainInvokeEvent) => BrowserWindow,
  window: () => BrowserWindow | undefined): () => void {
  const manager = new CommunityAccount({
    origin: communityOrigin(!app.isPackaged, process.env.DECRYPTHUB_COMMUNITY_URL),
    vault: communityVault(join(app.getPath('userData'), 'community-account.enc'), {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable()
        && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
      encryptString: value => safeStorage.encryptString(value), decryptString: value => safeStorage.decryptString(value),
    }),
    openBrowser: url => shell.openExternal(url), attemptTimeoutMs: 300_000,
    changed: (state) => {
      const owner = window()
      if (owner !== undefined && !owner.isDestroyed()) owner.webContents.send(COMMUNITY_ACCOUNT_IPC.changed, state)
    },
  })
  const commands = {
    get: () => manager.get(), refresh: () => manager.refresh(), start: () => manager.start(),
    cancel: () => manager.cancel(), signOut: () => manager.signOut(),
  } as const
  for (const [method, operation] of Object.entries(commands)) {
    const channel = COMMUNITY_ACCOUNT_IPC[method as keyof typeof commands]
    ipcMain.handle(channel, async (event) => { assertSender(event); return operation() })
  }
  ipcMain.handle(COMMUNITY_ACCOUNT_IPC.open, async (event, page: unknown) => {
    assertSender(event)
    if (page !== 'community' && page !== 'points' && page !== 'authorize') throw new Error('Invalid community destination')
    await manager.open(page)
  })
  return () => {
    manager.dispose()
    for (const method of Object.keys(commands)) ipcMain.removeHandler(COMMUNITY_ACCOUNT_IPC[method as keyof typeof commands])
    ipcMain.removeHandler(COMMUNITY_ACCOUNT_IPC.open)
  }
}
