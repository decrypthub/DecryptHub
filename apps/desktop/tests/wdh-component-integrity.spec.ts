import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { verifyWdhComponent } from '../scripts/verify-wdh-component.mjs'

const target = { platform: 'darwin', arch: 'arm64' }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wdh-payload-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const entry = { path: 'src/cli.mjs', size: 2, sha256: createHash('sha256').update('{}').digest('hex') }
  const files = [entry, { ...entry, path: 'node_modules/@modelcontextprotocol/sdk/package.json' }]
  for (const entry of files) {
    await mkdir(dirname(join(root, entry.path)), { recursive: true })
    await writeFile(join(root, entry.path), '{}')
  }
  const manifest = { id: 'wdh', apiVersion: 1, version: '0.1.1', ...target, entrypoint: 'src/cli.mjs', browserBinariesIncluded: false, files }
  const save = () => writeFile(join(root, 'component.json'), JSON.stringify(manifest))
  await save()
  return { root, manifest, save, entry }
}

it('accepts a complete component and rejects a different target', async () => {
  const { root } = await fixture()
  await expect(verifyWdhComponent(root, target)).resolves.toEqual({ version: '0.1.1', filesVerified: 2 })
  await expect(verifyWdhComponent(root, { ...target, arch: 'x64' })).rejects.toThrow('incompatible')
})

it('refuses the packaging omission of node_modules and changed component bytes', async () => {
  const { root } = await fixture()
  await writeFile(join(root, 'src/cli.mjs'), 'changed')
  await expect(verifyWdhComponent(root, target)).rejects.toThrow('digest mismatch')
  await writeFile(join(root, 'src/cli.mjs'), '{}')
  await rm(join(root, 'node_modules'), { recursive: true })
  await expect(verifyWdhComponent(root, target)).rejects.toThrow('ENOENT')
})

it('refuses traversal and payload symlinks before reading their bytes', async () => {
  const { root, entry, save } = await fixture()
  entry.path = '../outside'
  await save()
  await expect(verifyWdhComponent(root, target)).rejects.toThrow('unsafe')
  entry.path = 'src/cli.mjs'
  await save()
  await rm(join(root, 'src/cli.mjs'))
  await symlink(join(root, 'component.json'), join(root, 'src/cli.mjs'))
  await expect(verifyWdhComponent(root, target)).rejects.toThrow('regular owned payload')
})
