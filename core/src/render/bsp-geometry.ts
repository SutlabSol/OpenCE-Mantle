import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { decodeStruct, resolveStruct } from '../map/definitions/engine';
import { locateStructureBsp } from '../map/definitions/validate-tag';

/**
 * A renderable submesh within the Structure BSP, corresponding to a single Material
 * entry in a BSP lightmap plate.
 */
export interface BspSubmesh {
  /** Index of this submesh within the BSP (0-based sequential). */
  submeshIndex: number;
  /** Index into the BSP lightmaps reflexive. */
  lightmapIndex: number;
  /** Sub-bitmap index inside the lightmap bitm tag (-1 if none/unlit). */
  lightmapBitmapIndex: number;
  /** Tag ID of the shader tag (e.g. senv/soso/schi/etc). */
  shaderTagId: number;
  /** Shader permutation index. */
  shaderPermutation: number;
  /** Number of vertices in this submesh. */
  vertexCount: number;
  /**
   * Interleaved vertex buffer: [x, y, z, nx, ny, nz, u, v] per vertex (stride = 8 floats = 32 bytes).
   * In Halo coordinates (Z-up, right-handed: +X forward, +Y left, +Z up).
   */
  vertices: Float32Array;
  /**
   * Lightmap UV buffer: [lu, lv] per vertex (stride = 2 floats = 8 bytes).
   */
  lightmapUvs: Float32Array;
  /**
   * Indexed triangle list: [v0, v1, v2, ...].
   * Indices are local to this submesh (0 to vertexCount - 1).
   */
  indices: Uint16Array;
  /** Local bounding box of this submesh in Halo coordinates: [minX, minY, minZ, maxX, maxY, maxZ]. */
  boundingBox: [number, number, number, number, number, number];
}

/**
 * Parsed Structure BSP 3D render mesh for Halo PC / Custom Edition.
 */
export interface BspRenderMesh {
  /** Scenario BSP index (0 for primary BSP). */
  bspIndex: number;
  /** Tag ID of the scenario_structure_bsp tag. */
  bspTagId: number;
  /** Tag ID of the lightmap bitmap tag (or 0xFFFFFFFF if none). */
  lightmapsBitmapTagId: number;
  /** World bounds from sbsp header: [minX, minY, minZ, maxX, maxY, maxZ]. */
  worldBounds: [number, number, number, number, number, number];
  /** Total number of vertices across all submeshes. */
  totalVertices: number;
  /** Total number of triangles across all submeshes. */
  totalTriangles: number;
  /** Array of renderable submeshes. */
  submeshes: BspSubmesh[];
}

/**
 * Extracts the 3D render geometry for a scenario Structure BSP from a Halo PC / CE map buffer.
 *
 * @param buffer The complete map file buffer.
 * @param header The parsed CacheFileHeader.
 * @param tagIndex The parsed TagIndex.
 * @param bspIndex Index in the scenario's "structure bsps" reflexive (default 0).
 * @returns Fully decoded BspRenderMesh with interleaved vertex buffers, lightmap UVs, and triangle indices.
 */
