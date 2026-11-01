// Keep native PTY workers and failures out of the Harness process.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { childEnv, findNode } from './executor.mjs';
import { killPidTree } from './proctree.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export function spawnTerminal({ cwd, dataDir, cols, rows }) {
  const bases = [here, path.join(here, '../terminal'), path.join(path.dirname(process.execPath), 'resources/terminal')];
  const base = bases.find(p => fs.existsSync(path.join(p, 'terminal-entry.cjs')) && fs.existsSync(path.join(p, 'node_modules/node-pty/lib/index.js')));
  if (!base) throw Error('终端运行组件缺失，请重新构建或安装 DecryptHub');
  const temp = path.join(dataDir, '.terminal'); fs.mkdirSync(temp, { recursive: true });
  const env = childEnv(process.env, { HOME: temp, USERPROFILE: temp, TMP: temp, TEMP: temp, TMPDIR: temp, TERM: 'xterm-256color', COLORTERM: 'truecolor' });
  const child = spawn(findNode(), [path.join(base, 'terminal-entry.cjs')], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const dataListeners = new Set(), exitListeners = new Set(), buffered = []; let bufferedSize = 0, ended = false, stopping = false, closeTimer, stderr = '', exit;
  let resolveReady, rejectReady, resolveDone;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }), done = new Promise(resolve => resolveDone = resolve);
  const startup = setTimeout(() => { rejectReady(Error('终端启动超时')); kill(); }, 15000);
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  child.stdin.on('error', () => {});
  const send = message => { if (!ended) child.stdin.write(JSON.stringify(message) + '\n'); };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { if (line.length > 2000000) return; let message; try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'ready') { clearTimeout(startup); resolveReady(); }
    else if (message.type === 'error') rejectReady(Error(message.message || '终端启动失败'));
    else if (message.type === 'data' && typeof message.data === 'string') { if (dataListeners.size) for (const fn of dataListeners) fn(message.data); else if (bufferedSize < 500000) { buffered.push(message.data); bufferedSize += message.data.length; } }
  });
  child.on('error', error => rejectReady(error));
  child.on('close', code => { ended = true; clearTimeout(startup); clearTimeout(closeTimer); lines.close(); exit = { exitCode: code ?? -1 }; rejectReady(Error(stderr || '终端进程已退出')); for (const fn of [...exitListeners]) fn(exit); resolveDone(); });
  function kill() { if (ended || stopping) return; stopping = true; send({ action: 'close' }); closeTimer = setTimeout(() => { if (!ended) { killPidTree(child.pid); child.kill(); } }, 2500); }
  send({ action: 'open', cwd, cols, rows });
  return { ready, done, kill, write: data => send({ action: 'input', data }), resize: (cols, rows) => send({ action: 'resize', cols, rows }),
    onData: fn => { dataListeners.add(fn); buffered.splice(0).forEach(fn); bufferedSize = 0; return { dispose: () => dataListeners.delete(fn) }; },
    onExit: fn => { if (exit) queueMicrotask(() => fn(exit)); else exitListeners.add(fn); return { dispose: () => exitListeners.delete(fn) }; } };
}
