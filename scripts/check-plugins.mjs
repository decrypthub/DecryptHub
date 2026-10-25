// Actual UI -> RPC -> GitHub asset -> verified component -> MCP integration.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { chromium } from '@zhizhuodemao/patchright';
const root = process.cwd(),
  parent = path.resolve('.tmp');
fs.mkdirSync(parent, { recursive: true });
const data = fs.mkdtempSync(path.join(parent, 'plugins-ui-')),
  token = crypto.randomBytes(20).toString('hex'),
  pending = new Map();
let socket,
  sequence = 0,
  browser;
const chrome =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(fs.existsSync);
if (!chrome) throw Error('Browser required for plugin UI validation');
const site = http.createServer(async (req, res) => {
  if (req.url === '/browser-fixture') {
    res.setHeader('Content-Type', 'text/html');
    return res.end('<h1>Installed WDH browser verified</h1><script>fetch("/device/network")</script>');
  }
  if (req.url.startsWith('/device') || req.url === '/health' || req.url.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      let text = '';
      for await (const chunk of req) text += chunk;
      const message = JSON.parse(text);
      if (message.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'device-fixture', version: '1.0.0' },
            }
          : message.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'fixture_ping',
                    description: 'Local integration sample',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              }
            : { content: [{ type: 'text', text: 'ok' }] };
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    }
    return res.end(
      JSON.stringify({
        ok: true,
        service: 'ADH',
        process: { pid: 321, app: 'fixture', bundle_id: 'local.fixture' },
        stats: {},
      }),
    );
  }
  const name = new URL(req.url, 'http://local').pathname;
  const file = path.resolve('ui-dist', '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(path.resolve('ui-dist') + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    res.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'application/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.html')
            ? 'text/html'
            : file.endsWith('.svg')
              ? 'image/svg+xml'
              : file.endsWith('.png')
                ? 'image/png'
                : file.endsWith('.ico')
                  ? 'image/x-icon'
                  : 'application/octet-stream',
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const child = spawn(process.execPath, [path.resolve('sidecar/index.mjs')], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    DECRYPTHUB_DATA_DIR: data,
    DECRYPTHUB_WDH_DIR: '',
    JSRA_DEV: '1',
    JSRA_WS_PORT: '0',
    JSRA_WS_TOKEN: token,
    JSRA_NATIVE_HOST: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '',
  errors = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (errors += d));
const until = async (check, label, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (child.exitCode !== null) throw Error('Core exited: ' + errors.slice(-1200));
    if (Date.now() > end) throw Error('Timeout: ' + label);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const invoke = (channel, args = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('RPC timed out: ' + channel));
      }, 300000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ type: 'invoke', id, channel, args }));
  });
