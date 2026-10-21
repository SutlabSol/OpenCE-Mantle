/**
 * 3D Model & Structure BSP Exporter (Milestone 13.3)
 * Supports exporting Halo CE gbxmodel and sbsp geometry to:
 * 1. Wavefront OBJ (.obj + .mtl)
 * 2. glTF 2.0 Binary (.glb)
 *
 * Fully zero-dependency, self-contained, and compliant with Blender / 3ds Max / glTF 2.0 loaders.
 */
import type { ModelRenderGeometry, ModelSubmesh } from './model-geometry';
import type { BspRenderMesh, BspSubmesh } from './bsp-geometry';

export interface ObjExportOptions {
  /** Optional MTL file name referenced in obj `mtllib <filename>`. Defaults to `${name}.mtl`. */
  mtlFileName?: string;
  /** Invert V coordinate (standard for OpenGL/OBJ where (0,0) is bottom-left). Default true. */
  flipV?: boolean;
}

export interface ObjExportResult {
  objText: string;
  mtlText: string;
}

/**
 * Exports a `gbxmodel` geometry to Wavefront OBJ + MTL format.
 */
export function exportModelToObj(geometry: ModelRenderGeometry, options: ObjExportOptions = {}): ObjExportResult {
  const flipV = options.flipV ?? true;
  const mtlName = options.mtlFileName ?? `${geometry.modelPath.split('\\').pop() || 'model'}.mtl`;

  const objLines: string[] = [
    `# OpenCE Mantle - gbxmodel Wavefront OBJ Exporter`,
    `# Model: ${geometry.modelPath} (LOD ${geometry.lodLevel})`,
    `# Total Vertices: ${geometry.totalVertices}, Total Triangles: ${geometry.totalTriangles}`,
    `mtllib ${mtlName}`,
    '',
  ];

  const mtlLines: string[] = [
    `# OpenCE Mantle - Material Library`,
    `# Model: ${geometry.modelPath}`,
    '',
  ];

  const definedMaterials = new Set<string>();
  let vertexOffset = 1; // OBJ is 1-based

  for (let sIdx = 0; sIdx < geometry.submeshes.length; sIdx++) {
    const sub = geometry.submeshes[sIdx];
    const matName = `mat_shader_${sub.shaderTagId !== undefined && sub.shaderTagId !== 0xffffffff ? (sub.shaderTagId >>> 0).toString(16) : `part_${sIdx}`}`;

    if (!definedMaterials.has(matName)) {
      definedMaterials.add(matName);
      mtlLines.push(
        `newmtl ${matName}`,
        `Ka 0.200000 0.200000 0.200000`,
        `Kd 0.800000 0.800000 0.800000`,
        `Ks 0.100000 0.100000 0.100000`,
        `d 1.000000`,
        `illum 2`,
        '',
      );
    }

    objLines.push(`g part_${sub.partIndex}`);
    objLines.push(`usemtl ${matName}`);

    const vertStride = 8;
    for (let v = 0; v < sub.vertexCount; v++) {
      const idx = v * vertStride;
      const x = sub.vertices[idx];
      const y = sub.vertices[idx + 1];
      const z = sub.vertices[idx + 2];
      const nx = sub.vertices[idx + 3];
      const ny = sub.vertices[idx + 4];
      const nz = sub.vertices[idx + 5];
      const u = sub.vertices[idx + 6];
      let uvV = sub.vertices[idx + 7];
      if (flipV) uvV = 1.0 - uvV;

      objLines.push(`v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
      objLines.push(`vn ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
      objLines.push(`vt ${u.toFixed(6)} ${uvV.toFixed(6)}`);
    }

    for (let t = 0; t < sub.indices.length; t += 3) {
      const i0 = vertexOffset + sub.indices[t];
      const i1 = vertexOffset + sub.indices[t + 1];
      const i2 = vertexOffset + sub.indices[t + 2];
      objLines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
    }

    vertexOffset += sub.vertexCount;
    objLines.push('');
  }

  return {
    objText: objLines.join('\n'),
    mtlText: mtlLines.join('\n'),
  };
}

/**
 * Exports a `scenario_structure_bsp` render mesh to Wavefront OBJ + MTL format.
 */
export function exportBspToObj(mesh: BspRenderMesh, options: ObjExportOptions = {}): ObjExportResult {
  const flipV = options.flipV ?? true;
  const bspLabel = mesh.bspNames?.[mesh.bspIndex] || `bsp_${mesh.bspIndex}`;
  const mtlName = options.mtlFileName ?? `${bspLabel.split('\\').pop() || 'bsp'}.mtl`;

  const objLines: string[] = [
    `# OpenCE Mantle - Structure BSP Wavefront OBJ Exporter`,
    `# BSP: ${bspLabel} (Index ${mesh.bspIndex})`,
    `# Total Vertices: ${mesh.totalVertices}, Total Triangles: ${mesh.totalTriangles}`,
    `mtllib ${mtlName}`,
    '',
  ];

  const mtlLines: string[] = [
    `# OpenCE Mantle - Material Library`,
    `# BSP: ${bspLabel}`,
    '',
  ];

  const definedMaterials = new Set<string>();
  let vertexOffset = 1;

  for (let sIdx = 0; sIdx < mesh.submeshes.length; sIdx++) {
    const sub = mesh.submeshes[sIdx];
    const matName = `mat_shader_${sub.shaderTagId !== 0xffffffff ? (sub.shaderTagId >>> 0).toString(16) : `submesh_${sIdx}`}`;

    if (!definedMaterials.has(matName)) {
      definedMaterials.add(matName);
      mtlLines.push(
        `newmtl ${matName}`,
        `Ka 0.200000 0.200000 0.200000`,
        `Kd 0.800000 0.800000 0.800000`,
        `Ks 0.050000 0.050000 0.050000`,
        `d 1.000000`,
        `illum 2`,
        '',
      );
    }

    objLines.push(`g submesh_${sub.submeshIndex}_lightmap_${sub.lightmapIndex}`);
    objLines.push(`usemtl ${matName}`);

    const vertStride = 8;
    for (let v = 0; v < sub.vertexCount; v++) {
      const idx = v * vertStride;
      const x = sub.vertices[idx];
      const y = sub.vertices[idx + 1];
      const z = sub.vertices[idx + 2];
      const nx = sub.vertices[idx + 3];
      const ny = sub.vertices[idx + 4];
      const nz = sub.vertices[idx + 5];
      const u = sub.vertices[idx + 6];
      let uvV = sub.vertices[idx + 7];
      if (flipV) uvV = 1.0 - uvV;

      objLines.push(`v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
      objLines.push(`vn ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
      objLines.push(`vt ${u.toFixed(6)} ${uvV.toFixed(6)}`);
    }

    for (let t = 0; t < sub.indices.length; t += 3) {
      const i0 = vertexOffset + sub.indices[t];
      const i1 = vertexOffset + sub.indices[t + 1];
      const i2 = vertexOffset + sub.indices[t + 2];
      objLines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
    }

    vertexOffset += sub.vertexCount;
    objLines.push('');
  }

  return {
    objText: objLines.join('\n'),
    mtlText: mtlLines.join('\n'),
  };
}

/* --------------------------------- glTF 2.0 Binary (.glb) Exporter --------------------------------- */

interface GlbGeometrySubmesh {
  vertexCount: number;
  vertices: Float32Array; // [x, y, z, nx, ny, nz, u, v]
  indices: Uint16Array | Uint32Array;
  shaderTagId?: number;
  name?: string;
}

/**
 * Internal binary writer for packing submeshes into a glTF 2.0 .glb container.
 */
function buildGlbBinary(modelName: string, submeshes: GlbGeometrySubmesh[]): Uint8Array {
  // We'll collect all binary data into a single Uint8Array buffer
  // For each submesh:
  // - Position buffer (vec3 float32): vertexCount * 12 bytes
  // - Normal buffer (vec3 float32): vertexCount * 12 bytes
  // - Texcoord buffer (vec2 float32): vertexCount * 8 bytes
  // - Indices buffer (scalar uint16 or uint32): indices.length * bytesPerIndex
  // All bufferViews must be aligned to 4-byte boundaries.

  const bufferChunks: Uint8Array[] = [];
  let currentOffset = 0;

  const accessors: any[] = [];
  const bufferViews: any[] = [];
  const materials: any[] = [];
  const primitives: any[] = [];

  const matMap = new Map<number, number>();

  for (let s = 0; s < submeshes.length; s++) {
    const sub = submeshes[s];
    if (sub.vertexCount === 0 || sub.indices.length === 0) continue;

    // Materials
    const tagId = sub.shaderTagId ?? 0xffffffff;
    let matIndex: number;
    if (matMap.has(tagId)) {
      matIndex = matMap.get(tagId)!;
    } else {
      matIndex = materials.length;
      materials.push({
        name: `shader_${tagId !== 0xffffffff ? (tagId >>> 0).toString(16) : `part_${s}`}`,
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.8, 0.8, 1.0],
          metallicFactor: 0.1,
          roughnessFactor: 0.8,
        },
        doubleSided: true,
      });
      matMap.set(tagId, matIndex);
    }

    // Deinterleave vertices:
    // Halo coordinates: +X forward, +Y left, +Z up
    // glTF coordinates: +X right, +Y up, +Z forward (-Z forward)
    // To preserve Halo coordinates directly in glTF (or standard view), we export [x, y, z]
    const positions = new Float32Array(sub.vertexCount * 3);
    const normals = new Float32Array(sub.vertexCount * 3);
    const uvs = new Float32Array(sub.vertexCount * 2);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let v = 0; v < sub.vertexCount; v++) {
      const srcIdx = v * 8;
      const x = sub.vertices[srcIdx];
      const y = sub.vertices[srcIdx + 1];
      const z = sub.vertices[srcIdx + 2];
      const nx = sub.vertices[srcIdx + 3];
      const ny = sub.vertices[srcIdx + 4];
      const nz = sub.vertices[srcIdx + 5];
      const u = sub.vertices[srcIdx + 6];
      const uvV = sub.vertices[srcIdx + 7];

      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;

      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;

      uvs[v * 2] = u;
      uvs[v * 2 + 1] = uvV;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    // Align helper
    const align4 = (bytes: Uint8Array): Uint8Array => {
      const rem = bytes.byteLength % 4;
      if (rem === 0) return bytes;
      const padded = new Uint8Array(bytes.byteLength + (4 - rem));
      padded.set(bytes);
      return padded;
    };

    // 1. POSITION bufferView & accessor
    const posBytes = align4(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength));
    const posViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: positions.byteLength,
      target: 34962, // ARRAY_BUFFER
    });
    bufferChunks.push(posBytes);
    currentOffset += posBytes.byteLength;

    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: sub.vertexCount,
      type: 'VEC3',
      max: [maxX, maxY, maxZ],
      min: [minX, minY, minZ],
    });

    // 2. NORMAL bufferView & accessor
    const normBytes = align4(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength));
    const normViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: normals.byteLength,
      target: 34962, // ARRAY_BUFFER
    });
    bufferChunks.push(normBytes);
    currentOffset += normBytes.byteLength;

    const normAccIdx = accessors.length;
    accessors.push({
      bufferView: normViewIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: sub.vertexCount,
      type: 'VEC3',
    });

    // 3. TEXCOORD_0 bufferView & accessor
    const uvBytes = align4(new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength));
    const uvViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: uvs.byteLength,
      target: 34962, // ARRAY_BUFFER
    });
    bufferChunks.push(uvBytes);
    currentOffset += uvBytes.byteLength;

    const uvAccIdx = accessors.length;
    accessors.push({
      bufferView: uvViewIdx,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: sub.vertexCount,
      type: 'VEC2',
    });

    // 4. INDICES bufferView & accessor
    const is32Bit = sub.vertexCount > 65535;
    const indicesTyped = is32Bit
      ? sub.indices instanceof Uint32Array
        ? sub.indices
        : new Uint32Array(sub.indices)
      : sub.indices instanceof Uint16Array
        ? sub.indices
        : new Uint16Array(sub.indices);

    const indexBytes = align4(new Uint8Array(indicesTyped.buffer, indicesTyped.byteOffset, indicesTyped.byteLength));
    const idxViewIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: currentOffset,
      byteLength: indicesTyped.byteLength,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });
    bufferChunks.push(indexBytes);
    currentOffset += indexBytes.byteLength;

    const idxAccIdx = accessors.length;
    accessors.push({
      bufferView: idxViewIdx,
      byteOffset: 0,
      componentType: is32Bit ? 5125 : 5123, // UNSIGNED_INT (5125) or UNSIGNED_SHORT (5123)
      count: sub.indices.length,
      type: 'SCALAR',
    });

    // Primitive definition
    primitives.push({
      attributes: {
        POSITION: posAccIdx,
        NORMAL: normAccIdx,
        TEXCOORD_0: uvAccIdx,
      },
      indices: idxAccIdx,
      material: matIndex,
      mode: 4, // TRIANGLES
    });
  }

  // Concatenate binary buffer
  const binBuffer = new Uint8Array(currentOffset);
  let writePtr = 0;
  for (const chunk of bufferChunks) {
    binBuffer.set(chunk, writePtr);
    writePtr += chunk.byteLength;
  }

  // Build JSON structure
  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'OpenCE Mantle glTF 2.0 Exporter',
    },
    scene: 0,
    scenes: [
      {
        name: 'Scene',
        nodes: [0],
      },
    ],
    nodes: [
      {
        name: modelName,
        mesh: 0,
      },
    ],
    meshes: [
      {
        name: modelName,
        primitives,
      },
    ],
    materials,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: binBuffer.byteLength,
      },
    ],
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  // JSON chunk must be padded with 0x20 (ASCII space) to 4-byte alignment
  const jsonPadding = (4 - (jsonBuf.byteLength % 4)) % 4;
  const jsonChunkLength = jsonBuf.byteLength + jsonPadding;

  // BIN chunk must be padded with 0x00 to 4-byte alignment
  const binPadding = (4 - (binBuffer.byteLength % 4)) % 4;
  const binChunkLength = binBuffer.byteLength + binPadding;

  // Total GLB size: 12-byte header + 8-byte JSON chunk header + jsonChunkLength + 8-byte BIN chunk header + binChunkLength
  const totalGlbLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const glb = Buffer.alloc(totalGlbLength);
  let p = 0;

  // GLB Header
  glb.writeUInt32LE(0x46546c67, p); // "glTF"
  p += 4;
  glb.writeUInt32LE(2, p); // version 2
  p += 4;
  glb.writeUInt32LE(totalGlbLength, p); // total length
  p += 4;

  // Chunk 0: JSON
  glb.writeUInt32LE(jsonChunkLength, p);
  p += 4;
  glb.writeUInt32LE(0x4e4f534a, p); // "JSON"
  p += 4;
  jsonBuf.copy(glb, p);
  p += jsonBuf.byteLength;
  for (let i = 0; i < jsonPadding; i++) {
    glb.writeUInt8(0x20, p++); // space padding
  }

  // Chunk 1: BIN
  glb.writeUInt32LE(binChunkLength, p);
  p += 4;
  glb.writeUInt32LE(0x004e4942, p); // "BIN\0"
  p += 4;
  Buffer.from(binBuffer.buffer, binBuffer.byteOffset, binBuffer.byteLength).copy(glb, p);
  p += binBuffer.byteLength;
  for (let i = 0; i < binPadding; i++) {
    glb.writeUInt8(0x00, p++); // null padding
  }

  return new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength);
}

