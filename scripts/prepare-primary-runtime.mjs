// Pinned DSH interpreter/library inputs, materialized in the owned build tree.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from '../sidecar/node_modules/fflate/esm/index.mjs';
import { resolveIn } from '../sidecar/paths.mjs';
import { prepareBuildExecutable } from '../sidecar/windows-runtime.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'resources/primary-runtime.lock.json')));
const cache = path.join(root, '.tmp/primary-runtime-downloads'), output = path.join(root, 'build/resources/primary-runtime');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function download(url, expected, algorithm = 'sha256') {
  fs.mkdirSync(cache, { recursive: true }); const file = path.join(cache, expected);
  let bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!bytes) { console.log('Downloading ' + new URL(url).hostname + '/' + path.basename(new URL(url).pathname)); const response = await fetch(url, { signal: AbortSignal.timeout(300000) }); if (!response.ok) throw Error('Download ' + response.status + ': ' + url); bytes = Buffer.from(await response.arrayBuffer()); }
  if (crypto.createHash(algorithm).update(bytes).digest('hex') !== expected) throw Error('Runtime payload checksum mismatch: ' + url);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' }); return file;
}
function unzip(archive, directory, { strip = '' } = {}) {
  for (const [name, bytes] of Object.entries(unzipSync(fs.readFileSync(archive)))) {
    const relative = strip && name.startsWith(strip) ? name.slice(strip.length) : strip ? null : name;
    if (!relative || relative.endsWith('/')) continue;
    const [first, scheme] = relative.split('/'); if (first.endsWith('.data') && scheme !== 'scripts') throw Error('Unsupported wheel installation scheme');
    const file = resolveIn(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
  }
}
export async function preparePrimaryRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Prepare the pinned primary runtime on the Windows x64 release host');
  const digest = hash(JSON.stringify({ lock, pnpm: '12.16.1', format: 1 }));
  if (fs.existsSync(path.join(output, 'runtime.json')) && JSON.parse(fs.readFileSync(path.join(output, 'runtime.json'))).payloadDigest === digest) return output;
  const stage = path.join(root, 'build/resources/.primary-runtime-' + crypto.randomUUID()), deps = path.join(stage, 'dependencies'); fs.mkdirSync(deps, { recursive: true });
  const target = lock.targets['win-x64'], pythonName = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${target.pythonTarget}-install_only_stripped.tar.gz`;
  const python = await download(`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(pythonName)}`, target.pythonSha256);
  execFileSync(path.join(process.env.SystemRoot, 'System32/tar.exe'), ['-xzf', python, '-C', deps], { windowsHide: true, timeout: 120000 });
  const packages = path.join(deps, 'python/Lib/site-packages');
  for (const wheel of [...target.wheels, ...lock.wheels]) unzip(await download(wheel.url, wheel.sha256), packages);
  const nodeName = `node-v${lock.nodeVersion}-win-x64.zip`, nodeArchive = await download(`https://nodejs.org/dist/v${lock.nodeVersion}/${nodeName}`, target.nodeSha256);
  unzip(nodeArchive, path.join(deps, 'node'), { strip: nodeName.slice(0, -4) + '/' });
  fs.mkdirSync(path.join(deps, 'node/bin')); fs.renameSync(path.join(deps, 'node/node.exe'), path.join(deps, 'node/bin/node.exe')); fs.mkdirSync(path.join(deps, 'node/node_modules'), { recursive: true });
  const npmLockFile = path.join(root, 'resources/pnpm-runtime.lock.json');
  let npmLock;
  if (fs.existsSync(npmLockFile)) npmLock = JSON.parse(fs.readFileSync(npmLockFile));
  else { const response = await fetch('https://registry.npmjs.org/pnpm/12.16.1'); if (!response.ok) throw Error('pnpm metadata download failed'); const metadata = await response.json(); npmLock = { name: metadata.name, version: metadata.version, ...metadata.dist }; fs.writeFileSync(npmLockFile, JSON.stringify(npmLock, null, 2) + '\n', { flag: 'wx' }); }
  if (npmLock.name !== 'pnpm' || npmLock.version !== '12.16.1' || !npmLock.integrity?.startsWith('sha512-')) throw Error('pnpm runtime lock invalid');
  const pnpm = await download(npmLock.tarball, Buffer.from(npmLock.integrity.slice(7), 'base64').toString('hex'), 'sha512');
  fs.mkdirSync(path.join(deps, 'pnpm')); execFileSync(path.join(process.env.SystemRoot, 'System32/tar.exe'), ['-xzf', pnpm, '--strip-components=1', '-C', path.join(deps, 'pnpm')], { windowsHide: true, timeout: 120000 });
  const manifest = { desktopVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, platform: 'win32', arch: 'x64', payloadDigest: digest, python: lock.pythonVersion, node: lock.nodeVersion, pnpm: npmLock.version, pythonPackages: lock.pythonPackages };
  fs.writeFileSync(path.join(stage, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
  await prepareBuildExecutable(path.join(deps, 'python/python.exe'), stage); await prepareBuildExecutable(path.join(deps, 'node/bin/node.exe'), stage);
  const actual = JSON.parse(execFileSync(path.join(deps, 'python/python.exe'), ['-I', '-B', '-c', 'import json,importlib.metadata as m; import numpy,pandas,docx,pptx,openpyxl,PIL,lxml,xlsxwriter; print(json.dumps({d.metadata["Name"]:d.version for d in m.distributions()}))'], { encoding: 'utf8', windowsHide: true, timeout: 120000 }));
  for (const [name, version] of Object.entries(lock.pythonPackages)) if (actual[name] !== version && !Object.entries(actual).some(([key, value]) => key.toLowerCase().replaceAll('_','-') === name.toLowerCase().replaceAll('_','-') && value === version)) throw Error('Python distribution version mismatch: ' + name);
  const previous = path.join(root, '.tmp/primary-runtime-previous-' + crypto.randomUUID()); if (fs.existsSync(output)) { fs.renameSync(output, previous); }
  try { fs.renameSync(stage, output); } catch (error) { if (fs.existsSync(previous) && !fs.existsSync(output)) fs.renameSync(previous, output); throw error; }
  console.log('Primary runtime prepared and verified: ' + output); return output;
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await preparePrimaryRuntime();
