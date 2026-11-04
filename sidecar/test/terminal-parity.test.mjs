import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';
import { TerminalSanitizer } from '../terminal-sanitize.mjs';
import { BoundedTextBuffer } from '../terminal-buffer.mjs';
import { readTerminalPage } from '../terminal-output.mjs';
import { runPersistentPwsh, capturedCommand, wrapPwsh } from '../persistent-shell.mjs';
import { TERMINAL_TOOLS } from '../terminal-tools.mjs';
import { jobOutput, jobKill } from '../workspace.mjs';
import { findNode } from '../executor.mjs';
const run = (name, args, ctx) => TERMINAL_TOOLS.find(tool => tool.name === name).run(args, ctx);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-terminal-parity-'));
  const root = path.join(base, 'workspace'), data = path.join(base, 'data'); fs.mkdirSync(root); fs.mkdirSync(data);
  const manager = new SessionManager({ userDataDir: data, getSettings: () => ({}), broadcast() {}, chromeMod: {}, titleGenerator: async () => '' });
  const folder = manager.workspaces.folder(root), project = manager.projects.save({ name: 'Terminal fixture', folders: [folder], primaryId: folder.id });
  const session = manager.create({ projectId: project.id }); session.mode = 'full-access';
  t.after(async () => { await manager.closeAll(); assert.equal(path.dirname(base), os.tmpdir()); assert.ok(path.basename(base).startsWith('dh-terminal-parity-')); fs.rmSync(base, { recursive: true, force: true }); });
  return { session, manager, root, ctx: () => session.toolCtx() };
}
test('upstream streaming sanitizer handles every control-sequence chunk boundary', () => {
  const source = 'one\r\n\x1b[31m彩色\x1b[0m\r\n\x1b]0;hidden-title\x1b\\tail\rnext\x07';
  for (let at = 0; at <= source.length; at++) {
    const sanitizer = new TerminalSanitizer(256);
    const output = sanitizer.push(source.slice(0, at)).text + sanitizer.push(source.slice(at)).text + sanitizer.flush();
    assert.equal(output, 'one\n彩色\ntail\nnext');
  }
  const bounded = new TerminalSanitizer(16);
  assert.equal(bounded.push('\x1b]' + 'x'.repeat(10000)).text, '');
  assert.equal(bounded.push('discarded\x07visible').text, 'visible');
});
test('upstream terminal buffer and newest-relative pages preserve Unicode and bounds', () => {
  const buffer = new BoundedTextBuffer(40, 4);
  buffer.append('discard\nline1\n'); buffer.append('😀中文\nline3\nline4');
  const snap = buffer.snapshot(); assert.equal(snap.truncated, true); assert.ok(Buffer.byteLength(snap.text) <= 40);
  const newest = readTerminalPage(snap, { count: 2 }); assert.equal(newest.text, 'line3\nline4');
  const older = readTerminalPage(snap, { offset: newest.lineEnd, count: 2 }); assert.match(older.text, /😀中文/);
  assert.equal(readTerminalPage(snap, { offset: 1000 }).text, '');
  assert.throws(() => readTerminalPage(snap, { count: 0 }), /count/);
});
test('completion marker requires real numeric status, never the echoed wrapper', () => {
  const marker = { start: 'START_NONCE', end: 'END_NONCE:' }, wrapper = wrapPwsh('echo "$x"\n`test', marker);
  assert.equal(capturedCommand(wrapper + '\n', marker, wrapper), undefined);
  assert.deepEqual(capturedCommand('START_NONCE\nresult\nEND_NONCE:-7\n', marker, wrapper), { text: 'result', incomplete: false, exitCode: -7 });
});
test('real persistent PowerShell preserves state, waits for completion and resets on timeout', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const f = fixture(t), context = f.ctx();
  const first = await runPersistentPwsh(context, '$parityValue = 41; $env:DH_PARITY_VALUE = "kept"; Write-Output "STATE_SET"', { timeoutMs: 15000 });
  assert.equal(first.isError, undefined, first.text); assert.match(first.text, /STATE_SET/);
  const second = await runPersistentPwsh(context, 'Write-Output ($parityValue + 1); Write-Output $env:DH_PARITY_VALUE; cmd /c exit 7', { timeoutMs: 15000 });
  assert.match(second.text, /42/); assert.match(second.text, /kept/); assert.match(second.text, /exit code: 7/);
  const third = await runPersistentPwsh(context, 'Write-Output "STATUS_FRESH"', { timeoutMs: 15000 });
  assert.match(third.text, /STATUS_FRESH/); assert.doesNotMatch(third.text, /exit code/);
  const before = Date.now(), slow = await runPersistentPwsh(context, 'Start-Sleep -Milliseconds 3400; Write-Output "DONE_AFTER_SILENCE"', { timeoutMs: 15000 });
  assert.ok(Date.now() - before >= 3400); assert.match(slow.text, /DONE_AFTER_SILENCE/);
  const timeout = await runPersistentPwsh(context, 'Start-Sleep -Seconds 10', { timeoutMs: 250 });
  assert.equal(timeout.isError, true); assert.match(timeout.text, /已重置/);
  const fresh = await runPersistentPwsh(context, 'Write-Output (Test-Path Env:DH_PARITY_VALUE); Write-Output (Get-Location).Path', { timeoutMs: 15000 });
  assert.match(fresh.text, /False/); assert.ok(fresh.text.includes(f.root), fresh.text);
  const exited = await runPersistentPwsh(context, 'exit 7', { timeoutMs: 15000 }); assert.match(exited.text, /shell exited: 7/);
  const restarted = await runPersistentPwsh(context, 'Write-Output "RESTARTED"', { timeoutMs: 15000 }); assert.match(restarted.text, /RESTARTED/);
  const listed = JSON.parse((await run('terminal_list', {}, context)).text); assert.equal(listed.length, 1);
  await run('terminal_close', { sessionId: listed[0].sessionId }, context);
  const afterClose = await runPersistentPwsh(context, 'Write-Output "AFTER_MANUAL_CLOSE"', { timeoutMs: 15000 }); assert.match(afterClose.text, /AFTER_MANUAL_CLOSE/);
});
test('headless PTY answers a real foreground terminal query without a UI client', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const f = fixture(t);
  const js = "process.stdin.setRawMode(true);process.stdin.resume();let input='';process.stdin.on('data',d=>{input+=d.toString();const m=/\\x1b\\[\\d+;\\d+R/.exec(input);if(m){console.log('PROTOCOL_OK:'+JSON.stringify(m[0]));process.exit(0)}});process.stdout.write(" + JSON.stringify('\x1b[6n') + ");setTimeout(()=>process.exit(9),3000)";
  const result = await runPersistentPwsh(f.ctx(), '& ' + quote(findNode()) + ' -e ' + quote(js), { timeoutMs: 20000 });
  assert.match(result.text, /PROTOCOL_OK/); assert.ok(result.text.includes('\\u001b['), result.text); assert.doesNotMatch(result.text, /exit code: 9/);
});
test('terminal sends authorize actual input, preserve ownership and support background jobs', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const f = fixture(t), ctx = f.ctx();
  const opened = JSON.parse((await run('terminal_open', { type: 'shell', name: 'owned' }, ctx)).text), id = opened.sessionId;
  assert.ok(id); assert.equal(opened.status.kind, 'running');
  const deniedFile = path.join(f.root, 'must-not-exist.txt'); let approvedCommand;
  f.session.mode = 'standard'; f.session.approve = async request => { approvedCommand = request.command; return false; };
  const denied = await run('terminal_send', { sessionId: id, text: 'Set-Content -LiteralPath ' + quote(deniedFile) + ' -Value wrong' }, f.ctx());
  assert.equal(denied.isError, true); assert.match(approvedCommand, /Set-Content/); assert.equal(fs.existsSync(deniedFile), false);
  f.session.mode = 'full-access';
  const task = JSON.parse((await run('terminal_send', { sessionId: id, text: 'Write-Output "BG_START"; Start-Sleep -Milliseconds 200; Write-Output "BG_DONE"', run_in_background: true }, ctx)).text);
  assert.equal(task.kind, 'background');
  assert.equal((await run('terminal_send', { sessionId: id, text: 'Write-Output wrong' }, ctx)).isError, true);
  const impostor = { ...ctx, terminals: { ...ctx.terminals } };
  assert.equal((await run('terminal_read', { sessionId: id }, impostor)).isError, true);
  const end = Date.now() + 15000; let output = '';
  while (Date.now() < end) { output += jobOutput(ctx, { id: task.jobId }).text; if (output.includes('BG_DONE') && output.includes('waitReason=')) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.match(output, /BG_START/); assert.match(output, /BG_DONE/);
  const page1 = JSON.parse((await run('terminal_read', { sessionId: id, offset: 0, count: 3 }, ctx)).text);
  const page2 = JSON.parse((await run('terminal_read', { sessionId: id, offset: 0, count: 3 }, ctx)).text);
  assert.equal(page1.text, page2.text);
  const background = JSON.parse((await run('terminal_send', { sessionId: id, text: 'Start-Sleep -Seconds 10', run_in_background: true }, ctx)).text);
  jobKill(ctx, { id: background.jobId });
  const close = await run('terminal_close', { sessionId: id }, ctx); assert.equal(close.isError, undefined, close.text);
  assert.equal(JSON.parse((await run('terminal_list', {}, ctx)).text).length, 0);
});
