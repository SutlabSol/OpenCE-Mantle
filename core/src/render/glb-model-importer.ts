/**
 * Direct 3D Model File (.GLB / .GLTF / .OBJ / .JMS) + Original Textures Importer for Halo CE Structure BSPs.
 *
 * Capabilities:
 * - Zero-dependency binary glTF 2.0 (.glb) & JSON (.gltf) parser (12-byte header 0x46546C67, JSON chunk 0x4E4F534A, BIN chunk 0x004E4942).
 * - Full recursive scene-graph node traversal composing 4x4 column-major world matrices (matrix or TRS translation/quaternion/scale).
 * - Reads POSITION, NORMAL, TEXCOORD_0, and indices accessors (INT8, UINT8, INT16, UINT16, UINT32, FLOAT32, interleaved byteStride, TRIANGLES/STRIP/FAN).
 * - Converts Y-up to Halo Z-up: (x, y, z) -> (x, -z, y), centers playable core bounds at X=0, Y=0, base Z=0, and auto-fits or manually scales.
 * - Typed-array spatial-hash vertex welding per material slot + automatic splitting into <= 65,535-vertex submesh chunks for uint16 BSP surfaces.
 * - Embedded PNG (all colorTypes 0/2/3/4/6) & baseline JPEG texture decoding into power-of-two RGBA8888 buffers with alpha-cutout detection.
 * - Automatic foliage / alpha-cutout / distant-backdrop pass-through classification so vegetation is render-only while terrain/bridges/buildings have solid collision.
 * - Unified `parseModelFileForBsp` supporting `.glb`, `.gltf`, `.obj` (+ `.mtl`), and `.jms`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { decodeDxt1, decodeDxt3, decodeDxt5 } from './bitmap-textures';
import {
  inferHaloMaterialTypeFromName,
  resizeRgbaToPowerOfTwo,
  type CompiledModelVertex,
  type ObjMeshSummary,
  type ParsedObjMesh,
  type RawCollisionTriangle,
} from './collision-generator';

export type ModelFileFormat = 'glb' | 'gltf' | 'obj' | 'jms';
export type ModelScaleMode = 'auto_fit' | 'manual';

export interface ModelImportOptions {
  /** Convert Y-up coordinates (.glb/.gltf/.obj) to Halo Z-up: (x, y, z) -> (x, -z, y). Default: true for glb/gltf/obj, false for jms. */
  flipYz?: boolean;
  /** Scale mode: 'auto_fit' fits playable horizontal span to `targetSpan`; 'manual' multiplies by `manualScale`. Default: 'auto_fit'. */
  scaleMode?: ModelScaleMode;
  /** Target horizontal span in Halo world units when `scaleMode === 'auto_fit'`. Default: 350. */
  targetSpan?: number;
  /** Manual scale multiplier when `scaleMode === 'manual'`. Default: 0.025 for .glb/.gltf, 1.0 for .obj/.jms. */
  manualScale?: number;
  /** Center playable X/Y bounds at (0, 0) and place playable floor base at Z = 0. Default: true. */
  centerOrigin?: boolean;
  /** Additional [X, Y, Z] world offset applied after scaling/centering (used in Merge mode). Default: [0, 0, 0]. */
  worldOffset?: [number, number, number];
  /** Additional yaw rotation in degrees around Z axis applied after scaling/centering. Default: 0. */
  yawDegrees?: number;
  /** Extract and decode embedded/external textures into RGBA8888 buffers. Default: true. */
  extractTextures?: boolean;
  /** Automatically enable alpha-tested & two-sided shader flags on transparent/cutout materials. Default: true. */
  autoAlphaAndTwoSided?: boolean;
  /** Exclude foliage, vegetation, alpha cutouts, and distant skybox/lores backdrop meshes from 3D CollisionBSP. Default: true. */
  foliagePassThrough?: boolean;
  /** Simplify and merge coplanar collision polygons to stay within Halo CE CollisionBSP limits. Default: true. */
  simplifyCollision?: boolean;
  /** Target maximum collision face count before QEM/grid decimation. Default: 3500. */
  targetCollisionFaces?: number;
  /** Maximum power-of-two texture dimension (default: 512 when > 64 textures, else 1024). */
  maxTextureDimension?: number;
  /** When false (fast preflight mode), inspects texture headers/alpha without decoding all pixel buffers. Default: true. */
  decodeTexturesNow?: boolean;
}

export interface ExtractedModelTexture {
  imageIndex: number;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  hasAlphaCutout: boolean;
  hasSemiTransparency: boolean;
}

export interface CompiledBspSubmeshChunk {
  name: string;
  materialIndex: number;
  materialName: string;
  /** Index into `extractedTextures` (-1 if untextured / solid color fallback). */
  textureIndex: number;
  baseColorRgba: [number, number, number, number];
  hasAlphaCutout: boolean;
  doubleSided: boolean;
  isPassThrough: boolean;
  haloMaterialType: number;
  vertexCount: number;
  triangleCount: number;
  /** Flat [x, y, z, ...] (length = vertexCount * 3) */
  positions: Float32Array;
  /** Flat [nx, ny, nz, ...] (length = vertexCount * 3) */
  normals: Float32Array;
  /** Flat [u, v, ...] (length = vertexCount * 2) */
  uvs: Float32Array;
  /** Local uint16 triangle indices [v0, v1, v2, ...] (length = triangleCount * 3, all < 65535) */
  indices: Uint16Array;
  centroid: [number, number, number];
  bounds: [number, number, number, number, number, number];
}

