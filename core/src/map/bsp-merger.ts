import { decodeStruct, resolveStruct } from './definitions/engine';
import { locateStructureBsp } from './definitions/validate-tag';
import { inspectCustomEditionMap } from './open-map';
import { fourCCFromString } from '../constants/tag-classes';
import { compileMeshCollisionBspData, parseObjMesh } from '../render/collision-generator';
import {
  exportWorldMeshToObj,
  resolveDefaultHaloShadersForWorld,
  type GeneratedWorldMesh,
  type WorldMaterialRole,
} from '../render/world-bsp-generator';

export interface MergeBspOptions {
  /**
   * When true, automatically removes duplicate co-planar transition-corridor triangles from
   * secondary BSPs so adjacent BSPs do not z-fight.
   */
  removeOverlappingPortalCaps?: boolean;
  /**
   * When true (default: true), automatically removes end-of-BSP black/portal cap blocker walls
   * and their collision surfaces inside shared transition doorways between adjacent BSPs.
   */
  removeBspEndBlockWalls?: boolean;
  /**
   * When true, offsets secondary BSP lightmap `bitmap` indices by the cumulative plate counts
   * of earlier contexts' lightmap bitmap tags so `bsp-swapper` can append secondary lightmap
   * `BitmapData` plates into the base lightmap bitmap tag.
   */
  mergeLightmapPlates?: boolean;
  /**
   * Maximum safe byte size for the merged Structure BSP so that `tagDataSize + bspSize <= 23 MiB`
   * in Halo Custom Edition's tag cache (`0x40440000 .. 0x41B40000`). Defaults to 16.8 MiB in stock mode
   * or 116 MiB when `useExpandedEngineLimits` is enabled.
   */
  maxBspBytes?: number;
  /**
   * When true, targets the expanded 122 MiB (`0x47E40000`) OpenCE engine ceiling and raised surface/lightmap limits
   * instead of compacting to fit the stock 23 MiB (`0x41B40000`) limit.
   */
  useExpandedEngineLimits?: boolean;
}

export interface MergedBspResult {
  bspBuffer: Buffer;
  bspSize: number;
  bspAddress: number;
  vertexCount: number;
  triangleCount: number;
  submeshCount: number;
  worldBounds: [number, number, number, number, number, number];
  hasDobc: boolean;
  hasDecals: boolean;
  mergedBspNames: string[];
  removedDuplicateTriangles?: number;
  removedPortalBlockerTriangles?: number;
  donorLightmapTagIds?: number[];
  plateOffsetByContext?: number[];
}

interface BspContext {
  bspIndex: number;
  bspTagId: number;
  bspName: string;
  bspStart: number;
  bspSize: number;
  bspAddress: number;
  loc: { fileOffset: number; fileOffsetAnchor: number; baseMemoryAddress: number };
  decoded: Map<string, any>;
  hasDobc: boolean;
  hasDecals: boolean;
}

function getReflexive(decoded: Map<string, any>, key: string): { count: number; pointerLow: number } {
  const f = decoded.get(key);
  if (f && f.kind === 'reflexive' && f.value) {
    return f.value;
  }
  return { count: 0, pointerLow: 0 };
}

function getBounds(decoded: Map<string, any>, key: string): [number, number] {
  const f = decoded.get(key);
  if (f && f.kind === 'bounds' && Array.isArray(f.value)) {
    return f.value;
  }
  return [0, 0];
}

/**
 * Recursively walks a ScenarioStructureBSP buffer and rebases every internal
 * reflexive, tagDataOffset, and root header pointer from oldBaseAddress to newBaseAddress.
 *
 * This ensures that when a merged or transplanted BSP is positioned within the 23 MiB
 * Custom Edition tag cache (CE ceiling: 0x41B40000), all pointer references remain valid.
 */
export function rebaseStructureBspPointers(
  bspBuffer: Buffer,
  oldBaseAddress: number,
  newBaseAddress: number,
): number {
  const delta = newBaseAddress - oldBaseAddress;

  const bspSize = bspBuffer.length;
  const inBsp = (p: number, len: number) => {
    const at = p - oldBaseAddress;
    return at >= 0 && at + len <= bspSize;
  };

  const sites: { at: number; value: number }[] = [];
  const rootPtr = bspBuffer.readUInt32LE(0);
  if (delta !== 0) {
    sites.push({ at: 0, value: rootPtr });
  }

  const visited = new Set<string>();

  function walk(structName: string, pointer: number, where: string): void {
    const structDef = resolveStruct(structName);
    const size = structDef.totalSize;
    if (!inBsp(pointer, size)) return;
    const at = pointer - oldBaseAddress;
    const key = `${structName}@${at}`;
    if (visited.has(key)) return;
    visited.add(key);

    const decoded = decodeStruct(bspBuffer, at, structName);
    for (const field of structDef.fields) {
      const value = decoded.get(field.name);
      if (!value || field.def.nonCached) continue;
      if (value.kind === 'reflexive' && field.def.type === 'TagReflexive') {
        const p = value.value.pointerLow >>> 0;
        if (value.value.count === 0) {
          if (p !== 0) {
            bspBuffer.writeUInt32LE(0, at + field.offset + 4);
          }
          continue;
        }
        if (p !== 0 && delta !== 0 && (value.value.count > 0 || inBsp(p, 1))) {
          sites.push({ at: at + field.offset + 4, value: p });
        }
        if (value.value.count > 0 && field.def.struct) {
          const childStruct = field.def.struct;
          const childSize = resolveStruct(childStruct).totalSize;
          if (inBsp(p, value.value.count * childSize)) {
            for (let i = 0; i < value.value.count; i++) {
              walk(childStruct, (p + i * childSize) >>> 0, `${where}.${field.name}[${i}]`);
            }
          }
        }
      } else if (value.kind === 'dependency' && field.def.type === 'TagDependency') {
        // Zero donor TagDependency pathPointer (+4) and pathLength (+8) so pointer-rebase never fails
        // on donor path pointers before rewriteBspDependencies populates the target path pointers
        bspBuffer.writeUInt32LE(0, at + field.offset + 4);
        bspBuffer.writeUInt32LE(0, at + field.offset + 8);
      } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset) {
        const p = value.value.pointerLow >>> 0;
        const sz = bspBuffer.readInt32LE(at + field.offset);
        if (sz === 0) {
          if (p !== 0) {
            bspBuffer.writeUInt32LE(0, at + field.offset + 12);
          }
          continue;
        }
        if (p !== 0 && delta !== 0 && inBsp(p, 1)) {
          sites.push({ at: at + field.offset + 12, value: p });
        }
      }
    }
  }

  walk('ScenarioStructureBSP', rootPtr, 'ScenarioStructureBSP');

  for (const s of sites) {
    bspBuffer.writeUInt32LE((s.value + delta) >>> 0, s.at);
  }

  return sites.length;
}

/**
 * Merges 2 or more Structure BSPs from a Halo PC / CE map buffer into a single
 * unified ScenarioStructureBSP (sbsp) binary blob.
 *
 * Fuses:
 * - Submesh materials & vertex streams (rebased to the unified memory buffer).
 * - Surfaces (indexed triangles).
 * - Lightmaps plates.
 * - Clusters and all-visible PVS data (0xFF bitfield).
 * - Collision geometry (3D BSP nodes, separating divider plane, leaves, 2D references, 2D nodes, surfaces, edges, vertices).
 * - World bounds and vehicle floor/ceiling limits.
 *
 * @param sourceBuffer Complete map file buffer.
 * @param bspIndices Indices into the scenario's "structure bsps" reflexive to combine.
 */
