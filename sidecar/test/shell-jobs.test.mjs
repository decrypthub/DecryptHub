import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellWorkspace, jobOutput, jobKill, killAllJobs } from '../workspace.mjs';
import { CollectedStream } from '../shell-process.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-shell-')); }
const nodeCmd = script => `node -e ${JSON.stringify(script)}`;

test('collected stream keeps the tail, splits consuming and offset reads, and spills', () => {
  const dir = tmp();
  const spill = path.join(dir, 'stdout.log');
  const stream = new CollectedStream({ maxChars: 8, spillPath: spill });
  stream.push('abcdefghij');
  stream.push('KLM');
  assert.equal(stream.tail, 'fghijKLM');
  assert.equal(stream.truncated, true);
  const lost = stream.readFrom(0);
  assert.equal(lost.lossy, true);
  assert.equal(lost.text, 'fghijKLM');
  assert.equal(lost.spillPath, spill);
  assert.equal(fs.readFileSync(spill, 'utf8'), 'abcdefghijKLM');
  const fresh = new CollectedStream({ maxChars: 100 });
  fresh.push('one');
  assert.equal(fresh.read().text, 'one');
  fresh.push('two');
  assert.equal(fresh.read().text, 'two');
  assert.equal(fresh.read().text, '');
  assert.equal(fresh.readFrom(0).text, 'onetwo');
});

test('foreground timeout promotes the command to a background job instead of killing it', { timeout: 20000 }, async () => {
  const dir = tmp();
  const script = "process.stdout.write('STILL\\n'); setInterval(()=>{}, 1000)";
  try {
    const started = Date.now();
    const result = await shellWorkspace(dir, { cmd: nodeCmd(script), timeoutMs: 1200 });
    assert.ok(Date.now() - started < 8000, '前台等待不应拖到进程自然结束');
    assert.equal(result.isError, undefined);
    assert.match(result.text, /转入后台/);
    assert.match(result.text, /没有被杀掉/);
    const id = result.text.match(/id=([a-f0-9-]+)/)?.[1];
    assert.ok(id);
    let polled = '';
    for (const deadline = Date.now() + 10000; Date.now() < deadline && !polled.includes('STILL');) {
      polled = jobOutput(dir, { id, tail: true }).text;
      if (!polled.includes('STILL')) await new Promise(r => setTimeout(r, 50));
    }
    assert.match(polled, /running/);
    assert.doesNotMatch(polled, /killed|timeout/);
    assert.match(polled, /STILL/);
    const killed = jobKill(dir, { id });
    assert.equal(killed.isError, undefined);
  } finally { killAllJobs(dir); }
});

test('job output is fenced to the owning session', { timeout: 20000 }, async () => {
  const dir = tmp();
  const script = "process.stdout.write('OWNED\\n'); setInterval(()=>{}, 1000)";
  const owner = { projectDir: dir, sessionId: 'session-a' };
  const other = { projectDir: dir, sessionId: 'session-b' };
  try {
    const started = await shellWorkspace(owner, { cmd: nodeCmd(script), background: true });
    const id = started.text.match(/id=([a-f0-9-]+)/)?.[1];
    assert.ok(id);
    assert.equal(jobOutput(other, { id }).isError, true);
    assert.match(jobOutput(other, { id }).text, /没有这个后台任务/);
    assert.equal(jobKill(other, { id }).isError, true);
    let own = '';
    for (const deadline = Date.now() + 10000; Date.now() < deadline && !own.includes('OWNED');) {
      own = jobOutput(owner, { id, tail: true }).text;
      if (!own.includes('OWNED')) await new Promise(r => setTimeout(r, 50));
    }
    assert.match(own, /OWNED/);
  } finally { killAllJobs(dir); }
});

test('stdout and stderr stay distinguishable after the command exits', { timeout: 20000 }, async () => {
  const dir = tmp();
  const script = "process.stdout.write('OUT'); process.stderr.write('ERR')";
  const result = await shellWorkspace(dir, { cmd: nodeCmd(script), timeoutMs: 15000 });
  assert.match(result.text, /OUT/);
  assert.match(result.text, /\[stderr\]\nERR/);
  assert.equal(result.isError, false);
});
