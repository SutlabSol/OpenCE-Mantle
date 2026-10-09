import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** tests/helpers -> tests -> core -> <repo root> -> sample_maps */
const DEFAULT_SAMPLE_MAPS_DIR = path.resolve(TEST_FILE_DIR, '../../../sample_maps');

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
