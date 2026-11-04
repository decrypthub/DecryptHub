import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Agent } from '../agent.mjs';
import { DEFAULT_TOOLS } from '../catalog.mjs';
import { PlanMode } from '../plan-mode.mjs';
import { ChangeStore, contentHash } from '../changes.mjs';
import { ExtensionStore } from '../extensions.mjs';
import { ResearchAgents } from '../subagents.mjs';
import { completeAnthropic, toAnthropicMessages } from '../providers/anthropic.mjs';
import { completeOpenAI } from '../providers/openai.mjs';
import { History } from '../history.mjs';
import { historyEvents } from '../../ui/src/conversation.js';
import { applyGoalOperation } from '../goal-tools.mjs';
import { searchWorkspace } from '../workspace-search.mjs';
import { patchWorkspace } from '../workspace-patch.mjs';
import { AgentTerminal, waitForTerminal } from '../agent-terminal.mjs';
import { SessionManager } from '../sessions.mjs';
import { readRef } from '../context.mjs';
import { Executor, privateProcessEnv, shellSpec } from '../executor.mjs';
import { createGoal, finishGoalRound } from '../goals.mjs';
import { InstructionContext, appendContext } from '../agent-context.mjs';
import { resolveProvider } from '../providers/index.mjs';
import { captureSelection, selectionSettings } from '../model-selection.mjs';
import { generateSessionTitle } from '../session-titles.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-parity-'));
  const root = path.join(base, 'workspace'), data = path.join(base, 'private');
  fs.mkdirSync(root); fs.mkdirSync(data);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const settings = { provider: 'openai', openai: { apiKey: 'fixture', model: 'fixture', contextWindow: 100000 }, maxSteps: 0, tokenBudget: 0 };
  const ctx = { workRoot: root, projectDir: data, protectedRoot: data, projectId: 'project', sessionId: 'session', workspaceId: 'workspace', workspaceKind: 'folder', mode: 'full-access', readHashes: new Map(), changes: new ChangeStore(data) };
  ctx.extensions = new ExtensionStore({ directory: data, getSettings: () => settings });
  const plan = new PlanMode(null); ctx.getPlan = () => plan.snapshot(); ctx.planMode = plan; ctx.planBoundary = () => plan.boundary();
  const agent = chatFn => new Agent({ projectDir: data, getSettings: () => settings, tools: DEFAULT_TOOLS.filter(t => !t.component && !t.name.startsWith('browser_')),
    getMode: () => ctx.mode, getPlan: ctx.getPlan, getWorkspace: () => ({ id: ctx.workspaceId, root }), getToolContext: () => ctx,
    mcp: { tools: [], has: () => false }, emit: () => {}, chatFn });
  return { root, data, ctx, plan, settings, agent };
}
const answer = content => ({ content, toolCalls: [] });
const call = (name, args) => ({ content: '', toolCalls: [{ id: Math.random().toString(), name, args }] });

test('real tool loop loads nested rules, notices updates, and keeps user input separate', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'src'));
  fs.writeFileSync(path.join(f.root, 'AGENTS.md'), 'ROOT-RULE');
  fs.writeFileSync(path.join(f.root, 'src', 'CLAUDE.md'), 'NESTED-V1');
  fs.writeFileSync(path.join(f.root, 'src', 'file.txt'), 'hello');
  let step = 0;
  const agent = f.agent(async (_, messages) => {
    const wire = JSON.stringify(messages);
    assert.match(wire, /ROOT-RULE/);
    if (step === 0) { step++; return call('workspace_read', { path: 'src/file.txt' }); }
    if (step === 1) { assert.match(wire, /NESTED-V1/); fs.writeFileSync(path.join(f.root, 'src', 'CLAUDE.md'), 'NESTED-V2'); step++; return call('workspace_read', { path: 'src/file.txt' }); }
    assert.match(wire, /NESTED-V2/); return answer('done');
  });
  assert.equal((await agent.send('Investigate files')).stop, 'completed');
  assert.equal(agent.hist.events.find(e => e.t === 'user').content, 'Investigate files');
  const restored = History.load(agent.histFile(), 'system');
  assert.ok(restored.events.some(e => e.source?.kind === 'runtime-context'));
  assert.ok(!historyEvents(restored.events).some(e => /NESTED-V2|当前运行环境快照/.test(e.content || '')));
  const resumed = f.agent(async (_, messages) => { assert.match(JSON.stringify(messages), /NESTED-V2/); return answer('resumed'); });
  resumed.restore(); await resumed.send('Continue from restored state');
  assert.match(resumed.hist.events.findLast(e => e.source?.kind === 'agent-instructions').content, /NESTED-V2/);
});

