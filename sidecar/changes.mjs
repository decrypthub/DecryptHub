import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, containsPath, resolveIn, isSensitivePath } from './paths.mjs';
export const contentHash = text => crypto.createHash('sha256').update(text).digest('hex');
export class ChangeStore {
  constructor(dataDir) { this.file = path.join(dataDir, '.changes.json'); this.items = []; try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).items || []; } catch {} }
  save() { atomicJson(this.file, { v: 1, items: this.items }); }
  write(root, file, content, { expectedHash, workspaceId, runId } = {}) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (!containsPath(root, file) || isSensitivePath(rel)) throw new Error('拒绝修改此路径');
    resolveIn(root, rel);
    const exists = fs.existsSync(file), before = exists ? fs.readFileSync(file, 'utf8') : null;
    if (exists && fs.statSync(file).nlink > 1) throw new Error('拒绝修改有多个硬链接的文件');
    if (Buffer.byteLength(content) > 4 * 1024 * 1024 || (before && Buffer.byteLength(before) > 4 * 1024 * 1024)) throw new Error('单次编辑最多 4MB');
    if (expectedHash && contentHash(before ?? '') !== expectedHash) throw new Error('文件已发生变化，请重新读取后再编辑');
    const e = { id: crypto.randomUUID(), workspaceId, root, path: rel, before, after: content, afterHash: contentHash(content), runId, at: Date.now(), status: 'pending' };
    this.items.push(e); this.items = this.items.slice(-100); this.save();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + e.id + '.tmp', fd = fs.openSync(tmp, 'wx', exists ? fs.statSync(file).mode : 0o644);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    resolveIn(root, rel);
    if (exists && contentHash(fs.readFileSync(file, 'utf8')) !== contentHash(before)) { fs.unlinkSync(tmp); e.status = 'conflict'; this.save(); throw new Error('写入前文件已被其他程序修改'); }
    // A new file must never replace a file created after our initial check.
    try { if (exists) fs.renameSync(tmp, file); else { fs.linkSync(tmp, file); fs.unlinkSync(tmp); } }
    catch (error) { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); e.status = 'conflict'; this.save(); throw error; }
    e.status = 'applied'; this.save(); return e;
  }
  list(workspaceId) { return this.items.filter(e => e.workspaceId === workspaceId).map(({ before, after, root, ...e }) => ({ ...e, created: before === null, beforeLines: before?.split('\n').length || 0, afterLines: after.split('\n').length })); }
  detail(id, workspaceId) { const e = this.items.find(e => e.id === id && e.workspaceId === workspaceId); if (!e) throw new Error('改动记录不存在'); return e; }
  undo(id, ws) {
    const e = this.detail(id, ws.id); if (e.status !== 'applied') throw new Error('此改动不能撤销');
    if (path.resolve(e.root) !== path.resolve(ws.root)) throw new Error('工作区已变化');
    const file = resolveIn(ws.root, e.path);
    if (!fs.existsSync(file) || contentHash(fs.readFileSync(file)) !== e.afterHash) throw new Error('文件已被后续操作修改，不能覆盖；请先查看差异');
    if (e.before === null) fs.unlinkSync(file); else { const tmp = file + '.' + crypto.randomUUID() + '.tmp'; fs.writeFileSync(tmp, e.before, { flag: 'wx', mode: fs.statSync(file).mode }); resolveIn(ws.root, e.path); fs.renameSync(tmp, file); }
    e.status = 'reverted'; this.save(); return { ok: true };
  }
}
