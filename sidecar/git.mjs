import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { childEnv } from './executor.mjs';
import { workspacePath } from './workspaces.mjs';
const exec = promisify(execFile);
async function git(root, args) {
  const { stdout } = await exec('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), ...args], { cwd: root, windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 ** 2, env: childEnv(process.env, { GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' }) });
  return stdout;
}
export async function gitStatus(ctx) {
  try {
    const repository = (await git(ctx.workRoot, ['rev-parse', '--show-toplevel'])).trim();
    const items = (await git(ctx.workRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.'])).split('\0'), files = [];
    for (let i = 0; i < items.length; i++) { const item = items[i]; if (!item) continue; const status = item.slice(0, 2), name = path.relative(ctx.workRoot, path.resolve(repository, item.slice(3))).split(path.sep).join('/'); if (/[RC]/.test(status)) i++; try { workspacePath(ctx, name); files.push({ name, status }); } catch {} }
    return { available: true, files };
  } catch { return { available: false, files: [] }; }
}
export async function gitDiff(ctx, name) {
  const file = workspacePath(ctx, name), relative = path.relative(ctx.workRoot, file).split(path.sep).join('/');
  if (!relative || relative.startsWith('-')) throw new Error('文件路径无效');
  const flags = ['--no-ext-diff', '--no-textconv', '--no-color'];
  let diff; try { diff = await git(ctx.workRoot, ['diff', ...flags, 'HEAD', '--', relative]); } catch { diff = await git(ctx.workRoot, ['diff', ...flags, '--', relative]); diff += await git(ctx.workRoot, ['diff', ...flags, '--cached', '--', relative]); }
  if (!diff && fs.existsSync(file) && fs.statSync(file).isFile()) { const size = fs.statSync(file).size; diff = size <= 300000 ? '新文件：' + relative + '\n' + fs.readFileSync(file, 'utf8') : '文件过大，无法预览'; }
  return { text: diff.slice(0, 300000), truncated: diff.length > 300000 };
}
