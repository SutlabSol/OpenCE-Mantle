import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { convertRetailToCustomEdition, preflightRetailConversion, ConversionRefusedError } from '../src/map/convert/retail-to-ce';
import type { ConversionResourceFiles } from '../src/map/convert/retail-to-ce';
import type { RandomAccessFile } from '../src/map/convert/resource-files';
import { writeFinalizedMap } from '../src/map/write-map';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { verifyEmbeddedData } from '../src/map/embedded-data-verifier';
import { getGroupStructName, resolveStruct } from '../src/map/definitions/engine';
import { checkTagDataExtents } from '../src/map/convert/extent-check';
import { measureBlockAlignment } from '../src/map/convert/align-tag-data';
import { collectTagDataPointers, tagDataLayoutOf } from '../src/map/pointer-rebase';
import type { ToleratedPointer } from '../src/map/pointer-rebase';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { sampleIn, sampleMapPath, skippableTest } from './helpers/sample-maps';
import { BASE, RAW_LAYOUT, rawAssets, rawBspRegions, rawCrc, tagDataOffsetOf } from './helpers/raw-map';
import type { RawAsset } from './helpers/raw-map';

/**
 * Converter Phase 1b on temp copies of the HaloMD maps, with HaloMD's own bitmaps.map / sounds.map.
 *
 * Independent checks: assets, offsets, regions and the CRC come from `helpers/raw-map.ts` (fixed
 * format offsets + node:zlib), and the expected packing (where each range must land) is computed
 * here - not by the converter. Resource bytes are read here through our own file handle. Only the
 * last test ("reads with the CE reader") is same-reader. Resource maps are opened read-only and
 * read by offset; nothing in sample_maps is written.
 */

const RES = { bitmaps: sampleIn('haloMD', 'bitmaps.map'), sounds: sampleIn('haloMD', 'sounds.map') };
/**
 * `align`: the zero bytes Phase 1c inserts after the tag path strings (PRD 2026-10-12): every HaloMD
 * map's tags and blocks are 2 mod 4 (crossing 1 mod 4), so 2 (crossing 3). `tolerated`: the stale
 * pointers the alignment walk leaves as they are (heh_2: the BSP's stale sound environment path
 * pointer; crossing: #2404's root). `repairs`: the other required repairs (PRD "OpenCE findings"),
 * planned after the alignment, in the order the converter applies them: the scenario's script syntax
 * data where it overlaps other tags (barrier; after the alignment it is 4-aligned in every map, so
 * heh_2 and crossing no longer need it), then tag #2404's root (crossing). Sizes = Phase 1b size +
 * align + for each block, padding to 4 from the tag data start + the block (380,076-byte script data,
 * 72-byte sound_environment).
 */
type ExpectedRepair = { kind: 'scriptSyntaxData'; blockSize: number } | { kind: 'tagRootOutside'; tagIndex: number; blockSize: number };
const SCRIPT: ExpectedRepair = { kind: 'scriptSyntaxData', blockSize: 380_076 };
const CASES: { file: string; out: string; size: number; align: number; tolerated: ToleratedPointer['kind'][]; repairs: ExpectedRepair[] }[] = [
  { file: sampleIn('haloMD', 'heh_2.map'), out: 'heh_2_ce.map', size: 70_827_478 + 2, align: 2, tolerated: ['staleReferencePath'], repairs: [] },
  { file: sampleIn('haloMD', 'crossing.map'), out: 'crossing_ce.map', size: 75_214_196 + 3 + 0 + 72, align: 3, tolerated: ['rootOutsideTagData'], repairs: [{ kind: 'tagRootOutside', tagIndex: 2404, blockSize: 72 }] },
  { file: sampleIn('haloMD', 'barrier.map'), out: 'barrier_ce.map', size: 77_338_350 + 2 + 0 + 380_076, align: 2, tolerated: [], repairs: [SCRIPT] },
];

/**
 * Independent (raw tag array only): the end of the tag path strings, where Phase 1c inserts its bytes,
 * and how many: the first struct starts right there in every HaloMD map (measured), so its remainder
 * mod 4 decides the count.
 */
function rawAlignment(buf: Buffer): { insertAt: number; bytes: number } {
  const td = tagDataOffsetOf(buf);
  const count = buf.readUInt32LE(td + 0xc);
  let end = 0x28 + count * 0x20;
  for (let i = 0; i < count; i++) {
    let at = td + (buf.readUInt32LE(td + 0x28 + i * 0x20 + 0x10) - BASE);
    while (buf[at] !== 0) at++;
    end = Math.max(end, at + 1 - td);
  }
  return { insertAt: end, bytes: (4 - (end % 4)) % 4 };
}

