import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { previewHarnessImport, runHarnessImport } from '../src/harness-import.ts'

/** Write one file, creating its parents. */
async function put(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

/**
 * A source home with the real JSONL layout: `sessions/<project>/<session>/session[.vN].jsonl`.
 * It also carries one workspace member without a stored log and one plaintext
 * generation that must not enter a Zstandard destination root.
 */
async function homes() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-import-'))
  const source = join(root, 'source')
  const destination = join(root, 'dest')
  await put(join(source, 'sessions', '--work-app--', 'session-a', 'session.v4.jsonl.zstd'), 'a')
  await put(join(source, 'sessions', '--work-app--', 'session-b', 'session.jsonl.zstd'), 'b')
  await put(join(source, 'sessions', '--work-other--', 'session-c', 'session.v2.jsonl.zstd'), 'c')
  await put(join(source, 'sessions', '--work-other--', 'session-d', 'session.v1.jsonl'), 'd')
  await put(join(source, 'storages', 'session_projcache', 'sessions', 'session-a.json'), JSON.stringify({ version: 7, record: {} }))
  await put(join(source, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws-1', 'ws-2'], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        'ws-1': { path: 'C:\\work\\app', title: 'app', sessionIds: ['session-a', 'session-b', 'session-ghost'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        'ws-2': { path: 'C:\\work\\other', title: 'other', sessionIds: ['session-c'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    },
  }))
  await mkdir(destination, { recursive: true })
  return { root, source, destination }
}

/** One source or destination home's stored session ids. */
async function sessionIds(home: string): Promise<string[]> {
  const ids: string[] = []
  const projects = await readdir(join(home, 'sessions'), { withFileTypes: true }).catch(() => [])
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const sessions = await readdir(join(home, 'sessions', project.name), { withFileTypes: true }).catch(() => [])
    for (const session of sessions) if (session.isDirectory()) ids.push(session.name)
  }
  return ids.toSorted()
}

it('previews stored conversations instead of working-directory projects', async () => {
  const { source, destination } = await homes()
  const preview = await previewHarnessImport(source, destination)
  expect(preview).toHaveLength(1)
  expect(preview[0]?.id).toBe('sessions')
  expect(preview[0]?.count).toBe(3)
  expect(preview[0]?.detail).toContain('4 条会话')
  expect(preview[0]?.detail).toContain('日志编码与目标不一致 1 条')
  expect(await sessionIds(destination)).toEqual([])
})

it('copies every stored conversation and only memberships backed by a log', async () => {
  const { source, destination } = await homes()
  const results = await runHarnessImport(source, destination, ['sessions'])
  const sessions = results.find(result => result.id === 'sessions')
  expect(sessions?.status).toBe('imported')
  expect(sessions?.detail).toContain('导入 3 条会话')
  expect(sessions?.detail).toContain('并入 2 个分组、3 条会话归属')
  expect(sessions?.detail).toContain('1 条标题')
  expect(sessions?.detail).toContain('1 条归属因日志缺失未并入')
  expect(sessions?.detail).toContain('1 条会话因日志编码与目标不一致未导入')

  expect(await sessionIds(destination)).toEqual(['session-a', 'session-b', 'session-c'])
  const cache = JSON.parse(await readFile(join(destination, 'storages', 'session_projcache', 'sessions', 'session-a.json'), 'utf8')) as { version: number }
  expect(cache.version).toBe(7)

  const workspaces = JSON.parse(await readFile(join(destination, 'storages', 'workspace.json'), 'utf8')) as {
    tables: { workspaces: Record<string, { sessionIds: string[] }> }
    global: { workspaceIds: string[] }
  }
  expect(workspaces.global.workspaceIds.toSorted()).toEqual(['ws-1', 'ws-2'])
  expect(workspaces.tables.workspaces['ws-1']?.sessionIds).toEqual(['session-a', 'session-b'])
  expect(workspaces.tables.workspaces['ws-2']?.sessionIds).toEqual(['session-c'])

  const storages = await readdir(join(destination, 'storages'))
  expect(storages.some(name => name.endsWith('.tmp'))).toBe(false)
})

it('reports an import where conversations already exist instead of adding empty groups', async () => {
  const { source, destination } = await homes()
  await runHarnessImport(source, destination, ['sessions'])
  const again = await runHarnessImport(source, destination, ['sessions'])
  expect(again.find(result => result.id === 'sessions')?.status).toBe('skipped')
  expect(again.find(result => result.id === 'sessions')?.detail).toContain('无需导入')
  expect(await sessionIds(destination)).toEqual(['session-a', 'session-b', 'session-c'])
})

it('copies only missing conversations when the destination already used the same project directories', async () => {
  const { source, destination } = await homes()
  await put(join(destination, 'sessions', '--work-app--', 'session-existing', 'session.v4.jsonl.zstd'), 'native')
  await put(join(destination, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['native'], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { native: { path: 'C:\\native', title: 'native', sessionIds: ['session-existing'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } } },
  }))
  const results = await runHarnessImport(source, destination, ['sessions'])
  const sessions = results.find(result => result.id === 'sessions')
  expect(sessions?.status).toBe('imported')
  expect(sessions?.detail).toContain('导入 3 条会话')
  expect(await sessionIds(destination)).toEqual(['session-a', 'session-b', 'session-c', 'session-existing'])

  const workspaces = JSON.parse(await readFile(join(destination, 'storages', 'workspace.json'), 'utf8')) as {
    tables: { workspaces: Record<string, { sessionIds: string[] }> }
    global: { workspaceIds: string[] }
  }
  expect(workspaces.tables.workspaces.native?.sessionIds).toEqual(['session-existing'])
  expect(workspaces.tables.workspaces['ws-1']?.sessionIds).toEqual(['session-a', 'session-b'])
  expect(workspaces.global.workspaceIds).toContain('native')
})

it('fills an existing junk session directory instead of skipping its conversation', async () => {
  const { source, destination } = await homes()
  await mkdir(join(destination, 'sessions', '--work-app--', 'session-a'), { recursive: true })
  const results = await runHarnessImport(source, destination, ['sessions'])
  expect(results.find(result => result.id === 'sessions')?.detail).toContain('导入 3 条会话')
  expect(await readdir(join(destination, 'sessions', '--work-app--', 'session-a'))).toContain('session.v4.jsonl.zstd')
})

it('keeps a plaintext destination consistent by skipping Zstandard conversations', async () => {
  const { source, destination } = await homes()
  await put(join(destination, 'sessions', '--plain--', 'session-native', 'session.jsonl'), 'native')
  const results = await runHarnessImport(source, destination, ['sessions'])
  const sessions = results.find(result => result.id === 'sessions')
  expect(sessions?.detail).toContain('导入 1 条会话')
  expect(sessions?.detail).toContain('3 条会话因日志编码与目标不一致未导入')
  expect(await sessionIds(destination)).toEqual(['session-d', 'session-native'])
})

it('returns no result when conversations were not requested', async () => {
  const { source, destination } = await homes()
  expect(await runHarnessImport(source, destination, [])).toEqual([])
})
