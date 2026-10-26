import fs from 'node:fs';
import path from 'node:path';
import { workRoot, workspacePath, selectReadRoot } from './workspaces.mjs';
import { isSensitivePath } from './paths.mjs';
import { contentHash } from './changes.mjs';
import { executor, findNode, shellSpec, childEnv } from './executor.mjs';
export { childEnv };

const buckets = new Map(), ignored = new Set(['.git', '.ctx', '.chats', '.exec', '.capture', 'node_modules']);
const ctxOf = v => typeof v === 'string' ? { projectDir: v } : v;
const slash = v => v.split(path.sep).join('/');
function walk(ctx, rel = '.', { depth = 8, includeModules = false, max = 10000 } = {}) {
  const root = workRoot(ctx), base = workspacePath(ctx, rel), out = [];
  function visit(dir, level) {
    if (level > depth || out.length >= max) return;
    for (const name of fs.readdirSync(dir).sort()) {
      if (out.length >= max) break;
      if (ignored.has(name) && !(includeModules && name === 'node_modules')) continue;
      const p = path.join(dir, name), r = slash(path.relative(root, p));
      let st; try { workspacePath(ctx, r); st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink() || isSensitivePath(r)) continue;
      out.push({ name: r, size: st.size, mtime: st.mtimeMs, directory: st.isDirectory() });
      if (st.isDirectory()) visit(p, level + 1);
    }
  }
  if (fs.statSync(base).isDirectory()) visit(base, 0); else { const st = fs.statSync(base); out.push({ name: slash(path.relative(root, base)), size: st.size, mtime: st.mtimeMs, directory: false }); }
  return out;
}
export function listWorkspace(ctx) { return walk(ctx).filter(e => !e.directory); }
// The file browser loads one level at a time; it never walks an entire project
// merely to display its root, and can show empty directories.
export function listDirectory(ctx, rel = '.') {
  const root = workRoot(ctx), base = workspacePath(ctx, rel);
  if (!fs.statSync(base).isDirectory()) throw new Error('不是文件夹');
  const entries = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const name = slash(path.relative(root, path.join(base, entry.name)));
    try {
      const file = workspacePath(ctx, name), st = fs.lstatSync(file);
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) continue;
      entries.push({ name: entry.name, path: name, directory: st.isDirectory(), size: st.size });
    } catch { /* sensitive files and links are excluded at the same boundary as tools */ }
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  return { path: slash(path.relative(root, base)) || '.', entries: entries.slice(0, 2000), truncated: entries.length > 2000 };
}
export function readWorkspace(ctx, rel, max = 300000) {
  const p = workspacePath(ctx, rel), st = fs.statSync(p); if (!st.isFile()) throw new Error('不是文件');
  const fd = fs.openSync(p, 'r');
  try { const buffer = Buffer.alloc(Math.min(st.size, Math.max(1, max) * 4)); const n = fs.readSync(fd, buffer); return buffer.subarray(0, n).toString('utf8').slice(0, max); }
  finally { fs.closeSync(fd); }
}
function write(ctx, rel, content, expectedHash) {
  const root = workRoot(ctx), file = workspacePath(ctx, rel, { write: true });
  if (fs.existsSync(file) && fs.statSync(file).nlink > 1) throw new Error('不能修改多硬链接文件');
  if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error('单次写入最多 4MB');
  if (ctx.changes) ctx.changes.write(root, file, content, { workspaceId: ctx.workspaceId, runId: ctx.runId, expectedHash });
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  ctx.readHashes?.set(file, contentHash(content));
  return { text: `已写入 ${slash(path.relative(root, file))}（${Buffer.byteLength(content)} 字节）`, wrote: [file] };
}
async function wsWrite(a, ctx) {
  const rel = a.path || a.file; if (!rel) throw new Error('需要 path');
  const file = workspacePath(ctx, rel, { write: true }), expected = a.expectedHash || ctx.readHashes?.get(file);
  if (fs.existsSync(file) && ctx.readHashes && !expected) throw new Error('覆盖已有文件前请先 workspace_read，或使用 workspace_edit 精确替换');
  return write(ctx, rel, String(a.content ?? ''), expected);
}
async function wsRead(a, ctx) {
  ctx = selectReadRoot(ctx, a.root);
  const rel = a.path || a.file; if (!rel) throw new Error('需要 path');
  const file = workspacePath(ctx, rel), size = fs.statSync(file).size; if (size > 8 * 1024 * 1024) throw new Error('文件超过 8MB，请用搜索或分段读取');
  const buf = fs.readFileSync(file); ctx.readHashes?.set(file, contentHash(buf));
  const max = Math.min(300000, Math.max(1, Number(a.max) || 30000)), text = a.binary ? buf.toString('base64') : buf.toString('utf8');
  return { text: `文件 ${rel}（${size} 字节，sha256=${contentHash(buf)}）：\n` + text.slice(0, max) + (text.length > max ? '\n…(已截断)' : '') };
}
async function wsList(a, ctx) {
  const roots = (ctx.projectRoots || []).map(r => `${r.id} · ${r.label}${r.primary ? '（主目录，可写）' : '（附加目录，只读）'}`).join('\n');
  ctx = selectReadRoot(ctx, a.root);
  const entries = walk(ctx, a.path || '.', { depth: Math.min(12, Math.max(0, a.depth ?? 3)), includeModules: !!a.includeModules });
  return { text: (roots ? '项目目录（读取其他目录时传 root ID）：\n' + roots + '\n\n' : '') + `工作区：${workRoot(ctx)}\n` + (entries.map(e => e.name + (e.directory ? '/' : `  ${e.size}B`)).join('\n') || '工作区为空，可以创建文件。') };
}
export function workspaceFileSize(v, rel) { try { return fs.statSync(workspacePath(ctxOf(v), rel)).size; } catch { return 0; } }
export function editWorkspace(v, a) {
  try {
    const ctx = ctxOf(v), rel = a.path || a.file; if (!rel) throw new Error('需要 path');
    const old = String(a.old_string ?? a.old ?? ''), next = a.new_string ?? a.new;
    if (!old) throw new Error('old_string 不能为空'); if (next == null) throw new Error('需要 new_string'); if (old === String(next)) throw new Error('old_string 与 new_string 相同，没有改动');
    const file = workspacePath(ctx, rel, { write: true }); if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('文件太大，请分段处理');
    const text = fs.readFileSync(file, 'utf8'); if (text.includes('\0')) throw new Error('二进制文件不能精确编辑');
    let count = 0, at = -1, start = 0; while ((start = text.indexOf(old, start)) !== -1) { if (at < 0) at = start; count++; start += old.length; }
    if (!count) throw new Error('未找到完全一致的 old_string，请重新读取文件确认上下文');
    const all = !!(a.replace_all ?? a.replaceAll); if (!all && count !== 1) throw new Error(`匹配了 ${count} 处，不是唯一匹配，请加长上下文，或设置 replace_all=true`);
    const result = write(ctx, rel, all ? text.split(old).join(String(next)) : text.slice(0, at) + String(next) + text.slice(at + old.length), contentHash(text));
    result.text = `已替换 ${all ? count : 1} 处：${rel}`; return result;
  } catch (e) { return { text: e.message, isError: true }; }
}
function globMatch(rel, glob) {
  if (!glob) return true;
  const escaped = String(glob).replace(/\\/g, '/').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '.').replace(/\u0001\//g, '(?:.*/)?').replace(/\u0001/g, '.*');
  const re = new RegExp('^' + escaped + '$', 'i'); return re.test(rel) || (!glob.includes('/') && re.test(path.basename(rel)));
}
export function grepWorkspace(v, a) {
  try {
    const ctx = selectReadRoot(ctxOf(v), a.root); if (!a.pattern) throw new Error('需要 pattern');
    const source = a.literal ? a.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : a.pattern;
    let re; try { re = new RegExp(source, a.ignoreCase ? 'i' : ''); } catch (e) { throw new Error('正则无效：' + e.message); }
    const hits = [], max = Math.min(200, Math.max(1, a.max || 80));
    for (const entry of walk(ctx, a.path || '.', { includeModules: !!a.includeModules })) {
      if (entry.directory || entry.size > 1500000 || !globMatch(entry.name, a.glob)) continue;
      const text = readWorkspace(ctx, entry.name, 1500000); if (text.includes('\0')) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && hits.length < max; i++) if (re.test(lines[i])) hits.push(`${entry.name}:${i + 1}: ${lines[i].slice(0, 240)}`);
      if (hits.length >= max) break;
    }
    return { text: hits.length ? `匹配 ${hits.length} 处：\n` + hits.join('\n') : '无匹配' };
  } catch (e) { return { text: e.message, isError: true }; }
}
function bucket(ctx) { const key = ctx.projectDir + ':' + workRoot(ctx); if (!buckets.has(key)) buckets.set(key, new Map()); return buckets.get(key); }
function jobText(j) { return `job ${j.id} ${j.status === 'running' ? 'running' : j.reason === 'cancelled' ? 'killed' : 'exit ' + j.code} pid=${j.pid || '-'}\n${j.out}${j.err ? '\n[stderr]\n' + j.err : ''}${j.truncated ? '\n[输出已截断]' : ''}`; }
async function start(ctx, spec) { return ctx.exec ? await ctx.exec(spec) : executor.start(spec, { signal: ctx.signal, dataDir: ctx.projectDir }); }
export async function shellWorkspace(v, a, signal) {
  try {
    const ctx = { ...ctxOf(v), ...(signal ? { signal } : {}) }, cmd = String(a.cmd || a.command || '').trim();
    if (!cmd) throw new Error('需要 cmd'); if (cmd.length > 20000) throw new Error('命令过长');
    const job = await start(ctx, { ...shellSpec(cmd), cwd: workRoot(ctx), timeoutMs: Math.min(a.background ? 3600000 : 300000, Math.max(1000, a.timeoutMs || (a.background ? 600000 : 60000))), network: a.networkDomains || [] });
    bucket(ctx).set(job.id, job);
    if (a.background) return { text: `已在后台启动 id=${job.id} pid=${job.pid || '-'}\n${job.isolated ? '受限执行' : '未隔离执行'}；用 workspace_job_output 查看、workspace_job_kill 停止。` };
    await job.done; return { text: jobText(job), isError: job.code !== 0 || !!job.reason };
  } catch (e) { return { text: e.message, isError: true }; }
}
export function jobOutput(v, a) { const j = bucket(ctxOf(v)).get(String(a.id)); if (!j) return { text: '没有这个后台任务：' + a.id, isError: true }; const body = jobText(j), offset = Math.max(0, Number(a.offset) || 0), slice = body.slice(offset, offset + 20000); return { text: `offset=${offset} next=${offset + slice.length} total=${body.length}\n${slice}` }; }
export function jobKill(v, a) { const j = bucket(ctxOf(v)).get(String(a.id)); if (!j) return { text: '没有这个后台任务：' + a.id, isError: true }; j.kill(); return { text: '已请求结束任务 ' + j.id }; }
export function killAllJobs(v) { const ctx = ctxOf(v); for (const [key, jobs] of buckets) if (key.startsWith(ctx.projectDir + ':')) for (const j of jobs.values()) if (j.status === 'running') j.kill(); }
async function wsRun(a, ctx) {
  const file = a.eval ? null : workspacePath(ctx, a.file || a.path || 'index.js');
  const code = a.eval ? String(a.eval) : fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(code) > 8 * 1024 * 1024) throw new Error('脚本超过 8MB，请拆分后执行');
  const args = a.eval ? ['-e', code] : [file, ...(a.args || [])];
  const job = await start(ctx, { file: findNode(), args, cwd: workRoot(ctx), preview: code,
    guardFiles: file ? [{ file, hash: contentHash(code) }] : [], timeoutMs: a.timeoutMs || 60000 }); const r = await job.done;
  return { text: `node → exit ${r.code}\n${r.out}${r.err ? '\n[stderr]\n' + r.err : ''}`, isError: r.code !== 0 || !!r.reason };
}
async function wsNpm(a, ctx) {
  const node = findNode(), cli = path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(cli)) throw new Error('未找到 npm，请安装包含 npm 的 Node，或用 workspace_shell 运行系统包管理器');
  const registry = new URL(a.registry || 'https://registry.npmjs.org'); if (registry.protocol !== 'https:') throw new Error('registry 必须使用 HTTPS');
  const args = [cli, ...(a.command === 'init' ? ['init', '-y'] : ['install', ...(a.packages || (a.package ? [a.package] : [])), ...(a.dev ? ['--save-dev'] : [])]), '--ignore-scripts', '--registry', registry.href];
  const job = await start(ctx, { file: node, args, cwd: workRoot(ctx), trustedPurpose: 'dependency-install', timeoutMs: a.timeoutMs || 180000, network: a.command === 'init' ? [] : [registry.hostname] }); const r = await job.done;
  return { text: `npm → exit ${r.code}\n${r.out}${r.err ? '\n[stderr]\n' + r.err : ''}`, isError: r.code !== 0 || !!r.reason };
}
const S = (properties, required) => ({ type: 'object', properties, additionalProperties: false, ...(required ? { required } : {}) });
const str = { type: 'string' }, num = { type: 'number' }, bool = { type: 'boolean' };
export const WORKSPACE_TOOLS = [
  { name: 'workspace_list', description: '列出工作目录与项目授权根 ID。root 可选择附加目录；默认主目录。跳过敏感文件与链接。', schema: S({ root: str, path: str, depth: num, includeModules: bool }), run: wsList },
  { name: 'workspace_read', description: '读取工作文件并返回版本 hash。root 可选项目附加目录 ID；写入只作用于主目录。', schema: S({ root: str, path: str, file: str, max: num, binary: bool }), run: wsRead },
  { name: 'workspace_write', description: '创建或覆盖文本文件。覆盖前先读取；修改已有代码优先 workspace_edit。改动可在界面审阅和撤销。', schema: S({ path: str, file: str, content: str, expectedHash: str }, ['content']), run: wsWrite },
  { name: 'workspace_edit', description: '精确替换已有文件，old_string 默认必须唯一；replace_all 可替换全部。', schema: S({ path: str, old_string: str, new_string: str, replace_all: bool }, ['path', 'old_string', 'new_string']), run: (a, ctx) => editWorkspace(ctx, a) },
  { name: 'workspace_grep', description: '检索代码，返回相对路径和行号。root 可选项目附加目录 ID；支持 glob、子目录和正则。', schema: S({ root: str, pattern: str, path: str, glob: str, literal: bool, ignoreCase: bool, max: num, includeModules: bool }, ['pattern']), run: (a, ctx) => grepWorkspace(ctx, a) },
  { name: 'workspace_run', description: '用 Node 执行当前工作目录内的脚本或 eval，遵守执行隔离和审批。', schema: S({ file: str, path: str, eval: str, args: { type: 'array', items: str }, timeoutMs: num }), run: wsRun },
  { name: 'workspace_npm', description: '在工作目录安装依赖或初始化 npm；默认禁用安装脚本，联网需授权。', schema: S({ packages: { type: 'array', items: str }, package: str, command: { type: 'string', enum: ['install', 'init'] }, registry: str, dev: bool, timeoutMs: num }), run: wsNpm },
  { name: 'workspace_shell', description: '在当前工作目录执行命令。Windows 用 PowerShell，其他平台用 sh。支持后台任务；networkDomains 申请受限执行所需域名。未隔离执行会明确请求用户确认。', schema: S({ cmd: str, timeoutMs: num, background: bool, networkDomains: { type: 'array', items: str } }, ['cmd']), run: (a, ctx) => shellWorkspace(ctx, a) },
  { name: 'workspace_job_output', description: '读取本对话后台任务输出，offset 支持分页。', schema: S({ id: str, offset: num }, ['id']), run: (a, ctx) => jobOutput(ctx, a) },
  { name: 'workspace_job_kill', description: '停止本对话后台任务及子进程，不能结束其他进程。', schema: S({ id: str }, ['id']), run: (a, ctx) => jobKill(ctx, a) },
].map(tool => ({ ...tool, strict: true }));