export function extractBspRenderMesh(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  bspIndex = 0,
): BspRenderMesh {
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) {
    throw new Error(`Scenario tag (ID: 0x${tagIndex.scenarioTagId.toString(16)}) not found in tag index.`);
  }

  const scenarioFileOffset = resolveTagDataPointer(
    scenarioEntry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  const decodedScenario = decodeStruct(buffer, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive' || bspsField.value.count === 0) {
    throw new Error('Scenario has no structure bsps.');
  }

  if (bspIndex < 0 || bspIndex >= bspsField.value.count) {
    throw new Error(`BSP index ${bspIndex} is out of bounds (scenario has ${bspsField.value.count} BSPs).`);
  }

  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspsArrayOffset = header.tagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);
  const bspEntryOffset = bspsArrayOffset + bspIndex * scenarioBspSize;
  const decodedBspEntry = decodeStruct(buffer, bspEntryOffset, 'ScenarioBSP');

  const bspDep = decodedBspEntry.get('structure bsp');
  const bspTagId = bspDep && bspDep.kind === 'dependency' ? bspDep.value.tagId : 0xffffffff;

  const bspLocation = locateStructureBsp(
    buffer,
    tagIndex,
    scenarioFileOffset,
    header.tagDataOffset,
    tagIndex.baseMemoryAddress,
    bspTagId,
  );

  if (!bspLocation) {
    throw new Error(`Failed to locate structure BSP (tagId: 0x${bspTagId.toString(16)}).`);
  }

  const decodedBsp = decodeStruct(buffer, bspLocation.fileOffset, 'ScenarioStructureBSP');

  // Lightmaps bitmap tag ID
  const lightmapsBitmapDep = decodedBsp.get('lightmaps bitmap');
  const lightmapsBitmapTagId =
    lightmapsBitmapDep && lightmapsBitmapDep.kind === 'dependency' ? lightmapsBitmapDep.value.tagId : 0xffffffff;

  // World bounds
  const boundsX = decodedBsp.get('world bounds x') as { kind: 'bounds'; value: [number, number] } | undefined;
  const boundsY = decodedBsp.get('world bounds y') as { kind: 'bounds'; value: [number, number] } | undefined;
  const boundsZ = decodedBsp.get('world bounds z') as { kind: 'bounds'; value: [number, number] } | undefined;

  const worldBounds: [number, number, number, number, number, number] = [
    boundsX?.value[0] ?? 0,
    boundsY?.value[0] ?? 0,
    boundsZ?.value[0] ?? 0,
    boundsX?.value[1] ?? 0,
    boundsY?.value[1] ?? 0,
    boundsZ?.value[1] ?? 0,
  ];

  // Surfaces (triangles)
  const surfacesField = decodedBsp.get('surfaces');
  if (!surfacesField || surfacesField.kind !== 'reflexive') {
    throw new Error('ScenarioStructureBSP has invalid surfaces reflexive.');
  }
  const surfacesOffset = bspLocation.fileOffsetAnchor + (surfacesField.value.pointerLow - bspLocation.baseMemoryAddress);

  // Lightmaps
  const lightmapsField = decodedBsp.get('lightmaps');
  if (!lightmapsField || lightmapsField.kind !== 'reflexive') {
    throw new Error('ScenarioStructureBSP has invalid lightmaps reflexive.');
  }
  const lightmapsOffset = bspLocation.fileOffsetAnchor + (lightmapsField.value.pointerLow - bspLocation.baseMemoryAddress);

  const lmStructSize = resolveStruct('ScenarioStructureBSPLightmap').totalSize;
  const matStructSize = resolveStruct('ScenarioStructureBSPMaterial').totalSize;

  const submeshes: BspSubmesh[] = [];
  let totalVertices = 0;
  let totalTriangles = 0;
  let submeshCounter = 0;

  for (let lmIdx = 0; lmIdx < lightmapsField.value.count; lmIdx++) {
    const lmOffset = lightmapsOffset + lmIdx * lmStructSize;
    const decodedLm = decodeStruct(buffer, lmOffset, 'ScenarioStructureBSPLightmap');
    const bitmapField = decodedLm.get('bitmap') as { kind: 'basic'; value: number } | undefined;
    const lightmapBitmapIndex = bitmapField?.value ?? -1;

    const materialsReflexive = decodedLm.get('materials');
    if (!materialsReflexive || materialsReflexive.kind !== 'reflexive' || materialsReflexive.value.count === 0) {
      continue;
    }

    const materialsOffset = bspLocation.fileOffsetAnchor + (materialsReflexive.value.pointerLow - bspLocation.baseMemoryAddress);

    for (let matIdx = 0; matIdx < materialsReflexive.value.count; matIdx++) {
      const matOffset = materialsOffset + matIdx * matStructSize;
      const decodedMat = decodeStruct(buffer, matOffset, 'ScenarioStructureBSPMaterial');

      const shaderDep = decodedMat.get('shader');
      const shaderTagId = shaderDep && shaderDep.kind === 'dependency' ? shaderDep.value.tagId : 0xffffffff;
      const shaderPermField = decodedMat.get('shader permutation') as { kind: 'basic'; value: number } | undefined;
      const shaderPermutation = shaderPermField?.value ?? 0;

      const surfStartField = decodedMat.get('surfaces') as { kind: 'basic'; value: number } | undefined;
      const surfCountField = decodedMat.get('surface count') as { kind: 'basic'; value: number } | undefined;
      const vertCountField = decodedMat.get('rendered vertices count') as { kind: 'basic'; value: number } | undefined;

      const surfaceIndexStart = surfStartField?.value ?? 0;
      const surfaceCount = surfCountField?.value ?? 0;
      const vertexCount = vertCountField?.value ?? 0;

      if (vertexCount === 0 || surfaceCount === 0) {
        continue;
      }

      const uncompressedData = decodedMat.get('uncompressed vertices');
      if (!uncompressedData || uncompressedData.kind !== 'tagDataOffset') {
        continue;
      }

      const vertPtr = uncompressedData.value.pointerLow;
      const vertOffset = bspLocation.fileOffsetAnchor + (vertPtr - bspLocation.baseMemoryAddress);

      // Read interleaved vertices: [x, y, z, nx, ny, nz, u, v] (8 floats per vertex)
      const vertices = new Float32Array(vertexCount * 8);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      for (let v = 0; v < vertexCount; v++) {
        const vOff = vertOffset + v * 56;
        const x = buffer.readFloatLE(vOff + 0);
        const y = buffer.readFloatLE(vOff + 4);
        const z = buffer.readFloatLE(vOff + 8);
        const nx = buffer.readFloatLE(vOff + 12);
        const ny = buffer.readFloatLE(vOff + 16);
        const nz = buffer.readFloatLE(vOff + 20);
        const u = buffer.readFloatLE(vOff + 48);
        const vCoord = buffer.readFloatLE(vOff + 52);

        const outIdx = v * 8;
        vertices[outIdx + 0] = x;
        vertices[outIdx + 1] = y;
        vertices[outIdx + 2] = z;
        vertices[outIdx + 3] = nx;
        vertices[outIdx + 4] = ny;
        vertices[outIdx + 5] = nz;
        vertices[outIdx + 6] = u;
        vertices[outIdx + 7] = vCoord;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }

      // Read lightmap UVs (secondary stream immediately follows vertexCount * 56)
      const lightmapUvs = new Float32Array(vertexCount * 2);
      const lmVertOffset = vertOffset + vertexCount * 56;
      for (let v = 0; v < vertexCount; v++) {
        const lmvOff = lmVertOffset + v * 20;
        const lu = buffer.readFloatLE(lmvOff + 12);
        const lv = buffer.readFloatLE(lmvOff + 16);
        lightmapUvs[v * 2 + 0] = lu;
        lightmapUvs[v * 2 + 1] = lv;
      }

      // Read triangle indices (3 x uint16 per surface)
      const indices = new Uint16Array(surfaceCount * 3);
      for (let s = 0; s < surfaceCount; s++) {
        const sOff = surfacesOffset + (surfaceIndexStart + s) * 6;
        indices[s * 3 + 0] = buffer.readUInt16LE(sOff + 0);
        indices[s * 3 + 1] = buffer.readUInt16LE(sOff + 2);
        indices[s * 3 + 2] = buffer.readUInt16LE(sOff + 4);
      }

      const boundingBox: [number, number, number, number, number, number] = [
        minX === Infinity ? 0 : minX,
        minY === Infinity ? 0 : minY,
        minZ === Infinity ? 0 : minZ,
        maxX === -Infinity ? 0 : maxX,
        maxY === -Infinity ? 0 : maxY,
        maxZ === -Infinity ? 0 : maxZ,
      ];

      submeshes.push({
        submeshIndex: submeshCounter++,
        lightmapIndex: lmIdx,
        lightmapBitmapIndex,
        shaderTagId,
        shaderPermutation,
        vertexCount,
        vertices,
        lightmapUvs,
        indices,
        boundingBox,
      });

      totalVertices += vertexCount;
      totalTriangles += surfaceCount;
    }
  }

  return {
    bspIndex,
    bspTagId,
    lightmapsBitmapTagId,
    worldBounds,
    totalVertices,
    totalTriangles,
    submeshes,
  };
}