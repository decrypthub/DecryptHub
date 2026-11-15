/** Product bootstrap; the upstream Desktop owns the application lifecycle. */
import { app } from 'electron'
import { join } from 'node:path'
import { applyProductIdentity } from './product-identity.ts'

const runtimeHome = applyProductIdentity(app, process.env)
process.env.DSH_CLIENT_TITLE ??= 'DecryptHub'
process.env.DSH_DESKTOP_PROTOCOL = 'decrypthub'
process.env.DSH_DESKTOP_ONBOARDING = 'models'
process.env.DSH_DESKTOP_ACCOUNT_PROVIDER = 'decrypthub'
process.env.DSH_TELEMETRY_DISABLED = '1'
if (app.isPackaged) {
  // WDH ships as an online component; only its data directory is deployment-owned.
  process.env.DSH_WDH_DATA_DIR ??= join(runtimeHome, 'wdh')
}
await import('./main.ts')
