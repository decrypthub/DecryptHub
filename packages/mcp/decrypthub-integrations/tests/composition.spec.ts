/** Official management and volatile configuration through an actual profile Loader. */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { initProfile, mountRootInclude, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import McpManager from '@deepseek-ai/dsh-mcp-manager'
import Components from '@deepseek-ai/dsh-decrypthub-components'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as SessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as ProductMemory from '@deepseek-ai/dsh-product-memory'
import * as ProductSessions from '@deepseek-ai/dsh-tool-product-sessions'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node'
import { z } from 'zod'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { PeerId, Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { strToU8, zipSync } from 'fflate'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Integration from '../src/index.ts'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

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

async function mountProfile(devices: Partial<Record<'adh' | 'idh', { endpoint: string; devices: string[] }>> = {},
  options: { wdhEnabled?: boolean; wdhEntry?: string; componentFeed?: string; home?: string; workspaceTools?: boolean } = {}) {
  const home = options.home ?? await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'decrypthub-profile-')))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    if (options.home === undefined) await fs.rm(home, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(UserQuestionService)
  const dir = join(home, 'profile'), bundle = join(dir, 'node_modules', 'test-official-components')
  if (options.home === undefined) initProfile(dir, ['test-official-components'])
  await fs.mkdir(bundle, { recursive: true })
  await fs.writeFile(join(home, 'package.json'), '{"name":"component-test"}')
  await fs.writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-official-components', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await fs.writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'mcp-manager', name: 'cordis:test-mcp' },
    { id: 'components', name: 'cordis:test-components', config: { directory: join(home, 'components'), componentFeed: options.componentFeed } },
    { id: 'decrypthub-integrations', name: 'cordis:test-integrations', inject: ['decrypthubComponents'], config: {
      wdh: { enabled: options.wdhEnabled ?? false, dataDirectory: join(home, 'browser'),
        browser: 'system', entry: options.wdhEntry ?? (options.wdhEnabled ? '' : fileURLToPath(new URL('./fixture-server.ts', import.meta.url))) },
      ...devices,
    } },
    ...(options.workspaceTools ? [
      { id: 'product-memory', name: 'cordis:test-product-memory' },
      { id: 'tool-product-sessions', name: 'cordis:test-product-sessions' },
    ] : []),
  ] }]))
  await fs.writeFile(join(dir, 'cordis.yml'), '[]')
  const profile: ProfileContext = { name: 'desktop', startedBundles: ['test-official-components'], dir,
    patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
  ctx.baseUrl = pathToFileURL(home).href + '/'
  ctx.provide('profileContext', profile)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(home, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  if (options.workspaceTools) {
    await ctx.plugin(SessionPersistence, { root: join(home, 'sessions'), compression: 'none' })
    await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
    await ctx.plugin(WorkspaceRegistry)
  }
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins['test-mcp'] = McpManager
  ctx.loader.builtins['test-components'] = Components
  ctx.loader.builtins['test-integrations'] = Integration
  ctx.loader.builtins['test-product-memory'] = ProductMemory
  ctx.loader.builtins['test-product-sessions'] = ProductSessions
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await mountRootInclude(ctx, join(dir, 'cordis.yml'), readProfilePatches('test', profile))
  await ctx.loader.await()
  return { ctx, harness, home, profile }
}

const fixtureConfig = {
  transport: 'stdio', command: process.execPath,
  args: [fileURLToPath(new URL('./fixture-server.ts', import.meta.url)), 'chat-added'],
} as const

const realWdhEntry = process.env.DECRYPTHUB_WDH_COMPONENT_ENTRY
it.skipIf(realWdhEntry === undefined)('reads response and initiating frames through the Desktop profile’s owning WDH connection', async () => {
  if (realWdhEntry === undefined) throw new Error('Set DECRYPTHUB_WDH_COMPONENT_ENTRY to run the capture profile smoke')
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'decrypthub-wdh-capture-')))
  const launcher = join(home, 'capture.mjs')
  await fs.writeFile(launcher, `process.argv.push('--headless'); await import(${JSON.stringify(pathToFileURL(realWdhEntry).href)});\n`)
  initProfile(join(home, 'profile'), ['test-official-components'])
  const { ctx, harness } = await mountProfile({}, { home, wdhEnabled: true, wdhEntry: launcher })
  const site = createServer((req, res) => {
    if (req.url === '/sample') {
      res.setHeader('Content-Type', 'text/plain')
      return res.end('capture fixture response')
    }
    res.setHeader('Content-Type', 'text/html')
    res.end('<script>function loadSample() { return fetch("/sample").then(response => response.text()); } loadSample();</script>')
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => {
    site.closeAllConnections()
    await new Promise<void>(resolve => site.close(() => resolve()))
    await ctx.fiber.dispose()
    await fs.rm(home, { recursive: true, force: true })
  })
  const address = site.address()
  if (address === null || typeof address === 'string') throw new Error('Capture fixture has no TCP address')
  const origin = `http://127.0.0.1:${address.port}`
  const a = await harness.create(SessionId('capture-owner'), {}, { cwd: home })
  const b = await harness.create(SessionId('capture-other-chat'), {}, { cwd: home })
  const signal = AbortSignal.timeout(30_000)
  expect(ctx.tools.get('mcp__wdh__wdh_control', a)).toBeUndefined()
  const opened = await executeToolFixture(ctx, { agent: a, name: 'mcp__wdh__browser_open',
    arguments: { url: origin }, callId: ToolCallId('capture-open'), signal })
  expect(opened).toMatchObject({ isError: false })
  const readCapture = async () => {
    const list = await ctx.decrypthubComponents.wdhCaptureList(a.id, signal)
    const row = list.requests.find(row => row.url === origin + '/sample')
    if (row === undefined) return null
    const selection = { generation: list.generation, id: row.id }
    return { selection, detail: await ctx.decrypthubComponents.wdhCaptureDetail(a.id, selection, signal) }
  }
  await expect.poll(readCapture).toMatchObject({ detail: {
    body: { text: 'capture fixture response' },
    frames: expect.arrayContaining([expect.objectContaining({ functionName: 'loadSample' })]),
  } })
  const capture = await readCapture()
  if (capture === null) throw new Error('The captured sample disappeared')
  await expect(ctx.decrypthubComponents.wdhCaptureDetail(b.id, capture.selection, signal)).resolves.toBeNull()
  await expect(caller(ctx, { kind: 'test-component-guest' }).decrypthubComponents.wdhCaptureList(a.id, signal)).rejects.toThrow('owner')
  expect(ctx.tools.get('mcp__wdh__get_request_initiator', a)).toBeUndefined()
}, 45_000)