/** Raw file offset of the scenario struct (tag data header +0x4 names the scenario). */
function rawScenarioAt(buf: Buffer): number {
  const td = tagDataOffsetOf(buf);
  const entry = td + 0x28 + (buf.readUInt32LE(td + 4) & 0xffff) * 0x20;
  return td + (buf.readUInt32LE(entry + 0x14) - BASE);
}

/**
 * The repairs as computed here from raw bytes: for each, the pointer that moves (offset inside the
 * tag data), its old and new value and its padding; and the exact bytes appended after the old tag
 * data (each block's padding, then the block). Script data: the 56-byte data array header and the
 * used nodes (count at +0x2E, 20-byte nodes, per OpenCE memory/data.h and hs.h) are copied, the
 * rest is zero.
 */
function expectedRepairs(
  source: Buffer,
  list: ExpectedRepair[],
): { tail: Buffer; each: { kind: ExpectedRepair['kind']; sourcePointerInTagData: number; pointerInTagData: number; sourcePointer: number; oldPointer: number; newPointer: number; padding: number; blockSize: number; usedNodes: number }[] } {
  const td = tagDataOffsetOf(source);
  const size = source.readUInt32LE(0x14);
  // The repairs run after the alignment: offsets and pointers past the insertion point are `bytes` further on.
  const { insertAt, bytes } = rawAlignment(source);
  const moved = (offsetInTagData: number) => offsetInTagData + (offsetInTagData >= insertAt ? bytes : 0);
  const movedPointer = (pointer: number) => (pointer >= BASE + insertAt && pointer < BASE + size ? pointer + bytes : pointer);
  const parts: Buffer[] = [];
  const each = [];
  let end = size + bytes;
  for (const r of list) {
    const padding = (4 - (end % 4)) % 4;
    const block = Buffer.alloc(padding + r.blockSize);
    const newPointer = BASE + end + padding;
    if (r.kind === 'scriptSyntaxData') {
      const pointerAt = rawScenarioAt(source) + 0x474 + 0xc;
      const sourcePointer = source.readUInt32LE(pointerAt);
      const oldAt = td + (sourcePointer - BASE);
      const usedNodes = source.readInt16LE(oldAt + 0x2e);
      source.copy(block, padding, oldAt, oldAt + 56 + usedNodes * 20);
      each.push({ kind: r.kind, sourcePointerInTagData: pointerAt - td, pointerInTagData: moved(pointerAt - td), sourcePointer, oldPointer: movedPointer(sourcePointer), newPointer, padding, blockSize: r.blockSize, usedNodes });
    } else {
      const pointerAt = td + 0x28 + r.tagIndex * 0x20 + 0x14;
      const sourcePointer = source.readUInt32LE(pointerAt);
      each.push({ kind: r.kind, sourcePointerInTagData: pointerAt - td, pointerInTagData: moved(pointerAt - td), sourcePointer, oldPointer: movedPointer(sourcePointer), newPointer, padding, blockSize: r.blockSize, usedNodes: 0 });
    }
    parts.push(block);
    end += padding + r.blockSize;
  }
  return { tail: Buffer.concat(parts), each };
}

/** A read-only file handle read by offset (the test's own, not the script's or the worker's). */
function openReadOnly(file: string): RandomAccessFile & { close(): void } {
  const fd = fs.openSync(file, 'r');
  return {
    label: path.basename(file),
    size: fs.fstatSync(fd).size,
    read(offset: number, length: number) {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, offset);
      return n === length ? buf : buf.subarray(0, n);
    },
    close: () => fs.closeSync(fd),
  };
}

const writeOps = {
  writeFileSync: (p: string, d: Buffer) => fs.writeFileSync(p, d),
  renameSync: (a: string, b: string) => fs.renameSync(a, b),
  removeIfExists: (p: string) => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  },
};
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('raw-map helper layout agrees with the schema', () => {
  it('Bitmap / BitmapData / Sound / SoundPitchRange / SoundPermutation offsets', () => {
    const field = (s: string, f: string) => resolveStruct(s).fields.find((x) => x.name === f)!.offset;
    const L = RAW_LAYOUT;
    expect(field('Scenario', 'structure bsps')).toBe(L.scenarioStructureBsps);
    expect(field(getGroupStructName('bitmap')!, 'bitmap data')).toBe(L.bitmapDataList);
    expect(resolveStruct('BitmapData').totalSize).toBe(L.bitmapDataSize);
    expect([field('BitmapData', 'flags'), field('BitmapData', 'pixel data offset'), field('BitmapData', 'pixel data size')]).toEqual([L.bitmapFlags, L.bitmapOffset, L.bitmapPixelSize]);
    expect(field(getGroupStructName('sound')!, 'pitch ranges')).toBe(L.soundPitchRanges);
    expect(resolveStruct('SoundPitchRange').totalSize).toBe(L.pitchRangeSize);
    expect(field('SoundPitchRange', 'permutations')).toBe(L.pitchRangePermutations);
    expect(resolveStruct('SoundPermutation').totalSize).toBe(L.permutationSize);
    expect(field('SoundPermutation', 'samples')).toBe(L.permutationSamples);
  });
});

