import { describe, expect, it } from 'vitest';
import { appendToRawDataRegion, rawDataRegionLayoutOf, RawDataAppendCancelledError } from '../src/map/raw-data-region';
import type { RawDataChunk } from '../src/map/raw-data-region';

/**
 * Synthetic map: [header 0x800][BSP 0x100][raw 0x40][model 0x30][tag data 0x60]. Only the fields the
 * raw-data region writer reads and writes are filled in; the checks below read raw offsets directly.
 */
function syntheticMap(): Buffer {
  const bspEnd = 0x800 + 0x100;
  const model = bspEnd + 0x40;
  const tagData = model + 0x30;
  const buf = Buffer.alloc(tagData + 0x60);
  for (let i = 0x800; i < buf.length; i++) buf[i] = i & 0xff;
  buf.writeUInt32LE(buf.length, 0x8);
  buf.writeUInt32LE(tagData, 0x10);
  buf.writeUInt32LE(0x60, 0x14);
  buf.writeUInt32LE(model, tagData + 0x14);
  buf.writeUInt32LE(0x30, tagData + 0x20);
  return buf;
}
const BSP_END = 0x900;
const chunk = (bytes: number[]): RawDataChunk => ({ length: bytes.length, write: (t, at) => Buffer.from(bytes).copy(t, at) });

describe('appendToRawDataRegion (synthetic)', () => {
  it('packs chunks back to back at the model data offset; model data and tag data move as blocks; three fields updated', () => {
    const map = syntheticMap();
    const before = Buffer.from(map);
    const layout = rawDataRegionLayoutOf(map, BSP_END);
    expect(layout).toEqual({ bspEnd: BSP_END, insertAt: 0x940, modelDataSize: 0x30, tagDataOffset: 0x970, tagDataSize: 0x60 });
    const { buffer, shift, chunkOffsets } = appendToRawDataRegion(map, layout, [chunk([1, 2, 3]), chunk([4, 5, 6, 7, 8])]);
    expect(map.equals(before)).toBe(true);
    expect(shift).toBe(8);
    expect(chunkOffsets).toEqual([0x940, 0x943]);
    expect([...buffer.subarray(0x940, 0x948)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(buffer.length).toBe(map.length + 8);
    expect(buffer.readUInt32LE(0x8)).toBe(buffer.length);
    expect(buffer.readUInt32LE(0x10)).toBe(0x970 + 8);
    expect(buffer.readUInt32LE(0x14)).toBe(0x60);
    expect(buffer.readUInt32LE(0x978 + 0x14)).toBe(0x948);
    expect(buffer.subarray(0x800, 0x940).equals(map.subarray(0x800, 0x940))).toBe(true);
    expect(buffer.subarray(0x948, 0x978).equals(map.subarray(0x940, 0x970))).toBe(true);
    // Tag data: identical except the model data offset field.
    const out = buffer.subarray(0x978);
    const src = map.subarray(0x970);
    const differing = [...out.keys()].filter((i) => out[i] !== src[i]);
    expect(differing.every((i) => i >= 0x14 && i < 0x18)).toBe(true);
  });

  it('cancel before a chunk throws and returns nothing', () => {
    const map = syntheticMap();
    let n = 0;
    expect(() => appendToRawDataRegion(map, rawDataRegionLayoutOf(map, BSP_END), [chunk([1]), chunk([2])], { shouldCancel: () => ++n > 1 })).toThrow(RawDataAppendCancelledError);
  });

  const refusals: [string, (b: Buffer) => void][] = [
    ['a header file size that is not the file size', (b) => b.writeUInt32LE(b.length + 1, 0x8)],
    ['model data not directly followed by tag data', (b) => b.writeUInt32LE(0x2f, b.readUInt32LE(0x10) + 0x20)],
    ['tag data not ending at the end of the file', (b) => b.writeUInt32LE(0x5f, 0x14)],
  ];
  for (const [what, corrupt] of refusals) {
    it(`refuses ${what}`, () => {
      const map = syntheticMap();
      corrupt(map);
      expect(() => rawDataRegionLayoutOf(map, BSP_END)).toThrow();
    });
  }
  it('refuses a BSP that runs past the model data', () => {
    expect(() => rawDataRegionLayoutOf(syntheticMap(), 0x941)).toThrow(/runs past the model data/);
  });
});
