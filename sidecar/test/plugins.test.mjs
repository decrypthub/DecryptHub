import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ComponentStore } from '../components.mjs';
import { PluginManager, selectPluginRelease, comparePluginVersions } from '../plugins.mjs';
import { approvedServers, redactMcpLog } from '../mcphost.mjs';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function zipFiles(files) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name),
      data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const row = Buffer.alloc(46);
    row.writeUInt32LE(0x02014b50);
    row.writeUInt16LE(0x0314, 4);
    row.writeUInt16LE(20, 6);
    row.writeUInt32LE(crc, 16);
    row.writeUInt32LE(data.length, 20);
    row.writeUInt32LE(data.length, 24);
    row.writeUInt16LE(filename.length, 28);
    row.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    row.writeUInt32LE(offset, 42);
    central.push(row, filename);
    offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function archive(id = 'wdh', version = '0.1.0', corrupt = false) {
  const name = id === 'wdh' ? 'cli.mjs' : 'launch.py',
    data = id === 'wdh' ? 'export {};' : 'print("ok")';
  const manifest = {
    manifestVersion: 1,
    id,
    version,
    apiVersion: 1,
    runtime: id === 'wdh' ? 'node' : 'python',
    source: {
      repository: 'decrypthub/' + (id === 'wdh' ? 'WebDecryptHub' : id + '-cli'),
      commit: 'a'.repeat(40),
    },
    entrypoint: name,
    platform: id === 'wdh' ? process.platform : 'any',
    arch: id === 'wdh' ? process.arch : 'any',
    files: [{ path: name, size: Buffer.byteLength(data), sha256: sha(data) }],
  };
  return zipFiles({
    'component.json': JSON.stringify(manifest),
    [name]: corrupt ? 'x'.repeat(data.length) : data,
  });
}
function release(id, bytes) {
  const repo = id === 'wdh' ? 'WebDecryptHub' : id + '-cli';
  return {
    id: 11,
    tag_name: 'component-preview',
    published_at: '2026-10-25T00:00:00Z',
    prerelease: true,
    assets: [
      {
        id: 22,
        name: id + '-0.1.0-' + (id === 'wdh' ? process.platform + '-' + process.arch : 'any') + '.zip',
        digest: 'sha256:' + sha(bytes),
        size: bytes.length,
        browser_download_url:
          'https://github.com/decrypthub/' + repo + '/releases/download/component-preview/plugin.zip',
      },
    ],
  };
}
function fixture(t, { id = 'wdh', bytes = archive(id), fetcher: override } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decrypthub-plugins-')),
    components = new ComponentStore(directory),
    settings = { mcpServers: {} },
    published = release(id, bytes),
    events = [];
  const mcp = { status: () => [], apply: async () => {}, restart: async () => {} };
  const fetcher =
    override ||
    (async (url) =>
      String(url).includes('api.github.com')
        ? new Response(JSON.stringify(String(url).includes('/releases/11') ? published : [published]))
        : new Response(bytes));
  const manager = new PluginManager({
    components,
    mcpHost: mcp,
    getSettings: () => settings,
    saveSettings: () => {},
    broadcast: (channel, event) => events.push(event),
    fetcher,
    pythonProbe: async () => ({
      available: true,
      command: process.execPath,
      args: [],
      version: 'Python 3.14.5',
    }),
  });
  t.after(async () => {
    await manager.close();
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('decrypthub-plugins-'))
      fs.rmSync(directory, { recursive: true, force: true });
  });
  return { manager, components, settings, published, bytes, events };
}
test('official catalog accepts only the matching platform, fixed repository, ZIP and API SHA-256', () => {
  const bytes = archive(),
    value = release('wdh', bytes);
  assert.equal(selectPluginRelease('wdh', [value]).version, '0.1.0');
  for (const mutate of [
    (x) => (x.assets[0].name = 'DecryptHub.exe'),
    (x) =>
      (x.assets[0].browser_download_url = 'https://github.com/other/repo/releases/download/tag/plugin.zip'),
    (x) => (x.assets[0].digest = ''),
    (x) => (x.assets[0].size = 1024 ** 3),
    (x) => (x.draft = true),
  ]) {
    const next = structuredClone(value);
    mutate(next);
    assert.equal(selectPluginRelease('wdh', [next]), null);
  }
  assert.equal(selectPluginRelease('wdh', [value], 'wrong-os', 'x64'), null);
  assert.throws(() => selectPluginRelease('other', []));
});
test('download installs verified files, exposes version and can disable without losing the installed package', async (t) => {
  const { manager, components } = fixture(t);
  manager.install('wdh');
  await manager.jobs.get('wdh');
  assert.equal(manager.operations.get('wdh').phase, 'installed');
  assert.equal(components.info().version, '0.1.0');
  await manager.toggle('wdh', false);
  assert.equal(components.info().installed, true);
  assert.equal(components.info().enabled, false);
  assert.equal(components.resolve(), null);
  await manager.toggle('wdh', true);
  assert.equal(components.info().enabled, true);
});
test('a checksum-invalid component never replaces an existing activation', async (t) => {
  const { manager, components } = fixture(t, { bytes: archive('wdh', '0.1.0', true) });
  const source = path.join(components.root, 'old');
  fs.mkdirSync(source, { recursive: true });
  const old = 'export {};';
  fs.writeFileSync(path.join(source, 'cli.mjs'), old);
  fs.writeFileSync(
    path.join(source, 'component.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: 'wdh',
      apiVersion: 1,
      version: '0.0.9',
      entrypoint: 'cli.mjs',
      platform: process.platform,
      arch: process.arch,
      files: [{ path: 'cli.mjs', size: old.length, sha256: sha(old) }],
    }),
  );
  components.installLocal(source);
  const pointer = fs.readFileSync(components.activeFile, 'utf8');
  manager.install('wdh');
  await manager.jobs.get('wdh');
  assert.equal(manager.operations.get('wdh').phase, 'error');
  assert.equal(fs.readFileSync(components.activeFile, 'utf8'), pointer);
  assert.equal(components.info().version, '0.0.9');
});
test('download redirects cannot leave approved HTTPS asset hosts', async (t) => {
  const bytes = archive(),
    value = release('wdh', bytes),
    { manager, components } = fixture(t, {
      fetcher: async (url) =>
        String(url).includes('api.github.com')
          ? new Response(JSON.stringify(String(url).includes('/releases/11') ? value : [value]))
          : new Response(null, { status: 302, headers: { location: 'http://untrusted.example/plugin.zip' } }),
    });
  manager.install('wdh');
  await manager.jobs.get('wdh');
  assert.equal(manager.operations.get('wdh').phase, 'error');
  assert.equal(components.info().installed, false);
});
test('cancelled installs never activate a component', async (t) => {
  const { manager, components } = fixture(t);
  manager.install('wdh');
  manager.cancel('wdh');
  await manager.jobs.get('wdh');
  assert.equal(manager.operations.get('wdh').phase, 'cancelled');
  assert.equal(components.info().installed, false);
});
test('mobile plugins install separately, configure argument vectors and preserve the official namespace', async (t) => {
  const { manager, components, settings } = fixture(t, { id: 'idh' });
  manager.install('idh');
  await manager.jobs.get('idh');
  assert.equal(components.info('idh').installed, true);
  assert.equal(components.info('wdh').installed, false);
  assert.equal(manager.status().official.find((p) => p.id === 'idh').state, 'needs-configuration');
  await assert.rejects(() => manager.configure('idh', 'http://user:secret@127.0.0.1:8088'), /账号密码/);
  await manager.configure('idh', '127.0.0.1:8088');
  const cfg = settings.mcpServers.decrypthub_idh;
  assert.equal(cfg.command, process.execPath);
  assert.deepEqual(cfg.args.slice(-3), ['mcp', '--endpoint', 'http://127.0.0.1:8088/']);
  assert.ok(cfg.approvedFingerprint);
  assert.equal(components.info('idh').enabled, true);
  assert.ok(manager.preserveManagedServers({}).decrypthub_idh);
  assert.throws(
    () => manager.preserveManagedServers({ decrypthub_idh: { command: 'arbitrary' } }),
    /官方插件/,
  );
});
test('runtime changes are rejected while an Agent is running', async (t) => {
  const { manager } = fixture(t);
  manager.getSessions = () => [{ agent: { running: true } }];
  assert.throws(() => manager.install('wdh'), /停止/);
  await assert.rejects(() => manager.toggle('wdh', false), /停止/);
});

