/**
 * Developer-only CLI (read-only, map-agnostic, no logic keyed to a specific map name/path/size
 * per RULES.md): reports `modelDataFileOffset`/`tagDataOffset` alignment across every real
 * sample map, to settle the embedded-relocation padding decision (preserve the target's own
 * alignment vs force 4-byte). Writes nothing.
 *
 * Usage: yarn tsx scripts/check-alignment.ts [sample_maps_dir]
 */
import * as fs from 'fs';
import * as path from 'path';
import { inspectCustomEditionMap } from '../src/map/open-map';

const dir = process.argv[2] ?? path.resolve(__dirname, '../../sample_maps');
const candidates = ['bloodgulch.map', 'ui.map', 'sidewinder.map', 'coldsnap.map', 'Yoyorast_Island.map'];
const extra = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.map') && !candidates.includes(f) && !['bitmaps.map', 'sounds.map', 'loc.map'].includes(f)) : [];
const mapNames = [...candidates, ...extra];

const CACHE_FILE_HEADER_SIZE = 0x800; // BSP data start - fixed format constant for every v609 map, see header.ts

interface Row {
  mapName: string;
  buildString: string;
  fileSize: number;
  modelDataFileOffset: number;
  tagDataOffset: number;
}

const rows: Row[] = [];

for (const mapName of mapNames) {
  const p = path.join(dir, mapName);
  if (!fs.existsSync(p)) {
    console.log(`${mapName}: SKIPPED (not found at "${p}")`);
    continue;
  }
  const buffer = fs.readFileSync(p);
  const result = inspectCustomEditionMap(buffer);
  if (result.status !== 'ok') {
    console.log(`${mapName}: SKIPPED (did not parse: ${result.status})`);
    continue;
  }
  rows.push({
    mapName,
    buildString: result.header.buildString,
    fileSize: buffer.length,
    modelDataFileOffset: result.tagIndex.modelDataFileOffset,
    tagDataOffset: result.header.tagDataOffset,
  });
}

function mods(n: number): string {
  return `mod4=${n % 4} mod16=${n % 16} mod4096=${n % 4096}`;
}

console.log('');
console.log('map'.padEnd(22), 'buildString'.padEnd(16), 'fileSize'.padEnd(12), 'bspDataStart'.padEnd(16), 'modelDataFileOffset (= end of embedded region)'.padEnd(52), 'tagDataOffset');
for (const r of rows) {
  console.log(
    r.mapName.padEnd(22),
    r.buildString.padEnd(16),
    String(r.fileSize).padEnd(12),
    `${CACHE_FILE_HEADER_SIZE} (${mods(CACHE_FILE_HEADER_SIZE)})`.padEnd(16),
    `${r.modelDataFileOffset} (${mods(r.modelDataFileOffset)})`.padEnd(52),
    `${r.tagDataOffset} (${mods(r.tagDataOffset)})`,
  );
}

console.log('');
const allModelData4 = rows.every((r) => r.modelDataFileOffset % 4 === 0);
const allModelData16 = rows.every((r) => r.modelDataFileOffset % 16 === 0);
const allTagData4 = rows.every((r) => r.tagDataOffset % 4 === 0);
const allTagData16 = rows.every((r) => r.tagDataOffset % 16 === 0);
const breaks4 = rows.filter((r) => r.modelDataFileOffset % 4 !== 0 || r.tagDataOffset % 4 !== 0).map((r) => r.mapName);
const breaks16 = rows.filter((r) => r.modelDataFileOffset % 16 !== 0 || r.tagDataOffset % 16 !== 0).map((r) => r.mapName);
console.log(`RESULT: 4-byte alignment of modelDataFileOffset+tagDataOffset holds across ALL ${rows.length} maps: ${allModelData4 && allTagData4}. 16-byte alignment holds: ${allModelData16 && allTagData16}.`);
console.log(`Maps breaking 4-byte alignment: ${breaks4.length === 0 ? 'none' : breaks4.join(', ')}.`);
console.log(`Maps breaking 16-byte alignment: ${breaks16.length === 0 ? 'none' : breaks16.join(', ')}.`);
