import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveIn, atomicJson } from './paths.mjs';

export function validateManifest(manifest, { development = false } = {}) {
  if (
    manifest?.manifestVersion !== 1 ||
    !['wdh', 'idh', 'adh'].includes(manifest.id) ||
    manifest.apiVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version || '')
  )
    throw Error('Incompatible WDH component manifest');
  if ((manifest.runtime || 'node') !== (manifest.id === 'wdh' ? 'node' : 'python'))
    throw Error('Invalid component runtime');
  const relative = (value) =>
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    !value.split('/').some((p) => !p || p === '.' || p === '..') &&
    !/[:\0]/.test(value);
  if (!relative(manifest.entrypoint)) throw Error('Invalid component entrypoint');
  if (development && !manifest.files) return manifest;
  if (
    (manifest.platform !== process.platform || manifest.arch !== process.arch) &&
    !(manifest.id !== 'wdh' && manifest.platform === 'any' && manifest.arch === 'any')
  )
    throw Error('Component platform mismatch');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 50000)
    throw Error('Invalid component file list');
  const seen = new Set();
  let bytes = 0;
  for (const file of manifest.files) {
    const key = String(file.path).toLowerCase();
    if (
      !relative(file.path) ||
      key === 'component.json' ||
      seen.has(key) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw Error('Invalid or duplicate component file');
    bytes += file.size;
    if (bytes > 1024 ** 3) throw Error('Component exceeds 1 GiB');
    seen.add(key);
  }
  if (!manifest.files.some((f) => f.path === manifest.entrypoint))
    throw Error('Component entrypoint is not checksummed');
  return manifest;
}
export function verifyComponentFile(directory, file) {
  const full = resolveIn(directory, file.path),
    stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.nlink > 1 || stat.size !== file.size)
    throw Error('Invalid component file: ' + file.path);
  const bytes = fs.readFileSync(full);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    throw Error('Component checksum mismatch: ' + file.path);
  return bytes;
}
export class ComponentStore {
  constructor(userDataDir) {
    this.root = path.join(userDataDir, 'components');
    this.activeFile = path.join(this.root, 'active.json');
  }
  resolve(id = 'wdh', { includeDisabled = false } = {}) {
    if (!['wdh', 'idh', 'adh'].includes(id)) throw Error('Unknown component');
    const development = id === 'wdh' && !!process.env.DECRYPTHUB_WDH_DIR && process.env.JSRA_DEV === '1';
    let directory;
    if (development && !includeDisabled) {
      let current = {};
      try {
        current = JSON.parse(fs.readFileSync(resolveIn(this.root, 'active.json'), 'utf8'));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (current.disabled?.[id]) return null;
    }
    if (development) directory = path.resolve(process.env.DECRYPTHUB_WDH_DIR);
    else {
      let active;
      try {
        active = JSON.parse(fs.readFileSync(resolveIn(this.root, 'active.json'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      if (!active[id] || (!includeDisabled && active.disabled?.[id])) return null;
      if (typeof active[id] !== 'string' || path.isAbsolute(active[id]))
        throw Error('Invalid component activation pointer');
      directory = resolveIn(this.root, active[id]);
    }
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(resolveIn(directory, 'component.json'), 'utf8')),
      { development },
    );
    if (manifest.id !== id) throw Error('Component identity mismatch');
    const entry = resolveIn(directory, manifest.entrypoint);
    if (!fs.statSync(entry).isFile()) throw Error('WDH entrypoint missing');
    // Installed packages are verified in full before activation. Recheck the
    // entrypoint on launch; this is integrity detection, not an OS sandbox.
    if (!development)
      verifyComponentFile(
        directory,
        manifest.files.find((f) => f.path === manifest.entrypoint),
      );
    return {
      directory,
      entry,
      runtime: manifest.runtime || 'node',
      version: manifest.version,
      apiVersion: manifest.apiVersion,
    };
  }
  info(id = 'wdh') {
    try {
      const active = this.resolve(id, { includeDisabled: true });
      return {
        id,
        installed: !!active,
        enabled: !!active && !!this.resolve(id),
        version: active?.version || null,
        apiVersion: 1,
      };
    } catch (error) {
      return { id, installed: false, enabled: false, error: error.message };
    }
  }
  setEnabled(id, enabled) {
    if (!['wdh', 'idh', 'adh'].includes(id)) throw Error('Unknown component');
    let active = {};
    try {
      active = JSON.parse(fs.readFileSync(this.activeFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!this.resolve(id, { includeDisabled: true })) throw Error('请先安装插件');
    atomicJson(this.activeFile, { ...active, disabled: { ...active.disabled, [id]: !enabled } });
  }
  async prepareLocal(source, { signal, onProgress } = {}) {
    source = path.resolve(source);
    const manifest = validateManifest(
      JSON.parse(await fs.promises.readFile(resolveIn(source, 'component.json'), 'utf8')),
    );
    const directory = path.join(
      this.root,
      'versions',
      manifest.id + '-' + manifest.version + '-' + crypto.randomUUID(),
    );
    await fs.promises.mkdir(directory, { recursive: true });
    let done = 0;
    for (const file of manifest.files) {
      signal?.throwIfAborted();
      const original = resolveIn(source, file.path),
        stat = await fs.promises.lstat(original);
      if (!stat.isFile() || stat.nlink > 1 || stat.size !== file.size)
        throw Error('Invalid component file: ' + file.path);
      const bytes = await fs.promises.readFile(original);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256)
        throw Error('Component checksum mismatch: ' + file.path);
      const destination = resolveIn(directory, file.path);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.writeFile(destination, bytes);
      if (++done % 100 === 0 || done === manifest.files.length)
        onProgress?.({ doneFiles: done, totalFiles: manifest.files.length });
    }
    signal?.throwIfAborted();
    await fs.promises.writeFile(path.join(directory, 'component.json'), JSON.stringify(manifest, null, 2));
    return { id: manifest.id, version: manifest.version, directory };
  }
  activate(prepared, { enabled = true } = {}) {
    const directory = resolveIn(this.root, prepared.directory);
    if (!path.relative(this.root, directory).startsWith('versions' + path.sep))
      throw Error('Invalid component activation directory');
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(resolveIn(directory, 'component.json'), 'utf8')),
    );
    if (manifest.id !== prepared.id || manifest.version !== prepared.version)
      throw Error('Prepared component identity mismatch');
    verifyComponentFile(
      directory,
      manifest.files.find((f) => f.path === manifest.entrypoint),
    );
    let active = {};
    try {
      active = JSON.parse(fs.readFileSync(this.activeFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    atomicJson(this.activeFile, {
      ...active,
      [manifest.id]: path.relative(this.root, directory),
      disabled: { ...active.disabled, [manifest.id]: !enabled },
    });
    return { id: manifest.id, version: manifest.version, directory };
  }
  installLocal(source) {
    source = path.resolve(source);
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(resolveIn(source, 'component.json'), 'utf8')),
    );
    const target = path.join(
      this.root,
      'versions',
      manifest.id + '-' + manifest.version + '-' + crypto.randomUUID(),
    );
    fs.mkdirSync(target, { recursive: true });
    for (const file of manifest.files) {
      const bytes = verifyComponentFile(source, file),
        destination = resolveIn(target, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
    fs.writeFileSync(path.join(target, 'component.json'), JSON.stringify(manifest, null, 2));
    // Never activate a partial package. No post-install command is executed.
    let active = {};
    try {
      active = JSON.parse(fs.readFileSync(this.activeFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    atomicJson(this.activeFile, {
      ...active,
      [manifest.id]: path.relative(this.root, target),
      disabled: { ...active.disabled, [manifest.id]: false },
    });
    return { id: manifest.id, version: manifest.version, directory: target };
  }
}
