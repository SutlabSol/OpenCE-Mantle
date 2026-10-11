import * as fs from 'fs';
import * as path from 'path';

/**
 * tests/helpers -> tests -> core -> <repo root> -> sample_maps. Uses `__dirname` (provided by Vitest
 * and tsx) rather than `import.meta.url`, so the desktop tests can import this helper under their
 * CommonJS typecheck.
 */
const DEFAULT_SAMPLE_MAPS_DIR = path.resolve(__dirname, '../../../sample_maps');

/**
 * Sub-folders of the sample maps directory - the ONLY place folder names appear. Custom Edition maps
 * and CE resource maps sit at the root; each other game's maps (and its own resource maps) get a
 * folder, because several share file names (bloodgulch.map, bitmaps.map, ...). Adding a folder is one
 * line here.
 */
export const SAMPLE_FOLDERS = {
  ce: '',
  haloMD: 'HaloMD',
  macDemo: 'MacDemo',
  pc: 'PC',
  xbox: 'xbox',
  mcc: 'MCC',
} as const;
export type SampleFolder = keyof typeof SAMPLE_FOLDERS;

/** The sample name of `file` inside `folder`, for every helper below, e.g. `sampleIn('haloMD', 'heh_2.map')`. */
export function sampleIn(folder: SampleFolder, file: string): string {
  const dir = SAMPLE_FOLDERS[folder];
  return dir ? `${dir}/${file}` : file;
}

/** `SAMPLE_MAPS_DIR` env var wins if set; otherwise `<repo root>/sample_maps`, resolved relative to this file - never an absolute `/app` path, so this works unmodified on Windows. */
export function sampleMapsDir(): string {
  return process.env.SAMPLE_MAPS_DIR ? path.resolve(process.env.SAMPLE_MAPS_DIR) : DEFAULT_SAMPLE_MAPS_DIR;
}

export function sampleMapPath(name: string): string {
  return path.join(sampleMapsDir(), name);
}

export function hasSampleMap(name: string): boolean {
  return fs.existsSync(sampleMapPath(name));
}

export function hasSampleMaps(names: string[]): boolean {
  return names.every(hasSampleMap);
}

/** Lazily reads a sample map; never call this at `describe` scope - only inside `beforeAll`/`it`, so a skipped suite never touches disk. */
export function readSampleMap(name: string): Buffer {
  const p = sampleMapPath(name);
  if (!fs.existsSync(p)) {
    throw new Error(`Sample map "${name}" not found at "${p}". Set SAMPLE_MAPS_DIR or place sample maps there (see core/README.md).`);
  }
  return fs.readFileSync(p);
}

/** One consistent "why was this skipped" message for every suite, naming the missing file(s) and where it looked. */
export function missingSampleMapsMessage(names: string[]): string {
  const missing = names.filter((n) => !hasSampleMap(n));
  return `missing sample map(s) [${missing.join(', ')}] in "${sampleMapsDir()}" - set SAMPLE_MAPS_DIR or see core/README.md`;
}

/**
 * For a single `it()` inside an otherwise-always-collected describe block: tells you whether to
 * skip it and what to append to its title, so the reason (which file, where it looked for it)
 * shows up directly in the Vitest summary instead of a bare "skipped" with no explanation.
 * Only ever calls the cheap `fs.existsSync` check (via `hasSampleMap`) - never reads file
 * contents at describe/module scope, only the `it`/`beforeAll` body does that.
 */
export function skippableTest(names: string[]): { skip: boolean; titleSuffix: string } {
  const missing = names.filter((n) => !hasSampleMap(n));
  if (missing.length === 0) return { skip: false, titleSuffix: '' };
  return { skip: true, titleSuffix: ` [SKIPPED: missing ${missing.join(', ')} in "${sampleMapsDir()}"]` };
}
