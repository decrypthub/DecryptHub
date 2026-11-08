/**
 * Launch the development Desktop shell on hosts where Chromium's sandbox cannot start.
 *
 * `apps/desktop/scripts/dev.ts` prepares the disposable project and the primary
 * runtime, then launches Electron without `--no-sandbox`; on a workstation whose
 * Chromium sandbox is unavailable the shell exits with a breakpoint before the
 * Host serves, which hides every product plugin from the window. This launcher
 * performs the same preparation and adds that one switch, so product checks can
 * run on such a host without changing the shipped launcher.
 *
 * @module scripts/start-desktop-dev
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../apps/desktop/src/host-protocol.ts'
import type { DesktopRelease } from '../apps/desktop/src/release.ts'
import { developmentRuntimeDirectory, resolveDesktopBuildTarget } from '../apps/desktop/scripts/desktop-build-paths.mjs'
import { prepareDevelopmentProject } from '../apps/desktop/scripts/development-project.ts'
import { preparePrimaryRuntime } from '../apps/desktop/scripts/prepare-primary-runtime.ts'

const APP_ROOT = resolve(import.meta.dirname, '..', 'apps', 'desktop')
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')
const DEVELOPMENT_ROOT = join(APP_ROOT, '.desktop-build', 'development')

/**
 * Read one package version.
 * @param path - manifest path.
 * @param subject - manifest role for error messages.
 * @returns the manifest version.
 */
function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: string }
  if (typeof manifest.version !== 'string') throw new Error(`start-desktop-dev: ${subject} has no version`)
  return manifest.version
}

/**
 * Read one integer debug port from the environment.
 * @param name - environment variable name.
 * @param fallback - port used when the variable is unset.
 * @returns the validated port.
 */
function debugPort(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`start-desktop-dev: ${name} must be a port`)
  return port
}

const electron = createRequire(import.meta.url)('electron') as unknown
if (typeof electron !== 'string') throw new Error('start-desktop-dev: electron executable is unavailable')
for (const path of [join(APP_ROOT, 'lib', 'main.js'), join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js')]) {
  if (!existsSync(path)) throw new Error(`start-desktop-dev: missing built artifact ${path}; run build:artifacts first`)
}

const release: DesktopRelease = {
  schemaVersion: 1,
  version: packageVersion(join(APP_ROOT, 'package.json'), 'desktop package'),
  hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
  nodeVersion: execFileSync(electron, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim(),
  pnpmVersion: packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package'),
}

prepareDevelopmentProject({
  projectDir: join(DEVELOPMENT_ROOT, 'project'),
  cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
  hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
  dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
  release,
  target: resolveDesktopBuildTarget(),
})
await preparePrimaryRuntime()

const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229)
const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222)
const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
const home = resolve(process.env.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
const userData = resolve(process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(DEVELOPMENT_ROOT, 'electron-user-data'))
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  DSH_HOME: home,
  DSH_DESKTOP_PRIMARY_RUNTIME_DIR: process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR ?? developmentRuntimeDirectory(),
  DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
  DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS ?? '0',
  ELECTRON_ENABLE_LOGGING: '1',
}
delete environment.ELECTRON_RUN_AS_NODE
console.log(`start-desktop-dev: DSH_HOME=${home}`)
console.log(`start-desktop-dev: userData=${userData}`)
console.log(`start-desktop-dev: renderer debug port=${String(rendererPort)}`)

const child = spawn(electron, [
  '--no-sandbox',
  `--inspect=127.0.0.1:${String(mainPort)}`,
  `--remote-debugging-port=${String(rendererPort)}`,
  `--user-data-dir=${userData}`,
  APP_ROOT,
], { cwd: APP_ROOT, env: environment, stdio: 'inherit' })
child.on('exit', (code) => { process.exitCode = code ?? 0 })
