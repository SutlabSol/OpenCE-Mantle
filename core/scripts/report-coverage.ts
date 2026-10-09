import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { getAllTagGroupNames } from '../src/map/definitions/engine';

const perGroup = new Map<string, number>();
for (const g of getAllTagGroupNames()) perGroup.set(g, 0);

for (const mapName of ['bloodgulch.map', 'ui.map']) {
  const buffer = fs.readFileSync(`/app/sample_maps/${mapName}`);
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
