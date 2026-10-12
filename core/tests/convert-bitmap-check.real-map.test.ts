import { describe, expect, it } from 'vitest';
import { bitmapDrawProblems, BITMAP_DATA_OFFSETS, checkDrawableBitmaps } from '../src/map/convert/bitmap-check';
import type { BitmapValues } from '../src/map/convert/bitmap-check';
import { normalizeDemoMap, convertDemoToCustomEdition, preflightDemoConversion } from '../src/map/convert/demo-to-ce';
import { ConversionRefusedError } from '../src/map/convert/retail-to-ce';
import { resolveStruct } from '../src/map/definitions/engine';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { MACDEMO, MACDEMO_RES, withResources } from './helpers/demo-map';

/**
 * The "Bitmaps OpenCE can draw" row (`bitmap-check.ts`, mirror of OpenCE's custom_edition_bitmap_drawable).
 * Independent: `rawBitmaps` reads every bitmap from raw bytes (fixed offsets, standard or demo header),
 * and `rawPixelBytes` computes the needed size on its own; the check must see the same bitmaps and agree
 * on the size verdict. Expected (PRD 2026-10-12): 0 problems on the CE maps and every map that loads; 1 in
 * TrueInfectionV2 (#3849 bitmap 0).
 */

const TRUE_INFECTION_BAD = '#3849';

interface RawBitmap {
  tagIndex: number;
  bitmapIndex: number;
  width: number;
  height: number;
  depth: number;
  type: number;
  format: number;
  flags: number;
  mipmaps: number;
  size: number;
}

/** Every bitmap of every internal 'bitm' tag, from raw bytes only. */
function rawBitmaps(b: Buffer): RawBitmap[] {
  const demo = b.readUInt32LE(0x2c0) === 0x45686564;
  const tdo = demo ? b.readUInt32LE(0x5ec) : b.readUInt32LE(0x10);
  const base = demo ? 0x4bf10000 : 0x40440000;
  const at = (p: number) => tdo + (p - base);
  const out: RawBitmap[] = [];
  const count = b.readUInt32LE(tdo + 0xc);
  for (let i = 0; i < count; i++) {
    const e = tdo + 0x28 + i * 0x20;
    if (b.readUInt32LE(e) !== 0x6269746d || b.readUInt32LE(e + 0x18) === 1) continue;
    const root = at(b.readUInt32LE(e + 0x14));
    const n = b.readUInt32LE(root + 0x60);
    const list = b.readUInt32LE(root + 0x64);
    for (let k = 0; k < n; k++) {
      const d = at(list + k * 48);
      out.push({ tagIndex: i, bitmapIndex: k, width: b.readInt16LE(d + 4), height: b.readInt16LE(d + 6), depth: b.readInt16LE(d + 8), type: b.readInt16LE(d + 10), format: b.readInt16LE(d + 12), flags: b.readUInt16LE(d + 14), mipmaps: b.readInt16LE(d + 20), size: b.readInt32LE(d + 28) });
    }
  }
  return out;
}

/** Bytes a bitmap's mip chain needs (bits per pixel: 4 for DXT1, 8 for DXT3/5 and 8-bit formats, 16, 32). */
function rawPixelBytes(r: RawBitmap): number {
  const bits: Record<number, number> = { 0: 8, 1: 8, 2: 8, 3: 16, 6: 16, 8: 16, 9: 16, 10: 32, 11: 32, 14: 4, 15: 8, 16: 8, 17: 8 };
  const block = r.format >= 14 && r.format <= 16;
  let total = 0;
  for (let m = 0; m <= r.mipmaps; m++) {
    const w = Math.max(r.width >> m, 1);
    const h = Math.max(r.height >> m, 1);
    const d = Math.max(r.depth >> m, 1);
    total += (block ? Math.ceil(w / 4) * 4 * Math.ceil(h / 4) * 4 : w * h) * d * (r.type === 2 ? 6 : 1);
  }
  return (total * bits[r.format]) / 8;
}

/** A buffer the CE reader accepts: CE as is, retail with version 609, demo through the rebase. */
function readable(b: Buffer): Buffer {
  if (b.readUInt32LE(0x2c0) === 0x45686564) {
    const n = normalizeDemoMap(b);
    if (!n.ok) throw new Error(n.rows.map((r) => r.message).join(' '));
    const v = n.value.buffer;
    v.writeUInt32LE(609, 4);
    return v;
  }
  const v = Buffer.from(b);
  v.writeUInt32LE(609, 4);
  return v;
}

describe('bitmap check: the BitmapData offsets equal the schema and OpenCE\'s struct bitmap_data', () => {
  it('48-byte BitmapData; Bitmap "bitmap data" at 0x60; field offsets', () => {
    const s = resolveStruct('BitmapData');
    expect(s.totalSize).toBe(48);
    const off = (n: string) => s.fields.find((f) => f.name === n)!.offset;
    expect({ width: off('width'), height: off('height'), depth: off('depth'), type: off('type'), format: off('format'), flags: off('flags'), mipmapCount: off('mipmap count'), pixelsSize: off('pixel data size') }).toEqual(BITMAP_DATA_OFFSETS);
    expect(resolveStruct('Bitmap').fields.find((f) => f.name === 'bitmap data')!.offset).toBe(0x60);
  });
});

