// Debugger bridge over the same per-session WDH MCP connection as UI browsing.
export class McpBridge {
  constructor(log, browser) {
    this.log = log || (() => {});
    this.browser = browser;
    this.tools = [];
    this.started = false;
  }
  get client() {
    return this.started && this.browser?.client;
  }
  async start(options) {
    this.opts = options;
    const value = await this.browser.control('debugger-start', { allowedRoot: options.allowedRoot });
    this.tools = value.tools;
    this.started = true;
    return this.tools;
  }
  has(name) {
    return this.tools.some((t) => t.name === name);
  }
  call(name, args, signal) {
    return this.browser.callTool(name, args, signal);
  }
  async selectTarget() {
    return this.browser.bindDebuggerTarget();
  }
  async stop() {
    if (this.browser?.client) await this.browser.control('debugger-stop').catch(() => {});
    this.started = false;
    this.tools = [];
  }
}