/**
 * theisland_3 converted (105,728,562 B, CRC32 0xFC042F66) but OpenCE refused it at its model part
 * check (model #2574). Since 2026-10-12 the converter refuses it too, with the resource files and
 * every repair ticked, naming the model, its parts and the bad strip indices.
 */
describe(`Phase 1b: HaloMD/theisland_3.map is refused at OpenCE's model part check`, () => {
  const file = sampleIn('haloMD', 'theisland_3.map');
  const gate = skippableTest([file, RES.bitmaps, RES.sounds]);
  it.skipIf(gate.skip)(`refused with the resource files and every repair; the row names #2574's two parts and nothing is returned${gate.titleSuffix}`, () => {
    const source = fs.readFileSync(sampleMapPath(file));
    const bitmaps = openReadOnly(sampleMapPath(RES.bitmaps));
    const sounds = openReadOnly(sampleMapPath(RES.sounds));
    try {
      const report = preflightRetailConversion(source, { bitmaps, sounds });
      expect(report.canConvert).toBe(false);
      expect(report.checks.filter((k) => k.status === 'refuse').map((k) => k.id)).toEqual(['modelParts']);
      const row = report.checks.find((k) => k.id === 'modelParts')!;
      expect(row.details).toHaveLength(2);
      expect(row.details[0]).toBe('#2574 effects\\debris objects\\forerunner dark structure\\forerunner dark structure: geometry 0 part 0: 2 of 104 strip indices are past its 70 vertices (value@position: 70@100, 71@102)');
      expect(row.details[1]).toMatch(/^#2574 .*: geometry 1 part 0: 33 of 66 strip indices are past its 44 vertices/);
      expect(() => convertRetailToCustomEdition(source, { acknowledgeScripts: true, repairs: { alignTagData: true, scriptSyntaxData: true, tagRootOutside: true }, resources: { bitmaps, sounds } })).toThrow(ConversionRefusedError);
    } finally {
      bitmaps.close();
      sounds.close();
    }
  }, 120_000);
});

for (const c of CASES) {
  describe(`Phase 1b: ${c.file} with HaloMD's resource maps (temp copy)`, () => {
    const gate = skippableTest([c.file, RES.bitmaps, RES.sounds]);
    let dir = '';
    let source: Buffer;
    let out: Buffer;
    let converted: ReturnType<typeof convertRetailToCustomEdition>;
    let sourceHash = '';
    let copyPath = '';
    let resourceStats: { size: number; mtimeMs: number }[] = [];
    let bitmaps: ReturnType<typeof openReadOnly>;
    let sounds: ReturnType<typeof openReadOnly>;

    beforeAll(() => {
      if (gate.skip) return;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-1b-'));
      copyPath = path.join(dir, path.basename(c.file));
      fs.copyFileSync(sampleMapPath(c.file), copyPath);
      source = fs.readFileSync(copyPath);
      sourceHash = sha256(source);
      resourceStats = [RES.bitmaps, RES.sounds].map((r) => {
        const s = fs.statSync(sampleMapPath(r));
        return { size: s.size, mtimeMs: s.mtimeMs };
      });
      bitmaps = openReadOnly(sampleMapPath(RES.bitmaps));
      sounds = openReadOnly(sampleMapPath(RES.sounds));
      converted = convertRetailToCustomEdition(source, { acknowledgeScripts: false, repairs: { alignTagData: true, scriptSyntaxData: true, tagRootOutside: true }, resources: { bitmaps, sounds } });
      const outPath = path.join(dir, c.out);
      writeFinalizedMap(converted.buffer, outPath, writeOps);
      out = fs.readFileSync(outPath);
    }, 120_000);

    afterAll(() => {
      bitmaps?.close();
      sounds?.close();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      source = out = Buffer.alloc(0);
    });

    /** Source assets that were external, in the order the plan says: bitmaps, then sounds, each in tag order. */
    const externalInCopyOrder = (assets: RawAsset[]) => [...assets.filter((a) => a.external && a.kind === 'bitmap'), ...assets.filter((a) => a.external && a.kind === 'sound')];

    it.skipIf(gate.skip)(`output is ${c.size.toLocaleString('en-US')} bytes, as estimated; the header's file size says so too${gate.titleSuffix}`, () => {
      expect(out.length).toBe(c.size);
      expect(out.readUInt32LE(0x8)).toBe(c.size);
    });

    /** Bytes the Phase 1b copy inserted before the model data (the tag data moved by this much). */
    const importShift = () => tagDataOffsetOf(out) - tagDataOffsetOf(source);
    /** Where a byte of the source's tag data is in the output: the import shift, plus the Phase 1c bytes when it lies past the tag path strings. */
    const mapAt = (fileOffset: number) => {
      const { insertAt, bytes } = rawAlignment(source);
      return fileOffset + importShift() + (fileOffset - tagDataOffsetOf(source) >= insertAt ? bytes : 0);
    };

    it.skipIf(gate.skip)(`every copied range equals the resource bytes at its old offset, packed back to back from the old model data offset (offsets computed here)${gate.titleSuffix}`, () => {
      const shift = importShift();
      const src = rawAssets(source);
      const outAssets = rawAssets(out);
      const { bytes: alignBytes } = rawAlignment(source);
      expect(outAssets).toHaveLength(src.length);
      let expectedAt = source.readUInt32LE(tagDataOffsetOf(source) + 0x14);
      let copied = 0;
      const external = new Set(externalInCopyOrder(src));
      for (const a of externalInCopyOrder(src)) {
        const newOffset = out.readUInt32LE(mapAt(a.offsetAt));
        expect(newOffset).toBe(expectedAt);
        const file = a.kind === 'bitmap' ? bitmaps : sounds;
        if (!out.subarray(newOffset, newOffset + a.size).equals(file.read(a.offset, a.size))) throw new Error(`bytes differ for ${a.kind} of tag #${a.tagIndex} (old offset ${a.offset})`);
        expectedAt += a.size;
        copied += a.size;
      }
      expect(copied).toBe(shift);
      expect(alignBytes).toBe(c.align);
      // Internal assets keep their offset and bytes.
      for (const a of src) {
        if (external.has(a)) continue;
        expect(out.readUInt32LE(mapAt(a.offsetAt))).toBe(a.offset);
        expect(out.subarray(a.offset, a.offset + a.size).equals(source.subarray(a.offset, a.offset + a.size))).toBe(true);
      }
    });

    it.skipIf(gate.skip)(`no external bit remains; every other flag bit is unchanged${gate.titleSuffix}`, () => {
      const src = rawAssets(source);
      const after = rawAssets(out);
      expect(after.filter((a) => a.external)).toEqual([]);
      src.forEach((a, i) => {
        const mask = a.kind === 'bitmap' ? 0x100 : 0x1;
        expect(after[i].flagAt).toBe(mapAt(a.flagAt));
        expect(after[i].flagValue).toBe((a.flagValue & ~mask) >>> 0);
      });
    });

    it.skipIf(gate.skip)(`the new data starts at the old raw region's end (or the BSP end); BSP, existing raw data and model data are byte-identical${gate.titleSuffix}`, () => {
      const oldModel = source.readUInt32LE(tagDataOffsetOf(source) + 0x14);
      const modelSize = source.readUInt32LE(tagDataOffsetOf(source) + 0x20);
      const bspEnd = Math.max(...rawBspRegions(source).map((b) => b.start + b.size));
      const internalEnd = rawAssets(source).filter((a) => !a.external).reduce((end, a) => Math.max(end, a.offset + a.size), bspEnd);
      expect(oldModel).toBe(internalEnd);
      expect(rawBspRegions(out)).toEqual(rawBspRegions(source));
      expect(out.subarray(0x800, oldModel).equals(source.subarray(0x800, oldModel))).toBe(true);
      const newModel = out.readUInt32LE(tagDataOffsetOf(out) + 0x14);
      expect(newModel).toBe(oldModel + importShift());
      expect(out.readUInt32LE(tagDataOffsetOf(out) + 0x20)).toBe(modelSize);
      expect(out.subarray(newModel, newModel + modelSize).equals(source.subarray(oldModel, oldModel + modelSize))).toBe(true);
    });

    it.skipIf(gate.skip)(`tag data: ${c.align} zero byte(s) inserted at the end of the tag names (found here from the raw tag array); every other changed byte is a pointer into [insertion point, old end) moved by exactly ${c.align}, an asset offset, an external flag, the model data offset or a repaired pointer; the tag data is still the last block${gate.titleSuffix}`, () => {
      const oldTd = tagDataOffsetOf(source);
      const newTd = tagDataOffsetOf(out);
      const size = source.readUInt32LE(0x14);
      const { insertAt, bytes } = rawAlignment(source);
      expect(bytes).toBe(c.align);
      const expected = expectedRepairs(source, c.repairs);
      const tail = expected.tail.length;
      expect(out.readUInt32LE(0x14)).toBe(size + bytes + tail);
      expect(newTd + size + bytes + tail).toBe(out.length);
      expect(out.subarray(newTd + insertAt, newTd + insertAt + bytes).equals(Buffer.alloc(bytes))).toBe(true);
      const outIndex = (i: number) => (i < insertAt ? i : i + bytes);
      const allowed = new Set<number>();
      const allow = (at: number, n: number) => {
        for (let i = 0; i < n; i++) allowed.add(at - oldTd + i);
      };
      allow(oldTd + 0x14, 4);
      for (const r of expected.each) allow(oldTd + r.sourcePointerInTagData, 4);
      for (const a of rawAssets(source)) {
        if (!a.external) continue;
        allow(a.offsetAt, 4);
        allow(a.flagAt, a.flagWidth);
      }
      const movedWords = new Set<number>();
      const unexpected: number[] = [];
      for (let i = 0; i < size; i++) {
        if (source[oldTd + i] === out[newTd + outIndex(i)] || allowed.has(i)) continue;
        let moved = false;
        for (let w = Math.max(0, i - 3); w <= i && !moved; w++) {
          if (w + 4 > size || (w < insertAt && w + 4 > insertAt)) continue;
          const before = source.readUInt32LE(oldTd + w);
          const after = out.readUInt32LE(newTd + outIndex(w));
          if (before >= BASE + insertAt && before < BASE + size && after === before + bytes) {
            moved = true;
            movedWords.add(w);
          }
        }
        if (!moved) unexpected.push(i);
      }
      expect(unexpected.slice(0, 10)).toEqual([]);
      // The raw diff finds the pointers the schema walk moved (a repaired pointer that also moved is counted as repaired).
      const repairedAndMoved = expected.each.filter((r) => r.oldPointer !== r.sourcePointer).length;
      expect(movedWords.size + repairedAndMoved).toBe(converted.alignment!.pointersMoved);
    });

    it.skipIf(gate.skip)(`same-reader: the converter reports the same alignment; every block, tag and data block of the output is 4-aligned (OpenCE's loaded_block_get rule); only the known stale pointers were left as they were${gate.titleSuffix}`, () => {
      const { insertAt, bytes } = rawAlignment(source);
      expect(converted.alignment).toMatchObject({ insertAt, bytes, tolerated: c.tolerated.length });
      const header = parseCacheFileHeader(out);
      const r = measureBlockAlignment(out, header, parseTagIndex(out, header));
      expect([r.blocks.unaligned, r.bspBlocks.unaligned, r.roots.unaligned, r.dataBlocks.unaligned]).toEqual([0, 0, 0, 0]);
      expect(r.blocks.checked).toBeGreaterThan(6000);
      const view = Buffer.from(source);
      view.writeUInt32LE(609, 4);
      const viewHeader = parseCacheFileHeader(view);
      const tolerated: ToleratedPointer[] = [];
      collectTagDataPointers(view, tagDataLayoutOf(viewHeader, parseTagIndex(view, viewHeader)), { tolerate: { staleReferencePaths: true, rootsOutsideTagData: true }, tolerated });
      expect(tolerated.map((t) => t.kind)).toEqual(c.tolerated);
    });

    it.skipIf(gate.skip)(`same-reader: every pointer of the source (schema walk) holds the same target in the output, moved by ${c.align} past the insertion point; every data block's bytes are unchanged${gate.titleSuffix}`, () => {
      const { insertAt, bytes } = rawAlignment(source);
      const oldTd = tagDataOffsetOf(source);
      const newTd = tagDataOffsetOf(out);
      const size = source.readUInt32LE(0x14);
      const view = Buffer.from(source);
      view.writeUInt32LE(609, 4);
      const viewHeader = parseCacheFileHeader(view);
      const sites = collectTagDataPointers(view, tagDataLayoutOf(viewHeader, parseTagIndex(view, viewHeader)), { tolerate: { staleReferencePaths: true, rootsOutsideTagData: true }, tolerated: [] });
      const repaired = new Set(expectedRepairs(source, c.repairs).each.map((r) => r.sourcePointerInTagData));
      // (a BSP reference path pointer lies in the BSP, before the raw data the import grew: it keeps its file offset)
      const outAt = (at: number) => (at < oldTd ? at : newTd + (at - oldTd) + (at - oldTd >= insertAt ? bytes : 0));
      const wrong: string[] = [];
      let dataBlocks = 0;
      for (const site of sites) {
        if (repaired.has(site.at - oldTd)) continue;
        const expectedValue = site.value >= BASE + insertAt && site.value < BASE + size ? site.value + bytes : site.value;
        const value = out.readUInt32LE(outAt(site.at));
        if (value !== expectedValue) wrong.push(`${site.kind} at ${site.at}: ${value} != ${expectedValue}`);
        if (site.kind === 'dataBlock' && value === expectedValue) {
          const length = source.readInt32LE(site.at - 0xc);
          if (length <= 0) continue;
          dataBlocks++;
          const from = oldTd + (site.value - BASE);
          const to = newTd + (value - BASE);
          if (!source.subarray(from, from + length).equals(out.subarray(to, to + length))) wrong.push(`data block at ${site.at} (${length} bytes) differs`);
        }
      }
      expect(wrong.slice(0, 10)).toEqual([]);
      expect(dataBlocks).toBeGreaterThan(2000);
    });

    if (c.repairs.length > 0) {
      it.skipIf(gate.skip)(`repairs ${c.repairs.map((r) => r.kind).join(', ')}: each pointer moved to its 4-aligned block after the old tag data; the appended bytes are exactly the paddings and blocks computed here${gate.titleSuffix}`, () => {
        const size = source.readUInt32LE(0x14) + rawAlignment(source).bytes;
        const expected = expectedRepairs(source, c.repairs);
        const newTd = tagDataOffsetOf(out);
        for (const r of expected.each) {
          expect(out.readUInt32LE(newTd + r.pointerInTagData)).toBe(r.newPointer);
          expect((r.newPointer - BASE) % 4).toBe(0);
        }
        expect(out.subarray(newTd + size).equals(expected.tail)).toBe(true);
        // The tool reports the same values.
        expect(converted.repairs).toEqual(
          expected.each.map((r) => expect.objectContaining({ id: r.kind, oldPointer: r.oldPointer, newPointer: r.newPointer, padding: r.padding, blockSize: r.blockSize, bytesAppended: r.padding + r.blockSize })),
        );
      });
    }
    if (c.repairs.some((r) => r.kind === 'scriptSyntaxData')) {
      it.skipIf(gate.skip)(`repaired script data: 4-aligned from the tag data start; header and used nodes as in the source, every other node slot free (identifier 0, as OpenCE's data.c reads a free slot)${gate.titleSuffix}`, () => {
        const expected = expectedRepairs(source, c.repairs).each.find((r) => r.kind === 'scriptSyntaxData')!;
        expect((expected.sourcePointer - BASE) % 4).not.toBe(0); // every HaloMD map's is unaligned in the source
        const at = tagDataOffsetOf(out) + (out.readUInt32LE(tagDataOffsetOf(out) + expected.pointerInTagData) - BASE);
        const oldAt = tagDataOffsetOf(source) + (expected.sourcePointer - BASE);
        expect(out.subarray(at, at + 56).equals(source.subarray(oldAt, oldAt + 56))).toBe(true);
        const maximum = out.readInt16LE(at + 0x20);
        expect(out.readInt16LE(at + 0x2e)).toBe(expected.usedNodes);
        expect(56 + maximum * out.readInt16LE(at + 0x22)).toBe(expected.blockSize);
        for (let i = 0; i < maximum; i++) {
          const node = at + 56 + i * 20;
          if (i < expected.usedNodes) expect(out.subarray(node, node + 20).equals(source.subarray(oldAt + 56 + i * 20, oldAt + 76 + i * 20))).toBe(true);
          else if (out.readInt16LE(node) !== 0) throw new Error(`node slot ${i} is not free`);
        }
        expect((at - tagDataOffsetOf(out)) % 4).toBe(0);
      });
    }

    it.skipIf(gate.skip)(`same-reader: the block check (OpenCE's rules) finds no problem in the output${gate.titleSuffix}`, () => {
      const header = parseCacheFileHeader(out);
      expect(checkTagDataExtents(out, header, parseTagIndex(out, header)).violations.map((v) => v.text)).toEqual([]);
    });

    it.skipIf(gate.skip)(`header: only version, file size, tag data offset and size, name, build string and CRC changed${gate.titleSuffix}`, () => {
      const allowed = (i: number) => (i >= 0x4 && i < 0xc) || (i >= 0x10 && i < 0x18) || (i >= 0x20 && i < 0x60) || (i >= 0x64 && i < 0x68);
      const unexpected: string[] = [];
      for (let i = 0; i < 0x800; i++) if (source[i] !== out[i] && !allowed(i)) unexpected.push(`0x${i.toString(16)}`);
      expect(unexpected).toEqual([]);
      expect(out.readUInt32LE(0x4)).toBe(609);
      expect(out.subarray(0x40, 0x60).toString('latin1').replace(/\0+$/, '')).toBe('01.00.00.0609');
      expect(out.subarray(0x20, 0x40).toString('latin1').replace(/\0+$/, '')).toBe(c.out.replace(/\.map$/, ''));
      expect(out.readUInt32LE(0x10)).toBe(source.readUInt32LE(0x10) + importShift());
    });

    it.skipIf(gate.skip)(`the header CRC32 matches an independent node:zlib computation${gate.titleSuffix}`, () => {
      expect(out.readUInt32LE(0x64)).toBe(rawCrc(out));
    });

    it.skipIf(gate.skip)(`the source copy and the resource maps are unchanged${gate.titleSuffix}`, () => {
      expect(sha256(fs.readFileSync(copyPath))).toBe(sourceHash);
      [RES.bitmaps, RES.sounds].forEach((r, i) => {
        const s = fs.statSync(sampleMapPath(r));
        expect({ size: s.size, mtimeMs: s.mtimeMs }).toEqual(resourceStats[i]);
      });
    });

    it.skipIf(gate.skip)(`same-reader: the output opens with the CE reader and Verify Embedded Data finds 0 external, 0 out of bounds, 0 overlapping${gate.titleSuffix}`, () => {
      const ins = inspectCustomEditionMap(out);
      if (ins.status !== 'ok') throw new Error(ins.status);
      const report = verifyEmbeddedData(out, ins.header, ins.tagIndex);
      expect(report.counts).toMatchObject({ external: 0, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 });
      expect(report.counts.embedded).toBe(rawAssets(source).length);
    });
  });
}

describe('Phase 1b refusals', () => {
  const HEH = sampleIn('haloMD', 'heh_2.map');
  const CROSSING = sampleIn('haloMD', 'crossing.map');

  const missingGate = skippableTest([HEH]);
  it.skipIf(missingGate.skip)(`without resource files: refused, naming both files${missingGate.titleSuffix}`, () => {
    const source = fs.readFileSync(sampleMapPath(HEH));
    const report = preflightRetailConversion(source);
    expect(report.canConvert).toBe(false);
    expect(report.externalData).toEqual({ bitmaps: { count: 676, bytes: 44_396_916 }, sounds: { count: 951, bytes: 11_972_226 } });
    expect(report.estimatedOutputSize).toBe(70_827_478 + 2); // the Phase 1b size + the required tag data alignment (its script data is then aligned)
    expect(report.checks.find((k) => k.id === 'externalData')).toMatchObject({ status: 'refuse', message: expect.stringMatching(/Missing: bitmaps\.map, sounds\.map/) });
    expect(() => convertRetailToCustomEdition(source, { acknowledgeScripts: true })).toThrow(ConversionRefusedError);
  });

  const wrongSets = [
    { name: 'Mac demo', bitmaps: sampleIn('macDemo', 'bitmaps.map'), sounds: sampleIn('macDemo', 'sounds.map') },
    { name: 'Custom Edition', bitmaps: sampleIn('ce', 'bitmaps.map'), sounds: sampleIn('ce', 'sounds.map') },
  ];
  for (const set of wrongSets) {
    const gate = skippableTest([HEH, set.bitmaps, set.sounds]);
    it.skipIf(gate.skip)(`the ${set.name} resource files are refused by the range check${gate.titleSuffix}`, () => {
      const source = fs.readFileSync(sampleMapPath(HEH));
      const files = [openReadOnly(sampleMapPath(set.bitmaps)), openReadOnly(sampleMapPath(set.sounds))];
      try {
        const resources: ConversionResourceFiles = { bitmaps: files[0], sounds: files[1] };
        const report = preflightRetailConversion(source, resources);
        expect(report.canConvert).toBe(false);
        const row = report.checks.find((k) => k.id === 'resourceFiles')!;
        expect(row.status).toBe('refuse');
        expect(row.details.some((d) => /ranges this map needs are not entries of this file/.test(d))).toBe(true);
        expect(() => convertRetailToCustomEdition(source, { acknowledgeScripts: true, resources })).toThrow(ConversionRefusedError);
      } finally {
        files.forEach((f) => f.close());
      }
    });
  }

  const swapGate = skippableTest([HEH, RES.bitmaps, RES.sounds]);
  it.skipIf(swapGate.skip)(`sounds.map offered as bitmaps.map is refused as the wrong kind${swapGate.titleSuffix}`, () => {
    const source = fs.readFileSync(sampleMapPath(HEH));
    const s = openReadOnly(sampleMapPath(RES.sounds));
    try {
      const report = preflightRetailConversion(source, { bitmaps: s, sounds: s });
      expect(report.checks.find((k) => k.id === 'resourceFiles')).toMatchObject({ status: 'refuse', details: expect.arrayContaining([expect.stringMatching(/is a sounds\.map resource file, not a bitmaps\.map/)]) });
    } finally {
      s.close();
    }
  });

  const crossingGate = skippableTest([CROSSING, RES.bitmaps, RES.sounds]);
  it.skipIf(crossingGate.skip)(`crossing: the tag data alignment (3 bytes) and the tag outside the tag data each get a required repair row; the script data needs none once aligned; converting without either is refused (REPAIR_REQUIRED)${crossingGate.titleSuffix}`, () => {
    const source = fs.readFileSync(sampleMapPath(CROSSING));
    const files = [openReadOnly(sampleMapPath(RES.bitmaps)), openReadOnly(sampleMapPath(RES.sounds))];
    try {
      const resources = { bitmaps: files[0], sounds: files[1] };
      const report = preflightRetailConversion(source, resources);
      expect(report.canConvert).toBe(true);
      expect(report.requiresAcknowledgement).toBe(false);
      const alignment = report.checks.find((k) => k.id === 'tagBlockAlignment')!;
      expect(alignment.status).toBe('warn');
      expect(alignment.message).toMatch(/6,870 of 6,870 tag data blocks \(and 2,403 of 2,403 tags, 2,294 of 2,294 data blocks\) start 1 mod 4/);
      expect(report.checks.find((k) => k.id === 'repairAlignTagData')).toMatchObject({ status: 'warn', requiresAcknowledgement: false, repair: { id: 'alignTagData', required: true } });
      expect(report.checks.find((k) => k.id === 'tagDataExtents')).toMatchObject({ status: 'warn', details: [expect.stringMatching(/^#2404 sound\\sound environments\\arena\.sound_environment root: 72 bytes at 0x409DC695, outside the tag data \(0x40440000 to 0x409DC698\)/)] });
      expect(report.checks.find((k) => k.id === 'repairTagRootOutside')).toMatchObject({ status: 'warn', requiresAcknowledgement: false, repair: { id: 'tagRootOutside', required: true } });
      expect(report.checks.find((k) => k.id === 'repairScriptSyntaxData')).toBeUndefined();
      // The alignment comes first (3 bytes), then the struct (no padding: the aligned tag data ends 4-aligned).
      expect(report.repairs).toEqual([
        { id: 'alignTagData', required: true, tagPath: '(all tags)', bytesAdded: 3 },
        { id: 'tagRootOutside', required: true, tagPath: 'sound\\sound environments\\arena', bytesAdded: 72 },
      ]);
      expect(report.estimatedOutputSize).toBe(75_214_196 + 3 + 72);
      for (const repairs of [undefined, { tagRootOutside: true }, { alignTagData: true }, { alignTagData: false, tagRootOutside: true }]) {
        try {
          convertRetailToCustomEdition(source, { acknowledgeScripts: true, resources, repairs });
          throw new Error('expected a refusal');
        } catch (err) {
          expect((err as ConversionRefusedError).code).toBe('REPAIR_REQUIRED');
        }
      }
    } finally {
      files.forEach((f) => f.close());
    }
  });

  it.skipIf(swapGate.skip)(`cancel while copying: CANCELLED, and nothing is written${swapGate.titleSuffix}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-1b-cancel-'));
    const files = [openReadOnly(sampleMapPath(RES.bitmaps)), openReadOnly(sampleMapPath(RES.sounds))];
    try {
      const source = fs.readFileSync(sampleMapPath(HEH));
      let calls = 0;
      const outPath = path.join(dir, 'heh_2_ce.map');
      try {
        const converted = convertRetailToCustomEdition(source, { acknowledgeScripts: true, repairs: { alignTagData: true }, resources: { bitmaps: files[0], sounds: files[1] }, shouldCancel: () => ++calls > 10 });
        writeFinalizedMap(converted.buffer, outPath, writeOps);
        throw new Error('expected cancel');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionRefusedError);
        expect((err as ConversionRefusedError).code).toBe('CANCELLED');
      }
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      files.forEach((f) => f.close());
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
