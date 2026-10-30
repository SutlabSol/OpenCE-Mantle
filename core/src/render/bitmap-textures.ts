import { CorruptMapError } from '../map/errors';
import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { parseResourceMap } from '../map/resource-map';
import { decodeStruct } from '../map/definitions/engine';

export class BitmapTextureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BitmapTextureError';
  }
}

export class UnsupportedBitmapFormatError extends BitmapTextureError {
  constructor(bitmapTagId: number, imageIndex: number, format: number) {
    super(
      `Unsupported bitmap format ${format} (0x${format.toString(16)}) for bitm tag 0x${bitmapTagId.toString(16)} image ${imageIndex}.`,
    );
    this.name = 'UnsupportedBitmapFormatError';
  }
}

/** FourCC for 'bitm' ('b','i','t','m' = 0x6269746d). */
export const BITM_FOURCC = 0x6269746d;

/** Bitmap Format enum values per Halo specification. */
export const BitmapFormat = {
  A8: 0,
  Y8: 1,
  AY8: 2,
  A8Y8: 3,
  R5G6B5: 6,
  A1R5G5B5: 8,
  A4R4G4B4: 9,
  X8R8G8B8: 10,
  A8R8G8B8: 11,
  DXT1: 14,
  DXT3: 15,
  DXT5: 16,
  P8: 17,
} as const;

export interface ShaderRenderMetadata {
  shaderClass: string;
  alphaTested?: boolean;
  alphaBlended?: boolean;
  twoSided?: boolean;
  environmentType?: number; // 0 = normal, 1 = blended, 2 = blended base specular
  detailFunction?: number; // 0 = double/biased multiply, 1 = multiply, 2 = double/biased add
  primaryDetailTagId?: number;
  primaryDetailScale?: number;
  secondaryDetailTagId?: number;
  secondaryDetailScale?: number;
  microDetailTagId?: number;
  microDetailScale?: number;
  bumpMapTagId?: number;
  bumpMapScale?: number;
  uScale?: number;
  vScale?: number;
  decalRadius?: number;
  decalBlendFunction?: number;
  decalIntensity?: number;
  decalTint?: [number, number, number];
}

export interface DecodedRgbaTexture {
  width: number;
  height: number;
  format: number;
  /** RGBA8888 pixel buffer (width * height * 4 bytes) ready for Three.js DataTexture */
  rgbaData: Uint8Array;
  /** Optional Sapien shader metadata when resolved from a shader tag (`senv`, `soso`, `schi`, etc.) */
  shaderMeta?: ShaderRenderMetadata;
}

export interface BitmapImageDescriptor {
  width: number;
  height: number;
  format: number;
  flags: number;
  isExternal: boolean;
  pixelsOffset: number;
  pixelsSize: number;
}

/**
 * Unswizzles a Morton (Z-order) swizzled 2D pixel buffer into linear row-major order.
 * Used for Xbox (`flags & 0x08`) non-DXT textures.
 */
export function unswizzleMorton2D(
  src: Buffer | Uint8Array,
  srcOffset: number,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer {
  const totalBytes = width * height * bytesPerPixel;
  const out = Buffer.alloc(totalBytes);
  if (width <= 1 || height <= 1) {
    Buffer.from(src.buffer, src.byteOffset + srcOffset, Math.min(totalBytes, src.length - srcOffset)).copy(out, 0);
    return out;
  }

  // Build X and Y bit masks following Halo/NV2A Morton curve interleaving
  let maskX = 0;
  let maskY = 0;
  let bit = 1;
  let step = 1;
  while (step < width || step < height) {
    if (step < width) {
      maskX |= bit;
      bit <<= 1;
    }
    if (step < height) {
      maskY |= bit;
      bit <<= 1;
    }
    step <<= 1;
  }

  const spreadBits = (val: number, mask: number): number => {
    let result = 0;
    let v = val;
    let b = 1;
    while (b <= mask && b > 0) {
      if (mask & b) {
        if (v & 1) result |= b;
        v >>>= 1;
      }
      b <<= 1;
    }
    return result;
  };

  const xIndices = new Uint32Array(width);
  for (let x = 0; x < width; x++) {
    xIndices[x] = spreadBits(x, maskX);
  }
  const yIndices = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    yIndices[y] = spreadBits(y, maskY);
  }

  let dstIdx = 0;
  for (let y = 0; y < height; y++) {
    const ySwiz = yIndices[y];
    for (let x = 0; x < width; x++) {
      const swizPixel = (ySwiz | xIndices[x]) * bytesPerPixel;
      const sOff = srcOffset + swizPixel;
      for (let b = 0; b < bytesPerPixel; b++) {
        out[dstIdx++] = src[sOff + b] ?? 0;
      }
    }
  }
  return out;
}

