import fs from 'node:fs';
import path from 'node:path';
import { workRoot, workspacePath, selectReadRoot } from './workspaces.mjs';
import { isSensitivePath } from './paths.mjs';
import { contentHash } from './changes.mjs';
import { executor, findNode, shellSpec, childEnv } from './executor.mjs';
import { findJob, killTracked, killTrackedProject, trackJob } from './jobs.mjs';
import { TERMINAL_TOOLS } from './terminal-tools.mjs';
import { searchWorkspace } from './workspace-search.mjs';
import { readTextWindow } from './workspace-read.mjs';
export { childEnv };

const ignored = new Set(['.git', '.ctx', '.chats', '.exec', '.capture', 'node_modules']);
const ctxOf = v => typeof v === 'string' ? { projectDir: v } : v;
const slash = v => v.split(path.sep).join('/');
/** path 是目录、file 是文件名；只传一个时即那个相对路径，两个都给则拼接。 */
function workspaceRel(a) {
  const p = a.path ? String(a.path).replace(/\\/g, '/') : '';
  const f = a.file ? String(a.file).replace(/\\/g, '/') : '';
  if (!p) return f;
  if (!f) return p;
  return path.posix.join(p, f);
}
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
//
// 实现已迁到 `file-view.mjs`（对齐 DeepSeek Harness 的 workspace-files 契约：
// `type: file|directory|other`、带错误码的失败、每层 truncated）。这里只保留
// 这个入口，因为 Agent 侧的测试与调用点引用的是它的名字。
export { listDirectoryView as listDirectory } from './file-view.mjs';
export function readWorkspace(ctx, rel, max = 300000) {
  const p = workspacePath(ctx, rel), st = fs.statSync(p); if (!st.isFile()) throw new Error('不是文件');
  const fd = fs.openSync(p, 'r');
  try { const buffer = Buffer.alloc(Math.min(st.size, Math.max(1, max) * 4)); const n = fs.readSync(fd, buffer); return buffer.subarray(0, n).toString('utf8').slice(0, max); }
  finally { fs.closeSync(fd); }
}
function write(ctx, rel, content, expectedHash) {
  const root = workRoot(ctx), file = workspacePath(ctx, rel, { write: true });
  if (fs.existsSync(file) && fs.statSync(file).nlink > 1) throw new Error('不能修改多硬链接文件');
  if (ctx.changes) ctx.changes.write(root, file, content, { workspaceId: ctx.workspaceId, runId: ctx.runId, expectedHash });
  else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  ctx.readHashes?.set(file, contentHash(content));
  return { text: `已写入 ${slash(path.relative(root, file))}（${Buffer.byteLength(content)} 字节）`, wrote: [file] };
}
async function wsWrite(a, ctx) {
  const rel = workspaceRel(a); if (!rel) throw new Error('需要 path 或 file');
  const file = workspacePath(ctx, rel, { write: true }), expected = a.expectedHash || ctx.readHashes?.get(file);
  if (fs.existsSync(file) && ctx.readHashes && !expected) throw new Error('覆盖已有文件前请先 workspace_read，或使用 workspace_edit 精确替换');
  return write(ctx, rel, String(a.content ?? ''), expected);
}
async function wsRead(a, ctx) {
  ctx = selectReadRoot(ctx, a.root);
  const rel = workspaceRel(a); if (!rel) throw new Error('需要 path 或 file');
  const file = workspacePath(ctx, rel), st = fs.statSync(file);
  if (!st.isFile()) throw new Error('不是文件：' + rel + (a.path && a.file ? '（path 是目录、file 是文件名，两者会拼接）' : ''));
  const max = Math.min(300000, Math.max(1, Number(a.max) || 50000));
  if (a.binary) {
    if (st.size > 8 * 1024 * 1024) throw Error('base64 读取最多 8MB；大文本请去掉 binary 并按行读取');
    const bytes = fs.readFileSync(file), hash = contentHash(bytes), text = bytes.toString('base64'); ctx.readHashes?.set(file, hash);
    return { text: `文件 ${rel}（${bytes.length} 字节，sha256=${hash}）：\n${text.slice(0, max)}${text.length > max ? '\n[base64 输出已截断]' : ''}` };
  }
  const result = await readTextWindow(file, { offset: a.offset ?? 1, limit: a.limit ?? 2000, signal: ctx.signal, verify: () => workspacePath(ctx, rel) });
  ctx.readHashes?.set(file, result.hash);
  const body = result.lines.map(line => `${line.number}: ${line.text}`).join('\n'), end = result.lines.at(-1)?.number || 0;
  const footer = body.length > max ? '本次输出已按 max 截断，请增大 max 或缩小 limit 后重读当前范围'
    : result.truncatedByBytes || end < result.totalLines ? `本次窗口已截断；用 offset=${end + 1} 继续读取` : '已到文件末尾';
  return { text: `文件 ${rel}（${result.size} 字节，sha256=${result.hash}，共 ${result.totalLines} 行）：\n${body.slice(0, max)}\n[${footer}]` };
}
async function wsList(a, ctx) {
  const roots = (ctx.projectRoots || []).map(r => `${r.id} · ${r.label}${r.primary ? '（主目录，可写）' : '（附加目录，只读）'}`).join('\n');
  ctx = selectReadRoot(ctx, a.root);
  const depth = Math.min(12, Math.max(0, a.depth ?? 3));
  const MAX = 10000;
  const entries = walk(ctx, a.path || '.', { depth, includeModules: !!a.includeModules, max: MAX });
  const body = entries.map(e => e.name + (e.directory ? '/' : `  ${e.size}B`)).join('\n') || '工作区为空，可以创建文件。';
  // walk() 到上限就直接停，不报告已停：模型会误以为「这就是全部」。这里必须说明。
  const notice = entries.length >= MAX
    ? `\n\n…(已截断：最多列出 ${MAX} 项，还有更多未列出。请用 path 缩小范围、减小 depth，或改用 workspace_grep 精确定位)`
    : '';
  return { text: (roots ? '项目目录（读取其他目录时传 root ID）：\n' + roots + '\n\n' : '') + `工作区：${workRoot(ctx)}（depth=${depth}，共 ${entries.length} 项）\n` + body + notice };
}
export function workspaceFileSize(v, rel) { try { return fs.statSync(workspacePath(ctxOf(v), rel)).size; } catch { return 0; } }
export function editWorkspace(v, a) {
  try {
    const ctx = ctxOf(v), rel = workspaceRel(a); if (!rel) throw new Error('需要 path 或 file');
    const old = String(a.old_string ?? a.old ?? ''), next = a.new_string ?? a.new;
    if (!old) throw new Error('old_string 不能为空'); if (next == null) throw new Error('需要 new_string'); if (old === String(next)) throw new Error('old_string 与 new_string 相同，没有改动');
    const file = workspacePath(ctx, rel, { write: true });
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file)); if (text.includes('\0')) throw new Error('二进制文件不能精确编辑');
    const observed = ctx.readHashes?.get(file);
    if (ctx.readHashes && !observed) throw new Error('编辑已有文件前请先 workspace_read，建立当前版本观察');
    if (observed && observed !== contentHash(text)) throw new Error('文件自上次读取后已变化，请重新读取再编辑');
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
function jobOwner(ctx) { return ctx.sessionId || ctx.projectDir || 'local'; }
function jobHeader(j) {
  const elapsed = Math.max(0, Math.round((((j.endedAt || Date.now()) - j.startedAt) || 0) / 1000));
  const state = j.status === 'running' ? 'running' : j.reason === 'cancelled' ? 'killed' : j.reason === 'timeout' ? 'timeout' : 'exit ' + j.code;
  return `job ${j.id} ${state} pid=${j.pid || '-'} time=${elapsed}s out=${j.out.length}B${j.err ? ' err=' + j.err.length + 'B' : ''}`;
}
function jobBody(j) {
  return `${j.out}${j.err ? '\n[stderr]\n' + j.err : ''}${j.truncated ? '\n[输出已截断]' : ''}`;
}
function jobText(j) { return jobHeader(j) + '\n' + jobBody(j); }
function lossLine(read) {
  if (!read?.lossy) return '';
  const files = [read.stdoutSpillPath && `stdout ${read.stdoutSpillPath}`, read.stderrSpillPath && `stderr ${read.stderrSpillPath}`].filter(Boolean);
  return '\n[中间输出已不在内存里' + (files.length ? '，完整内容见 ' + files.join('，') : '') + ']';
}
async function start(ctx, spec) { return ctx.exec ? await ctx.exec(spec) : executor.start(spec, { signal: ctx.signal, dataDir: ctx.projectDir }); }
function remember(ctx, job, label) {
  trackJob(job, { owner: jobOwner(ctx), projectDir: ctx.projectDir, label });
  return job;
}
export async function shellWorkspace(v, a, signal) {
  try {
    const ctx = { ...ctxOf(v), ...(signal ? { signal } : {}) }, cmd = String(a.cmd || a.command || '').trim();
    if (!cmd) throw new Error('需要 cmd'); if (cmd.length > 20000) throw new Error('命令过长');
    const background = !!a.background;
    // 前台和后台是同一次启动。后台不等；前台只等 timeoutMs，到点转入后台而不是杀掉。
    const waitMs = Math.min(300000, Math.max(1000, Number(a.timeoutMs) || 60000));
    const job = remember(ctx, await start(ctx, {
      ...shellSpec(cmd), cwd: workRoot(ctx), onExpiry: 'none', network: a.networkDomains || [],
    }), cmd);
    const isolated = job.isolated ? '受限执行' : '未隔离执行';
    if (background) return { text: `已在后台启动 id=${job.id} pid=${job.pid || '-'}\n${isolated}；用 workspace_job_output 查看、workspace_job_kill 停止。这次没有截止期限，进程会一直跑到自己结束或被停止。` };
    let finished = false, timer;
    const done = job.done.then(result => { finished = true; return result; });
    const wait = new Promise(resolve => { timer = setTimeout(() => resolve('wait-expired'), waitMs); });
    try { await Promise.race([done, wait]); }
    finally { clearTimeout(timer); }
    if (finished || job.status !== 'running') return { text: jobText(job), isError: job.code !== 0 || !!job.reason };
    const read = typeof job.readOutput === 'function' ? job.readOutput() : { delta: job.out || '' };
    const shown = read.delta?.trim() ? read.delta : '(到目前还没有输出)';
    return { text: `前台等待 ${Math.round(waitMs / 1000)} 秒已到，命令仍在运行，已转入后台继续执行（进程没有被杀掉）。\nid=${job.id} pid=${job.pid || '-'} ${isolated}\n--- 到目前为止的输出 ---\n${shown}${lossLine(read)}\n用 workspace_job_output 接着读新输出，用 workspace_job_kill 停止。` };
  } catch (e) { return { text: e.message, isError: true }; }
}
export function jobOutput(v, a) {
  const ctx = ctxOf(v), rec = findJob(String(a.id), jobOwner(ctx));
  if (!rec) return { text: '没有这个后台任务：' + a.id, isError: true };
  const j = rec.proc, header = jobHeader(j);
  if (a.tail) { const body = jobBody(j), slice = body.slice(-20000); return { text: `tail=${slice.length} total=${body.length}\n${header}\n${slice}` }; }
  if (a.offset != null && a.offset !== '') {
    const body = jobBody(j), offset = Math.max(0, Number(a.offset) || 0), slice = body.slice(offset, offset + 20000);
    return { text: `offset=${offset} next=${offset + slice.length} total=${body.length}\n${header}\n${slice}` };
  }
  const read = typeof j.readOutput === 'function' ? j.readOutput() : { delta: j.out || '', lossy: !!j.truncated };
  return { text: `${header}\n${read.delta || '(本次没有新输出)'}${lossLine(read)}` };
}
export function jobKill(v, a) {
  const rec = killTracked(String(a.id), jobOwner(ctxOf(v)));
  if (!rec) return { text: '没有这个后台任务：' + a.id, isError: true };
  return { text: '已请求结束任务 ' + rec.id };
}
export function killAllJobs(v) { killTrackedProject(ctxOf(v).projectDir); }

