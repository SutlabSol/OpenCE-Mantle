import * as fs from 'fs';
import * as path from 'path';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { getAllTagGroupNames } from '../src/map/definitions/engine';

const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR ? path.resolve(process.env.SAMPLE_MAPS_DIR) : path.resolve(__dirname, '../../sample_maps');

const perGroup = new Map<string, number>();
for (const g of getAllTagGroupNames()) perGroup.set(g, 0);

for (const mapName of ['bloodgulch.map', 'ui.map']) {
  const mapPath = path.join(SAMPLE_MAPS_DIR, mapName);
  if (!fs.existsSync(mapPath)) {
    console.log(`Skipping ${mapName}: not found at ${mapPath} (set SAMPLE_MAPS_DIR or see core/README.md)`);
    continue;
  }
  const buffer = fs.readFileSync(mapPath);
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') continue;
  for (const entry of inspected.tagIndex.entries) {
    const group = entry.primaryClassName;
    if (!group || !perGroup.has(group)) continue;
    if (entry.isExternal) continue; // present but not walked/validated (no data in this map)
    perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
  }
}

const tested = [...perGroup.entries()].filter(([, n]) => n > 0).sort();
const untested = [...perGroup.entries()].filter(([, n]) => n === 0).sort((a, b) => a[0].localeCompare(b[0]));

console.log('=== TESTED (group: tag count across bloodgulch.map + ui.map) ===');
for (const [g, n] of tested) console.log(`${g}\t${n}`);
console.log(`\ntotal tested groups: ${tested.length}`);

console.log('\n=== UNTESTED (0 tags in either sample map) ===');
for (const [g] of untested) console.log(g);
console.log(`\ntotal untested groups: ${untested.length}`);
