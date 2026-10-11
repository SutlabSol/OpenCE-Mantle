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
import { sampleIn, sampleMapPath, skippableTest } from './helpers/sample-maps';
import { RAW_LAYOUT, rawAssets, rawBspRegions, rawCrc, tagDataOffsetOf } from './helpers/raw-map';
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
const CASES = [
  { file: sampleIn('haloMD', 'heh_2.map'), out: 'heh_2_ce.map', size: 70_827_478, acknowledgeTagDataOutside: false },
  { file: sampleIn('haloMD', 'theisland_3.map'), out: 'theisland_3_ce.map', size: 105_348_484, acknowledgeTagDataOutside: false },
  { file: sampleIn('haloMD', 'crossing.map'), out: 'crossing_ce.map', size: 75_214_196, acknowledgeTagDataOutside: true },
  { file: sampleIn('haloMD', 'barrier.map'), out: 'barrier_ce.map', size: 77_338_350, acknowledgeTagDataOutside: false },
];

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
      const converted = convertRetailToCustomEdition(source, { acknowledgeScripts: false, acknowledgeTagDataOutside: c.acknowledgeTagDataOutside, resources: { bitmaps, sounds } });
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

    it.skipIf(gate.skip)(`every copied range equals the resource bytes at its old offset, packed back to back from the old model data offset (offsets computed here)${gate.titleSuffix}`, () => {
      const shift = out.length - source.length;
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
      const shift = out.length - source.length;
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
      expect(newModel).toBe(oldModel + (out.length - source.length));
      expect(out.readUInt32LE(tagDataOffsetOf(out) + 0x20)).toBe(modelSize);
      expect(out.subarray(newModel, newModel + modelSize).equals(source.subarray(oldModel, oldModel + modelSize))).toBe(true);
    });

    it.skipIf(gate.skip)(`tag data: same size, and every changed byte is an asset offset, an external flag or the model data offset${gate.titleSuffix}`, () => {
      const oldTd = tagDataOffsetOf(source);
      const newTd = tagDataOffsetOf(out);
      const size = source.readUInt32LE(0x14);
      expect(out.readUInt32LE(0x14)).toBe(size);
      expect(newTd + size).toBe(out.length);
      const allowed = new Set<number>();
      const allow = (at: number, n: number) => {
        for (let i = 0; i < n; i++) allowed.add(at - oldTd + i);
      };
      allow(oldTd + 0x14, 4);
      for (const a of rawAssets(source)) {
        if (!a.external) continue;
        allow(a.offsetAt, 4);
        allow(a.flagAt, a.flagWidth);
      }
      const unexpected: number[] = [];
      for (let i = 0; i < size; i++) if (source[oldTd + i] !== out[newTd + i] && !allowed.has(i)) unexpected.push(i);
      expect(unexpected.slice(0, 10)).toEqual([]);
    });

    it.skipIf(gate.skip)(`header: only version, file size, tag data offset, name, build string and CRC changed${gate.titleSuffix}`, () => {
      const allowed = (i: number) => (i >= 0x4 && i < 0xc) || (i >= 0x10 && i < 0x14) || (i >= 0x20 && i < 0x60) || (i >= 0x64 && i < 0x68);
      const unexpected: string[] = [];
      for (let i = 0; i < 0x800; i++) if (source[i] !== out[i] && !allowed(i)) unexpected.push(`0x${i.toString(16)}`);
      expect(unexpected).toEqual([]);
      expect(out.readUInt32LE(0x4)).toBe(609);
      expect(out.subarray(0x40, 0x60).toString('latin1').replace(/\0+$/, '')).toBe('01.00.00.0609');
      expect(out.subarray(0x20, 0x40).toString('latin1').replace(/\0+$/, '')).toBe(c.out.replace(/\.map$/, ''));
      expect(out.readUInt32LE(0x10)).toBe(source.readUInt32LE(0x10) + (out.length - source.length));
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
    expect(report.estimatedOutputSize).toBe(70_827_478);
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
  it.skipIf(crossingGate.skip)(`crossing: the tag outside the tag data needs an acknowledgement${crossingGate.titleSuffix}`, () => {
    const source = fs.readFileSync(sampleMapPath(CROSSING));
    const files = [openReadOnly(sampleMapPath(RES.bitmaps)), openReadOnly(sampleMapPath(RES.sounds))];
    try {
      const resources = { bitmaps: files[0], sounds: files[1] };
      const row = preflightRetailConversion(source, resources).checks.find((k) => k.id === 'tagDataOutside')!;
      expect(row).toMatchObject({ status: 'warn', requiresAcknowledgement: true });
      expect(row.details).toEqual([expect.stringMatching(/^#2404 sound\\sound environments\\arena\.sound_environment/)]);
      try {
        convertRetailToCustomEdition(source, { acknowledgeScripts: true, resources });
        throw new Error('expected a refusal');
      } catch (err) {
        expect((err as ConversionRefusedError).code).toBe('ACKNOWLEDGEMENT_REQUIRED');
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
        const converted = convertRetailToCustomEdition(source, { acknowledgeScripts: true, resources: { bitmaps: files[0], sounds: files[1] }, shouldCancel: () => ++calls > 10 });
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
