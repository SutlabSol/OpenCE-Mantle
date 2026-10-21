import { decodeStruct, resolveStruct } from './definitions/engine';
import { locateStructureBsp } from './definitions/validate-tag';
import { inspectCustomEditionMap } from './open-map';
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { extractBspRenderMesh } from '../render/bsp-geometry';
import { extractTagSet } from './tag-extractor';
import type { RandomAccessFile } from './convert/resource-files';
import { serializeContainer, deserializeContainer } from './container';
import { planAddInjection, applyAddInjection, type InjectionPlan } from './tag-injector';
import { mergeStructureBsps, rebaseStructureBspPointers } from './bsp-merger';
import { decodeReflexive } from './definitions/codec';
import { resolveTagDataPointer } from './tag-index';
import { ensurePaletteEntry, appendReflexiveElements } from '../render/scenario-objects';

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
  importSceneryAndMachines?: boolean;
  importVehicles?: boolean;
  makeDoorsAutomatic?: boolean;
  filterObjectsToBspBounds?: boolean;
  clearExistingPlacements?: boolean;
  clearPlayerSpawns?: boolean;
  resourceFiles?: { bitmaps?: RandomAccessFile; sounds?: RandomAccessFile };
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

  // Determine whether this is a single BSP swap or a multi-BSP merger
  let srcBspData: Buffer;
  let srcBspSize: number;
  let srcBspAddress: number;
  let srcBspName: string;
  let srcWorldBounds: [number, number, number, number, number, number];

  if (srcIndices.length > 1) {
    const merged = mergeStructureBsps(sourceBuffer, srcIndices);
    srcBspData = merged.bspBuffer;
    srcBspSize = merged.bspSize;
    srcBspAddress = merged.bspAddress;
    srcBspName = merged.mergedBspNames.join(' + ');
    srcWorldBounds = merged.worldBounds;
  } else {
    srcBspData = Buffer.from(sourceBuffer.subarray(srcBsp.bspStart, srcBsp.bspStart + srcBsp.bspSize));
    srcBspSize = srcBsp.bspSize;
    srcBspAddress = srcBsp.bspAddress;
    const CE_BSP_CACHE_CEILING = 0x41b40000;
    if (srcBspAddress + srcBspSize > CE_BSP_CACHE_CEILING) {
      const rebasedAddr = (CE_BSP_CACHE_CEILING - srcBspSize) & ~511;
      rebaseStructureBspPointers(srcBspData, srcBspAddress, rebasedAddr);
      srcBspAddress = rebasedAddr;
    }
    srcBspName = srcBsp.path;
    srcWorldBounds = srcBsp.worldBounds;
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
  const { header, tagIndex } = targetInspected;
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
    const shouldImportObjects = Boolean(options.importSceneryAndMachines);
    const shouldImportVehicles = Boolean(options.importVehicles);
    const srcTagIndex = sourceInspected.tagIndex;
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
          if (
            idx < srcTagIndex.entries.length &&
            srcTagIndex.entries[idx].primaryClassName !== '' &&
            srcTagIndex.entries[idx].primaryClassName !== 'sbsp' &&
            srcTagIndex.entries[idx].primaryClassName !== 'scenario_structure_bsp'
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

      if (shouldImportObjects || shouldImportVehicles) {
        if (srcScnrOffset > 0) {
          if (shouldImportObjects) {
            // Scenery palette (0x21c) and scenery placements (0x210)
            const scenPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x21c);
            srcSceneryPalCount = scenPalRefl.count;
            if (scenPalRefl.count > 0) {
              srcSceneryPalOffset = sourceInspected.header.tagDataOffset + (scenPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < scenPalRefl.count; i++) {
                const tagId = sourceBuffer.readUInt32LE(srcSceneryPalOffset + i * 48 + 12);
                if (tagId !== 0xffffffff && (tagId & 0xffff) < srcTagIndex.entries.length) {
                  rootIndicesSet.add(tagId & 0xffff);
                }
              }
            }

            const scenRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x210);
            srcPlacedSceneryCount = scenRefl.count;
            if (scenRefl.count > 0) {
              srcPlacedSceneryOffset = sourceInspected.header.tagDataOffset + (scenRefl.pointerLow - srcTagIndex.baseMemoryAddress);
            }
          }

          if (shouldImportVehicles) {
            // Vehicle palette (0x24c) and vehicle placements (0x240)
            const vehPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x24c);
            srcVehiclePalCount = vehPalRefl.count;
            if (vehPalRefl.count > 0) {
              srcVehiclePalOffset = sourceInspected.header.tagDataOffset + (vehPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < vehPalRefl.count; i++) {
                const tagId = sourceBuffer.readUInt32LE(srcVehiclePalOffset + i * 48 + 12);
                if (tagId !== 0xffffffff && (tagId & 0xffff) < srcTagIndex.entries.length) {
                  rootIndicesSet.add(tagId & 0xffff);
                }
              }
            }

            const vehRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x240);
            srcPlacedVehiclesCount = vehRefl.count;
            if (vehRefl.count > 0) {
              srcPlacedVehiclesOffset = sourceInspected.header.tagDataOffset + (vehRefl.pointerLow - srcTagIndex.baseMemoryAddress);
            }
          }

          if (shouldImportObjects) {
            // Machine palette (0x2a0) and machine placements (0x294)
            const machPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x2a0);
            srcMachinePalCount = machPalRefl.count;
            if (machPalRefl.count > 0) {
              srcMachinePalOffset = sourceInspected.header.tagDataOffset + (machPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < machPalRefl.count; i++) {
                const tagId = sourceBuffer.readUInt32LE(srcMachinePalOffset + i * 48 + 12);
                if (tagId !== 0xffffffff && (tagId & 0xffff) < srcTagIndex.entries.length) {
                  rootIndicesSet.add(tagId & 0xffff);
                }
              }
            }

            const machRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x294);
            srcPlacedMachinesCount = machRefl.count;
            if (machRefl.count > 0) {
              srcPlacedMachinesOffset = sourceInspected.header.tagDataOffset + (machRefl.pointerLow - srcTagIndex.baseMemoryAddress);
            }
          }
        }
      }

      const rootIndices = Array.from(rootIndicesSet);
      if (rootIndices.length > 0) {
        try {
          const extracted = extractTagSet(sourceBuffer, sourceInspected.header, srcTagIndex, rootIndices, {
            resourceFiles: options.resourceFiles,
          });
          if (extracted.tags.length > 0) {
            const containerBuf = serializeContainer(extracted, 'harvested_bsp_assets');
            const container = deserializeContainer(containerBuf);

            const planResult = planAddInjection(
              { buffer: out, header: reinspected.header, tagIndex: reinspected.tagIndex },
              container,
              {},
              { allowEmbeddedRelocation: true, allowGbxmodelGeometryRelocation: true },
            );

            if (planResult.kind !== 'refused') {
              const plan = planResult as InjectionPlan;
              out = applyAddInjection(
                out,
                reinspected.header,
                reinspected.tagIndex,
                container,
                plan,
                { allowEmbeddedRelocation: true, allowGbxmodelGeometryRelocation: true },
              );
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
            }
          }
        } catch {
          // If harvesting encounters an issue with any one tag, proceed with geometry swap
        }
      }

      // Optionally clear existing placements from target map (scenery, vehicles, equipment, weapons, etc.)
      if (options.clearExistingPlacements) {
        const targetScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
        if (targetScnrEntry) {
          const curScnrOff = resolveTagDataPointer(
            targetScnrEntry.tagDataPointerOrResourceIndex,
            reinspected.header,
            reinspected.tagIndex.baseMemoryAddress,
          );
          const clearOffsets = [0x210, 0x228, 0x240, 0x258, 0x270, 0x294, 0x2ac, 0x2c4, 0x2dc, 0x360, 0x378, 0x384, 0x3a8, 0x42c];
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
          const spawnClearOffsets = [0x348, 0x354, 0x390];
          for (const off of spawnClearOffsets) {
            out.writeUInt32LE(0, curScnrOff + off);
            out.writeUInt32LE(0, curScnrOff + off + 4);
          }
        }
      }

      // Import donor player starting locations (or ensure at least one valid spawn in new BSP)
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
          const [minX, minY, minZ, maxX, maxY, maxZ] = srcWorldBounds;

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
                  spawnBuf.writeInt16LE(dstIdx, 18); // Map to target BSP index
                  if (spawnBuf.readInt16LE(20) === 0) {
                    spawnBuf.writeInt16LE(12, 20); // type 0 = 12 (all games) so campaign spawns work in MP
                  }
                  importedSpawns.push(spawnBuf);
                }
              }
            }
          }

          if (importedSpawns.length === 0) {
            const fallback = Buffer.alloc(52);
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;
            const groundZ = minZ + 1.0;
            fallback.writeFloatLE(midX, 0);
            fallback.writeFloatLE(midY, 4);
            fallback.writeFloatLE(groundZ, 8);
            fallback.writeFloatLE(0, 12); // facing
            fallback.writeInt16LE(0, 16); // team
            fallback.writeInt16LE(dstIdx, 18); // bsp index
            fallback.writeInt16LE(12, 20); // type 0 = 12 (all games)
            importedSpawns.push(fallback);
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

            // Also ensure multiplayer netgame flags (0x36c) has spawn points if cleared/empty
            const netgameFlagsCount = out.readUInt32LE(curScnrOff + 0x36c);
            if (netgameFlagsCount === 0) {
              const importedFlags: Buffer[] = [];
              for (const sp of importedSpawns) {
                const flag = Buffer.alloc(148);
                sp.copy(flag, 0, 0, 12); // position
                sp.copy(flag, 12, 12, 16); // facing
                flag.writeInt16LE(0, 16); // type 0 = mp spawn point
                flag.writeInt16LE(0, 18); // team
                importedFlags.push(flag);
              }
              if (importedFlags.length > 0) {
                const flagRes = appendReflexiveElements(
                  out,
                  reinspected.header,
                  reinspected.tagIndex,
                  curScnrOff + 0x36c,
                  Buffer.concat(importedFlags),
                  importedFlags.length,
                );
                out = flagRes.buffer;
                reinspected.header = flagRes.header;
              }
            }
          }
        }
      }

      // Import Scenery, Vehicles, and Doors into target scenario
      if (shouldImportObjects || shouldImportVehicles) {
        const targetScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
        if (targetScnrEntry) {
          const [minX, minY, minZ, maxX, maxY, maxZ] = srcWorldBounds;
          // 1. Scenery Palette & Placed Scenery
          if (shouldImportObjects && srcSceneryPalCount > 0 && srcPlacedSceneryCount > 0) {
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
            for (let i = 0; i < srcPlacedSceneryCount; i++) {
              const sOff = srcPlacedSceneryOffset + i * 72;
              const donorPalIdx = sourceBuffer.readInt16LE(sOff + 0);
              const targetPalIdx = donorToTargetScenPal.get(donorPalIdx);
              if (targetPalIdx !== undefined) {
                if (options.filterObjectsToBspBounds) {
                  const posX = sourceBuffer.readFloatLE(sOff + 8);
                  const posY = sourceBuffer.readFloatLE(sOff + 12);
                  const posZ = sourceBuffer.readFloatLE(sOff + 16);
                  const margin = 20.0;
                  if (
                    posX < minX - margin || posX > maxX + margin ||
                    posY < minY - margin || posY > maxY + margin ||
                    posZ < minZ - margin || posZ > maxZ + margin
                  ) {
                    continue;
                  }
                }
                const sBytes = Buffer.alloc(72);
                sourceBuffer.copy(sBytes, 0, sOff, sOff + 72);
                sBytes.writeInt16LE(targetPalIdx, 0);
                sBytes.writeInt16LE(-1, 2);
                validPlaced.push(sBytes);
              }
            }

            if (validPlaced.length > 0) {
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
                Buffer.concat(validPlaced),
                validPlaced.length,
              );
              out = appendRes.buffer;
              reinspected.header = appendRes.header;
              importedScenery = validPlaced.length;
            }
          }

          // 2. Vehicle Palette & Placed Vehicles
          if (shouldImportVehicles && srcVehiclePalCount > 0 && srcPlacedVehiclesCount > 0) {
            const donorToTargetVehPal = new Map<number, number>();
            for (let i = 0; i < srcVehiclePalCount; i++) {
              const entryOff = srcVehiclePalOffset + i * 48;
              const donorTagId = sourceBuffer.readUInt32LE(entryOff + 12);
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
            for (let i = 0; i < srcPlacedVehiclesCount; i++) {
              const vOff = srcPlacedVehiclesOffset + i * 120;
              const donorPalIdx = sourceBuffer.readInt16LE(vOff + 0);
              const targetPalIdx = donorToTargetVehPal.get(donorPalIdx);
              if (targetPalIdx !== undefined) {
                if (options.filterObjectsToBspBounds) {
                  const posX = sourceBuffer.readFloatLE(vOff + 8);
                  const posY = sourceBuffer.readFloatLE(vOff + 12);
                  const posZ = sourceBuffer.readFloatLE(vOff + 16);
                  const margin = 20.0;
                  if (
                    posX < minX - margin || posX > maxX + margin ||
                    posY < minY - margin || posY > maxY + margin ||
                    posZ < minZ - margin || posZ > maxZ + margin
                  ) {
                    continue;
                  }
                }
                const vBytes = Buffer.alloc(120);
                sourceBuffer.copy(vBytes, 0, vOff, vOff + 120);
                vBytes.writeInt16LE(targetPalIdx, 0);
                vBytes.writeInt16LE(-1, 2);
                vBytes.writeUInt16LE(0, 4); // not placed = 0 (spawn immediately)
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
          if (shouldImportObjects && srcMachinePalCount > 0 && srcPlacedMachinesCount > 0) {
            const donorToTargetMachPal = new Map<number, number>();
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
              }
            }

            const validMachPlaced: Buffer[] = [];
            const makeAutomatic = options.makeDoorsAutomatic !== false;
            for (let i = 0; i < srcPlacedMachinesCount; i++) {
              const mOff = srcPlacedMachinesOffset + i * 64;
              const donorPalIdx = sourceBuffer.readInt16LE(mOff + 0);
              const targetPalIdx = donorToTargetMachPal.get(donorPalIdx);
              if (targetPalIdx !== undefined) {
                if (options.filterObjectsToBspBounds) {
                  const posX = sourceBuffer.readFloatLE(mOff + 8);
                  const posY = sourceBuffer.readFloatLE(mOff + 12);
                  const posZ = sourceBuffer.readFloatLE(mOff + 16);
                  const margin = 20.0;
                  if (
                    posX < minX - margin || posX > maxX + margin ||
                    posY < minY - margin || posY > maxY + margin ||
                    posZ < minZ - margin || posZ > maxZ + margin
                  ) {
                    continue;
                  }
                }
                const mBytes = Buffer.alloc(64);
                sourceBuffer.copy(mBytes, 0, mOff, mOff + 64);
                mBytes.writeInt16LE(targetPalIdx, 0);
                mBytes.writeInt16LE(-1, 2);
                mBytes.writeInt16LE(-1, 40);
                mBytes.writeInt16LE(-1, 42);
                if (makeAutomatic) {
                  let devFlags = mBytes.readUInt32LE(44);
                  devFlags &= ~1;
                  mBytes.writeUInt32LE(devFlags, 44);
                  let machFlags = mBytes.readUInt32LE(48);
                  machFlags &= ~1;
                  mBytes.writeUInt32LE(machFlags, 48);
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
      strippedDecals = true;
    }
  }

  // 6. Relocate player spawns and netgame equipment if requested
  let relocatedSpawns = 0;
  if (options.relocateGroundObjects ?? true) {
    const minX = srcWorldBounds[0];
    const minY = srcWorldBounds[1];
    const minZ = srcWorldBounds[2];
    const maxX = srcWorldBounds[3];
    const maxY = srcWorldBounds[4];
    const maxZ = srcWorldBounds[5];
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
  }

  return {
    ok: true,
    buffer: out,
    summary: {
      sourceBspName: srcBspName,
      targetBspName: dstBsp.path,
      oldSize: targetBuffer.length,
      newSize: out.length,
      delta,
      strippedDobc,
      strippedDecals,
      relocatedSpawns,
      harvestedShaders,
      harvestedBitmaps,
      importedScenery,
      importedVehicles,
      importedMachines,
    },
  };
}