/**
 * Extracts Sapien-grade shader properties (detail maps, detail scales, alpha-testing, two-sided foliage,
 * transparent blending) for `shader_environment` (`senv`), `shader_model` (`soso`), and transparent shaders.
 */
export function resolveShaderRenderMetadata(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  shaderTagId: number,
): ShaderRenderMetadata | undefined {
  const entry = tagIndex.entries.find((e) => e.tagId === shaderTagId);
  if (!entry || entry.isExternal) return undefined;

  const shaderClass = entry.primaryClassName || 'shader';
  const shaderPath = (entry.path || '').toLowerCase();
  const shaderOffset = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  try {
    if (shaderClass === 'shader_environment') {
      const decoded = decodeStruct(buffer, shaderOffset, 'ShaderEnvironment');
      const envFlags = (decoded.get('shader environment flags')?.value as number) ?? 0;
      const envType = (decoded.get('shader environment type')?.value as number) ?? 0;
      const detailFunc = (decoded.get('detail map function')?.value as number) ?? 0;
      const pScale = (decoded.get('primary detail map scale')?.value as number) || 1;
      const pDep = decoded.get('primary detail map');
      const pTagId = pDep && pDep.kind === 'dependency' && pDep.value.tagId !== 0xffffffff ? pDep.value.tagId : undefined;
      const sScale = (decoded.get('secondary detail map scale')?.value as number) || 1;
      const sDep = decoded.get('secondary detail map');
      const sTagId = sDep && sDep.kind === 'dependency' && sDep.value.tagId !== 0xffffffff ? sDep.value.tagId : undefined;
      const mScale = (decoded.get('micro detail map scale')?.value as number) || 1;
      const mDep = decoded.get('micro detail map');
      const mTagId = mDep && mDep.kind === 'dependency' && mDep.value.tagId !== 0xffffffff ? mDep.value.tagId : undefined;
      const bScale = (decoded.get('bump map scale')?.value as number) || 1;
      const bDep = decoded.get('bump map');
      const bTagId = bDep && bDep.kind === 'dependency' && bDep.value.tagId !== 0xffffffff ? bDep.value.tagId : undefined;

      const alphaTested =
        (envFlags & 1) !== 0 ||
        shaderPath.includes('grate') ||
        shaderPath.includes('fence') ||
        shaderPath.includes('ladder') ||
        shaderPath.includes('chainlink') ||
        shaderPath.includes('leaf') ||
        shaderPath.includes('leaves') ||
        shaderPath.includes('fern');

      return {
        shaderClass,
        alphaTested,
        twoSided: alphaTested,
        environmentType: envType,
        detailFunction: detailFunc,
        primaryDetailTagId: pTagId,
        primaryDetailScale: pScale > 0 ? pScale : 1,
        secondaryDetailTagId: sTagId,
        secondaryDetailScale: sScale > 0 ? sScale : 1,
        microDetailTagId: mTagId,
        microDetailScale: mScale > 0 ? mScale : 1,
        bumpMapTagId: bTagId,
        bumpMapScale: bScale > 0 ? bScale : 1,
      };
    }

    if (shaderClass === 'shader_model') {
      const decoded = decodeStruct(buffer, shaderOffset, 'ShaderModel');
      const modelFlags = (decoded.get('shader model flags')?.value as number) ?? 0;
      const twoSided = (modelFlags & 2) !== 0;
      const notAlphaTested = (modelFlags & 4) !== 0;
      const alphaBlendedDecal = (modelFlags & 8) !== 0;
      const uScale = (decoded.get('map u scale')?.value as number) || 1;
      const vScale = (decoded.get('map v scale')?.value as number) || 1;
      const detailFunc = (decoded.get('detail function')?.value as number) ?? 0;
      const dScale = (decoded.get('detail map scale')?.value as number) || 1;
      const dDep = decoded.get('detail map');
      const dTagId = dDep && dDep.kind === 'dependency' && dDep.value.tagId !== 0xffffffff ? dDep.value.tagId : undefined;

      const isFoliagePath =
        shaderPath.includes('leaf') ||
        shaderPath.includes('leaves') ||
        shaderPath.includes('foliage') ||
        shaderPath.includes('branch') ||
        shaderPath.includes('fern') ||
        shaderPath.includes('vine') ||
        shaderPath.includes('bush') ||
        shaderPath.includes('shrub') ||
        shaderPath.includes('pine') ||
        shaderPath.includes('frond');

      return {
        shaderClass,
        twoSided: twoSided || isFoliagePath,
        alphaTested: (twoSided && !notAlphaTested) || isFoliagePath,
        alphaBlended: alphaBlendedDecal,
        detailFunction: detailFunc,
        primaryDetailTagId: dTagId,
        primaryDetailScale: dScale > 0 ? dScale : 1,
        uScale: uScale > 0 ? uScale : 1,
        vScale: vScale > 0 ? vScale : 1,
      };
    }

    if (
      shaderClass.startsWith('shader_transparent') ||
      shaderClass === 'shader_transparent_chicago' ||
      shaderClass === 'shader_transparent_chicago_extended' ||
      shaderClass === 'shader_transparent_generic' ||
      shaderClass === 'shader_transparent_glass' ||
      shaderClass === 'shader_transparent_water' ||
      shaderClass === 'shader_transparent_plasma' ||
      shaderClass === 'shader_transparent_meter'
    ) {
      return {
        shaderClass,
        alphaBlended: true,
        twoSided: true,
      };
    }

    if (shaderClass === 'decal' || entry.primaryClassFourCC === 0x64656361) {
      const decoded = decodeStruct(buffer, shaderOffset, 'Decal');
      const radiusBounds = decoded.get('radius')?.value as [number, number] | undefined;
      const rMin = radiusBounds ? Number(radiusBounds[0]) || 0 : 0;
      const rMax = radiusBounds ? Number(radiusBounds[1]) || 0 : 0;
      let decalRadius = rMax > 0 ? (rMin > 0 ? (rMin + rMax) * 0.5 : rMax) : rMin > 0 ? rMin : 0.65;
      if (!Number.isFinite(decalRadius) || decalRadius <= 0.02) decalRadius = 0.65;
      decalRadius = Math.max(0.15, Math.min(8.0, decalRadius));

      const intensityBounds = decoded.get('intensity')?.value as [number, number] | undefined;
      const iMin = intensityBounds ? Number(intensityBounds[0]) || 0 : 0;
      const iMax = intensityBounds ? Number(intensityBounds[1]) || 0 : 0;
      const decalIntensity = iMax > 0 ? iMax : iMin > 0 ? iMin : 1.0;

      const blendFunc = (decoded.get('framebuffer blend function')?.value as number) ?? 0;
      const colLow = decoded.get('color lower bounds')?.value as [number, number, number] | undefined;
      const colHigh = decoded.get('color upper bounds')?.value as [number, number, number] | undefined;
      let decalTint: [number, number, number] = [1, 1, 1];
      if (colLow && colHigh) {
        const avgR = (colLow[0] + colHigh[0]) * 0.5;
        const avgG = (colLow[1] + colHigh[1]) * 0.5;
        const avgB = (colLow[2] + colHigh[2]) * 0.5;
        if (avgR > 0.02 || avgG > 0.02 || avgB > 0.02) {
          decalTint = [
            Math.min(1, Math.max(0.1, avgR)),
            Math.min(1, Math.max(0.1, avgG)),
            Math.min(1, Math.max(0.1, avgB)),
          ];
        }
      }

      return {
        shaderClass: 'decal',
        alphaBlended: true,
        twoSided: true,
        decalRadius,
        decalBlendFunction: blendFunc,
        decalIntensity: Math.max(0.25, Math.min(1.0, decalIntensity)),
        decalTint,
      };
    }
  } catch {
    // Non-fatal fallback
  }

  return { shaderClass };
}

