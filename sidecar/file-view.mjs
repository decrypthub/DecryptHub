// 文件浏览面板的后端：一层目录的读取契约与目录监听。
//
// 契约对齐 DeepSeek Harness 的 `packages/api/workspace-files`：
//   · 每个条目是 `{ name, type: 'file'|'directory'|'other', size? }`，不含路径拼接
//   · 一层返回 `{ path（该目录的绝对路径）, entries, truncated }`
//   · 失败带**机器可路由的错误码**，而不是只有一条给人看的字符串
// 这样界面才能像 DSH 一样按错误码分别说「目录不在了」「在工作区之外」「这不是目录」。
//
// 与 DSH 的两处有意差异（安全边界，不是遗漏）：
//   1. 符号链接报 `other` 而不是目标类型。DSH 读文件时仍会拒绝符号链接，
//      所以它的 `type` 只是「列目录事实」；我们这里干脆不承诺可读性——
//      Agent 工具与 workspacePath 一律不跟随链接，界面也就不该显示成可展开的目录。
//   2. 敏感文件（.env / *.pem / id_rsa …）继续不列出。那是与 Agent 工具共用的边界，
//      在这里放出去等于新开一处泄露面。
import fs from 'node:fs';
import path from 'node:path';
import { isSensitivePath } from './paths.mjs';
import { workRoot, workspacePath } from './workspaces.mjs';

/** 与 Agent 工具一致的目录排除项：这些名字既不显示也不遍历。 */
export const IGNORED_DIRECTORIES = new Set(['.git', '.ctx', '.chats', '.exec', '.capture', 'node_modules']);

/** 一层目录最多返回的条目数；超出就标记 `truncated`，由界面说明「只显示了一部分」。 */
export const MAX_ENTRIES = 2000;

/**
 * 一个带错误码的失败。
 * @param {string} code - `workspace-file/not-found` | `workspace-file/outside-workspace` | `workspace-file/not-directory`
 * @param {string} message - 给人看的说明；界面对已知码会换成自己的文案。
 * @returns {Error}
 */
export function fileError(code, message) {
  return Object.assign(new Error(message), { code });
}

const toPosix = value => String(value).split(path.sep).join('/');

/**
 * 列出工作区内一层目录。
 *
 * 与 `workspace_list` 的分工：那个会递归遍历给模型看（`walk()` / `wsList`），
 * 这里**只读一层**，供界面逐层展开。两者不共用代码，因此改这里不会改变 Agent 的工具行为。
 * @param {object} ctx - 工具上下文（`session.toolCtx()` 或 `selectReadRoot()` 的结果）
 * @param {string} [rel] - 相对工作区根的目录；`.`
 * @returns {{ path: string, entries: Array<{ name: string, type: string, size?: number }>, truncated: boolean }}
 */
export function listDirectoryView(ctx, rel = '.') {
  const root = workRoot(ctx);
  let base;
  try { base = workspacePath(ctx, rel); }
  // 越界与敏感路径对浏览器是同一件事：这个目录不在可浏览范围内。
  catch (e) { throw fileError('workspace-file/outside-workspace', e.message); }
  let stat;
  try { stat = fs.statSync(base); }
  catch { throw fileError('workspace-file/not-found', '目录不存在'); }
  if (!stat.isDirectory()) throw fileError('workspace-file/not-directory', '不是文件夹');

  const entries = [];
  let seen = 0;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = path.join(base, entry.name);
    const relative = toPosix(path.relative(root, child));
    if (isSensitivePath(relative)) continue;
    let info;
    try { info = fs.lstatSync(child); } catch { continue; }
    seen++;
    if (entries.length >= MAX_ENTRIES) continue;
    // 链接不跟随：报 `other`，界面灰显不可点，从而「完整呈现目录内容」但不承诺可读。
    if (info.isSymbolicLink()) { entries.push({ name: entry.name, type: 'other' }); continue; }
    if (info.isDirectory()) { entries.push({ name: entry.name, type: 'directory' }); continue; }
    if (info.isFile()) { entries.push({ name: entry.name, type: 'file', size: info.size }); continue; }
    entries.push({ name: entry.name, type: 'other' });
  }
  // DSH 的说法是「一层按后端稳定的名字顺序返回，展示顺序由调用方决定」，界面也会再排一次。
  // 这里仍给出「目录优先、再按名字自然序」的稳定顺序，因为这是本仓既有的返回契约
  // （`test/workspace-agent.test.mjs` 锁着它），重复排序不会改变界面结果。
  entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory')
    || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  return { path: base, entries, truncated: seen > entries.length };
}