test('unavailable instruction reads retain the last durable rules instead of declaring them removed', t => {
  const f = fixture(t); let unavailable = false;
  const read = (dir, name) => path.resolve(dir) === path.resolve(f.root) && name === 'AGENTS.md'
    ? unavailable ? { kind: 'unavailable' } : { kind: 'present', file: path.join(dir, name), content: 'DO-NOT-LOSE-THIS-RULE' } : { kind: 'absent' };
  const first = new InstructionContext({ read }), history = new History({ system: '' });
  appendContext(history, 'agent-instructions', first.render(f.ctx), 'turn', first.snapshotMeta());
  unavailable = true;
  const restored = new InstructionContext({ read }); restored.restore(History.fromJSON(history.toJSON()), f.ctx);
  assert.match(restored.render(f.ctx), /DO-NOT-LOSE-THIS-RULE/); assert.equal(restored.complete, false);
});

test('a plan selection made before lazy Agent restoration wins over an older history event', async t => {
  const f = fixture(t), options = { userDataDir: f.data, getSettings: () => f.settings, broadcast: () => {}, chromeMod: {} };
  const first = new SessionManager(options), folder = first.workspaces.folder(f.root), project = first.projects.save({ name: 'project', folders: [folder], primaryId: folder.id });
  const session = first.create({ projectId: project.id }); session.ensureAgent(); session.planMode.select(true); session.planMode.select(false);
  await first.closeAll();
  const resumed = new SessionManager(options), next = resumed.get(session.id); assert.ok(!next.agent);
  next.planMode.select(true); next.ensureAgent(); assert.equal(next.planMode.active, true);
  await resumed.closeAll();
});

test('plan approval stays active for the current tool batch and commits before next request', async t => {
  const f = fixture(t); f.plan.select(true);
  let step = 0, checked = false;
  const agent = f.agent(async (_, messages) => {
    if (step++ === 0) {
      assert.match(messages[0].content, /【计划模式】/);
      return { content: '', toolCalls: [{ id: 'exit', name: 'exit_plan_mode', args: { plan: '# Plan\nInspect then implement.' } }, { id: 'probe', name: 'probe_plan', args: {} }] };
    }
    assert.doesNotMatch(messages[0].content, /【计划模式】/); return answer('implemented');
  });
  agent.ask = async () => ({ status: 'answered', answer: '批准计划并实施' });
  agent.localTools.push({ name: 'probe_plan', risk: 'read', schema: { type: 'object', properties: {} }, run: () => { checked = f.plan.active; return { text: 'checked' }; } });
  assert.equal((await agent.send('Plan this task')).stop, 'completed');
  assert.equal(checked, true); assert.equal(f.plan.active, false);
  assert.ok(agent.allTools().some(t => t.name === 'exit_plan_mode'));
  assert.equal(new PlanMode(f.plan.snapshot()).active, false);
});

