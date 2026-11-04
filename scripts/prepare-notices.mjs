import fs from 'node:fs';
import path from 'node:path';
export function prepareNotices(root) {
  const destination = path.join(root, 'build/resources/notices'), receipt = [];
  fs.mkdirSync(destination, { recursive: true });
  const inspect = directory => {
    if (receipt.length >= 1000 || fs.lstatSync(directory).isSymbolicLink()) throw Error('依赖许可目录异常');
    const manifest = path.join(directory, 'package.json'); if (!fs.existsSync(manifest)) return;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')), target = path.join(destination, String(pkg.name).replace(/[^a-zA-Z0-9_.-]/g, '_') + '-' + pkg.version);
    const notices = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(entry.name));
    fs.mkdirSync(target, { recursive: true });
    for (const notice of notices) fs.copyFileSync(path.join(directory, notice.name), path.join(target, notice.name));
    if (pkg.name?.startsWith('@earendil-works/pi-')) fs.copyFileSync(path.join(root, 'docs/licenses/pi-ai-MIT.txt'), path.join(target, 'LICENSE'));
    if (pkg.name === '@xterm/headless') fs.copyFileSync(path.join(root, 'docs/licenses/xterm-MIT.txt'), path.join(target, 'LICENSE'));
    receipt.push({ name: pkg.name, version: pkg.version, license: pkg.license || null });
    const nested = path.join(directory, 'node_modules'); if (fs.existsSync(nested)) collect(nested);
  };
  const collect = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const folder = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) { for (const child of fs.readdirSync(folder, { withFileTypes: true })) if (child.isDirectory()) inspect(path.join(folder, child.name)); }
      else inspect(folder);
    }
  };
  collect(path.join(root, 'sidecar/node_modules'));
  fs.writeFileSync(path.join(destination, 'dependency-licenses.json'), JSON.stringify(receipt, null, 2));
  fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(destination, 'THIRD_PARTY_NOTICES.md'));
  fs.copyFileSync(path.join(root, 'docs/licenses/deepseek-harness-MIT.txt'), path.join(destination, 'deepseek-harness-MIT.txt'));
}