export function mergeStructureBsps(
  sourceBuffer: Buffer,
  bspIndices: number[],
  options: MergeBspOptions = {},
): MergedBspResult {
  if (bspIndices.length === 0) {
    throw new Error('mergeStructureBsps requires at least one BSP index.');
  }
  const removeOverlappingPortalCaps = options.removeOverlappingPortalCaps === true;
  const removeBspEndBlockWalls = options.removeBspEndBlockWalls !== false;
  const useExpandedEngineLimits = options.useExpandedEngineLimits === true;
  const maxBspBytes =
    options.maxBspBytes ?? (useExpandedEngineLimits ? 116 * 1024 * 1024 : 16_800_000);

  const inspected = inspectCustomEditionMap(sourceBuffer);
  if (inspected.status !== 'ok') {
    throw new Error('Failed to inspect map buffer header or tag index.');
  }

  const { header, tagIndex } = inspected;
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    throw new Error(`Scenario tag (ID: 0x${tagIndex.scenarioTagId.toString(16)}) not found in tag index.`);
  }

  const scenarioFileOffset =
    header.tagDataOffset + (scenarioEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
  const decodedScenario = decodeStruct(sourceBuffer, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive' || bspsField.value.count === 0) {
    throw new Error('Scenario has no structure bsps.');
  }

  const bspCount = bspsField.value.count;
  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspsArrayOffset = header.tagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);

  // Load and validate all requested BSP contexts
  const contexts: BspContext[] = [];
  for (const idx of bspIndices) {
    if (idx < 0 || idx >= bspCount) {
      throw new Error(`BSP index ${idx} is out of bounds (scenario has ${bspCount} BSPs).`);
    }

    const bspEntryOffset = bspsArrayOffset + idx * scenarioBspSize;
    const decodedBspEntry = decodeStruct(sourceBuffer, bspEntryOffset, 'ScenarioBSP');
    const bspDep = decodedBspEntry.get('structure bsp');
    const bspTagId = bspDep && bspDep.kind === 'dependency' ? bspDep.value.tagId : 0xffffffff;
    const bspStart = (decodedBspEntry.get('bsp start') as { kind: 'basic'; value: number }).value;
    const bspSize = (decodedBspEntry.get('bsp size') as { kind: 'basic'; value: number }).value;
    const bspAddress = (decodedBspEntry.get('bsp address') as { kind: 'basic'; value: number }).value;

    const loc = locateStructureBsp(
      sourceBuffer,
      tagIndex,
      scenarioFileOffset,
      header.tagDataOffset,
      tagIndex.baseMemoryAddress,
      bspTagId,
      idx,
    );
    if (!loc) {
      throw new Error(`Failed to locate structure BSP for index ${idx}.`);
    }

    const decoded = decodeStruct(sourceBuffer, loc.fileOffset, 'ScenarioStructureBSP');
    const tagEntry = tagIndex.entries[bspTagId & 0xffff];
    const bspName = tagEntry?.path || `BSP ${idx}`;

    const dobc = decoded.get('detail objects');
    const hasDobc = !!dobc && dobc.kind === 'reflexive' && dobc.value.count > 0;
    const decals = decoded.get('runtime decals');
    const hasDecals = !!decals && decals.kind === 'reflexive' && decals.value.count > 0;

    contexts.push({
      bspIndex: idx,
      bspTagId,
      bspName,
      bspStart,
      bspSize,
      bspAddress,
      loc,
      decoded,
      hasDobc,
      hasDecals,
    });
  }

  // Base BSP is contexts[0]
  const baseCtx = contexts[0];
  const baseAddress = baseCtx.bspAddress;

  // Single BSP fast-path (no merging required)
  if (contexts.length === 1) {
    const bspBuf = Buffer.alloc(baseCtx.bspSize);
    sourceBuffer.copy(bspBuf, 0, baseCtx.bspStart, baseCtx.bspStart + baseCtx.bspSize);

    const CE_STOCK_CEILING = 0x41b40000;
    const CE_EXTENDED_CEILING = 0x47e40000; // 0x40440000 + 0x07A00000 (122 MiB)
    const bspCacheCeiling =
      header.tagDataSize + baseCtx.bspSize + 2 * 1024 * 1024 <= 23 * 1024 * 1024
        ? CE_STOCK_CEILING
        : CE_EXTENDED_CEILING;
    let finalBspAddress = baseAddress;
    if (baseAddress + baseCtx.bspSize > bspCacheCeiling || baseAddress < 0x40440000 + header.tagDataSize) {
      finalBspAddress = (bspCacheCeiling - baseCtx.bspSize) & ~511;
      rebaseStructureBspPointers(bspBuf, baseAddress, finalBspAddress);
    }

    const b0x = getBounds(baseCtx.decoded, 'world bounds x');
    const b0y = getBounds(baseCtx.decoded, 'world bounds y');
    const b0z = getBounds(baseCtx.decoded, 'world bounds z');

    const surfacesRefl = getReflexive(baseCtx.decoded, 'surfaces');

    return {
      bspBuffer: bspBuf,
      bspSize: baseCtx.bspSize,
      bspAddress: finalBspAddress,
      vertexCount: 0,
      triangleCount: surfacesRefl.count,
      submeshCount: 0,
      worldBounds: [b0x[0], b0y[0], b0z[0], b0x[1], b0y[1], b0z[1]],
      hasDobc: baseCtx.hasDobc,
      hasDecals: baseCtx.hasDecals,
      mergedBspNames: [baseCtx.bspName],
    };
  }

  // Allocate working buffer for merged BSP (including merged CollisionBSP + leaves)
  let totalEstimatedBytes = 0;
  for (const c of contexts) totalEstimatedBytes += c.bspSize;
  totalEstimatedBytes += 24 * 1024 * 1024; // safety margin for alignment and merged collision/render reflexives

  const merged = Buffer.alloc(totalEstimatedBytes);

  // Copy Base BSP 0 into `merged`, then reclaim dead ranges inside Base BSP 0 whose headers
  // are replaced by merged equivalents (CollisionBSP 8 child arrays, leaves, leaf surfaces, surfaces)
  sourceBuffer.copy(merged, 0, baseCtx.bspStart, baseCtx.bspStart + baseCtx.bspSize);

  let appendOffset = (baseCtx.bspSize + 15) & ~15;

  const reclaimedRanges: { start: number; end: number }[] = [];
  const addReclaimedRange = (ptr: number, byteLen: number) => {
    if (byteLen <= 0 || ptr <= baseAddress) return;
    const relStart = ptr - baseAddress;
    const relEnd = relStart + byteLen;
    if (relStart >= 0x300 && relEnd <= baseCtx.bspSize) {
      reclaimedRanges.push({ start: relStart, end: relEnd });
    }
  };
  {
    const baseCollRefl = getReflexive(baseCtx.decoded, 'collision bsp');
    if (baseCollRefl.count > 0 && baseCollRefl.pointerLow > baseAddress) {
      const cOff = baseCtx.bspStart + (baseCollRefl.pointerLow - baseAddress);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x04), sourceBuffer.readUInt32LE(cOff + 0x00) * 12);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x10), sourceBuffer.readUInt32LE(cOff + 0x0c) * 16);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x1c), sourceBuffer.readUInt32LE(cOff + 0x18) * 8);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x28), sourceBuffer.readUInt32LE(cOff + 0x24) * 8);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x34), sourceBuffer.readUInt32LE(cOff + 0x30) * 20);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x40), sourceBuffer.readUInt32LE(cOff + 0x3c) * 12);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x4c), sourceBuffer.readUInt32LE(cOff + 0x48) * 24);
      addReclaimedRange(sourceBuffer.readUInt32LE(cOff + 0x58), sourceBuffer.readUInt32LE(cOff + 0x54) * 16);
    }
    const baseNodesRefl = getReflexive(baseCtx.decoded, 'nodes');
    addReclaimedRange(baseNodesRefl.pointerLow, baseNodesRefl.count * 6);
    const baseLeavesRefl = getReflexive(baseCtx.decoded, 'leaves');
    addReclaimedRange(baseLeavesRefl.pointerLow, baseLeavesRefl.count * 16);
    const baseLeafSurfRefl = getReflexive(baseCtx.decoded, 'leaf surfaces');
    addReclaimedRange(baseLeafSurfRefl.pointerLow, baseLeafSurfRefl.count * 8);
    const baseSurfacesRefl = getReflexive(baseCtx.decoded, 'surfaces');
    addReclaimedRange(baseSurfacesRefl.pointerLow, baseSurfacesRefl.count * 6);
    const baseClusterPortalsRefl = getReflexive(baseCtx.decoded, 'cluster portals');
    addReclaimedRange(baseClusterPortalsRefl.pointerLow, baseClusterPortalsRefl.count * 64);
    if (baseClusterPortalsRefl.count > 0 && baseClusterPortalsRefl.pointerLow > baseAddress) {
      const cpBaseOff = baseCtx.bspStart + (baseClusterPortalsRefl.pointerLow - baseAddress);
      for (let p = 0; p < baseClusterPortalsRefl.count; p++) {
        const pvCnt = sourceBuffer.readUInt32LE(cpBaseOff + p * 64 + 0x34);
        const pvPtr = sourceBuffer.readUInt32LE(cpBaseOff + p * 64 + 0x38);
        addReclaimedRange(pvPtr, pvCnt * 12);
      }
    }
    const basePathfindingRefl = getReflexive(baseCtx.decoded, 'pathfinding surfaces');
    addReclaimedRange(basePathfindingRefl.pointerLow, basePathfindingRefl.count);
    const baseDobcRefl = getReflexive(baseCtx.decoded, 'detail objects');
    addReclaimedRange(baseDobcRefl.pointerLow, baseDobcRefl.count * 64);
    const baseDecalsRefl = getReflexive(baseCtx.decoded, 'runtime decals');
    addReclaimedRange(baseDecalsRefl.pointerLow, baseDecalsRefl.count * 16);
    const basePvsSize = sourceBuffer.readUInt32LE(baseCtx.loc.fileOffset + 0x140);
    const basePvsPtr = sourceBuffer.readUInt32LE(baseCtx.loc.fileOffset + 0x14c);
    addReclaimedRange(basePvsPtr, basePvsSize);
    const baseLmRefl = getReflexive(baseCtx.decoded, 'lightmaps');
    if (baseLmRefl.count > 0 && baseLmRefl.pointerLow > baseAddress) {
      addReclaimedRange(baseLmRefl.pointerLow, baseLmRefl.count * 32);
      const bLmOff = baseCtx.bspStart + (baseLmRefl.pointerLow - baseAddress);
      for (let i = 0; i < baseLmRefl.count; i++) {
        const mCnt = sourceBuffer.readUInt32LE(bLmOff + i * 32 + 0x14);
        const mPtr = sourceBuffer.readUInt32LE(bLmOff + i * 32 + 0x18);
        if (mCnt > 0 && mPtr > baseAddress) {
          addReclaimedRange(mPtr, mCnt * 256);
          const mBaseOff = baseCtx.bspStart + (mPtr - baseAddress);
          for (let j = 0; j < mCnt; j++) {
            const uSz = sourceBuffer.readUInt32LE(mBaseOff + j * 256 + 0xd8);
            const uPtr = sourceBuffer.readUInt32LE(mBaseOff + j * 256 + 0xe4);
            addReclaimedRange(uPtr, uSz);
          }
        }
      }
    }
    const baseClustRefl = getReflexive(baseCtx.decoded, 'clusters');
    if (baseClustRefl.count > 0 && baseClustRefl.pointerLow > baseAddress) {
      const bClOff = baseCtx.bspStart + (baseClustRefl.pointerLow - baseAddress);
      for (let c = 0; c < baseClustRefl.count; c++) {
        const cEnt = bClOff + c * 104;
        const scCnt = sourceBuffer.readUInt32LE(cEnt + 0x34);
        const scPtr = sourceBuffer.readUInt32LE(cEnt + 0x38);
        if (scCnt > 0 && scPtr > baseAddress) {
          addReclaimedRange(scPtr, scCnt * 36);
          const scBase = baseCtx.bspStart + (scPtr - baseAddress);
          for (let s = 0; s < scCnt; s++) {
            const siCnt = sourceBuffer.readUInt32LE(scBase + s * 36 + 0x18);
            const siPtr = sourceBuffer.readUInt32LE(scBase + s * 36 + 0x1c);
            addReclaimedRange(siPtr, siCnt * 4);
          }
        }
        const cSiCnt = sourceBuffer.readUInt32LE(cEnt + 0x44);
        const cSiPtr = sourceBuffer.readUInt32LE(cEnt + 0x48);
        addReclaimedRange(cSiPtr, cSiCnt * 4);
      }
    }
  }
  // Merge adjacent/overlapping reclaimed ranges inside BSP 0 before 16-byte alignment
  reclaimedRanges.sort((a, b) => a.start - b.start);
  const mergedRanges: { start: number; end: number }[] = [];
  for (const r of reclaimedRanges) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (last && r.start <= last.end + 16) {
      last.end = Math.max(last.end, r.end);
    } else {
      mergedRanges.push({ ...r });
    }
  }
  const freePool: { start: number; end: number }[] = [];
  for (const r of mergedRanges) {
    const aStart = (r.start + 15) & ~15;
    const aEnd = r.end & ~15;
    if (aEnd - aStart >= 32) {
      freePool.push({ start: aStart, end: aEnd });
    }
  }
  const allocMerged = (byteLen: number): number => {
    const alignedLen = (Math.max(1, byteLen) + 15) & ~15;
    for (const slot of freePool) {
      if (slot.end - slot.start >= alignedLen) {
        const out = slot.start;
        slot.start += alignedLen;
        return out;
      }
    }
    const out = appendOffset;
    appendOffset += alignedLen;
    return out;
  };

  const lmStructSize = resolveStruct('ScenarioStructureBSPLightmap').totalSize; // 32
  const matStructSize = resolveStruct('ScenarioStructureBSPMaterial').totalSize; // 256

  const baseClustersRefl = getReflexive(baseCtx.decoded, 'clusters');
  const cumulativeClusterCount = baseClustersRefl.count;
  const baseCollisionMaterialsCount = getReflexive(baseCtx.decoded, 'collision materials').count;
  const baseBreakableSurfacesCount = getReflexive(baseCtx.decoded, 'breakable surfaces').count;

  // World bounds per context and union
  const ctxBounds: [number, number, number, number, number, number][] = [];
  for (const c of contexts) {
    const bx = getBounds(c.decoded, 'world bounds x');
    const by = getBounds(c.decoded, 'world bounds y');
    const bz = getBounds(c.decoded, 'world bounds z');
    ctxBounds.push([bx[0], by[0], bz[0], bx[1], by[1], bz[1]]);
  }
  const unionBounds: [number, number, number, number, number, number] = [...ctxBounds[0]];
  let vehicleFloor = (baseCtx.decoded.get('vehicle floor') as { kind: 'basic'; value: number })?.value ?? 0;
  let vehicleCeiling = (baseCtx.decoded.get('vehicle ceiling') as { kind: 'basic'; value: number })?.value ?? 0;
  for (let k = 1; k < contexts.length; k++) {
    const cb = ctxBounds[k];
    unionBounds[0] = Math.min(unionBounds[0], cb[0]);
    unionBounds[1] = Math.min(unionBounds[1], cb[1]);
    unionBounds[2] = Math.min(unionBounds[2], cb[2]);
    unionBounds[3] = Math.max(unionBounds[3], cb[3]);
    unionBounds[4] = Math.max(unionBounds[4], cb[4]);
    unionBounds[5] = Math.max(unionBounds[5], cb[5]);
    const vFloor = (contexts[k].decoded.get('vehicle floor') as { kind: 'basic'; value: number })?.value ?? 0;
    const vCeil = (contexts[k].decoded.get('vehicle ceiling') as { kind: 'basic'; value: number })?.value ?? 0;
    vehicleFloor = Math.min(vehicleFloor, vFloor);
    vehicleCeiling = Math.max(vehicleCeiling, vCeil);
  }

  // Pre-scan all triangles per context to detect shared transition rooms, duplicate overlap triangles,
  // and between-BSP doorway/bulkhead cap blockers
  interface PreScanTri {
    lmIdx: number;
    matIdx: number;
    localSurfIdx: number;
    v0: number;
    v1: number;
    v2: number;
    cx: number;
    cy: number;
    cz: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    key5cm: string;
    isBlackOrPortalShader: boolean;
    keep: boolean;
  }

  const q5cm = (n: number) => Math.round(n * 20);
  const q15cm = (n: number) => Math.round(n * 6.6667);

  const ctxTris: PreScanTri[][] = [];
  const ctxCenters: [number, number, number][] = [];

  const resolveMatVertOff = (ctx: BspContext, mOff: number, vCount: number): { vertSrcOff: number; hasUncomp56: boolean } => {
    const uncompSize = sourceBuffer.readUInt32LE(mOff + 0xd8);
    const vertPtr = sourceBuffer.readUInt32LE(mOff + 0xe4);
    if (vertPtr !== 0 && uncompSize >= vCount * 56) {
      return {
        vertSrcOff: ctx.loc.fileOffsetAnchor + (vertPtr - ctx.loc.baseMemoryAddress),
        hasUncomp56: true,
      };
    }
    if (header.engine === 13 && vCount > 0) {
      const renderedVertOffset = sourceBuffer.readUInt32LE(mOff + 0xb8);
      const off = 2048 + renderedVertOffset;
      if (off + vCount * 56 <= sourceBuffer.length) {
        return { vertSrcOff: off, hasUncomp56: true };
      }
    }
    return { vertSrcOff: 0, hasUncomp56: false };
  };

  for (let k = 0; k < contexts.length; k++) {
    const ctx = contexts[k];
    const lmRefl = getReflexive(ctx.decoded, 'lightmaps');
    const lmOff = ctx.loc.fileOffsetAnchor + (lmRefl.pointerLow - ctx.loc.baseMemoryAddress);
    const surfRefl = getReflexive(ctx.decoded, 'surfaces');
    const surfOff = ctx.loc.fileOffsetAnchor + (surfRefl.pointerLow - ctx.loc.baseMemoryAddress);
    const tris: PreScanTri[] = [];
    let sx = 0, sy = 0, sz = 0;

    for (let i = 0; i < lmRefl.count; i++) {
      const lm = decodeStruct(sourceBuffer, lmOff + i * lmStructSize, 'ScenarioStructureBSPLightmap');
      const rawLmBitmap = (lm.get('bitmap') as { kind: 'basic'; value: number })?.value ?? -1;
      const mats = getReflexive(lm, 'materials');
      if (mats.count === 0) continue;
      const matsOff = ctx.loc.fileOffsetAnchor + (mats.pointerLow - ctx.loc.baseMemoryAddress);
      for (let j = 0; j < mats.count; j++) {
        const mOff = matsOff + j * matStructSize;
        const shaderTagId = sourceBuffer.readUInt32LE(mOff + 0x0c);
        const shaderEnt = tagIndex.entries[shaderTagId & 0xffff];
        const shaderPath = (shaderEnt?.path ?? '').toLowerCase();
        const isBlackOrPortalShader =
          rawLmBitmap < 0 ||
          /black|darkness|dark_cap|portal|invisible|nodraw|blank|\+sky|\+unused|teleporter_black|void/i.test(shaderPath);
        const sStart = sourceBuffer.readInt32LE(mOff + 0x14);
        const sCount = sourceBuffer.readInt32LE(mOff + 0x18);
        const vCount = sourceBuffer.readUInt32LE(mOff + 0xb4);
        const { vertSrcOff: vOff, hasUncomp56 } = resolveMatVertOff(ctx, mOff, vCount);
        for (let s = 0; s < sCount; s++) {
          const sIdx = sStart + s;
          if (sIdx < 0 || sIdx >= surfRefl.count) continue;
          const v0 = sourceBuffer.readUInt16LE(surfOff + sIdx * 6 + 0);
          const v1 = sourceBuffer.readUInt16LE(surfOff + sIdx * 6 + 2);
          const v2 = sourceBuffer.readUInt16LE(surfOff + sIdx * 6 + 4);
          let cx = 0, cy = 0, cz = 0;
          let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
          if (v0 < vCount && v1 < vCount && v2 < vCount && hasUncomp56) {
            const x0 = sourceBuffer.readFloatLE(vOff + v0 * 56 + 0);
            const y0 = sourceBuffer.readFloatLE(vOff + v0 * 56 + 4);
            const z0 = sourceBuffer.readFloatLE(vOff + v0 * 56 + 8);
            const x1 = sourceBuffer.readFloatLE(vOff + v1 * 56 + 0);
            const y1 = sourceBuffer.readFloatLE(vOff + v1 * 56 + 4);
            const z1 = sourceBuffer.readFloatLE(vOff + v1 * 56 + 8);
            const x2 = sourceBuffer.readFloatLE(vOff + v2 * 56 + 0);
            const y2 = sourceBuffer.readFloatLE(vOff + v2 * 56 + 4);
            const z2 = sourceBuffer.readFloatLE(vOff + v2 * 56 + 8);
            cx = (x0 + x1 + x2) / 3;
            cy = (y0 + y1 + y2) / 3;
            cz = (z0 + z1 + z2) / 3;
            minX = Math.min(x0, x1, x2);
            maxX = Math.max(x0, x1, x2);
            minY = Math.min(y0, y1, y2);
            maxY = Math.max(y0, y1, y2);
            minZ = Math.min(z0, z1, z2);
            maxZ = Math.max(z0, z1, z2);
            sx += cx; sy += cy; sz += cz;
          }
          tris.push({
            lmIdx: i,
            matIdx: j,
            localSurfIdx: s,
            v0,
            v1,
            v2,
            cx,
            cy,
            cz,
            minX,
            maxX,
            minY,
            maxY,
            minZ,
            maxZ,
            key5cm: `${q5cm(cx)},${q5cm(cy)},${q5cm(cz)}`,
            isBlackOrPortalShader,
            keep: true,
          });
        }
      }
    }
    ctxTris.push(tris);
    const cnt = tris.length || 1;
    ctxCenters.push([sx / cnt, sy / cnt, sz / cnt]);
  }

  let removedDuplicateTriangles = 0;
  let removedPortalBlockerTriangles = 0;
  // Track 15cm spatial cells of removed blocker triangles per context so we also disable their CollisionBSP surfaces
  const ctxRemovedBlockerCells: Set<string>[] = contexts.map(() => new Set<string>());
  // Also compute shared transition centroids between adjacent contexts (k, k+1) for CollisionBSP root splitting planes
  const pairSharedCentroids = new Map<string, [number, number, number]>();

  const addBlockerCellNeighborhood = (cellSet: Set<string>, cx: number, cy: number, cz: number) => {
    const gx = q15cm(cx);
    const gy = q15cm(cy);
    const gz = q15cm(cz);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          cellSet.add(`${gx + dx},${gy + dy},${gz + dz}`);
        }
      }
    }
  };

  if (contexts.length > 1) {
    // 1. Compute shared transition corridor centroids (and optionally strip end-of-BSP black / portal cap blockers)
    for (let k = 0; k < contexts.length; k++) {
      const trisK = ctxTris[k];
      const setK = new Set(trisK.map((t) => t.key5cm));

      for (let m = k + 1; m < contexts.length; m++) {
        const trisM = ctxTris[m];
        const setM = new Set(trisM.map((t) => t.key5cm));

        // Find shared triangles between k and m and compute the TIGHT 3D bounding box of the shared transition corridor
        let sharedCount = 0;
        let shX = 0, shY = 0, shZ = 0;
        let shMinX = Infinity, shMaxX = -Infinity;
        let shMinY = Infinity, shMaxY = -Infinity;
        let shMinZ = Infinity, shMaxZ = -Infinity;
        const lmStatsK = new Map<number, { total: number; shared: number; unsharedInCorridor: number }>();
        for (const t of trisK) {
          const st = lmStatsK.get(t.lmIdx) ?? { total: 0, shared: 0, unsharedInCorridor: 0 };
          st.total++;
          if (setM.has(t.key5cm)) {
            st.shared++;
            sharedCount++;
            shX += t.cx; shY += t.cy; shZ += t.cz;
            if (t.minX < shMinX) shMinX = t.minX;
            if (t.maxX > shMaxX) shMaxX = t.maxX;
            if (t.minY < shMinY) shMinY = t.minY;
            if (t.maxY > shMaxY) shMaxY = t.maxY;
            if (t.minZ < shMinZ) shMinZ = t.minZ;
            if (t.maxZ > shMaxZ) shMaxZ = t.maxZ;
          }
          lmStatsK.set(t.lmIdx, st);
        }

        if (sharedCount < 12) continue;
        pairSharedCentroids.set(`${k}:${m}`, [shX / sharedCount, shY / sharedCount, shZ / sharedCount]);

        if (!removeBspEndBlockWalls) continue;

        // Helper: check if a triangle centroid lies inside the tight shared transition corridor AABB
        const pad = 1.25;
        const inSharedCorridor = (t: PreScanTri) =>
          t.cx >= shMinX - pad &&
          t.cx <= shMaxX + pad &&
          t.cy >= shMinY - pad &&
          t.cy <= shMaxY + pad &&
          t.cz >= shMinZ - pad &&
          t.cz <= shMaxZ + pad;

        for (const t of trisK) {
          if (!setM.has(t.key5cm) && inSharedCorridor(t)) {
            const st = lmStatsK.get(t.lmIdx);
            if (st) st.unsharedInCorridor++;
          }
        }

        const removedFromK: PreScanTri[] = [];
        for (const t of trisK) {
          if (!t.keep || setM.has(t.key5cm) || !inSharedCorridor(t)) continue;
          const st = lmStatsK.get(t.lmIdx);
          const isSharedTransitionLm = !!st && st.total > 0 && st.shared / st.total >= 0.35;
          const isEndOfBspCap =
            t.isBlackOrPortalShader ||
            (isSharedTransitionLm && st!.unsharedInCorridor <= 320);
          if (isEndOfBspCap) {
            t.keep = false;
            removedPortalBlockerTriangles++;
            removedFromK.push(t);
            addBlockerCellNeighborhood(ctxRemovedBlockerCells[k], t.cx, t.cy, t.cz);
          }
        }

        const lmStatsM = new Map<number, { total: number; shared: number; unsharedInCorridor: number }>();
        for (const t of trisM) {
          const st = lmStatsM.get(t.lmIdx) ?? { total: 0, shared: 0, unsharedInCorridor: 0 };
          st.total++;
          if (setK.has(t.key5cm)) {
            st.shared++;
          } else if (inSharedCorridor(t)) {
            st.unsharedInCorridor++;
          }
          lmStatsM.set(t.lmIdx, st);
        }

        const patchedCellsFromK = new Set<string>();
        for (const rk of removedFromK) {
          addBlockerCellNeighborhood(patchedCellsFromK, rk.cx, rk.cy, rk.cz);
        }

        for (const t of trisM) {
          if (!t.keep || setK.has(t.key5cm) || !inSharedCorridor(t)) continue;
          const cellKey = `${q15cm(t.cx)},${q15cm(t.cy)},${q15cm(t.cz)}`;
          if (!t.isBlackOrPortalShader && patchedCellsFromK.has(cellKey)) continue;
          const st = lmStatsM.get(t.lmIdx);
          const isSharedTransitionLm = !!st && st.total > 0 && st.shared / st.total >= 0.35;
          const isEndOfBspCap =
            t.isBlackOrPortalShader ||
            (isSharedTransitionLm && st!.unsharedInCorridor <= 320);
          if (isEndOfBspCap) {
            t.keep = false;
            removedPortalBlockerTriangles++;
            addBlockerCellNeighborhood(ctxRemovedBlockerCells[m], t.cx, t.cy, t.cz);
          }
        }
      }
    }

    // 2. Optional toggle: Deduplicate co-located transition corridor triangles in donor BSPs (k >= 1) against already-kept triangles
    if (removeOverlappingPortalCaps) {
      const keptCentroidKeys = new Set<string>();
      for (const t of ctxTris[0]) {
        if (t.keep) keptCentroidKeys.add(t.key5cm);
      }
      for (let k = 1; k < contexts.length; k++) {
        for (const t of ctxTris[k]) {
          if (!t.keep) continue;
          if (keptCentroidKeys.has(t.key5cm)) {
            t.keep = false;
            removedDuplicateTriangles++;
          } else {
            keptCentroidKeys.add(t.key5cm);
          }
        }
      }
    }
  }

  // Pre-calculate total CollisionBSP + non-vertex byte footprint so we know if we must compact
  // lightmap Stream 1 vertices (saving 20 bytes/vertex) to fit inside Halo CE's 23 MiB Tag Cache!
  let preSumCollBytes = 0;
  let preSumSbspLeaves = 0;
  for (let k = 0; k < contexts.length; k++) {
    const ctx = contexts[k];
    const toOff = (ptr: number) => ctx.loc.fileOffsetAnchor + (ptr - ctx.loc.baseMemoryAddress);
    const collRefl = getReflexive(ctx.decoded, 'collision bsp');
    const collOff = toOff(collRefl.pointerLow);
    const n3d = sourceBuffer.readUInt32LE(collOff + 0x00);
    const pln = sourceBuffer.readUInt32LE(collOff + 0x0c);
    const lvs = sourceBuffer.readUInt32LE(collOff + 0x18);
    const r2d = sourceBuffer.readUInt32LE(collOff + 0x24);
    const n2d = sourceBuffer.readUInt32LE(collOff + 0x30);
    const srf = sourceBuffer.readUInt32LE(collOff + 0x3c);
    const edg = sourceBuffer.readUInt32LE(collOff + 0x48);
    const vrt = sourceBuffer.readUInt32LE(collOff + 0x54);
    preSumCollBytes += n3d * 12 + pln * 16 + lvs * 8 + r2d * 8 + n2d * 20 + srf * 12 + edg * 24 + vrt * 16;
    preSumSbspLeaves += lvs * 16;
  }
  let preKeptTris = 0;
  for (let k = 0; k < contexts.length; k++) {
    for (const t of ctxTris[k]) if (t.keep) preKeptTris++;
  }
  const estimatedWeldedVerts = Math.ceil(preKeptTris * 1.48);
  const estimatedNonVertBytes =
    preSumCollBytes + preSumSbspLeaves + preKeptTris * 10 + 350_000;
  const compactLightmapVerts =
    contexts.length > 1 &&
    (!useExpandedEngineLimits || estimatedNonVertBytes + estimatedWeldedVerts * 76 > maxBspBytes) &&
    (estimatedNonVertBytes + estimatedWeldedVerts * 76 > maxBspBytes || preKeptTris > 131_000);

  // When merging 3+ BSPs, auto-deduplicate exact 5cm co-planar overlapping corridor triangles
  // in k >= 1 so adjacent BSP transition hallways don't double-render or Z-fight.
  if (!removeOverlappingPortalCaps && contexts.length > 2) {
    const keptCentroidKeys = new Set<string>();
    for (const t of ctxTris[0]) {
      if (t.keep) keptCentroidKeys.add(t.key5cm);
    }
    for (let k = 1; k < contexts.length; k++) {
      for (const t of ctxTris[k]) {
        if (!t.keep) continue;
        if (keptCentroidKeys.has(t.key5cm)) {
          t.keep = false;
          removedDuplicateTriangles++;
        } else {
          keptCentroidKeys.add(t.key5cm);
        }
      }
    }
  }

  // In Standard 23 MB Hybrid Mode (!useExpandedEngineLimits), if total kept triangles exceed Stock CE's
  // MAXIMUM_SURFACES_PER_STRUCTURE (131,072) or the 17.6 MiB BSP byte ceiling, cull tiny decorative micro-chamfer
  // triangles so the combined BSP fits inside Stock CE's 23 MiB cache without engine modifications.
  const maxCollBudgetBytes = !useExpandedEngineLimits ? Math.floor(maxBspBytes * 0.42) : preSumCollBytes;
  const effectiveCollBytes = !useExpandedEngineLimits ? Math.min(preSumCollBytes, maxCollBudgetBytes) : preSumCollBytes;
  if (compactLightmapVerts && !useExpandedEngineLimits) {
    let curKept = 0;
    for (let k = 0; k < contexts.length; k++) {
      for (const t of ctxTris[k]) if (t.keep) curKept++;
    }
    const maxStockTris = Math.min(
      128_000,
      Math.max(40_000, Math.floor((maxBspBytes - effectiveCollBytes - preSumSbspLeaves - 650_000) / 112)),
    );
    if (curKept > maxStockTris) {
      const scored: { t: PreScanTri; spanSq: number }[] = [];
      for (let k = 0; k < contexts.length; k++) {
        for (const t of ctxTris[k]) {
          if (!t.keep) continue;
          const dx = t.maxX - t.minX;
          const dy = t.maxY - t.minY;
          const dz = t.maxZ - t.minZ;
          // Protect large floor/ceiling/wall structural slabs; prioritize tiny high-poly detail ribs/trim
          const isFlatFloor = dz < 0.05 && dx * dy > 0.25;
          const spanSq = (dx * dx + dy * dy + dz * dz) * (isFlatFloor ? 8.0 : 1.0);
          scored.push({ t, spanSq });
        }
      }
      scored.sort((a, b) => a.spanSq - b.spanSq);
      const toDrop = curKept - maxStockTris;
      for (let d = 0; d < toDrop && d < scored.length; d++) {
        scored[d].t.keep = false;
      }
    }
  }

  interface LightmapPlateInfo {
    bitmap: number;
    materialsCount: number;
    materialsPointer: number;
  }
  const allLightmaps: LightmapPlateInfo[] = [];
  const allSurfacesChunks: Buffer[] = [];
  let cumulativeSurfaceCount = 0;
  let totalTriangles = 0;
  let totalVertices = 0;
  let totalSubmeshes = 0;

  // Inspect each context's lightmap bitmap tag (at ScenarioStructureBSP + 0x0c) so we know plate counts
  const donorLightmapTagIds: number[] = [];
  const donorLightmapPlateCounts: number[] = [];
  const plateOffsetByContext: number[] = [];
  let runningPlateOffset = 0;
  for (let k = 0; k < contexts.length; k++) {
    plateOffsetByContext.push(runningPlateOffset);
    const ctx = contexts[k];
    const lmTagId = sourceBuffer.readUInt32LE(ctx.loc.fileOffset + 0x0c);
    donorLightmapTagIds.push(lmTagId);
    let plateCount = 0;
    const lmTagIdx = lmTagId & 0xffff;
    if (lmTagId !== 0xffffffff && lmTagIdx < tagIndex.entries.length) {
      const lmEntry = tagIndex.entries[lmTagIdx];
      if (lmEntry && !lmEntry.isExternal && lmEntry.tagDataPointerOrResourceIndex >= tagIndex.baseMemoryAddress) {
        const bitmOff = header.tagDataOffset + (lmEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
        if (bitmOff >= 0 && bitmOff + 0x6c <= sourceBuffer.length) {
          plateCount = sourceBuffer.readUInt32LE(bitmOff + 0x60);
        }
      }
    }
    donorLightmapPlateCounts.push(plateCount);
    runningPlateOffset += plateCount;
  }
  const basePlateCount = donorLightmapPlateCounts[0] ?? 0;

  interface OutTriMeta {
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
  }
  const outTriMeta: OutTriMeta[] = [];

  // Build filtered surfaces & materials for ALL contexts (0..N-1)
  if (compactLightmapVerts) {
    // Consolidate submeshes across ALL contexts (0..N-1) by shaderTagId into a single ScenarioStructureBSPLightmap (bitmap = -1)
    // to eliminate duplicate room-boundary & transition-corridor vertices and cut material header & draw-call overhead by ~15x.
    interface MatSourceSlice {
      mSrcOff: number;
      vertSrcOff: number;
      oldVCount: number;
      keptTris: PreScanTri[];
    }
    const byShader = new Map<number, MatSourceSlice[]>();
    for (let k = 0; k < contexts.length; k++) {
      const ctx = contexts[k];
      const lmRefl = getReflexive(ctx.decoded, 'lightmaps');
      const lmOff = ctx.loc.fileOffsetAnchor + (lmRefl.pointerLow - ctx.loc.baseMemoryAddress);
      const keptByMat = new Map<string, PreScanTri[]>();
      for (const t of ctxTris[k]) {
        if (!t.keep) continue;
        const key = `${t.lmIdx}:${t.matIdx}`;
        let list = keptByMat.get(key);
        if (!list) {
          list = [];
          keptByMat.set(key, list);
        }
        list.push(t);
      }
      for (let i = 0; i < lmRefl.count; i++) {
        const lm = decodeStruct(sourceBuffer, lmOff + i * lmStructSize, 'ScenarioStructureBSPLightmap');
        const mats = getReflexive(lm, 'materials');
        if (mats.count === 0) continue;
        const matsSourceOff = ctx.loc.fileOffsetAnchor + (mats.pointerLow - ctx.loc.baseMemoryAddress);
        for (let j = 0; j < mats.count; j++) {
          const mSrcOff = matsSourceOff + j * matStructSize;
          const keptTris = keptByMat.get(`${i}:${j}`) ?? [];
          const oldVCount = sourceBuffer.readUInt32LE(mSrcOff + 0xb4);
          const { vertSrcOff, hasUncomp56 } = resolveMatVertOff(ctx, mSrcOff, oldVCount);
          if (keptTris.length > 0 && oldVCount > 0 && hasUncomp56) {
            const shaderTagId = sourceBuffer.readUInt32LE(mSrcOff + 0x0c);
            let list = byShader.get(shaderTagId);
            if (!list) {
              list = [];
              byShader.set(shaderTagId, list);
            }
            list.push({ mSrcOff, vertSrcOff, oldVCount, keptTris });
          }
        }
      }
    }

    interface ConsolidatedMat {
      templateSrcOff: number;
      vertFileOffsets: number[];
      surfBuf: Buffer;
      triMetas: OutTriMeta[];
    }
    const consolidatedMats: ConsolidatedMat[] = [];
    const qPos = (x: number) => Math.round(x * 50);
    const qUv = (x: number) => Math.round(x * 4);

    for (const slices of byShader.values()) {
      if (slices.length === 0) continue;
      let weldMap = new Map<string, number>();
      let vertFileOffsets: number[] = [];
      let triIndices: [number, number, number, PreScanTri][] = [];
      const flushChunk = () => {
        if (triIndices.length === 0 || vertFileOffsets.length === 0) return;
        const newSurfStart = cumulativeSurfaceCount;
        const newSurfCount = triIndices.length;
        const sBuf = Buffer.alloc(newSurfCount * 6);
        const metas: OutTriMeta[] = [];
        for (let s = 0; s < newSurfCount; s++) {
          const [nv0, nv1, nv2, t] = triIndices[s];
          sBuf.writeUInt16LE(nv0, s * 6 + 0);
          sBuf.writeUInt16LE(nv1, s * 6 + 2);
          sBuf.writeUInt16LE(nv2, s * 6 + 4);
          metas.push({
            surfIdx: newSurfStart + s,
            cx: t.cx,
            cy: t.cy,
            cz: t.cz,
            minX: t.minX,
            maxX: t.maxX,
            minY: t.minY,
            maxY: t.maxY,
            minZ: t.minZ,
            maxZ: t.maxZ,
          });
        }
        cumulativeSurfaceCount += newSurfCount;
        consolidatedMats.push({
          templateSrcOff: slices[0].mSrcOff,
          vertFileOffsets,
          surfBuf: sBuf,
          triMetas: metas,
        });
        weldMap = new Map<string, number>();
        vertFileOffsets = [];
        triIndices = [];
      };

      for (const sl of slices) {
        const mapSliceVert = (ov: number): number => {
          if (ov >= sl.oldVCount) return 0;
          const vBase = sl.vertSrcOff + ov * 56;
          const px = qPos(sourceBuffer.readFloatLE(vBase + 0));
          const py = qPos(sourceBuffer.readFloatLE(vBase + 4));
          const pz = qPos(sourceBuffer.readFloatLE(vBase + 8));
          const u0 = qUv(sourceBuffer.readFloatLE(vBase + 48));
          const v0 = qUv(sourceBuffer.readFloatLE(vBase + 52));
          const wKey = `${px},${py},${pz},${u0},${v0}`;
          const existing = weldMap.get(wKey);
          if (existing !== undefined) return existing;
          const newIdx = vertFileOffsets.length;
          vertFileOffsets.push(vBase);
          weldMap.set(wKey, newIdx);
          return newIdx;
        };
        for (const t of sl.keptTris) {
          if (vertFileOffsets.length > 24000 || triIndices.length >= 19000) {
            flushChunk();
          }
          const nv0 = mapSliceVert(t.v0);
          const nv1 = mapSliceVert(t.v1);
          const nv2 = mapSliceVert(t.v2);
          triIndices.push([nv0, nv1, nv2, t]);
        }
      }
      flushChunk();
    }

    if (consolidatedMats.length > 0) {
      const matsDestOff = allocMerged(consolidatedMats.length * matStructSize);
      for (let outJ = 0; outJ < consolidatedMats.length; outJ++) {
        const cm = consolidatedMats[outJ];
        const mOff = matsDestOff + outJ * matStructSize;
        sourceBuffer.copy(merged, mOff, cm.templateSrcOff, cm.templateSrcOff + matStructSize);

        const newSurfStart = cm.triMetas[0].surfIdx;
        const newSurfCount = cm.triMetas.length;
        merged.writeInt32LE(newSurfStart, mOff + 0x14);
        merged.writeInt32LE(newSurfCount, mOff + 0x18);
        merged.fill(0, mOff + 0xec, mOff + 0x100);

        const brkSurf = merged.readInt16LE(mOff + 0xac);
        if (brkSurf < 0 || brkSurf >= baseBreakableSurfacesCount) {
          merged.writeInt16LE(-1, mOff + 0xac);
        }

        const newVCount = cm.vertFileOffsets.length;
        const newUncompSize = newVCount * 56;
        const vertDstOff = allocMerged(newUncompSize);
        for (let v = 0; v < newVCount; v++) {
          const vFileOff = cm.vertFileOffsets[v];
          sourceBuffer.copy(merged, vertDstOff + v * 56, vFileOff, vFileOff + 56);
        }
        merged.writeUInt32LE(newVCount, mOff + 0xb4);
        merged.writeUInt32LE(0, mOff + 0xc8);
        merged.writeUInt32LE(newUncompSize, mOff + 0xd8);
        merged.writeUInt32LE(baseAddress + vertDstOff, mOff + 0xe4);

        allSurfacesChunks.push(cm.surfBuf);
        for (const tm of cm.triMetas) outTriMeta.push(tm);
        totalTriangles += newSurfCount;
        totalVertices += newVCount;
        totalSubmeshes++;
      }
      allLightmaps.push({
        bitmap: -1,
        materialsCount: consolidatedMats.length,
        materialsPointer: baseAddress + matsDestOff,
      });
    }
  } else {
    for (let k = 0; k < contexts.length; k++) {
      const ctx = contexts[k];
      const lmRefl = getReflexive(ctx.decoded, 'lightmaps');
      const lmOff = ctx.loc.fileOffsetAnchor + (lmRefl.pointerLow - ctx.loc.baseMemoryAddress);

      // Group kept triangles by (lmIdx, matIdx)
      const keptByMat = new Map<string, PreScanTri[]>();
      for (const t of ctxTris[k]) {
        if (!t.keep) continue;
        const key = `${t.lmIdx}:${t.matIdx}`;
        let list = keptByMat.get(key);
        if (!list) {
          list = [];
          keptByMat.set(key, list);
        }
        list.push(t);
      }

      const ctxPlateCount = donorLightmapPlateCounts[k] ?? 0;
      for (let i = 0; i < lmRefl.count; i++) {
      const lm = decodeStruct(sourceBuffer, lmOff + i * lmStructSize, 'ScenarioStructureBSPLightmap');
      const rawBitmap = (lm.get('bitmap') as { kind: 'basic'; value: number })?.value ?? -1;
      const validRawBitmap = rawBitmap >= 0 && (ctxPlateCount === 0 || rawBitmap < ctxPlateCount);
      const bitmap = compactLightmapVerts
        ? -1
        : !validRawBitmap
          ? -1
          : k === 0
            ? rawBitmap
            : options?.mergeLightmapPlates
              ? plateOffsetByContext[k] + rawBitmap
              : basePlateCount > 0
                ? Math.min(rawBitmap, basePlateCount - 1)
                : -1;
      const mats = getReflexive(lm, 'materials');
      if (mats.count === 0) {
        continue;
      }

      const matsSourceOff = ctx.loc.fileOffsetAnchor + (mats.pointerLow - ctx.loc.baseMemoryAddress);
      const keptMatIndices: number[] = [];
      for (let j = 0; j < mats.count; j++) {
        const mSrcOff = matsSourceOff + j * matStructSize;
        const keptTris = keptByMat.get(`${i}:${j}`) ?? [];
        const oldVCount = sourceBuffer.readUInt32LE(mSrcOff + 0xb4);
        const { hasUncomp56 } = resolveMatVertOff(ctx, mSrcOff, oldVCount);
        if (keptTris.length > 0 && oldVCount > 0 && hasUncomp56) {
          keptMatIndices.push(j);
        }
      }
      if (keptMatIndices.length === 0) {
        continue;
      }

      const matsByteSize = keptMatIndices.length * matStructSize;
      const matsDestOff = allocMerged(matsByteSize);

      for (let outJ = 0; outJ < keptMatIndices.length; outJ++) {
        const j = keptMatIndices[outJ];
        const mSrcOff = matsSourceOff + j * matStructSize;
        const mOff = matsDestOff + outJ * matStructSize;
        sourceBuffer.copy(merged, mOff, mSrcOff, mSrcOff + matStructSize);

        const keptTris = keptByMat.get(`${i}:${j}`)!;
        const newSurfStart = cumulativeSurfaceCount;
        const newSurfCount = keptTris.length;

        merged.writeInt32LE(newSurfStart, mOff + 0x14);
        merged.writeInt32LE(newSurfCount, mOff + 0x18);

        // Zero compressed vertices TagDataOffset (0xec..0x100) so tag_validate_structure_bsp never sees stale pointers
        merged.fill(0, mOff + 0xec, mOff + 0x100);

        const brkSurf = merged.readInt16LE(mOff + 0xac);
        if (brkSurf < 0 || brkSurf >= baseBreakableSurfacesCount) {
          merged.writeInt16LE(-1, mOff + 0xac);
        }

        const oldVCount = merged.readUInt32LE(mOff + 0xb4);
        const oldLmVCount = merged.readUInt32LE(mOff + 0xc8);
        const oldUncompSize = merged.readUInt32LE(mOff + 0xd8);
        const { vertSrcOff } = resolveMatVertOff(ctx, mSrcOff, oldVCount);
        // Preserve lightmap UVs + normals for ALL contexts whenever bitmap >= 0 so OpenCE's D3D Stream 1 vertex buffer is always valid
        const hasLmVerts =
          bitmap >= 0 &&
          oldLmVCount === oldVCount &&
          (oldUncompSize >= oldVCount * 76 || header.engine === 13);
        const oldLmSrcBase =
          header.engine === 13 && merged.readUInt32LE(mOff + 0xe4) === 0 && merged.readUInt32LE(mOff + 0xcc) !== 0
            ? 2048 + merged.readUInt32LE(mOff + 0xcc)
            : vertSrcOff + oldVCount * 56;
        // Compact and weld vertices referenced by keptTris
        const oldToNew = new Int32Array(oldVCount).fill(-1);
        const usedOldVerts: number[] = [];
        const weldMap = new Map<string, number>();
        const qPos = compactLightmapVerts ? (x: number) => Math.round(x * 100) : (x: number) => Math.round(x * 200);
        const qNorm = (x: number) => Math.round(x * 40);
        const qUv = compactLightmapVerts ? (x: number) => Math.round(x * 50) : (x: number) => Math.round(x * 200);
        const mapOldVert = (ov: number): number => {
          if (ov >= oldVCount) return 0;
          if (oldToNew[ov] !== -1) return oldToNew[ov];
          const vBase = vertSrcOff + ov * 56;
          const px = qPos(sourceBuffer.readFloatLE(vBase + 0));
          const py = qPos(sourceBuffer.readFloatLE(vBase + 4));
          const pz = qPos(sourceBuffer.readFloatLE(vBase + 8));
          const u0 = qUv(sourceBuffer.readFloatLE(vBase + 48));
          const v0 = qUv(sourceBuffer.readFloatLE(vBase + 52));
          let wKey: string;
          if (compactLightmapVerts) {
            wKey = `${px},${py},${pz},${u0},${v0}`;
          } else {
            const nx = qNorm(sourceBuffer.readFloatLE(vBase + 12));
            const ny = qNorm(sourceBuffer.readFloatLE(vBase + 16));
            const nz = qNorm(sourceBuffer.readFloatLE(vBase + 20));
            wKey = `${px},${py},${pz},${nx},${ny},${nz},${u0},${v0}`;
            if (hasLmVerts) {
              const lmBase = oldLmSrcBase + ov * 20;
              const lu = qUv(sourceBuffer.readFloatLE(lmBase + 12));
              const lv = qUv(sourceBuffer.readFloatLE(lmBase + 16));
              wKey += `,${lu},${lv}`;
            }
          }
          const existing = weldMap.get(wKey);
          if (existing !== undefined) {
            oldToNew[ov] = existing;
            return existing;
          }
          const newIdx = usedOldVerts.length;
          usedOldVerts.push(ov);
          weldMap.set(wKey, newIdx);
          oldToNew[ov] = newIdx;
          return newIdx;
        };
        for (let s = 0; s < newSurfCount; s++) {
          const t = keptTris[s];
          mapOldVert(t.v0);
          mapOldVert(t.v1);
          mapOldVert(t.v2);
        }
        const newVCount = usedOldVerts.length;
        const needLmStream = bitmap >= 0;
        const newLmVCount = needLmStream ? newVCount : 0;
        const newUncompSize = newVCount * 56 + newLmVCount * 20;
        const vertDstOff = allocMerged(newUncompSize);
        const newLmDstBase = vertDstOff + newVCount * 56;
        for (let v = 0; v < newVCount; v++) {
          const ov = usedOldVerts[v];
          sourceBuffer.copy(merged, vertDstOff + v * 56, vertSrcOff + ov * 56, vertSrcOff + (ov + 1) * 56);
          if (hasLmVerts) {
            sourceBuffer.copy(merged, newLmDstBase + v * 20, oldLmSrcBase + ov * 20, oldLmSrcBase + (ov + 1) * 20);
          } else if (needLmStream) {
            const lmOff = newLmDstBase + v * 20;
            // Copy normal from Stream 0 and neutral lightmap UV (0.5, 0.5)
            sourceBuffer.copy(merged, lmOff, vertSrcOff + ov * 56 + 12, vertSrcOff + ov * 56 + 24);
            merged.writeFloatLE(0.5, lmOff + 12);
            merged.writeFloatLE(0.5, lmOff + 16);
          }
        }
        merged.writeUInt32LE(newVCount, mOff + 0xb4);
        merged.writeUInt32LE(newLmVCount, mOff + 0xc8);
        merged.writeUInt32LE(newUncompSize, mOff + 0xd8);
        merged.writeUInt32LE(baseAddress + vertDstOff, mOff + 0xe4);

        const sBuf = Buffer.alloc(newSurfCount * 6);
        for (let s = 0; s < newSurfCount; s++) {
          const t = keptTris[s];
          sBuf.writeUInt16LE(Math.max(0, oldToNew[t.v0]), s * 6 + 0);
          sBuf.writeUInt16LE(Math.max(0, oldToNew[t.v1]), s * 6 + 2);
          sBuf.writeUInt16LE(Math.max(0, oldToNew[t.v2]), s * 6 + 4);
          outTriMeta.push({
            surfIdx: newSurfStart + s,
            cx: t.cx,
            cy: t.cy,
            cz: t.cz,
            minX: t.minX,
            maxX: t.maxX,
            minY: t.minY,
            maxY: t.maxY,
            minZ: t.minZ,
            maxZ: t.maxZ,
          });
        }
        allSurfacesChunks.push(sBuf);
        cumulativeSurfaceCount += newSurfCount;
        totalTriangles += newSurfCount;
        totalVertices += newVCount;
        totalSubmeshes++;
      }

      allLightmaps.push({
        bitmap,
        materialsCount: keptMatIndices.length,
        materialsPointer: baseAddress + matsDestOff,
      });
    }
    }
  }

  // Write Combined Lightmaps Array
  const combinedLmByteSize = allLightmaps.length * lmStructSize;
  const combinedLmDestOff = allocMerged(combinedLmByteSize);
  for (let i = 0; i < allLightmaps.length; i++) {
    const off = combinedLmDestOff + i * lmStructSize;
    merged.writeUInt16LE(allLightmaps[i].bitmap & 0xffff, off + 0x0);
    merged.writeUInt16LE(0, off + 0x2);
    merged.writeUInt32LE(0, off + 0x4);
    merged.writeUInt32LE(0, off + 0x8);
    merged.writeUInt32LE(0, off + 0xc);
    merged.writeUInt32LE(0, off + 0x10);
    merged.writeUInt32LE(allLightmaps[i].materialsCount, off + 0x14);
    merged.writeUInt32LE(allLightmaps[i].materialsPointer, off + 0x18);
  }

  // Write Combined Surfaces Array
  const combinedSurfacesDestOff = allocMerged(totalTriangles * 6);
  let currSurfOff = combinedSurfacesDestOff;
  for (const sBuf of allSurfacesChunks) {
    sBuf.copy(merged, currSurfOff);
    currSurfOff += sBuf.length;
  }

  // Fuse CollisionBSP (bsp3d_nodes, planes, leaves, bsp2d_references, bsp2d_nodes, surfaces, edges, vertices)
  // and ScenarioStructureBSPLeaf (sbsp.leaves) across all contexts (0..N-1)
  const splitNodeCount = contexts.length - 1;
  interface CollContextInfo {
    collOff: number;
    node3dCount: number;
    node3dOff: number;
    planeCount: number;
    planeOff: number;
    leafCount: number;
    leafOff: number;
    ref2dCount: number;
    ref2dOff: number;
    node2dCount: number;
    node2dOff: number;
    surfCount: number;
    surfOff: number;
    edgeCount: number;
    edgeOff: number;
    vertCount: number;
    vertOff: number;
    sbspLeafCount: number;
    sbspLeafOff: number;
    node3dShift: number;
    planeShift: number;
    leafShift: number;
    ref2dShift: number;
    node2dShift: number;
    surfShift: number;
    edgeShift: number;
    vertShift: number;
    removedCollSurfs: Set<number>;
    keepSurf?: Uint8Array;
    oldToNewSurf?: Int32Array;
    keptSurfs?: number[];
    oldToNewEdge?: Int32Array;
    keptEdges?: number[];
    oldToNewVert?: Int32Array;
    keptVerts?: number[];
    vertNewFirstEdge?: Int32Array;
    compactedLeaves?: { flags: number; count: number; firstRef: number }[];
    compactedRefs?: { plane: number; root: number }[];
    compactedNodes2d?: { srcN: number; c0: number; c1: number }[];
  }

  const collInfos: CollContextInfo[] = [];
  let sumNode3d = splitNodeCount;
  let sumPlanes = 0;
  let sumLeaves = 0;
  let sumRef2d = 0;
  let sumNode2d = 0;
  let sumSurf = 0;
  let sumEdge = 0;
  let sumVert = 0;

  for (let k = 0; k < contexts.length; k++) {
    const ctx = contexts[k];
    const toOff = (ptr: number) => ctx.loc.fileOffsetAnchor + (ptr - ctx.loc.baseMemoryAddress);
    const collRefl = getReflexive(ctx.decoded, 'collision bsp');
    const collOff = toOff(collRefl.pointerLow);
    const node3dCount = sourceBuffer.readUInt32LE(collOff + 0x00);
    const node3dOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x04));
    const planeCount = sourceBuffer.readUInt32LE(collOff + 0x0c);
    const planeOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x10));
    const leafCount = sourceBuffer.readUInt32LE(collOff + 0x18);
    const leafOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x1c));
    const ref2dCount = sourceBuffer.readUInt32LE(collOff + 0x24);
    const ref2dOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x28));
    const node2dCount = sourceBuffer.readUInt32LE(collOff + 0x30);
    const node2dOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x34));
    const surfCount = sourceBuffer.readUInt32LE(collOff + 0x3c);
    const surfOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x40));
    const edgeCount = sourceBuffer.readUInt32LE(collOff + 0x48);
    const edgeOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x4c));
    const vertCount = sourceBuffer.readUInt32LE(collOff + 0x54);
    const vertOff = toOff(sourceBuffer.readUInt32LE(collOff + 0x58));

    const sbspLeavesRefl = getReflexive(ctx.decoded, 'leaves');
    const sbspLeafCount = sbspLeavesRefl.count;
    const sbspLeafOff = toOff(sbspLeavesRefl.pointerLow);

    // Identify collision surfaces in context k that correspond to removed portal/bulkhead blocker triangles
    const removedCollSurfs = new Set<number>();
    const blockerCells = ctxRemovedBlockerCells[k];
    if (blockerCells.size > 0 && surfCount > 0 && edgeCount > 0 && vertCount > 0) {
      for (let s = 0; s < surfCount; s++) {
        const firstEdge = sourceBuffer.readInt32LE(surfOff + s * 12 + 4);
        if (firstEdge < 0 || firstEdge >= edgeCount) continue;
        let e = firstEdge;
        let guard = 0;
        let cx = 0, cy = 0, cz = 0, vCnt = 0;
        let allVertsInBlocker = true;
        do {
          const eOff = edgeOff + e * 24;
          const startV = sourceBuffer.readInt32LE(eOff + 0);
          const endV = sourceBuffer.readInt32LE(eOff + 4);
          const fwdE = sourceBuffer.readInt32LE(eOff + 8);
          const revE = sourceBuffer.readInt32LE(eOff + 12);
          const leftS = sourceBuffer.readInt32LE(eOff + 16);
          const vIdx = leftS === s ? startV : endV;
          if (vIdx >= 0 && vIdx < vertCount) {
            const vx = sourceBuffer.readFloatLE(vertOff + vIdx * 16 + 0);
            const vy = sourceBuffer.readFloatLE(vertOff + vIdx * 16 + 4);
            const vz = sourceBuffer.readFloatLE(vertOff + vIdx * 16 + 8);
            cx += vx; cy += vy; cz += vz; vCnt++;
            if (!blockerCells.has(`${q15cm(vx)},${q15cm(vy)},${q15cm(vz)}`)) {
              allVertsInBlocker = false;
            }
          }
          e = leftS === s ? fwdE : revE;
          guard++;
        } while (e !== firstEdge && e >= 0 && e < edgeCount && guard < 32);

        if (vCnt >= 3) {
          cx /= vCnt; cy /= vCnt; cz /= vCnt;
          if (allVertsInBlocker || blockerCells.has(`${q15cm(cx)},${q15cm(cy)},${q15cm(cz)}`)) {
            removedCollSurfs.add(s);
          }
        }
      }
    }

    collInfos.push({
      collOff,
      node3dCount,
      node3dOff,
      planeCount,
      planeOff,
      leafCount,
      leafOff,
      ref2dCount,
      ref2dOff,
      node2dCount,
      node2dOff,
      surfCount,
      surfOff,
      edgeCount,
      edgeOff,
      vertCount,
      vertOff,
      sbspLeafCount,
      sbspLeafOff,
      node3dShift: sumNode3d,
      planeShift: sumPlanes,
      leafShift: sumLeaves,
      ref2dShift: sumRef2d,
      node2dShift: sumNode2d,
      surfShift: sumSurf,
      edgeShift: sumEdge,
      vertShift: sumVert,
      removedCollSurfs,
    });

    sumNode3d += node3dCount;
    sumPlanes += planeCount;
    sumLeaves += leafCount;
    sumRef2d += ref2dCount;
    sumNode2d += node2dCount;
    sumSurf += surfCount;
    sumEdge += edgeCount;
    sumVert += vertCount;
  }

  const shouldCompactCollision = !useExpandedEngineLimits && preSumCollBytes > maxCollBudgetBytes;
  if (shouldCompactCollision) {
    const q10cm = (n: number) => Math.round(n * 10);
    const seenCollCentroids = new Set<string>();
    const scoredSurfs: { k: number; s: number; score: number }[] = [];
    let totalKeptCollSurfs = 0;

    for (let k = 0; k < collInfos.length; k++) {
      const ci = collInfos[k];
      const keepSurf = new Uint8Array(ci.surfCount);
      for (let s = 0; s < ci.surfCount; s++) {
        if (s > 0 && ci.removedCollSurfs.has(s)) continue;
        const sOff = ci.surfOff + s * 12;
        const rawPlane = sourceBuffer.readInt32LE(sOff + 0);
        const pIdx = rawPlane & 0x7fffffff;
        const nz = pIdx < ci.planeCount ? sourceBuffer.readFloatLE(ci.planeOff + pIdx * 16 + 8) : 0;
        const firstEdge = sourceBuffer.readInt32LE(sOff + 4);
        if (firstEdge < 0 || firstEdge >= ci.edgeCount) {
          if (s === 0) {
            keepSurf[0] = 1;
            totalKeptCollSurfs++;
          }
          continue;
        }
        let e = firstEdge;
        let guard = 0;
        let cx = 0, cy = 0, cz = 0, vCnt = 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        do {
          const eOff = ci.edgeOff + e * 24;
          const startV = sourceBuffer.readInt32LE(eOff + 0);
          const endV = sourceBuffer.readInt32LE(eOff + 4);
          const fwdE = sourceBuffer.readInt32LE(eOff + 8);
          const revE = sourceBuffer.readInt32LE(eOff + 12);
          const leftS = sourceBuffer.readInt32LE(eOff + 16);
          const vIdx = leftS === s ? startV : endV;
          if (vIdx >= 0 && vIdx < ci.vertCount) {
            const vx = sourceBuffer.readFloatLE(ci.vertOff + vIdx * 16 + 0);
            const vy = sourceBuffer.readFloatLE(ci.vertOff + vIdx * 16 + 4);
            const vz = sourceBuffer.readFloatLE(ci.vertOff + vIdx * 16 + 8);
            cx += vx; cy += vy; cz += vz; vCnt++;
            if (vx < minX) minX = vx;
            if (vx > maxX) maxX = vx;
            if (vy < minY) minY = vy;
            if (vy > maxY) maxY = vy;
            if (vz < minZ) minZ = vz;
            if (vz > maxZ) maxZ = vz;
          }
          e = leftS === s ? fwdE : revE;
          guard++;
        } while (e !== firstEdge && e >= 0 && e < ci.edgeCount && guard < 32);

        if (vCnt > 0) {
          cx /= vCnt; cy /= vCnt; cz /= vCnt;
          const cKey = `${q10cm(cx)},${q10cm(cy)},${q10cm(cz)}`;
          if (s > 0 && k >= 1 && seenCollCentroids.has(cKey)) {
            continue; // Duplicate overlapping transition room collision surface
          }
          seenCollCentroids.add(cKey);
        }
        keepSurf[s] = 1;
        totalKeptCollSurfs++;
        if (s > 0) {
          const dx = Number.isFinite(minX) ? maxX - minX : 0;
          const dy = Number.isFinite(minY) ? maxY - minY : 0;
          const dz = Number.isFinite(minZ) ? maxZ - minZ : 0;
          const spanSq = dx * dx + dy * dy + dz * dz;
          const isFloorOrRamp = Math.abs(nz) >= 0.45 && (rawPlane >= 0 ? nz > 0 : nz < 0);
          const score = isFloorOrRamp ? spanSq * 50.0 + 25.0 : spanSq * (dz > 0.5 ? 4.0 : 1.0);
          scoredSurfs.push({ k, s, score });
        }
      }
      ci.keepSurf = keepSurf;
    }

    const fixed3dBytes = sumNode3d * 12 + (sumPlanes + splitNodeCount + 1) * 16 + sumLeaves * 8;
    const maxKeptCollSurfaces = Math.max(
      12000,
      Math.floor(Math.max(1_200_000, maxCollBudgetBytes - fixed3dBytes) / 138),
    );
    if (totalKeptCollSurfs > maxKeptCollSurfaces) {
      scoredSurfs.sort((a, b) => a.score - b.score);
      const toDrop = totalKeptCollSurfs - maxKeptCollSurfaces;
      for (let d = 0; d < toDrop && d < scoredSurfs.length; d++) {
        const item = scoredSurfs[d];
        collInfos[item.k].keepSurf![item.s] = 0;
      }
    }

    sumRef2d = 0;
    sumNode2d = 0;
    sumSurf = 0;
    sumEdge = 0;
    sumVert = 0;

    for (let k = 0; k < collInfos.length; k++) {
      const ci = collInfos[k];
      const keepSurf = ci.keepSurf!;
      keepSurf[0] = 1; // Always keep surface 0

      const oldToNewSurf = new Int32Array(ci.surfCount).fill(-1);
      const keptSurfs: number[] = [];
      const keepEdge = new Uint8Array(ci.edgeCount);

      for (let s = 0; s < ci.surfCount; s++) {
        if (!keepSurf[s]) continue;
        const firstEdge = sourceBuffer.readInt32LE(ci.surfOff + s * 12 + 4);
        if (firstEdge < 0 || firstEdge >= ci.edgeCount) continue;
        let e = firstEdge;
        let guard = 0;
        const ring: number[] = [];
        do {
          ring.push(e);
          const eOff = ci.edgeOff + e * 24;
          const fwdE = sourceBuffer.readInt32LE(eOff + 8);
          const revE = sourceBuffer.readInt32LE(eOff + 12);
          const leftS = sourceBuffer.readInt32LE(eOff + 16);
          e = leftS === s ? fwdE : revE;
          guard++;
        } while (e !== firstEdge && e >= 0 && e < ci.edgeCount && guard < 32);
        if (e === firstEdge && ring.length >= 3) {
          oldToNewSurf[s] = keptSurfs.length;
          keptSurfs.push(s);
          for (const re of ring) keepEdge[re] = 1;
        }
      }

      const oldToNewEdge = new Int32Array(ci.edgeCount).fill(-1);
      const keptEdges: number[] = [];
      const keepVert = new Uint8Array(ci.vertCount);
      const vertNewFirstEdge = new Int32Array(ci.vertCount).fill(0);
      for (let e = 0; e < ci.edgeCount; e++) {
        if (!keepEdge[e]) continue;
        const ne = keptEdges.length;
        oldToNewEdge[e] = ne;
        keptEdges.push(e);
        const eOff = ci.edgeOff + e * 24;
        const sv = sourceBuffer.readInt32LE(eOff + 0);
        const ev = sourceBuffer.readInt32LE(eOff + 4);
        if (sv >= 0 && sv < ci.vertCount) {
          keepVert[sv] = 1;
          vertNewFirstEdge[sv] = ne;
        }
        if (ev >= 0 && ev < ci.vertCount) {
          keepVert[ev] = 1;
          vertNewFirstEdge[ev] = ne;
        }
      }

      const oldToNewVert = new Int32Array(ci.vertCount).fill(-1);
      const keptVerts: number[] = [];
      for (let v = 0; v < ci.vertCount; v++) {
        if (!keepVert[v]) continue;
        oldToNewVert[v] = keptVerts.length;
        keptVerts.push(v);
      }

      ci.surfShift = sumSurf;
      ci.edgeShift = sumEdge;
      ci.vertShift = sumVert;
      ci.ref2dShift = sumRef2d;
      ci.node2dShift = sumNode2d;

      // Resolve and prune bsp2d_nodes & bsp2d_references for context k
      const compactedNodes2d: { srcN: number; c0: number; c1: number }[] = [];
      const node2dMemo = new Int32Array(ci.node2dCount).fill(-2); // -2 = unvisited, -3 = visiting, -1 = pruned
      const resolve2dChild = (ch: number, depth: number): number => {
        if (ch === -1 || depth > 64) return -1;
        if (ch < 0) {
          const localSurf = ch & 0x7fffffff;
          if (localSurf >= ci.surfCount) return -1;
          const ns = oldToNewSurf[localSurf];
          if (ns < 0) return -1;
          return ((ns + ci.surfShift) | 0x80000000) >> 0;
        }
        if (ch >= ci.node2dCount) return -1;
        if (node2dMemo[ch] !== -2) {
          return node2dMemo[ch] === -3 ? -1 : node2dMemo[ch];
        }
        node2dMemo[ch] = -3;
        const nOff = ci.node2dOff + ch * 20;
        const c0 = resolve2dChild(sourceBuffer.readInt32LE(nOff + 12), depth + 1);
        const c1 = resolve2dChild(sourceBuffer.readInt32LE(nOff + 16), depth + 1);
        if (c0 === -1 && c1 === -1) {
          node2dMemo[ch] = -1;
          return -1;
        }
        if (c0 === -1) {
          node2dMemo[ch] = c1;
          return c1;
        }
        if (c1 === -1) {
          node2dMemo[ch] = c0;
          return c0;
        }
        const newIdx = ci.node2dShift + compactedNodes2d.length;
        compactedNodes2d.push({ srcN: ch, c0, c1 });
        node2dMemo[ch] = newIdx;
        return newIdx;
      };

      const compactedLeaves: { flags: number; count: number; firstRef: number }[] = [];
      const compactedRefs: { plane: number; root: number }[] = [];
      for (let l = 0; l < ci.leafCount; l++) {
        const lOff = ci.leafOff + l * 8;
        const flags = sourceBuffer.readUInt16LE(lOff + 0);
        const refCount = sourceBuffer.readUInt16LE(lOff + 2);
        const firstRef = sourceBuffer.readInt32LE(lOff + 4);
        const newFirst = ci.ref2dShift + compactedRefs.length;
        let newCount = 0;
        if (refCount > 0 && firstRef >= 0 && firstRef + refCount <= ci.ref2dCount) {
          for (let r = 0; r < refCount; r++) {
            const rOff = ci.ref2dOff + (firstRef + r) * 8;
            const rawPlane = sourceBuffer.readInt32LE(rOff + 0);
            const rawRoot = sourceBuffer.readInt32LE(rOff + 4);
            const resolvedRoot = resolve2dChild(rawRoot, 1);
            if (resolvedRoot !== -1) {
              const planeSign = rawPlane & 0x80000000;
              const planeIdx = (rawPlane & 0x7fffffff) + ci.planeShift;
              compactedRefs.push({ plane: (planeIdx | planeSign) >> 0, root: resolvedRoot });
              newCount++;
            }
          }
        }
        compactedLeaves.push({
          flags,
          count: newCount,
          firstRef: newCount > 0 ? newFirst : 0,
        });
      }

      ci.oldToNewSurf = oldToNewSurf;
      ci.keptSurfs = keptSurfs;
      ci.oldToNewEdge = oldToNewEdge;
      ci.keptEdges = keptEdges;
      ci.oldToNewVert = oldToNewVert;
      ci.keptVerts = keptVerts;
      ci.vertNewFirstEdge = vertNewFirstEdge;
      ci.compactedLeaves = compactedLeaves;
      ci.compactedRefs = compactedRefs;
      ci.compactedNodes2d = compactedNodes2d;

      sumSurf += keptSurfs.length;
      sumEdge += keptEdges.length;
      sumVert += keptVerts.length;
      sumRef2d += compactedRefs.length;
      sumNode2d += compactedNodes2d.length;
    }
  }

  const totalPlanesWithSplits = sumPlanes + splitNodeCount;

  // 1. Write combined bsp3d_nodes (splitNodeCount root splitting nodes + all contexts' bsp3d_nodes)
  const combinedNode3dDestOff = allocMerged(sumNode3d * 12);
  const splitPlanes: [number, number, number, number][] = [];
  for (let k = 0; k < splitNodeCount; k++) {
    // Compute separating plane between contexts[k] and contexts[k+1]
    const cA = ctxCenters[k];
    const cB = ctxCenters[k + 1];
    const sharedMid = pairSharedCentroids.get(`${k}:${k + 1}`) ?? [
      (cA[0] + cB[0]) * 0.5,
      (cA[1] + cB[1]) * 0.5,
      (cA[2] + cB[2]) * 0.5,
    ];
    let dx = cB[0] - cA[0];
    let dy = cB[1] - cA[1];
    let dz = cB[2] - cA[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let pa = dx, pb = dy, pc = dz;
    if (Math.abs(dx) >= 0.72) {
      pa = Math.sign(dx); pb = 0; pc = 0;
    } else if (Math.abs(dy) >= 0.72) {
      pa = 0; pb = Math.sign(dy); pc = 0;
    }
    const pd = pa * sharedMid[0] + pb * sharedMid[1] + pc * sharedMid[2];
    splitPlanes.push([pa, pb, pc, pd]);

    const splitPlaneIdx = sumPlanes + k;
    const backChild = collInfos[k].node3dShift; // Root 3D node of contexts[k]
    const frontChild = k === splitNodeCount - 1 ? collInfos[k + 1].node3dShift : k + 1;
    const nOff = combinedNode3dDestOff + k * 12;
    merged.writeInt32LE(splitPlaneIdx, nOff + 0);
    merged.writeInt32LE(backChild, nOff + 4);
    merged.writeInt32LE(frontChild, nOff + 8);
  }

  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    for (let n = 0; n < ci.node3dCount; n++) {
      const srcOff = ci.node3dOff + n * 12;
      const dstOff = combinedNode3dDestOff + (ci.node3dShift + n) * 12;
      const rawPlane = sourceBuffer.readInt32LE(srcOff + 0);
      const planeSign = rawPlane & 0x80000000;
      const planeIdx = (rawPlane & 0x7fffffff) + ci.planeShift;
      const shiftChild = (ch: number): number => {
        if (ch === -1) return -1;
        if (ch < 0) return (((ch & 0x7fffffff) + ci.leafShift) | 0x80000000) >> 0;
        return ch + ci.node3dShift;
      };
      const backChild = shiftChild(sourceBuffer.readInt32LE(srcOff + 4));
      const frontChild = shiftChild(sourceBuffer.readInt32LE(srcOff + 8));
      merged.writeInt32LE((planeIdx | planeSign) >> 0, dstOff + 0);
      merged.writeInt32LE(backChild, dstOff + 4);
      merged.writeInt32LE(frontChild, dstOff + 8);
    }
  }

  // 2. Write combined planes (+ splitPlanes at the end + 1 unused dummy plane for disabled portal-blocker bsp2d_references)
  const unusedBlockerPlaneIdx = totalPlanesWithSplits;
  const totalPlanesWithBlockerDummy = totalPlanesWithSplits + 1;
  const combinedPlanesDestOff = allocMerged(totalPlanesWithBlockerDummy * 16);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    const byteLen = ci.planeCount * 16;
    sourceBuffer.copy(merged, combinedPlanesDestOff + ci.planeShift * 16, ci.planeOff, ci.planeOff + byteLen);
  }
  for (let k = 0; k < splitPlanes.length; k++) {
    const pOff = combinedPlanesDestOff + (sumPlanes + k) * 16;
    merged.writeFloatLE(splitPlanes[k][0], pOff + 0);
    merged.writeFloatLE(splitPlanes[k][1], pOff + 4);
    merged.writeFloatLE(splitPlanes[k][2], pOff + 8);
    merged.writeFloatLE(splitPlanes[k][3], pOff + 12);
  }
  {
    const dummyOff = combinedPlanesDestOff + unusedBlockerPlaneIdx * 16;
    merged.writeFloatLE(0, dummyOff + 0);
    merged.writeFloatLE(0, dummyOff + 4);
    merged.writeFloatLE(1, dummyOff + 8);
    merged.writeFloatLE(-100000, dummyOff + 12);
  }

  // 3. Write combined CollisionBSP leaves (8 bytes each)
  const combinedCollLeavesDestOff = allocMerged(sumLeaves * 8);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    if (shouldCompactCollision && ci.compactedLeaves) {
      for (let l = 0; l < ci.compactedLeaves.length; l++) {
        const cl = ci.compactedLeaves[l];
        const dstOff = combinedCollLeavesDestOff + (ci.leafShift + l) * 8;
        merged.writeUInt16LE(cl.flags, dstOff + 0);
        merged.writeUInt16LE(cl.count, dstOff + 2);
        merged.writeInt32LE(cl.count > 0 ? cl.firstRef : 0, dstOff + 4);
      }
    } else {
      for (let l = 0; l < ci.leafCount; l++) {
        const srcOff = ci.leafOff + l * 8;
        const dstOff = combinedCollLeavesDestOff + (ci.leafShift + l) * 8;
        const flags = sourceBuffer.readUInt16LE(srcOff + 0);
        const refCount = sourceBuffer.readUInt16LE(srcOff + 2);
        const firstRef = sourceBuffer.readInt32LE(srcOff + 4);
        merged.writeUInt16LE(flags, dstOff + 0);
        merged.writeUInt16LE(refCount, dstOff + 2);
        merged.writeInt32LE(refCount > 0 && firstRef >= 0 ? firstRef + ci.ref2dShift : -1, dstOff + 4);
      }
    }
  }

  // 4. Write combined bsp2d_references (8 bytes each)
  const combinedRef2dDestOff = allocMerged(Math.max(1, sumRef2d) * 8);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    if (shouldCompactCollision && ci.compactedRefs) {
      for (let r = 0; r < ci.compactedRefs.length; r++) {
        const cr = ci.compactedRefs[r];
        const dstOff = combinedRef2dDestOff + (ci.ref2dShift + r) * 8;
        merged.writeInt32LE(cr.plane, dstOff + 0);
        merged.writeInt32LE(cr.root, dstOff + 4);
      }
    } else {
      for (let r = 0; r < ci.ref2dCount; r++) {
        const srcOff = ci.ref2dOff + r * 8;
        const dstOff = combinedRef2dDestOff + (ci.ref2dShift + r) * 8;
        const rawPlane = sourceBuffer.readInt32LE(srcOff + 0);
        const planeSign = rawPlane & 0x80000000;
        let planeIdx = (rawPlane & 0x7fffffff) + ci.planeShift;
        const rawNode = sourceBuffer.readInt32LE(srcOff + 4);
        let newNode: number;
        if (rawNode === -1) {
          planeIdx = unusedBlockerPlaneIdx;
          newNode = -1;
        } else if (rawNode < 0) {
          const localSurf = rawNode & 0x7fffffff;
          if (ci.removedCollSurfs.has(localSurf)) {
            planeIdx = unusedBlockerPlaneIdx;
            newNode = -1;
          } else {
            newNode = ((localSurf + ci.surfShift) | 0x80000000) >> 0;
          }
        } else {
          newNode = rawNode + ci.node2dShift;
        }
        merged.writeInt32LE((planeIdx | planeSign) >> 0, dstOff + 0);
        merged.writeInt32LE(newNode, dstOff + 4);
      }
    }
  }

  // 5. Write combined bsp2d_nodes (20 bytes each)
  const combinedNode2dDestOff = allocMerged(Math.max(1, sumNode2d) * 20);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    if (shouldCompactCollision && ci.compactedNodes2d) {
      for (let n = 0; n < ci.compactedNodes2d.length; n++) {
        const cn = ci.compactedNodes2d[n];
        const srcOff = ci.node2dOff + cn.srcN * 20;
        const dstOff = combinedNode2dDestOff + (ci.node2dShift + n) * 20;
        sourceBuffer.copy(merged, dstOff, srcOff, srcOff + 12);
        merged.writeInt32LE(cn.c0, dstOff + 12);
        merged.writeInt32LE(cn.c1, dstOff + 16);
      }
    } else {
      const shift2dChild = (ch: number): number => {
        if (ch === -1) return -1;
        if (ch < 0) {
          const localSurf = ch & 0x7fffffff;
          if (ci.removedCollSurfs.has(localSurf)) return -1;
          return ((localSurf + ci.surfShift) | 0x80000000) >> 0;
        }
        return ch + ci.node2dShift;
      };
      for (let n = 0; n < ci.node2dCount; n++) {
        const srcOff = ci.node2dOff + n * 20;
        const dstOff = combinedNode2dDestOff + (ci.node2dShift + n) * 20;
        sourceBuffer.copy(merged, dstOff, srcOff, srcOff + 12);
        let c0 = shift2dChild(sourceBuffer.readInt32LE(srcOff + 12));
        let c1 = shift2dChild(sourceBuffer.readInt32LE(srcOff + 16));
        if (c0 === -1 && c1 !== -1) c0 = c1;
        else if (c1 === -1 && c0 !== -1) c1 = c0;
        // When both children are pruned (-1), keep -1 (NONE) so bsp2d_test_point/pill returns false cleanly
        // rather than falsely redirecting to Surface 0 (0x80000000)!
        merged.writeInt32LE(c0, dstOff + 12);
        merged.writeInt32LE(c1, dstOff + 16);
      }
    }
  }

  // 6. Write combined CollisionBSP surfaces (12 bytes each)
  const combinedCollSurfDestOff = allocMerged(Math.max(1, sumSurf) * 12);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    if (shouldCompactCollision && ci.keptSurfs && ci.oldToNewEdge) {
      for (let idx = 0; idx < ci.keptSurfs.length; idx++) {
        const s = ci.keptSurfs[idx];
        const srcOff = ci.surfOff + s * 12;
        const dstOff = combinedCollSurfDestOff + (ci.surfShift + idx) * 12;
        const rawPlane = sourceBuffer.readInt32LE(srcOff + 0);
        const planeSign = rawPlane & 0x80000000;
        const planeIdx = (rawPlane & 0x7fffffff) + ci.planeShift;
        const firstEdge = sourceBuffer.readInt32LE(srcOff + 4);
        const newFirstEdge = firstEdge >= 0 && firstEdge < ci.edgeCount ? ci.oldToNewEdge[firstEdge] : -1;
        merged.writeInt32LE((planeIdx | planeSign) >> 0, dstOff + 0);
        merged.writeInt32LE(newFirstEdge >= 0 ? newFirstEdge + ci.edgeShift : -1, dstOff + 4);
        sourceBuffer.copy(merged, dstOff + 8, srcOff + 8, srcOff + 12);
        const matIdx = merged.readInt16LE(dstOff + 10);
        if (matIdx < -1 || matIdx >= baseCollisionMaterialsCount) {
          merged.writeInt16LE(baseCollisionMaterialsCount > 0 ? 0 : -1, dstOff + 10);
        }
      }
    } else {
      for (let s = 0; s < ci.surfCount; s++) {
        const srcOff = ci.surfOff + s * 12;
        const dstOff = combinedCollSurfDestOff + (ci.surfShift + s) * 12;
        const rawPlane = sourceBuffer.readInt32LE(srcOff + 0);
        const planeSign = rawPlane & 0x80000000;
        const planeIdx = (rawPlane & 0x7fffffff) + ci.planeShift;
        const firstEdge = sourceBuffer.readInt32LE(srcOff + 4);
        merged.writeInt32LE((planeIdx | planeSign) >> 0, dstOff + 0);
        merged.writeInt32LE(firstEdge >= 0 ? firstEdge + ci.edgeShift : -1, dstOff + 4);
        sourceBuffer.copy(merged, dstOff + 8, srcOff + 8, srcOff + 12);
        const matIdx = merged.readInt16LE(dstOff + 10);
        if (matIdx < -1 || matIdx >= baseCollisionMaterialsCount) {
          merged.writeInt16LE(baseCollisionMaterialsCount > 0 ? 0 : -1, dstOff + 10);
        }
      }
    }
  }

  // 7. Write combined CollisionBSP edges (24 bytes each)
  const combinedCollEdgeDestOff = allocMerged(Math.max(1, sumEdge) * 24);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    if (shouldCompactCollision && ci.keptEdges && ci.oldToNewEdge && ci.oldToNewVert && ci.oldToNewSurf) {
      for (let idx = 0; idx < ci.keptEdges.length; idx++) {
        const e = ci.keptEdges[idx];
        const srcOff = ci.edgeOff + e * 24;
        const dstOff = combinedCollEdgeDestOff + (ci.edgeShift + idx) * 24;
        const sv = sourceBuffer.readInt32LE(srcOff + 0);
        const ev = sourceBuffer.readInt32LE(srcOff + 4);
        const fe = sourceBuffer.readInt32LE(srcOff + 8);
        const re = sourceBuffer.readInt32LE(srcOff + 12);
        const ls = sourceBuffer.readInt32LE(srcOff + 16);
        const rs = sourceBuffer.readInt32LE(srcOff + 20);
        const nsv = sv >= 0 && sv < ci.vertCount && ci.oldToNewVert[sv] >= 0 ? ci.oldToNewVert[sv] + ci.vertShift : 0;
        const nev = ev >= 0 && ev < ci.vertCount && ci.oldToNewVert[ev] >= 0 ? ci.oldToNewVert[ev] + ci.vertShift : 0;
        const mappedFe = fe >= 0 && fe < ci.edgeCount && ci.oldToNewEdge[fe] >= 0 ? ci.oldToNewEdge[fe] + ci.edgeShift : -1;
        const mappedRe = re >= 0 && re < ci.edgeCount && ci.oldToNewEdge[re] >= 0 ? ci.oldToNewEdge[re] + ci.edgeShift : -1;
        const nfe = mappedFe >= 0 ? mappedFe : mappedRe >= 0 ? mappedRe : idx + ci.edgeShift;
        const nre = mappedRe >= 0 ? mappedRe : mappedFe >= 0 ? mappedFe : idx + ci.edgeShift;
        const nls = ls >= 0 && ls < ci.surfCount && ci.oldToNewSurf[ls] >= 0 ? ci.oldToNewSurf[ls] + ci.surfShift : -1;
        const nrs = rs >= 0 && rs < ci.surfCount && ci.oldToNewSurf[rs] >= 0 ? ci.oldToNewSurf[rs] + ci.surfShift : -1;
        merged.writeInt32LE(nsv, dstOff + 0);
        merged.writeInt32LE(nev, dstOff + 4);
        merged.writeInt32LE(nfe, dstOff + 8);
        merged.writeInt32LE(nre, dstOff + 12);
        merged.writeInt32LE(nls, dstOff + 16);
        merged.writeInt32LE(nrs, dstOff + 20);
      }
    } else {
      for (let e = 0; e < ci.edgeCount; e++) {
        const srcOff = ci.edgeOff + e * 24;
        const dstOff = combinedCollEdgeDestOff + (ci.edgeShift + e) * 24;
        const sv = sourceBuffer.readInt32LE(srcOff + 0);
        const ev = sourceBuffer.readInt32LE(srcOff + 4);
        const fe = sourceBuffer.readInt32LE(srcOff + 8);
        const re = sourceBuffer.readInt32LE(srcOff + 12);
        const ls = sourceBuffer.readInt32LE(srcOff + 16);
        const rs = sourceBuffer.readInt32LE(srcOff + 20);
        const mappedFe = fe >= 0 ? fe + ci.edgeShift : -1;
        const mappedRe = re >= 0 ? re + ci.edgeShift : -1;
        merged.writeInt32LE(sv >= 0 ? sv + ci.vertShift : 0, dstOff + 0);
        merged.writeInt32LE(ev >= 0 ? ev + ci.vertShift : 0, dstOff + 4);
        merged.writeInt32LE(mappedFe >= 0 ? mappedFe : mappedRe >= 0 ? mappedRe : e + ci.edgeShift, dstOff + 8);
        merged.writeInt32LE(mappedRe >= 0 ? mappedRe : mappedFe >= 0 ? mappedFe : e + ci.edgeShift, dstOff + 12);
        merged.writeInt32LE(ls >= 0 ? ls + ci.surfShift : -1, dstOff + 16);
        merged.writeInt32LE(rs >= 0 ? rs + ci.surfShift : -1, dstOff + 20);
      }
    }
  }

  // 8. Write combined CollisionBSP vertices (16 bytes each)
  const combinedCollVertDestOff = allocMerged(Math.max(1, sumVert) * 16);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    if (shouldCompactCollision && ci.keptVerts && ci.vertNewFirstEdge) {
      for (let idx = 0; idx < ci.keptVerts.length; idx++) {
        const v = ci.keptVerts[idx];
        const srcOff = ci.vertOff + v * 16;
        const dstOff = combinedCollVertDestOff + (ci.vertShift + idx) * 16;
        sourceBuffer.copy(merged, dstOff, srcOff, srcOff + 12);
        merged.writeInt32LE(ci.vertNewFirstEdge[v] + ci.edgeShift, dstOff + 12);
      }
    } else {
      for (let v = 0; v < ci.vertCount; v++) {
        const srcOff = ci.vertOff + v * 16;
        const dstOff = combinedCollVertDestOff + (ci.vertShift + v) * 16;
        sourceBuffer.copy(merged, dstOff, srcOff, srcOff + 12);
        const fe = sourceBuffer.readInt32LE(srcOff + 12);
        merged.writeInt32LE(fe >= 0 ? fe + ci.edgeShift : -1, dstOff + 12);
      }
    }
  }

  // Update Base BSP 0's 96-byte CollisionBSP header in-place inside `merged`
  const baseCollHeaderOff = collInfos[0].collOff - baseCtx.bspStart;
  merged.writeUInt32LE(sumNode3d, baseCollHeaderOff + 0x00);
  merged.writeUInt32LE(baseAddress + combinedNode3dDestOff, baseCollHeaderOff + 0x04);
  merged.writeUInt32LE(totalPlanesWithBlockerDummy, baseCollHeaderOff + 0x0c);
  merged.writeUInt32LE(baseAddress + combinedPlanesDestOff, baseCollHeaderOff + 0x10);
  merged.writeUInt32LE(sumLeaves, baseCollHeaderOff + 0x18);
  merged.writeUInt32LE(baseAddress + combinedCollLeavesDestOff, baseCollHeaderOff + 0x1c);
  merged.writeUInt32LE(sumRef2d, baseCollHeaderOff + 0x24);
  merged.writeUInt32LE(baseAddress + combinedRef2dDestOff, baseCollHeaderOff + 0x28);
  merged.writeUInt32LE(sumNode2d, baseCollHeaderOff + 0x30);
  merged.writeUInt32LE(baseAddress + combinedNode2dDestOff, baseCollHeaderOff + 0x34);
  merged.writeUInt32LE(sumSurf, baseCollHeaderOff + 0x3c);
  merged.writeUInt32LE(baseAddress + combinedCollSurfDestOff, baseCollHeaderOff + 0x40);
  merged.writeUInt32LE(sumEdge, baseCollHeaderOff + 0x48);
  merged.writeUInt32LE(baseAddress + combinedCollEdgeDestOff, baseCollHeaderOff + 0x4c);
  merged.writeUInt32LE(sumVert, baseCollHeaderOff + 0x54);
  merged.writeUInt32LE(baseAddress + combinedCollVertDestOff, baseCollHeaderOff + 0x58);

  // 9. Write combined ScenarioStructureBSPLeaf array (16 bytes each) so EVERY leaf index across all
  // merged BSPs (k = 0..N-1) maps to Cluster 0 (which contains the spatially-partitioned subclusters
  // for all merged geometry and has 0xFF all-visible PVS!).
  const combinedSbspLeavesDestOff = allocMerged(sumLeaves * 16);
  for (let k = 0; k < collInfos.length; k++) {
    const ci = collInfos[k];
    for (let l = 0; l < ci.leafCount; l++) {
      const dstOff = combinedSbspLeavesDestOff + (ci.leafShift + l) * 16;
      if (k === 0 && l < ci.sbspLeafCount) {
        const srcOff = ci.sbspLeafOff + l * 16;
        sourceBuffer.copy(merged, dstOff, srcOff, srcOff + 16);
        merged.writeInt16LE(0, dstOff + 8); // cluster = 0 (unified cluster containing all subclusters!)
        merged.writeInt16LE(0, dstOff + 10); // surface reference count = 0 (rendered via subclusters)
        merged.writeInt32LE(0, dstOff + 12); // first surface reference index = 0
      } else {
        merged.fill(0, dstOff, dstOff + 6);
        merged.writeUInt8(255, dstOff + 1);
        merged.writeUInt8(255, dstOff + 3);
        merged.writeUInt8(255, dstOff + 5);
        merged.writeUInt16LE(0, dstOff + 6);
        merged.writeInt16LE(0, dstOff + 8); // cluster = 0 (all-visible PVS)
        merged.writeInt16LE(0, dstOff + 10); // surface reference count = 0
        merged.writeInt32LE(0, dstOff + 12); // first surface reference index = 0
      }
    }
  }

  // 10. Partition all merged triangles into spatially-sorted tight-AABB Subclusters in Cluster 0
  // (<= 128 surfaces per subcluster, <= 3800 subclusters < MAXIMUM_SUBCLUSTERS_PER_CLUSTER = 4096)
  // so OpenCE's frustum culler (`render_frustum_cube_visible` on `subcluster->world_bounds`)
  // only submits visible subclusters and NEVER saturates `MAXIMUM_RENDERED_ENVIRONMENT_SURFACES` (16,384)!
  const totalClusters = cumulativeClusterCount;
  if (totalClusters > 0 && outTriMeta.length > 0) {
    // Sort triangles along the dominant world axis (then secondary axis, then Z) so each subcluster has a tight 3D AABB
    const spanX = unionBounds[3] - unionBounds[0];
    const spanY = unionBounds[4] - unionBounds[1];
    const primaryIsX = spanX >= spanY;
    const cellSecondary = 8.0;
    const cellZ = 4.0;
    const sortedTris = [...outTriMeta].sort((a, b) => {
      const pA = primaryIsX ? a.cx : a.cy;
      const pB = primaryIsX ? b.cx : b.cy;
      const bandA = Math.floor(pA / 12.0);
      const bandB = Math.floor(pB / 12.0);
      if (bandA !== bandB) return bandA - bandB;
      const sA = Math.floor((primaryIsX ? a.cy : a.cx) / cellSecondary);
      const sB = Math.floor((primaryIsX ? b.cy : b.cx) / cellSecondary);
      if (sA !== sB) return sA - sB;
      const zA = Math.floor(a.cz / cellZ);
      const zB = Math.floor(b.cz / cellZ);
      if (zA !== zB) return zA - zB;
      return pA - pB;
    });

    const MAX_SUBCLUSTERS = 3800; // < MAXIMUM_SUBCLUSTERS_PER_CLUSTER (4096)
    const trisPerSubcluster = Math.max(64, Math.min(2048, Math.ceil(sortedTris.length / MAX_SUBCLUSTERS), 128));
    const actualChunk = Math.max(trisPerSubcluster, Math.ceil(sortedTris.length / MAX_SUBCLUSTERS));
    const numSubclusters = Math.ceil(sortedTris.length / actualChunk);
    const subclustersDestOff = allocMerged(numSubclusters * 36);
    const allSurfIndicesOff = allocMerged(sortedTris.length * 4);

    for (let sc = 0; sc < numSubclusters; sc++) {
      const sStart = sc * actualChunk;
      const sCount = Math.min(actualChunk, sortedTris.length - sStart);
      const surfIndicesOff = allSurfIndicesOff + sStart * 4;
      let bMinX = Infinity, bMaxX = -Infinity;
      let bMinY = Infinity, bMaxY = -Infinity;
      let bMinZ = Infinity, bMaxZ = -Infinity;
      for (let s = 0; s < sCount; s++) {
        const tm = sortedTris[sStart + s];
        merged.writeInt32LE(tm.surfIdx, surfIndicesOff + s * 4);
        if (tm.minX < bMinX) bMinX = tm.minX;
        if (tm.maxX > bMaxX) bMaxX = tm.maxX;
        if (tm.minY < bMinY) bMinY = tm.minY;
        if (tm.maxY > bMaxY) bMaxY = tm.maxY;
        if (tm.minZ < bMinZ) bMinZ = tm.minZ;
        if (tm.maxZ > bMaxZ) bMaxZ = tm.maxZ;
      }
      if (!Number.isFinite(bMinX)) {
        bMinX = unionBounds[0]; bMaxX = unionBounds[3];
        bMinY = unionBounds[1]; bMaxY = unionBounds[4];
        bMinZ = unionBounds[2]; bMaxZ = unionBounds[5];
      }
      const scOff = subclustersDestOff + sc * 36;
      merged.writeFloatLE(bMinX - 0.05, scOff + 0x00);
      merged.writeFloatLE(bMaxX + 0.05, scOff + 0x04);
      merged.writeFloatLE(bMinY - 0.05, scOff + 0x08);
      merged.writeFloatLE(bMaxY + 0.05, scOff + 0x0c);
      merged.writeFloatLE(bMinZ - 0.05, scOff + 0x10);
      merged.writeFloatLE(bMaxZ + 0.05, scOff + 0x14);
      merged.writeUInt32LE(sCount, scOff + 0x18);
      merged.writeUInt32LE(baseAddress + surfIndicesOff, scOff + 0x1c);
      merged.writeUInt32LE(0, scOff + 0x20);
    }

    const baseClustersOff = baseClustersRefl.pointerLow - baseAddress;
    // Cluster 0 gets the spatially-sorted tight-AABB subclusters containing all merged triangles
    merged.writeInt16LE(-1, baseClustersOff + 0x0c); // first_runtime_decal_index = NONE
    merged.writeInt16LE(0, baseClustersOff + 0x0e);  // runtime_decal_count = 0
    merged.writeUInt32LE(numSubclusters, baseClustersOff + 0x34);
    merged.writeUInt32LE(baseAddress + subclustersDestOff, baseClustersOff + 0x38);
    merged.writeUInt32LE(0, baseClustersOff + 0x3c);
    merged.fill(0, baseClustersOff + 0x44, baseClustersOff + 0x68); // zero surface_indices (0x44), mirrors (0x50), portals (0x5c)
    // Clusters 1..N-1 have 0 subclusters/surfaces/mirrors/portals so surfaces aren't duplicated and tag_validate claims don't overlap
    for (let c = 1; c < totalClusters; c++) {
      const cOff = baseClustersOff + c * 104;
      merged.writeInt16LE(-1, cOff + 0x0c); // first_runtime_decal_index = NONE
      merged.writeInt16LE(0, cOff + 0x0e);  // runtime_decal_count = 0
      merged.writeUInt32LE(0, cOff + 0x34);
      merged.writeUInt32LE(0, cOff + 0x38);
      merged.writeUInt32LE(0, cOff + 0x3c);
      merged.fill(0, cOff + 0x44, cOff + 0x68); // zero surface_indices (0x44), mirrors (0x50), portals (0x5c)
    }
  }

  // Write All-Visible Clusters & PVS
  // Halo CE PVS bitvectors are 32-bit (4-byte) aligned rows: ((clusters + 31) >> 5) * 4.
  // Halo's structure_bsp_load verifies: cluster_data.size >= clusters.count * (((clusters.count + 31) >> 3) & ~3).
  const pvsBytesPerCluster = totalClusters > 0 ? Math.ceil(totalClusters / 32) * 4 : 0;
  const pvsTotalSize = totalClusters * pvsBytesPerCluster;
  const pvsDestOff = allocMerged(pvsTotalSize);
  merged.fill(0xff, pvsDestOff, pvsDestOff + pvsTotalSize);

  // Update ScenarioStructureBSP Root Struct (starts at offset 0x18 in BSP chunk)
  const rootOffset = 0x18;

  // Zero unused 3D render nodes reflexive at 0xbc..0xc7
  merged.fill(0, rootOffset + 0xbc, rootOffset + 0xc8);

  // World bounds union
  merged.writeFloatLE(unionBounds[0], rootOffset + 0xc8);
  merged.writeFloatLE(unionBounds[3], rootOffset + 0xcc);
  merged.writeFloatLE(unionBounds[1], rootOffset + 0xd0);
  merged.writeFloatLE(unionBounds[4], rootOffset + 0xd4);
  merged.writeFloatLE(unionBounds[2], rootOffset + 0xd8);
  merged.writeFloatLE(unionBounds[5], rootOffset + 0xdc);

  // Vehicle floor & ceiling (0x10 and 0x14)
  merged.writeFloatLE(vehicleFloor, rootOffset + 0x10);
  merged.writeFloatLE(vehicleCeiling, rootOffset + 0x14);
  if (compactLightmapVerts) {
    // In Hybrid 23 MB mode, set lightmaps bitmap TagDependency (0x00..0x0f) to NONE so Halo CE's
    // structure_render_lightmaps switches to _rasterizer_lightmap_mode_no_lightmap and renders
    // all diffuse shader textures at full brightness without per-vertex lightmap data.
    merged.writeUInt32LE(0, rootOffset + 0x04);
    merged.writeUInt32LE(0, rootOffset + 0x08);
    merged.writeUInt32LE(0xffffffff, rootOffset + 0x0c);
  }

  // ScenarioStructureBSP leaves reflexive at 0xe0 (NOT 0x11c which is lens flares!)
  merged.writeUInt32LE(sumLeaves, rootOffset + 0xe0);
  merged.writeUInt32LE(baseAddress + combinedSbspLeavesDestOff, rootOffset + 0xe4);

  // Zero leaf surfaces reflexive at 0xec..0xf4 (rendered via subclusters)
  merged.fill(0, rootOffset + 0xec, rootOffset + 0xf8);

  // Surfaces reflexive at 0xf8
  merged.writeUInt32LE(totalTriangles, rootOffset + 0xf8);
  merged.writeUInt32LE(baseAddress + combinedSurfacesDestOff, rootOffset + 0xfc);

  // Lightmaps reflexive at 0x104
  merged.writeUInt32LE(allLightmaps.length, rootOffset + 0x104);
  merged.writeUInt32LE(baseAddress + combinedLmDestOff, rootOffset + 0x108);

  // Cluster data tagDataOffset at 0x140 (size at 0x140, pointerLow at 0x14c)
  merged.writeUInt32LE(pvsTotalSize, rootOffset + 0x140);
  merged.writeUInt32LE(baseAddress + pvsDestOff, rootOffset + 0x14c);

  // Zero cluster_portals reflexive at 0x154..0x160 (since all leaves map to Cluster 0)
  merged.fill(0, rootOffset + 0x150, rootOffset + 0x160);

  // Zero reclaimed pathfinding_surfaces (0x1e4), detail_objects (0x24c), and runtime_decals (0x258)
  merged.fill(0, rootOffset + 0x1e4, rootOffset + 0x1f0);
  merged.fill(0, rootOffset + 0x24c, rootOffset + 0x264);

  const finalMergedSize = (appendOffset + 511) & ~511;
  const finalMergedBuffer = Buffer.alloc(finalMergedSize);
  merged.copy(finalMergedBuffer, 0, 0, finalMergedSize);

  // Ceiling for Custom Edition Structure BSPs:
  // - Standard 23 MiB ceiling: 0x40440000 + 0x01700000 = 0x41B40000 (default Hybrid BSP mode)
  // - Extended 122 MiB ceiling: 0x40440000 + 0x07A00000 = 0x47E40000 (when useExpandedEngineLimits is enabled)
  const CE_STOCK_CEILING = 0x41b40000;
  const CE_EXTENDED_CEILING = 0x47e40000;
  const bspCacheCeiling =
    options.useExpandedEngineLimits === true &&
    (finalMergedSize > 17_616_076 || header.tagDataSize + finalMergedSize + 1_500_000 > 23 * 1024 * 1024)
      ? CE_EXTENDED_CEILING
      : CE_STOCK_CEILING;
  const finalBspAddress = (bspCacheCeiling - finalMergedSize) & ~511;
  rebaseStructureBspPointers(finalMergedBuffer, baseAddress, finalBspAddress);

  const anyDobc = contexts.some((c) => c.hasDobc);
  const anyDecals = contexts.some((c) => c.hasDecals);
  const mergedNames = contexts.map((c) => c.bspName);

  return {
    bspBuffer: finalMergedBuffer,
    bspSize: finalMergedSize,
    bspAddress: finalBspAddress,
    vertexCount: totalVertices,
    triangleCount: totalTriangles,
    submeshCount: totalSubmeshes,
    worldBounds: unionBounds,
    hasDobc: anyDobc,
    hasDecals: anyDecals,
    mergedBspNames: mergedNames,
    removedDuplicateTriangles,
    removedPortalBlockerTriangles,
    donorLightmapTagIds: compactLightmapVerts ? [] : donorLightmapTagIds,
    plateOffsetByContext,
  };
}

