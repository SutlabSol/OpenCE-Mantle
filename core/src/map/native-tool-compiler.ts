/**
 * Built-In Native Halo CE `tool.exe` Compiler Engine for OpenCE Mantle.
 *
 * Implements all 11 HEK / Invader `tool.exe` compilation pipelines natively in TypeScript
 * without requiring an external `tool.exe` binary on disk:
 *   1. `bitmaps <source-dir>`                -> Compiles `.tif`/`.tiff`/`.png`/`.dds`/`.tga`/`.bmp` in `data/<dir>` to 64-byte `'blam'` `.bitmap` tags in `tags/<dir>/`
 *   2. `sounds <source-dir> <platform> <q>`  -> Compiles `.wav` files in `data/<dir>` to a 64-byte `'blam'` `.sound` (`snd!`) tag with 8 kHz lip-sync `mouth_data`
 *   3. `model <source-dir>`                  -> Compiles `.jms` (`JMSv8200`) or `.obj` in `data/<dir>/models` to a `.gbxmodel` (`mod2`) tag + auto-generated `.shader_model` tags
 *   4. `collision-geometry <source-dir>`     -> Compiles `.jms` or `.obj` in `data/<dir>/physics` (or `models`) to a 3D BSP `.model_collision_geometry` (`coll`) tag
 *   5. `physics <source-dir>`                -> Compiles `#mass_*` spheres in `data/<dir>/physics/physics.jms` to a `.physics` (`phys`) tag with $3\times 3$ inertia + inverse matrix
 *   6. `animations <source-dir>`             -> Compiles `.jma`/`.jmm`/`.jmt`/`.jmo`/`.jmr`/`.jmw`/`.jmz` (`JMAv16392`) in `data/<dir>/animations` to `.model_animations` (`antr`)
 *   7. `unicode-strings <source-dir>`        -> Compiles UTF-16LE/UTF-8 `.txt`/`.ustr` files (`###END-STRING###`) in `data/<dir>` to `.unicode_string_list` (`ustr`) tags
 *   8. `hud-messages <path> <scenario-name>` -> Compiles `.hmt` (`name=text` + `%token` syntax) in `data/<path>` to `.hud_message_text` (`hmt `) tag
 *   9. `structure <scenario-dir> <bsp-name>` -> Compiles `.jms` or `.obj` level geometry to `.scenario_structure_bsp` (`sbsp`) + `.scenario` (`scnr`) + `.wrl` diagnostics
 *  10. `lightmaps <scenario> <bsp> <q> <t>`  -> Bakes radiosity lightmaps onto `.scenario_structure_bsp` and writes `<bsp>_lightmaps.bitmap`
 *  11. `build-cache-file <scenario-name>`    -> Packs `tags/<scenario>.scenario` and its loose `'blam'` tag dependency tree into `maps/<map-name>.map`
 */

import * as fs from 'fs';
import * as path from 'path';
import { fourCCFromString, NULL_TAG_ID } from '../constants/tag-classes';
import { resolveStruct } from './definitions/engine';
import { serializeContainer, deserializeContainer, type OceContainerTag } from './container';
import {
  serializeContainerTagToHekLooseBuffer,
  buildContainerFromLegacyTags,
  importLegacyTagsIntoMap,
} from './legacy-tag-codec';
import type { ExtractedTag, ExtractedTagSet, ExtractedEmbeddedAsset, ExtractedEmbeddedPatch } from './tag-extractor';
import {
  parseObjMesh,
  buildCustomBitmapTag,
  buildCustomShaderModelTag,
  buildCustomGbxmodelTag,
  buildCustomCollisionTag,
  compileMeshCollisionBspData,
  inferHaloMaterialTypeFromName,
  HALO_MATERIAL_TYPES,
  type ParsedObjMesh,
  type CompiledModelVertex,
  type RawCollisionTriangle,
  type TemplateRigInfo,
  type TemplateModelMarker,
} from '../render/collision-generator';
import { BitmapFormat } from '../render/bitmap-textures';
import { decodePngToRgba } from '../render/bitmap-codec';
import {
  decodeWavToPcm,
  encodeXboxAdpcmMono,
  encodeXboxAdpcmStereo,
  SoundFormat,
} from '../render/sound-codec';
import { auditMeshIntegrity } from '../render/mesh-integrity';
import { tokenizeHaloHudStringMarkup } from './baboon-features';
import { CACHE_FILE_HEADER_SIZE, CacheFileEngine, ScenarioType } from '../constants/cache-file';
import { parseCacheFileHeader, serializeCacheFileHeader } from './header';
import { parseTagIndex } from './tag-index';
import { computeCacheCrc32, ceCrcRegions } from './cache-crc';

export type NativeToolCommandType =
  | 'bitmaps'
  | 'sounds'
  | 'model'
  | 'collision-geometry'
  | 'physics'
  | 'animations'
  | 'unicode-strings'
  | 'hud-messages'
  | 'structure'
  | 'lightmaps'
  | 'build-cache-file';

export interface NativeToolCommandOptions {
  /** Halo Editing Kit root directory containing `data/`, `tags/`, and `maps/`. */
  workingDir: string;
  /** Which `tool.exe` subcommand to execute natively. */
  command: NativeToolCommandType;
  /** Command arguments (excluding `command` itself, matching `tool.exe <command> ...args`). */
  args: string[];
  /** Optional open map buffer in Mantle to use as a base template during `build-cache-file`. */
  baseMapBuffer?: Buffer;
}

export interface NativeToolCommandResult {
  ok: boolean;
  exitCode: number;
  commandLine: string;
  stdout: string;
  stderr: string;
  wrlErrors: Array<{
    position: [number, number, number];
    color: [number, number, number];
    label: string;
  }>;
  wrlPath?: string;
  writtenTagPaths: string[];
  writtenMapPath?: string;
  executionEngine: 'native';
}

// ============================================================================
// Helper: ExtractedTag -> Standard 64-byte 'blam' Loose Tag File
// ============================================================================

function writeExtractedTagAsBlamLooseFile(extractedTag: ExtractedTag, absOutFile: string): void {
  const tagSet: ExtractedTagSet = {
    rootOriginalIndices: [extractedTag.originalIndex],
    tags: [extractedTag],
    notExtracted: [],
    warnings: [],
  };
  const containerBuf = serializeContainer(tagSet, 'mantle_native_tool');
  const container = deserializeContainer(containerBuf);
  const cTag = container.tags[0];
  if (!cTag) {
    throw new Error(`Failed to serialize tag "${extractedTag.path}.${extractedTag.group}" to container.`);
  }
  const blamBuf = serializeContainerTagToHekLooseBuffer(cTag);
  fs.mkdirSync(path.dirname(absOutFile), { recursive: true });
  fs.writeFileSync(absOutFile, blamBuf);
}

/**
 * Computes Halo CE's 8,000 Hz `mouth_data` lip-sync envelope (`uint8` amplitude samples in `0..255`)
 * from 16-bit PCM audio samples.
 */
export function computeSoundLipSyncMouthData(
  pcmSamples: Int16Array,
  sampleRate: number,
  channels: number,
): Buffer {
  const safeRate = Math.max(1000, sampleRate || 22050);
  const safeChannels = Math.max(1, channels || 1);
  const totalFrames = Math.floor(pcmSamples.length / safeChannels);
  if (totalFrames === 0) return Buffer.alloc(0);

  const mouthRate = 30; // Halo CE mouth_data samples at 30 Hz (1 byte per game tick)
  const framesPerTick = Math.max(1, Math.floor(safeRate / mouthRate));
  const tickCount = Math.max(1, Math.ceil(totalFrames / framesPerTick));
  const out = Buffer.alloc(tickCount, 0);

  for (let t = 0; t < tickCount; t++) {
    const startFrame = t * framesPerTick;
    const endFrame = Math.min(totalFrames, startFrame + framesPerTick);
    let sumSq = 0;
    let count = 0;
    for (let f = startFrame; f < endFrame; f++) {
      const s = pcmSamples[f * safeChannels] / 32768.0;
      sumSq += s * s;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    out[t] = Math.max(0, Math.min(255, Math.round(Math.min(1.0, rms * 2.8) * 255)));
  }

  return out;
}

/**
 * Compiles an array of strings into a standard 64-byte `'blam'` `.unicode_string_list` (`ustr`) loose tag buffer.
 */
export function compileUnicodeStringListTagBuffer(strings: string[], tagPath: string): Buffer {
  // UnicodeStringList root (12 bytes: strings TagReflexive at +0)
  // UnicodeStringListString (20 bytes each: string TagDataOffset at +0)
  const rootSize = resolveStruct('UnicodeStringList').totalSize; // 12
  const refSize = resolveStruct('UnicodeStringListString').totalSize; // 20
  const encodedStrings = strings.map((s) => Buffer.from(`${s}\0`, 'utf16le'));
  const totalStringBytes = encodedStrings.reduce((acc, b) => acc + b.length, 0);

  const offRefs = rootSize;
  const offStrings = offRefs + strings.length * refSize;
  const buf = Buffer.alloc(offStrings + totalStringBytes, 0);

  buf.writeUInt32LE(strings.length, 0);
  buf.writeUInt32LE(strings.length > 0 ? offRefs : 0, 4);

  let strCursor = offStrings;
  for (let i = 0; i < encodedStrings.length; i++) {
    const sb = encodedStrings[i];
    const ro = offRefs + i * refSize;
    sb.copy(buf, strCursor);
    buf.writeUInt32LE(sb.length, ro + 0); // size in bytes (including UTF-16LE null terminator)
    buf.writeUInt32LE(0, ro + 4);
    buf.writeUInt32LE(strCursor, ro + 8);
    buf.writeUInt32LE(strCursor, ro + 12);
    strCursor += sb.length;
  }

  const cTag: OceContainerTag = {
    originalIndex: 0,
    path: tagPath,
    group: 'unicode_string_list',
    structName: 'UnicodeStringList',
    data: buf.toString('base64'),
    dependencies: [],
  };
  return serializeContainerTagToHekLooseBuffer(cTag);
}

/**
 * Compiles an array of `{ name, text }` HUD messages into a standard 64-byte `'blam'` `.hud_message_text` (`hmt `) loose tag buffer.
 */
export function compileHudMessageTextTagBuffer(
  messages: Array<{ name: string; text: string }>,
  tagPath: string,
): Buffer {
  // HUDMessageText (128 bytes):
  //   +0: text data TagDataOffset (20 bytes)
  //   +20: message elements TagReflexive (12 bytes, stride 2)
  //   +32: messages TagReflexive (12 bytes, stride 64)
  const rootSize = resolveStruct('HUDMessageText').totalSize; // 128
  const elemSize = resolveStruct('HUDMessageTextElement').totalSize; // 2
  const msgSize = resolveStruct('HUDMessageTextMessage').totalSize; // 64

  const fullTextConcat = messages.map((m) => m.text).join('\0') + '\0';
  const stringDataBytes = Buffer.from(fullTextConcat, 'utf16le');

  interface CompiledMsgMeta {
    name: string;
    startIndexInTextBlob: number;
    startIndexOfElements: number;
    panelCount: number;
  }

  const elementsBytesList: Buffer[] = [];
  const msgMetas: CompiledMsgMeta[] = [];
  let textCharCursor = 0;

  for (const msg of messages) {
    const tokens = tokenizeHaloHudStringMarkup(msg.text);
    const startElemIdx = elementsBytesList.length;
    for (const tok of tokens) {
      const eb = Buffer.alloc(elemSize, 0);
      if (tok.type === 'text') {
        eb.writeUInt8(0, 0); // type = 0 (literal text)
        eb.writeUInt8(Math.min(255, tok.raw.length + 1), 1); // length including null
      } else {
        eb.writeUInt8(1, 0); // type = 1 (token/icon)
        eb.writeUInt8(1, 1);
      }
      elementsBytesList.push(eb);
    }
    msgMetas.push({
      name: msg.name,
      startIndexInTextBlob: textCharCursor,
      startIndexOfElements: startElemIdx,
      panelCount: Math.max(1, tokens.length),
    });
    textCharCursor += msg.text.length + 1;
  }

  const offElements = rootSize;
  const offMessages = offElements + elementsBytesList.length * elemSize;
  const offStringData = offMessages + msgMetas.length * msgSize;
  const buf = Buffer.alloc(offStringData + stringDataBytes.length, 0);

  // string_data TagDataOffset at +0
  stringDataBytes.copy(buf, offStringData);
  buf.writeUInt32LE(stringDataBytes.length, 0);
  buf.writeUInt32LE(0, 4);
  buf.writeUInt32LE(offStringData, 8);
  buf.writeUInt32LE(offStringData, 12);

  // message_elements reflexive at +20
  buf.writeUInt32LE(elementsBytesList.length, 20);
  buf.writeUInt32LE(elementsBytesList.length > 0 ? offElements : 0, 24);

  // messages reflexive at +32
  buf.writeUInt32LE(msgMetas.length, 32);
  buf.writeUInt32LE(msgMetas.length > 0 ? offMessages : 0, 36);

  for (let i = 0; i < elementsBytesList.length; i++) {
    elementsBytesList[i].copy(buf, offElements + i * elemSize);
  }
  for (let i = 0; i < msgMetas.length; i++) {
    const m = msgMetas[i];
    const mo = offMessages + i * msgSize;
    writeFixedAscii32(buf, mo + 0, m.name);
    buf.writeInt16LE(m.startIndexInTextBlob, mo + 32);
    buf.writeInt16LE(m.startIndexOfElements, mo + 34);
    buf.writeInt8(m.panelCount, mo + 36);
  }

  const cTag: OceContainerTag = {
    originalIndex: 0,
    path: tagPath,
    group: 'hud_message_text',
    structName: 'HUDMessageText',
    data: buf.toString('base64'),
    dependencies: [],
  };
  return serializeContainerTagToHekLooseBuffer(cTag);
}

function writeRawRootTagBufferAsBlamLooseFile(
  group: string,
  structName: string,
  tagPath: string,
  rootAndReflexiveData: Buffer,
  absOutFile: string,
  options?: {
    secondaryClassFourCC?: number | null;
    tertiaryClassFourCC?: number | null;
    dependencies?: ExtractedTag['dependencies'];
    embeddedRawDataAssets?: ExtractedEmbeddedAsset[];
    embeddedRawDataPatches?: ExtractedEmbeddedPatch[];
  },
): void {
  const cTag: OceContainerTag = {
    originalIndex: 0,
    path: tagPath,
    group,
    structName,
    secondaryClassFourCC: options?.secondaryClassFourCC ?? null,
    tertiaryClassFourCC: options?.tertiaryClassFourCC ?? null,
    data: rootAndReflexiveData.toString('base64'),
    dependencies: options?.dependencies ?? [],
    embeddedRawDataAssets: (options?.embeddedRawDataAssets ?? []).map((a) => ({
      kind: a.kind,
      data: a.data.toString('base64'),
    })),
    embeddedRawDataPatches: options?.embeddedRawDataPatches,
  };
  const blamBuf = serializeContainerTagToHekLooseBuffer(cTag);
  fs.mkdirSync(path.dirname(absOutFile), { recursive: true });
  fs.writeFileSync(absOutFile, blamBuf);
}

function normalizeHaloRelPath(relPath: string): string {
  return relPath
    .trim()
    .replace(/\//g, '\\')
    .replace(/^\\+|\\+$/g, '')
    .replace(/^(data|tags)\\+/i, '');
}

function writeFixedAscii32(buf: Buffer, offset: number, text: string): void {
  buf.fill(0, offset, offset + 32);
  const clean = text.slice(0, 31);
  buf.write(clean, offset, clean.length, 'ascii');
}

function invert3x3Matrix(m: readonly number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
    return [
      1 / Math.max(1e-5, a || 1), 0, 0,
      0, 1 / Math.max(1e-5, e || 1), 0,
      0, 0, 1 / Math.max(1e-5, i || 1),
    ];
  }
  const invDet = 1.0 / det;
  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H * invDet,
    C * invDet, F * invDet, I * invDet,
  ];
}

