// DSH search semantics: packaged ripgrep, argv rather than shell interpolation,
// grep respects ignore files; glob discovers hidden/ignored files by mtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { workspacePath, selectReadRoot } from './workspaces.mjs';
import { childEnv } from './executor.mjs';
import { trimToolOutput } from './context.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const vcs = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'];
const sensitive = ['.ssh', '.aws', '.azure', '.gnupg', '.wdh', '.history', '.changes', '.data-write-lease.sqlite*', '.writer-lease.sqlite*', '.session-search.sqlite*', '.agent-state.json', '.agent-history.json', '.npmrc', '.pypirc', 'credentials', 'credentials.json', 'id_rsa', 'id_ed25519', '.env', '.env.*', '*.pem', '*.p12', '*.pfx', '*.key'];
const exclusions = [...vcs, ...sensitive].flatMap(name => ['--glob=!**/' + name, '--glob=!**/' + name + '/**']);
const matches = (file, pattern) => !pattern || path.matchesGlob(file, pattern) || !pattern.includes('/') && path.matchesGlob(path.basename(file), pattern);
export function searchBinary() {
  const name = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const candidates = [path.join(here, '../search', name), path.join(path.dirname(process.execPath), '../search', name),
    path.join(path.dirname(process.execPath), 'resources/search', name),
    path.join(here, 'node_modules/@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin', name)];
  const file = candidates.find(file => fs.existsSync(file));
  if (!file) throw Error('搜索运行组件缺失，请重新构建或安装 DecryptHub');
  return file;
}
function runSearch(args, ctx) {
  ctx.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(searchBinary(), args, { cwd: ctx.workRoot, env: childEnv(process.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '', bytes = 0, failure;
    const stop = error => { failure ||= error; child.kill(); };
    const abort = () => stop(ctx.signal.reason || Error('搜索已取消'));
    ctx.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(Error('搜索达到 60 秒上限，请缩小 path')), 60000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { bytes += Buffer.byteLength(text); if (bytes > 32 * 1024 * 1024) stop(Error('搜索输出超过 32MB，未完成搜索，请缩小 pattern/path')); else output += text; });
    child.stderr.on('data', text => { stderr = (stderr + text).slice(-4000); });
    child.on('error', error => { failure ||= error; });
    child.on('close', code => {
      clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0 && code !== 1) reject(Error('搜索未完成：' + (stderr || 'ripgrep exit ' + code)));
      else resolve(output);
    });
    if (ctx.signal?.aborted) abort();
  });
}
function includeValue(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.startsWith('!')) throw Error('include/glob 需要一个非空的正向 glob');
  let depth = 0;
  for (const char of value) { if (char === '{') depth++; else if (char === '}') depth--; else if (char === ',' && depth === 0) throw Error('include/glob 只能提供一个 glob，可用 {js,ts} 表达多个后缀'); }
  return value;
}
const preview = text => { const bytes = Buffer.from(text); let end = Math.min(bytes.length, 2000); while (end && (bytes[end] & 0xc0) === 0x80) end--; return bytes.subarray(0, end).toString('utf8') + (end < bytes.length ? '…' : ''); };
export async function searchWorkspace(ctx, input, glob = false) {
  ctx = selectReadRoot(ctx, input.root);
  if (typeof input.pattern !== 'string' || !input.pattern.length || glob && !input.pattern.trim()) throw Error('pattern 不能为空');
  if (input.path !== undefined && (typeof input.path !== 'string' || !input.path.trim())) throw Error('path 不能为空');
  const target = workspacePath(ctx, input.path || '.'), filter = includeValue(input.include ?? input.glob);
  const args = ['--no-config'];
  if (glob) args.push('--files', '--hidden', '--no-ignore', '--sort=modified', '--glob=' + input.pattern);
  else { args.push('--json', '--regexp=' + input.pattern); if (filter) args.push('--glob=' + filter); if (input.literal) args.push('--fixed-strings'); if (input.ignoreCase) args.push('--ignore-case'); if (input.includeModules) args.push('--no-ignore'); }
  // Negative globs precede the explicit target; no model-controlled shell text.
  args.push(...exclusions, ...(glob || filter ? ['example', 'sample', 'template'].map(suffix => '--glob=**/.env.' + suffix) : []), '--', target);
  const raw = await runSearch(args, ctx), results = []; let omitted = 0;
  const validPath = file => { try {
    workspacePath(ctx, file); const relative = path.relative(ctx.workRoot, file).replaceAll('\\', '/');
    return matches(relative, glob ? input.pattern : filter) ? relative : null;
  } catch { omitted++; return null; } };
  if (glob) {
    for (const line of raw.split(/\r?\n/).filter(Boolean)) { const name = validPath(line); if (name !== null) results.push(name); }
  } else for (const line of raw.split('\n').filter(Boolean)) {
    let record; try { record = JSON.parse(line); } catch { throw Error('搜索结果格式无效，不能报告为完整搜索'); }
    if (record.type !== 'match') continue;
    const data = record.data;
    if (typeof data?.path?.text !== 'string' || !Number.isSafeInteger(data.line_number) || !data.lines || typeof data.lines.text !== 'string' && typeof data.lines.bytes !== 'string') throw Error('搜索结果缺少路径、行号或正文');
    const name = validPath(data.path.text); if (name === null) continue;
    results.push(`${name}:${data.line_number}: ${preview(typeof data.lines.text === 'string' ? data.lines.text.replace(/\r?\n$/, '') : '[此行不是有效 UTF-8 文本]')}`);
  }
  const max = Math.min(1000, Math.max(1, Math.floor(input.max || (glob ? 100 : 250))));
  const header = `${glob ? '文件' : '内容'}匹配 ${results.length} 项${results.length > max ? `（仅显示前 ${max} 项）` : ''}：\n`;
  let text = header + (results.slice(0, max).join('\n') || '在本次已扫描范围内无匹配');
  if (results.length > max) {
    const full = trimToolOutput(header + results.join('\n'), { dir: ctx.projectDir ? path.join(ctx.projectDir, '.ctx') : null, name: glob ? 'glob' : 'grep', limit: 0, head: 0 });
    const reference = full.match(/context_ref_read\([^)]*\)/)?.[0];
    text += '\n' + (reference ? '完整搜索结果已保存：' + reference : '完整结果无法保存，请缩小范围继续搜索');
  }
  if (omitted) text += `\n[权限或文件身份校验排除了 ${omitted} 项，未将其正文交给模型。]`;
  return { text };
}
