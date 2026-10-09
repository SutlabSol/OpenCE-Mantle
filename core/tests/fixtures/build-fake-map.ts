import { CacheFileEngine, CacheFileLiteral, ScenarioType, TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE, CHIMERA_COMPRESSED_ENGINE_MASK } from '../../src/constants/cache-file';
import { fourCCFromString, TAG_CLASS_NONE } from '../../src/constants/tag-classes';
import { writeFixedString } from '../../src/binary/strings';

export interface FixtureTag {
  primaryClass: string;
  secondaryClass?: string | null;
  tertiaryClass?: string | null;
  tagId: number;
  path: string;
  isExternal?: boolean;
  tagDataPointerOrResourceIndex?: number;
}

export interface FixtureOptions {
  scenarioName?: string;
  buildString?: string;
  mapType?: ScenarioType;
  crc32?: number;
  tags: FixtureTag[];
  baseMemoryAddress?: number;
  scenarioTagId?: number;
  compressed?: boolean;
}

const HEADER_SIZE = 0x800;
const TAG_DATA_OFFSET = HEADER_SIZE; // tag data section starts right after the header

/** Builds a complete, byte-accurate synthetic Custom Edition .map buffer for tests. */
export function buildFakeMap(options: FixtureOptions): Buffer {
  const baseMemoryAddress = options.baseMemoryAddress ?? 0x50000000;
  const tagArrayFileOffset = TAG_DATA_OFFSET + TAG_DATA_HEADER_PC_SIZE;
  const tagArrayAddress = baseMemoryAddress + (tagArrayFileOffset - TAG_DATA_OFFSET);

  const pointerFor = (fileOffset: number) => baseMemoryAddress + (fileOffset - TAG_DATA_OFFSET);

  // Lay out path strings right after the tag array.
  const pathsStart = tagArrayFileOffset + options.tags.length * TAG_ENTRY_SIZE;
  const pathBuffers: Buffer[] = [];
  const pathOffsets: number[] = [];
  let runningOffset = pathsStart;
  for (const tag of options.tags) {
    pathOffsets.push(runningOffset);
    const buf = Buffer.concat([Buffer.from(tag.path, 'ascii'), Buffer.from([0])]);
    pathBuffers.push(buf);
    runningOffset += buf.length;
  }
  const tagDataSectionSize = runningOffset - TAG_DATA_OFFSET;
  const totalSize = TAG_DATA_OFFSET + tagDataSectionSize;

  const buffer = Buffer.alloc(totalSize);

  // --- Header ---
  buffer.writeUInt32LE(CacheFileLiteral.HEAD, 0x0);
  const engineValue = options.compressed
    ? (CacheFileEngine.CUSTOM_EDITION | CHIMERA_COMPRESSED_ENGINE_MASK) >>> 0
    : CacheFileEngine.CUSTOM_EDITION;
  buffer.writeUInt32LE(engineValue, 0x4);
  buffer.writeUInt32LE(totalSize, 0x8); // decompressedFileSize
  buffer.writeUInt32LE(0, 0xc); // compressedPadding
  buffer.writeUInt32LE(TAG_DATA_OFFSET, 0x10);
  buffer.writeUInt32LE(tagDataSectionSize, 0x14);
  writeFixedString(buffer, 0x20, 32, options.scenarioName ?? 'test_scenario');
  writeFixedString(buffer, 0x40, 32, options.buildString ?? '01.00.01.0609');
  buffer.writeUInt16LE(options.mapType ?? ScenarioType.MULTIPLAYER, 0x60);
  buffer.writeUInt32LE(options.crc32 ?? 0xdeadbeef, 0x64);
  buffer.writeUInt32LE(CacheFileLiteral.FOOT, 0x7fc);

  // --- Tag data header (CacheFileTagDataHeaderPC) ---
  buffer.writeUInt32LE(tagArrayAddress, TAG_DATA_OFFSET + 0x00);
  buffer.writeUInt32LE(options.scenarioTagId ?? 0, TAG_DATA_OFFSET + 0x04);
  buffer.writeUInt32LE(0x12345678, TAG_DATA_OFFSET + 0x08); // tagFileChecksums
  buffer.writeUInt32LE(options.tags.length, TAG_DATA_OFFSET + 0x0c);
  buffer.writeUInt32LE(0, TAG_DATA_OFFSET + 0x10); // modelPartCount
  buffer.writeUInt32LE(0, TAG_DATA_OFFSET + 0x14); // modelDataFileOffset
  buffer.writeUInt32LE(0, TAG_DATA_OFFSET + 0x18); // modelPartCountAgain
  buffer.writeUInt32LE(32, TAG_DATA_OFFSET + 0x1c); // vertexSize
  buffer.writeUInt32LE(0, TAG_DATA_OFFSET + 0x20); // modelDataSize
  buffer.writeUInt32LE(CacheFileLiteral.TAGS, TAG_DATA_OFFSET + 0x24);

  // --- Tag array ---
  options.tags.forEach((tag, i) => {
    const entryOffset = tagArrayFileOffset + i * TAG_ENTRY_SIZE;
    buffer.writeUInt32LE(fourCCFromString(tag.primaryClass), entryOffset + 0x00);
    buffer.writeUInt32LE(tag.secondaryClass ? fourCCFromString(tag.secondaryClass) : TAG_CLASS_NONE, entryOffset + 0x04);
    buffer.writeUInt32LE(tag.tertiaryClass ? fourCCFromString(tag.tertiaryClass) : TAG_CLASS_NONE, entryOffset + 0x08);
    buffer.writeUInt32LE(tag.tagId, entryOffset + 0x0c);
    buffer.writeUInt32LE(pointerFor(pathOffsets[i]), entryOffset + 0x10);
    buffer.writeUInt32LE(tag.tagDataPointerOrResourceIndex ?? 0, entryOffset + 0x14);
    buffer.writeUInt32LE(tag.isExternal ? 1 : 0, entryOffset + 0x18);
  });

  // --- Path strings ---
  pathBuffers.forEach((buf, i) => buf.copy(buffer, pathOffsets[i]));

  return buffer;
}
