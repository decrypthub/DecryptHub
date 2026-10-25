import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveIn, atomicJson } from './paths.mjs';

export function validateManifest(manifest, { development = false } = {}) {
  if (
    manifest?.manifestVersion !== 1 ||
    manifest.id !== 'wdh' ||
    manifest.apiVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version || '')
  )
    throw Error('Incompatible WDH component manifest');
  const relative = (value) =>
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    !value.split('/').some((p) => !p || p === '.' || p === '..') &&
    !/[:\0]/.test(value);
  if (!relative(manifest.entrypoint)) throw Error('Invalid component entrypoint');
  if (development && !manifest.files) return manifest;
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
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
  resolve(id = 'wdh') {
    if (id !== 'wdh') throw Error('Unknown component');
    const development = !!process.env.DECRYPTHUB_WDH_DIR && process.env.JSRA_DEV === '1';
    let directory;
    if (development) directory = path.resolve(process.env.DECRYPTHUB_WDH_DIR);
    else {
      let active;
      try {
        active = JSON.parse(fs.readFileSync(resolveIn(this.root, 'active.json'), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      if (!active.wdh) return null;
      if (typeof active.wdh !== 'string' || path.isAbsolute(active.wdh))
        throw Error('Invalid component activation pointer');
      directory = resolveIn(this.root, active.wdh);
    }
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(resolveIn(directory, 'component.json'), 'utf8')),
      { development },
    );
    const entry = resolveIn(directory, manifest.entrypoint);
    if (!fs.statSync(entry).isFile()) throw Error('WDH entrypoint missing');
    // Installed packages are verified in full before activation. Recheck the
    // entrypoint on launch; this is integrity detection, not an OS sandbox.
    if (!development)
      verifyComponentFile(
        directory,
        manifest.files.find((f) => f.path === manifest.entrypoint),
      );
    return { directory, entry, version: manifest.version, apiVersion: manifest.apiVersion };
  }
  info() {
    try {
      const active = this.resolve();
      return { id: 'wdh', installed: !!active, version: active?.version || null, apiVersion: 1 };
    } catch (error) {
      return { id: 'wdh', installed: false, error: error.message };
    }
  }
  installLocal(source) {
    source = path.resolve(source);
    const manifest = validateManifest(
      JSON.parse(fs.readFileSync(resolveIn(source, 'component.json'), 'utf8')),
    );
    const target = path.join(this.root, 'versions', 'wdh-' + manifest.version + '-' + crypto.randomUUID());
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
    atomicJson(this.activeFile, { ...active, wdh: path.relative(this.root, target) });
    return { version: manifest.version, directory: target };
  }
}
