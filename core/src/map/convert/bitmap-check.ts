import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { resolveTagDataPointer } from '../tag-index';
import { decodeStruct, isRangeInBuffer, resolveStruct } from '../definitions/engine';

/**
 * OpenCE's bitmap check at load (build 185, commit 6399ed9): `custom_edition_bitmaps_verify` refuses the
 * map ("bitmap N of '...' cannot be drawn by this build", then game_load() failed) at the first bitmap
 * `custom_edition_bitmap_drawable` (port/linux/game/custom_edition_bitmaps.c l.223) rejects. Mirrored rule
 * by rule (memory/opence-notes.md "Phase 2 mods in OpenCE"):
 * - `bitmap_verify` (source/bitmaps/bitmaps.c l.1220): signature 'bitm'; no flag beyond the 8 defined bits;
 *   type 0-2; format 0-17; width and height 1-30000; depth 1-256, and 1 unless 3D;
 *   0 <= mipmap count <= floor(log2(largest dimension));
 * - a format with a hardware texture (`bitmap_format_drawable`): a8, y8, ay8, a8y8, r5g6b5, a1r5g5b5,
 *   a4r4g4b4, x8r8g8b8, a8r8g8b8; dxt1/3/5 and p8 bump only when not linear;
 * - the compressed flag set exactly for dxt1-5;
 * - power-of-two width, height and depth, or a linear 2D bitmap;
 * - square cube maps;
 * - pixel data size >= `bitmap_get_pixel_data_size`: every mip level (dimension >> level, at least 1;
 *   compressed levels padded to 4), x6 for cube maps, times the format's bits per pixel / 8.
 * The BitmapData layout equals OpenCE's `struct bitmap_data` (source/bitmaps/bitmap_group.h l.29).
 *
 * `ignoreExternalBit`: the pre-flight reads the source, where a bitmap whose pixels are in a resource
 * file still has flag 0x100; the copy-in (Phase 1b) clears it, so the pre-flight checks the flags the
 * output will have. The check of the written map uses the real flags. Measured: 0 problems on the 5 CE
 * maps (internal bitmaps), PC / HaloMD / Mac demo stock maps and every map that loads in OpenCE; 1 in
 * MacDemo TrueInfectionV2 (#3849, DXT1 512x512 with 9 mipmaps, 43,960 of 174,776 bytes).
 */

const BITMAP_SIGNATURE = 0x6269746d; // 'bitm'
const DEFINED_FLAG_BITS = 0xff;
const FLAG_COMPRESSED = 0x2;
const FLAG_LINEAR = 0x10;
const FLAG_EXTERNAL = 0x100;
const TYPE_2D = 0;
const TYPE_3D = 1;
const TYPE_CUBE_MAP = 2;
const FORMAT_DXT1 = 14;
const FORMAT_DXT5 = 16;
/** `bitmap_format_bits_per_pixel_table` (bitmaps.c), formats 0-17. */
const BITS_PER_PIXEL = [8, 8, 8, 16, 0, 0, 16, 0, 16, 16, 32, 32, 0, 0, 4, 8, 8, 8];
const DRAWABLE_FORMATS = new Set([0, 1, 2, 3, 6, 8, 9, 10, 11]);
const DRAWABLE_IF_NOT_LINEAR = new Set([14, 15, 16, 17]);
const MAXIMUM_WIDTH = 30000;
const MAXIMUM_HEIGHT = 30000;
const MAXIMUM_DEPTH = 256;

export interface BitmapValues {
  signature: number;
  width: number;
  height: number;
  depth: number;
  type: number;
  format: number;
  flags: number;
  mipmapCount: number;
  pixelsSize: number;
}

export interface BitmapProblem {
  tagIndex: number;
  tagPath: string;
  bitmapIndex: number;
  values: BitmapValues;
  reasons: string[];
  /** One line for the dialog, in OpenCE's words where it has them. */
  text: string;
}

export interface BitmapReport {
  problems: BitmapProblem[];
  tagsChecked: number;
  bitmapsChecked: number;
}

const powerOfTwo = (v: number) => v > 0 && (v & (v - 1)) === 0;
const floorLog2 = (v: number) => (v > 0 ? 31 - Math.clz32(v) : -1);

/** `bitmap_get_pixel_data_size` for a bitmap that passed `bitmap_verify`. */
export function requiredPixelDataSize(v: BitmapValues): number {
  let pixels = 0;
  for (let level = 0; level <= v.mipmapCount; level++) {
    let width = Math.max(v.width >> level, 1);
    let height = Math.max(v.height >> level, 1);
    const depth = Math.max(v.depth >> level, 1);
    if (v.flags & FLAG_COMPRESSED) {
      width += -width & 3;
      height += -height & 3;
    }
    pixels += width * height * depth * (v.type === TYPE_CUBE_MAP ? 6 : 1);
  }
  return Math.floor((pixels * BITS_PER_PIXEL[v.format]) / 8);
}

