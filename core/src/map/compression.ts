import * as zlib from 'zlib';
import { compress as zstdCompress, decompress as zstdDecompress } from '@mongodb-js/zstd';
import {
  CACHE_FILE_HEADER_SIZE,
  CacheFileEngine,
  CHIMERA_COMPRESSED_ENGINE_MASK,
} from '../constants/cache-file';
import { hasValidMagic, isChimeraCompressedCustomEdition, parseCacheFileHeader } from './header';
import { CorruptMapError, NotCompressedMapError, UnsupportedMapVersionError } from './errors';

const CUSTOM_EDITION_COMPRESSED_ENGINE = (CacheFileEngine.CUSTOM_EDITION | CHIMERA_COMPRESSED_ENGINE_MASK) >>> 0;

/** Compresses a decompressed Custom Edition map using zstd (level 19, matching Chimera's chimera-compress tool). */
export async function compressCustomEditionMap(buffer: Buffer, level = 19): Promise<Buffer> {
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

/**
 * Transparently decompresses an Xbox (`engine === 5`) cache file if its body is zlib-compressed.
 * On disk, Xbox `.map` files have a standard 2048-byte header followed by a zlib-deflated body.
 * Returns the original buffer unchanged if it is not an Xbox map or is already decompressed.
 */
export function ensureXboxMapDecompressed(buffer: Buffer): Buffer {
  if (!hasValidMagic(buffer)) return buffer;
  const engine = buffer.readUInt32LE(0x4);
  if (engine !== CacheFileEngine.XBOX) return buffer;

  const decompressedFileSize = buffer.readUInt32LE(0x8);
  const tagDataOffset = buffer.readUInt32LE(0x10);
  if (
    buffer.length >= decompressedFileSize &&
    tagDataOffset + 0x24 <= buffer.length &&
    buffer.readUInt32LE(tagDataOffset) === 0x803a6024
  ) {
    return buffer;
  }

  // Only inflate if the body after the 2048-byte header starts with a valid zlib header (CMF = 0x78)
  if (buffer.length <= CACHE_FILE_HEADER_SIZE || buffer[CACHE_FILE_HEADER_SIZE] !== 0x78) {
    return buffer;
  }

  try {
    const inflated = zlib.inflateSync(buffer.subarray(CACHE_FILE_HEADER_SIZE));
    const totalSize = Math.max(decompressedFileSize, CACHE_FILE_HEADER_SIZE + inflated.length);
    const out = Buffer.alloc(totalSize, 0xca);
    buffer.copy(out, 0, 0, CACHE_FILE_HEADER_SIZE);
    inflated.copy(out, CACHE_FILE_HEADER_SIZE);
    return out;
  } catch {
    return buffer;
  }
}
