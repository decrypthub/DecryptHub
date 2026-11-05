/** Product bootstrap; the upstream Desktop owns the application lifecycle. */
import { app } from 'electron'
import { join } from 'node:path'
import { applyProductIdentity } from './product-identity.ts'

const runtimeHome = applyProductIdentity(app, process.env)
process.env.DSH_DESKTOP_ONBOARDING = 'models'
process.env.DSH_DESKTOP_ACCOUNT_PROVIDER = 'decrypthub'
process.env.DSH_TELEMETRY_DISABLED = '1'
if (app.isPackaged) {
  process.env.DSH_WDH_ENTRY ??= join(process.resourcesPath, 'components', 'wdh', 'src', 'cli.mjs')
  process.env.DSH_WDH_DATA_DIR ??= join(runtimeHome, 'wdh')
}
await import('./main.ts')
