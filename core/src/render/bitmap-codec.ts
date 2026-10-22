import * as zlib from 'zlib';
import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { parseResourceMap } from '../map/resource-map';
import { CorruptMapError } from '../map/errors';
import {
  BitmapFormat,
  BitmapTextureError,
  readBitmapImageDescriptor,
  decodeBitmapTagImage,
  type BitmapImageDescriptor,
} from './bitmap-textures';

export interface BitmapSequenceInfo {
  name: string;
  firstSubImageIndex: number;
  subImageCount: number;
}

export interface BitmapImageInfo {
  index: number;
  width: number;
  height: number;
  depth: number;
  type: number;
  typeName: string;
  format: number;
  formatName: string;
  flags: number;
  mipmapCount: number;
  pixelDataOffset: number;
  pixelDataSize: number;
  isExternal: boolean;
}

export interface BitmapTagSummary {
  tagId: number;
  tagIndex: number;
  path: string;
  type: number;
  typeName: string;
  format: number;
  formatName: string;
  usage: number;
  usageName: string;
  isExternal: boolean;
  imageCount: number;
  images: BitmapImageInfo[];
  sequences: BitmapSequenceInfo[];
}

export const BITMAP_TYPE_NAMES = [
  '2D Textures',
  '3D Textures',
  'Cube Maps',
  'Sprites',
  'Interface Bitmaps',
] as const;

export const BITMAP_DATA_TYPE_NAMES = [
  '2D Texture',
  '3D Texture',
  'Cube Map',
  'White',
] as const;

export const BITMAP_FORMAT_NAMES: Record<number, string> = {
  [BitmapFormat.A8]: 'A8 (8-bit Alpha)',
  [BitmapFormat.Y8]: 'Y8 (8-bit Greyscale)',
  [BitmapFormat.AY8]: 'AY8 (8-bit Alpha-Greyscale)',
  [BitmapFormat.A8Y8]: 'A8Y8 (16-bit Alpha-Greyscale)',
  [BitmapFormat.R5G6B5]: 'R5G6B5 (16-bit RGB 565)',
  [BitmapFormat.A1R5G5B5]: 'A1R5G5B5 (16-bit ARGB 1555)',
  [BitmapFormat.A4R4G4B4]: 'A4R4G4B4 (16-bit ARGB 4444)',
  [BitmapFormat.X8R8G8B8]: 'X8R8G8B8 (32-bit RGB 888)',
  [BitmapFormat.A8R8G8B8]: 'A8R8G8B8 (32-bit ARGB 8888)',
  [BitmapFormat.DXT1]: 'DXT1 (BC1 Compressed RGB)',
  [BitmapFormat.DXT3]: 'DXT3 (BC2 Compressed Explicit Alpha)',
  [BitmapFormat.DXT5]: 'DXT5 (BC3 Compressed Interpolated Alpha)',
  [BitmapFormat.P8]: 'P8 (8-bit Paletted / Bump)',
};

export const BITMAP_USAGE_NAMES = [
  'Alpha Blend',
  'Default',
  'Height Map',
  'Detail Map',
  'Light Map',
  'Vector Map',
] as const;

/**
 * Inspects a `bitm` tag in the given map and extracts its sequences and image plates.
 */
