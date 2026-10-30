/**
 * Render-level model geometry extraction (Step 8.2): turns one `gbxmodel` (`mod2`) or Xbox `model` (`mode`)
 * tag into renderable data - interleaved vertices, indexed triangle lists, per-part bounding boxes.
 * Struct fields are decoded with the tag-definition engine, then raw vertex + triangle index bytes are read
 * from the model data region (or indirect Xbox reflexives when `header.engine === 5`).
 */
import { CacheFileEngine } from '../constants/cache-file';
import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { decodeStruct, resolveStruct, resolvePointer } from '../map/definitions/engine';
import type { DecodedFieldValue } from '../map/definitions/engine';
import { unpackCompressedUnitVector32 } from './bsp-geometry';

/**
 * A renderable submesh: one geometry part of the model, with local-space vertices and an
 * indexed triangle list (indices local to the part's own vertex array).
 */
export interface ModelSubmesh {
  partIndex: number;
  shaderIndex: number;
  /** Tag ID of the shader tag referenced by this part (or 0xFFFFFFFF if unshaded). */
  shaderTagId?: number;
  vertexCount: number;
  /** Interleaved [x, y, z, nx, ny, nz, u, v] per vertex, uScale/vScale already applied to UVs. */
  vertices: Float32Array;
  /** Indexed triangle list [v0, v1, v2, ...] (unstripped, degenerate triangles dropped). */
  indices: Uint16Array;
  /** Local bounding box [minX, minY, minZ, maxX, maxY, maxZ] in the part's vertex space. */
  boundingBox: [number, number, number, number, number, number];
}

/**
 * Parsed, renderable 3D geometry for one model tag at one LOD.
 */
export interface ModelRenderGeometry {
  modelTagId: number;
  modelPath: string;
  lodLevel: number;
  uScale: number;
  vScale: number;
  totalVertices: number;
  totalTriangles: number;
  submeshes: ModelSubmesh[];
}

const VERTEX_TYPE_UNCOMPRESSED = 4;
const VERTEX_TYPE_COMPRESSED = 5;
const UNCOMPRESSED_VERTEX_SIZE = 68;
const COMPRESSED_VERTEX_SIZE = 32;
const TRIANGLE_BUFFER_TYPE_STRIP = 1;
const PRIMITIVE_RESTART_INDEX = 0xffff;
const LOD_FIELD_NAMES = ['super low', 'low', 'medium', 'high', 'super high'];

function numeric(value: DecodedFieldValue | undefined): number | undefined {
  if (!value) return undefined;
  if (value.kind === 'basic' || value.kind === 'enum') return value.value as number;
  return undefined;
}

/**
 * Reads a triangle-strip index buffer and unstrips it into an indexed triangle list. The
 * 0xFFFF primitive-restart sentinel may appear mid-buffer (concatenated strips), not just at
 * the end. Produces up to `triangleCount` triangles; degenerate triangles are left in and
 * filtered by the caller, but all are tracked so winding stays in sync with the strip.
 */
function decodeTriangleStrip(
  buffer: Buffer,
  stripFileOffset: number,
  vertexCount: number,
  triangleCount: number,
): Uint16Array {
  const out: number[] = [];
  let produced = 0;
  let n = 0; // valid (non-restart) indices in the current strip
  let a = 0, b = 0; // the strip's (n-2)-th and (n-1)-th indices once n >= 2

  let w = 0;
  while (produced < triangleCount) {
    const readOff = stripFileOffset + w * 2;
    if (readOff + 2 > buffer.length) break;
    const idx = buffer.readUInt16LE(readOff);
    w++;
    if (idx === PRIMITIVE_RESTART_INDEX) {
      n = 0;
      continue;
    }
    if (idx >= vertexCount) break; // out-of-range: never index past this part's own vertices

    if (n === 0) a = idx;
    else if (n === 1) b = idx;
    else {
      // Position n in the strip: odd positions flip winding to keep the strip's orientation
      // consistent as a triangle list (v(n-2), v(n-1), v(n) vs the reverse).
      if (n % 2 === 0) out.push(a, b, idx);
      else out.push(b, a, idx);
      a = b;
      b = idx;
      produced++;
    }
    n++;
  }
  return new Uint16Array(out);
}

/**
 * Extracts the 3D render geometry of one model tag (`gbxmodel`/`mod2` or Xbox `model`/`mode`) at the requested LOD.
 *
 * @param lod 0 = super low .. 4 = super high (default). Chosen via the model's first region's
 *   first permutation; falls back to geometry 0 when the model has no regions/permutations.
 */
