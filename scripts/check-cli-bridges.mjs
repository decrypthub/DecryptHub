import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { extractZip } from '../sidecar/zip.mjs';
import { ComponentStore } from '../sidecar/components.mjs';
import { McpHost } from '../sidecar/mcphost.mjs';
import { PluginManager } from '../sidecar/plugins.mjs';
const archives = process.argv.slice(2);
if (archives.length !== 2) throw Error('Usage: node scripts/check-cli-bridges.mjs <idh.zip> <adh.zip>');
const root = fs.mkdtempSync(path.resolve('.tmp/cli-bridge-')),
  components = new ComponentStore(root),
  settings = { mcpServers: {} };
const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const msg = JSON.parse(body);
    if (msg.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    const result =
      msg.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture-device', version: '1.0.0' },
          }
        : msg.method === 'tools/list'
          ? {
              tools: [
                {
                  name: 'fixture_ping',
                  description: 'Local test only',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            }
          : { content: [{ type: 'text', text: 'ok' }] };
    return res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  }
  res.end(
    JSON.stringify({
      ok: true,
      service: 'ADH',
      process: { pid: 123, app: 'fixture', bundle_id: 'local.fixture' },
      stats: {},
    }),
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const host = new McpHost({
  getServers: () => settings.mcpServers,
  baseDir: root,
  log: (m) => process.stderr.write(m + '\n'),
});
const plugins = new PluginManager({
  components,
  mcpHost: host,
  getSettings: () => settings,
  saveSettings: () => {},
});
try {
  for (const [id, index] of [
    ['idh', 0],
    ['adh', 1],
  ]) {
    const stage = path.join(root, id);
    await extractZip(path.resolve(archives[index]), { dir: stage });
    components.installLocal(stage);
    await plugins.configure(id, 'http://127.0.0.1:' + server.address().port);
    let status;
    const deadline = Date.now() + 15000;
    do {
      status = host.status().find((s) => s.name === 'decrypthub_' + id);
      if (status.state === 'ready' || status.state === 'error') break;
      await new Promise((r) => setTimeout(r, 50));
    } while (Date.now() < deadline);
    if (status.state !== 'ready') throw Error(JSON.stringify(status));
    console.log(id + ': ready; tools=' + status.toolCount + '; server version=' + status.version);
  }
} finally {
  await plugins.close();
  await host.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