/**
 * Converts a decoded `decal` (`deca`) bitmap plate into standard alpha-blended RGBA pixels
 * by honoring Halo CE's decal framebuffer blend function (multiply, double-multiply, add, alpha-blend)
 * and tint bounds so decal square borders are 100% transparent.
 */
export function applyDecalBlendToRgba(
  rgbaData: Uint8Array,
  width: number,
  height: number,
  meta: ShaderRenderMetadata,
): void {
  if (width <= 0 || height <= 0 || rgbaData.length < width * height * 4) return;
  const blendFunc = meta.decalBlendFunction ?? 0;
  const intensity = meta.decalIntensity ?? 1.0;
  const [tintR, tintG, tintB] = meta.decalTint ?? [1, 1, 1];

  // Sample the 4 corner pixels to detect whether the bitmap already has an alpha cutout or a solid key background
  const cornerCoords: [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let bgR = 0, bgG = 0, bgB = 0, bgA = 0;
  for (const [cx, cy] of cornerCoords) {
    const idx = (cy * width + cx) * 4;
    bgR += rgbaData[idx + 0];
    bgG += rgbaData[idx + 1];
    bgB += rgbaData[idx + 2];
    bgA += rgbaData[idx + 3];
  }
  bgR /= 4;
  bgG /= 4;
  bgB /= 4;
  bgA /= 4;

  const hasCornerTransparency = bgA < 40;

  for (let y = 0; y < height; y++) {
    const ny = height > 1 ? (y / (height - 1)) * 2 - 1 : 0;
    for (let x = 0; x < width; x++) {
      const nx = width > 1 ? (x / (width - 1)) * 2 - 1 : 0;
      const idx = (y * width + x) * 4;
      const r = rgbaData[idx + 0];
      const g = rgbaData[idx + 1];
      const b = rgbaData[idx + 2];
      const a = rgbaData[idx + 3];

      let outR = Math.round(r * tintR);
      let outG = Math.round(g * tintG);
      let outB = Math.round(b * tintB);
      let outA = a;

      if (blendFunc === 1 || blendFunc === 5) {
        // Multiply / Component-Min: white (255,255,255) is transparent, dark pixels darken the surface
        const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0;
        const darkness = Math.max(0, Math.min(1, (1.0 - lum) * 1.35));
        outA = Math.round(darkness * a * intensity);
      } else if (blendFunc === 2) {
        // Double-Multiply (2 * src * dst): mid-gray (~128,128,128) is transparent
        if (!hasCornerTransparency) {
          const dev = Math.max(Math.abs(r - bgR), Math.abs(g - bgG), Math.abs(b - bgB)) / 128.0;
          const strength = Math.max(0, Math.min(1, dev * 1.65));
          outA = Math.round(strength * a * intensity);
        } else {
          outA = Math.round(a * intensity);
        }
      } else if (blendFunc === 3 || blendFunc === 6 || blendFunc === 7) {
        // Add / Max / Alpha-Multiply-Add: black (0,0,0) is transparent
        const bright = Math.max(r, g, b) / 255.0;
        outA = Math.round(Math.min(1, bright * 1.25) * a * intensity);
      } else {
        // Alpha-Blend (0) or Subtract (4): if bitmap format lacked an alpha channel (bgA > 235), key out the border color
        if (!hasCornerTransparency && bgA > 235) {
          if (bgR > 230 && bgG > 230 && bgB > 230) {
            const lum = (r + g + b) / (3 * 255.0);
            outA = Math.round(Math.max(0, Math.min(1, (1.0 - lum) * 1.35)) * 255 * intensity);
          } else if (bgR < 25 && bgG < 25 && bgB < 25) {
            const bright = Math.max(r, g, b) / 255.0;
            outA = Math.round(Math.min(1, bright * 1.35) * 255 * intensity);
          } else {
            const dev = Math.max(Math.abs(r - bgR), Math.abs(g - bgG), Math.abs(b - bgB)) / 128.0;
            outA = Math.round(Math.max(0, Math.min(1, dev * 1.6)) * 255 * intensity);
          }
        } else {
          outA = Math.round(a * intensity);
        }
      }

      // Soft border feather at the outermost 5% of the quad if corners were originally opaque
      if (!hasCornerTransparency) {
        const edgeDist = Math.max(Math.abs(nx), Math.abs(ny));
        if (edgeDist > 0.9) {
          const fade = Math.max(0, (1.0 - edgeDist) / 0.1);
          outA = Math.round(outA * fade);
        }
      }

      rgbaData[idx + 0] = Math.max(0, Math.min(255, outR));
      rgbaData[idx + 1] = Math.max(0, Math.min(255, outG));
      rgbaData[idx + 2] = Math.max(0, Math.min(255, outB));
      rgbaData[idx + 3] = Math.max(0, Math.min(255, outA));
    }
  }
}

/**
 * Resolves the base diffuse texture bitmap tag from a shader tag using SparkEdit's universal heuristic.
 * Scans the shader's raw metadata buffer for the first valid 'bitm' dependency reference.
 */
export function resolveShaderBaseBitmapTagId(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  shaderTagId: number,
  _depth = 0,
): number | null {
  const entry = tagIndex.entries.find((e) => e.tagId === shaderTagId);
  if (!entry || entry.isExternal) return null;

  const shaderOffset = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  // Scan up to 512 bytes for a 16-byte tag dependency where class is 'bitm'
  const scanLimit = Math.min(shaderOffset + 512, buffer.length - 16);
  for (let off = shaderOffset; off <= scanLimit; off += 4) {
    if (buffer.readUInt32LE(off) === BITM_FOURCC) {
      const tagId = buffer.readUInt32LE(off + 0x0c);
      if (tagId !== 0xffffffff) {
        const targetIdx = tagId & 0xffff;
        if (targetIdx < tagIndex.entries.length) {
          const target = tagIndex.entries[targetIdx];
          if (target && target.primaryClassFourCC === BITM_FOURCC) {
            return tagId;
          }
        }
      }
    }
  }

  // For compound `decal` (`deca`) tags whose bitmap lives on `next decal in chain` (+0x08..+0x17)
  if ((entry.primaryClassName === 'decal' || entry.primaryClassFourCC === 0x64656361) && _depth < 4) {
    if (shaderOffset + 0x18 <= buffer.length) {
      const nextDecalTagId = buffer.readUInt32LE(shaderOffset + 0x08 + 0x0c);
      if (nextDecalTagId !== 0xffffffff && nextDecalTagId !== shaderTagId) {
        return resolveShaderBaseBitmapTagId(buffer, header, tagIndex, nextDecalTagId, _depth + 1);
      }
    }
  }

  return null;
}

/**
 * Reads the 48-byte bitmap image descriptor from a `bitm` tag.
 */
export function readBitmapImageDescriptor(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  bitmapTagId: number,
  imageIndex = 0,
  externalBitmapsBuffer?: Buffer,
): BitmapImageDescriptor {
  const entry = tagIndex.entries.find((e) => e.tagId === bitmapTagId);
  if (!entry) {
    throw new BitmapTextureError(`Bitmap tag (ID: 0x${bitmapTagId.toString(16)}) not found in tag index.`);
  }

  if (entry.isExternal) {
    if (!externalBitmapsBuffer) {
      throw new BitmapTextureError(
        `External bitmaps.map buffer is required to read external bitmap tag "${entry.path}".`,
      );
    }

    const resMap = parseResourceMap(externalBitmapsBuffer);
    const resIndex = entry.tagDataPointerOrResourceIndex;
    if (resIndex >= resMap.entries.length) {
      throw new CorruptMapError(
        `Bitmap tag "${entry.path}" references external resource index ${resIndex} out of bounds (count=${resMap.entries.length}).`,
      );
    }

    const res = resMap.entries[resIndex];
    const tagStart = res.dataOffset;
    if (tagStart + 0x6c > externalBitmapsBuffer.length) {
      throw new CorruptMapError(`Resource entry for bitmap "${entry.path}" exceeds external buffer.`);
    }

    const count = externalBitmapsBuffer.readUInt32LE(tagStart + 0x60);
    const ptrLow = externalBitmapsBuffer.readUInt32LE(tagStart + 0x64);
    if (imageIndex >= count) {
      throw new BitmapTextureError(
        `Bitmap tag "${entry.path}" has ${count} images; requested index ${imageIndex} is out of range.`,
      );
    }

    const rowStart = tagStart + ptrLow + imageIndex * 48;
    if (rowStart + 48 > externalBitmapsBuffer.length) {
      throw new CorruptMapError(`Bitmap descriptor row exceeds external buffer.`);
    }

    const width = externalBitmapsBuffer.readUInt16LE(rowStart + 0x04);
    const height = externalBitmapsBuffer.readUInt16LE(rowStart + 0x06);
    const format = externalBitmapsBuffer.readUInt16LE(rowStart + 0x0c);
    const flags = externalBitmapsBuffer.readUInt16LE(rowStart + 0x0e);
    const pixelsOffset = externalBitmapsBuffer.readUInt32LE(rowStart + 0x18);
    const pixelsSize = externalBitmapsBuffer.readUInt32LE(rowStart + 0x1c);

    return {
      width,
      height,
      format,
      flags,
      isExternal: true,
      pixelsOffset,
      pixelsSize,
    };
  }

  // Internal bitmap tag within .map buffer
  const tagStart = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  const count = buffer.readUInt32LE(tagStart + 0x60);
  const ptrLow = buffer.readUInt32LE(tagStart + 0x64);
  if (imageIndex >= count) {
    throw new BitmapTextureError(
      `Bitmap tag "${entry.path}" has ${count} images; requested index ${imageIndex} is out of range.`,
    );
  }

  const arrayOffset = header.tagDataOffset + (ptrLow - tagIndex.baseMemoryAddress);
  const rowStart = arrayOffset + imageIndex * 48;
  if (rowStart + 48 > buffer.length) {
    throw new CorruptMapError(`Bitmap descriptor row exceeds map buffer.`);
  }

  const width = buffer.readUInt16LE(rowStart + 0x04);
  const height = buffer.readUInt16LE(rowStart + 0x06);
  const format = buffer.readUInt16LE(rowStart + 0x0c);
  const flags = buffer.readUInt16LE(rowStart + 0x0e);
  const pixelsOffset = buffer.readUInt32LE(rowStart + 0x18);
  const pixelsSize = buffer.readUInt32LE(rowStart + 0x1c);

  const isExternal = header.engine !== 5 && ((flags & 0x100) !== 0 || header.engine === 7);

  return {
    width,
    height,
    format,
    flags,
    isExternal,
    pixelsOffset,
    pixelsSize,
  };
}

/** Unpacks an RGB565 16-bit integer into [R, G, B]. */
function unpackRgb565(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) * 255 / 31;
  const g = ((c >> 5) & 0x3f) * 255 / 63;
  const b = (c & 0x1f) * 255 / 31;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** Decompresses DXT1 (BC1) pixel data into an RGBA8888 buffer. */
export function decodeDxt1(data: Buffer | Uint8Array, offset: number, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);

  let src = offset;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      if (src + 8 > data.length) {
        throw new BitmapTextureError(`DXT1 buffer truncated at block (${bx}, ${by}).`);
      }

      const c0 = data[src + 0] | (data[src + 1] << 8);
      const c1 = data[src + 2] | (data[src + 3] << 8);
      const code = data[src + 4] | (data[src + 5] << 8) | (data[src + 6] << 16) | (data[src + 7] << 24);
      src += 8;

      const [r0, g0, b0] = unpackRgb565(c0);
      const [r1, g1, b1] = unpackRgb565(c1);

      // Colors palette
      let colPalette: [number, number, number, number][];
      if (c0 > c1) {
        colPalette = [
          [r0, g0, b0, 255],
          [r1, g1, b1, 255],
          [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3), 255],
          [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3), 255],
        ];
      } else {
        colPalette = [
          [r0, g0, b0, 255],
          [r1, g1, b1, 255],
          [Math.round((r0 + r1) / 2), Math.round((g0 + g1) / 2), Math.round((b0 + b1) / 2), 255],
          [0, 0, 0, 0],
        ];
      }

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const pixelX = bx * 4 + px;
          const pixelY = by * 4 + py;
          if (pixelX < width && pixelY < height) {
            const shift = (py * 4 + px) * 2;
            const colorIdx = (code >> shift) & 0x03;
            const [r, g, b, a] = colPalette[colorIdx];
            const dstIdx = (pixelY * width + pixelX) * 4;
            rgba[dstIdx + 0] = r;
            rgba[dstIdx + 1] = g;
            rgba[dstIdx + 2] = b;
            rgba[dstIdx + 3] = a;
          }
        }
      }
    }
  }

  return rgba;
}

