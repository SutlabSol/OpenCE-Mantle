/**
 * Developer-only CLI (NOT part of the shipped app): converts a retail-layout (v7) map whose bitmap
 * and sound data is external into a Custom Edition (609) map, copying that data in from the source
 * game's resource files (converter Phase 1b). Same code and same write path as the app: the
 * checks and conversion of `convertRetailToCustomEdition`, then `writeFinalizedMap` (scenario name
 * from the output file name, CRC32, temp file + rename).
 *
 * An original demo map (true demo layout, version 6: the Mac demo) is detected from its header and
 * converted with `convertDemoToCustomEdition` (converter Phase 2): the tag data is moved to the Custom
 * Edition address first, then the same steps run. Pass the demo's own resource folder.
 *
 * Usage (from core/):
 *   npx tsx scripts/convert-external.ts <source.map> <folder with bitmaps.map and sounds.map> <output.map>
 *     [--acknowledge-scripts]
 *
 * Every REQUIRED tag data repair the checks list (`tag-data-repairs.ts`: what OpenCE's validator
 * refuses) is applied, and each is printed: what it changed, bytes appended, the pointer before and
 * after. Optional repairs are listed but not applied.
 *
 * Never writes into the source map's folder or the resource folder (so never into sample_maps),
 * never over the source or a resource map. Resource maps are read by offset only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { convertRetailToCustomEdition, preflightRetailConversion, ConversionRefusedError } from '../src/map/convert/retail-to-ce';
import { convertDemoToCustomEdition, preflightDemoConversion } from '../src/map/convert/demo-to-ce';
import { classifyMapLayout } from '../src/map/convert/classify';
import type { ConversionCheck, ConversionResourceFiles } from '../src/map/convert/retail-to-ce';
import type { RandomAccessFile } from '../src/map/convert/resource-files';
import { writeFinalizedMap } from '../src/map/write-map';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [sourceArg, resourceArg, outputArg] = args.filter((a) => !a.startsWith('--'));
const known = new Set(['--acknowledge-scripts']);
for (const f of flags) if (!known.has(f)) fail(`Unknown option ${f}.`);
if (!sourceArg || !resourceArg || !outputArg) {
  fail('Usage: npx tsx scripts/convert-external.ts <source.map> <resource folder> <output.map> [--acknowledge-scripts]');
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const source = path.resolve(sourceArg);
const resourceDir = path.resolve(resourceArg);
const output = path.resolve(outputArg);
const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

if (!fs.existsSync(source)) fail(`Source map not found: ${source}`);
if (!fs.existsSync(resourceDir) || !fs.statSync(resourceDir).isDirectory()) fail(`Resource folder not found: ${resourceDir}`);
if (!output.toLowerCase().endsWith('.map')) fail('The output file name must end in .map.');
if (same(output, source)) fail('The output would overwrite the source map.');
for (const name of ['bitmaps.map', 'sounds.map', 'loc.map']) if (same(output, path.join(resourceDir, name))) fail(`The output would overwrite a resource map (${name}).`);
if (same(path.dirname(output), path.dirname(source)) || same(path.dirname(output), resourceDir)) {
  fail('Write the output to another folder than the source map and the resource maps (for example C:\\temp\\opence\\).');
}
if (!fs.existsSync(path.dirname(output))) fail(`The output folder does not exist: ${path.dirname(output)}`);

/** A resource map opened read-only and read by offset. */
function openResource(file: string): { file: RandomAccessFile; close: () => void } | null {
  if (!fs.existsSync(file)) return null;
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  return {
    file: {
      label: file,
      size,
      read(offset, length) {
        const buf = Buffer.alloc(length);
        let done = 0;
        while (done < length) {
          const n = fs.readSync(fd, buf, done, length - done, offset + done);
          if (n === 0) break;
          done += n;
        }
        return done === length ? buf : buf.subarray(0, done);
      },
    },
    close: () => fs.closeSync(fd),
  };
}

function printChecks(checks: ConversionCheck[]) {
  for (const c of checks) {
    const repair = c.repair ? (c.repair.required ? ' (required repair: applied)' : ' (optional repair: not applied)') : '';
    console.log(`[${c.status.toUpperCase()}]${c.requiresAcknowledgement ? ' (needs acknowledgement)' : ''}${repair} ${c.label}: ${c.message}`);
    for (const d of c.details.slice(0, 15)) console.log(`        ${d}`);
    if (c.details.length > 15) console.log(`        ... ${c.details.length - 15} more`);
  }
}

