// The only launcher for model-directed processes. Approval lives in Session;
// sandbox setup failures never trigger an automatic unsandboxed retry.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { killPidTree } from './proctree.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_OUTPUT = 80000;
const ENV_ALLOW = /^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|SYSTEMDRIVE|PROGRAMFILES(?:\(X86\))?|COMMONPROGRAMFILES(?:\(X86\))?|LANG|LC_[A-Z_]+|TERM|COLORTERM|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS)$/i;
export function childEnv(base = {}, additions = {}) {
  const env = {};
  for (const [k, v] of Object.entries(base)) if (v != null && ENV_ALLOW.test(k)) env[k] = String(v);
  return { ...env, ...additions, npm_config_fund: 'false', npm_config_audit: 'false' };
}
export function findNode() {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [process.env.JSRA_NODE, path.join(path.dirname(process.execPath), 'resources', 'node', name), /node(?:\.exe)?$/i.test(process.execPath) ? process.execPath : null];
  for (const base of (process.env.PATH || '').split(path.delimiter)) if (base && path.isAbsolute(base)) candidates.push(path.join(base, name));
  const found = candidates.find(p => p && path.isAbsolute(p) && fs.existsSync(p));
  if (!found) throw new Error('未找到 Node 运行时');
  return found;
}
export function findExecutable(name) {
  const names = process.platform === 'win32' && !path.extname(name) ? [name + '.exe', name + '.cmd'] : [name];
  for (const base of (process.env.PATH || '').split(path.delimiter)) if (base && path.isAbsolute(base)) for (const n of names) { const file = path.join(base, n); if (fs.existsSync(file)) return file; }
  throw new Error('未找到运行程序：' + name);
}
// Windows PowerShell 5.1 默认使用系统 ANSI 代码页（中文机器为 CP936），而宿主与
// workspace_read 全程按 UTF-8 处理，于是整条链路三处都会坏：
//   输出侧：stdout 是 CP936 字节 → 宿主按 UTF-8 解码，中文全成乱码；
//   读取侧：Get-Content / Select-String 按 ANSI 解读 UTF-8 文件 → 读中文文件、匹配都失败；
//   写入侧：Set-Content / Out-File 按 ANSI 写盘 → workspace_read 再读回来又是乱码。
// 三处必须一起对齐到 UTF-8，否则只是把乱码从一端挪到另一端（写入端默认 ANSI 时，
// 读回必然坏）。这里只固定这几个 cmdlet，不影响其它行为。
const PS_UTF8 = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
  "$OutputEncoding=[System.Text.Encoding]::UTF8;" +
  "$PSDefaultParameterValues['Get-Content:Encoding']='utf8';" +
  "$PSDefaultParameterValues['Select-String:Encoding']='utf8';" +
  "$PSDefaultParameterValues['Import-Csv:Encoding']='utf8';" +
  "$PSDefaultParameterValues['Set-Content:Encoding']='utf8';" +
  "$PSDefaultParameterValues['Add-Content:Encoding']='utf8';" +
  "$PSDefaultParameterValues['Out-File:Encoding']='utf8';" +
  "$PSDefaultParameterValues['Export-Csv:Encoding']='utf8';";
