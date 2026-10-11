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
 * `repairs`: the required tag data repairs OpenCE needs (PRD "OpenCE findings"), in the order the
 * converter applies them: the scenario's script syntax data (every HaloMD map: it is not 4-aligned;
 * theisland_3 / barrier: it also overlaps other tags), then tag #2404's root (crossing). Sizes =
 * Phase 1b size + for each block, padding to 4 from the tag data start + the block (380,076-byte
 * script data, 72-byte sound_environment).
 */
type ExpectedRepair = { kind: 'scriptSyntaxData'; blockSize: number } | { kind: 'tagRootOutside'; tagIndex: number; blockSize: number };
const SCRIPT: ExpectedRepair = { kind: 'scriptSyntaxData', blockSize: 380_076 };
const CASES: { file: string; out: string; size: number; repairs: ExpectedRepair[] }[] = [
  { file: sampleIn('haloMD', 'heh_2.map'), out: 'heh_2_ce.map', size: 70_827_478 + 2 + 380_076, repairs: [SCRIPT] },
  { file: sampleIn('haloMD', 'theisland_3.map'), out: 'theisland_3_ce.map', size: 105_348_484 + 2 + 380_076, repairs: [SCRIPT] },
  { file: sampleIn('haloMD', 'crossing.map'), out: 'crossing_ce.map', size: 75_214_196 + 3 + 380_076 + 0 + 72, repairs: [SCRIPT, { kind: 'tagRootOutside', tagIndex: 2404, blockSize: 72 }] },
  { file: sampleIn('haloMD', 'barrier.map'), out: 'barrier_ce.map', size: 77_338_350 + 2 + 380_076, repairs: [SCRIPT] },
];

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
function expectedRepairs(source: Buffer, list: ExpectedRepair[]): { tail: Buffer; each: { kind: ExpectedRepair['kind']; pointerInTagData: number; oldPointer: number; newPointer: number; padding: number; blockSize: number; usedNodes: number }[] } {
  const td = tagDataOffsetOf(source);
  const size = source.readUInt32LE(0x14);
  const parts: Buffer[] = [];
  const each = [];
  let end = size;
  for (const r of list) {
    const padding = (4 - (end % 4)) % 4;
    const block = Buffer.alloc(padding + r.blockSize);
    const newPointer = BASE + end + padding;
    if (r.kind === 'scriptSyntaxData') {
      const pointerAt = rawScenarioAt(source) + 0x474 + 0xc;
      const oldPointer = source.readUInt32LE(pointerAt);
      const oldAt = td + (oldPointer - BASE);
      const usedNodes = source.readInt16LE(oldAt + 0x2e);
      source.copy(block, padding, oldAt, oldAt + 56 + usedNodes * 20);
      each.push({ kind: r.kind, pointerInTagData: pointerAt - td, oldPointer, newPointer, padding, blockSize: r.blockSize, usedNodes });
    } else {
      const pointerAt = td + 0x28 + r.tagIndex * 0x20 + 0x14;
      each.push({ kind: r.kind, pointerInTagData: pointerAt - td, oldPointer: source.readUInt32LE(pointerAt), newPointer, padding, blockSize: r.blockSize, usedNodes: 0 });
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
      converted = convertRetailToCustomEdition(source, { acknowledgeScripts: false, repairs: { scriptSyntaxData: true, tagRootOutside: true }, resources: { bitmaps, sounds } });
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

    it.skipIf(gate.skip)(`every copied range equals the resource bytes at its old offset, packed back to back from the old model data offset (offsets computed here)${gate.titleSuffix}`, () => {
      const shift = importShift();
      const src = rawAssets(source);
      const outAssets = rawAssets(out);
      expect(outAssets).toHaveLength(src.length);
      let expectedAt = source.readUInt32LE(tagDataOffsetOf(source) + 0x14);
      let copied = 0;
      const external = new Set(externalInCopyOrder(src));
      for (const a of externalInCopyOrder(src)) {
        const newOffset = out.readUInt32LE(a.offsetAt + shift);
        expect(newOffset).toBe(expectedAt);
        const file = a.kind === 'bitmap' ? bitmaps : sounds;
        if (!out.subarray(newOffset, newOffset + a.size).equals(file.read(a.offset, a.size))) throw new Error(`bytes differ for ${a.kind} of tag #${a.tagIndex} (old offset ${a.offset})`);
        expectedAt += a.size;
        copied += a.size;
      }
      expect(copied).toBe(shift);
      // Internal assets keep their offset and bytes.
      for (const a of src) {
        if (external.has(a)) continue;
        expect(out.readUInt32LE(a.offsetAt + shift)).toBe(a.offset);
        expect(out.subarray(a.offset, a.offset + a.size).equals(source.subarray(a.offset, a.offset + a.size))).toBe(true);
      }
    });

    it.skipIf(gate.skip)(`no external bit remains; every other flag bit is unchanged${gate.titleSuffix}`, () => {
      const shift = importShift();
      const src = rawAssets(source);
      const after = rawAssets(out);
      expect(after.filter((a) => a.external)).toEqual([]);
      src.forEach((a, i) => {
        const mask = a.kind === 'bitmap' ? 0x100 : 0x1;
        expect(after[i].flagAt).toBe(a.flagAt + shift);
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

    it.skipIf(gate.skip)(`tag data: every changed byte of the old tag data is an asset offset, an external flag, the model data offset or the repaired pointer; it is still the last block${gate.titleSuffix}`, () => {
      const oldTd = tagDataOffsetOf(source);
      const newTd = tagDataOffsetOf(out);
      const size = source.readUInt32LE(0x14);
      const expected = expectedRepairs(source, c.repairs);
      const tail = expected.tail.length;
      expect(out.readUInt32LE(0x14)).toBe(size + tail);
      expect(newTd + size + tail).toBe(out.length);
      const allowed = new Set<number>();
      const allow = (at: number, n: number) => {
        for (let i = 0; i < n; i++) allowed.add(at - oldTd + i);
      };
      allow(oldTd + 0x14, 4);
      for (const r of expected.each) allow(oldTd + r.pointerInTagData, 4);
      for (const a of rawAssets(source)) {
        if (!a.external) continue;
        allow(a.offsetAt, 4);
        allow(a.flagAt, a.flagWidth);
      }
      const unexpected: number[] = [];
      for (let i = 0; i < size; i++) if (source[oldTd + i] !== out[newTd + i] && !allowed.has(i)) unexpected.push(i);
      expect(unexpected.slice(0, 10)).toEqual([]);
    });

    if (c.repairs.length > 0) {
      it.skipIf(gate.skip)(`repairs ${c.repairs.map((r) => r.kind).join(', ')}: each pointer moved to its 4-aligned block after the old tag data; the appended bytes are exactly the paddings and blocks computed here${gate.titleSuffix}`, () => {
        const size = source.readUInt32LE(0x14);
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
        expect((expected.oldPointer - BASE) % 4).not.toBe(0); // every HaloMD map's is unaligned
        const at = tagDataOffsetOf(out) + (out.readUInt32LE(tagDataOffsetOf(out) + expected.pointerInTagData) - BASE);
        const oldAt = tagDataOffsetOf(source) + (expected.oldPointer - BASE);
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
    expect(report.estimatedOutputSize).toBe(70_827_478 + 2 + 380_076); // the Phase 1b size + the required script data repair
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
  it.skipIf(crossingGate.skip)(`crossing: the unaligned script data and the tag outside the tag data each get a required repair row; converting without either is refused (REPAIR_REQUIRED)${crossingGate.titleSuffix}`, () => {
    const source = fs.readFileSync(sampleMapPath(CROSSING));
    const files = [openReadOnly(sampleMapPath(RES.bitmaps)), openReadOnly(sampleMapPath(RES.sounds))];
    try {
      const resources = { bitmaps: files[0], sounds: files[1] };
      const report = preflightRetailConversion(source, resources);
      expect(report.canConvert).toBe(true);
      expect(report.requiresAcknowledgement).toBe(false);
      expect(report.checks.find((k) => k.id === 'tagDataExtents')).toMatchObject({ status: 'warn', details: [expect.stringMatching(/^#2404 sound\\sound environments\\arena\.sound_environment root: 72 bytes at 0x409DC695, outside the tag data/)] });
      expect(report.checks.find((k) => k.id === 'repairTagRootOutside')).toMatchObject({ status: 'warn', requiresAcknowledgement: false, repair: { id: 'tagRootOutside', required: true } });
      const script = report.checks.find((k) => k.id === 'repairScriptSyntaxData')!;
      expect(script).toMatchObject({ status: 'warn', requiresAcknowledgement: false, repair: { id: 'scriptSyntaxData', required: true } });
      expect(script.message).toMatch(/^OpenCE refuses this map without this repair: .*not 4-aligned/);
      expect(script.details[0]).toMatch(/starts at 0x[0-9A-F]+, which is not 4-aligned from the tag data start/);
      // The script block comes first (3 bytes of padding), then the struct (no padding: the script block ends 4-aligned).
      expect(report.repairs).toEqual([
        { id: 'scriptSyntaxData', required: true, tagPath: expect.any(String), bytesAdded: 3 + 380_076 },
        { id: 'tagRootOutside', required: true, tagPath: 'sound\\sound environments\\arena', bytesAdded: 72 },
      ]);
      expect(report.estimatedOutputSize).toBe(75_214_196 + 3 + 380_076 + 72);
      for (const repairs of [undefined, { tagRootOutside: false, scriptSyntaxData: true }, { scriptSyntaxData: true }, { tagRootOutside: true }]) {
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
        const converted = convertRetailToCustomEdition(source, { acknowledgeScripts: true, repairs: { scriptSyntaxData: true }, resources: { bitmaps: files[0], sounds: files[1] }, shouldCancel: () => ++calls > 10 });
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