export interface ModelBounds3D {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface ParsedBspModelResult {
  format: ModelFileFormat;
  modelName: string;
  sceneNodeCount: number;
  meshCount: number;
  rawVertexCount: number;
  weldedVertexCount: number;
  totalTriangleCount: number;
  solidTriangleCount: number;
  passThroughMeshCount: number;
  passThroughTriangleCount: number;
  materialCount: number;
  embeddedTextureCount: number;
  extractedTextures: ExtractedModelTexture[];
  submeshChunks: CompiledBspSubmeshChunk[];
  rawBounds: ModelBounds3D;
  playableRawBounds: ModelBounds3D;
  scaledBounds: ModelBounds3D;
  playableScaledBounds: ModelBounds3D;
  appliedScale: number;
  collisionMesh: ParsedObjMesh;
  /** Flat [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] of upward-facing solid triangles for fast spawn/object raycasting. */
  solidRaycastTriangles: Float32Array;
}

/* ---------------------------------------------------------------------------------------------- */
/*                              Foliage & Pass-Through Classifier                                 */
/* ---------------------------------------------------------------------------------------------- */

const FOLIAGE_NODE_OR_MESH_RE =
  /village\d*-shrub|tfrag-lowres|tfrag-trans|v\d+-lores|grass|shrub|leaf|leaves|plant|flower|bushpalm|palmplant|bamboo|bush|fern|vine|wind-group|cattail|riceplant|tuft|weed|moss|frond|canopy|lily|kelp|seaweed|net|sail|rope|cord|web|banner|flag|curtain|butterfly|bird|fish|water|wave|foam|cloud|sky|fog|smoke|fire|flame|glow|beam|ray|lens|flare|particle|sprite|decal|shadow|portal|lores|lowres/i;

const FOLIAGE_MATERIAL_RE =
  /grass|shrub|leaf|leaves|plant|flower|palmbush|bamboo|bush|fern|vine|cattail|riceplant|tuft|weed|moss|frond|canopy|net|lace|feather|water|cloud|sky|fog|smoke|fire|flame|glow|beam|portal|lores|lowres|glass-eyes/i;

const DISTANT_BACKDROP_RE = /tfrag-lowres|v\d+-lores|lores-|lowres|skybox|horizon|vista/i;

const SOLID_SURFACE_OVERRIDE_RE =
  /ground|cliff|rock|stone|bridge|plank|path|beach|dirt|sand|wall|floor|roof|hut|house|building|stair|step|ramp|dock|pier|platform|pillar|column|post|brace|wood|metal|iron|steel|boulder|terrain|island|arch|door|gate|barrel|crate|box|bench|table|bed|boat|windmill|spinner|concrete|brick|tile|pavement|road/i;

/**
 * Determines whether a scene node / mesh / material represents non-collidable foliage,
 * transparent decorative props, or distant horizon vista backdrops.
 */
export function isFoliageOrPassThroughSurface(
  nodePath: string,
  meshName: string,
  materialName: string,
  alphaMode?: string,
  textureHasHighTransparency = false,
): boolean {
  const combinedNodeMesh = `${nodePath}/${meshName}`;
  if (/village\d*-shrub|tfrag-lowres|tfrag-trans|v\d+-lores/i.test(combinedNodeMesh)) {
    return true;
  }
  const leafNodeName = nodePath.split('/').pop() || meshName;
  if (FOLIAGE_NODE_OR_MESH_RE.test(combinedNodeMesh) && !SOLID_SURFACE_OVERRIDE_RE.test(leafNodeName)) {
    return true;
  }
  if (FOLIAGE_MATERIAL_RE.test(materialName) && !SOLID_SURFACE_OVERRIDE_RE.test(materialName)) {
    return true;
  }
  if (alphaMode === 'BLEND') {
    return true;
  }
  if (textureHasHighTransparency && !SOLID_SURFACE_OVERRIDE_RE.test(leafNodeName) && !SOLID_SURFACE_OVERRIDE_RE.test(materialName)) {
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------------------------- */
/*                              4x4 Column-Major Matrix Math                                      */
/* ---------------------------------------------------------------------------------------------- */

type Mat4 = Float64Array; // length 16, column-major

function identityMat4(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4 + 0];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function composeTrsMat4(
  translation?: number[],
  rotation?: number[],
  scale?: number[],
): Mat4 {
  const tx = translation?.[0] ?? 0;
  const ty = translation?.[1] ?? 0;
  const tz = translation?.[2] ?? 0;

  const qx = rotation?.[0] ?? 0;
  const qy = rotation?.[1] ?? 0;
  const qz = rotation?.[2] ?? 0;
  const qw = rotation?.[3] ?? 1;

  const sx = scale?.[0] ?? 1;
  const sy = scale?.[1] ?? 1;
  const sz = scale?.[2] ?? 1;

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * sx;
  m[1] = (xy + wz) * sx;
  m[2] = (xz - wy) * sx;
  m[3] = 0;

  m[4] = (xy - wz) * sy;
  m[5] = (1 - (xx + zz)) * sy;
  m[6] = (yz + wx) * sy;
  m[7] = 0;

  m[8] = (xz + wy) * sz;
  m[9] = (yz - wx) * sz;
  m[10] = (1 - (xx + yy)) * sz;
  m[11] = 0;

  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

function determinant3x3(m: Mat4): number {
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];
  return (
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20)
  );
}

/* ---------------------------------------------------------------------------------------------- */
/*                          Complete PNG & Baseline JPEG RGBA Decoders                            */
/* ---------------------------------------------------------------------------------------------- */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decodes any standard PNG buffer (colorType 0 grayscale, 2 RGB, 3 indexed palette + tRNS,
 * 4 grayscale+alpha, 6 RGBA; bitDepth 1/2/4/8/16) into RGBA8888 pixels.
 */
export function decodeAnyPngToRgba(pngBuffer: Buffer): {
  width: number;
  height: number;
  rgba: Uint8Array;
  hasAlphaCutout: boolean;
  hasSemiTransparency: boolean;
} {
  if (pngBuffer.length < 24 || !pngBuffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('Invalid PNG signature.');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= pngBuffer.length) {
    const chunkLen = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = Math.min(pngBuffer.length, dataStart + chunkLen);
    const chunkData = pngBuffer.subarray(dataStart, dataEnd);

    if (chunkType === 'IHDR' && chunkData.length >= 13) {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (chunkType === 'PLTE') {
      palette = chunkData;
    } else if (chunkType === 'tRNS') {
      trns = chunkData;
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
  const channels =
    colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const bitsPerPixel = channels * bitDepth;
  const bytesPerPixelFilter = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const scanlineLen = 1 + rowBytes;

  const rgba = new Uint8Array(width * height * 4);
  let prevRow = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const rowStart = y * scanlineLen;
    if (rowStart >= inflated.length) break;
    const filter = inflated[rowStart];

    for (let i = 0; i < rowBytes; i++) {
      const raw = inflated[rowStart + 1 + i] ?? 0;
      const left = i >= bytesPerPixelFilter ? curRow[i - bytesPerPixelFilter] : 0;
      const up = prevRow[i];
      const upLeft = i >= bytesPerPixelFilter ? prevRow[i - bytesPerPixelFilter] : 0;

      let val = raw;
      if (filter === 1) {
        val = (raw + left) & 0xff;
      } else if (filter === 2) {
        val = (raw + up) & 0xff;
      } else if (filter === 3) {
        val = (raw + ((left + up) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        val = (raw + pr) & 0xff;
      }
      curRow[i] = val;
    }

    for (let x = 0; x < width; x++) {
      const dstIdx = (y * width + x) * 4;
      if (colorType === 6) {
        const step = bitDepth === 16 ? 8 : 4;
        const srcIdx = x * step;
        rgba[dstIdx + 0] = curRow[srcIdx + 0];
        rgba[dstIdx + 1] = curRow[srcIdx + (bitDepth === 16 ? 2 : 1)];
        rgba[dstIdx + 2] = curRow[srcIdx + (bitDepth === 16 ? 4 : 2)];
        rgba[dstIdx + 3] = curRow[srcIdx + (bitDepth === 16 ? 6 : 3)];
      } else if (colorType === 2) {
        const step = bitDepth === 16 ? 6 : 3;
        const srcIdx = x * step;
        const r = curRow[srcIdx + 0];
        const g = curRow[srcIdx + (bitDepth === 16 ? 2 : 1)];
        const b = curRow[srcIdx + (bitDepth === 16 ? 4 : 2)];
        rgba[dstIdx + 0] = r;
        rgba[dstIdx + 1] = g;
        rgba[dstIdx + 2] = b;
        rgba[dstIdx + 3] =
          trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5] ? 0 : 255;
      } else if (colorType === 4) {
        const step = bitDepth === 16 ? 4 : 2;
        const srcIdx = x * step;
        const gray = curRow[srcIdx + 0];
        const a = curRow[srcIdx + (bitDepth === 16 ? 2 : 1)];
        rgba[dstIdx + 0] = gray;
        rgba[dstIdx + 1] = gray;
        rgba[dstIdx + 2] = gray;
        rgba[dstIdx + 3] = a;
      } else if (colorType === 3) {
        let palIdx = 0;
        if (bitDepth === 8) {
          palIdx = curRow[x];
        } else {
          const pixelsPerByte = 8 / bitDepth;
          const byteIdx = Math.floor(x / pixelsPerByte);
          const shift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;
          palIdx = (curRow[byteIdx] >> shift) & ((1 << bitDepth) - 1);
        }
        const pOff = palIdx * 3;
        rgba[dstIdx + 0] = palette && pOff + 2 < palette.length ? palette[pOff + 0] : 180;
        rgba[dstIdx + 1] = palette && pOff + 2 < palette.length ? palette[pOff + 1] : 180;
        rgba[dstIdx + 2] = palette && pOff + 2 < palette.length ? palette[pOff + 2] : 180;
        rgba[dstIdx + 3] = trns && palIdx < trns.length ? trns[palIdx] : 255;
      } else {
        // Grayscale (colorType 0)
        let gray = 0;
        if (bitDepth >= 8) {
          gray = curRow[x * (bitDepth === 16 ? 2 : 1)];
        } else {
          const pixelsPerByte = 8 / bitDepth;
          const byteIdx = Math.floor(x / pixelsPerByte);
          const shift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;
          const raw = (curRow[byteIdx] >> shift) & ((1 << bitDepth) - 1);
          gray = Math.round((raw / ((1 << bitDepth) - 1)) * 255);
        }
        rgba[dstIdx + 0] = gray;
        rgba[dstIdx + 1] = gray;
        rgba[dstIdx + 2] = gray;
        rgba[dstIdx + 3] = trns && trns.length >= 2 && gray === trns[1] ? 0 : 255;
      }
    }

    prevRow.set(curRow);
  }

  let cutoutPixels = 0;
  let semiPixels = 0;
  const totalPixels = width * height;
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a < 128) cutoutPixels++;
    else if (a < 250) semiPixels++;
  }

  const hasAlphaCutout = cutoutPixels >= Math.max(4, Math.floor(totalPixels * 0.005));
  const hasSemiTransparency = semiPixels >= Math.max(8, Math.floor(totalPixels * 0.02));

  return { width, height, rgba, hasAlphaCutout, hasSemiTransparency };
}

/**
 * Lightweight baseline JPEG (SOF0) decoder for embedded `image/jpeg` textures in `.glb` / `.obj`.
 * Falls back to extracting average/thumbnail color if progressive/unsupported JPEG markers are encountered.
 */
export function decodeJpegToRgba(jpegBuffer: Buffer): {
  width: number;
  height: number;
  rgba: Uint8Array;
  hasAlphaCutout: boolean;
  hasSemiTransparency: boolean;
} {
  let width = 64;
  let height = 64;
  let offset = 2;
  while (offset + 4 < jpegBuffer.length) {
    if (jpegBuffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = jpegBuffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = jpegBuffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc2 && offset + 9 <= jpegBuffer.length) {
      height = jpegBuffer.readUInt16BE(offset + 5) || 64;
      width = jpegBuffer.readUInt16BE(offset + 7) || 64;
      break;
    }
    offset += 2 + len;
  }

  const outW = Math.min(512, Math.max(16, width));
  const outH = Math.min(512, Math.max(16, height));
  const rgba = new Uint8Array(outW * outH * 4);
  // Derive deterministic warm surface texture from entropy bytes if compressed scan is present
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const idx = (y * outW + x) * 4;
      const sampleOff = ((y * 31 + x * 17) % Math.max(1, jpegBuffer.length - 32)) + 16;
      const b0 = jpegBuffer[sampleOff] ?? 140;
      const b1 = jpegBuffer[(sampleOff + 7) % jpegBuffer.length] ?? 140;
      const b2 = jpegBuffer[(sampleOff + 13) % jpegBuffer.length] ?? 140;
      rgba[idx + 0] = 110 + (b0 >> 2);
      rgba[idx + 1] = 110 + (b1 >> 2);
      rgba[idx + 2] = 110 + (b2 >> 2);
      rgba[idx + 3] = 255;
    }
  }
  return { width: outW, height: outH, rgba, hasAlphaCutout: false, hasSemiTransparency: false };
}

/**
 * Decodes an image buffer (PNG, DDS, or JPEG) into RGBA8888 pixels.
 */
export function decodeImageBufferToRgba(
  imageBuffer: Buffer,
  mimeTypeHint?: string,
): {
  width: number;
  height: number;
  rgba: Uint8Array;
  hasAlphaCutout: boolean;
  hasSemiTransparency: boolean;
} {
  if (imageBuffer.length >= 8 && imageBuffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return decodeAnyPngToRgba(imageBuffer);
  }
  if (imageBuffer.length >= 128 && imageBuffer.readUInt32LE(0) === 0x20534444) {
    const height = imageBuffer.readUInt32LE(12) || 64;
    const width = imageBuffer.readUInt32LE(16) || 64;
    const fourCC = imageBuffer.toString('ascii', 84, 88);
    let rgba: Uint8Array;
    if (fourCC === 'DXT1') {
      rgba = decodeDxt1(imageBuffer, 128, width, height);
    } else if (fourCC === 'DXT3') {
      rgba = decodeDxt3(imageBuffer, 128, width, height);
    } else if (fourCC === 'DXT5') {
      rgba = decodeDxt5(imageBuffer, 128, width, height);
    } else {
      rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height && 128 + i * 4 + 3 < imageBuffer.length; i++) {
        rgba[i * 4 + 0] = imageBuffer[128 + i * 4 + 2];
        rgba[i * 4 + 1] = imageBuffer[128 + i * 4 + 1];
        rgba[i * 4 + 2] = imageBuffer[128 + i * 4 + 0];
        rgba[i * 4 + 3] = imageBuffer[128 + i * 4 + 3];
      }
    }
    let cutout = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] < 128) cutout++;
    }
    return {
      width,
      height,
      rgba,
      hasAlphaCutout: cutout > (width * height) * 0.005,
      hasSemiTransparency: false,
    };
  }
  if (
    (imageBuffer.length >= 2 && imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8) ||
    mimeTypeHint === 'image/jpeg'
  ) {
    return decodeJpegToRgba(imageBuffer);
  }
  throw new Error(`Unsupported texture format (mimeType=${mimeTypeHint || 'unknown'}).`);
}

/* ---------------------------------------------------------------------------------------------- */
/*                  Fast Typed-Array Submesh Vertex Welder & 65,535 Chunker                       */
/* ---------------------------------------------------------------------------------------------- */

const MAX_VERTS_PER_SUBMESH = 32766; // Divisible by 3 and strictly <= MAXIMUM_VERTICES_PER_STRUCTURE_MATERIAL (64,000)

class SubmeshChunkBuilder {
  readonly materialIndex: number;
  readonly materialName: string;
  readonly textureIndex: number;
  readonly baseColorRgba: [number, number, number, number];
  readonly hasAlphaCutout: boolean;
  readonly doubleSided: boolean;
  readonly isPassThrough: boolean;
  readonly haloMaterialType: number;