test('filesystem skill discovery supports YAML, resources, invocation policy and deletion', t => {
  const f = fixture(t), directory = path.join(f.root, '.agents', 'skills', 'review'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'SKILL.md');
  fs.writeFileSync(file, '---\nname: review\ndescription: >\n  Review project\n  with evidence.\ndisable-model-invocation: true\n---\nUse references.md.');
  const listed = f.ctx.extensions.list('skill', f.ctx).find(s => s.name === 'review');
  assert.match(listed.description, /Review project with evidence/);
  assert.equal(f.ctx.extensions.loadSkill('review', f.ctx), null);
  assert.match(f.ctx.extensions.loadSkill('review', f.ctx, { user: true }).content, /Use references/);
  fs.unlinkSync(file);
  assert.equal(f.ctx.extensions.loadSkill('review', f.ctx, { user: true }), null);
});

test('project skill precedence is resolved before invocation policy, including a nested workspace', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, '.git'));
  const project = path.join(f.root, '.agents', 'skills', 'same'); fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'SKILL.md'), '---\nname: same\ndescription: Project rule\ndisable-model-invocation: true\n---\nProject body.');
  f.ctx.extensions.write('skill', { name: 'same', scope: 'user', content: '---\nname: same\ndescription: User rule\n---\nUser body.' }, f.ctx);
  const nested = path.join(f.root, 'src'); fs.mkdirSync(nested); const ctx = { ...f.ctx, workRoot: nested };
  assert.equal(f.ctx.extensions.list('skill', ctx).filter(skill => skill.name === 'same').length, 1);
  assert.equal(f.ctx.extensions.loadSkill('same', ctx), null);
  assert.match(f.ctx.extensions.loadSkill('same', ctx, { user: true }).content, /Project body/);
});

test('deep search finds real files and edit rejects a version changed outside the Agent', async t => {
  const f = fixture(t), deep = path.join(...Array.from({ length: 13 }, (_, i) => 'd' + i));
  fs.mkdirSync(path.join(f.root, deep), { recursive: true });
  fs.writeFileSync(path.join(f.root, deep, 'one.ts'), 'needle\nneedle');
  fs.writeFileSync(path.join(f.root, '.env'), 'needle-secret');
  const search = await searchWorkspace(f.ctx, { pattern: 'needle', max: 1 });
  assert.match(search.text, /内容匹配 2 项/); assert.doesNotMatch(search.text, /needle-secret/);
  assert.match((await searchWorkspace(f.ctx, { pattern: '**/*.{js,ts}' }, true)).text, /one.ts/);
  const agent = f.agent(async () => answer('ok'));
  assert.equal((await agent.runTool('workspace_read', { path: deep + '/one.ts' })).isError, undefined);
  fs.writeFileSync(path.join(f.root, deep, 'one.ts'), 'external\nneedle');
  const edited = await agent.runTool('workspace_edit', { path: deep + '/one.ts', old_string: 'needle', new_string: 'changed' });
  assert.equal(edited.isError, true); assert.match(fs.readFileSync(path.join(f.root, deep, 'one.ts'), 'utf8'), /external\nneedle/);
});

test('workspace_read streams past a giant line and reads large-file middle lines with the complete version hash', async t => {
  const f = fixture(t), agent = f.agent(async () => answer('ok')), file = path.join(f.root, 'large.txt');
  const content = 'x'.repeat(12 * 1024 * 1024) + '\n目标行\nlast\n'; fs.writeFileSync(file, content);
  const middle = await agent.runTool('workspace_read', { path: 'large.txt', offset: 2, limit: 1 });
  assert.equal(middle.isError, undefined); assert.match(middle.text, /2: 目标行/); assert.match(middle.text, /共 3 行/);
  assert.equal(f.ctx.readHashes.get(file), contentHash(content));
  const first = await agent.runTool('workspace_read', { path: 'large.txt', limit: 1 });
  assert.match(first.text, /本行已截断/); assert.ok(first.text.length < 3000);
});