/** Decompresses DXT3 (BC2) pixel data into an RGBA8888 buffer. */
export function decodeDxt3(data: Buffer | Uint8Array, offset: number, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);

  let src = offset;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      if (src + 16 > data.length) {
        throw new BitmapTextureError(`DXT3 buffer truncated at block (${bx}, ${by}).`);
      }

      // First 8 bytes: 16 x 4-bit explicit alphas
      const alphaBytes = [
        data[src + 0], data[src + 1], data[src + 2], data[src + 3],
        data[src + 4], data[src + 5], data[src + 6], data[src + 7],
      ];
      src += 8;

      const c0 = data[src + 0] | (data[src + 1] << 8);
      const c1 = data[src + 2] | (data[src + 3] << 8);
      const code = data[src + 4] | (data[src + 5] << 8) | (data[src + 6] << 16) | (data[src + 7] << 24);
      src += 8;

      const [r0, g0, b0] = unpackRgb565(c0);
      const [r1, g1, b1] = unpackRgb565(c1);

      const colPalette: [number, number, number][] = [
        [r0, g0, b0],
        [r1, g1, b1],
        [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3)],
        [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3)],
      ];

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const pixelX = bx * 4 + px;
          const pixelY = by * 4 + py;
          if (pixelX < width && pixelY < height) {
            const linearIdx = py * 4 + px;
            const aByte = alphaBytes[linearIdx >> 1];
            const a4 = (linearIdx & 1) === 0 ? (aByte & 0x0f) : (aByte >> 4);
            const a = a4 | (a4 << 4);

            const shift = linearIdx * 2;
            const colorIdx = (code >> shift) & 0x03;
            const [r, g, b] = colPalette[colorIdx];

            const dstIdx = (pixelY * width + pixelX) * 4;
            rgba[dstIdx + 0] = r;
            rgba[dstIdx + 1] = g;
            rgba[dstIdx + 2] = b;
            rgba[dstIdx + 3] = a;
          }
        }
      }
    }
  }

  return rgba;
}