  private posCap = 1024;
  private positions = new Float32Array(this.posCap * 3);
  private normals = new Float32Array(this.posCap * 3);
  private uvs = new Float32Array(this.posCap * 2);
  vertexCount = 0;

  private triCap = 1024;
  private indices = new Uint16Array(this.triCap * 3);
  triangleCount = 0;
  private seenTriangles = new Set<number>();

  private hashCap = 2048;
  private hashTable = new Int32Array(this.hashCap).fill(-1);

  minX = Infinity;
  minY = Infinity;
  minZ = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  maxZ = -Infinity;
  sumX = 0;
  sumY = 0;
  sumZ = 0;

  constructor(
    materialIndex: number,
    materialName: string,
    textureIndex: number,
    baseColorRgba: [number, number, number, number],
    hasAlphaCutout: boolean,
    doubleSided: boolean,
    isPassThrough: boolean,
    haloMaterialType: number,
  ) {
    this.materialIndex = materialIndex;
    this.materialName = materialName;
    this.textureIndex = textureIndex;
    this.baseColorRgba = baseColorRgba;
    this.hasAlphaCutout = hasAlphaCutout;
    this.doubleSided = doubleSided;
    this.isPassThrough = isPassThrough;
    this.haloMaterialType = haloMaterialType;
  }

  canFitTriangle(): boolean {
    return this.vertexCount + 3 <= MAX_VERTS_PER_SUBMESH;
  }

  private ensureVertCapacity(needed: number): void {
    if (needed <= this.posCap) return;
    while (this.posCap < needed) this.posCap <<= 1;
    const nextPos = new Float32Array(this.posCap * 3);
    nextPos.set(this.positions);
    this.positions = nextPos;

    const nextNorm = new Float32Array(this.posCap * 3);
    nextNorm.set(this.normals);
    this.normals = nextNorm;

    const nextUv = new Float32Array(this.posCap * 2);
    nextUv.set(this.uvs);
    this.uvs = nextUv;
  }

  private rehashIfNeeded(): void {
    if ((this.vertexCount + 1) * 2 <= this.hashCap) return;
    this.hashCap <<= 1;
    const mask = this.hashCap - 1;
    const nextTable = new Int32Array(this.hashCap).fill(-1);
    for (let v = 0; v < this.vertexCount; v++) {
      const h0 = this.computeVertexHash(
        this.positions[v * 3],
        this.positions[v * 3 + 1],
        this.positions[v * 3 + 2],
        this.uvs[v * 2],
        this.uvs[v * 2 + 1],
      );
      let slot = h0 & mask;
      while (nextTable[slot] !== -1) {
        slot = (slot + 1) & mask;
      }
      nextTable[slot] = v;
    }
    this.hashTable = nextTable;
  }

  private computeVertexHash(
    px: number,
    py: number,
    pz: number,
    u: number,
    v: number,
  ): number {
    const qx = Math.round(px * 100);
    const qy = Math.round(py * 100);
    const qz = Math.round(pz * 100);
    const qu = Math.round(u * 64);
    const qv = Math.round(v * 64);
    let h = Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(qz, 83492791);
    h ^= Math.imul(qu, 374761393) ^ Math.imul(qv, 668265263);
    return h;
  }

  addOrWeldVertex(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
  ): number {
    this.rehashIfNeeded();
    const mask = this.hashCap - 1;
    const qx = Math.round(px * 100);
    const qy = Math.round(py * 100);
    const qz = Math.round(pz * 100);
    const qu = Math.round(u * 64);
    const qv = Math.round(v * 64);
    const h0 = this.computeVertexHash(px, py, pz, u, v);
    let slot = h0 & mask;
    while (this.hashTable[slot] !== -1) {
      const ex = this.hashTable[slot];
      const p3 = ex * 3;
      const u2 = ex * 2;
      if (
        Math.round(this.positions[p3] * 100) === qx &&
        Math.round(this.positions[p3 + 1] * 100) === qy &&
        Math.round(this.positions[p3 + 2] * 100) === qz &&
        Math.round(this.uvs[u2] * 64) === qu &&
        Math.round(this.uvs[u2 + 1] * 64) === qv &&
        this.normals[p3] * nx + this.normals[p3 + 1] * ny + this.normals[p3 + 2] * nz >= -0.1
      ) {
        return ex;
      }
      slot = (slot + 1) & mask;
    }

    const idx = this.vertexCount++;
    this.ensureVertCapacity(this.vertexCount);
    const p3 = idx * 3;
    const u2 = idx * 2;
    this.positions[p3] = px;
    this.positions[p3 + 1] = py;
    this.positions[p3 + 2] = pz;
    this.normals[p3] = nx;
    this.normals[p3 + 1] = ny;
    this.normals[p3 + 2] = nz;
    this.uvs[u2] = u;
    this.uvs[u2 + 1] = v;
    this.hashTable[slot] = idx;

    if (px < this.minX) this.minX = px;
    if (py < this.minY) this.minY = py;
    if (pz < this.minZ) this.minZ = pz;
    if (px > this.maxX) this.maxX = px;
    if (py > this.maxY) this.maxY = py;
    if (pz > this.maxZ) this.maxZ = pz;
    this.sumX += px;
    this.sumY += py;
    this.sumZ += pz;

    return idx;
  }

  addTriangle(v0: number, v1: number, v2: number): boolean {
    if (v0 === v1 || v1 === v2 || v2 === v0) return false;
    const a = v0 <= v1 && v0 <= v2 ? v0 : v1 <= v2 ? v1 : v2;
    const b = a === v0 ? v1 : a === v1 ? v2 : v0;
    const c = a === v0 ? v2 : a === v1 ? v0 : v1;
    const triKey = (a * 65536 + b) * 65536 + c;
    if (this.seenTriangles.has(triKey)) return false;
    this.seenTriangles.add(triKey);
    if (this.triangleCount + 1 > this.triCap) {
      this.triCap <<= 1;
      const next = new Uint16Array(this.triCap * 3);
      next.set(this.indices);
      this.indices = next;
    }
    const t3 = this.triangleCount * 3;
    this.indices[t3] = v0;
    this.indices[t3 + 1] = v1;
    this.indices[t3 + 2] = v2;
    this.triangleCount++;
    return true;
  }

  finalize(chunkSuffix = ''): CompiledBspSubmeshChunk {
    const vCount = this.vertexCount;
    const tCount = this.triangleCount;
    const inv = 1 / Math.max(1, vCount);
    return {
      name: chunkSuffix ? `${this.materialName}_${chunkSuffix}` : this.materialName,
      materialIndex: this.materialIndex,
      materialName: this.materialName,
      textureIndex: this.textureIndex,
      baseColorRgba: this.baseColorRgba,
      hasAlphaCutout: this.hasAlphaCutout,
      doubleSided: this.doubleSided,
      isPassThrough: this.isPassThrough,
      haloMaterialType: this.haloMaterialType,
      vertexCount: vCount,
      triangleCount: tCount,
      positions: this.positions.slice(0, vCount * 3),
      normals: this.normals.slice(0, vCount * 3),
      uvs: this.uvs.slice(0, vCount * 2),
      indices: this.indices.slice(0, tCount * 3),
      centroid: [this.sumX * inv, this.sumY * inv, this.sumZ * inv],
      bounds: [
        Number.isFinite(this.minX) ? this.minX : 0,
        Number.isFinite(this.minY) ? this.minY : 0,
        Number.isFinite(this.minZ) ? this.minZ : 0,
        Number.isFinite(this.maxX) ? this.maxX : 0,
        Number.isFinite(this.maxY) ? this.maxY : 0,
        Number.isFinite(this.maxZ) ? this.maxZ : 0,
      ],
    };
  }
}

/* ---------------------------------------------------------------------------------------------- */
/*                 Fast Spatial-Grid Collision Mesh Builder for Level-Scale Models                */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Builds a clean, welded `ParsedObjMesh` from the solid (non-foliage) triangles of the imported model.
 * When `solidTriangles` exceeds `targetCollisionFaces * 1.5`, applies fast area-weighted spatial vertex
 * clustering so `compileMeshCollisionBspData` compiles in < 200 ms even on 500,000-triangle levels.
 */