const allReady = async (names) => {
  const list = await invoke('mcp-status');
  for (const name of names) {
    const entry = list.find((s) => s.name === name);
    if (entry?.state === 'error') throw Error(name + ': ' + entry.error);
  }
  return names.every((name) => list.find((s) => s.name === name)?.state === 'ready');
};
try {
  await until(() => /JSRA_PORT=(\d+)/.test(output), 'core ready');
  const port = Number(output.match(/JSRA_PORT=(\d+)/)[1]);
  socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  socket.on('message', (raw) => {
    const message = JSON.parse(raw),
      request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      message.error ? request.reject(Error(message.error)) : request.resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const originalSettings = await invoke('get-settings');
  browser = await chromium.launch({ executablePath: chrome, headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' }),
    page = await context.newPage(),
    pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${site.address().port}/?port=${port}&token=${token}`);
  const skip = page.getByRole('button', { name: '稍后', exact: true });
  await skip.waitFor({ state: 'visible', timeout: 15000 });
  await skip.click();
  await page.locator('.setup-dialog').waitFor({ state: 'detached' });
  const rail = page.getByRole('button', { name: '展开会话列表' });
  if (await rail.count()) await rail.first().click();
  await page.locator('.rail-nav').getByRole('button', { name: '插件', exact: true }).click();
  await page.locator('[data-plugin-id="wdh"]').waitFor();
  let available = await invoke('plugins-refresh', { force: true });
  for (const plugin of available.official)
    if (!plugin.latest) throw Error(plugin.id + ': missing release ' + plugin.catalogError);
  for (const id of ['wdh', 'idh', 'adh']) {
    const row = page.locator('[data-plugin-id="' + id + '"]');
    await row.getByRole('button', { name: '安装 ' + id.toUpperCase(), exact: true }).click();
    await until(
      async () => {
        const p = (await invoke('plugins-list')).official.find((p) => p.id === id);
        if (p.operation?.phase === 'error') throw Error(id + ': ' + p.operation.error);
        return p.installed && p.operation?.phase === 'installed';
      },
      id + ' installed',
      300000,
    );
    console.log(
      id.toUpperCase() +
        ': downloaded from official release, full checksum verification and activation passed.',
    );
  }
  for (const id of ['idh', 'adh']) {
    const row = page.locator('[data-plugin-id="' + id + '"]');
    await row.getByRole('button', { name: '配置', exact: true }).click();
    await row
      .getByRole('textbox', { name: id.toUpperCase() + ' 服务地址', exact: true })
      .fill('http://127.0.0.1:' + site.address().port + '/device');
    await row.getByRole('button', { name: '保存并连接', exact: true }).click();
    await until(() => allReady(['decrypthub_' + id]), id + ' MCP connected');
    await row.getByRole('button', { name: '收起', exact: true }).click();
  }
  await page.getByRole('button', { name: '添加服务', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').nth(0).fill('custom-demo');
  await dialog.locator('input').nth(1).fill(process.execPath);
  await dialog.locator('textarea').nth(0).fill(path.resolve('sidecar/test/fixtures/mcp-demo-server.mjs'));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await until(() => allReady(['custom-demo']), 'custom MCP connected');
  await invoke('save-settings', { ...originalSettings, temperature: 0.3 });
  if (!(await allReady(['decrypthub_idh', 'decrypthub_adh', 'custom-demo'])))
    throw Error('Stale preferences overwrote MCP configuration');
  const statuses = await invoke('mcp-status');
  if (statuses.some((s) => s.state === 'ready' && !s.version)) throw Error('Connected MCP version missing');
  const shots = path.resolve('artifacts/plugins');
  fs.mkdirSync(shots, { recursive: true });
  await page.locator('.plugins-page').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ path: path.join(shots, 'light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(shots, 'dark.png') });
  const preferences = await invoke('get-settings');
  await invoke('save-settings', {
    ...preferences,
    kernel: 'system',
    headless: true,
    embedMode: 'screencast',
  });
  const session = (await invoke('session-list')).focused;
  const opened = await invoke('browser-launch', {
    sessionId: session,
    url: 'http://127.0.0.1:' + site.address().port + '/browser-fixture',
  });
  if (!opened.ok) throw Error(opened.error);
  const snapshot = await invoke('tool-run', { sessionId: session, name: 'browser_snapshot', args: {} });
  if (snapshot.isError || !snapshot.text.includes('Installed WDH browser verified'))
    throw Error('Downloaded WDH browser failed: ' + snapshot.text);
  await until(
    async () =>
      (await invoke('get-requests', { sessionId: session })).list.some(
        (r) => r.url.endsWith('/device/network') && r.bodyState === 'ok',
      ),
    'downloaded WDH capture',
  );
  await invoke('browser-close', { sessionId: session });
  const wdh = page.locator('[data-plugin-id="wdh"]');
  await wdh.getByRole('switch', { name: '启用 WDH', exact: true }).click();
  await until(
    async () => (await invoke('plugins-list')).official.find((p) => p.id === 'wdh').enabled === false,
    'disabled WDH',
  );
  const sid = (await invoke('session-list')).focused;
  if ((await invoke('list-tools', { sessionId: sid })).some((t) => t.name === 'browser_open'))
    throw Error('Disabled WDH tools still registered');
  if (pageErrors.length) throw Error(pageErrors.join('\n'));
  console.log(
    'Plugin UI passed: three real installs, IDH/ADH bridges, custom MCP editor, versions, stale-settings protection, disable, light/dark screenshots.',
  );
  await invoke('prepare-exit');
} finally {
  await browser?.close();
  socket?.terminate();
  if (child.exitCode === null)
    await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 12000))]);
  if (child.exitCode === null) child.kill();
  site.closeAllConnections();
  await new Promise((r) => site.close(r));
}