export function extractModelRenderGeometry(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  modelTagId: number,
  lod = 4,
): ModelRenderGeometry {
  const entry = tagIndex.entries.find((e) => e.tagId === modelTagId);
  if (!entry) {
    throw new Error(`Model tag (ID: 0x${modelTagId.toString(16)}) not found in tag index.`);
  }

  const isXboxModel =
    header.engine === CacheFileEngine.XBOX ||
    entry.primaryClassFourCC === 0x6d6f6465 ||
    entry.primaryClassName === 'model';

  const rootStructName = isXboxModel ? 'Model' : 'GBXModel';
  const geomStructName = isXboxModel ? 'ModelGeometry' : 'GBXModelGeometry';
  const partStructName = isXboxModel ? 'ModelGeometryPart' : 'GBXModelGeometryPart';

  const modelFileOffset = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  const model = decodeStruct(buffer, modelFileOffset, rootStructName);

  // Base-map UV scaling lives on the model header.
  const uScaleRaw = numeric(model.get('base map u scale'));
  const vScaleRaw = numeric(model.get('base map v scale'));
  const uScale = uScaleRaw && Number.isFinite(uScaleRaw) && uScaleRaw > 0 ? uScaleRaw : 1.0;
  const vScale = vScaleRaw && Number.isFinite(vScaleRaw) && vScaleRaw > 0 ? vScaleRaw : 1.0;

  const geoms = model.get('geometries');
  if (!geoms || geoms.kind !== 'reflexive' || geoms.value.count === 0) {
    throw new Error(`Model "${entry.path}" has no geometries.`);
  }
  const geomSize = resolveStruct(geomStructName).totalSize;
  const partSize = resolveStruct(partStructName).totalSize;

  // --- Pick geometry indices for the requested LOD across all model regions. ---
  const chosenGeomIndices = new Set<number>();
  const regions = model.get('regions');
  if (regions && regions.kind === 'reflexive' && regions.value.count > 0) {
    const regionSize = resolveStruct('ModelRegion').totalSize;
    const regionFileOffset = resolvePointer(
      regions.value.pointerLow,
      header.tagDataOffset,
      tagIndex.baseMemoryAddress,
    );
    for (let r = 0; r < regions.value.count; r++) {
      const region = decodeStruct(buffer, regionFileOffset + r * regionSize, 'ModelRegion');
      const perms = region.get('permutations');
      if (perms && perms.kind === 'reflexive' && perms.value.count > 0) {
        const permFileOffset = resolvePointer(
          perms.value.pointerLow,
          header.tagDataOffset,
          tagIndex.baseMemoryAddress,
        );
        const firstPerm = decodeStruct(buffer, permFileOffset, 'ModelRegionPermutation');
        const lodGeomField = numeric(firstPerm.get(LOD_FIELD_NAMES[lod] ?? 'super high'));
        if (lodGeomField !== undefined && lodGeomField >= 0 && lodGeomField < geoms.value.count) {
          chosenGeomIndices.add(lodGeomField);
        }
      }
    }
  }

  if (chosenGeomIndices.size === 0) {
    chosenGeomIndices.add(0);
  }

  const geomsFileOffset = resolvePointer(geoms.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);

  // Model data region for PC/CE/MCC: vertices at modelDataFileOffset, triangle index words begin at
  // modelDataFileOffset + vertexSize (end of the map's total vertex data).
  const vertexBase = tagIndex.modelDataFileOffset;
  const indexBase = vertexBase + tagIndex.vertexSize;

  const shaderTagIds: number[] = [];
  const shadersReflexive = model.get('shaders');
  if (shadersReflexive && shadersReflexive.kind === 'reflexive' && shadersReflexive.value.count > 0) {
    const shaderRefSize = resolveStruct('ModelShaderReference').totalSize;
    const sOffset = resolvePointer(shadersReflexive.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let s = 0; s < shadersReflexive.value.count; s++) {
      const sStruct = decodeStruct(buffer, sOffset + s * shaderRefSize, 'ModelShaderReference');
      const dep = sStruct.get('shader');
      if (dep && dep.kind === 'dependency' && dep.value.tagId !== 0xffffffff) {
        shaderTagIds.push(dep.value.tagId);
      } else {
        shaderTagIds.push(0xffffffff);
      }
    }
  }

  const submeshes: ModelSubmesh[] = [];
  let totalVertices = 0;
  let totalTriangles = 0;
  let partIndexCounter = 0;

  for (const geomIndex of chosenGeomIndices) {
    const geom = decodeStruct(buffer, geomsFileOffset + geomIndex * geomSize, geomStructName);
    const parts = geom.get('parts');
    if (!parts || parts.kind !== 'reflexive' || parts.value.count === 0) continue;
    const partsFileOffset = resolvePointer(parts.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);

    for (let p = 0; p < parts.value.count; p++) {
      const part = decodeStruct(buffer, partsFileOffset + p * partSize, partStructName);

      const vertexType = numeric(part.get('vertex type')) ?? -1;
      const vertexCount = numeric(part.get('vertex count')) ?? 0;
      const vertexOffset = numeric(part.get('vertex offset')) ?? 0;
      const triangleBufferType = numeric(part.get('triangle buffer type')) ?? -1;
      const triangleCount = numeric(part.get('triangle count')) ?? 0;
      const triangleOffset = numeric(part.get('triangle offset')) ?? 0;
      const shaderIndex = numeric(part.get('shader index')) ?? 0;

      if (vertexCount === 0 || triangleCount === 0) continue;
      if (triangleBufferType !== TRIANGLE_BUFFER_TYPE_STRIP) continue;

      let partVertOffset = 0;
      let partStripOffset = 0;
      const isCompressedVert = vertexType === VERTEX_TYPE_COMPRESSED || isXboxModel;

      if (isXboxModel) {
        // On Xbox, `vertex offset` (+0x64) is a virtual pointer to a 12-byte indirect reflexive in tag data,
        // where +4 holds the virtual pointer to the 32-byte compressed vertices.
        // And `triangle offset` (+0x4C) is the direct virtual pointer to the uint16 triangle strip indices.
        const vertIndirectOff = resolvePointer(vertexOffset, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (vertIndirectOff < 0 || vertIndirectOff + 12 > buffer.length) continue;
        const vertVirtualPtr = buffer.readUInt32LE(vertIndirectOff + 4);
        partVertOffset = resolvePointer(vertVirtualPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
        partStripOffset = resolvePointer(triangleOffset, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (
          partVertOffset < 0 ||
          partVertOffset + vertexCount * COMPRESSED_VERTEX_SIZE > buffer.length ||
          partStripOffset < 0 ||
          partStripOffset >= buffer.length
        ) {
          continue;
        }
      } else {
        if (vertexType !== VERTEX_TYPE_UNCOMPRESSED) continue;
        partVertOffset = vertexBase + vertexOffset;
        const partVertEnd = partVertOffset + vertexCount * UNCOMPRESSED_VERTEX_SIZE;
        if (partVertEnd > header.tagDataOffset) continue;
        partStripOffset = indexBase + triangleOffset;
      }

      const vertices = new Float32Array(vertexCount * 8);

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      if (isCompressedVert) {
        for (let v = 0; v < vertexCount; v++) {
          const vOff = partVertOffset + v * COMPRESSED_VERTEX_SIZE;
          const x = buffer.readFloatLE(vOff + 0x00);
          const y = buffer.readFloatLE(vOff + 0x04);
          const z = buffer.readFloatLE(vOff + 0x08);
          const [nx, ny, nz] = unpackCompressedUnitVector32(buffer.readUInt32LE(vOff + 0x0c));
          const u = (buffer.readInt16LE(vOff + 0x18) / 32767.0) * uScale;
          const vCoord = (buffer.readInt16LE(vOff + 0x1a) / 32767.0) * vScale;

          const o = v * 8;
          vertices[o + 0] = x;
          vertices[o + 1] = y;
          vertices[o + 2] = z;
          vertices[o + 3] = nx;
          vertices[o + 4] = ny;
          vertices[o + 5] = nz;
          vertices[o + 6] = u;
          vertices[o + 7] = vCoord;

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      } else {
        for (let v = 0; v < vertexCount; v++) {
          const vOff = partVertOffset + v * UNCOMPRESSED_VERTEX_SIZE;
          const x = buffer.readFloatLE(vOff + 0x00);
          const y = buffer.readFloatLE(vOff + 0x04);
          const z = buffer.readFloatLE(vOff + 0x08);
          const nx = buffer.readFloatLE(vOff + 0x0c);
          const ny = buffer.readFloatLE(vOff + 0x10);
          const nz = buffer.readFloatLE(vOff + 0x14);
          // Texture coords follow position(12)+normal(12)+binormal(12)+tangent(12) = 0x30.
          const u = buffer.readFloatLE(vOff + 0x30) * uScale;
          const vCoord = buffer.readFloatLE(vOff + 0x34) * vScale;

          const o = v * 8;
          vertices[o + 0] = x;
          vertices[o + 1] = y;
          vertices[o + 2] = z;
          vertices[o + 3] = nx;
          vertices[o + 4] = ny;
          vertices[o + 5] = nz;
          vertices[o + 6] = u;
          vertices[o + 7] = vCoord;

          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }

      // Unstrip, drop degenerate triangles, and orient triangle winding to match stored outward vertex normals
      // so dynamic lighting on vehicles/weapons/equipment never flips normals into dark shadow.
      const raw = decodeTriangleStrip(buffer, partStripOffset, vertexCount, triangleCount);
      const indices: number[] = [];
      for (let t = 0; t + 2 < raw.length; t += 3) {
        const v0 = raw[t], v1 = raw[t + 1], v2 = raw[t + 2];
        if (v0 === v1 || v1 === v2 || v0 === v2) continue;
        const o0 = v0 * 8, o1 = v1 * 8, o2 = v2 * 8;
        const e1x = vertices[o1] - vertices[o0];
        const e1y = vertices[o1 + 1] - vertices[o0 + 1];
        const e1z = vertices[o1 + 2] - vertices[o0 + 2];
        const e2x = vertices[o2] - vertices[o0];
        const e2y = vertices[o2 + 1] - vertices[o0 + 1];
        const e2z = vertices[o2 + 2] - vertices[o0 + 2];
        const fnx = e1y * e2z - e1z * e2y;
        const fny = e1z * e2x - e1x * e2z;
        const fnz = e1x * e2y - e1y * e2x;
        const vnx = vertices[o0 + 3] + vertices[o1 + 3] + vertices[o2 + 3];
        const vny = vertices[o0 + 4] + vertices[o1 + 4] + vertices[o2 + 4];
        const vnz = vertices[o0 + 5] + vertices[o1 + 5] + vertices[o2 + 5];
        if (fnx * vnx + fny * vny + fnz * vnz < 0) {
          indices.push(v0, v2, v1);
        } else {
          indices.push(v0, v1, v2);
        }
      }

      submeshes.push({
        partIndex: partIndexCounter++,
        shaderIndex,
        shaderTagId: shaderTagIds[shaderIndex] ?? 0xffffffff,
        vertexCount,
        vertices,
        indices: new Uint16Array(indices),
        boundingBox: [
          minX === Infinity ? 0 : minX,
          minY === Infinity ? 0 : minY,
          minZ === Infinity ? 0 : minZ,
          maxX === -Infinity ? 0 : maxX,
          maxY === -Infinity ? 0 : maxY,
          maxZ === -Infinity ? 0 : maxZ,
        ],
      });

      totalVertices += vertexCount;
      totalTriangles += indices.length / 3;
    }
  }

  return {
    modelTagId,
    modelPath: entry.path,
    lodLevel: lod,
    uScale,
    vScale,
    totalVertices,
    totalTriangles,
    submeshes,
  };
}

/**
 * Writes modified 3D vertex positions and normals back into a `gbxmodel` (`mod2`) or Xbox `model` (`mode`)
 * vertex buffer in memory.
 */
export function updateModelVerticesInMap(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  modelTagId: number,
  updates: Array<{ partIndex: number; vertices: Float32Array | number[]; shaderTagId?: number }>,
  lod = 4,
): { updatedVertices: number; updatedShaders: number } {
  const entry = tagIndex.entries.find((e) => e.tagId === modelTagId);
  if (!entry) throw new Error(`Model tag 0x${modelTagId.toString(16)} not found.`);

  const isXboxModel =
    header.engine === CacheFileEngine.XBOX ||
    entry.primaryClassFourCC === 0x6d6f6465 ||
    entry.primaryClassName === 'model';

  const rootStructName = isXboxModel ? 'Model' : 'GBXModel';
  const geomStructName = isXboxModel ? 'ModelGeometry' : 'GBXModelGeometry';
  const partStructName = isXboxModel ? 'ModelGeometryPart' : 'GBXModelGeometryPart';

  const modelFileOffset = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  const model = decodeStruct(buffer, modelFileOffset, rootStructName);
  const geoms = model.get('geometries');
  if (!geoms || geoms.kind !== 'reflexive' || geoms.value.count === 0) {
    return { updatedVertices: 0, updatedShaders: 0 };
  }
  const geomSize = resolveStruct(geomStructName).totalSize;
  const partSize = resolveStruct(partStructName).totalSize;

  const rawUScale = numeric(model.get('base map u scale')) ?? 0;
  const rawVScale = numeric(model.get('base map v scale')) ?? 0;
  const uScale = rawUScale === 0 ? 1 : rawUScale;
  const vScale = rawVScale === 0 ? 1 : rawVScale;

  const shadersReflexive = model.get('shaders');
  const shaderRefSize = resolveStruct('ModelShaderReference').totalSize;
  const shadersFileOffset =
    shadersReflexive && shadersReflexive.kind === 'reflexive' && shadersReflexive.value.count > 0
      ? resolvePointer(shadersReflexive.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress)
      : 0;
  const shadersCount = shadersReflexive && shadersReflexive.kind === 'reflexive' ? shadersReflexive.value.count : 0;

  const chosenGeomIndices = new Set<number>();
  const regions = model.get('regions');
  if (regions && regions.kind === 'reflexive' && regions.value.count > 0) {
    const regionSize = resolveStruct('ModelRegion').totalSize;
    const regionFileOffset = resolvePointer(regions.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    for (let r = 0; r < regions.value.count; r++) {
      const region = decodeStruct(buffer, regionFileOffset + r * regionSize, 'ModelRegion');
      const perms = region.get('permutations');
      if (perms && perms.kind === 'reflexive' && perms.value.count > 0) {
        const permFileOffset = resolvePointer(perms.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
        const firstPerm = decodeStruct(buffer, permFileOffset, 'ModelRegionPermutation');
        const lodGeomField = numeric(firstPerm.get(LOD_FIELD_NAMES[lod] ?? 'super high'));
        if (lodGeomField !== undefined && lodGeomField >= 0 && lodGeomField < geoms.value.count) {
          chosenGeomIndices.add(lodGeomField);
        }
      }
    }
  }
  if (chosenGeomIndices.size === 0) chosenGeomIndices.add(0);

  const geomsFileOffset = resolvePointer(geoms.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
  const vertexBase = tagIndex.modelDataFileOffset;
  const indexBase = vertexBase + tagIndex.vertexSize;
  const updateMap = new Map<number, { vertices: Float32Array | number[]; shaderTagId?: number }>();
  for (const u of updates) updateMap.set(u.partIndex, u);

  let partIndexCounter = 0;
  let updatedVertices = 0;
  let updatedShaders = 0;
  const movedVerts: Array<{
    oldX: number;
    oldY: number;
    oldZ: number;
    newX: number;
    newY: number;
    newZ: number;
    nx: number;
    ny: number;
    nz: number;
  }> = [];

  for (const geomIndex of chosenGeomIndices) {
    const geom = decodeStruct(buffer, geomsFileOffset + geomIndex * geomSize, geomStructName);
    const parts = geom.get('parts');
    if (!parts || parts.kind !== 'reflexive' || parts.value.count === 0) continue;
    const partsFileOffset = resolvePointer(parts.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);

    for (let p = 0; p < parts.value.count; p++) {
      const part = decodeStruct(buffer, partsFileOffset + p * partSize, partStructName);
      const vertexType = numeric(part.get('vertex type')) ?? -1;
      const vertexCount = numeric(part.get('vertex count')) ?? 0;
      const vertexOffset = numeric(part.get('vertex offset')) ?? 0;
      const triangleBufferType = numeric(part.get('triangle buffer type')) ?? -1;
      const triangleCount = numeric(part.get('triangle count')) ?? 0;
      const triangleOffset = numeric(part.get('triangle offset')) ?? 0;
      const shaderIndex = numeric(part.get('shader index')) ?? 0;

      if (vertexCount === 0 || triangleCount === 0) continue;
      if (triangleBufferType !== TRIANGLE_BUFFER_TYPE_STRIP) continue;

      let partVertOffset = 0;
      let partStripOffset = 0;
      const isCompressedVert = vertexType === VERTEX_TYPE_COMPRESSED || isXboxModel;
      if (isXboxModel) {
        const vertIndirectOff = resolvePointer(vertexOffset, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (vertIndirectOff < 0 || vertIndirectOff + 12 > buffer.length) continue;
        const vertVirtualPtr = buffer.readUInt32LE(vertIndirectOff + 4);
        partVertOffset = resolvePointer(vertVirtualPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
        partStripOffset = resolvePointer(triangleOffset, header.tagDataOffset, tagIndex.baseMemoryAddress);
      } else {
        if (vertexType !== VERTEX_TYPE_UNCOMPRESSED) continue;
        partVertOffset = vertexBase + vertexOffset;
        partStripOffset = indexBase + triangleOffset;
      }

      const thisPartIdx = partIndexCounter++;
      const upd = updateMap.get(thisPartIdx);
      if (!upd) continue;

      if (
        upd.shaderTagId !== undefined &&
        upd.shaderTagId !== 0xffffffff &&
        shadersFileOffset > 0 &&
        shaderIndex >= 0 &&
        shaderIndex < shadersCount
      ) {
        const sRefOff = shadersFileOffset + shaderIndex * shaderRefSize;
        const shaderEntry = tagIndex.entries.find((e) => e.tagId === upd.shaderTagId);
        if (shaderEntry) {
          const tagArrayAddr = buffer.readUInt32LE(header.tagDataOffset);
          const tagEntryOff = header.tagDataOffset + (tagArrayAddr - tagIndex.baseMemoryAddress) + shaderEntry.index * 32;
          const namePtr = tagEntryOff + 20 <= buffer.length ? buffer.readUInt32LE(tagEntryOff + 16) : 0;
          buffer.writeUInt32LE(shaderEntry.primaryClassFourCC >>> 0, sRefOff + 0);
          buffer.writeUInt32LE(namePtr >>> 0, sRefOff + 4);
          buffer.writeUInt32LE(0, sRefOff + 8);
        }
        buffer.writeUInt32LE(upd.shaderTagId >>> 0, sRefOff + 12);
        updatedShaders++;
      }

      const verts = upd.vertices;

      // Recompute outward Halo Clockwise vertex normals: (v2 - v0) x (v1 - v0)
      const cwNormals = new Float32Array(vertexCount * 3);
      if (partStripOffset > 0 && verts.length >= vertexCount * 8) {
        const raw = decodeTriangleStrip(buffer, partStripOffset, vertexCount, triangleCount);
        for (let t = 0; t + 2 < raw.length; t += 3) {
          const i0 = raw[t]!, i1 = raw[t + 1]!, i2 = raw[t + 2]!;
          if (i0 === i1 || i1 === i2 || i0 === i2) continue;
          if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
          const x0 = verts[i0 * 8 + 0]!, y0 = verts[i0 * 8 + 1]!, z0 = verts[i0 * 8 + 2]!;
          const x1 = verts[i1 * 8 + 0]!, y1 = verts[i1 * 8 + 1]!, z1 = verts[i1 * 8 + 2]!;
          const x2 = verts[i2 * 8 + 0]!, y2 = verts[i2 * 8 + 1]!, z2 = verts[i2 * 8 + 2]!;
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

      const stride = isCompressedVert ? COMPRESSED_VERTEX_SIZE : UNCOMPRESSED_VERTEX_SIZE;
      for (let v = 0; v < vertexCount && v * 8 + 5 < verts.length; v++) {
        const vOff = partVertOffset + v * stride;
        if (vOff + 12 > buffer.length) break;
        const oldX = buffer.readFloatLE(vOff + 0x00);
        const oldY = buffer.readFloatLE(vOff + 0x04);
        const oldZ = buffer.readFloatLE(vOff + 0x08);
        const newX = verts[v * 8 + 0]!;
        const newY = verts[v * 8 + 1]!;
        const newZ = verts[v * 8 + 2]!;
        const nx = cwNormals[v * 3 + 0]!;
        const ny = cwNormals[v * 3 + 1]!;
        const nz = cwNormals[v * 3 + 2]!;
        if (Math.abs(newX - oldX) > 1e-5 || Math.abs(newY - oldY) > 1e-5 || Math.abs(newZ - oldZ) > 1e-5) {
          movedVerts.push({ oldX, oldY, oldZ, newX, newY, newZ, nx, ny, nz });
        }
        buffer.writeFloatLE(newX, vOff + 0x00);
        buffer.writeFloatLE(newY, vOff + 0x04);
        buffer.writeFloatLE(newZ, vOff + 0x08);
        if (!isCompressedVert && vOff + 0x38 <= buffer.length) {
          buffer.writeFloatLE(nx, vOff + 0x0c);
          buffer.writeFloatLE(ny, vOff + 0x10);
          buffer.writeFloatLE(nz, vOff + 0x14);
          // Orthonormal binormal (+0x18) & tangent (+0x24)
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
          buffer.writeFloatLE(bx, vOff + 0x18);
          buffer.writeFloatLE(by, vOff + 0x1c);
          buffer.writeFloatLE(bz, vOff + 0x20);
          buffer.writeFloatLE(tx, vOff + 0x24);
          buffer.writeFloatLE(ty, vOff + 0x28);
          buffer.writeFloatLE(tz, vOff + 0x2c);
          if (v * 8 + 7 < verts.length) {
            buffer.writeFloatLE(verts[v * 8 + 6]! / uScale, vOff + 0x30);
            buffer.writeFloatLE(verts[v * 8 + 7]! / vScale, vOff + 0x34);
          }
        }
        updatedVertices++;
      }
    }
  }

  // Propagate moved vertices to all other LOD geometries in the model so lower LODs match edits
  if (movedVerts.length > 0) {
    for (let geomIndex = 0; geomIndex < geoms.value.count; geomIndex++) {
      if (chosenGeomIndices.has(geomIndex)) continue;
      const geom = decodeStruct(buffer, geomsFileOffset + geomIndex * geomSize, geomStructName);
      const parts = geom.get('parts');
      if (!parts || parts.kind !== 'reflexive' || parts.value.count === 0) continue;
      const partsFileOffset = resolvePointer(parts.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
      for (let p = 0; p < parts.value.count; p++) {
        const part = decodeStruct(buffer, partsFileOffset + p * partSize, partStructName);
        const vertexType = numeric(part.get('vertex type')) ?? -1;
        const vertexCount = numeric(part.get('vertex count')) ?? 0;
        const vertexOffset = numeric(part.get('vertex offset')) ?? 0;
        if (vertexCount === 0) continue;
        let partVertOffset = 0;
        const isCompressedVert = vertexType === VERTEX_TYPE_COMPRESSED || isXboxModel;
        if (isXboxModel) {
          const vertIndirectOff = resolvePointer(vertexOffset, header.tagDataOffset, tagIndex.baseMemoryAddress);
          if (vertIndirectOff < 0 || vertIndirectOff + 12 > buffer.length) continue;
          const vertVirtualPtr = buffer.readUInt32LE(vertIndirectOff + 4);
          partVertOffset = resolvePointer(vertVirtualPtr, header.tagDataOffset, tagIndex.baseMemoryAddress);
        } else {
          if (vertexType !== VERTEX_TYPE_UNCOMPRESSED) continue;
          partVertOffset = vertexBase + vertexOffset;
        }
        const stride = isCompressedVert ? COMPRESSED_VERTEX_SIZE : UNCOMPRESSED_VERTEX_SIZE;
        for (let v = 0; v < vertexCount; v++) {
          const vOff = partVertOffset + v * stride;
          if (vOff + 12 > buffer.length) break;
          const vx = buffer.readFloatLE(vOff + 0x00);
          const vy = buffer.readFloatLE(vOff + 0x04);
          const vz = buffer.readFloatLE(vOff + 0x08);
          let bestDistSq = 0.04;
          let bestMv: (typeof movedVerts)[number] | null = null;
          for (let m = 0; m < movedVerts.length; m++) {
            const mv = movedVerts[m]!;
            const dx = vx - mv.oldX;
            const dy = vy - mv.oldY;
            const dz = vz - mv.oldZ;
            const dSq = dx * dx + dy * dy + dz * dz;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              bestMv = mv;
            }
          }
          if (bestMv) {
            buffer.writeFloatLE(bestMv.newX, vOff + 0x00);
            buffer.writeFloatLE(bestMv.newY, vOff + 0x04);
            buffer.writeFloatLE(bestMv.newZ, vOff + 0x08);
            if (!isCompressedVert && vOff + 24 <= buffer.length) {
              buffer.writeFloatLE(bestMv.nx, vOff + 0x0c);
              buffer.writeFloatLE(bestMv.ny, vOff + 0x10);
              buffer.writeFloatLE(bestMv.nz, vOff + 0x14);
            }
          }
        }
      }
    }
  }

  return { updatedVertices, updatedShaders };
}
