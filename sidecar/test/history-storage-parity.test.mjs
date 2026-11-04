import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { History } from '../history.mjs';
import { readHistoryStorage, HISTORY_STORAGE_VERSION } from '../history-store.mjs';
import { compressFrame } from '../history-zstd.mjs';
import { WriterLease } from '../writer-lease.mjs';
import { Agent } from '../agent.mjs';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-storage-parity-')), handles = [], file = path.join(root, '.agent-history.json');
  t.after(() => { for (const h of handles) h.close(); assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('dh-storage-parity-')); fs.rmSync(root, { recursive: true, force: true }); });
  const own = h => (handles.push(h), h);
  return { root, file, own, load: () => own(History.load(file, 'system')) };
}
test('JSON predecessor is retained exactly; new commits append without rewriting committed bytes', t => {
  const f = fixture(t), legacy = Buffer.from('\uFEFF' + JSON.stringify({ v: 2, events: [{ t: 'user', content: 'legacy 中文', at: 1 }] })); fs.writeFileSync(f.file, legacy);
  const h = f.load(); h.onAppend = () => assert.equal(h.save(f.file), true, h.lastSaveError?.message);
  h.append({ t: 'assistant', content: 'first answer', at: 2 });
  const first = readHistoryStorage(f.file), bytes = fs.readFileSync(first.generation);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).v, HISTORY_STORAGE_VERSION);
  const backup = fs.readdirSync(path.join(f.root, '.history')).find(name => name.startsWith('legacy-')); assert.deepEqual(fs.readFileSync(path.join(f.root, '.history', backup)), legacy);
  h.append({ t: 'turn-end', stop: 'completed', at: 3 });
  const next = readHistoryStorage(f.file); assert.equal(first.generation, next.generation); assert.deepEqual(fs.readFileSync(next.generation).subarray(0, bytes.length), bytes); assert.equal(next.raw.events.length, 3);
  assert.throws(() => History.fromJSON(JSON.parse(fs.readFileSync(f.file))), /版本/);
  assert.throws(() => { h.events[0].content = 'mutated'; }, TypeError);
  h.close(); assert.deepEqual(f.load().events, h.events);
});
test('only a torn final record is recoverable; read never truncates, next writer repairs before appending', t => {
  const f = fixture(t), first = f.load(); first.events = [{ t: 'user', content: '完整😀', at: 1 }]; assert.equal(first.save(f.file), true); first.close();
  const source = readHistoryStorage(f.file), goodSize = fs.statSync(source.generation).size; fs.appendFileSync(source.generation, compressFrame('{"seq":1,"event":{"content":"partial').subarray(0,6));
  const raw = readHistoryStorage(f.file); assert.equal(raw.tornTail, true); assert.equal(raw.committedBytes, goodSize); assert.equal(raw.raw.events.length, 1); assert.ok(fs.statSync(source.generation).size > goodSize);
  const h = f.load(); h.onAppend = () => assert.equal(h.save(f.file), true, h.lastSaveError?.message); h.append({ t: 'assistant', content: 'recovered' }); h.close();
  assert.equal(readHistoryStorage(f.file).tornTail, false); assert.equal(f.load().events[1].content, 'recovered');
  fs.appendFileSync(source.generation, compressFrame('{not-json}\n')); assert.throws(() => f.load(), /损坏/);
});
test('resets publish a successor; damaged pointers and outside changes never fall back or overwrite', t => {
  const f = fixture(t), h = f.load(); h.onAppend = () => assert.equal(h.save(f.file), true, h.lastSaveError?.message);
  h.append({ t: 'user', content: 'old generation' }); const old = readHistoryStorage(f.file), bytes = fs.readFileSync(old.generation);
  h.reset(); h.append({ t: 'user', content: 'new generation' }); const next = readHistoryStorage(f.file);
  assert.notEqual(next.generation, old.generation); assert.deepEqual(fs.readFileSync(old.generation), bytes);
  fs.appendFileSync(next.generation, compressFrame('{"seq":99,"event":{"t":"user"}}\n')); assert.equal(h.save(f.file), false); assert.match(h.lastSaveError.message, /变化/); h.close(); assert.throws(() => f.load(), /序号/);
  fs.writeFileSync(f.file, '{"v":4,"storage":"decrypthub-history-jsonl","generation":"../escape","id":"' + 'a'.repeat(32) + '"}'); assert.throws(() => f.load(), /指针/);
});
test('a stale read handle cannot overwrite a newer generation and another live writer is refused', t => {
  const f = fixture(t), initial = new History({ events: [{ t: 'user', content: 'old' }] }); assert.equal(initial.save(f.file), true);
  const stale = f.load(), fresh = f.load(); fresh.onAppend = () => assert.equal(fresh.save(f.file), true); fresh.append({ t: 'assistant', content: 'new' });
  assert.equal(stale.save(f.file), false); assert.equal(stale.lastSaveError.code, 'SESSION_ALREADY_OWNED'); fresh.close();
  assert.equal(stale.save(f.file), false); assert.match(stale.lastSaveError.message, /更新/); assert.equal(f.load().events.length, 2);
});
test('a failed absent-file observation stays stale on retry and a closed handle never writes again', t => {
  const f = fixture(t), stale = f.load(), fresh = new History({ events: [{ t: 'user', content: 'new owner' }] }); assert.equal(fresh.save(f.file), true);
  for (let i = 0; i < 2; i++) { assert.equal(stale.save(f.file), false); assert.match(stale.lastSaveError.message, /更新/); }
  const current = f.load(); current.close();
  for (let i = 0; i < 2; i++) { assert.equal(current.save(f.file), false); assert.match(current.lastSaveError.message, /关闭/); }
  assert.equal(f.load().events[0].content, 'new owner');
});
test('incremental scanning preserves long records and Unicode across 64 KiB chunk boundaries', t => {
  const f = fixture(t), text = '中文😀'.repeat(30000), h = new History({ events: [{ t: 'user', content: text, at: 1 }] }); assert.equal(h.save(f.file), true);
  assert.equal(f.load().events[0].content, text);
});
test('the OS releases the writer lease after process death without a stale PID timeout', async t => {
  const f = fixture(t), moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, '../writer-lease.mjs')).href;
  const code = `const {WriterLease}=await import(${JSON.stringify(moduleUrl)});const lease=new WriterLease(${JSON.stringify(f.root)});process.send('ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore','ignore','pipe','ipc'], windowsHide: true });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(Error('Lease child exited ' + code))); });
  assert.throws(() => new WriterLease(f.root), error => error.code === 'SESSION_ALREADY_OWNED');
  const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended;
  const lease = new WriterLease(f.root); lease.close();
});
test('restart logs unknown outcomes and never replays interrupted tools', async t => {
  const f = fixture(t), hist = new History({ events: [
    { t: 'user', turnId: 'r', content: 'do work', at: 1 },
    { t: 'assistant', turnId: 'r', at: 2, calls: [{ id: 'c', itemId: 'i', name: 'dangerous', args: {} }] },
    { t: 'system', turnId: 'r', id: 'c', itemId: 'i', at: 3, source: { kind: 'tool-call-start' } },
  ] }); assert.equal(hist.save(f.file), true);
  let invoked = 0;
  const agent = new Agent({ projectDir: f.root, getSettings: () => ({ openai: { apiKey: 'fixture', model: 'fixture' } }), tools: [{ name: 'dangerous', run: () => { invoked++; } }], mcp: { tools: [], has: () => false }, browser: null, emit() {} });
  f.own(agent.hist); agent.restore(); f.own(agent.hist);
  assert.equal(invoked, 0); assert.equal(agent.hist.events.at(-1).stop, 'interrupted');
  assert.equal(agent.hist.events.find(e => e.t === 'tool').error.code, 'TOOL_OUTCOME_UNKNOWN');
  assert.match(JSON.stringify(agent.messages), /不能盲目重放/);
  const count = agent.hist.events.length; agent.hist.close(); agent.restore(); f.own(agent.hist); assert.equal(agent.hist.events.length, count);
});
