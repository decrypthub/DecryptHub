/**
 * Copy DeepSeek Harness conversations into this product home. The source is
 * only read. Conversations are the only stable interchange unit: the session
 * JSONL format is versioned with an explicit migration contract, while tasks,
 * model credentials and plugins are internal files that would break the
 * destination when their versions drift.
 */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import type { ImportItem, ImportKind, ImportResult } from './types.ts'

/** One workspace account to recreate so imported sessions keep their group. */
export interface ImportedWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

/** Group counts reported after the workspace rows were merged or adopted. */
export interface AdoptedGroups {
  readonly workspaces: number
  readonly sessions: number
  /** Groups whose source path was unavailable, so no account was created. */
  readonly skipped?: number
  /** Memberships the live registry refused to attach. */
  readonly unattached?: number
}

export type { ImportItem, ImportKind, ImportResult }

/**
 * Canonical JSONL generation filenames. Version zero keeps the original
 * suffix-only name; every later generation carries a lowercase `vN` segment.
 * The backend binds one physical compression per root and rejects a root that
 * mixes them, so the import reads the encoding from the stored file name.
 */
const SESSION_LOG_ZSTD = /^session(?:\.v[1-9][0-9]*)?\.jsonl\.zstd$/
const SESSION_LOG_PLAIN = /^session(?:\.v[1-9][0-9]*)?\.jsonl$/

/** One stored session directory: the project key is its `sessions` child. */
interface StoredSession {
  readonly project: string
  readonly sessionId: string
  /** Physical compression of the stored generation; the backend forbids mixing. */
  readonly zstd: boolean
}

/**
 * Default official Harness home on this machine.
 * @returns the `~/.dsh` path.
 */
export function defaultHarnessHome(): string {
  return join(homedir(), '.dsh')
}

/**
 * Describe the conversations a source home can contribute.
 * @param source - official Harness home.
 * @param destination - this product's `DSH_HOME`.
 * @returns the single conversation row.
 */
export async function previewHarnessImport(source: string, destination: string): Promise<readonly ImportItem[]> {
  assertHomes(source, destination)
  const stored = await storedSessions(source)
  const present = await destinationSessionIds(destination)
  const zstd = await destinationCompression(destination)
  const compatible = stored.filter(session => session.zstd === zstd)
  const pending = compatible.filter(session => !present.has(session.sessionId)).length
  return [{
    id: 'sessions',
    count: pending,
    seconds: Math.max(1, Math.ceil(pending * 0.4)),
    detail: `${stored.length} 条会话（按工作目录分组）；已存在 ${stored.length - pending} 条、日志编码与目标不一致 ${stored.length - compatible.length} 条会跳过。`,
  }]
}

/**
 * Copy the conversations. Existing destination sessions are left in place.
 * @param source - official Harness home.
 * @param destination - this product's `DSH_HOME`.
 * @param kinds - requested categories; only conversations are supported.
 * @param adoptWorkspaces - optional live workspace registry bridge; the JSON `workspace.json` merge is used when omitted.
 * @returns the conversation outcome, or no result when it was not requested.
 */
export async function runHarnessImport(
  source: string,
  destination: string,
  kinds: readonly ImportKind[],
  adoptWorkspaces?: (records: readonly ImportedWorkspace[]) => Promise<AdoptedGroups | undefined>,
): Promise<readonly ImportResult[]> {
  assertHomes(source, destination)
  if (!kinds.includes('sessions')) return []
  const outcome = await copySessions(source, destination, adoptWorkspaces)
  return [outcome.result]
}

function assertHomes(source: string, destination: string): void {
  const from = resolve(source)
  const to = resolve(destination)
  if (from === to || from.startsWith(to + sep) || to.startsWith(from + sep)) {
    throw new Error('导入来源和当前数据目录不能是同一个，也不能互相包含')
  }
}

/** List the session directories a Harness home actually stores. */
async function storedSessions(home: string): Promise<StoredSession[]> {
  const root = join(home, 'sessions')
  const stored: StoredSession[] = []
  for (const project of await directoryNames(root)) {
    for (const sessionId of await directoryNames(join(root, project))) {
      const zstd = await generationEncoding(join(root, project, sessionId))
      if (zstd === undefined) continue
      stored.push({ project, sessionId, zstd })
    }
  }
  return stored
}