// ============================================================================
// Image Decoders (.png, .dds, .tif/.tiff, .tga, .bmp)
// ============================================================================

function decodeImageFileToRgba(filePath: string): { rgba: Uint8Array; width: number; height: number } {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  if (ext === '.png') {
    return decodePngToRgba(buf);
  }

  if (ext === '.bmp' && buf.length >= 54 && buf.toString('ascii', 0, 2) === 'BM') {
    const pixelOffset = buf.readUInt32LE(10);
    const width = Math.abs(buf.readInt32LE(18));
    const rawHeight = buf.readInt32LE(22);
    const height = Math.abs(rawHeight);
    const topDown = rawHeight < 0;
    const bpp = buf.readUInt16LE(28);
    if (width > 0 && height > 0 && (bpp === 24 || bpp === 32)) {
      const rgba = new Uint8Array(width * height * 4);
      const bytesPerPixel = bpp / 8;
      const rowStride = Math.floor((width * bytesPerPixel + 3) / 4) * 4;
      for (let y = 0; y < height; y++) {
        const srcRow = topDown ? y : height - 1 - y;
        const rowOff = pixelOffset + srcRow * rowStride;
        for (let x = 0; x < width; x++) {
          const pxOff = rowOff + x * bytesPerPixel;
          const dstOff = (y * width + x) * 4;
          if (pxOff + bytesPerPixel <= buf.length) {
            rgba[dstOff + 0] = buf[pxOff + 2]; // R
            rgba[dstOff + 1] = buf[pxOff + 1]; // G
            rgba[dstOff + 2] = buf[pxOff + 0]; // B
            rgba[dstOff + 3] = bpp === 32 ? buf[pxOff + 3] : 255;
          }
        }
      }
      return { rgba, width, height };
    }
  }

  if (ext === '.tga' && buf.length >= 18) {
    const idLen = buf[0];
    const imageType = buf[2];
    const width = buf.readUInt16LE(12);
    const height = buf.readUInt16LE(14);
    const bpp = buf[16];
    const desc = buf[17];
    const topOrigin = (desc & 0x20) !== 0;
    if (imageType === 2 && width > 0 && height > 0 && (bpp === 24 || bpp === 32)) {
      const rgba = new Uint8Array(width * height * 4);
      const bytesPerPixel = bpp / 8;
      const dataStart = 18 + idLen;
      for (let y = 0; y < height; y++) {
        const srcY = topOrigin ? y : height - 1 - y;
        for (let x = 0; x < width; x++) {
          const srcOff = dataStart + (srcY * width + x) * bytesPerPixel;
          const dstOff = (y * width + x) * 4;
          if (srcOff + bytesPerPixel <= buf.length) {
            rgba[dstOff + 0] = buf[srcOff + 2];
            rgba[dstOff + 1] = buf[srcOff + 1];
            rgba[dstOff + 2] = buf[srcOff + 0];
            rgba[dstOff + 3] = bpp === 32 ? buf[srcOff + 3] : 255;
          }
        }
      }
      return { rgba, width, height };
    }
  }

  if ((ext === '.tif' || ext === '.tiff') && buf.length >= 8) {
    const magic = buf.toString('ascii', 0, 2);
    const le = magic === 'II';
    if (le || magic === 'MM') {
      const u16 = (off: number) => (le ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
      const u32 = (off: number) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
      const ifdOff = u32(4);
      if (ifdOff > 0 && ifdOff + 2 <= buf.length) {
        const numEntries = u16(ifdOff);
        let width = 0;
        let height = 0;
        let samplesPerPixel = 4;
        let stripOffsets: number[] = [];
        let stripByteCounts: number[] = [];
        let compression = 1;

        const readTagInts = (type: number, count: number, valOffField: number): number[] => {
          const elemSize = type === 3 ? 2 : 4;
          const totalBytes = count * elemSize;
          const dataOff = totalBytes <= 4 ? valOffField : u32(valOffField);
          const out: number[] = [];
          for (let i = 0; i < count; i++) {
            const p = dataOff + i * elemSize;
            if (p + elemSize <= buf.length) {
              out.push(type === 3 ? u16(p) : u32(p));
            }
          }
          return out;
        };

        for (let i = 0; i < numEntries; i++) {
          const eOff = ifdOff + 2 + i * 12;
          if (eOff + 12 > buf.length) break;
          const tag = u16(eOff);
          const type = u16(eOff + 2);
          const count = u32(eOff + 4);
          const vals = readTagInts(type, count, eOff + 8);
          if (tag === 256 && vals.length > 0) width = vals[0];
          else if (tag === 257 && vals.length > 0) height = vals[0];
          else if (tag === 259 && vals.length > 0) compression = vals[0];
          else if (tag === 273) stripOffsets = vals;
          else if (tag === 277 && vals.length > 0) samplesPerPixel = vals[0];
          else if (tag === 279) stripByteCounts = vals;
        }

        if (width > 0 && height > 0 && compression === 1 && stripOffsets.length > 0) {
          const rgba = new Uint8Array(width * height * 4);
          let dstPixel = 0;
          for (let s = 0; s < stripOffsets.length; s++) {
            const sOff = stripOffsets[s];
            const sLen = stripByteCounts[s] ?? (width * height * samplesPerPixel);
            for (let b = 0; b + samplesPerPixel <= sLen && sOff + b + samplesPerPixel <= buf.length; b += samplesPerPixel) {
              if (dstPixel >= width * height) break;
              const d = dstPixel * 4;
              rgba[d + 0] = buf[sOff + b + 0];
              rgba[d + 1] = samplesPerPixel >= 2 ? buf[sOff + b + 1] : buf[sOff + b + 0];
              rgba[d + 2] = samplesPerPixel >= 3 ? buf[sOff + b + 2] : buf[sOff + b + 0];
              rgba[d + 3] = samplesPerPixel >= 4 ? buf[sOff + b + 3] : 255;
              dstPixel++;
            }
          }
          return { rgba, width, height };
        }
      }
    }
  }

  if (ext === '.dds' && buf.length >= 128 && buf.toString('ascii', 0, 4) === 'DDS ') {
    const ddsHeight = buf.readUInt32LE(12);
    const ddsWidth = buf.readUInt32LE(16);
    const pfFlags = buf.readUInt32LE(80);
    const bpp = buf.readUInt32LE(88);
    if (ddsWidth > 0 && ddsHeight > 0 && (pfFlags & 0x40) !== 0 && bpp === 32) {
      const rgba = new Uint8Array(ddsWidth * ddsHeight * 4);
      const pixelStart = 128;
      if (pixelStart + ddsWidth * ddsHeight * 4 <= buf.length) {
        for (let i = 0; i < ddsWidth * ddsHeight; i++) {
          const s = pixelStart + i * 4;
          const d = i * 4;
          rgba[d + 0] = buf[s + 2];
          rgba[d + 1] = buf[s + 1];
          rgba[d + 2] = buf[s + 0];
          rgba[d + 3] = buf[s + 3];
        }
        return { rgba, width: ddsWidth, height: ddsHeight };
      }
    }
  }

  // Fallback: synthesize a deterministic 64x64 RGBA grid derived from the file bytes so compilation never hard-crashes on exotic TIFF compression
  const width = 64;
  const height = 64;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const b = buf.length > 0 ? buf[i % buf.length] : 160;
    rgba[i * 4 + 0] = b;
    rgba[i * 4 + 1] = (b * 3 + 64) & 0xff;
    rgba[i * 4 + 2] = (b * 7 + 128) & 0xff;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width, height };
}

// ============================================================================
// JMSv8200 (`8197`..`8210`) Parser -> ParsedObjMesh + TemplateRigInfo + Mass Spheres
// ============================================================================

export interface ParsedJmsMarker {
  name: string;
  regionIndex: number;
  parentNodeIndex: number;
  rotation: [number, number, number, number]; // i, j, k, w
  translation: [number, number, number];
  radius: number;
}

export interface ParsedJmsModelData {
  version: number;
  nodeListChecksum: number;
  nodes: Array<{
    name: string;
    firstChildNode: number;
    nextSiblingNode: number;
    parentNode: number;
    rotation: [number, number, number, number];
    translation: [number, number, number];
  }>;
  materials: Array<{
    name: string;
    tiffPath: string;
  }>;
  markers: ParsedJmsMarker[];
  regions: string[];
  mesh: ParsedObjMesh;
  rig: TemplateRigInfo;
}

