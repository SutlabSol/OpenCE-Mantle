import { describe, expect, it } from 'vitest';
import { findEmbeddedDataFields, expectedBitmapPixelDataSize, validateBitmapAssetSize } from '../src/map/embedded-data-fields';
import type { ResolvedField, ResolvedStruct, DecodedFieldValue } from '../src/map/definitions/engine';

function field(name: string, offset: number, def: Partial<ResolvedField['def']> = {}): ResolvedField {
  return { name, offset, def: { name, type: 'uint32', ...def } } as ResolvedField;
}

function struct(fields: ResolvedField[]): ResolvedStruct {
  return { name: 'Fake', totalSize: 64, fields } as ResolvedStruct;
}

describe('findEmbeddedDataFields (unit, no real map needed - synthetic resolved/decoded)', () => {
  it('TagDataOffset + externalFileOffset, external=0: reports an embedded (not external) match with the right patch offset', () => {
    const resolved = struct([field('samples', 8, { type: 'TagDataOffset', externalFileOffset: 'sounds.map' })]);
    const decoded = new Map<string, DecodedFieldValue>([['samples', { kind: 'tagDataOffset', value: { size: 512, external: 0, fileOffset: 1000, pointerLow: 0, pointerHigh: 0 } } as DecodedFieldValue]]);
    const matches = findEmbeddedDataFields(resolved, decoded);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'sound', external: false, fileOffset: 1000, size: 512, patchOffset: 8 + 8, patchWidth: 4 });
  });

  it('TagDataOffset + externalFileOffset, external=1: reports an external (not embedded) match', () => {
    const resolved = struct([field('samples', 8, { type: 'TagDataOffset', externalFileOffset: 'sounds.map' })]);
    const decoded = new Map<string, DecodedFieldValue>([['samples', { kind: 'tagDataOffset', value: { size: 512, external: 1, fileOffset: 2000, pointerLow: 0, pointerHigh: 0 } } as DecodedFieldValue]]);
    const matches = findEmbeddedDataFields(resolved, decoded);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'sound', external: true, fileOffset: 2000, size: 512 });
  });

  it('bitfield + externalDataSibling, external bit unset: reports an embedded bitmap match using the sibling offset field', () => {
    const resolved = struct([
      field('flags', 4, { type: 'BitmapDataFlags', externalDataSibling: { offsetField: 'pixel data offset', sizeField: 'pixel data size', resourceMap: 'bitmaps.map' } }),
      field('pixel data offset', 20),
      field('pixel data size', 24),
    ]);
    const decoded = new Map<string, DecodedFieldValue>([
      ['flags', { kind: 'bitfield', value: 0 } as DecodedFieldValue],
      ['pixel data offset', { kind: 'basic', value: 5000 } as DecodedFieldValue],
      ['pixel data size', { kind: 'basic', value: 256 } as DecodedFieldValue],
    ]);
    const matches = findEmbeddedDataFields(resolved, decoded);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'bitmap', external: false, fileOffset: 5000, size: 256, patchOffset: 20, patchWidth: 4 });
  });

  it('bitfield + externalDataSibling, external bit set: reports an external bitmap match', () => {
    const resolved = struct([
      field('flags', 4, { type: 'BitmapDataFlags', externalDataSibling: { offsetField: 'pixel data offset', sizeField: 'pixel data size', resourceMap: 'bitmaps.map' } }),
      field('pixel data offset', 20),
      field('pixel data size', 24),
    ]);
    const decoded = new Map<string, DecodedFieldValue>([
      ['flags', { kind: 'bitfield', value: 1 << 8 } as DecodedFieldValue], // bit 8 = "external" per real BitmapDataFlags (see bitmap.json)
      ['pixel data offset', { kind: 'basic', value: 5000 } as DecodedFieldValue],
      ['pixel data size', { kind: 'basic', value: 256 } as DecodedFieldValue],
    ]);
    const matches = findEmbeddedDataFields(resolved, decoded);
    expect(matches).toHaveLength(1);
    expect(matches[0].external).toBe(true);
  });

  it('bitfield + externalDataSibling whose sibling offset field cannot be resolved: reports "unknown", never a guess', () => {
    const resolved = struct([
      field('flags', 4, { type: 'BitmapDataFlags', externalDataSibling: { offsetField: 'does not exist', sizeField: 'pixel data size', resourceMap: 'bitmaps.map' } }),
      field('pixel data size', 24),
    ]);
    const decoded = new Map<string, DecodedFieldValue>([
      ['flags', { kind: 'bitfield', value: 0 } as DecodedFieldValue],
      ['pixel data size', { kind: 'basic', value: 256 } as DecodedFieldValue],
    ]);
    const matches = findEmbeddedDataFields(resolved, decoded);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ kind: 'unknown', patchWidth: 0 });
  });

  it('a field annotated with externalDataSibling but whose bitfield type has no "external" bit: reports "unknown"', () => {
    const resolved = struct([field('flags', 4, { type: 'SomeOtherBitfieldWithNoExternalBit', externalDataSibling: { offsetField: 'x', sizeField: 'y', resourceMap: 'bitmaps.map' } })]);
    const decoded = new Map<string, DecodedFieldValue>([['flags', { kind: 'bitfield', value: 0 } as DecodedFieldValue]]);
    const matches = findEmbeddedDataFields(resolved, decoded);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('unknown');
  });

  it('a plain TagDataOffset field with no externalFileOffset annotation (e.g. scenario script data, font pixels): never matched - this is the separate, already-safe pointer mechanism', () => {
    const resolved = struct([field('script syntax data', 8, { type: 'TagDataOffset' })]);
    const decoded = new Map<string, DecodedFieldValue>([['script syntax data', { kind: 'tagDataOffset', value: { size: 999, external: 1234567, fileOffset: 42, pointerLow: 1079500000, pointerHigh: 0 } } as DecodedFieldValue]]);
    expect(findEmbeddedDataFields(resolved, decoded)).toEqual([]);
  });

  it('nonCached fields (e.g. bitmap "compressed color plate data") are never matched, even if annotated', () => {
    const resolved = struct([field('compressed color plate data', 8, { type: 'TagDataOffset', externalFileOffset: 'bitmaps.map', nonCached: true })]);
    const decoded = new Map<string, DecodedFieldValue>([['compressed color plate data', { kind: 'tagDataOffset', value: { size: 500, external: 0, fileOffset: 10, pointerLow: 0, pointerHigh: 0 } } as DecodedFieldValue]]);
    expect(findEmbeddedDataFields(resolved, decoded)).toEqual([]);
  });

  it('size 0 is never reported (nothing there to relocate)', () => {
    const resolved = struct([field('samples', 8, { type: 'TagDataOffset', externalFileOffset: 'sounds.map' })]);
    const decoded = new Map<string, DecodedFieldValue>([['samples', { kind: 'tagDataOffset', value: { size: 0, external: 0, fileOffset: 0, pointerLow: 0, pointerHigh: 0 } } as DecodedFieldValue]]);
    expect(findEmbeddedDataFields(resolved, decoded)).toEqual([]);
  });
});

