/**
 * Developer-only CLI: scans a real .map file for any bitmap/sound tag whose pixel or sample
 * data is EMBEDDED in this map's own raw-data region (external=0), as opposed to living in
 * bitmaps.map/sounds.map (external=1). Reuses `walkDependencies`'s existing `embeddedRawData`
 * detection (dependency-walker.ts) - no separate parsing logic, so results match what the
 * injector's relocation guard would see.
 *
 * Usage:
 *   yarn build && node scripts/scan-embedded-data.js /path/to/some.map
 */
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies } from '../src/map/dependency-walker';

const mapPath = process.argv[2];
if (!mapPath) {
  console.error('Usage: node scripts/scan-embedded-data.js <path-to-map>');
  process.exit(1);
}

const buffer = fs.readFileSync(mapPath);
const result = inspectCustomEditionMap(buffer);
if (result.status !== 'ok') {
  console.error(`Cannot scan: ${result.status}`);
  process.exit(1);
}
const { header, tagIndex } = result;

const bitmapSoundIndices = tagIndex.entries
  .filter((e) => !e.isExternal && (e.primaryClassName === 'bitmap' || e.primaryClassName === 'sound'))
  .map((e) => e.index);

console.log(`${mapPath}: ${bitmapSoundIndices.length} non-external bitmap/sound tags to check.`);

const walk = walkDependencies(buffer, header, tagIndex, bitmapSoundIndices);

const embedded = walk.warnings.filter((w) => w.kind === 'embeddedRawData');
const external = walk.warnings.filter((w) => w.kind === 'externalData' && (w.resourceMap === 'bitmaps.map' || w.resourceMap === 'sounds.map'));

console.log(`External (resource-map) bitmap/sound data fields found: ${external.length}`);
console.log(`EMBEDDED (external=0, raw bytes in this map) bitmap/sound data fields found: ${embedded.length}`);

if (embedded.length > 0) {
  console.log('\n--- EMBEDDED entries (real evidence) ---');
  for (const w of embedded) {
    console.log(`  tag[${w.originalIndex}] "${w.path}" -> ${w.size} bytes at file offset ${w.fileOffset} (resourceMap field: ${w.resourceMap})`);
  }
} else {
  console.log('\nNo embedded bitmap/sound data fields found in this map.');
}