/**
 * 目录监听：每个展开中的目录一条 `fs.watch`，只关心它的直接子项。
 *
 * 由界面在展开/收起后同步一次「当前展开的绝对路径列表」，这里做差集开关，
 * 所以一条展开路径最多产生一次往返，不需要每个目录各发一条请求。
 * 变化事件按目录合并后再上报，避免一次写入触发十几个抖动。
 */
export class DirectoryWatches {
  /**
   * @param {(sessionId: string, paths: readonly string[]) => void} onChange - 收到「这些目录的直接子项变了」
   */
  constructor(onChange) {
    this.onChange = onChange;
    /** @type {Map<string, Map<string, { watcher: fs.FSWatcher, timer: NodeJS.Timeout | null }>>} */
    this.bySession = new Map();
  }

  /**
   * 让某个会话的监听集合等于给定目录集合。
   * @param {string} sessionId - 会话 id
   * @param {readonly string[]} paths - 该会话当前展开的目录绝对路径
   */
  sync(sessionId, paths) {
    const wanted = new Set(paths.filter(value => typeof value === 'string' && value));
    let watched = this.bySession.get(sessionId);
    if (!watched) { watched = new Map(); this.bySession.set(sessionId, watched); }
    for (const [key, entry] of watched) {
      if (wanted.has(key)) continue;
      this.closeEntry(entry);
      watched.delete(key);
    }
    for (const key of wanted) {
      if (watched.has(key)) continue;
      const entry = this.watchOne(sessionId, key);
      if (entry) watched.set(key, entry);
    }
    if (!watched.size) this.bySession.delete(sessionId);
  }

  /**
   * 一条目录监听；目录读不到就当作没展开，不报错也不重试。
   * @param {string} sessionId - 会话 id
   * @param {string} absolute - 目录绝对路径
   * @returns {{ watcher: fs.FSWatcher, timer: NodeJS.Timeout | null } | null}
   */
  watchOne(sessionId, absolute) {
    let watcher;
    try {
      // persistent:false —— 监听不能拖住进程退出；session 关掉时会显式 close。
      watcher = fs.watch(absolute, { persistent: false }, () => this.queue(sessionId, absolute));
    } catch { return null; }
    watcher.on('error', () => {
      // 目录在监听期间被删掉会走到这里；收起它，下次展开时重新建立。
      const watched = this.bySession.get(sessionId);
      const entry = watched?.get(absolute);
      if (entry) { this.closeEntry(entry); watched.delete(absolute); }
    });
    return { watcher, timer: null };
  }

  /**
   * 把一次变化并到该目录的待上报批次里。
   * @param {string} sessionId - 会话 id
   * @param {string} absolute - 变化的目录
   */
  queue(sessionId, absolute) {
    const entry = this.bySession.get(sessionId)?.get(absolute);
    if (!entry) return;
    entry.pending = true;
    if (entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const paths = [...(this.bySession.get(sessionId) || new Map()).entries()]
        .filter(([, value]) => value.pending).map(([key]) => key);
      for (const value of (this.bySession.get(sessionId) || new Map()).values()) value.pending = false;
      if (paths.length) { try { this.onChange(sessionId, paths); } catch {} }
    }, 150);
  }

  /** @param {{ watcher: fs.FSWatcher, timer: NodeJS.Timeout | null }} entry */
  closeEntry(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    try { entry.watcher.close(); } catch {}
  }

  /** @param {string} sessionId - 会话 id */
  closeSession(sessionId) {
    const watched = this.bySession.get(sessionId);
    if (!watched) return;
    for (const entry of watched.values()) this.closeEntry(entry);
    this.bySession.delete(sessionId);
  }

  closeAll() {
    for (const sessionId of [...this.bySession.keys()]) this.closeSession(sessionId);
  }
}