export interface InjectProceduralBspOptions {
  /** Target Scenario BSP index (default: 0). */
  bspIndex?: number;
  /** Optional explicit shader tag bindings per `WorldMaterialRole`. */
  shaderBindings?: Partial<Record<WorldMaterialRole, { tagId: number; path: string; classFourCC: string }>>;
  /** Optional collision compilation mode ('auto' | 'exact'). */
  collisionMode?: 'auto' | 'exact';
}

export interface InjectProceduralBspResult {
  mapBuffer: Buffer;
  addedVertices: number;
  addedTriangles: number;
  addedSubmeshes: number;
  addedCollisionSurfaces: number;
  addedCollisionNodes3d: number;
  newBspSize: number;
  newBspAddress: number;
  worldBounds: [number, number, number, number, number, number];
}

/**
 * Injects a procedural `GeneratedWorldMesh` (Tunnel+Cave network, Multi-Style Bridge network,
 * or QuickForge Terrain/Biome/City/Forerunner world) directly into a Halo CE map's `ScenarioStructureBSP` (`sbsp`).
 *
 * Fuses:
 * 1. Rendered submeshes (`ScenarioStructureBSPLightmap` with `bitmap = -1` full-brightness diffuse shaders
 + `ScenarioStructureBSPMaterial` with 56-byte uncompressed vertices + indexed `surfaces`).
 * 2. Cluster 0 tight-AABB `subclusters` so Halo CE's frustum culler renders the new geometry from all clusters.
 * 3. Compiled 3D & 2D `CollisionBSP` (`bsp3d_nodes` joined via a root separating plane + `planes` + `leaves` +
 *    `bsp2d_references` + `bsp2d_nodes` + winged-edge `surfaces`, `edges`, and `vertices`) + `ScenarioStructureBSPLeaf`.
 * 4. Expanded `world_bounds` and `vehicle_floor` / `vehicle_ceiling`.
 */
