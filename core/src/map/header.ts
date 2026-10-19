import {
  CACHE_FILE_HEADER_SIZE,
  CacheFileEngine,
  CacheFileLiteral,
  CHIMERA_COMPRESSED_ENGINE_MASK,
  ScenarioType,
  TAG_STRING_SIZE,
} from '../constants/cache-file';
import { readFixedString, writeFixedString } from '../binary/strings';
import { CorruptMapError, UnsupportedMapVersionError } from './errors';

/**
 * Parsed form of `CacheFileHeader` (invader/hek/map.hpp). Layout (2048 bytes total):
 *   0x000 head_literal      uint32  "head"
 *   0x004 engine            uint32  CacheFileEngine
 *   0x008 decompressedFileSize uint32
 *   0x00C compressedPadding uint32
 *   0x010 tagDataOffset     uint32
 *   0x014 tagDataSize       uint32
 *   0x018 ..0x01F           PAD(8)
 *   0x020 scenarioName      char[32]
 *   0x040 buildString       char[32]
 *   0x060 mapType           uint16  ScenarioType
 *   0x062 ..0x063           PAD(2)
 *   0x064 crc32             uint32
 *   0x068 ..0x7FB           PAD(0x794)
 *   0x7FC foot_literal      uint32  "foot"
 */
export interface CacheFileHeader {
  engine: CacheFileEngine;
  decompressedFileSize: number;
  compressedPadding: number;
  tagDataOffset: number;
  tagDataSize: number;
  scenarioName: string;
  buildString: string;
  mapType: ScenarioType;
  crc32: number;
}

export function hasValidMagic(buffer: Buffer): boolean {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) {
    return false;
  }
  return buffer.readUInt32LE(0x0) === CacheFileLiteral.HEAD && buffer.readUInt32LE(0x7fc) === CacheFileLiteral.FOOT;
}

/**
 * Returns true if the header's `engine` field matches a Chimera-compressed Custom Edition
 * marker (engine OR'd with 0x861A0000). See CHIMERA_COMPRESSED_ENGINE_MASK for the citation
 * and the stated assumption. Full decompression is Milestone 2 - this is detection only.
 */
export function isChimeraCompressedCustomEdition(buffer: Buffer): boolean {
  if (!hasValidMagic(buffer)) {
    return false;
  }
  const engine = buffer.readUInt32LE(0x4);
  return (engine & 0xffff0000) >>> 0 === CHIMERA_COMPRESSED_ENGINE_MASK && (engine & 0xffff) === CacheFileEngine.CUSTOM_EDITION;
}

/**
 * Parses and validates the 2048-byte Custom Edition map header.
 * Throws CorruptMapError if the file is too small or magic values don't match.
 * Throws UnsupportedMapVersionError if the engine is a recognized-but-out-of-scope version
 * (Xbox, retail, demo, MCC CEA, native) per project SCOPE.
 */
export function parseCacheFileHeader(buffer: Buffer): CacheFileHeader {
  if (buffer.length < CACHE_FILE_HEADER_SIZE) {
    throw new CorruptMapError(
      `File is only ${buffer.length} bytes; a Halo CE map header is at least ${CACHE_FILE_HEADER_SIZE} bytes.`,
    );
  }

  if (!hasValidMagic(buffer)) {
    throw new CorruptMapError('Missing "head"/"foot" magic values. This does not look like a Halo map file.');
  }

  const engine = buffer.readUInt32LE(0x4);
  if (
    engine !== CacheFileEngine.CUSTOM_EDITION &&
    engine !== CacheFileEngine.RETAIL &&
    engine !== CacheFileEngine.MCC_CEA
  ) {
    throw new UnsupportedMapVersionError(engine);
  }

  return {
    engine,
    decompressedFileSize: buffer.readUInt32LE(0x8),
    compressedPadding: buffer.readUInt32LE(0xc),
    tagDataOffset: buffer.readUInt32LE(0x10),
    tagDataSize: buffer.readUInt32LE(0x14),
    scenarioName: readFixedString(buffer, 0x20, TAG_STRING_SIZE),
    buildString: readFixedString(buffer, 0x40, TAG_STRING_SIZE),
    mapType: buffer.readUInt16LE(0x60),
    crc32: buffer.readUInt32LE(0x64),
  };
}

/** Serializes a CacheFileHeader back into a fresh 2048-byte Buffer (or writes into `out` if given). */
export function serializeCacheFileHeader(header: CacheFileHeader, out?: Buffer): Buffer {
  const buffer = out ?? Buffer.alloc(CACHE_FILE_HEADER_SIZE);
  buffer.writeUInt32LE(CacheFileLiteral.HEAD, 0x0);
  buffer.writeUInt32LE(header.engine, 0x4);
  buffer.writeUInt32LE(header.decompressedFileSize, 0x8);
  buffer.writeUInt32LE(header.compressedPadding, 0xc);
  buffer.writeUInt32LE(header.tagDataOffset, 0x10);
  buffer.writeUInt32LE(header.tagDataSize, 0x14);
  writeFixedString(buffer, 0x20, TAG_STRING_SIZE, header.scenarioName);
  writeFixedString(buffer, 0x40, TAG_STRING_SIZE, header.buildString);
  buffer.writeUInt16LE(header.mapType, 0x60);
  buffer.writeUInt32LE(header.crc32, 0x64);
  buffer.writeUInt32LE(CacheFileLiteral.FOOT, 0x7fc);
  return buffer;
}
