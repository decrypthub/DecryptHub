// 用户配置的 MCP 服务：多服务并存、stdin/stdout 与 HTTP/SSE 三种传输，
// 工具统一加「服务名__工具名」前缀，避免不同服务重名。
// 设计参考 Cherry Studio / Cline / Claude Desktop 的 mcpServers 配置习惯：
//   { "name": { "command": "...", "args": [...], "env": {...} } } 可直接导入。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { childEnv } from './executor.mjs';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const CONNECT_TIMEOUT = 25000;
const LIST_TIMEOUT = 30000;
const CALL_TIMEOUT = 120000;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' 超时（' + Math.round(ms / 1000) + 's）')), ms); }),
  ]);
}

function strMap(input) {
  const out = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input)) {
      const key = String(k).trim();
      if (key) out[key] = String(v ?? '');
    }
  }
  return out;
}

export function normalizeServer(name, raw = {}) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const transport = ['stdio', 'http', 'sse'].includes(cfg.transport) ? cfg.transport : (cfg.url ? 'http' : 'stdio');
  return {
    name: String(name),
    enabled: cfg.enabled !== false,
    transport,
    command: String(cfg.command || '').trim(),
    args: Array.isArray(cfg.args) ? cfg.args.map(a => String(a)) : (typeof cfg.args === 'string' && cfg.args.trim() ? cfg.args.match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, '')) : []),
    env: strMap(cfg.env),
    cwd: String(cfg.cwd || '').trim(),
    url: String(cfg.url || '').trim(),
    headers: strMap(cfg.headers),
    approvedFingerprint: String(cfg.approvedFingerprint || ''),
  };
}

export function serverFingerprint(cfg) {
  const { approvedFingerprint, ...spec } = normalizeServer(cfg.name, cfg);
  return crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

export function normalizeServers(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [name, cfg] of Object.entries(input)) {
    const n = String(name).trim();
    if (!NAME_RE.test(n)) continue;
    out[n] = normalizeServer(n, cfg);
  }
  return out;
}

// OpenAI 兼容接口要求函数名 [A-Za-z0-9_-]{1,64}，所以统一把非法字符替换掉。
export function qualifiedToolName(server, tool) {
  const raw = `${server}__${tool}`;
  if (/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return raw;
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 51);
  return clean + '_' + crypto.createHash('sha256').update(JSON.stringify([server, tool])).digest('hex').slice(0, 12);
}

// Approval is granted only to named configurations reviewed in the editor.
export function approvedServers(input, previous = {}, approveNames = []) {
  const next = normalizeServers(input), approved = new Set(approveNames);
  for (const [name, cfg] of Object.entries(next)) {
    const fingerprint = serverFingerprint(cfg), old = previous[name];
    cfg.approvedFingerprint = approved.has(name) || (old?.approvedFingerprint === fingerprint) ? fingerprint : '';
  }
  return next;
}

export function redactMcpLog(text,cfg={}) {
  let safe=String(text);
  const secrets=[...Object.entries(cfg.env||{}).filter(([key])=>/token|key|pass|secret|auth|cookie/i.test(key)).map(([,value])=>value),...Object.entries(cfg.headers||{}).filter(([key])=>/authorization|cookie|key|token/i.test(key)).map(([,value])=>value)].filter(value=>typeof value==='string'&&value.length>=4);
  for(const value of secrets.sort((a,b)=>b.length-a.length))safe=safe.replaceAll(value,'[REDACTED]');
  return safe;
}

export class McpHost {
  constructor({ getServers, log, onChange, baseDir } = {}) {
    this.getServers = getServers || (() => ({}));
    this.log = log || (() => {});
    this.onChange = onChange || (() => {});
    this.baseDir = baseDir || process.cwd();
    this.entries = new Map(); // name -> { cfg, state, error, tools, client, transport }
    this.starting = new Map();
    this.index = new Map(); // qualified name -> { entry, raw }
    this.rebuilding = null;
  }

