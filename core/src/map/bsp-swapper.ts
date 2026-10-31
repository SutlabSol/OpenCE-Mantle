import { decodeStruct, resolveStruct } from './definitions/engine';
import { locateStructureBsp } from './definitions/validate-tag';
import { inspectCustomEditionMap } from './open-map';
import type { TagIndex } from './tag-index';
import { extractBspRenderMesh } from '../render/bsp-geometry';
import { extractTagSet } from './tag-extractor';
import type { RandomAccessFile } from './convert/resource-files';
import { serializeContainer, deserializeContainer } from './container';
import {
  planAddInjection,
  applyAddInjection,
  autoLinkExternalResourceMapsInContainer,
  hydrateExternalRawDataInContainer,
  normalizeTagPath,
  type InjectionPlan,
} from './tag-injector';
import { mergeStructureBsps, rebaseStructureBspPointers } from './bsp-merger';
import { decodeReflexive } from './definitions/codec';
import { resolveTagDataPointer } from './tag-index';
import { ensurePaletteEntry, appendReflexiveElements } from '../render/scenario-objects';
import { compileHaloScriptIntoScenario } from './hs-compiler';
import { duplicateTagInMap } from './tag-index-editor';
import {
  parseModelFileForBsp,
  type ModelImportOptions,
  type ModelBounds3D,
} from '../render/glb-model-importer';
import {
  buildCustomBitmapTag,
  buildCustomShaderEnvironmentTag,
  buildCustomShaderModelTag,
  compileMeshCollisionBspData,
} from '../render/collision-generator';
import { BitmapFormat } from '../render/bitmap-textures';
import { ceCrcRegions, computeCacheCrc32 } from './cache-crc';
import { fourCCFromString } from '../constants/tag-classes';
import type { ExtractedTag, ExtractedTagSet } from './tag-extractor';

export interface BspInfo {
  index: number;
  path: string;
  tagId: number;
  bspStart: number;
  bspSize: number;
  bspAddress: number;
  vertexCount: number;
  triangleCount: number;
  submeshCount: number;
  worldBounds: [number, number, number, number, number, number];
  hasDobc: boolean;
  hasDecals: boolean;
}

export interface BspSwapPreflightResult {
  ok: boolean;
  sourceBsps: BspInfo[];
  targetBsps: BspInfo[];
  selectedSourceBsp: BspInfo | null;
  selectedSourceBsps?: BspInfo[];
  selectedTargetBsp: BspInfo | null;
  sizeDelta: number;
  estimatedNewSize: number;
  warnings: string[];
  error?: string;
  sourceEdition?: string;
  sourceEditionName?: string;
  sourceBitmapsPath?: string | null;
  sourceSoundsPath?: string | null;
}

export interface BspSwapOptions {
  sourceBspIndex?: number;
  sourceBspIndices?: number[];
  targetBspIndex?: number;
  stripDobcAndDecals?: boolean;
  stripDobc?: boolean;
  stripDecals?: boolean;
  relocateGroundObjects?: boolean;
  newScenarioName?: string;
  harvestShaders?: boolean;
  importScenery?: boolean;
  importMachines?: boolean;
  importSceneryAndMachines?: boolean;
  importVehicles?: boolean;
  makeDoorsAutomatic?: boolean;
  filterObjectsToBspBounds?: boolean;
  clearExistingPlacements?: boolean;
  clearPlayerSpawns?: boolean;
  mergeMultipleBsps?: boolean;
  useExpandedEngineLimits?: boolean;
  removeOverlappingPortalCaps?: boolean;
  removeBspEndBlockWalls?: boolean;
  addBspActivationScript?: boolean;
  bspScriptMode?: 'none' | 'switch' | 'activate_all';
  resourceFiles?: { bitmaps?: RandomAccessFile; sounds?: RandomAccessFile };
  ceResourceFiles?: { bitmaps?: RandomAccessFile; sounds?: RandomAccessFile };
  customBitmapsPath?: string | null;
  customSoundsPath?: string | null;
}

export interface BspSwapResult {
  ok: boolean;
  buffer: Buffer;
  summary: {
    sourceBspName: string;
    targetBspName: string;
    oldSize: number;
    newSize: number;
    delta: number;
    strippedDobc: boolean;
    strippedDecals: boolean;
    relocatedSpawns: number;
    harvestedShaders?: number;
    harvestedBitmaps?: number;
    importedScenery?: number;
    importedVehicles?: number;
    importedMachines?: number;
    removedDuplicateTriangles?: number;
    removedPortalBlockerTriangles?: number;
    createdTriggerVolumes?: number;
  };
  error?: string;
}

/**
 * Enumerates all BSPs present in a map buffer with their geometry and metadata.
 */
export function getMapBsps(buffer: Buffer): BspInfo[] {
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') {
    return [];
  }
  const { header, tagIndex } = inspected;
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) return [];

  const scenarioFileOffset = header.tagDataOffset + (scenarioEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
  const decodedScenario = decodeStruct(buffer, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive' || bspsField.value.count === 0) {
    return [];
  }

  const bspCount = bspsField.value.count;
  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspsArrayOffset = header.tagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);
  const results: BspInfo[] = [];

  for (let i = 0; i < bspCount; i++) {
    const entryOffset = bspsArrayOffset + i * scenarioBspSize;
    const entry = decodeStruct(buffer, entryOffset, 'ScenarioBSP');
    const dep = entry.get('structure bsp');
    const depTagId = dep && dep.kind === 'dependency' ? dep.value.tagId : 0xffffffff;
    const tagEntry = tagIndex.entries[depTagId & 0xffff];
    const path = tagEntry?.path || `levels\\bsp_${i}`;

    const bspStart = (entry.get('bsp start') as { kind: 'basic'; value: number }).value;
    const bspSize = (entry.get('bsp size') as { kind: 'basic'; value: number }).value;
    const bspAddress = (entry.get('bsp address') as { kind: 'basic'; value: number }).value;

    let vertexCount = 0;
    let triangleCount = 0;
    let submeshCount = 0;
    let worldBounds: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
    let hasDobc = false;
    let hasDecals = false;

    try {
      const mesh = extractBspRenderMesh(buffer, header, tagIndex, i);
      vertexCount = mesh.totalVertices;
      triangleCount = mesh.totalTriangles;
      submeshCount = mesh.submeshes.length;
      worldBounds = mesh.worldBounds;
    } catch {
      // Mesh decode fallback if partially damaged
    }

    const bspLoc = locateStructureBsp(
      buffer,
      tagIndex,
      scenarioFileOffset,
      header.tagDataOffset,
      tagIndex.baseMemoryAddress,
      depTagId,
      i,
    );

    if (bspLoc && bspLoc.fileOffset + 0x260 <= buffer.length) {
      const dobcCount = buffer.readUInt32LE(bspLoc.fileOffset + 0x24c);
      const decalCount = buffer.readUInt32LE(bspLoc.fileOffset + 0x258);
      hasDobc = dobcCount > 0;
      hasDecals = decalCount > 0;
    }

    results.push({
      index: i,
      path,
      tagId: depTagId,
      bspStart,
      bspSize,
      bspAddress,
      vertexCount,
      triangleCount,
      submeshCount,
      worldBounds,
      hasDobc,
      hasDecals,
    });
  }

  return results;
}

/**
 * Pre-flights a BSP swap between a source map and a target map.
 */
export function bspSwapPreflight(
  sourceBuffer: Buffer,
  targetBuffer: Buffer,
  sourceBspIndex = 0,
  targetBspIndex = 0,
  sourceBspIndices?: number[],
): BspSwapPreflightResult {
  const sourceBsps = getMapBsps(sourceBuffer);
  const targetBsps = getMapBsps(targetBuffer);

  if (sourceBsps.length === 0) {
    return {
      ok: false,
      sourceBsps: [],
      targetBsps: [],
      selectedSourceBsp: null,
      selectedTargetBsp: null,
      sizeDelta: 0,
      estimatedNewSize: targetBuffer.length,
      warnings: [],
      error: 'No valid Structure BSPs found in source map.',
    };
  }

  if (targetBsps.length === 0) {
    return {
      ok: false,
      sourceBsps,
      targetBsps: [],
      selectedSourceBsp: null,
      selectedTargetBsp: null,
      sizeDelta: 0,
      estimatedNewSize: targetBuffer.length,
      warnings: [],
      error: 'No valid Structure BSPs found in target map.',
    };
  }

  const selectedTargetBsp = targetBsps[targetBspIndex] ?? targetBsps[0];

  let selectedSourceBsps: BspInfo[] | undefined;
  let selectedSourceBsp: BspInfo;
  let totalSourceSize = 0;

  if (sourceBspIndices && sourceBspIndices.length > 0) {
    selectedSourceBsps = sourceBspIndices.map((idx) => sourceBsps[idx]).filter(Boolean);
    if (selectedSourceBsps.length === 0) {
      selectedSourceBsp = sourceBsps[sourceBspIndex] ?? sourceBsps[0];
      selectedSourceBsps = [selectedSourceBsp];
    } else {
      selectedSourceBsp = selectedSourceBsps[0];
    }
  } else {
    selectedSourceBsp = sourceBsps[sourceBspIndex] ?? sourceBsps[0];
    selectedSourceBsps = [selectedSourceBsp];
  }

  if (selectedSourceBsps.length > 1) {
    totalSourceSize = selectedSourceBsps.reduce((acc, b) => acc + b.bspSize, 0);
  } else {
    totalSourceSize = selectedSourceBsp.bspSize;
  }

  const sizeDelta = totalSourceSize - selectedTargetBsp.bspSize;
  const estimatedNewSize = targetBuffer.length + sizeDelta;
  const warnings: string[] = [];

  const anyDobc = selectedSourceBsps.some((b) => b.hasDobc);
  const anyDecals = selectedSourceBsps.some((b) => b.hasDecals);

  if (anyDobc) {
    warnings.push('Source BSP contains Detail Objects (DOBC). Stripping recommended for multiplayer.');
  }
  if (anyDecals) {
    warnings.push('Source BSP contains Runtime Decals. Stripping recommended for multiplayer stability.');
  }
  if (selectedSourceBsps.length > 1) {
    warnings.push(`Multi-BSP Merge Mode active: ${selectedSourceBsps.length} donor BSPs will be fused into a single multiplayer BSP.`);
  }
  if (estimatedNewSize > 250 * 1024 * 1024) {
    warnings.push('Target map size will exceed 250 MB; verify engine memory constraints.');
  }

  return {
    ok: true,
    sourceBsps,
    targetBsps,
    selectedSourceBsp,
    selectedSourceBsps,
    selectedTargetBsp,
    sizeDelta,
    estimatedNewSize,
    warnings,
  };
}

interface BspDependencyOccurrence {
  bspRelativeOffset: number;
  fourcc: number;
  tagId: number;
}

function scanBspDependencies(
  buffer: Buffer,
  structName: string,
  fileOffset: number,
  bspStart: number,
  bspSize: number,
  bspAddress: number,
  out: BspDependencyOccurrence[],
  visitedOffsets: Set<number>,
): void {
  if (fileOffset < bspStart || fileOffset >= bspStart + bspSize || visitedOffsets.has(fileOffset)) return;
  visitedOffsets.add(fileOffset);
  let resolved;
  try {
    resolved = resolveStruct(structName);
  } catch {
    return;
  }
  if (fileOffset + resolved.totalSize > buffer.length) return;

  for (const field of resolved.fields) {
    const fieldOffset = fileOffset + field.offset;
    if (field.def.type === 'TagDependency') {
      if (fieldOffset + 16 <= buffer.length) {
        const fourcc = buffer.readUInt32LE(fieldOffset + 0);
        const tagId = buffer.readUInt32LE(fieldOffset + 12);
        if (tagId !== 0xffffffff && tagId !== 0) {
          out.push({
            bspRelativeOffset: fieldOffset - bspStart,
            fourcc,
            tagId,
          });
        }
      }
    } else if (field.def.type === 'TagReflexive') {
      if (fieldOffset + 12 <= buffer.length && field.def.struct) {
        const count = buffer.readUInt32LE(fieldOffset + 0);
        const pointerLow = buffer.readUInt32LE(fieldOffset + 4);
        if (count > 0 && count < 20000 && pointerLow >= bspAddress) {
          const childArrayOffset = bspStart + (pointerLow - bspAddress);
          if (childArrayOffset >= bspStart && childArrayOffset < bspStart + bspSize) {
            try {
              const childSize = resolveStruct(field.def.struct).totalSize;
              for (let i = 0; i < count; i++) {
                scanBspDependencies(
                  buffer,
                  field.def.struct,
                  childArrayOffset + i * childSize,
                  bspStart,
                  bspSize,
                  bspAddress,
                  out,
                  visitedOffsets,
                );
              }
            } catch {
              // ignore unknown child struct
            }
          }
        }
      }
    }
  }
}

function rewriteBspDependencies(
  buffer: Buffer,
  structName: string,
  fileOffset: number,
  bspStart: number,
  bspSize: number,
  bspAddress: number,
  tagIdMap: Map<number, number>,
  visitedOffsets: Set<number>,
  tagDataOffset?: number,
): void {
  if (fileOffset < bspStart || fileOffset >= bspStart + bspSize || visitedOffsets.has(fileOffset)) return;
  visitedOffsets.add(fileOffset);
  let resolved;
  try {
    resolved = resolveStruct(structName);
  } catch {
    return;
  }
  if (fileOffset + resolved.totalSize > buffer.length) return;

  for (const field of resolved.fields) {
    const fieldOffset = fileOffset + field.offset;
    if (field.def.type === 'TagDependency') {
      if (fieldOffset + 16 <= buffer.length) {
        const oldTagId = buffer.readUInt32LE(fieldOffset + 12);
        if (oldTagId !== 0xffffffff) {
          const mapped = tagIdMap.get(oldTagId) ?? tagIdMap.get(oldTagId & 0xffff);
          if (mapped !== undefined) {
            buffer.writeUInt32LE(mapped >>> 0, fieldOffset + 12);
            if (tagDataOffset !== undefined) {
              const tagHeaderSize = buffer.readUInt32LE(0x04) === 5 ? 0x24 : 0x28;
              const entryOff = tagDataOffset + tagHeaderSize + (mapped & 0xffff) * 32;
              if (entryOff + 0x14 <= buffer.length) {
                const pathPtr = buffer.readUInt32LE(entryOff + 0x10);
                buffer.writeUInt32LE(pathPtr >>> 0, fieldOffset + 4);
                buffer.writeUInt32LE(0, fieldOffset + 8);
              }
            }
          } else {
            buffer.writeUInt32LE(0, fieldOffset + 4);
            buffer.writeUInt32LE(0, fieldOffset + 8);
            buffer.writeUInt32LE(0xffffffff, fieldOffset + 12);
          }
        } else {
          buffer.writeUInt32LE(0, fieldOffset + 4);
          buffer.writeUInt32LE(0, fieldOffset + 8);
        }
      }
    } else if (field.def.type === 'TagReflexive') {
      if (fieldOffset + 12 <= buffer.length && field.def.struct) {
        if (field.def.struct === 'PredictedResource') {
          buffer.writeUInt32LE(0, fieldOffset + 0);
          buffer.writeUInt32LE(0, fieldOffset + 4);
          continue;
        }
        const count = buffer.readUInt32LE(fieldOffset + 0);
        const pointerLow = buffer.readUInt32LE(fieldOffset + 4);
        if (count > 0 && count < 20000 && pointerLow >= bspAddress) {
          const childArrayOffset = bspStart + (pointerLow - bspAddress);
          if (childArrayOffset >= bspStart && childArrayOffset < bspStart + bspSize) {
            try {
              const childSize = resolveStruct(field.def.struct).totalSize;
              for (let i = 0; i < count; i++) {
                rewriteBspDependencies(
                  buffer,
                  field.def.struct,
                  childArrayOffset + i * childSize,
                  bspStart,
                  bspSize,
                  bspAddress,
                  tagIdMap,
                  visitedOffsets,
                  tagDataOffset,
                );
              }
            } catch {
              // ignore unknown child struct
            }
          }
        }
      }
    }
  }
}

function shiftExistingRawDataOffsets(
  buffer: Buffer,
  tagDataOffset: number,
  tagIndex: TagIndex,
  cutoffOffset: number,
  delta: number,
): void {
  if (delta === 0) return;
  const base = tagIndex.baseMemoryAddress;

  for (const entry of tagIndex.entries) {
    if (entry.isExternal) continue;
    const tagFileOffset = tagDataOffset + (entry.tagDataPointerOrResourceIndex - base);
    if (tagFileOffset < 0 || tagFileOffset + 16 > buffer.length) continue;

    if (entry.primaryClassName === 'bitmap') {
      try {
        const decoded = decodeStruct(buffer, tagFileOffset, 'Bitmap');
        const bDataRefl = decoded.get('bitmap data');
        if (bDataRefl && bDataRefl.kind === 'reflexive' && bDataRefl.value.count > 0) {
          const arrOffset = tagDataOffset + (bDataRefl.value.pointerLow - base);
          const bDataSize = resolveStruct('BitmapData').totalSize;
          for (let i = 0; i < bDataRefl.value.count; i++) {
            const itemOffset = arrOffset + i * bDataSize;
            if (itemOffset + 32 <= buffer.length) {
              const flags = buffer.readUInt16LE(itemOffset + 14);
              const isExternal = (flags & 0x100) !== 0;
              if (!isExternal) {
                const curPixOff = buffer.readUInt32LE(itemOffset + 24);
                if (curPixOff >= cutoffOffset) {
                  buffer.writeUInt32LE(curPixOff + delta, itemOffset + 24);
                }
              }
            }
          }
        }
      } catch {}
    } else if (entry.primaryClassName === 'sound') {
      try {
        const decoded = decodeStruct(buffer, tagFileOffset, 'Sound');
        const pitchRefl = decoded.get('pitch ranges');
        if (pitchRefl && pitchRefl.kind === 'reflexive' && pitchRefl.value.count > 0) {
          const pitchArrOffset = tagDataOffset + (pitchRefl.value.pointerLow - base);
          const pitchSize = resolveStruct('SoundPitchRange').totalSize;
          for (let p = 0; p < pitchRefl.value.count; p++) {
            const pOffset = pitchArrOffset + p * pitchSize;
            const pDecoded = decodeStruct(buffer, pOffset, 'SoundPitchRange');
            const permRefl = pDecoded.get('permutations');
            if (permRefl && permRefl.kind === 'reflexive' && permRefl.value.count > 0) {
              const permArrOffset = tagDataOffset + (permRefl.value.pointerLow - base);
              const permSize = resolveStruct('SoundPermutation').totalSize;
              for (let m = 0; m < permRefl.value.count; m++) {
                const mOffset = permArrOffset + m * permSize;
                if (mOffset + 0x4c <= buffer.length) {
                  const sampleExt = buffer.readUInt32LE(mOffset + 0x44);
                  if ((sampleExt & 1) === 0) {
                    const curSampleOff = buffer.readUInt32LE(mOffset + 0x48);
                    if (curSampleOff >= cutoffOffset && curSampleOff !== 0xffffffff) {
                      buffer.writeUInt32LE(curSampleOff + delta, mOffset + 0x48);
                    }
                  }
                }
              }
            }
          }
        }
      } catch {}
    }
  }
}

function resolvePointer(pointer: number, tagDataOffset: number, baseMemoryAddress: number): number {
  return tagDataOffset + (pointer - baseMemoryAddress);
}

/**
 * Repairs any non-external (`!entry.isExternal`) bitmap or sound tags in `buffer` whose
 * sub-entries still carry the Retail PC / HaloMD `in data file` flag (`BitmapData.flags & 0x100`
 * or `SoundPermutation.external & 1`) by reading the raw bytes from `resourceFiles` and
 * appending them to the map's raw-data region (right before `tagDataOffset`).
 */
export function internalizeBrokenExternalBitmaps(
  buffer: Buffer,
  resourceFiles?: { bitmaps?: RandomAccessFile; sounds?: RandomAccessFile },
): Buffer {
  if (!resourceFiles?.bitmaps && !resourceFiles?.sounds) return buffer;
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') return buffer;

  const { header, tagIndex } = inspected;
  const tagDataOffset = header.tagDataOffset;
  const base = tagIndex.baseMemoryAddress;

  interface PendingPatch {
    tagDataRelativeOffset: number;
    flagTagDataRelativeOffset: number;
    flagWidth: 2 | 4;
    flagMask: number;
    chunkIndex: number;
  }

  const chunks: Buffer[] = [];
  const chunkOffsets: number[] = [];
  const dedupe = new Map<string, number>();
  const patches: PendingPatch[] = [];
  let totalInserted = 0;

  for (const entry of tagIndex.entries) {
    if (entry.isExternal) continue;
    const tagRel = entry.tagDataPointerOrResourceIndex - base;
    const tagFileOffset = tagDataOffset + tagRel;
    if (tagFileOffset < tagDataOffset || tagFileOffset + 64 > buffer.length) continue;

    if (entry.primaryClassName === 'bitmap' && resourceFiles.bitmaps) {
      const bCount = buffer.readInt32LE(tagFileOffset + 0x60);
      const bPtr = buffer.readUInt32LE(tagFileOffset + 0x64);
      if (bCount <= 0 || bCount > 256) continue;
      const arrRel = bPtr - base;
      const arrOffset = tagDataOffset + arrRel;
      if (arrOffset < tagDataOffset || arrOffset + bCount * 48 > buffer.length) continue;
      for (let i = 0; i < bCount; i++) {
        const elemRel = arrRel + i * 48;
        const elemOff = tagDataOffset + elemRel;
        const flags = buffer.readUInt16LE(elemOff + 14);
        if ((flags & 0x100) === 0) continue;
        const pixOff = buffer.readUInt32LE(elemOff + 24);
        const pixSize = buffer.readUInt32LE(elemOff + 28);
        if (pixSize <= 0 || pixOff + pixSize > resourceFiles.bitmaps.size) continue;
        const key = `bitm:${pixOff}:${pixSize}`;
        let chunkIdx = dedupe.get(key);
        if (chunkIdx === undefined) {
          const raw = Buffer.from(resourceFiles.bitmaps.read(pixOff, pixSize));
          const alignedLen = (raw.length + 3) & ~3;
          const padded = alignedLen === raw.length ? raw : Buffer.concat([raw, Buffer.alloc(alignedLen - raw.length)]);
          chunkIdx = chunks.length;
          chunkOffsets.push(tagDataOffset + totalInserted);
          chunks.push(padded);
          totalInserted += padded.length;
          dedupe.set(key, chunkIdx);
        }
        patches.push({
          tagDataRelativeOffset: elemRel + 24,
          flagTagDataRelativeOffset: elemRel + 14,
          flagWidth: 2,
          flagMask: 0x100,
          chunkIndex: chunkIdx,
        });
      }
    } else if (entry.primaryClassName === 'sound' && resourceFiles.sounds) {
      const prCount = buffer.readInt32LE(tagFileOffset + 0x98);
      const prPtr = buffer.readUInt32LE(tagFileOffset + 0x9c);
      if (prCount <= 0 || prCount > 64) continue;
      const prArrRel = prPtr - base;
      const prArrOff = tagDataOffset + prArrRel;
      if (prArrOff < tagDataOffset || prArrOff + prCount * 72 > buffer.length) continue;
      for (let p = 0; p < prCount; p++) {
        const prOff = prArrOff + p * 72;
        const permCount = buffer.readInt32LE(prOff + 0x38);
        const permPtr = buffer.readUInt32LE(prOff + 0x3c);
        if (permCount <= 0 || permCount > 256) continue;
        const permArrRel = permPtr - base;
        const permArrOff = tagDataOffset + permArrRel;
        if (permArrOff < tagDataOffset || permArrOff + permCount * 124 > buffer.length) continue;
        for (let m = 0; m < permCount; m++) {
          const permRel = permArrRel + m * 124;
          const permOff = tagDataOffset + permRel;
          const extFlag = buffer.readUInt32LE(permOff + 0x44);
          if ((extFlag & 1) === 0) continue;
          const sampleSize = buffer.readUInt32LE(permOff + 0x40);
          const sampleOff = buffer.readUInt32LE(permOff + 0x48);
          if (sampleSize <= 0 || sampleOff + sampleSize > resourceFiles.sounds.size) continue;
          const key = `snd!:${sampleOff}:${sampleSize}`;
          let chunkIdx = dedupe.get(key);
          if (chunkIdx === undefined) {
            const raw = Buffer.from(resourceFiles.sounds.read(sampleOff, sampleSize));
            const alignedLen = (raw.length + 3) & ~3;
            const padded = alignedLen === raw.length ? raw : Buffer.concat([raw, Buffer.alloc(alignedLen - raw.length)]);
            chunkIdx = chunks.length;
            chunkOffsets.push(tagDataOffset + totalInserted);
            chunks.push(padded);
            totalInserted += padded.length;
            dedupe.set(key, chunkIdx);
          }
          patches.push({
            tagDataRelativeOffset: permRel + 0x48,
            flagTagDataRelativeOffset: permRel + 0x44,
            flagWidth: 4,
            flagMask: 1,
            chunkIndex: chunkIdx,
          });
        }
      }
    }
  }

  if (patches.length === 0) return buffer;

  const newTagDataOffset = tagDataOffset + totalInserted;
  const out = Buffer.concat([
    buffer.subarray(0, tagDataOffset),
    ...chunks,
    buffer.subarray(tagDataOffset),
  ]);

  out.writeUInt32LE(out.length, 0x08);
  out.writeUInt32LE(newTagDataOffset, 0x10);

  for (const patch of patches) {
    const newFileOff = chunkOffsets[patch.chunkIndex];
    out.writeUInt32LE(newFileOff >>> 0, newTagDataOffset + patch.tagDataRelativeOffset);
    const flagOff = newTagDataOffset + patch.flagTagDataRelativeOffset;
    if (patch.flagWidth === 2) {
      out.writeUInt16LE(out.readUInt16LE(flagOff) & ~patch.flagMask, flagOff);
    } else {
      out.writeUInt32LE((out.readUInt32LE(flagOff) & ~patch.flagMask) >>> 0, flagOff);
    }
  }

  return out;
}

