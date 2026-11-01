// Windows PowerShell 5.1 默认按系统 ANSI 代码页处理 stdio 与文件编码，而宿主全程按 UTF-8。
// 这组测试锁住三个方向：输出、读取、写入→读回。任何一处退回 ANSI，中文就会重新变乱码。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shellWorkspace, killAllJobs } from '../workspace.mjs';

const win = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wdh-enc-'));

test('shell output survives PowerShell console code page', { skip: !win }, async () => {
  const dir = tmp();
  try {
    const r = await shellWorkspace(dir, { cmd: 'Write-Output "中文里程碑：扫描完成 584 台，命中 3"', timeoutMs: 90000 });
    assert.equal(r.isError, false);
    assert.match(r.text, /中文里程碑：扫描完成 584 台，命中 3/);
    assert.doesNotMatch(r.text, /\uFFFD/);
  } finally { killAllJobs(dir); }
});

test('reading a UTF-8 Chinese file and matching it works', { skip: !win }, async () => {
  const dir = tmp(), root = path.join(dir, 'workspace');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'note.txt'), '里程碑：已完成 584 台主机探测\n第二行\n', 'utf8');
  try {
    const read = await shellWorkspace(dir, { cmd: 'Get-Content note.txt', timeoutMs: 90000 });
    assert.match(read.text, /里程碑：已完成 584 台主机探测/);
    const matched = await shellWorkspace(dir, { cmd: 'Get-Content note.txt | Select-String "里程碑"', timeoutMs: 90000 });
    assert.match(matched.text, /里程碑/);
  } finally { killAllJobs(dir); }
});

test('writing through PowerShell then reading back keeps Chinese intact', { skip: !win }, async () => {
  const dir = tmp(), root = path.join(dir, 'workspace');
  fs.mkdirSync(root, { recursive: true });
  try {
    const written = await shellWorkspace(dir, { cmd: 'Set-Content -Path out.txt -Value "回环中文"; Out-File -FilePath out2.txt -InputObject "第二份"', timeoutMs: 90000 });
    assert.equal(written.isError, false);
    // PowerShell 5.1 的 -Encoding utf8 会写 BOM；宿主读取必须剥掉，否则正文开头多一个不可见字符。
    const raw = fs.readFileSync(path.join(root, 'out.txt'), 'utf8');
    assert.match(raw.replace(/^\uFEFF/, ''), /^回环中文/);
    await shellWorkspace(dir, { cmd: 'Write-Output ok', timeoutMs: 90000 });
    const back = await shellWorkspace(dir, { cmd: 'Get-Content out.txt, out2.txt', timeoutMs: 90000 });
    assert.match(back.text, /回环中文/);
    assert.match(back.text, /第二份/);
    assert.doesNotMatch(back.text, /\uFFFD/);
  } finally { killAllJobs(dir); }
});

test('Chinese directory and file names round-trip', { skip: !win }, async () => {
  const dir = tmp();
  try {
    const r = await shellWorkspace(dir, {
      cmd: 'New-Item -ItemType Directory -Force -Path "中文目录" | Out-Null; Write-Output "创建成功" | Tee-Object -FilePath "中文目录/报告.txt"; Get-Content "中文目录/报告.txt"',
      timeoutMs: 90000,
    });
    assert.equal(r.isError, false);
    assert.match(r.text, /创建成功/);
    assert.doesNotMatch(r.text, /\uFFFD/);
  } finally { killAllJobs(dir); }
});

test('error text is readable instead of mojibake', { skip: !win }, async () => {
  const dir = tmp();
  try {
    const r = await shellWorkspace(dir, { cmd: 'throw "中文错误：目标不可达"', timeoutMs: 90000 });
    assert.equal(r.isError, true);
    assert.match(r.text, /中文错误：目标不可达/);
    assert.doesNotMatch(r.text, /\uFFFD/);
  } finally { killAllJobs(dir); }
});