test('ripgrep respects ignore files for content search, includes ignored paths for glob, and retains capped results', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, '.git')); fs.mkdirSync(path.join(f.root, 'ignored'));
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'ignored/\n');
  fs.writeFileSync(path.join(f.root, 'ignored', 'hidden.ts'), 'needle');
  fs.writeFileSync(path.join(f.root, 'visible.ts'), 'needle\nneedle\nneedle');
  fs.writeFileSync(path.join(f.root, '.env.example'), 'EXAMPLE=needle'); fs.writeFileSync(path.join(f.root, '.env.local'), 'PRIVATE=needle');
  const grep = await searchWorkspace(f.ctx, { pattern: 'needle', glob: '*.ts', max: 1 });
  assert.match(grep.text, /内容匹配 3 项/); assert.doesNotMatch(grep.text, /hidden\.ts|EXAMPLE|PRIVATE/);
  const reference = grep.text.match(/ctx_[0-9a-f]{10}/)?.[0]; assert.ok(reference); assert.match(readRef(path.join(f.data, '.ctx'), reference).text, /visible.ts:3/);
  assert.match((await searchWorkspace(f.ctx, { pattern: '**/*.ts' }, true)).text, /hidden.ts/);
  const examples = await searchWorkspace(f.ctx, { pattern: 'needle', glob: '.env.*' });
  assert.match(examples.text, /EXAMPLE=needle/); assert.doesNotMatch(examples.text, /PRIVATE/);
  await assert.rejects(searchWorkspace(f.ctx, { pattern: '(', literal: false }), /搜索未完成/);
});

test('delegated Agent inherits captured permission and model, writes files and resumes its history', async t => {
  const f = fixture(t); let calls = 0, inheritedModel;
  const manager = new ResearchAgents({ directory: f.data, context: () => f.ctx, settings: () => f.settings,
    createAgent: options => new Agent({ ...options, chatFn: async settings => { inheritedModel = settings.openai.model; return calls++ === 0 ? call('workspace_write', { path: 'child.txt', content: 'delegated' }) : answer('done'); } }),
  });
  const started = manager.spawn('Write child.txt'); f.ctx.mode = 'read-only';
  await manager.join();
  assert.equal(fs.readFileSync(path.join(f.root, 'child.txt'), 'utf8'), 'delegated');
  assert.equal(inheritedModel, 'fixture'); assert.equal(manager.records[0].access, 'full-access');
  manager.message(started.id, 'Report the result'); await manager.join();
  assert.ok(manager.resumable.get(started.id).hist.events.filter(e => e.t === 'user').length >= 2);
  manager.cancelAll();
});

test('goal tools enforce exact revisions, human authority and the blocked-round threshold', () => {
  const goal = applyGoalOperation(null, { operation: 'create', objective: 'Finish project' }, { directHuman: true, workspaceId: 'w' });
  assert.equal(goal.maxTurns, 256);
  assert.throws(() => applyGoalOperation(goal, { goal_id: goal.id, revision: 0, action: 'complete' }, { directHuman: true }), /revision/);
  assert.throws(() => applyGoalOperation(goal, { goal_id: goal.id, revision: goal.revision, action: 'blocked', blocked_reason: 'missing input' }, { goalRound: true }), /3/);
  const complete = applyGoalOperation(goal, { goal_id: goal.id, revision: goal.revision, action: 'complete' }, { goalRound: true });
  assert.equal(complete.status, 'complete');
});

