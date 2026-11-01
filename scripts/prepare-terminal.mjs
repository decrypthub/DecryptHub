import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function prepareTerminal(root = fileURLToPath(new URL('..', import.meta.url)), platform = process.platform) {
  const source = path.join(root, 'sidecar/node_modules/node-pty'), dest = path.join(root, 'build/resources/terminal/node_modules/node-pty');
  fs.mkdirSync(path.join(root, 'build/resources/terminal'), { recursive: true });
  fs.copyFileSync(path.join(root, 'sidecar/terminal-entry.cjs'), path.join(root, 'build/resources/terminal/terminal-entry.cjs'));
  for (const entry of ['package.json', 'LICENSE', 'lib']) { fs.mkdirSync(dest, { recursive: true }); fs.cpSync(path.join(source, entry), path.join(dest, entry), { recursive: true }); }
  fs.mkdirSync(path.join(dest, 'deps/winpty'), { recursive: true }); fs.copyFileSync(path.join(source, 'deps/winpty/LICENSE'), path.join(dest, 'deps/winpty/LICENSE'));
  const prebuilt = 'prebuilds/' + platform + '-' + process.arch;
  const native = fs.existsSync(path.join(source, prebuilt)) ? prebuilt : 'build/Release';
  if (!fs.existsSync(path.join(source, native))) throw Error('PTY原生组件缺失。请执行 npm --prefix sidecar rebuild node-pty 后重新打包');
  const target = path.join(dest, native); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(source, native), target, { recursive: true, filter: p => !/\.(?:pdb|obj|lib|exp)$/i.test(p) });
  return dest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('Terminal resources: ' + prepareTerminal());
