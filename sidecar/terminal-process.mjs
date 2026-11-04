// Keep native PTY workers and failures out of the Harness process.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { privateProcessEnv, findNode } from './executor.mjs';
import { killPidTree } from './proctree.mjs';
import { resolvePwshPath } from './pwsh-path.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export function spawnTerminal({ cwd, dataDir, cols, rows, agentOwned = false }) {
  const bases = [here, path.join(here, '../terminal'), path.join(path.dirname(process.execPath), 'resources/terminal')];
  const base = bases.find(p => fs.existsSync(path.join(p, 'terminal-entry.cjs')) && fs.existsSync(path.join(p, 'node_modules/node-pty/lib/index.js')));
  if (!base) throw Error('终端运行组件缺失，请重新构建或安装 DecryptHub');
  const temp = path.join(dataDir, '.terminal'); fs.mkdirSync(temp, { recursive: true });
  const env = privateProcessEnv(temp, { TERM: 'xterm-256color', COLORTERM: 'truecolor' });
  const child = spawn(findNode(), [path.join(base, 'terminal-entry.cjs')], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const dataListeners = new Set(), exitListeners = new Set(), buffered = []; let bufferedSize = 0, ended = false, stopping = false, closeTimer, stderr = '', exit;
  const writes = new Map(); let writeSequence = 0, protocolPending = false, sessionExitCode, pid, foreground, inputRevision = 0;
  const rejectWrites = error => { for (const { reject, timer } of writes.values()) { clearTimeout(timer); reject(error); } writes.clear(); };
  let resolveReady, rejectReady, resolveDone;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }), done = new Promise(resolve => resolveDone = resolve);
  const startup = setTimeout(() => { rejectReady(Error('终端启动超时')); kill(); }, 15000);
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  child.stdin.on('error', error => rejectWrites(error));
  const send = message => { if (!ended) child.stdin.write(JSON.stringify(message) + '\n'); };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { if (line.length > 2000000) return; let message; try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'ready') { pid = message.pid; clearTimeout(startup); resolveReady(); }
    else if (message.type === 'error') { const error = Error(message.message || '终端传输失败'); rejectReady(error); rejectWrites(error); }
    else if (message.type === 'exit') sessionExitCode = message.exitCode;
    else if (message.type === 'protocol') protocolPending = message.pending === true;
    else if (['written','inspected','request-error'].includes(message.type)) { const pending = writes.get(message.requestId); if (pending) { writes.delete(message.requestId); clearTimeout(pending.timer); if(message.type==='request-error')pending.reject(Error(message.message)); else { if(message.type==='inspected'&&pending.inputRevision===inputRevision)foreground=message.foreground; pending.resolve(message.foreground); } } }
    else if (message.type === 'data' && typeof message.data === 'string') { if (dataListeners.size) for (const fn of dataListeners) fn(message.data); else if (bufferedSize < 500000) { buffered.push(message.data); bufferedSize += message.data.length; } }
  });
  child.on('error', error => rejectReady(error));
  child.on('close', code => { ended = true; clearTimeout(startup); clearTimeout(closeTimer); lines.close(); exit = { exitCode: sessionExitCode ?? code ?? -1 }; const error = Error(stderr || '终端进程已退出'); rejectReady(error); rejectWrites(error); for (const fn of [...exitListeners]) fn(exit); resolveDone(); });
  function kill() { if (ended || stopping) return; stopping = true; send({ action: 'close' }); closeTimer = setTimeout(() => { if (!ended) { killPidTree(child.pid); child.kill(); } }, 2500); }
  const write = (data, action = 'input') => new Promise((resolve, reject) => {
    if (ended || stopping) { reject(Error('终端已关闭')); return; }
    const requestId = ++writeSequence, timer = setTimeout(() => { writes.delete(requestId); reject(Error('终端输入传输超时')); kill(); }, 15000);
    if(action!=='inspect'){inputRevision++;foreground=undefined;}
    timer.unref?.(); writes.set(requestId, { resolve, reject, timer, inputRevision }); send({ action, data, requestId });
  });
  send({ action: 'open', cwd, cols, rows, agentOwned, ...(agentOwned && process.platform === 'win32' ? { shellPath: resolvePwshPath() } : {}) });
  return { ready, done, kill, get pid() { return pid; }, get protocolPending() { return protocolPending; }, get foreground() { return foreground; },
    inspectForeground: async () => { if(process.platform==='win32')return foreground={processGroupId:pid,inputWaiting:false,mechanism:'windows-console'}; return write('','inspect'); },
    signalForeground: signal => signal==='SIGINT'&&process.platform==='win32' ? write('','interrupt') : write(signal,'signal'),
    write, interrupt: () => write('', 'interrupt'), resize: (cols, rows) => send({ action: 'resize', cols, rows }),
    onData: fn => { dataListeners.add(fn); buffered.splice(0).forEach(fn); bufferedSize = 0; return { dispose: () => dataListeners.delete(fn) }; },
    onExit: fn => { if (exit) queueMicrotask(() => fn(exit)); else exitListeners.add(fn); return { dispose: () => exitListeners.delete(fn) }; } };
}
