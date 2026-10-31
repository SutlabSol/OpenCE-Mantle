import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { fourCCToString } from '../constants/tag-classes';
import { decodeStruct, resolveStruct } from '../map/definitions/engine';
import { locateStructureBsp } from '../map/definitions/validate-tag';

/**
 * Unpacks an Xbox 11-11-10 bit compressed unit vector (`uint32`) into `[nx, ny, nz]`.
 * Layout: bits 0..10 = signed 11-bit X, bits 11..21 = signed 11-bit Y, bits 22..31 = signed 10-bit Z.
 */
export function unpackCompressedUnitVector32(packed: number): [number, number, number] {
  let ix = packed & 0x7ff;
  if (ix & 0x400) ix -= 0x800;
  let iy = (packed >>> 11) & 0x7ff;
  if (iy & 0x400) iy -= 0x800;
  let iz = (packed >>> 22) & 0x3ff;
  if (iz & 0x200) iz -= 0x400;

  let nx = ix / 1023.0;
  let ny = iy / 1023.0;
  let nz = iz / 511.0;
  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-6) {
    nx /= len;
    ny /= len;
    nz /= len;
  }
  return [nx, ny, nz];
}

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
  /** Optional tag path of the shader tag (e.g. 'levels\\test\\bloodgulch\\shaders\\ground'). */
  shaderPath?: string;
  /** Optional 4-char class FourCC of the shader tag (e.g. 'senv'). */
  shaderClassFourCC?: string;
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
 * Parsed Structure BSP 3D render mesh for Halo PC / Custom Edition / Xbox.
 */
export interface BspRenderMesh {
  /** Scenario BSP index (0 for primary BSP). */
  bspIndex: number;
  /** Total number of BSPs in this scenario. */
  bspCount?: number;
  /** Human-readable tag paths or labels for all BSPs in the scenario. */
  bspNames?: string[];
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
  /** Extracted BSP cluster portals (acoustic/visibility portals between clusters). */
  clusterPortals?: Array<{
    frontCluster: number;
    backCluster: number;
    centroid: [number, number, number];
    boundingRadius: number;
    vertices: Array<[number, number, number]>;
  }>;
  /** Extracted BSP planar fog regions. */
  fogPlanes?: Array<{
    frontRegion: number;
    centroid: [number, number, number];
    vertices: Array<[number, number, number]>;
  }>;
  /** Extracted BSP weather polyhedra (rain/snow exclusion or inclusion volumes). */
  weatherPolyhedra?: Array<{
    center: [number, number, number];
    radius: number;
    planes: Array<[number, number, number, number]>;
  }>;
  /** Tag ID of the scenario's primary Sky 3D model (`gbxmodel`), if any. */
  skyModelTagId?: number;
  /** Outdoor ambient radiosity color `[r, g, b]` from the scenario's primary `sky` tag. */
  skyOutdoorAmbientColor?: [number, number, number];
  /** Outdoor fog color `[r, g, b]` from the scenario's primary `sky` tag. */
  skyOutdoorFogColor?: [number, number, number];
}

