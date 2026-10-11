import { CorruptMapError } from './errors';

/**
 * The raw-data region of an uncompressed cache file: the bytes between the last BSP and the model
 * data, holding embedded (internal) bitmap pixels and sound samples at ABSOLUTE file offsets, back
 * to back with no padding. File layout (measured on coldsnap, Yoyorast_Island, HaloMD crossing and
 * barrier; PRD 2026-10-11 "Converter: per-asset external data"):
 *
 *   [header 2048][BSPs][raw-data region][model data][tag data]
 *
 * `appendToRawDataRegion` adds bytes at the END of that region (= the model data file offset), so
 * every existing absolute offset before it (BSP start, existing embedded assets) stays valid. Model
 * data and tag data move by the inserted length N as whole blocks:
 *   - header 0x8 (file size) += N, header 0x10 (tag data offset) += N,
 *   - tag data header +0x14 (model data file offset) += N.
 * Unchanged: tag data size (0x14), every tag data pointer (memory addresses, not file offsets),
 * BSP start, model data size and the model parts' offsets (relative to the model data).
 *
 * Written for the Demo/HaloMD converter (Phase 1b) and meant to be reused for embedded-data
 * relocation in Inject (PRD). The caller patches its own asset offsets afterwards: a field that was
 * at absolute file offset X in tag data is at X + N in the output.
 */

const FILE_SIZE_OFFSET = 0x8;
const TAG_DATA_OFFSET_OFFSET = 0x10;
const TAG_DATA_SIZE_OFFSET = 0x14;
/** Tag data header: model data file offset (+0x14) and model data size (+0x20). */
const TAG_DATA_HEADER_MODEL_DATA_OFFSET = 0x14;
const TAG_DATA_HEADER_MODEL_DATA_SIZE = 0x20;

/** One block of new raw data: its length, and how to write its bytes into the output. */
export interface RawDataChunk {
  length: number;
  /** Writes exactly `length` bytes into `target` at `at`. */
  write(target: Buffer, at: number): void;
}

export interface RawDataRegionLayout {
  /** The last BSP's end (bsp start + bsp size), i.e. where the raw-data region starts. */
  bspEnd: number;
  /** Where new bytes go: the model data file offset (the end of the current raw-data region). */
  insertAt: number;
  modelDataSize: number;
  tagDataOffset: number;
  tagDataSize: number;
}

/**
 * Reads the region boundaries from the header and tag data header, and refuses (CorruptMapError)
 * any layout other than [.. BSP end <= model data][model data][tag data] ending at the end of the
 * file, because then something after the insertion point would not move with it.
 */
export function rawDataRegionLayoutOf(map: Buffer, bspEnd: number): RawDataRegionLayout {
  const tagDataOffset = map.readUInt32LE(TAG_DATA_OFFSET_OFFSET);
  const tagDataSize = map.readUInt32LE(TAG_DATA_SIZE_OFFSET);
  if (tagDataOffset + TAG_DATA_HEADER_MODEL_DATA_SIZE + 4 > map.length) throw new CorruptMapError('The tag data header is outside the file.');
  const insertAt = map.readUInt32LE(tagDataOffset + TAG_DATA_HEADER_MODEL_DATA_OFFSET);
  const modelDataSize = map.readUInt32LE(tagDataOffset + TAG_DATA_HEADER_MODEL_DATA_SIZE);
  if (map.readUInt32LE(FILE_SIZE_OFFSET) !== map.length) throw new CorruptMapError(`The header's file size (${map.readUInt32LE(FILE_SIZE_OFFSET)}) is not the file's size (${map.length}).`);
  if (bspEnd > insertAt) throw new CorruptMapError(`The BSP data (ends at ${bspEnd}) runs past the model data (starts at ${insertAt}).`);
  if (insertAt + modelDataSize !== tagDataOffset) {
    throw new CorruptMapError(`The model data (${insertAt} + ${modelDataSize}) is not directly followed by the tag data (${tagDataOffset}); this file layout is not supported.`);
  }
  if (tagDataOffset + tagDataSize !== map.length) {
    throw new CorruptMapError(`The tag data (${tagDataOffset} + ${tagDataSize}) does not end at the end of the file (${map.length}); this file layout is not supported.`);
  }
  return { bspEnd, insertAt, modelDataSize, tagDataOffset, tagDataSize };
}

export interface RawDataAppendResult {
  buffer: Buffer;
  /** Bytes inserted (N). Everything from `layout.insertAt` on moved by this much. */
  shift: number;
  /** Absolute output file offset of each chunk, in order. */
  chunkOffsets: number[];
}

export class RawDataAppendCancelledError extends Error {
  constructor() {
    super('Cancelled. Nothing was written.');
    this.name = 'RawDataAppendCancelledError';
  }
}

/**
 * Returns a new buffer with `chunks` packed back to back (no padding) at `layout.insertAt`, model
 * data and tag data moved after them, and the three location fields above updated. Never mutates
 * `map`. `onChunk` reports progress after each chunk; `shouldCancel` is checked before each chunk
 * (throws RawDataAppendCancelledError).
 */
export function appendToRawDataRegion(
  map: Buffer,
  layout: RawDataRegionLayout,
  chunks: readonly RawDataChunk[],
  hooks: { onChunk?: (done: number, total: number) => void; shouldCancel?: () => boolean } = {},
): RawDataAppendResult {
  const shift = chunks.reduce((n, c) => n + c.length, 0);
  const out = Buffer.alloc(map.length + shift);
  map.copy(out, 0, 0, layout.insertAt);
  const chunkOffsets: number[] = [];
  let at = layout.insertAt;
  for (let i = 0; i < chunks.length; i++) {
    if (hooks.shouldCancel?.()) throw new RawDataAppendCancelledError();
    chunks[i].write(out, at);
    chunkOffsets.push(at);
    at += chunks[i].length;
    hooks.onChunk?.(i + 1, chunks.length);
  }
  map.copy(out, at, layout.insertAt);
  out.writeUInt32LE(out.length, FILE_SIZE_OFFSET);
  out.writeUInt32LE(layout.tagDataOffset + shift, TAG_DATA_OFFSET_OFFSET);
  out.writeUInt32LE(layout.insertAt + shift, layout.tagDataOffset + shift + TAG_DATA_HEADER_MODEL_DATA_OFFSET);
  return { buffer: out, shift, chunkOffsets };
}