/**
 * Performs the BSP swap from source map into target map buffer in memory.
 */
export function performBspSwap(
  sourceBuffer: Buffer,
  targetBuffer: Buffer,
  options: BspSwapOptions,
): BspSwapResult {
  const sourceInspected = inspectCustomEditionMap(sourceBuffer);
  let targetInspected = inspectCustomEditionMap(targetBuffer);
  if (targetInspected.status !== 'ok') {
    return {
      ok: false,
      buffer: targetBuffer,
      summary: {
        sourceBspName: '',
        targetBspName: '',
        oldSize: targetBuffer.length,
        newSize: targetBuffer.length,
        delta: 0,
        strippedDobc: false,
        strippedDecals: false,
        relocatedSpawns: 0,
      },
      error: 'Failed to parse target map header or tag index.',
    };
  }

  const sourceBsps = getMapBsps(sourceBuffer);
  let targetBsps = getMapBsps(targetBuffer);

  const srcIdx = options.sourceBspIndex ?? 0;
  const dstIdx = options.targetBspIndex ?? 0;

  const srcIndices = options.sourceBspIndices && options.sourceBspIndices.length > 0
    ? options.sourceBspIndices
    : [srcIdx];

  const srcBsp = sourceBsps[srcIndices[0]];
  let dstBsp = targetBsps[dstIdx];

  if (!srcBsp) {
    return {
      ok: false,
      buffer: targetBuffer,
      summary: { sourceBspName: '', targetBspName: '', oldSize: targetBuffer.length, newSize: targetBuffer.length, delta: 0, strippedDobc: false, strippedDecals: false, relocatedSpawns: 0 },
      error: `Invalid source BSP index ${srcIdx}.`,
    };
  }

  if (!dstBsp) {
    return {
      ok: false,
      buffer: targetBuffer,
      summary: { sourceBspName: srcBsp.path, targetBspName: '', oldSize: targetBuffer.length, newSize: targetBuffer.length, delta: 0, strippedDobc: false, strippedDecals: false, relocatedSpawns: 0 },
      error: `Invalid target BSP index ${dstIdx}.`,
    };
  }

  // Determine whether this is a multi-BSP merge into 1 BSP or separate multiple BSPs, and the script mode.
  // When merging all selected BSPs into 1 combined BSP (`shouldMergeMultiBsp === true`), BSP 0 is natively
  // active in Halo CE at all times without needing any activation script.
  const shouldMergeMultiBsp = options.mergeMultipleBsps !== false;
  const effectiveScriptMode: 'none' | 'switch' | 'activate_all' = shouldMergeMultiBsp
    ? 'none'
    : options.bspScriptMode ??
      (options.addBspActivationScript ? 'switch' : srcIndices.length > 1 ? 'switch' : 'none');
  let srcBspData: Buffer;
  let srcBspSize: number;
  let srcBspAddress: number;
  let srcBspName: string;
  let srcWorldBounds: [number, number, number, number, number, number];
  let removedDuplicateTriangles = 0;
  let removedPortalBlockerTriangles = 0;
  let createdTriggerVolumes = 0;
  let donorLightmapTagIds: number[] = [];

  if (srcIndices.length > 1 && shouldMergeMultiBsp) {
    const useExpandedEngineLimits = options.useExpandedEngineLimits === true;
    const CE_TAG_SPACE_BYTES = useExpandedEngineLimits
      ? 122 * 1024 * 1024 // 122 MiB OpenCE extended tag/BSP cache (0x07A00000)
      : 23 * 1024 * 1024; // 23 MiB Standard Halo CE tag/BSP cache
    const safeMaxBspBytes = useExpandedEngineLimits
      ? Math.min(
          110 * 1024 * 1024,
          Math.max(16 * 1024 * 1024, CE_TAG_SPACE_BYTES - targetInspected.header.tagDataSize - 2 * 1024 * 1024),
        )
      : Math.min(
          15_500_000,
          Math.max(8 * 1024 * 1024, CE_TAG_SPACE_BYTES - targetInspected.header.tagDataSize - 4_500_000),
        );
    const merged = mergeStructureBsps(sourceBuffer, srcIndices, {
      removeOverlappingPortalCaps: options.removeOverlappingPortalCaps === true,
      removeBspEndBlockWalls: options.removeBspEndBlockWalls !== false,
      mergeLightmapPlates: options.harvestShaders !== false,
      maxBspBytes: safeMaxBspBytes,
      useExpandedEngineLimits,
    });
    srcBspData = merged.bspBuffer;
    srcBspSize = merged.bspSize;
    srcBspAddress = merged.bspAddress;
    srcBspName = merged.mergedBspNames.join(' + ');
    srcWorldBounds = merged.worldBounds;
    removedDuplicateTriangles = merged.removedDuplicateTriangles ?? 0;
    removedPortalBlockerTriangles = merged.removedPortalBlockerTriangles ?? 0;
    donorLightmapTagIds = merged.donorLightmapTagIds ?? [];
  } else {
    srcBspData = Buffer.from(sourceBuffer.subarray(srcBsp.bspStart, srcBsp.bspStart + srcBsp.bspSize));
    srcBspSize = srcBsp.bspSize;
    srcBspAddress = srcBsp.bspAddress;
    const CE_BSP_CACHE_CEILING =
      options.useExpandedEngineLimits === true &&
      (srcBspSize > 17_616_076 || targetInspected.header.tagDataSize + srcBspSize + 1_500_000 > 23 * 1024 * 1024)
        ? 0x47e40000
        : 0x41b40000;
    let rebasedAddr = srcBspAddress;
    if (srcBspAddress + srcBspSize > CE_BSP_CACHE_CEILING) {
      rebasedAddr = (CE_BSP_CACHE_CEILING - srcBspSize) & ~511;
    }
    rebaseStructureBspPointers(srcBspData, srcBspAddress, rebasedAddr);
    srcBspAddress = rebasedAddr;
    srcBspName =
      srcIndices.length > 1
        ? srcIndices.map((idx) => sourceBsps[idx]?.path || `bsp_${idx}`).join(', ')
        : srcBsp.path;
    srcWorldBounds = [...srcBsp.worldBounds] as [number, number, number, number, number, number];
    if (srcIndices.length > 1) {
      for (const bIdx of srcIndices.slice(1)) {
        const b = sourceBsps[bIdx];
        if (!b) continue;
        srcWorldBounds[0] = Math.min(srcWorldBounds[0], b.worldBounds[0]);
        srcWorldBounds[1] = Math.min(srcWorldBounds[1], b.worldBounds[1]);
        srcWorldBounds[2] = Math.min(srcWorldBounds[2], b.worldBounds[2]);
        srcWorldBounds[3] = Math.max(srcWorldBounds[3], b.worldBounds[3]);
        srcWorldBounds[4] = Math.max(srcWorldBounds[4], b.worldBounds[4]);
        srcWorldBounds[5] = Math.max(srcWorldBounds[5], b.worldBounds[5]);
      }
    }
  }

  // 1. Perform geometry swap FIRST so modelDataFileOffset and tagDataOffset are at their final positions.
  const delta = srcBspSize - dstBsp.bspSize;
  const newLength = targetBuffer.length + delta;
  let out: Buffer = Buffer.alloc(newLength);

  // Copy everything before target BSP
  targetBuffer.copy(out, 0, 0, dstBsp.bspStart);

  // Copy source BSP data (single or merged)
  srcBspData.copy(out, dstBsp.bspStart, 0, srcBspSize);

  // Copy everything after target BSP shifted by delta
  targetBuffer.copy(out, dstBsp.bspStart + srcBspSize, dstBsp.bspStart + dstBsp.bspSize);

  // Update Header decompressedFileSize & tagDataOffset
  const oldFileSize = targetBuffer.readUInt32LE(0x8);
  out.writeUInt32LE(oldFileSize + delta, 0x8);

  const oldTagDataOffset = targetBuffer.readUInt32LE(0x10);
  const newTagDataOffset = oldTagDataOffset + delta;
  out.writeUInt32LE(newTagDataOffset, 0x10);

  // Update tag data header modelDataFileOffset
  const oldModelDataOffset = targetBuffer.readUInt32LE(oldTagDataOffset + 0x14);
  out.writeUInt32LE(oldModelDataOffset + delta, newTagDataOffset + 0x14);

  // Update ScenarioBSP in target Scenario tag
  const { tagIndex } = targetInspected;
  const scnrEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scnrOffset = newTagDataOffset + (scnrEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
  const decodedScnr = decodeStruct(out, scnrOffset, 'Scenario');
  const bspsField = decodedScnr.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive') {
    return {
      ok: false,
      buffer: targetBuffer,
      summary: { sourceBspName: srcBsp.path, targetBspName: dstBsp.path, oldSize: targetBuffer.length, newSize: targetBuffer.length, delta: 0, strippedDobc: false, strippedDecals: false, relocatedSpawns: 0 },
      error: 'Target scenario structure bsps reflexive missing.',
    };
  }

  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspArrayOffset = newTagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);
  const targetEntryOffset = bspArrayOffset + dstIdx * scenarioBspSize;

  // Write new bsp_start, bsp_size, bsp_address
  out.writeUInt32LE(dstBsp.bspStart, targetEntryOffset + 0);
  out.writeUInt32LE(srcBspSize, targetEntryOffset + 4);
  out.writeUInt32LE(srcBspAddress, targetEntryOffset + 8);

  // Shift existing embedded raw data offsets if any pre-existed in target map
  shiftExistingRawDataOffsets(out, newTagDataOffset, tagIndex, dstBsp.bspStart + dstBsp.bspSize, delta);

  let reinspected = inspectCustomEditionMap(out);
  if (reinspected.status !== 'ok') {
    return {
      ok: false,
      buffer: targetBuffer,
      summary: { sourceBspName: srcBsp.path, targetBspName: dstBsp.path, oldSize: targetBuffer.length, newSize: targetBuffer.length, delta: 0, strippedDobc: false, strippedDecals: false, relocatedSpawns: 0 },
      error: 'Failed to inspect map after BSP copy.',
    };
  }

  // 2. Harvest Shaders & Bitmaps from source BSP into target map if requested
  let harvestedShaders = 0;
  let harvestedBitmaps = 0;
  let importedScenery = 0;
  let importedVehicles = 0;
  let importedMachines = 0;
  const tagIdMap = new Map<number, number>();
  const bspDeps: BspDependencyOccurrence[] = [];

  if (sourceInspected.status === 'ok') {
    for (const bIdx of srcIndices) {
      const curBsp = sourceBsps[bIdx];
      if (!curBsp) continue;
      const metaPointer = sourceBuffer.readUInt32LE(curBsp.bspStart + 0);
      const bspRootOffset = curBsp.bspStart + (metaPointer - curBsp.bspAddress);
      if (bspRootOffset >= curBsp.bspStart && bspRootOffset < curBsp.bspStart + curBsp.bspSize) {
        scanBspDependencies(
          sourceBuffer,
          'ScenarioStructureBSP',
          bspRootOffset,
          curBsp.bspStart,
          curBsp.bspSize,
          curBsp.bspAddress,
          bspDeps,
          new Set<number>(),
        );
      }
    }

    const shouldHarvestShaders = options.harvestShaders !== false;
    const shouldImportScenery =
      options.importScenery !== undefined
        ? Boolean(options.importScenery)
        : Boolean(options.importSceneryAndMachines);
    const shouldImportMachines =
      options.importMachines !== undefined
        ? Boolean(options.importMachines)
        : Boolean(options.importSceneryAndMachines);
    const shouldImportObjects = shouldImportScenery || shouldImportMachines;
    const shouldImportVehicles = Boolean(options.importVehicles);
    const srcTagIndex = sourceInspected.tagIndex;

    // Pre-populate tagIdMap for any donor tags that already exist by normalized path + group in the target map
    const existingTargetByKey = new Map<string, number>();
    for (const te of reinspected.tagIndex.entries) {
      if (te.path && te.primaryClassName) {
        existingTargetByKey.set(`${normalizeTagPath(te.path)}|${te.primaryClassName}`, te.tagId);
      }
    }
    for (const se of srcTagIndex.entries) {
      if (!se.path || !se.primaryClassName) continue;
      const existingId = existingTargetByKey.get(`${normalizeTagPath(se.path)}|${se.primaryClassName}`);
      if (existingId !== undefined) {
        tagIdMap.set(se.tagId, existingId);
        tagIdMap.set(se.index, existingId);
      }
    }
    let srcScnrOffset = 0;
    const srcScnrEntry = srcTagIndex.entries[srcTagIndex.scenarioTagId & 0xffff];
    if (srcScnrEntry) {
      srcScnrOffset = resolveTagDataPointer(
        srcScnrEntry.tagDataPointerOrResourceIndex,
        sourceInspected.header,
        srcTagIndex.baseMemoryAddress,
      );
    }

    if (
      (shouldHarvestShaders && bspDeps.length > 0) ||
      shouldImportObjects ||
      shouldImportVehicles ||
      Boolean(options.clearExistingPlacements) ||
      Boolean(options.clearPlayerSpawns)
    ) {
      const rootIndicesSet = new Set<number>();

      if (shouldHarvestShaders) {
        for (const dep of bspDeps) {
          const idx = dep.tagId & 0xffff;
          const entry = srcTagIndex.entries[idx];
          if (
            entry &&
            entry.tagId === dep.tagId &&
            entry.primaryClassName !== '' &&
            entry.primaryClassName !== 'sbsp' &&
            entry.primaryClassName !== 'scenario_structure_bsp' &&
            entry.primaryClassName !== 'scnr' &&
            entry.primaryClassName !== 'scenario'
          ) {
            rootIndicesSet.add(idx);
          }
        }
      }

      // Read donor Scenery, Vehicles & Machines info from Scenario tag
      let srcSceneryPalCount = 0;
      let srcSceneryPalOffset = 0;
      let srcPlacedSceneryCount = 0;
      let srcPlacedSceneryOffset = 0;

      let srcVehiclePalCount = 0;
      let srcVehiclePalOffset = 0;
      let srcPlacedVehiclesCount = 0;
      let srcPlacedVehiclesOffset = 0;

      let srcMachinePalCount = 0;
      let srcMachinePalOffset = 0;
      let srcPlacedMachinesCount = 0;
      let srcPlacedMachinesOffset = 0;

      const bspRootIndices = Array.from(rootIndicesSet);
      const scenRootSet = new Set<number>();
      const vehRootSet = new Set<number>();
      const machRootSet = new Set<number>();
      const doorMachRootSet = new Set<number>();

      const selectedBspBoundsForHarvest = srcIndices
        .map((idx) => sourceBsps[idx]?.worldBounds)
        .filter((b): b is [number, number, number, number, number, number] => Boolean(b));
      if (selectedBspBoundsForHarvest.length === 0) {
        selectedBspBoundsForHarvest.push(srcWorldBounds);
      }
      const isPosInSelectedBsps = (posX: number, posY: number, posZ: number, margin = 20.0): boolean =>
        !options.filterObjectsToBspBounds ||
        selectedBspBoundsForHarvest.some(
          ([bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ]) =>
            posX >= bMinX - margin &&
            posX <= bMaxX + margin &&
            posY >= bMinY - margin &&
            posY <= bMaxY + margin &&
            posZ >= bMinZ - margin &&
            posZ <= bMaxZ + margin,
        );

      if (shouldImportObjects || shouldImportVehicles) {
        if (srcScnrOffset > 0) {
          if (shouldImportScenery) {
            // Scenery palette (0x21c) and scenery placements (0x210)
            const scenPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x21c);
            srcSceneryPalCount = scenPalRefl.count;
            if (scenPalRefl.count > 0) {
              srcSceneryPalOffset = sourceInspected.header.tagDataOffset + (scenPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
            }
            const scenRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x210);
            srcPlacedSceneryCount = scenRefl.count;
            if (scenRefl.count > 0) {
              srcPlacedSceneryOffset = sourceInspected.header.tagDataOffset + (scenRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < scenRefl.count; i++) {
                const sOff = srcPlacedSceneryOffset + i * 72;
                const palIdx = sourceBuffer.readInt16LE(sOff + 0);
                if (palIdx < 0 || palIdx >= srcSceneryPalCount) continue;
                const posX = sourceBuffer.readFloatLE(sOff + 8);
                const posY = sourceBuffer.readFloatLE(sOff + 12);
                const posZ = sourceBuffer.readFloatLE(sOff + 16);
                if (!isPosInSelectedBsps(posX, posY, posZ)) continue;
                const tagId = sourceBuffer.readUInt32LE(srcSceneryPalOffset + palIdx * 48 + 12);
                if (tagId !== 0xffffffff && srcTagIndex.entries[tagId & 0xffff]?.tagId === tagId) {
                  scenRootSet.add(tagId & 0xffff);
                }
              }
            }
          }

          if (shouldImportVehicles) {
            // Vehicle palette (0x24c) and vehicle placements (0x240)
            const vehPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x24c);
            srcVehiclePalCount = vehPalRefl.count;
            if (vehPalRefl.count > 0) {
              srcVehiclePalOffset = sourceInspected.header.tagDataOffset + (vehPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
            }
            const vehRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x240);
            srcPlacedVehiclesCount = vehRefl.count;
            if (vehRefl.count > 0) {
              srcPlacedVehiclesOffset = sourceInspected.header.tagDataOffset + (vehRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < vehRefl.count; i++) {
                const vOff = srcPlacedVehiclesOffset + i * 120;
                const palIdx = sourceBuffer.readInt16LE(vOff + 0);
                const flags = sourceBuffer.readUInt16LE(vOff + 4);
                if (palIdx < 0 || palIdx >= srcVehiclePalCount) continue;
                const posX = sourceBuffer.readFloatLE(vOff + 8);
                const posY = sourceBuffer.readFloatLE(vOff + 12);
                const posZ = sourceBuffer.readFloatLE(vOff + 16);
                if (!isPosInSelectedBsps(posX, posY, posZ)) continue;
                const tagId = sourceBuffer.readUInt32LE(srcVehiclePalOffset + palIdx * 48 + 12);
                const vPath = srcTagIndex.entries[tagId & 0xffff]?.path ?? '';
                if ((flags & 1) !== 0 && /lifepod|c_dropship|pelican/i.test(vPath)) continue;
                if (tagId !== 0xffffffff && srcTagIndex.entries[tagId & 0xffff]?.tagId === tagId) {
                  vehRootSet.add(tagId & 0xffff);
                }
              }
            }
          }

          if (shouldImportMachines) {
            // Machine palette (0x2a0) and machine placements (0x294)
            const machPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x2a0);
            srcMachinePalCount = machPalRefl.count;
            if (machPalRefl.count > 0) {
              srcMachinePalOffset = sourceInspected.header.tagDataOffset + (machPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
            }
            const machRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x294);
            srcPlacedMachinesCount = machRefl.count;
            if (machRefl.count > 0) {
              srcPlacedMachinesOffset = sourceInspected.header.tagDataOffset + (machRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < machRefl.count; i++) {
                const mOff = srcPlacedMachinesOffset + i * 64;
                const palIdx = sourceBuffer.readInt16LE(mOff + 0);
                if (palIdx < 0 || palIdx >= srcMachinePalCount) continue;
                const posX = sourceBuffer.readFloatLE(mOff + 8);
                const posY = sourceBuffer.readFloatLE(mOff + 12);
                const posZ = sourceBuffer.readFloatLE(mOff + 16);
                if (!isPosInSelectedBsps(posX, posY, posZ)) continue;
                const tagId = sourceBuffer.readUInt32LE(srcMachinePalOffset + palIdx * 48 + 12);
                if (tagId !== 0xffffffff && srcTagIndex.entries[tagId & 0xffff]?.tagId === tagId) {
                  const mIdx = tagId & 0xffff;
                  machRootSet.add(mIdx);
                  const mPath = srcTagIndex.entries[mIdx]?.path ?? '';
                  if (/door|airlock|gate|shutter|hatch/i.test(mPath)) {
                    doorMachRootSet.add(mIdx);
                  }
                }
              }
            }
          }
        }
      }

      const candidateRootTiers: number[][] = [
        Array.from(new Set([...bspRootIndices, ...machRootSet, ...vehRootSet, ...scenRootSet])),
        Array.from(new Set([...bspRootIndices, ...doorMachRootSet, ...vehRootSet])),
        Array.from(new Set([...bspRootIndices, ...doorMachRootSet])),
        bspRootIndices,
      ].filter((tier, idx, arr) => tier.length > 0 && (idx === 0 || tier.length < arr[idx - 1].length));

      if (candidateRootTiers.length > 0) {
        try {
          let chosenContainer: ReturnType<typeof deserializeContainer> | null = null;
          let chosenPlan: InjectionPlan | null = null;

          for (const tierRoots of candidateRootTiers) {
            const extracted = extractTagSet(sourceBuffer, sourceInspected.header, srcTagIndex, tierRoots, {
              resourceFiles: options.resourceFiles,
            });
            if (extracted.tags.length === 0) continue;
            const containerBuf = serializeContainer(extracted, 'harvested_bsp_assets');
            const container = deserializeContainer(containerBuf);

            if (options.ceResourceFiles) {
              autoLinkExternalResourceMapsInContainer(container, options.ceResourceFiles);
            }
            if (options.resourceFiles) {
              hydrateExternalRawDataInContainer(container, options.resourceFiles);
            }

            const planResult = planAddInjection(
              { buffer: out, header: reinspected.header, tagIndex: reinspected.tagIndex },
              container,
              {},
              { allowEmbeddedRelocation: true, allowGbxmodelGeometryRelocation: true },
            );
            if (planResult.kind !== 'refused') {
              chosenContainer = container;
              chosenPlan = planResult as InjectionPlan;
              break;
            }
          }

          if (chosenContainer && chosenPlan) {
            const container = chosenContainer;
            const plan = chosenPlan;
            {
              out = applyAddInjection(
                out,
                reinspected.header,
                reinspected.tagIndex,
                container,
                plan,
                { allowEmbeddedRelocation: true, allowGbxmodelGeometryRelocation: true },
              );
              out = internalizeBrokenExternalBitmaps(out, options.resourceFiles);
              const afterInject = inspectCustomEditionMap(out);
              if (afterInject.status === 'ok') {
                reinspected = afterInject;
              }

              for (let i = 0; i < container.tags.length; i++) {
                const cTag = container.tags[i];
                if (cTag.group.startsWith('shader')) harvestedShaders++;
                if (cTag.group === 'bitmap') harvestedBitmaps++;

                const donorTagId = srcTagIndex.entries[cTag.originalIndex]?.tagId ?? (0xe1000000 | cTag.originalIndex);
                const targetTagId = plan.resolvedTagIdByLocalIndex.get(i);
                if (targetTagId !== undefined) {
                  tagIdMap.set(donorTagId, targetTagId);
                  tagIdMap.set(cTag.originalIndex, targetTagId);
                }
              }

              // If multiple BSPs were merged into 1 combined BSP, append the 48-byte BitmapData plates
              // from secondary BSPs' lightmap bitmap tags (k = 1..N-1) into Base BSP 0's lightmap bitmap tag
              // so every merged BSP's `ScenarioStructureBSPLightmap.bitmap` index resolves to its true lightmap texture!
              if (srcIndices.length > 1 && shouldMergeMultiBsp && donorLightmapTagIds.length > 1) {
                const targetLmTagId0 =
                  tagIdMap.get(donorLightmapTagIds[0]) ?? tagIdMap.get(donorLightmapTagIds[0] & 0xffff);
                if (targetLmTagId0 !== undefined && targetLmTagId0 !== 0xffffffff) {
                  const extraPlateBuffers: Buffer[] = [];
                  for (let k = 1; k < donorLightmapTagIds.length; k++) {
                    const dLmId = donorLightmapTagIds[k];
                    const tLmId = tagIdMap.get(dLmId) ?? tagIdMap.get(dLmId & 0xffff);
                    if (tLmId === undefined || tLmId === 0xffffffff) continue;
                    const tEntry = reinspected.tagIndex.entries[tLmId & 0xffff];
                    if (!tEntry || tEntry.isExternal) continue;
                    const bitmOff = resolveTagDataPointer(
                      tEntry.tagDataPointerOrResourceIndex,
                      reinspected.header,
                      reinspected.tagIndex.baseMemoryAddress,
                    );
                    if (bitmOff < 0 || bitmOff + 0x6c > out.length) continue;
                    const bdCount = out.readUInt32LE(bitmOff + 0x60);
                    const bdPtr = out.readUInt32LE(bitmOff + 0x64);
                    if (bdCount <= 0 || bdPtr === 0) continue;
                    const bdArrOff = resolvePointer(
                      bdPtr,
                      reinspected.header.tagDataOffset,
                      reinspected.tagIndex.baseMemoryAddress,
                    );
                    if (bdArrOff < 0 || bdArrOff + bdCount * 48 > out.length) continue;
                    for (let p = 0; p < bdCount; p++) {
                      const plateBuf = Buffer.alloc(48);
                      out.copy(plateBuf, 0, bdArrOff + p * 48, bdArrOff + (p + 1) * 48);
                      plateBuf.writeUInt32LE(targetLmTagId0 >>> 0, 0x20); // update owner bitmap_tag_id to base lightmap tag
                      extraPlateBuffers.push(plateBuf);
                    }
                    // Clear secondary lightmap tag's bitmap_data reflexive count so pixel offsets are never double-shifted
                    out.writeUInt32LE(0, bitmOff + 0x60);
                    out.writeUInt32LE(0, bitmOff + 0x64);
                  }
                  if (extraPlateBuffers.length > 0) {
                    const entry0 = reinspected.tagIndex.entries[targetLmTagId0 & 0xffff];
                    if (entry0 && !entry0.isExternal) {
                      const bitm0Off = resolveTagDataPointer(
                        entry0.tagDataPointerOrResourceIndex,
                        reinspected.header,
                        reinspected.tagIndex.baseMemoryAddress,
                      );
                      const lmAppendRes = appendReflexiveElements(
                        out,
                        reinspected.header,
                        reinspected.tagIndex,
                        bitm0Off + 0x60,
                        Buffer.concat(extraPlateBuffers),
                        extraPlateBuffers.length,
                      );
                      out = lmAppendRes.buffer;
                      reinspected.header = lmAppendRes.header;
                      const afterLmMerge = inspectCustomEditionMap(out);
                      if (afterLmMerge.status === 'ok') reinspected = afterLmMerge;
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn('[bsp-swapper] harvest catch:', err);
        }
      }

      // Optionally clear existing placements from target map (scenery, vehicles, equipment, weapons, etc.)
      // Do NOT clear 0x378 (netgame flags) here unless clearPlayerSpawns is also enabled, so CTF/Oddball/KOTH/Race flags remain valid.
      if (options.clearExistingPlacements) {
        const targetScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
        if (targetScnrEntry) {
          const curScnrOff = resolveTagDataPointer(
            targetScnrEntry.tagDataPointerOrResourceIndex,
            reinspected.header,
            reinspected.tagIndex.baseMemoryAddress,
          );
          const clearOffsets = [0x210, 0x228, 0x240, 0x258, 0x270, 0x294, 0x2ac, 0x2c4, 0x2dc, 0x360, 0x384, 0x3a8, 0x42c];
          for (const off of clearOffsets) {
            out.writeUInt32LE(0, curScnrOff + off);
            out.writeUInt32LE(0, curScnrOff + off + 4);
          }
        }
      }

      // Optionally clear player starting locations & profiles from target map
      if (options.clearPlayerSpawns) {
        const targetScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
        if (targetScnrEntry) {
          const curScnrOff = resolveTagDataPointer(
            targetScnrEntry.tagDataPointerOrResourceIndex,
            reinspected.header,
            reinspected.tagIndex.baseMemoryAddress,
          );
          const spawnClearOffsets = [0x348, 0x354, 0x378, 0x390];
          for (const off of spawnClearOffsets) {
            out.writeUInt32LE(0, curScnrOff + off);
            out.writeUInt32LE(0, curScnrOff + off + 4);
          }
        }
      }

      // Import donor player starting locations (or ensure at least 8 valid spawns: 4 Team 0 + 4 Team 1 in new BSP)
      const targetScnrEntryForSpawns = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
      if (targetScnrEntryForSpawns) {
        let curScnrOff = resolveTagDataPointer(
          targetScnrEntryForSpawns.tagDataPointerOrResourceIndex,
          reinspected.header,
          reinspected.tagIndex.baseMemoryAddress,
        );
        const curSpawnsCount = out.readUInt32LE(curScnrOff + 0x354);

        if (options.clearPlayerSpawns || curSpawnsCount === 0) {
          const importedSpawns: Buffer[] = [];
          const [minX, minY, minZ, maxX, maxY] = srcWorldBounds;

          if (srcScnrOffset > 0) {
            const donorPslRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x354);
            if (donorPslRefl.count > 0) {
              const donorPslOffset = resolvePointer(
                donorPslRefl.pointerLow,
                sourceInspected.header.tagDataOffset,
                srcTagIndex.baseMemoryAddress,
              );
              for (let i = 0; i < donorPslRefl.count; i++) {
                const sOff = donorPslOffset + i * 52;
                const donorBspIdx = sourceBuffer.readInt16LE(sOff + 18);
                const matchesBsp = srcIndices.includes(donorBspIdx) || sourceBsps.length <= 1;
                if (matchesBsp) {
                  const spawnBuf = Buffer.alloc(52);
                  sourceBuffer.copy(spawnBuf, 0, sOff, sOff + 52);
                  // Normalize team_index (+16) to 0 (Red/FFA) or 1 (Blue) so Campaign spawns (which often have team=100) never cause MP blue-screen
                  spawnBuf.writeInt16LE(importedSpawns.length % 2, 16);
                  spawnBuf.writeInt16LE(dstIdx, 18); // Map to target BSP index
                  spawnBuf.writeInt16LE(12, 20); // type 0 = 12 (all games) so spawns work in all MP & SP modes
                  importedSpawns.push(spawnBuf);
                }
              }
            }
          }

          if (importedSpawns.length === 0) {
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;
            const groundZ = minZ + 1.0;
            for (let s = 0; s < 8; s++) {
              const fallback = Buffer.alloc(52);
              const team = s % 2;
              const idxInTeam = Math.floor(s / 2);
              fallback.writeFloatLE(midX + (team === 0 ? -4.0 : 4.0) + (idxInTeam % 2) * 1.5, 0);
              fallback.writeFloatLE(midY + Math.floor(idxInTeam / 2) * 1.5, 4);
              fallback.writeFloatLE(groundZ, 8);
              fallback.writeFloatLE(team === 0 ? 0 : Math.PI, 12); // facing
              fallback.writeInt16LE(team, 16); // team 0 and team 1
              fallback.writeInt16LE(dstIdx, 18); // bsp index
              fallback.writeInt16LE(12, 20); // type 0 = 12 (all games)
              importedSpawns.push(fallback);
            }
          } else {
            // Ensure at least 8 spawns (4 Team 0 Red + 4 Team 1 Blue) for full Multiplayer compatibility
            const offsets: Array<[number, number]> = [
              [1.2, 0.0],
              [-1.2, 0.0],
              [0.0, 1.2],
              [0.0, -1.2],
              [1.2, 1.2],
              [-1.2, -1.2],
            ];
            let nextIdx = 0;
            while (importedSpawns.length < 8) {
              const baseSpawn = importedSpawns[nextIdx % importedSpawns.length];
              const clone = Buffer.from(baseSpawn);
              const [dx, dy] = offsets[nextIdx % offsets.length];
              const team = importedSpawns.length % 2;
              clone.writeFloatLE(baseSpawn.readFloatLE(0) + dx + (team === 1 ? 2.5 : 0), 0);
              clone.writeFloatLE(baseSpawn.readFloatLE(4) + dy, 4);
              clone.writeInt16LE(team, 16);
              clone.writeInt16LE(dstIdx, 18);
              clone.writeInt16LE(12, 20);
              importedSpawns.push(clone);
              nextIdx++;
            }
          }

          if (importedSpawns.length > 0) {
            const appendRes = appendReflexiveElements(
              out,
              reinspected.header,
              reinspected.tagIndex,
              curScnrOff + 0x354,
              Buffer.concat(importedSpawns),
              importedSpawns.length,
            );
            out = appendRes.buffer;
            reinspected.header = appendRes.header;
            curScnrOff = resolveTagDataPointer(
              targetScnrEntryForSpawns.tagDataPointerOrResourceIndex,
              reinspected.header,
              reinspected.tagIndex.baseMemoryAddress,
            );
          }
        }

        // Ensure multiplayer netgame flags (0x378) has valid CTF (Red=0, Blue=1), Oddball, KOTH, and Race flags
        const netgameFlagsCount = out.readUInt32LE(curScnrOff + 0x378);
        if (netgameFlagsCount === 0) {
          const pslRefl = decodeReflexive(out, curScnrOff + 0x354);
          let redX = (srcWorldBounds[0] + srcWorldBounds[3]) / 2 - 4.0;
          let redY = (srcWorldBounds[1] + srcWorldBounds[4]) / 2;
          let redZ = srcWorldBounds[2] + 0.5;
          let blueX = (srcWorldBounds[0] + srcWorldBounds[3]) / 2 + 4.0;
          let blueY = redY;
          let blueZ = redZ;
          if (pslRefl.count > 0) {
            const pslOff = resolvePointer(
              pslRefl.pointerLow,
              reinspected.header.tagDataOffset,
              reinspected.tagIndex.baseMemoryAddress,
            );
            redX = out.readFloatLE(pslOff + 0) + 1.5;
            redY = out.readFloatLE(pslOff + 4);
            redZ = out.readFloatLE(pslOff + 8);
            const secondIdx = pslRefl.count > 1 ? 1 : 0;
            const bOff = pslOff + secondIdx * 52;
            blueX = out.readFloatLE(bOff + 0) - 1.5;
            blueY = out.readFloatLE(bOff + 4) + (secondIdx === 0 ? 4.0 : 0);
            blueZ = out.readFloatLE(bOff + 8);
            if (Math.hypot(blueX - redX, blueY - redY) < 2.0) {
              blueX = redX + 4.0;
            }
          }
          const midX = (redX + blueX) / 2;
          const midY = (redY + blueY) / 2;
          const midZ = (redZ + blueZ) / 2;
          const makeNetgameFlag = (x: number, y: number, z: number, type: number, team: number): Buffer => {
            const flag = Buffer.alloc(148);
            flag.writeFloatLE(x, 0);
            flag.writeFloatLE(y, 4);
            flag.writeFloatLE(z, 8);
            flag.writeFloatLE(0, 12);
            flag.writeInt16LE(type, 16);
            flag.writeInt16LE(team, 18);
            return flag;
          };
          const generatedFlags: Buffer[] = [
            makeNetgameFlag(redX, redY, redZ, 0, 0), // CTF Flag - Red Team (0)
            makeNetgameFlag(blueX, blueY, blueZ, 0, 1), // CTF Flag - Blue Team (1)
            makeNetgameFlag(midX, midY, midZ, 2, 0), // Oddball Spawn (type 2, team 0)
            makeNetgameFlag(midX - 2.0, midY - 2.0, midZ, 3, 0), // Hill Flag 0
            makeNetgameFlag(midX + 2.0, midY - 2.0, midZ, 3, 0), // Hill Flag 1
            makeNetgameFlag(midX + 2.0, midY + 2.0, midZ, 3, 0), // Hill Flag 2
            makeNetgameFlag(midX - 2.0, midY + 2.0, midZ, 3, 0), // Hill Flag 3
            makeNetgameFlag(redX, redY, redZ, 4, 0), // Race Track 0
            makeNetgameFlag(blueX, blueY, blueZ, 4, 1), // Race Track 1
          ];
          const flagRes = appendReflexiveElements(
            out,
            reinspected.header,
            reinspected.tagIndex,
            curScnrOff + 0x378,
            Buffer.concat(generatedFlags),
            generatedFlags.length,
          );
          out = flagRes.buffer;
          reinspected.header = flagRes.header;
        }
      }

      // Import Scenery, Vehicles, and Doors into target scenario
      if (shouldImportObjects || shouldImportVehicles) {
        const targetScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
        if (targetScnrEntry) {
          const selectedBspBoundsList = srcIndices
            .map((idx) => sourceBsps[idx]?.worldBounds)
            .filter((b): b is [number, number, number, number, number, number] => Boolean(b));
          if (selectedBspBoundsList.length === 0) {
            selectedBspBoundsList.push(srcWorldBounds);
          }
          const isWithinSelectedBspBounds = (posX: number, posY: number, posZ: number, margin = 20.0): boolean =>
            selectedBspBoundsList.some(
              ([bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ]) =>
                posX >= bMinX - margin &&
                posX <= bMaxX + margin &&
                posY >= bMinY - margin &&
                posY <= bMaxY + margin &&
                posZ >= bMinZ - margin &&
                posZ <= bMaxZ + margin,
            );

          // 1. Scenery Palette & Placed Scenery
          if (shouldImportScenery && srcSceneryPalCount > 0 && srcPlacedSceneryCount > 0) {
            const donorToTargetScenPal = new Map<number, number>();
            for (let i = 0; i < srcSceneryPalCount; i++) {
              const entryOff = srcSceneryPalOffset + i * 48;
              const donorTagId = sourceBuffer.readUInt32LE(entryOff + 12);
              const targetTagId = tagIdMap.get(donorTagId) ?? tagIdMap.get(donorTagId & 0xffff);
              if (targetTagId !== undefined && targetTagId !== 0xffffffff) {
                const palRes = ensurePaletteEntry(
                  out,
                  reinspected.header,
                  reinspected.tagIndex,
                  'scenery palette',
                  'ScenarioSceneryPalette',
                  targetTagId,
                  0x7363656e, // 'scen'
                );
                out = palRes.buffer;
                reinspected.header = palRes.header;
                donorToTargetScenPal.set(i, palRes.paletteIndex);
              }
            }

            const validPlaced: Buffer[] = [];
            const seenScenKeys = new Set<string>();
            for (let i = 0; i < srcPlacedSceneryCount; i++) {
              const sOff = srcPlacedSceneryOffset + i * 72;
              const donorPalIdx = sourceBuffer.readInt16LE(sOff + 0);
              const targetPalIdx = donorToTargetScenPal.get(donorPalIdx);
              if (targetPalIdx !== undefined) {
                const posX = sourceBuffer.readFloatLE(sOff + 8);
                const posY = sourceBuffer.readFloatLE(sOff + 12);
                const posZ = sourceBuffer.readFloatLE(sOff + 16);
                if (options.filterObjectsToBspBounds && !isWithinSelectedBspBounds(posX, posY, posZ, 20.0)) {
                  continue;
                }
                const dedupeKey = `${targetPalIdx}:${Math.round(posX * 10)}:${Math.round(posY * 10)}:${Math.round(posZ * 10)}`;
                if (seenScenKeys.has(dedupeKey)) continue;
                seenScenKeys.add(dedupeKey);

                const sBytes = Buffer.alloc(72);
                sourceBuffer.copy(sBytes, 0, sOff, sOff + 72);
                sBytes.writeInt16LE(targetPalIdx, 0);
                sBytes.writeInt16LE(-1, 2);
                sBytes.writeUInt16LE(0, 4); // not placed = 0 (spawn immediately)
                sBytes.writeUInt16LE(0, 30); // bsp policy = 0 (auto from leaves)
                sBytes.writeUInt16LE(0, 32); // manual bsp flags = 0
                validPlaced.push(sBytes);
              }
            }

            if (validPlaced.length > 0) {
              // In multi-BSP merge mode, cap imported scenery to 600 items so Cluster 0's active object pool never overflows
              const cappedScenery =
                srcIndices.length > 1 && shouldMergeMultiBsp && validPlaced.length > 600
                  ? validPlaced.slice(0, 600)
                  : validPlaced;
              const curScnrOff = resolveTagDataPointer(
                targetScnrEntry.tagDataPointerOrResourceIndex,
                reinspected.header,
                reinspected.tagIndex.baseMemoryAddress,
              );
              const appendRes = appendReflexiveElements(
                out,
                reinspected.header,
                reinspected.tagIndex,
                curScnrOff + 0x210,
                Buffer.concat(cappedScenery),
                cappedScenery.length,
              );
              out = appendRes.buffer;
              reinspected.header = appendRes.header;
              importedScenery = cappedScenery.length;
            }
          }

          // 2. Vehicle Palette & Placed Vehicles
          if (shouldImportVehicles && srcVehiclePalCount > 0 && srcPlacedVehiclesCount > 0) {
            const donorToTargetVehPal = new Map<number, number>();
            const donorVehIsScriptedDropship = new Set<number>();
            for (let i = 0; i < srcVehiclePalCount; i++) {
              const entryOff = srcVehiclePalOffset + i * 48;
              const donorTagId = sourceBuffer.readUInt32LE(entryOff + 12);
              const donorPath = srcTagIndex.entries[donorTagId & 0xffff]?.path ?? '';
              if (/lifepod|c_dropship|pelican/i.test(donorPath)) {
                donorVehIsScriptedDropship.add(i);
              }
              const targetTagId = tagIdMap.get(donorTagId) ?? tagIdMap.get(donorTagId & 0xffff);
              if (targetTagId !== undefined && targetTagId !== 0xffffffff) {
                const palRes = ensurePaletteEntry(
                  out,
                  reinspected.header,
                  reinspected.tagIndex,
                  'vehicle palette',
                  'ScenarioVehiclePalette',
                  targetTagId,
                  0x76656869, // 'vehi'
                );
                out = palRes.buffer;
                reinspected.header = palRes.header;
                donorToTargetVehPal.set(i, palRes.paletteIndex);
              }
            }

            const validVehPlaced: Buffer[] = [];
            const seenVehKeys = new Set<string>();
            for (let i = 0; i < srcPlacedVehiclesCount; i++) {
              const vOff = srcPlacedVehiclesOffset + i * 120;
              const donorPalIdx = sourceBuffer.readInt16LE(vOff + 0);
              const donorFlags = sourceBuffer.readUInt16LE(vOff + 4);
              // Skip non-placed scripted campaign dropships/lifepods (`not placed automatically` flag bit 0)
              if ((donorFlags & 1) !== 0 && donorVehIsScriptedDropship.has(donorPalIdx)) {
                continue;
              }
              const targetPalIdx = donorToTargetVehPal.get(donorPalIdx);
              if (targetPalIdx !== undefined) {
                const posX = sourceBuffer.readFloatLE(vOff + 8);
                const posY = sourceBuffer.readFloatLE(vOff + 12);
                const posZ = sourceBuffer.readFloatLE(vOff + 16);
                if (options.filterObjectsToBspBounds && !isWithinSelectedBspBounds(posX, posY, posZ, 20.0)) {
                  continue;
                }
                const dedupeKey = `${targetPalIdx}:${Math.round(posX * 10)}:${Math.round(posY * 10)}:${Math.round(posZ * 10)}`;
                if (seenVehKeys.has(dedupeKey)) continue;
                seenVehKeys.add(dedupeKey);

                const vBytes = Buffer.alloc(120);
                sourceBuffer.copy(vBytes, 0, vOff, vOff + 120);
                vBytes.writeInt16LE(targetPalIdx, 0);
                vBytes.writeInt16LE(-1, 2);
                vBytes.writeUInt16LE(0, 4); // not placed = 0 (spawn immediately)
                vBytes.writeUInt16LE(0, 30); // bsp policy = 0
                vBytes.writeUInt16LE(0, 32); // manual bsp flags = 0
                vBytes.writeUInt16LE(0x0f0f, 90); // multiplayer spawn flags = all gametypes
                validVehPlaced.push(vBytes);
              }
            }

            if (validVehPlaced.length > 0) {
              const curScnrOff = resolveTagDataPointer(
                targetScnrEntry.tagDataPointerOrResourceIndex,
                reinspected.header,
                reinspected.tagIndex.baseMemoryAddress,
              );
              const appendRes = appendReflexiveElements(
                out,
                reinspected.header,
                reinspected.tagIndex,
                curScnrOff + 0x240,
                Buffer.concat(validVehPlaced),
                validVehPlaced.length,
              );
              out = appendRes.buffer;
              reinspected.header = appendRes.header;
              importedVehicles = validVehPlaced.length;
            }
          }

          // 3. Machine Palette & Placed Machines (Doors, Bridges)
          if (shouldImportMachines && srcMachinePalCount > 0 && srcPlacedMachinesCount > 0) {
            const donorToTargetMachPal = new Map<number, number>();
            const makeAutomatic = options.makeDoorsAutomatic !== false;
            for (let i = 0; i < srcMachinePalCount; i++) {
              const entryOff = srcMachinePalOffset + i * 48;
              const donorTagId = sourceBuffer.readUInt32LE(entryOff + 12);
              const targetTagId = tagIdMap.get(donorTagId) ?? tagIdMap.get(donorTagId & 0xffff);
              if (targetTagId !== undefined && targetTagId !== 0xffffffff) {
                const palRes = ensurePaletteEntry(
                  out,
                  reinspected.header,
                  reinspected.tagIndex,
                  'machine palette',
                  'ScenarioMachinePalette',
                  targetTagId,
                  0x6d616368, // 'mach'
                );
                out = palRes.buffer;
                reinspected.header = palRes.header;
                donorToTargetMachPal.set(i, palRes.paletteIndex);

                // Ensure harvested door device_machine tags have machine_type = 0 (door), automatic_activation_radius >= 2.25,
                // positive door_open_time, and responsive position velocity/acceleration for proximity operation in OpenCE
                if (makeAutomatic) {
                  const machEntry = reinspected.tagIndex.entries[targetTagId & 0xffff];
                  if (machEntry && !machEntry.isExternal) {
                    try {
                      const machOff = resolveTagDataPointer(
                        machEntry.tagDataPointerOrResourceIndex,
                        reinspected.header,
                        reinspected.tagIndex.baseMemoryAddress,
                      );
                      const lowerPath = machEntry.path.toLowerCase();
                      const isDoorLike =
                        /door|airlock|gate|shutter|hatch/i.test(lowerPath) &&
                        !/closed|half|bashed|holo|casket|display|light|button|switch/i.test(lowerPath);
                      const hasAnimGraph =
                        machOff >= 0 &&
                        machOff + 804 <= out.length &&
                        out.readUInt32LE(machOff + 56 + 12) !== 0xffffffff;
                      if (machOff >= 0 && machOff + 804 <= out.length && (isDoorLike || out.readInt16LE(machOff + 656) === 0)) {
                        if (hasAnimGraph) {
                          out.writeInt16LE(0, machOff + 656); // machine type = 0 (_machine_type_door)
                          const curRad = out.readFloatLE(machOff + 540);
                          if (!(curRad >= 2.25)) {
                            out.writeFloatLE(2.25, machOff + 540); // automatic activation radius
                          }
                          const posTrans = out.readFloatLE(machOff + 392);
                          const rtPosVel = out.readFloatLE(machOff + 648);
                          if (!(posTrans >= 0.1 && posTrans <= 2.5) || !(rtPosVel >= 0.013)) {
                            out.writeFloatLE(0.65, machOff + 392); // position transition time (s)
                            out.writeFloatLE(0.15, machOff + 396); // position acceleration time (s)
                            out.writeFloatLE(0.2222222, machOff + 644); // runtime max powered position acceleration
                            out.writeFloatLE(1.0 / (0.65 * 30.0), machOff + 648); // runtime max powered position velocity
                          }
                          if (!(out.readFloatLE(machOff + 632) > 0)) {
                            out.writeFloatLE(1.0, machOff + 628);
                            out.writeFloatLE(1.0, machOff + 632);
                          }
                        }
                        const openTime = out.readFloatLE(machOff + 660);
                        if (!(openTime >= 3.0)) {
                          out.writeFloatLE(3.0, machOff + 660);
                          out.writeUInt32LE(90, machOff + 800);
                        }
                      }
                    } catch {
                      // non-fatal
                    }
                  }
                }
              }
            }

            // Ensure a powered ScenarioDeviceGroup (initial value = 1.0) exists so imported doors have power in-game
            let powerGroupIdx = -1;
            if (makeAutomatic) {
              const scnrOffForDg = resolveTagDataPointer(
                targetScnrEntry.tagDataPointerOrResourceIndex,
                reinspected.header,
                reinspected.tagIndex.baseMemoryAddress,
              );
              const scnrDef = resolveStruct('Scenario');
              const dgField = scnrDef.fields.find((f) => f.name === 'device groups');
              if (dgField) {
                const dgReflOff = scnrOffForDg + dgField.offset;
                const dgRefl = decodeReflexive(out, dgReflOff);
                if (dgRefl.count > 0) {
                  const dgBase = resolvePointer(dgRefl.pointerLow, reinspected.header.tagDataOffset, reinspected.tagIndex.baseMemoryAddress);
                  for (let i = 0; i < dgRefl.count; i++) {
                    if (out.readFloatLE(dgBase + i * 52 + 32) >= 0.99) {
                      powerGroupIdx = i;
                      break;
                    }
                  }
                }
                if (powerGroupIdx < 0) {
                  const dgBytes = Buffer.alloc(52, 0);
                  dgBytes.write('auto_door_power', 0, 'ascii');
                  dgBytes.writeFloatLE(1.0, 32);
                  const dgApp = appendReflexiveElements(out, reinspected.header, reinspected.tagIndex, dgReflOff, dgBytes, 1);
                  out = dgApp.buffer;
                  reinspected.header = dgApp.header;
                  powerGroupIdx = dgApp.startIndex;
                }
              }
            }

            const validMachPlaced: Buffer[] = [];
            const seenMachKeys = new Set<string>();
            for (let i = 0; i < srcPlacedMachinesCount; i++) {
              const mOff = srcPlacedMachinesOffset + i * 64;
              const donorPalIdx = sourceBuffer.readInt16LE(mOff + 0);
              const targetPalIdx = donorToTargetMachPal.get(donorPalIdx);
              if (targetPalIdx !== undefined) {
                const posX = sourceBuffer.readFloatLE(mOff + 8);
                const posY = sourceBuffer.readFloatLE(mOff + 12);
                const posZ = sourceBuffer.readFloatLE(mOff + 16);
                if (options.filterObjectsToBspBounds && !isWithinSelectedBspBounds(posX, posY, posZ, 20.0)) {
                  continue;
                }
                const dedupeKey = `${targetPalIdx}:${Math.round(posX * 10)}:${Math.round(posY * 10)}:${Math.round(posZ * 10)}`;
                if (seenMachKeys.has(dedupeKey)) continue;
                seenMachKeys.add(dedupeKey);

                const mBytes = Buffer.alloc(64);
                sourceBuffer.copy(mBytes, 0, mOff, mOff + 64);
                mBytes.writeInt16LE(targetPalIdx, 0);
                mBytes.writeInt16LE(-1, 2);
                mBytes.writeUInt16LE(0, 4); // not placed = 0 (spawn immediately)
                mBytes.writeUInt16LE(0, 30); // bsp policy = 0
                mBytes.writeUInt16LE(0, 32); // manual bsp flags = 0
                mBytes.writeInt16LE(makeAutomatic ? powerGroupIdx : -1, 40);
                mBytes.writeInt16LE(-1, 42);
                if (makeAutomatic) {
                  mBytes.writeUInt32LE(0, 44); // device flags = 0 (powered & ready)
                  mBytes.writeUInt32LE(4, 48); // machine flags = 4 (never appears locked, operates automatically)
                }
                validMachPlaced.push(mBytes);
              }
            }

            if (validMachPlaced.length > 0) {
              const curScnrOff = resolveTagDataPointer(
                targetScnrEntry.tagDataPointerOrResourceIndex,
                reinspected.header,
                reinspected.tagIndex.baseMemoryAddress,
              );
              const appendRes = appendReflexiveElements(
                out,
                reinspected.header,
                reinspected.tagIndex,
                curScnrOff + 0x294,
                Buffer.concat(validMachPlaced),
                validMachPlaced.length,
              );
              out = appendRes.buffer;
              reinspected.header = appendRes.header;
              importedMachines = validMachPlaced.length;
            }
          }

          const finalRe = inspectCustomEditionMap(out);
          if (finalRe.status === 'ok') {
            reinspected = finalRe;
          }
        }
      }
    }
  }

  // 3. Rename scenario in header if requested
  if (options.newScenarioName && options.newScenarioName.trim().length > 0) {
    const nameStr = options.newScenarioName.trim().slice(0, 31);
    const nameBuf = Buffer.alloc(32);
    nameBuf.write(nameStr, 'ascii');
    nameBuf.copy(out, 0x20);
  }

  // 4. Rewrite TagDependency tagId fields directly in the swapped/merged BSP
  const metaPointer = out.readUInt32LE(dstBsp.bspStart + 0);
  const bspRootOffset = dstBsp.bspStart + (metaPointer - srcBspAddress);
  if (bspRootOffset >= dstBsp.bspStart && bspRootOffset < dstBsp.bspStart + srcBspSize) {
    rewriteBspDependencies(
      out,
      'ScenarioStructureBSP',
      bspRootOffset,
      dstBsp.bspStart,
      srcBspSize,
      srcBspAddress,
      tagIdMap,
      new Set<number>(),
      reinspected.header.tagDataOffset,
    );
  }

  // 5. Strip DOBC & Decals if requested
  let strippedDobc = false;
  let strippedDecals = false;
  const shouldStripDobc = options.stripDobc !== undefined ? options.stripDobc : (options.stripDobcAndDecals ?? true);
  const shouldStripDecals = options.stripDecals !== undefined ? options.stripDecals : (options.stripDobcAndDecals ?? true);

  const bspRootFileOffset = dstBsp.bspStart + (metaPointer - srcBspAddress);
  if (bspRootFileOffset >= dstBsp.bspStart && bspRootFileOffset + 0x260 <= dstBsp.bspStart + srcBspSize) {
    if (shouldStripDobc) {
      // detail objects reflexive at 0x24c: count = 0, pointerLow = 0
      out.writeUInt32LE(0, bspRootFileOffset + 0x24c);
      out.writeUInt32LE(0, bspRootFileOffset + 0x250);
      strippedDobc = true;
    }

    if (shouldStripDecals) {
      // runtime decals reflexive at 0x258: count = 0, pointerLow = 0
      out.writeUInt32LE(0, bspRootFileOffset + 0x258);
      out.writeUInt32LE(0, bspRootFileOffset + 0x25c);
      // Also reset first_runtime_decal_index = -1 and runtime_decal_count = 0 on all clusters (at root + 0x134)
      const clCount = out.readUInt32LE(bspRootFileOffset + 0x134);
      const clPtr = out.readUInt32LE(bspRootFileOffset + 0x138);
      const clBase = dstBsp.bspStart + (clPtr - srcBspAddress);
      if (clCount > 0 && clBase >= dstBsp.bspStart && clBase + clCount * 104 <= dstBsp.bspStart + srcBspSize) {
        for (let c = 0; c < clCount; c++) {
          out.writeInt16LE(-1, clBase + c * 104 + 0x0c);
          out.writeInt16LE(0, clBase + c * 104 + 0x0e);
        }
      }
      strippedDecals = true;
    }
  }

  // 6. Relocate player spawns and netgame equipment if requested
  let relocatedSpawns = 0;
  if (options.relocateGroundObjects ?? true) {
    // Use the first BSP's bounds in separate multi-BSP mode so spawns sit inside BSP #0 on startup
    const spawnBounds = srcIndices.length > 1 && !shouldMergeMultiBsp ? srcBsp.worldBounds : srcWorldBounds;
    const minX = spawnBounds[0];
    const minY = spawnBounds[1];
    const minZ = spawnBounds[2];
    const maxX = spawnBounds[3];
    const maxY = spawnBounds[4];
    const maxZ = spawnBounds[5];
    const defaultGroundZ = minZ + 0.5;

    const latestTagDataOffset = reinspected.header.tagDataOffset;
    const latestBaseAddr = reinspected.tagIndex.baseMemoryAddress;
    const latestScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
    const latestScnrOffset = latestTagDataOffset + (latestScnrEntry.tagDataPointerOrResourceIndex - latestBaseAddr);
    const latestDecodedScnr = decodeStruct(out, latestScnrOffset, 'Scenario');

    // Player starting locations at 0x354
    const spawnsReflexive = latestDecodedScnr.get('player starting locations');
    if (spawnsReflexive && spawnsReflexive.kind === 'reflexive' && spawnsReflexive.value.count > 0) {
      const spawnSize = 52;
      const spawnsOffset = latestTagDataOffset + (spawnsReflexive.value.pointerLow - latestBaseAddr);
      for (let s = 0; s < spawnsReflexive.value.count; s++) {
        const sOff = spawnsOffset + s * spawnSize;
        let curX = out.readFloatLE(sOff + 0);
        let curY = out.readFloatLE(sOff + 4);
        let curZ = out.readFloatLE(sOff + 8);
        let changed = false;
        if (curX < minX || curX > maxX) {
          curX = Math.min(Math.max(curX, minX + 2), maxX - 2);
          out.writeFloatLE(curX, sOff + 0);
          changed = true;
        }
        if (curY < minY || curY > maxY) {
          curY = Math.min(Math.max(curY, minY + 2), maxY - 2);
          out.writeFloatLE(curY, sOff + 4);
          changed = true;
        }
        if (curZ < minZ || curZ > maxZ) {
          curZ = defaultGroundZ;
          out.writeFloatLE(curZ, sOff + 8);
          changed = true;
        }
        if (changed) relocatedSpawns++;
      }
    }

    // Netgame equipment at 0x384
    const equipReflexive = latestDecodedScnr.get('netgame equipment');
    if (equipReflexive && equipReflexive.kind === 'reflexive' && equipReflexive.value.count > 0) {
      const equipSize = 144; // ScenarioNetgameEquipment struct
      const equipOffset = latestTagDataOffset + (equipReflexive.value.pointerLow - latestBaseAddr);
      for (let e = 0; e < equipReflexive.value.count; e++) {
        const eOff = equipOffset + e * equipSize;
        let curX = out.readFloatLE(eOff + 64);
        let curY = out.readFloatLE(eOff + 68);
        let curZ = out.readFloatLE(eOff + 72);
        let changed = false;
        if (curX < minX || curX > maxX) {
          curX = Math.min(Math.max(curX, minX + 2), maxX - 2);
          out.writeFloatLE(curX, eOff + 64);
          changed = true;
        }
        if (curY < minY || curY > maxY) {
          curY = Math.min(Math.max(curY, minY + 2), maxY - 2);
          out.writeFloatLE(curY, eOff + 68);
          changed = true;
        }
        if (curZ < minZ || curZ > maxZ) {
          out.writeFloatLE(defaultGroundZ, eOff + 72);
          changed = true;
        }
        if (changed) relocatedSpawns++;
      }
    }

    // Netgame flags at 0x378 (CTF flags, Oddball, Hill, Race points)
    const flagsReflexive = decodeReflexive(out, latestScnrOffset + 0x378);
    if (flagsReflexive.count > 0) {
      const flagSize = 148; // ScenarioNetgameFlag struct
      const flagsOffset = latestTagDataOffset + (flagsReflexive.pointerLow - latestBaseAddr);
      let ctfCount = 0;
      for (let f = 0; f < flagsReflexive.count; f++) {
        const fOff = flagsOffset + f * flagSize;
        let curX = out.readFloatLE(fOff + 0);
        let curY = out.readFloatLE(fOff + 4);
        let curZ = out.readFloatLE(fOff + 8);
        if (curX < minX || curX > maxX) {
          curX = Math.min(Math.max(curX, minX + 2), maxX - 2);
          out.writeFloatLE(curX, fOff + 0);
        }
        if (curY < minY || curY > maxY) {
          curY = Math.min(Math.max(curY, minY + 2), maxY - 2);
          out.writeFloatLE(curY, fOff + 4);
        }
        if (curZ < minZ || curZ > maxZ) {
          curZ = defaultGroundZ;
          out.writeFloatLE(curZ, fOff + 8);
        }
        const flagType = out.readInt16LE(fOff + 16);
        if (flagType === 0) {
          // Ensure first CTF flag is Red (0), second is Blue (1), and any extras become Hill flags (3)
          if (ctfCount === 0) {
            out.writeInt16LE(0, fOff + 18);
          } else if (ctfCount === 1) {
            out.writeInt16LE(1, fOff + 18);
          } else {
            out.writeInt16LE(3, fOff + 16); // Hill flag
            out.writeInt16LE(0, fOff + 18);
          }
          ctfCount++;
        }
      }
    }
  }

  // 7. If multiple BSPs were selected with `mergeMultipleBsps === false`, append each additional donor BSP sequentially in `scnr.structure_bsps`
  if (srcIndices.length > 1 && !shouldMergeMultiBsp) {
    const CE_BSP_CACHE_CEILING = 0x41b40000;
    let cumulativeBspEnd = dstBsp.bspStart + srcBspSize;

    for (let extraIdx = 1; extraIdx < srcIndices.length; extraIdx++) {
      const donorBspInfo = sourceBsps[srcIndices[extraIdx]];
      if (!donorBspInfo) continue;

      let extraBspBytes = Buffer.from(
        sourceBuffer.subarray(donorBspInfo.bspStart, donorBspInfo.bspStart + donorBspInfo.bspSize),
      );
      const extraPad = (512 - (extraBspBytes.length % 512)) % 512;
      if (extraPad > 0) {
        extraBspBytes = Buffer.concat([extraBspBytes, Buffer.alloc(extraPad, 0)]);
      }
      const extraBspSize = extraBspBytes.length;
      const extraCeiling =
        extraBspSize <= 17_616_076 && targetInspected.header.tagDataSize + extraBspSize + 1_500_000 <= 23 * 1024 * 1024
          ? 0x41b40000
          : 0x47e40000;
      let extraBspAddress = donorBspInfo.bspAddress;
      let rebasedExtraAddr = extraBspAddress;
      if (extraBspAddress + extraBspSize > extraCeiling) {
        rebasedExtraAddr = (extraCeiling - extraBspSize) & ~511;
      }
      rebaseStructureBspPointers(extraBspBytes, extraBspAddress, rebasedExtraAddr);
      extraBspAddress = rebasedExtraAddr;

      const extraMetaPtr = extraBspBytes.readUInt32LE(0);
      const extraRootRel = extraMetaPtr - extraBspAddress;
      if (extraRootRel >= 0 && extraRootRel + 0x260 <= extraBspSize) {
        if (shouldStripDobc) {
          extraBspBytes.writeUInt32LE(0, extraRootRel + 0x24c);
          extraBspBytes.writeUInt32LE(0, extraRootRel + 0x250);
        }
        if (shouldStripDecals) {
          extraBspBytes.writeUInt32LE(0, extraRootRel + 0x258);
          extraBspBytes.writeUInt32LE(0, extraRootRel + 0x25c);
          const clCount = extraBspBytes.readUInt32LE(extraRootRel + 0x134);
          const clPtr = extraBspBytes.readUInt32LE(extraRootRel + 0x138);
          const clRel = clPtr - extraBspAddress;
          if (clCount > 0 && clRel >= 0 && clRel + clCount * 104 <= extraBspSize) {
            for (let c = 0; c < clCount; c++) {
              extraBspBytes.writeInt16LE(-1, clRel + c * 104 + 0x0c);
              extraBspBytes.writeInt16LE(0, clRel + c * 104 + 0x0e);
            }
          }
        }
      }

      // Insert extraBspBytes sequentially at cumulativeBspEnd (before tagDataOffset)
      const insertAt = cumulativeBspEnd;
      cumulativeBspEnd += extraBspSize;
      const curTagDataOffset = out.readUInt32LE(0x10);
      const nextTagDataOffset = curTagDataOffset + extraBspSize;
      const expanded = Buffer.concat([
        out.subarray(0, insertAt),
        extraBspBytes,
        out.subarray(insertAt),
      ]);
      expanded.writeUInt32LE(expanded.length >>> 0, 0x08);
      expanded.writeUInt32LE(nextTagDataOffset >>> 0, 0x10);
      const curModelDataOff = expanded.readUInt32LE(nextTagDataOffset + 0x14);
      expanded.writeUInt32LE((curModelDataOff + extraBspSize) >>> 0, nextTagDataOffset + 0x14);

      const reAfterInsert = inspectCustomEditionMap(expanded);
      if (reAfterInsert.status === 'ok') {
        shiftExistingRawDataOffsets(expanded, nextTagDataOffset, reAfterInsert.tagIndex, insertAt, extraBspSize);
        reinspected = reAfterInsert;
      }
      out = expanded;

      // Rewrite TagDependencies directly in `out` at `insertAt` using the real `nextTagDataOffset`
      if (extraRootRel >= 0 && extraRootRel < extraBspSize) {
        rewriteBspDependencies(
          out,
          'ScenarioStructureBSP',
          insertAt + extraRootRel,
          insertAt,
          extraBspSize,
          extraBspAddress,
          tagIdMap,
          new Set<number>(),
          nextTagDataOffset,
        );
      }

      // Allocate a distinct sbsp TagIndex entry so each ScenarioBSP[extraIdx] has a unique tagId and path
      let newSbspTagId = dstBsp.tagId;
      try {
        const baseCandidatePath = donorBspInfo.path || `levels\\bsp_${extraIdx}`;
        const uniquePath = reinspected.tagIndex.entries.some((e) => e.path === baseCandidatePath)
          ? `${baseCandidatePath}_bsp_${extraIdx}`
          : baseCandidatePath;
        const dupRes = duplicateTagInMap(
          out,
          reinspected.header,
          reinspected.tagIndex,
          dstBsp.tagId & 0xffff,
          uniquePath,
        );
        out = dupRes.buffer;
        newSbspTagId = dupRes.newTagId;
        const reAfterSlot = inspectCustomEditionMap(out);
        if (reAfterSlot.status === 'ok') reinspected = reAfterSlot;
      } catch {
        // Fallback to existing sbsp tagId if slot allocation fails
      }

      // Append a 32-byte ScenarioBSP entry to scnr.structure_bsps (offset 0x5a4)
      const scnrEntryNow = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
      if (scnrEntryNow) {
        const scnrOffNow = resolveTagDataPointer(
          scnrEntryNow.tagDataPointerOrResourceIndex,
          reinspected.header,
          reinspected.tagIndex.baseMemoryAddress,
        );
        const curTagOff = out.readUInt32LE(0x10);
        const tagHeaderSize = reinspected.header.engine === 5 ? 0x24 : 0x28;
        const sbspEntryOff = curTagOff + tagHeaderSize + (newSbspTagId & 0xffff) * 32;
        const sbspPathPtr = sbspEntryOff + 0x14 <= out.length ? out.readUInt32LE(sbspEntryOff + 0x10) : 0;

        const elemBuf = Buffer.alloc(32, 0);
        elemBuf.writeUInt32LE(insertAt >>> 0, 0); // bsp start
        elemBuf.writeUInt32LE(extraBspSize >>> 0, 4); // bsp size
        elemBuf.writeUInt32LE(extraBspAddress >>> 0, 8); // bsp address
        elemBuf.writeUInt32LE(0x73627370, 16); // 'sbsp' fourCC
        elemBuf.writeUInt32LE(sbspPathPtr >>> 0, 20); // path pointer
        elemBuf.writeUInt32LE(0, 24);
        elemBuf.writeUInt32LE(newSbspTagId >>> 0, 28); // tagId
        const appendBspRes = appendReflexiveElements(
          out,
          reinspected.header,
          reinspected.tagIndex,
          scnrOffNow + 0x5a4,
          elemBuf,
          1,
        );
        out = appendBspRes.buffer;
        const reAfterAppend = inspectCustomEditionMap(out);
        if (reAfterAppend.status === 'ok') reinspected = reAfterAppend;
      }
    }
  }

  // 8. Auto-add directional transition trigger volumes & HaloScript to activate/switch BSPs based on `effectiveScriptMode`
  const shouldGenerateBspScript = !shouldMergeMultiBsp && effectiveScriptMode !== 'none';
  if (shouldGenerateBspScript) {
    const finalBsps = getMapBsps(out);
    const totalBspCount = Math.max(1, finalBsps.length);
    const transitionPairs: Array<{ a: number; b: number; trigAtoB: string; trigBtoA: string }> = [];

    if ((effectiveScriptMode === 'switch' || effectiveScriptMode === 'activate_all') && totalBspCount > 1) {
      // Analyze shared 3D transition corridor geometry between BSPs to place non-overlapping directional trigger volumes
      const q20 = (v: number) => Math.round(v * 5);
      const bspCells: Array<Map<string, { x: number; y: number; z: number }>> = [];
      const bspCentroids: Array<{ x: number; y: number; z: number }> = [];

      for (let b = 0; b < totalBspCount; b++) {
        const cellMap = new Map<string, { x: number; y: number; z: number }>();
        let sumX = 0, sumY = 0, sumZ = 0, cnt = 0;
        try {
          const mesh = extractBspRenderMesh(out, reinspected.header, reinspected.tagIndex, b);
          for (const sm of mesh.submeshes) {
            for (let v = 0; v < sm.vertexCount; v++) {
              const x = sm.vertices[v * 8 + 0]!;
              const y = sm.vertices[v * 8 + 1]!;
              const z = sm.vertices[v * 8 + 2]!;
              sumX += x; sumY += y; sumZ += z; cnt++;
              const key = `${q20(x)},${q20(y)},${q20(z)}`;
              if (!cellMap.has(key)) cellMap.set(key, { x, y, z });
            }
          }
        } catch {
          // fallback to worldBounds center
        }
        const wb = finalBsps[b]?.worldBounds ?? [0, 0, 0, 0, 0, 0];
        bspCells.push(cellMap);
        bspCentroids.push(
          cnt > 0
            ? { x: sumX / cnt, y: sumY / cnt, z: sumZ / cnt }
            : { x: 0.5 * (wb[0] + wb[3]), y: 0.5 * (wb[1] + wb[4]), z: 0.5 * (wb[2] + wb[5]) },
        );
      }

      const trigBuffers: Buffer[] = [];
      const createTriggerVolumeBytes = (name: string, cx: number, cy: number, cz: number, extX = 2.6, extY = 2.6, extZ = 2.4): Buffer => {
        const buf = Buffer.alloc(96, 0);
        buf.writeUInt16LE(1, 0); // initialized flag = 1
        buf.write(name.slice(0, 31), 4, 'ascii');
        buf.writeFloatLE(1.0, 48); // forward.i
        buf.writeFloatLE(0.0, 52); // forward.j
        buf.writeFloatLE(0.0, 56); // forward.k
        buf.writeFloatLE(0.0, 60); // up.i
        buf.writeFloatLE(0.0, 64); // up.j
        buf.writeFloatLE(1.0, 68); // up.k
        buf.writeFloatLE(cx - extX * 0.5, 72); // corner.x
        buf.writeFloatLE(cy - extY * 0.5, 76); // corner.y
        buf.writeFloatLE(cz - 0.4, 80);        // corner.z (slightly below floor level)
        buf.writeFloatLE(extX, 84);            // extents.x
        buf.writeFloatLE(extY, 88);            // extents.y
        buf.writeFloatLE(extZ, 92);            // extents.z
        return buf;
      };

      for (let a = 0; a < totalBspCount; a++) {
        for (let b = a + 1; b < totalBspCount; b++) {
          const sharedPts: Array<{ x: number; y: number; z: number }> = [];
          for (const [k, pt] of bspCells[b]!) {
            if (bspCells[a]!.has(k)) sharedPts.push(pt);
          }
          if (sharedPts.length < 10 && b !== a + 1) continue;

          const cA = bspCentroids[a]!;
          const cB = bspCentroids[b]!;
          let dx = cB.x - cA.x;
          let dy = cB.y - cA.y;
          let dz = cB.z - cA.z;
          const dLen = Math.hypot(dx, dy, dz) || 1;
          dx /= dLen; dy /= dLen; dz /= dLen;

          let ptBtoA: { x: number; y: number; z: number };
          let ptAtoB: { x: number; y: number; z: number };

          if (sharedPts.length >= 2) {
            let mX = 0, mY = 0, mZ = 0;
            for (const p of sharedPts) { mX += p.x; mY += p.y; mZ += p.z; }
            mX /= sharedPts.length; mY /= sharedPts.length; mZ /= sharedPts.length;

            const sorted = sharedPts
              .map((p) => ({
                ...p,
                proj: (p.x - mX) * dx + (p.y - mY) * dy + (p.z - mZ) * dz,
              }))
              .sort((p1, p2) => p1.proj - p2.proj);

            // Pick floor-level points near the 30% quantile (side A) and 70% quantile (side B)
            const sliceA = sorted.slice(Math.floor(sorted.length * 0.22), Math.max(1, Math.floor(sorted.length * 0.38)));
            const sliceB = sorted.slice(Math.floor(sorted.length * 0.62), Math.max(1, Math.floor(sorted.length * 0.78)));
            const pickFloorPoint = (arr: typeof sorted, fallback: { x: number; y: number; z: number }) => {
              if (arr.length === 0) return fallback;
              const byZ = [...arr].sort((u, v) => u.z - v.z);
              const floorZ = byZ[Math.floor(byZ.length * 0.15)]!.z;
              let sx = 0, sy = 0, cnt = 0;
              for (const p of arr) {
                if (Math.abs(p.z - floorZ) <= 1.2) { sx += p.x; sy += p.y; cnt++; }
              }
              return cnt > 0 ? { x: sx / cnt, y: sy / cnt, z: floorZ } : arr[Math.floor(arr.length / 2)]!;
            };
            ptBtoA = pickFloorPoint(sliceA, sorted[Math.floor(sorted.length * 0.3)]!);
            ptAtoB = pickFloorPoint(sliceB, sorted[Math.floor(sorted.length * 0.7)]!);
          } else {
            const midX = 0.5 * (cA.x + cB.x);
            const midY = 0.5 * (cA.y + cB.y);
            const midZ = 0.5 * (cA.z + cB.z);
            ptBtoA = { x: midX - dx * 2.2, y: midY - dy * 2.2, z: midZ };
            ptAtoB = { x: midX + dx * 2.2, y: midY + dy * 2.2, z: midZ };
          }

          // Guarantee >= 4.0 world units separation between trig_bsp_B_to_A and trig_bsp_A_to_B so they never overlap
          const sep = Math.hypot(ptAtoB.x - ptBtoA.x, ptAtoB.y - ptBtoA.y);
          if (sep < 4.0) {
            const midX = 0.5 * (ptBtoA.x + ptAtoB.x);
            const midY = 0.5 * (ptBtoA.y + ptAtoB.y);
            const xyLen = Math.hypot(dx, dy) || 1;
            const ux = dx / xyLen;
            const uy = dy / xyLen;
            ptBtoA = { x: midX - ux * 2.1, y: midY - uy * 2.1, z: ptBtoA.z };
            ptAtoB = { x: midX + ux * 2.1, y: midY + uy * 2.1, z: ptAtoB.z };
          }

          const trigAtoB = `trig_bsp_${a}_to_${b}`;
          const trigBtoA = `trig_bsp_${b}_to_${a}`;
          trigBuffers.push(createTriggerVolumeBytes(trigAtoB, ptAtoB.x, ptAtoB.y, ptAtoB.z));
          trigBuffers.push(createTriggerVolumeBytes(trigBtoA, ptBtoA.x, ptBtoA.y, ptBtoA.z));
          transitionPairs.push({ a, b, trigAtoB, trigBtoA });
        }
      }

      if (trigBuffers.length > 0) {
        const scnrEntryTrig = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
        const trigFieldDef = resolveStruct('Scenario').fields.find((f) => f.name === 'trigger volumes');
        if (scnrEntryTrig && trigFieldDef) {
          const scnrOffTrig = resolveTagDataPointer(
            scnrEntryTrig.tagDataPointerOrResourceIndex,
            reinspected.header,
            reinspected.tagIndex.baseMemoryAddress,
          );
          const appendTrigRes = appendReflexiveElements(
            out,
            reinspected.header,
            reinspected.tagIndex,
            scnrOffTrig + trigFieldDef.offset,
            Buffer.concat(trigBuffers),
            trigBuffers.length,
          );
          out = appendTrigRes.buffer;
          createdTriggerVolumes = trigBuffers.length;
          const reAfterTrig = inspectCustomEditionMap(out);
          if (reAfterTrig.status === 'ok') reinspected = reAfterTrig;
        }
      }
    }

    let hsc = `; ============================================================================\n`;
    hsc += `; Auto-Generated Multi-BSP Activation & Directional Transition Script\n`;
    hsc += `; ============================================================================\n`;
    hsc += `(global short active_bsp_index 0)\n\n`;
    for (let b = 0; b < totalBspCount; b++) {
      hsc += `; Manually switch to Structure BSP #${b} (${finalBsps[b]?.path ?? `bsp_${b}`})\n`;
      hsc += `(script static void activate_bsp_${b}\n  (switch_bsp ${b})\n  (set active_bsp_index ${b})\n  (sv_say "Activated Structure BSP #${b}!")\n)\n\n`;
    }
    if (effectiveScriptMode === 'activate_all' && totalBspCount > 1) {
      hsc += `; Static helper: sequentially activates all ${totalBspCount} separate Structure BSPs in the scenario\n`;
      hsc += `(script static void activate_all_bsps\n`;
      for (let b = 0; b < totalBspCount; b++) {
        hsc += `  (switch_bsp ${b})\n`;
      }
      hsc += `  (switch_bsp 0)\n  (set active_bsp_index 0)\n  (sv_say "Initialized all ${totalBspCount} Structure BSPs!")\n)\n\n`;
      hsc += `; Startup script: activates all ${totalBspCount} Structure BSPs on map load\n`;
      hsc += `(script startup init_activate_all_bsps\n  (activate_all_bsps)\n)\n\n`;
    } else if (effectiveScriptMode === 'switch' && totalBspCount > 1) {
      hsc += `; Startup script: initializes Structure BSP #0 on map load\n`;
      hsc += `(script startup init_multi_bsp_manager\n  (switch_bsp 0)\n  (set active_bsp_index 0)\n  (sv_say "Multi-BSP Map Loaded (${totalBspCount} BSPs)! Walk through transition corridors to switch BSP zones.")\n)\n\n`;
    }
    if (transitionPairs.length > 0) {
      hsc += `; Continuous directional BSP transition monitor:\n`;
      hsc += `; Each pair of connected BSPs (A <-> B) has two non-overlapping corridor triggers:\n`;
      hsc += `;   - trig_bsp_A_to_B (placed on B's side of the shared transition corridor)\n`;
      hsc += `;   - trig_bsp_B_to_A (placed on A's side of the shared transition corridor)\n`;
      hsc += `; Guards each switch with (= (structure_bsp_index) A) so standing inside a trigger never loops!\n`;
      hsc += `(script continuous monitor_bsp_transitions\n`;
      for (const pair of transitionPairs) {
        hsc += `  (if (and (= (structure_bsp_index) ${pair.a}) (volume_test_objects ${pair.trigAtoB} (players)))\n`;
        hsc += `    (begin\n      (switch_bsp ${pair.b})\n      (set active_bsp_index ${pair.b})\n      (sv_say "Transitioned to Structure BSP #${pair.b}!")\n      (sleep 30)\n    )\n  )\n`;
        hsc += `  (if (and (= (structure_bsp_index) ${pair.b}) (volume_test_objects ${pair.trigBtoA} (players)))\n`;
        hsc += `    (begin\n      (switch_bsp ${pair.a})\n      (set active_bsp_index ${pair.a})\n      (sv_say "Transitioned to Structure BSP #${pair.a}!")\n      (sleep 30)\n    )\n  )\n`;
      }
      hsc += `  (sleep 5)\n)\n`;
    }
    try {
      const compiled = compileHaloScriptIntoScenario(out, hsc);
      if (!compiled.diagnostics.some((d) => d.severity === 'error')) {
        out = compiled.buffer;
      }
    } catch {
      // Keep swapped map even if script compile encounters an unexpected edge case
    }
  }

  const finalDelta = out.length - targetBuffer.length;
  return {
    ok: true,
    buffer: out,
    summary: {
      sourceBspName: srcBspName,
      targetBspName: dstBsp.path,
      oldSize: targetBuffer.length,
      newSize: out.length,
      delta: finalDelta,
      strippedDobc,
      strippedDecals,
      relocatedSpawns,
      harvestedShaders,
      harvestedBitmaps,
      importedScenery,
      importedVehicles,
      importedMachines,
      removedDuplicateTriangles,
      removedPortalBlockerTriangles,
      createdTriggerVolumes,
    },
  };
}

// ============================================================================
// Part 2: Direct 3D Model File (.glb / .gltf / .obj / .jms) + Original Textures
//         BSP Replacement & Merge
// ============================================================================

export interface BspModelSwapOptions extends ModelImportOptions {
  /** Target BSP slot index in the open donor map (default: 0). */
  targetBspIndex?: number;
  /** Whether to replace the target BSP geometry/collision or merge/append into it (default: 'replace'). */
  injectionMode?: 'replace' | 'merge';
  /** Whether to extract & inject original embedded/external textures as A8R8G8B8 bitmaps + ShaderModel tags (default: true). */
  extractTextures?: boolean;
  /** Automatically enable two-sided and alpha-tested flags on foliage/cutout shaders (default: true). */
  autoAlphaAndTwoSided?: boolean;
  /** Render diffuse textures at full brightness (ScenarioStructureBSPLightmap.bitmap = -1) (default: true). */
  fullBrightnessLightmap?: boolean;
  /** Simplify solid collision via area-weighted vertex clustering + coplanar polygon merging (default: true). */
  simplifyCollision?: boolean;
  /** Relocate player spawns, netgame flags, equipment, vehicles, and ground objects onto new solid ground (default: true). */
  relocateGroundObjects?: boolean;
  /** Clear existing scenery, runtime decals, and detail objects (DOBC) (default: true). */
  clearExistingPlacements?: boolean;
  /** Strip Detail Objects (DOBC) and Runtime Decals from the target BSP (default: true). */
  stripDobcAndDecals?: boolean;
  /** Cache ceiling mode: 'expanded_opence' (122 MiB / 0x47E40000) or 'stock_ce' (23 MiB / 0x41B40000) (default: 'expanded_opence'). */
  cacheCeilingMode?: 'expanded_opence' | 'stock_ce';
  /** Optional new scenario name to write into the map header (+0x20). */
  newScenarioName?: string;
}

function toBoundsTuple(b: ModelBounds3D): [number, number, number, number, number, number] {
  return [b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]];
}

export interface BspModelPreflightResult {
  ok: boolean;
  modelFileName: string;
  format: 'glb' | 'gltf' | 'obj' | 'jms';
  nodeCount: number;
  meshCount: number;
  rawVertexCount: number;
  weldedVertexCount: number;
  totalTriangleCount: number;
  solidCollisionTriangleCount: number;
  foliageTriangleCount: number;
  foliageMeshCount: number;
  materialCount: number;
  textureCount: number;
  submeshChunkCount: number;
  appliedScale: number;
  rawBounds: [number, number, number, number, number, number];
  scaledBounds: [number, number, number, number, number, number];
  playableScaledBounds: [number, number, number, number, number, number];
  targetBsps: BspInfo[];
  selectedTargetBsp: BspInfo | null;
  estimatedBspBytes: number;
  estimatedNewMapBytes: number;
  warnings: string[];
  error?: string;
}

export interface BspModelSwapResult {
  ok: boolean;
  buffer: Buffer;
  summary: {
    modelFileName: string;
    targetBspName: string;
    injectionMode: 'replace' | 'merge';
    oldSize: number;
    newSize: number;
    delta: number;
    weldedVertices: number;
    totalTriangles: number;
    solidCollisionTriangles: number;
    foliageTriangles: number;
    submeshChunks: number;
    injectedBitmaps: number;
    injectedShaders: number;
    collisionNodes3d: number;
    collisionSurfaces: number;
    relocatedSpawns: number;
    strippedDobc: boolean;
    strippedDecals: boolean;
    newBspAddress: number;
    newBspSize: number;
    worldBounds: [number, number, number, number, number, number];
  };
  error?: string;
}

/**
 * Preflights a direct 3D model file (`.glb`, `.gltf`, `.obj`, `.jms`) for BSP replacement or merge.
 */
export function preflightModelBspSwap(
  modelPathOrBuffer: string | Buffer,
  targetMapBuffer: Buffer,
  targetBspIndex = 0,
  options: BspModelSwapOptions = {},
): BspModelPreflightResult {
  const targetBsps = getMapBsps(targetMapBuffer);
  const selectedTargetBsp = targetBsps[targetBspIndex] ?? targetBsps[0] ?? null;

  try {
    const parsed = parseModelFileForBsp(modelPathOrBuffer, {
      ...options,
      decodeTexturesNow: false,
    });

    const isMerge = options.injectionMode === 'merge';
    const baseBspBytes = isMerge && selectedTargetBsp ? selectedTargetBsp.bspSize : 96_000;
    const renderBytes =
      parsed.weldedVertexCount * 56 +
      parsed.totalTriangleCount * 10 +
      parsed.submeshChunks.length * 256;
    const estCollFaces = Math.min(
      options.targetCollisionFaces ?? 3500,
      Math.max(100, parsed.solidTriangleCount),
    );
    const estCollBytes = estCollFaces * 220;
    const estimatedBspBytes = (baseBspBytes + renderBytes + estCollBytes + 65535) & ~511;

    const rawTexEstimate =
      options.extractTextures !== false ? Math.max(0, parsed.embeddedTextureCount) * 262_144 : 0;
    const oldTargetBspBytes = selectedTargetBsp?.bspSize ?? 0;
    const estimatedNewMapBytes =
      targetMapBuffer.length - oldTargetBspBytes + estimatedBspBytes + rawTexEstimate;

    const warnings: string[] = [];
    if (!selectedTargetBsp) {
      warnings.push('No valid Structure BSP found in the currently open map.');
    }
    if (
      options.cacheCeilingMode === 'stock_ce' &&
      estimatedBspBytes > 17_500_000
    ) {
      warnings.push(
        `Estimated BSP size (${(estimatedBspBytes / (1024 * 1024)).toFixed(1)} MiB) exceeds Stock Halo CE's 23 MiB cache ceiling; it will automatically promote to Expanded OpenCE 122 MiB (0x47E40000).`,
      );
    }

    return {
      ok: Boolean(selectedTargetBsp) && parsed.totalTriangleCount > 0,
      modelFileName: parsed.modelName,
      format: parsed.format,
      nodeCount: parsed.sceneNodeCount,
      meshCount: parsed.meshCount,
      rawVertexCount: parsed.rawVertexCount,
      weldedVertexCount: parsed.weldedVertexCount,
      totalTriangleCount: parsed.totalTriangleCount,
      solidCollisionTriangleCount: parsed.solidTriangleCount,
      foliageTriangleCount: parsed.passThroughTriangleCount,
      foliageMeshCount: parsed.passThroughMeshCount,
      materialCount: parsed.materialCount,
      textureCount: parsed.embeddedTextureCount,
      submeshChunkCount: parsed.submeshChunks.length,
      appliedScale: parsed.appliedScale,
      rawBounds: toBoundsTuple(parsed.rawBounds),
      scaledBounds: toBoundsTuple(parsed.scaledBounds),
      playableScaledBounds: toBoundsTuple(parsed.playableScaledBounds),
      targetBsps,
      selectedTargetBsp,
      estimatedBspBytes,
      estimatedNewMapBytes,
      warnings,
      error: !selectedTargetBsp
        ? 'No valid Structure BSP found in target map.'
        : parsed.totalTriangleCount === 0
          ? '3D model contains 0 valid triangles.'
          : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      modelFileName: typeof modelPathOrBuffer === 'string' ? modelPathOrBuffer : 'model',
      format: 'glb',
      nodeCount: 0,
      meshCount: 0,
      rawVertexCount: 0,
      weldedVertexCount: 0,
      totalTriangleCount: 0,
      solidCollisionTriangleCount: 0,
      foliageTriangleCount: 0,
      foliageMeshCount: 0,
      materialCount: 0,
      textureCount: 0,
      submeshChunkCount: 0,
      appliedScale: 1,
      rawBounds: [0, 0, 0, 0, 0, 0],
      scaledBounds: [0, 0, 0, 0, 0, 0],
      playableScaledBounds: [0, 0, 0, 0, 0, 0],
      targetBsps,
      selectedTargetBsp,
      estimatedBspBytes: 0,
      estimatedNewMapBytes: targetMapBuffer.length,
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Downward raycaster over `solidRaycastTriangles` (`[x0,y0,z0, x1,y1,z1, x2,y2,z2, ...]`)
 * accelerated by a 2D spatial grid so spawns, flags, equipment, vehicles, and scenery
 * snap accurately onto walkable ground surfaces.
 */
function createGroundSnapper(
  solidRaycastTriangles: Float32Array,
  playableBounds: [number, number, number, number, number, number],
): {
  snapXYToGround: (x: number, y: number, fallbackIndex?: number) => [number, number, number];
  raycastGroundZ: (x: number, y: number, preferBelowZ?: number) => number | null;
} {
  const cellSize = 8.0;
  const grid = new Map<string, number[]>();
  const triCount = Math.floor(solidRaycastTriangles.length / 9);
  const samplePoints: [number, number, number][] = [];

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const x0 = solidRaycastTriangles[base + 0]!;
    const y0 = solidRaycastTriangles[base + 1]!;
    const z0 = solidRaycastTriangles[base + 2]!;
    const x1 = solidRaycastTriangles[base + 3]!;
    const y1 = solidRaycastTriangles[base + 4]!;
    const z1 = solidRaycastTriangles[base + 5]!;
    const x2 = solidRaycastTriangles[base + 6]!;
    const y2 = solidRaycastTriangles[base + 7]!;
    const z2 = solidRaycastTriangles[base + 8]!;

    const minGx = Math.floor(Math.min(x0, x1, x2) / cellSize);
    const maxGx = Math.floor(Math.max(x0, x1, x2) / cellSize);
    const minGy = Math.floor(Math.min(y0, y1, y2) / cellSize);
    const maxGy = Math.floor(Math.max(y0, y1, y2) / cellSize);
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const key = `${gx},${gy}`;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(t);
      }
    }

    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const cz = (z0 + z1 + z2) / 3;
    if (
      cx >= playableBounds[0] + 4 &&
      cx <= playableBounds[3] - 4 &&
      cy >= playableBounds[1] + 4 &&
      cy <= playableBounds[4] - 4
    ) {
      samplePoints.push([cx, cy, cz]);
    }
  }

  // Sort sample points by distance to playable center so fallback points cluster around the main village/arena
  const midX = 0.5 * (playableBounds[0] + playableBounds[3]);
  const midY = 0.5 * (playableBounds[1] + playableBounds[4]);
  samplePoints.sort(
    (a, b) =>
      (a[0] - midX) ** 2 + (a[1] - midY) ** 2 - ((b[0] - midX) ** 2 + (b[1] - midY) ** 2),
  );

  const raycastGroundZ = (x: number, y: number, preferBelowZ?: number): number | null => {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    const list = grid.get(`${gx},${gy}`);
    if (!list || list.length === 0) return null;

    let bestZ: number | null = null;
    for (let i = 0; i < list.length; i++) {
      const base = list[i]! * 9;
      const x0 = solidRaycastTriangles[base + 0]!;
      const y0 = solidRaycastTriangles[base + 1]!;
      const z0 = solidRaycastTriangles[base + 2]!;
      const x1 = solidRaycastTriangles[base + 3]!;
      const y1 = solidRaycastTriangles[base + 4]!;
      const z1 = solidRaycastTriangles[base + 5]!;
      const x2 = solidRaycastTriangles[base + 6]!;
      const y2 = solidRaycastTriangles[base + 7]!;
      const z2 = solidRaycastTriangles[base + 8]!;

      const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(denom) < 1e-8) continue;
      const w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / denom;
      const w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / denom;
      const w2 = 1.0 - w0 - w1;
      if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
        const hitZ = w0 * z0 + w1 * z1 + w2 * z2;
        if (preferBelowZ !== undefined && hitZ > preferBelowZ + 6.0) continue;
        if (bestZ === null || hitZ > bestZ) {
          bestZ = hitZ;
        }
      }
    }
    return bestZ;
  };

  const snapXYToGround = (x: number, y: number, fallbackIndex = 0): [number, number, number] => {
    const margin = 4.0;
    const inPlayable =
      x >= playableBounds[0] + margin &&
      x <= playableBounds[3] - margin &&
      y >= playableBounds[1] + margin &&
      y <= playableBounds[4] - margin;
    if (inPlayable) {
      const hitZ = raycastGroundZ(x, y);
      if (hitZ !== null) return [x, y, hitZ];
    }
    // Search nearby ring around (clampedX, clampedY)
    const cx = Math.min(Math.max(x, playableBounds[0] + margin), playableBounds[3] - margin);
    const cy = Math.min(Math.max(y, playableBounds[1] + margin), playableBounds[4] - margin);
    const hitClamped = raycastGroundZ(cx, cy);
    if (hitClamped !== null) return [cx, cy, hitClamped];

    for (let r = 2; r <= 24; r += 3) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const tx = cx + Math.cos(ang) * r;
        const ty = cy + Math.sin(ang) * r;
        const hz = raycastGroundZ(tx, ty);
        if (hz !== null) return [tx, ty, hz];
      }
    }

    if (samplePoints.length > 0) {
      const sp = samplePoints[(fallbackIndex * 13) % Math.min(samplePoints.length, 256)]!;
      return [sp[0], sp[1], sp[2]];
    }
    return [midX, midY, playableBounds[2] + 0.5];
  };

  return { snapXYToGround, raycastGroundZ };
}

