/** Official management and volatile configuration through an actual profile Loader. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { initProfile, mountRootInclude, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import Components from '@deepseek-ai/dsh-decrypthub-components'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { PeerId, Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import * as Integration from '../src/index.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap { 'test-component-guest': { kind: 'test-component-guest' } }
}

function caller(ctx: Context, principal: Principal): Context {
  const signal = new AbortController().signal
  const invocation: RemoteInvocation = { request: { namespace: 'decrypthubComponents', method: 'snapshot', args: {} }, service: 'decrypthubComponents',
    peer: { id: 'component-peer' as PeerId, ctx, principal, interactions: 'answer', signal, dispose: async () => {} }, signal,
    uplink: <In>(): AsyncIterable<In> => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
  }
  return ctx.extend({ invocation })
}

it('exposes and persists official connection choices and permits only the owner to manage them', async () => {
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'decrypthub-profile-')))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await fs.rm(home, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await mountAgentLoopTestHarness(ctx)
  const dir = join(home, 'profile'), bundle = join(dir, 'node_modules', 'test-official-components')
  initProfile(dir, ['test-official-components'])
  await fs.mkdir(bundle, { recursive: true })
  await fs.writeFile(join(home, 'package.json'), '{"name":"component-test"}')
  await fs.writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-official-components', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await fs.writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'mcp', name: 'cordis:test-mcp' },
    { id: 'components', name: 'cordis:test-components', config: { directory: join(home, 'components') } },
    { id: 'decrypthub-integrations', name: 'cordis:test-integrations', inject: ['decrypthubComponents'], config: {
      wdh: { entry: fileURLToPath(new URL('./fixture-server.ts', import.meta.url)), dataDirectory: join(home, 'browser') },
    } },
  ] }]))
  await fs.writeFile(join(dir, 'cordis.yml'), '[]')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-official-components'], dir,
    patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  ctx.baseUrl = pathToFileURL(home).href + '/'
  ctx.provide('profileContext', profile)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(Loader)
  ctx.loader.builtins['test-mcp'] = McpManager
  ctx.loader.builtins['test-components'] = Components
  ctx.loader.builtins['test-integrations'] = Integration
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await mountRootInclude(ctx, join(dir, 'cordis.yml'), readProfilePatches('test', profile))
  await ctx.loader.await()
  const namespace = ctx.settings.describe().find(row => row.ns === 'decrypthub-integrations')
  expect(namespace, JSON.stringify(ctx.configEditor.entries().map(entry => ({ id: entry.options.id, state: entry.fiber?.state }))) + ' subprocess=' + String(ctx.get('subprocess') !== undefined)).toBeDefined()
  const owner = caller(ctx, { kind: 'owner' })
  const initial = await owner.decrypthubComponents.snapshot()
  expect(initial.configuration?.wdh.enabled).toBe(false)
  await owner.decrypthubComponents.configure('wdh', true, '', [], '', 'system', namespace!.revision)
  expect((await owner.decrypthubComponents.snapshot()).configuration?.wdh.enabled).toBe(true)
  expect(await fs.readFile(profile.patchPath, 'utf8')).toContain('enabled: true')
  await expect(owner.decrypthubComponents.configure('wdh', false, '', [], '', 'system', namespace!.revision)).rejects.toThrow('changed')
  await expect(caller(ctx, { kind: 'test-component-guest' }).decrypthubComponents.snapshot()).rejects.toThrow('owner')
})
