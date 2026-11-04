// Host adapter for DSH's live-preferred, workspace-scoped logical session corpus.
// Querying never starts an Agent or publishes a writable restored history.
import fs from 'node:fs';
import path from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { History } from './history.mjs';
import { projectHistory } from './history-projection.mjs';
import { resolveIn, pathKey } from './paths.mjs';
import { toolInput } from './session-query-input.mjs';
import { SessionQueryError } from './session-query-values.mjs';
import { historyRevision } from './history-store.mjs';
import { SessionSearchIndex } from './session-search-index.mjs';
const rootKey = root => pathKey(path.resolve(root));
const canonicalType = type => ({ user: 'user/message', assistant: 'assistant/message', tool: 'tool/result', summary: 'user/message', continuation: 'user/message', 'turn-end': 'turn/end' }[type] || type);
const fail = (message, code) => { throw new SessionQueryError(message, code); };
const publicRecord = record => ({ sessionId: record.id, title: record.title, cwd: record.root, parentSessionId: record.parentSessionId || null,
  inheritedEventCount: record.inheritedEventCount || 0, live: !!record.agent(), persisted: fs.existsSync(path.join(record.directory, '.agent-history.json')) });
const textOf = event => {
  if (event.t === 'user') return event.renderedContent ?? event.displayContent ?? (/^【(?:系统|工作区已切换|当前状态)】/.test(event.content || '') ? '' : String(event.content || ''));
  if (event.t === 'assistant') return [event.content || '', ...(event.calls || []).flatMap(call => [call.name, typeof call.args === 'string' ? call.args : JSON.stringify(call.args || {})])].filter(Boolean).join('\n');
  if (event.t === 'tool' || event.t === 'summary') return String(event.content || '');
  if (event.t === 'turn-end' && ['interrupted', 'max-tokens', 'error'].includes(event.stop)) return [event.stop, event.error || ''].filter(Boolean).join('\n');
  return '';
};
export function eventSurfaces(events) {
  const projection = projectHistory(events), current = new Set(projection.nodes.map(node => node.seq));
  return { ...projection, records: events.map((event, seq) => ({ seq, type: canonicalType(event.t), time: event.at || 0,
    surface: current.has(seq) ? 'current' : ['user', 'assistant', 'tool', 'continuation', 'summary'].includes(event.t) ? 'shadowed' : 'log-only' })) };
}
export class SessionQuery {
  constructor(manager) { this.manager = manager; this.cache = new Map(); this.indexedSources = new Map(); this.liveIdentities = new WeakMap(); this.identitySequence = 0; this.index = new SessionSearchIndex(resolveIn(manager.userDataDir, '.session-search.sqlite')); }
  close() { this.index.close(); this.cache.clear(); this.indexedSources.clear(); }
  forget(id) { this.index.forget(id); this.indexedSources.delete(id); }
  // Trusted desktop list search uses the same cold-safe index as Agent queries.
  // Reference: api/session-controller/src/list.ts:193–295.
  async searchSidebar({ query, signal }) {
    if (typeof query !== 'string' || query.length > 500) throw Error('搜索内容最多 500 个字符');
    query = query.trim(); if (!query) return { matches: [], skipped: 0, capped: false };
    query = toolInput.normalizeQuery(query);
    await this.index.ready(); const records = new Map(), projects = new Set(this.manager.projects.list().map(project => project.id)); let skipped = 0;
    for (const session of this.manager.sessions.values()) {
      signal?.throwIfAborted(); await yieldTurn();
      if (!session.projectId || !projects.has(session.projectId)) continue;
      const record = { id: session.id, title: session.title, root: session.workspace.root, directory: session.projectDir, parentSessionId: session.parentSessionId, inheritedEventCount: session.inheritedEventCount || 0, createdAt: session.createdAt, agent: () => session.agent };
      const ctx = { sessionId: session.id, workspaceId: session.workspace.id, workRoot: record.root, signal }, info = publicRecord(record), revision = JSON.stringify([this.sourceRevision(record), info, record.createdAt]);
      try {
        if (this.indexedSources.get(record.id) !== revision && !this.index.matchesSource(record.id, revision)) {
          const snap = await this.observe(ctx, record, signal), surfaces = eventSurfaces(snap.events), documents = [];
          for (let seq = 0; seq < snap.events.length; seq++) { if (seq % 128 === 0) { await yieldTurn(); signal?.throwIfAborted(); } const text = textOf(snap.events[seq]); if (text) documents.push({ ...surfaces.records[seq], text }); }
          this.index.upsert({ ...info, createdAt: record.createdAt ?? snap.events[0]?.at ?? 0 }, documents, revision); this.indexedSources.set(record.id, revision);
        }
        if (this.manager.sessions.get(session.id) === session && session.projectId) records.set(session.id, { session, record, ctx, projectId: session.projectId });
      } catch (error) { signal?.throwIfAborted(); if (error.code !== 'SESSION_QUERY_CORRUPT_SESSION') throw error; skipped++; }
    }
    signal?.throwIfAborted();
    const page = this.index.query(query, [...records.keys()], [{ kind: 'type', values: ['user/message', 'assistant/message'] }, { kind: 'surface', values: ['current'] }]);
    const matches = [];
    for (const hit of page.items) {
      const target = records.get(hit.sessionId); if (!target) continue;
      const { session, projectId } = target;
      if (this.manager.sessions.get(session.id) !== session || session.projectId !== projectId) continue;
      matches.push({ sessionId: session.id, projectId, excerpt: hit.snippet, seq: hit.seq });
    }
    return { matches, skipped, capped: page.capped };
  }
  sourceRevision(record) {
    const live = record.agent();
    if (live) { const events = live.hist.events; if (!this.liveIdentities.has(events)) this.liveIdentities.set(events, ++this.identitySequence); const tail = events.at(-1); if (tail && !this.liveIdentities.has(tail)) this.liveIdentities.set(tail, ++this.identitySequence); return 'live:' + [this.liveIdentities.get(events), events.length, tail && this.liveIdentities.get(tail)].join(':'); }
    return historyRevision(resolveIn(record.directory, '.agent-history.json'));
  }
  corpus(ctx) {
    this.caller(ctx);
    const records = new Map(), sameRoot = rootKey(ctx.workRoot);
    for (const session of this.manager.sessions.values()) records.set(session.id, {
      id: session.id, title: session.title, root: session.workspace.root, directory: session.projectDir,
      parentSessionId: session.parentSessionId, inheritedEventCount: session.inheritedEventCount || 0, createdAt: session.createdAt,
      agent: () => session.agent, children: session.subagents,
    });
    const pending = [...records.values()].filter(record => rootKey(record.root) === sameRoot), visited = new Set();
    while (pending.length) {
      const parent = pending.pop(); if (visited.has(parent.id)) fail('会话父子关系存在循环', 'SESSION_QUERY_INVALID_LINEAGE'); visited.add(parent.id);
      let children = parent.children?.records;
      if (!children) {
        const file = resolveIn(parent.directory, '.subagents.json');
        try { children = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') fail('子会话索引无法读取', 'SESSION_QUERY_CORRUPT_SESSION'); children = []; }
      }
      if (!Array.isArray(children)) fail('子会话索引结构无效', 'SESSION_QUERY_CORRUPT_SESSION');
      for (const child of children) {
        if (!/^[a-f0-9-]{36}$/.test(child.id || '')) fail('子会话标识无效', 'SESSION_QUERY_CORRUPT_SESSION');
        const root = child.workRoot;
        if (!root || rootKey(root) !== sameRoot) continue;
        if (records.has(child.id)) fail('会话标识重复或父子关系存在循环', 'SESSION_QUERY_INVALID_LINEAGE');
        const agent = () => parent.children?.jobs.get(child.id)?.agent || parent.children?.resumable.get(child.id);
        const record = { id: child.id, title: child.title || child.task, root, directory: resolveIn(parent.directory, '.subagents/' + child.id),
          parentSessionId: child.parentSessionId || parent.id, inheritedEventCount: child.inheritedEventCount || 0, createdAt: child.startedAt,
          agent, children: agent()?.delegatedChildren };
        records.set(record.id, record); pending.push(record);
      }
    }
    return records;
  }
  caller(ctx) {
    if (!ctx.sessionId || !ctx.workRoot) fail('历史查询需要所属 Agent 和工作目录', 'SESSION_QUERY_TOOL_MISSING_AGENT');
    const live = this.manager.sessions.get(ctx.sessionId);
    if (live && (rootKey(live.workspace.root) !== rootKey(ctx.workRoot) || live.workspace.id !== ctx.workspaceId)) fail('所属工作目录已变化', 'SESSION_QUERY_TOOL_UNAUTHORIZED');
    ctx.signal?.throwIfAborted();
    return rootKey(ctx.workRoot);
  }
  target(ctx, records, id = ctx.sessionId, explicitUserReference = false) {
    this.caller(ctx);
    const record = records.get(id);
    if (!record || (!explicitUserReference && rootKey(record.root) !== rootKey(ctx.workRoot))) fail('目标会话不存在或不属于当前工作目录', 'SESSION_QUERY_TOOL_UNAUTHORIZED');
    return record;
  }
  async observe(ctx, record, signal = ctx.signal, explicitUserReference = false) {
    signal?.throwIfAborted(); this.target(ctx, new Map([[record.id, record]]), record.id, explicitUserReference);
    const live = record.agent();
    if (live?.hist) return { session: publicRecord(record), events: structuredClone(live.hist.events) };
    const file = resolveIn(record.directory, '.agent-history.json');
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      const revision = historyRevision(file);
      if (revision === 'absent') return { session: publicRecord(record), events: [] };
      let events = this.cache.get(file)?.revision === revision ? this.cache.get(file).events : null;
      if (!events) {
        try { events = History.load(file, '').events; }
        catch (error) { fail('目标会话历史无法重建：' + error.message, 'SESSION_QUERY_CORRUPT_SESSION'); }
      }
      if (historyRevision(file) !== revision) continue;
      this.caller(ctx); signal?.throwIfAborted();
      this.cache.delete(file); this.cache.set(file, { revision, events });
      if (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value);
      return { session: publicRecord(record), events: structuredClone(events) };
    }
    fail('会话仍在变化，无法取得一致快照，请重试', 'SESSION_QUERY_UNAVAILABLE');
  }
  candidates(ctx, query = '', limit = 50) {
    this.caller(ctx);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('候选数量必须在 1–50 之间', 'SESSION_QUERY_INVALID_FILTER');
    const needle = String(query).toLocaleLowerCase();
    return [...this.corpus(ctx).values()].filter(record => record.id !== ctx.sessionId && [record.id, record.title, record.root].some(value => String(value).toLocaleLowerCase().includes(needle)))
      .sort((a, b) => Number(rootKey(b.root) === rootKey(ctx.workRoot)) - Number(rootKey(a.root) === rootKey(ctx.workRoot))).slice(0, limit).map(publicRecord);
  }
  async search(ctx, args, single = false) {
    this.caller(ctx);
    const signal = ctx.signal || new AbortController().signal;
    const query = toolInput.normalizeQuery(args.query), records = this.corpus(ctx);
    const filters = toolInput.buildEventFilters({ seqFrom: single ? args.seq_from : args.event_seq_from, seqTo: single ? args.seq_to : args.event_seq_to,
      timeFrom: single ? args.time_from : args.event_time_from, timeTo: single ? args.time_to : args.event_time_to, eventTypes: args.event_types, surfaces: single ? args.surfaces : args.event_surfaces });
    const sessionFilters = single ? [] : toolInput.buildSessionFilters(args);
    const parents = args.parent_session_ids ? new Set(toolInput.materializeParentSessionIds(args.parent_session_ids)) : null;
    const target = single ? this.target(ctx, records, args.session_id) : null;
    const allowed = [], titles = new Map();
    await this.index.ready();
    for (const record of target ? [target] : records.values()) {
      signal.throwIfAborted();
      if (!single && (record.id === ctx.sessionId || rootKey(record.root) !== rootKey(ctx.workRoot))) continue;
      if (sessionFilters.some(filter => filter.kind === 'id' && !filter.values.includes(record.id))) continue;
      if (parents || args.include_root_sessions) {
        const parent = records.get(record.parentSessionId);
        if (!(args.include_root_sessions && !record.parentSessionId) && !(parent && rootKey(parent.root) === rootKey(ctx.workRoot) && parents?.has(parent.id))) continue;
      }
      const info = publicRecord(record), sourceRevision = JSON.stringify([this.sourceRevision(record), info, record.createdAt]);
      if (sessionFilters.some(filter => filter.kind === 'availability' && !filter.values.some(value => info[value]))) continue;
      const snap = this.indexedSources.get(record.id) !== sourceRevision && !this.index.matchesSource(record.id, sourceRevision) || record.createdAt == null ? await this.observe(ctx, record, signal) : null;
      const created = record.createdAt ?? snap?.events[0]?.at;
      if (sessionFilters.some(filter => filter.kind === 'created-at' && ((filter.from !== undefined && !(created >= filter.from)) || (filter.to !== undefined && !(created <= filter.to))))) continue;
      allowed.push(record.id); titles.set(record.id, record.title);
      if (!snap) continue;
      const surface = eventSurfaces(snap.events);
      const documents = [];
      for (let seq = 0; seq < snap.events.length; seq++) {
        if (seq % 128 === 0) { await yieldTurn(); signal.throwIfAborted(); }
        const text = textOf(snap.events[seq]);
        if (text) documents.push({ ...surface.records[seq], text });
      }
      this.index.upsert({ ...info, createdAt: created || 0 }, documents, sourceRevision);
      this.indexedSources.set(record.id, sourceRevision);
    }
    this.caller(ctx); signal.throwIfAborted();
    const result = this.index.query(query, allowed, filters.map(filter => filter.kind === 'type' ? { ...filter, values: filter.values.map(canonicalType) } : filter), { single,
      self: ctx.sessionId, boundary: ctx.getStepBoundary?.() ?? 0, limit: args.limit ?? 100, cursor: args.cursor });
    return { ...result, items: result.items.map(item => ({ ...item, title: titles.get(item.sessionId) })) };
  }
  async readEvent(ctx, args) {
    toolInput.assertNonNegativeSafeInteger('seq', args.seq);
    for (const key of ['before', 'after']) if (args[key] !== undefined) toolInput.assertNonNegativeSafeInteger(key, args[key]);
    const records = this.corpus(ctx), snap = await this.observe(ctx, this.target(ctx, records, args.session_id));
    if (!snap.events[args.seq]) fail('目标事件不存在', 'SESSION_QUERY_EVENT_NOT_FOUND');
    const startSeq = Math.max(0, args.seq - (args.before || 0)), endSeq = Math.min(snap.events.length - 1, args.seq + (args.after || 0));
    const surfaces = eventSurfaces(snap.events).records;
    return { session: snap.session, target: { ...snap.events[args.seq], seq: args.seq }, startSeq, endSeq,
      neighbors: surfaces.slice(startSeq, endSeq + 1).filter(record => record.seq !== args.seq).map(record => ({ ...record, rawType: snap.events[record.seq].t, sourceKind: snap.events[record.seq].source?.kind || null, text: textOf(snap.events[record.seq]) })) };
  }
  async traceEvent(ctx, args) {
    toolInput.assertNonNegativeSafeInteger('seq', args.seq);
    const records = this.corpus(ctx), snap = await this.observe(ctx, this.target(ctx, records, args.session_id));
    if (!snap.events[args.seq]) fail('目标事件不存在', 'SESSION_QUERY_EVENT_NOT_FOUND');
    const projection = eventSurfaces(snap.events), chain = []; let seq = args.seq;
    while (projection.replacedBy.has(seq)) { seq = projection.replacedBy.get(seq); chain.push(seq); }
    return { session: snap.session, target: projection.records[args.seq], replacedBy: chain[0] ?? null, replacementChain: chain,
      replacedEventSeqs: projection.replacements.get(args.seq) || [], sourceEventSeqs: snap.events[args.seq].sourceEventSeqs || [],
      derivedEventSeqs: snap.events.flatMap((event, seq) => seq > args.seq && event.sourceEventSeqs?.includes(args.seq) ? [seq] : []) };
  }
  traceSession(ctx, args = {}) {
    const records = this.corpus(ctx), target = this.target(ctx, records, args.session_id), ancestors = [], seen = new Set([target.id]);
    let parentId = target.parentSessionId, complete = true;
    while (parentId) {
      if (seen.has(parentId)) fail('会话父子关系存在循环', 'SESSION_QUERY_INVALID_LINEAGE'); seen.add(parentId);
      const parent = records.get(parentId);
      if (!parent || rootKey(parent.root) !== rootKey(ctx.workRoot)) { complete = false; break; }
      ancestors.push(publicRecord(parent)); parentId = parent.parentSessionId;
    }
    const descendants = [], pending = [{ id: target.id, output: descendants }], visited = new Set();
    while (pending.length) {
      const item = pending.pop(); if (visited.has(item.id)) fail('会话父子关系存在循环', 'SESSION_QUERY_INVALID_LINEAGE'); visited.add(item.id);
      for (const child of records.values()) if (child.parentSessionId === item.id && rootKey(child.root) === rootKey(ctx.workRoot)) {
        const node = { session: publicRecord(child), descendants: [] }; item.output.push(node); pending.push({ id: child.id, output: node.descendants });
      }
    }
    return { target: publicRecord(target), ancestors, descendants, complete, ...(complete ? { root: ancestors.at(-1) || publicRecord(target) } : { ancestorBoundary: true }) };
  }
}
