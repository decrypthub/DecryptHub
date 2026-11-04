// 终端等待语义：参考 DSH `terminal/terminal/src/types.ts` 的 TerminalWaitReason。
// 关键点是把「为什么把控制权还给你」作为一等结果——模型必须能区分
// 「程序在等我输入」和「命令真的卡死了」，否则只能靠 timeout 硬等，交互式任务无法完成。
import test from 'node:test';
import assert from 'node:assert/strict';
import { WAIT_REASONS, looksLikeStdinRead, classifyWait, tailViewport, stripAnsi } from '../agent-terminal.mjs';

test('stripAnsi 剥离真实 PTY 输出里的控制序列', () => {
  // 这是 2026-11-02 真实链路验收抓到的实际字节（PowerShell 提示符）
  const raw = '\x1b[0m\x1b[0KPS C:\\Users\\x\\AppData\\Local\\Temp\\dh-dbgw> \x1b[0K\x1b[54G';
  const clean = stripAnsi(raw);
  assert.equal(clean, 'PS C:\\Users\\x\\AppData\\Local\\Temp\\dh-dbgw> ', '应当只剩可读文本');
  assert.equal(clean.includes('\x1b'), false);
});

test('剥离 ANSI 后能识别真实 PowerShell 提示符', () => {
  const raw = '\x1b[0m\x1b[0KPS C:\\Users\\x\\dh-dbgw>\x1b[0K\x1b[54G';
  assert.equal(looksLikeStdinRead(raw), true, '真实提示符必须能识别——这是交互式可用的前提');
});

test('剥离 ANSI 后能识别 node REPL 提示符', () => {
  const raw = 'Welcome to Node.js v24.16.0\r\nType ".help" for more information.\r\n> ';
  assert.equal(looksLikeStdinRead(raw), true);
});

test('命令输出带颜色码时仍不误判', () => {
  const raw = '\x1b[32mMARK\x1b[0m\r\n\x1b[0m\x1b[0KPS C:\\x>\x1b[0K';
  assert.equal(looksLikeStdinRead(raw), true, '末尾是提示符，应判定等待输入');
  const done = '\x1b[32mBuild finished\x1b[0m\r\n';
  assert.equal(looksLikeStdinRead(done), false, '只是彩色输出，不是提示符');
});

test('四种等待原因齐备（与 DSH 词表一致）', () => {
  assert.deepEqual(Object.values(WAIT_REASONS).sort(),
    ['inferred_idle', 'session_exit', 'stdin_read', 'timeout'].sort());
});

test('识别常见交互式提示符为 stdin_read', () => {
  const prompts = [
    '$ ',
    'user@host:~$ ',
    'root@localhost:/# ',
    '>>> ',
    'Password: ',
    'Enter passphrase: ',
    '继续吗？(y/n)',
    'Continue? [Y/n]',
    'Press any key to continue',
    '按任意键继续',
    'frida> ',
    'gdb> ',
  ];
  for (const p of prompts) {
    assert.equal(looksLikeStdinRead('some output\n' + p), true, `应当识别为 stdin_read: ${JSON.stringify(p)}`);
  }
});

test('普通完成输出不会被误判为等待输入', () => {
  const outputs = [
    'total 3\n-rw-r--r-- a.txt\n-rw-r--r-- b.txt\n',
    'Build finished in 1.2s\n',
    'Done.\n',
    'Error: something failed\n',
    '',
  ];
  for (const o of outputs) {
    assert.equal(looksLikeStdinRead(o), false, `不应识别为 stdin_read: ${JSON.stringify(o)}`);
  }
});

test('classifyWait：退出优先于一切', () => {
  assert.equal(classifyWait({ exited: true, promptDetected: true, quietMs: 9999, idleMs: 700, elapsedMs: 9999, timeoutMs: 1000 }), WAIT_REASONS.SESSION_EXIT);
});

test('classifyWait：提示符优先于空闲与超时', () => {
  assert.equal(classifyWait({ exited: false, promptDetected: true, quietMs: 0, idleMs: 700, elapsedMs: 5000, timeoutMs: 1000 }), WAIT_REASONS.STDIN_READ);
});

test('classifyWait：安静够久判定空闲', () => {
  assert.equal(classifyWait({ exited: false, promptDetected: false, quietMs: 800, idleMs: 700, elapsedMs: 900, timeoutMs: 5000 }), WAIT_REASONS.INFERRED_IDLE);
});

test('classifyWait：到时限仍无判据算超时', () => {
  assert.equal(classifyWait({ exited: false, promptDetected: false, quietMs: 10, idleMs: 700, elapsedMs: 1000, timeoutMs: 1000 }), WAIT_REASONS.TIMEOUT);
});

test('tailViewport 保留尾部并明确标记截断', () => {
  const long = 'A'.repeat(1000) + 'TAIL_MARKER';
  const { viewport, truncated } = tailViewport(long, 100);
  assert.equal(truncated, true);
  assert.ok(viewport.endsWith('TAIL_MARKER'), '必须保留尾部——结论常在末尾');
  assert.equal(viewport.length <= 100, true);
});

test('tailViewport 不切开代理对', () => {
  const text = '😀'.repeat(200);
  for (let n = 1; n <= 50; n++) {
    const { viewport } = tailViewport(text, n);
    const first = viewport.charCodeAt(0);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), `maxChars=${n} 时产生了孤立低位代理`);
  }
});

test('短输出不标记截断', () => {
  const { viewport, truncated } = tailViewport('short', 100);
  assert.equal(truncated, false);
  assert.equal(viewport, 'short');
});