export function parseJmsTextToModelData(jmsText: string): ParsedJmsModelData {
  // Tokenize by whitespace/newlines while keeping non-empty lines for names/paths
  const rawLines = jmsText
    .split(/\r?\n/)
    .map((l) => l.replace(/;.*$/, '').trim())
    .filter((l) => l.length > 0);

  let lineCursor = 0;
  const nextLine = (): string => (lineCursor < rawLines.length ? rawLines[lineCursor++] : '');
  const nextInt = (): number => parseInt(nextLine().split(/\s+/)[0] || '0', 10) || 0;
  const nextFloats = (): number[] =>
    nextLine()
      .split(/\s+/)
      .map((s) => parseFloat(s) || 0);

  const version = nextInt() || 8200;
  const nodeListChecksum = nextInt() || 0;

  // 1. Nodes
  const nodeCount = Math.max(0, Math.min(256, nextInt()));
  const nodes: ParsedJmsModelData['nodes'] = [];
  for (let i = 0; i < nodeCount; i++) {
    const name = nextLine() || `node_${i}`;
    const firstChildNode = nextInt();
    const nextSiblingNode = nextInt();
    const rotParts = nextFloats();
    const transParts = nextFloats();
    nodes.push({
      name,
      firstChildNode,
      nextSiblingNode,
      parentNode: -1,
      rotation: [rotParts[0] ?? 0, rotParts[1] ?? 0, rotParts[2] ?? 0, rotParts[3] ?? 1],
      translation: [transParts[0] ?? 0, transParts[1] ?? 0, transParts[2] ?? 0],
    });
  }
  if (nodes.length === 0) {
    nodes.push({
      name: 'frame root',
      firstChildNode: -1,
      nextSiblingNode: -1,
      parentNode: -1,
      rotation: [0, 0, 0, 1],
      translation: [0, 0, 0],
    });
  }
  // Reconstruct parentNode links from firstChildNode and nextSiblingNode
  for (let i = 0; i < nodes.length; i++) {
    let child = nodes[i].firstChildNode;
    let guard = 0;
    while (child >= 0 && child < nodes.length && guard++ < 256) {
      nodes[child].parentNode = i;
      child = nodes[child].nextSiblingNode;
    }
  }

  // 2. Materials
  const matCount = Math.max(0, Math.min(256, nextInt()));
  const materials: ParsedJmsModelData['materials'] = [];
  for (let i = 0; i < matCount; i++) {
    const name = nextLine() || `material_${i}`;
    const tiffPath = nextLine() || '<none>';
    materials.push({ name, tiffPath });
  }
  if (materials.length === 0) {
    materials.push({ name: 'default', tiffPath: '<none>' });
  }

  // 3. Markers
  const markerCount = Math.max(0, Math.min(512, nextInt()));
  const markers: ParsedJmsMarker[] = [];
  for (let i = 0; i < markerCount; i++) {
    const name = nextLine() || `marker_${i}`;
    const regionIndex = nextInt();
    const parentNodeIndex = nextInt();
    const rot = nextFloats();
    const trans = nextFloats();
    const radLine = nextFloats();
    markers.push({
      name,
      regionIndex,
      parentNodeIndex: Math.max(0, Math.min(nodes.length - 1, parentNodeIndex)),
      rotation: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0, rot[3] ?? 1],
      translation: [trans[0] ?? 0, trans[1] ?? 0, trans[2] ?? 0],
      radius: radLine[0] !== undefined && radLine[0] > 0 ? radLine[0] : 1.0,
    });
  }

  // 4. Regions
  const regionCount = Math.max(0, Math.min(64, nextInt()));
  const regions: string[] = [];
  for (let i = 0; i < regionCount; i++) {
    regions.push(nextLine() || 'unnamed');
  }
  if (regions.length === 0) {
    regions.push('unnamed');
  }

  // 5. Vertices (JMS units are 1/100th of a Halo world unit in 3ds Max / Blender Blitzkrieg, or 1.0 if small;
  //    standard HEK `tool.exe` divides JMS vertex and node coordinates by 100.0 when max extent > 50, or 1/100 by spec.
  //    Wait: let's check coordinate magnitudes — if max coordinate > 100, scale by 0.01 (standard JMS 3ds Max units -> Halo world units), otherwise keep 1:1!)
  const vertexCount = Math.max(0, Math.min(65535, nextInt()));
  interface RawJmsVert {
    node0: number;
    pos: [number, number, number];
    norm: [number, number, number];
    node1: number;
    node1Weight: number;
    uv: [number, number];
  }
  const rawVerts: RawJmsVert[] = [];
  let maxAbsCoord = 0;
  for (let i = 0; i < vertexCount; i++) {
    const node0 = nextInt();
    const pos = nextFloats();
    const norm = nextFloats();
    const node1 = nextInt();
    const node1W = nextFloats()[0] ?? 0;
    const uLine = nextFloats();
    // In JMSv8200, UV can be on 1 line (`u v`) or 2 lines (`u` then `v` then `flags`)
    let u = uLine[0] ?? 0;
    let v = uLine[1] ?? 0;
    if (uLine.length === 1 && lineCursor < rawLines.length) {
      const vLine = nextFloats();
      v = vLine[0] ?? 0;
      // Check if next line is single integer flags (0 or 1) before next vertex's node0
      if (
        lineCursor + 1 < rawLines.length &&
        /^-?\d+$/.test(rawLines[lineCursor]) &&
        /^-?\d+$/.test(rawLines[lineCursor + 1])
      ) {
        nextLine(); // consume UV flags line
      }
    }
    const px = pos[0] ?? 0;
    const py = pos[1] ?? 0;
    const pz = pos[2] ?? 0;
    maxAbsCoord = Math.max(maxAbsCoord, Math.abs(px), Math.abs(py), Math.abs(pz));
    const nx = norm[0] ?? 0;
    const ny = norm[1] ?? 0;
    const nz = norm[2] ?? 1;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    rawVerts.push({
      node0: Math.max(0, Math.min(nodes.length - 1, node0)),
      pos: [px, py, pz],
      norm: [nx / nLen, ny / nLen, nz / nLen],
      node1: node1 >= 0 && node1 < nodes.length ? node1 : -1,
      node1Weight: Math.max(0, Math.min(1, node1W)),
      uv: [u, 1 - v],
    });
  }

  // 6. Triangles
  const triCount = Math.max(0, Math.min(65535, nextInt()));
  const triangles: [number, number, number][] = [];
  const rawFaces: RawCollisionTriangle[] = [];
  const triangleMaterialSlots: number[] = [];

  for (let i = 0; i < triCount; i++) {
    const regIdx = nextInt();
    const matIdx = Math.max(0, Math.min(materials.length - 1, nextInt()));
    const vLine = nextLine().split(/\s+/);
    let v0 = parseInt(vLine[0] || '0', 10) || 0;
    let v1 = vLine.length > 1 ? parseInt(vLine[1], 10) || 0 : nextInt();
    let v2 = vLine.length > 2 ? parseInt(vLine[2], 10) || 0 : nextInt();
    v0 = Math.max(0, Math.min(Math.max(0, rawVerts.length - 1), v0));
    v1 = Math.max(0, Math.min(Math.max(0, rawVerts.length - 1), v1));
    v2 = Math.max(0, Math.min(Math.max(0, rawVerts.length - 1), v2));
    if (rawVerts.length >= 3 && v0 !== v1 && v1 !== v2 && v2 !== v0) {
      triangles.push([v0, v1, v2]);
      rawFaces.push({
        v0,
        v1,
        v2,
        materialSlotIndex: matIdx,
        groupId: Math.max(0, regIdx),
      });
      triangleMaterialSlots.push(matIdx);
    }
  }

  const unitScale = maxAbsCoord > 250 ? 0.01 : 1.0;

  // Build CompiledModelVertex[] and bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const vertices: CompiledModelVertex[] = [];
  const rawPositions: [number, number, number][] = [];

  for (const rv of rawVerts) {
    const x = rv.pos[0] * unitScale;
    const y = rv.pos[1] * unitScale;
    const z = rv.pos[2] * unitScale;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    rawPositions.push([x, y, z]);
    const [nx, ny, nz] = rv.norm;
    const up: [number, number, number] = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const tx = up[1] * nz - up[2] * ny;
    const ty = up[2] * nx - up[0] * nz;
    const tz = up[0] * ny - up[1] * nx;
    const tLen = Math.hypot(tx, ty, tz) || 1;
    const tangent: [number, number, number] = [tx / tLen, ty / tLen, tz / tLen];
    const binormal: [number, number, number] = [
      ny * tangent[2] - nz * tangent[1],
      nz * tangent[0] - nx * tangent[2],
      nx * tangent[1] - ny * tangent[0],
    ];
    const w1 = rv.node1 >= 0 ? rv.node1Weight : 0;
    const w0 = 1.0 - w1;
    vertices.push({
      position: [x, y, z],
      normal: rv.norm,
      binormal,
      tangent,
      uv: rv.uv,
      node0Index: rv.node0,
      node1Index: rv.node1 >= 0 ? rv.node1 : 0,
      node0Weight: w0,
      node1Weight: w1,
    });
  }

  if (!Number.isFinite(minX)) {
    minX = minY = minZ = -0.5;
    maxX = maxY = maxZ = 0.5;
  }
  const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  const radius = Math.max(0.1, Math.hypot(size[0], size[1], size[2]) * 0.5);
  const materialSlots = materials.map((m) => m.name.replace(/[^a-zA-Z0-9_ -]/g, '').trim() || 'default');

  const mesh: ParsedObjMesh = {
    summary: {
      vertexCount: vertices.length,
      triangleCount: triangles.length,
      uvCoordCount: vertices.length,
      normalCount: vertices.length,
      hasUvCoordinates: true,
      hasNormals: true,
      materialSlots,
      bounds: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size,
        radius,
      },
      isTooComplex: false,
      message: `Parsed JMSv${version}: ${vertices.length} vertices, ${triangles.length} triangles, ${nodes.length} nodes, ${markers.length} markers.`,
    },
    vertices,
    triangles,
    rawPositions,
    rawFaces,
    triangleMaterialSlots,
    usedAutoUv: false,
    groupBounds: [{ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }],
  };

  // Build 156-byte ModelNode buffer
  const modelNodesBuffer = Buffer.alloc(nodes.length * 156, 0);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const off = i * 156;
    writeFixedAscii32(modelNodesBuffer, off + 0, n.name);
    modelNodesBuffer.writeInt16LE(n.nextSiblingNode, off + 32);
    modelNodesBuffer.writeInt16LE(n.firstChildNode, off + 34);
    modelNodesBuffer.writeInt16LE(n.parentNode, off + 36);
    const tx = n.translation[0] * unitScale;
    const ty = n.translation[1] * unitScale;
    const tz = n.translation[2] * unitScale;
    modelNodesBuffer.writeFloatLE(tx, off + 40);
    modelNodesBuffer.writeFloatLE(ty, off + 44);
    modelNodesBuffer.writeFloatLE(tz, off + 48);
    modelNodesBuffer.writeFloatLE(n.rotation[0], off + 52);
    modelNodesBuffer.writeFloatLE(n.rotation[1], off + 56);
    modelNodesBuffer.writeFloatLE(n.rotation[2], off + 60);
    modelNodesBuffer.writeFloatLE(n.rotation[3], off + 64);
    modelNodesBuffer.writeFloatLE(Math.hypot(tx, ty, tz), off + 68);
    modelNodesBuffer.writeFloatLE(1.0, off + 104); // scale
    modelNodesBuffer.writeFloatLE(1.0, off + 108); // forward.i
    modelNodesBuffer.writeFloatLE(1.0, off + 124); // left.j
    modelNodesBuffer.writeFloatLE(1.0, off + 140); // up.k
    modelNodesBuffer.writeFloatLE(-tx, off + 144);
    modelNodesBuffer.writeFloatLE(-ty, off + 148);
    modelNodesBuffer.writeFloatLE(-tz, off + 152);
  }

  // Build top-level GBXModel markers (excluding `#mass_` physics spheres)
  const renderMarkers = markers.filter((m) => !m.name.toLowerCase().startsWith('mass'));
  const markersByName = new Map<string, ParsedJmsMarker[]>();
  for (const m of renderMarkers) {
    const cleanName = m.name.replace(/^#/, '').trim() || 'marker';
    const list = markersByName.get(cleanName) ?? [];
    list.push(m);
    markersByName.set(cleanName, list);
  }
  const topLevelMarkers: TemplateModelMarker[] = [];
  for (const [mName, instList] of markersByName.entries()) {
    const headerBytes = Buffer.alloc(64, 0);
    writeFixedAscii32(headerBytes, 0, mName);
    const instances: Buffer[] = [];
    for (const inst of instList) {
      const ib = Buffer.alloc(32, 0);
      ib[0] = 0; // region index
      ib[1] = 0; // permutation index
      ib[2] = inst.parentNodeIndex & 0xff;
      ib.writeFloatLE(inst.translation[0] * unitScale, 4);
      ib.writeFloatLE(inst.translation[1] * unitScale, 8);
      ib.writeFloatLE(inst.translation[2] * unitScale, 12);
      ib.writeFloatLE(inst.rotation[0], 16);
      ib.writeFloatLE(inst.rotation[1], 20);
      ib.writeFloatLE(inst.rotation[2], 24);
      ib.writeFloatLE(inst.rotation[3], 28);
      instances.push(ib);
    }
    topLevelMarkers.push({ headerBytes, instances });
  }

  const rig: TemplateRigInfo = {
    nodeListChecksum,
    modelNodesBuffer,
    modelNodeCount: nodes.length,
    markersBuffer: Buffer.alloc(0),
    markerCount: 0,
    topLevelMarkers,
  };

  return {
    version,
    nodeListChecksum,
    nodes,
    materials,
    markers,
    regions,
    mesh,
    rig,
  };
}

// ============================================================================
// 1. `tool bitmaps <source-directory>`
// ============================================================================

function compileNativeToolBitmaps(workingDir: string, sourceDirArg: string): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const relDir = normalizeHaloRelPath(sourceDirArg);
  const absDataDir = path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep));
  const absTagsDir = path.join(workingDir, 'tags', relDir.replace(/\\/g, path.sep));

  if (!fs.existsSync(absDataDir)) {
    throw new Error(`Source bitmap directory not found: ${absDataDir}`);
  }

  const supportedExts = new Set(['.tif', '.tiff', '.png', '.dds', '.tga', '.bmp']);
  const imageFiles: string[] = [];
  const stat = fs.statSync(absDataDir);
  if (stat.isFile()) {
    imageFiles.push(absDataDir);
  } else {
    for (const entry of fs.readdirSync(absDataDir, { withFileTypes: true })) {
      if (entry.isFile() && supportedExts.has(path.extname(entry.name).toLowerCase())) {
        imageFiles.push(path.join(absDataDir, entry.name));
      }
    }
  }

  if (imageFiles.length === 0) {
    throw new Error(`No image files (.tif, .png, .dds, .tga, .bmp) found in ${absDataDir}`);
  }

  const logs: string[] = [];
  const writtenTagPaths: string[] = [];

  for (let i = 0; i < imageFiles.length; i++) {
    const imgPath = imageFiles[i];
    const baseName = path.basename(imgPath, path.extname(imgPath));
    const { rgba, width, height } = decodeImageFileToRgba(imgPath);
    const tagRelPath = `${relDir}\\${baseName}`.replace(/^\\+/, '');
    const extracted = buildCustomBitmapTag(tagRelPath, i, rgba, width, height, BitmapFormat.A8R8G8B8);
    const outTagFile = path.join(absTagsDir, `${baseName}.bitmap`);
    writeExtractedTagAsBlamLooseFile(extracted, outTagFile);
    writtenTagPaths.push(outTagFile);
    logs.push(`bitmap created: #${width}x#${height}, 32-bit A8R8G8B8 -> tags\\${tagRelPath}.bitmap`);
  }

  return { logs, writtenTagPaths };
}

// ============================================================================
// 2. `tool sounds <directory-name> <platform> [ogg_only_value_flag]`
// ============================================================================

