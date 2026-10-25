import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ComponentStore, validateManifest } from '../components.mjs';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const manifest = () => ({
  manifestVersion: 1,
  id: 'wdh',
  version: '0.1.0',
  apiVersion: 1,
  entrypoint: 'src/cli.mjs',
  platform: process.platform,
  arch: process.arch,
  files: [{ path: 'src/cli.mjs', size: 2, sha256: sha('ok') }],
});
test('component manifest rejects ambiguous paths, API mismatch, duplicates and unchecked entrypoint', () => {
  for (const mutate of [
    (m) => (m.apiVersion = 2),
    (m) => (m.entrypoint = '../cli.mjs'),
    (m) => m.files.push(m.files[0]),
    (m) => (m.files[0].path = 'component.json'),
    (m) => (m.files[0].path = 'src/../cli.mjs'),
    (m) => (m.files[0].size = -1),
  ]) {
    const m = manifest();
    mutate(m);
    assert.throws(() => validateManifest(m));
  }
});
test('local component install is checked before activation and entry tampering is detected', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'decrypthub-components-'));
  t.after(() => {
    if (path.dirname(base) === os.tmpdir() && path.basename(base).startsWith('decrypthub-components-'))
      fs.rmSync(base, { recursive: true, force: true });
  });
  const source = path.join(base, 'source');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.writeFileSync(path.join(source, 'src/cli.mjs'), 'ok');
  fs.writeFileSync(path.join(source, 'component.json'), JSON.stringify(manifest()));
  const store = new ComponentStore(path.join(base, 'app'));
  assert.equal(store.info().installed, false);
  const installed = store.installLocal(source);
  assert.equal(store.resolve().version, '0.1.0');
  const pointer = fs.readFileSync(store.activeFile, 'utf8');
  fs.writeFileSync(path.join(source, 'src/cli.mjs'), 'xx');
  assert.throws(() => store.installLocal(source), /checksum/);
  assert.equal(fs.readFileSync(store.activeFile, 'utf8'), pointer);
  fs.writeFileSync(path.join(installed.directory, 'src/cli.mjs'), 'xx');
  assert.equal(store.info().installed, false);
});