export function inspectBitmapTag(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  bitmapTagId: number,
  externalBitmapsBuffer?: Buffer,
): BitmapTagSummary {
  const entryIdx = bitmapTagId & 0xffff;
  const entry = tagIndex.entries[entryIdx];
  if (!entry || entry.tagId !== bitmapTagId) {
    throw new BitmapTextureError(`Bitmap tag (ID: 0x${bitmapTagId.toString(16)}) not found.`);
  }

  let tagStart = 0;
  let isExternal = entry.isExternal;
  let srcBuf = buffer;

  if (isExternal) {
    if (!externalBitmapsBuffer) {
      throw new BitmapTextureError(`External bitmaps.map required for tag "${entry.path}".`);
    }
    const resMap = parseResourceMap(externalBitmapsBuffer);
    const resIdx = entry.tagDataPointerOrResourceIndex;
    if (resIdx >= resMap.entries.length) {
      throw new CorruptMapError(`External resource index ${resIdx} out of range.`);
    }
    tagStart = resMap.entries[resIdx].dataOffset;
    srcBuf = externalBitmapsBuffer;
  } else {
    tagStart = resolveTagDataPointer(
      entry.tagDataPointerOrResourceIndex,
      header,
      tagIndex.baseMemoryAddress,
    );
  }

  const rootType = srcBuf.readUInt16LE(tagStart + 0x00);
  const rootFormat = srcBuf.readUInt16LE(tagStart + 0x02);
  const rootUsage = srcBuf.readUInt16LE(tagStart + 0x04);

  // Sequences reflexive: count at 0x54, ptr at 0x58
  const seqCount = srcBuf.readUInt32LE(tagStart + 0x54);
  const seqPtr = srcBuf.readUInt32LE(tagStart + 0x58);

  const sequences: BitmapSequenceInfo[] = [];
  if (seqCount > 0 && seqCount < 1000) {
    const seqBase = isExternal
      ? tagStart + seqPtr
      : header.tagDataOffset + (seqPtr - tagIndex.baseMemoryAddress);

    for (let i = 0; i < seqCount; i++) {
      const row = seqBase + i * 64;
      if (row + 64 <= srcBuf.length) {
        let name = '';
        for (let b = 0; b < 32; b++) {
          const ch = srcBuf[row + b];
          if (ch === 0) break;
          name += String.fromCharCode(ch);
        }
        const firstSubImage = srcBuf.readUInt16LE(row + 0x20);
        const subImageCount = srcBuf.readUInt16LE(row + 0x22);
        sequences.push({
          name: name.trim() || `sequence_${i}`,
          firstSubImageIndex: firstSubImage,
          subImageCount,
        });
      }
    }
  }

  // Bitmaps reflexive: count at 0x60, ptr at 0x64
  const imgCount = srcBuf.readUInt32LE(tagStart + 0x60);
  const imgPtr = srcBuf.readUInt32LE(tagStart + 0x64);

  const images: BitmapImageInfo[] = [];
  const imgBase = isExternal
    ? tagStart + imgPtr
    : header.tagDataOffset + (imgPtr - tagIndex.baseMemoryAddress);

  for (let i = 0; i < imgCount; i++) {
    const row = imgBase + i * 48;
    if (row + 48 <= srcBuf.length) {
      const width = srcBuf.readUInt16LE(row + 0x04);
      const height = srcBuf.readUInt16LE(row + 0x06);
      const depth = srcBuf.readUInt16LE(row + 0x08);
      const type = srcBuf.readUInt16LE(row + 0x0a);
      const format = srcBuf.readUInt16LE(row + 0x0c);
      const flags = srcBuf.readUInt16LE(row + 0x0e);
      const mipmapCount = srcBuf.readUInt16LE(row + 0x14);
      const pixelDataOffset = srcBuf.readUInt32LE(row + 0x18);
      const pixelDataSize = srcBuf.readUInt32LE(row + 0x1c);

      const imgExternal = header.engine !== 5 && ((flags & 0x100) !== 0 || header.engine === 7 || isExternal);

      images.push({
        index: i,
        width,
        height,
        depth: depth || 1,
        type,
        typeName: BITMAP_DATA_TYPE_NAMES[type] ?? `Type ${type}`,
        format,
        formatName: BITMAP_FORMAT_NAMES[format] ?? `Format ${format}`,
        flags,
        mipmapCount,
        pixelDataOffset,
        pixelDataSize,
        isExternal: imgExternal,
      });
    }
  }

  return {
    tagId: bitmapTagId,
    tagIndex: entryIdx,
    path: entry.path,
    type: rootType,
    typeName: BITMAP_TYPE_NAMES[rootType] ?? `Type ${rootType}`,
    format: rootFormat,
    formatName: BITMAP_FORMAT_NAMES[rootFormat] ?? `Format ${rootFormat}`,
    usage: rootUsage,
    usageName: BITMAP_USAGE_NAMES[rootUsage] ?? `Usage ${rootUsage}`,
    isExternal,
    imageCount: images.length,
    images,
    sequences,
  };
}

/* ----------------------------------- PNG Encoder & Decoder ----------------------------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Standard CRC32 table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function pngCrc32(buf: Buffer, offset = 0, length = buf.length): number {
  let crc = 0xffffffff;
  for (let i = offset; i < offset + length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  const crc = pngCrc32(chunk, 4, 4 + data.length);
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

/**
 * Encodes standard RGBA8888 pixels into a PNG Buffer.
 */
export function encodeRgbaToPng(rgba: Uint8Array, width: number, height: number): Buffer {
  const scanlineLength = 1 + width * 4;
  const rawScanlines = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawScanlines[rowOffset] = 0; // Filter type 0 (None)
    const srcRow = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      rawScanlines[rowOffset + 1 + x] = rgba[srcRow + x];
    }
  }

  const deflated = zlib.deflateSync(rawScanlines, { level: 6 });

  // IHDR chunk (13 bytes)
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression: 0
  ihdr[11] = 0; // Filter: 0
  ihdr[12] = 0; // Interlace: 0

  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', deflated);
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Decodes a PNG Buffer into standard RGBA8888 pixels.
 */