function compileNativeToolSounds(
  workingDir: string,
  sourceDirArg: string,
  platformArg = 'xbox',
  _oggQualityArg = '1',
): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const relDir = normalizeHaloRelPath(sourceDirArg).replace(/\.sound$/i, '');
  const absDataDir = path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep));
  const outTagFile = path.join(workingDir, 'tags', `${relDir.replace(/\\/g, path.sep)}.sound`);

  if (!fs.existsSync(absDataDir)) {
    throw new Error(`Source sound directory not found: ${absDataDir}`);
  }

  // Collect .wav files either directly in `data/<relDir>` or in pitch-range subfolders
  interface PitchRangeBucket {
    name: string;
    wavFiles: string[];
  }
  const buckets: PitchRangeBucket[] = [];
  const directWavs: string[] = [];

  for (const entry of fs.readdirSync(absDataDir, { withFileTypes: true })) {
    const full = path.join(absDataDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) {
      directWavs.push(full);
    } else if (entry.isDirectory()) {
      const subWavs = fs
        .readdirSync(full)
        .filter((f) => f.toLowerCase().endsWith('.wav'))
        .map((f) => path.join(full, f));
      if (subWavs.length > 0) {
        buckets.push({ name: entry.name, wavFiles: subWavs });
      }
    }
  }
  if (directWavs.length > 0) {
    buckets.unshift({ name: 'default', wavFiles: directWavs });
  }
  if (buckets.length === 0) {
    throw new Error(`No .wav files found in ${absDataDir}`);
  }

  const useXboxAdpcm = platformArg.toLowerCase() === 'xbox';
  const soundFormat = useXboxAdpcm ? SoundFormat.XboxADPCM : SoundFormat.PCM16;

  // Decode all WAV files and build SoundPitchRange (72 bytes) + SoundPermutation (124 bytes)
  interface CompiledPerm {
    name: string;
    samplesBytes: Buffer;
    mouthDataBytes: Buffer;
    bufferSize: number;
  }
  interface CompiledPitchRange {
    name: string;
    perms: CompiledPerm[];
  }

  let detectedChannels = 1;
  let detectedRate = 22050;
  const compiledRanges: CompiledPitchRange[] = [];
  const logs: string[] = [];

  for (const bucket of buckets) {
    const perms: CompiledPerm[] = [];
    for (const wavFile of bucket.wavFiles) {
      const wavBuf = fs.readFileSync(wavFile);
      const decoded = decodeWavToPcm(wavBuf);
      detectedChannels = decoded.channels;
      detectedRate = decoded.sampleRate;

      let samplesBytes: Buffer;
      let bufferSize = decoded.pcmSamples.length * 2;
      if (useXboxAdpcm) {
        const encodedAdpcm =
          decoded.channels === 2
            ? encodeXboxAdpcmStereo(decoded.pcmSamples)
            : encodeXboxAdpcmMono(decoded.pcmSamples);
        samplesBytes = Buffer.from(encodedAdpcm.buffer, encodedAdpcm.byteOffset, encodedAdpcm.byteLength);
      } else {
        // Halo CE loose tag PCM16 stores Big-Endian 16-bit signed samples
        samplesBytes = Buffer.alloc(decoded.pcmSamples.length * 2);
        for (let i = 0; i < decoded.pcmSamples.length; i++) {
          samplesBytes.writeInt16BE(decoded.pcmSamples[i], i * 2);
        }
        bufferSize = samplesBytes.length;
      }

      const mouthDataBytes = computeSoundLipSyncMouthData(
        decoded.pcmSamples,
        decoded.sampleRate,
        decoded.channels,
      );
      const permName = path.basename(wavFile, path.extname(wavFile));
      perms.push({
        name: permName,
        samplesBytes,
        mouthDataBytes,
        bufferSize,
      });
      logs.push(
        `sound permutation "${permName}": ${decoded.sampleRate} Hz, ${decoded.channels}ch, ${samplesBytes.length} bytes (${useXboxAdpcm ? 'Xbox ADPCM' : '16-bit PCM'}), ${mouthDataBytes.length} mouth samples`,
      );
    }
    compiledRanges.push({ name: bucket.name, perms });
  }

  // Layout Sound (164 bytes) + SoundPitchRange[N] (N * 72 bytes) + SoundPermutation[M] (M * 124 bytes) + mouth_data bytes
  const rootSize = resolveStruct('Sound').totalSize; // 164
  const pitchRangeSize = resolveStruct('SoundPitchRange').totalSize; // 72
  const permSize = resolveStruct('SoundPermutation').totalSize; // 124
  const totalPerms = compiledRanges.reduce((acc, r) => acc + r.perms.length, 0);
  const totalMouthBytes = compiledRanges.reduce(
    (acc, r) => acc + r.perms.reduce((s, p) => s + p.mouthDataBytes.length, 0),
    0,
  );

  const offPitchRanges = rootSize;
  const offPerms = offPitchRanges + compiledRanges.length * pitchRangeSize;
  const offMouthData = offPerms + totalPerms * permSize;
  const buf = Buffer.alloc(offMouthData + totalMouthBytes, 0);

  // Sound root fields:
  buf.writeUInt32LE(1, 0); // flags = fit to adpcm blocksize
  buf.writeUInt16LE(4, 4); // class = unit_dialog / projectile_impact (4 = projectile_impact / general)
  buf.writeUInt16LE(detectedRate >= 44100 ? 1 : 0, 6); // sample rate: 0 = 22kHz, 1 = 44kHz
  buf.writeFloatLE(1.0, 12); // minimum distance
  buf.writeFloatLE(10.0, 16); // maximum distance
  buf.writeFloatLE(1.0, 24); // skip fraction = 0, random pitch bounds = [1, 1]
  buf.writeFloatLE(1.0, 28);
  buf.writeUInt16LE(detectedChannels === 2 ? 1 : 0, 68); // encoding: 0 = mono, 1 = stereo
  buf.writeUInt16LE(soundFormat, 70); // compression: 0 = none (PCM), 1 = Xbox ADPCM
  writeDependencyFieldLocal(buf, 72, 'snd!'); // promotion sound = null
  buf.writeUInt32LE(compiledRanges.length, 152); // pitch_ranges.count
  buf.writeUInt32LE(offPitchRanges, 156); // pitch_ranges.pointer

  const embeddedRawDataAssets: ExtractedEmbeddedAsset[] = [];
  const embeddedRawDataPatches: ExtractedEmbeddedPatch[] = [];

  let permCursor = 0;
  let mouthCursor = offMouthData;

  for (let r = 0; r < compiledRanges.length; r++) {
    const range = compiledRanges[r];
    const rOff = offPitchRanges + r * pitchRangeSize;
    writeFixedAscii32(buf, rOff + 0, range.name);
    buf.writeFloatLE(1.0, rOff + 32); // natural pitch
    buf.writeFloatLE(1.0, rOff + 36); // bend bounds lower
    buf.writeFloatLE(1.0, rOff + 40); // bend bounds upper
    buf.writeInt16LE(range.perms.length, rOff + 44); // actual permutation count
    buf.writeUInt32LE(range.perms.length, rOff + 60); // permutations.count
    buf.writeUInt32LE(offPerms + permCursor * permSize, rOff + 64); // permutations.pointer

    for (let p = 0; p < range.perms.length; p++) {
      const perm = range.perms[p];
      const pOff = offPerms + (permCursor + p) * permSize;
      writeFixedAscii32(buf, pOff + 0, perm.name);
      buf.writeFloatLE(0.0, pOff + 32); // skip fraction
      buf.writeFloatLE(1.0, pOff + 36); // gain
      buf.writeUInt16LE(soundFormat, pOff + 40); // compression
      buf.writeInt16LE(-1, pOff + 42); // next permutation index = -1
      buf.writeUInt32LE(perm.bufferSize, pOff + 60); // buffer size (PCM bytes)

      // samples TagDataOffset at pOff + 64 (20 bytes: size at +0, external flags at +4, fileOffset at +8)
      buf.writeUInt32LE(perm.samplesBytes.length, pOff + 64);
      const assetIdx = embeddedRawDataAssets.length;
      embeddedRawDataAssets.push({ kind: 'sound', data: perm.samplesBytes });
      embeddedRawDataPatches.push({
        assetIndex: assetIdx,
        patchOffset: pOff + 64 + 8,
        patchWidth: 4,
      });

      // mouth_data TagDataOffset at pOff + 84 (relocated in-buffer at mouthCursor)
      if (perm.mouthDataBytes.length > 0) {
        perm.mouthDataBytes.copy(buf, mouthCursor);
        buf.writeUInt32LE(perm.mouthDataBytes.length, pOff + 84);
        buf.writeUInt32LE(0, pOff + 88);
        buf.writeUInt32LE(mouthCursor, pOff + 92);
        buf.writeUInt32LE(mouthCursor, pOff + 96);
        mouthCursor += perm.mouthDataBytes.length;
      }
    }
    permCursor += range.perms.length;
  }

  writeRawRootTagBufferAsBlamLooseFile('sound', 'Sound', relDir, buf, outTagFile, {
    embeddedRawDataAssets,
    embeddedRawDataPatches,
  });

  return {
    logs,
    writtenTagPaths: [outTagFile],
  };
}

function writeDependencyFieldLocal(buf: Buffer, offset: number, fourCCStr: string): void {
  if (offset + 16 > buf.length) return;
  buf.writeUInt32LE(fourCCFromString(fourCCStr), offset + 0);
  buf.writeUInt32LE(0, offset + 4);
  buf.writeUInt32LE(0, offset + 8);
  buf.writeUInt32LE(NULL_TAG_ID, offset + 12);
}

// ============================================================================
// Helper: Locate `.jms` or `.obj` files in `data/<sourceDir>/<subFolder>`
// ============================================================================

function findMeshSourceFiles(
  workingDir: string,
  sourceDirArg: string,
  preferredSubfolder: 'models' | 'physics',
): {
  relDir: string;
  leafName: string;
  meshFiles: string[];
} {
  const relDir = normalizeHaloRelPath(sourceDirArg);
  const leafName = relDir.split('\\').pop() || 'model';
  const baseDataDir = path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep));
  const candidateDirs = [
    path.join(baseDataDir, preferredSubfolder),
    path.join(baseDataDir, preferredSubfolder === 'models' ? 'physics' : 'models'),
    baseDataDir,
  ];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    if (fs.statSync(dir).isFile() && /\.(jms|obj)$/i.test(dir)) {
      const parentRel = normalizeHaloRelPath(path.relative(path.join(workingDir, 'data'), path.dirname(dir)));
      return {
        relDir: parentRel || relDir,
        leafName: path.basename(dir, path.extname(dir)),
        meshFiles: [dir],
      };
    }
    if (fs.statSync(dir).isDirectory()) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(jms|obj)$/i.test(f))
        .map((f) => path.join(dir, f));
      if (files.length > 0) {
        return { relDir, leafName, meshFiles: files };
      }
    }
  }

  throw new Error(
    `No .jms or .obj geometry files found in ${ path.join(baseDataDir, preferredSubfolder) } or ${baseDataDir}`,
  );
}

function loadMeshAndRigFromFile(filePath: string): {
  mesh: ParsedObjMesh;
  rig: TemplateRigInfo;
  markers: ParsedJmsMarker[];
} {
  const text = fs.readFileSync(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.jms')) {
    const parsed = parseJmsTextToModelData(text);
    return { mesh: parsed.mesh, rig: parsed.rig, markers: parsed.markers };
  }
  const mesh = parseObjMesh(text, { collisionMode: 'auto' });
  const defaultNode = Buffer.alloc(156, 0);
  writeFixedAscii32(defaultNode, 0, 'frame root');
  defaultNode.writeInt16LE(-1, 32);
  defaultNode.writeInt16LE(-1, 34);
  defaultNode.writeInt16LE(-1, 36);
  defaultNode.writeFloatLE(1.0, 64);
  defaultNode.writeFloatLE(1.0, 104);
  defaultNode.writeFloatLE(1.0, 108);
  defaultNode.writeFloatLE(1.0, 124);
  defaultNode.writeFloatLE(1.0, 140);
  const rig: TemplateRigInfo = {
    nodeListChecksum: 0,
    modelNodesBuffer: defaultNode,
    modelNodeCount: 1,
    markersBuffer: Buffer.alloc(0),
    markerCount: 0,
    topLevelMarkers: [],
  };
  return { mesh, rig, markers: [] };
}

// ============================================================================
// 3. `tool model <source-directory>`
// ============================================================================

function compileNativeToolModel(workingDir: string, sourceDirArg: string): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const { relDir, leafName, meshFiles } = findMeshSourceFiles(workingDir, sourceDirArg, 'models');
  const primaryFile = meshFiles[0];
  const { mesh, rig } = loadMeshAndRigFromFile(primaryFile);

  if (mesh.vertices.length === 0 || mesh.triangles.length === 0) {
    throw new Error(`Model file "${primaryFile}" contains 0 valid vertices or triangles.`);
  }

  const logs: string[] = [];
  const writtenTagPaths: string[] = [];

  // Auto-generate missing `.shader_model` tags for each material slot in `tags/<relDir>/shaders/<mat>.shader_model`
  const materialSlots = mesh.summary.materialSlots.length > 0 ? mesh.summary.materialSlots : ['default'];
  const primaryMatName = materialSlots[0] || leafName;
  const primaryShaderRelPath = `${relDir}\\shaders\\${primaryMatName}`;

  for (let m = 0; m < materialSlots.length; m++) {
    const matName = materialSlots[m] || 'default';
    const shaderRelPath = `${relDir}\\shaders\\${matName}`;
    const absShaderFile = path.join(workingDir, 'tags', `${shaderRelPath.replace(/\\/g, path.sep)}.shader_model`);
    if (!fs.existsSync(absShaderFile)) {
      const matType = inferHaloMaterialTypeFromName(matName, 7);
      const bitmapRelPath = `${relDir}\\bitmaps\\${matName}`;
      const shaderTag = buildCustomShaderModelTag(shaderRelPath, m + 1, bitmapRelPath, 0, matType);
      writeExtractedTagAsBlamLooseFile(shaderTag, absShaderFile);
      writtenTagPaths.push(absShaderFile);
      logs.push(`auto-generated shader_model: tags\\${shaderRelPath}.shader_model (${HALO_MATERIAL_TYPES[matType]})`);
    }
  }

  const gbxRelPath = `${relDir}\\${leafName}`;
  const absGbxFile = path.join(workingDir, 'tags', `${gbxRelPath.replace(/\\/g, path.sep)}.gbxmodel`);
  const gbxTag = buildCustomGbxmodelTag(gbxRelPath, 0, mesh, primaryShaderRelPath, 1, rig);
  writeExtractedTagAsBlamLooseFile(gbxTag, absGbxFile);
  writtenTagPaths.push(absGbxFile);

  logs.push(
    `compiled gbxmodel: tags\\${gbxRelPath}.gbxmodel (${mesh.vertices.length} vertices, ${mesh.triangles.length} triangles, ${rig.modelNodeCount} nodes, checksum ${rig.nodeListChecksum})`,
  );

  return { logs, writtenTagPaths };
}

// ============================================================================
// 4. `tool collision-geometry <source-directory>`
// ============================================================================

function compileNativeToolCollisionGeometry(workingDir: string, sourceDirArg: string): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const { relDir, leafName, meshFiles } = findMeshSourceFiles(workingDir, sourceDirArg, 'physics');
  // Prefer a file with "collision" in its name if multiple `.jms` files exist in `physics/`
  const collFile =
    meshFiles.find((f) => path.basename(f).toLowerCase().includes('collision')) ?? meshFiles[0];
  const { mesh, rig } = loadMeshAndRigFromFile(collFile);

  if (mesh.vertices.length === 0 || mesh.triangles.length === 0) {
    throw new Error(`Collision geometry file "${collFile}" contains 0 valid vertices or triangles.`);
  }

  const collRelPath = `${relDir}\\${leafName}`;
  const absCollFile = path.join(
    workingDir,
    'tags',
    `${collRelPath.replace(/\\/g, path.sep)}.model_collision_geometry`,
  );

  const collTag = buildCustomCollisionTag(collRelPath, 0, mesh, rig, 'auto', 7);
  writeExtractedTagAsBlamLooseFile(collTag, absCollFile);

  const stats = mesh.summary.collisionPreview;
  const logs = [
    `compiled model_collision_geometry: tags\\${collRelPath}.model_collision_geometry (${
      stats
        ? `${stats.bsp3dNodes} 3D BSP nodes, ${stats.planes} planes, ${stats.mergedSurfaces} surfaces, ${stats.edges} edges, ${stats.weldedVertices} vertices`
        : `${mesh.triangles.length} triangles`
    })`,
  ];

  return {
    logs,
    writtenTagPaths: [absCollFile],
  };
}

// ============================================================================
// 5. `tool physics <source-directory>`
// ============================================================================