test('model and thinking selections are independent per chat and survive restart', async t => {
  const f = fixture(t);
  f.settings.providers = [{ id: 'p1', type: 'openai', baseUrl: 'https://first.invalid/v1', apiKey: 'key1', models: [{ id: 'first', thinking: { levels: ['low', 'high'], default: 'low' } }] },
    { id: 'p2', type: 'anthropic', baseUrl: 'https://second.invalid', apiKey: 'key2', models: [{ id: 'second', thinking: { levels: ['low', 'high'], default: 'high' } }] }];
  Object.assign(f.settings, { activeProviderId: 'p1', activeModel: 'first' });
  const options = { userDataDir: f.data, getSettings: () => f.settings, broadcast: () => {}, chromeMod: { findChrome: () => [] } };
  const manager = new SessionManager(options), folder = manager.workspaces.folder(f.root);
  const project = manager.projects.save({ name: 'project', folders: [folder], primaryId: folder.id });
  const first = manager.create({ projectId: project.id }), second = manager.create({ projectId: project.id });
  second.setModel({ providerId: 'p2', model: 'second', thinking: 'high' });
  assert.equal(first.requestSettings().activeModel, 'first');
  assert.equal(second.requestSettings().activeModel, 'second'); assert.equal(second.requestSettings().anthropic.apiKey, 'key2');
  f.settings.activeProviderId = 'p2'; f.settings.activeModel = 'second';
  assert.equal(first.requestSettings().activeProviderId, 'p1');
  await manager.closeAll();
  const resumed = new SessionManager(options);
  assert.equal(resumed.get(second.id).requestSettings().activeThinking, 'high');
  f.settings.providers = [];
  assert.equal(resumed.get(second.id).requestSettings().anthropic.apiKey, '');
  await resumed.closeAll();
});

