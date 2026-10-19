import { compress as zstdCompress, decompress as zstdDecompress } from '@mongodb-js/zstd';
import {
  CACHE_FILE_HEADER_SIZE,
  CacheFileEngine,
  CHIMERA_COMPRESSED_ENGINE_MASK,
} from '../constants/cache-file';
import { hasValidMagic, isChimeraCompressedCustomEdition, parseCacheFileHeader } from './header';
import { CorruptMapError, NotCompressedMapError, UnsupportedMapVersionError } from './errors';

/**
 * Milestone 2: decompress/recompress.
 *
 * ALGORITHM SOURCE (format reference only, GPL-3.0-only, not copied as code):
 *   Chimera (SnowyMouse/chimera) `src/chimera/halo_data/map.hpp` (CacheFileEngine enum,
 *   confirms CACHE_FILE_CUSTOM_EDITION_COMPRESSED = 0x861A0261 = 0x861A0000 | 0x261) and
 *   `src/chimera/map_loading/compression.cpp` (zstd streaming decompression, header stays
 *   2048 bytes, everything after it is a zstd frame).
 *   https://github.com/SnowyMouse/chimera/blob/master/src/chimera/halo_data/map.hpp
 *   https://github.com/SnowyMouse/chimera/blob/master/src/chimera/map_loading/compression.cpp
 *
 * STATED DEVIATION FROM THE REFERENCE (per project instructions: state assumptions rather
 * than silently guess): Chimera's own `decompress_header()` zeroes the header's `file_size`
 * field in the decompressed output (it does not reconstruct the true decompressed size at
 * that point in its low-memory streaming code path). We instead copy the ENTIRE 2048-byte
 * header through verbatim in both directions and only ever patch the 4-byte `engine` field.
 * This guarantees a perfect byte-identical round trip (decompress(compress(x)) === x) and
 * keeps `decompressedFileSize`/`crc32`/etc. accurate, which cannot break Chimera's own
 * loader (it does not depend on that field being zero). No real Chimera-compressed sample
 * map was available to diff against; this was validated via self round-trip on the user's
 * real bloodgulch.map (see /app/core/tests/compression.test.ts).
 */

const CUSTOM_EDITION_COMPRESSED_ENGINE = (CacheFileEngine.CUSTOM_EDITION | CHIMERA_COMPRESSED_ENGINE_MASK) >>> 0;

/** Compresses a decompressed Custom Edition map using zstd (level 19, matching Chimera's chimera-compress tool). */
export async function compressCustomEditionMap(buffer: Buffer, level = 19): Promise<Buffer> {
  // Validates magic + engine === CUSTOM_EDITION (609); throws a friendly error otherwise.
  const header = parseCacheFileHeader(buffer);
  if (header.engine !== CacheFileEngine.CUSTOM_EDITION) {
    throw new UnsupportedMapVersionError(header.engine);
  }

  const body = buffer.subarray(CACHE_FILE_HEADER_SIZE);
  const compressedBody = await zstdCompress(Buffer.from(body), level);

  const output = Buffer.alloc(CACHE_FILE_HEADER_SIZE + compressedBody.length);
  buffer.copy(output, 0, 0, CACHE_FILE_HEADER_SIZE);
  output.writeUInt32LE(CUSTOM_EDITION_COMPRESSED_ENGINE, 0x4);
  compressedBody.copy(output, CACHE_FILE_HEADER_SIZE);

  return output;
}

/** Decompresses a Chimera-compressed Custom Edition map back to a standalone, standard .map. */
export async function decompressCustomEditionMap(buffer: Buffer): Promise<Buffer> {
  if (!hasValidMagic(buffer)) {
    throw new CorruptMapError('Missing "head"/"foot" magic values. This does not look like a Halo map file.');
  }
  if (!isChimeraCompressedCustomEdition(buffer)) {
    throw new NotCompressedMapError();
  }
  if (buffer.length <= CACHE_FILE_HEADER_SIZE) {
    throw new CorruptMapError('Compressed map has no body data after the header.');
  }

  const compressedBody = buffer.subarray(CACHE_FILE_HEADER_SIZE);
  const decompressedBody = await zstdDecompress(Buffer.from(compressedBody));

  const output = Buffer.alloc(CACHE_FILE_HEADER_SIZE + decompressedBody.length);
  buffer.copy(output, 0, 0, CACHE_FILE_HEADER_SIZE);
  output.writeUInt32LE(CacheFileEngine.CUSTOM_EDITION, 0x4);
  decompressedBody.copy(output, CACHE_FILE_HEADER_SIZE);

  return output;
}