/** Decompresses DXT5 (BC3) pixel data into an RGBA8888 buffer. */
export function decodeDxt5(data: Buffer | Uint8Array, offset: number, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);

  let src = offset;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      if (src + 16 > data.length) {
        throw new BitmapTextureError(`DXT5 buffer truncated at block (${bx}, ${by}).`);
      }

      // First 8 bytes: interpolated alpha
      const a0 = data[src + 0];
      const a1 = data[src + 1];
      const aBits = BigInt(data[src + 2]) |
        (BigInt(data[src + 3]) << 8n) |
        (BigInt(data[src + 4]) << 16n) |
        (BigInt(data[src + 5]) << 24n) |
        (BigInt(data[src + 6]) << 32n) |
        (BigInt(data[src + 7]) << 40n);
      src += 8;

      let alphaPalette: number[];
      if (a0 > a1) {
        alphaPalette = [
          a0,
          a1,
          Math.round((6 * a0 + 1 * a1) / 7),
          Math.round((5 * a0 + 2 * a1) / 7),
          Math.round((4 * a0 + 3 * a1) / 7),
          Math.round((3 * a0 + 4 * a1) / 7),
          Math.round((2 * a0 + 5 * a1) / 7),
          Math.round((1 * a0 + 6 * a1) / 7),
        ];
      } else {
        alphaPalette = [
          a0,
          a1,
          Math.round((4 * a0 + 1 * a1) / 5),
          Math.round((3 * a0 + 2 * a1) / 5),
          Math.round((2 * a0 + 3 * a1) / 5),
          Math.round((1 * a0 + 4 * a1) / 5),
          0,
          255,
        ];
      }

      const c0 = data[src + 0] | (data[src + 1] << 8);
      const c1 = data[src + 2] | (data[src + 3] << 8);
      const code = data[src + 4] | (data[src + 5] << 8) | (data[src + 6] << 16) | (data[src + 7] << 24);
      src += 8;

      const [r0, g0, b0] = unpackRgb565(c0);
      const [r1, g1, b1] = unpackRgb565(c1);

      const colPalette: [number, number, number][] = [
        [r0, g0, b0],
        [r1, g1, b1],
        [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3)],
        [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3)],
      ];

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const pixelX = bx * 4 + px;
          const pixelY = by * 4 + py;
          if (pixelX < width && pixelY < height) {
            const linearIdx = py * 4 + px;
            const alphaIdx = Number((aBits >> BigInt(linearIdx * 3)) & 0x07n);
            const a = alphaPalette[alphaIdx];

            const shift = linearIdx * 2;
            const colorIdx = (code >> shift) & 0x03;
            const [r, g, b] = colPalette[colorIdx];

            const dstIdx = (pixelY * width + pixelX) * 4;
            rgba[dstIdx + 0] = r;
            rgba[dstIdx + 1] = g;
            rgba[dstIdx + 2] = b;
            rgba[dstIdx + 3] = a;
          }
        }
      }
    }
  }

  return rgba;
}