test('provider effort mapping reaches HTTP verbatim and rejected effort never silently downgrades', async t => {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk; const body = JSON.parse(data); bodies.push(body);
    if (body.model === 'reject') { res.writeHead(400); res.end('{"error":{"message":"Unsupported parameter reasoning_effort"}}'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const settings = { provider: 'openai', activeThinking: 'high', openai: { baseUrl: 'http://127.0.0.1:' + server.address().port, apiKey: 'fixture', model: 'deepseek-custom',
    thinking: { levels: ['off', 'high'], transport: 'effort', wireValues: { off: 'none', high: 'vendor-max' } } } };
  await resolveProvider(settings).complete([{ role: 'user', content: 'hello' }], []);
  assert.equal(bodies[0].reasoning_effort, 'vendor-max'); assert.equal(bodies[0].thinking, undefined);
  await assert.rejects(resolveProvider({ ...settings, openai: { ...settings.openai, model: 'reject' } }).complete([{ role: 'user', content: 'hello' }], []), /思考配置/);
  assert.equal(bodies.length, 2);
});

test('legacy chat captures its model instead of following later global defaults', () => {
  const settings = { provider: 'openai', openai: { model: 'original', apiKey: 'fixture' } }, selection = captureSelection(settings);
  const projected = selectionSettings({ ...settings, provider: 'anthropic', openai: { ...settings.openai, model: 'changed' }, anthropic: { model: 'other' } }, selection);
  assert.equal(projected.provider, 'openai'); assert.equal(projected.openai.model, 'original');
});

test('title generation never inherits the chat thinking budget or model output cap', async () => {
  let cfg;
  await generateSessionTitle({ provider: 'anthropic', anthropic: { apiKey: 'fixture', baseUrl: 'https://fixture.invalid', maxTokens: 16000, thinking: { transport: 'budget', level: 'high' } } }, 'task',
    { complete: async settings => { cfg = resolveProvider(settings).cfg; return answer('Title'); } });
  assert.equal(cfg.maxTokens, 256); assert.equal(cfg.requestPurpose, 'session-title');
});

for (const provider of ['openai', 'anthropic']) test(provider + ' keeps tool images visible in the actual HTTP request without splitting a tool batch', async t => {
  let request;
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk; request = JSON.parse(data);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events = provider === 'openai' ? [{ choices: [{ delta: { content: 'seen' }, finish_reason: 'stop' }] }]
      : [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'seen' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }];
    res.end(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const cfg = { baseUrl: 'http://127.0.0.1:' + server.address().port, apiKey: 'fixture', model: 'vision' };
  const messages = [{ role: 'user', content: 'Inspect' }, { role: 'assistant', content: '', tool_calls: ['one', 'two'].map(id => ({ id, type: 'function', function: { name: 'inspect', arguments: '{}' } })) },
    { role: 'tool', tool_call_id: 'one', name: 'inspect', content: [{ type: 'text', text: 'first result' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }] },
    { role: 'tool', tool_call_id: 'two', name: 'inspect', content: 'second result' }];
  await (provider === 'openai' ? completeOpenAI : completeAnthropic)(cfg, messages, []);
  if (provider === 'openai') {
    assert.deepEqual(request.messages.map(m => m.role), ['user', 'assistant', 'tool', 'tool', 'user']);
    assert.equal(request.messages[2].content, 'first result'); assert.equal(request.messages[4].content[1].image_url.url, 'data:image/png;base64,AQID');
  } else {
    const outputs = request.messages.at(-1).content; assert.equal(outputs[0].type, 'tool_result');
    assert.equal(outputs[0].content[1].source.data, 'AQID'); assert.equal(outputs[1].tool_use_id, 'two');
  }
});

test('multi-file patches preflight all hunks and deletion remains undoable', async t => {
  const f = fixture(t), agent = f.agent(async () => answer('ok'));
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(f.root, 'b.txt'), 'keep\n');
  await agent.runTool('workspace_read', { path: 'a.txt' }); await agent.runTool('workspace_read', { path: 'b.txt' });
  const rejected = patchWorkspace(f.ctx, '*** Begin Patch\n*** Update File: a.txt\n@@\n-one\n+changed\n*** Update File: b.txt\n@@\n-missing\n+replacement\n*** End Patch');
  assert.equal(rejected.isError, true); assert.equal(fs.readFileSync(path.join(f.root, 'a.txt'), 'utf8'), 'one\ntwo\n');
  const success = patchWorkspace(f.ctx, '*** Begin Patch\n*** Update File: a.txt\n*** Move to: moved.txt\n@@\n-one\n+changed\n*** Delete File: b.txt\n*** Add File: new.txt\n+new\n*** End Patch');
  assert.equal(success.isError, undefined); assert.equal(fs.readFileSync(path.join(f.root, 'moved.txt'), 'utf8'), 'changed\ntwo\n');
  assert.equal(fs.existsSync(path.join(f.root, 'a.txt')), false); assert.equal(fs.existsSync(path.join(f.root, 'b.txt')), false);
  const removal = f.ctx.changes.items.find(e => e.path === 'b.txt');
  f.ctx.changes.undo(removal.id, { id: f.ctx.workspaceId, root: f.root });
  assert.equal(fs.readFileSync(path.join(f.root, 'b.txt'), 'utf8'), 'keep\n');
});

test('a parent joins its delegated work before producing the final answer', async t => {
  const f = fixture(t); let parent, step = 0;
  const children = new ResearchAgents({ directory: f.data, context: () => f.ctx, settings: () => f.settings,
    onSettled: record => parent.queueNotice('child settled: ' + record.summary),
    createAgent: options => new Agent({ ...options, chatFn: async () => { await new Promise(r => setTimeout(r, 30)); return answer('child evidence'); } }),
  });
  f.ctx.subagents = children;
  parent = f.agent(async () => step++ === 0 ? call('agent_spawn', { task: 'Inspect' }) : answer(step === 2 ? 'premature' : 'verified final'));
  assert.equal((await parent.send('Investigate')).stop, 'completed');
  assert.equal(children.jobs.size, 0); assert.equal(parent.hist.events.findLast(e => e.t === 'assistant').content, 'verified final');
  children.cancelAll();
});

test('Anthropic thinking signatures survive an actual two-request HTTP tool loop and stay route-scoped', async t => {
  let requests = 0, replayed;
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data); requests++;
    if (requests === 2) replayed = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).find(b => b.type === 'thinking');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
    send({ type: 'message_start', message: { usage: { input_tokens: 10 } } });
    if (requests === 1) {
      send({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
      send({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'inspect' } });
      send({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-proof' } });
      send({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'read', name: 'probe', input: {} } });
      send({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } });
    } else send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } });
    send({ type: 'message_delta', delta: { stop_reason: requests === 1 ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 10 } });
    send({ type: 'message_stop' }); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const cfg = { baseUrl: 'http://127.0.0.1:' + server.address().port, apiKey: 'fixture', model: 'claude-fixture' };
  const result = await completeAnthropic(cfg, [{ role: 'user', content: 'inspect' }], [], {});
  const hist = new History({ system: 'system' }); hist.append({ t: 'user', content: 'inspect' });
  hist.append({ t: 'assistant', content: result.content, reasoning: result.reasoning, nativeReplay: result.nativeReplay, calls: result.toolCalls });
  hist.append({ t: 'tool', id: 'read', name: 'probe', content: 'observed' });
  await completeAnthropic(cfg, History.fromJSON(hist.toJSON()).view(), [], {});
  assert.deepEqual(replayed, { type: 'thinking', thinking: 'inspect', signature: 'signed-proof' });
  assert.ok(!JSON.stringify(toAnthropicMessages(hist.view(), 'another-model')).includes('signed-proof'));
  assert.ok(!JSON.stringify(toAnthropicMessages(hist.view(), cfg.model, 'https://another-route.invalid')).includes('signed-proof'));
});

