import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function prepareSearch(root = fileURLToPath(new URL('..', import.meta.url)), platform = process.platform) {
  const name = platform === 'win32' ? 'rg.exe' : 'rg';
  const source = path.join(root, 'sidecar/node_modules/@vscode', `ripgrep-${platform}-${process.arch}`);
  const dest = path.join(root, 'build/resources/search');
  if (!fs.existsSync(path.join(source, 'bin', name))) throw Error('目标平台的搜索运行组件缺失，请安装 @vscode/ripgrep-' + platform + '-' + process.arch);
  fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(path.join(source, 'bin', name), path.join(dest, name));
  fs.copyFileSync(path.join(root, 'sidecar/node_modules/@vscode/ripgrep/LICENSE'), path.join(dest, 'LICENSE-vscode-ripgrep'));
  if (fs.existsSync(path.join(source, 'LICENSE'))) fs.copyFileSync(path.join(source, 'LICENSE'), path.join(dest, 'LICENSE-ripgrep'));
  if (platform !== 'win32') fs.chmodSync(path.join(dest, name), 0o755);
  return dest;
}