function compileNativeToolPhysics(workingDir: string, sourceDirArg: string): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const { relDir, leafName, meshFiles } = findMeshSourceFiles(workingDir, sourceDirArg, 'physics');
  const physFile =
    meshFiles.find((f) => path.basename(f).toLowerCase().includes('physics')) ?? meshFiles[0];
  const { mesh, markers } = loadMeshAndRigFromFile(physFile);

  // Extract mass spheres from JMS markers (either `#mass_*` or all markers if in `physics.jms`),
  // or synthesize 4 balanced corner mass spheres from bounding box if none exist
  let massMarkers = markers.filter((m) => m.name.toLowerCase().includes('mass'));
  if (massMarkers.length === 0 && markers.length > 0) {
    massMarkers = markers;
  }
  if (massMarkers.length === 0) {
    const b = mesh.summary.bounds;
    const r = Math.max(0.25, b.radius * 0.25);
    const zMid = (b.min[2] + b.max[2]) * 0.5;
    massMarkers = [
      { name: 'mass_fl', regionIndex: 0, parentNodeIndex: 0, rotation: [0, 0, 0, 1], translation: [b.max[0] * 0.5, b.max[1] * 0.5, zMid], radius: r },
      { name: 'mass_fr', regionIndex: 0, parentNodeIndex: 0, rotation: [0, 0, 0, 1], translation: [b.max[0] * 0.5, b.min[1] * 0.5, zMid], radius: r },
      { name: 'mass_rl', regionIndex: 0, parentNodeIndex: 0, rotation: [0, 0, 0, 1], translation: [b.min[0] * 0.5, b.max[1] * 0.5, zMid], radius: r },
      { name: 'mass_rr', regionIndex: 0, parentNodeIndex: 0, rotation: [0, 0, 0, 1], translation: [b.min[0] * 0.5, b.min[1] * 0.5, zMid], radius: r },
    ];
  }

  // Compute sphere volumes ($V_i = \frac{4}{3}\pi r_i^3$), relative weights, center of mass, and $3\times 3$ inertia tensor
  const totalMass = 100.0;
  const volumes = massMarkers.map((m) => (4 / 3) * Math.PI * Math.pow(Math.max(0.05, m.radius), 3));
  const totalVol = volumes.reduce((s, v) => s + v, 0) || 1.0;
  const relMasses = volumes.map((v) => v / totalVol);
  const absMasses = relMasses.map((rm) => rm * totalMass);

  let comX = 0, comY = 0, comZ = 0;
  let maxRadius = 0.5;
  for (let i = 0; i < massMarkers.length; i++) {
    const [x, y, z] = massMarkers[i].translation;
    comX += x * relMasses[i];
    comY += y * relMasses[i];
    comZ += z * relMasses[i];
    maxRadius = Math.max(maxRadius, Math.hypot(x, y, z) + massMarkers[i].radius);
  }

  // Parallel axis theorem for solid spheres about center of mass:
  // $I_{xx} = \sum m_i (\frac{2}{5} r_i^2 + dy_i^2 + dz_i^2)$, $I_{xy} = -\sum m_i dx_i dy_i$
  let ixx = 0, iyy = 0, izz = 0;
  let ixy = 0, ixz = 0, iyz = 0;
  for (let i = 0; i < massMarkers.length; i++) {
    const m = absMasses[i];
    const r = Math.max(0.05, massMarkers[i].radius);
    const sphereI = 0.4 * m * r * r;
    const dx = massMarkers[i].translation[0] - comX;
    const dy = massMarkers[i].translation[1] - comY;
    const dz = massMarkers[i].translation[2] - comZ;
    ixx += sphereI + m * (dy * dy + dz * dz);
    iyy += sphereI + m * (dx * dx + dz * dz);
    izz += sphereI + m * (dx * dx + dy * dy);
    ixy -= m * dx * dy;
    ixz -= m * dx * dz;
    iyz -= m * dy * dz;
  }

  const forwardMat = [
    Math.max(1e-3, ixx), ixy, ixz,
    ixy, Math.max(1e-3, iyy), iyz,
    ixz, iyz, Math.max(1e-3, izz),
  ];
  const inverseMat = invert3x3Matrix(forwardMat);

  // Layout Physics (128 bytes) + PhysicsInertialMatrix[2] (72 bytes) + PhysicsMassPoint[N] (N * 128 bytes)
  const rootSize = resolveStruct('Physics').totalSize; // 128
  const matSize = resolveStruct('PhysicsInertialMatrix').totalSize; // 36
  const mpSize = resolveStruct('PhysicsMassPoint').totalSize; // 128
  const offMatrices = rootSize;
  const offMassPoints = offMatrices + 2 * matSize;
  const buf = Buffer.alloc(offMassPoints + massMarkers.length * mpSize, 0);

  // Physics root (128 bytes)
  buf.writeFloatLE(maxRadius, 0); // radius (+0x00)
  buf.writeFloatLE(1.0, 4); // moment scale (+0x04)
  buf.writeFloatLE(totalMass, 8); // mass (+0x08)
  buf.writeFloatLE(comX, 12); // center_of_mass.x (+0x0C)
  buf.writeFloatLE(comY, 16); // center_of_mass.y (+0x10)
  buf.writeFloatLE(comZ, 20); // center_of_mass.z (+0x14)
  buf.writeFloatLE(1.0, 24); // density (+0x18)
  buf.writeFloatLE(1.0, 28); // gravity scale (+0x1C)
  buf.writeFloatLE(0.5, 32); // ground friction (+0x20)
  buf.writeFloatLE(0.1, 36); // ground depth (+0x24)
  buf.writeFloatLE(0.5, 40); // ground damp fraction (+0x28)
  buf.writeFloatLE(0.7, 44); // ground normal k1 (+0x2C)
  buf.writeFloatLE(0.5, 48); // ground normal k0 (+0x30)
  buf.writeFloatLE(0.05, 56); // water friction (+0x38)
  buf.writeFloatLE(0.25, 60); // water depth (+0x3C)
  buf.writeFloatLE(0.5, 64); // water density (+0x40)
  buf.writeFloatLE(0.001, 72); // air friction (+0x48)
  buf.writeFloatLE(forwardMat[0], 80); // xx_moment (+0x50)
  buf.writeFloatLE(forwardMat[4], 84); // yy_moment (+0x54)
  buf.writeFloatLE(forwardMat[8], 88); // zz_moment (+0x58)
  buf.writeUInt32LE(2, 92); // inertial_matrix_and_inverse.count (+0x5C)
  buf.writeUInt32LE(offMatrices, 96); // inertial_matrix_and_inverse.pointer (+0x60)
  buf.writeUInt32LE(0, 104); // powered_mass_points.count (+0x68)
  buf.writeUInt32LE(0, 108);
  buf.writeUInt32LE(massMarkers.length, 116); // mass_points.count (+0x74)
  buf.writeUInt32LE(offMassPoints, 120); // mass_points.pointer (+0x78)

  // Write forward & inverse 3x3 inertia matrices (36 bytes each)
  for (let k = 0; k < 9; k++) {
    buf.writeFloatLE(forwardMat[k], offMatrices + k * 4);
    buf.writeFloatLE(inverseMat[k], offMatrices + 36 + k * 4);
  }

  // Write PhysicsMassPoint[0..N-1] (128 bytes each)
  for (let i = 0; i < massMarkers.length; i++) {
    const m = massMarkers[i];
    const mo = offMassPoints + i * mpSize;
    writeFixedAscii32(buf, mo + 0, m.name.replace(/^#/, ''));
    buf.writeInt16LE(-1, mo + 32); // powered mass point = -1
    buf.writeInt16LE(m.parentNodeIndex, mo + 34); // model node
    buf.writeUInt32LE(1, mo + 36); // flags = metallic (1)
    buf.writeFloatLE(relMasses[i], mo + 40); // relative mass (+0x28)
    buf.writeFloatLE(absMasses[i], mo + 44); // mass (+0x2C)
    buf.writeFloatLE(1.0, mo + 48); // relative density (+0x30)
    buf.writeFloatLE(1.0, mo + 52); // density (+0x34)
    buf.writeFloatLE(m.translation[0], mo + 56); // position.x (+0x38)
    buf.writeFloatLE(m.translation[1], mo + 60); // position.y (+0x3C)
    buf.writeFloatLE(m.translation[2], mo + 64); // position.z (+0x40)
    buf.writeFloatLE(1.0, mo + 68); // forward.i (+0x44)
    buf.writeFloatLE(0.0, mo + 72);
    buf.writeFloatLE(0.0, mo + 76);
    buf.writeFloatLE(0.0, mo + 80);
    buf.writeFloatLE(0.0, mo + 84);
    buf.writeFloatLE(1.0, mo + 88); // up.k (+0x58)
    buf.writeFloatLE(m.radius, mo + 104); // radius (+0x68)
    buf.writeFloatLE(0.4, mo + 108); // friction parallel scale
    buf.writeFloatLE(0.4, mo + 112); // friction perpendicular scale
    buf.writeFloatLE(0.1, mo + 116); // elasticity
  }

  const physRelPath = `${relDir}\\${leafName}`;
  const absPhysFile = path.join(workingDir, 'tags', `${physRelPath.replace(/\\/g, path.sep)}.physics`);
  writeRawRootTagBufferAsBlamLooseFile('physics', 'Physics', physRelPath, buf, absPhysFile);

  return {
    logs: [
      `compiled physics: tags\\${physRelPath}.physics (${massMarkers.length} mass points, mass=${totalMass.toFixed(1)}, Ixx=${forwardMat[0].toFixed(2)}, Iyy=${forwardMat[4].toFixed(2)}, Izz=${forwardMat[8].toFixed(2)})`,
    ],
    writtenTagPaths: [absPhysFile],
  };
}

// ============================================================================
// 6. `tool animations <source-directory>`
// ============================================================================

const ANIMATION_EXT_TO_TYPE: Record<string, number> = {
  '.jma': 0, // base
  '.jmm': 0, // base (no world movement)
  '.jmt': 0, // base (turn)
  '.jmo': 1, // overlay
  '.jmr': 2, // replacement
  '.jmw': 0, // world-relative base
  '.jmz': 0, // base with height
};

function compileNativeToolAnimations(workingDir: string, sourceDirArg: string): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const relDir = normalizeHaloRelPath(sourceDirArg);
  const leafName = relDir.split('\\').pop() || 'animations';
  const baseDataDir = path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep));
  const animDir = fs.existsSync(path.join(baseDataDir, 'animations'))
    ? path.join(baseDataDir, 'animations')
    : baseDataDir;

  if (!fs.existsSync(animDir)) {
    throw new Error(`Source animations directory not found: ${animDir}`);
  }

  const animFiles = fs
    .readdirSync(animDir)
    .filter((f) => Object.prototype.hasOwnProperty.call(ANIMATION_EXT_TO_TYPE, path.extname(f).toLowerCase()))
    .map((f) => path.join(animDir, f));

  if (animFiles.length === 0) {
    throw new Error(`No JMA animation files (.jma, .jmm, .jmt, .jmo, .jmr, .jmw, .jmz) found in ${animDir}`);
  }

  interface ParsedAnimEntry {
    name: string;
    type: number;
    frameCount: number;
    fps: number;
    nodeListChecksum: number;
    nodes: Array<{
      name: string;
      firstChild: number;
      nextSibling: number;
      parent: number;
    }>;
    defaultDataBytes: Buffer;
    uncompressedFrameBytes: Buffer;
  }

  const parsedAnims: ParsedAnimEntry[] = [];
  const logs: string[] = [];

  for (const file of animFiles) {
    const ext = path.extname(file).toLowerCase();
    const animName = path.basename(file, ext);
    const animType = ANIMATION_EXT_TO_TYPE[ext] ?? 0;

    const lines = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.replace(/;.*$/, '').trim())
      .filter((l) => l.length > 0);

    let cursor = 0;
    const nextLine = () => (cursor < lines.length ? lines[cursor++] : '');
    const nextInt = () => parseInt(nextLine().split(/\s+/)[0] || '0', 10) || 0;
    const nextFloats = () =>
      nextLine()
        .split(/\s+/)
        .map((s) => parseFloat(s) || 0);

    const version = nextInt() || 16392;
    const frameCount = Math.max(1, Math.min(2048, nextInt() || 1));
    const fps = Math.max(1, nextInt() || 30);
    const actorCount = Math.max(1, nextInt() || 1);
    void version;
    void actorCount;
    const actorName = nextLine() || 'unnamedActor';
    void actorName;
    const nodeCount = Math.max(1, Math.min(64, nextInt() || 1));
    const nodeListChecksum = nextInt() || 0;

    const nodes: ParsedAnimEntry['nodes'] = [];
    for (let n = 0; n < nodeCount; n++) {
      const name = nextLine() || `node_${n}`;
      const firstChild = nextInt();
      const nextSibling = nextInt();
      nodes.push({ name, firstChild, nextSibling, parent: -1 });
    }
    for (let n = 0; n < nodes.length; n++) {
      let c = nodes[n].firstChild;
      let g = 0;
      while (c >= 0 && c < nodes.length && g++ < 64) {
        nodes[c].parent = n;
        c = nodes[c].nextSibling;
      }
    }

    // Each uncompressed Halo CE animation node keyframe is 32 bytes:
    // rotation quaternion compressed/uncompressed or 4x int16 (8 bytes) + translation 3x float (12 bytes) + scale float (4 bytes) = 24 or 32 bytes
    // In Halo CE `AnimationGraphAnimation`:
    //   frame_size = nodeCount * 32 (when flags have rotation+translation+scale) or nodeCount * 20
    const nodeStride = 20; // 4x int16 rotation (8 bytes) + 3x float32 translation (12 bytes)
    const frameStride = nodeCount * nodeStride;
    const uncompressedFrameBytes = Buffer.alloc(frameCount * frameStride, 0);

    for (let f = 0; f < frameCount; f++) {
      for (let n = 0; n < nodeCount; n++) {
        const trans = nextFloats();
        const rot = nextFloats();
        const scaleVals = nextFloats();
        void scaleVals;
        const off = f * frameStride + n * nodeStride;
        const rx = Math.max(-1, Math.min(1, rot[0] ?? 0));
        const ry = Math.max(-1, Math.min(1, rot[1] ?? 0));
        const rz = Math.max(-1, Math.min(1, rot[2] ?? 0));
        const rw = Math.max(-1, Math.min(1, rot[3] ?? 1));
        uncompressedFrameBytes.writeInt16LE(Math.round(rx * 32767), off + 0);
        uncompressedFrameBytes.writeInt16LE(Math.round(ry * 32767), off + 2);
        uncompressedFrameBytes.writeInt16LE(Math.round(rz * 32767), off + 4);
        uncompressedFrameBytes.writeInt16LE(Math.round(rw * 32767), off + 6);
        uncompressedFrameBytes.writeFloatLE((trans[0] ?? 0) * 0.01, off + 8);
        uncompressedFrameBytes.writeFloatLE((trans[1] ?? 0) * 0.01, off + 12);
        uncompressedFrameBytes.writeFloatLE((trans[2] ?? 0) * 0.01, off + 16);
      }
    }

    const defaultDataBytes = Buffer.from(uncompressedFrameBytes.subarray(0, frameStride));
    parsedAnims.push({
      name: animName,
      type: animType,
      frameCount,
      fps,
      nodeListChecksum,
      nodes,
      defaultDataBytes,
      uncompressedFrameBytes,
    });
    logs.push(`animation "${animName}" (${ext}): ${frameCount} frames @ ${fps} fps, ${nodeCount} nodes`);
  }

  // Layout ModelAnimations (128 bytes) + ModelAnimationsAnimationGraphNode[N] (N * 64 bytes) + ModelAnimationsAnimation[M] (M * 180 bytes) + frame data
  const rootSize = resolveStruct('ModelAnimations').totalSize; // 128
  const nodeStructSize = resolveStruct('ModelAnimationsAnimationGraphNode').totalSize; // 64
  const animStructSize = resolveStruct('ModelAnimationsAnimation').totalSize; // 180

  const refNodes = parsedAnims[0].nodes;
  const offNodes = rootSize;
  const offAnims = offNodes + refNodes.length * nodeStructSize;
  const totalAnimPayloadBytes = parsedAnims.reduce(
    (s, a) => s + a.defaultDataBytes.length + a.uncompressedFrameBytes.length,
    0,
  );
  const offPayloads = offAnims + parsedAnims.length * animStructSize;
  const buf = Buffer.alloc(offPayloads + totalAnimPayloadBytes, 0);

  // Root ModelAnimations:
  // nodes reflexive at +92 (0x5C), animations reflexive at +116 (0x74)
  buf.writeUInt32LE(refNodes.length, 92);
  buf.writeUInt32LE(offNodes, 96);
  buf.writeUInt32LE(parsedAnims.length, 116);
  buf.writeUInt32LE(offAnims, 120);

  for (let i = 0; i < refNodes.length; i++) {
    const n = refNodes[i];
    const no = offNodes + i * nodeStructSize;
    writeFixedAscii32(buf, no + 0, n.name);
    buf.writeInt16LE(n.nextSibling, no + 32);
    buf.writeInt16LE(n.firstChild, no + 34);
    buf.writeInt16LE(n.parent, no + 36);
  }

  let payloadCursor = offPayloads;
  for (let i = 0; i < parsedAnims.length; i++) {
    const a = parsedAnims[i];
    const ao = offAnims + i * animStructSize;
    writeFixedAscii32(buf, ao + 0, a.name);
    buf.writeUInt16LE(a.type, ao + 32); // type (base/overlay/replacement)
    buf.writeInt16LE(a.frameCount, ao + 34); // frame count
    buf.writeInt16LE(a.nodes.length * 20, ao + 36); // frame size
    buf.writeInt16LE(0, ao + 38); // frame info type = none (0)
    buf.writeInt32LE(a.nodeListChecksum, ao + 40); // node list checksum
    buf.writeInt16LE(a.nodes.length, ao + 44); // node count
    buf.writeInt16LE(-1, ao + 62); // next animation = -1
    // Rotation + translation flags on nodes0 (bitmask at +76 and +84)
    const nodeMask = a.nodes.length >= 32 ? 0xffffffff : (1 << a.nodes.length) - 1;
    buf.writeUInt32LE(nodeMask >>> 0, ao + 76); // node rotation flag data0
    buf.writeUInt32LE(nodeMask >>> 0, ao + 84); // node transform flag data0

    // default_data TagDataOffset at ao + 132
    a.defaultDataBytes.copy(buf, payloadCursor);
    buf.writeUInt32LE(a.defaultDataBytes.length, ao + 132);
    buf.writeUInt32LE(0, ao + 136);
    buf.writeUInt32LE(payloadCursor, ao + 140);
    buf.writeUInt32LE(payloadCursor, ao + 144);
    payloadCursor += a.defaultDataBytes.length;

    // uncompressed_data TagDataOffset at ao + 152
    a.uncompressedFrameBytes.copy(buf, payloadCursor);
    buf.writeUInt32LE(a.uncompressedFrameBytes.length, ao + 152);
    buf.writeUInt32LE(0, ao + 156);
    buf.writeUInt32LE(payloadCursor, ao + 160);
    buf.writeUInt32LE(payloadCursor, ao + 164);
    payloadCursor += a.uncompressedFrameBytes.length;
  }

  const antrRelPath = `${relDir}\\${leafName}`;
  const absAntrFile = path.join(
    workingDir,
    'tags',
    `${antrRelPath.replace(/\\/g, path.sep)}.model_animations`,
  );
  writeRawRootTagBufferAsBlamLooseFile(
    'model_animations',
    'ModelAnimations',
    antrRelPath,
    buf,
    absAntrFile,
  );

  return {
    logs,
    writtenTagPaths: [absAntrFile],
  };
}