/** Why OpenCE can't draw this bitmap; empty when it can. */
export function bitmapDrawProblems(v: BitmapValues): string[] {
  const reasons: string[] = [];
  if (v.signature !== BITMAP_SIGNATURE) reasons.push(`its signature is 0x${v.signature.toString(16)}, not 'bitm'`);
  if (v.flags & ~DEFINED_FLAG_BITS) reasons.push(`its flags 0x${v.flags.toString(16)} use bits past the 8 defined ones`);
  if (v.type < 0 || v.type > TYPE_CUBE_MAP) reasons.push(`type ${v.type} does not exist`);
  if (v.format < 0 || v.format >= BITS_PER_PIXEL.length) reasons.push(`format ${v.format} does not exist`);
  if (!(v.width > 0 && v.width <= MAXIMUM_WIDTH)) reasons.push(`width ${v.width} is out of range`);
  if (!(v.height > 0 && v.height <= MAXIMUM_HEIGHT)) reasons.push(`height ${v.height} is out of range`);
  if (!(v.depth > 0 && v.depth <= MAXIMUM_DEPTH && (v.depth === 1 || v.type === TYPE_3D))) reasons.push(`depth ${v.depth} is not valid for type ${v.type}`);
  const maximumMipmaps = floorLog2(Math.max(v.width, v.height, v.depth));
  if (v.mipmapCount < 0 || v.mipmapCount > maximumMipmaps) reasons.push(`${v.mipmapCount} mipmaps, at most ${maximumMipmaps} for its size`);
  const verified = reasons.length === 0;

  const linear = (v.flags & FLAG_LINEAR) !== 0;
  if (!DRAWABLE_FORMATS.has(v.format) && !(DRAWABLE_IF_NOT_LINEAR.has(v.format) && !linear)) reasons.push(`format ${v.format}${linear ? ' (linear)' : ''} has no texture format in this build`);
  const compressedFormat = v.format >= FORMAT_DXT1 && v.format <= FORMAT_DXT5;
  if (((v.flags & FLAG_COMPRESSED) !== 0) !== compressedFormat) reasons.push(`its compressed flag does not match format ${v.format}`);
  if (linear ? v.type !== TYPE_2D : !(powerOfTwo(v.width) && powerOfTwo(v.height) && powerOfTwo(v.depth))) {
    reasons.push(linear ? `it is linear but not 2D (type ${v.type})` : `${v.width}x${v.height}x${v.depth} is not a power of two in every dimension`);
  }
  if (v.type === TYPE_CUBE_MAP && v.width !== v.height) reasons.push(`a cube map must be square (${v.width}x${v.height})`);
  if (verified) {
    const needed = requiredPixelDataSize(v);
    if (v.pixelsSize < needed) reasons.push(`it has ${v.pixelsSize.toLocaleString('en-US')} bytes of pixels; its size and ${v.mipmapCount} mipmaps need ${needed.toLocaleString('en-US')}`);
  }
  return reasons;
}

/** BitmapData offsets (= the schema's, checked by a test; = OpenCE's `struct bitmap_data`). */
export const BITMAP_DATA_OFFSETS = { width: 0x4, height: 0x6, depth: 0x8, type: 0xa, format: 0xc, flags: 0xe, mipmapCount: 0x14, pixelsSize: 0x1c } as const;

/**
 * Every bitmap of every internal bitmap tag (Bitmap "bitmap data" through the tag definitions, 48-byte
 * BitmapData). Tags kept whole in a resource map (entry +0x18 == 1; CE maps only) are not in this file
 * and are not checked. Reads only.
 */
export function checkDrawableBitmaps(buffer: Buffer, header: Pick<CacheFileHeader, 'tagDataOffset'>, tagIndex: TagIndex, options: { ignoreExternalBit?: boolean } = {}): BitmapReport {
  const report: BitmapReport = { problems: [], tagsChecked: 0, bitmapsChecked: 0 };
  const bitmapSize = resolveStruct('BitmapData').totalSize;
  const groupSize = resolveStruct('Bitmap').totalSize;
  for (const e of tagIndex.entries) {
    if (e.primaryClassName !== 'bitmap' || e.isExternal) continue;
    const root = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header as CacheFileHeader, tagIndex.baseMemoryAddress);
    if (!isRangeInBuffer(root, groupSize, buffer.length)) continue; // outside the tag data: the extent check refuses it
    report.tagsChecked++;
    const list = decodeStruct(buffer, root, 'Bitmap').get('bitmap data');
    if (list?.kind !== 'reflexive') continue;
    for (let i = 0; i < list.value.count; i++) {
      const at = resolveTagDataPointer((list.value.pointerLow + i * bitmapSize) >>> 0, header as CacheFileHeader, tagIndex.baseMemoryAddress);
      if (!isRangeInBuffer(at, bitmapSize, buffer.length)) break;
      const flags = buffer.readUInt16LE(at + BITMAP_DATA_OFFSETS.flags);
      const values: BitmapValues = {
        signature: buffer.readUInt32LE(at),
        width: buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.width),
        height: buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.height),
        depth: buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.depth),
        type: buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.type),
        format: buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.format),
        flags: options.ignoreExternalBit ? flags & ~FLAG_EXTERNAL : flags,
        mipmapCount: buffer.readInt16LE(at + BITMAP_DATA_OFFSETS.mipmapCount),
        pixelsSize: buffer.readInt32LE(at + BITMAP_DATA_OFFSETS.pixelsSize),
      };
      report.bitmapsChecked++;
      const reasons = bitmapDrawProblems(values);
      if (reasons.length === 0) continue;
      report.problems.push({
        tagIndex: e.index,
        tagPath: e.path,
        bitmapIndex: i,
        values,
        reasons,
        text: `#${e.index} ${e.path}: bitmap ${i} (type ${values.type}, format ${values.format}, ${values.width}x${values.height}x${values.depth}, flags 0x${values.flags.toString(16).toUpperCase()}): ${reasons.join('; ')}`,
      });
    }
  }
  return report;
}
