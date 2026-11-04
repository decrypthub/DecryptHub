// Normal user integrity for this project's own executable artifacts; never touch the workspace label.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuildExecutable } from '../sidecar/windows-runtime.mjs';
import { containsPath } from '../sidecar/paths.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
export async function prepareWindowsArtifacts(kind = 'all') {
  if (process.platform !== 'win32') return;
  const files = [];
  if (['desktop', 'all'].includes(kind)) {
    const target = path.resolve(root, process.env.CARGO_TARGET_DIR || 'src-tauri/target');
    if (!containsPath(root, target) || path.resolve(root) === target) throw Error('Desktop build target must be a dedicated directory inside this workspace');
    files.push([path.join(target, 'debug/jsra-tauri.exe'), target]);
  }
  if (['sidecar', 'all'].includes(kind)) files.push([path.join(root, 'build/resources/node/node.exe'), path.join(root, 'build')], [path.join(root, 'build/jsra-sidecar.exe'), path.join(root, 'build')], [path.join(root, 'build/resources/search/rg.exe'), path.join(root, 'build')]);
  if (['sidecar', 'all'].includes(kind)) {
    // PTY helpers are executable child processes too. A newly copied helper may
    // inherit a low directory label even when the source helper was provisioned.
    const terminal = path.join(root, 'build/resources/terminal');
    if (fs.existsSync(terminal)) for (const relative of fs.readdirSync(terminal, { recursive: true })) {
      if (relative.toLowerCase().endsWith('.exe')) files.push([path.join(terminal, relative), path.join(root, 'build')]);
    }
  }
  for (const [file, parent] of files) if (fs.existsSync(file)) {
    const result = await prepareBuildExecutable(file, parent);
    console.log('Windows runtime ' + path.relative(root, file) + ': ' + (result.changed ? 'restored normal user integrity' : 'normal user integrity'));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareWindowsArtifacts(process.argv[2]);