/** Physical compression of one session directory's committed generation. */
async function generationEncoding(directory: string): Promise<boolean | undefined> {
  try {
    const names = await readdir(directory)
    if (names.some(name => SESSION_LOG_ZSTD.test(name))) return true
    if (names.some(name => SESSION_LOG_PLAIN.test(name))) return false
    return undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Session ids already present in one home. */
async function destinationSessionIds(destination: string): Promise<Set<string>> {
  return new Set((await storedSessions(destination)).map(session => session.sessionId))
}

/**
 * Physical compression this destination's session backend is bound to. The
 * product profiles default to Zstandard; an existing plaintext root keeps the
 * plaintext binding it was created with.
 */
async function destinationCompression(destination: string): Promise<boolean> {
  const stored = await storedSessions(destination)
  return stored[0]?.zstd ?? true
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function copySessions(
  source: string,
  destination: string,
  adoptWorkspaces?: (records: readonly ImportedWorkspace[]) => Promise<AdoptedGroups | undefined>,
): Promise<{ result: ImportResult; present: Set<string> }> {
  const stored = await storedSessions(source)
  const present = await destinationSessionIds(destination)
  const zstd = await destinationCompression(destination)
  const records = await workspaceRecords(join(source, 'storages', 'workspace.json'))
  if (stored.length === 0 && records.length === 0) {
    return { result: { id: 'sessions', status: 'empty', detail: '没有会话可导入' }, present }
  }
  const root = join(destination, 'sessions')
  await mkdir(root, { recursive: true })
  let copied = 0
  let skipped = 0
  let encodingSkipped = 0
  for (const session of stored) {
    if (session.zstd !== zstd) {
      encodingSkipped += 1
      continue
    }
    if (present.has(session.sessionId)) {
      skipped += 1
      continue
    }
    const target = join(root, session.project, session.sessionId)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(source, 'sessions', session.project, session.sessionId), target, { recursive: true, force: true })
    present.add(session.sessionId)
    copied += 1
  }
  const titles = await copyProjectionCache(source, destination, present)
  const totalMembers = records.reduce((sum, record) => sum + record.sessionIds.length, 0)
  const adoptedRecords = records.flatMap((record) => {
    const sessionIds = record.sessionIds.filter(sessionId => present.has(sessionId))
    return sessionIds.length === 0 ? [] : [{ ...record, sessionIds }]
  })
  const adoptedMembers = adoptedRecords.reduce((sum, record) => sum + record.sessionIds.length, 0)
  let groups: AdoptedGroups = { workspaces: 0, sessions: 0 }
  if (adoptedRecords.length > 0) {
    groups = adoptWorkspaces === undefined
      ? await mergeWorkspaceFile(source, destination, adoptedRecords)
      : await adoptWorkspaces(adoptedRecords) ?? groups
  }
  const detail = [
    `导入 ${copied} 条会话`,
    skipped > 0 ? `跳过 ${skipped} 条已存在的` : '',
    `并入 ${groups.workspaces} 个分组、${groups.sessions} 条会话归属`,
    titles > 0 ? `${titles} 条标题` : '',
    totalMembers > adoptedMembers ? `${totalMembers - adoptedMembers} 条归属因日志缺失未并入` : '',
    encodingSkipped > 0 ? `${encodingSkipped} 条会话因日志编码与目标不一致未导入` : '',
    groups.skipped !== undefined && groups.skipped > 0 ? `${groups.skipped} 个分组路径不可用未导入` : '',
    groups.unattached !== undefined && groups.unattached > 0 ? `${groups.unattached} 条会话归属未能挂入` : '',
  ].filter(part => part !== '').join('，')
  const changed = copied > 0 || groups.sessions > 0
  return {
    result: {
      id: 'sessions',
      status: changed ? 'imported' : 'skipped',
      detail: changed ? `${detail}。重新打开应用后显示。` : '会话均已存在，无需导入。',
    },
    present,
  }
}

async function copyProjectionCache(source: string, destination: string, present: ReadonlySet<string>): Promise<number> {
  const from = join(source, 'storages', 'session_projcache', 'sessions')
  const files = await jsonFiles(from)
  const target = join(destination, 'storages', 'session_projcache', 'sessions')
  await mkdir(target, { recursive: true })
  let copied = 0
  for (const name of files) {
    if (!present.has(name.slice(0, -'.json'.length))) continue
    const dest = join(target, name)
    if (await fileExists(dest)) continue
    await cp(join(from, name), dest)
    copied += 1
  }
  return copied
}

async function jsonFiles(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function workspaceRecords(path: string): Promise<ImportedWorkspace[]> {
  try {
    const document = JSON.parse(await readFile(path, 'utf8')) as {
      tables?: { workspaces?: Record<string, { path?: unknown; title?: unknown; sessionIds?: unknown }> }
    }
    return Object.entries(document.tables?.workspaces ?? {}).flatMap(([id, record]) => {
      if (typeof record.path !== 'string' || typeof record.title !== 'string' || !Array.isArray(record.sessionIds)) return []
      return [{ id, path: record.path, title: record.title, sessionIds: record.sessionIds.filter((item): item is string => typeof item === 'string') }]
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    return []
  }
}

async function mergeWorkspaceFile(
  source: string,
  destination: string,
  records: readonly ImportedWorkspace[],
): Promise<AdoptedGroups> {
  if (records.length === 0) return { workspaces: 0, sessions: 0 }
  const from = join(source, 'storages', 'workspace.json')
  const targetDir = join(destination, 'storages')
  const target = join(targetDir, 'workspace.json')
  await mkdir(targetDir, { recursive: true })
  let sourceText: string
  try { sourceText = await readFile(from, 'utf8') } catch { return { workspaces: 0, sessions: 0 } }
  let destDoc: {
    unit?: unknown
    global?: { initialized?: boolean; workspaceIds?: string[]; archivedSessionIds?: string[]; pinnedSessionIds?: string[] }
    tables?: { workspaces?: Record<string, { path?: string; sessionIds?: string[] }> }
  }
  try {
    destDoc = JSON.parse(await readFile(target, 'utf8')) as typeof destDoc
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeJsonAtomic(target, withOnlyRecords(sourceText, records))
    return { workspaces: records.length, sessions: records.reduce((sum, record) => sum + record.sessionIds.length, 0) }
  }
  const destWorkspaces = destDoc.tables?.workspaces ?? {}
  const byPath = new Map<string, string>()
  for (const [id, record] of Object.entries(destWorkspaces)) {
    if (typeof record.path === 'string') byPath.set(record.path, id)
  }
  const sourceDoc = JSON.parse(sourceText) as { tables?: { workspaces?: Record<string, { path?: string; sessionIds?: string[] }> } }
  let workspaces = 0
  let sessions = 0
  let skipped = 0
  const order = destDoc.global?.workspaceIds ?? []
  for (const record of records) {
    const existingId = Object.hasOwn(destWorkspaces, record.id) ? record.id : byPath.get(record.path)
    if (existingId !== undefined) {
      const existing = destWorkspaces[existingId]
      if (existing === undefined) continue
      const ids = existing.sessionIds ?? []
      const have = new Set(ids)
      for (const sessionId of record.sessionIds) {
        if (have.has(sessionId)) continue
        ids.push(sessionId)
        have.add(sessionId)
        sessions += 1
      }
      existing.sessionIds = ids
      continue
    }
    const sourceRecord = sourceDoc.tables?.workspaces?.[record.id]
    if (sourceRecord === undefined) { skipped += 1; continue }
    destWorkspaces[record.id] = { ...sourceRecord, sessionIds: [...record.sessionIds] }
    byPath.set(record.path, record.id)
    order.push(record.id)
    workspaces += 1
    sessions += record.sessionIds.length
  }
  destDoc.global = { ...destDoc.global, initialized: true, workspaceIds: order }
  destDoc.tables = { ...destDoc.tables, workspaces: destWorkspaces }
  await writeJsonAtomic(target, destDoc)
  return { workspaces, sessions, ...skipped > 0 ? { skipped } : {} }
}

/** Replace a source document's workspace rows with the adopted records only. */
function withOnlyRecords(sourceText: string, records: readonly ImportedWorkspace[]): unknown {
  const document = JSON.parse(sourceText) as {
    global?: { workspaceIds?: string[] }
    tables?: { workspaces?: Record<string, unknown> }
  }
  const byId = new Map(records.map(record => [record.id, record]))
  const tables = document.tables?.workspaces ?? {}
  const workspaces: Record<string, unknown> = {}
  for (const record of records) {
    const row = tables[record.id]
    if (row !== undefined) workspaces[record.id] = { ...row, sessionIds: [...record.sessionIds] }
    else workspaces[record.id] = { path: record.path, title: record.title, sessionIds: [...record.sessionIds] }
  }
  const workspaceIds = (document.global?.workspaceIds ?? []).filter(id => byId.has(id))
  for (const record of records) if (!workspaceIds.includes(record.id)) workspaceIds.push(record.id)
  return { ...document, global: { ...document.global, initialized: true, workspaceIds }, tables: { ...document.tables, workspaces } }
}

/** Write JSON through a same-directory temporary file so a reader never sees a partial document. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.import-${process.pid}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
