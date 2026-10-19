import { TAG_CLASS_NONE, fourCCToString, lookupTagClass } from '../constants/tag-classes';
import {
  CacheFileEngine,
  CE_BASE_MEMORY_ADDRESS,
  CE_TAG_ARRAY_ADDRESS,
  MCC_BASE_MEMORY_ADDRESS,
  MCC_TAG_ARRAY_ADDRESS,
  TAG_DATA_HEADER_PC_SIZE,
  TAG_ENTRY_SIZE,
} from '../constants/cache-file';
import { readCString } from '../binary/strings';
import { CorruptMapError, UnexpectedTagArrayAddressError } from './errors';
import type { CacheFileHeader } from './header';

/**
 * Parsed form of `CacheFileTagDataHeaderPC` (invader/hek/map.hpp), 0x28 bytes, located at
 * file offset `header.tagDataOffset`:
 *   0x00 tagArrayAddress    uint32 (pointer, virtual address of tag array)
 *   0x04 scenarioTagId      uint32
 *   0x08 tagFileChecksums   uint32
 *   0x0C tagCount           uint32
 *   0x10 modelPartCount     uint32
 *   0x14 modelDataFileOffset uint32
 *   0x18 modelPartCountAgain uint32
 *   0x1C vertexSize         uint32
 *   0x20 modelDataSize      uint32
 *   0x24 tagsLiteral        uint32 "tags"
 */
export interface TagIndexEntry {
  /** Index within the tag array (0-based). */
  index: number;
  /** Raw tag ID as stored in the cache file (salt in high 16 bits, array index in low 16 bits). */
  tagId: number;
  primaryClassFourCC: number;
  secondaryClassFourCC: number | null;
  tertiaryClassFourCC: number | null;
  primaryClassName: string | null;
  path: string;
  /** True if tag data lives in an external resource map (bitmaps.map/sounds.map/loc.map). */
  isExternal: boolean;
  /** Virtual-address pointer to the tag's base struct if not external; resource index if external. */
  tagDataPointerOrResourceIndex: number;
}

export interface TagIndex {
  scenarioTagId: number;
  tagChecksum: number;
  tagCount: number;
  modelPartCount: number;
  modelDataFileOffset: number;
  vertexSize: number;
  modelDataSize: number;
  /** Virtual base address of the tag data: always `CE_BASE_MEMORY_ADDRESS` for a CE map (fixed, not inferred). */
  baseMemoryAddress: number;
  entries: TagIndexEntry[];
}

/**
 * Resolves a virtual-address pointer found in the tag data section to an absolute file offset.
 */
export function resolveTagDataPointer(pointer: number, header: CacheFileHeader, baseMemoryAddress: number): number {
  return header.tagDataOffset + (pointer - baseMemoryAddress);
}

/**
 * Base address a reader would GUESS from a tag array pointer, assuming the array follows the tag
 * data header. For the Demo/HaloMD converter's classifier only (to tell layouts apart, e.g.
 * 0x40440000 vs the true demo's 0x4BF10000). Never use it to read a CE map: the engine's base is
 * fixed, and a map whose array pointer was moved resolves to garbage in the game even though
 * this guess makes it look fine to us (PRD 2026-10-11 "ADD tag-array growth").
 */
export function inferBaseMemoryAddressForClassifier(tagArrayAddress: number): number {
  return (tagArrayAddress - TAG_DATA_HEADER_PC_SIZE) >>> 0;
}

/**
 * Parses the tag index (tag data header + tag array + tag path strings) for a decompressed
 * Custom Edition map. The base is the fixed `CE_BASE_MEMORY_ADDRESS`, and the tag array must be
 * where Tool puts it, right after the `CacheFileTagDataHeaderPC` (array pointer
 * `CE_TAG_ARRAY_ADDRESS`). Any other array pointer is rejected with
 * `UnexpectedTagArrayAddressError`: earlier builds of this tool wrote such maps with ADD, and the
 * engine can't load them.
 */
