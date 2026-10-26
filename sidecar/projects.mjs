import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicJson, pathKey } from './paths.mjs';

export function validateProject({ name, folders, primaryId }) {
  name = String(name || '').trim();
  if (!name || name.length > 80) throw Error('项目名称需要 1–80 个字符');
  if (!Array.isArray(folders) || !folders.length || folders.length > 12) throw Error('项目需要 1–12 个目录');
  if (new Set(folders.map(f => pathKey(f.root))).size !== folders.length) throw Error('项目目录不能重复');
  if (!folders.some(f => f.id === primaryId)) throw Error('请选择主目录');
  return name;
}

export class ProjectStore {
  constructor(directory) {
    this.file = path.join(directory, 'code-projects.json');
    this.entries = [];
    try { this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8')).projects || []; }
    catch (error) { if (error.code !== 'ENOENT') throw Error('项目配置损坏，请先恢复 code-projects.json'); }
  }
  list() { return this.entries.map(p => structuredClone(p)); }
  get(id) { const p = this.entries.find(p => p.id === id); if (!p) throw Error('项目不存在'); return p; }
  save({ id, name, folders, primaryId }) {
    const previous = id ? this.get(id) : null;
    name = validateProject({ name, folders, primaryId });
    const next = { id: previous?.id || crypto.randomUUID(), name, folders: structuredClone(folders), primaryId,
      revision: (previous?.revision || 0) + 1, updatedAt: Date.now() };
    const entries = previous ? this.entries.map(p => p.id === id ? next : p) : [...this.entries, next];
    atomicJson(this.file, { version: 1, projects: entries }); this.entries = entries;
    return structuredClone(next);
  }
  workspace(id) {
    const p = this.get(id), main = p.folders.find(f => f.id === p.primaryId);
    return { ...main, missing: !fs.existsSync(main.root), projectId: p.id, projectRevision: p.revision,
      roots: p.folders.map(f => ({ ...f, primary: f.id === p.primaryId, readOnly: f.id !== p.primaryId })) };
  }
  remove(id) {
    this.get(id); const entries = this.entries.filter(p => p.id !== id);
    atomicJson(this.file, { version: 1, projects: entries }); this.entries = entries;
  }
}
