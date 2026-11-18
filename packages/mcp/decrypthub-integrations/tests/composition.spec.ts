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
import { expect, it, onTestFinished, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Integration from '../src/index.ts'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

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

async function mountProfile(devices: Partial<Record<'adh' | 'idh', { endpoint: string; devices: string[] }>> = {}) {
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'decrypthub-profile-')))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await fs.rm(home, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  const harness = await mountAgentLoopTestHarness(ctx)
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
      ...devices,
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
  return { ctx, harness, home, profile }
}

it('exposes and persists official connection choices and permits only the owner to manage them', async () => {
  const { ctx, profile } = await mountProfile()
  const namespace = ctx.settings.describe().find(row => row.ns === 'decrypthub-integrations')
  expect(namespace, JSON.stringify(ctx.configEditor.entries().map(entry => ({ id: entry.options.id, state: entry.fiber?.state }))) + ' subprocess=' + String(ctx.get('subprocess') !== undefined)).toBeDefined()
  const owner = caller(ctx, { kind: 'owner' })
  const initial = await owner.decrypthubComponents.snapshot()
  expect(initial.configuration?.wdh.enabled).toBe(false)
  const status = await executeToolFixture(ctx, { signal: new AbortController().signal,
    callId: ToolCallId('official-status'), name: 'decrypthub_status', arguments: {} })
  expect(status.isError).toBeFalsy()
  const text = status.content.find(block => block.type === 'text')
  if (text?.type !== 'text') throw new Error('Missing component status result')
  const report = JSON.parse(text.text) as { components: { component: string; targets: unknown[] }[] }
  expect(report.components.map(row => row.component)).toEqual(['wdh', 'adh', 'idh'])
  expect(report.components.every(row => row.targets.length === 0)).toBe(true)
  await owner.decrypthubComponents.configure('wdh', true, '', [], '', 'system', namespace!.revision)
  expect((await owner.decrypthubComponents.snapshot()).configuration?.wdh.enabled).toBe(true)
  expect(await fs.readFile(profile.patchPath, 'utf8')).toContain('enabled: true')
  await expect(owner.decrypthubComponents.configure('wdh', false, '', [], '', 'system', namespace!.revision)).rejects.toThrow('changed')
  await expect(caller(ctx, { kind: 'test-component-guest' }).decrypthubComponents.snapshot()).rejects.toThrow('owner')
})

async function openDevice(component: 'adh' | 'idh', name: string) {
  let endpoint = ''
  let generation = 1
  const pid = 42
  const seen: string[] = []
  const identity = () => ({
    id: component === 'adh' ? `${name}-${generation}` : name,
    name,
    endpoint,
    online: true,
    pid,
    bundle: `test.${name}`,
    package: `test.${name}`,
  })
  const server = createServer((request, response) => {
    seen.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/status') {
      response.end(JSON.stringify({
        schemaVersion: 1, component, version: '2', checkedAt: new Date().toISOString(),
        connections: [{ endpoint, online: true }], targets: [identity()],
      }))
    } else if (component === 'idh' && request.url === '/call') {
      response.end(JSON.stringify({
        structuredContent: { processGeneration: `${name}-${generation}`, process: { pid, bundleId: identity().bundle } },
      }))
    } else {
      response.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture device address')
  const base = `http://127.0.0.1:${address.port}`
  endpoint = `${base}${component === 'adh' ? '/mcp' : '/api/mcp'}`
  return {
    base, seen,
    choice: () => ({ component, endpoint, id: identity().id, pid: String(pid), appId: identity().bundle }),
    restart: () => { generation++ },
  }
}

it.each(['adh', 'idh'] as const)('routes each %s chat to its chosen device and rejects a restarted process', async (component) => {
  const [first, second] = await Promise.all([openDevice(component, 'first-app'), openDevice(component, 'second-app')])
  const { ctx, harness, home } = await mountProfile({
    [component]: { endpoint: second.base, devices: [first.base, second.base] },
  })
  const components = ctx.decrypthubComponents
  const fixture = fileURLToPath(new URL('./fixture-device-cli.ts', import.meta.url))
  vi.spyOn(components, 'runtime').mockImplementation(async (_id, _command, args) =>
    ({ command: process.execPath, args: [fixture, ...args], env: {}, cwd: home }))
  const a = await harness.create(SessionId('device-chat-a'), {}, { cwd: home })
  const b = await harness.create(SessionId('device-chat-b'), {}, { cwd: home })
  const signal = new AbortController().signal
  await expect(Promise.all([
    components.setChatTarget(a.id, first.choice(), signal),
    components.setChatTarget(b.id, second.choice(), signal),
  ])).resolves.toMatchObject([{ name: 'first-app', state: 'bound' }, { name: 'second-app', state: 'bound' }])
  await expect(caller(ctx, { kind: 'test-component-guest' }).decrypthubComponents.chatTarget(a.id, signal)).rejects.toThrow('owner')
  const marker = vi.fn(async () => 'fixture')
  const tool = `mcp__${component}__fixture_marker`
  ctx.effect(() => ctx.tools.register(defineTool({
    name: tool, description: 'Report a fixture marker.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: marker,
  })))
  const blocked = await executeToolFixture(ctx, {
    signal, agent: a, callId: ToolCallId('unscoped-marker'), name: tool, arguments: {},
  })
  expect(blocked.isError).toBe(true)
  expect(JSON.stringify(blocked)).toContain('CHAT_TARGET_STATUS_ONLY')
  expect(marker).not.toHaveBeenCalled()

  const read = async (agent: typeof a) => {
    const result = await executeToolFixture(ctx, {
      signal, agent, callId: ToolCallId(`read-${agent.id}`), name: 'decrypthub_status', arguments: {},
    })
    expect(result.isError).toBeFalsy()
    const body = result.content.find(block => block.type === 'text')
    if (body?.type !== 'text') throw new Error('Missing chat-scoped status')
    return JSON.parse(body.text) as unknown
  }
  second.seen.length = 0
  await expect(read(a)).resolves.toMatchObject({ target: { name: 'first-app', state: 'bound' } })
  expect(second.seen).toEqual([])
  first.seen.length = 0
  await expect(read(b)).resolves.toMatchObject({ target: { name: 'second-app', state: 'bound' } })
  expect(first.seen).toEqual([])

  // Reuse the PID to verify process identity, not merely the PID shown in the picker.
  first.restart()
  await expect(Promise.all([read(a), read(b)])).resolves.toMatchObject([
    { target: { name: 'first-app', state: 'stale' } },
    { target: { name: 'second-app', state: 'bound' } },
  ])
  first.seen.length = 0
  await expect(read(a)).resolves.toMatchObject({ target: { state: 'stale' } })
  expect(first.seen).toEqual([])
  await expect(components.setChatTarget(a.id, first.choice(), signal)).resolves.toMatchObject({ state: 'bound' })
  await expect(components.setChatTarget(a.id, null, signal)).resolves.toBeNull()
  await expect(read(b)).resolves.toMatchObject({ target: { state: 'bound' } })
})
