// Normal user integrity for this project's own executable artifacts; never touch the workspace label.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuildExecutable } from '../sidecar/windows-runtime.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
export async function prepareWindowsArtifacts(kind = 'all') {
  if (process.platform !== 'win32') return;
  const files = [];
  if (['desktop', 'all'].includes(kind)) files.push(['src-tauri/target/debug/jsra-tauri.exe', 'src-tauri/target']);
  if (['sidecar', 'all'].includes(kind)) files.push(['build/resources/node/node.exe', 'build'], ['build/jsra-sidecar.exe', 'build']);
  for (const [relative, parent] of files) if (fs.existsSync(path.join(root, relative))) {
    const result = await prepareBuildExecutable(path.join(root, relative), path.join(root, parent));
    console.log('Windows runtime ' + relative + ': ' + (result.changed ? 'restored normal user integrity' : 'normal user integrity'));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareWindowsArtifacts(process.argv[2]);