export function injectProceduralWorldIntoMapBsp(
  sourceBuffer: Buffer,
  worldMesh: GeneratedWorldMesh,
  options: InjectProceduralBspOptions = {},
): InjectProceduralBspResult {
  if (worldMesh.vertices.length === 0 || worldMesh.triangles.length === 0) {
    throw new Error('Procedural world mesh has no vertices or triangles to inject.');
  }

  const inspected = inspectCustomEditionMap(sourceBuffer);
  if (inspected.status !== 'ok') {
    throw new Error('Failed to inspect map buffer header or tag index.');
  }
  const { header, tagIndex } = inspected;
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    throw new Error('Scenario tag not found in map tag index.');
  }

  const scenarioFileOffset =
    header.tagDataOffset + (scenarioEntry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
  const decodedScenario = decodeStruct(sourceBuffer, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive' || bspsField.value.count === 0) {
    throw new Error('Scenario has no structure bsps.');
  }

  const bspIdx = Math.max(0, Math.min(bspsField.value.count - 1, options.bspIndex ?? 0));
  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspsArrayOffset = header.tagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);
  const bspEntryOffset = bspsArrayOffset + bspIdx * scenarioBspSize;
  const decodedBspEntry = decodeStruct(sourceBuffer, bspEntryOffset, 'ScenarioBSP');
  const bspDep = decodedBspEntry.get('structure bsp');
  const bspTagId = bspDep && bspDep.kind === 'dependency' ? bspDep.value.tagId : 0xffffffff;
  const oldBspStart = (decodedBspEntry.get('bsp start') as { kind: 'basic'; value: number }).value;
  const oldBspSize = (decodedBspEntry.get('bsp size') as { kind: 'basic'; value: number }).value;
  const baseAddress = (decodedBspEntry.get('bsp address') as { kind: 'basic'; value: number }).value;

  const loc = locateStructureBsp(
    sourceBuffer,
    tagIndex,
    scenarioFileOffset,
    header.tagDataOffset,
    tagIndex.baseMemoryAddress,
    bspTagId,
    bspIdx,
  );
  if (!loc) {
    throw new Error(`Failed to locate Structure BSP ${bspIdx}.`);
  }

  const decodedBsp = decodeStruct(sourceBuffer, loc.fileOffset, 'ScenarioStructureBSP');

  // Resolve shader bindings for each material role in the procedural mesh
  const autoShaders = resolveDefaultHaloShadersForWorld(tagIndex.entries, worldMesh.materialRoles);
  const resolvedShaders: Record<WorldMaterialRole, { tagId: number; path: string; classFourCC: string }> = {
    ...autoShaders,
  };
  if (options.shaderBindings) {
    for (const [role, binding] of Object.entries(options.shaderBindings)) {
      if (binding && binding.tagId !== undefined && binding.tagId !== 0xffffffff) {
        resolvedShaders[role as WorldMaterialRole] = binding;
      }
    }
  }

  // Group procedural/merged triangles by explicit shaderPath/shaderTagId (for Donor Map World Merger) or by materialRole
  interface TriangleBucket {
    role: WorldMaterialRole;
    shaderPath?: string;
    shaderTagId?: number;
    shaderClassFourCC?: string;
    tris: { v0: number; v1: number; v2: number }[];
  }
  const bucketMap = new Map<string, TriangleBucket>();
  for (const t of worldMesh.triangles) {
    if (t.isPortal) continue;
    const key =
      t.shaderPath || (t.shaderTagId !== undefined && t.shaderTagId !== 0xffffffff)
        ? `shader:${(t.shaderPath || '').toLowerCase()}|${t.shaderTagId ?? ''}`
        : `role:${t.materialRole}`;
    let b = bucketMap.get(key);
    if (!b) {
      b = {
        role: t.materialRole,
        shaderPath: t.shaderPath,
        shaderTagId: t.shaderTagId,
        shaderClassFourCC: t.shaderClassFourCC,
        tris: [],
      };
      bucketMap.set(key, b);
    }
    b.tris.push({ v0: t.v0, v1: t.v1, v2: t.v2 });
  }

  // Allocate working BSP buffer with room for existing BSP + new render/collision arrays
  const extraBytes = Math.max(
    16 * 1024 * 1024,
    worldMesh.vertices.length * 160 + worldMesh.triangles.length * 128 + 8 * 1024 * 1024,
  );
  const workCapacity = oldBspSize + extraBytes;
  const bspBuf = Buffer.alloc(workCapacity, 0);
  sourceBuffer.copy(bspBuf, 0, oldBspStart, oldBspStart + oldBspSize);
  let cursor = (oldBspSize + 15) & ~15;
  const toRel = (ptr: number): number => ptr - baseAddress;

  // Snapshot all existing replaceable arrays inside `bspBuf` FIRST and reclaim their byte ranges
  const freeRanges: { start: number; end: number }[] = [];
  const markFreeRange = (relStart: number, byteLen: number): void => {
    if (byteLen < 32 || relStart < 0x200 || relStart + byteLen > oldBspSize) return;
    freeRanges.push({ start: relStart, end: relStart + byteLen });
  };
  const sliceAndReclaim = (relStart: number, byteLen: number): Buffer => {
    if (byteLen <= 0 || relStart < 0 || relStart + byteLen > oldBspSize) return Buffer.alloc(0);
    const copy = Buffer.from(bspBuf.subarray(relStart, relStart + byteLen));
    markFreeRange(relStart, byteLen);
    return copy;
  };

  // 1. Read existing surfaces, lightmaps, clusters, leaves, and collision BSP
  const rootOff = 0x18;
  const oldSurfacesRefl = getReflexive(decodedBsp, 'surfaces');
  const oldSurfCount = oldSurfacesRefl.count;
  const oldSurfRel = toRel(oldSurfacesRefl.pointerLow);
  const oldSurfacesBuf = sliceAndReclaim(oldSurfRel, oldSurfCount * 6);

  const oldLmRefl = getReflexive(decodedBsp, 'lightmaps');
  const oldLmCount = oldLmRefl.count;
  const oldLmRel = toRel(oldLmRefl.pointerLow);
  const lmStructSize = 32;
  const matStructSize = 256;

  // Grab a template 256-byte ScenarioStructureBSPMaterial from existing BSP to preserve valid vertex buffer header fields
  const templateMatBuf = Buffer.alloc(matStructSize, 0);
  if (oldLmCount > 0 && oldLmRel >= 0 && oldLmRel + lmStructSize <= oldBspSize) {
    const firstMatsCount = bspBuf.readUInt32LE(oldLmRel + 0x14);
    const firstMatsPtr = bspBuf.readUInt32LE(oldLmRel + 0x18);
    const firstMatsRel = toRel(firstMatsPtr);
    if (firstMatsCount > 0 && firstMatsRel >= 0 && firstMatsRel + matStructSize <= oldBspSize) {
      bspBuf.copy(templateMatBuf, 0, firstMatsRel, firstMatsRel + matStructSize);
    }
  }
  const oldLmBuf = sliceAndReclaim(oldLmRel, oldLmCount * lmStructSize);

  const clustersRefl = getReflexive(decodedBsp, 'clusters');
  const clustersRel = clustersRefl.count > 0 ? toRel(clustersRefl.pointerLow) : -1;
  const oldScChunks: Buffer[] = [];
  if (clustersRel >= 0) {
    for (let c = 0; c < clustersRefl.count; c++) {
      const cEnt = clustersRel + c * 104;
      const scCnt = bspBuf.readUInt32LE(cEnt + 0x34);
      const scRel = toRel(bspBuf.readUInt32LE(cEnt + 0x38));
      if (scCnt > 0 && scRel >= 0 && scRel + scCnt * 36 <= oldBspSize) {
        oldScChunks.push(sliceAndReclaim(scRel, scCnt * 36));
      }
    }
  }
  const oldScBuf = oldScChunks.length > 0 ? Buffer.concat(oldScChunks) : Buffer.alloc(0);
  const oldScCount = Math.floor(oldScBuf.length / 36);

  // Reclaim obsolete visibility/portal/decal blocks so all geometry renders from consolidated Cluster 0
  const nodesRefl = getReflexive(decodedBsp, 'nodes');
  markFreeRange(toRel(nodesRefl.pointerLow), nodesRefl.count * 6);
  const leafSurfRefl = getReflexive(decodedBsp, 'leaf surfaces');
  markFreeRange(toRel(leafSurfRefl.pointerLow), leafSurfRefl.count * 8);
  const portalsRefl = getReflexive(decodedBsp, 'cluster portals');
  markFreeRange(toRel(portalsRefl.pointerLow), portalsRefl.count * 64);
  const dobcRefl = getReflexive(decodedBsp, 'detail objects');
  markFreeRange(toRel(dobcRefl.pointerLow), dobcRefl.count * 64);
  const decalsRefl = getReflexive(decodedBsp, 'runtime decals');
  markFreeRange(toRel(decalsRefl.pointerLow), decalsRefl.count * 16);

  const collRefl = getReflexive(decodedBsp, 'collision bsp');
  const collRel = toRel(collRefl.pointerLow);
  const oldN3dCount = bspBuf.readUInt32LE(collRel + 0x00);
  const oldN3dRel = toRel(bspBuf.readUInt32LE(collRel + 0x04));
  const oldN3dBuf = sliceAndReclaim(oldN3dRel, oldN3dCount * 12);

  const oldPlnCount = bspBuf.readUInt32LE(collRel + 0x0c);
  const oldPlnRel = toRel(bspBuf.readUInt32LE(collRel + 0x10));
  const oldPlnBuf = sliceAndReclaim(oldPlnRel, oldPlnCount * 16);

  const oldLeafCount = bspBuf.readUInt32LE(collRel + 0x18);
  const oldLeafRel = toRel(bspBuf.readUInt32LE(collRel + 0x1c));
  const oldLeafBuf = sliceAndReclaim(oldLeafRel, oldLeafCount * 8);

  const oldRef2dCount = bspBuf.readUInt32LE(collRel + 0x24);
  const oldRef2dRel = toRel(bspBuf.readUInt32LE(collRel + 0x28));
  const oldRef2dBuf = sliceAndReclaim(oldRef2dRel, oldRef2dCount * 8);

  const oldNode2dCount = bspBuf.readUInt32LE(collRel + 0x30);
  const oldNode2dRel = toRel(bspBuf.readUInt32LE(collRel + 0x34));
  const oldNode2dBuf = sliceAndReclaim(oldNode2dRel, oldNode2dCount * 20);

  const oldCSurfCount = bspBuf.readUInt32LE(collRel + 0x3c);
  const oldCSurfRel = toRel(bspBuf.readUInt32LE(collRel + 0x40));
  const oldCSurfBuf = sliceAndReclaim(oldCSurfRel, oldCSurfCount * 12);

  const oldCEdgeCount = bspBuf.readUInt32LE(collRel + 0x48);
  const oldCEdgeRel = toRel(bspBuf.readUInt32LE(collRel + 0x4c));
  const oldCEdgeBuf = sliceAndReclaim(oldCEdgeRel, oldCEdgeCount * 24);

  const oldCVertCount = bspBuf.readUInt32LE(collRel + 0x54);
  const oldCVertRel = toRel(bspBuf.readUInt32LE(collRel + 0x58));
  const oldCVertBuf = sliceAndReclaim(oldCVertRel, oldCVertCount * 16);

  const sbspLeavesRefl = getReflexive(decodedBsp, 'leaves');
  const oldSbspLeafRel = toRel(sbspLeavesRefl.pointerLow);
  const copySbspLeafCount = Math.min(sbspLeavesRefl.count, oldLeafCount);
  const oldSbspLeavesBuf = sliceAndReclaim(oldSbspLeafRel, sbspLeavesRefl.count * 16);

  // Coalesce adjacent/overlapping free ranges so contiguous CollisionBSP blocks merge into single large spans
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
  const reclaimedTotalBytes = mergedFreeRanges.reduce((acc, r) => acc + (r.end - r.start), 0);

  const alloc = (byteLen: number): number => {
    const aligned = (Math.max(1, byteLen) + 15) & ~15;
    let bestIdx = -1;
    let bestRemainder = Infinity;
    for (let i = 0; i < mergedFreeRanges.length; i++) {
      const r = mergedFreeRanges[i];
      const aStart = (r.start + 15) & ~15;
      if (aStart + aligned <= r.end) {
        const rem = r.end - (aStart + aligned);
        if (rem < bestRemainder) {
          bestRemainder = rem;
          bestIdx = i;
        }
      }
    }
    if (bestIdx !== -1) {
      const r = mergedFreeRanges[bestIdx];
      const aStart = (r.start + 15) & ~15;
      r.start = aStart + aligned;
      if (r.end - r.start < 16) {
        mergedFreeRanges.splice(bestIdx, 1);
      }
      return aStart;
    }
    const out = cursor;
    cursor += aligned;
    return out;
  };

  // Build new submeshes per bucket (with spatial + UV vertex deduplication and <= 32,766 vertices per chunk)
  interface NewSubmeshData {
    shaderTagId: number;
    shaderClassFourCC: string;
    vertBuf: Buffer;
    vertCount: number;
    surfBuf: Buffer;
    surfStart: number;
    surfCount: number;
    centroid: [number, number, number];
  }
  interface TriBoundsMeta {
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
  }
  const newSubmeshes: NewSubmeshData[] = [];
  let runningSurfCount = oldSurfCount;
  let addedVertices = 0;
  let addedTriangles = 0;
  const triMetaForSubclusters: TriBoundsMeta[] = [];

  const fourCCToStr = (fcc: number): string =>
    String.fromCharCode((fcc >>> 24) & 0xff, (fcc >>> 16) & 0xff, (fcc >>> 8) & 0xff, fcc & 0xff);

  const MAX_VERTS_PER_CHUNK = 32766;
  for (const bucket of bucketMap.values()) {
    const allRoleTris = bucket.tris;
    if (allRoleTris.length === 0) continue;
    let shaderInfo = resolvedShaders[bucket.role] ?? Object.values(resolvedShaders)[0];
    if (bucket.shaderPath) {
      const normPath = bucket.shaderPath.toLowerCase();
      const matchedByPath = tagIndex.entries.find(
        (e) => e.path.toLowerCase() === normPath && (e.primaryClassName?.startsWith('shader') ?? false),
      );
      if (matchedByPath) {
        shaderInfo = {
          tagId: matchedByPath.tagId,
          path: matchedByPath.path,
          classFourCC: fourCCToStr(matchedByPath.primaryClassFourCC),
        };
      }
    } else if (bucket.shaderTagId !== undefined && bucket.shaderTagId !== 0xffffffff) {
      const matchedById = tagIndex.entries.find(
        (e) => e.tagId === bucket.shaderTagId && (e.primaryClassName?.startsWith('shader') ?? false),
      );
      if (matchedById) {
        shaderInfo = {
          tagId: matchedById.tagId,
          path: matchedById.path,
          classFourCC: fourCCToStr(matchedById.primaryClassFourCC),
        };
      }
    }

    let triCursor = 0;
    while (triCursor < allRoleTris.length) {
      const localVMap = new Map<string, number>();
      const localVerts: number[] = [];
      const chunkTris: { nv0: number; nv1: number; nv2: number; orig: { v0: number; v1: number; v2: number } }[] = [];
      const mapV = (origIdx: number): number => {
        const wv = worldMesh.vertices[origIdx];
        const [px, py, pz] = wv.position;
        const [nx, ny, nz] = wv.normal;
        const [u, v] = wv.uv;
        const vKey = `${Math.round(px * 1000)},${Math.round(py * 1000)},${Math.round(pz * 1000)},${Math.round(nx * 200)},${Math.round(ny * 200)},${Math.round(nz * 200)},${Math.round(u * 2000)},${Math.round(v * 2000)}`;
        const ex = localVMap.get(vKey);
        if (ex !== undefined) return ex;
        const ni = localVerts.length;
        localVerts.push(origIdx);
        localVMap.set(vKey, ni);
        return ni;
      };

      while (triCursor < allRoleTris.length) {
        if (localVerts.length + 3 > MAX_VERTS_PER_CHUNK && chunkTris.length > 0) {
          break;
        }
        const rt = allRoleTris[triCursor]!;
        triCursor++;
        const nv0 = mapV(rt.v0);
        const nv1 = mapV(rt.v1);
        const nv2 = mapV(rt.v2);
        chunkTris.push({ nv0, nv1, nv2, orig: rt });
      }
      if (chunkTris.length === 0) continue;

      const sBuf = Buffer.alloc(chunkTris.length * 6);
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < chunkTris.length; i++) {
        const ct = chunkTris[i]!;
        // Halo CE D3D9 structure BSP surfaces use Clockwise (CW) front-face winding (`v0, v2, v1`),
        // whereas `worldMesh` (and `extractBspRenderMesh`) uses Counter-Clockwise (CCW) `(v0, v1, v2)`.
        sBuf.writeUInt16LE(ct.nv0, i * 6 + 0);
        sBuf.writeUInt16LE(ct.nv2, i * 6 + 2);
        sBuf.writeUInt16LE(ct.nv1, i * 6 + 4);
        const p0 = worldMesh.vertices[ct.orig.v0].position;
        const p1 = worldMesh.vertices[ct.orig.v1].position;
        const p2 = worldMesh.vertices[ct.orig.v2].position;
        const tcx = (p0[0] + p1[0] + p2[0]) / 3;
        const tcy = (p0[1] + p1[1] + p2[1]) / 3;
        const tcz = (p0[2] + p1[2] + p2[2]) / 3;
        cx += tcx;
        cy += tcy;
        cz += tcz;
        triMetaForSubclusters.push({
          surfIdx: runningSurfCount + i,
          cx: tcx,
          cy: tcy,
          cz: tcz,
          minX: Math.min(p0[0], p1[0], p2[0]),
          maxX: Math.max(p0[0], p1[0], p2[0]),
          minY: Math.min(p0[1], p1[1], p2[1]),
          maxY: Math.max(p0[1], p1[1], p2[1]),
          minZ: Math.min(p0[2], p1[2], p2[2]),
          maxZ: Math.max(p0[2], p1[2], p2[2]),
        });
      }

      const vCount = localVerts.length;
      const vBuf = Buffer.alloc(vCount * 56, 0);
      for (let v = 0; v < vCount; v++) {
        const wv = worldMesh.vertices[localVerts[v]];
        const vo = v * 56;
        const [px, py, pz] = wv.position;
        const [nx, ny, nz] = wv.normal;
        // Compute orthonormal binormal & tangent
        const ref: [number, number, number] = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        let tx = ref[1] * nz - ref[2] * ny;
        let ty = ref[2] * nx - ref[0] * nz;
        let tz = ref[0] * ny - ref[1] * nx;
        const tLen = Math.hypot(tx, ty, tz) || 1;
        tx /= tLen; ty /= tLen; tz /= tLen;
        const bx = ny * tz - nz * ty;
        const by = nz * tx - nx * tz;
        const bz = nx * ty - ny * tx;

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
        vBuf.writeFloatLE(wv.uv[0], vo + 48);
        vBuf.writeFloatLE(wv.uv[1], vo + 52);
      }

      const invCount = 1 / Math.max(1, chunkTris.length);
      newSubmeshes.push({
        shaderTagId: shaderInfo.tagId,
        shaderClassFourCC: shaderInfo.classFourCC || 'senv',
        vertBuf: vBuf,
        vertCount: vCount,
        surfBuf: sBuf,
        surfStart: runningSurfCount,
        surfCount: chunkTris.length,
        centroid: [cx * invCount, cy * invCount, cz * invCount],
      });

      runningSurfCount += chunkTris.length;
      addedVertices += vCount;
      addedTriangles += chunkTris.length;
    }
  }

  // Adaptive targetCollisionFaces so finalBspSize fits cleanly inside Halo CE's tag cache
  const CE_STOCK_CEILING = 0x41b40000;
  const CE_EXTENDED_CEILING = 0x47e40000; // 0x40440000 + 0x07A00000 (122 MiB)
  const maxAllowedBspSize = Math.max(
    oldBspSize,
    (CE_EXTENDED_CEILING - (0x40440000 + header.tagDataSize) - 65536) & ~511,
  );
  const newRenderBytes =
    addedVertices * 56 +
    runningSurfCount * 6 +
    newSubmeshes.length * matStructSize +
    triMetaForSubclusters.length * 4 +
    (oldLmCount + 1) * lmStructSize +
    (oldScCount + Math.ceil(triMetaForSubclusters.length / 128) + 1) * 36;
  const existingCollBytes =
    oldN3dBuf.length +
    oldPlnBuf.length +
    oldLeafBuf.length +
    oldRef2dBuf.length +
    oldNode2dBuf.length +
    oldCSurfBuf.length +
    oldCEdgeBuf.length +
    oldCVertBuf.length +
    oldSbspLeavesBuf.length;
  const availableForNewCollBytes = Math.max(
    180_000,
    maxAllowedBspSize - oldBspSize + reclaimedTotalBytes - newRenderBytes - existingCollBytes - 98304,
  );
  const adaptiveTargetFaces = Math.max(
    1500,
    Math.min(16000, Math.floor(availableForNewCollBytes / 175)),
  );

  // Compute AABB boundary planes wrapping `worldMesh.bounds`
  const pad = 3.5;
  const [wMinX, wMinY, wMinZ] = [
    worldMesh.bounds.min[0] - pad,
    worldMesh.bounds.min[1] - pad,
    worldMesh.bounds.min[2] - pad,
  ];
  const [wMaxX, wMaxY, wMaxZ] = [
    worldMesh.bounds.max[0] + pad,
    worldMesh.bounds.max[1] + pad,
    worldMesh.bounds.max[2] + 5.0,
  ];
  const bx = getBounds(decodedBsp, 'world bounds x');
  const by = getBounds(decodedBsp, 'world bounds y');
  const bz = getBounds(decodedBsp, 'world bounds z');

  // Extract Host Map collision polygons whose AABB overlaps `[wMinX..wMaxX, wMinY..wMaxY, wMinZ..wMaxZ]`
  // and include them in the collision mesh passed to `compileMeshCollisionBspData` so Host Map terrain,
  // floors, and walls inside the injected mesh's AABB retain 100% solid collision!
  const objText = exportWorldMeshToObj(worldMesh);
  const parsedObj = parseObjMesh(objText, {
    collisionMode: 'box', // skip redundant preview compilation inside parseObjMesh
    targetCollisionFaces: adaptiveTargetFaces,
  });

  if (oldCSurfCount > 0 && oldCEdgeCount > 0 && oldCVertCount > 0 && oldPlnCount > 0) {
    let appendedHostCollTris = 0;
    const MAX_HOST_OVERLAP_TRIS = 6000;
    for (let s = 0; s < oldCSurfCount && appendedHostCollTris < MAX_HOST_OVERLAP_TRIS; s++) {
      const sOff = s * 12;
      if (sOff + 12 > oldCSurfBuf.length) break;
      const rawPlane = oldCSurfBuf.readInt32LE(sOff + 0);
      const firstEdge = oldCSurfBuf.readInt32LE(sOff + 4);
      const sFlags = oldCSurfBuf.readUInt8(sOff + 8);
      if ((sFlags & 0x02) !== 0) continue; // skip invisible portal/weather-poly surfaces
      if (firstEdge < 0 || firstEdge >= oldCEdgeCount) continue;

      const pIdx = rawPlane & 0x7fffffff;
      if (pIdx >= oldPlnCount || (pIdx + 1) * 16 > oldPlnBuf.length) continue;
      const pSign = rawPlane < 0 ? -1 : 1;
      const pnx = oldPlnBuf.readFloatLE(pIdx * 16 + 0) * pSign;
      const pny = oldPlnBuf.readFloatLE(pIdx * 16 + 4) * pSign;
      const pnz = oldPlnBuf.readFloatLE(pIdx * 16 + 8) * pSign;

      const polyPts: [number, number, number][] = [];
      let sMinX = Infinity, sMaxX = -Infinity;
      let sMinY = Infinity, sMaxY = -Infinity;
      let sMinZ = Infinity, sMaxZ = -Infinity;
      let currEdge = firstEdge;
      for (let step = 0; step < 16; step++) {
        const eOff = currEdge * 24;
        if (eOff < 0 || eOff + 24 > oldCEdgeBuf.length) break;
        const vStart = oldCEdgeBuf.readInt32LE(eOff + 0);
        const vEnd = oldCEdgeBuf.readInt32LE(eOff + 4);
        const fwdEdge = oldCEdgeBuf.readInt32LE(eOff + 8);
        const revEdge = oldCEdgeBuf.readInt32LE(eOff + 12);
        const leftS = oldCEdgeBuf.readInt32LE(eOff + 16);
        const rightS = oldCEdgeBuf.readInt32LE(eOff + 20);

        let vIdx = -1;
        let nextEdge = -1;
        if (leftS === s) {
          vIdx = vStart;
          nextEdge = fwdEdge;
        } else if (rightS === s) {
          vIdx = vEnd;
          nextEdge = revEdge;
        } else {
          break;
        }
        if (vIdx < 0 || vIdx >= oldCVertCount || (vIdx + 1) * 16 > oldCVertBuf.length) break;
        const vx = oldCVertBuf.readFloatLE(vIdx * 16 + 0);
        const vy = oldCVertBuf.readFloatLE(vIdx * 16 + 4);
        const vz = oldCVertBuf.readFloatLE(vIdx * 16 + 8);
        polyPts.push([vx, vy, vz]);
        if (vx < sMinX) sMinX = vx;
        if (vx > sMaxX) sMaxX = vx;
        if (vy < sMinY) sMinY = vy;
        if (vy > sMaxY) sMaxY = vy;
        if (vz < sMinZ) sMinZ = vz;
        if (vz > sMaxZ) sMaxZ = vz;

        if (nextEdge === firstEdge || nextEdge < 0 || nextEdge >= oldCEdgeCount) break;
        currEdge = nextEdge;
      }

      if (polyPts.length < 3) continue;
      // Check if surface AABB overlaps `[wMinX - 0.5 .. wMaxX + 0.5]`
      if (
        sMaxX < wMinX - 0.5 ||
        sMinX > wMaxX + 0.5 ||
        sMaxY < wMinY - 0.5 ||
        sMinY > wMaxY + 0.5 ||
        sMaxZ < wMinZ - 0.5 ||
        sMinZ > wMaxZ + 0.5
      ) {
        continue;
      }

      const basePosIdx = parsedObj.rawPositions.length;
      for (const pt of polyPts) {
        parsedObj.rawPositions.push(pt);
      }
      for (let k = 1; k + 1 < polyPts.length; k++) {
        const p0 = polyPts[0]!;
        const p1 = polyPts[k]!;
        const p2 = polyPts[k + 1]!;
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
        const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const dot = cx * pnx + cy * pny + cz * pnz;
        const i0 = basePosIdx;
        const i1 = dot >= 0 ? basePosIdx + k : basePosIdx + k + 1;
        const i2 = dot >= 0 ? basePosIdx + k + 1 : basePosIdx + k;
        parsedObj.rawFaces.push({
          v0: i0,
          v1: i1,
          v2: i2,
          materialSlotIndex: 0,
          groupId: 0,
        });
        appendedHostCollTris++;
      }
    }
  }

  const compiledColl = compileMeshCollisionBspData(parsedObj, Math.max(1, worldMesh.materialRoles.length), {
    mode: options.collisionMode ?? 'auto',
    targetFaces: adaptiveTargetFaces,
  });
  if (!compiledColl) {
    throw new Error('Failed to compile 3D collision BSP for procedural world mesh.');
  }

  // Build strict-tree AABB boundary planes wrapping `worldMesh.bounds`:
  // IMPORTANT: OpenCE's `bsp3d_check` (`tag_schema_collision.c` L1043-1075) enforces that NO internal
  // `bsp3d_node` (`child >= 0`) is ever reached twice (`collision_bsp_visited`), whereas collision leaves
  // (`child < 0`) CAN be referenced multiple times.
  // Therefore, each active boundary plane `b` points its `frontChild` to its own dedicated shifted copy
  // of `oldN3d` (`oldNodeShift + b * oldN3dCount`) so the entire `bsp3d_nodes` graph is a 100% strict tree!
  const candidateBoxPlanes: { plane: [number, number, number, number]; needed: boolean }[] =
    oldN3dCount > 0
      ? [
          { plane: [1, 0, 0, wMaxX], needed: bx[1] > wMaxX - 2.0 },
          { plane: [-1, 0, 0, -wMinX], needed: bx[0] < wMinX + 2.0 },
          { plane: [0, 1, 0, wMaxY], needed: by[1] > wMaxY - 2.0 },
          { plane: [0, -1, 0, -wMinY], needed: by[0] < wMinY + 2.0 },
          { plane: [0, 0, 1, wMaxZ], needed: bz[1] > wMaxZ - 2.0 },
          { plane: [0, 0, -1, -wMinZ], needed: bz[0] < wMinZ + 2.0 },
        ]
      : [];
  const maxAllowedOldCopies =
    oldN3dCount > 0
      ? Math.max(1, Math.min(6, Math.floor((125000 - compiledColl.bsp3dNodes.length - 6) / oldN3dCount)))
      : 0;
  const neededPlanes = candidateBoxPlanes.filter((c) => c.needed).map((c) => c.plane);
  const boxPlanes: [number, number, number, number][] =
    oldN3dCount > 0
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

  // Allocate large contiguous CollisionBSP, leaves, and surfaces arrays in descending size order so they pack optimally into reclaimed spans
  const bulkRequests = [
    { key: 'cEdge', bytes: Math.max(1, totalCEdge) * 24, rel: 0 },
    { key: 'n3d', bytes: totalN3d * 12, rel: 0 },
    { key: 'ref2d', bytes: Math.max(1, totalRef2d) * 8, rel: 0 },
    { key: 'sbspLeaves', bytes: totalLeaves * 16, rel: 0 },
    { key: 'cSurf', bytes: Math.max(1, totalCSurf) * 12, rel: 0 },
    { key: 'cVert', bytes: Math.max(1, totalCVert) * 16, rel: 0 },
    { key: 'pln', bytes: totalPlanes * 16, rel: 0 },
    { key: 'combinedSurf', bytes: runningSurfCount * 6, rel: 0 },
    { key: 'leaf', bytes: totalLeaves * 8, rel: 0 },
    { key: 'node2d', bytes: Math.max(1, totalNode2d) * 20, rel: 0 },
  ];
  bulkRequests.sort((a, b) => b.bytes - a.bytes);
  for (const req of bulkRequests) {
    req.rel = alloc(req.bytes);
  }
  const getBulkRel = (key: string): number => bulkRequests.find((r) => r.key === key)!.rel;
  const newCEdgeRel = getBulkRel('cEdge');
  const newN3dRel = getBulkRel('n3d');
  const newRef2dRel = getBulkRel('ref2d');
  const newSbspLeavesRel = getBulkRel('sbspLeaves');
  const newCSurfRel = getBulkRel('cSurf');
  const newCVertRel = getBulkRel('cVert');
  const newPlnRel = getBulkRel('pln');
  const combinedSurfRel = getBulkRel('combinedSurf');
  const newLeafRel = getBulkRel('leaf');
  const newNode2dRel = getBulkRel('node2d');

  // 2. Write combined surfaces array (existing + new)
  if (oldSurfacesBuf.length > 0) {
    oldSurfacesBuf.copy(bspBuf, combinedSurfRel);
  }
  let surfWriteOff = combinedSurfRel + oldSurfCount * 6;
  for (const sm of newSubmeshes) {
    sm.surfBuf.copy(bspBuf, surfWriteOff);
    surfWriteOff += sm.surfBuf.length;
  }
  bspBuf.writeUInt32LE(runningSurfCount, rootOff + 0xf8);
  bspBuf.writeUInt32LE(baseAddress + combinedSurfRel, rootOff + 0xfc);

  // Write new materials & append a new ScenarioStructureBSPLightmap (`bitmap = -1` full-brightness diffuse)
  const newMatsRel = alloc(newSubmeshes.length * matStructSize);
  for (let i = 0; i < newSubmeshes.length; i++) {
    const sm = newSubmeshes[i];
    const mOff = newMatsRel + i * matStructSize;
    templateMatBuf.copy(bspBuf, mOff, 0, matStructSize);
    // Shader dependency at +0x00..+0x0f
    bspBuf.writeUInt32LE(fourCCFromString(sm.shaderClassFourCC), mOff + 0x00);
    bspBuf.writeUInt32LE(0, mOff + 0x04);
    bspBuf.writeUInt32LE(0, mOff + 0x08);
    bspBuf.writeUInt32LE(sm.shaderTagId >>> 0, mOff + 0x0c);
    bspBuf.writeInt16LE(0, mOff + 0x10); // shader permutation
    bspBuf.writeUInt16LE(0, mOff + 0x12); // flags
    bspBuf.writeInt32LE(sm.surfStart, mOff + 0x14);
    bspBuf.writeInt32LE(sm.surfCount, mOff + 0x18);
    bspBuf.writeFloatLE(sm.centroid[0], mOff + 0x1c);
    bspBuf.writeFloatLE(sm.centroid[1], mOff + 0x20);
    bspBuf.writeFloatLE(sm.centroid[2], mOff + 0x24);
    bspBuf.writeInt16LE(-1, mOff + 0xac); // breakable surface = -1

    const vRel = alloc(sm.vertBuf.length);
    sm.vertBuf.copy(bspBuf, vRel);
    bspBuf.writeUInt16LE(0, mOff + 0xb0); // vertex buffers type = 0
    bspBuf.writeUInt32LE(sm.vertCount, mOff + 0xb4);
    bspBuf.writeUInt32LE(0, mOff + 0xb8);
    bspBuf.writeUInt32LE(0, mOff + 0xc8); // 0 lightmap vertices
    bspBuf.writeUInt32LE(sm.vertBuf.length, mOff + 0xd8); // uncompressed vertices size
    bspBuf.writeUInt32LE(0, mOff + 0xdc);
    bspBuf.writeUInt32LE(0, mOff + 0xe0);
    bspBuf.writeUInt32LE(baseAddress + vRel, mOff + 0xe4); // uncompressed vertices pointer
    bspBuf.fill(0, mOff + 0xec, mOff + 0x100); // zero compressed vertices
  }

  const newLmCount = oldLmCount + 1;
  const combinedLmRel = alloc(newLmCount * lmStructSize);
  if (oldLmBuf.length > 0) {
    oldLmBuf.copy(bspBuf, combinedLmRel);
  }
  const appendedLmOff = combinedLmRel + oldLmCount * lmStructSize;
  bspBuf.writeInt16LE(-1, appendedLmOff + 0x00); // bitmap = -1 (full-brightness diffuse shader mode)
  bspBuf.writeUInt16LE(0, appendedLmOff + 0x02);
  bspBuf.fill(0, appendedLmOff + 0x04, appendedLmOff + 0x14);
  bspBuf.writeUInt32LE(newSubmeshes.length, appendedLmOff + 0x14);
  bspBuf.writeUInt32LE(baseAddress + newMatsRel, appendedLmOff + 0x18);
  bspBuf.writeUInt32LE(0, appendedLmOff + 0x1c);

  bspBuf.writeUInt32LE(newLmCount, rootOff + 0x104);
  bspBuf.writeUInt32LE(baseAddress + combinedLmRel, rootOff + 0x108);

  // Consolidate all existing subclusters + spatially partitioned new subclusters (<= 128 surfaces each)
  // into Cluster 0 so `MAXIMUM_SURFACES_PER_SUBCLUSTER = 4096` is never exceeded and frustum culling is exact!
  if (clustersRel >= 0) {
    const MAX_SURFS_PER_SC = 128;
    const spanX = worldMesh.bounds.max[0] - worldMesh.bounds.min[0];
    const spanY = worldMesh.bounds.max[1] - worldMesh.bounds.min[1];
    const gridCells = Math.max(1, Math.min(16, Math.ceil(Math.sqrt(triMetaForSubclusters.length / MAX_SURFS_PER_SC))));
    triMetaForSubclusters.sort((a, b) => {
      const gxA = spanX > 1e-3 ? Math.floor(((a.cx - worldMesh.bounds.min[0]) / spanX) * gridCells) : 0;
      const gxB = spanX > 1e-3 ? Math.floor(((b.cx - worldMesh.bounds.min[0]) / spanX) * gridCells) : 0;
      if (gxA !== gxB) return gxA - gxB;
      const gyA = spanY > 1e-3 ? Math.floor(((a.cy - worldMesh.bounds.min[1]) / spanY) * gridCells) : 0;
      const gyB = spanY > 1e-3 ? Math.floor(((b.cy - worldMesh.bounds.min[1]) / spanY) * gridCells) : 0;
      if (gyA !== gyB) return gyA - gyB;
      return a.cz - b.cz;
    });

    const newScCount = Math.max(1, Math.ceil(triMetaForSubclusters.length / MAX_SURFS_PER_SC));
    const totalScCount = oldScCount + newScCount;
    const newScRel = alloc(totalScCount * 36);
    if (oldScBuf.length > 0) {
      oldScBuf.copy(bspBuf, newScRel, 0, oldScCount * 36);
    }
    const surfIdxRel = alloc(Math.max(1, triMetaForSubclusters.length) * 4);
    for (let sc = 0; sc < newScCount; sc++) {
      const startIdx = sc * MAX_SURFS_PER_SC;
      const endIdx = Math.min(triMetaForSubclusters.length, startIdx + MAX_SURFS_PER_SC);
      const sCount = Math.max(0, endIdx - startIdx);
      let bMinX = worldMesh.bounds.min[0], bMaxX = worldMesh.bounds.max[0];
      let bMinY = worldMesh.bounds.min[1], bMaxY = worldMesh.bounds.max[1];
      let bMinZ = worldMesh.bounds.min[2], bMaxZ = worldMesh.bounds.max[2];
      if (sCount > 0) {
        bMinX = Infinity; bMaxX = -Infinity;
        bMinY = Infinity; bMaxY = -Infinity;
        bMinZ = Infinity; bMaxZ = -Infinity;
        for (let k = startIdx; k < endIdx; k++) {
          const tm = triMetaForSubclusters[k]!;
          bspBuf.writeInt32LE(tm.surfIdx, surfIdxRel + k * 4);
          if (tm.minX < bMinX) bMinX = tm.minX;
          if (tm.maxX > bMaxX) bMaxX = tm.maxX;
          if (tm.minY < bMinY) bMinY = tm.minY;
          if (tm.maxY > bMaxY) bMaxY = tm.maxY;
          if (tm.minZ < bMinZ) bMinZ = tm.minZ;
          if (tm.maxZ > bMaxZ) bMaxZ = tm.maxZ;
        }
      }
      const scOff = newScRel + (oldScCount + sc) * 36;
      bspBuf.writeFloatLE(bMinX - 0.1, scOff + 0x00);
      bspBuf.writeFloatLE(bMaxX + 0.1, scOff + 0x04);
      bspBuf.writeFloatLE(bMinY - 0.1, scOff + 0x08);
      bspBuf.writeFloatLE(bMaxY + 0.1, scOff + 0x0c);
      bspBuf.writeFloatLE(bMinZ - 0.1, scOff + 0x10);
      bspBuf.writeFloatLE(bMaxZ + 0.1, scOff + 0x14);
      bspBuf.writeUInt32LE(sCount, scOff + 0x18);
      bspBuf.writeUInt32LE(baseAddress + surfIdxRel + startIdx * 4, scOff + 0x1c);
      bspBuf.writeUInt32LE(0, scOff + 0x20);
    }

    bspBuf.writeInt16LE(-1, clustersRel + 0x0c); // first_runtime_decal_index = -1
    bspBuf.writeInt16LE(0, clustersRel + 0x0e);  // runtime_decal_count = 0
    bspBuf.writeUInt32LE(totalScCount, clustersRel + 0x34);
    bspBuf.writeUInt32LE(baseAddress + newScRel, clustersRel + 0x38);
    bspBuf.writeUInt32LE(0, clustersRel + 0x3c);
    bspBuf.fill(0, clustersRel + 0x44, clustersRel + 0x68); // zero surface_indices, mirrors, portals on Cluster 0
    for (let c = 1; c < clustersRefl.count; c++) {
      const cOff = clustersRel + c * 104;
      bspBuf.writeInt16LE(-1, cOff + 0x0c);
      bspBuf.writeInt16LE(0, cOff + 0x0e);
      bspBuf.writeUInt32LE(0, cOff + 0x34);
      bspBuf.writeUInt32LE(0, cOff + 0x38);
      bspBuf.writeUInt32LE(0, cOff + 0x3c);
      bspBuf.fill(0, cOff + 0x44, cOff + 0x68);
    }

    // Zero obsolete visibility/portal/decal reflexives on ScenarioStructureBSP root
    bspBuf.fill(0, rootOff + 0xbc, rootOff + 0xc8); // zero 3D render nodes
    bspBuf.fill(0, rootOff + 0xec, rootOff + 0xf8); // zero leaf surfaces
    bspBuf.fill(0, rootOff + 0x150, rootOff + 0x160); // zero cluster portals
    bspBuf.fill(0, rootOff + 0x1e4, rootOff + 0x1f0); // zero pathfinding surfaces
    bspBuf.fill(0, rootOff + 0x24c, rootOff + 0x264); // zero detail objects & runtime decals

    // Fill PVS with 0xFF so Cluster 0 is visible from everywhere
    const pvsSize = bspBuf.readUInt32LE(rootOff + 0x140);
    const pvsRel = toRel(bspBuf.readUInt32LE(rootOff + 0x14c));
    if (pvsSize > 0 && pvsRel >= 0 && pvsRel + pvsSize <= oldBspSize) {
      bspBuf.fill(0xff, pvsRel, pvsRel + pvsSize);
    } else {
      const totalClusters = clustersRefl.count;
      const pvsBytesPerCluster = totalClusters > 0 ? Math.ceil(totalClusters / 32) * 4 : 4;
      const newPvsSize = Math.max(4, totalClusters * pvsBytesPerCluster);
      const newPvsRel = alloc(newPvsSize);
      bspBuf.fill(0xff, newPvsRel, newPvsRel + newPvsSize);
      bspBuf.writeUInt32LE(newPvsSize, rootOff + 0x140);
      bspBuf.writeUInt32LE(baseAddress + newPvsRel, rootOff + 0x14c);
    }
  }

  // 3A. Write combined strict-tree bsp3d_nodes
  for (let b = 0; b < boxNodeCount; b++) {
    const nOff = newN3dRel + b * 12;
    const planeIdx = boxPlaneShift + b;
    const backChild = b === boxNodeCount - 1 ? procNodeShift : b + 1;
    const frontChild = oldNodeShift + b * oldN3dCount; // Dedicated shifted copy of old BSP root!
    bspBuf.writeInt32LE(planeIdx, nOff + 0);
    bspBuf.writeInt32LE(backChild, nOff + 4);
    bspBuf.writeInt32LE(frontChild, nOff + 8);
  }
  for (let copyIdx = 0; copyIdx < oldCopyCount; copyIdx++) {
    const copyShift = oldNodeShift + copyIdx * oldN3dCount;
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
    const node = compiledColl.bsp3dNodes[n];
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

  // 3B. Write combined planes
  if (oldPlnBuf.length > 0) {
    oldPlnBuf.copy(bspBuf, newPlnRel);
  }
  for (let b = 0; b < boxPlanes.length; b++) {
    const pOff = newPlnRel + (boxPlaneShift + b) * 16;
    bspBuf.writeFloatLE(boxPlanes[b][0], pOff + 0);
    bspBuf.writeFloatLE(boxPlanes[b][1], pOff + 4);
    bspBuf.writeFloatLE(boxPlanes[b][2], pOff + 8);
    bspBuf.writeFloatLE(boxPlanes[b][3], pOff + 12);
  }
  for (let p = 0; p < compiledColl.planes.length; p++) {
    const pl = compiledColl.planes[p];
    const pOff = newPlnRel + (procPlaneShift + p) * 16;
    bspBuf.writeFloatLE(pl[0], pOff + 0);
    bspBuf.writeFloatLE(pl[1], pOff + 4);
    bspBuf.writeFloatLE(pl[2], pOff + 8);
    bspBuf.writeFloatLE(pl[3], pOff + 12);
  }

  // 3C. Write combined collision leaves
  if (oldLeafBuf.length > 0) {
    oldLeafBuf.copy(bspBuf, newLeafRel);
  }
  for (let l = 0; l < compiledColl.leaves.length; l++) {
    const lf = compiledColl.leaves[l];
    const lOff = newLeafRel + (procLeafShift + l) * 8;
    bspBuf.writeUInt16LE(lf[0] & 0xffff, lOff + 0);
    bspBuf.writeUInt16LE(lf[1] & 0xffff, lOff + 2);
    bspBuf.writeInt32LE(lf[1] > 0 ? lf[2] + procRef2dShift : 0, lOff + 4);
  }

  // 3D. Write combined bsp2d_references
  if (oldRef2dBuf.length > 0) {
    oldRef2dBuf.copy(bspBuf, newRef2dRel);
  }
  for (let r = 0; r < compiledColl.bsp2dReferences.length; r++) {
    const ref = compiledColl.bsp2dReferences[r];
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

  // 3E. Write combined bsp2d_nodes
  if (oldNode2dBuf.length > 0) {
    oldNode2dBuf.copy(bspBuf, newNode2dRel);
  }
  for (let n = 0; n < compiledColl.bsp2dNodes.length; n++) {
    const n2 = compiledColl.bsp2dNodes[n];
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

  // 3F. Write combined collision surfaces
  if (oldCSurfBuf.length > 0) {
    oldCSurfBuf.copy(bspBuf, newCSurfRel);
  }
  for (let s = 0; s < compiledColl.surfaces.length; s++) {
    const sf = compiledColl.surfaces[s];
    const sOff = newCSurfRel + (procSurfShift + s) * 12;
    const rawPlane = sf.planeDesignator | 0;
    const pSign = rawPlane & 0x80000000;
    const pIdx = ((rawPlane & 0x7fffffff) + procPlaneShift) | pSign;
    bspBuf.writeInt32LE(pIdx, sOff + 0);
    bspBuf.writeInt32LE(sf.firstEdgeIndex + procEdgeShift, sOff + 4);
    bspBuf.writeUInt8(sf.flags & 0xff, sOff + 8);
    bspBuf.writeUInt8(0xff, sOff + 9);
    bspBuf.writeInt16LE(0, sOff + 10); // material index 0
  }

  // 3G. Write combined collision edges
  if (oldCEdgeBuf.length > 0) {
    oldCEdgeBuf.copy(bspBuf, newCEdgeRel);
  }
  for (let e = 0; e < compiledColl.edges.length; e++) {
    const ed = compiledColl.edges[e];
    const eOff = newCEdgeRel + (procEdgeShift + e) * 24;
    bspBuf.writeInt32LE(ed.vertexIndices[0] + procVertShift, eOff + 0);
    bspBuf.writeInt32LE(ed.vertexIndices[1] + procVertShift, eOff + 4);
    bspBuf.writeInt32LE(ed.edgeIndices[0] >= 0 ? ed.edgeIndices[0] + procEdgeShift : e + procEdgeShift, eOff + 8);
    bspBuf.writeInt32LE(ed.edgeIndices[1] >= 0 ? ed.edgeIndices[1] + procEdgeShift : e + procEdgeShift, eOff + 12);
    bspBuf.writeInt32LE(ed.surfaceIndices[0] >= 0 ? ed.surfaceIndices[0] + procSurfShift : -1, eOff + 16);
    bspBuf.writeInt32LE(ed.surfaceIndices[1] >= 0 ? ed.surfaceIndices[1] + procSurfShift : -1, eOff + 20);
  }

  // 3H. Write combined collision vertices
  if (oldCVertBuf.length > 0) {
    oldCVertBuf.copy(bspBuf, newCVertRel);
  }
  for (let v = 0; v < compiledColl.vertices.length; v++) {
    const vt = compiledColl.vertices[v];
    const vOff = newCVertRel + (procVertShift + v) * 16;
    bspBuf.writeFloatLE(vt.point[0], vOff + 0);
    bspBuf.writeFloatLE(vt.point[1], vOff + 4);
    bspBuf.writeFloatLE(vt.point[2], vOff + 8);
    bspBuf.writeInt32LE(vt.firstEdgeIndex + procEdgeShift, vOff + 12);
  }

  // Update 96-byte CollisionBSP header in `bspBuf`
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

  // 3I. Write ScenarioStructureBSPLeaf entries (16 bytes each) and map ALL leaves to Cluster 0
  if (oldSbspLeavesBuf.length > 0 && copySbspLeafCount > 0) {
    oldSbspLeavesBuf.copy(bspBuf, newSbspLeavesRel, 0, copySbspLeafCount * 16);
  }
  for (let l = 0; l < totalLeaves; l++) {
    const lOff = newSbspLeavesRel + l * 16;
    if (l >= copySbspLeafCount) {
      bspBuf.fill(0, lOff, lOff + 16);
      bspBuf.writeUInt8(255, lOff + 1);
      bspBuf.writeUInt8(255, lOff + 3);
      bspBuf.writeUInt8(255, lOff + 5);
    }
    bspBuf.writeInt16LE(0, lOff + 8); // cluster = 0
    bspBuf.writeInt16LE(0, lOff + 10); // surface reference count = 0
    bspBuf.writeInt32LE(0, lOff + 12); // surface reference = 0
  }
  bspBuf.writeUInt32LE(totalLeaves, rootOff + 0xe0);
  bspBuf.writeUInt32LE(baseAddress + newSbspLeavesRel, rootOff + 0xe4);

  // 4. Expand world bounds & vehicle floor/ceiling
  const unionBounds: [number, number, number, number, number, number] = [
    Math.min(bx[0], worldMesh.bounds.min[0] - 2),
    Math.min(by[0], worldMesh.bounds.min[1] - 2),
    Math.min(bz[0], worldMesh.bounds.min[2] - 2),
    Math.max(bx[1], worldMesh.bounds.max[0] + 2),
    Math.max(by[1], worldMesh.bounds.max[1] + 2),
    Math.max(bz[1], worldMesh.bounds.max[2] + 2),
  ];
  bspBuf.writeFloatLE(unionBounds[0], rootOff + 0xc8);
  bspBuf.writeFloatLE(unionBounds[3], rootOff + 0xcc);
  bspBuf.writeFloatLE(unionBounds[1], rootOff + 0xd0);
  bspBuf.writeFloatLE(unionBounds[4], rootOff + 0xd4);
  bspBuf.writeFloatLE(unionBounds[2], rootOff + 0xd8);
  bspBuf.writeFloatLE(unionBounds[5], rootOff + 0xdc);

  const curVFloor = bspBuf.readFloatLE(rootOff + 0x10);
  const curVCeil = bspBuf.readFloatLE(rootOff + 0x14);
  bspBuf.writeFloatLE(Math.min(curVFloor, unionBounds[2]), rootOff + 0x10);
  bspBuf.writeFloatLE(Math.max(curVCeil, unionBounds[5] + 10), rootOff + 0x14);

  // Finalize BSP buffer & rebase pointers to fit inside Halo CE's stock 23 MiB (0x41B40000) or expanded 122 MiB (0x47E40000) tag cache ceiling
  const finalBspSize = (cursor + 511) & ~511;
  const finalBspBuf = Buffer.alloc(finalBspSize);
  bspBuf.copy(finalBspBuf, 0, 0, finalBspSize);

  const bspCacheCeiling =
    header.tagDataSize + finalBspSize + 512_000 <= 23 * 1024 * 1024
      ? CE_STOCK_CEILING
      : CE_EXTENDED_CEILING;
  const newBspAddress = (bspCacheCeiling - finalBspSize) & ~511;
  rebaseStructureBspPointers(finalBspBuf, baseAddress, newBspAddress);

  // Splice updated BSP in-place at `oldBspStart` (before modelDataFileOffset & tagDataOffset) and shift subsequent offsets
  const delta = finalBspSize - oldBspSize;
  const newFileSize = sourceBuffer.length + delta;
  const outMap = Buffer.alloc(newFileSize);

  sourceBuffer.copy(outMap, 0, 0, oldBspStart);
  finalBspBuf.copy(outMap, oldBspStart, 0, finalBspSize);
  sourceBuffer.copy(outMap, oldBspStart + finalBspSize, oldBspStart + oldBspSize);

  // Update CacheFileHeader decompressedFileSize (+0x08) and tagDataOffset (+0x10)
  outMap.writeUInt32LE(newFileSize, 0x08);
  const oldTagDataOffset = sourceBuffer.readUInt32LE(0x10);
  const newTagDataOffset = oldTagDataOffset + delta;
  outMap.writeUInt32LE(newTagDataOffset, 0x10);

  // Update PC/CE/MCC tag data header modelDataFileOffset (+0x14)
  if (header.engine !== 5 && newTagDataOffset + 0x28 <= outMap.length) {
    const oldModelDataOffset = sourceBuffer.readUInt32LE(oldTagDataOffset + 0x14);
    if (oldModelDataOffset >= oldBspStart + oldBspSize) {
      outMap.writeUInt32LE(oldModelDataOffset + delta, newTagDataOffset + 0x14);
    }
  }

  // Update ScenarioBSP entries (shift any subsequent BSP starts, and write updated bspStart/bspSize/bspAddress)
  const newBspArrayOffset = bspsArrayOffset + delta;
  for (let i = 0; i < bspsField.value.count; i++) {
    const eOff = newBspArrayOffset + i * scenarioBspSize;
    if (i === bspIdx) {
      outMap.writeUInt32LE(oldBspStart, eOff + 0x00);
      outMap.writeUInt32LE(finalBspSize, eOff + 0x04);
      outMap.writeUInt32LE(newBspAddress, eOff + 0x08);
    } else {
      const otherStart = outMap.readUInt32LE(eOff + 0x00);
      if (otherStart >= oldBspStart + oldBspSize) {
        outMap.writeUInt32LE(otherStart + delta, eOff + 0x00);
      }
    }
  }

  // Shift any embedded BitmapData / SoundPermutation raw file offsets located after the spliced BSP
  if (delta !== 0) {
    const cutoffOffset = oldBspStart + oldBspSize;
    const baseMem = tagIndex.baseMemoryAddress;
    const bDataSize = resolveStruct('BitmapData').totalSize;
    const pitchSize = resolveStruct('SoundPitchRange').totalSize;
    const permSize = resolveStruct('SoundPermutation').totalSize;

    for (const entry of tagIndex.entries) {
      if (entry.isExternal) continue;
      const tagFileOffset = newTagDataOffset + (entry.tagDataPointerOrResourceIndex - baseMem);
      if (tagFileOffset < 0 || tagFileOffset + 64 > outMap.length) continue;

      if (entry.primaryClassName === 'bitmap') {
        try {
          const decoded = decodeStruct(outMap, tagFileOffset, 'Bitmap');
          const bDataRefl = decoded.get('bitmap data');
          if (bDataRefl && bDataRefl.kind === 'reflexive' && bDataRefl.value.count > 0) {
            const arrOffset = newTagDataOffset + (bDataRefl.value.pointerLow - baseMem);
            for (let i = 0; i < bDataRefl.value.count; i++) {
              const itemOffset = arrOffset + i * bDataSize;
              if (itemOffset + 32 <= outMap.length) {
                const flags = outMap.readUInt16LE(itemOffset + 14);
                if ((flags & 0x100) === 0) {
                  const curPixOff = outMap.readUInt32LE(itemOffset + 24);
                  if (curPixOff >= cutoffOffset && curPixOff !== 0xffffffff) {
                    outMap.writeUInt32LE(curPixOff + delta, itemOffset + 24);
                  }
                }
              }
            }
          }
        } catch {}
      } else if (entry.primaryClassName === 'sound') {
        try {
          const decoded = decodeStruct(outMap, tagFileOffset, 'Sound');
          const pitchRefl = decoded.get('pitch ranges');
          if (pitchRefl && pitchRefl.kind === 'reflexive' && pitchRefl.value.count > 0) {
            const pitchArrOffset = newTagDataOffset + (pitchRefl.value.pointerLow - baseMem);
            for (let p = 0; p < pitchRefl.value.count; p++) {
              const pOffset = pitchArrOffset + p * pitchSize;
              const pDecoded = decodeStruct(outMap, pOffset, 'SoundPitchRange');
              const permRefl = pDecoded.get('permutations');
              if (permRefl && permRefl.kind === 'reflexive' && permRefl.value.count > 0) {
                const permArrOffset = newTagDataOffset + (permRefl.value.pointerLow - baseMem);
                for (let m = 0; m < permRefl.value.count; m++) {
                  const mOffset = permArrOffset + m * permSize;
                  if (mOffset + 0x4c <= outMap.length) {
                    const sampleExt = outMap.readUInt32LE(mOffset + 0x44);
                    if ((sampleExt & 1) === 0) {
                      const curSampleOff = outMap.readUInt32LE(mOffset + 0x48);
                      if (curSampleOff >= cutoffOffset && curSampleOff !== 0xffffffff) {
                        outMap.writeUInt32LE(curSampleOff + delta, mOffset + 0x48);
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

  return {
    mapBuffer: outMap,
    addedVertices,
    addedTriangles,
    addedSubmeshes: newSubmeshes.length,
    addedCollisionSurfaces: compiledColl.surfaces.length,
    addedCollisionNodes3d: compiledColl.bsp3dNodes.length + boxNodeCount,
    newBspSize: finalBspSize,
    newBspAddress,
    worldBounds: unionBounds,
  };
}