async function askToAdd(ctx: Context, agent: Agent, args: object) {
  return executeToolFixture(ctx, { name: 'mcp_add', arguments: args, agent,
    signal: new AbortController().signal, callId: ToolCallId('mcp-add-test') })
}

function callChunks(name: string, args: object): StreamChunk[] {
  const id = ToolCallId(name)
  const json = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

it('uses one Workspace account for the loaded history and memory plugins', async () => {
  const { ctx, harness, home } = await mountProfile({}, { workspaceTools: true })
  const firstPath = join(home, 'first'), secondPath = join(home, 'second')
  await Promise.all([fs.mkdir(firstPath), fs.mkdir(secondPath)])
  const first = await ctx.workspaceRegistry.create(firstPath, 'First')
  const second = await ctx.workspaceRegistry.create(secondPath, 'Second')
  const a = await harness.create(SessionId('workspace-chat-a'), {}, { cwd: first.path })
  const b = await harness.create(SessionId('workspace-chat-b'), {}, { cwd: second.path })
  const outside = await harness.create(SessionId('workspace-chat-outside'), {}, { cwd: first.path })
  await first.attachSession(a.id)
  await second.attachSession(b.id)
  await first.detachSession(outside.id)
  const signal = new AbortController().signal
  const run = (agent: Agent, name: string, args: unknown = {}) => executeToolFixture(ctx,
    { signal, agent, callId: ToolCallId(`${agent.id}-${name}`), name, arguments: args })

  await expect(run(a, 'session_list')).resolves.toMatchObject({ value: { sessions: [{ id: a.id }] } })
  await expect(run(a, 'session_read', { id: b.id })).resolves.toMatchObject({ isError: true })
  await expect(run(outside, 'session_list')).resolves.toMatchObject({ isError: true })
  const saved = await run(a, 'memory_write', { scope: 'project', text: 'Use the sample project configuration.' })
  expect(saved).toMatchObject({ isError: false, value: { scope: 'project' } })
  const row = ctx.settings.describe().find(candidate => candidate.ns === 'product-memory')
  expect(Object.values((row?.value as { entries: Record<string, unknown> }).entries))
    .toMatchObject([{ workspaceId: first.id, workspace: first.path }])
  await expect(run(b, 'memory_list')).resolves.toMatchObject({ value: { entries: [] } })
  const prompt = async (agent: Agent) => (await ctx.systemPrompt.assemble({ agent, scope: agent })).sections.map(section => section.text).join('\n')
  expect(await prompt(a)).toContain('Use the sample project configuration.')
  expect(await prompt(b)).not.toContain('Use the sample project configuration.')
  expect(await prompt(outside)).not.toContain('Use the sample project configuration.')
})

it('exposes newly installed WDH to the next model request in an already open or newly opened chat', async () => {
  const feed = 'https://components.example.test/'
  const { ctx, harness, home } = await mountProfile({}, { wdhEnabled: true, componentFeed: feed })
  const opened = await harness.create(SessionId('wdh-open-before-install'), { provider: 'test', model: 'model' }, { cwd: home })
  expect(ctx.tools.get('mcp__wdh__workspace', opened)).toBeUndefined()

  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  const version = '1.0.0'
  const filename = `wdh-${version}-${process.platform}-${process.arch}.zip`
  const entry = strToU8(`import ${JSON.stringify(new URL('./fixture-server.ts', import.meta.url).href)}\n`)
  const archive = Uint8Array.from(zipSync({
    'entry.mjs': entry,
    'component.json': strToU8(JSON.stringify({
      manifestVersion: 1, apiVersion: 1, id: 'wdh', version, runtime: 'node', entrypoint: 'entry.mjs',
      platform: process.platform, arch: process.arch, source: { repository: 'decrypthub/WebDecryptHub', commit: 'a'.repeat(40) },
      files: [{ path: 'entry.mjs', size: entry.length, sha256: digest(entry) }],
    })),
  }))
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === feed + 'index.json') return Response.json({ version: 1, components: { wdh: {
      name: filename, version, size: archive.length, sha256: digest(archive),
    } } })
    if (url === feed + filename) return new Response(archive)
    throw new Error('Unexpected component fixture request')
  })
  onTestFinished(() => { fetch.mockRestore() })
  ctx.decrypthubComponents.installComponent('wdh', version)
  await expect.poll(async () => {
    const snapshot = await ctx.decrypthubComponents.snapshot()
    const wdh = snapshot.components.find(row => row.id === 'wdh')
    return [wdh?.installed?.version, wdh?.operation?.phase]
  }, { timeout: 5_000 }).toEqual([version, undefined])

  const requests: GenerateOptions[] = []
  class Adapter extends LlmAdapter {
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(options)
      if (requests.length % 2 === 1) yield* callChunks('mcp__wdh__workspace', {})
      else yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['test'], new Adapter()))
  const later = await harness.create(SessionId('wdh-open-after-install'), { provider: 'test', model: 'model' }, { cwd: home })
  for (const agent of [opened, later]) {
    requests.length = 0
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Read the installed WDH workspace.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(requests[0]?.tools?.map(tool => tool.name)).toContain('mcp__wdh__workspace')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toMatchObject([
      { data: { step: 1, message: { isError: false, content: [{ type: 'text' }] } } },
    ])
  }
}, 15_000)