  status() {
    return [...this.entries.values()].map(e => ({
      name: e.cfg.name,
      enabled: e.cfg.enabled,
      transport: e.cfg.transport,
      state: e.state,
      version: e.version || null,
      error: ['error', 'needs-approval'].includes(e.state) ? (e.error || '连接失败') : '',
      tools: (e.tools || []).map(t => ({ name: t.name, description: t.description || '' })),
      toolCount: (e.tools || []).length,
      // 编辑对话框要用回原始配置
      config: { command: e.cfg.command, args: e.cfg.args, env: e.cfg.env, cwd: e.cfg.cwd, url: e.cfg.url, headers: e.cfg.headers },
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  notify() {
    try { this.rebuildIndex(); this.onChange(this.status()); } catch {}
  }

  rebuildIndex() {
    const idx = new Map();
    for (const e of this.entries.values()) {
      if (e.state !== 'ready') continue;
      for (const t of e.tools || []) idx.set(qualifiedToolName(e.cfg.name, t.name), { entry: e, raw: t.name });
    }
    this.index = idx;
  }

  // 给 Agent 的工具清单：带前缀、只暴露已连接服务
  tools() {
    if (this.index.size !== [...this.entries.values()].reduce((n, e) => n + (e.state === 'ready' ? (e.tools || []).length : 0), 0)) this.rebuildIndex();
    return [...this.index.entries()].map(([name, { entry, raw }]) => {
      const t = (entry.tools || []).find(x => x.name === raw) || {};
      return {
        name,
        description: `[MCP:${entry.cfg.name}] ${t.description || raw}`,
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        server: entry.cfg.name,
      };
    });
  }

  has(name) { return this.index.has(name); }
  fingerprint(name) { const hit = this.index.get(name); if (!hit) return ''; return crypto.createHash('sha256').update(JSON.stringify({ server: serverFingerprint(hit.entry.cfg), tool: hit.entry.tools.find(t => t.name === hit.raw) })).digest('hex'); }

  async call(name, args, signal) {
    const hit = this.index.get(name);
    if (!hit) throw new Error('MCP 工具不可用：' + name + '（服务可能未连接，可在插件 → MCP 服务里重试）');
    const { entry, raw } = hit;
    if (!entry.client) throw new Error(`MCP 服务「${entry.cfg.name}」已断开，请在插件中重新连接该服务`);
    let res;
    try {
      res = await entry.client.callTool({ name: raw, arguments: args || {} }, undefined, { signal, timeout: CALL_TIMEOUT });
    } catch (e) {
      return { text: `[MCP:${entry.cfg.name}] 调用失败：${e.message || e}`, isError: true };
    }
    const text = (res.content || []).map(c => c.type === 'text' ? c.text : c.type === 'image' ? `[图片 ${c.mimeType || ''}]` : c.type === 'resource' ? `[资源 ${c.resource?.uri || ''}]` : '').filter(Boolean).join('\n');
    return { text: (res.isError ? '[错误] ' : '') + (text || '（无返回内容）'), isError: !!res.isError };
  }

  async connect(cfg) {
    const [{ Client }, mod] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      cfg.transport === 'stdio'
        ? import('@modelcontextprotocol/sdk/client/stdio.js')
        : cfg.transport === 'sse'
          ? import('@modelcontextprotocol/sdk/client/sse.js')
          : import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    ]);
    let transport;
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error('缺少启动命令');
      const cwd = cfg.cwd || path.join(this.baseDir, 'mcp');
      try { fs.mkdirSync(cwd, { recursive: true }); } catch {}
      transport = new mod.StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: childEnv(process.env, cfg.env),
        cwd,
        stderr: 'pipe',
      });
      transport.stderr?.on('data', d => {
        const s = redactMcpLog(String(d).trim(),cfg);
        if (s) this.log(`[mcp:${cfg.name}] ${s.slice(0, 400)}`);
      });
    } else {
      if (!/^https?:\/\//i.test(cfg.url)) throw new Error('URL 需要以 http(s):// 开头');
      const opts = Object.keys(cfg.headers).length ? { requestInit: { headers: cfg.headers } } : undefined;
      transport = cfg.transport === 'sse'
        ? new mod.SSEClientTransport(new URL(cfg.url), opts)
        : new mod.StreamableHTTPClientTransport(new URL(cfg.url), opts);
    }
    const client = new Client({ name: 'webdecrypthub', version: '1.4.0' });
    try {
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT, '连接');
    } catch (e) {
      try { await client.close(); } catch {}
      throw e;
    }
    return { client, transport };
  }

  async start(name, cfg) {
    if (this.starting.has(name)) return this.starting.get(name);
    const e = this.entries.get(name);
    if (!e) return;
    e.cfg = cfg || e.cfg;
    if (!e.cfg.enabled) { e.state = 'disabled'; this.notify(); return; }
    if (e.cfg.approvedFingerprint !== serverFingerprint(e.cfg)) { e.state = 'needs-approval'; e.error = '启动配置尚未批准，请编辑服务并保存以启用。stdio 服务会以系统用户权限启动。'; this.notify(); return; }
    const generation = e.generation = (e.generation || 0) + 1;
    const current = () => this.entries.get(name) === e && e.generation === generation;
    const task = Promise.resolve().then(async () => {
      let client;
      e.state = 'connecting'; e.error = ''; this.notify();
      try {
        const connection = await this.connect(e.cfg);
        client = connection.client;
        const transport = connection.transport;
        if (!current()) { await client.close(); return; }
        e.pendingClient = client;
        const res = await withTimeout(client.listTools(), LIST_TIMEOUT, '读取工具列表');
        if (!current()) { await client.close(); return; }
        e.pendingClient = null;
        e.client = client; e.transport = transport; e.tools = res.tools || [];
        e.version = client.getServerVersion?.()?.version || null;
        e.state = 'ready'; e.error = '';
        const previousClose = transport.onclose;
        transport.onclose = () => {
          previousClose?.();
          if (e.client !== client) return;
          e.client = null; e.tools = []; e.state = 'error'; e.error = '连接已断开';
          this.log(`[mcp] ${name} 连接已断开`);
          this.notify();
        };
        this.log(`[mcp] ${name} 已连接（${e.tools.length} 个工具）`);
      } catch (err) {
        if (client) { try { await client.close(); } catch {} }
        if (!current()) return;
        e.state = 'error'; e.error = redactMcpLog(String(err?.message || err),e.cfg); e.tools = [];
        e.client = null; e.pendingClient = null;
        this.log(`[mcp] ${name} 连接失败：${e.error}`);
      } finally {
        if (this.starting.get(name) === task) this.starting.delete(name);
        if (current()) this.notify();
      }
    });
    this.starting.set(name, task);
    return task;
  }

  async stop(name) {
    const e = this.entries.get(name);
    if (!e) return;
    e.generation = (e.generation || 0) + 1;
    this.starting.delete(name);
    const clients = new Set([e.client, e.pendingClient]);
    e.client = null; e.pendingClient = null; e.tools = [];
    for (const c of clients) if (c) { try { await c.close(); } catch {} }
    if (e.state !== 'disabled') e.state = 'idle';
    this.notify();
  }

  // 与设置对齐：新增的启动、删除/停用/改配置的停止；配置未变且已连接的不重复拉起
  async apply({ restartAll = false } = {}) {
    const next = normalizeServers(this.getServers());
    for (const [name, e] of [...this.entries]) {
      const cfg = next[name];
      const changed = !cfg || JSON.stringify(cfg) !== JSON.stringify(e.cfg);
      if (!cfg) { await this.stop(name); this.entries.delete(name); continue; }
      if (restartAll || changed || (!cfg.enabled && e.state !== 'disabled')) await this.stop(name);
      e.cfg = cfg;
      if (!cfg.enabled) { e.state = 'disabled'; e.tools = []; }
    }
    for (const [name, cfg] of Object.entries(next)) {
      let e = this.entries.get(name);
      if (!e) { e = { cfg, state: 'idle', error: '', tools: [], client: null }; this.entries.set(name, e); }
      e.cfg = cfg;
      if (!cfg.enabled) { e.state = 'disabled'; continue; }
      if (e.state === 'ready' || e.state === 'connecting') continue;
      this.start(name, cfg);
    }
    this.notify();
    return this.status();
  }

  async restart(name) {
    const cfg = normalizeServers(this.getServers())[name] || this.entries.get(name)?.cfg;
    if (!cfg) throw new Error('服务不存在：' + name);
    await this.stop(name);
    const e = this.entries.get(name) || { cfg, state: 'idle', error: '', tools: [], client: null };
    this.entries.set(name, e);
    e.cfg = cfg;
    await this.start(name, cfg);
    return this.status();
  }

  // 保存前试连：不进入常驻列表，只返回工具清单
  async test(raw) {
    const cfg = normalizeServer(raw?.name || 'test', raw || {});
    let client;
    try {
      const r = await this.connect(cfg);
      client = r.client;
      const res = await withTimeout(client.listTools(), LIST_TIMEOUT, '读取工具列表');
      return { ok: true, tools: (res.tools || []).map(t => ({ name: t.name, description: t.description || '' })), transport: cfg.transport };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      if (client) { try { await client.close(); } catch {} }
    }
  }

  async close() {
    for (const name of [...this.entries.keys()]) await this.stop(name);
    this.entries.clear(); this.index.clear();
  }
}