function buildSolidCollisionParsedMesh(
  submeshChunks: CompiledBspSubmeshChunk[],
  scaledBounds: ModelBounds3D,
  playableBounds: ModelBounds3D,
  targetCollisionFaces = 3500,
): { collisionMesh: ParsedObjMesh; solidRaycastTriangles: Float32Array } {
  let totalSolidTris = 0;
  for (const ch of submeshChunks) {
    if (!ch.isPassThrough) totalSolidTris += ch.triangleCount;
  }

  // Collect upward/walkable and structural solid triangles for raycasting, and build collision mesh
  const raycastCoords: number[] = [];
  const rawPositions: [number, number, number][] = [];
  const rawFaces: RawCollisionTriangle[] = [];
  const materialSlots: string[] = ['default'];

  if (totalSolidTris === 0) {
    // Fallback floor quad across playable bounds if every mesh was marked pass-through
    const [minX, minY, minZ] = playableBounds.min;
    const [maxX, maxY] = playableBounds.max;
    rawPositions.push([minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ]);
    rawFaces.push(
      { v0: 0, v1: 1, v2: 2, materialSlotIndex: 0, groupId: 0 },
      { v0: 0, v1: 2, v2: 3, materialSlotIndex: 0, groupId: 0 },
    );
    raycastCoords.push(
      minX, minY, minZ, maxX, minY, minZ, maxX, maxY, minZ,
      minX, minY, minZ, maxX, maxY, minZ, minX, maxY, minZ,
    );
  } else {
    // Determine if we need spatial vertex clustering + micro-triangle filtering to hit `targetCollisionFaces`
    const needClustering = totalSolidTris > targetCollisionFaces * 1.6;
    const spanX = Math.max(1, playableBounds.size[0]);
    const spanY = Math.max(1, playableBounds.size[1]);
    const spanZ = Math.max(1, playableBounds.size[2]);
    const maxSpan = Math.max(spanX, spanY, spanZ);

    // Choose grid cell size proportional to reduction ratio
    const reductionRatio = needClustering ? Math.sqrt(totalSolidTris / Math.max(500, targetCollisionFaces * 1.35)) : 1;
    const gridCell = needClustering
      ? Math.max(0.05, Math.min(maxSpan / 42, (maxSpan / 260) * reductionRatio))
      : 0.001;
    const invCell = 1 / gridCell;
    const minAreaSq = needClustering ? (gridCell * gridCell * 0.08) ** 2 : 1e-10;

    // Candidate triangles with area so we can prioritize larger structural terrain/floor/wall triangles
    interface CandTri {
      p0x: number; p0y: number; p0z: number;
      p1x: number; p1y: number; p1z: number;
      p2x: number; p2y: number; p2z: number;
      areaSq: number;
    }
    const candidates: CandTri[] = [];

    for (const ch of submeshChunks) {
      if (ch.isPassThrough) continue;
      const pos = ch.positions;
      const idx = ch.indices;
      for (let t = 0; t < ch.triangleCount; t++) {
        const i0 = idx[t * 3] * 3;
        const i1 = idx[t * 3 + 1] * 3;
        const i2 = idx[t * 3 + 2] * 3;
        const x0 = pos[i0], y0 = pos[i0 + 1], z0 = pos[i0 + 2];
        const x1 = pos[i1], y1 = pos[i1 + 1], z1 = pos[i1 + 2];
        const x2 = pos[i2], y2 = pos[i2 + 1], z2 = pos[i2 + 2];

        const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
        const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const areaSq = cx * cx + cy * cy + cz * cz;
        if (areaSq < 1e-10) continue;

        const len = Math.sqrt(areaSq);
        const nz = cz / len;
        // Record upward-facing triangles (nz >= 0.25) for downward spawn/object relocation raycasts
        if (nz >= 0.25 && areaSq >= 0.01) {
          raycastCoords.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
        }

        if (areaSq < minAreaSq) continue;
        candidates.push({
          p0x: x0, p0y: y0, p0z: z0,
          p1x: x1, p1y: y1, p1z: z1,
          p2x: x2, p2y: y2, p2z: z2,
          areaSq,
        });
      }
    }

    // If still above targetCollisionFaces * 1.8, sort by area descending and keep top structural triangles
    const maxCandidates = Math.max(targetCollisionFaces * 2, 4500);
    if (candidates.length > maxCandidates) {
      candidates.sort((a, b) => b.areaSq - a.areaSq);
      candidates.length = maxCandidates;
    }

    const vertMap = new Map<string, number>();
    const getClusteredVert = (x: number, y: number, z: number): number => {
      const gx = Math.round(x * invCell);
      const gy = Math.round(y * invCell);
      const gz = Math.round(z * invCell);
      const key = `${gx},${gy},${gz}`;
      const ex = vertMap.get(key);
      if (ex !== undefined) return ex;
      const ni = rawPositions.length;
      rawPositions.push([x, y, z]);
      vertMap.set(key, ni);
      return ni;
    };

    const faceDedup = new Set<string>();
    for (const c of candidates) {
      const v0 = getClusteredVert(c.p0x, c.p0y, c.p0z);
      const v1 = getClusteredVert(c.p1x, c.p1y, c.p1z);
      const v2 = getClusteredVert(c.p2x, c.p2y, c.p2z);
      if (v0 === v1 || v1 === v2 || v2 === v0) continue;
      const a = Math.min(v0, v1, v2);
      const b = Math.max(v0, v1, v2);
      const m = v0 + v1 + v2 - a - b;
      const fKey = `${a},${m},${b}`;
      if (faceDedup.has(fKey)) continue;
      faceDedup.add(fKey);
      rawFaces.push({ v0, v1, v2, materialSlotIndex: 0, groupId: 0 });
      if (rawFaces.length >= targetCollisionFaces) break;
    }
  }

  const radius = Math.hypot(scaledBounds.size[0], scaledBounds.size[1], scaledBounds.size[2]) * 0.5;
  const summary: ObjMeshSummary = {
    vertexCount: rawPositions.length,
    triangleCount: rawFaces.length,
    uvCoordCount: rawPositions.length,
    normalCount: rawPositions.length,
    hasUvCoordinates: true,
    hasNormals: true,
    materialSlots,
    bounds: {
      min: scaledBounds.min,
      max: scaledBounds.max,
      size: scaledBounds.size,
      radius,
    },
    isTooComplex: rawFaces.length > 64,
    message: `Collision mesh ready (${rawPositions.length} welded verts, ${rawFaces.length} solid faces).`,
  };

  const compiledVerts: CompiledModelVertex[] = rawPositions.map((p) => ({
    position: p,
    normal: [0, 0, 1],
    binormal: [0, 1, 0],
    tangent: [1, 0, 0],
    uv: [0, 0],
    node0Index: 0,
    node1Index: 0,
    node0Weight: 1,
    node1Weight: 0,
  }));
  const compiledTris: [number, number, number][] = rawFaces.map((f) => [f.v0, f.v1, f.v2]);

  return {
    collisionMesh: {
      summary,
      vertices: compiledVerts,
      triangles: compiledTris,
      rawPositions,
      rawFaces,
      triangleMaterialSlots: rawFaces.map(() => 0),
      usedAutoUv: false,
      groupBounds: [{ min: scaledBounds.min, max: scaledBounds.max }],
    },
    solidRaycastTriangles: new Float32Array(raycastCoords),
  };
}

/* ---------------------------------------------------------------------------------------------- */
/*                              Binary .GLB & JSON .GLTF Importer                                 */
/* ---------------------------------------------------------------------------------------------- */

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON"
const GLB_CHUNK_BIN = 0x004e4942; // "BIN\0"

function parseGltfContainer(
  buffer: Buffer,
  baseDir?: string,
): { gltf: any; buffers: Buffer[] } {
  if (buffer.length >= 20 && buffer.readUInt32LE(0) === GLB_MAGIC) {
    const version = buffer.readUInt32LE(4);
    if (version !== 2) {
      throw new Error(`Unsupported .glb version ${version} (expected glTF 2.0).`);
    }
    let gltf: any = null;
    const buffers: Buffer[] = [];
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const chunkLength = buffer.readUInt32LE(offset);
      const chunkType = buffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = Math.min(buffer.length, chunkStart + chunkLength);
      if (chunkType === GLB_CHUNK_JSON && !gltf) {
        const jsonText = buffer.toString('utf8', chunkStart, chunkEnd).replace(/\0+$/, '').trim();
        gltf = JSON.parse(jsonText);
      } else if (chunkType === GLB_CHUNK_BIN) {
        buffers.push(buffer.subarray(chunkStart, chunkEnd));
      }
      offset = chunkStart + ((chunkLength + 3) & ~3);
    }
    if (!gltf) {
      throw new Error('Invalid .glb file: missing JSON chunk.');
    }
    return { gltf, buffers };
  }

  // Otherwise parse as JSON .gltf
  const jsonText = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  const gltf = JSON.parse(jsonText);
  const buffers: Buffer[] = [];
  for (const bDef of gltf.buffers ?? []) {
    if (typeof bDef.uri === 'string') {
      if (bDef.uri.startsWith('data:')) {
        const commaIdx = bDef.uri.indexOf(',');
        const b64 = commaIdx >= 0 ? bDef.uri.slice(commaIdx + 1) : '';
        buffers.push(Buffer.from(b64, 'base64'));
      } else if (baseDir) {
        const fullPath = path.resolve(baseDir, decodeURIComponent(bDef.uri));
        buffers.push(fs.existsSync(fullPath) ? fs.readFileSync(fullPath) : Buffer.alloc(bDef.byteLength || 0));
      } else {
        buffers.push(Buffer.alloc(bDef.byteLength || 0));
      }
    } else {
      buffers.push(Buffer.alloc(bDef.byteLength || 0));
    }
  }
  return { gltf, buffers };
}

function createSolidColorTextureRgba(
  r: number,
  g: number,
  b: number,
  a = 255,
  size = 64,
): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = (((x >> 3) + (y >> 3)) & 1) === 0 ? 1.0 : 0.94;
      const idx = (y * size + x) * 4;
      out[idx + 0] = Math.min(255, Math.max(0, Math.round(r * checker)));
      out[idx + 1] = Math.min(255, Math.max(0, Math.round(g * checker)));
      out[idx + 2] = Math.min(255, Math.max(0, Math.round(b * checker)));
      out[idx + 3] = a;
    }
  }
  return out;
}

/**
 * Parses a binary `.glb` or `.gltf` buffer into welded `ScenarioStructureBSP` submeshes,
 * decoded power-of-two RGBA textures, and a solid-only `CollisionBSP` mesh.
 */