it('confirms a local MCP once, saves it, and calls its live tool in the next step of the same turn', async () => {
  const { ctx, harness, home, profile } = await mountProfile()
  const agent = await harness.create(SessionId('chat-add'), { provider: 'test', model: 'model' }, { cwd: home })
  const config = { ...fixtureConfig, cwd: home }
  const source = 'https://github.com/example/mcp-server'
  const confirm = vi.fn(async (request: { questions: { id: string; detail?: string }[] }) => {
    const question = request.questions[0]!
    expect(question.detail).toContain(source)
    expect(question.detail).toContain('chat-added')
    expect(ctx.mcpManager.list()).toEqual([])
    return { answers: [{ id: question.id, selected: ['Add and connect'] }] }
  })
  ctx.on('user-questions/request', confirm)
  const requests: GenerateOptions[] = []
  class Adapter extends LlmAdapter {
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(options)
      if (requests.length === 1) yield* callChunks('mcp_add', { name: 'fixture', config, source })
      else if (requests.length === 2) yield* callChunks('mcp__fixture__workspace', {})
      else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Done' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['test'], new Adapter()))
  agent.followup(createUserMessage({ content: [{ type: 'text', text: `Add ${source} and call its workspace tool.` }], source: { kind: 'user' } }))
  await agent.whenIdle()

  expect(confirm).toHaveBeenCalledOnce()
  expect(requests).toHaveLength(3)
  expect(requests[0]?.tools?.map(tool => tool.name)).not.toContain('mcp__fixture__workspace')
  expect(requests[1]?.tools?.map(tool => tool.name)).toContain('mcp__fixture__workspace')
  const events = agent.session.snapshotEvents()
  expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
  const results = events.filter(event => event.type === 'tool/result')
  expect(results).toMatchObject([
    { data: { step: 1, message: { isError: false } } },
    { data: { step: 2, message: { isError: false, content: [{ text: JSON.stringify({ cwd: home, args: ['chat-added'] }) }] } } },
  ])
  expect(JSON.stringify(results[0]?.data.message.content)).toContain('Discovered 1 tool')
  expect(await fs.readFile(profile.patchPath, 'utf8')).toContain('command:')
  expect(ctx.mcpManager.list()).toMatchObject([{ name: 'fixture', configured: true, status: { state: 'connected', toolCount: 1 } }])
})

it.each([
  { name: 'fixture', config: { transport: 'streamable-http', url: 'https://github.com/example/mcp' } },
  { name: 'fixture', config: { ...fixtureConfig, env: { __jsExpr: 'process.exit(1)' } } },
  { name: 'fixture', config: { transport: 'streamable-http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer value' } } },
  { name: 'wdh', config: fixtureConfig },
])('rejects invalid MCP input before asking or writing', async (args) => {
  const { ctx, harness, home } = await mountProfile()
  const agent = await harness.create(SessionId('chat-invalid'), {}, { cwd: home })
  const confirm = vi.fn()
  ctx.on('user-questions/request', confirm)
  await expect(askToAdd(ctx, agent, args)).resolves.toMatchObject({ isError: true, error: { info: { code: 'INVALID_ARGS' } } })
  expect(confirm).not.toHaveBeenCalled()
  expect(ctx.mcpManager.list()).toEqual([])
})

