// Windows 终端输入诊断：对比裸 CR、CRLF、win32-input-mode 键事件三种提交方式。
// 只依赖 sidecar 的 node-pty 组件，不启动桌面应用，不读写用户数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawnTerminal } from '../sidecar/terminal-process.mjs';

process.env.JSRA_TERMINAL_RAW_INPUT = '1'; // 诊断时禁用 worker 的自动 CRLF 翻译
const exec = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-term-diag-'));
const ENTER = '\x1b[13;28;13;1;0;1_\x1b[13;28;13;0;0;1_';
const PROMPT = process.platform === 'win32' ? /PS [^>\r\n]*>/ : /[$#] /;

async function waitFor(check, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await sleep(50); } return false; }

async function trial(name, submit) {
  const job = spawnTerminal({ cwd: dir, dataDir: dir, cols: 100, rows: 30 });
  let out = '';
  job.onData(data => { out += data; });
  try {
    await job.ready;
    const ready = await waitFor(() => PROMPT.test(out), 20000);
    if (!ready) { console.log(name, 'FAIL', 'no shell prompt', JSON.stringify(out.slice(-300))); return; }
    await sleep(800);
    const marker = 'MODE_' + name.toUpperCase() + '_OK';
    job.write(process.platform === 'win32' ? "Write-Output ('MODE_' + '" + name.toUpperCase() + "' + '_OK')" : "printf 'MODE_%s_OK\\n' '" + name.toUpperCase() + "'");
    await sleep(500);
    job.write(submit);
    const ok = await waitFor(() => out.includes(marker), 8000);
    console.log(name, ok ? 'PASS' : 'FAIL', JSON.stringify(out.slice(-400)));
  } catch (error) { console.log(name, 'ERROR', error.message); }
  finally { try { job.kill(); } catch {} await Promise.race([job.done, sleep(3000)]); }
}

console.log('platform=' + process.platform, 'release=' + os.release(), 'node=' + process.version, 'COMMAND ' + (process.env.ComSpec || '-'));
if (process.platform === 'win32') {
  try { const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']); console.log('powershell=' + stdout.trim()); } catch (e) { console.log('powershell=unknown (' + e.message.split('\n')[0] + ')'); }
}
await trial('cr', '\r');
await trial('crlf', '\r\n');
await trial('win32', ENTER);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