/**
 * Replaces or merges a direct 3D model file (`.glb`, `.gltf`, `.obj`, `.jms`) and all of its
 * original embedded/external textures into the target map's `ScenarioStructureBSP`.
 */
export function swapMapBspFromModelFile(
  modelPathOrBuffer: string | Buffer,
  targetMapBuffer: Buffer,
  options: BspModelSwapOptions = {},
): BspModelSwapResult {
  const dstIdx = options.targetBspIndex ?? 0;
  const injectionMode: 'replace' | 'merge' = options.injectionMode === 'merge' ? 'merge' : 'replace';
  const extractTextures = options.extractTextures !== false;
  const autoAlphaAndTwoSided = options.autoAlphaAndTwoSided !== false;
  const fullBrightnessLightmap = options.fullBrightnessLightmap !== false;
  const simplifyCollision = options.simplifyCollision !== false;
  const relocateGroundObjects = options.relocateGroundObjects !== false;
  const clearExistingPlacements = options.clearExistingPlacements !== false;
  const stripDobcAndDecals = options.stripDobcAndDecals !== false;
  const cacheCeilingMode = options.cacheCeilingMode ?? 'expanded_opence';

  const makeErrorResult = (errMsg: string): BspModelSwapResult => ({
    ok: false,
    buffer: targetMapBuffer,
    summary: {
      modelFileName: '',
      targetBspName: '',
      injectionMode,
      oldSize: targetMapBuffer.length,
      newSize: targetMapBuffer.length,
      delta: 0,
      weldedVertices: 0,
      totalTriangles: 0,
      solidCollisionTriangles: 0,
      foliageTriangles: 0,
      submeshChunks: 0,
      injectedBitmaps: 0,
      injectedShaders: 0,
      collisionNodes3d: 0,
      collisionSurfaces: 0,
      relocatedSpawns: 0,
      strippedDobc: false,
      strippedDecals: false,
      newBspAddress: 0,
      newBspSize: 0,
      worldBounds: [0, 0, 0, 0, 0, 0],
    },
    error: errMsg,
  });

  let reinspected = inspectCustomEditionMap(targetMapBuffer);
  if (reinspected.status !== 'ok') {
    return makeErrorResult('Failed to inspect target map header or tag index.');
  }

  let parsed;
  try {
    parsed = parseModelFileForBsp(modelPathOrBuffer, {
      ...options,
      decodeTexturesNow: extractTextures,
    });
  } catch (err) {
    return makeErrorResult(err instanceof Error ? err.message : String(err));
  }

  if (parsed.totalTriangleCount === 0 || parsed.submeshChunks.length === 0) {
    return makeErrorResult('3D model contains 0 valid triangles.');
  }

  let workMapBuf: Buffer = Buffer.from(targetMapBuffer);
  let injectedBitmaps = 0;
  let injectedShaders = 0;

  // Map from materialIndex -> resolved target shader tag info
  const materialShaderMap = new Map<
    number,
    { tagId: number; pathPtr: number; classFourCC: number }
  >();

  // 1. Extract & inject original textures (`bitm`) and shaders (`soso`) into `workMapBuf` BEFORE splicing the BSP
  if (extractTextures && parsed.submeshChunks.length > 0) {
    const modelSlug =
      parsed.modelName
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .slice(0, 28) || 'custom_model';

    const extractedTags: ExtractedTag[] = [];
    const bitmapIdxByImageIndex = new Map<number, { localIndex: number; path: string }>();
    const solidColorBitmaps = new Map<string, { localIndex: number; path: string }>();

    // Build custom `bitmap` tags for every decoded embedded/external texture
    for (let tIdx = 0; tIdx < parsed.extractedTextures.length; tIdx++) {
      const tex = parsed.extractedTextures[tIdx]!;
      if (!tex.rgba || tex.width <= 0 || tex.height <= 0) continue;
      const texSlug =
        tex.name
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '_')
          .slice(0, 28) || `tex_${tex.imageIndex}`;
      const bitmPath = `levels\\custom_import\\${modelSlug}\\bitmaps\\${texSlug}_${tex.imageIndex}`;
      const localIdx = extractedTags.length;
      const bitmTag = buildCustomBitmapTag(
        bitmPath,
        localIdx,
        tex.rgba,
        tex.width,
        tex.height,
        BitmapFormat.A8R8G8B8,
      );
      extractedTags.push(bitmTag);
      bitmapIdxByImageIndex.set(tex.imageIndex, { localIndex: localIdx, path: bitmPath });
    }

    // Build custom `shader_model` (`soso`) tags for every unique material referenced by `submeshChunks`
    const chunkRepByMatIndex = new Map<number, (typeof parsed.submeshChunks)[number]>();
    for (const chunk of parsed.submeshChunks) {
      if (!chunkRepByMatIndex.has(chunk.materialIndex)) {
        chunkRepByMatIndex.set(chunk.materialIndex, chunk);
      }
    }

    const shaderLocalIdxByMatIndex = new Map<number, number>();
    for (const [matIdx, chunk] of chunkRepByMatIndex.entries()) {
      let bitmRef =
        chunk.textureIndex >= 0 ? bitmapIdxByImageIndex.get(chunk.textureIndex) : undefined;
      if (!bitmRef) {
        // Synthesize a 4x4 solid-color RGBA texture from `chunk.baseColorRgba`
        const r = Math.max(0, Math.min(255, Math.round((chunk.baseColorRgba[0] ?? 0.8) * 255)));
        const g = Math.max(0, Math.min(255, Math.round((chunk.baseColorRgba[1] ?? 0.8) * 255)));
        const b = Math.max(0, Math.min(255, Math.round((chunk.baseColorRgba[2] ?? 0.8) * 255)));
        const a = Math.max(0, Math.min(255, Math.round((chunk.baseColorRgba[3] ?? 1.0) * 255)));
        const colorKey = `${r}_${g}_${b}_${a}`;
        bitmRef = solidColorBitmaps.get(colorKey);
        if (!bitmRef) {
          const solidRgba = new Uint8Array(4 * 4 * 4);
          for (let p = 0; p < 16; p++) {
            solidRgba[p * 4 + 0] = r;
            solidRgba[p * 4 + 1] = g;
            solidRgba[p * 4 + 2] = b;
            solidRgba[p * 4 + 3] = a;
          }
          const bitmPath = `levels\\custom_import\\${modelSlug}\\bitmaps\\solid_${colorKey}`;
          const localIdx = extractedTags.length;
          extractedTags.push(
            buildCustomBitmapTag(bitmPath, localIdx, solidRgba, 4, 4, BitmapFormat.A8R8G8B8),
          );
          bitmRef = { localIndex: localIdx, path: bitmPath };
          solidColorBitmaps.set(colorKey, bitmRef);
        }
      }

      const matSlug =
        chunk.materialName
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '_')
          .slice(0, 28) || `mat_${matIdx}`;
      const shaderPath = `levels\\custom_import\\${modelSlug}\\shaders\\${matSlug}_${matIdx}`;
      const alphaTested =
        autoAlphaAndTwoSided && (chunk.hasAlphaCutout || chunk.isPassThrough);
      const matType = chunk.haloMaterialType;

      const shaderLocalIdx = extractedTags.length;
      const shaderTag = buildCustomShaderEnvironmentTag(
        shaderPath,
        shaderLocalIdx,
        bitmRef.path,
        bitmRef.localIndex,
        matType,
        { alphaTested },
      );
      extractedTags.push(shaderTag);
      shaderLocalIdxByMatIndex.set(matIdx, shaderLocalIdx);
    }

    if (extractedTags.length > 0) {
      const rootOriginalIndices = Array.from(shaderLocalIdxByMatIndex.values());
      const tagSet: ExtractedTagSet = {
        rootOriginalIndices,
        tags: extractedTags,
        notExtracted: [],
        warnings: [],
      };
      const containerBuf = serializeContainer(tagSet, `model_bsp_${modelSlug}`);
      const container = deserializeContainer(containerBuf);
      const planRes = planAddInjection(
        {
          buffer: workMapBuf,
          header: reinspected.header,
          tagIndex: reinspected.tagIndex,
        },
        container,
        {},
        {
          allowEmbeddedRelocation: true,
          allowGbxmodelGeometryRelocation: true,
          allowExpandedTagSpace: true,
        },
      );
      if (planRes.kind !== 'refused') {
        workMapBuf = Buffer.from(
          applyAddInjection(
            workMapBuf,
            reinspected.header,
            reinspected.tagIndex,
            container,
            planRes,
            {
              allowEmbeddedRelocation: true,
              allowGbxmodelGeometryRelocation: true,
              allowExpandedTagSpace: true,
            },
          ),
        );
        const afterInject = inspectCustomEditionMap(workMapBuf);
        if (afterInject.status === 'ok') {
          reinspected = afterInject;
        }
        for (const t of container.tags) {
          if (t.group === 'bitmap') injectedBitmaps++;
          if (t.group === 'shader_environment' || t.group === 'shader_model') injectedShaders++;
        }

        const tagHeaderSize = reinspected.header.engine === 5 ? 0x24 : 0x28;
        const curTagDataOffset = reinspected.header.tagDataOffset;
        for (const [matIdx, localIdx] of shaderLocalIdxByMatIndex.entries()) {
          const resolvedTagId = planRes.resolvedTagIdByLocalIndex.get(localIdx);
          if (resolvedTagId !== undefined && resolvedTagId !== 0xffffffff) {
            const entryOff =
              curTagDataOffset + tagHeaderSize + (resolvedTagId & 0xffff) * 32;
            const pathPtr =
              entryOff + 0x14 <= workMapBuf.length
                ? workMapBuf.readUInt32LE(entryOff + 0x10)
                : 0;
            materialShaderMap.set(matIdx, {
              tagId: resolvedTagId,
              pathPtr,
              classFourCC: fourCCFromString('senv'),
            });
          }
        }
      }
    }
  }

  // Fallback in-map shader if any submesh has no injected shader (e.g. extractTextures === false)
  let fallbackShader: { tagId: number; pathPtr: number; classFourCC: number } = {
    tagId: 0xffffffff,
    pathPtr: 0,
    classFourCC: fourCCFromString('senv'),
  };
  {
    const tagHeaderSize = reinspected.header.engine === 5 ? 0x24 : 0x28;
    const curTagDataOffset = reinspected.header.tagDataOffset;
    const candidate =
      reinspected.tagIndex.entries.find(
        (e) =>
          (e.primaryClassName === 'shader_environment' ||
            e.primaryClassName === 'shader_model') &&
          !/sky|portal|invisible|nodraw/i.test(e.path),
      ) ??
      reinspected.tagIndex.entries.find((e) => e.primaryClassName?.startsWith('shader'));
    if (candidate) {
      const entryOff = curTagDataOffset + tagHeaderSize + candidate.index * 32;
      const pathPtr =
        entryOff + 0x14 <= workMapBuf.length
          ? workMapBuf.readUInt32LE(entryOff + 0x10)
          : 0;
      fallbackShader = {
        tagId: candidate.tagId,
        pathPtr,
        classFourCC: candidate.primaryClassFourCC,
      };
    }
  }

  // 2. Locate target BSP in `workMapBuf`
  const targetBsps = getMapBsps(workMapBuf);
  const dstBsp = targetBsps[dstIdx] ?? targetBsps[0];
  if (!dstBsp) {
    return makeErrorResult(`Invalid target BSP index ${dstIdx}.`);
  }

  const { header, tagIndex } = reinspected;
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    return makeErrorResult('Scenario tag not found in target map.');
  }
  const scenarioFileOffset =
    header.tagDataOffset +
    (scenarioEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
  const decodedScenario = decodeStruct(workMapBuf, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive' || bspsField.value.count === 0) {
    return makeErrorResult('Scenario has no structure bsps.');
  }
  const effectiveBspIdx = Math.max(0, Math.min(bspsField.value.count - 1, dstIdx));
  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspsArrayOffset =
    header.tagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);
  const bspEntryOffset = bspsArrayOffset + effectiveBspIdx * scenarioBspSize;
  const decodedBspEntry = decodeStruct(workMapBuf, bspEntryOffset, 'ScenarioBSP');
  const bspDep = decodedBspEntry.get('structure bsp');
  const bspTagId = bspDep && bspDep.kind === 'dependency' ? bspDep.value.tagId : 0xffffffff;
  const oldBspStart = (decodedBspEntry.get('bsp start') as { kind: 'basic'; value: number }).value;
  const oldBspSize = (decodedBspEntry.get('bsp size') as { kind: 'basic'; value: number }).value;
  const baseAddress = (decodedBspEntry.get('bsp address') as { kind: 'basic'; value: number }).value;

  const loc = locateStructureBsp(
    workMapBuf,
    tagIndex,
    scenarioFileOffset,
    header.tagDataOffset,
    tagIndex.baseMemoryAddress,
    bspTagId,
    effectiveBspIdx,
  );
  if (!loc) {
    return makeErrorResult(`Failed to locate Structure BSP ${effectiveBspIdx}.`);
  }
  const decodedBsp = decodeStruct(workMapBuf, loc.fileOffset, 'ScenarioStructureBSP');

  // 3. Compile solid 3D CollisionBSP from `parsed.collisionMesh`
  const targetCollFaces = options.targetCollisionFaces ?? 3500;
  const compiledColl = compileMeshCollisionBspData(parsed.collisionMesh, 1, {
    mode: simplifyCollision ? 'auto' : 'exact',
    targetFaces: targetCollFaces,
  });
  if (!compiledColl) {
    return makeErrorResult('Failed to compile 3D CollisionBSP from model geometry.');
  }

  // 4. Construct the updated `ScenarioStructureBSP` buffer (`replace` or `merge` mode)
  const getRefl = (decoded: Map<string, any>, key: string): { count: number; pointerLow: number } => {
    const f = decoded.get(key);
    return f && f.kind === 'reflexive' && f.value ? f.value : { count: 0, pointerLow: 0 };
  };
  const getBnds = (decoded: Map<string, any>, key: string): [number, number] => {
    const f = decoded.get(key);
    return f && f.kind === 'bounds' && Array.isArray(f.value) ? f.value : [0, 0];
  };

  const toRel = (ptr: number): number => ptr - baseAddress;
  const rootOff = loc.fileOffset - oldBspStart;
  const lmStructSize = 32;
  const matStructSize = 256;

  // Estimate working capacity for the new/merged BSP
  const extraCapacity =
    parsed.weldedVertexCount * 64 +
    parsed.totalTriangleCount * 16 +
    parsed.submeshChunks.length * 512 +
    compiledColl.bsp3dNodes.length * 16 +
    compiledColl.planes.length * 20 +
    compiledColl.leaves.length * 32 +
    compiledColl.bsp2dReferences.length * 16 +
    compiledColl.bsp2dNodes.length * 24 +
    compiledColl.surfaces.length * 16 +
    compiledColl.edges.length * 32 +
    compiledColl.vertices.length * 20 +
    8 * 1024 * 1024;
  const bspBuf = Buffer.alloc(oldBspSize + extraCapacity, 0);
  workMapBuf.copy(bspBuf, 0, oldBspStart, oldBspStart + oldBspSize);
  let cursor = (oldBspSize + 15) & ~15;

  const freeRanges: { start: number; end: number }[] = [];
  const markFreeRange = (relStart: number, byteLen: number): void => {
    if (byteLen < 32 || relStart < 0x280 || relStart + byteLen > oldBspSize) return;
    freeRanges.push({ start: relStart, end: relStart + byteLen });
  };
  const sliceAndReclaim = (relStart: number, byteLen: number): Buffer => {
    if (byteLen <= 0 || relStart < 0 || relStart + byteLen > oldBspSize) return Buffer.alloc(0);
    const copy = Buffer.from(bspBuf.subarray(relStart, relStart + byteLen));
    markFreeRange(relStart, byteLen);
    return copy;
  };

  // Extract a template 256-byte `ScenarioStructureBSPMaterial` from the donor BSP
  const oldLmRefl = getRefl(decodedBsp, 'lightmaps');
  const oldLmCount = oldLmRefl.count;
  const oldLmRel = toRel(oldLmRefl.pointerLow);
  const templateMatBuf = Buffer.alloc(matStructSize, 0);
  if (oldLmCount > 0 && oldLmRel >= 0 && oldLmRel + lmStructSize <= oldBspSize) {
    const firstMatsCount = bspBuf.readUInt32LE(oldLmRel + 0x14);
    const firstMatsPtr = bspBuf.readUInt32LE(oldLmRel + 0x18);
    const firstMatsRel = toRel(firstMatsPtr);
    if (firstMatsCount > 0 && firstMatsRel >= 0 && firstMatsRel + matStructSize <= oldBspSize) {
      bspBuf.copy(templateMatBuf, 0, firstMatsRel, firstMatsRel + matStructSize);
    }
  }

  const oldSurfacesRefl = getRefl(decodedBsp, 'surfaces');
  const oldSurfCount = injectionMode === 'merge' ? oldSurfacesRefl.count : 0;
  const oldSurfRel = toRel(oldSurfacesRefl.pointerLow);
  const oldSurfacesBuf = sliceAndReclaim(oldSurfRel, oldSurfacesRefl.count * 6);

  // In 'replace' mode, reclaim all old lightmaps, materials, and uncompressed vertex buffers
  if (injectionMode === 'replace' && oldLmCount > 0 && oldLmRel >= 0 && oldLmRel + oldLmCount * lmStructSize <= oldBspSize) {
    for (let i = 0; i < oldLmCount; i++) {
      const mCnt = bspBuf.readUInt32LE(oldLmRel + i * lmStructSize + 0x14);
      const mRel = toRel(bspBuf.readUInt32LE(oldLmRel + i * lmStructSize + 0x18));
      if (mCnt > 0 && mRel >= 0 && mRel + mCnt * matStructSize <= oldBspSize) {
        for (let j = 0; j < mCnt; j++) {
          const uSz = bspBuf.readUInt32LE(mRel + j * matStructSize + 0xd8);
          const uRel = toRel(bspBuf.readUInt32LE(mRel + j * matStructSize + 0xe4));
          markFreeRange(uRel, uSz);
        }
        markFreeRange(mRel, mCnt * matStructSize);
      }
    }
  }
  const oldLmBuf = sliceAndReclaim(oldLmRel, oldLmCount * lmStructSize);

  const clustersRefl = getRefl(decodedBsp, 'clusters');
  const clustersRel = clustersRefl.count > 0 ? toRel(clustersRefl.pointerLow) : -1;
  const oldScChunks: Buffer[] = [];
  if (clustersRel >= 0) {
    for (let c = 0; c < clustersRefl.count; c++) {
      const cEnt = clustersRel + c * 104;
      const scCnt = bspBuf.readUInt32LE(cEnt + 0x34);
      const scRel = toRel(bspBuf.readUInt32LE(cEnt + 0x38));
      if (scCnt > 0 && scRel >= 0 && scRel + scCnt * 36 <= oldBspSize) {
        if (injectionMode === 'replace') {
          for (let s = 0; s < scCnt; s++) {
            const siCnt = bspBuf.readUInt32LE(scRel + s * 36 + 0x18);
            const siRel = toRel(bspBuf.readUInt32LE(scRel + s * 36 + 0x1c));
            markFreeRange(siRel, siCnt * 4);
          }
          markFreeRange(scRel, scCnt * 36);
        } else {
          oldScChunks.push(sliceAndReclaim(scRel, scCnt * 36));
        }
      }
    }
  }
  const oldScBuf = oldScChunks.length > 0 ? Buffer.concat(oldScChunks) : Buffer.alloc(0);
  const oldScCount = Math.floor(oldScBuf.length / 36);

  const collRefl = getRefl(decodedBsp, 'collision bsp');
  const collRel = toRel(collRefl.pointerLow);
  const rawOldN3dCount = bspBuf.readUInt32LE(collRel + 0x00);
  const oldN3dBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x04)), rawOldN3dCount * 12);
  const rawOldPlnCount = bspBuf.readUInt32LE(collRel + 0x0c);
  const oldPlnBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x10)), rawOldPlnCount * 16);
  const rawOldLeafCount = bspBuf.readUInt32LE(collRel + 0x18);
  const oldLeafBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x1c)), rawOldLeafCount * 8);
  const rawOldRef2dCount = bspBuf.readUInt32LE(collRel + 0x24);
  const oldRef2dBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x28)), rawOldRef2dCount * 8);
  const rawOldNode2dCount = bspBuf.readUInt32LE(collRel + 0x30);
  const oldNode2dBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x34)), rawOldNode2dCount * 20);
  const rawOldCSurfCount = bspBuf.readUInt32LE(collRel + 0x3c);
  const oldCSurfBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x40)), rawOldCSurfCount * 12);
  const rawOldCEdgeCount = bspBuf.readUInt32LE(collRel + 0x48);
  const oldCEdgeBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x4c)), rawOldCEdgeCount * 24);
  const rawOldCVertCount = bspBuf.readUInt32LE(collRel + 0x54);
  const oldCVertBuf = sliceAndReclaim(toRel(bspBuf.readUInt32LE(collRel + 0x58)), rawOldCVertCount * 16);

  const sbspLeavesRefl = getRefl(decodedBsp, 'leaves');
  const oldSbspLeavesBuf = sliceAndReclaim(toRel(sbspLeavesRefl.pointerLow), sbspLeavesRefl.count * 16);

  if (injectionMode === 'replace') {
    const nodesRefl = getRefl(decodedBsp, 'nodes');
    markFreeRange(toRel(nodesRefl.pointerLow), nodesRefl.count * 6);
    const leafSurfRefl = getRefl(decodedBsp, 'leaf surfaces');
    markFreeRange(toRel(leafSurfRefl.pointerLow), leafSurfRefl.count * 8);
    const portalsRefl = getRefl(decodedBsp, 'cluster portals');
    markFreeRange(toRel(portalsRefl.pointerLow), portalsRefl.count * 64);
  }
  if (stripDobcAndDecals) {
    const dobcRefl = getRefl(decodedBsp, 'detail objects');
    markFreeRange(toRel(dobcRefl.pointerLow), dobcRefl.count * 64);
    const decalsRefl = getRefl(decodedBsp, 'runtime decals');
    markFreeRange(toRel(decalsRefl.pointerLow), decalsRefl.count * 16);
  }

  // Coalesce free ranges for best-fit allocation
  freeRanges.sort((a, b) => a.start - b.start);
  const mergedFreeRanges: { start: number; end: number }[] = [];
  for (const r of freeRanges) {
    const last = mergedFreeRanges[mergedFreeRanges.length - 1];
    if (last && r.start <= last.end + 16) {
      last.end = Math.max(last.end, r.end);
    } else {
      mergedFreeRanges.push({ ...r });
    }
  }

  const alloc = (byteLen: number): number => {
    const aligned = (Math.max(1, byteLen) + 15) & ~15;
    let bestIdx = -1;
    let bestRem = Infinity;
    for (let i = 0; i < mergedFreeRanges.length; i++) {
      const r = mergedFreeRanges[i]!;
      const aStart = (r.start + 15) & ~15;
      if (aStart + aligned <= r.end) {
        const rem = r.end - (aStart + aligned);
        if (rem < bestRem) {
          bestRem = rem;
          bestIdx = i;
        }
      }
    }
    if (bestIdx !== -1) {
      const r = mergedFreeRanges[bestIdx]!;
      const aStart = (r.start + 15) & ~15;
      r.start = aStart + aligned;
      if (r.end - r.start < 16) mergedFreeRanges.splice(bestIdx, 1);
      return aStart;
    }
    const out = cursor;
    cursor += aligned;
    return out;
  };

  // 4A. Build 56-byte uncompressed vertex buffers and 6-byte surface buffers for each `SubmeshChunk`
  interface BuiltSubmesh {
    shaderTagId: number;
    shaderPathPtr: number;
    shaderClassFourCC: number;
    vertBuf: Buffer;
    vertCount: number;
    surfBuf: Buffer;
    surfStart: number;
    surfCount: number;
    centroid: [number, number, number];
  }

  const builtSubmeshes: BuiltSubmesh[] = [];
  const triMetaForSubclusters: {
    surfIdx: number;
    cx: number;
    cy: number;
    cz: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  }[] = [];

  // Enforce Halo CE / OpenCE's hard `MAXIMUM_SURFACES_PER_STRUCTURE = 131,072` (0x20000) surface bitvector limit:
  // If the model has more than `128,000 - oldSurfCount` triangles (e.g. mega-levels like `jak.glb`),
  // automatically cull the smallest micro-detail/distant-backdrop triangles while preserving all major
  // terrain, floor, building, and structural surfaces and guaranteeing at least 8 triangles per submesh chunk.
  const maxAllowedNewSurfaces = Math.max(1000, 128000 - oldSurfCount);
  const rawTotalChunkTris = parsed.submeshChunks.reduce(
    (sum, c) => sum + Math.floor(c.indices.length / 3),
    0,
  );
  const chunkKeepMask = new Map<number, Uint8Array>();
  if (rawTotalChunkTris > maxAllowedNewSurfaces) {
    const scoredTris: { cIdx: number; tIdx: number; score: number }[] = [];
    for (let cIdx = 0; cIdx < parsed.submeshChunks.length; cIdx++) {
      const ch = parsed.submeshChunks[cIdx]!;
      const tCnt = Math.floor(ch.indices.length / 3);
      const mask = new Uint8Array(tCnt);
      mask.fill(1);
      chunkKeepMask.set(cIdx, mask);
      const minProtected = Math.min(tCnt, 8);
      for (let t = minProtected; t < tCnt; t++) {
        const i0 = ch.indices[t * 3 + 0]!;
        const i1 = ch.indices[t * 3 + 1]!;
        const i2 = ch.indices[t * 3 + 2]!;
        const x0 = ch.positions[i0 * 3 + 0]!,
          y0 = ch.positions[i0 * 3 + 1]!,
          z0 = ch.positions[i0 * 3 + 2]!;
        const x1 = ch.positions[i1 * 3 + 0]!,
          y1 = ch.positions[i1 * 3 + 1]!,
          z1 = ch.positions[i1 * 3 + 2]!;
        const x2 = ch.positions[i2 * 3 + 0]!,
          y2 = ch.positions[i2 * 3 + 1]!,
          z2 = ch.positions[i2 * 3 + 2]!;
        const dx = Math.max(x0, x1, x2) - Math.min(x0, x1, x2);
        const dy = Math.max(y0, y1, y2) - Math.min(y0, y1, y2);
        const dz = Math.max(z0, z1, z2) - Math.min(z0, z1, z2);
        const isWalkableSlab = !ch.isPassThrough && dz < 0.25 && dx * dy > 0.2;
        const weight = isWalkableSlab ? 8.0 : ch.isPassThrough ? 0.35 : 1.0;
        const score = (dx * dx + dy * dy + dz * dz) * weight;
        scoredTris.push({ cIdx, tIdx: t, score });
      }
    }
    scoredTris.sort((a, b) => a.score - b.score);
    const toDrop = rawTotalChunkTris - maxAllowedNewSurfaces;
    for (let d = 0; d < toDrop && d < scoredTris.length; d++) {
      const item = scoredTris[d]!;
      const mask = chunkKeepMask.get(item.cIdx);
      if (mask) mask[item.tIdx] = 0;
    }
  }

  let runningSurfCount = oldSurfCount;
  for (let chunkIdx = 0; chunkIdx < parsed.submeshChunks.length; chunkIdx++) {
    const chunk = parsed.submeshChunks[chunkIdx]!;
    const keepMask = chunkKeepMask.get(chunkIdx);
    const sh = materialShaderMap.get(chunk.materialIndex) ?? fallbackShader;
    const rawTriCount = Math.floor(chunk.indices.length / 3);
    let keptTriCount = rawTriCount;
    if (keepMask) {
      keptTriCount = 0;
      for (let t = 0; t < rawTriCount; t++) {
        if (keepMask[t]) keptTriCount++;
      }
    }
    if (keptTriCount === 0) continue;

    // Compact vertex buffer when triangles were culled by `keepMask`, and enforce `<= 32,766` vertices per submesh
    const origVCount = Math.floor(chunk.positions.length / 3);
    let vertRemap: Int32Array | null = null;
    let keptOrigVerts: number[] | null = null;
    if (keepMask) {
      vertRemap = new Int32Array(origVCount).fill(-1);
      keptOrigVerts = [];
      for (let t = 0; t < rawTriCount; t++) {
        if (!keepMask[t]) continue;
        for (let k = 0; k < 3; k++) {
          const ov = chunk.indices[t * 3 + k]!;
          if (vertRemap[ov] === -1) {
            vertRemap[ov] = keptOrigVerts.length;
            keptOrigVerts.push(ov);
          }
        }
      }
    }
    const vCount = keptOrigVerts ? keptOrigVerts.length : origVCount;
    const vBuf = Buffer.alloc(vCount * 56, 0);
    for (let v = 0; v < vCount; v++) {
      const srcV = keptOrigVerts ? keptOrigVerts[v]! : v;
      const pBase = srcV * 3;
      const uvBase = srcV * 2;
      const px = chunk.positions[pBase + 0]!;
      const py = chunk.positions[pBase + 1]!;
      const pz = chunk.positions[pBase + 2]!;
      const nx = chunk.normals[pBase + 0]!;
      const ny = chunk.normals[pBase + 1]!;
      const nz = chunk.normals[pBase + 2]!;
      const u = chunk.uvs[uvBase + 0]!;
      const vCoord = chunk.uvs[uvBase + 1]!;

      const refX = Math.abs(nz) < 0.9 ? 0 : 1;
      const refZ = Math.abs(nz) < 0.9 ? 1 : 0;
      let tx = -refZ * ny;
      let ty = refZ * nx - refX * nz;
      let tz = refX * ny;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      tx /= tLen;
      ty /= tLen;
      tz /= tLen;
      const bx = ny * tz - nz * ty;
      const by = nz * tx - nx * tz;
      const bz = nx * ty - ny * tx;

      const vo = v * 56;
      vBuf.writeFloatLE(px, vo + 0);
      vBuf.writeFloatLE(py, vo + 4);
      vBuf.writeFloatLE(pz, vo + 8);
      vBuf.writeFloatLE(nx, vo + 12);
      vBuf.writeFloatLE(ny, vo + 16);
      vBuf.writeFloatLE(nz, vo + 20);
      vBuf.writeFloatLE(bx, vo + 24);
      vBuf.writeFloatLE(by, vo + 28);
      vBuf.writeFloatLE(bz, vo + 32);
      vBuf.writeFloatLE(tx, vo + 36);
      vBuf.writeFloatLE(ty, vo + 40);
      vBuf.writeFloatLE(tz, vo + 44);
      vBuf.writeFloatLE(u, vo + 48);
      vBuf.writeFloatLE(vCoord, vo + 52);
    }

    const wantTwoSided =
      autoAlphaAndTwoSided && (chunk.doubleSided || chunk.isPassThrough);
    // In Halo CE's D3D9 shader_environment renderer, hardware backface culling (D3DCULL_CCW) is always active.
    // Emit back-face triangles (i0, i1, i2) alongside front-face triangles (i0, i2, i1) for two-sided/cutout
    // submeshes (matching tool.exe '%' material compilation) when total surfaces fit within Halo CE's 131,072 cap.
    const emitBackfaces =
      !keepMask && wantTwoSided && runningSurfCount + keptTriCount * 2 <= 128000;
    const emittedTriCount = emitBackfaces ? keptTriCount * 2 : keptTriCount;
    const sBuf = Buffer.alloc(emittedTriCount * 6);
    let localSurfWriteIdx = 0;
    for (let t = 0; t < rawTriCount; t++) {
      if (keepMask && !keepMask[t]) continue;
      const rawI0 = chunk.indices[t * 3 + 0]!;
      const rawI1 = chunk.indices[t * 3 + 1]!;
      const rawI2 = chunk.indices[t * 3 + 2]!;
      const i0 = vertRemap ? vertRemap[rawI0]! : rawI0;
      const i1 = vertRemap ? vertRemap[rawI1]! : rawI1;
      const i2 = vertRemap ? vertRemap[rawI2]! : rawI2;
      // Halo CE ScenarioStructureBSP render surfaces use Clockwise winding: (i0, i2, i1)
      sBuf.writeUInt16LE(i0, localSurfWriteIdx * 6 + 0);
      sBuf.writeUInt16LE(i2, localSurfWriteIdx * 6 + 2);
      sBuf.writeUInt16LE(i1, localSurfWriteIdx * 6 + 4);

      const x0 = chunk.positions[rawI0 * 3 + 0]!,
        y0 = chunk.positions[rawI0 * 3 + 1]!,
        z0 = chunk.positions[rawI0 * 3 + 2]!;
      const x1 = chunk.positions[rawI1 * 3 + 0]!,
        y1 = chunk.positions[rawI1 * 3 + 1]!,
        z1 = chunk.positions[rawI1 * 3 + 2]!;
      const x2 = chunk.positions[rawI2 * 3 + 0]!,
        y2 = chunk.positions[rawI2 * 3 + 1]!,
        z2 = chunk.positions[rawI2 * 3 + 2]!;
      const cx = (x0 + x1 + x2) / 3;
      const cy = (y0 + y1 + y2) / 3;
      const cz = (z0 + z1 + z2) / 3;
      const minX = Math.min(x0, x1, x2);
      const maxX = Math.max(x0, x1, x2);
      const minY = Math.min(y0, y1, y2);
      const maxY = Math.max(y0, y1, y2);
      const minZ = Math.min(z0, z1, z2);
      const maxZ = Math.max(z0, z1, z2);

      triMetaForSubclusters.push({
        surfIdx: runningSurfCount + localSurfWriteIdx,
        cx,
        cy,
        cz,
        minX,
        maxX,
        minY,
        maxY,
        minZ,
        maxZ,
      });
      localSurfWriteIdx++;

      if (emitBackfaces) {
        sBuf.writeUInt16LE(i0, localSurfWriteIdx * 6 + 0);
        sBuf.writeUInt16LE(i1, localSurfWriteIdx * 6 + 2);
        sBuf.writeUInt16LE(i2, localSurfWriteIdx * 6 + 4);
        triMetaForSubclusters.push({
          surfIdx: runningSurfCount + localSurfWriteIdx,
          cx,
          cy,
          cz,
          minX,
          maxX,
          minY,
          maxY,
          minZ,
          maxZ,
        });
        localSurfWriteIdx++;
      }
    }

    builtSubmeshes.push({
      shaderTagId: sh.tagId,
      shaderPathPtr: sh.pathPtr,
      shaderClassFourCC: sh.classFourCC,
      vertBuf: vBuf,
      vertCount: vCount,
      surfBuf: sBuf,
      surfStart: runningSurfCount,
      surfCount: emittedTriCount,
      centroid: chunk.centroid,
    });
    runningSurfCount += emittedTriCount;
  }

  // Write surfaces array
  const combinedSurfRel = alloc(runningSurfCount * 6);
  if (injectionMode === 'merge' && oldSurfacesBuf.length > 0) {
    oldSurfacesBuf.copy(bspBuf, combinedSurfRel);
  }
  let surfWriteOff = combinedSurfRel + oldSurfCount * 6;
  for (const sm of builtSubmeshes) {
    sm.surfBuf.copy(bspBuf, surfWriteOff);
    surfWriteOff += sm.surfBuf.length;
  }
  bspBuf.writeUInt32LE(runningSurfCount, rootOff + 0xf8);
  bspBuf.writeUInt32LE(baseAddress + combinedSurfRel, rootOff + 0xfc);

  // Write `ScenarioStructureBSPMaterial` entries + uncompressed vertex buffers
  const newMatsRel = alloc(builtSubmeshes.length * matStructSize);
  for (let i = 0; i < builtSubmeshes.length; i++) {
    const sm = builtSubmeshes[i]!;
    const mOff = newMatsRel + i * matStructSize;
    templateMatBuf.copy(bspBuf, mOff, 0, matStructSize);
    bspBuf.writeUInt32LE(sm.shaderClassFourCC >>> 0, mOff + 0x00);
    bspBuf.writeUInt32LE(sm.shaderPathPtr >>> 0, mOff + 0x04);
    bspBuf.writeUInt32LE(0, mOff + 0x08);
    bspBuf.writeUInt32LE(sm.shaderTagId >>> 0, mOff + 0x0c);
    bspBuf.writeInt16LE(0, mOff + 0x10);
    bspBuf.writeUInt16LE(0, mOff + 0x12);
    bspBuf.writeInt32LE(sm.surfStart, mOff + 0x14);
    bspBuf.writeInt32LE(sm.surfCount, mOff + 0x18);
    bspBuf.writeFloatLE(sm.centroid[0], mOff + 0x1c);
    bspBuf.writeFloatLE(sm.centroid[1], mOff + 0x20);
    bspBuf.writeFloatLE(sm.centroid[2], mOff + 0x24);
    bspBuf.writeInt16LE(-1, mOff + 0xac);

    const vRel = alloc(sm.vertBuf.length);
    sm.vertBuf.copy(bspBuf, vRel);
    bspBuf.writeUInt16LE(0, mOff + 0xb0);
    bspBuf.writeUInt32LE(sm.vertCount, mOff + 0xb4);
    bspBuf.writeUInt32LE(0, mOff + 0xb8);
    bspBuf.writeUInt32LE(0, mOff + 0xc8); // 0 lightmap vertices
    bspBuf.writeUInt32LE(sm.vertBuf.length, mOff + 0xd8);
    bspBuf.writeUInt32LE(0, mOff + 0xdc);
    bspBuf.writeUInt32LE(0, mOff + 0xe0);
    bspBuf.writeUInt32LE(baseAddress + vRel, mOff + 0xe4);
    bspBuf.fill(0, mOff + 0xec, mOff + 0x100);
  }

  // Write `ScenarioStructureBSPLightmap` (`bitmap = -1` for full-brightness diffuse rendering)
  const keptOldLmCount = injectionMode === 'merge' ? oldLmCount : 0;
  const newLmCount = keptOldLmCount + 1;
  const combinedLmRel = alloc(newLmCount * lmStructSize);
  if (injectionMode === 'merge' && oldLmBuf.length > 0) {
    oldLmBuf.copy(bspBuf, combinedLmRel);
  }
  const newLmOff = combinedLmRel + keptOldLmCount * lmStructSize;
  bspBuf.writeInt16LE(-1, newLmOff + 0x00); // bitmap = -1 (full-brightness diffuse mode)
  bspBuf.writeUInt16LE(0, newLmOff + 0x02);
  bspBuf.fill(0, newLmOff + 0x04, newLmOff + 0x14);
  bspBuf.writeUInt32LE(builtSubmeshes.length, newLmOff + 0x14);
  bspBuf.writeUInt32LE(baseAddress + newMatsRel, newLmOff + 0x18);
  bspBuf.writeUInt32LE(0, newLmOff + 0x1c);

  bspBuf.writeUInt32LE(newLmCount, rootOff + 0x104);
  bspBuf.writeUInt32LE(baseAddress + combinedLmRel, rootOff + 0x108);

  if (injectionMode === 'replace' && fullBrightnessLightmap) {
    // Clear `lightmaps bitmap` TagDependency at rootOff + 0x00 so OpenCE uses _rasterizer_lightmap_mode_no_lightmap
    bspBuf.writeUInt32LE(0, rootOff + 0x04);
    bspBuf.writeUInt32LE(0, rootOff + 0x08);
    bspBuf.writeUInt32LE(0xffffffff, rootOff + 0x0c);
  }

  const scaledBoundsTuple = toBoundsTuple(parsed.scaledBounds);
  const playableScaledBoundsTuple = toBoundsTuple(parsed.playableScaledBounds);

  // 4B. Partition triangles into spatially-sorted tight-AABB Subclusters in Cluster 0
  if (clustersRel >= 0 && triMetaForSubclusters.length > 0) {
    const spanX = scaledBoundsTuple[3] - scaledBoundsTuple[0];
    const spanY = scaledBoundsTuple[4] - scaledBoundsTuple[1];
    const primaryIsX = spanX >= spanY;
    const sortedTris = [...triMetaForSubclusters].sort((a, b) => {
      const pA = primaryIsX ? a.cx : a.cy;
      const pB = primaryIsX ? b.cx : b.cy;
      const bandA = Math.floor(pA / 12.0);
      const bandB = Math.floor(pB / 12.0);
      if (bandA !== bandB) return bandA - bandB;
      const sA = Math.floor((primaryIsX ? a.cy : a.cx) / 8.0);
      const sB = Math.floor((primaryIsX ? b.cy : b.cx) / 8.0);
      if (sA !== sB) return sA - sB;
      const zA = Math.floor(a.cz / 4.0);
      const zB = Math.floor(b.cz / 4.0);
      if (zA !== zB) return zA - zB;
      return pA - pB;
    });

    const maxNewSubclusters = Math.max(1, 3800 - oldScCount);
    const trisPerSc = Math.max(128, Math.ceil(sortedTris.length / maxNewSubclusters));
    const numNewSc = Math.ceil(sortedTris.length / trisPerSc);
    const totalScCount = oldScCount + numNewSc;

    const newScRel = alloc(totalScCount * 36);
    if (injectionMode === 'merge' && oldScBuf.length > 0) {
      oldScBuf.copy(bspBuf, newScRel);
    }
    const allSurfIndicesRel = alloc(sortedTris.length * 4);
    for (let sc = 0; sc < numNewSc; sc++) {
      const sStart = sc * trisPerSc;
      const sCount = Math.min(trisPerSc, sortedTris.length - sStart);
      const surfIndicesOff = allSurfIndicesRel + sStart * 4;
      let bMinX = Infinity,
        bMaxX = -Infinity;
      let bMinY = Infinity,
        bMaxY = -Infinity;
      let bMinZ = Infinity,
        bMaxZ = -Infinity;
      for (let s = 0; s < sCount; s++) {
        const tm = sortedTris[sStart + s]!;
        bspBuf.writeInt32LE(tm.surfIdx, surfIndicesOff + s * 4);
        if (tm.minX < bMinX) bMinX = tm.minX;
        if (tm.maxX > bMaxX) bMaxX = tm.maxX;
        if (tm.minY < bMinY) bMinY = tm.minY;
        if (tm.maxY > bMaxY) bMaxY = tm.maxY;
        if (tm.minZ < bMinZ) bMinZ = tm.minZ;
        if (tm.maxZ > bMaxZ) bMaxZ = tm.maxZ;
      }
      const scOff = newScRel + (oldScCount + sc) * 36;
      bspBuf.writeFloatLE(bMinX - 0.05, scOff + 0x00);
      bspBuf.writeFloatLE(bMaxX + 0.05, scOff + 0x04);
      bspBuf.writeFloatLE(bMinY - 0.05, scOff + 0x08);
      bspBuf.writeFloatLE(bMaxY + 0.05, scOff + 0x0c);
      bspBuf.writeFloatLE(bMinZ - 0.05, scOff + 0x10);
      bspBuf.writeFloatLE(bMaxZ + 0.05, scOff + 0x14);
      bspBuf.writeUInt32LE(sCount, scOff + 0x18);
      bspBuf.writeUInt32LE(baseAddress + surfIndicesOff, scOff + 0x1c);
      bspBuf.writeUInt32LE(0, scOff + 0x20);
    }

    bspBuf.writeInt16LE(-1, clustersRel + 0x0c);
    bspBuf.writeInt16LE(0, clustersRel + 0x0e);
    bspBuf.writeUInt32LE(totalScCount, clustersRel + 0x34);
    bspBuf.writeUInt32LE(baseAddress + newScRel, clustersRel + 0x38);
    bspBuf.writeUInt32LE(0, clustersRel + 0x3c);
    bspBuf.fill(0, clustersRel + 0x44, clustersRel + 0x68);
    for (let c = 1; c < clustersRefl.count; c++) {
      const cOff = clustersRel + c * 104;
      bspBuf.writeInt16LE(-1, cOff + 0x0c);
      bspBuf.writeInt16LE(0, cOff + 0x0e);
      bspBuf.writeUInt32LE(0, cOff + 0x34);
      bspBuf.writeUInt32LE(0, cOff + 0x38);
      bspBuf.writeUInt32LE(0, cOff + 0x3c);
      bspBuf.fill(0, cOff + 0x44, cOff + 0x68);
    }
    bspBuf.fill(0, rootOff + 0xbc, rootOff + 0xc8); // zero 3D render nodes
    bspBuf.fill(0, rootOff + 0xec, rootOff + 0xf8); // zero leaf surfaces
    bspBuf.fill(0, rootOff + 0x150, rootOff + 0x160); // zero cluster portals
    bspBuf.fill(0, rootOff + 0x1e4, rootOff + 0x1fc); // zero pathfinding surfaces & edges
    if (injectionMode === 'replace') {
      bspBuf.fill(0, rootOff + 0x128, rootOff + 0x134); // zero lens flare markers
      bspBuf.fill(0, rootOff + 0x168, rootOff + 0x174); // zero breakable surfaces
      bspBuf.fill(0, rootOff + 0x240, rootOff + 0x24c); // zero markers
    }

    // Fill PVS (`cluster data` at rootOff + 0x140) with 0xFF so Cluster 0 is visible everywhere
    const totalClusters = clustersRefl.count;
    const pvsBytesPerCluster = totalClusters > 0 ? Math.ceil(totalClusters / 32) * 4 : 4;
    const pvsTotalSize = Math.max(4, totalClusters * pvsBytesPerCluster);
    const pvsRel = alloc(pvsTotalSize);
    bspBuf.fill(0xff, pvsRel, pvsRel + pvsTotalSize);
    bspBuf.writeUInt32LE(pvsTotalSize, rootOff + 0x140);
    bspBuf.writeUInt32LE(baseAddress + pvsRel, rootOff + 0x14c);
  }

  // 4C. Write CollisionBSP (8 child arrays) and `ScenarioStructureBSPLeaf` array
  const oldN3dCount = injectionMode === 'merge' ? rawOldN3dCount : 0;
  const oldPlnCount = injectionMode === 'merge' ? rawOldPlnCount : 0;
  const oldLeafCount = injectionMode === 'merge' ? rawOldLeafCount : 0;
  const oldRef2dCount = injectionMode === 'merge' ? rawOldRef2dCount : 0;
  const oldNode2dCount = injectionMode === 'merge' ? rawOldNode2dCount : 0;
  const oldCSurfCount = injectionMode === 'merge' ? rawOldCSurfCount : 0;
  const oldCEdgeCount = injectionMode === 'merge' ? rawOldCEdgeCount : 0;
  const oldCVertCount = injectionMode === 'merge' ? rawOldCVertCount : 0;

  const bx = getBnds(decodedBsp, 'world bounds x');
  const by = getBnds(decodedBsp, 'world bounds y');
  const bz = getBnds(decodedBsp, 'world bounds z');

  const candidateBoxPlanes: { plane: [number, number, number, number]; needed: boolean }[] =
    injectionMode === 'merge' && oldN3dCount > 0
      ? [
          { plane: [1, 0, 0, scaledBoundsTuple[3] + 3.5], needed: bx[1] > scaledBoundsTuple[3] + 1.0 },
          { plane: [-1, 0, 0, -(scaledBoundsTuple[0] - 3.5)], needed: bx[0] < scaledBoundsTuple[0] - 1.0 },
          { plane: [0, 1, 0, scaledBoundsTuple[4] + 3.5], needed: by[1] > scaledBoundsTuple[4] + 1.0 },
          { plane: [0, -1, 0, -(scaledBoundsTuple[1] - 3.5)], needed: by[0] < scaledBoundsTuple[1] - 1.0 },
          { plane: [0, 0, 1, scaledBoundsTuple[5] + 5.0], needed: bz[1] > scaledBoundsTuple[5] + 1.0 },
          { plane: [0, 0, -1, -(scaledBoundsTuple[2] - 3.5)], needed: bz[0] < scaledBoundsTuple[2] - 1.0 },
        ]
      : [];
  const maxAllowedOldCopies =
    oldN3dCount > 0
      ? Math.max(1, Math.min(6, Math.floor((125000 - compiledColl.bsp3dNodes.length - 6) / oldN3dCount)))
      : 0;
  const neededPlanes = candidateBoxPlanes.filter((c) => c.needed).map((c) => c.plane);
  const boxPlanes: [number, number, number, number][] =
    injectionMode === 'merge' && oldN3dCount > 0
      ? (neededPlanes.length > 0 ? neededPlanes : [candidateBoxPlanes[0]!.plane]).slice(0, maxAllowedOldCopies)
      : [];

  const boxNodeCount = boxPlanes.length;
  const oldCopyCount = boxNodeCount;
  const oldNodeShift = boxNodeCount;
  const procNodeShift = boxNodeCount + oldCopyCount * oldN3dCount;
  const totalN3d = procNodeShift + compiledColl.bsp3dNodes.length;

  const boxPlaneShift = oldPlnCount;
  const procPlaneShift = oldPlnCount + boxPlanes.length;
  const totalPlanes = procPlaneShift + compiledColl.planes.length;

  const procLeafShift = oldLeafCount;
  const totalLeaves = oldLeafCount + compiledColl.leaves.length;

  const procRef2dShift = oldRef2dCount;
  const totalRef2d = oldRef2dCount + compiledColl.bsp2dReferences.length;

  const procNode2dShift = oldNode2dCount;
  const totalNode2d = oldNode2dCount + compiledColl.bsp2dNodes.length;

  const procSurfShift = oldCSurfCount;
  const totalCSurf = oldCSurfCount + compiledColl.surfaces.length;

  const procEdgeShift = oldCEdgeCount;
  const totalCEdge = oldCEdgeCount + compiledColl.edges.length;

  const procVertShift = oldCVertCount;
  const totalCVert = oldCVertCount + compiledColl.vertices.length;

  const newN3dRel = alloc(Math.max(1, totalN3d) * 12);
  const newPlnRel = alloc(Math.max(1, totalPlanes) * 16);
  const newLeafRel = alloc(Math.max(1, totalLeaves) * 8);
  const newRef2dRel = alloc(Math.max(1, totalRef2d) * 8);
  const newNode2dRel = alloc(Math.max(1, totalNode2d) * 20);
  const newCSurfRel = alloc(Math.max(1, totalCSurf) * 12);
  const newCEdgeRel = alloc(Math.max(1, totalCEdge) * 24);
  const newCVertRel = alloc(Math.max(1, totalCVert) * 16);
  const newSbspLeavesRel = alloc(Math.max(1, totalLeaves) * 16);

  // bsp3d_nodes (strict tree: each boxPlane `b` has its own dedicated shifted copy of `oldN3d` so no node is reached twice)
  for (let b = 0; b < boxNodeCount; b++) {
    const nOff = newN3dRel + b * 12;
    const copyRoot = oldNodeShift + b * oldN3dCount;
    bspBuf.writeInt32LE(boxPlaneShift + b, nOff + 0);
    bspBuf.writeInt32LE(b === boxNodeCount - 1 ? procNodeShift : b + 1, nOff + 4);
    bspBuf.writeInt32LE(copyRoot, nOff + 8);
  }
  for (let b = 0; b < oldCopyCount; b++) {
    const copyShift = oldNodeShift + b * oldN3dCount;
    for (let n = 0; n < oldN3dCount; n++) {
      const srcOff = n * 12;
      const dstOff = newN3dRel + (copyShift + n) * 12;
      const pl = oldN3dBuf.readInt32LE(srcOff + 0);
      const backC = oldN3dBuf.readInt32LE(srcOff + 4);
      const frontC = oldN3dBuf.readInt32LE(srcOff + 8);
      bspBuf.writeInt32LE(pl, dstOff + 0);
      bspBuf.writeInt32LE(backC >= 0 ? backC + copyShift : backC, dstOff + 4);
      bspBuf.writeInt32LE(frontC >= 0 ? frontC + copyShift : frontC, dstOff + 8);
    }
  }
  for (let n = 0; n < compiledColl.bsp3dNodes.length; n++) {
    const node = compiledColl.bsp3dNodes[n]!;
    const dstOff = newN3dRel + (procNodeShift + n) * 12;
    const rawPlane = node[0];
    const pSign = rawPlane & 0x80000000;
    const pIdx = ((rawPlane & 0x7fffffff) + procPlaneShift) | pSign;
    const mapProcChild = (ch: number): number => {
      const signed = ch | 0;
      if (signed === -1) return -1;
      if (signed < 0) return (((signed & 0x7fffffff) + procLeafShift) | 0x80000000) | 0;
      return signed + procNodeShift;
    };
    bspBuf.writeInt32LE(pIdx, dstOff + 0);
    bspBuf.writeInt32LE(mapProcChild(node[1]), dstOff + 4);
    bspBuf.writeInt32LE(mapProcChild(node[2]), dstOff + 8);
  }

  // planes
  if (oldPlnCount > 0 && oldPlnBuf.length > 0) {
    oldPlnBuf.copy(bspBuf, newPlnRel);
  }
  for (let b = 0; b < boxPlanes.length; b++) {
    const pOff = newPlnRel + (boxPlaneShift + b) * 16;
    bspBuf.writeFloatLE(boxPlanes[b]![0], pOff + 0);
    bspBuf.writeFloatLE(boxPlanes[b]![1], pOff + 4);
    bspBuf.writeFloatLE(boxPlanes[b]![2], pOff + 8);
    bspBuf.writeFloatLE(boxPlanes[b]![3], pOff + 12);
  }
  for (let p = 0; p < compiledColl.planes.length; p++) {
    const pl = compiledColl.planes[p]!;
    const pOff = newPlnRel + (procPlaneShift + p) * 16;
    bspBuf.writeFloatLE(pl[0], pOff + 0);
    bspBuf.writeFloatLE(pl[1], pOff + 4);
    bspBuf.writeFloatLE(pl[2], pOff + 8);
    bspBuf.writeFloatLE(pl[3], pOff + 12);
  }

  // collision leaves
  if (oldLeafCount > 0 && oldLeafBuf.length > 0) {
    oldLeafBuf.copy(bspBuf, newLeafRel);
  }
  for (let l = 0; l < compiledColl.leaves.length; l++) {
    const lf = compiledColl.leaves[l]!;
    const lOff = newLeafRel + (procLeafShift + l) * 8;
    bspBuf.writeUInt16LE(lf[0] & 0xffff, lOff + 0);
    bspBuf.writeUInt16LE(lf[1] & 0xffff, lOff + 2);
    bspBuf.writeInt32LE(lf[1] > 0 ? lf[2] + procRef2dShift : 0, lOff + 4);
  }

  // bsp2d_references
  if (oldRef2dCount > 0 && oldRef2dBuf.length > 0) {
    oldRef2dBuf.copy(bspBuf, newRef2dRel);
  }
  for (let r = 0; r < compiledColl.bsp2dReferences.length; r++) {
    const ref = compiledColl.bsp2dReferences[r]!;
    const rOff = newRef2dRel + (procRef2dShift + r) * 8;
    const rawPlane = ref[0] | 0;
    const pSign = rawPlane & 0x80000000;
    const pIdx = ((rawPlane & 0x7fffffff) + procPlaneShift) | pSign;
    const rawNode = ref[1] | 0;
    const mappedNode =
      rawNode < 0
        ? (((rawNode & 0x7fffffff) + procSurfShift) | 0x80000000) | 0
        : rawNode + procNode2dShift;
    bspBuf.writeInt32LE(pIdx, rOff + 0);
    bspBuf.writeInt32LE(mappedNode, rOff + 4);
  }

  // bsp2d_nodes
  if (oldNode2dCount > 0 && oldNode2dBuf.length > 0) {
    oldNode2dBuf.copy(bspBuf, newNode2dRel);
  }
  for (let n = 0; n < compiledColl.bsp2dNodes.length; n++) {
    const n2 = compiledColl.bsp2dNodes[n]!;
    const nOff = newNode2dRel + (procNode2dShift + n) * 20;
    const map2d = (ch: number): number => {
      const signed = ch | 0;
      if (signed === -1) return -1;
      if (signed < 0) return (((signed & 0x7fffffff) + procSurfShift) | 0x80000000) | 0;
      return signed + procNode2dShift;
    };
    bspBuf.writeFloatLE(n2.planeI, nOff + 0);
    bspBuf.writeFloatLE(n2.planeJ, nOff + 4);
    bspBuf.writeFloatLE(n2.planeD, nOff + 8);
    bspBuf.writeInt32LE(map2d(n2.leftChild), nOff + 12);
    bspBuf.writeInt32LE(map2d(n2.rightChild), nOff + 16);
  }

  // collision surfaces
  if (oldCSurfCount > 0 && oldCSurfBuf.length > 0) {
    oldCSurfBuf.copy(bspBuf, newCSurfRel);
  }
  for (let s = 0; s < compiledColl.surfaces.length; s++) {
    const sf = compiledColl.surfaces[s]!;
    const sOff = newCSurfRel + (procSurfShift + s) * 12;
    const rawPlane = sf.planeDesignator | 0;
    const pSign = rawPlane & 0x80000000;
    const pIdx = ((rawPlane & 0x7fffffff) + procPlaneShift) | pSign;
    bspBuf.writeInt32LE(pIdx, sOff + 0);
    bspBuf.writeInt32LE(sf.firstEdgeIndex + procEdgeShift, sOff + 4);
    bspBuf.writeUInt8(sf.flags & 0xff, sOff + 8);
    bspBuf.writeUInt8(0xff, sOff + 9);
    bspBuf.writeInt16LE(0, sOff + 10);
  }

  // collision edges
  if (oldCEdgeCount > 0 && oldCEdgeBuf.length > 0) {
    oldCEdgeBuf.copy(bspBuf, newCEdgeRel);
  }
  for (let e = 0; e < compiledColl.edges.length; e++) {
    const ed = compiledColl.edges[e]!;
    const eOff = newCEdgeRel + (procEdgeShift + e) * 24;
    bspBuf.writeInt32LE(ed.vertexIndices[0] + procVertShift, eOff + 0);
    bspBuf.writeInt32LE(ed.vertexIndices[1] + procVertShift, eOff + 4);
    bspBuf.writeInt32LE(
      ed.edgeIndices[0] >= 0 ? ed.edgeIndices[0] + procEdgeShift : e + procEdgeShift,
      eOff + 8,
    );
    bspBuf.writeInt32LE(
      ed.edgeIndices[1] >= 0 ? ed.edgeIndices[1] + procEdgeShift : e + procEdgeShift,
      eOff + 12,
    );
    bspBuf.writeInt32LE(
      ed.surfaceIndices[0] >= 0 ? ed.surfaceIndices[0] + procSurfShift : -1,
      eOff + 16,
    );
    bspBuf.writeInt32LE(
      ed.surfaceIndices[1] >= 0 ? ed.surfaceIndices[1] + procSurfShift : -1,
      eOff + 20,
    );
  }

  // collision vertices
  if (oldCVertCount > 0 && oldCVertBuf.length > 0) {
    oldCVertBuf.copy(bspBuf, newCVertRel);
  }
  for (let v = 0; v < compiledColl.vertices.length; v++) {
    const vt = compiledColl.vertices[v]!;
    const vOff = newCVertRel + (procVertShift + v) * 16;
    bspBuf.writeFloatLE(vt.point[0], vOff + 0);
    bspBuf.writeFloatLE(vt.point[1], vOff + 4);
    bspBuf.writeFloatLE(vt.point[2], vOff + 8);
    bspBuf.writeInt32LE(vt.firstEdgeIndex + procEdgeShift, vOff + 12);
  }

  // Update 96-byte CollisionBSP header
  bspBuf.writeUInt32LE(totalN3d, collRel + 0x00);
  bspBuf.writeUInt32LE(baseAddress + newN3dRel, collRel + 0x04);
  bspBuf.writeUInt32LE(totalPlanes, collRel + 0x0c);
  bspBuf.writeUInt32LE(baseAddress + newPlnRel, collRel + 0x10);
  bspBuf.writeUInt32LE(totalLeaves, collRel + 0x18);
  bspBuf.writeUInt32LE(baseAddress + newLeafRel, collRel + 0x1c);
  bspBuf.writeUInt32LE(totalRef2d, collRel + 0x24);
  bspBuf.writeUInt32LE(baseAddress + newRef2dRel, collRel + 0x28);
  bspBuf.writeUInt32LE(totalNode2d, collRel + 0x30);
  bspBuf.writeUInt32LE(baseAddress + newNode2dRel, collRel + 0x34);
  bspBuf.writeUInt32LE(totalCSurf, collRel + 0x3c);
  bspBuf.writeUInt32LE(baseAddress + newCSurfRel, collRel + 0x40);
  bspBuf.writeUInt32LE(totalCEdge, collRel + 0x48);
  bspBuf.writeUInt32LE(baseAddress + newCEdgeRel, collRel + 0x4c);
  bspBuf.writeUInt32LE(totalCVert, collRel + 0x54);
  bspBuf.writeUInt32LE(baseAddress + newCVertRel, collRel + 0x58);

  // ScenarioStructureBSPLeaf array (16 bytes per leaf, all mapped to Cluster 0)
  for (let l = 0; l < totalLeaves; l++) {
    const lOff = newSbspLeavesRel + l * 16;
    bspBuf.fill(0, lOff, lOff + 16);
    bspBuf.writeUInt8(255, lOff + 1);
    bspBuf.writeUInt8(255, lOff + 3);
    bspBuf.writeUInt8(255, lOff + 5);
    bspBuf.writeInt16LE(0, lOff + 8); // cluster = 0
  }
  bspBuf.writeUInt32LE(totalLeaves, rootOff + 0xe0);
  bspBuf.writeUInt32LE(baseAddress + newSbspLeavesRel, rootOff + 0xe4);

  // Strip DOBC & Runtime Decals if requested
  let strippedDobc = false;
  let strippedDecals = false;
  if (stripDobcAndDecals) {
    bspBuf.writeUInt32LE(0, rootOff + 0x24c);
    bspBuf.writeUInt32LE(0, rootOff + 0x250);
    bspBuf.writeUInt32LE(0, rootOff + 0x258);
    bspBuf.writeUInt32LE(0, rootOff + 0x25c);
    strippedDobc = true;
    strippedDecals = true;
  }

  // Update world bounds and vehicle floor/ceiling
  const finalBounds: [number, number, number, number, number, number] =
    injectionMode === 'merge'
      ? [
          Math.min(bx[0], scaledBoundsTuple[0] - 2),
          Math.min(by[0], scaledBoundsTuple[1] - 2),
          Math.min(bz[0], scaledBoundsTuple[2] - 2),
          Math.max(bx[1], scaledBoundsTuple[3] + 2),
          Math.max(by[1], scaledBoundsTuple[4] + 2),
          Math.max(bz[1], scaledBoundsTuple[5] + 2),
        ]
      : [
          scaledBoundsTuple[0] - 2,
          scaledBoundsTuple[1] - 2,
          scaledBoundsTuple[2] - 2,
          scaledBoundsTuple[3] + 2,
          scaledBoundsTuple[4] + 2,
          scaledBoundsTuple[5] + 2,
        ];
  bspBuf.writeFloatLE(finalBounds[0], rootOff + 0xc8);
  bspBuf.writeFloatLE(finalBounds[3], rootOff + 0xcc);
  bspBuf.writeFloatLE(finalBounds[1], rootOff + 0xd0);
  bspBuf.writeFloatLE(finalBounds[4], rootOff + 0xd4);
  bspBuf.writeFloatLE(finalBounds[2], rootOff + 0xd8);
  bspBuf.writeFloatLE(finalBounds[5], rootOff + 0xdc);
  bspBuf.writeFloatLE(finalBounds[2] - 5.0, rootOff + 0x10); // vehicle floor
  bspBuf.writeFloatLE(finalBounds[5] + 25.0, rootOff + 0x14); // vehicle ceiling

  // 5. Finalize BSP buffer & rebase pointers to the target cache ceiling
  const finalBspSize = (cursor + 511) & ~511;
  const finalBspBuf = Buffer.alloc(finalBspSize);
  bspBuf.copy(finalBspBuf, 0, 0, finalBspSize);

  const CE_STOCK_CEILING = 0x41b40000;
  const CE_EXTENDED_CEILING = 0x47e40000; // 0x40440000 + 0x07A00000 (122 MiB OpenCE lifted ceiling)
  const needsExtended =
    cacheCeilingMode === 'expanded_opence' ||
    header.tagDataSize + finalBspSize + 512_000 > 23 * 1024 * 1024;
  const ceiling = needsExtended ? CE_EXTENDED_CEILING : CE_STOCK_CEILING;
  const newBspAddress = (ceiling - finalBspSize) & ~511;
  rebaseStructureBspPointers(finalBspBuf, baseAddress, newBspAddress);

  // 6. Splice `finalBspBuf` into `workMapBuf` at `oldBspStart` and shift downstream offsets
  const delta = finalBspSize - oldBspSize;
  const newFileSize = workMapBuf.length + delta;
  let outMap: Buffer = Buffer.alloc(newFileSize);

  workMapBuf.copy(outMap, 0, 0, oldBspStart);
  finalBspBuf.copy(outMap, oldBspStart, 0, finalBspSize);
  workMapBuf.copy(outMap, oldBspStart + finalBspSize, oldBspStart + oldBspSize);

  outMap.writeUInt32LE(newFileSize >>> 0, 0x08);
  const oldTagDataOffset = workMapBuf.readUInt32LE(0x10);
  const newTagDataOffset = oldTagDataOffset + delta;
  outMap.writeUInt32LE(newTagDataOffset >>> 0, 0x10);

  if (header.engine !== 5 && newTagDataOffset + 0x28 <= outMap.length) {
    const oldModelDataOffset = workMapBuf.readUInt32LE(oldTagDataOffset + 0x14);
    if (oldModelDataOffset >= oldBspStart + oldBspSize) {
      outMap.writeUInt32LE((oldModelDataOffset + delta) >>> 0, newTagDataOffset + 0x14);
    }
  }

  const newBspArrayOffset = bspsArrayOffset + delta;
  for (let i = 0; i < bspsField.value.count; i++) {
    const eOff = newBspArrayOffset + i * scenarioBspSize;
    if (i === effectiveBspIdx) {
      outMap.writeUInt32LE(oldBspStart >>> 0, eOff + 0x00);
      outMap.writeUInt32LE(finalBspSize >>> 0, eOff + 0x04);
      outMap.writeUInt32LE(newBspAddress >>> 0, eOff + 0x08);
    } else {
      const otherStart = outMap.readUInt32LE(eOff + 0x00);
      if (otherStart >= oldBspStart + oldBspSize) {
        outMap.writeUInt32LE((otherStart + delta) >>> 0, eOff + 0x00);
      }
    }
  }

  shiftExistingRawDataOffsets(
    outMap,
    newTagDataOffset,
    tagIndex,
    oldBspStart + oldBspSize,
    delta,
  );

  const afterSplice = inspectCustomEditionMap(outMap);
  if (afterSplice.status === 'ok') {
    reinspected = afterSplice;
  }

  // Populate post-splice `pathPointer` (+0x04) on all TagDependency fields inside the spliced BSP
  {
    const identityTagIdMap = new Map<number, number>();
    for (const e of reinspected.tagIndex.entries) {
      if (e.tagId !== 0xffffffff) {
        identityTagIdMap.set(e.tagId, e.tagId);
        identityTagIdMap.set(e.index, e.tagId);
      }
    }
    const metaPointer = outMap.readUInt32LE(oldBspStart + 0);
    const bspRootOffset = oldBspStart + (metaPointer - newBspAddress);
    if (bspRootOffset >= oldBspStart && bspRootOffset < oldBspStart + finalBspSize) {
      rewriteBspDependencies(
        outMap,
        'ScenarioStructureBSP',
        bspRootOffset,
        oldBspStart,
        finalBspSize,
        newBspAddress,
        identityTagIdMap,
        new Set<number>(),
        reinspected.header.tagDataOffset,
      );
    }
  }

  // 7. Clear existing scenery placements if requested, and relocate player spawns/flags/equipment/vehicles onto solid ground
  let relocatedSpawns = 0;
  const latestTagDataOffset = reinspected.header.tagDataOffset;
  const latestBaseAddr = reinspected.tagIndex.baseMemoryAddress;
  const latestScnrEntry =
    reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];

  if (latestScnrEntry) {
    const latestScnrOffset =
      latestTagDataOffset +
      (latestScnrEntry.tagDataPointerOrResourceIndex - latestBaseAddr);

    if (clearExistingPlacements && injectionMode === 'replace') {
      // Clear placed scenery (+0x210), sound scenery (+0x2dc), light fixtures (+0x2c4), decals (+0x42c)
      const clearOffsets = [0x210, 0x2c4, 0x2dc, 0x42c];
      for (const off of clearOffsets) {
        outMap.writeUInt32LE(0, latestScnrOffset + off);
        outMap.writeUInt32LE(0, latestScnrOffset + off + 4);
      }
    }

    if (relocateGroundObjects) {
      const snapper = createGroundSnapper(
        parsed.solidRaycastTriangles,
        playableScaledBoundsTuple,
      );
      const latestDecodedScnr = decodeStruct(outMap, latestScnrOffset, 'Scenario');

      // Player starting locations (+0x354, 52B each)
      const spawnsRefl = latestDecodedScnr.get('player starting locations');
      if (spawnsRefl && spawnsRefl.kind === 'reflexive' && spawnsRefl.value.count > 0) {
        const spawnsOffset =
          latestTagDataOffset + (spawnsRefl.value.pointerLow - latestBaseAddr);
        for (let s = 0; s < spawnsRefl.value.count; s++) {
          const sOff = spawnsOffset + s * 52;
          const curX = outMap.readFloatLE(sOff + 0);
          const curY = outMap.readFloatLE(sOff + 4);
          const [nx, ny, gz] = snapper.snapXYToGround(curX, curY, s);
          outMap.writeFloatLE(nx, sOff + 0);
          outMap.writeFloatLE(ny, sOff + 4);
          outMap.writeFloatLE(gz + 0.3, sOff + 8);
          outMap.writeInt16LE(effectiveBspIdx, sOff + 18);
          relocatedSpawns++;
        }
      }

      // Netgame flags (+0x378, 148B each)
      const flagsRefl = decodeReflexive(outMap, latestScnrOffset + 0x378);
      if (flagsRefl.count > 0) {
        const flagsOffset = latestTagDataOffset + (flagsRefl.pointerLow - latestBaseAddr);
        for (let f = 0; f < flagsRefl.count; f++) {
          const fOff = flagsOffset + f * 148;
          const curX = outMap.readFloatLE(fOff + 0);
          const curY = outMap.readFloatLE(fOff + 4);
          const [nx, ny, gz] = snapper.snapXYToGround(curX, curY, f + 16);
          outMap.writeFloatLE(nx, fOff + 0);
          outMap.writeFloatLE(ny, fOff + 4);
          outMap.writeFloatLE(gz + 0.3, fOff + 8);
          relocatedSpawns++;
        }
      }

      // Netgame equipment (+0x384, 144B each, position at +64..+72)
      const equipRefl = latestDecodedScnr.get('netgame equipment');
      if (equipRefl && equipRefl.kind === 'reflexive' && equipRefl.value.count > 0) {
        const equipOffset =
          latestTagDataOffset + (equipRefl.value.pointerLow - latestBaseAddr);
        for (let e = 0; e < equipRefl.value.count; e++) {
          const eOff = equipOffset + e * 144;
          const curX = outMap.readFloatLE(eOff + 64);
          const curY = outMap.readFloatLE(eOff + 68);
          const [nx, ny, gz] = snapper.snapXYToGround(curX, curY, e + 32);
          outMap.writeFloatLE(nx, eOff + 64);
          outMap.writeFloatLE(ny, eOff + 68);
          outMap.writeFloatLE(gz + 0.35, eOff + 72);
          relocatedSpawns++;
        }
      }

      // Vehicles (+0x240, 120B each, position at +8..+16)
      const vehRefl = decodeReflexive(outMap, latestScnrOffset + 0x240);
      if (vehRefl.count > 0) {
        const vehOffset = latestTagDataOffset + (vehRefl.pointerLow - latestBaseAddr);
        for (let v = 0; v < vehRefl.count; v++) {
          const vOff = vehOffset + v * 120;
          const curX = outMap.readFloatLE(vOff + 8);
          const curY = outMap.readFloatLE(vOff + 12);
          const [nx, ny, gz] = snapper.snapXYToGround(curX, curY, v + 64);
          outMap.writeFloatLE(nx, vOff + 8);
          outMap.writeFloatLE(ny, vOff + 12);
          outMap.writeFloatLE(gz + 0.65, vOff + 16);
          relocatedSpawns++;
        }
      }

      // Scenery (+0x210, 72B each, position at +8..+16) if not cleared
      if (!clearExistingPlacements || injectionMode === 'merge') {
        const scenRefl = decodeReflexive(outMap, latestScnrOffset + 0x210);
        if (scenRefl.count > 0) {
          const scenOffset = latestTagDataOffset + (scenRefl.pointerLow - latestBaseAddr);
          for (let s = 0; s < scenRefl.count; s++) {
            const sOff = scenOffset + s * 72;
            const curX = outMap.readFloatLE(sOff + 8);
            const curY = outMap.readFloatLE(sOff + 12);
            const [nx, ny, gz] = snapper.snapXYToGround(curX, curY, s + 96);
            outMap.writeFloatLE(nx, sOff + 8);
            outMap.writeFloatLE(ny, sOff + 12);
            outMap.writeFloatLE(gz + 0.05, sOff + 16);
          }
        }
      }
    }
  }

  // 8. Optional scenario rename & Custom Edition header CRC32 recalculation
  if (options.newScenarioName && options.newScenarioName.trim().length > 0) {
    const nameStr = options.newScenarioName.trim().slice(0, 31);
    const nameBuf = Buffer.alloc(32, 0);
    nameBuf.write(nameStr, 'ascii');
    nameBuf.copy(outMap, 0x20);
  }

  try {
    const finalInspected = inspectCustomEditionMap(outMap);
    if (finalInspected.status === 'ok' && finalInspected.header.engine === 609) {
      const crc = computeCacheCrc32(
        outMap,
        ceCrcRegions(outMap, finalInspected.header, finalInspected.tagIndex),
      );
      outMap.writeUInt32LE(crc >>> 0, 0x64);
    }
  } catch {
    // Non-fatal if CRC calculation is skipped on non-CE header
  }

  return {
    ok: true,
    buffer: outMap,
    summary: {
      modelFileName: parsed.modelName,
      targetBspName: dstBsp.path,
      injectionMode,
      oldSize: targetMapBuffer.length,
      newSize: outMap.length,
      delta: outMap.length - targetMapBuffer.length,
      weldedVertices: parsed.weldedVertexCount,
      totalTriangles: parsed.totalTriangleCount,
      solidCollisionTriangles: parsed.solidTriangleCount,
      foliageTriangles: parsed.passThroughTriangleCount,
      submeshChunks: parsed.submeshChunks.length,
      injectedBitmaps,
      injectedShaders,
      collisionNodes3d: totalN3d,
      collisionSurfaces: totalCSurf,
      relocatedSpawns,
      strippedDobc,
      strippedDecals,
      newBspAddress,
      newBspSize: finalBspSize,
      worldBounds: finalBounds,
    },
  };
}