it('does not save or start a server the user declines', async () => {
  const { ctx, harness, home } = await mountProfile()
  const agent = await harness.create(SessionId('chat-decline'), {}, { cwd: home })
  ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected: ['Cancel'] }] }))
  await expect(askToAdd(ctx, agent, { name: 'fixture', config: fixtureConfig })).resolves.toMatchObject({
    isError: true, error: { info: { code: 'APPROVAL_REJECTED' } },
  })
  expect(ctx.mcpManager.list()).toEqual([])
})

it('connects a Streamable HTTP endpoint only after confirmation and discovers its real tools', async () => {
  const { ctx, harness, home } = await mountProfile()
  const agent = await harness.create(SessionId('chat-http'), {}, { cwd: home })
  const handler = toNodeHandler(createMcpHandler(() => {
    const mcp = new McpServer({ name: 'chat-http', version: '1.0.0' })
    mcp.registerTool('ping', { inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: 'pong' }] }))
    return mcp
  }))
  const seen = vi.fn((request: IncomingMessage, response: ServerResponse) => {
    void handler(request as NodeIncomingMessageLike, response).catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  const server = createServer(seen)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(() => { server.close(); server.closeAllConnections() })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing MCP fixture address')
  const url = `http://127.0.0.1:${address.port}/mcp`
  ctx.on('user-questions/request', async ({ questions }) => {
    expect(questions[0]!.detail).toContain(url)
    expect(seen).not.toHaveBeenCalled()
    return { answers: [{ id: questions[0]!.id, selected: ['Add and connect'] }] }
  })
  const result = await askToAdd(ctx, agent, { name: 'remote', config: { transport: 'streamable-http', url } })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).toContain('Discovered 1 tool')
  expect(seen).toHaveBeenCalled()
  expect(ctx.tools.get('mcp__remote__ping', agent)).toBeDefined()
})

