import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editWorkspace, grepWorkspace, shellWorkspace, jobOutput, jobKill, killAllJobs, childEnv, workspaceFileSize, listDirectory } from '../workspace.mjs';
import { decideTool } from '../policy.mjs';
import { Agent } from '../agent.mjs';
import { SessionManager } from '../sessions.mjs';
import { DEFAULT_TOOLS as LOCAL_TOOLS } from '../catalog.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-ws-')); }
test('directory browsing is shallow, includes empty folders and rejects escaped or linked paths', () => {
  const dir = tmp(), root = path.join(dir, 'workspace'); fs.mkdirSync(path.join(root, 'src/empty'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/main.js'), 'source'); fs.writeFileSync(path.join(root, 'README.md'), 'readme'); fs.writeFileSync(path.join(root, '.env'), 'fixture-secret');
  fs.symlinkSync(os.tmpdir(), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const first = listDirectory(dir); assert.deepEqual(first.entries.map(e => e.name), ['src', 'README.md']);
  const nested = listDirectory(dir, 'src'); assert.deepEqual(nested.entries.map(e => e.name), ['empty', 'main.js']);
  assert.equal(listDirectory(dir, 'src/empty').entries.length, 0);
  assert.throws(() => listDirectory(dir, '../'), /越界|outside|范围/);
  assert.throws(() => listDirectory(dir, 'linked'), /链接|link/);
});
function write(dir, rel, text) {
  const p = path.join(dir, 'workspace', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

test('workspace_edit requires a unique match and can replace all', () => {
  const dir = tmp();
  const file = write(dir, 'sign.js', 'const a = alpha;\nconst b = alpha;\n');
  const dup = editWorkspace(dir, { path: 'sign.js', old_string: 'alpha', new_string: 'beta' });
  assert.equal(dup.isError, true);
  assert.match(dup.text, /不是唯一匹配/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'const a = alpha;\nconst b = alpha;\n');
  const all = editWorkspace(dir, { path: 'sign.js', old_string: 'alpha', new_string: 'beta', replace_all: true });
  assert.equal(all.isError, undefined);
  assert.match(all.text, /2 处/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'const a = beta;\nconst b = beta;\n');
  const miss = editWorkspace(dir, { path: 'sign.js', old_string: 'no-such-token', new_string: 'x' });
  assert.equal(miss.isError, true);
  assert.match(miss.text, /未找到/);
  const one = editWorkspace(dir, { path: 'sign.js', old_string: 'const a = beta;', new_string: 'const a = gamma;' });
  assert.equal(one.isError, undefined);
  assert.match(fs.readFileSync(file, 'utf8'), /const a = gamma;/);
  const outside = editWorkspace(dir, { path: '../outside.js', old_string: 'a', new_string: 'b' });
  assert.equal(outside.isError, true);
});

test('workspace_grep respects glob and path', () => {
  const dir = tmp();
  write(dir, 'a.js', 'function sign(){ return 1 }\n');
  write(dir, 'nested/b.js', 'const sign = 2;\n');
  write(dir, 'note.txt', 'sign in text\n');
  const js = grepWorkspace(dir, { pattern: 'sign', glob: '*.js' });
  assert.equal(js.isError, undefined);
  assert.match(js.text, /a\.js:1:/);
  assert.match(js.text, /nested\/b\.js:1:/);
  assert.doesNotMatch(js.text, /note\.txt/);
  const sub = grepWorkspace(dir, { pattern: 'sign', path: 'nested', glob: '*.js' });
  assert.match(sub.text, /b\.js:1:/);
  assert.doesNotMatch(sub.text, /a\.js/);
  const none = grepWorkspace(dir, { pattern: 'not-present-xyz' });
  assert.equal(none.text, '无匹配');
  assert.equal(grepWorkspace(dir, { pattern: '(' }).isError, true);
});

test('child env never receives WDH_LLM_API_KEY', () => {
  const env = childEnv({ PATH: '/usr/bin', WDH_LLM_API_KEY: 'wdh-secret-value', OPENAI_API_KEY: 'sk-test', HOME: '/tmp' });
  assert.equal(env.WDH_LLM_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.HOME, undefined);
  assert.equal('WDH_LLM_API_KEY' in env, false);
});

test('workspace_shell background job can be polled and killed', { timeout: 40000 }, async () => {
  const dir = tmp();
  const script = "require('fs').writeSync(1,'READY\\n'); setInterval(()=>{},1000)";
  try {
    const started = await shellWorkspace(dir, { cmd: `node -e ${JSON.stringify(script)}`, background: true });
    assert.equal(started.isError, undefined);
    const id = started.text.match(/id=([a-f0-9-]+)/)?.[1];
    assert.ok(id);
    let seen = '';
    for (const deadline = Date.now() + 15000; Date.now() < deadline && !seen.includes('READY');) {
      seen = jobOutput(dir, { id }).text;
      if (!seen.includes('READY')) await new Promise(r => setTimeout(r, 50));
    }
    assert.match(seen, /READY/);
    assert.match(seen, /running/);
    const killed = jobKill(dir, { id });
    assert.equal(killed.isError, undefined);
    let after = '';
    for (const deadline = Date.now() + 15000; Date.now() < deadline && !/killed|exit /.test(after);) {
      after = jobOutput(dir, { id }).text;
      if (!/killed|exit /.test(after)) await new Promise(r => setTimeout(r, 50));
    }
    assert.match(after, /killed|exit /);
    assert.equal(jobKill(dir, { id: 'missing' }).isError, true);
  } finally { killAllJobs(dir); }
});

test('workspace_shell does not pass WDH_LLM_API_KEY to the child', async () => {
  const dir = tmp();
  const prev = process.env.WDH_LLM_API_KEY;
  process.env.WDH_LLM_API_KEY = 'wdh-secret-value';
  try {
    const script = "process.stdout.write(process.env.WDH_LLM_API_KEY||'EMPTY')";
    const r = await shellWorkspace(dir, { cmd: `node -e ${JSON.stringify(script)}`, timeoutMs: 15000 });
    assert.equal(String(r.text).includes('wdh-secret-value'), false);
    assert.match(r.text, /EMPTY/);
    assert.equal(r.isError, false);
  } finally {
    if (prev == null) delete process.env.WDH_LLM_API_KEY; else process.env.WDH_LLM_API_KEY = prev;
    killAllJobs(dir);
  }
});
