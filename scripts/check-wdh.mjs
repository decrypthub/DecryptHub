import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { BrowserManager } from '../sidecar/browser.mjs';
import { McpBridge } from '../sidecar/mcp.mjs';
import { userDataDir } from '../sidecar/settings.mjs';
import { ComponentStore } from '../sidecar/components.mjs';
const source = process.argv[2] || process.env.DECRYPTHUB_WDH_DIR;
const installed = source === '--installed';
if (!source) throw Error('Provide the independent WDH checkout path or --installed');
if (installed) {
  delete process.env.DECRYPTHUB_WDH_DIR;
} else {
  process.env.JSRA_DEV = '1';
  process.env.DECRYPTHUB_WDH_DIR = path.resolve(source);
}
const parent = path.resolve('.tmp');
fs.mkdirSync(parent, { recursive: true });
const root = fs.mkdtempSync(path.join(parent, 'wdh-integration-'));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/api' ? 'application/json' : 'text/html');
  res.end(
    req.url === '/api'
      ? '{"integration":true}'
      : '<h1>DecryptHub WDH module verified</h1><script>const MODULE_SOURCE_PROOF = 42;fetch("/api")</script>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = new BrowserManager({
    components: new ComponentStore(installed ? userDataDir() : root),
    getRoot: () => root,
    dataDir: path.join(root, 'web'),
    kernelDir: root,
  }),
  mcp = new McpBridge(() => {}, browser);
try {
  const pending = browser.ensure();
  const cancelled = pending.catch((error) => error);
  await browser.close();
  if (!((await cancelled) instanceof Error) || browser.client)
    throw Error('Close during startup leaked a WDH client');
  const opened = await browser.launch({
    kernel: 'system',
    headless: true,
    embed: false,
    url: `http://127.0.0.1:${server.address().port}`,
  });
  if (!opened.ok) throw Error(opened.error);
  const snapshot = await browser.callTool('browser_snapshot', {});
  if (snapshot.isError || !snapshot.text.includes('module verified')) throw Error(snapshot.text);
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!(await browser.refreshRequests()).some((r) => r.url.endsWith('/api') && r.bodyState === 'ok'))
    throw Error('Module capture failed');
  await mcp.start({ allowedRoot: root });
  const script = await mcp.call('search_in_sources', { query: 'MODULE_SOURCE_PROOF' });
  if (script.isError || !script.text.includes('MODULE_SOURCE_PROOF')) throw Error(script.text);
  console.log('Independent WDH MCP -> DecryptHub: browser, DOM, capture and debugger passed.');
} finally {
  await mcp.stop();
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
