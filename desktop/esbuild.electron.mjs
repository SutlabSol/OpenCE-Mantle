// Bundles the Electron main/preload/worker entry points into dist-electron/*.js.
// core/src is imported directly and inlined here (no runtime dependency on a separate
// "core" folder/package) - this is what fixes the packaged-app "Cannot find module
// '../../core/dist/index'" error: that relative path only ever existed in dev, and core/
// was never part of the electron-builder package. @mongodb-js/zstd is a native addon and
// can't be bundled, so it's marked external and must be a real dependency of this
// package.json (it is) so electron-builder packages + rebuilds it for Electron's ABI.
import { build } from 'esbuild';

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/map-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outdir: 'dist-electron',
  external: ['electron', '@mongodb-js/zstd'],
  sourcemap: true,
  logLevel: 'info',
});
