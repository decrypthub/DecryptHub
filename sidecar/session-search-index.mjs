// Disposable FTS read model; canonical session files remain authoritative.
import crypto from 'node:crypto';
import { SessionQueryError } from './session-query-values.mjs';
import { openSearchDatabase } from './session-search-schema.mjs';
import { sanitizeFtsText, makeSnippet, buildEventWhere, selectedDocumentsSql, selectedDocumentsParams, assertPortableBindingCount, assertFts5OuterPredicateCount } from './session-search-sql.mjs';
export class SessionSearchIndex {
  constructor(file) { this.file = file; this.generation = 0; this.closed = false; this.instance = crypto.randomUUID(); }
  async ready() {
    if (this.closed) throw Error('历史搜索服务已关闭');
    this.opening ||= openSearchDatabase(this.file, 'wal').then(db => { if (this.closed) { db.close(); throw Error('历史搜索服务已关闭'); } this.db = db; return db; });
    return this.opening;
  }
  matchesSource(id, sourceRevision) {
    if (!this.db || this.closed) throw Error('历史搜索服务未就绪');
    const fingerprint = crypto.createHash('sha256').update(sourceRevision).digest('hex');
    const row = this.db.prepare('SELECT fingerprint AS revision FROM live_sessions WHERE id=?').get(id) || this.db.prepare('SELECT revision FROM persisted_sessions WHERE id=?').get(id);
    return row?.revision === fingerprint;
  }
  upsert(record, documents, sourceRevision) {
    if (!this.db || this.closed) throw Error('历史搜索服务未就绪');
    const fingerprint = crypto.createHash('sha256').update(sourceRevision ?? JSON.stringify([record, documents])).digest('hex');
    const table = record.live ? 'live' : 'persisted', header = table + '_sessions', docs = table + '_docs', versionColumn = record.live ? 'fingerprint' : 'revision';
    if (this.db.prepare(`SELECT ${versionColumn} AS revision FROM ${header} WHERE id=?`).get(record.sessionId)?.revision === fingerprint) return;
    this.db.exec('BEGIN');
    try {
      // A cold observation must not leave a stale live layer shadowing it.
      for (const prefix of ['live', 'persisted']) {
        this.db.prepare(`DELETE FROM ${prefix}_docs WHERE session_id=?`).run(record.sessionId);
        this.db.prepare(`DELETE FROM ${prefix}_sessions WHERE id=?`).run(record.sessionId);
      }
      const columns = ['id','version','created_at','cwd','parent_session','seed_length','delegation_depth','agent_preset', versionColumn, ...(record.live ? ['persisted'] : []), 'generation'];
      const values = [record.sessionId, 3, record.createdAt || 0, record.cwd, record.parentSessionId ?? null, record.parentSessionId == null ? null : record.inheritedEventCount ?? 0, null, null, fingerprint, ...(record.live ? [record.persisted ? 1 : 0] : []), ++this.generation];
      this.db.prepare(`INSERT INTO ${header} (${columns.join(',')}) VALUES (${values.map(() => '?').join(',')})`).run(...values);
      const insert = this.db.prepare(`INSERT INTO ${docs} (text,session_id,seq,type,time,surface,codepoint_length) VALUES (?,?,?,?,?,?,?)`);
      for (const document of documents) { const text = sanitizeFtsText(document.text); insert.run(text, record.sessionId, document.seq, document.type, document.time, document.surface, Array.from(text).length); }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  query(query, allowed, filters, { single = false, self, boundary = Number.MAX_SAFE_INTEGER, limit = 100, cursor } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new SessionQueryError('分页数量必须在 1–100 之间', 'SESSION_QUERY_INVALID_LIMIT');
    if (!allowed.length) return { items: [], capped: false };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([query, [...allowed].sort(), filters, single, self, boundary, limit])).digest('hex');
    const facts = allowed.map(id => [id, this.db.prepare('SELECT fingerprint AS revision,generation FROM live_sessions WHERE id=?').get(id) || this.db.prepare('SELECT revision,generation FROM persisted_sessions WHERE id=?').get(id)]);
    const generation = crypto.createHash('sha256').update(JSON.stringify(facts.sort((a,b) => a[0].localeCompare(b[0])))).digest('hex');
    const scope = single ? 'events' : 'sessions'; let offset = 0;
    if (cursor !== undefined) {
      let decoded; try { if (typeof cursor !== 'string' || cursor.length > 8192) throw Error('cursor'); decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()); } catch { throw new SessionQueryError('检索游标无效', 'SESSION_QUERY_INVALID_CURSOR'); }
      if (!decoded || decoded.version !== 1 || decoded.instance !== this.instance || decoded.scope !== scope || decoded.fingerprint !== fingerprint || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new SessionQueryError('游标不属于当前请求', 'SESSION_QUERY_INVALID_CURSOR');
      if (decoded.generation !== generation) throw new SessionQueryError('相关历史已变化，请重新检索', 'SESSION_QUERY_STALE_CURSOR');
      offset = decoded.offset;
    }
    const where = buildEventWhere(filters), clauses = [`session_id IN (${allowed.map(() => '?').join(',')})`, ...(where.sql ? [where.sql] : [])];
    const params = [...selectedDocumentsParams(sanitizeFtsText(query), true), ...allowed, ...where.params];
    if (self) { clauses.push('(session_id <> ? OR seq < ?)'); params.push(self, boundary); }
    assertFts5OuterPredicateCount(where.predicateCount + 1 + (self ? 1 : 0)); assertPortableBindingCount(params.length + 2);
    const selected = selectedDocumentsSql();
    const suffix = single
      ? `SELECT * FROM matched WHERE ${clauses.join(' AND ')} ORDER BY match_count DESC, document_length ASC, time DESC, seq DESC LIMIT ?`
      : `, filtered AS (SELECT * FROM matched WHERE ${clauses.join(' AND ')}), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY match_count DESC,document_length ASC,time DESC,seq DESC) AS event_rank FROM filtered) SELECT * FROM ranked WHERE event_rank=1 ORDER BY match_count DESC,document_length ASC,time DESC,session_id ASC,seq DESC LIMIT ?`;
    const rows = this.db.prepare(selected.sql + '\n' + suffix + ' OFFSET ?').all(...params, limit + 1, offset);
    return { items: rows.slice(0, limit).map(row => ({ sessionId: row.session_id, seq: row.seq, type: row.type, time: row.time, surface: row.surface, snippet: makeSnippet(row.marked_text, 240) })), capped: rows.length > limit,
      ...(rows.length > limit ? { nextCursor: Buffer.from(JSON.stringify({ version: 1, instance: this.instance, scope, fingerprint, generation, offset: offset + limit })).toString('base64url') } : {}) };
  }
  forget(id) {
    if (!this.db) return;
    for (const prefix of ['live', 'persisted']) { this.db.prepare(`DELETE FROM ${prefix}_docs WHERE session_id=?`).run(id); this.db.prepare(`DELETE FROM ${prefix}_sessions WHERE id=?`).run(id); }
  }
  close() { this.closed = true; this.db?.close(); this.db = null; }
}
