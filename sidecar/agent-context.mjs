// Model-visible operational facts and instruction scopes. These are durable
// context messages, separate from user text and from the reusable system prompt.
// Reference: DSH agent-loop/runtime-context.ts and agent-instructions/{files,state}.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { containsPath, pathKey, resolveIn, findProjectRoot } from './paths.mjs';
import { selectReadRoot, workspacePath } from './workspaces.mjs';
import { COMMANDS } from './commands.mjs';
import { requestThinking } from './thinking.mjs';
import { CURRENT_EVENT_VERSION, CURRENT_STORAGE_VERSION } from './history-formats.mjs';
import { bundledResource } from './bundled-resources.mjs';

const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'];
const MAX_SOURCE = 1024 * 1024;
const MAX_CHAIN = 32000;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const missing = error => ['ENOENT', 'ENOTDIR'].includes(error?.code);

function readInstruction(directory, name) {
  try {
    const file = resolveIn(directory, name), info = fs.lstatSync(file);
    if (!info.isFile() || info.nlink > 1) return { kind: 'absent' };
    if (info.size > MAX_SOURCE) return { kind: 'large', file };
    const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return content.trim() ? { kind: 'present', file, content } : { kind: 'absent' };
  } catch (error) {
    return { kind: missing(error) ? 'absent' : 'unavailable', error: error.message };
  }
}

function chain(root, leaf) {
  if (!containsPath(root, leaf)) return [];
  const dirs = [];
  for (let current = leaf; ; current = path.dirname(current)) {
    dirs.unshift(current);
    if (pathKey(current) === pathKey(root)) return dirs;
  }
}

