// DSH SessionWriteLease semantics: the kernel owns exclusion and releases it on
// process death. SQLite's retained write transaction supplies that primitive on
// the shipped Node runtime without a second native Windows binding.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveIn } from './paths.mjs';
const APPLICATION_ID = 0x44484c31;
export class WriterLease {
  constructor(directory, filename = '.writer-lease.sqlite') {
    fs.mkdirSync(directory, { recursive: true });
    const file = resolveIn(directory, filename);
    const existing = fs.lstatSync(file, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || existing.nlink !== 1)) throw Error('写入租约不是独立普通文件');
    const db = new DatabaseSync(file); this.db = db;
    try {
      const id = db.prepare('PRAGMA application_id').get().application_id;
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").all();
      if (id !== APPLICATION_ID && (id !== 0 || tables.length)) throw Error('写入租约文件不属于本应用');
      db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
      db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    } catch (cause) {
      db.close(); this.db = null;
      const error = Error(cause.code?.includes('BUSY') || /locked/i.test(cause.message) ? '此数据已由另一个运行实例持有，拒绝重复写入' : cause.message, { cause });
      error.code = /locked/i.test(cause.message) || cause.code?.includes('BUSY') ? 'SESSION_ALREADY_OWNED' : 'SESSION_LEASE_INVALID'; throw error;
    }
  }
  close() { if (!this.db) return; const db = this.db; this.db = null; try { db.exec('ROLLBACK'); } finally { db.close(); } }
}
