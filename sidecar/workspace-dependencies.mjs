// Offline, relocatable authoring runtime. DSH tool-workspace-dependencies semantics.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { bundledResource } from './bundled-resources.mjs';
import { resolveIn } from './paths.mjs';
import { prepareBuildExecutable } from './windows-runtime.mjs';
const preparations = new Map();
export function dependencyPaths(root, manifest) {
  if (manifest.platform !== process.platform || manifest.arch !== process.arch || !/^\d+\.\d+\.\d+$/.test(manifest.python || '') || !manifest.pythonPackages || typeof manifest.pythonPackages !== 'object') throw Error('内置运行资源与当前平台不兼容');
  const deps = path.join(root, 'dependencies'), windows = manifest.platform === 'win32';
  return { python: path.join(deps, 'python', windows ? 'python.exe' : 'bin/python3'), node: path.join(deps, 'node/bin', windows ? 'node.exe' : 'node'), pnpm: path.join(deps, 'pnpm/bin/pnpm.mjs'),
    pythonPackages: path.join(deps, 'python', windows ? 'Lib' : 'lib/python' + manifest.python.split('.').slice(0,2).join('.'), 'site-packages'), nodePackages: path.join(deps, 'node/node_modules'), pythonDistributions: manifest.pythonPackages,
    versions: { python: manifest.python, node: manifest.node, pnpm: manifest.pnpm, source: 'verified-bundled-manifest' } };
}
export async function loadWorkspaceDependencies(dataDir, { signal, source = bundledResource('primary-runtime') } = {}) {
  if (!source) throw Error('此安装缺少内置 Python 和文档库，请安装完整发行包');
  signal?.throwIfAborted();
  const target = resolveIn(dataDir, 'runtimes/primary-runtime');
  let pending = preparations.get(target);
  if (!pending) {
    pending = (async () => {
      const manifest = JSON.parse(await fsp.readFile(path.join(source, 'runtime.json'), 'utf8')); dependencyPaths(source, manifest);
      let current; try { current = JSON.parse(await fsp.readFile(path.join(target, 'runtime.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current?.payloadDigest !== manifest.payloadDigest) {
        const parent = path.dirname(target); await fsp.mkdir(parent, { recursive: true });
        const stage = resolveIn(parent, '.primary-runtime-' + crypto.randomUUID()), previous = resolveIn(parent, '.primary-runtime-previous-' + crypto.randomUUID());
        await fsp.cp(source, stage, { recursive: true, errorOnExist: true, force: false });
        if (process.platform === 'win32') for (const relative of ['dependencies/python/python.exe', 'dependencies/node/bin/node.exe']) {
          const expected = crypto.createHash('sha256').update(await fsp.readFile(resolveIn(source, relative))).digest('hex');
          const actual = crypto.createHash('sha256').update(await fsp.readFile(resolveIn(stage, relative))).digest('hex');
          if (expected !== actual) throw Error('内置解释器复制校验失败');
          await prepareBuildExecutable(resolveIn(stage, relative), stage);
        }
        try { if (current) await fsp.rename(target, previous); await fsp.rename(stage, target); }
        catch (error) { if (current && !fs.existsSync(target) && fs.existsSync(previous)) await fsp.rename(previous, target); throw error; }
      }
      const paths = dependencyPaths(target, manifest);
      for (const key of ['python','node','pnpm','pythonPackages','nodePackages']) { const info = await fsp.lstat(paths[key]); if (!(key.endsWith('Packages') ? info.isDirectory() : info.isFile())) throw Error('运行资源不是预期文件：' + key); }
      return paths;
    })().catch(error => { preparations.delete(target); throw error; }); preparations.set(target, pending);
  }
  const result = await pending; signal?.throwIfAborted(); return result;
}
export const WORKSPACE_DEPENDENCY_TOOLS = [{ name: 'load_workspace_dependencies', description: '获取内置 Python、Node、pnpm 和文档/表格/演示文稿库的绝对路径及固定版本。首次离线准备，不改 PATH，不使用机器上碰巧安装的库。pnpm 通过返回的 Node 执行；工作区或用户指定其他环境时遵循其要求。',
  schema: { type: 'object', properties: {}, additionalProperties: false }, run: async (_args, ctx) => ({ text: JSON.stringify(await loadWorkspaceDependencies(ctx.protectedRoot, { signal: ctx.signal })) }) }];