export function decodePngToRgba(pngBuffer: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (pngBuffer.length < 8 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature.');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= pngBuffer.length) {
    const chunkLen = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const chunkData = pngBuffer.subarray(offset + 8, offset + 8 + chunkLen);

    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }

    offset += 12 + chunkLen;
  }

  if (width <= 0 || height <= 0) {
    throw new Error('PNG has invalid dimensions.');
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const scanlineLen = 1 + width * bpp;

  const rgba = new Uint8Array(width * height * 4);

  let prevRow: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const rowStart = y * scanlineLen;
    const filter = inflated[rowStart];
    const currentRow = new Uint8Array(width * bpp);

    for (let i = 0; i < width * bpp; i++) {
      let byte = inflated[rowStart + 1 + i];
      const left = i >= bpp ? currentRow[i - bpp] : 0;
      const up = prevRow ? prevRow[i] : 0;
      const upLeft = prevRow && i >= bpp ? prevRow[i - bpp] : 0;

      if (filter === 1) {
        byte = (byte + left) & 0xff;
      } else if (filter === 2) {
        byte = (byte + up) & 0xff;
      } else if (filter === 3) {
        byte = (byte + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        let pr = left;
        if (pb < pa) pr = up;
        if (pc < pb && pc < pa) pr = upLeft;
        byte = (byte + pr) & 0xff;
      }
      currentRow[i] = byte;
    }

    // Convert row into RGBA8888
    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      if (colorType === 6) {
        const srcIdx = x * 4;
        rgba[dstIdx + 0] = currentRow[srcIdx + 0];
        rgba[dstIdx + 1] = currentRow[srcIdx + 1];
        rgba[dstIdx + 2] = currentRow[srcIdx + 2];
        rgba[dstIdx + 3] = currentRow[srcIdx + 3];
      } else if (colorType === 2) {
        const srcIdx = x * 3;
        rgba[dstIdx + 0] = currentRow[srcIdx + 0];
        rgba[dstIdx + 1] = currentRow[srcIdx + 1];
        rgba[dstIdx + 2] = currentRow[srcIdx + 2];
        rgba[dstIdx + 3] = 255;
      } else {
        const gray = currentRow[x];
        rgba[dstIdx + 0] = gray;
        rgba[dstIdx + 1] = gray;
        rgba[dstIdx + 2] = gray;
        rgba[dstIdx + 3] = 255;
      }
    }

    prevRow = currentRow;
  }

  return { width, height, rgba };
}

/* ----------------------------------- DDS Encoder & Decoder ----------------------------------- */

const DDS_MAGIC = 0x20534444; // "DDS "

/**
 * Encodes pixel data into a standard DirectDraw Surface (.dds) container.
 */
export function encodeToDds(
  imageData: Uint8Array | Buffer,
  width: number,
  height: number,
  format: number,
  mipmapCount = 1,
): Buffer {
  const header = Buffer.alloc(128);
  header.writeUInt32LE(DDS_MAGIC, 0); // "DDS "
  header.writeUInt32LE(124, 4); // dwSize (124)
  header.writeUInt32LE(0x00021007, 8); // DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);

  let linearSize = imageData.length;
  if (format === BitmapFormat.DXT1) {
    linearSize = Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 8;
  } else if (format === BitmapFormat.DXT3 || format === BitmapFormat.DXT5) {
    linearSize = Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * 16;
  }
  header.writeUInt32LE(linearSize, 20); // dwPitchOrLinearSize
  header.writeUInt32LE(0, 24); // dwDepth
  header.writeUInt32LE(mipmapCount || 1, 28); // dwMipMapCount

  // ddspf (32 bytes at offset 76)
  header.writeUInt32LE(32, 76); // dwSize

  if (format === BitmapFormat.DXT1) {
    header.writeUInt32LE(0x04, 80); // DDPF_FOURCC
    header.write('DXT1', 84, 4, 'ascii');
  } else if (format === BitmapFormat.DXT3) {
    header.writeUInt32LE(0x04, 80); // DDPF_FOURCC
    header.write('DXT3', 84, 4, 'ascii');
  } else if (format === BitmapFormat.DXT5) {
    header.writeUInt32LE(0x04, 80); // DDPF_FOURCC
    header.write('DXT5', 84, 4, 'ascii');
  } else {
    // Uncompressed RGBA8888
    header.writeUInt32LE(0x41, 80); // DDPF_RGB | DDPF_ALPHAPIXELS
    header.writeUInt32LE(32, 88); // dwRGBBitCount
    header.writeUInt32LE(0x00ff0000, 92); // R mask
    header.writeUInt32LE(0x0000ff00, 96); // G mask
    header.writeUInt32LE(0x000000ff, 100); // B mask
    header.writeUInt32LE(0xff000000, 104); // A mask
  }

  header.writeUInt32LE(0x1000, 108); // dwCaps = DDSCAPS_TEXTURE

  return Buffer.concat([header, Buffer.from(imageData)]);
}

