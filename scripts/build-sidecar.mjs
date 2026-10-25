import fs from 'node:fs';
import path from 'node:path';
import { prepareExecutor } from './prepare-executor.mjs';
import { prepareWindowsArtifacts } from './prepare-windows-runtime.mjs';
if (typeof Bun === 'undefined' || Bun.version !== '1.4.4')
  throw Error('Use npx --yes bun@1.4.4 scripts/build-sidecar.mjs win|linux');
const root = path.resolve(import.meta.dir, '..');
const which = process.argv[2] || 'win';
if (!['win', 'linux'].includes(which)) throw Error('Choose win or linux');
prepareExecutor(root);
const output = path.join(root, 'build');
const common = {
  entrypoints: [path.join(root, 'sidecar/index.mjs')],
  minify: { syntax: true, whitespace: true },
  define: { 'process.env.NODE_ENV': '"production"' },
};
const result = await Bun.build(
  which === 'win'
    ? {
        ...common,
        target: 'node',
        format: 'esm',
        outdir: path.join(output, 'resources/sidecar'),
        naming: 'main.mjs',
      }
    : {
        ...common,
        compile: {
          target: 'bun-linux-x64',
          outfile: path.join(output, 'jsra-sidecar-linux'),
          autoloadDotenv: false,
          autoloadBunfig: false,
          autoloadTsconfig: false,
          autoloadPackageJson: false,
        },
      },
);
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
const file = path.join(output, which === 'win' ? 'resources/sidecar/main.mjs' : 'jsra-sidecar-linux');
const bytes = fs.readFileSync(file);
for (const forbidden of [root, '@zhizhuodemao/patchright', 'js-reverse-core']) {
  if (bytes.includes(forbidden))
    throw Error('Core bundle contains a browser dependency or build path: ' + forbidden);
}
await prepareWindowsArtifacts('sidecar');
console.log(
  'DecryptHub core built: ' + (bytes.length / 1e6).toFixed(1) + ' MB; WDH is an optional external component.',
);
