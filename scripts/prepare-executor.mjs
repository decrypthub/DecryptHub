import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function prepareExecutor(root = fileURLToPath(new URL('..', import.meta.url))) {
  const sc = path.join(root, 'sidecar'), dest = path.join(root, 'build', 'resources', 'executor');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(sc, 'sandbox-entry.mjs'), path.join(dest, 'sandbox-entry.mjs'));
  for (const name of ['@anthropic-ai/sandbox-runtime', '@pondwader/socks5-server', 'commander', 'node-forge']) {
    const source = path.join(sc, 'node_modules', name), target = path.join(dest, 'node_modules', name);
    if (!fs.existsSync(source)) throw new Error('缺少执行隔离依赖，请先在 sidecar 下运行 npm ci：' + name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(source, target, { recursive: true });
  }
  return dest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('Executor resources: ' + prepareExecutor());