/* ---------------------------------- Fast DXT1 / DXT5 Encoder ---------------------------------- */

function packRgb565(r: number, g: number, b: number): number {
  return (((r >> 3) & 0x1f) << 11) | (((g >> 2) & 0x3f) << 5) | ((b >> 3) & 0x1f);
}

function unpackRgb565Fast(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) * 255 / 31;
  const g = ((c >> 5) & 0x3f) * 255 / 63;
  const b = (c & 0x1f) * 255 / 31;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr * 2 + dg * dg * 4 + db * db * 3;
}

/**
 * Encodes RGBA8888 pixels into DXT1 (BC1) compressed blocks.
 */
export function encodeRgbaToDxt1(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(blocksX * blocksY * 8);

  let dst = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let minR = 255, minG = 255, minB = 255;
      let maxR = 0, maxG = 0, maxB = 0;

      // Scan 4x4 block bounding box
      const blockPixels: [number, number, number][] = [];
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = Math.min(width - 1, bx * 4 + px);
          const y = Math.min(height - 1, by * 4 + py);
          const idx = (y * width + x) * 4;
          const r = rgba[idx + 0];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          blockPixels.push([r, g, b]);
          if (r < minR) minR = r;
          if (g < minG) minG = g;
          if (b < minB) minB = b;
          if (r > maxR) maxR = r;
          if (g > maxG) maxG = g;
          if (b > maxB) maxB = b;
        }
      }

      let c0 = packRgb565(maxR, maxG, maxB);
      let c1 = packRgb565(minR, minG, minB);
      if (c0 === c1) {
        c0 = packRgb565(Math.min(255, maxR + 4), maxG, maxB);
      }
      if (c0 < c1) {
        const tmp = c0;
        c0 = c1;
        c1 = tmp;
      }

      const [r0, g0, b0] = unpackRgb565Fast(c0);
      const [r1, g1, b1] = unpackRgb565Fast(c1);

      const palette: [number, number, number][] = [
        [r0, g0, b0],
        [r1, g1, b1],
        [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3)],
        [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3)],
      ];

      let code = 0;
      for (let i = 0; i < 16; i++) {
        const [pr, pg, pb] = blockPixels[i];
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let p = 0; p < 4; p++) {
          const d = colorDistSq(pr, pg, pb, palette[p][0], palette[p][1], palette[p][2]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = p;
          }
        }
        code |= bestIdx << (i * 2);
      }

      out[dst + 0] = c0 & 0xff;
      out[dst + 1] = (c0 >> 8) & 0xff;
      out[dst + 2] = c1 & 0xff;
      out[dst + 3] = (c1 >> 8) & 0xff;
      out[dst + 4] = code & 0xff;
      out[dst + 5] = (code >> 8) & 0xff;
      out[dst + 6] = (code >> 16) & 0xff;
      out[dst + 7] = (code >> 24) & 0xff;
      dst += 8;
    }
  }

  return out;
}

/**
 * Encodes RGBA8888 pixels into DXT5 (BC3) compressed blocks.
 */