/**
 * Decodes a bitmap tag's image plate into standard RGBA8888 pixels.
 */
export function decodeBitmapTagImage(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  bitmapTagId: number,
  imageIndex = 0,
  externalBitmapsBuffer?: Buffer,
): DecodedRgbaTexture {
  const desc = readBitmapImageDescriptor(
    buffer,
    header,
    tagIndex,
    bitmapTagId,
    imageIndex,
    externalBitmapsBuffer,
  );

  const srcBuffer = desc.isExternal ? externalBitmapsBuffer : buffer;
  if (!srcBuffer) {
    throw new BitmapTextureError(`Missing source buffer for bitmap tag 0x${bitmapTagId.toString(16)}.`);
  }

  if (desc.pixelsOffset + desc.pixelsSize > srcBuffer.length) {
    throw new BitmapTextureError(
      `Bitmap pixel data (offset 0x${desc.pixelsOffset.toString(16)}, size ${desc.pixelsSize}) exceeds buffer length (${srcBuffer.length}).`,
    );
  }

  const { width, height, format, flags } = desc;
  const isSwizzled =
    (flags & 0x08) !== 0 &&
    format !== BitmapFormat.DXT1 &&
    format !== BitmapFormat.DXT3 &&
    format !== BitmapFormat.DXT5;

  const bytesPerPixel =
    format === BitmapFormat.X8R8G8B8 || format === BitmapFormat.A8R8G8B8
      ? 4
      : format === BitmapFormat.R5G6B5 ||
          format === BitmapFormat.A1R5G5B5 ||
          format === BitmapFormat.A4R4G4B4 ||
          format === BitmapFormat.A8Y8
        ? 2
        : 1;

  const pixelSrc: Buffer = isSwizzled
    ? unswizzleMorton2D(srcBuffer, desc.pixelsOffset, width, height, bytesPerPixel)
    : srcBuffer;
  const pixelsOffset = isSwizzled ? 0 : desc.pixelsOffset;

  switch (format) {
    case BitmapFormat.DXT1: {
      const rgbaData = decodeDxt1(srcBuffer, desc.pixelsOffset, width, height);
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.DXT3: {
      const rgbaData = decodeDxt3(srcBuffer, desc.pixelsOffset, width, height);
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.DXT5: {
      const rgbaData = decodeDxt5(srcBuffer, desc.pixelsOffset, width, height);
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.X8R8G8B8:
    case BitmapFormat.A8R8G8B8: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const b = pixelSrc[src + 0];
        const g = pixelSrc[src + 1];
        const r = pixelSrc[src + 2];
        const a = format === BitmapFormat.X8R8G8B8 ? 255 : pixelSrc[src + 3];
        src += 4;
        rgbaData[dst + 0] = r;
        rgbaData[dst + 1] = g;
        rgbaData[dst + 2] = b;
        rgbaData[dst + 3] = a;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.R5G6B5: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const val = pixelSrc.readUInt16LE(src);
        src += 2;
        const [r, g, b] = unpackRgb565(val);
        rgbaData[dst + 0] = r;
        rgbaData[dst + 1] = g;
        rgbaData[dst + 2] = b;
        rgbaData[dst + 3] = 255;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.A1R5G5B5: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const val = pixelSrc.readUInt16LE(src);
        src += 2;
        const a = (val & 0x8000) ? 255 : 0;
        const r = Math.round(((val >> 10) & 0x1f) * 255 / 31);
        const g = Math.round(((val >> 5) & 0x1f) * 255 / 31);
        const b = Math.round((val & 0x1f) * 255 / 31);
        rgbaData[dst + 0] = r;
        rgbaData[dst + 1] = g;
        rgbaData[dst + 2] = b;
        rgbaData[dst + 3] = a;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.A4R4G4B4: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const val = pixelSrc.readUInt16LE(src);
        src += 2;
        const a = ((val >> 12) & 0x0f) * 17;
        const r = ((val >> 8) & 0x0f) * 17;
        const g = ((val >> 4) & 0x0f) * 17;
        const b = (val & 0x0f) * 17;
        rgbaData[dst + 0] = r;
        rgbaData[dst + 1] = g;
        rgbaData[dst + 2] = b;
        rgbaData[dst + 3] = a;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.A8: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const a = pixelSrc[src++];
        rgbaData[dst + 0] = 255;
        rgbaData[dst + 1] = 255;
        rgbaData[dst + 2] = 255;
        rgbaData[dst + 3] = a;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.Y8:
    case BitmapFormat.P8: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const y = pixelSrc[src++];
        rgbaData[dst + 0] = y;
        rgbaData[dst + 1] = y;
        rgbaData[dst + 2] = y;
        rgbaData[dst + 3] = 255;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.AY8: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const val = pixelSrc[src++];
        rgbaData[dst + 0] = val;
        rgbaData[dst + 1] = val;
        rgbaData[dst + 2] = val;
        rgbaData[dst + 3] = val;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    case BitmapFormat.A8Y8: {
      const rgbaData = new Uint8Array(width * height * 4);
      let src = pixelsOffset;
      let dst = 0;
      for (let i = 0; i < width * height; i++) {
        const y = pixelSrc[src + 0];
        const a = pixelSrc[src + 1];
        src += 2;
        rgbaData[dst + 0] = y;
        rgbaData[dst + 1] = y;
        rgbaData[dst + 2] = y;
        rgbaData[dst + 3] = a;
        dst += 4;
      }
      return { width, height, format, rgbaData };
    }
    default:
      throw new UnsupportedBitmapFormatError(bitmapTagId, imageIndex, format);
  }
}
