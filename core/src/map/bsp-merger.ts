import { decodeStruct, resolveStruct } from './definitions/engine';
import { locateStructureBsp } from './definitions/validate-tag';
import { inspectCustomEditionMap } from './open-map';

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
  if (delta === 0) return 0;

  const bspSize = bspBuffer.length;
  const inBsp = (p: number, len: number) => {
    const at = p - oldBaseAddress;
    return at >= 0 && at + len <= bspSize;
  };

  const sites: { at: number; value: number }[] = [];
  const rootPtr = bspBuffer.readUInt32LE(0);
  sites.push({ at: 0, value: rootPtr });

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
        if (p !== 0 && (value.value.count > 0 || inBsp(p, 1))) {
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
      } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset) {
        const p = value.value.pointerLow >>> 0;
        if (p !== 0 && inBsp(p, 1)) {
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
export function mergeStructureBsps(sourceBuffer: Buffer, bspIndices: number[]): MergedBspResult {
  if (bspIndices.length === 0) {
    throw new Error('mergeStructureBsps requires at least one BSP index.');
  }

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

    const CE_BSP_CACHE_CEILING = 0x41b40000;
    let finalBspAddress = baseAddress;
    if (baseAddress + baseCtx.bspSize > CE_BSP_CACHE_CEILING) {
      finalBspAddress = (CE_BSP_CACHE_CEILING - baseCtx.bspSize) & ~511;
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

  // Allocate working buffer for merged BSP
  let totalEstimatedBytes = 0;
  for (const c of contexts) totalEstimatedBytes += c.bspSize;
  totalEstimatedBytes += 16 * 1024 * 1024; // safety margin for alignment and new reflexives

  const merged = Buffer.alloc(totalEstimatedBytes);

  // Copy entire Base BSP 0 as foundation
  sourceBuffer.copy(merged, 0, baseCtx.bspStart, baseCtx.bspStart + baseCtx.bspSize);

  let appendOffset = (baseCtx.bspSize + 511) & ~511;

  const lmStructSize = resolveStruct('ScenarioStructureBSPLightmap').totalSize; // 32
  const matStructSize = resolveStruct('ScenarioStructureBSPMaterial').totalSize; // 256

  // Cumulative counts
  let cumulativeSurfaceCount = getReflexive(baseCtx.decoded, 'surfaces').count;
  const cumulativeClusterCount = getReflexive(baseCtx.decoded, 'clusters').count;

  // World bounds union
  const b0x = getBounds(baseCtx.decoded, 'world bounds x');
  const b0y = getBounds(baseCtx.decoded, 'world bounds y');
  const b0z = getBounds(baseCtx.decoded, 'world bounds z');
  const unionBounds: [number, number, number, number, number, number] = [
    b0x[0],
    b0y[0],
    b0z[0],
    b0x[1],
    b0y[1],
    b0z[1],
  ];

  let vehicleFloor = (baseCtx.decoded.get('vehicle floor') as { kind: 'basic'; value: number })?.value ?? 0;
  let vehicleCeiling = (baseCtx.decoded.get('vehicle ceiling') as { kind: 'basic'; value: number })?.value ?? 0;

  interface LightmapPlateInfo {
    bitmap: number;
    materialsCount: number;
    materialsPointer: number;
  }
  const allLightmaps: LightmapPlateInfo[] = [];

  // Read base BSP 0 lightmaps
  const lmRefl0 = getReflexive(baseCtx.decoded, 'lightmaps');
  const lmOff0 = baseCtx.loc.fileOffsetAnchor + (lmRefl0.pointerLow - baseCtx.loc.baseMemoryAddress);
  for (let i = 0; i < lmRefl0.count; i++) {
    const lm = decodeStruct(sourceBuffer, lmOff0 + i * lmStructSize, 'ScenarioStructureBSPLightmap');
    const bitmap = (lm.get('bitmap') as { kind: 'basic'; value: number })?.value ?? -1;
    const mats = getReflexive(lm, 'materials');
    allLightmaps.push({
      bitmap,
      materialsCount: mats.count,
      materialsPointer: mats.pointerLow,
    });
  }

  // Surfaces buffer tracking
  const allSurfacesBuffers: Buffer[] = [];
  const baseSurfacesRefl = getReflexive(baseCtx.decoded, 'surfaces');
  const baseSurfacesOff =
    baseCtx.loc.fileOffsetAnchor + (baseSurfacesRefl.pointerLow - baseCtx.loc.baseMemoryAddress);
  allSurfacesBuffers.push(sourceBuffer.subarray(baseSurfacesOff, baseSurfacesOff + baseSurfacesRefl.count * 6));

  let totalTriangles = baseSurfacesRefl.count;
  let totalVertices = 0;
  let totalSubmeshes = 0;

  // For each additional donor BSP (1..N):
  for (let k = 1; k < contexts.length; k++) {
    const ctx = contexts[k];

    // 1. Update Union Bounds
    const cx = getBounds(ctx.decoded, 'world bounds x');
    const cy = getBounds(ctx.decoded, 'world bounds y');
    const cz = getBounds(ctx.decoded, 'world bounds z');

    unionBounds[0] = Math.min(unionBounds[0], cx[0]);
    unionBounds[1] = Math.min(unionBounds[1], cy[0]);
    unionBounds[2] = Math.min(unionBounds[2], cz[0]);
    unionBounds[3] = Math.max(unionBounds[3], cx[1]);
    unionBounds[4] = Math.max(unionBounds[4], cy[1]);
    unionBounds[5] = Math.max(unionBounds[5], cz[1]);

    const vFloor = (ctx.decoded.get('vehicle floor') as { kind: 'basic'; value: number })?.value ?? 0;
    const vCeil = (ctx.decoded.get('vehicle ceiling') as { kind: 'basic'; value: number })?.value ?? 0;
    vehicleFloor = Math.min(vehicleFloor, vFloor);
    vehicleCeiling = Math.max(vehicleCeiling, vCeil);

    // 2. Locate & Copy Vertex Buffers for donor BSP
    const lmRefl = getReflexive(ctx.decoded, 'lightmaps');
    const lmOff = ctx.loc.fileOffsetAnchor + (lmRefl.pointerLow - ctx.loc.baseMemoryAddress);

    let minVertPtr = Infinity;
    let maxVertPtr = -Infinity;

    for (let i = 0; i < lmRefl.count; i++) {
      const lm = decodeStruct(sourceBuffer, lmOff + i * lmStructSize, 'ScenarioStructureBSPLightmap');
      const mats = getReflexive(lm, 'materials');
      if (mats.count === 0) continue;
      const matsOff = ctx.loc.fileOffsetAnchor + (mats.pointerLow - ctx.loc.baseMemoryAddress);
      for (let j = 0; j < mats.count; j++) {
        const mat = decodeStruct(sourceBuffer, matsOff + j * matStructSize, 'ScenarioStructureBSPMaterial');
        const uncomp = mat.get('uncompressed vertices');
        if (uncomp && uncomp.kind === 'tagDataOffset' && uncomp.value.pointerLow) {
          const p = uncomp.value.pointerLow as number;
          const sz = uncomp.value.size as number;
          if (p < minVertPtr) minVertPtr = p;
          if (p + sz > maxVertPtr) maxVertPtr = p + sz;
        }
      }
    }

    let vertRebaseDelta = 0;
    if (minVertPtr !== Infinity && maxVertPtr > minVertPtr) {
      const vertSpanSize = maxVertPtr - minVertPtr;
      const vertSourceOffset = ctx.loc.fileOffsetAnchor + (minVertPtr - ctx.loc.baseMemoryAddress);
      const vertDestOffset = appendOffset;
      sourceBuffer.copy(merged, vertDestOffset, vertSourceOffset, vertSourceOffset + vertSpanSize);
      appendOffset += (vertSpanSize + 15) & ~15;
      vertRebaseDelta = baseAddress + vertDestOffset - minVertPtr;
    }

    // 3. Write Donor Materials with rebased vertex pointers and shifted surfaces
    for (let i = 0; i < lmRefl.count; i++) {
      const lm = decodeStruct(sourceBuffer, lmOff + i * lmStructSize, 'ScenarioStructureBSPLightmap');
      const bitmap = (lm.get('bitmap') as { kind: 'basic'; value: number })?.value ?? -1;
      const mats = getReflexive(lm, 'materials');
      if (mats.count === 0) {
        allLightmaps.push({ bitmap, materialsCount: 0, materialsPointer: 0 });
        continue;
      }

      const matsSourceOff = ctx.loc.fileOffsetAnchor + (mats.pointerLow - ctx.loc.baseMemoryAddress);
      const matsDestOff = appendOffset;
      const matsByteSize = mats.count * matStructSize;
      sourceBuffer.copy(merged, matsDestOff, matsSourceOff, matsSourceOff + matsByteSize);

      for (let j = 0; j < mats.count; j++) {
        const mOff = matsDestOff + j * matStructSize;
        // Shift surface index (offset 0x14)
        const oldSurf = merged.readInt32LE(mOff + 0x14);
        merged.writeInt32LE(oldSurf + cumulativeSurfaceCount, mOff + 0x14);

        // Rebase vertex buffer pointer (offset 0xe4)
        const oldVertPtr = merged.readUInt32LE(mOff + 0xe4);
        if (oldVertPtr !== 0 && vertRebaseDelta !== 0) {
          merged.writeUInt32LE(oldVertPtr + vertRebaseDelta, mOff + 0xe4);
        }

        const vCount = merged.readUInt32LE(mOff + 0xb4);
        totalVertices += vCount;
        totalSubmeshes++;
      }

      allLightmaps.push({
        bitmap,
        materialsCount: mats.count,
        materialsPointer: baseAddress + matsDestOff,
      });

      appendOffset += (matsByteSize + 15) & ~15;
    }

    // 4. Collect donor surfaces (triangles)
    const surfacesRefl = getReflexive(ctx.decoded, 'surfaces');
    const surfacesOff = ctx.loc.fileOffsetAnchor + (surfacesRefl.pointerLow - ctx.loc.baseMemoryAddress);
    allSurfacesBuffers.push(sourceBuffer.subarray(surfacesOff, surfacesOff + surfacesRefl.count * 6));
    cumulativeSurfaceCount += surfacesRefl.count;
    totalTriangles += surfacesRefl.count;
  }

  // Count base BSP vertices & submeshes
  for (let i = 0; i < lmRefl0.count; i++) {
    const lm = decodeStruct(sourceBuffer, lmOff0 + i * lmStructSize, 'ScenarioStructureBSPLightmap');
    const mats = getReflexive(lm, 'materials');
    if (mats.count === 0) continue;
    const matsOff = baseCtx.loc.fileOffsetAnchor + (mats.pointerLow - baseCtx.loc.baseMemoryAddress);
    for (let j = 0; j < mats.count; j++) {
      const vCount = sourceBuffer.readUInt32LE(matsOff + j * matStructSize + 0xb4);
      totalVertices += vCount;
      totalSubmeshes++;
    }
  }

  // Write Combined Lightmaps Array
  const combinedLmDestOff = appendOffset;
  const combinedLmByteSize = allLightmaps.length * lmStructSize;
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
  appendOffset += (combinedLmByteSize + 15) & ~15;

  // Write Combined Surfaces Array
  const combinedSurfacesDestOff = appendOffset;
  let currSurfOff = combinedSurfacesDestOff;
  for (const sBuf of allSurfacesBuffers) {
    sBuf.copy(merged, currSurfOff);
    currSurfOff += sBuf.length;
  }
  appendOffset += (currSurfOff - combinedSurfacesDestOff + 15) & ~15;

  // Write All-Visible Clusters & PVS
  const totalClusters = cumulativeClusterCount;
  // Halo CE PVS bitvectors are 32-bit (4-byte) aligned rows: ((clusters + 31) >> 5) * 4.
  // Halo's structure_bsp_load verifies: cluster_data.size >= clusters.count * (((clusters.count + 31) >> 3) & ~3).
  const pvsBytesPerCluster = totalClusters > 0 ? Math.ceil(totalClusters / 32) * 4 : 0;
  const pvsTotalSize = totalClusters * pvsBytesPerCluster;
  const pvsDestOff = appendOffset;
  merged.fill(0xff, pvsDestOff, pvsDestOff + pvsTotalSize);
  appendOffset += (pvsTotalSize + 15) & ~15;

  // Update ScenarioStructureBSP Root Struct (starts at offset 0x18 in BSP chunk)
  const rootOffset = 0x18;

  // World bounds union
  merged.writeFloatLE(unionBounds[0], rootOffset + 0xc8);
  merged.writeFloatLE(unionBounds[3], rootOffset + 0xcc);
  merged.writeFloatLE(unionBounds[1], rootOffset + 0xd0);
  merged.writeFloatLE(unionBounds[4], rootOffset + 0xd4);
  merged.writeFloatLE(unionBounds[2], rootOffset + 0xd8);
  merged.writeFloatLE(unionBounds[5], rootOffset + 0xdc);

  // Vehicle floor & ceiling
  merged.writeFloatLE(vehicleFloor, rootOffset + 0x4);
  merged.writeFloatLE(vehicleCeiling, rootOffset + 0x8);

  // Surfaces reflexive at 0xf8
  merged.writeUInt32LE(totalTriangles, rootOffset + 0xf8);
  merged.writeUInt32LE(baseAddress + combinedSurfacesDestOff, rootOffset + 0xfc);

  // Lightmaps reflexive at 0x104
  merged.writeUInt32LE(allLightmaps.length, rootOffset + 0x104);
  merged.writeUInt32LE(baseAddress + combinedLmDestOff, rootOffset + 0x108);

  // Cluster data tagDataOffset at 0x140 (size at 0x140, pointerLow at 0x14c)
  merged.writeUInt32LE(pvsTotalSize, rootOffset + 0x140);
  merged.writeUInt32LE(baseAddress + pvsDestOff, rootOffset + 0x14c);

  const finalMergedSize = (appendOffset + 511) & ~511;
  const finalMergedBuffer = Buffer.alloc(finalMergedSize);
  merged.copy(finalMergedBuffer, 0, 0, finalMergedSize);

  // Ceiling for Custom Edition Structure BSPs in the 23 MiB tag cache:
  // 0x40440000 + 0x01700000 = 0x41B40000.
  // The structure BSP must satisfy: bspAddress + bspSize <= 0x41B40000.
  const CE_BSP_CACHE_CEILING = 0x41b40000;
  let finalBspAddress = baseAddress;
  if (baseAddress + finalMergedSize > CE_BSP_CACHE_CEILING) {
    finalBspAddress = (CE_BSP_CACHE_CEILING - finalMergedSize) & ~511;
    rebaseStructureBspPointers(finalMergedBuffer, baseAddress, finalBspAddress);
  }

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
  };
}
