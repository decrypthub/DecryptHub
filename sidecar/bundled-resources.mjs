import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export function bundledResource(name) {
  for (const base of [path.join(here, '..'), path.join(here, '../resources'), path.join(here, '../build/resources')]) {
    const candidate = path.join(base, name); if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
export function officeRuntime() {
  const cli = [bundledResource('office/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js'), path.join(here, 'node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js')].find(file => file && fs.existsSync(file));
  const node = bundledResource('node/node.exe') || process.execPath;
  return cli ? { node, cli } : null;
}
