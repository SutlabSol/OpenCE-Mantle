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
              const entryOff = tagDataOffset + 0x28 + (mapped & 0xffff) * 32;
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
      ? 128 * 1024 * 1024 // 128 MiB OpenCE extended tag/BSP cache
      : 23 * 1024 * 1024; // 23 MiB Standard Halo CE tag/BSP cache
    const safeMaxBspBytes = useExpandedEngineLimits
      ? Math.min(
          116 * 1024 * 1024,
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
        ? 0x48440000
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
          : 0x48440000;
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
        const sbspEntryOff = curTagOff + 0x28 + (newSbspTagId & 0xffff) * 32;
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
