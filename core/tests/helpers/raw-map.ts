import * as zlib from 'node:zlib';

/**
 * Raw-byte readers for independent converter checks: fixed format offsets and node:zlib only -
 * none of the converter, finalize, CRC, tag-index or schema code. `RAW_LAYOUT` is cross-checked
 * against the schema in one test (`convert-external.real-map.test.ts`), nothing more.
 * Works on standard-header maps (retail v7 and CE 609) whose tag data is at base 0x40440000.
 */

export const BASE = 0x40440000;

export const RAW_LAYOUT = {
  /** Scenario "structure bsps" block list; each element 32 bytes: start +0, size +4, address +8. */
  scenarioStructureBsps: 0x5a4,
  /** Bitmap "bitmap data" block list; BitmapData is 48 bytes. */
  bitmapDataList: 0x60,
  bitmapDataSize: 48,
  bitmapFlags: 0x0e,
  bitmapOffset: 0x18,
  bitmapPixelSize: 0x1c,
  /** Sound "pitch ranges" (72-byte blocks) -> "permutations" (124-byte blocks) -> "samples" data at +0x40: size +0, external word +4, file offset +8. */
  soundPitchRanges: 0x98,
  pitchRangeSize: 72,
  pitchRangePermutations: 0x3c,
  permutationSize: 124,
  permutationSamples: 0x40,
} as const;

const FOURCC_BITMAP = 0x6269746d; // "bitm"
const FOURCC_SOUND = 0x736e6421; // "snd!"

export const tagDataOffsetOf = (buf: Buffer) => buf.readUInt32LE(0x10);
const fileOf = (buf: Buffer, pointer: number) => tagDataOffsetOf(buf) + (pointer - BASE);

/** The scenario's structure BSPs as (start, size), from raw bytes. */
export function rawBspRegions(buf: Buffer): { start: number; size: number }[] {
  const tagData = tagDataOffsetOf(buf);
  const entry = tagData + 0x28 + (buf.readUInt32LE(tagData + 0x4) & 0xffff) * 0x20;
  const scenarioAt = fileOf(buf, buf.readUInt32LE(entry + 0x14));
  const count = buf.readUInt32LE(scenarioAt + RAW_LAYOUT.scenarioStructureBsps);
  const listAt = fileOf(buf, buf.readUInt32LE(scenarioAt + RAW_LAYOUT.scenarioStructureBsps + 4));
  const out: { start: number; size: number }[] = [];
  for (let i = 0; i < count; i++) out.push({ start: buf.readUInt32LE(listAt + i * 32), size: buf.readUInt32LE(listAt + i * 32 + 4) });
  return out;
}

/** Halo's header crc32 from raw bytes: bit-inverted CRC-32 over each BSP, model data, then tag data. */
export function rawCrc(buf: Buffer): number {
  const tagData = tagDataOffsetOf(buf);
  let crc = 0;
  for (const b of rawBspRegions(buf)) crc = zlib.crc32(buf.subarray(b.start, b.start + b.size), crc);
  const modelAt = buf.readUInt32LE(tagData + 0x14);
  crc = zlib.crc32(buf.subarray(modelAt, modelAt + buf.readUInt32LE(tagData + 0x20)), crc);
  crc = zlib.crc32(buf.subarray(tagData, tagData + buf.readUInt32LE(0x14)), crc);
  return ~crc >>> 0;
}

export interface RawAsset {
  kind: 'bitmap' | 'sound';
  tagIndex: number;
  /** Absolute file offsets of the offset field and of the external flag (2 bytes for bitmaps, 4 for sounds). */
  offsetAt: number;
  flagAt: number;
  flagWidth: 2 | 4;
  offset: number;
  size: number;
  /** Bitmaps: flags & 0x100. Sounds: word & 1. */
  external: boolean;
  flagValue: number;
}

/** Every bitmap image and sound permutation with data, in tag order then block order, from raw bytes. Tags marked external in the tag array are skipped. */
export function rawAssets(buf: Buffer): RawAsset[] {
  const L = RAW_LAYOUT;
  const tagData = tagDataOffsetOf(buf);
  const count = buf.readUInt32LE(tagData + 0xc);
  const out: RawAsset[] = [];
  for (let i = 0; i < count; i++) {
    const entry = tagData + 0x28 + i * 0x20;
    if (buf.readUInt32LE(entry + 0x18) !== 0) continue;
    const fourcc = buf.readUInt32LE(entry);
    const at = fileOf(buf, buf.readUInt32LE(entry + 0x14));
    if (fourcc === FOURCC_BITMAP) {
      const n = buf.readUInt32LE(at + L.bitmapDataList);
      const list = fileOf(buf, buf.readUInt32LE(at + L.bitmapDataList + 4));
      for (let k = 0; k < n; k++) {
        const s = list + k * L.bitmapDataSize;
        const size = buf.readUInt32LE(s + L.bitmapPixelSize);
        if (size === 0) continue;
        const flags = buf.readUInt16LE(s + L.bitmapFlags);
        out.push({ kind: 'bitmap', tagIndex: i, offsetAt: s + L.bitmapOffset, flagAt: s + L.bitmapFlags, flagWidth: 2, offset: buf.readUInt32LE(s + L.bitmapOffset), size, external: (flags & 0x100) !== 0, flagValue: flags });
      }
    } else if (fourcc === FOURCC_SOUND) {
      const ranges = buf.readUInt32LE(at + L.soundPitchRanges);
      const rangeList = fileOf(buf, buf.readUInt32LE(at + L.soundPitchRanges + 4));
      for (let r = 0; r < ranges; r++) {
        const pr = rangeList + r * L.pitchRangeSize;
        const n = buf.readUInt32LE(pr + L.pitchRangePermutations);
        const list = fileOf(buf, buf.readUInt32LE(pr + L.pitchRangePermutations + 4));
        for (let k = 0; k < n; k++) {
          const samples = list + k * L.permutationSize + L.permutationSamples;
          const size = buf.readUInt32LE(samples);
          if (size === 0) continue;
          const word = buf.readUInt32LE(samples + 4);
          out.push({ kind: 'sound', tagIndex: i, offsetAt: samples + 8, flagAt: samples + 4, flagWidth: 4, offset: buf.readUInt32LE(samples + 8), size, external: (word & 1) !== 0, flagValue: word });
        }
      }
    }
  }
  return out;
}