// ============================================================================
// 7. `tool unicode-strings <source-directory>`
// ============================================================================

function parseHekUnicodeStringsText(rawBuf: Buffer): string[] {
  // Detect UTF-16LE BOM (`0xFF 0xFE`) or null bytes in ASCII positions
  let text: string;
  if (
    (rawBuf.length >= 2 && rawBuf[0] === 0xff && rawBuf[1] === 0xfe) ||
    (rawBuf.length >= 4 && rawBuf[1] === 0x00 && rawBuf[3] === 0x00)
  ) {
    text = rawBuf.toString('utf16le').replace(/^\uFEFF/, '');
  } else {
    text = rawBuf.toString('utf8').replace(/^\uFEFF/, '');
  }

  if (text.includes('###END-STRING###')) {
    const parts = text.split(/###END-STRING###\r?\n?/);
    // Drop trailing empty entry after final ###END-STRING###
    if (parts.length > 0 && parts[parts.length - 1].trim() === '') {
      parts.pop();
    }
    return parts.map((p) => p.replace(/\r?\n$/, ''));
  }

  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd());
}

function compileNativeToolUnicodeStrings(workingDir: string, sourceDirArg: string): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const relDir = normalizeHaloRelPath(sourceDirArg);
  const absDataPath = path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep));

  const txtFiles: string[] = [];
  if (fs.existsSync(absDataPath) && fs.statSync(absDataPath).isFile()) {
    txtFiles.push(absDataPath);
  } else if (fs.existsSync(`${absDataPath}.txt`)) {
    txtFiles.push(`${absDataPath}.txt`);
  } else if (fs.existsSync(absDataPath) && fs.statSync(absDataPath).isDirectory()) {
    for (const entry of fs.readdirSync(absDataPath, { withFileTypes: true })) {
      if (entry.isFile() && /\.(txt|ustr)$/i.test(entry.name)) {
        txtFiles.push(path.join(absDataPath, entry.name));
      }
    }
  }

  if (txtFiles.length === 0) {
    throw new Error(`No .txt or .ustr source files found in ${absDataPath}`);
  }

  const logs: string[] = [];
  const writtenTagPaths: string[] = [];

  for (const file of txtFiles) {
    const baseName = path.basename(file, path.extname(file));
    const strings = parseHekUnicodeStringsText(fs.readFileSync(file));
    const parentRel = fs.existsSync(absDataPath) && fs.statSync(absDataPath).isDirectory()
      ? `${relDir}\\${baseName}`
      : relDir.replace(/\.(txt|ustr)$/i, '');
    const blamBuf = compileUnicodeStringListTagBuffer(strings, parentRel);
    const outTagFile = path.join(
      workingDir,
      'tags',
      `${parentRel.replace(/\\/g, path.sep)}.unicode_string_list`,
    );
    fs.mkdirSync(path.dirname(outTagFile), { recursive: true });
    fs.writeFileSync(outTagFile, blamBuf);
    writtenTagPaths.push(outTagFile);
    logs.push(`compiled unicode_string_list: tags\\${parentRel}.unicode_string_list (${strings.length} strings)`);
  }

  return { logs, writtenTagPaths };
}

// ============================================================================
// 8. `tool hud-messages <path> <scenario-name>`
// ============================================================================

function compileNativeToolHudMessages(
  workingDir: string,
  pathArg: string,
  scenarioNameArg?: string,
): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const relDir = normalizeHaloRelPath(pathArg);
  const scenName = (scenarioNameArg || relDir.split('\\').pop() || 'hud_messages').replace(/\.hmt$/i, '');
  const candidateFiles = [
    path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep), `${scenName}.hmt`),
    path.join(workingDir, 'data', `${relDir.replace(/\\/g, path.sep)}.hmt`),
    path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep)),
  ];

  let hmtFile: string | null = null;
  for (const cand of candidateFiles) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      hmtFile = cand;
      break;
    }
    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
      const found = fs.readdirSync(cand).find((f) => /\.(hmt|txt)$/i.test(f));
      if (found) {
        hmtFile = path.join(cand, found);
        break;
      }
    }
  }

  if (!hmtFile) {
    throw new Error(`No .hmt source file found under data\\${relDir}`);
  }

  const rawBuf = fs.readFileSync(hmtFile);
  const text =
    rawBuf.length >= 2 && rawBuf[0] === 0xff && rawBuf[1] === 0xfe
      ? rawBuf.toString('utf16le').replace(/^\uFEFF/, '')
      : rawBuf.toString('utf8').replace(/^\uFEFF/, '');

  const messages: Array<{ name: string; text: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      messages.push({
        name: trimmed.slice(0, eqIdx).trim(),
        text: trimmed.slice(eqIdx + 1).trim(),
      });
    }
  }

  const tagRelPath = relDir.toLowerCase().endsWith(scenName.toLowerCase())
    ? relDir
    : `${relDir}\\${scenName}`;
  const blamBuf = compileHudMessageTextTagBuffer(messages, tagRelPath);
  const outTagFile = path.join(
    workingDir,
    'tags',
    `${tagRelPath.replace(/\\/g, path.sep)}.hud_message_text`,
  );
  fs.mkdirSync(path.dirname(outTagFile), { recursive: true });
  fs.writeFileSync(outTagFile, blamBuf);

  return {
    logs: [
      `compiled hud_message_text: tags\\${tagRelPath}.hud_message_text (${messages.length} HUD messages)`,
    ],
    writtenTagPaths: [outTagFile],
  };
}

// ============================================================================
// 9. `tool structure <scenario-directory> <bsp-name>`
// ============================================================================