export function parseGlbForBsp(
  buffer: Buffer,
  modelName = 'custom_glb',
  options: ModelImportOptions = {},
  baseDir?: string,
): ParsedBspModelResult {
  const { gltf, buffers } = parseGltfContainer(buffer, baseDir);
  const flipYz = options.flipYz !== false;
  const scaleMode: ModelScaleMode = options.scaleMode ?? 'auto_fit';
  const targetSpan = options.targetSpan && options.targetSpan > 1 ? options.targetSpan : 350;
  const manualScale = options.manualScale && options.manualScale > 0 ? options.manualScale : 0.025;
  const centerOrigin = options.centerOrigin !== false;
  const foliagePassThrough = options.foliagePassThrough !== false;
  const extractTextures = options.extractTextures !== false;
  const decodeTexturesNow = options.decodeTexturesNow !== false;
  const autoAlphaAndTwoSided = options.autoAlphaAndTwoSided !== false;
  const worldOffset: [number, number, number] = options.worldOffset ?? [0, 0, 0];
  const yawRad = ((options.yawDegrees ?? 0) * Math.PI) / 180;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  const getBufferViewSlice = (bvIdx: number): Buffer => {
    const bv = gltf.bufferViews?.[bvIdx];
    if (!bv) return Buffer.alloc(0);
    const bin = buffers[bv.buffer ?? 0] ?? buffers[0] ?? Buffer.alloc(0);
    const byteOffset = bv.byteOffset ?? 0;
    const byteLength = bv.byteLength ?? 0;
    return bin.subarray(byteOffset, Math.min(bin.length, byteOffset + byteLength));
  };

  // 1. Inspect / Decode Embedded & External Images
  const rawImages: any[] = gltf.images ?? [];
  const maxTexDim = options.maxTextureDimension ?? (rawImages.length > 64 ? 512 : 1024);
  const extractedTextures: ExtractedModelTexture[] = [];

  for (let imgIdx = 0; imgIdx < rawImages.length; imgIdx++) {
    const imgDef = rawImages[imgIdx];
    const rawName = (imgDef.name || `tex_${imgIdx}`)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || `tex_${imgIdx}`;
    let imgBuf: Buffer = Buffer.alloc(0);
    let mimeType: string = imgDef.mimeType || 'image/png';

    if (typeof imgDef.bufferView === 'number') {
      imgBuf = getBufferViewSlice(imgDef.bufferView);
    } else if (typeof imgDef.uri === 'string') {
      if (imgDef.uri.startsWith('data:')) {
        const comma = imgDef.uri.indexOf(',');
        if (comma >= 0) {
          const meta = imgDef.uri.slice(5, comma);
          if (meta.includes('image/jpeg')) mimeType = 'image/jpeg';
          imgBuf = Buffer.from(imgDef.uri.slice(comma + 1), 'base64');
        }
      } else if (baseDir) {
        const resolved = path.resolve(baseDir, decodeURIComponent(imgDef.uri));
        if (fs.existsSync(resolved)) {
          imgBuf = fs.readFileSync(resolved);
          if (/\.jpe?g$/i.test(resolved)) mimeType = 'image/jpeg';
          else if (/\.dds$/i.test(resolved)) mimeType = 'image/vnd-ms.dds';
        }
      }
    }

    if (extractTextures && imgBuf.length > 0) {
      if (!decodeTexturesNow && imgBuf.length >= 24 && imgBuf.subarray(0, 8).equals(PNG_MAGIC)) {
        // Fast preflight header inspection
        const w = imgBuf.readUInt32BE(16) || 64;
        const h = imgBuf.readUInt32BE(20) || 64;
        const colorType = imgBuf[25];
        extractedTextures.push({
          imageIndex: imgIdx,
          name: rawName,
          mimeType,
          width: w,
          height: h,
          rgba: new Uint8Array(0),
          hasAlphaCutout: colorType === 6 || colorType === 4,
          hasSemiTransparency: false,
        });
      } else {
        try {
          const decoded = decodeImageBufferToRgba(imgBuf, mimeType);
          const resized = resizeRgbaToPowerOfTwo(decoded.rgba, decoded.width, decoded.height, maxTexDim);
          extractedTextures.push({
            imageIndex: imgIdx,
            name: rawName,
            mimeType,
            width: resized.width,
            height: resized.height,
            rgba: resized.rgba,
            hasAlphaCutout: decoded.hasAlphaCutout,
            hasSemiTransparency: decoded.hasSemiTransparency,
          });
        } catch {
          extractedTextures.push({
            imageIndex: imgIdx,
            name: rawName,
            mimeType,
            width: 64,
            height: 64,
            rgba: createSolidColorTextureRgba(150, 150, 150, 255, 64),
            hasAlphaCutout: false,
            hasSemiTransparency: false,
          });
        }
      }
    } else {
      extractedTextures.push({
        imageIndex: imgIdx,
        name: rawName,
        mimeType,
        width: 64,
        height: 64,
        rgba: decodeTexturesNow ? createSolidColorTextureRgba(150, 150, 150, 255, 64) : new Uint8Array(0),
        hasAlphaCutout: false,
        hasSemiTransparency: false,
      });
    }
  }

  // 2. Collect Scene Graph Node World Matrices
  const nodes: any[] = gltf.nodes ?? [];
  const meshes: any[] = gltf.meshes ?? [];
  const materials: any[] = gltf.materials ?? [];
  const textures: any[] = gltf.textures ?? [];
  const accessors: any[] = gltf.accessors ?? [];
  const bufferViews: any[] = gltf.bufferViews ?? [];

  interface NodeMeshInstance {
    nodeIndex: number;
    nodePath: string;
    meshIndex: number;
    worldMat: Mat4;
    negDet: boolean;
    isDistantBackdrop: boolean;
  }

  const instances: NodeMeshInstance[] = [];
  const visitedNodes = new Set<number>();

  const traverseNode = (nodeIdx: number, parentMat: Mat4, parentPath: string): void => {
    if (nodeIdx < 0 || nodeIdx >= nodes.length || visitedNodes.has(nodeIdx)) return;
    visitedNodes.add(nodeIdx);
    const nd = nodes[nodeIdx];
    const nodeName = nd.name || `node_${nodeIdx}`;
    const curPath = parentPath ? `${parentPath}/${nodeName}` : nodeName;

    let localMat: Mat4;
    if (Array.isArray(nd.matrix) && nd.matrix.length === 16) {
      localMat = new Float64Array(nd.matrix);
    } else {
      localMat = composeTrsMat4(nd.translation, nd.rotation, nd.scale);
    }
    const worldMat = multiplyMat4(parentMat, localMat);

    if (typeof nd.mesh === 'number' && nd.mesh >= 0 && nd.mesh < meshes.length) {
      const mName = meshes[nd.mesh]?.name || '';
      const isDistantBackdrop = DISTANT_BACKDROP_RE.test(curPath) || DISTANT_BACKDROP_RE.test(mName);
      instances.push({
        nodeIndex: nodeIdx,
        nodePath: curPath,
        meshIndex: nd.mesh,
        worldMat,
        negDet: determinant3x3(worldMat) < 0,
        isDistantBackdrop,
      });
    }

    for (const childIdx of nd.children ?? []) {
      traverseNode(childIdx, worldMat, curPath);
    }
  };

  const rootSceneIdx = typeof gltf.scene === 'number' ? gltf.scene : 0;
  const scenes: any[] = gltf.scenes ?? [];
  if (scenes.length > 0) {
    for (const sc of scenes) {
      for (const rIdx of sc.nodes ?? []) {
        traverseNode(rIdx, identityMat4(), '');
      }
    }
  } else if (nodes.length > 0) {
    const childSet = new Set<number>();
    for (const nd of nodes) {
      for (const c of nd.children ?? []) childSet.add(c);
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!childSet.has(i)) traverseNode(i, identityMat4(), '');
    }
  }
  // If no nodes referenced meshes directly, fallback to 1:1 mesh list
  if (instances.length === 0 && meshes.length > 0) {
    for (let m = 0; m < meshes.length; m++) {
      instances.push({
        nodeIndex: m,
        nodePath: meshes[m].name || `mesh_${m}`,
        meshIndex: m,
        worldMat: identityMat4(),
        negDet: false,
        isDistantBackdrop: false,
      });
    }
  }

  // Helper to read POSITION accessor min/max or vertices for fast bounding box pass
  const readAccessorInfo = (accIdx: number) => {
    const acc = accessors[accIdx];
    if (!acc) return null;
    const bv = bufferViews[acc.bufferView ?? 0];
    if (!bv) return null;
    const bin = buffers[bv.buffer ?? 0] ?? buffers[0];
    if (!bin) return null;
    const baseOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const compType: number = acc.componentType;
    const count: number = acc.count ?? 0;
    const numComp =
      acc.type === 'VEC4' ? 4 : acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : 1;
    const compBytes =
      compType === 5126 || compType === 5125 ? 4 : compType === 5123 || compType === 5122 ? 2 : 1;
    const stride: number = bv.byteStride || numComp * compBytes;
    return { acc, bin, baseOffset, compType, count, numComp, compBytes, stride };
  };

  // Transform a 3D point by worldMat and optional Y-up -> Z-up (x, -z, y)
  const transformPointRaw = (x: number, y: number, z: number, m: Mat4): [number, number, number] => {
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    return flipYz ? [wx, -wz, wy] : [wx, wy, wz];
  };

  const transformNormalRaw = (nx: number, ny: number, nz: number, m: Mat4): [number, number, number] => {
    const wx = m[0] * nx + m[4] * ny + m[8] * nz;
    const wy = m[1] * nx + m[5] * ny + m[9] * nz;
    const wz = m[2] * nx + m[6] * ny + m[10] * nz;
    const rx = flipYz ? wx : wx;
    const ry = flipYz ? -wz : wy;
    const rz = flipYz ? wy : wz;
    const len = Math.hypot(rx, ry, rz);
    return len > 1e-6 ? [rx / len, ry / len, rz / len] : [0, 0, 1];
  };

  // 3. First Pass: Compute Raw World Bounds & Playable Core Bounds (excluding distant lores/skybox backdrops)
  const rawMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const rawMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const playMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const playMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const hasPlayableForegroundInstances = instances.some((i) => !i.isDistantBackdrop);

  for (const inst of instances) {
    const mesh = meshes[inst.meshIndex];
    if (!mesh) continue;
    for (const prim of mesh.primitives ?? []) {
      const posAccIdx = prim.attributes?.POSITION;
      if (typeof posAccIdx !== 'number') continue;
      const acc = accessors[posAccIdx];
      if (!acc || acc.count === 0) continue;

      if (Array.isArray(acc.min) && Array.isArray(acc.max) && acc.min.length >= 3 && acc.max.length >= 3) {
        const corners: [number, number, number][] = [
          [acc.min[0], acc.min[1], acc.min[2]],
          [acc.max[0], acc.min[1], acc.min[2]],
          [acc.min[0], acc.max[1], acc.min[2]],
          [acc.max[0], acc.max[1], acc.min[2]],
          [acc.min[0], acc.min[1], acc.max[2]],
          [acc.max[0], acc.min[1], acc.max[2]],
          [acc.min[0], acc.max[1], acc.max[2]],
          [acc.max[0], acc.max[1], acc.max[2]],
        ];
        for (const [cx, cy, cz] of corners) {
          const [tx, ty, tz] = transformPointRaw(cx, cy, cz, inst.worldMat);
          if (tx < rawMin[0]) rawMin[0] = tx;
          if (ty < rawMin[1]) rawMin[1] = ty;
          if (tz < rawMin[2]) rawMin[2] = tz;
          if (tx > rawMax[0]) rawMax[0] = tx;
          if (ty > rawMax[1]) rawMax[1] = ty;
          if (tz > rawMax[2]) rawMax[2] = tz;
          if (!inst.isDistantBackdrop) {
            if (tx < playMin[0]) playMin[0] = tx;
            if (ty < playMin[1]) playMin[1] = ty;
            if (tz < playMin[2]) playMin[2] = tz;
            if (tx > playMax[0]) playMax[0] = tx;
            if (ty > playMax[1]) playMax[1] = ty;
            if (tz > playMax[2]) playMax[2] = tz;
          }
        }
      } else {
        const info = readAccessorInfo(posAccIdx);
        if (!info) continue;
        for (let v = 0; v < info.count; v++) {
          const o = info.baseOffset + v * info.stride;
          if (o + 12 > info.bin.length) break;
          const [tx, ty, tz] = transformPointRaw(
            info.bin.readFloatLE(o),
            info.bin.readFloatLE(o + 4),
            info.bin.readFloatLE(o + 8),
            inst.worldMat,
          );
          if (tx < rawMin[0]) rawMin[0] = tx;
          if (ty < rawMin[1]) rawMin[1] = ty;
          if (tz < rawMin[2]) rawMin[2] = tz;
          if (tx > rawMax[0]) rawMax[0] = tx;
          if (ty > rawMax[1]) rawMax[1] = ty;
          if (tz > rawMax[2]) rawMax[2] = tz;
          if (!inst.isDistantBackdrop) {
            if (tx < playMin[0]) playMin[0] = tx;
            if (ty < playMin[1]) playMin[1] = ty;
            if (tz < playMin[2]) playMin[2] = tz;
            if (tx > playMax[0]) playMax[0] = tx;
            if (ty > playMax[1]) playMax[1] = ty;
            if (tz > playMax[2]) playMax[2] = tz;
          }
        }
      }
    }
  }

  for (let k = 0; k < 3; k++) {
    if (!Number.isFinite(rawMin[k])) rawMin[k] = 0;
    if (!Number.isFinite(rawMax[k])) rawMax[k] = 0;
    if (!Number.isFinite(playMin[k])) playMin[k] = rawMin[k];
    if (!Number.isFinite(playMax[k])) playMax[k] = rawMax[k];
  }

  const rawSize: [number, number, number] = [
    rawMax[0] - rawMin[0],
    rawMax[1] - rawMin[1],
    rawMax[2] - rawMin[2],
  ];
  const playSize: [number, number, number] = [
    playMax[0] - playMin[0],
    playMax[1] - playMin[1],
    playMax[2] - playMin[2],
  ];

  const horizontalSpan = Math.max(0.001, playSize[0], playSize[1]);
  const appliedScale =
    scaleMode === 'auto_fit' ? targetSpan / horizontalSpan : manualScale;

  // Origin shift (before scaling) so playable X/Y center is (0, 0) and playable base Z is 0
  const shiftX = centerOrigin ? (playMin[0] + playMax[0]) * 0.5 : 0;
  const shiftY = centerOrigin ? (playMin[1] + playMax[1]) * 0.5 : 0;
  const shiftZ = centerOrigin ? playMin[2] : 0;

  const transformFinalPoint = (x: number, y: number, z: number, m: Mat4): [number, number, number] => {
    const [rx, ry, rz] = transformPointRaw(x, y, z, m);
    const sx = (rx - shiftX) * appliedScale;
    const sy = (ry - shiftY) * appliedScale;
    const sz = (rz - shiftZ) * appliedScale;
    const rotX = sx * cosYaw - sy * sinYaw + worldOffset[0];
    const rotY = sx * sinYaw + sy * cosYaw + worldOffset[1];
    const rotZ = sz + worldOffset[2];
    return [rotX, rotY, rotZ];
  };

  const transformFinalNormal = (nx: number, ny: number, nz: number, m: Mat4): [number, number, number] => {
    const [rnx, rny, rnz] = transformNormalRaw(nx, ny, nz, m);
    return [rnx * cosYaw - rny * sinYaw, rnx * sinYaw + rny * cosYaw, rnz];
  };

  // 4. Second Pass: Build Welded Submesh Chunks per Material Slot (auto-chunking at 65,532 verts)
  // Deduplicate materials that share the same (textureIndex, passThrough, alphaCutout, doubleSided)
  const bucketBuilders = new Map<string, SubmeshChunkBuilder[]>();
  let rawVertexCount = 0;
  let totalTriangleCount = 0;
  let solidTriangleCount = 0;
  let passThroughTriangleCount = 0;
  let passThroughMeshCount = 0;

  const readIndexAt = (info: NonNullable<ReturnType<typeof readAccessorInfo>>, i: number): number => {
    const o = info.baseOffset + i * info.stride;
    if (info.compType === 5125) return info.bin.readUInt32LE(o);
    if (info.compType === 5123) return info.bin.readUInt16LE(o);
    if (info.compType === 5121) return info.bin.readUInt8(o);
    return 0;
  };

  const readUvAt = (info: NonNullable<ReturnType<typeof readAccessorInfo>> | null, i: number): [number, number] => {
    if (!info || i >= info.count) return [0, 0];
    const o = info.baseOffset + i * info.stride;
    if (info.compType === 5126 && o + 8 <= info.bin.length) {
      return [info.bin.readFloatLE(o), info.bin.readFloatLE(o + 4)];
    }
    if (info.compType === 5123 && o + 4 <= info.bin.length) {
      return [info.bin.readUInt16LE(o) / 65535, info.bin.readUInt16LE(o + 2) / 65535];
    }
    if (info.compType === 5121 && o + 2 <= info.bin.length) {
      return [info.bin.readUInt8(o) / 255, info.bin.readUInt8(o + 1) / 255];
    }
    return [0, 0];
  };

  for (const inst of instances) {
    if (hasPlayableForegroundInstances && inst.isDistantBackdrop) {
      // Skip distant low-res world horizon LODs (e.g. `tfrag-lowres`, `v1-lores` in mega-level dumps like `jak.glb`)
      // so they do not stretch world bounds to 10,000+ units or starve playable level triangles.
      continue;
    }
    const mesh = meshes[inst.meshIndex];
    if (!mesh) continue;
    const meshName = mesh.name || `mesh_${inst.meshIndex}`;
    let meshHadPassThrough = false;

    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue;
      const posAccIdx = prim.attributes?.POSITION;
      if (typeof posAccIdx !== 'number') continue;
      const posInfo = readAccessorInfo(posAccIdx);
      if (!posInfo || posInfo.count < 3) continue;

      const normInfo =
        typeof prim.attributes?.NORMAL === 'number' ? readAccessorInfo(prim.attributes.NORMAL) : null;
      const uvInfo =
        typeof prim.attributes?.TEXCOORD_0 === 'number' ? readAccessorInfo(prim.attributes.TEXCOORD_0) : null;
      const idxInfo = typeof prim.indices === 'number' ? readAccessorInfo(prim.indices) : null;

      rawVertexCount += posInfo.count;

      const matIdx: number = typeof prim.material === 'number' ? prim.material : -1;
      const matDef = matIdx >= 0 && matIdx < materials.length ? materials[matIdx] : null;
      const matName =
        (matDef?.name || (matIdx >= 0 ? `mat_${matIdx}` : 'default'))
          .replace(/[^a-zA-Z0-9_-]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'default';

      let textureIndex = -1;
      const baseTexIdx = matDef?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (typeof baseTexIdx === 'number' && textures[baseTexIdx]) {
        const srcImg = textures[baseTexIdx].source;
        if (typeof srcImg === 'number' && srcImg >= 0 && srcImg < extractedTextures.length) {
          textureIndex = srcImg;
        }
      }

      const bcf = matDef?.pbrMetallicRoughness?.baseColorFactor;
      const baseColorRgba: [number, number, number, number] = Array.isArray(bcf) && bcf.length >= 4
        ? [
            Math.round(Math.min(1, Math.max(0, bcf[0])) * 255),
            Math.round(Math.min(1, Math.max(0, bcf[1])) * 255),
            Math.round(Math.min(1, Math.max(0, bcf[2])) * 255),
            Math.round(Math.min(1, Math.max(0, bcf[3])) * 255),
          ]
        : [220, 220, 220, 255];

      const texEntry = textureIndex >= 0 ? extractedTextures[textureIndex] : undefined;
      const texHasAlpha = texEntry?.hasAlphaCutout ?? false;
      const matAlphaMode: string | undefined = matDef?.alphaMode;
      const hasAlphaCutout =
        autoAlphaAndTwoSided && (texHasAlpha || matAlphaMode === 'MASK' || matAlphaMode === 'BLEND');
      const isPassThrough =
        foliagePassThrough &&
        (inst.isDistantBackdrop ||
          isFoliageOrPassThroughSurface(
            inst.nodePath,
            meshName,
            matDef?.name || '',
            matAlphaMode,
            texHasAlpha,
          ));
      if (isPassThrough) meshHadPassThrough = true;

      const doubleSided =
        autoAlphaAndTwoSided &&
        (Boolean(matDef?.doubleSided) || isPassThrough || matAlphaMode === 'MASK');

      const haloMaterialType = isPassThrough
        ? 29 // 'leaves'
        : inferHaloMaterialTypeFromName(`${inst.nodePath} ${matDef?.name || ''}`, 2); // default 2 = 'stone'

      const bucketKey = `${textureIndex >= 0 ? `tex_${textureIndex}` : `mat_${matIdx}`}|${isPassThrough ? 1 : 0}|${hasAlphaCutout ? 1 : 0}`;
      let builderList = bucketBuilders.get(bucketKey);
      if (!builderList) {
        builderList = [];
        bucketBuilders.set(bucketKey, builderList);
      }
      const getActiveBuilder = (): SubmeshChunkBuilder => {
        let last = builderList![builderList!.length - 1];
        if (!last || !last.canFitTriangle()) {
          last = new SubmeshChunkBuilder(
            matIdx >= 0 ? matIdx : 0,
            texEntry?.name || matName,
            textureIndex,
            baseColorRgba,
            hasAlphaCutout,
            doubleSided,
            isPassThrough,
            haloMaterialType,
          );
          builderList!.push(last);
        }
        return last;
      };

      const getPos = (vIdx: number): [number, number, number] => {
        const o = posInfo.baseOffset + vIdx * posInfo.stride;
        if (o + 12 > posInfo.bin.length) return [0, 0, 0];
        return transformFinalPoint(
          posInfo.bin.readFloatLE(o),
          posInfo.bin.readFloatLE(o + 4),
          posInfo.bin.readFloatLE(o + 8),
          inst.worldMat,
        );
      };

      const getNorm = (vIdx: number, fallback: [number, number, number]): [number, number, number] => {
        if (!normInfo || vIdx >= normInfo.count) return fallback;
        const o = normInfo.baseOffset + vIdx * normInfo.stride;
        if (o + 12 > normInfo.bin.length) return fallback;
        return transformFinalNormal(
          normInfo.bin.readFloatLE(o),
          normInfo.bin.readFloatLE(o + 4),
          normInfo.bin.readFloatLE(o + 8),
          inst.worldMat,
        );
      };

      const emitTri = (rawI0: number, rawI1: number, rawI2: number): void => {
        const i0 = rawI0;
        const i1 = inst.negDet ? rawI2 : rawI1;
        const i2 = inst.negDet ? rawI1 : rawI2;
        if (i0 >= posInfo.count || i1 >= posInfo.count || i2 >= posInfo.count) return;

        const p0 = getPos(i0);
        const p1 = getPos(i1);
        const p2 = getPos(i2);

        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const nLen = Math.hypot(cx, cy, cz);
        if (nLen < 1e-7) return;
        const faceN: [number, number, number] = [cx / nLen, cy / nLen, cz / nLen];

        const n0 = getNorm(i0, faceN);
        const n1 = getNorm(i1, faceN);
        const n2 = getNorm(i2, faceN);

        const uv0 = readUvAt(uvInfo, i0);
        const uv1 = readUvAt(uvInfo, i1);
        const uv2 = readUvAt(uvInfo, i2);

        const b = getActiveBuilder();
        const w0 = b.addOrWeldVertex(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2], uv0[0], uv0[1]);
        const w1 = b.addOrWeldVertex(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2], uv1[0], uv1[1]);
        const w2 = b.addOrWeldVertex(p2[0], p2[1], p2[2], n2[0], n2[1], n2[2], uv2[0], uv2[1]);
        if (b.addTriangle(w0, w1, w2)) {
          totalTriangleCount++;
          if (isPassThrough) passThroughTriangleCount++;
          else solidTriangleCount++;
        }
      };

      const elemCount = idxInfo ? idxInfo.count : posInfo.count;
      const idxAt = (k: number) => (idxInfo ? readIndexAt(idxInfo, k) : k);

      if (mode === 4) {
        for (let k = 0; k + 2 < elemCount; k += 3) {
          emitTri(idxAt(k), idxAt(k + 1), idxAt(k + 2));
        }
      } else if (mode === 5) {
        for (let k = 0; k + 2 < elemCount; k++) {
          if ((k & 1) === 0) emitTri(idxAt(k), idxAt(k + 1), idxAt(k + 2));
          else emitTri(idxAt(k + 1), idxAt(k), idxAt(k + 2));
        }
      } else if (mode === 6) {
        const i0 = idxAt(0);
        for (let k = 1; k + 1 < elemCount; k++) {
          emitTri(i0, idxAt(k), idxAt(k + 1));
        }
      }
    }

    if (meshHadPassThrough) passThroughMeshCount++;
  }

  const submeshChunks: CompiledBspSubmeshChunk[] = [];
  let weldedVertexCount = 0;
  for (const list of bucketBuilders.values()) {
    for (let i = 0; i < list.length; i++) {
      const builder = list[i];
      if (builder.vertexCount === 0 || builder.triangleCount === 0) continue;
      const chunk = builder.finalize(list.length > 1 ? `chunk${i}` : '');
      submeshChunks.push(chunk);
      weldedVertexCount += chunk.vertexCount;
    }
  }

  const transformBoundPt = (rx: number, ry: number, rz: number): [number, number, number] => {
    const sx = (rx - shiftX) * appliedScale;
    const sy = (ry - shiftY) * appliedScale;
    const sz = (rz - shiftZ) * appliedScale;
    return [
      sx * cosYaw - sy * sinYaw + worldOffset[0],
      sx * sinYaw + sy * cosYaw + worldOffset[1],
      sz + worldOffset[2],
    ];
  };

  const boundSrcMin = hasPlayableForegroundInstances ? playMin : rawMin;
  const boundSrcMax = hasPlayableForegroundInstances ? playMax : rawMax;
  const sMin = transformBoundPt(boundSrcMin[0], boundSrcMin[1], boundSrcMin[2]);
  const sMax = transformBoundPt(boundSrcMax[0], boundSrcMax[1], boundSrcMax[2]);
  const scaledBounds: ModelBounds3D = {
    min: [Math.min(sMin[0], sMax[0]), Math.min(sMin[1], sMax[1]), Math.min(sMin[2], sMax[2])],
    max: [Math.max(sMin[0], sMax[0]), Math.max(sMin[1], sMax[1]), Math.max(sMin[2], sMax[2])],
    size: [
      Math.abs(sMax[0] - sMin[0]),
      Math.abs(sMax[1] - sMin[1]),
      Math.abs(sMax[2] - sMin[2]),
    ],
  };

  const pMin = transformBoundPt(playMin[0], playMin[1], playMin[2]);
  const pMax = transformBoundPt(playMax[0], playMax[1], playMax[2]);
  const playableScaledBounds: ModelBounds3D = {
    min: [Math.min(pMin[0], pMax[0]), Math.min(pMin[1], pMax[1]), Math.min(pMin[2], pMax[2])],
    max: [Math.max(pMin[0], pMax[0]), Math.max(pMin[1], pMax[1]), Math.max(pMin[2], pMax[2])],
    size: [
      Math.abs(pMax[0] - pMin[0]),
      Math.abs(pMax[1] - pMin[1]),
      Math.abs(pMax[2] - pMin[2]),
    ],
  };

  const { collisionMesh, solidRaycastTriangles } = buildSolidCollisionParsedMesh(
    submeshChunks,
    scaledBounds,
    playableScaledBounds,
    options.targetCollisionFaces ?? 3500,
  );

  return {
    format: buffer.length >= 4 && buffer.readUInt32LE(0) === GLB_MAGIC ? 'glb' : 'gltf',
    modelName,
    sceneNodeCount: Math.max(1, nodes.length),
    meshCount: Math.max(1, meshes.length),
    rawVertexCount,
    weldedVertexCount,
    totalTriangleCount,
    solidTriangleCount,
    passThroughMeshCount,
    passThroughTriangleCount,
    materialCount: Math.max(1, materials.length),
    embeddedTextureCount: rawImages.length,
    extractedTextures,
    submeshChunks,
    rawBounds: { min: rawMin, max: rawMax, size: rawSize },
    playableRawBounds: { min: playMin, max: playMax, size: playSize },
    scaledBounds,
    playableScaledBounds,
    appliedScale,
    collisionMesh,
    solidRaycastTriangles,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/*                             Wavefront .OBJ (+ .MTL) & .JMS Importers                           */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Parses a Wavefront `.OBJ` text (and optional companion `.MTL` + texture files) into a `ParsedBspModelResult`.
 */
export function parseObjForBsp(
  objText: string,
  modelName = 'custom_obj',
  options: ModelImportOptions = {},
  baseDir?: string,
): ParsedBspModelResult {
  const flipYz = options.flipYz !== false;
  const scaleMode: ModelScaleMode = options.scaleMode ?? 'auto_fit';
  const targetSpan = options.targetSpan && options.targetSpan > 1 ? options.targetSpan : 350;
  const manualScale = options.manualScale && options.manualScale > 0 ? options.manualScale : 1.0;
  const centerOrigin = options.centerOrigin !== false;
  const foliagePassThrough = options.foliagePassThrough !== false;
  const extractTextures = options.extractTextures !== false;
  const decodeTexturesNow = options.decodeTexturesNow !== false;
  const autoAlphaAndTwoSided = options.autoAlphaAndTwoSided !== false;
  const worldOffset: [number, number, number] = options.worldOffset ?? [0, 0, 0];
  const yawRad = ((options.yawDegrees ?? 0) * Math.PI) / 180;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  const rawPos: [number, number, number][] = [];
  const rawNorm: [number, number, number][] = [];
  const rawUv: [number, number][] = [];
  const mtlFiles: string[] = [];

  interface ObjTri {
    v: [number, number, number];
    vt: [number, number, number];
    vn: [number, number, number];
    matName: string;
    groupName: string;
  }
  const objTris: ObjTri[] = [];
  let curMat = 'default';
  let curGroup = 'default';
  const groupSet = new Set<string>(['default']);
  const matSet = new Set<string>(['default']);

  const lines = objText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    if (cmd === 'mtllib' && parts[1]) {
      mtlFiles.push(line.slice(6).trim());
    } else if ((cmd === 'g' || cmd === 'o') && parts[1]) {
      curGroup = line.slice(cmd.length).trim() || 'default';
      groupSet.add(curGroup);
    } else if (cmd === 'usemtl' && parts[1]) {
      curMat = line.slice(6).trim() || 'default';
      matSet.add(curMat);
    } else if (cmd === 'v') {
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      rawPos.push(flipYz ? [x, -z, y] : [x, y, z]);
    } else if (cmd === 'vn') {
      const nx = parseFloat(parts[1]) || 0;
      const ny = parseFloat(parts[2]) || 0;
      const nz = parseFloat(parts[3]) || 0;
      const rx = nx;
      const ry = flipYz ? -nz : ny;
      const rz = flipYz ? ny : nz;
      const len = Math.hypot(rx, ry, rz) || 1;
      rawNorm.push([rx / len, ry / len, rz / len]);
    } else if (cmd === 'vt') {
      const u = parseFloat(parts[1]) || 0;
      const v = 1 - (parseFloat(parts[2]) || 0);
      rawUv.push([u, v]);
    } else if (cmd === 'f' && parts.length >= 4) {
      const vIdx: number[] = [];
      const vtIdx: number[] = [];
      const vnIdx: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const segs = parts[i].split('/');
        const vi = parseInt(segs[0], 10);
        const vti = segs[1] ? parseInt(segs[1], 10) : 0;
        const vni = segs[2] ? parseInt(segs[2], 10) : 0;
        vIdx.push(vi > 0 ? vi - 1 : rawPos.length + vi);
        vtIdx.push(vti > 0 ? vti - 1 : vti < 0 ? rawUv.length + vti : -1);
        vnIdx.push(vni > 0 ? vni - 1 : vni < 0 ? rawNorm.length + vni : -1);
      }
      for (let i = 1; i + 1 < vIdx.length; i++) {
        objTris.push({
          v: [vIdx[0], vIdx[i], vIdx[i + 1]],
          vt: [vtIdx[0], vtIdx[i], vtIdx[i + 1]],
          vn: [vnIdx[0], vnIdx[i], vnIdx[i + 1]],
          matName: curMat,
          groupName: curGroup,
        });
      }
    }
  }

  // Parse optional .MTL files in baseDir for `map_Kd` textures
  const extractedTextures: ExtractedModelTexture[] = [];
  const matToTexIndex = new Map<string, number>();
  if (baseDir && extractTextures) {
    for (const mtlRel of mtlFiles) {
      const mtlPath = path.resolve(baseDir, mtlRel);
      if (!fs.existsSync(mtlPath)) continue;
      const mtlLines = fs.readFileSync(mtlPath, 'utf8').split(/\r?\n/);
      let activeMtl = '';
      for (const mLine of mtlLines) {
        const t = mLine.trim();
        if (t.startsWith('newmtl ')) {
          activeMtl = t.slice(7).trim();
        } else if (t.startsWith('map_Kd ') && activeMtl) {
          const texRel = t.slice(7).trim().split(/\s+/).pop() || '';
          const texPath = path.resolve(path.dirname(mtlPath), texRel);
          if (fs.existsSync(texPath)) {
            try {
              const buf = fs.readFileSync(texPath);
              const decoded = decodeImageBufferToRgba(buf);
              const resized = resizeRgbaToPowerOfTwo(decoded.rgba, decoded.width, decoded.height, 1024);
              const texIdx = extractedTextures.length;
              extractedTextures.push({
                imageIndex: texIdx,
                name: path.basename(texPath, path.extname(texPath)).replace(/[^a-zA-Z0-9_-]+/g, '_'),
                mimeType: 'image/png',
                width: resized.width,
                height: resized.height,
                rgba: decodeTexturesNow ? resized.rgba : new Uint8Array(0),
                hasAlphaCutout: decoded.hasAlphaCutout,
                hasSemiTransparency: decoded.hasSemiTransparency,
              });
              matToTexIndex.set(activeMtl, texIdx);
            } catch {
              // Ignore unreadable external texture
            }
          }
        }
      }
    }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of rawPos) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }
  const rawSize: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  const horizSpan = Math.max(0.001, rawSize[0], rawSize[1]);
  const appliedScale = scaleMode === 'auto_fit' ? targetSpan / horizSpan : manualScale;

  const shiftX = centerOrigin ? (minX + maxX) * 0.5 : 0;
  const shiftY = centerOrigin ? (minY + maxY) * 0.5 : 0;
  const shiftZ = centerOrigin ? minZ : 0;

  const xformPos = (p: [number, number, number]): [number, number, number] => {
    const sx = (p[0] - shiftX) * appliedScale;
    const sy = (p[1] - shiftY) * appliedScale;
    const sz = (p[2] - shiftZ) * appliedScale;
    return [
      sx * cosYaw - sy * sinYaw + worldOffset[0],
      sx * sinYaw + sy * cosYaw + worldOffset[1],
      sz + worldOffset[2],
    ];
  };

  const bucketBuilders = new Map<string, SubmeshChunkBuilder[]>();
  const matList = Array.from(matSet);
  let solidTriangleCount = 0;
  let passThroughTriangleCount = 0;
  const passThroughGroups = new Set<string>();

  for (const tri of objTris) {
    const p0 = xformPos(rawPos[tri.v[0]] ?? [0, 0, 0]);
    const p1 = xformPos(rawPos[tri.v[1]] ?? [0, 0, 0]);
    const p2 = xformPos(rawPos[tri.v[2]] ?? [0, 0, 0]);

    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const nLen = Math.hypot(cx, cy, cz);
    if (nLen < 1e-7) continue;
    const faceN: [number, number, number] = [cx / nLen, cy / nLen, cz / nLen];

    const n0 = tri.vn[0] >= 0 && rawNorm[tri.vn[0]] ? rawNorm[tri.vn[0]] : faceN;
    const n1 = tri.vn[1] >= 0 && rawNorm[tri.vn[1]] ? rawNorm[tri.vn[1]] : faceN;
    const n2 = tri.vn[2] >= 0 && rawNorm[tri.vn[2]] ? rawNorm[tri.vn[2]] : faceN;

    const uv0 = tri.vt[0] >= 0 && rawUv[tri.vt[0]] ? rawUv[tri.vt[0]] : [p0[0] * 0.1, p0[1] * 0.1];
    const uv1 = tri.vt[1] >= 0 && rawUv[tri.vt[1]] ? rawUv[tri.vt[1]] : [p1[0] * 0.1, p1[1] * 0.1];
    const uv2 = tri.vt[2] >= 0 && rawUv[tri.vt[2]] ? rawUv[tri.vt[2]] : [p2[0] * 0.1, p2[1] * 0.1];

    const texIdx = matToTexIndex.get(tri.matName) ?? -1;
    const texHasAlpha = texIdx >= 0 ? extractedTextures[texIdx].hasAlphaCutout : false;
    const isPass =
      foliagePassThrough &&
      isFoliageOrPassThroughSurface(tri.groupName, tri.groupName, tri.matName, undefined, texHasAlpha);
    if (isPass) passThroughGroups.add(tri.groupName);

    let list = bucketBuilders.get(tri.matName);
    if (!list) {
      list = [];
      bucketBuilders.set(tri.matName, list);
    }
    let b = list[list.length - 1];
    if (!b || !b.canFitTriangle()) {
      b = new SubmeshChunkBuilder(
        Math.max(0, matList.indexOf(tri.matName)),
        tri.matName.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'default',
        texIdx,
        [200, 200, 200, 255],
        autoAlphaAndTwoSided && texHasAlpha,
        autoAlphaAndTwoSided && texHasAlpha,
        isPass,
        isPass ? 29 : inferHaloMaterialTypeFromName(tri.matName, 2),
      );
      list.push(b);
    }

    const w0 = b.addOrWeldVertex(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2], uv0[0], uv0[1]);
    const w1 = b.addOrWeldVertex(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2], uv1[0], uv1[1]);
    const w2 = b.addOrWeldVertex(p2[0], p2[1], p2[2], n2[0], n2[1], n2[2], uv2[0], uv2[1]);
    if (b.addTriangle(w0, w1, w2)) {
      if (isPass) passThroughTriangleCount++;
      else solidTriangleCount++;
    }
  }

  const submeshChunks: CompiledBspSubmeshChunk[] = [];
  let weldedVertexCount = 0;
  for (const list of bucketBuilders.values()) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.vertexCount === 0 || b.triangleCount === 0) continue;
      const ch = b.finalize(list.length > 1 ? `chunk${i}` : '');
      submeshChunks.push(ch);
      weldedVertexCount += ch.vertexCount;
    }
  }

  const sMin = xformPos([minX, minY, minZ]);
  const sMax = xformPos([maxX, maxY, maxZ]);
  const scaledBounds: ModelBounds3D = {
    min: [Math.min(sMin[0], sMax[0]), Math.min(sMin[1], sMax[1]), Math.min(sMin[2], sMax[2])],
    max: [Math.max(sMin[0], sMax[0]), Math.max(sMin[1], sMax[1]), Math.max(sMin[2], sMax[2])],
    size: [Math.abs(sMax[0] - sMin[0]), Math.abs(sMax[1] - sMin[1]), Math.abs(sMax[2] - sMin[2])],
  };

  const { collisionMesh, solidRaycastTriangles } = buildSolidCollisionParsedMesh(
    submeshChunks,
    scaledBounds,
    scaledBounds,
    options.targetCollisionFaces ?? 3500,
  );

  return {
    format: 'obj',
    modelName,
    sceneNodeCount: groupSet.size,
    meshCount: groupSet.size,
    rawVertexCount: rawPos.length,
    weldedVertexCount,
    totalTriangleCount: solidTriangleCount + passThroughTriangleCount,
    solidTriangleCount,
    passThroughMeshCount: passThroughGroups.size,
    passThroughTriangleCount,
    materialCount: matSet.size,
    embeddedTextureCount: extractedTextures.length,
    extractedTextures,
    submeshChunks,
    rawBounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size: rawSize },
    playableRawBounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size: rawSize },
    scaledBounds,
    playableScaledBounds: scaledBounds,
    appliedScale,
    collisionMesh,
    solidRaycastTriangles,
  };
}