test('dismissed plan review concludes the turn without implementation or a repeated request', async t => {
  const f = fixture(t); f.plan.select(true); let calls = 0;
  const agent = f.agent(async () => { calls++; return { content: '', toolCalls: [
    { id: 'review', name: 'exit_plan_mode', args: { plan: '# Plan\nWait for acceptance.' } },
    { id: 'write', name: 'workspace_write', args: { path: 'should-not-exist.txt', content: 'forbidden' } },
  ] }; });
  agent.ask = async () => ({ status: 'skipped' });
  assert.equal((await agent.send('Plan only')).stop, 'completed');
  assert.equal(calls, 1); assert.equal(f.plan.active, true);
  assert.equal(fs.existsSync(path.join(f.root, 'should-not-exist.txt')), false);
});

test('OpenAI reasoning replay is retained on its own route and removed after switching provider', async t => {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    bodies.push(JSON.parse(data)); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok', reasoning_content: 'private reasoning' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const cfg = { baseUrl: 'http://127.0.0.1:' + server.address().port, model: 'fixture', providerId: 'first', apiKey: 'fixture' };
  const result = await completeOpenAI(cfg, [{ role: 'user', content: 'hello' }], []);
  const messages = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: result.content, reasoning_content: result.reasoning, _nativeReplay: result.nativeReplay }, { role: 'user', content: 'continue' }];
  await completeOpenAI(cfg, messages, []); await completeOpenAI({ ...cfg, providerId: 'second' }, messages, []);
  assert.equal(bodies[1].messages[1].reasoning_content, 'private reasoning');
  assert.equal(bodies[2].messages[1].reasoning_content, undefined);
  assert.ok(!JSON.stringify(bodies).includes('_nativeReplay'));
});