export function encodeRgbaToDxt5(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(blocksX * blocksY * 16);

  let dst = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let minA = 255, maxA = 0;
      let minR = 255, minG = 255, minB = 255;
      let maxR = 0, maxG = 0, maxB = 0;

      const blockPixels: [number, number, number, number][] = [];
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = Math.min(width - 1, bx * 4 + px);
          const y = Math.min(height - 1, by * 4 + py);
          const idx = (y * width + x) * 4;
          const r = rgba[idx + 0];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const a = rgba[idx + 3];
          blockPixels.push([r, g, b, a]);
          if (a < minA) minA = a;
          if (a > maxA) maxA = a;
          if (r < minR) minR = r;
          if (g < minG) minG = g;
          if (b < minB) minB = b;
          if (r > maxR) maxR = r;
          if (g > maxG) maxG = g;
          if (b > maxB) maxB = b;
        }
      }

      // --- 1. Encode 8 bytes alpha ---
      let a0 = maxA;
      let a1 = minA;
      if (a0 === a1) {
        a0 = Math.min(255, maxA + 1);
      }
      out[dst + 0] = a0;
      out[dst + 1] = a1;

      const alphaPalette = [
        a0,
        a1,
        Math.round((6 * a0 + 1 * a1) / 7),
        Math.round((5 * a0 + 2 * a1) / 7),
        Math.round((4 * a0 + 3 * a1) / 7),
        Math.round((3 * a0 + 4 * a1) / 7),
        Math.round((2 * a0 + 5 * a1) / 7),
        Math.round((1 * a0 + 6 * a1) / 7),
      ];

      let aBits = 0n;
      for (let i = 0; i < 16; i++) {
        const aVal = blockPixels[i][3];
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let p = 0; p < 8; p++) {
          const d = Math.abs(aVal - alphaPalette[p]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = p;
          }
        }
        aBits |= BigInt(bestIdx) << BigInt(i * 3);
      }

      out[dst + 2] = Number(aBits & 0xffn);
      out[dst + 3] = Number((aBits >> 8n) & 0xffn);
      out[dst + 4] = Number((aBits >> 16n) & 0xffn);
      out[dst + 5] = Number((aBits >> 24n) & 0xffn);
      out[dst + 6] = Number((aBits >> 32n) & 0xffn);
      out[dst + 7] = Number((aBits >> 40n) & 0xffn);

      // --- 2. Encode 8 bytes RGB DXT1 ---
      let c0 = packRgb565(maxR, maxG, maxB);
      let c1 = packRgb565(minR, minG, minB);
      if (c0 === c1) {
        c0 = packRgb565(Math.min(255, maxR + 4), maxG, maxB);
      }
      if (c0 < c1) {
        const tmp = c0;
        c0 = c1;
        c1 = tmp;
      }

      const [r0, g0, b0] = unpackRgb565Fast(c0);
      const [r1, g1, b1] = unpackRgb565Fast(c1);

      const colorPalette: [number, number, number][] = [
        [r0, g0, b0],
        [r1, g1, b1],
        [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3)],
        [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3)],
      ];

      let code = 0;
      for (let i = 0; i < 16; i++) {
        const [pr, pg, pb] = blockPixels[i];
        let bestDist = Infinity;
        let bestIdx = 0;
        for (let p = 0; p < 4; p++) {
          const d = colorDistSq(pr, pg, pb, colorPalette[p][0], colorPalette[p][1], colorPalette[p][2]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = p;
          }
        }
        code |= bestIdx << (i * 2);
      }

      out[dst + 8] = c0 & 0xff;
      out[dst + 9] = (c0 >> 8) & 0xff;
      out[dst + 10] = c1 & 0xff;
      out[dst + 11] = (c1 >> 8) & 0xff;
      out[dst + 12] = code & 0xff;
      out[dst + 13] = (code >> 8) & 0xff;
      out[dst + 14] = (code >> 16) & 0xff;
      out[dst + 15] = (code >> 24) & 0xff;

      dst += 16;
    }
  }

  return out;
}

/**
 * Downsamples RGBA8888 buffer by 2x in width and height using a 2x2 box filter.
 */
export function downsampleRgba2x(
  src: Uint8Array,
  srcW: number,
  srcH: number,
): { dst: Uint8Array; dstW: number; dstH: number } {
  const dstW = Math.max(1, Math.floor(srcW / 2));
  const dstH = Math.max(1, Math.floor(srcH / 2));
  const dst = new Uint8Array(dstW * dstH * 4);

  for (let y = 0; y < dstH; y++) {
    const srcY0 = Math.min(srcH - 1, y * 2);
    const srcY1 = Math.min(srcH - 1, y * 2 + 1);
    for (let x = 0; x < dstW; x++) {
      const srcX0 = Math.min(srcW - 1, x * 2);
      const srcX1 = Math.min(srcW - 1, x * 2 + 1);

      const p00 = (srcY0 * srcW + srcX0) * 4;
      const p10 = (srcY0 * srcW + srcX1) * 4;
      const p01 = (srcY1 * srcW + srcX0) * 4;
      const p11 = (srcY1 * srcW + srcX1) * 4;

      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx + 0] = Math.round((src[p00 + 0] + src[p10 + 0] + src[p01 + 0] + src[p11 + 0]) / 4);
      dst[dstIdx + 1] = Math.round((src[p00 + 1] + src[p10 + 1] + src[p01 + 1] + src[p11 + 1]) / 4);
      dst[dstIdx + 2] = Math.round((src[p00 + 2] + src[p10 + 2] + src[p01 + 2] + src[p11 + 2]) / 4);
      dst[dstIdx + 3] = Math.round((src[p00 + 3] + src[p10 + 3] + src[p01 + 3] + src[p11 + 3]) / 4);
    }
  }
  return { dst, dstW, dstH };
}