describe('expectedBitmapPixelDataSize / validateBitmapAssetSize', () => {
  it('matches hand-computed sizes for every supported format (uncompressed, block-compressed, cube map, 3d texture)', () => {
    expect(expectedBitmapPixelDataSize(4, 4, 1, '2d texture', 'a8r8g8b8', 0)).toBe(4 * 4 * 4);
    expect(expectedBitmapPixelDataSize(4, 4, 1, '2d texture', 'dxt1', 0)).toBe(8); // one 4x4 block
    expect(expectedBitmapPixelDataSize(8, 8, 1, '2d texture', 'dxt1', 1)).toBe(32 + 8); // mip0 8x8=2x2 blocks*8, mip1 4x4=1 block*8
    expect(expectedBitmapPixelDataSize(2, 2, 1, 'cube map', 'a8', 0)).toBe(2 * 2 * 1 * 6); // 6 faces
    expect(expectedBitmapPixelDataSize(4, 4, 2, '3d texture', 'a8', 0)).toBe(4 * 4 * 1 * 2); // depth multiplies
  });

  it('returns null for an "unused" format slot - unsupported, never guessed', () => {
    expect(expectedBitmapPixelDataSize(4, 4, 1, '2d texture', 'unused1', 0)).toBeNull();
  });

  it('validateBitmapAssetSize blocks with a reason on a mismatch, and passes on an exact match', () => {
    const decoded = new Map<string, DecodedFieldValue>([
      ['width', { kind: 'basic', value: 4 } as DecodedFieldValue],
      ['height', { kind: 'basic', value: 4 } as DecodedFieldValue],
      ['depth', { kind: 'basic', value: 1 } as DecodedFieldValue],
      ['type', { kind: 'enum', value: 0 } as DecodedFieldValue], // 2d texture
      ['format', { kind: 'enum', value: 11 } as DecodedFieldValue], // a8r8g8b8
      ['mipmap count', { kind: 'basic', value: 0 } as DecodedFieldValue],
    ]);
    expect(validateBitmapAssetSize(decoded, 4 * 4 * 4)).toEqual({ ok: true });
    const bad = validateBitmapAssetSize(decoded, 999);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('expected');
  });
});
