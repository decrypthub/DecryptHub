/** Verified, immutable component versions with one atomic activation pointer. */
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep, delimiter } from 'node:path'
import { z } from 'zod'
import type { ComponentId, InstalledComponent } from './types.ts'

/** Accepted code-owned identities. */
export const componentIds = ['wdh', 'adh', 'idh'] as const
/** Release sources are checked against these repositories before activation. */
export const repositories: Record<ComponentId, string> = {
  wdh: 'decrypthub/WebDecryptHub', adh: 'decrypthub/adh-cli', idh: 'decrypthub/idh-cli',
}
const manifestSchema = z.object({
  manifestVersion: z.literal(1), apiVersion: z.literal(1), id: z.enum(componentIds),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  runtime: z.enum(['node', 'python']).default('node'), entrypoint: z.string(), platform: z.string(), arch: z.string(),
  source: z.object({ repository: z.string(), commit: z.string().regex(/^[a-f0-9]{40}$/) }).optional(),
  files: z.array(z.object({ path: z.string(), size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(50_000),
})
/** Validated component manifest. */
export type ComponentManifest = z.infer<typeof manifestSchema>
const pointerSchema = z.object({ current: z.string().optional(), previous: z.string().optional() })
const pointersSchema = z.object({ wdh: pointerSchema.optional(), adh: pointerSchema.optional(), idh: pointerSchema.optional() }).strict()
type Pointers = z.infer<typeof pointersSchema>

/** Initialize the owned management lifetime.
 * @param path - archive-relative component path.
 * @returns whether every segment is safe. */
export function safeComponentPath(path: string): boolean {
  return !!path && !isAbsolute(path) && !/[\\:\0]/.test(path) && path.split('/').every(part => !!part && part !== '.' && part !== '..')
}

/** Resolve an owned descendant and reject any existing symlink along its path.
 * @param root - trusted component directory.
 * @param path - relative file.
 * @returns checked descendant.
 */
export async function componentPath(root: string, path: string): Promise<string> {
  if (!safeComponentPath(path)) throw new Error('Invalid component path')
  const full = resolve(root, path)
  const parts = relative(root, full).split(sep)
  let cursor = resolve(root)
  for (const part of ['', ...parts]) {
    if (part) cursor = join(cursor, part)
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Component symlinks are not allowed') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return full
}

/** Validate manifest paths, runtime, platform and bounded file inventory.
 * @param value - parsed component.json.
 * @returns accepted manifest.
 */
export function validateComponentManifest(value: unknown): ComponentManifest {
  const manifest = manifestSchema.parse(value)
  if (manifest.runtime !== (manifest.id === 'wdh' ? 'node' : 'python')) throw new Error('Component runtime mismatch')
  if ((manifest.platform !== process.platform || manifest.arch !== process.arch)
    && !(manifest.id !== 'wdh' && manifest.platform === 'any' && manifest.arch === 'any')) throw new Error('Incompatible component platform')
  const seen = new Set<string>()
  let bytes = 0
  for (const file of manifest.files) {
    const key = file.path.toLowerCase()
    if (!safeComponentPath(file.path) || key === 'component.json' || seen.has(key)) throw new Error('Invalid component inventory')
    bytes += file.size
    if (bytes > 1024 ** 3) throw new Error('Component exceeds 1 GiB')
    seen.add(key)
  }
  if (!manifest.files.some(file => file.path === manifest.entrypoint)) throw new Error('Component entrypoint has no checksum')
  return manifest
}

/** Read one bounded JSON document; only absence is treated as missing.
 * @param filename - owned JSON file.
 * @returns parsed JSON, or undefined on ENOENT.
 */
export async function componentJson(filename: string): Promise<unknown> {
  try {
    if ((await fs.stat(filename)).size > 32 * 1024 ** 2) throw new Error('Component metadata is too large')
    const value: unknown = JSON.parse(await fs.readFile(filename, 'utf8'))
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

/** Owned component versions; activation never publishes an unverified installation. */
export class ComponentFiles {
  private changes: Promise<void> = Promise.resolve()
  /** Read the previous verified component version.
 * @param root - component data directory.
 * @param bundledEntry - optional packaged WDH entry. */
  constructor(readonly root: string, private readonly bundledEntry: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.changes.then(operation)
    this.changes = work.then(() => undefined, () => undefined)
    return work
  }

  private async installation(id: ComponentId, pointer: string | undefined): Promise<InstalledComponent | null> {
    const bundled = pointer === undefined || pointer === '@bundled'
    if (bundled && (id !== 'wdh' || !this.bundledEntry)) return null
    if (!bundled && !pointer.startsWith('versions/')) throw new Error('Invalid component activation directory')
    const root = bundled ? dirname(dirname(this.bundledEntry)) : await componentPath(this.root, pointer)
    const manifest = validateComponentManifest(await componentJson(join(root, 'component.json')))
    if (manifest.id !== id) throw new Error('Component identity mismatch')
    const entry = await componentPath(root, manifest.entrypoint)
    const file = manifest.files.find(file => file.path === manifest.entrypoint)
    if (file === undefined) throw new Error('Missing component entrypoint')
    const bytes = await fs.readFile(entry)
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Component entrypoint checksum mismatch')
    return { id, version: manifest.version, entry, runtime: manifest.runtime, source: bundled ? 'bundled' : 'managed' }
  }

  private async pointers(): Promise<Pointers> {
    const data = await componentJson(join(this.root, 'active.json'))
    return data === undefined ? {} : pointersSchema.parse(data)
  }

  private async write(pointers: Pointers): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const temporary = join(this.root, `${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify(pointers), { mode: 0o600, flag: 'wx' })
      await fs.rename(temporary, join(this.root, 'active.json'))
    } finally { await fs.rm(temporary, { force: true }) }
  }

  /** Resolve the active component and validate its entry; a packaged WDH is the fallback.
   * @param id - code-owned identity.
 * @returns actual local installation, or null.
   */
  async resolve(id: ComponentId): Promise<InstalledComponent | null> {
    const pointer = (await this.pointers())[id]?.current
    return this.installation(id, pointer)
  }

  /** Validate and manage the requested configuration.
 * @param id - component identity.
 * @returns prior verified version, or null. */
  async previous(id: ComponentId): Promise<string | null> {
    const pointer = (await this.pointers())[id]?.previous
    if (!pointer) return null
    return (await this.installation(id, pointer))?.version ?? null
  }

  /** Copy and verify a downloaded package before atomically activating it.
   * @param directory - extraction stage.
 * @param id - requested identity.
 * @param version - verified release version.
   * @param signal - installation lifetime.
 * @returns activated installation.
   */
  async install(directory: string, id: ComponentId, version: string, signal: AbortSignal): Promise<InstalledComponent> {
    return this.serialize(() => this.installVersion(directory, id, version, signal))
  }

  private async installVersion(directory: string, id: ComponentId, version: string, signal: AbortSignal): Promise<InstalledComponent> {
    const manifest = validateComponentManifest(await componentJson(join(directory, 'component.json')))
    if (manifest.id !== id || manifest.version !== version || manifest.source?.repository !== repositories[id]) throw new Error('Package does not match the official release')
    const location = `versions/${id}-${version}-${randomUUID()}`
    const target = await componentPath(this.root, location)
    let activated = false
    await fs.mkdir(target, { recursive: true })
    try {
      for (const file of manifest.files) {
        signal.throwIfAborted()
        const original = await componentPath(directory, file.path)
        const stat = await fs.lstat(original)
        if (!stat.isFile() || stat.nlink > 1 || stat.size !== file.size) throw new Error('Invalid component file')
        const bytes = await fs.readFile(original)
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Component file checksum mismatch')
        const destination = await componentPath(target, file.path)
        await fs.mkdir(dirname(destination), { recursive: true })
        await fs.writeFile(destination, bytes, { flag: 'wx' })
      }
      await fs.writeFile(join(target, 'component.json'), JSON.stringify(manifest), { flag: 'wx' })
      signal.throwIfAborted()
      const pointers = await this.pointers()
      const previous = pointers[id]?.current ?? (id === 'wdh' && this.bundledEntry ? '@bundled' : undefined)
      pointers[id] = { current: location, ...(previous === undefined ? {} : { previous }) }
      await this.write(pointers)
      activated = true
    } finally { if (!activated) await fs.rm(target, { recursive: true, force: true }) }
    return { id, version, entry: join(target, manifest.entrypoint), runtime: manifest.runtime, source: 'managed' }
  }

  /** Atomically swap current and previous verified versions.
   * @param id - component identity.
 * @returns active installation after rollback.
   */
  async rollback(id: ComponentId): Promise<InstalledComponent> {
    return this.serialize(() => this.rollbackVersion(id))
  }

  private async rollbackVersion(id: ComponentId): Promise<InstalledComponent> {
    const pointers = await this.pointers()
    const current = pointers[id]
    if (!current?.previous) throw new Error('No previous component version')
    const result = await this.installation(id, current.previous)
    if (result === null) throw new Error('Previous component is unavailable')
    pointers[id] = { current: current.previous, previous: current.current ?? '@bundled' }
    await this.write(pointers)
    return result
  }
}

/** Find a concrete executable in absolute PATH directories without launching it.
 * @param command - configured executable name or path.
 * @param pathValue - captured host PATH.
 * @returns executable path, or null.
 */
export async function componentExecutable(command: string, pathValue: string): Promise<string | null> {
  const candidates = isAbsolute(command) ? [command] : pathValue.split(delimiter).filter(isAbsolute).flatMap(directory =>
    process.platform === 'win32' ? [join(directory, command), join(directory, `${command}.exe`), join(directory, `${command}.cmd`)] : [join(directory, command)])
  for (const path of candidates) {
    try { await fs.access(path, constants.X_OK); if ((await fs.stat(path)).isFile()) return path }
    catch (_error) { /* Unavailable PATH candidates are not installations. */ }
  }
  return null
}
