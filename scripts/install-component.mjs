// Explicit local developer installation; signed remote catalogs are a separate trust path.
import { ComponentStore } from '../sidecar/components.mjs';
import { userDataDir } from '../sidecar/settings.mjs';
const argv = process.argv.slice(2),
  from = argv.indexOf('--from');
if (from < 0 || !argv[from + 1] || !argv.includes('--allow-local'))
  throw Error('Usage: node scripts/install-component.mjs --from <built component directory> --allow-local');
const result = new ComponentStore(userDataDir()).installLocal(argv[from + 1]);
console.log('Installed WDH ' + result.version + '. Restart the desktop host to load its tools.');