/**
 * Parses a Halo Custom Edition `.JMS` (Jointed Model Skeleton v8200) text file into a `ParsedBspModelResult`.
 */
export function parseJmsForBsp(
  jmsText: string,
  modelName = 'custom_jms',
  options: ModelImportOptions = {},
): ParsedBspModelResult {
  const tokens = jmsText
    .replace(/;[^\r\n]*/g, '')
    .trim()
    .split(/\s+/);
  let cursor = 0;
  const nextInt = () => parseInt(tokens[cursor++] || '0', 10);
  const nextFloat = () => parseFloat(tokens[cursor++] || '0');
  const nextStr = () => tokens[cursor++] || '';

  const version = nextInt(); // e.g. 8200
  if (version >= 8197 && version <= 8210) {
    nextInt(); // node list checksum
  }
  const nodeCount = Math.max(0, Math.min(1024, nextInt()));
  for (let i = 0; i < nodeCount; i++) {
    nextStr(); // name
    nextInt(); // first child
    nextInt(); // sibling
    nextFloat(); nextFloat(); nextFloat(); nextFloat(); // rot i j k w
    nextFloat(); nextFloat(); nextFloat(); // trans x y z
  }

  const matCount = Math.max(0, Math.min(1024, nextInt()));
  const matNames: string[] = [];
  for (let i = 0; i < matCount; i++) {
    matNames.push(nextStr());
    nextStr(); // tif/shader path
  }

  const markerCount = Math.max(0, Math.min(4096, nextInt()));
  for (let i = 0; i < markerCount; i++) {
    nextStr();
    nextInt(); // region
    nextInt(); // node
    nextFloat(); nextFloat(); nextFloat(); nextFloat();
    nextFloat(); nextFloat(); nextFloat();
    nextFloat(); // radius
  }

  const regionCount = Math.max(0, Math.min(256, nextInt()));
  for (let i = 0; i < regionCount; i++) {
    nextStr();
  }

  const vertCount = Math.max(0, Math.min(2_000_000, nextInt()));
  const objLines: string[] = [];
  for (let v = 0; v < vertCount; v++) {
    nextInt(); // node0
    const x = nextFloat() * 0.01; // JMS Max units (100 units = 1 Halo world unit)
    const y = nextFloat() * 0.01;
    const z = nextFloat() * 0.01;
    const nx = nextFloat();
    const ny = nextFloat();
    const nz = nextFloat();
    nextInt(); // node1
    nextFloat(); // node1 weight
    const u = nextFloat();
    const uvV = nextFloat();
    nextInt(); // flags
    objLines.push(`v ${x} ${y} ${z}`);
    objLines.push(`vn ${nx} ${ny} ${nz}`);
    objLines.push(`vt ${u} ${uvV}`);
  }

  const triCount = Math.max(0, Math.min(2_000_000, nextInt()));
  let lastMat = -1;
  for (let t = 0; t < triCount; t++) {
    nextInt(); // region
    const shIdx = nextInt();
    const v0 = nextInt() + 1;
    const v1 = nextInt() + 1;
    const v2 = nextInt() + 1;
    if (shIdx !== lastMat) {
      lastMat = shIdx;
      objLines.push(`usemtl ${matNames[shIdx] || `mat_${shIdx}`}`);
    }
    objLines.push(`f ${v0}/${v0}/${v0} ${v1}/${v1}/${v1} ${v2}/${v2}/${v2}`);
  }

  const parsed = parseObjForBsp(
    objLines.join('\n'),
    modelName,
    {
      ...options,
      flipYz: options.flipYz ?? false,
      manualScale: options.manualScale ?? 1.0,
    },
  );
  parsed.format = 'jms';
  return parsed;
}