const bitmaps = openResource(path.join(resourceDir, 'bitmaps.map'));
const sounds = openResource(path.join(resourceDir, 'sounds.map'));
try {
  const resources: ConversionResourceFiles = {};
  if (bitmaps) resources.bitmaps = bitmaps.file;
  if (sounds) resources.sounds = sounds.file;

  console.log(`Source:    ${source}`);
  console.log(`Resources: ${resourceDir} (bitmaps.map ${bitmaps ? 'found' : 'MISSING'}, sounds.map ${sounds ? 'found' : 'MISSING'})`);
  console.log(`Output:    ${output}\n`);
  const sourceBytes = fs.readFileSync(source);
  const demo = classifyMapLayout(sourceBytes).kind === 'demo';
  console.log(`Layout:    ${demo ? 'original demo map (version 6): the tag data is moved to the Custom Edition address first' : 'retail layout (version 7) or other'}
`);
  const report = demo ? preflightDemoConversion(sourceBytes, resources) : preflightRetailConversion(sourceBytes, resources);
  printChecks(report.checks);
  if (!report.canConvert) fail('\nThis map is not converted (see the REFUSE rows above).');

  let lastPercent = -1;
  const convert = demo ? convertDemoToCustomEdition : convertRetailToCustomEdition;
  const converted = convert(sourceBytes, {
    acknowledgeScripts: flags.has('--acknowledge-scripts'),
    repairs: Object.fromEntries(report.repairs.filter((r) => r.required).map((r) => [r.id, true])),
    resources,
    onProgress: (done, total) => {
      const percent = total === 0 ? 100 : Math.floor((done / total) * 100);
      if (percent >= lastPercent + 5 || percent === 100) {
        lastPercent = percent;
        process.stdout.write(`\rCopying bitmap and sound data: ${percent}%   `);
      }
    },
  });
  if (converted.imported) process.stdout.write('\n');

  const finalized = writeFinalizedMap(
    converted.buffer,
    output,
    {
      writeFileSync: (p, data) => fs.writeFileSync(p, data),
      renameSync: (from, to) => fs.renameSync(from, to),
      removeIfExists: (p) => {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* best effort */
        }
      },
    },
    'the source map was not changed',
  );

  const out = finalized.buffer;
  const tagDataOffset = out.readUInt32LE(0x10);
  const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
  console.log('\nWritten.');
  console.log(`  File size:          ${out.length.toLocaleString('en-US')} bytes (header ${out.readUInt32LE(0x8).toLocaleString('en-US')})`);
  console.log(`  Tag data offset:    ${tagDataOffset.toLocaleString('en-US')}`);
  console.log(`  Model data offset:  ${out.readUInt32LE(tagDataOffset + 0x14).toLocaleString('en-US')}`);
  console.log(`  CRC32:              ${hex(finalized.crc32)}`);
  console.log(`  Internal name:      "${finalized.scenarioName}" (was "${finalized.previousScenarioName}")`);
  console.log(`  Ranges copied:      ${converted.imported?.rangesCopied ?? 0}`);
  console.log(`  Bytes added:        ${(converted.imported?.bytesAdded ?? 0).toLocaleString('en-US')}`);
  console.log(`  Tag data size:      ${out.readUInt32LE(0x14).toLocaleString('en-US')}`);
  const a = converted.alignment;
  console.log(`  Tag data aligned:   ${a ? `${a.bytes} byte(s) inserted at tag data +0x${a.insertAt.toString(16).toUpperCase()} (end of the tag names); ${a.pointersMoved.toLocaleString('en-US')} pointers moved; ${a.tolerated} stale pointer(s) left as they were` : 'no (already 4-aligned)'}`);
  if ('moved' in converted) {
    const moved = converted.moved as Record<string, number>;
    const total = Object.values(moved).reduce((a, b) => a + b, 0);
    console.log(`  Pointers moved:     ${total.toLocaleString('en-US')} from 0x4BF10000 to 0x40440000 (${Object.entries(moved).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ')})`);
  }
  console.log(`  Tag data repairs:   ${converted.repairs.length}`);
  for (const r of converted.repairs) {
    const what =
      r.id === 'scriptSyntaxData'
        ? `script syntax data of #${r.tagIndex} ${r.tagPath} moved to its own block (${r.copied.toLocaleString('en-US')} bytes copied: header and used nodes; rest zero)`
        : r.id === 'blockOverlap'
          ? `a block of #${r.tagIndex} ${r.tagPath} that overlapped another tag moved, with its data blocks, to ${r.blockSize.toLocaleString('en-US')} bytes of its own (today's bytes copied)`
          : `tag #${r.tagIndex} ${r.tagPath} given a zeroed ${r.blockSize}-byte root struct (tag entry +0x14)`;
    console.log(`    - ${r.id}: ${what}`);
    console.log(`      pointer ${hex(r.oldPointer)} -> ${hex(r.newPointer)}; appended ${r.bytesAppended.toLocaleString('en-US')} bytes (${r.padding} padding + ${r.blockSize.toLocaleString('en-US')} block)`);
  }
  const warnings = [...finalized.warnings, ...report.checks.filter((c) => c.status === 'warn').map((c) => `${c.label}: ${c.message}`), ...(converted.imported?.warnings ?? [])];
  console.log(`  Warnings:           ${warnings.length}`);
  for (const w of warnings) console.log(`    - ${w}`);
} catch (err) {
  if (err instanceof ConversionRefusedError) fail(err.message);
  fail(err instanceof Error ? err.message : String(err));
} finally {
  bitmaps?.close();
  sounds?.close();
}
