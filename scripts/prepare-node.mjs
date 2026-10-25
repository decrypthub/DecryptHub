import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractZip } from '../sidecar/zip.mjs';
import { prepareWindowsArtifacts } from './prepare-windows-runtime.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const version = 'v24.16.0',
  name = `node-${version}-win-x64.zip`;
const base = `https://nodejs.org/dist/${version}/`;
const fetchOk = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download failed (${response.status}): ${url}`);
  return response;
};
const sums = await (await fetchOk(base + 'SHASUMS256.txt')).text();
const expected = sums
  .split(/\r?\n/)
  .find((line) => line.endsWith('  ' + name))
  ?.split(/\s+/)[0];
if (!expected) throw Error('Official Node checksum missing');
const bytes = Buffer.from(await (await fetchOk(base + name)).arrayBuffer());
if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected)
  throw Error('Node checksum mismatch');
const stage = path.join(root, 'build', 'node-' + crypto.randomUUID());
fs.mkdirSync(stage, { recursive: true });
const zip = path.join(stage, name);
fs.writeFileSync(zip, bytes);
await extractZip(zip, { dir: stage });
const destination = path.join(root, 'build/resources/node');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(stage, `node-${version}-win-x64`), destination, { recursive: true });
await prepareWindowsArtifacts('sidecar');
console.log('Official Node ' + version + ' installed with SHA-256 verification.');
