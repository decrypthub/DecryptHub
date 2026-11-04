import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { prepareBuildExecutable } from '../sidecar/windows-runtime.mjs';
export async function prepareOffice(root = fileURLToPath(new URL('..', import.meta.url))) {
  const output = path.join(root, 'build/resources/office'), stage = path.join(root, '.tmp/office-build-' + crypto.randomUUID());
  const copied = new Set();
  function copy(name, origin) {
    if (copied.has(name)) return;
    const require = createRequire(path.join(origin, 'package.json')); let manifestFile;
    try { manifestFile = require.resolve(name + '/package.json'); }
    catch { let candidate = path.dirname(require.resolve(name)); while (!fs.existsSync(path.join(candidate, 'package.json')) || JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'))).name !== name) { const parent = path.dirname(candidate); if (candidate === parent) throw Error('Office dependency identity missing: ' + name); candidate = parent; } manifestFile = path.join(candidate, 'package.json'); }
    const source = path.dirname(manifestFile), manifest = JSON.parse(fs.readFileSync(manifestFile));
    if (manifest.name !== name) throw Error('Office dependency identity mismatch');
    const destination = path.join(stage, 'node_modules', name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.cpSync(source, destination, { recursive: true, dereference: true }); copied.add(name);
    for (const dependency of Object.keys(manifest.dependencies || {})) copy(dependency, source);
    for (const dependency of Object.keys(manifest.optionalDependencies || {})) {
      try { copy(dependency,source); } catch(error) { if(error.code!=='MODULE_NOT_FOUND')throw error; }
    }
  }
  copy('@deepseek-ai/libreoffice-kit', path.join(root, 'sidecar'));
  const engine = '@deepseek-ai/libreoffice-kit-' + process.platform + '-' + process.arch; copy(engine, path.join(root, 'sidecar'));
  if(process.platform==='win32')await prepareBuildExecutable(path.join(stage,'node_modules',engine,'bin/libreoffice-kit.exe'),stage);
  fs.writeFileSync(path.join(stage, 'SOURCE.md'), '# Office runtime\n\nUnmodified @deepseek-ai/libreoffice-kit 0.1.5 and matching native engine. MPL-2.0 source: https://github.com/deepseek-ai/dsh-libreoffice-kit . Package NOTICE and all bundled third-party notices are retained.\n');
  if (fs.existsSync(output)) fs.renameSync(output, path.join(root, '.tmp/office-previous-' + crypto.randomUUID())); fs.renameSync(stage, output);
  fs.cpSync(path.join(root, 'resources/office-skills'), path.join(root, 'build/resources/office-skills'), { recursive: true });
  return { output, packages: copied.size };
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) console.log(await prepareOffice());
