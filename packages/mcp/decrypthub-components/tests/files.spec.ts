import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { ComponentFiles, componentPath, safeComponentPath, validateComponentManifest } from '../src/files.ts'
import { extractComponentZip } from '../src/zip.ts'
import { selectComponentRelease } from '../src/releases.ts'

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'decrypthub-components-'))
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }))
  const stage = async (version: string) => {
    const directory = join(root, `stage-${version}`)
    await fs.mkdir(directory)
    const source = 'print("MCP fixture")\n'
    const manifest = { manifestVersion: 1, apiVersion: 1, id: 'idh', version, runtime: 'python', entrypoint: 'main.py', platform: 'any', arch: 'any',
      source: { repository: 'decrypthub/idh-cli', commit: 'a'.repeat(40) },
      files: [{ path: 'main.py', size: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex') }] }
    await fs.writeFile(join(directory, 'main.py'), source)
    await fs.writeFile(join(directory, 'component.json'), JSON.stringify(manifest))
    return { directory, manifest }
  }
  return { root, stage, files: new ComponentFiles(join(root, 'components'), '') }
}

describe('verified official components', () => {
  it('installs and rolls back without replacing a usable version on corruption or cancellation', async () => {
    const { stage, files } = await fixture()
    const first = await stage('1.0.0'), second = await stage('2.0.0'), third = await stage('3.0.0')
    const signal = new AbortController().signal
    await files.install(first.directory, 'idh', '1.0.0', signal)
    await files.install(second.directory, 'idh', '2.0.0', signal)
    expect(await files.previous('idh')).toBe('1.0.0')
    await fs.writeFile(join(third.directory, 'main.py'), 'corrupt')
    await expect(files.install(third.directory, 'idh', '3.0.0', signal)).rejects.toThrow()
    expect((await files.resolve('idh'))?.version).toBe('2.0.0')
    await expect(files.install(first.directory, 'idh', '1.0.0', AbortSignal.abort())).rejects.toThrow()
    expect((await files.rollback('idh')).version).toBe('1.0.0')
    expect((await files.rollback('idh')).version).toBe('2.0.0')
  })
  it('serializes concurrent activations so the predecessor remains available', async () => {
    const { stage, files } = await fixture()
    const first = await stage('1.0.0'), second = await stage('2.0.0')
    await Promise.all([files.install(first.directory, 'idh', '1.0.0', new AbortController().signal), files.install(second.directory, 'idh', '2.0.0', new AbortController().signal)])
    expect((await files.resolve('idh'))?.version).toBe('2.0.0')
    expect(await files.previous('idh')).toBe('1.0.0')
  })
  it('rejects traversal, symlinks, duplicate case paths and missing checksums', async () => {
    const { root, stage } = await fixture()
    for (const path of ['../a', '/a', 'a\\b', 'a:b', 'a//b', './a']) expect(safeComponentPath(path)).toBe(false)
    await fs.symlink(tmpdir(), join(root, 'link'))
    await expect(componentPath(root, 'link/file')).rejects.toThrow()
    const { manifest } = await stage('1.0.0')
    expect(() => validateComponentManifest({ ...manifest, files: [manifest.files[0], { ...manifest.files[0], path: 'MAIN.py' }] })).toThrow()
    expect(() => validateComponentManifest({ ...manifest, entrypoint: 'missing.py' })).toThrow()
  })
  it('extracts complete archives and waits for cancellation to settle', async () => {
    const { root } = await fixture()
    const archive = join(root, 'files.zip'), destination = join(root, 'out')
    await fs.mkdir(destination)
    await fs.writeFile(archive, zipSync({ 'src/main.py': strToU8('print(1)'), 'data.txt': strToU8('data') }))
    await extractComponentZip(archive, destination, new AbortController().signal)
    expect(await fs.readFile(join(destination, 'src/main.py'), 'utf8')).toBe('print(1)')
    await expect(extractComponentZip(archive, join(root, 'cancelled'), AbortSignal.abort())).rejects.toThrow()
    await fs.writeFile(archive, zipSync({ '../outside': strToU8('bad') }))
    await expect(extractComponentZip(archive, join(root, 'unsafe'), new AbortController().signal)).rejects.toThrow()
  })
  it('selects only compatible assets with a published hash and a fixed repository', () => {
    const asset = { id: 2, name: 'idh-1.0.0-any.zip', size: 123, digest: `sha256:${'b'.repeat(64)}`, browser_download_url: 'https://github.com/decrypthub/idh-cli/releases/download/v1.0.0/idh-1.0.0-any.zip' }
    const release = (assets: unknown[]) => [{ id: 1, draft: false, published_at: '2026-11-05T00:00:00Z', assets }]
    expect(selectComponentRelease('idh', release([asset]))?.version).toBe('1.0.0')
    for (const bad of [{ ...asset, digest: null }, { ...asset, browser_download_url: 'invalid' }, { ...asset, browser_download_url: 'https://github.com/other/idh-cli/releases/download/v1/idh.zip' }, { ...asset, name: 'idh-1.0.0-linux-x64.zip' }]) {
      expect(selectComponentRelease('idh', release([bad]))).toBeNull()
    }
  })
})
