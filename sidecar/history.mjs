// 会话历史：只追加的事件日志 + 派生视图。
//
// 旧实现直接把 messages 数组就地改写（microcompact 改 content、compact 截断、压缩重建数组），
// 结果是：压缩只能写成破坏性操作、落盘的对话和内存里已经不是同一份、fork/rewind 做不了。
//
// 这里把三件事拆开：
//   1) events  —— 唯一事实来源，只 append。压缩、裁剪都不删不改。
//   2) view()  —— 纯函数派生：拿当前 events 算出「这一轮要发给模型的消息」。
//   3) 本地化   —— 旧工具结果在 view 阶段换成 ctx_ref 引用（原始事件不动）。
//
// v3 summary 通过 surfaceOp/sourceEventSeqs 替换当前模型视图中的一个区间，保留近期尾部。
// 没有区间标记的旧 summary 仍按旧版本语义覆盖全部前文；原始事件始终保留。

import fs from 'node:fs';
import path from 'node:path';
import { atomicJson } from './paths.mjs';
import { messageTokens, estimateTokens, splitByTokens, trimToolOutput, SUMMARY_PREFIX } from './context.mjs';
import { projectHistory } from './history-projection.mjs';
import { HistoryStore, readHistoryStorage } from './history-store.mjs';
import { CURRENT_EVENT_VERSION } from './history-formats.mjs';

export const HISTORY_VERSION = CURRENT_EVENT_VERSION;

// 已知事件类型。参考 DSH `session-persistence/storage-contract.ts`：
// **不认识的事件类型不能静默跳过** —— 跳过一条「必要」事件可能重建出错误的会话，
// 用户看到的历史被悄悄改了却没有任何提示。ignorable 事件保留原始序号但不参与视图，否则拒绝加载。
export const KNOWN_EVENT_TYPES = new Set([
  'user', 'assistant', 'tool', 'summary', 'continuation', 'notice', 'system', 'turn-end',
]);

/** 版本门错误：调用方需要区分「文件坏了」和「文件来自更新的版本」。 */
export class HistoryFormatError extends Error {
  constructor(message, { version, file } = {}) {
    super(message);
    this.name = 'HistoryFormatError';
    this.code = 'history-format-unsupported';
    this.version = version;
    this.file = file;
  }
}

const stripPrefix = s => String(s || '').replace(/^【[^】]*】\n?/, '');

// 补齐缺失响应时的占位正文：明确告诉模型「这条没有产生结果」，而不是让它以为工具返回了空内容。
const MISSING_TOOL_RESULT = '[未执行：这一轮在此结果返回前结束，没有产生输出]';

export class History {
  /** @param {{system:string, events?:object[]}} */
  constructor({ system, events }) {
    this.system = system || '';
    this.events = Array.isArray(events) ? events : [];
    this._refs = new Map(); // content hash → ctx_ref，避免重复落盘同一份大输出
    this._dir = null;       // 归档目录（Agent 注入 projectDir/.ctx）
  }

  // ------------------------------------------------------------ 写入
  append(event, finalize) {
    if (this._closed) throw Error('历史句柄已关闭');
    if (!event || typeof event.t !== 'string' || !KNOWN_EVENT_TYPES.has(event.t) && event.ignorable !== true) throw Error('历史事件类型无效');
    const seq = this.events.length;
    this.events.push({ at: Date.now(), ...event });
    try { finalize?.(); this.events[seq] = immutableEvent(this.events[seq]); }
    catch (error) { this.events.pop(); throw error; }
    this.onAppend?.(); return seq;
  }
  appendBatch(events) {
    if (this._closed) throw Error('历史句柄已关闭');
    const prepared = events.map(event => { if (!event || typeof event.t !== 'string' || !KNOWN_EVENT_TYPES.has(event.t) && event.ignorable !== true) throw Error('历史事件类型无效'); return immutableEvent({ at: Date.now(), ...event }); });
    const seq = this.events.length; this.events.push(...prepared); if (prepared.length) this.onAppend?.(); return seq;
  }
  /** 追加检查点；replacement 指定区间，省略时兼容旧版的全部前文覆盖。 */
  commitSummary(text, meta = {}, replacement, finalize) {
    const event = { t: 'summary', content: String(text || ''), meta, ...replacement };
    projectHistory([...this.events, event]);
    return this.append(event, finalize);
  }
  reset() { this.events = []; this._refs.clear(); }