/**
 * Exports a `gbxmodel` geometry to glTF 2.0 Binary (.glb) format.
 */
export function exportModelToGlb(geometry: ModelRenderGeometry): Uint8Array {
  const submeshes: GlbGeometrySubmesh[] = geometry.submeshes.map((s) => ({
    vertexCount: s.vertexCount,
    vertices: s.vertices,
    indices: s.indices,
    shaderTagId: s.shaderTagId,
    name: `part_${s.partIndex}`,
  }));

  const name = geometry.modelPath.split('\\').pop() || 'model';
  return buildGlbBinary(name, submeshes);
}

/**
 * Exports a `scenario_structure_bsp` render mesh to glTF 2.0 Binary (.glb) format.
 */
export function exportBspToGlb(mesh: BspRenderMesh): Uint8Array {
  const submeshes: GlbGeometrySubmesh[] = mesh.submeshes.map((s) => ({
    vertexCount: s.vertexCount,
    vertices: s.vertices,
    indices: s.indices,
    shaderTagId: s.shaderTagId,
    name: `submesh_${s.submeshIndex}`,
  }));

  const label = mesh.bspNames?.[mesh.bspIndex] || `bsp_${mesh.bspIndex}`;
  const name = label.split('\\').pop() || 'bsp';
  return buildGlbBinary(name, submeshes);
}