async function wsRun(a, ctx) {
  const file = a.eval ? null : workspacePath(ctx, workspaceRel(a) || 'index.js');
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
  { name: 'workspace_read', description: '读取工作文件并返回版本 hash。root 可选项目附加目录 ID；写入只作用于主目录。长文件用 offset/limit 按行分段读取，不要一次读完。', schema: S({ root: str, path: str, file: str, max: num, binary: bool, offset: num, limit: num }), run: wsRead },
  { name: 'workspace_write', description: '创建或覆盖文本文件。覆盖前先读取；修改已有代码优先 workspace_edit。改动可在界面审阅和撤销。', schema: S({ path: str, file: str, content: str, expectedHash: str }, ['content']), run: wsWrite },
  { name: 'workspace_edit', description: '精确替换已有文件，old_string 默认必须唯一；replace_all 可替换全部。', schema: S({ path: str, old_string: str, new_string: str, replace_all: bool }, ['path', 'old_string', 'new_string']), run: (a, ctx) => editWorkspace(ctx, a) },
  { name: 'workspace_grep', description: '通过 ripgrep 检索文件内容，返回相对路径和行号。root 选择授权目录；glob/include 是一个正向 glob，可用 {js,ts}。默认遵循 .gitignore/.ignore；includeModules=true 包含被忽略文件。支持正则/字面量，完整大结果保存为 context_ref_read 引用；取消、失败或超限会明确报告。', schema: S({ root: str, pattern: str, path: str, glob: str, include: str, literal: bool, ignoreCase: bool, max: num, includeModules: bool }, ['pattern']), run: (a, ctx) => searchWorkspace(ctx, a) },
  { name: 'workspace_glob', description: '通过 ripgrep 按 glob 查找文件名，按修改时间排序。包括隐藏和被忽略文件，排除版本库元数据、敏感文件和链接。支持 **/*.ts、*.{js,jsx} 等，root 选择授权目录；完整大结果保存为引用。', schema: S({ root: str, pattern: str, path: str, max: num, includeModules: bool }, ['pattern']), run: (a, ctx) => searchWorkspace(ctx, a, true) },
  { name: 'workspace_run', description: '用 Node 执行当前工作目录内的脚本或 eval，遵守执行隔离和审批。timeoutMs 指定预计耗时：默认 60 秒、上限 300 秒；预计更久的脚本请拆分为可续跑的步骤。', schema: S({ file: str, path: str, eval: str, args: { type: 'array', items: str }, timeoutMs: num }), run: wsRun },
  { name: 'workspace_npm', description: '在工作目录安装依赖或初始化 npm；默认禁用安装脚本，联网需授权。timeoutMs 默认 180 秒、上限 600 秒。', schema: S({ packages: { type: 'array', items: str }, package: str, command: { type: 'string', enum: ['install', 'init'] }, registry: str, dev: bool, timeoutMs: num }), run: wsNpm },
  { name: 'workspace_shell', description: '在当前工作目录执行命令。Windows 用 PowerShell，其他平台用 sh。前台和后台是同一次启动：background=true 立刻返回 id，不设截止期限。不设 background 时，timeoutMs（默认 60 秒、上限 300 秒）只决定等多久；到点命令转入后台继续跑，不会被杀掉。接着用 workspace_job_output 读新输出，用 workspace_job_kill 停止。networkDomains 申请受限执行所需域名。未隔离执行会明确请求用户确认。', schema: S({ cmd: str, timeoutMs: num, background: bool, networkDomains: { type: 'array', items: str } }, ['cmd']), run: (a, ctx) => shellWorkspace(ctx, a) },
  { name: 'workspace_job_output', description: '读取本对话后台任务自上次读取以来的新输出（连续调用不重复）。返回状态、已运行时间、输出大小。offset 按绝对位置分页且不推进游标；tail=true 读取最后 20KB，同样不推进游标。只能读本对话自己的任务。', schema: S({ id: str, offset: num, tail: bool }, ['id']), run: (a, ctx) => jobOutput(ctx, a) },
  { name: 'workspace_job_kill', description: '停止本对话后台任务及子进程，不能结束其他进程。', schema: S({ id: str }, ['id']), run: (a, ctx) => jobKill(ctx, a) },
  ...TERMINAL_TOOLS,
].map(tool => ({ ...tool, strict: true }));
