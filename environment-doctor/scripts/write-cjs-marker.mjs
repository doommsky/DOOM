// 1) The package is "type": "module" for Vite; compiled main code is CommonJS → mark dist-electron as commonjs.
// 2) Sandboxed preloads may only require('electron'), so the preload is bundled into one self-contained file.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

fs.writeFileSync(new URL('../dist-electron/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
await build({
  entryPoints: [fileURLToPath(new URL('../src/electron/preload.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist-electron/electron/preload.js', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], logLevel: 'warning',
});
console.log('dist-electron: commonjs marker + bundled sandboxed preload');