test('delegated usage includes descendants exactly once on each continuation', async t => {
  const f = fixture(t), settled = [];
  const manager = new ResearchAgents({ directory: f.data, context: () => f.ctx, settings: () => f.settings,
    onUsage: record => settled.push(structuredClone(record.usage)),
    createAgent: options => { let step = 0; return new Agent({ ...options, chatFn: async () => {
      const depth = options.getToolContext().delegationDepth;
      const result = depth === 1 && step++ === 0 ? call('agent_spawn', { task: 'Nested inspection' }) : answer('evidence');
      return { ...result, usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } }); },
  });
  const record = manager.spawn('Delegate one nested inspection'); await manager.join();
  assert.equal(settled.length, 1); assert.equal(settled[0].prompt, 21); assert.equal(settled[0].completion, 9);
  manager.message(record.id, 'Continue without delegation'); await manager.join();
  assert.equal(settled[1].prompt, 7); assert.equal(settled[1].completion, 3); manager.cancelAll();
});

test('patches preserve UTF-8 BOM and target EOF when identical lines occur earlier', async t => {
  const f = fixture(t), agent = f.agent(async () => answer('ok'));
  const file = path.join(f.root, 'bom.txt'); fs.writeFileSync(file, '\uFEFFsame\nmiddle\nsame\n');
  await agent.runTool('workspace_read', { path: 'bom.txt' });
  const result = patchWorkspace(f.ctx, '*** Begin Patch\n*** Update File: bom.txt\n@@\n-same\n+last\n*** End of File\n*** End Patch');
  assert.equal(result.isError, undefined); assert.equal(fs.readFileSync(file, 'utf8'), '\uFEFFsame\nmiddle\nlast\n');
});

test('goal continuation does not declare blockage merely because one round used no tools', () => {
  const goal = createGoal('Investigate', 'w'); goal.turns = 1;
  const next = finishGoalRound(goal, { stop: 'completed', usage: {} }, { automatic: true, hasWork: false });
  assert.equal(next.status, 'active'); assert.equal(next.maxTurns, 256);
  const limited = finishGoalRound({ ...next, turns: 256 }, { stop: 'completed' });
  assert.equal(limited.status, 'paused');
});

test('real shell profile paths resolve inside private execution storage rather than workspace', async t => {
  const f = fixture(t), env = privateProcessEnv(f.data);
  assert.ok(path.isAbsolute(env.APPDATA)); assert.ok(path.isAbsolute(env.LOCALAPPDATA));
  if (process.platform !== 'win32') return;
  const executor = new Executor(); t.after(() => executor.dispose());
  const job = executor.start({ ...shellSpec('[Console]::WriteLine($env:APPDATA); [Console]::WriteLine($env:LOCALAPPDATA)'), cwd: f.root }, { dataDir: f.data });
  const result = await job.done; assert.equal(result.code, 0);
  assert.match(result.out, /AppData[\\/]Roaming/); assert.match(result.out, /AppData[\\/]Local/);
  assert.equal(fs.existsSync(path.join(f.root, 'Microsoft')), false);
});

test('terminal output remains readable after scrollback rotates and waits honour cancellation', async () => {
  let snapshot = { output: '12345', outputOffset: 0, status: 'running' };
  const terminal = new AgentTerminal({ session: { terminals: { snapshot: () => snapshot } }, id: 't', cwd: '.' });
  assert.equal(terminal.drain().delta, '12345');
  snapshot = { output: '67890', outputOffset: 5, status: 'running' };
  assert.equal(terminal.drain().delta, '67890');
  const controller = new AbortController(); setTimeout(() => controller.abort(), 20);
  await assert.rejects(waitForTerminal(terminal, { waitMs: 5000, signal: controller.signal }), /abort/i);
});

test('a prompt-shaped terminal output is only an idle hint, not proof of a pending stdin read', async () => {
  const terminal = new AgentTerminal({ session: { terminals: { snapshot: () => ({ output: 'ordinary output > ', status: 'running' }) } }, id: 't', cwd: '.' });
  const result = await waitForTerminal(terminal, { idleMs: 5, waitMs: 200 });
  assert.equal(result.reason, 'inferred_idle'); assert.equal(result.promptHint, true);
});

test('failed history restoration never publishes a writable empty Agent on a second attempt', async t => {
  const f = fixture(t), manager = new SessionManager({ userDataDir: f.data, getSettings: () => f.settings, broadcast: () => {}, chromeMod: {} });
  const folder = manager.workspaces.folder(f.root), project = manager.projects.save({ name: 'project', folders: [folder], primaryId: folder.id });
  const session = manager.create({ projectId: project.id }), file = path.join(session.projectDir, '.agent-history.json');
  for (const source of ['{broken JSON', JSON.stringify({ v: 999, events: [{ t: 'user', content: 'important' }] })]) {
    fs.writeFileSync(file, source);
    assert.throws(() => session.ensureAgent(), /记录|版本/); assert.ok(!session.agent);
    assert.throws(() => session.ensureAgent(), /记录|版本/); assert.equal(fs.readFileSync(file, 'utf8'), source);
  }
  await manager.closeAll();
});
