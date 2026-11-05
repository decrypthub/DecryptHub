/** DecryptHub Desktop identity and its independent data roots. */
import type { App } from 'electron'
import { join, resolve } from 'node:path'

/** User-facing identity of the product shell. */
export const PRODUCT_NAME = 'DecryptHub'

/** Folder distinct from both the upstream and previous Tauri application. */
export const PRODUCT_DATA_DIRECTORY = 'DecryptHub-DSH'

/**
 * Configure identity before importing the upstream Desktop entry.
 * @param app - Electron name and path operations.
 * @param environment - Process environment inherited by the bundled Host.
 * @returns The selected Harness home, also written to the Host environment.
 */
export function applyProductIdentity(
  app: Pick<App, 'setName' | 'setPath' | 'getPath' | 'commandLine'>,
  environment: NodeJS.ProcessEnv,
): string {
  app.setName(PRODUCT_NAME)
  const requested = app.commandLine.getSwitchValue('user-data-dir') || environment.DSH_DESKTOP_USER_DATA_DIR
  const userData = requested === undefined || requested === ''
    ? join(app.getPath('appData'), PRODUCT_DATA_DIRECTORY)
    : resolve(requested)
  app.setPath('userData', userData)
  const requestedHome = environment.DSH_HOME
  const runtimeHome = requestedHome === undefined || requestedHome.trim() === '' ? join(userData, 'runtime') : requestedHome
  environment.DSH_HOME = runtimeHome
  return runtimeHome
}
