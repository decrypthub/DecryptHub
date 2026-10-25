import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, containsPath, pathKey, resolveIn, isSensitivePath } from './paths.mjs';

const leases = new Map();
export class WorkspaceStore {
  constructor(userDataDir) {
    this.userDataDir = path.resolve(userDataDir); this.file = path.join(userDataDir, 'workspaces.json'); this.entries = [];
    try { this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8')).entries || []; } catch {}
  }
  save() { atomicJson(this.file, { v: 1, entries: this.entries }); }
  managed(id, dataDir) { return { id: 'managed-' + id, kind: 'managed', root: path.join(dataDir, 'workspace'), revision: 1, label: '会话工作区' }; }
  folder(root) {
    const canonical = fs.realpathSync.native(path.resolve(String(root)));
    if (!fs.statSync(canonical).isDirectory()) throw new Error('请选择文件夹');
    if (containsPath(this.userDataDir, canonical)) throw new Error('应用数据目录不能作为代码工作区');
    if (path.parse(canonical).root === canonical) throw new Error('请选择具体项目文件夹，不要选择整个磁盘');
    const st = fs.statSync(canonical), identity = `${st.dev}:${st.ino}:${st.birthtimeMs}`;
    let entry = this.entries.find(e => pathKey(e.root) === pathKey(canonical));
    if (!entry) { entry = { id: crypto.randomUUID(), kind: 'folder', root: canonical, revision: 1 }; this.entries.push(entry); }
    if (entry.identity && entry.identity !== identity) entry.revision++;
    Object.assign(entry, { identity, label: path.basename(canonical), lastUsed: Date.now() }); this.save(); return { ...entry };
  }
  restore(binding, id, dataDir) { return binding?.kind === 'folder' ? { ...binding, missing: !fs.existsSync(binding.root) } : this.managed(id, dataDir); }
  recent() { return [...this.entries].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 12); }
  verify(ws) {
    if (ws.kind === 'managed') fs.mkdirSync(ws.root, { recursive: true });
    if (!fs.existsSync(ws.root)) throw new Error('工作文件夹不存在，请重新选择文件夹');
    const st = fs.statSync(ws.root);
    if (!st.isDirectory() || (ws.identity && `${st.dev}:${st.ino}:${st.birthtimeMs}` !== ws.identity)) throw new Error('工作文件夹身份已变化，请重新选择文件夹');
    resolveIn(ws.root, '.'); return ws.root;
  }
  acquire(ws, owner, write = true) {
    this.verify(ws);
    const key = pathKey(ws.root), prev = leases.get(key);
    if (write && prev && prev !== owner) throw new Error('另一个任务正在修改此文件夹，请等它完成或使用另一个文件夹');
    if (write) leases.set(key, owner);
    return () => { if (leases.get(key) === owner) leases.delete(key); };
  }
}
export function workRoot(ctx) {
  const root = typeof ctx === 'string' ? path.join(ctx, 'workspace') : ctx.workRoot || path.join(ctx.projectDir, 'workspace');
  if (typeof ctx !== 'string' && ctx.workspaceKind === 'folder' && !fs.existsSync(root)) throw new Error('工作文件夹不存在，请重新选择');
  fs.mkdirSync(root, { recursive: true }); return root;
}
export function workspacePath(ctx, rel, { write = false } = {}) {
  const root = workRoot(ctx), target = resolveIn(root, rel, { label: '工作区' });
  if (typeof ctx !== 'string') {
    if (write && ctx.mode === 'read-only') throw new Error('只读权限：不能修改工作文件');
    if (ctx.protectedRoot && containsPath(ctx.protectedRoot, target) && ctx.workspaceKind === 'folder') throw new Error('禁止访问应用数据');
  }
  if (isSensitivePath(path.relative(root, target))) throw new Error('敏感文件不可由 Agent 自动读取或修改；请按需明确提供相关内容');
  if (fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).nlink > 1) throw new Error('拒绝访问有多个硬链接的文件');
  return target;
}
