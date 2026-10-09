/** Measures select-all walk + extraction timing on bloodgulch.map (used to decide if fine-grained mid-tag cancellation is worth the complexity). Not part of the test suite - run manually with `yarn tsx scripts/bench-extract.ts`. */
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies } from '../src/map/dependency-walker';
import { extractTagSet } from '../src/map/tag-extractor';
import { sampleMapPath, hasSampleMap } from '../tests/helpers/sample-maps';
import * as fs from 'fs';

if (!hasSampleMap('bloodgulch.map')) {
  console.log('bloodgulch.map not found - set SAMPLE_MAPS_DIR or see core/README.md');
  process.exit(1);
}

const buffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
const inspected = inspectCustomEditionMap(buffer);
if (inspected.status !== 'ok') throw new Error('map did not parse');
const { header, tagIndex } = inspected;

const allIndices = tagIndex.entries.map((e) => e.index);
console.log(`Total tags in map: ${allIndices.length}`);

let t0 = performance.now();
const walk = walkDependencies(buffer, header, tagIndex, allIndices);
let t1 = performance.now();
console.log(`walkDependencies (select-all, ${allIndices.length} roots): ${(t1 - t0).toFixed(1)}ms, visited ${walk.tags.length} internal + ${walk.externalTags.length} external, ${walk.warnings.length} warnings`);

t0 = performance.now();
const set = extractTagSet(buffer, header, tagIndex, allIndices);
t1 = performance.now();
console.log(`extractTagSet (select-all, ${allIndices.length} roots): ${(t1 - t0).toFixed(1)}ms, wrote ${set.tags.length} tags, skipped ${set.notExtracted.length} (BSP)`);

const totalBytes = set.tags.reduce((sum, t) => sum + t.data.length, 0);
console.log(`Total extracted bytes: ${totalBytes} (${(totalBytes / 1024).toFixed(1)} KB)`);
console.log(`Average per-tag extraction time: ${((t1 - t0) / set.tags.length).toFixed(3)}ms/tag`);
