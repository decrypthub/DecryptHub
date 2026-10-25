// WDH is a separate MCP process. This adapter owns no Chromium/Patchright code.
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { childEnv, findNode } from './executor.mjs';
const EventSchema = z.object({
  method: z.literal('notifications/wdh/event'),
  params: z.object({ channel: z.string(), payload: z.any().optional() }),
});
export class BrowserManager extends EventEmitter {
  constructor({ components, getRoot, dataDir, kernelDir } = {}) {
    super();
    Object.assign(this, { components, getRoot, dataDir, kernelDir });
    this.client = null;
    this.starting = null;
    this.generation = 0;
    this.closing = null;
    this.snapshot = { running: false, pages: [] };
    this.pages = [];
    this.activePage = null;
    this.requests = [];
    this.scripts = [];
    this.pageCache = new Map();
    this.net = { paused: false };
    this.imported = [];
  }
  get running() {
    return !!this.client && !!this.snapshot.running;
  }
  get embedActive() {
    return this.running && !!this.snapshot.embed;
  }
  get chromePid() {
    return this.snapshot.chromePid;
  }
  get chromeExe() {
    return this.snapshot.chromeExe;
  }
  get cdpPort() {
    return this.snapshot.cdpPort;
  }
  get profileDir() {
    return this.snapshot.profileDir;
  }
  status() {
    return this.snapshot;
  }
  updateStatus(status) {
    if (!status) return;
    this.snapshot = status;
    this.net.paused = !!status.capturePaused;
    for (const page of this.pageCache.values()) page.closed = true;
    this.pages = (status.pages || []).map((info) => {
      let page = this.pageCache.get(info.id);
      if (!page) {
        page = {
          id: info.id,
          info,
          closed: false,
          url() {
            return this.info.url;
          },
          isClosed() {
            return this.closed;
          },
          title: () => this.control('title'),
        };
        this.pageCache.set(info.id, page);
      }
      page.info = info;
      page.closed = false;
      return page;
    });
    this.activePage = this.pages.find((p) => p.info.active) || null;
  }
  expected() {
    return this.activePage ? { id: this.activePage.id, url: this.activePage.url() } : undefined;
  }
  event(channel, payload) {
    if (channel === 'status') this.updateStatus(payload);
    if (channel === 'requests') {
      const by = new Map(this.requests.map((r) => [r.id, r]));
      for (const record of payload || []) by.set(record.id, { ...by.get(record.id), ...record });
      this.requests = [...by.values()].slice(-2000);
    }
    if (channel === 'requests-cleared') this.requests = [];
    if (channel === 'script') this.scripts.push(payload);
    if (channel === 'closed') {
      this.updateStatus({ running: false, pages: [] });
      this.emit('closed');
      return;
    }
    this.emit(channel, payload);
  }
  async ensure() {
    if (this.closing) throw Error('WDH is closing');
    if (this.client) return this.client;
    if (this.starting) return this.starting;
    const generation = this.generation;
    this.starting = (async () => {
      const component = this.components?.resolve();
      if (!component)
        throw Error('尚未安装 WebDecryptHub 组件。文件与代码任务仍可使用；请先在组件设置中安装 WDH。');
      const root = this.getRoot(),
        dataDir = this.dataDir;
      fs.mkdirSync(dataDir, { recursive: true });
      // WDH is a trusted browser runtime, not an untrusted shell job. Chromium's
      // Windows subprocesses need the real OS profile/cache paths. Credentials
      // remain excluded by childEnv; browser profiles/data are explicit below.
      const runtimeEnv = childEnv(
        process.env,
        Object.fromEntries(
          ['TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
            .filter((key) => process.env[key])
            .map((key) => [key, process.env[key]]),
        ),
      );
      const transport = new StdioClientTransport({
        command: findNode(),
        args: [
          component.entry,
          'mcp',
          '--desktop',
          '--root',
          root,
          '--data-dir',
          dataDir,
          '--kernel-dir',
          this.kernelDir,
        ],
        cwd: root,
        env: runtimeEnv,
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (data) => this.emit('log', '[WDH] ' + String(data).trim()));
      const client = new Client({ name: 'DecryptHub', version: '1.4.0' });
      client.setNotificationHandler(EventSchema, (message) =>
        this.event(message.params.channel, message.params.payload),
      );
      try {
        await client.connect(transport);
        if (generation !== this.generation) throw Error('WDH startup cancelled');
        this.client = client;
        const hello = await this.control('hello');
        if (hello.apiVersion !== 1) throw Error('WDH protocol mismatch');
        this.updateStatus(hello.status);
      } catch (error) {
        this.client = null;
        await transport.close().catch(() => {});
        throw error;
      }
      const previousClose = transport.onclose;
      transport.onclose = () => {
        previousClose?.();
        if (this.client === client) {
          this.client = null;
          this.updateStatus({ running: false, pages: [] });
          this.emit('closed');
        }
      };
      return client;
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async invoke(name, args = {}, signal, expected) {
    const client = await this.ensure();
    const result = await client.callTool(
      { name, arguments: args, ...(expected ? { _meta: { 'decrypthub/target': expected } } : {}) },
      undefined,
      { signal, timeout: 150000 },
    );
    return {
      text: (result.content || [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n'),
      isError: !!result.isError,
    };
  }
  async control(action, args = {}) {
    const result = await this.invoke('wdh_control', { action, args });
    if (result.isError) throw Error(result.text);
    const value = JSON.parse(result.text);
    if (value?.pages) this.updateStatus(value);
    return value;
  }
  async callTool(name, args, signal) {
    return this.invoke(name, args, signal, this.expected());
  }
  async launch(options) {
    const result = await this.control('launch', options);
    if (result.ok && this.fit) await this.control('viewport', this.fit);
    return result;
  }
  async navigate(url) {
    return this.control('navigate', { url });
  }
  async setActive(page) {
    if (!page) throw Error('标签页不存在');
    return this.control('select', { index: this.pages.indexOf(page) });
  }
  async fitViewport(width, height, dpr) {
    this.fit = { width, height, dpr };
    return this.client ? this.control('viewport', this.fit) : this.fit;
  }
  async selectPage(index) {
    return this.control('select', { index });
  }
  async newPage(url) {
    return this.control('new-page', { url });
  }
  async goBack() {
    return this.control('go-back');
  }
  async reload() {
    return this.control('reload');
  }
  async input(event) {
    return this.control('input', { event, expected: this.expected() });
  }
  async startScreencast() {
    return this.control('start-frames');
  }
  async stopScreencast() {
    if (this.client) return this.control('stop-frames');
  }
  async embedInset() {
    return this.control('embed-inset');
  }
  async embedFallback(reason) {
    return this.control('embed-fallback', { reason });
  }
  async setCapturePaused(paused) {
    return this.control('capture-pause', { paused });
  }
  async clearRequests() {
    return this.control('clear-requests');
  }
  findRequest(id) {
    return this.requests.find((r) => r.id === id);
  }
  async refreshRequests() {
    if (this.client) this.requests = await this.control('requests');
    return this.requests;
  }
  async bindDebuggerTarget(signal) {
    return this.control('debugger-bind');
  }
  async close() {
    if (this.closing) return this.closing;
    ++this.generation;
    this.closing = (async () => {
      await this.starting?.catch(() => {});
      const client = this.client;
      if (!client) return;
      try {
        await client.callTool({ name: 'wdh_control', arguments: { action: 'close', args: {} } }, undefined, {
          timeout: 15000,
        });
      } finally {
        this.client = null;
        await client.close().catch(() => {});
        this.updateStatus({ running: false, pages: [] });
      }
    })().finally(() => {
      this.closing = null;
    });
    return this.closing;
  }
}