describe('bitmap check: each rule of custom_edition_bitmap_drawable (synthetic values)', () => {
  // A drawable DXT1 256x256 with a full chain: 32768 + 8192 + 2048 + 512 + 128 + 32 + 8 + 8 + 8 = 43,704 bytes.
  const ok: BitmapValues = { signature: 0x6269746d, width: 256, height: 256, depth: 1, type: 0, format: 14, flags: 0x3, mipmapCount: 8, pixelsSize: 43_704 };
  it('the reference bitmap passes, and one byte short fails on size', () => {
    expect(bitmapDrawProblems(ok)).toEqual([]);
    expect(bitmapDrawProblems({ ...ok, pixelsSize: 43_703 })).toEqual(['it has 43,703 bytes of pixels; its size and 8 mipmaps need 43,704']);
  });
  const cases: [string, Partial<BitmapValues>, RegExp][] = [
    ['signature', { signature: 0 }, /signature/],
    ['a flag past bit 7 (the external bit 0x100)', { flags: 0x103 }, /past the 8 defined/],
    ['type 3', { type: 3 }, /type 3 does not exist/],
    ['format 18', { format: 18 }, /format 18 does not exist/],
    ['width 0', { width: 0 }, /width 0/],
    ['depth 2 on a 2D bitmap', { depth: 2 }, /depth 2/],
    ['too many mipmaps', { mipmapCount: 9 }, /9 mipmaps, at most 8/],
    ['an unused format (12)', { format: 12, flags: 0x1 }, /no texture format/],
    ['DXT1 linear', { flags: 0x13 }, /no texture format/],
    ['the compressed flag missing on DXT1', { flags: 0x1 }, /compressed flag/],
    ['not a power of two', { width: 192 }, /not a power of two/],
    ['a cube map that is not square', { type: 2, height: 128, mipmapCount: 7, pixelsSize: 10_000_000 }, /cube map must be square/],
  ];
  for (const [what, change, reason] of cases) {
    it(`refuses ${what}`, () => {
      const problems = bitmapDrawProblems({ ...ok, ...change });
      expect(problems.some((p) => reason.test(p))).toBe(true);
    });
  }
});

const MAPS = [
  'bloodgulch.map',
  'sidewinder.map',
  'coldsnap.map',
  'ui.map',
  'Yoyorast_Island.map',
  sampleIn('pc', 'bloodgulch.map'),
  sampleIn('haloMD', 'bloodgulch.map'),
  sampleIn('haloMD', 'heh_2.map'),
  sampleIn('haloMD', 'crossing.map'),
  sampleIn('haloMD', 'barrier.map'),
  sampleIn('haloMD', 'theisland_3.map'),
  MACDEMO.bloodgulch,
  MACDEMO.ui,
  MACDEMO.zombiemod,
  MACDEMO.trueInfection,
];

describe('bitmap check on the sample maps (independent raw count and size verdict)', () => {
  for (const file of MAPS) {
    const gate = skippableTest([file]);
    const expectBad = file === MACDEMO.trueInfection ? 1 : 0;
    it.skipIf(gate.skip)(`${file}: ${expectBad} bitmap(s) OpenCE can't draw${gate.titleSuffix}`, () => {
      const source = readSampleMap(file);
      const raw = rawBitmaps(source);
      const view = readable(source);
      const header = parseCacheFileHeader(view);
      const report = checkDrawableBitmaps(view, header, parseTagIndex(view, header), { ignoreExternalBit: true });
      expect(report.bitmapsChecked).toBe(raw.length);
      // Independent size verdict over the same bitmaps.
      const rawShort = raw.filter((r) => r.size < rawPixelBytes(r));
      expect(report.problems.map((p) => `${p.tagIndex}:${p.bitmapIndex}`)).toEqual(rawShort.map((r) => `${r.tagIndex}:${r.bitmapIndex}`));
      expect(report.problems).toHaveLength(expectBad);
      if (expectBad) {
        expect(report.problems[0].text).toMatch(new RegExp(`^${TRUE_INFECTION_BAD} .*: bitmap 0 \\(type 0, format 14, 512x512x1, flags 0x83\\): it has 43,960 bytes of pixels; its size and 9 mipmaps need 174,776$`));
        expect(rawShort[0]).toMatchObject({ tagIndex: 3849, bitmapIndex: 0, format: 14, width: 512, height: 512, mipmaps: 9, size: 43_960 });
        expect(rawPixelBytes(rawShort[0])).toBe(174_776);
      }
    }, 300_000);
  }
});

describe('bitmap check in the Convert pre-flight', () => {
  const gate = skippableTest([MACDEMO.trueInfection, MACDEMO_RES.bitmaps, MACDEMO_RES.sounds]);
  it.skipIf(gate.skip)(`TrueInfectionV2 is refused by the "Bitmaps OpenCE can draw" row, naming #3849 bitmap 0; the converter refuses too${gate.titleSuffix}`, () => {
    const source = readSampleMap(MACDEMO.trueInfection);
    const report = withResources(MACDEMO_RES, (r) => preflightDemoConversion(source, r));
    expect(report.canConvert).toBe(false);
    expect(report.checks.filter((c) => c.status === 'refuse').map((c) => c.id)).toEqual(['drawableBitmaps']);
    const row = report.checks.find((c) => c.id === 'drawableBitmaps')!;
    expect(row.label).toBe('Bitmaps OpenCE can draw');
    expect(row.details).toHaveLength(1);
    expect(row.details[0]).toMatch(/^#3849 .*: bitmap 0 \(type 0, format 14, 512x512x1, flags 0x83\)/);
    expect(() => withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: true, resources: r, repairs: { scriptSyntaxData: true } }))).toThrow(ConversionRefusedError);
  }, 300_000);
});
