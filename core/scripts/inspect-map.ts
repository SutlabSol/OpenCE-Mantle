/**
 * Developer-only CLI for inspecting a real .map file against the /core parser.
 * NOT part of the shipped GUI app (per project brief: "The shipped app is GUI-only").
 *
 * Usage:
 *   yarn build && node scripts/inspect-map.js /path/to/bloodgulch.map
 */
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/index';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/inspect-map.js <path-to-map>');
  process.exit(1);
}

const buffer = fs.readFileSync(path);
const result = inspectCustomEditionMap(buffer);

if (result.status === 'unsupported') {
  console.log(`UNSUPPORTED: ${result.message}`);
} else if (result.status === 'compressed') {
  console.log('This map is compressed (Chimera marker detected). Decompress support is Milestone 2.');
} else {
  const { header, tagIndex } = result;
  console.log(`Scenario:    ${header.scenarioName}`);
  console.log(`Build:       ${header.buildString}`);
  console.log(`Map type:    ${header.mapType}`);
  console.log(`CRC32:       0x${header.crc32.toString(16)}`);
  console.log(`Tag data:    offset=0x${header.tagDataOffset.toString(16)} size=${header.tagDataSize}`);
  console.log(`Decomp size: ${header.decompressedFileSize} (actual file: ${buffer.length})`);
  console.log(`Tag count:   ${tagIndex.tagCount}`);
  console.log(`External tags (resource maps): ${tagIndex.entries.filter((e) => e.isExternal).length}`);
  console.log('First 15 tags:');
  for (const e of tagIndex.entries.slice(0, 15)) {
    console.log(`  [${e.index}] ${e.primaryClassName}\t${e.path}${e.isExternal ? '  (external)' : ''}`);
  }
}