test('updating a disabled mobile gateway preserves its endpoint and disabled state', async (t) => {
  const { manager, components, settings } = fixture(t, { id: 'idh' });
  manager.install('idh');
  await manager.jobs.get('idh');
  await manager.configure('idh', '127.0.0.1:8088');
  await manager.toggle('idh', false);
  const oldEntry = components.resolve('idh', { includeDisabled: true }).entry;
  manager.install('idh');
  await manager.jobs.get('idh');
  assert.equal(manager.operations.get('idh').phase, 'installed');
  const next = components.resolve('idh', { includeDisabled: true });
  assert.notEqual(next.entry, oldEntry);
  assert.equal(components.info('idh').enabled, false);
  assert.equal(settings.mcpServers.decrypthub_idh.enabled, false);
  assert.ok(settings.mcpServers.decrypthub_idh.args.includes(next.entry));
  assert.ok(settings.mcpServers.decrypthub_idh.args.includes('http://127.0.0.1:8088/'));
});

test('updates preserve a disabled WDH and cancellation while closing never activates it', async (t) => {
  const { manager, components } = fixture(t);
  manager.install('wdh');
  await manager.jobs.get('wdh');
  await manager.toggle('wdh', false);
  manager.install('wdh');
  await manager.jobs.get('wdh');
  assert.equal(manager.operations.get('wdh').phase, 'installed');
  assert.equal(components.info().enabled, false);
  const pointer = fs.readFileSync(components.activeFile, 'utf8');
  manager.releaseWdh = async () => manager.cancel('wdh');
  manager.install('wdh');
  await manager.jobs.get('wdh');
  assert.equal(manager.operations.get('wdh').phase, 'cancelled');
  assert.equal(fs.readFileSync(components.activeFile, 'utf8'), pointer);
});