/**
 * Encodes RGBA8888 pixels into the full mipmap chain for the specified format.
 * Returns the combined byte buffer and the number of downsampled mip levels.
 */
export function encodeBitmapWithMipmaps(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: number,
  generateMips = true,
): { pixelData: Uint8Array; mipmapCount: number } {
  const buffers: Uint8Array[] = [];
  let curRgba = rgba;
  let curW = width;
  let curH = height;

  const maxMips = generateMips ? Math.floor(Math.log2(Math.max(width, height))) : 0;

  for (let level = 0; level <= maxMips; level++) {
    let levelBytes: Uint8Array;
    if (format === BitmapFormat.DXT1) {
      levelBytes = encodeRgbaToDxt1(curRgba, curW, curH);
    } else if (format === BitmapFormat.DXT5) {
      levelBytes = encodeRgbaToDxt5(curRgba, curW, curH);
    } else {
      // Uncompressed ARGB (Halo PC stores as B8G8R8A8 in memory/disk)
      levelBytes = new Uint8Array(curW * curH * 4);
      for (let i = 0; i < curRgba.length; i += 4) {
        levelBytes[i + 0] = curRgba[i + 2]; // B
        levelBytes[i + 1] = curRgba[i + 1]; // G
        levelBytes[i + 2] = curRgba[i + 0]; // R
        levelBytes[i + 3] = curRgba[i + 3]; // A
      }
    }
    buffers.push(levelBytes);

    if (level < maxMips) {
      const down = downsampleRgba2x(curRgba, curW, curH);
      curRgba = down.dst;
      curW = down.dstW;
      curH = down.dstH;
    }
  }

  // Concatenate all mip levels
  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }

  return { pixelData: out, mipmapCount: maxMips };
}

/**
 * Replaces an existing bitmap image plate's pixels with new compressed or raw bytes.
 * If external, internalizes the tag definition and image data directly into the map's raw data partition.
 */
