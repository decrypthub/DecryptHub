/** Validate the installed WDH payload before an assembled Desktop passes its smoke gate. */
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, win32 } from 'node:path'

/**
 * Check component identity, target and every recorded file without following payload symlinks.
 * @param {string} directory Installed component directory.
 * @param {{ platform: string, arch: string }} target Desktop target.
 * @returns {Promise<{ version: string, filesVerified: number }>} Verified component summary.
 */
export async function verifyWdhComponent(directory, target) {
  const root = await realpath(directory)
  const manifest = JSON.parse(await readFile(join(root, 'component.json'), 'utf8'))
  if (manifest?.id !== 'wdh' || manifest.apiVersion !== 1 || typeof manifest.version !== 'string'
    || manifest.platform !== target.platform || manifest.arch !== target.arch
    || manifest.browserBinariesIncluded !== false || !Array.isArray(manifest.files)) {
    throw new Error('WDH component: incompatible identity, target or file manifest')
  }
  const seen = new Set()
  for (const entry of manifest.files) {
    const path = entry?.path
    if (typeof path !== 'string' || path === '' || isAbsolute(path) || win32.isAbsolute(path)
      || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.' || part === '')
      || seen.has(path) || !Number.isSafeInteger(entry.size) || entry.size < 0
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error('WDH component: unsafe or invalid file record')
    }
    const file = join(root, path)
    if (await realpath(file) !== file || !(await lstat(file)).isFile()) {
      throw new Error(`WDH component: file is not a regular owned payload: ${path}`)
    }
    const bytes = await readFile(file)
    if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new Error(`WDH component: file digest mismatch: ${path}`)
    }
    seen.add(path)
  }
  if (!seen.has(manifest.entrypoint) || !seen.has('node_modules/@modelcontextprotocol/sdk/package.json')) {
    throw new Error('WDH component: entry point or MCP runtime dependencies are missing')
  }
  return { version: manifest.version, filesVerified: seen.size }
}
