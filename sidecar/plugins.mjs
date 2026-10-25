import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { OFFICIAL_PLUGINS, officialPlugin, managedServerName } from './plugin-catalog.mjs';
import { resolveIn, atomicJson } from './paths.mjs';
import { validateManifest, verifyComponentFile } from './components.mjs';
import { extractZip } from './zip.mjs';
import { approvedServers, normalizeServers, serverFingerprint } from './mcphost.mjs';
import { childEnv } from './executor.mjs';
import { DEFAULT_TOOLS } from './catalog.mjs';
const githubHeaders = () => {
  const token = String(process.env.DECRYPTHUB_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (token && /[^\x21-\x7e]/.test(token)) throw Error('GitHub 访问凭据格式无效');
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DecryptHub/1.4',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
  };
};
const exec = promisify(execFile),
  MAX_ARCHIVE = 256 * 1024 ** 2;
export function comparePluginVersions(a, b) {
  const parse = (value) => {
      const [main, ...pre] = String(value).replace(/^v/, '').split('-');
      return { main: main.split('.').map(Number), pre: pre.join('-').split('.').filter(Boolean) };
    },
    x = parse(a),
    y = parse(b);
  for (let i = 0; i < 3; i++) {
    const n = (x.main[i] || 0) - (y.main[i] || 0);
    if (n) return Math.sign(n);
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined) return -1;
    if (y.pre[i] === undefined) return 1;
    if (x.pre[i] === y.pre[i]) continue;
    const xn = /^\d+$/.test(x.pre[i]),
      yn = /^\d+$/.test(y.pre[i]);
    if (xn && yn) return Math.sign(Number(x.pre[i]) - Number(y.pre[i]));
    if (xn !== yn) return xn ? -1 : 1;
    return x.pre[i].localeCompare(y.pre[i]);
  }
  return 0;
}
export function selectPluginRelease(id, releases, platform = process.platform, arch = process.arch) {
  const plugin = officialPlugin(id),
    suffix = id === 'wdh' ? platform + '-' + arch : 'any';
  for (const release of releases
    .filter((r) => !r.draft)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))) {
    for (const asset of release.assets || []) {
      const match = String(asset.name).match(
        new RegExp('^' + id + '-(\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?)-' + suffix + '\\.zip$'),
      );
      if (
        !match ||
        !Number.isSafeInteger(release.id) ||
        release.id < 1 ||
        !Number.isSafeInteger(asset.id) ||
        asset.id < 1
      )
        continue;
      if (
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > MAX_ARCHIVE
      )
        continue;
      let url;
      try {
        url = new URL(asset.browser_download_url);
      } catch {
        continue;
      }
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'github.com' ||
        !url.pathname.startsWith('/' + plugin.repository + '/releases/download/')
      )
        continue;
      return {
        version: match[1],
        tag: release.tag_name,
        releaseId: release.id,
        assetId: asset.id,
        name: asset.name,
        url: url.href,
        size: asset.size,
        sha256: asset.digest.slice(7),
        prerelease: !!release.prerelease,
        publishedAt: release.published_at,
      };
    }
  }
  return null;
}
export async function detectPython(base = process.env) {
  const commands = [];
  if (base.DECRYPTHUB_PYTHON && path.isAbsolute(base.DECRYPTHUB_PYTHON))
    commands.push([base.DECRYPTHUB_PYTHON, []]);
  for (const directory of (base.PATH || base.Path || '').split(path.delimiter)) {
    if (!path.isAbsolute(directory) || /Microsoft[\\/]WindowsApps/i.test(directory)) continue;
    for (const name of process.platform === 'win32'
      ? ['python.exe', 'python3.exe', 'py.exe']
      : ['python3', 'python']) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) commands.push([file, name === 'py.exe' ? ['-3'] : []]);
    }
  }
  for (const [command, args] of commands) {
    try {
      const result = await exec(
        command,
        [
          ...args,
          '-I',
          '-c',
          'import sys,json; print(json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable}))',
        ],
        { windowsHide: true, timeout: 5000, env: childEnv(base) },
      );
      const info = JSON.parse(result.stdout.trim());
      if (
        info.version?.[0] === 3 &&
        info.version[1] >= 10 &&
        path.isAbsolute(info.executable) &&
        fs.existsSync(info.executable)
      )
        return {
          available: true,
          command: info.executable,
          args: ['-I', '-B', '-X', 'utf8'],
          version: 'Python ' + info.version.join('.'),
        };
    } catch {}
  }
  return {
    available: false,
    version: null,
    error: '需要 Python 3.10 或更新版本。安装后点击检查更新以重新检测。',
  };
}
export class PluginManager {
  constructor({
    components,
    mcpHost,
    getSettings,
    saveSettings,
    getSessions = () => [],
    broadcast = () => {},
    fetcher = fetch,
    pythonProbe = detectPython,
  }) {
    Object.assign(this, {
      components,
      mcpHost,
      getSettings,
      saveSettings,
      getSessions,
      broadcast,
      fetcher,
      pythonProbe,
    });
    this.root = path.join(components.root, 'downloads');
    this.cacheFile = path.join(components.root, 'catalog.json');
    this.releases = {};
    this.operations = new Map();
    this.controllers = new Map();
    this.jobs = new Map();
    this.errors = {};
    this.python = null;
    this.closed = false;
    try {
      const cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      if (cache.version === 1) {
        this.releases = cache.releases || {};
        this.checkedAt = cache.checkedAt;
      }
    } catch {}
  }
  async runtime(force = false) {
    if (force) this.pythonPromise = null;
    if (!this.pythonPromise) this.pythonPromise = this.pythonProbe().then((value) => (this.python = value));
    await this.pythonPromise;
    return this.python;
  }
  status() {
    const settings = this.getSettings(),
      mcp = this.mcpHost.status(),
      sessions = this.getSessions();
    return {
      checkedAt: this.checkedAt || null,
      official: OFFICIAL_PLUGINS.map((plugin) => {
        const local = this.components.info(plugin.id),
          cfg = settings.mcpServers?.[managedServerName(plugin.id)],
          connection = mcp.find((x) => x.name === managedServerName(plugin.id));
        const latest = this.releases[plugin.id] || null,
          active = sessions.filter((s) => s.browser.running).length;
        let state = !local.installed
          ? 'not-installed'
          : plugin.id === 'wdh'
            ? !local.enabled
              ? 'disabled'
              : active
                ? 'running'
                : 'ready'
            : !this.python?.available
              ? 'needs-runtime'
              : !cfg
                ? 'needs-configuration'
                : !local.enabled
                  ? 'disabled'
                  : connection?.state || 'idle';
        return {
          ...plugin,
          ...local,
          latest,
          updateAvailable:
            !!latest && !!local.version && comparePluginVersions(latest.version, local.version) > 0,
          state,
          active: plugin.id === 'wdh' ? active : 0,
          toolCount: connection?.toolCount || 0,
          serverVersion: connection?.version || null,
          endpoint: cfg?.args?.find((a, i) => cfg.args[i - 1] === '--endpoint') || '',
          runtimeInfo:
            plugin.runtime === 'python'
              ? this.python
              : { available: true, version: 'Node ' + process.versions.node },
          catalogError: this.errors[plugin.id] || '',
          error: local.error || connection?.error || '',
          operation: this.operations.get(plugin.id) || null,
        };
      }),
    };
  }
  notify() {
    if (!this.closed) this.broadcast('plugins-status', this.status());
  }
  async refresh(force = false) {
    await this.runtime(force);
    if (!force && this.checkedAt && Date.now() - this.checkedAt < 10 * 60 * 1000) return this.status();
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const settled = await Promise.allSettled(
        OFFICIAL_PLUGINS.map(async (plugin) => {
          const response = await this.fetcher(
            'https://api.github.com/repos/' + plugin.repository + '/releases?per_page=30',
            { headers: githubHeaders(), signal: AbortSignal.timeout(20000) },
          );
          if (!response.ok)
            throw Error(
              response.status === 403 || response.status === 429
                ? 'GitHub 请求受限，请稍后重试。'
                : '无法检查版本（HTTP ' + response.status + '）',
            );
          const releases = await response.json();
          if (!Array.isArray(releases)) throw Error('无效的 GitHub 发布数据');
          return selectPluginRelease(plugin.id, releases);
        }),
      );
      settled.forEach((result, index) => {
        const id = OFFICIAL_PLUGINS[index].id;
        if (result.status === 'fulfilled') {
          this.releases[id] = result.value;
          delete this.errors[id];
        } else this.errors[id] = result.reason.message;
      });
      this.checkedAt = Date.now();
      atomicJson(this.cacheFile, { version: 1, releases: this.releases, checkedAt: this.checkedAt });
      this.notify();
      return this.status();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  assertIdle() {
    if (this.getSessions().some((s) => s.agent?.running || s.queue?.length))
      throw Error('请先停止正在运行的 Agent 并清空队列，再变更插件。');
  }
  async releaseWdh() {
    for (const session of this.getSessions()) await session.closeBrowser();
  }
  updateTools() {
    for (const session of this.getSessions()) {
      if (session.agent) {
        session.agent.localTools = DEFAULT_TOOLS.filter(
          (t) => !t.component || (this.components.info().installed && this.components.info().enabled),
        );
        session.agent.emitContext();
      }
    }
  }
  async change(fn) {
    this.assertIdle();
    if (this.applying) throw Error('正在切换插件，请稍后重试');
    this.applying = true;
    try {
      return await fn();
    } finally {
      this.applying = false;
    }
  }
  toggle(id, enabled) {
    return this.change(() => this._toggle(id, enabled));
  }
  configure(id, endpoint, enabled = true) {
    return this.change(() => this._configure(id, endpoint, enabled));
  }
  async _toggle(id, enabled) {
    officialPlugin(id);
    this.assertIdle();
    if (this.controllers.has(id)) throw Error('插件正在安装，请等待或取消');
    if (id === 'wdh') await this.releaseWdh();
    this.components.setEnabled(id, !!enabled);
    if (id !== 'wdh') {
      const settings = this.getSettings(),
        name = managedServerName(id),
        servers = { ...settings.mcpServers };
      if (servers[name]) servers[name] = { ...servers[name], enabled: !!enabled };
      settings.mcpServers = approvedServers(servers, settings.mcpServers, enabled ? [name] : []);
      await this.saveSettings();
      await this.mcpHost.apply();
    }
    this.updateTools();
    this.notify();
    return this.status();
  }
  async _configure(id, endpoint, enabled = true) {
    const plugin = officialPlugin(id);
    if (plugin.runtime !== 'python') throw Error('此插件不使用设备服务地址');
    this.assertIdle();
    const component = this.components.resolve(id, { includeDisabled: true });
    if (!component) throw Error('请先安装插件');
    await this.runtime(true);
    if (!this.python.available) throw Error(this.python.error);
    let address = String(endpoint).trim();
    if (!address.includes('://')) address = 'http://' + address;
    const url = new URL(address);
    if (url.protocol !== 'http:' || url.username || url.password || url.hash || url.search)
      throw Error('当前官方网关需要 HTTP 服务地址，地址中不应包含账号密码、查询参数或片段');
    const name = managedServerName(id),
      directory = path.join(this.components.root, 'data', id);
    fs.mkdirSync(directory, { recursive: true });
    const settings = this.getSettings(),
      cfg = {
        transport: 'stdio',
        enabled: !!enabled,
        command: this.python.command,
        args: [
          ...this.python.args,
          component.entry,
          ...(id === 'idh' ? ['--no-auto-update'] : []),
          'mcp',
          '--endpoint',
          url.href,
        ],
        cwd: directory,
        env: {
          [id.toUpperCase() + '_CONFIG_PATH']: path.join(directory, 'connections.json'),
          ...(id === 'idh'
            ? { IDH_SETTINGS_PATH: path.join(directory, 'settings.json'), IDH_AUTO_UPDATE: 'off' }
            : {}),
          HOME: directory,
          USERPROFILE: directory,
          APPDATA: directory,
          LOCALAPPDATA: directory,
          PYTHONIOENCODING: 'utf-8',
        },
      };
    settings.mcpServers = approvedServers({ ...settings.mcpServers, [name]: cfg }, settings.mcpServers, [
      name,
    ]);
    this.components.setEnabled(id, !!enabled);
    await this.saveSettings();
    await this.mcpHost.apply();
    this.updateTools();
    this.notify();
    return this.status();
  }
  async reconnect(id) {
    officialPlugin(id);
    if (id === 'wdh') return this.status();
    await this.mcpHost.restart(managedServerName(id));
    this.notify();
    return this.status();
  }
  progress(id, patch) {
    const prior = this.operations.get(id) || {};
    const next = { ...prior, ...patch, id };
    this.operations.set(id, next);
    this.notify();
  }
  async download(asset, file, signal, id) {
    let url = new URL(asset.url),
      response;
    for (let attempt = 0; attempt < 6; attempt++) {
      const allowed =
        url.protocol === 'https:' &&
        (url.hostname === 'github.com' ||
          url.hostname === 'release-assets.githubusercontent.com' ||
          url.hostname === 'objects.githubusercontent.com');
      if (!allowed) throw Error('插件下载跳转到未经允许的地址');
      response = await this.fetcher(url.href, { redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        await response.body?.cancel();
        if (!next) throw Error('下载重定向无效');
        url = new URL(next, url);
        continue;
      }
      break;
    }
    if (!response?.ok) throw Error('插件下载失败（HTTP ' + response?.status + '）');
    const hash = crypto.createHash('sha256');
    let got = 0,
      last = 0;
    const meter = new Transform({
      transform: (chunk, encoding, callback) => {
        got += chunk.length;
        if (got > asset.size || got > MAX_ARCHIVE) return callback(Error('插件大小超过发布记录'));
        hash.update(chunk);
        if (Date.now() - last > 120) {
          last = Date.now();
          this.progress(id, { phase: 'downloading', got, total: asset.size });
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(file, { flags: 'wx' }), {
      signal,
    });
    if (got !== asset.size || hash.digest('hex') !== asset.sha256) throw Error('插件 SHA-256 校验失败');
  }
  install(id) {
    officialPlugin(id);
    this.assertIdle();
    if (this.controllers.has(id)) throw Error('插件正在安装');
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.progress(id, { phase: 'checking', got: 0, total: 0, error: '', version: null });
    const job = (async () => {
      let partial;
      try {
        await this.refresh(true);
        controller.signal.throwIfAborted();
        const asset = this.releases[id];
        if (!asset) throw Error('当前平台尚无兼容的官方插件安装包');
        // Fetch again by immutable release ID; ignore an editable local catalog cache.
        const plugin = officialPlugin(id),
          response = await this.fetcher(
            'https://api.github.com/repos/' + plugin.repository + '/releases/' + asset.releaseId,
            { signal: controller.signal, headers: githubHeaders() },
          );
        if (!response.ok) throw Error('无法复核官方发布记录');
        const verified = selectPluginRelease(id, [await response.json()]);
        if (
          !verified ||
          verified.assetId !== asset.assetId ||
          verified.sha256 !== asset.sha256 ||
          verified.version !== asset.version ||
          verified.name !== asset.name ||
          verified.size !== asset.size
        )
          throw Error('发布记录已变化，请刷新后重试');
        fs.mkdirSync(this.root, { recursive: true });
        partial = path.join(this.root, crypto.randomUUID() + '.part');
        this.progress(id, { phase: 'downloading', version: asset.version, total: asset.size });
        await this.download(verified, partial, controller.signal, id);
        controller.signal.throwIfAborted();
        this.progress(id, { phase: 'verifying', got: asset.size, total: asset.size });
        const staged = fs.mkdtempSync(path.join(this.root, 'stage-' + id + '-'));
        await extractZip(partial, { dir: staged, maxBytes: 1024 ** 3, maxEntries: 50000 });
        controller.signal.throwIfAborted();
        const manifest = validateManifest(
          JSON.parse(fs.readFileSync(resolveIn(staged, 'component.json'), 'utf8')),
        );
        if (
          manifest.id !== id ||
          manifest.version !== asset.version ||
          (manifest.runtime || 'node') !== plugin.runtime ||
          manifest.source?.repository !== plugin.repository ||
          !/^[a-f0-9]{40}$/.test(manifest.source?.commit || '')
        )
          throw Error('安装包身份或运行时与官方插件不一致');
        const prepared = await this.components.prepareLocal(staged, {
          signal: controller.signal,
          onProgress: (progress) => this.progress(id, progress),
        });
        await this.change(async () => {
          controller.signal.throwIfAborted();
          this.progress(id, { phase: 'installing' });
          const settings = this.getSettings(),
            previousServers = settings.mcpServers,
            previousPointer = fs.existsSync(this.components.activeFile)
              ? JSON.parse(fs.readFileSync(this.components.activeFile, 'utf8'))
              : {},
            local = this.components.info(id),
            name = id !== 'wdh' ? managedServerName(id) : null,
            existing = name && previousServers?.[name];
          let nextServers = previousServers;
          if (existing) {
            const current = this.components.resolve(id, { includeDisabled: true }),
              args = [...existing.args],
              index = args.indexOf(current?.entry);
            if (index < 0) throw Error('现有网关配置已更改，请重新配置地址');
            args[index] = resolveIn(prepared.directory, manifest.entrypoint);
            nextServers = approvedServers(
              { ...previousServers, [name]: { ...existing, args } },
              previousServers,
              [name],
            );
          }
          if (id === 'wdh') await this.releaseWdh();
          controller.signal.throwIfAborted();
          let installed;
          try {
            installed = this.components.activate(prepared, {
              enabled: id === 'wdh' ? !local.installed || local.enabled : !!existing?.enabled,
            });
            if (existing) {
              settings.mcpServers = nextServers;
              await this.saveSettings();
              await this.mcpHost.apply();
            }
          } catch (error) {
            atomicJson(this.components.activeFile, previousPointer);
            settings.mcpServers = previousServers;
            if (existing) {
              try {
                await this.saveSettings();
                await this.mcpHost.apply();
              } catch {}
            }
            throw error;
          }
          this.updateTools();
          this.progress(id, {
            phase: 'installed',
            got: asset.size,
            total: asset.size,
            version: installed.version,
          });
        });
      } catch (error) {
        this.progress(id, {
          phase: controller.signal.aborted ? 'cancelled' : 'error',
          error: controller.signal.aborted ? '已取消安装' : error.message,
        });
      } finally {
        if (partial)
          try {
            fs.unlinkSync(partial);
          } catch {}
        this.controllers.delete(id);
        this.jobs.delete(id);
        this.notify();
      }
    })();
    this.jobs.set(id, job);
    return this.status();
  }
  cancel(id) {
    if (this.controllers.has(id)) {
      this.controllers.get(id).abort();
      this.progress(id, { phase: 'cancelling' });
    }
    return this.status();
  }
  preserveManagedServers(input) {
    const next = normalizeServers(input),
      old = this.getSettings().mcpServers || {};
    for (const id of ['idh', 'adh']) {
      const name = managedServerName(id);
      if (next[name] && (!old[name] || serverFingerprint(next[name]) !== serverFingerprint(old[name])))
        throw Error('官方插件请在插件详情中配置');
      if (old[name]) next[name] = old[name];
    }
    return next;
  }
  async close() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.jobs.values()]);
  }
}