export function replaceBitmapImageData(
  mapBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  bitmapTagId: number,
  imageIndex: number,
  newPixels: Uint8Array | Buffer,
  newWidth: number,
  newHeight: number,
  newFormat: number,
  externalBitmapsBuffer?: Buffer,
  newMipmapCount?: number,
): Buffer {
  const entryIdx = bitmapTagId & 0xffff;
  const entry = tagIndex.entries[entryIdx];
  if (!entry) {
    throw new BitmapTextureError(`Bitmap tag (ID 0x${bitmapTagId.toString(16)}) not found.`);
  }

  const isPowerOfTwo =
    newWidth > 0 &&
    newHeight > 0 &&
    (newWidth & (newWidth - 1)) === 0 &&
    (newHeight & (newHeight - 1)) === 0;
  const isCompressed =
    newFormat === BitmapFormat.DXT1 ||
    newFormat === BitmapFormat.DXT3 ||
    newFormat === BitmapFormat.DXT5;
  const isPalettized = newFormat === BitmapFormat.P8;

  const computeBitmapFlags = (oldFlags: number): number => {
    // Clear external (0x0100), power-of-two (0x0001), compressed (0x0002), palettized (0x0004), swizzled (0x0008)
    let flags = oldFlags & ~(0x0100 | 0x0001 | 0x0002 | 0x0004 | 0x0008);
    flags |= 0x0080; // _bitmap_cached_bit
    if (isPowerOfTwo) flags |= 0x0001; // _bitmap_has_power_of_two_dimensions_bit
    if (isCompressed) flags |= 0x0002; // _bitmap_compressed_bit
    if (isPalettized) flags |= 0x0004; // _bitmap_palettized_bit
    return flags;
  };

  // Branch 1: Tag is currently EXTERNAL (definition lives in bitmaps.map)
  if (entry.isExternal) {
    if (!externalBitmapsBuffer) {
      throw new BitmapTextureError(
        `External bitmaps.map buffer required to internalize external bitmap "${entry.path}".`,
      );
    }
    const resMap = parseResourceMap(externalBitmapsBuffer);
    const resIdx = entry.tagDataPointerOrResourceIndex;
    if (resIdx >= resMap.entries.length) {
      throw new CorruptMapError(`External resource index ${resIdx} out of bounds.`);
    }

    const resEntry = resMap.entries[resIdx];
    const rawTagBytes = externalBitmapsBuffer.subarray(resEntry.dataOffset, resEntry.dataOffset + resEntry.size);
    const tagCopy = Buffer.from(rawTagBytes);

    const imgCount = tagCopy.readUInt32LE(0x60);
    const imgPtrRel = tagCopy.readUInt32LE(0x64);
    if (imageIndex >= imgCount) {
      throw new BitmapTextureError(`Image index ${imageIndex} out of range (count=${imgCount}).`);
    }

    // Align append offset for tag struct
    const tagStartInMap = (mapBuffer.length + 3) & ~3;
    const tagVirtualAddress = tagIndex.baseMemoryAddress + (tagStartInMap - header.tagDataOffset);

    // Rebase sequences reflexive if present
    const seqCount = tagCopy.readUInt32LE(0x54);
    const seqPtrRel = tagCopy.readUInt32LE(0x58);
    if (seqCount > 0) {
      tagCopy.writeUInt32LE(tagVirtualAddress + seqPtrRel, 0x58);
    }

    // Rebase bitmaps reflexive
    tagCopy.writeUInt32LE(tagVirtualAddress + imgPtrRel, 0x64);

    // Align append offset for pixel data (right after tag struct)
    const pixelsStartInMap = (tagStartInMap + tagCopy.length + 3) & ~3;

    // Update target BitmapData row in tagCopy
    const rowOffset = imgPtrRel + imageIndex * 48;
    tagCopy.writeUInt16LE(newWidth, rowOffset + 0x04);
    tagCopy.writeUInt16LE(newHeight, rowOffset + 0x06);
    tagCopy.writeUInt16LE(newFormat, rowOffset + 0x0c);
    tagCopy.writeUInt16LE(Math.floor(newWidth / 2), rowOffset + 0x10);
    tagCopy.writeUInt16LE(Math.floor(newHeight / 2), rowOffset + 0x12);
    if (newMipmapCount !== undefined) {
      tagCopy.writeUInt16LE(newMipmapCount, rowOffset + 0x14);
    }

    const oldFlags = tagCopy.readUInt16LE(rowOffset + 0x0e);
    tagCopy.writeUInt16LE(computeBitmapFlags(oldFlags), rowOffset + 0x0e);

    // Set map file offset and byte length
    tagCopy.writeUInt32LE(pixelsStartInMap, rowOffset + 0x18);
    tagCopy.writeUInt32LE(newPixels.length, rowOffset + 0x1c);

    // Allocate expanded map buffer
    const totalNewLength = pixelsStartInMap + newPixels.length;
    const outBuffer = Buffer.alloc(totalNewLength);
    mapBuffer.copy(outBuffer, 0);
    tagCopy.copy(outBuffer, tagStartInMap);
    Buffer.from(newPixels).copy(outBuffer, pixelsStartInMap);

    // Rebase tag table entry in map
    const tagArrayOffset = header.tagDataOffset + 0x28;
    const entryOffset = tagArrayOffset + entryIdx * 32;
    outBuffer.writeUInt32LE(tagVirtualAddress, entryOffset + 0x14);
    outBuffer.writeUInt32LE(0, entryOffset + 0x18); // isExternal = false

    // Update in-memory TagIndex entry
    entry.tagDataPointerOrResourceIndex = tagVirtualAddress;
    entry.isExternal = false;

    // Update map header tagDataSize and fileLength
    const newTagDataSize = totalNewLength - header.tagDataOffset;
    outBuffer.writeUInt32LE(totalNewLength, 0x08); // fileLength
    outBuffer.writeUInt32LE(newTagDataSize, 0x14); // tagDataSize
    header.tagDataSize = newTagDataSize;
    header.decompressedFileSize = totalNewLength;

    return outBuffer;
  }

  // Branch 2: Tag is ALREADY INTERNAL in mapBuffer
  const tagStart = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  const imgCount = mapBuffer.readUInt32LE(tagStart + 0x60);
  const imgPtr = mapBuffer.readUInt32LE(tagStart + 0x64);
  if (imageIndex >= imgCount) {
    throw new BitmapTextureError(`Image index ${imageIndex} out of range (count=${imgCount}).`);
  }

  const arrayOffset = header.tagDataOffset + (imgPtr - tagIndex.baseMemoryAddress);
  const rowStart = arrayOffset + imageIndex * 48;

  const oldSize = mapBuffer.readUInt32LE(rowStart + 0x1c);
  const oldOffset = mapBuffer.readUInt32LE(rowStart + 0x18);
  const oldFlags = mapBuffer.readUInt16LE(rowStart + 0x0e);

  let outputBuffer = mapBuffer;
  let targetOffset = oldOffset;
  let finalTagStart = tagStart;
  let finalRowStart = rowStart;

  // If new pixel payload fits in-place inside the map and wasn't external, overwrite in-place!
  const isImageExternal = (oldFlags & 0x100) !== 0;
  if (!isImageExternal && newPixels.length <= oldSize && oldOffset + newPixels.length <= mapBuffer.length) {
    Buffer.from(newPixels).copy(outputBuffer, oldOffset);
  } else {
    // Check if the map uses the standard [raw data][model data][tag data] layout:
    // If so, insert the new pixel bytes at `modelDataFileOffset` (end of raw-data region)
    // so `tagDataSize` is never inflated with raw pixel bytes and future tag injections succeed.
    const insertAt = tagIndex.modelDataFileOffset;
    const modelDataSize = tagIndex.modelDataSize;
    if (
      insertAt > 0 &&
      insertAt + modelDataSize === header.tagDataOffset &&
      header.tagDataOffset + header.tagDataSize === mapBuffer.length
    ) {
      const shift = (newPixels.length + 3) & ~3;
      const newBuf = Buffer.alloc(mapBuffer.length + shift, 0);
      mapBuffer.copy(newBuf, 0, 0, insertAt);
      Buffer.from(newPixels).copy(newBuf, insertAt);
      mapBuffer.copy(newBuf, insertAt + shift, insertAt);

      const newTagDataOffset = header.tagDataOffset + shift;
      const newModelDataFileOffset = insertAt + shift;
      newBuf.writeUInt32LE(newBuf.length, 0x08); // fileLength
      newBuf.writeUInt32LE(newTagDataOffset, 0x10); // tagDataOffset
      newBuf.writeUInt32LE(newModelDataFileOffset, newTagDataOffset + 0x14); // modelDataFileOffset

      header.decompressedFileSize = newBuf.length;
      header.tagDataOffset = newTagDataOffset;
      tagIndex.modelDataFileOffset = newModelDataFileOffset;

      outputBuffer = newBuf;
      targetOffset = insertAt;
      finalTagStart = tagStart + shift;
      finalRowStart = rowStart + shift;
    } else {
      // Fallback for non-standard map layouts: append at end of map buffer
      const alignedAppendOffset = (mapBuffer.length + 3) & ~3;
      const newBuf = Buffer.alloc(alignedAppendOffset + newPixels.length);
      mapBuffer.copy(newBuf, 0);
      Buffer.from(newPixels).copy(newBuf, alignedAppendOffset);
      outputBuffer = newBuf;
      targetOffset = alignedAppendOffset;

      const newTagDataSize = outputBuffer.length - header.tagDataOffset;
      outputBuffer.writeUInt32LE(outputBuffer.length, 0x08);
      outputBuffer.writeUInt32LE(newTagDataSize, 0x14);
      header.tagDataSize = newTagDataSize;
      header.decompressedFileSize = outputBuffer.length;
    }
  }

  // Update root Bitmap encoding format (+0x02) if single-image bitmap
  if (imgCount === 1) {
    const rootEncoding =
      newFormat === BitmapFormat.DXT1
        ? 1
        : newFormat === BitmapFormat.DXT3
          ? 2
          : newFormat === BitmapFormat.DXT5
            ? 3
            : 4;
    outputBuffer.writeUInt16LE(rootEncoding, finalTagStart + 0x02);
  }

  // Update BitmapData struct row (48 bytes)
  outputBuffer.writeUInt16LE(newWidth, finalRowStart + 0x04);
  outputBuffer.writeUInt16LE(newHeight, finalRowStart + 0x06);
  outputBuffer.writeUInt16LE(newFormat, finalRowStart + 0x0c);
  outputBuffer.writeUInt16LE(Math.floor(newWidth / 2), finalRowStart + 0x10);
  outputBuffer.writeUInt16LE(Math.floor(newHeight / 2), finalRowStart + 0x12);
  if (newMipmapCount !== undefined) {
    outputBuffer.writeUInt16LE(newMipmapCount, finalRowStart + 0x14);
  }

  // Set accurate Halo CE BitmapData flags (power-of-two, compressed/uncompressed, cached, internal)
  outputBuffer.writeUInt16LE(computeBitmapFlags(oldFlags), finalRowStart + 0x0e);

  outputBuffer.writeUInt32LE(targetOffset, finalRowStart + 0x18);
  outputBuffer.writeUInt32LE(newPixels.length, finalRowStart + 0x1c);

  return outputBuffer;
}