it('keeps an approved entry visible when its connection cannot start', async () => {
  const { ctx, harness, home } = await mountProfile()
  const agent = await harness.create(SessionId('chat-unavailable'), {}, { cwd: home })
  ctx.on('user-questions/request', async ({ questions }) => ({ answers: [{ id: questions[0]!.id, selected: ['Add and connect'] }] }))
  const config = { transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer ${credential:MCP_TEST_TOKEN}' } }
  await expect(askToAdd(ctx, agent, { name: 'remote', config })).resolves.toMatchObject({
    isError: true, error: { info: { code: 'MCP_ADD_CONNECTION_FAILED' } },
  })
  expect(ctx.mcpManager.list()).toMatchObject([{ name: 'remote', configured: true, status: { state: 'failed' } }])
})

it('does not overwrite a configuration saved from settings while the chat is waiting for approval', async () => {
  const { ctx, harness, home } = await mountProfile()
  const agent = await harness.create(SessionId('chat-race'), {}, { cwd: home })
  ctx.on('user-questions/request', async ({ questions }) => {
    await ctx.settings.mutate('mcp-manager', [{ op: 'set', path: ['servers', 'fixture'],
      value: { transport: 'streamable-http', url: 'https://example.com/mcp', enabled: false } }])
    return { answers: [{ id: questions[0]!.id, selected: ['Add and connect'] }] }
  })
  await expect(askToAdd(ctx, agent, { name: 'fixture', config: fixtureConfig })).resolves.toMatchObject({
    isError: true, error: { info: { code: 'MCP_ADD_SETTINGS_CONFLICT' } },
  })
  expect(ctx.mcpManager.config.servers.get().fixture).toMatchObject({ transport: 'streamable-http', enabled: false })
})

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

// Multiple real stdio clients start and stop on this path.
it.each(['adh', 'idh'] as const)('routes each %s chat to its chosen device and rejects a restarted process', { timeout: 90_000 }, async (component) => {
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

it.each(['adh', 'idh'] as const)('restores the %s chat target and its read-only guard in a new Host', async (component) => {
  const [first, second] = await Promise.all([openDevice(component, 'original'), openDevice(component, 'other')])
  const devices = { [component]: { endpoint: second.base, devices: [first.base, second.base] } }
  const sessionId = SessionId('restored-chat')
  const clearedId = SessionId('cleared-chat')
  const signal = new AbortController().signal
  const cli = fileURLToPath(new URL('./fixture-device-cli.ts', import.meta.url))
  const installFixture = (ctx: Context, home: string): void => {
    vi.spyOn(ctx.decrypthubComponents, 'runtime').mockImplementation(async (_id, _command, args) =>
      ({ command: process.execPath, args: [cli, ...args], env: {}, cwd: home }))
  }

  const initial = await mountProfile(devices)
  installFixture(initial.ctx, initial.home)
  await initial.harness.create(sessionId, {}, { cwd: initial.home })
  await initial.harness.create(clearedId, {}, { cwd: initial.home })
  await initial.ctx.decrypthubComponents.setChatTarget(sessionId, first.choice(), signal)
  await initial.ctx.decrypthubComponents.setChatTarget(clearedId, second.choice(), signal)
  await initial.ctx.decrypthubComponents.setChatTarget(clearedId, null, signal)
  await initial.ctx.fiber.dispose()

  const reopened = await mountProfile(devices, { home: initial.home })
  try {
    installFixture(reopened.ctx, reopened.home)
    const agent = await reopened.harness.create(sessionId, {}, { cwd: reopened.home })
    await expect(reopened.ctx.decrypthubComponents.chatTarget(clearedId, signal)).resolves.toBeNull()
    await expect(reopened.ctx.decrypthubComponents.chatTarget(sessionId, signal)).resolves.toMatchObject({ name: 'original', state: 'bound' })

    const marker = vi.fn(async () => 'fixture')
    const name = `mcp__${component}__fixture_marker`
    reopened.ctx.effect(() => reopened.ctx.tools.register(defineTool({
      name, description: 'Report a fixture marker.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: marker,
    })))
    const checkGuard = async () => executeToolFixture(reopened.ctx,
      { signal, agent, callId: ToolCallId('restored-guard'), name, arguments: {} })
    const denied = { isError: true, error: { info: { code: 'CHAT_TARGET_STATUS_ONLY' } } }
    await expect(checkGuard()).resolves.toMatchObject(denied)

    first.restart()
    second.seen.length = 0
    const status = await executeToolFixture(reopened.ctx,
      { signal, agent, callId: ToolCallId('restored-status'), name: 'decrypthub_status', arguments: {} })
    expect(status.isError).toBe(false)
    expect(JSON.parse(String(status.value))).toMatchObject({ target: { name: 'original', state: 'stale' }, scope: 'chat' })
    expect(second.seen).toEqual([])
    await expect(checkGuard()).resolves.toMatchObject(denied)
    expect(marker).not.toHaveBeenCalled()
  } finally {
    await reopened.ctx.fiber.dispose()
  }
}, 15_000)