  get lastSummary() {
    const records = projectHistory(this.events).nodes;
    for (let i = records.length - 1; i >= 0; i--) if (records[i].event.t === 'summary') return { event: records[i].event, index: records[i].seq };
    return null;
  }
  get compressions() { return this.events.filter(e => e.t === 'summary').length; }

  // ------------------------------------------------------------ 派生视图
  /**
   * @param {{prune?:{keep?:number,minChars?:number,dir?:string}}} [opts]
   * @returns {object[]} OpenAI 形状的 messages（首条为 system）
   */
  view(opts = {}) {
    const { prune } = opts;
    const body = projectHistory(this.events).nodes.map(node => node.event);
    // 防御：视图不能以孤儿 tool 结果开头（旧数据/迁移数据可能导致 400）
    while (body.length && body[0].t === 'tool') body.shift();
    const msgs = [{ role: 'system', content: this.system }];

    const prunable = prune ? this._prunable(body, prune.keep ?? 6, prune.minChars ?? 1200, prune.dir) : null;
    return this._pairToolResults([...msgs, ...this._bodyMessages(body, prunable)]);
  }

  /**
   * 事件 → wire messages（不含 system、不含检查点）。view() 与摘要的前缀重放共用它，
   * 保证「发给模型的对话」和「喂给摘要器的对话」是同一套映射——否则前缀复用就是假的：
   * 形状差一个字段，端点的缓存前缀就整段作废。
   * @param {object[]} body 事件
   * @param {Map<number,string>|null} prunable 需要换成引用的工具结果下标
   */
  _bodyMessages(body, prunable = null) {
    const msgs = [];
    for (let i = 0; i < body.length; i++) {
      const e = body[i];
      if (e.t === 'summary') {
        msgs.push({ role: 'user', content: SUMMARY_PREFIX + stripPrefix(e.content), _summary: e.meta || {} });
        if (['user', 'continuation'].includes(body[i + 1]?.t)) msgs.push({ role: 'assistant', content: '已了解之前的上下文，继续。', _ack: true });
        continue;
      }
      if (e.t === 'user' || e.t === 'continuation') { msgs.push({ role: 'user', content: String(e.content ?? ''), ...(e.att ? { _attTok: e.att } : {}), ...(e.images?.length ? { _images: e.images } : {}) }); continue; }
      if (e.t === 'assistant') {
        const m = { role: 'assistant', content: String(e.content ?? '') };
        if (e.reasoning) m.reasoning_content = e.reasoning;
        if (e.nativeReplay) m._nativeReplay = e.nativeReplay;
        if (e.calls?.length) m.tool_calls = e.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}) } }));
        msgs.push(m);
        continue;
      }
      if (e.t === 'tool') {
        const pruned = prunable?.has(i);
        msgs.push({ role: 'tool', tool_call_id: e.id, name: e.name, content: pruned ? prunable.get(i) : String(e.content ?? ''), ...(e.isError ? { _toolError: true } : {}), ...(pruned ? { _pruned: true } : {}) });
      }
    }
    return msgs;
  }

  /**
   * 补齐 wire 里缺失的工具响应。OpenAI 兼容协议要求每条 assistant.tool_calls 都被紧随其后的
   * tool 消息逐条应答，少一条整轮被拒（DeepSeek/AI SDK：insufficient tool messages following
   * tool_calls message）。进程在批次中途退出、旧数据残缺、fork 种子被裁剪都会留下这种空洞。
   *
   * 只影响派生视图，不改事件：补齐的响应按 tool_calls 顺序插入，多余的、重复的一律丢弃，
   * 保证同一批 call 的响应连续且唯一。
   */
  _pairToolResults(msgs) {
    const out = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== 'assistant' || !m.tool_calls?.length) { out.push(m); continue; }
      out.push(m);
      const batch = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j].role === 'tool') batch.push(msgs[j++]);
      for (const tc of m.tool_calls) {
        const hit = batch.find(t => t.tool_call_id === tc.id);
        out.push(hit || { role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: MISSING_TOOL_RESULT, _synth: true });
      }
      i = j - 1;
    }
    return out;
  }

  /** 需要裁成引用的工具结果下标 → 新内容（纯计算，不修改事件） */
  _prunable(body, keep, minChars, dir) {
    const idx = [];
    for (let i = 0; i < body.length; i++) if (body[i].t === 'tool') idx.push(i);
    const out = new Map();
    for (const i of idx.slice(0, Math.max(0, idx.length - keep))) {
      const e = body[i];
      const c = String(e.content ?? '');
      if (c.length < minChars) continue;
      out.set(i, this._ref(e.name, c, dir));
    }
    return out;
  }
  _ref(name, text, dir) {
    const key = name + '\u0000' + text.length + '\u0000' + text.slice(0, 200) + text.slice(-200);
    if (this._refs.has(key)) return this._refs.get(key);
    const v = trimToolOutput(text, { dir: dir || this.ctxDir, name, limit: 0, head: 300 }).replace('输出过长已截断', '旧工具结果已收起');
    this._refs.set(key, v);
    return v;
  }
  /** 归档目录（由 Agent 注入 projectDir/.ctx） */
  get ctxDir() { return this._dir || null; }
  set ctxDir(d) { this._dir = d || null; }

  // ------------------------------------------------------------ 用量
  stats() {
    const msgs = this.view({ prune: { keep: 6, minChars: 6000, dir: this.ctxDir } });
    let n = 0;
    for (const m of msgs) n += messageTokens(m);
    return { tokens: n, messages: msgs.length, summary: !!this.lastSummary, compressions: this.compressions };
  }
  /** 估算当前视图（不裁剪）的 token 数，供压缩决策使用 */
  tokens() { return this.stats().tokens; }

  // ------------------------------------------------------------ 压缩规划
  /**
   * 计算「要摘要多少条事件」：把摘要之后的事件按 keepTokens 从尾部原样保留，
   * 切点只落在 user/assistant 上（复用 context.splitByTokens 的规则）。
   * @returns {{ cover:number, old:object[], recent:object[] }} cover 为可摘要的事件条数
   */
  plan({ keepTokens = 0 } = {}) {
    const records = projectHistory(this.events).nodes, checkpoint = records[0]?.event.t === 'summary' ? records[0] : null;
    const bodyRecords = records.slice(checkpoint ? 1 : 0), body = bodyRecords.map(node => node.event);
    if (!body.length) return { cover: 0, old: [], recent: [] };
    // Log-only events have no model message; use an explicit index map rather
    // than treating the message count as an event offset.
    const indices = body.flatMap((e, i) => ['user', 'continuation', 'assistant', 'tool'].includes(e.t) ? [i] : []);
    const wire = [{ role: 'system', content: '' }, ...this._bodyMessages(body)];
    const { old } = splitByTokens(wire, keepTokens);
    let cover = old.length ? (indices[old.length] ?? body.length - 1) : 0;
    // 不能把 assistant(tool_calls) 和它的 tool 结果切开
    while (cover > 0 && body[cover]?.t === 'tool') cover--;
    const sources = [...(checkpoint ? [checkpoint.seq] : []), ...bodyRecords.slice(0, cover).map(node => node.seq)];
    const replacement = sources.length ? { surfaceOp: { op: 'replace', startSeq: sources[0], endSeq: sources.at(-1) }, sourceEventSeqs: sources } : null;
    return { cover, old: body.slice(0, cover), recent: body.slice(cover), replacement };
  }

  /** 把一组事件转成 wire messages（供摘要器、外部工具复用）。与 view() 用同一套映射，并补齐缺失的工具响应。 */
  wireOf(events, { repair = true } = {}) {
    const msgs = this._bodyMessages(events);
    return repair ? this._pairToolResults(msgs) : msgs;
  }

  /** 一组事件在 wire 上的 token 数（摘要尺寸校验用：被替换的区间到底值多少 token）。 */
  tokensOf(events) {
    let n = 0;
    for (const m of this.wireOf(events)) n += messageTokens(m);
    return n;
  }

  /**
   * 摘要的前缀重放：返回**与真实请求逐字节相同**的那一段消息。
   *
   * 这是 KV 缓存能否命中的唯一判据。真实请求是 `view({prune})` 派生的——旧工具结果
   * 已经换成 ctx_ref 引用。如果这里喂原始事件，形状就和真实前缀不一样：端点的缓存
   * 从第一个不同的 token 起整段失效，等于白做前缀复用。
   *
   * 所以走同一个 view 派生，只是只取「被摘要替换的那段事件」对应的消息。
   * 裁剪决定按**整个 body** 算（与真实请求一致），再按事件数截断——
   * 若按 old 自己算裁剪，「最近 N 条工具结果保留」的边界就会挪位。
   *
   * @param {number} eventCount 要被摘要替换的事件条数（从 body 头部起算）
   * @param {{prune?:object}} [opts] 与真实请求一致的裁剪参数
   * @returns {object[]} wire messages（不含 system）
   */
  replayHead(eventCount, opts = {}) {
    const count = Math.max(0, Number(eventCount) || 0);
    if (!count) return [];
    const records = projectHistory(this.events).nodes;
    const body = records.slice(records[0]?.event.t === 'summary' ? 1 : 0).map(node => node.event);
    while (body.length && body[0].t === 'tool') body.shift();
    // 裁剪按整个 body 算好，再只取前 count 个事件的消息：边界与真实请求完全一致。
    const prunable = opts.prune ? this._prunable(body, opts.prune.keep ?? 6, opts.prune.minChars ?? 1200, opts.prune.dir) : null;
    return this._pairToolResults(this._bodyMessages(body.slice(0, count), prunable));
  }

  /** 一组事件在 wire 上的 token 数（摘要尺寸校验用：被替换的区间到底值多少 token）。 */
  tokensOf(events) {
    let n = 0;
    for (const m of this.wireOf(events)) n += messageTokens(m);
    return n;
  }

  _bodyToWire(body) {
    const out = [];
    for (const e of body) {
      if (e.t === 'user') out.push({ role: 'user', content: String(e.content ?? '') });
      else if (e.t === 'assistant') out.push({ role: 'assistant', content: String(e.content ?? ''), ...(e.calls?.length ? { tool_calls: e.calls.map(c => ({ type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}) } })) } : {}) });
      else if (e.t === 'tool') out.push({ role: 'tool', name: e.name, content: String(e.content ?? '') });
    }
    return out;
  }

  // ------------------------------------------------------------ 持久化
  toJSON() { return { v: HISTORY_VERSION, events: this.events }; }

  static fromJSON(raw, { file } = {}) {
    const h = new History({ system: '' });
    if (Array.isArray(raw)) { h.events = migrateV1(raw); return h; }
    // 版本门：比当前版本更高 = 这个文件由更新的应用写过，我们无法正确解释它。
    // 宁可明确失败，也不要把一份读不懂的日志当成"少了几句对话"继续用。
    const version = Number(raw?.v);
    if (raw?.v !== undefined && (!Number.isSafeInteger(raw.v) || raw.v < 1)) throw new HistoryFormatError('会话记录版本无效，拒绝作为旧格式恢复', { version: raw.v, file });
    if (Number.isFinite(version) && version > HISTORY_VERSION) {
      throw new HistoryFormatError(
        `会话记录版本 ${version} 高于本程序支持的 ${HISTORY_VERSION}，可能是更新版本的 DecryptHub 写入的。` +
        '为避免错误重建对话，已拒绝加载。请升级应用，或先备份该文件。', { version, file });
    }
    if (!raw || !Array.isArray(raw.events)) return h;
    const events = [];
    for (const e of raw.events) {
      if (!e || typeof e.t !== 'string') throw new HistoryFormatError('会话包含无类型的事件，拒绝重建以保持序号稳定', { version, file });
      if (!KNOWN_EVENT_TYPES.has(e.t)) {
        // 显式声明可忽略的才跳过；其余拒绝，因为静默跳过可能重建出错误会话。
        if (e.ignorable === true) { events.push(e); continue; }
        throw new HistoryFormatError(
          `会话记录里有本程序不认识的事件类型「${e.t}」（seq=${e.seq ?? '?'}），且未标记可忽略。` +
          '静默跳过可能导致对话被错误重建，已拒绝加载。请升级应用后重试。', { version, file });
      }
      events.push(e);
    }
    try { projectHistory(events); } catch (error) { throw new HistoryFormatError('会话上下文替换记录无效：' + error.message, { version, file }); }
    h.events = events;
    return h;
  }
  save(file) {
    try {
      if (this._closed) throw Error('历史句柄已关闭');
      this.events = this.events.map(event => Object.isFrozen(event) ? event : immutableEvent(event));
      if (path.basename(file) !== '.agent-history.json') atomicJson(file, this.toJSON());
      else {
        if (this._store && this._store.file !== file) throw Error('历史写入句柄不能转绑其他文件');
        this._store ||= new HistoryStore(file, this._observed);
        this._store.validate = raw => History.fromJSON(raw, { file });
        this._store.replaceUnobserved = !this.onAppend;
        this._store.save(this.toJSON());
        if (!this.onAppend) this._observed = { revision: readHistoryStorage(file).revision };
      }
      this.lastSaveError = null; return true;
    } catch (error) { this.lastSaveError = error; return false; }
    finally { if (!this.onAppend && this._store) { this._store.close(); this._store = null; } }
  }
  close() { this._closed = true; this._store?.close(); }
  static load(file, system) {
    const h = new History({ system });
    let raw = null, observed;
    // Only an absent file denotes a new chat. Parse/read failures must never
    // publish an empty history that the next append would save over the source.
    let source;
    try {
      if (path.basename(file) === '.agent-history.json') { observed = readHistoryStorage(file); raw = observed.raw; if (raw === null) { h._observed = { revision: observed.revision }; h._store = new HistoryStore(file, observed); return h; } }
      else source = fs.readFileSync(file, 'utf8');
    }
    catch (error) { if (error.code === 'ENOENT') return h; throw new Error('无法读取会话记录，已停止以保护原文件：' + error.message + '（' + file + '）', { cause: error }); }
    try { if (!observed) raw = JSON.parse(source.replace(/^\uFEFF/, '')); }
    catch { throw new HistoryFormatError('会话记录无法解析，已停止以保护原文件。请从备份恢复后重试：' + file, { file }); }
    if (!Array.isArray(raw) && (!raw || !Array.isArray(raw.events)))
      throw new HistoryFormatError('会话记录结构无效，已停止以保护原文件：' + file, { file });
    const parsed = History.fromJSON(raw, { file });
    h.events = parsed.events.map(immutableEvent);
    if (observed) { h._observed = { revision: observed.revision }; h._store = new HistoryStore(file, observed); h._store.prime(h.events); }
    return h;
  }
  /** 新对话：当前历史归档到 .chats/ 后清空（原始事件完整保留，不再只留摘要） */
  archive(dir) {
    if (!dir || !this.events.length) return null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, Date.now() + '.json');
      fs.writeFileSync(f, JSON.stringify(this.toJSON()));
      return f;
    } catch { return null; }
  }
}

