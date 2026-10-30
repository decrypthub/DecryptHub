import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTitle, promptTitle, generateSessionTitle, SessionTitleService } from '../session-titles.mjs';
import { TestSessionManager as SessionManager } from './project-fixture.mjs';
import { sessionLabel } from '../../ui/src/state.js';
const settings = { provider: 'openai', openai: { baseUrl: 'https://model.invalid/v1', model: 'fixture', apiKey: 'fixture-key' } };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function manager(t, generator) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-titles-'));
  const mgr = new SessionManager({ userDataDir: directory, getSettings: () => settings, broadcast() {}, chromeMod: {}, titleGenerator: generator });
  t.after(async () => { await mgr.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); }); return mgr;
}
test('titles summarize the user task and never fall back to the current URL', () => {
  assert.equal(sessionLabel({ title: '会话 1', url: 'https://example.com' }), '会话 1');
  assert.match(promptTitle('分析 https://example.com/login 登录流程'), /分析.*登录流程/);
  assert.equal(promptTitle('https://example.com'), '分析网页任务');
  assert.equal(cleanTitle('“定位接口签名算法”'), '定位接口签名算法');
  assert.equal(cleanTitle('https://example.com'), '');
});
test('title request has no tools, bounded output, only the first task and cancellation', async () => {
  let seen;
  const value = await generateSessionTitle(settings, '分析登录接口', { complete: async (...args) => { seen = args; return { content: '定位登录请求签名' }; } });
  assert.equal(value, '定位登录请求签名'); assert.deepEqual(seen[2], []); assert.equal(seen[0].openaiMaxTokens, 256);
  assert.equal(JSON.parse(seen[1][1].content).task, '分析登录接口'); assert.ok(seen[3].signal);
  let calls = 0; await assert.rejects(generateSessionTitle(settings, 'x', { signal: AbortSignal.abort(), complete: async () => { calls++; } })); assert.equal(calls, 0);
});
test('manual rename wins over a late model result and survives restore', async t => {
  const pending = deferred(), mgr = manager(t, () => pending.promise), s = mgr.focused();
  const job = s.suggestTitle('分析 https://example.com 的登录签名');
  assert.equal(s.titleSource, 'prompt'); assert.ok(!s.title.includes('example.com'));
  s.rename('我的登录分析'); pending.resolve('模型晚到的标题'); await job;
  assert.equal(s.title, '我的登录分析'); assert.equal(s.titleSource, 'manual');
  const restored = new SessionManager({ userDataDir: mgr.userDataDir, getSettings: () => settings, broadcast() {}, chromeMod: {}, titleGenerator: () => { throw Error('must not rename'); } });
  t.after(() => restored.closeAll()); assert.equal(restored.focused().title, '我的登录分析'); assert.equal(restored.focused().titleSource, 'manual');
});
test('title deadline bounds transports which ignore cancellation', async t => {
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  await assert.rejects(generateSessionTitle(settings, '任务', { timeoutMs: 5, complete: () => new Promise(() => {}) }), error => error.name === 'TimeoutError');
});
test('generated title is persisted and generated only once; failure retains a task label', async t => {
  let calls = 0; const mgr = manager(t, async () => { calls++; return '定位网页登录签名'; }), s = mgr.focused();
  await s.suggestTitle('研究登录签名'); await s.suggestTitle('后续补充'); assert.equal(calls, 1); assert.equal(s.titleSource, 'model');
  const raw = JSON.parse(fs.readFileSync(mgr.stateFile, 'utf8')); assert.equal(raw.sessions[0].title, '定位网页登录签名'); assert.equal(raw.sessions[0].titleSource, 'model');
  const other = mgr.create({}); mgr.titleGenerator = async () => { throw Error('fixture network failure'); };
  await other.suggestTitle('修复任务执行错误'); assert.equal(other.title, '修复任务执行错误'); assert.equal(other.titleSource, 'prompt');
});
test('closing a chat cancels title generation and prevents a late mutation', async t => {
  const pending = deferred(); let signal; const mgr = manager(t, (_s, _p, options) => { signal = options.signal; return pending.promise; }), s = mgr.create({});
  const job = s.suggestTitle('研究网站登录'); await Promise.resolve(); await mgr.close(s.id);
  assert.equal(signal.aborted, true); pending.resolve('不能写回的标题'); await job; assert.notEqual(s.title, '不能写回的标题');
});
test('metadata requests are bounded in concurrency and queued cancellation does not call the model', async () => {
  const pending = [], service = new SessionTitleService({ concurrency: 1, generate: async () => { const job = deferred(); pending.push(job); return job.promise; } });
  const first = service.generate(settings, 'first'); await Promise.resolve();
  const controller = new AbortController(), cancelled = service.generate(settings, 'cancelled', { signal: controller.signal });
  const denied = assert.rejects(cancelled); controller.abort(); await denied;
  const second = service.generate(settings, 'second'); assert.equal(pending.length, 1);
  pending[0].resolve('one'); await first; await new Promise(r => setImmediate(r));
  assert.equal(pending.length, 2); pending[1].resolve('two'); assert.equal(await second, 'two');
});