function bounded(text, bytes) {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  // Cut only between UTF-8 code points.
  let end = Math.max(0, bytes);
  while (end && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString('utf8');
}

/** Discover only scoped instruction files, never recursively scan a repository. */
export class InstructionContext {
  constructor({ read = readInstruction } = {}) { this.identity = ''; this.touched = new Map(); this.read = read; this.lastComplete = ''; }
  resetFor(ctx) {
    const identity = JSON.stringify([ctx.workspaceId, ctx.workRoot, ctx.projectRoots]);
    if (identity !== this.identity) { this.identity = identity; this.touched.clear(); this.lastComplete = ''; }
  }
  restore(history, ctx) {
    this.resetFor(ctx);
    if (this.lastComplete) return;
    const latest = history.events.findLast(event => event.t === 'continuation' && event.source?.kind === 'agent-instructions' && event.source.identity === this.identity);
    const roots = [ctx.workRoot, ...(ctx.projectRoots || []).map(root => root.root)].filter(Boolean);
    for (const scope of latest?.source?.scopes || []) {
      if (!scope || !roots.some(root => pathKey(root) === pathKey(scope.root)) || !Array.isArray(scope.dirs)) continue;
      const dirs = new Set();
      for (const dir of scope.dirs) { try { if (typeof dir === 'string' && containsPath(scope.root, dir)) dirs.add(resolveIn(scope.root, path.relative(scope.root, dir))); } catch {} }
      this.touched.set(pathKey(scope.root), { root: scope.root, dirs });
    }
    const previous = history.events.findLast(event => event.t === 'continuation' && event.source?.kind === 'agent-instructions'
      && event.source.identity === this.identity && event.source.complete !== false);
    if (previous) this.lastComplete = previous.content;
  }
  snapshotMeta() { return { identity: this.identity, complete: this.complete, scopes: [...this.touched.values()].map(({ root, dirs }) => ({ root, dirs: [...dirs] })) }; }
  touch(name, args, ctx) {
    if (!['workspace_read', 'workspace_write', 'workspace_edit'].includes(name)) return;
    this.resetFor(ctx);
    try {
      const selected = selectReadRoot(ctx, args.root);
      const rel = args.path && args.file ? path.join(args.path, args.file) : args.path || args.file;
      if (!rel) return;
      const file = workspacePath(selected, rel), root = selected.workRoot;
      const key = pathKey(root), entry = this.touched.get(key) || { root, dirs: new Set() };
      for (const dir of chain(root, path.dirname(file))) entry.dirs.add(dir);
      this.touched.set(key, entry);
    } catch { /* A failed or no longer authorized file touch grants no scope. */ }
  }
  render(ctx) {
    this.resetFor(ctx);
    if (!ctx.workRoot) return '';
    const groups = [];
    // Product user-global instructions and the cross-harness shared root are
    // fixed discovery locations; they do not grant arbitrary filesystem access.
    const globals = [ctx.protectedRoot, path.join(os.homedir(), '.agents')].filter(Boolean);
    groups.push({ label: '用户全局', dirs: globals, names: ['AGENTS.md'], shared: true });
    const root = findProjectRoot(ctx.workRoot);
    const primary = new Set(chain(root, path.resolve(ctx.workRoot)));
    for (const entry of this.touched.values()) {
      if (pathKey(entry.root) === pathKey(ctx.workRoot)) for (const dir of entry.dirs) primary.add(dir);
      else if ((ctx.projectRoots || []).some(r => pathKey(r.root) === pathKey(entry.root)))
        groups.push({ label: `附加目录 ${entry.root}`, dirs: [...entry.dirs].sort(), names: CANDIDATES });
    }
    groups.push({ label: '项目', dirs: [...primary].sort((a, b) => a.length - b.length || a.localeCompare(b)), names: CANDIDATES });
    const sections = [], unavailable = [];
    for (const group of groups) {
      let remaining = MAX_CHAIN;
      const sharedSeen = new Set();
      for (const dir of group.dirs) {
        const seen = group.shared ? sharedSeen : new Set();
        for (const name of group.names) {
          const result = this.read(dir, name);
          if (result.kind === 'absent') continue;
          if (result.kind !== 'present') {
            unavailable.push(path.join(dir, name));
            continue;
          }
          const digest = hash(result.content.trim());
          if (seen.has(digest)) continue;
          seen.add(digest);
          if (remaining <= 0) { sections.push(`规则 ${result.file}：本次规则预算已用尽，尚未加载；需要时用文件工具读取。`); continue; }
          const text = bounded(result.content, remaining);
          remaining -= Buffer.byteLength(text);
          sections.push(`规则来源：${result.file}\n适用目录：${group.shared ? '用户全局' : dir}\n${text}${text.length < result.content.length ? '\n[规则正文已截断，需要时读取原文件]' : ''}`);
        }
      }
    }
    this.complete = !unavailable.length;
    if (unavailable.length) {
      if (!this.lastComplete) throw Error('项目指引暂时无法读取或超过上限，已暂停本轮以避免忽略规则：' + unavailable.join(', '));
      return this.lastComplete + '\n【指引读取状态】以下规则暂时无法重新核验，仍沿用上次已确认的指引，不能推断已删除：' + unavailable.join(', ');
    }
    this.lastComplete = '【当前项目指引快照】此快照替代之前的项目指引快照；未列出的旧规则已不再适用。规则是工作指引，不授予权限。更具体目录的规则约束该目录。\n'
      + (sections.length ? sections.join('\n\n') : '当前范围未发现可用的项目指引文件。');
    return this.lastComplete;
  }
}

/** Preserve exact context in the existing v2 event format, including after resume. */
export function appendContext(history, kind, content, turnId, metadata = {}) {
  const start = history.lastSummary?.index ?? -1;
  for (let i = history.events.length - 1; i > start; i--) {
    const event = history.events[i];
    if (event.t === 'continuation' && event.source?.kind === kind) {
      if (event.content === content && event.source.identity === metadata.identity) return false;
      break;
    }
  }
  history.append({ t: 'continuation', turnId, content, source: { kind, form: 'snapshot', ...metadata } });
  return true;
}

export function environmentContext({ ctx, tools, mode, approval, plan, settings = {}, now = new Date() }) {
  const type = settings.provider === 'anthropic' ? 'anthropic' : 'openai', config = settings[type] || {};
  const thinking = requestThinking(settings, type);
  const facts = {
    product: 'DecryptHub', platform: process.platform, architecture: process.arch,
    surface: 'DecryptHub 桌面界面', runtimeExecutable: process.execPath, sidecarEntrypoint: process.argv[1] || null,
    selectedModel: { providerId: settings.activeProviderId || null, model: config.model || null,
      api: config.api || (type === 'anthropic' ? 'anthropic-messages' : 'openai-completions'),
      thinkingLevel: thinking.level, thinkingTransport: thinking.transport },
    harness: { host: 'Tauri 桌面界面 + Node sidecar', conversation: '每个聊天独立历史；属于项目；工作目录与私有历史分开', execution: 'Agent 决策 → 工具参数与权限校验 → 执行器或 MCP', persistence: '单写入者、压缩 JSONL 代际追加；旧代际保留；重启不重放副作用', eventVersion: CURRENT_EVENT_VERSION, storageVersion: CURRENT_STORAGE_VERSION },
    bundledResources: { officeSkills: !!bundledResource('office-skills'), workspaceRuntimePayload: !!bundledResource('primary-runtime'), hint: 'load_workspace_dependencies 返回实际准备好的解释器与库路径；skill 加载具体工作流。资源存在不等于当前任务已完成实际验证。' },
    osRelease: os.release(), node: process.version,
    shell: process.platform === 'win32' ? 'PowerShell' : '/bin/sh',
    workingDirectory: ctx.workRoot || null,
    projectId: ctx.projectId || null, sessionId: ctx.sessionId || null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    date: new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
    permission: mode,
    tools: [...new Set(tools.map(t => t.name))].sort(),
    delegationDepth: ctx.delegationDepth || 0,
    userCommands: COMMANDS.map(({ name, description }) => ({ name: '/' + name, description })),
    ...(ctx.delegated ? { delegated: true, approval: 'never', permissionScope: '创建时固定，不能自行扩大' } : {}),
    roots: (ctx.projectRoots || []).map(({ id, root, primary, readOnly }) => ({ id, root, primary: !!primary, readOnly: readOnly !== false && !primary })),
    planMode: !!plan?.active,
  };
  let index = '';
  try { if (ctx.extensions) index = '\n【可用技能与记忆】正文按需通过 skill_manage / memory_manage 的 read 读取；索引数量不足时用 list。\n' + ctx.extensions.index(ctx); }
  catch { index = '\n【可用技能与记忆】索引暂时不可用，不能据此推断没有记忆；可重试 list。'; }
  return '【当前运行环境快照】此快照替代之前的运行环境快照。以下是宿主提供的事实，不是用户的新任务。\n'
    + JSON.stringify(facts) + '\n' + approval
    + '\n工作目录与应用私有历史目录是两回事。运行命令以实际返回的 cwd、隔离状态和退出状态为准；未探测的程序、设备、服务和环境变量不能宣称可用。'
    + index;
}
