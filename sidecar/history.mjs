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
// summary 事件的位置即语义：它覆盖自己之前的所有事件。因此「恢复历史」= 取最后一个 summary
// 之后的事件，前面拼一条摘要消息。多轮压缩天然是增量的（旧摘要永远排在前面）。

import fs from 'node:fs';
import path from 'node:path';
import { atomicJson } from './paths.mjs';
import { messageTokens, estimateTokens, splitByTokens, trimToolOutput, SUMMARY_PREFIX } from './context.mjs';

export const HISTORY_VERSION = 2;

const stripPrefix = s => String(s || '').replace(/^【[^】]*】\n?/, '');

export class History {
  /** @param {{system:string, events?:object[]}} */
  constructor({ system, events }) {
    this.system = system || '';
    this.events = Array.isArray(events) ? events : [];
    this._refs = new Map(); // content hash → ctx_ref，避免重复落盘同一份大输出
    this._dir = null;       // 归档目录（Agent 注入 projectDir/.ctx）
  }

  // ------------------------------------------------------------ 写入
  append(event) { this.events.push({ at: Date.now(), ...event }); this.onAppend?.(); return this.events.length - 1; }
  /** 追加一条检查点：覆盖它之前的所有事件（不删除任何东西） */
  commitSummary(text, meta = {}) { return this.append({ t: 'summary', content: String(text || ''), meta }); }
  reset() { this.events = []; this._refs.clear(); }

  get lastSummary() {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].t === 'summary') return { event: this.events[i], index: i };
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
    const last = this.lastSummary;
    const body = this.events.slice(last ? last.index + 1 : 0);
    // 防御：视图不能以孤儿 tool 结果开头（旧数据/迁移数据可能导致 400）
    while (body.length && body[0].t === 'tool') body.shift();
    const msgs = [{ role: 'system', content: this.system }];

    if (last) {
      const text = SUMMARY_PREFIX + stripPrefix(last.event.content);
      msgs.push({ role: 'user', content: text, _summary: last.event.meta || {} });
      // 摘要之后若紧跟用户消息，补一条确认，保持 user/assistant 交替
      if (['user', 'continuation'].includes(body[0]?.t)) msgs.push({ role: 'assistant', content: '已了解之前的上下文，继续。', _ack: true });
    }

    const prunable = prune ? this._prunable(body, prune.keep ?? 6, prune.minChars ?? 1200, prune.dir) : null;
    for (let i = 0; i < body.length; i++) {
      const e = body[i];
      if (e.t === 'user' || e.t === 'continuation') { msgs.push({ role: 'user', content: String(e.content ?? ''), ...(e.att ? { _attTok: e.att } : {}), ...(e.images?.length ? { _images: e.images } : {}) }); continue; }
      if (e.t === 'assistant') {
        const m = { role: 'assistant', content: String(e.content ?? '') };
        if (e.reasoning) m.reasoning_content = e.reasoning;
        if (e.calls?.length) m.tool_calls = e.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}) } }));
        msgs.push(m);
        continue;
      }
      if (e.t === 'tool') {
        const content = prunable?.has(i) ? prunable.get(i) : String(e.content ?? '');
        msgs.push({ role: 'tool', tool_call_id: e.id, name: e.name, content, ...(prunable?.has(i) ? { _pruned: true } : {}) });
      }
    }
    return msgs;
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
    const last = this.lastSummary;
    const body = this.events.slice(last ? last.index + 1 : 0);
    if (!body.length) return { cover: 0, old: [], recent: [] };
    // 先用 1:1 的 wire 视图做切分，再把下标映射回事件
    const wire = [{ role: 'system', content: '' }, ...this._bodyToWire(body)];
    const { old } = splitByTokens(wire, keepTokens);
    let cover = Math.max(0, Math.min(body.length - 1, old.length));
    // 不能把 assistant(tool_calls) 和它的 tool 结果切开
    while (cover > 0 && body[cover]?.t === 'tool') cover--;
    return { cover, old: body.slice(0, cover), recent: body.slice(cover) };
  }

  /** 把一组事件转成 wire messages（供摘要器、外部工具复用） */
  wireOf(events) { return this._bodyToWire(events); }

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

  static fromJSON(raw) {
    const h = new History({ system: '' });
    if (Array.isArray(raw)) { h.events = migrateV1(raw); return h; }
    if (raw && Array.isArray(raw.events)) { h.events = raw.events.filter(e => e && typeof e.t === 'string'); return h; }
    return h;
  }
  save(file) {
    try { atomicJson(file, this.toJSON()); return true; }
    catch { return false; }
  }
  static load(file, system) {
    const h = new History({ system });
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return h; }
    const parsed = History.fromJSON(raw);
    h.events = parsed.events;
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
