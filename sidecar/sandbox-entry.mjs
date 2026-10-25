// Separate trusted process: SRT has process-global policy and must not be shared
// across concurrent workspaces. No model-controlled package is imported here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SandboxManager, checkWindowsDependenciesAsync, VENDORED_SRT_WIN_EXE } from '@anthropic-ai/sandbox-runtime';

if (process.argv.includes('--probe')) {
  try { const deps = process.platform === 'win32' ? await checkWindowsDependenciesAsync({ srtWin: { exe: VENDORED_SRT_WIN_EXE, prependArgs: [] } }) : await SandboxManager.checkDependenciesAsync(); process.stdout.write(JSON.stringify({ available: SandboxManager.isSupportedPlatform() && !deps.errors.length, ...deps })); }
  catch (e) { process.stdout.write(JSON.stringify({ available: false, errors: [e.message] })); }
} else {
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16 * 1024 * 1024) throw new Error('执行请求过大'); }
  try {
    const { spec, workspace, dataDir, protectedRoot, temp, network, env } = JSON.parse(input);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const drives = process.platform === 'win32' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(d => d + ':\\').filter(p => fs.existsSync(p)) : ['/'];
    const runtimeRead = process.platform === 'win32' ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.dirname(process.execPath)] : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', '/dev', '/proc'];
    const metadata = ['.agent-history.json', '.agent-state.json', '.runs.json', '.run-events.jsonl', '.changes.json', '.ctx', '.chats'];
    const sensitive = ['**/.env', '**/.env.*', '**/.npmrc', '**/.pypirc', '**/credentials', '**/id_rsa', '**/id_ed25519',
      ...['.ssh', '.aws', '.azure', '.gnupg', '.wdh', '.agent-history', '.agent-state'].flatMap(p => ['**/' + p, '**/' + p + '/**']),
      ...['pem', 'p12', 'pfx', 'key'].map(ext => '**/*.' + ext)];
    await SandboxManager.initialize({
      ...(process.platform === 'win32' ? { windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } } } : {}),
      network: { allowedDomains: network || [], deniedDomains: [], strictAllowlist: true, allowLocalBinding: false },
      credentials: { files: sensitive.map(p => ({ path: path.join(workspace.root, p), mode: 'deny' })) },
      filesystem: { denyRead: [...drives, protectedRoot, ...metadata.map(p => path.join(dataDir, p)), ...sensitive.map(p => path.join(workspace.root, p))].filter(Boolean),
        allowRead: [workspace.root, here, temp, ...runtimeRead.filter(Boolean)],
        allowWrite: [workspace.root, temp], denyWrite: [...metadata.map(p => path.join(dataDir, p)), ...sensitive.map(p => path.join(workspace.root, p))] },
    });
    const quote = s => process.platform === 'win32' ? "'" + String(s).replace(/'/g, "''") + "'" : "'" + String(s).replace(/'/g, "'\\''") + "'";
    const command = (process.platform === 'win32' ? '& ' : '') + [spec.file, ...(spec.args || [])].map(quote).join(' ');
    const shell = process.platform === 'win32' ? { exe: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] } : '/bin/sh';
    const wrapped = await SandboxManager.wrapWithSandboxArgv(command, shell, undefined, undefined, spec.cwd, { commandId: crypto.randomUUID() });
    const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), { cwd: spec.cwd, env: { ...env, ...wrapped.env }, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    child.stdin.on('error', () => {}); child.stdin.end(spec.input || '');
    const code = await new Promise(resolve => { child.on('error', e => { process.stderr.write(e.message); resolve(1); }); child.on('close', c => resolve(c ?? 1)); });
    await SandboxManager.reset(); process.exitCode = code;
  } catch (e) { process.stderr.write('[执行隔离失败，未降级运行] ' + e.message); await SandboxManager.reset().catch(() => {}); process.exitCode = 1; }
}