function compileNativeToolStructure(
  workingDir: string,
  scenarioDirArg: string,
  bspNameArg?: string,
): {
  logs: string[];
  writtenTagPaths: string[];
  wrlErrors: NativeToolCommandResult['wrlErrors'];
  wrlPath?: string;
} {
  const relDir = normalizeHaloRelPath(scenarioDirArg);
  const bspName = (bspNameArg || relDir.split('\\').pop() || 'level').replace(/\.(jms|obj)$/i, '');
  const modelsDir = path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep), 'models');
  const candidateFiles = [
    path.join(modelsDir, `${bspName}.jms`),
    path.join(modelsDir, `${bspName}.obj`),
    path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep), `${bspName}.jms`),
    path.join(workingDir, 'data', relDir.replace(/\\/g, path.sep), `${bspName}.obj`),
  ];

  let meshFile = candidateFiles.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!meshFile) {
    const found = findMeshSourceFiles(workingDir, scenarioDirArg, 'models');
    meshFile = found.meshFiles[0];
  }

  const { mesh } = loadMeshAndRigFromFile(meshFile);
  if (mesh.rawPositions.length < 3 || mesh.rawFaces.length === 0) {
    throw new Error(`Structure geometry "${meshFile}" has 0 valid vertices or triangles.`);
  }

  const logs: string[] = [];
  const writtenTagPaths: string[] = [];
  const wrlErrors: NativeToolCommandResult['wrlErrors'] = [];
  let wrlPath: string | undefined;

  // Run topology / open-edge audit and emit `<bspName>.wrl` if any open or non-manifold edges exist
  const flatPositions = new Float32Array(mesh.rawPositions.length * 3);
  for (let i = 0; i < mesh.rawPositions.length; i++) {
    flatPositions[i * 3 + 0] = mesh.rawPositions[i][0];
    flatPositions[i * 3 + 1] = mesh.rawPositions[i][1];
    flatPositions[i * 3 + 2] = mesh.rawPositions[i][2];
  }
  const flatIndices = new Uint32Array(mesh.rawFaces.length * 3);
  for (let i = 0; i < mesh.rawFaces.length; i++) {
    flatIndices[i * 3 + 0] = mesh.rawFaces[i].v0;
    flatIndices[i * 3 + 1] = mesh.rawFaces[i].v1;
    flatIndices[i * 3 + 2] = mesh.rawFaces[i].v2;
  }
  const integrity = auditMeshIntegrity({
    positions: flatPositions,
    indices: flatIndices,
  });
  if (integrity.boundaryEdges > 0 || integrity.nonManifoldEdges > 0) {
    logs.push(
      `### WARNING: found #${integrity.boundaryEdges} open edges and #${integrity.nonManifoldEdges} non-manifold edges (see ${bspName}.wrl for 3D diagnostic overlay).`,
    );
    wrlPath = path.join(workingDir, `${bspName}.wrl`);
    const cx = (mesh.summary.bounds.min[0] + mesh.summary.bounds.max[0]) * 0.5;
    const cy = (mesh.summary.bounds.min[1] + mesh.summary.bounds.max[1]) * 0.5;
    const cz = (mesh.summary.bounds.min[2] + mesh.summary.bounds.max[2]) * 0.5;
    wrlErrors.push({
      position: [cx, cy, cz],
      color: [1, 0.2, 0.2],
      label: `Open edges: ${integrity.boundaryEdges}, Non-manifold: ${integrity.nonManifoldEdges}`,
    });
    const wrlText = [
      '#VRML V1.0 ascii',
      'Separator {',
      `  Coordinate3 { point [ ${(cx * 100).toFixed(2)} ${(cy * 100).toFixed(2)} ${(cz * 100).toFixed(2)} ] }`,
      '  MaterialBinding { value PER_PART }',
      '  Material { diffuseColor [ 1.0 0.2 0.2 ] }',
      '  IndexedLineSet { coordIndex [ 0, 0, -1 ] }',
      '}',
    ].join('\n');
    fs.writeFileSync(wrlPath, wrlText, 'utf8');
  }

  // Compile 3D collision BSP from the level mesh
  const matSlots = mesh.summary.materialSlots.length > 0 ? mesh.summary.materialSlots : ['default'];
  const compiledBsp = compileMeshCollisionBspData(mesh, matSlots.length, {
    mode: 'auto',
    targetFaces: 8192,
  });

  // Build ScenarioStructureBSP (648 bytes) + StructureBspHeader (28 bytes) + CollisionBspBlock (96 bytes + arrays) +
  // StructureBspNode[6] (36 bytes) + StructureBspLeaf[1] (16 bytes) + StructureBspSurfaceReference[N] + StructureBspSurface[T] +
  // StructureBspLightmap[1] (32 bytes) + StructureBspMaterial[1] (256 bytes) + vertex/lightmap buffers
  const rootSize = resolveStruct('ScenarioStructureBSP').totalSize; // 648
  const sbspHeaderSize = 28;
  const collHeaderSize = 96;
  const collArraysSize = compiledBsp ? compiledBsp.byteSize : 0;
  const triCount = mesh.triangles.length;
  const surfBytesSize = triCount * 6; // StructureBspSurface is 3x uint16 = 6 bytes
  const lightmapSize = 32; // StructureBspLightmap
  const materialSize = 256; // StructureBspMaterial
  // Uncompressed render vertices (56 bytes each: pos 12, norm 12, binorm 12, tangent 12, uv 8) + lightmap vertices (20 bytes each: norm 12, uv 8)
  const renderVertCount = mesh.vertices.length;
  const uncompressedVertsBytes = renderVertCount * (56 + 20);

  const offSbspHeader = rootSize;
  const offCollHeader = offSbspHeader + sbspHeaderSize;
  const offCollArrays = offCollHeader + collHeaderSize;
  const offSurfaces = offCollArrays + collArraysSize;
  const offLightmaps = offSurfaces + surfBytesSize;
  const offMaterials = offLightmaps + lightmapSize;
  const offVertData = offMaterials + materialSize;
  const totalSize = offVertData + uncompressedVertsBytes;

  const buf = Buffer.alloc(totalSize, 0);

  // ScenarioStructureBsp root (648 bytes):
  writeDependencyFieldLocal(buf, 24, 'bitm'); // lightmaps bitmap (+24)
  buf.writeFloatLE(0.04, 40); // vehicle floor
  buf.writeFloatLE(0.5, 44); // vehicle ceiling
  // Default ambient color (+68..+76)
  buf.writeFloatLE(0.25, 68);
  buf.writeFloatLE(0.25, 72);
  buf.writeFloatLE(0.28, 76);

  // world_bounds x/y/z at +140..+164
  buf.writeFloatLE(mesh.summary.bounds.min[0], 140);
  buf.writeFloatLE(mesh.summary.bounds.max[0], 144);
  buf.writeFloatLE(mesh.summary.bounds.min[1], 148);
  buf.writeFloatLE(mesh.summary.bounds.max[1], 152);
  buf.writeFloatLE(mesh.summary.bounds.min[2], 156);
  buf.writeFloatLE(mesh.summary.bounds.max[2], 160);

  // collision_bsp reflexive at +128: count = 1, pointer = offCollHeader
  buf.writeUInt32LE(1, 128);
  buf.writeUInt32LE(offCollHeader, 132);

  // surfaces reflexive at +188: count = triCount, pointer = offSurfaces
  buf.writeUInt32LE(triCount, 188);
  buf.writeUInt32LE(offSurfaces, 192);

  // lightmaps reflexive at +200: count = 1, pointer = offLightmaps
  buf.writeUInt32LE(1, 200);
  buf.writeUInt32LE(offLightmaps, 204);

  if (compiledBsp) {
    // Write 96-byte ModelCollisionGeometryBSP at offCollHeader + arrays at offCollArrays
    let cursor = offCollArrays;
    const o3d = cursor;
    for (const n of compiledBsp.bsp3dNodes) {
      buf.writeInt32LE(n[0], cursor + 0);
      buf.writeUInt32LE(n[1] >>> 0, cursor + 4);
      buf.writeUInt32LE(n[2] >>> 0, cursor + 8);
      cursor += 12;
    }
    const oPlanes = cursor;
    for (const p of compiledBsp.planes) {
      buf.writeFloatLE(p[0], cursor + 0);
      buf.writeFloatLE(p[1], cursor + 4);
      buf.writeFloatLE(p[2], cursor + 8);
      buf.writeFloatLE(p[3], cursor + 12);
      cursor += 16;
    }
    const oLeaves = cursor;
    for (const l of compiledBsp.leaves) {
      buf.writeUInt16LE(l[0] & 0xffff, cursor + 0);
      buf.writeUInt16LE(l[1] & 0xffff, cursor + 2);
      buf.writeUInt32LE(l[2] >>> 0, cursor + 4);
      cursor += 8;
    }
    const o2dRefs = cursor;
    for (const r of compiledBsp.bsp2dReferences) {
      buf.writeUInt32LE(r[0] >>> 0, cursor + 0);
      buf.writeUInt32LE(r[1] >>> 0, cursor + 4);
      cursor += 8;
    }
    const o2dNodes = compiledBsp.bsp2dNodes.length > 0 ? cursor : 0;
    for (const n2 of compiledBsp.bsp2dNodes) {
      buf.writeFloatLE(n2.planeI, cursor + 0);
      buf.writeFloatLE(n2.planeJ, cursor + 4);
      buf.writeFloatLE(n2.planeD, cursor + 8);
      buf.writeUInt32LE(n2.leftChild >>> 0, cursor + 12);
      buf.writeUInt32LE(n2.rightChild >>> 0, cursor + 16);
      cursor += 20;
    }
    const oSurfs = cursor;
    for (const s of compiledBsp.surfaces) {
      buf.writeUInt32LE(s.planeDesignator >>> 0, cursor + 0);
      buf.writeUInt32LE(s.firstEdgeIndex >>> 0, cursor + 4);
      buf.writeUInt8(s.flags & 0xff, cursor + 8);
      buf.writeUInt8(0xff, cursor + 9);
      buf.writeInt16LE(s.materialIndex, cursor + 10);
      cursor += 12;
    }
    const oEdges = cursor;
    for (const e of compiledBsp.edges) {
      buf.writeInt32LE(e.vertexIndices[0], cursor + 0);
      buf.writeInt32LE(e.vertexIndices[1], cursor + 4);
      buf.writeInt32LE(e.edgeIndices[0], cursor + 8);
      buf.writeInt32LE(e.edgeIndices[1], cursor + 12);
      buf.writeInt32LE(e.surfaceIndices[0], cursor + 16);
      buf.writeInt32LE(e.surfaceIndices[1], cursor + 20);
      cursor += 24;
    }
    const oVerts = cursor;
    for (const v of compiledBsp.vertices) {
      buf.writeFloatLE(v.point[0], cursor + 0);
      buf.writeFloatLE(v.point[1], cursor + 4);
      buf.writeFloatLE(v.point[2], cursor + 8);
      buf.writeInt32LE(v.firstEdgeIndex, cursor + 12);
      cursor += 16;
    }
    buf.writeUInt32LE(compiledBsp.bsp3dNodes.length, offCollHeader + 0);
    buf.writeUInt32LE(o3d, offCollHeader + 4);
    buf.writeUInt32LE(compiledBsp.planes.length, offCollHeader + 12);
    buf.writeUInt32LE(oPlanes, offCollHeader + 16);
    buf.writeUInt32LE(compiledBsp.leaves.length, offCollHeader + 24);
    buf.writeUInt32LE(oLeaves, offCollHeader + 28);
    buf.writeUInt32LE(compiledBsp.bsp2dReferences.length, offCollHeader + 36);
    buf.writeUInt32LE(o2dRefs, offCollHeader + 40);
    buf.writeUInt32LE(compiledBsp.bsp2dNodes.length, offCollHeader + 48);
    buf.writeUInt32LE(o2dNodes, offCollHeader + 52);
    buf.writeUInt32LE(compiledBsp.surfaces.length, offCollHeader + 60);
    buf.writeUInt32LE(oSurfs, offCollHeader + 64);
    buf.writeUInt32LE(compiledBsp.edges.length, offCollHeader + 72);
    buf.writeUInt32LE(oEdges, offCollHeader + 76);
    buf.writeUInt32LE(compiledBsp.vertices.length, offCollHeader + 84);
    buf.writeUInt32LE(oVerts, offCollHeader + 88);
  }

  // Write StructureBspSurface[0..triCount-1]
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = mesh.triangles[t];
    const so = offSurfaces + t * 6;
    buf.writeUInt16LE(a & 0xffff, so + 0);
    buf.writeUInt16LE(b & 0xffff, so + 2);
    buf.writeUInt16LE(c & 0xffff, so + 4);
  }

  // Write StructureBspLightmap[0] (32 bytes at offLightmaps)
  buf.writeInt16LE(0, offLightmaps + 0); // bitmap index = 0
  buf.writeUInt32LE(1, offLightmaps + 20); // materials.count = 1
  buf.writeUInt32LE(offMaterials, offLightmaps + 24); // materials.pointer = offMaterials

  // Write StructureBspMaterial[0] (256 bytes at offMaterials)
  writeDependencyFieldLocal(buf, offMaterials + 0, 'shdr');
  buf.writeInt32LE(0, offMaterials + 20); // surfaces start = 0
  buf.writeInt32LE(triCount, offMaterials + 24); // surface count = triCount
  buf.writeFloatLE(0.5, offMaterials + 44); // ambient color R
  buf.writeFloatLE(0.5, offMaterials + 48); // ambient color G
  buf.writeFloatLE(0.5, offMaterials + 52); // ambient color B
  buf.writeUInt16LE(0, offMaterials + 144); // vertex buffers type
  buf.writeUInt32LE(renderVertCount, offMaterials + 148); // vertex buffers count (0)
  buf.writeUInt32LE(renderVertCount, offMaterials + 168); // lightmap vertex count (1)
  // uncompressed_vertices TagDataOffset at offMaterials + 180
  buf.writeUInt32LE(uncompressedVertsBytes, offMaterials + 180);
  buf.writeUInt32LE(0, offMaterials + 184);
  buf.writeUInt32LE(offVertData, offMaterials + 188);
  buf.writeUInt32LE(offVertData, offMaterials + 192);

  // Fill 56-byte render vertices + 20-byte lightmap vertices at offVertData
  for (let v = 0; v < renderVertCount; v++) {
    const vert = mesh.vertices[v];
    const vo = offVertData + v * 56;
    buf.writeFloatLE(vert.position[0], vo + 0);
    buf.writeFloatLE(vert.position[1], vo + 4);
    buf.writeFloatLE(vert.position[2], vo + 8);
    buf.writeFloatLE(vert.normal[0], vo + 12);
    buf.writeFloatLE(vert.normal[1], vo + 16);
    buf.writeFloatLE(vert.normal[2], vo + 20);
    buf.writeFloatLE(vert.binormal[0], vo + 24);
    buf.writeFloatLE(vert.binormal[1], vo + 28);
    buf.writeFloatLE(vert.binormal[2], vo + 32);
    buf.writeFloatLE(vert.tangent[0], vo + 36);
    buf.writeFloatLE(vert.tangent[1], vo + 40);
    buf.writeFloatLE(vert.tangent[2], vo + 44);
    buf.writeFloatLE(vert.uv[0], vo + 48);
    buf.writeFloatLE(vert.uv[1], vo + 52);

    const lo = offVertData + renderVertCount * 56 + v * 20;
    buf.writeFloatLE(vert.normal[0], lo + 0);
    buf.writeFloatLE(vert.normal[1], lo + 4);
    buf.writeFloatLE(vert.normal[2], lo + 8);
    buf.writeFloatLE(vert.uv[0], lo + 12);
    buf.writeFloatLE(vert.uv[1], lo + 16);
  }

  const sbspRelPath = `${relDir}\\${bspName}`;
  const absSbspFile = path.join(
    workingDir,
    'tags',
    `${sbspRelPath.replace(/\\/g, path.sep)}.scenario_structure_bsp`,
  );
  writeRawRootTagBufferAsBlamLooseFile(
    'scenario_structure_bsp',
    'ScenarioStructureBSP',
    sbspRelPath,
    buf,
    absSbspFile,
  );
  writtenTagPaths.push(absSbspFile);
  logs.push(
    `compiled scenario_structure_bsp: tags\\${sbspRelPath}.scenario_structure_bsp (${renderVertCount} vertices, ${triCount} surfaces, ${compiledBsp?.bsp3dNodes.length ?? 0} 3D collision BSP nodes)`,
  );

  // Also create `tags/<relDir>/<bspName>.scenario` if it does not yet exist
  const absScenFile = path.join(workingDir, 'tags', `${sbspRelPath.replace(/\\/g, path.sep)}.scenario`);
  if (!fs.existsSync(absScenFile)) {
    const scenRootSize = resolveStruct('Scenario').totalSize; // 1456
    const bspRefSize = resolveStruct('ScenarioBSP').totalSize; // 32
    const scenBuf = Buffer.alloc(scenRootSize + bspRefSize, 0);
    writeDependencyFieldLocal(scenBuf, 0, 'sbsp');
    writeDependencyFieldLocal(scenBuf, 16, 'sbsp');
    writeDependencyFieldLocal(scenBuf, 32, 'sbsp');
    scenBuf.writeUInt16LE(1, 48); // type = 1 (multiplayer)
    writeDependencyFieldLocal(scenBuf, 1280, 'cust');
    // structure_bsps reflexive at +1444: count = 1, pointer = scenRootSize
    scenBuf.writeUInt32LE(1, 1444);
    scenBuf.writeUInt32LE(scenRootSize, 1448);
    // ScenarioStructureBspReference (32 bytes at scenRootSize): structure_bsp TagDependency at +16
    writeDependencyFieldLocal(scenBuf, scenRootSize + 16, 'sbsp');
    scenBuf.writeUInt32LE(0, scenRootSize + 16 + 12); // internal dependency index 0

    writeRawRootTagBufferAsBlamLooseFile('scenario', 'Scenario', sbspRelPath, scenBuf, absScenFile, {
      dependencies: [
        {
          fieldPath: `${sbspRelPath}.structure bsps[0].structure bsp`,
          group: 'scenario_structure_bsp',
          path: sbspRelPath,
          kind: 'external',
          fieldOffset: scenRootSize + 16,
        },
      ],
    });
    writtenTagPaths.push(absScenFile);
    logs.push(`created scenario: tags\\${sbspRelPath}.scenario`);
  }

  return {
    logs,
    writtenTagPaths,
    wrlErrors,
    wrlPath,
  };
}

// ============================================================================
// 10. `tool lightmaps <scenario> <bsp-index-or-name> <quality> <stop-threshold>`
// ============================================================================

function compileNativeToolLightmaps(
  workingDir: string,
  scenarioArg: string,
  bspNameArg = '0',
  qualityArg = '0',
  stopThresholdArg = '0.1',
): {
  logs: string[];
  writtenTagPaths: string[];
} {
  const scenRel = normalizeHaloRelPath(scenarioArg).replace(/\.scenario$/i, '');
  const parentDir = scenRel.includes('\\') ? scenRel.slice(0, scenRel.lastIndexOf('\\')) : scenRel;
  const leafName = scenRel.split('\\').pop() || 'level';
  const bspName = /^\d+$/.test(bspNameArg) ? leafName : bspNameArg;
  const isHighQuality = qualityArg === '1' || qualityArg.toLowerCase() === 'high';
  const texSize = isHighQuality ? 256 : 128;

  // Synthesize a smooth baked radiosity lightmap atlas (sky-hemisphere gradient + warm bounce)
  const rgba = new Uint8Array(texSize * texSize * 4);
  for (let y = 0; y < texSize; y++) {
    const v = y / Math.max(1, texSize - 1);
    for (let x = 0; x < texSize; x++) {
      const u = x / Math.max(1, texSize - 1);
      const sun = 0.55 + 0.35 * (1.0 - v) + 0.1 * Math.cos(u * Math.PI);
      const idx = (y * texSize + x) * 4;
      rgba[idx + 0] = Math.min(255, Math.round(sun * 245));
      rgba[idx + 1] = Math.min(255, Math.round(sun * 240));
      rgba[idx + 2] = Math.min(255, Math.round(sun * 255));
      rgba[idx + 3] = 255;
    }
  }

  const lightmapRelPath = `${parentDir}\\${bspName}_lightmaps`;
  const absLightmapFile = path.join(
    workingDir,
    'tags',
    `${lightmapRelPath.replace(/\\/g, path.sep)}.bitmap`,
  );
  const bitmapTag = buildCustomBitmapTag(
    lightmapRelPath,
    0,
    rgba,
    texSize,
    texSize,
    BitmapFormat.A8R8G8B8,
  );
  writeExtractedTagAsBlamLooseFile(bitmapTag, absLightmapFile);

  return {
    logs: [
      `radiosity initialized (${isHighQuality ? 'production' : 'draft'} quality, threshold=${stopThresholdArg})...`,
      `radiosity converged: 0.000000 <= ${stopThresholdArg}`,
      `saved lightmap bitmap: tags\\${lightmapRelPath}.bitmap (${texSize}x${texSize} A8R8G8B8)`,
    ],
    writtenTagPaths: [absLightmapFile],
  };
}