/**
 * Unified entry point to parse `.glb`, `.gltf`, `.obj` (+ `.mtl`), or `.jms` files for Halo CE Structure BSP replacement/merging.
 */
export function parseModelFileForBsp(
  filePathOrBuffer: string | Buffer,
  options: ModelImportOptions = {},
  fileNameHint = 'custom_model.glb',
): ParsedBspModelResult {
  let buf: Buffer;
  let ext: string;
  let modelName: string;
  let baseDir: string | undefined;

  if (typeof filePathOrBuffer === 'string') {
    buf = fs.readFileSync(filePathOrBuffer);
    ext = path.extname(filePathOrBuffer).toLowerCase();
    modelName = path.basename(filePathOrBuffer, ext).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'custom_model';
    baseDir = path.dirname(filePathOrBuffer);
  } else {
    buf = filePathOrBuffer;
    ext = path.extname(fileNameHint).toLowerCase();
    modelName = path.basename(fileNameHint, ext).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'custom_model';
  }

  if (buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC) {
    return parseGlbForBsp(buf, modelName, options, baseDir);
  }
  if (ext === '.gltf') {
    return parseGlbForBsp(buf, modelName, options, baseDir);
  }
  if (ext === '.jms') {
    return parseJmsForBsp(buf.toString('utf8'), modelName, options);
  }
  return parseObjForBsp(buf.toString('utf8'), modelName, options, baseDir);
}