/**
 * Extracts the 3D render geometry for a scenario Structure BSP from a Halo PC / CE / Xbox map buffer.
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

  const bspCount = bspsField.value.count;
  if (bspIndex < 0 || bspIndex >= bspCount) {
    throw new Error(`BSP index ${bspIndex} is out of bounds (scenario has ${bspCount} BSPs).`);
  }

  const scenarioBspSize = resolveStruct('ScenarioBSP').totalSize;
  const bspsArrayOffset = header.tagDataOffset + (bspsField.value.pointerLow - tagIndex.baseMemoryAddress);

  const bspNames: string[] = [];
  for (let i = 0; i < bspCount; i++) {
    const entryOffset = bspsArrayOffset + i * scenarioBspSize;
    const entry = decodeStruct(buffer, entryOffset, 'ScenarioBSP');
    const dep = entry.get('structure bsp');
    const depTagId = dep && dep.kind === 'dependency' ? dep.value.tagId : 0xffffffff;
    const tagEntry = tagIndex.entries[depTagId & 0xffff];
    bspNames.push(tagEntry?.path || `BSP ${i}`);
  }

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
    bspIndex,
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
    const rawBitmapIdx = bitmapField?.value ?? -1;
    const lightmapBitmapIndex = rawBitmapIdx === 0xffff || rawBitmapIdx < 0 ? -1 : rawBitmapIdx;

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
      const lmVertCountField = decodedMat.get('lightmap vertices count') as { kind: 'basic'; value: number } | undefined;

      const surfaceIndexStart = surfStartField?.value ?? 0;
      const surfaceCount = surfCountField?.value ?? 0;
      const vertexCount = vertCountField?.value ?? 0;
      const lmVertexCount = lmVertCountField?.value ?? 0;

      if (vertexCount === 0 || surfaceCount === 0) {
        continue;
      }

      const uncompressedData = decodedMat.get('uncompressed vertices');
      const vertPtr = uncompressedData && uncompressedData.kind === 'tagDataOffset' ? uncompressedData.value.pointerLow : 0;
      const rvIdxPtrField = decodedMat.get('rendered vertices index pointer') as { kind: 'basic'; value: number } | undefined;
      const lmvIdxPtrField = decodedMat.get('lightmap vertices index pointer') as { kind: 'basic'; value: number } | undefined;
      const rvIdxPtr = rvIdxPtrField?.value ?? 0;
      const lmvIdxPtr = lmvIdxPtrField?.value ?? 0;

      const isXboxCompressedBsp = vertPtr === 0 && rvIdxPtr !== 0 && header.engine === 5;

      let vertOffset: number;
      let lmVertOffset = 0;
      if (isXboxCompressedBsp) {
        const rvRefOff = bspLocation.fileOffsetAnchor + (rvIdxPtr - bspLocation.baseMemoryAddress);
        const actualVertPtr = buffer.readUInt32LE(rvRefOff + 4);
        vertOffset = bspLocation.fileOffsetAnchor + (actualVertPtr - bspLocation.baseMemoryAddress);
        if (lmVertexCount > 0 && lmvIdxPtr !== 0) {
          const lmvRefOff = bspLocation.fileOffsetAnchor + (lmvIdxPtr - bspLocation.baseMemoryAddress);
          const actualLmVertPtr = buffer.readUInt32LE(lmvRefOff + 4);
          lmVertOffset = bspLocation.fileOffsetAnchor + (actualLmVertPtr - bspLocation.baseMemoryAddress);
        }
      } else if (vertPtr !== 0) {
        vertOffset = bspLocation.fileOffsetAnchor + (vertPtr - bspLocation.baseMemoryAddress);
        lmVertOffset = vertOffset + vertexCount * 56;
      } else {
        const renderedVertOffsetField = decodedMat.get('rendered vertices offset') as { kind: 'basic'; value: number } | undefined;
        const lmVertOffsetField = decodedMat.get('lightmap vertices offset') as { kind: 'basic'; value: number } | undefined;
        vertOffset = 2048 + (renderedVertOffsetField?.value ?? 0);
        lmVertOffset = 2048 + (lmVertOffsetField?.value ?? (renderedVertOffsetField?.value ?? 0) + vertexCount * 56);
      }

      // Read interleaved vertices: [x, y, z, nx, ny, nz, u, v] (8 floats per vertex)
      const vertices = new Float32Array(vertexCount * 8);
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      if (isXboxCompressedBsp) {
        for (let v = 0; v < vertexCount; v++) {
          const vOff = vertOffset + v * 32;
          const x = buffer.readFloatLE(vOff + 0);
          const y = buffer.readFloatLE(vOff + 4);
          const z = buffer.readFloatLE(vOff + 8);
          const [nx, ny, nz] = unpackCompressedUnitVector32(buffer.readUInt32LE(vOff + 12));
          const u = buffer.readFloatLE(vOff + 24);
          const vCoord = buffer.readFloatLE(vOff + 28);

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
      } else {
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
      }

      // Read lightmap UVs
      const lightmapUvs = new Float32Array(vertexCount * 2);
      if (isXboxCompressedBsp) {
        if (lightmapBitmapIndex >= 0 && lmVertOffset > 0 && lmVertexCount >= vertexCount) {
          for (let v = 0; v < vertexCount; v++) {
            const lmvOff = lmVertOffset + v * 8;
            const lu = buffer.readInt16LE(lmvOff + 4) / 32767.0;
            const lv = buffer.readInt16LE(lmvOff + 6) / 32767.0;
            lightmapUvs[v * 2 + 0] = lu;
            lightmapUvs[v * 2 + 1] = lv;
          }
        }
      } else if (
        lightmapBitmapIndex >= 0 &&
        lmVertexCount >= vertexCount &&
        lmVertOffset > 0 &&
        lmVertOffset + vertexCount * 20 <= buffer.length
      ) {
        for (let v = 0; v < vertexCount; v++) {
          const lmvOff = lmVertOffset + v * 20;
          const lu = buffer.readFloatLE(lmvOff + 12);
          const lv = buffer.readFloatLE(lmvOff + 16);
          lightmapUvs[v * 2 + 0] = lu;
          lightmapUvs[v * 2 + 1] = lv;
        }
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

      const shaderEntry = shaderTagId !== 0xffffffff ? tagIndex.entries[shaderTagId & 0xffff] : undefined;
      submeshes.push({
        submeshIndex: submeshCounter++,
        lightmapIndex: lmIdx,
        lightmapBitmapIndex,
        shaderTagId,
        shaderPath: shaderEntry?.path || undefined,
        shaderClassFourCC: shaderEntry ? fourCCToString(shaderEntry.primaryClassFourCC) : undefined,
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

  // Extract 3D BSP Diagnostic Volumes: Cluster Portals, Fog Planes, Weather Polyhedra
  const clusterPortals: NonNullable<BspRenderMesh['clusterPortals']> = [];
  const portalsField = decodedBsp.get('cluster portals');
  if (portalsField && portalsField.kind === 'reflexive' && portalsField.value.count > 0 && portalsField.value.pointerLow > 0) {
    const portalStructSize = resolveStruct('ScenarioStructureBSPClusterPortal').totalSize; // 64
    const portalsOffset = bspLocation.fileOffsetAnchor + (portalsField.value.pointerLow - bspLocation.baseMemoryAddress);
    for (let i = 0; i < portalsField.value.count; i++) {
      const pOff = portalsOffset + i * portalStructSize;
      if (pOff < 0 || pOff + portalStructSize > buffer.length) break;
      const frontCluster = buffer.readInt16LE(pOff + 0);
      const backCluster = buffer.readInt16LE(pOff + 2);
      const cx = buffer.readFloatLE(pOff + 8);
      const cy = buffer.readFloatLE(pOff + 12);
      const cz = buffer.readFloatLE(pOff + 16);
      const boundingRadius = buffer.readFloatLE(pOff + 20);
      const vCount = buffer.readInt32LE(pOff + 52);
      const vPtr = buffer.readUInt32LE(pOff + 56);
      const verts: Array<[number, number, number]> = [];
      if (vCount > 0 && vCount <= 128 && vPtr > 0) {
        const vBase = bspLocation.fileOffsetAnchor + (vPtr - bspLocation.baseMemoryAddress);
        for (let v = 0; v < vCount; v++) {
          const vo = vBase + v * 12;
          if (vo < 0 || vo + 12 > buffer.length) break;
          verts.push([buffer.readFloatLE(vo), buffer.readFloatLE(vo + 4), buffer.readFloatLE(vo + 8)]);
        }
      }
      if (verts.length >= 3) {
        clusterPortals.push({
          frontCluster,
          backCluster,
          centroid: [cx, cy, cz],
          boundingRadius,
          vertices: verts,
        });
      }
    }
  }

  const fogPlanes: NonNullable<BspRenderMesh['fogPlanes']> = [];
  const fogField = decodedBsp.get('fog planes');
  if (fogField && fogField.kind === 'reflexive' && fogField.value.count > 0 && fogField.value.pointerLow > 0) {
    const fogStructSize = resolveStruct('ScenarioStructureBSPFogPlane').totalSize; // 32
    const fogOffset = bspLocation.fileOffsetAnchor + (fogField.value.pointerLow - bspLocation.baseMemoryAddress);
    for (let i = 0; i < fogField.value.count; i++) {
      const fOff = fogOffset + i * fogStructSize;
      if (fOff < 0 || fOff + fogStructSize > buffer.length) break;
      const frontRegion = buffer.readInt16LE(fOff + 0);
      const vCount = buffer.readInt32LE(fOff + 20);
      const vPtr = buffer.readUInt32LE(fOff + 24);
      const verts: Array<[number, number, number]> = [];
      let sx = 0, sy = 0, sz = 0;
      if (vCount > 0 && vCount <= 128 && vPtr > 0) {
        const vBase = bspLocation.fileOffsetAnchor + (vPtr - bspLocation.baseMemoryAddress);
        for (let v = 0; v < vCount; v++) {
          const vo = vBase + v * 12;
          if (vo < 0 || vo + 12 > buffer.length) break;
          const vx = buffer.readFloatLE(vo);
          const vy = buffer.readFloatLE(vo + 4);
          const vz = buffer.readFloatLE(vo + 8);
          verts.push([vx, vy, vz]);
          sx += vx; sy += vy; sz += vz;
        }
      }
      if (verts.length >= 3) {
        fogPlanes.push({
          frontRegion,
          centroid: [sx / verts.length, sy / verts.length, sz / verts.length],
          vertices: verts,
        });
      }
    }
  }

  const weatherPolyhedra: NonNullable<BspRenderMesh['weatherPolyhedra']> = [];
  const weatherField = decodedBsp.get('weather polyhedra');
  if (weatherField && weatherField.kind === 'reflexive' && weatherField.value.count > 0 && weatherField.value.pointerLow > 0) {
    const weatherStructSize = resolveStruct('ScenarioStructureBSPWeatherPolyhedron').totalSize; // 32
    const weatherOffset = bspLocation.fileOffsetAnchor + (weatherField.value.pointerLow - bspLocation.baseMemoryAddress);
    for (let i = 0; i < weatherField.value.count; i++) {
      const wOff = weatherOffset + i * weatherStructSize;
      if (wOff < 0 || wOff + weatherStructSize > buffer.length) break;
      const cx = buffer.readFloatLE(wOff + 0);
      const cy = buffer.readFloatLE(wOff + 4);
      const cz = buffer.readFloatLE(wOff + 8);
      const radius = buffer.readFloatLE(wOff + 12);
      const pCount = buffer.readInt32LE(wOff + 20);
      const pPtr = buffer.readUInt32LE(wOff + 24);
      const planes: Array<[number, number, number, number]> = [];
      if (pCount > 0 && pCount <= 64 && pPtr > 0) {
        const pBase = bspLocation.fileOffsetAnchor + (pPtr - bspLocation.baseMemoryAddress);
        for (let p = 0; p < pCount; p++) {
          const po = pBase + p * 16;
          if (po < 0 || po + 16 > buffer.length) break;
          planes.push([
            buffer.readFloatLE(po + 0),
            buffer.readFloatLE(po + 4),
            buffer.readFloatLE(po + 8),
            buffer.readFloatLE(po + 12),
          ]);
        }
      }
      if (radius > 0) {
        weatherPolyhedra.push({
          center: [cx, cy, cz],
          radius,
          planes,
        });
      }
    }
  }

  // Extract scenario Sky model & outdoor atmosphere colors (Sapien skybox + lighting)
  let skyModelTagId: number | undefined;
  let skyOutdoorAmbientColor: [number, number, number] | undefined;
  let skyOutdoorFogColor: [number, number, number] | undefined;
  try {
    const skiesField = decodedScenario.get('skies');
    if (skiesField && skiesField.kind === 'reflexive' && skiesField.value.count > 0 && skiesField.value.pointerLow > 0) {
      const skiesOffset = header.tagDataOffset + (skiesField.value.pointerLow - tagIndex.baseMemoryAddress);
      const skyDep = decodeStruct(buffer, skiesOffset, 'ScenarioSky').get('sky');
      const skyTagId = skyDep && skyDep.kind === 'dependency' ? skyDep.value.tagId : 0xffffffff;
      if (skyTagId !== 0xffffffff) {
        const skyEntry = tagIndex.entries[skyTagId & 0xffff];
        if (skyEntry && !skyEntry.isExternal) {
          const skyFileOffset = resolveTagDataPointer(
            skyEntry.tagDataPointerOrResourceIndex,
            header,
            tagIndex.baseMemoryAddress,
          );
          const decodedSky = decodeStruct(buffer, skyFileOffset, 'Sky');
          const modelDep = decodedSky.get('model');
          if (modelDep && modelDep.kind === 'dependency' && modelDep.value.tagId !== 0xffffffff) {
            skyModelTagId = modelDep.value.tagId;
          }
          const ambField = decodedSky.get('outdoor ambient radiosity color');
          if (ambField && ambField.kind === 'array' && Array.isArray(ambField.value) && ambField.value.length >= 3) {
            skyOutdoorAmbientColor = [
              Number(ambField.value[0]) || 0,
              Number(ambField.value[1]) || 0,
              Number(ambField.value[2]) || 0,
            ];
          }
          const fogField = decodedSky.get('outdoor fog color');
          if (fogField && fogField.kind === 'array' && Array.isArray(fogField.value) && fogField.value.length >= 3) {
            skyOutdoorFogColor = [
              Number(fogField.value[0]) || 0,
              Number(fogField.value[1]) || 0,
              Number(fogField.value[2]) || 0,
            ];
          }
        }
      }
    }
  } catch {
    // Non-fatal if sky tag is custom/missing
  }

  return {
    bspIndex,
    bspCount,
    bspNames,
    bspTagId,
    lightmapsBitmapTagId,
    worldBounds,
    totalVertices,
    totalTriangles,
    submeshes,
    clusterPortals,
    fogPlanes,
    weatherPolyhedra,
    skyModelTagId,
    skyOutdoorAmbientColor,
    skyOutdoorFogColor,
  };
}

/**
 * Writes modified 3D vertex positions and normals (plus optional shaderTagId and triangle indices overrides) back into a
 * `ScenarioStructureBSP` in memory, updating both rendered lightmap vertices and matching 3D collision BSP vertices.
 */
