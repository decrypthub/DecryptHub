import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, containsPath, resolveIn, isSensitivePath } from './paths.mjs';
import { ChangeBlobs } from './change-blobs.mjs';
import { atomicWorkspaceWrite } from './fs-atomic.mjs';
export const contentHash = text => crypto.createHash('sha256').update(text).digest('hex');
export class ChangeStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, '.changes.json'); this.blobs = new ChangeBlobs(resolveIn(dataDir, '.changes')); this.items = [];
    try { const bytes = fs.readFileSync(this.file), raw = JSON.parse(bytes); if (raw.v > 2 || !Array.isArray(raw.items)) throw Error('改动索引格式不受支持'); this.items = raw.items; if (raw.v !== 2) this.legacy = bytes; }
    catch (error) { if (error.code !== 'ENOENT') throw Error('无法读取文件改动索引：' + error.message, { cause: error }); }
  }
  save() {
    for (const item of this.items) for (const side of ['before', 'after']) if (Object.hasOwn(item, side)) { item[side + 'Ref'] = this.blobs.put(item[side]); delete item[side]; }
    if (this.legacy) { fs.mkdirSync(this.blobs.root, { recursive: true, mode: 0o700 }); const backup = resolveIn(this.blobs.root, 'legacy-' + contentHash(this.legacy) + '.json'); if (!fs.existsSync(backup)) { const fd = fs.openSync(backup, 'wx', 0o600); try { fs.writeFileSync(fd, this.legacy); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } }
    atomicJson(this.file, { v: 2, items: this.items }); this.legacy = null;
  }
  write(root, file, content, { expectedHash, workspaceId, runId } = {}) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (!containsPath(root, file) || isSensitivePath(rel)) throw new Error('拒绝修改此路径');
    resolveIn(root, rel);
    const exists = fs.existsSync(file), before = exists ? fs.readFileSync(file, 'utf8') : null;
    if (exists && fs.statSync(file).nlink > 1) throw new Error('拒绝修改有多个硬链接的文件');
    if (expectedHash && contentHash(before ?? '') !== expectedHash) throw new Error('文件已发生变化，请重新读取后再编辑');
    const e = { id: crypto.randomUUID(), workspaceId, root, path: rel, before, after: content, afterHash: contentHash(content), runId, at: Date.now(), status: 'pending' };
    this.items.push(e); this.items = this.items.slice(-100); this.save();
    try { atomicWorkspaceWrite(root,file,content,{expectedHash:exists?contentHash(before):undefined,createOnly:!exists}); }
    catch (error) { e.status = 'conflict'; this.save(); throw error; }
    e.status = 'applied'; this.save(); return e;
  }
  remove(root, file, { expectedHash, workspaceId, runId } = {}) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    resolveIn(root, rel);
    if (isSensitivePath(rel) || !fs.lstatSync(file).isFile() || fs.statSync(file).nlink > 1) throw Error('不能删除此文件');
    const before = fs.readFileSync(file, 'utf8');
    if (expectedHash && contentHash(before) !== expectedHash) throw Error('删除前文件已变化');
    const entry = { id: crypto.randomUUID(), workspaceId, root, path: rel, before, after: null, afterHash: null, runId, at: Date.now(), status: 'pending' };
    this.items.push(entry); this.items = this.items.slice(-100); this.save();
    resolveIn(root, rel);
    if (contentHash(fs.readFileSync(file, 'utf8')) !== contentHash(before)) { entry.status = 'conflict'; this.save(); throw Error('删除前文件已变化'); }
    fs.unlinkSync(file); entry.status = 'applied'; this.save(); return entry;
  }
  list(workspaceId) { return this.items.filter(e => e.workspaceId === workspaceId).map(({ before, after, beforeRef, afterRef, root, ...e }) => ({ ...e, created: beforeRef === null || before === null, deleted: afterRef === null || after === null, beforeLines: beforeRef?.lines ?? before?.split('\n').length ?? 0, afterLines: afterRef?.lines ?? after?.split('\n').length ?? 0 })); }
  detail(id, workspaceId, { offset = 0, maxChars = 80000 } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !(maxChars === Infinity || Number.isSafeInteger(maxChars) && maxChars > 0 && maxChars <= 300000)) throw Error('改动内容窗口无效');
    const e = this.items.find(e => e.id === id && e.workspaceId === workspaceId); if (!e) throw new Error('改动记录不存在');
    const result = { ...e, windows: {} };
    for (const side of ['before', 'after']) {
      const ref = e[side + 'Ref'];
      if (ref === null || e[side] === null) result[side] = null;
      else { const window = ref ? this.blobs.read(ref.hash, { offset, maxChars }) : { text: (e[side] || '').slice(offset, offset + maxChars), totalChars: (e[side] || '').length, offset };
        result[side] = window.text; result.windows[side] = { ...window, text: undefined, truncated: offset + window.text.length < window.totalChars }; }
    }
    return result;
  }
  undo(id, ws) {
    const e = this.items.find(e => e.id === id && e.workspaceId === ws.id); if (!e) throw Error('改动记录不存在');
    const version = this.detail(id, ws.id, { maxChars: Infinity });
    if (e.status !== 'applied') throw new Error('此改动不能撤销');
    if (path.resolve(e.root) !== path.resolve(ws.root)) throw new Error('工作区已变化');
    const file = resolveIn(ws.root, e.path);
    if (version.after === null) {
      if (fs.existsSync(file)) throw Error('文件已被重新创建，不能覆盖');
      atomicWorkspaceWrite(ws.root,file,version.before,{createOnly:true});
      e.status = 'reverted'; this.save(); return { ok: true };
    }
    if (!fs.existsSync(file) || contentHash(fs.readFileSync(file)) !== e.afterHash) throw new Error('文件已被后续操作修改，不能覆盖；请先查看差异');
    if (version.before === null) fs.unlinkSync(file); else atomicWorkspaceWrite(ws.root,file,version.before,{expectedHash:e.afterHash});
    e.status = 'reverted'; this.save(); return { ok: true };
  }
}