test('invalid gateway configuration or a settings save failure leaves the previous activation', async (t) => {
  const { manager, components, settings } = fixture(t, { id: 'adh' });
  manager.install('adh');
  await manager.jobs.get('adh');
  await manager.configure('adh', '127.0.0.1:8089');
  const pointer = fs.readFileSync(components.activeFile, 'utf8'),
    previousServers = structuredClone(settings.mcpServers);
  settings.mcpServers.decrypthub_adh.args = ['broken-launcher.py'];
  manager.install('adh');
  await manager.jobs.get('adh');
  assert.equal(manager.operations.get('adh').phase, 'error');
  assert.equal(fs.readFileSync(components.activeFile, 'utf8'), pointer);
  settings.mcpServers = previousServers;
  manager.saveSettings = async () => { throw Error('disk full'); };
  manager.install('adh');
  await manager.jobs.get('adh');
  assert.equal(manager.operations.get('adh').phase, 'error');
  assert.equal(fs.readFileSync(components.activeFile, 'utf8'), pointer);
  assert.deepEqual(settings.mcpServers, previousServers);
});

test('version comparisons keep stable releases above their prereleases and compare numeric segments', () => {
  assert.equal(comparePluginVersions('1.0.0', '1.0.0-beta.1'), 1);
  assert.equal(comparePluginVersions('1.10.0', '1.9.9'), 1);
  assert.equal(comparePluginVersions('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  assert.equal(comparePluginVersions('1.0.0', '1.0.0'), 0);
});

test('MCP diagnostics redact configured credentials without removing ordinary arguments', () => {
  const text = redactMcpLog('API secret-value Bearer header-value /ordinary/path', {
    env: { API_KEY: 'secret-value' },
    headers: { Authorization: 'Bearer header-value' },
  });
  assert.ok(!text.includes('secret-value'));
  assert.ok(!text.includes('header-value'));
  assert.ok(text.includes('/ordinary/path'));
});