export function updateBspVerticesInMap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  bspIndex: number,
  updates: Array<{
    submeshIndex: number;
    vertices: Float32Array | number[];
    shaderTagId?: number;
    indices?: Uint16Array | Uint32Array | number[];
  }>,
): { updatedVertices: number; updatedCollisionVertices: number; updatedShaders: number } {
  const scenarioEntry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  if (!scenarioEntry) throw new Error('Scenario tag not found.');
  const scenarioFileOffset = resolveTagDataPointer(
    scenarioEntry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  const decodedScenario = decodeStruct(buffer, scenarioFileOffset, 'Scenario');
  const bspsField = decodedScenario.get('structure bsps');
  if (!bspsField || bspsField.kind !== 'reflexive' || bspIndex < 0 || bspIndex >= bspsField.value.count) {
    throw new Error(`Invalid BSP index ${bspIndex}.`);
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
    bspIndex,
  );
  if (!bspLocation) throw new Error('Failed to locate structure BSP.');

  const decodedBsp = decodeStruct(buffer, bspLocation.fileOffset, 'ScenarioStructureBSP');
  const lightmapsField = decodedBsp.get('lightmaps');
  if (!lightmapsField || lightmapsField.kind !== 'reflexive') {
    throw new Error('ScenarioStructureBSP has invalid lightmaps reflexive.');
  }

  // Surfaces (triangles)
  const surfacesField = decodedBsp.get('surfaces');
  const surfacesOffset =
    surfacesField && surfacesField.kind === 'reflexive'
      ? bspLocation.fileOffsetAnchor + (surfacesField.value.pointerLow - bspLocation.baseMemoryAddress)
      : 0;

  const lightmapsOffset = bspLocation.fileOffsetAnchor + (lightmapsField.value.pointerLow - bspLocation.baseMemoryAddress);
  const lmStructSize = resolveStruct('ScenarioStructureBSPLightmap').totalSize;
  const matStructSize = resolveStruct('ScenarioStructureBSPMaterial').totalSize;

  const updateMap = new Map<
    number,
    { vertices: Float32Array | number[]; shaderTagId?: number; indices?: Uint16Array | Uint32Array | number[] }
  >();
  for (const u of updates) updateMap.set(u.submeshIndex, u);

  let submeshCounter = 0;
  let updatedVertices = 0;
  let updatedShaders = 0;
  const movedPositions: Array<{ oldX: number; oldY: number; oldZ: number; newX: number; newY: number; newZ: number }> = [];

  for (let lmIdx = 0; lmIdx < lightmapsField.value.count; lmIdx++) {
    const lmOffset = lightmapsOffset + lmIdx * lmStructSize;
    const decodedLm = decodeStruct(buffer, lmOffset, 'ScenarioStructureBSPLightmap');
    const materialsReflexive = decodedLm.get('materials');
    if (!materialsReflexive || materialsReflexive.kind !== 'reflexive' || materialsReflexive.value.count === 0) {
      continue;
    }
    const materialsOffset = bspLocation.fileOffsetAnchor + (materialsReflexive.value.pointerLow - bspLocation.baseMemoryAddress);

    for (let matIdx = 0; matIdx < materialsReflexive.value.count; matIdx++) {
      const matOffset = materialsOffset + matIdx * matStructSize;
      const decodedMat = decodeStruct(buffer, matOffset, 'ScenarioStructureBSPMaterial');
      const surfStartField = decodedMat.get('surfaces') as { kind: 'basic'; value: number } | undefined;
      const surfCountField = decodedMat.get('surface count') as { kind: 'basic'; value: number } | undefined;
      const vertCountField = decodedMat.get('rendered vertices count') as { kind: 'basic'; value: number } | undefined;
      const lmVertCountField = decodedMat.get('lightmap vertices count') as { kind: 'basic'; value: number } | undefined;
      const surfaceIndexStart = surfStartField?.value ?? 0;
      const surfaceCount = surfCountField?.value ?? 0;
      const vertexCount = vertCountField?.value ?? 0;
      const lmVertexCount = lmVertCountField?.value ?? 0;
      if (vertexCount === 0 || surfaceCount === 0) continue;

      const thisSubIdx = submeshCounter++;
      const upd = updateMap.get(thisSubIdx);
      if (!upd) continue;

      if (upd.shaderTagId !== undefined && upd.shaderTagId !== 0xffffffff) {
        const shaderEntry = tagIndex.entries.find((e) => e.tagId === upd.shaderTagId);
        if (shaderEntry) {
          const tagArrayAddr = buffer.readUInt32LE(header.tagDataOffset);
          const tagEntryOff = header.tagDataOffset + (tagArrayAddr - tagIndex.baseMemoryAddress) + shaderEntry.index * 32;
          const namePtr = tagEntryOff + 20 <= buffer.length ? buffer.readUInt32LE(tagEntryOff + 16) : 0;
          buffer.writeUInt32LE(shaderEntry.primaryClassFourCC >>> 0, matOffset + 0);
          buffer.writeUInt32LE(namePtr >>> 0, matOffset + 4);
          buffer.writeUInt32LE(0, matOffset + 8);
          buffer.writeUInt16LE(0, matOffset + 16); // shader permutation = 0
        }
        buffer.writeUInt32LE(upd.shaderTagId >>> 0, matOffset + 12);
        updatedShaders++;
      }

      // If updated triangle indices are provided (e.g. deleted faces collapsed to (0,0,0)), write them into surfaces
      if (upd.indices && surfacesOffset > 0) {
        const maxSurfs = Math.min(surfaceCount, Math.floor(upd.indices.length / 3));
        for (let s = 0; s < maxSurfs; s++) {
          const sOff = surfacesOffset + (surfaceIndexStart + s) * 6;
          if (sOff + 6 > buffer.length) break;
          const i0 = Math.min(vertexCount - 1, Math.max(0, upd.indices[s * 3 + 0]!));
          const i1 = Math.min(vertexCount - 1, Math.max(0, upd.indices[s * 3 + 1]!));
          const i2 = Math.min(vertexCount - 1, Math.max(0, upd.indices[s * 3 + 2]!));
          buffer.writeUInt16LE(i0, sOff + 0);
          buffer.writeUInt16LE(i1, sOff + 2);
          buffer.writeUInt16LE(i2, sOff + 4);
        }
      }

      const uncompressedData = decodedMat.get('uncompressed vertices');
      const vertPtr = uncompressedData && uncompressedData.kind === 'tagDataOffset' ? uncompressedData.value.pointerLow : 0;
      const rvIdxPtrField = decodedMat.get('rendered vertices index pointer') as { kind: 'basic'; value: number } | undefined;
      const rvIdxPtr = rvIdxPtrField?.value ?? 0;
      const isXboxCompressedBsp = vertPtr === 0 && rvIdxPtr !== 0 && header.engine === 5;

      let vertOffset: number;
      let lmVertOffset = 0;
      if (isXboxCompressedBsp) {
        const rvRefOff = bspLocation.fileOffsetAnchor + (rvIdxPtr - bspLocation.baseMemoryAddress);
        const actualVertPtr = buffer.readUInt32LE(rvRefOff + 4);
        vertOffset = bspLocation.fileOffsetAnchor + (actualVertPtr - bspLocation.baseMemoryAddress);
      } else if (vertPtr !== 0) {
        vertOffset = bspLocation.fileOffsetAnchor + (vertPtr - bspLocation.baseMemoryAddress);
        lmVertOffset = vertOffset + vertexCount * 56;
      } else {
        const renderedVertOffsetField = decodedMat.get('rendered vertices offset') as { kind: 'basic'; value: number } | undefined;
        const lmVertOffsetField = decodedMat.get('lightmap vertices offset') as { kind: 'basic'; value: number } | undefined;
        vertOffset = 2048 + (renderedVertOffsetField?.value ?? 0);
        lmVertOffset = 2048 + (lmVertOffsetField?.value ?? (renderedVertOffsetField?.value ?? 0) + vertexCount * 56);
      }

      const verts = upd.vertices;
      const stride = isXboxCompressedBsp ? 32 : 56;

      // Recompute outward Halo Clockwise vertex normals: (v2 - v0) x (v1 - v0)
      const cwNormals = new Float32Array(vertexCount * 3);
      if (surfacesOffset > 0 && verts.length >= vertexCount * 8) {
        for (let s = 0; s < surfaceCount; s++) {
          const sOff = surfacesOffset + (surfaceIndexStart + s) * 6;
          if (sOff + 6 > buffer.length) break;
          const i0 = buffer.readUInt16LE(sOff + 0);
          const i1 = buffer.readUInt16LE(sOff + 2);
          const i2 = buffer.readUInt16LE(sOff + 4);
          if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
          const x0 = verts[i0 * 8 + 0]!, y0 = verts[i0 * 8 + 1]!, z0 = verts[i0 * 8 + 2]!;
          const x1 = verts[i1 * 8 + 0]!, y1 = verts[i1 * 8 + 1]!, z1 = verts[i1 * 8 + 2]!;
          const x2 = verts[i2 * 8 + 0]!, y2 = verts[i2 * 8 + 1]!, z2 = verts[i2 * 8 + 2]!;
          // Halo CE uses Clockwise winding: outward normal is (v2 - v0) x (v1 - v0)
          const ax = x2 - x0, ay = y2 - y0, az = z2 - z0;
          const bx = x1 - x0, by = y1 - y0, bz = z1 - z0;
          const fnx = ay * bz - az * by;
          const fny = az * bx - ax * bz;
          const fnz = ax * by - ay * bx;
          cwNormals[i0 * 3 + 0] += fnx; cwNormals[i0 * 3 + 1] += fny; cwNormals[i0 * 3 + 2] += fnz;
          cwNormals[i1 * 3 + 0] += fnx; cwNormals[i1 * 3 + 1] += fny; cwNormals[i1 * 3 + 2] += fnz;
          cwNormals[i2 * 3 + 0] += fnx; cwNormals[i2 * 3 + 1] += fny; cwNormals[i2 * 3 + 2] += fnz;
        }
        for (let v = 0; v < vertexCount; v++) {
          const nx = cwNormals[v * 3 + 0]!;
          const ny = cwNormals[v * 3 + 1]!;
          const nz = cwNormals[v * 3 + 2]!;
          const len = Math.hypot(nx, ny, nz);
          if (len > 1e-6) {
            cwNormals[v * 3 + 0] = nx / len;
            cwNormals[v * 3 + 1] = ny / len;
            cwNormals[v * 3 + 2] = nz / len;
          } else {
            cwNormals[v * 3 + 0] = verts[v * 8 + 3] ?? 0;
            cwNormals[v * 3 + 1] = verts[v * 8 + 4] ?? 0;
            cwNormals[v * 3 + 2] = verts[v * 8 + 5] ?? 1;
          }
        }
      }

      let submeshPositionModified = false;
      for (let v = 0; v < vertexCount && v * 8 + 5 < verts.length; v++) {
        const vOff = vertOffset + v * stride;
        const oldX = buffer.readFloatLE(vOff + 0);
        const oldY = buffer.readFloatLE(vOff + 4);
        const oldZ = buffer.readFloatLE(vOff + 8);
        const newX = verts[v * 8 + 0]!;
        const newY = verts[v * 8 + 1]!;
        const newZ = verts[v * 8 + 2]!;
        const posMoved = Math.abs(newX - oldX) > 1e-4 || Math.abs(newY - oldY) > 1e-4 || Math.abs(newZ - oldZ) > 1e-4;
        if (posMoved) {
          submeshPositionModified = true;
          movedPositions.push({ oldX, oldY, oldZ, newX, newY, newZ });
          buffer.writeFloatLE(newX, vOff + 0);
          buffer.writeFloatLE(newY, vOff + 4);
          buffer.writeFloatLE(newZ, vOff + 8);
          updatedVertices++;
        }
        if (!isXboxCompressedBsp && v * 8 + 7 < verts.length) {
          const oldU = buffer.readFloatLE(vOff + 48);
          const oldV = buffer.readFloatLE(vOff + 52);
          const newU = verts[v * 8 + 6]!;
          const newV = verts[v * 8 + 7]!;
          if (Math.abs(newU - oldU) > 1e-5 || Math.abs(newV - oldV) > 1e-5) {
            buffer.writeFloatLE(newU, vOff + 48);
            buffer.writeFloatLE(newV, vOff + 52);
          }
        }
      }

      // If any vertex position in this submesh changed, write outward Clockwise normals, tangent/binormal, and lightmap vertex normals
      if (submeshPositionModified && !isXboxCompressedBsp) {
        for (let v = 0; v < vertexCount; v++) {
          const vOff = vertOffset + v * 56;
          if (vOff + 56 > buffer.length) break;
          const nx = cwNormals[v * 3 + 0]!;
          const ny = cwNormals[v * 3 + 1]!;
          const nz = cwNormals[v * 3 + 2]!;
          buffer.writeFloatLE(nx, vOff + 12);
          buffer.writeFloatLE(ny, vOff + 16);
          buffer.writeFloatLE(nz, vOff + 20);

          // Orthonormal tangent & binormal perpendicular to normal
          const upX = Math.abs(nz) < 0.99 ? 0 : 1;
          const upY = 0;
          const upZ = Math.abs(nz) < 0.99 ? 1 : 0;
          let tx = upY * nz - upZ * ny;
          let ty = upZ * nx - upX * nz;
          let tz = upX * ny - upY * nx;
          const tLen = Math.hypot(tx, ty, tz) || 1;
          tx /= tLen; ty /= tLen; tz /= tLen;
          const bx = ny * tz - nz * ty;
          const by = nz * tx - nx * tz;
          const bz = nx * ty - ny * tx;
          buffer.writeFloatLE(bx, vOff + 24);
          buffer.writeFloatLE(by, vOff + 28);
          buffer.writeFloatLE(bz, vOff + 32);
          buffer.writeFloatLE(tx, vOff + 36);
          buffer.writeFloatLE(ty, vOff + 40);
          buffer.writeFloatLE(tz, vOff + 44);

          if (lmVertOffset > 0 && v < lmVertexCount) {
            const lmvOff = lmVertOffset + v * 20;
            if (lmvOff + 12 <= buffer.length) {
              buffer.writeFloatLE(nx, lmvOff + 0);
              buffer.writeFloatLE(ny, lmvOff + 4);
              buffer.writeFloatLE(nz, lmvOff + 8);
            }
          }
        }
      }
    }
  }

  // Update CollisionBSP (vertices, non-partition surface planes, and bsp2d_nodes) so collision matches sculpted geometry without holes
  let updatedCollisionVertices = 0;
  if (movedPositions.length > 0) {
    const collBspField = decodedBsp.get('collision bsp');
    if (collBspField && collBspField.kind === 'reflexive' && collBspField.value.count > 0) {
      const collBspOff = bspLocation.fileOffsetAnchor + (collBspField.value.pointerLow - bspLocation.baseMemoryAddress);
      const toOff = (ptr: number) => bspLocation.fileOffsetAnchor + (ptr - bspLocation.baseMemoryAddress);

      const cNode3dCount = buffer.readUInt32LE(collBspOff + 0x00);
      const cNode3dPtr = buffer.readUInt32LE(collBspOff + 0x04);
      const cPlaneCount = buffer.readUInt32LE(collBspOff + 0x0c);
      const cPlanePtr = buffer.readUInt32LE(collBspOff + 0x10);
      const cRef2dCount = buffer.readUInt32LE(collBspOff + 0x24);
      const cRef2dPtr = buffer.readUInt32LE(collBspOff + 0x28);
      const cNode2dCount = buffer.readUInt32LE(collBspOff + 0x30);
      const cNode2dPtr = buffer.readUInt32LE(collBspOff + 0x34);
      const cSurfCount = buffer.readUInt32LE(collBspOff + 0x3c);
      const cSurfPtr = buffer.readUInt32LE(collBspOff + 0x40);
      const cEdgeCount = buffer.readUInt32LE(collBspOff + 0x48);
      const cEdgePtr = buffer.readUInt32LE(collBspOff + 0x4c);
      const cVertCount = buffer.readUInt32LE(collBspOff + 0x54);
      const cVertPtr = buffer.readUInt32LE(collBspOff + 0x58);

      // Count how many 3D BSP nodes use each plane as a spatial partition plane
      const plane3dNodeUseCount = new Map<number, number>();
      if (cNode3dCount > 0 && cNode3dPtr > 0) {
        const cNode3dBase = toOff(cNode3dPtr);
        for (let n = 0; n < cNode3dCount; n++) {
          const nOff = cNode3dBase + n * 12;
          if (nOff + 12 > buffer.length) break;
          const pIdx = buffer.readInt32LE(nOff + 0) & 0x7fffffff;
          plane3dNodeUseCount.set(pIdx, (plane3dNodeUseCount.get(pIdx) ?? 0) + 1);
        }
      }

      const modifiedCollVerts = new Set<number>();

      // Deduplicate moved render vertices by original position so seam duplicates don't skew IDW weights
      const uniqueMoved: Array<{ oldX: number; oldY: number; oldZ: number; newX: number; newY: number; newZ: number }> = [];
      const seenMovedKeys = new Set<string>();
      for (let m = 0; m < movedPositions.length; m++) {
        const mp = movedPositions[m]!;
        const k = `${Math.round(mp.oldX * 200)},${Math.round(mp.oldY * 200)},${Math.round(mp.oldZ * 200)}`;
        if (!seenMovedKeys.has(k)) {
          seenMovedKeys.add(k);
          uniqueMoved.push(mp);
        }
      }

      if (cVertCount > 0 && cVertPtr > 0 && uniqueMoved.length > 0) {
        const cVertBase = toOff(cVertPtr);
        for (let cv = 0; cv < cVertCount; cv++) {
          const cvOff = cVertBase + cv * 16;
          if (cvOff + 12 > buffer.length) break;
          const cx = buffer.readFloatLE(cvOff + 0);
          const cy = buffer.readFloatLE(cvOff + 4);
          const cz = buffer.readFloatLE(cvOff + 8);
          let bestDistSq = 0.0025; // 0.05 world units exact 1:1 vertex match radius (never collapse nearby distinct vertices!)
          let bestMp: { oldX: number; oldY: number; oldZ: number; newX: number; newY: number; newZ: number } | null = null;
          for (let m = 0; m < uniqueMoved.length; m++) {
            const mp = uniqueMoved[m]!;
            const dx = cx - mp.oldX;
            const dy = cy - mp.oldY;
            const dz = cz - mp.oldZ;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestMp = mp;
            }
          }
          if (bestMp) {
            const nx = cx + (bestMp.newX - bestMp.oldX);
            const ny = cy + (bestMp.newY - bestMp.oldY);
            const nz = cz + (bestMp.newZ - bestMp.oldZ);
            buffer.writeFloatLE(nx, cvOff + 0);
            buffer.writeFloatLE(ny, cvOff + 4);
            buffer.writeFloatLE(nz, cvOff + 8);
            modifiedCollVerts.add(cv);
            updatedCollisionVertices++;
          } else {
            // Smooth IDW displacement fallback for nearby CollisionBSP vertices (within 1.25 world units)
            // that are subdivided differently from lightmap vertices
            let wSum = 0;
            let dXSum = 0;
            let dYSum = 0;
            let dZSum = 0;
            for (let m = 0; m < uniqueMoved.length; m++) {
              const mp = uniqueMoved[m]!;
              const dx = cx - mp.oldX;
              const dy = cy - mp.oldY;
              const dz = cz - mp.oldZ;
              const dSq = dx * dx + dy * dy + dz * dz;
              if (dSq < 1.5625) {
                const dist = Math.sqrt(dSq);
                const falloff = 1.0 - dist / 1.25;
                const w = (falloff * falloff) / (dSq + 0.005);
                wSum += w;
                dXSum += (mp.newX - mp.oldX) * w;
                dYSum += (mp.newY - mp.oldY) * w;
                dZSum += (mp.newZ - mp.oldZ) * w;
              }
            }
            if (wSum > 0) {
              const nx = cx + dXSum / wSum;
              const ny = cy + dYSum / wSum;
              const nz = cz + dZSum / wSum;
              buffer.writeFloatLE(nx, cvOff + 0);
              buffer.writeFloatLE(ny, cvOff + 4);
              buffer.writeFloatLE(nz, cvOff + 8);
              modifiedCollVerts.add(cv);
              updatedCollisionVertices++;
            }
          }
        }

        // Expand ScenarioStructureBSP world bounds if any moved vertices exceed current bounds
        let wbMinX = buffer.readFloatLE(bspLocation.fileOffset + 200);
        let wbMaxX = buffer.readFloatLE(bspLocation.fileOffset + 204);
        let wbMinY = buffer.readFloatLE(bspLocation.fileOffset + 208);
        let wbMaxY = buffer.readFloatLE(bspLocation.fileOffset + 212);
        let wbMinZ = buffer.readFloatLE(bspLocation.fileOffset + 216);
        let wbMaxZ = buffer.readFloatLE(bspLocation.fileOffset + 220);
        let wbChanged = false;
        for (const mp of movedPositions) {
          if (mp.newX < wbMinX) { wbMinX = mp.newX - 1; wbChanged = true; }
          if (mp.newX > wbMaxX) { wbMaxX = mp.newX + 1; wbChanged = true; }
          if (mp.newY < wbMinY) { wbMinY = mp.newY - 1; wbChanged = true; }
          if (mp.newY > wbMaxY) { wbMaxY = mp.newY + 1; wbChanged = true; }
          if (mp.newZ < wbMinZ) { wbMinZ = mp.newZ - 1; wbChanged = true; }
          if (mp.newZ > wbMaxZ) { wbMaxZ = mp.newZ + 1; wbChanged = true; }
        }
        if (wbChanged) {
          buffer.writeFloatLE(wbMinX, bspLocation.fileOffset + 200);
          buffer.writeFloatLE(wbMaxX, bspLocation.fileOffset + 204);
          buffer.writeFloatLE(wbMinY, bspLocation.fileOffset + 208);
          buffer.writeFloatLE(wbMaxY, bspLocation.fileOffset + 212);
          buffer.writeFloatLE(wbMinZ, bspLocation.fileOffset + 216);
          buffer.writeFloatLE(wbMaxZ, bspLocation.fileOffset + 220);
        }

        // Recompute planes and enforce planarity ONLY for local surfaces where ALL surfaces on that plane were modified
        // and the plane is NOT a multi-node 3D spatial partition plane (preventing BSP tree tearing / falling through map!)
        if (modifiedCollVerts.size > 0 && cPlaneCount > 0 && cSurfCount > 0 && cEdgeCount > 0) {
          const cPlaneBase = toOff(cPlanePtr);
          const cSurfBase = toOff(cSurfPtr);
          const cEdgeBase = toOff(cEdgePtr);

          const getSurfaceLoop = (sIdx: number): number[] => {
            const sOff = cSurfBase + sIdx * 12;
            const firstEdge = buffer.readInt32LE(sOff + 4);
            if (firstEdge < 0 || firstEdge >= cEdgeCount) return [];
            const loop: number[] = [];
            let e = firstEdge;
            let guard = 0;
            do {
              const eOff = cEdgeBase + e * 24;
              const startV = buffer.readInt32LE(eOff + 0);
              const endV = buffer.readInt32LE(eOff + 4);
              const fwdE = buffer.readInt32LE(eOff + 8);
              const revE = buffer.readInt32LE(eOff + 12);
              const leftS = buffer.readInt32LE(eOff + 16);
              if (leftS === sIdx) {
                loop.push(startV);
                e = fwdE;
              } else {
                loop.push(endV);
                e = revE;
              }
              guard++;
            } while (e !== firstEdge && e >= 0 && e < cEdgeCount && guard < 64);
            return loop;
          };

          const allPlaneSurfaces = new Map<number, number[]>();
          const affectedPlanes = new Set<number>();
          const surfaceLoops = new Map<number, number[]>();

          for (let s = 0; s < cSurfCount; s++) {
            const sOff = cSurfBase + s * 12;
            const planeIdx = buffer.readInt32LE(sOff + 0) & 0x7fffffff;
            if (planeIdx < 0 || planeIdx >= cPlaneCount) continue;
            const loop = getSurfaceLoop(s);
            surfaceLoops.set(s, loop);
            let list = allPlaneSurfaces.get(planeIdx);
            if (!list) {
              list = [];
              allPlaneSurfaces.set(planeIdx, list);
            }
            list.push(s);
            if (loop.some((v) => modifiedCollVerts.has(v))) {
              affectedPlanes.add(planeIdx);
            }
          }

          const modifiedPlanes = new Set<number>();

          // Pass 1: Planar groups with > 3 unique vertices — refit plane when local, or translate pd when shared across 3D BSP nodes
          for (const pIdx of affectedPlanes) {
            const sList = allPlaneSurfaces.get(pIdx) ?? [];
            if (sList.length > 12) continue;
            const uniqueVerts = new Set<number>();
            for (const s of sList) {
              for (const v of surfaceLoops.get(s) ?? []) uniqueVerts.add(v);
            }
            if (uniqueVerts.size <= 3) continue;

            const modSurfs = sList.filter((s) => (surfaceLoops.get(s) ?? []).some((v) => modifiedCollVerts.has(v)));
            if (sList.length > 2 && modSurfs.length < sList.length) continue;
            const fitSurfs = modSurfs.length > 0 ? modSurfs : sList;
            const nodeUses = plane3dNodeUseCount.get(pIdx) ?? 0;

            const pOff = cPlaneBase + pIdx * 16;
            const oldA = buffer.readFloatLE(pOff + 0);
            const oldB = buffer.readFloatLE(pOff + 4);
            const oldC = buffer.readFloatLE(pOff + 8);
            const oldD = buffer.readFloatLE(pOff + 12);

            let pa = oldA, pb = oldB, pc = oldC, pd = oldD;
            let nx = 0, ny = 0, nz = 0;
            let cx = 0, cy = 0, cz = 0, cnt = 0;
            for (const s of fitSurfs) {
              const loop = surfaceLoops.get(s) ?? [];
              for (let i = 0; i < loop.length; i++) {
                const vCurr = loop[i]!;
                const vNext = loop[(i + 1) % loop.length]!;
                const off0 = cVertBase + vCurr * 16;
                const off1 = cVertBase + vNext * 16;
                const x0 = buffer.readFloatLE(off0 + 0), y0 = buffer.readFloatLE(off0 + 4), z0 = buffer.readFloatLE(off0 + 8);
                const x1 = buffer.readFloatLE(off1 + 0), y1 = buffer.readFloatLE(off1 + 4), z1 = buffer.readFloatLE(off1 + 8);
                nx += (y0 - y1) * (z0 + z1);
                ny += (z0 - z1) * (x0 + x1);
                nz += (x0 - x1) * (y0 + y1);
                cx += x0; cy += y0; cz += z0; cnt++;
              }
            }
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-6 && cnt > 0) {
              nx /= len; ny /= len; nz /= len;
              if (nx * oldA + ny * oldB + nz * oldC < 0) {
                nx = -nx; ny = -ny; nz = -nz;
              }
              const dot = nx * oldA + ny * oldB + nz * oldC;
              cx /= cnt; cy /= cnt; cz /= cnt;
              if (nodeUses <= 2 && dot >= 0.5) {
                pa = nx; pb = ny; pc = nz;
              } else if (dot >= 0.88) {
                pa = nx; pb = ny; pc = nz;
              }
              pd = pa * cx + pb * cy + pc * cz;
              buffer.writeFloatLE(pa, pOff + 0);
              buffer.writeFloatLE(pb, pOff + 4);
              buffer.writeFloatLE(pc, pOff + 8);
              buffer.writeFloatLE(pd, pOff + 12);
              modifiedPlanes.add(pIdx);
              if (sList.length <= 2) {
                for (const vIdx of uniqueVerts) {
                  const vOff = cVertBase + vIdx * 16;
                  const vx = buffer.readFloatLE(vOff + 0);
                  const vy = buffer.readFloatLE(vOff + 4);
                  const vz = buffer.readFloatLE(vOff + 8);
                  const dist = pa * vx + pb * vy + pc * vz - pd;
                  buffer.writeFloatLE(vx - pa * dist, vOff + 0);
                  buffer.writeFloatLE(vy - pb * dist, vOff + 4);
                  buffer.writeFloatLE(vz - pc * dist, vOff + 8);
                }
              }
            }
          }

          // Pass 2: 3-vertex single-surface triangles — compute plane through the 3 vertices,
          // clamping normal rotation on multi-node 3D partition planes so distant BSP branches never tear
          for (const pIdx of affectedPlanes) {
            const sList = allPlaneSurfaces.get(pIdx) ?? [];
            if (sList.length !== 1) continue;
            const uniqueVerts = new Set<number>();
            for (const s of sList) {
              for (const v of surfaceLoops.get(s) ?? []) uniqueVerts.add(v);
            }
            if (uniqueVerts.size !== 3) continue;
            const [v0, v1, v2] = Array.from(uniqueVerts);
            const off0 = cVertBase + v0! * 16;
            const off1 = cVertBase + v1! * 16;
            const off2 = cVertBase + v2! * 16;
            const x0 = buffer.readFloatLE(off0 + 0), y0 = buffer.readFloatLE(off0 + 4), z0 = buffer.readFloatLE(off0 + 8);
            const x1 = buffer.readFloatLE(off1 + 0), y1 = buffer.readFloatLE(off1 + 4), z1 = buffer.readFloatLE(off1 + 8);
            const x2 = buffer.readFloatLE(off2 + 0), y2 = buffer.readFloatLE(off2 + 4), z2 = buffer.readFloatLE(off2 + 8);
            const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
            const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
            let nx = ay * bz - az * by;
            let ny = az * bx - ax * bz;
            let nz = ax * by - ay * bx;
            const len = Math.hypot(nx, ny, nz);
            if (len > 1e-6) {
              nx /= len; ny /= len; nz /= len;
              const pOff = cPlaneBase + pIdx * 16;
              const oldA = buffer.readFloatLE(pOff + 0);
              const oldB = buffer.readFloatLE(pOff + 4);
              const oldC = buffer.readFloatLE(pOff + 8);
              if (nx * oldA + ny * oldB + nz * oldC < 0) {
                nx = -nx; ny = -ny; nz = -nz;
              }
              const dot = nx * oldA + ny * oldB + nz * oldC;
              const nodeUses = plane3dNodeUseCount.get(pIdx) ?? 0;
              const cx = (x0 + x1 + x2) / 3;
              const cy = (y0 + y1 + y2) / 3;
              const cz = (z0 + z1 + z2) / 3;
              if ((nodeUses <= 2 && dot >= 0.35) || dot >= 0.85) {
                const pd = nx * x0 + ny * y0 + nz * z0;
                buffer.writeFloatLE(nx, pOff + 0);
                buffer.writeFloatLE(ny, pOff + 4);
                buffer.writeFloatLE(nz, pOff + 8);
                buffer.writeFloatLE(pd, pOff + 12);
                modifiedPlanes.add(pIdx);
              } else {
                const pd = oldA * cx + oldB * cy + oldC * cz;
                buffer.writeFloatLE(pd, pOff + 12);
                modifiedPlanes.add(pIdx);
              }
            }
          }

          // Pass 3: Update bsp2d_nodes 2D splitting lines for ALL affected planes referenced by bsp2d_references
          if (affectedPlanes.size > 0 && cRef2dCount > 0 && cNode2dCount > 0) {
            const cRef2dBase = toOff(cRef2dPtr);
            const cNode2dBase = toOff(cNode2dPtr);

            const collectSubtreeSurfaces = (nodeIdx: number, out: Set<number>, depth = 0) => {
              if (depth > 32) return;
              if (nodeIdx < 0) {
                const surfIdx = nodeIdx & 0x7fffffff;
                if (surfIdx < cSurfCount) out.add(surfIdx);
                return;
              }
              if (nodeIdx >= cNode2dCount) return;
              const nOff = cNode2dBase + nodeIdx * 20;
              const left = buffer.readInt32LE(nOff + 12);
              const right = buffer.readInt32LE(nOff + 16);
              collectSubtreeSurfaces(left, out, depth + 1);
              collectSubtreeSurfaces(right, out, depth + 1);
            };

            const updateNode2d = (nodeIdx: number, axisI: number, axisJ: number, depth = 0) => {
              if (nodeIdx < 0 || nodeIdx >= cNode2dCount || depth > 32) return;
              const nOff = cNode2dBase + nodeIdx * 20;
              const oldPi = buffer.readFloatLE(nOff + 0);
              const oldPj = buffer.readFloatLE(nOff + 4);
              const left = buffer.readInt32LE(nOff + 12);
              const right = buffer.readInt32LE(nOff + 16);
              const leftSurfs = new Set<number>();
              const rightSurfs = new Set<number>();
              collectSubtreeSurfaces(left, leftSurfs, depth + 1);
              collectSubtreeSurfaces(right, rightSurfs, depth + 1);

              // Find an edge shared between leftSurfs and rightSurfs
              for (let e = 0; e < cEdgeCount; e++) {
                const eOff = cEdgeBase + e * 24;
                const ls = buffer.readInt32LE(eOff + 16);
                const rs = buffer.readInt32LE(eOff + 20);
                if ((leftSurfs.has(ls) && rightSurfs.has(rs)) || (leftSurfs.has(rs) && rightSurfs.has(ls))) {
                  const sv = buffer.readInt32LE(eOff + 0);
                  const ev = buffer.readInt32LE(eOff + 4);
                  const svOff = cVertBase + sv * 16;
                  const evOff = cVertBase + ev * 16;
                  const u0 = buffer.readFloatLE(svOff + axisI * 4);
                  const v0 = buffer.readFloatLE(svOff + axisJ * 4);
                  const u1 = buffer.readFloatLE(evOff + axisI * 4);
                  const v1 = buffer.readFloatLE(evOff + axisJ * 4);
                  const du = u1 - u0, dv = v1 - v0;
                  const len = Math.hypot(du, dv);
                  if (len > 1e-6) {
                    let pi = -dv / len;
                    let pj = du / len;
                    if (pi * oldPi + pj * oldPj < 0) {
                      pi = -pi; pj = -pj;
                    }
                    const pd = pi * u0 + pj * v0;
                    buffer.writeFloatLE(pi, nOff + 0);
                    buffer.writeFloatLE(pj, nOff + 4);
                    buffer.writeFloatLE(pd, nOff + 8);
                  }
                  break;
                }
              }
              updateNode2d(left, axisI, axisJ, depth + 1);
              updateNode2d(right, axisI, axisJ, depth + 1);
            };

            for (let r = 0; r < cRef2dCount; r++) {
              const rOff = cRef2dBase + r * 8;
              const rawPlaneDesignator = buffer.readInt32LE(rOff + 0);
              const pIdx = rawPlaneDesignator & 0x7fffffff;
              const isFlipped = (rawPlaneDesignator & -0x80000000) !== 0;
              const topNode = buffer.readInt32LE(rOff + 4);
              if (!affectedPlanes.has(pIdx) || topNode < 0) continue;
              const pOff = cPlaneBase + pIdx * 16;
              const rawA = buffer.readFloatLE(pOff + 0);
              const rawB = buffer.readFloatLE(pOff + 4);
              const rawC = buffer.readFloatLE(pOff + 8);
              const pa = Math.abs(rawA);
              const pb = Math.abs(rawB);
              const pc = Math.abs(rawC);
              // Match OpenCE collision_bsp.c lines 1864-1870 & 2101-2108:
              // projection_sign = (plane->n[proj] > 0) != isFlipped
              let axisI = 0, axisJ = 1;
              if (pc >= pb && pc >= pa) {
                const projSign = (rawC > 0) !== isFlipped;
                axisI = projSign ? 0 : 1;
                axisJ = projSign ? 1 : 0;
              } else if (pb >= pa) {
                const projSign = (rawB > 0) !== isFlipped;
                axisI = projSign ? 2 : 0;
                axisJ = projSign ? 0 : 2;
              } else {
                const projSign = (rawA > 0) !== isFlipped;
                axisI = projSign ? 1 : 2;
                axisJ = projSign ? 2 : 1;
              }
              updateNode2d(topNode, axisI, axisJ, 0);
            }
          }
        }
      }
    }
  }

  return { updatedVertices, updatedCollisionVertices, updatedShaders };
}