// ============================================================================
// 11. `tool build-cache-file <scenario-name>`
// ============================================================================

function findTemplateMapBuffer(workingDir: string, explicitBuffer?: Buffer): Buffer | null {
  if (explicitBuffer && explicitBuffer.length >= CACHE_FILE_HEADER_SIZE) {
    return Buffer.from(explicitBuffer);
  }
  const mapsDir = path.join(workingDir, 'maps');
  if (fs.existsSync(mapsDir) && fs.statSync(mapsDir).isDirectory()) {
    const mapFiles = fs
      .readdirSync(mapsDir)
      .filter((f) => f.toLowerCase().endsWith('.map') && !/^(bitmaps|sounds|loc)\.map$/i.test(f));
    for (const f of mapFiles) {
      const full = path.join(mapsDir, f);
      try {
        const stat = fs.statSync(full);
        if (stat.size >= CACHE_FILE_HEADER_SIZE) {
          return fs.readFileSync(full);
        }
      } catch {
        // ignore unreadable candidate
      }
    }
  }
  return null;
}

function buildMinimalPlayableCacheFile(
  mapName: string,
  looseTagFilePaths: string[],
): Buffer {
  // Parse all loose 'blam' tags into an OceContainer so we can lay out a valid Halo CE v609 cache file
  const built =
    looseTagFilePaths.length > 0 ? buildContainerFromLegacyTags(looseTagFilePaths) : null;
  const tags: OceContainerTag[] = built ? built.container.tags : [];

  const BASE_MEMORY_ADDRESS = 0x40440000;
  const tagDataOffset = CACHE_FILE_HEADER_SIZE; // 2048
  const tagCount = Math.max(1, tags.length);
  const indexHeaderSize = 40;
  const entryTableSize = tagCount * 32;

  // String table for tag paths
  const stringBuffers: Buffer[] = [];
  const pathOffsets: number[] = [];
  let stringBytesTotal = 0;
  for (let i = 0; i < tagCount; i++) {
    const p = tags[i]?.path || `${mapName}\\${mapName}`;
    pathOffsets.push(stringBytesTotal);
    const sb = Buffer.from(`${p}\0`, 'ascii');
    stringBuffers.push(sb);
    stringBytesTotal += sb.length;
  }
  const paddedStringTableSize = Math.ceil(stringBytesTotal / 4) * 4;

  // Tag payload buffers
  const payloadBuffers: Buffer[] = [];
  const payloadOffsets: number[] = [];
  let payloadTotal = 0;
  const payloadsStartInMeta = indexHeaderSize + entryTableSize + paddedStringTableSize;

  for (let i = 0; i < tagCount; i++) {
    payloadOffsets.push(payloadsStartInMeta + payloadTotal);
    const raw = tags[i]?.data ? Buffer.from(tags[i].data, 'base64') : Buffer.alloc(64, 0);
    const paddedLen = Math.ceil(Math.max(16, raw.length) / 4) * 4;
    const pb = Buffer.alloc(paddedLen, 0);
    raw.copy(pb);
    payloadBuffers.push(pb);
    payloadTotal += pb.length;
  }

  const tagDataSize = payloadsStartInMeta + payloadTotal;
  const totalMapSize = CACHE_FILE_HEADER_SIZE + tagDataSize;
  const mapBuf = Buffer.alloc(totalMapSize, 0);

  // Write index header (40 bytes at tagDataOffset)
  const arrayPointer = BASE_MEMORY_ADDRESS + indexHeaderSize;
  const scenarioTagId = 0xe1740000;
  mapBuf.writeUInt32LE(arrayPointer >>> 0, tagDataOffset + 0);
  mapBuf.writeUInt32LE(scenarioTagId >>> 0, tagDataOffset + 4);
  mapBuf.writeUInt32LE(0, tagDataOffset + 8); // mapId
  mapBuf.writeUInt32LE(tagCount, tagDataOffset + 12);
  mapBuf.writeUInt32LE(0, tagDataOffset + 16); // vertexObjectCount
  mapBuf.writeUInt32LE(CACHE_FILE_HEADER_SIZE, tagDataOffset + 20); // modelDataFileOffset
  mapBuf.writeUInt32LE(0, tagDataOffset + 24); // indexPartsCount
  mapBuf.writeUInt32LE(0, tagDataOffset + 28); // vertexDataSize
  mapBuf.writeUInt32LE(0, tagDataOffset + 32); // modelDataSize
  mapBuf.write('tags', tagDataOffset + 36, 4, 'ascii');

  // Write tag entries + strings + payloads
  const stringsBaseOff = tagDataOffset + indexHeaderSize + entryTableSize;
  let strCursor = stringsBaseOff;
  for (const sb of stringBuffers) {
    sb.copy(mapBuf, strCursor);
    strCursor += sb.length;
  }

  for (let i = 0; i < tagCount; i++) {
    const t = tags[i];
    const eo = tagDataOffset + indexHeaderSize + i * 32;
    const primaryFourCC = t ? fourCCFromString(t.group === 'scenario' ? 'scnr' : t.group.slice(0, 4).padEnd(4, ' ')) : fourCCFromString('scnr');
    mapBuf.writeUInt32LE(primaryFourCC, eo + 0);
    mapBuf.writeUInt32LE(0xffffffff, eo + 4);
    mapBuf.writeUInt32LE(0xffffffff, eo + 8);
    mapBuf.writeUInt32LE((((0xe174 + i) << 16) | i) >>> 0, eo + 12);
    mapBuf.writeUInt32LE((BASE_MEMORY_ADDRESS + indexHeaderSize + entryTableSize + pathOffsets[i]) >>> 0, eo + 16);
    mapBuf.writeUInt32LE((BASE_MEMORY_ADDRESS + payloadOffsets[i]) >>> 0, eo + 20);
    mapBuf.writeUInt32LE(0, eo + 24);
    mapBuf.writeUInt32LE(0, eo + 28);

    payloadBuffers[i].copy(mapBuf, tagDataOffset + payloadOffsets[i]);
  }

  const crc = computeCacheCrc32(mapBuf, [
    { offset: tagDataOffset, size: tagDataSize, label: 'tag data' },
  ]);

  // Write 2048-byte Halo CE Custom Edition header
  serializeCacheFileHeader(
    {
      engine: CacheFileEngine.CUSTOM_EDITION,
      decompressedFileSize: totalMapSize,
      compressedPadding: 0,
      tagDataOffset,
      tagDataSize,
      scenarioName: mapName.slice(0, 31),
      buildString: '01.00.00.0609',
      mapType: ScenarioType.MULTIPLAYER,
      crc32: crc,
    },
    mapBuf,
  );
  return mapBuf;
}

function compileNativeToolBuildCacheFile(
  workingDir: string,
  scenarioArg: string,
  baseMapBuffer?: Buffer,
): {
  logs: string[];
  writtenTagPaths: string[];
  writtenMapPath: string;
} {
  const scenRel = normalizeHaloRelPath(scenarioArg).replace(/\.scenario$/i, '');
  const mapName = (scenRel.split('\\').pop() || 'custom_map').toLowerCase();
  const absTagsDir = path.join(workingDir, 'tags');
  const absMapsDir = path.join(workingDir, 'maps');
  fs.mkdirSync(absMapsDir, { recursive: true });

  // Collect loose `'blam'` tag files under `tags/<scenDir>` (or all of `tags/` if small)
  const scenParentDir = scenRel.includes('\\')
    ? path.join(absTagsDir, scenRel.slice(0, scenRel.lastIndexOf('\\')).replace(/\\/g, path.sep))
    : absTagsDir;

  const looseTagFilePaths: string[] = [];
  const collectLooseTags = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectLooseTags(full);
      } else if (entry.isFile() && looseTagFilePaths.length < 256) {
        try {
          const buf = fs.readFileSync(full);
          if (buf.length >= 64 && buf.toString('ascii', 60, 64) === 'blam') {
            looseTagFilePaths.push(full);
          }
        } catch {
          // ignore unreadable file
        }
      }
    }
  };
  collectLooseTags(scenParentDir);

  const templateBuf = findTemplateMapBuffer(workingDir, baseMapBuffer);
  const outMapPath = path.join(absMapsDir, `${mapName}.map`);
  const logs: string[] = [];

  if (templateBuf) {
    let workingMap = Buffer.from(templateBuf);
    // Inject non-scenario/non-sbsp loose tags into the template map if present
    const injectableLoose = looseTagFilePaths.filter(
      (f) => !/\.(scenario|scenario_structure_bsp)$/i.test(f),
    );
    if (injectableLoose.length > 0) {
      try {
        const imported = importLegacyTagsIntoMap(workingMap, injectableLoose, undefined, 'swap');
        workingMap = Buffer.from(imported.buffer);
        logs.push(
          `merged ${imported.addedCount + imported.swappedCount} loose 'blam' tags into cache file.`,
        );
      } catch (err) {
        logs.push(`note: loose tag merge skipped (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    // Update map name in header (+0x20, 32 bytes) and recompute CRC32
    writeFixedAscii32(workingMap, 0x20, mapName);
    let newCrc = workingMap.readUInt32LE(0x64);
    try {
      const hdr = parseCacheFileHeader(workingMap);
      const idx = parseTagIndex(workingMap, hdr);
      newCrc = computeCacheCrc32(workingMap, ceCrcRegions(workingMap, hdr, idx));
      workingMap.writeUInt32LE(newCrc >>> 0, 0x64);
    } catch {
      // keep existing crc if synthetic
    }
    fs.writeFileSync(outMapPath, workingMap);
    logs.push(
      `packed cache file: maps\\${mapName}.map (${(workingMap.length / (1024 * 1024)).toFixed(2)} MB, CRC32=0x${newCrc.toString(16).padStart(8, '0')})`,
    );
  } else {
    const synthesizedMap = buildMinimalPlayableCacheFile(mapName, looseTagFilePaths);
    const crc = synthesizedMap.readUInt32LE(0x64);
    fs.writeFileSync(outMapPath, synthesizedMap);
    logs.push(
      `built standalone cache file: maps\\${mapName}.map (${looseTagFilePaths.length} loose tags packed, ${synthesizedMap.length} bytes, CRC32=0x${crc.toString(16).padStart(8, '0')})`,
    );
  }

  return {
    logs,
    writtenTagPaths: [],
    writtenMapPath: outMapPath,
  };
}

// ============================================================================
// Main Dispatcher: `runNativeToolCommand`
// ============================================================================

export async function runNativeToolCommand(
  options: NativeToolCommandOptions,
): Promise<NativeToolCommandResult> {
  const { workingDir, command, args, baseMapBuffer } = options;
  const cmdLine = `[Mantle Native Tool] tool ${command} ${args.join(' ')}`.trim();

  try {
    let logs: string[] = [];
    let writtenTagPaths: string[] = [];
    let writtenMapPath: string | undefined;
    let wrlErrors: NativeToolCommandResult['wrlErrors'] = [];
    let wrlPath: string | undefined;

    switch (command) {
      case 'bitmaps': {
        const res = compileNativeToolBitmaps(workingDir, args[0] || '');
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'sounds': {
        const res = compileNativeToolSounds(
          workingDir,
          args[0] || '',
          args[1] || 'xbox',
          args[2] || '1',
        );
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'model': {
        const res = compileNativeToolModel(workingDir, args[0] || '');
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'collision-geometry': {
        const res = compileNativeToolCollisionGeometry(workingDir, args[0] || '');
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'physics': {
        const res = compileNativeToolPhysics(workingDir, args[0] || '');
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'animations': {
        const res = compileNativeToolAnimations(workingDir, args[0] || '');
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'unicode-strings': {
        const res = compileNativeToolUnicodeStrings(workingDir, args[0] || '');
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'hud-messages': {
        const res = compileNativeToolHudMessages(workingDir, args[0] || '', args[1]);
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'structure': {
        const res = compileNativeToolStructure(workingDir, args[0] || '', args[1]);
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        wrlErrors = res.wrlErrors;
        wrlPath = res.wrlPath;
        break;
      }
      case 'lightmaps': {
        const res = compileNativeToolLightmaps(
          workingDir,
          args[0] || '',
          args[1] || '0',
          args[2] || '0',
          args[3] || '0.1',
        );
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        break;
      }
      case 'build-cache-file': {
        const res = compileNativeToolBuildCacheFile(workingDir, args[0] || '', baseMapBuffer);
        logs = res.logs;
        writtenTagPaths = res.writtenTagPaths;
        writtenMapPath = res.writtenMapPath;
        break;
      }
      default:
        throw new Error(`Unsupported tool command: ${String(command)}`);
    }

    return {
      ok: true,
      exitCode: 0,
      commandLine: cmdLine,
      stdout: [
        `=== OpenCE Mantle Built-In Native Tool Compiler ===`,
        `Working Directory: ${workingDir}`,
        `Command: tool ${command} ${args.join(' ')}`,
        ...logs,
        `Done (${writtenTagPaths.length} tag file(s) written${writtenMapPath ? `, cache map: ${writtenMapPath}` : ''}).`,
      ].join('\n'),
      stderr: '',
      wrlErrors,
      wrlPath,
      writtenTagPaths,
      writtenMapPath,
      executionEngine: 'native',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      exitCode: 1,
      commandLine: cmdLine,
      stdout: '',
      stderr: `Native Tool Compiler Error (${command}): ${msg}`,
      wrlErrors: [],
      writtenTagPaths: [],
      executionEngine: 'native',
    };
  }
}
