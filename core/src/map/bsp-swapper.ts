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
  importAiAndScripts?: boolean;
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
    importedEncounters?: number;
    importedTriggers?: number;
    importedScripts?: number;
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
        const mapped = tagIdMap.get(oldTagId) ?? tagIdMap.get(oldTagId & 0xffff);
        if (mapped !== undefined) {
          buffer.writeUInt32LE(mapped, fieldOffset + 12);
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
                rewriteBspDependencies(
                  buffer,
                  field.def.struct,
                  childArrayOffset + i * childSize,
                  bspStart,
                  bspSize,
                  bspAddress,
                  tagIdMap,
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
                if (mOffset + 20 <= buffer.length) {
                  const curSampleOff = buffer.readUInt32LE(mOffset + 12);
                  if (curSampleOff >= cutoffOffset && curSampleOff !== 0xffffffff) {
                    buffer.writeUInt32LE(curSampleOff + delta, mOffset + 12);
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

function appendDataBlock(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  data: Buffer,
): { buffer: Buffer; header: CacheFileHeader; virtualAddress: number; fileOffset: number } {
  if (data.length === 0) {
    return { buffer, header, virtualAddress: 0, fileOffset: 0 };
  }
  const alignedPad = (4 - (buffer.length % 4)) % 4;
  const padBuffer = alignedPad > 0 ? Buffer.alloc(alignedPad, 0) : Buffer.alloc(0);
  const fileOffset = buffer.length + padBuffer.length;
  const virtualAddress = tagIndex.baseMemoryAddress + (fileOffset - header.tagDataOffset);

  const newBuffer = Buffer.concat([buffer, padBuffer, data]);
  const newHeader: CacheFileHeader = {
    ...header,
    tagDataSize: newBuffer.length - header.tagDataOffset,
    decompressedFileSize: newBuffer.length,
  };
  newBuffer.writeUInt32LE(newBuffer.length, 0x08);
  newBuffer.writeUInt32LE(newHeader.tagDataSize, 0x14);
  return { buffer: newBuffer, header: newHeader, virtualAddress, fileOffset };
}

function cloneEncounterWithChildReflexives(
  encSourceBytes: Buffer,
  sourceBuffer: Buffer,
  srcHdr: CacheFileHeader,
  srcTagIndex: TagIndex,
  currentOut: Buffer,
  currentHdr: CacheFileHeader,
  currentTagIndex: TagIndex,
  donorToTargetActorPal: Map<number, number>,
  dstBspIdx: number,
): { buffer: Buffer; header: CacheFileHeader; encounterBytes: Buffer } {
  let curOut = currentOut;
  let curHdr = currentHdr;

  const encCopy = Buffer.alloc(176);
  encSourceBytes.copy(encCopy);

  encCopy.writeInt16LE(dstBspIdx, 0x2a); // manual bsp index
  encCopy.writeInt16LE(dstBspIdx, 0x7e); // precomputed bsp index

  // 1. Squads
  const sqCount = encSourceBytes.readUInt32LE(0x80);
  const sqPtr = encSourceBytes.readUInt32LE(0x84);
  if (sqCount > 0 && sqPtr !== 0) {
    const sqSrcBase = resolvePointer(sqPtr, srcHdr.tagDataOffset, srcTagIndex.baseMemoryAddress);
    const clonedSquads: Buffer[] = [];

    for (let s = 0; s < sqCount; s++) {
      const sqSrcOff = sqSrcBase + s * 232;
      const sqBytes = Buffer.alloc(232);
      sourceBuffer.copy(sqBytes, 0, sqSrcOff, sqSrcOff + 232);

      const donorActorType = sqBytes.readInt16LE(0x20);
      if (donorActorType >= 0 && donorToTargetActorPal.has(donorActorType)) {
        sqBytes.writeInt16LE(donorToTargetActorPal.get(donorActorType)!, 0x20);
      }

      // Move positions
      const moveCount = sourceBuffer.readUInt32LE(sqSrcOff + 0xc4);
      const movePtr = sourceBuffer.readUInt32LE(sqSrcOff + 0xc8);
      if (moveCount > 0 && movePtr !== 0) {
        const moveSrcOff = resolvePointer(movePtr, srcHdr.tagDataOffset, srcTagIndex.baseMemoryAddress);
        const moveData = Buffer.alloc(moveCount * 64);
        sourceBuffer.copy(moveData, 0, moveSrcOff, moveSrcOff + moveData.length);
        const appRes = appendDataBlock(curOut, curHdr, currentTagIndex, moveData);
        curOut = appRes.buffer;
        curHdr = appRes.header;
        sqBytes.writeUInt32LE(moveCount, 0xc4);
        sqBytes.writeUInt32LE(appRes.virtualAddress, 0xc8);
      } else {
        sqBytes.writeUInt32LE(0, 0xc4);
        sqBytes.writeUInt32LE(0, 0xc8);
      }

      // Starting locations
      const locCount = sourceBuffer.readUInt32LE(sqSrcOff + 0xd0);
      const locPtr = sourceBuffer.readUInt32LE(sqSrcOff + 0xd4);
      if (locCount > 0 && locPtr !== 0) {
        const locSrcOff = resolvePointer(locPtr, srcHdr.tagDataOffset, srcTagIndex.baseMemoryAddress);
        const locData = Buffer.alloc(locCount * 28);
        sourceBuffer.copy(locData, 0, locSrcOff, locSrcOff + locData.length);
        for (let l = 0; l < locCount; l++) {
          const lActorType = locData.readInt16LE(l * 28 + 24);
          if (lActorType >= 0 && donorToTargetActorPal.has(lActorType)) {
            locData.writeInt16LE(donorToTargetActorPal.get(lActorType)!, l * 28 + 24);
          }
        }
        const appRes = appendDataBlock(curOut, curHdr, currentTagIndex, locData);
        curOut = appRes.buffer;
        curHdr = appRes.header;
        sqBytes.writeUInt32LE(locCount, 0xd0);
        sqBytes.writeUInt32LE(appRes.virtualAddress, 0xd4);
      } else {
        sqBytes.writeUInt32LE(0, 0xd0);
        sqBytes.writeUInt32LE(0, 0xd4);
      }

      clonedSquads.push(sqBytes);
    }

    const allSquadsData = Buffer.concat(clonedSquads);
    const sqAppRes = appendDataBlock(curOut, curHdr, currentTagIndex, allSquadsData);
    curOut = sqAppRes.buffer;
    curHdr = sqAppRes.header;
    encCopy.writeUInt32LE(sqCount, 0x80);
    encCopy.writeUInt32LE(sqAppRes.virtualAddress, 0x84);
  } else {
    encCopy.writeUInt32LE(0, 0x80);
    encCopy.writeUInt32LE(0, 0x84);
  }

  // 2. Platoons
  const plCount = encSourceBytes.readUInt32LE(0x8c);
  const plPtr = encSourceBytes.readUInt32LE(0x90);
  if (plCount > 0 && plPtr !== 0) {
    const plSrcBase = resolvePointer(plPtr, srcHdr.tagDataOffset, srcTagIndex.baseMemoryAddress);
    const plData = Buffer.alloc(plCount * 172);
    sourceBuffer.copy(plData, 0, plSrcBase, plSrcBase + plData.length);
    const plAppRes = appendDataBlock(curOut, curHdr, currentTagIndex, plData);
    curOut = plAppRes.buffer;
    curHdr = plAppRes.header;
    encCopy.writeUInt32LE(plCount, 0x8c);
    encCopy.writeUInt32LE(plAppRes.virtualAddress, 0x90);
  } else {
    encCopy.writeUInt32LE(0, 0x8c);
    encCopy.writeUInt32LE(0, 0x90);
  }

  // 3. Firing Positions
  const fpCount = encSourceBytes.readUInt32LE(0x98);
  const fpPtr = encSourceBytes.readUInt32LE(0x9c);
  if (fpCount > 0 && fpPtr !== 0) {
    const fpSrcBase = resolvePointer(fpPtr, srcHdr.tagDataOffset, srcTagIndex.baseMemoryAddress);
    const fpData = Buffer.alloc(fpCount * 24);
    sourceBuffer.copy(fpData, 0, fpSrcBase, fpSrcBase + fpData.length);
    const fpAppRes = appendDataBlock(curOut, curHdr, currentTagIndex, fpData);
    curOut = fpAppRes.buffer;
    curHdr = fpAppRes.header;
    encCopy.writeUInt32LE(fpCount, 0x98);
    encCopy.writeUInt32LE(fpAppRes.virtualAddress, 0x9c);
  } else {
    encCopy.writeUInt32LE(0, 0x98);
    encCopy.writeUInt32LE(0, 0x9c);
  }

  // 4. Player Starting Locations
  const pslCount = encSourceBytes.readUInt32LE(0xa4);
  const pslPtr = encSourceBytes.readUInt32LE(0xa8);
  if (pslCount > 0 && pslPtr !== 0) {
    const pslSrcBase = resolvePointer(pslPtr, srcHdr.tagDataOffset, srcTagIndex.baseMemoryAddress);
    const pslData = Buffer.alloc(pslCount * 52);
    sourceBuffer.copy(pslData, 0, pslSrcBase, pslSrcBase + pslData.length);
    const pslAppRes = appendDataBlock(curOut, curHdr, currentTagIndex, pslData);
    curOut = pslAppRes.buffer;
    curHdr = pslAppRes.header;
    encCopy.writeUInt32LE(pslCount, 0xa4);
    encCopy.writeUInt32LE(pslAppRes.virtualAddress, 0xa8);
  } else {
    encCopy.writeUInt32LE(0, 0xa4);
    encCopy.writeUInt32LE(0, 0xa8);
  }

  return { buffer: curOut, header: curHdr, encounterBytes: encCopy };
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
  let importedEncounters = 0;
  let importedTriggers = 0;
  let importedScripts = 0;
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
    const shouldImportAiAndScripts = Boolean(options.importAiAndScripts);

    if ((shouldHarvestShaders && bspDeps.length > 0) || shouldImportObjects || shouldImportVehicles || shouldImportAiAndScripts) {
      const srcTagIndex = sourceInspected.tagIndex;
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

      let srcActorPalCount = 0;
      let srcActorPalOffset = 0;
      let srcRefCount = 0;
      let srcRefOffset = 0;
      let srcScnrOffset = 0;
      const srcScnrEntry = srcTagIndex.entries[srcTagIndex.scenarioTagId & 0xffff];
      if (srcScnrEntry) {
        srcScnrOffset = resolveTagDataPointer(
          srcScnrEntry.tagDataPointerOrResourceIndex,
          sourceInspected.header,
          srcTagIndex.baseMemoryAddress,
        );
      }

      if (shouldImportObjects || shouldImportVehicles || shouldImportAiAndScripts) {
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

          if (shouldImportAiAndScripts) {
            // Actor palette (0x420)
            const actorPalRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x420);
            srcActorPalCount = actorPalRefl.count;
            if (actorPalRefl.count > 0) {
              srcActorPalOffset = sourceInspected.header.tagDataOffset + (actorPalRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < actorPalRefl.count; i++) {
                const tagId = sourceBuffer.readUInt32LE(srcActorPalOffset + i * 16 + 12);
                if (tagId !== 0xffffffff && (tagId & 0xffff) < srcTagIndex.entries.length) {
                  rootIndicesSet.add(tagId & 0xffff);
                }
              }
            }

            // Script references (0x4b4)
            const refRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x4b4);
            srcRefCount = refRefl.count;
            if (refRefl.count > 0) {
              srcRefOffset = sourceInspected.header.tagDataOffset + (refRefl.pointerLow - srcTagIndex.baseMemoryAddress);
              for (let i = 0; i < refRefl.count; i++) {
                const tagId = sourceBuffer.readUInt32LE(srcRefOffset + i * 40 + 36);
                if (tagId !== 0xffffffff && (tagId & 0xffff) < srcTagIndex.entries.length) {
                  rootIndicesSet.add(tagId & 0xffff);
                }
              }
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

              // Optionally clear existing placements from target map (scenery, vehicles, equipment, weapons, etc.)
              if (options.clearExistingPlacements) {
                const targetScnrEntry = reinspected.tagIndex.entries[reinspected.tagIndex.scenarioTagId & 0xffff];
                if (targetScnrEntry) {
                  const curScnrOff = resolveTagDataPointer(
                    targetScnrEntry.tagDataPointerOrResourceIndex,
                    reinspected.header,
                    reinspected.tagIndex.baseMemoryAddress,
                  );
                  // Clear scenery (0x210), bipeds (0x228), vehicles (0x240), equipment (0x258), weapons (0x270), machines (0x294), controls (0x2ac), light fixtures (0x2c4), sound scenery (0x2dc), netgame flags (0x378), netgame equipment (0x384), decals (0x3a8)
                  const clearOffsets = [0x210, 0x228, 0x240, 0x258, 0x270, 0x294, 0x2ac, 0x2c4, 0x2dc, 0x378, 0x384, 0x3a8];
                  if (!shouldImportAiAndScripts) {
                    clearOffsets.push(0x360, 0x42c);
                  }
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
                  // Clear player starting profile (0x348), player starting locations (0x354), starting equipment (0x390)
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

                // If spawns were cleared OR if target currently has 0 spawns:
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
                          importedSpawns.push(spawnBuf);
                        }
                      }
                    }
                  }

                  // If no spawns found in donor for this BSP, create a default one inside BSP bounds
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

              // Import Scenery, Vehicles, Doors, AI & Scripts into target scenario
              if (shouldImportObjects || shouldImportVehicles || shouldImportAiAndScripts) {
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

                  // 4. AI Encounters, Squads, Triggers & Scripting
                  if (shouldImportAiAndScripts) {
                    // Ensure actor palette entries in target scenario
                    const donorToTargetActorPal = new Map<number, number>();
                    if (srcActorPalCount > 0) {
                      for (let i = 0; i < srcActorPalCount; i++) {
                        const entryOff = srcActorPalOffset + i * 16;
                        const donorTagId = sourceBuffer.readUInt32LE(entryOff + 12);
                        const targetTagId = tagIdMap.get(donorTagId) ?? tagIdMap.get(donorTagId & 0xffff);
                        if (targetTagId !== undefined && targetTagId !== 0xffffffff) {
                          const palRes = ensurePaletteEntry(
                            out,
                            reinspected.header,
                            reinspected.tagIndex,
                            'actor palette',
                            'ScenarioActorPalette',
                            targetTagId,
                            0x61637476, // 'actv'
                          );
                          out = palRes.buffer;
                          reinspected.header = palRes.header;
                          donorToTargetActorPal.set(i, palRes.paletteIndex);
                        }
                      }
                    }

                    const curScnrOff = resolveTagDataPointer(
                      targetScnrEntry.tagDataPointerOrResourceIndex,
                      reinspected.header,
                      reinspected.tagIndex.baseMemoryAddress,
                    );

                    // A. Trigger Volumes (0x360)
                    const trigRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x360);
                    if (trigRefl.count > 0) {
                      const trigBase = sourceInspected.header.tagDataOffset + (trigRefl.pointerLow - srcTagIndex.baseMemoryAddress);
                      const validTrigs: Buffer[] = [];
                      const [minX, minY, minZ, maxX, maxY, maxZ] = srcWorldBounds;
                      const margin = 25.0;

                      for (let i = 0; i < trigRefl.count; i++) {
                        const tOff = trigBase + i * 96;
                        if (options.filterObjectsToBspBounds) {
                          const posX = sourceBuffer.readFloatLE(tOff + 72);
                          const posY = sourceBuffer.readFloatLE(tOff + 76);
                          const posZ = sourceBuffer.readFloatLE(tOff + 80);
                          if (
                            posX < minX - margin || posX > maxX + margin ||
                            posY < minY - margin || posY > maxY + margin ||
                            posZ < minZ - margin || posZ > maxZ + margin
                          ) {
                            continue;
                          }
                        }
                        const tBytes = Buffer.alloc(96);
                        sourceBuffer.copy(tBytes, 0, tOff, tOff + 96);
                        validTrigs.push(tBytes);
                      }

                      if (validTrigs.length > 0) {
                        const appendRes = appendReflexiveElements(
                          out,
                          reinspected.header,
                          reinspected.tagIndex,
                          curScnrOff + 0x360,
                          Buffer.concat(validTrigs),
                          validTrigs.length,
                        );
                        out = appendRes.buffer;
                        reinspected.header = appendRes.header;
                        importedTriggers = validTrigs.length;
                      }
                    }

                    // B. Encounters & Squads (0x42c)
                    const encRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x42c);
                    if (encRefl.count > 0) {
                      const encBase = sourceInspected.header.tagDataOffset + (encRefl.pointerLow - srcTagIndex.baseMemoryAddress);
                      const clonedEncBuffers: Buffer[] = [];

                      for (let i = 0; i < encRefl.count; i++) {
                        const encOff = encBase + i * 176;
                        const precompBsp = sourceBuffer.readInt16LE(encOff + 0x7e);
                        const manualBsp = sourceBuffer.readInt16LE(encOff + 0x2a);

                        if (options.filterObjectsToBspBounds && srcIndices.length === 1) {
                          if (precompBsp !== -1 && precompBsp !== srcIdx && manualBsp !== srcIdx) {
                            continue;
                          }
                        }

                        const encBytes = sourceBuffer.subarray(encOff, encOff + 176);
                        const cloneRes = cloneEncounterWithChildReflexives(
                          encBytes,
                          sourceBuffer,
                          sourceInspected.header,
                          srcTagIndex,
                          out,
                          reinspected.header,
                          reinspected.tagIndex,
                          donorToTargetActorPal,
                          dstIdx,
                        );
                        out = cloneRes.buffer;
                        reinspected.header = cloneRes.header;
                        clonedEncBuffers.push(cloneRes.encounterBytes);
                      }

                      if (clonedEncBuffers.length > 0) {
                        const allEncBytes = Buffer.concat(clonedEncBuffers);
                        const appendRes = appendReflexiveElements(
                          out,
                          reinspected.header,
                          reinspected.tagIndex,
                          curScnrOff + 0x42c,
                          allEncBytes,
                          clonedEncBuffers.length,
                        );
                        out = appendRes.buffer;
                        reinspected.header = appendRes.header;
                        importedEncounters = clonedEncBuffers.length;
                      }
                    }

                    // C. Scripting (syntax data 0x474, string data 0x488, scripts 0x49c, globals 0x4a8, references 0x4b4)
                    const syntaxDataSize = sourceBuffer.readUInt32LE(srcScnrOffset + 0x474);
                    const syntaxDataPtr = sourceBuffer.readUInt32LE(srcScnrOffset + 0x474 + 12);
                    const stringDataSize = sourceBuffer.readUInt32LE(srcScnrOffset + 0x488);
                    const stringDataPtr = sourceBuffer.readUInt32LE(srcScnrOffset + 0x488 + 12);
                    const scriptsRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x49c);
                    const globalsRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x4a8);
                    const refsRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x4b4);

                    if (scriptsRefl.count > 0 && syntaxDataSize > 0) {
                      // 1. Script syntax data
                      const synSrcOff = resolvePointer(syntaxDataPtr, sourceInspected.header.tagDataOffset, srcTagIndex.baseMemoryAddress);
                      const synData = Buffer.alloc(syntaxDataSize);
                      sourceBuffer.copy(synData, 0, synSrcOff, synSrcOff + syntaxDataSize);
                      const synRes = appendDataBlock(out, reinspected.header, reinspected.tagIndex, synData);
                      out = synRes.buffer;
                      reinspected.header = synRes.header;
                      out.writeUInt32LE(syntaxDataSize, curScnrOff + 0x474);
                      out.writeUInt32LE(0, curScnrOff + 0x474 + 4);
                      out.writeUInt32LE(0, curScnrOff + 0x474 + 8);
                      out.writeUInt32LE(synRes.virtualAddress, curScnrOff + 0x474 + 12);

                      // 2. Script string data
                      const strSrcOff = resolvePointer(stringDataPtr, sourceInspected.header.tagDataOffset, srcTagIndex.baseMemoryAddress);
                      const strData = Buffer.alloc(stringDataSize);
                      sourceBuffer.copy(strData, 0, strSrcOff, strSrcOff + stringDataSize);
                      const strRes = appendDataBlock(out, reinspected.header, reinspected.tagIndex, strData);
                      out = strRes.buffer;
                      reinspected.header = strRes.header;
                      out.writeUInt32LE(stringDataSize, curScnrOff + 0x488);
                      out.writeUInt32LE(0, curScnrOff + 0x488 + 4);
                      out.writeUInt32LE(0, curScnrOff + 0x488 + 8);
                      out.writeUInt32LE(strRes.virtualAddress, curScnrOff + 0x488 + 12);

                      // 3. Scripts
                      const scSrcOff = resolvePointer(scriptsRefl.pointerLow, sourceInspected.header.tagDataOffset, srcTagIndex.baseMemoryAddress);
                      const scData = Buffer.alloc(scriptsRefl.count * 92);
                      sourceBuffer.copy(scData, 0, scSrcOff, scSrcOff + scData.length);
                      for (let s = 0; s < scriptsRefl.count; s++) {
                        scData.writeUInt32LE(0, s * 92 + 80);
                        scData.writeUInt32LE(0, s * 92 + 84);
                      }
                      const scRes = appendDataBlock(out, reinspected.header, reinspected.tagIndex, scData);
                      out = scRes.buffer;
                      reinspected.header = scRes.header;
                      out.writeUInt32LE(scriptsRefl.count, curScnrOff + 0x49c);
                      out.writeUInt32LE(scRes.virtualAddress, curScnrOff + 0x49c + 4);
                      importedScripts = scriptsRefl.count;

                      // 4. Globals
                      if (globalsRefl.count > 0) {
                        const glSrcOff = resolvePointer(globalsRefl.pointerLow, sourceInspected.header.tagDataOffset, srcTagIndex.baseMemoryAddress);
                        const glData = Buffer.alloc(globalsRefl.count * 92);
                        sourceBuffer.copy(glData, 0, glSrcOff, glSrcOff + glData.length);
                        const glRes = appendDataBlock(out, reinspected.header, reinspected.tagIndex, glData);
                        out = glRes.buffer;
                        reinspected.header = glRes.header;
                        out.writeUInt32LE(globalsRefl.count, curScnrOff + 0x4a8);
                        out.writeUInt32LE(glRes.virtualAddress, curScnrOff + 0x4a8 + 4);
                      }

                      // 5. References
                      if (refsRefl.count > 0) {
                        const refSrcOff = resolvePointer(refsRefl.pointerLow, sourceInspected.header.tagDataOffset, srcTagIndex.baseMemoryAddress);
                        const refData = Buffer.alloc(refsRefl.count * 40);
                        sourceBuffer.copy(refData, 0, refSrcOff, refSrcOff + refData.length);
                        for (let r = 0; r < refsRefl.count; r++) {
                          const donorTagId = refData.readUInt32LE(r * 40 + 36);
                          const targetTagId = tagIdMap.get(donorTagId) ?? tagIdMap.get(donorTagId & 0xffff);
                          if (targetTagId !== undefined) {
                            refData.writeUInt32LE(targetTagId, r * 40 + 36);
                          }
                        }
                        const refRes = appendDataBlock(out, reinspected.header, reinspected.tagIndex, refData);
                        out = refRes.buffer;
                        reinspected.header = refRes.header;
                        out.writeUInt32LE(refsRefl.count, curScnrOff + 0x4b4);
                        out.writeUInt32LE(refRes.virtualAddress, curScnrOff + 0x4b4 + 4);
                      }
                    }

                    // D. If player spawns were cleared and donor map has starting locations on this BSP, import donor starting locations
                    if (options.clearPlayerSpawns) {
                      const srcSpawnsRefl = decodeReflexive(sourceBuffer, srcScnrOffset + 0x354);
                      if (srcSpawnsRefl.count > 0) {
                        const spSize = resolveStruct('ScenarioPlayerStartingLocation').totalSize; // 52
                        const spBase = resolvePointer(srcSpawnsRefl.pointerLow, sourceInspected.header.tagDataOffset, srcTagIndex.baseMemoryAddress);
                        const validSpawns: Buffer[] = [];
                        const [minX, minY, minZ, maxX, maxY, maxZ] = srcWorldBounds;
                        const margin = 20.0;

                        for (let i = 0; i < srcSpawnsRefl.count; i++) {
                          const spOff = spBase + i * spSize;
                          const posX = sourceBuffer.readFloatLE(spOff + 0);
                          const posY = sourceBuffer.readFloatLE(spOff + 4);
                          const posZ = sourceBuffer.readFloatLE(spOff + 8);
                          if (
                            !options.filterObjectsToBspBounds ||
                            (posX >= minX - margin && posX <= maxX + margin &&
                             posY >= minY - margin && posY <= maxY + margin &&
                             posZ >= minZ - margin && posZ <= maxZ + margin)
                          ) {
                            const spBytes = Buffer.alloc(spSize);
                            sourceBuffer.copy(spBytes, 0, spOff, spOff + spSize);
                            validSpawns.push(spBytes);
                          }
                        }

                        if (validSpawns.length > 0) {
                          const appendRes = appendReflexiveElements(
                            out,
                            reinspected.header,
                            reinspected.tagIndex,
                            curScnrOff + 0x354,
                            Buffer.concat(validSpawns),
                            validSpawns.length,
                          );
                          out = appendRes.buffer;
                          reinspected.header = appendRes.header;
                        }
                      }
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
        } catch {
          // If harvesting encounters an issue with any one tag, proceed with geometry swap
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
  if (tagIdMap.size > 0) {
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
      );
    }
  }

  // 5. Strip DOBC & Decals if requested
  let strippedDobc = false;
  let strippedDecals = false;
  const shouldStripDobc = options.stripDobc !== undefined ? options.stripDobc : (options.stripDobcAndDecals ?? true);
  const shouldStripDecals = options.stripDecals !== undefined ? options.stripDecals : (options.stripDobcAndDecals ?? true);

  const metaPointer = out.readUInt32LE(dstBsp.bspStart + 0);
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

    // Player starting locations at 0x354
    const spawnsReflexive = decodedScnr.get('player starting locations');
    if (spawnsReflexive && spawnsReflexive.kind === 'reflexive' && spawnsReflexive.value.count > 0) {
      const spawnSize = 52;
      const spawnsOffset = newTagDataOffset + (spawnsReflexive.value.pointerLow - tagIndex.baseMemoryAddress);
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
    const equipReflexive = decodedScnr.get('netgame equipment');
    if (equipReflexive && equipReflexive.kind === 'reflexive' && equipReflexive.value.count > 0) {
      const equipSize = 144; // ScenarioNetgameEquipment struct
      const equipOffset = newTagDataOffset + (equipReflexive.value.pointerLow - tagIndex.baseMemoryAddress);
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
      importedEncounters,
      importedTriggers,
      importedScripts,
    },
  };
}