function immutableEvent(event) {
  const copy = structuredClone(event), pending = [copy];
  while (pending.length) { const value = pending.pop(); if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue; for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child); Object.freeze(value); }
  return copy;
}

/** v1=[{role,content,...}] → 事件；`_summary` 消息变成 summary 事件（覆盖它之前的空区间） */
export function migrateV1(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const at = m.at || undefined;
    if (m.role === 'system') continue;
    if (m.role === 'user' && m._summary) { out.push({ t: 'summary', content: stripPrefix(m.content), meta: m._summary === true ? {} : (m._summary || {}), ...(at ? { at } : {}) }); continue; }
    if (m.role === 'assistant' && m._ack) continue; // 合成的确认由 view() 重新生成
    if (m.role === 'user') { out.push({ t: 'user', content: String(m.content ?? ''), ...(m._attTok ? { att: m._attTok } : {}), ...(at ? { at } : {}) }); continue; }
    if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function?.name, args: safeArgs(tc.function?.arguments) }));
      out.push({ t: 'assistant', content: String(m.content ?? ''), ...(m.reasoning_content ? { reasoning: m.reasoning_content } : {}), ...(calls.length ? { calls } : {}), ...(at ? { at } : {}) });
      continue;
    }
    if (m.role === 'tool') out.push({ t: 'tool', id: m.tool_call_id, name: m.name, content: String(m.content ?? ''), ...(at ? { at } : {}) });
  }
  return out;
}
function safeArgs(a) { if (a && typeof a === 'object') return a; try { return JSON.parse(a || '{}'); } catch { return {}; } }

export { estimateTokens };