export function parseTagIndex(buffer: Buffer, header: CacheFileHeader): TagIndex {
  const tagDataHeaderOffset = header.tagDataOffset;
  if (tagDataHeaderOffset + TAG_DATA_HEADER_PC_SIZE > buffer.length) {
    throw new CorruptMapError('Tag data offset from the header is out of bounds of the file.');
  }

  const tagArrayAddress = buffer.readUInt32LE(tagDataHeaderOffset + 0x00);
  const scenarioTagId = buffer.readUInt32LE(tagDataHeaderOffset + 0x04);
  const tagFileChecksums = buffer.readUInt32LE(tagDataHeaderOffset + 0x08);
  const tagCount = buffer.readUInt32LE(tagDataHeaderOffset + 0x0c);
  const modelPartCount = buffer.readUInt32LE(tagDataHeaderOffset + 0x10);
  const modelDataFileOffset = buffer.readUInt32LE(tagDataHeaderOffset + 0x14);
  const vertexSize = buffer.readUInt32LE(tagDataHeaderOffset + 0x1c);
  const modelDataSize = buffer.readUInt32LE(tagDataHeaderOffset + 0x20);

  const isMcc = header.engine === CacheFileEngine.MCC_CEA || tagArrayAddress === MCC_TAG_ARRAY_ADDRESS;
  const expectedTagArrayAddress = isMcc ? MCC_TAG_ARRAY_ADDRESS : CE_TAG_ARRAY_ADDRESS;
  if (tagArrayAddress !== expectedTagArrayAddress) throw new UnexpectedTagArrayAddressError(tagArrayAddress, expectedTagArrayAddress);
  const tagArrayFileOffset = tagDataHeaderOffset + TAG_DATA_HEADER_PC_SIZE;
  const baseMemoryAddress = isMcc ? MCC_BASE_MEMORY_ADDRESS : CE_BASE_MEMORY_ADDRESS;

  if (tagArrayFileOffset + tagCount * TAG_ENTRY_SIZE > buffer.length) {
    throw new CorruptMapError('Tag count from the tag index is out of bounds of the file (map may be corrupt).');
  }

  const entries: TagIndexEntry[] = [];
  for (let i = 0; i < tagCount; i++) {
    const entryOffset = tagArrayFileOffset + i * TAG_ENTRY_SIZE;
    const primaryClassFourCC = buffer.readUInt32LE(entryOffset + 0x00);
    const secondaryClassFourCC = buffer.readUInt32LE(entryOffset + 0x04);
    const tertiaryClassFourCC = buffer.readUInt32LE(entryOffset + 0x08);
    const tagId = buffer.readUInt32LE(entryOffset + 0x0c);
    const tagPathPointer = buffer.readUInt32LE(entryOffset + 0x10);
    const tagDataPointerOrResourceIndex = buffer.readUInt32LE(entryOffset + 0x14);
    const isExternal = buffer.readUInt32LE(entryOffset + 0x18) === 1;

    const pathFileOffset = resolveTagDataPointer(tagPathPointer, header, baseMemoryAddress);
    if (pathFileOffset < 0 || pathFileOffset >= buffer.length) {
      throw new CorruptMapError(`Tag #${i}: path pointer resolves outside of the file; map may be corrupt or protected.`);
    }
    const path = readCString(buffer, pathFileOffset);

    entries.push({
      index: i,
      tagId,
      primaryClassFourCC,
      secondaryClassFourCC: secondaryClassFourCC === TAG_CLASS_NONE ? null : secondaryClassFourCC,
      tertiaryClassFourCC: tertiaryClassFourCC === TAG_CLASS_NONE ? null : tertiaryClassFourCC,
      primaryClassName: lookupTagClass(primaryClassFourCC)?.name ?? fourCCToString(primaryClassFourCC),
      path,
      isExternal,
      tagDataPointerOrResourceIndex,
    });
  }

  return {
    scenarioTagId,
    tagChecksum: tagFileChecksums,
    tagCount,
    modelPartCount,
    modelDataFileOffset,
    vertexSize,
    modelDataSize,
    baseMemoryAddress,
    entries,
  };
}