// 注意：Windows PowerShell 5.1 的 -Encoding 只接受字符串枚举，不能传 UTF8Encoding 对象，
// 所以写入端固定为带 BOM 的 'utf8'。BOM 由 workspace_read 剥离（同 settings.mjs 的做法）。
export function shellSpec(command) {
  if (process.platform === 'win32') return { file: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_UTF8 + command] };
  return { file: '/bin/sh', args: ['-c', 'export LC_ALL=${LC_ALL:-C.UTF-8} LANG=${LANG:-C.UTF-8}; ' + command] };
}
function sandboxEntry() {
  const candidates = [path.join(path.dirname(process.execPath), 'resources', 'executor', 'sandbox-entry.mjs'), path.join(path.dirname(process.execPath), '..', 'executor', 'sandbox-entry.mjs'), path.join(HERE, 'sandbox-entry.mjs')];
  const found = candidates.find(p => fs.existsSync(p)); if (!found) throw new Error('未找到执行隔离资源，请重新构建安装包'); return found;
}
function launch(spec, { signal, env, timeoutMs = 60000 } = {}) {
  if (signal?.aborted) throw new Error('任务已取消');
  const child = spawn(spec.file, spec.args || [], { cwd: spec.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  let out = '', err = '', truncated = false, ended = false, timer;
  const cap = (previous, chunk) => { const full = previous + chunk.toString(); if (full.length > MAX_OUTPUT) truncated = true; return full.slice(-MAX_OUTPUT); };
  child.stdout.on('data', d => { out = cap(out, d); }); child.stderr.on('data', d => { err = cap(err, d); });
  const job = { id: crypto.randomUUID(), child, pid: child.pid, startedAt: Date.now(), status: 'running', get out() { return out; }, get err() { return err; }, get truncated() { return truncated; } };
  const stop = reason => { if (ended) return; job.reason = reason; killPidTree(child.pid); try { child.kill('SIGKILL'); } catch {} };
  const onAbort = () => stop('cancelled'); signal?.addEventListener('abort', onAbort, { once: true });
  timer = setTimeout(() => stop('timeout'), Math.max(1000, Math.min(timeoutMs, 24 * 3600000)));
  job.kill = () => stop('cancelled');
  job.done = new Promise(resolve => {
    const finish = code => { if (ended) return; ended = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); job.code = code ?? -1; job.status = job.reason || (job.code === 0 ? 'completed' : 'failed'); job.endedAt = Date.now(); resolve({ code: job.code, out, err, truncated, reason: job.reason }); };
    child.on('error', e => { err = cap(err, String(e.message)); });
    // close follows output drain; exit can lose the last stdout chunk on Windows.
    child.on('close', finish);
  });
  child.stdin.on('error', () => {}); child.stdin.end(spec.input || ''); return job;
}

export class Executor {
  constructor() { this.jobs = new Map(); this.capability = null; this.terminals = new Set(); }
  async startTerminal(spec, { signal, verify } = {}) {
    const { spawnTerminal } = await import('./terminal-process.mjs');
    signal?.throwIfAborted(); verify?.();
    if (this.terminals.size >= 24) throw Error('当前最多同时运行24个终端');
    const pty = spawnTerminal(spec);
    this.terminals.add(pty);
    pty.done.finally(() => this.terminals.delete(pty));
    const abort = () => pty.kill(); signal?.addEventListener('abort', abort, { once: true });
    try { await pty.ready; signal?.throwIfAborted(); verify?.(); return pty; }
    catch (error) { pty.kill(); await pty.done; throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  async probe(force = false) {
    if (process.env.JSRA_TEST_FIXTURES === '1' && process.env.JSRA_TEST_NO_SANDBOX === '1') return { backend: 'test', available: false, errors: ['Test fixture'], warnings: [], platform: process.platform };
    if (this.capability && !force) return this.capability;
    try {
      const result = await launch({ file: findNode(), args: [sandboxEntry(), '--probe'] }, { env: childEnv(process.env), timeoutMs: 15000 }).done;
      const value = JSON.parse(result.out);
      this.capability = { backend: 'srt', available: !!value.available, errors: value.errors || [], warnings: value.warnings || [], platform: process.platform };
    } catch (e) { this.capability = { backend: 'srt', available: false, errors: [e.message], warnings: [], platform: process.platform }; }
    return this.capability;
  }
  start(spec, { signal, isolated = false, workspace, dataDir, protectedRoot, network = [] } = {}) {
    const temp = path.join(dataDir || os.tmpdir(), '.exec', crypto.randomUUID()); fs.mkdirSync(temp, { recursive: true });
    const env = childEnv(process.env, { HOME: temp, USERPROFILE: temp, TMP: temp, TEMP: temp, TMPDIR: temp,
      npm_config_cache: path.join(temp, 'npm-cache'), npm_config_userconfig: path.join(temp, 'npmrc'), ...spec.env });
    let target = { ...spec };
    if (isolated) {
      target = { file: findNode(), args: [sandboxEntry()], cwd: spec.cwd, input: JSON.stringify({ spec, workspace, dataDir, protectedRoot, temp, network, env }) };
    }
    const job = launch(target, { signal, env, timeoutMs: spec.timeoutMs });
    job.isolated = isolated; job.workspaceId = workspace?.id; this.jobs.set(job.id, job);
    job.done.then(() => { for (const [id, item] of this.jobs) if (this.jobs.size > 100 && item.status !== 'running') this.jobs.delete(id); });
    return job;
  }
  killWorkspace(workspaceId) { for (const j of this.jobs.values()) if (j.workspaceId === workspaceId && j.status === 'running') j.kill(); }
  dispose() { for (const j of this.jobs.values()) if (j.status === 'running') j.kill(); }
}
export const executor = new Executor();
