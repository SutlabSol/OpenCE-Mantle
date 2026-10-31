/**
 * Custom 3D Object Tag Compiler, UV Unwrapper, and Collision Model BSP Generator for Halo CE.
 * Compiles Wavefront .OBJ meshes + .PNG/.DDS textures directly into Halo CE tags:
 *   - bitmap (bitm)
 *   - shader_model (soso)
 *   - gbxmodel (mod2)
 *   - model_collision_geometry (coll)
 *   - scenery (scen) / weapon (weap) / vehicle (vehi) / equipment (eqip)
 * without requiring Blender or HEK tool.exe.
 */

import { fourCCFromString, fourCCToString, NULL_TAG_ID } from '../constants/tag-classes';
import { resolveStruct, decodeStruct, isRangeInBuffer } from '../map/definitions/engine';
import {
  childFieldPath,
  reflexiveElementPath,
  isRelocatedTagDataField,
  type ExtractedDependencyRef,
  type ExtractedEmbeddedAsset,
  type ExtractedEmbeddedPatch,
  type ExtractedTag,
  type ExtractedTagSet,
} from '../map/tag-extractor';
import type { CapturedGbxmodelPart } from '../map/gbxmodel-geometry';
import { serializeContainer, deserializeContainer, type OceContainer } from '../map/container';
import { BitmapFormat } from './bitmap-textures';
import { encodeBitmapWithMipmaps, encodeRgbaToPng } from './bitmap-codec';
import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { resolveTagDataPointer } from '../map/tag-index';
import { auditMeshIntegrity, type MeshIntegrityReview } from './mesh-integrity';

export type CustomObjectTagGroup = 'scenery' | 'weapon' | 'vehicle' | 'equipment';

export type CustomObjectCollisionMode = 'auto' | 'exact' | 'box';

export type CustomObjectUvUnwrapMode = 'box' | 'per_triangle' | 'smart';

export interface CollisionCompilationStats {
  mode: CustomObjectCollisionMode;
  inputTriangles: number;
  weldedVertices: number;
  decimatedTriangles: number;
  mergedSurfaces: number;
  planes: number;
  edges: number;
  bsp3dNodes: number;
  bsp2dNodes: number;
  isConcave: boolean;
}

export interface ObjParseOptions {
  /** Uniform scale multiplier applied to vertex positions (default: 1.0). */
  scale?: number;
  /** Convert Y-up OBJ coordinates to Halo Z-up: (x, y, z) -> (x, -z, y). */
  flipYz?: boolean;
  /** Center X/Y around 0 and place bottom at Z=0. */
  centerOrigin?: boolean;
  /** Automatically unwrap UVs when the OBJ has no vt coordinates (or when forced). */
  forceAutoUv?: boolean;
  /** UV unwrap algorithm to use when auto-unwrapping ('box' | 'per_triangle' | 'smart'). */
  uvUnwrapMode?: CustomObjectUvUnwrapMode;
  /** Collision mode ('exact' = 1:1 triangle copy, 'auto' = weld/coplanar merge/QEM decimate, 'box' = 6-plane box). */
  collisionMode?: CustomObjectCollisionMode;
  /** Target maximum face budget for automatic QEM collision decimation (default: 4096). */
  targetCollisionFaces?: number;
}

export interface ObjMeshSummary {
  vertexCount: number;
  triangleCount: number;
  uvCoordCount: number;
  normalCount: number;
  hasUvCoordinates: boolean;
  hasNormals: boolean;
  /** Blender / Wavefront `usemtl` material slot names found in the OBJ (defaults to `['default']`). */
  materialSlots: string[];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    radius: number;
  };
  isTooComplex: boolean;
  message: string;
  collisionPreview?: CollisionCompilationStats;
  /** Quantized coordinate edge-graph & T-junction topology review. */
  meshIntegrity?: MeshIntegrityReview;
}

export interface CompiledModelVertex {
  position: [number, number, number];
  normal: [number, number, number];
  binormal: [number, number, number];
  tangent: [number, number, number];
  uv: [number, number];
  node0Index: number;
  node1Index: number;
  node0Weight: number;
  node1Weight: number;
}

export interface RawCollisionTriangle {
  v0: number;
  v1: number;
  v2: number;
  materialSlotIndex: number;
  groupId: number;
}

export interface ParsedObjMesh {
  summary: ObjMeshSummary;
  vertices: CompiledModelVertex[];
  triangles: [number, number, number][];
  /** Raw 3D vertex positions (without UV/normal split duplicates) for topological 3D collision BSP compilation. */
  rawPositions: [number, number, number][];
  /** Raw triangle index triples into `rawPositions` + `usemtl` slot index. */
  rawFaces: RawCollisionTriangle[];
  /** `usemtl` material slot index for each triangle in `triangles`. */
  triangleMaterialSlots: number[];
  usedAutoUv: boolean;
  groupBounds: { min: [number, number, number]; max: [number, number, number] }[];
}

function normalizeVec3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  if (len < 1e-8) return [0, 0, 1];
  return [x / len, y / len, z / len];
}

function computeOrthonormalBasis(
  nx: number,
  ny: number,
  nz: number,
): { binormal: [number, number, number]; tangent: [number, number, number] } {
  // Choose a reference axis not parallel to n
  const ref: [number, number, number] = Math.abs(nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  // tangent = normalize(cross(ref, n))
  const tx = ref[1] * nz - ref[2] * ny;
  const ty = ref[2] * nx - ref[0] * nz;
  const tz = ref[0] * ny - ref[1] * nx;
  const tangent = normalizeVec3(tx, ty, tz);
  // binormal = normalize(cross(n, tangent))
  const bx = ny * tangent[2] - nz * tangent[1];
  const by = nz * tangent[0] - nx * tangent[2];
  const bz = nx * tangent[1] - ny * tangent[0];
  const binormal = normalizeVec3(bx, by, bz);
  return { binormal, tangent };
}

/**
 * Projects a 3D triangle onto a 3x2 6-face Box UV Atlas based on its dominant normal axis.
 * Grid layout (3 columns x 2 rows):
 *   Row 0: [ +X (0), -X (1), +Y (2) ]
 *   Row 1: [ -Y (3), +Z (4), -Z (5) ]
 */
function projectBoxAtlasUv(
  pos: [number, number, number],
  faceNormal: [number, number, number],
  minBounds: [number, number, number],
  maxBounds: [number, number, number],
): [number, number] {
  const [nx, ny, nz] = faceNormal;
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);

  const dx = Math.max(0.001, maxBounds[0] - minBounds[0]);
  const dy = Math.max(0.001, maxBounds[1] - minBounds[1]);
  const dz = Math.max(0.001, maxBounds[2] - minBounds[2]);

  const normX = (pos[0] - minBounds[0]) / dx;
  const normY = (pos[1] - minBounds[1]) / dy;
  const normZ = (pos[2] - minBounds[2]) / dz;

  let cellIndex = 0;
  let localU = 0.5;
  let localV = 0.5;

  if (ax >= ay && ax >= az) {
    if (nx >= 0) {
      cellIndex = 0; // +X
      localU = normY;
      localV = 1 - normZ;
    } else {
      cellIndex = 1; // -X
      localU = 1 - normY;
      localV = 1 - normZ;
    }
  } else if (ay >= ax && ay >= az) {
    if (ny >= 0) {
      cellIndex = 2; // +Y
      localU = 1 - normX;
      localV = 1 - normZ;
    } else {
      cellIndex = 3; // -Y
      localU = normX;
      localV = 1 - normZ;
    }
  } else {
    if (nz >= 0) {
      cellIndex = 4; // +Z (Top)
      localU = normX;
      localV = 1 - normY;
    } else {
      cellIndex = 5; // -Z (Bottom)
      localU = normX;
      localV = normY;
    }
  }

  const col = cellIndex % 3;
  const row = Math.floor(cellIndex / 3);
  const pad = 0.04;
  const uInCell = pad + Math.max(0, Math.min(1, localU)) * (1 - 2 * pad);
  const vInCell = pad + Math.max(0, Math.min(1, localV)) * (1 - 2 * pad);

  return [(col + uInCell) / 3, (row + vInCell) / 2];
}

/**
 * Unwraps every triangle into its own dedicated, non-overlapping grid cell in sequential order (`0..N-1`).
 * Each triangle is projected into its local 2D plane and fitted inside its assigned cell with padding.
 */
function computePerTriangleGridUvs(
  rawPositions: [number, number, number][],
  triVertexIndices: [number, number, number][],
): [[number, number], [number, number], [number, number]][] {
  const numTris = Math.max(1, triVertexIndices.length);
  const gridCols = Math.max(1, Math.ceil(Math.sqrt(numTris)));
  const gridRows = Math.max(1, Math.ceil(numTris / gridCols));
  const pad = 0.1;
  const innerSpan = 1 - 2 * pad;
  const result: [[number, number], [number, number], [number, number]][] = [];

  for (let t = 0; t < triVertexIndices.length; t++) {
    const [v0, v1, v2] = triVertexIndices[t];
    const p0 = rawPositions[v0] ?? [0, 0, 0];
    const p1 = rawPositions[v1] ?? [0, 0, 0];
    const p2 = rawPositions[v2] ?? [0, 0, 0];

    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
    const uAxis = normalizeVec3(e1x, e1y, e1z);
    const faceN = normalizeVec3(
      e1y * e2z - e1z * e2y,
      e1z * e2x - e1x * e2z,
      e1x * e2y - e1y * e2x,
    );
    const vAxis = normalizeVec3(
      faceN[1] * uAxis[2] - faceN[2] * uAxis[1],
      faceN[2] * uAxis[0] - faceN[0] * uAxis[2],
      faceN[0] * uAxis[1] - faceN[1] * uAxis[0],
    );

    const pts2d: [number, number][] = [p0, p1, p2].map((p) => {
      const dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
      return [
        dx * uAxis[0] + dy * uAxis[1] + dz * uAxis[2],
        dx * vAxis[0] + dy * vAxis[1] + dz * vAxis[2],
      ];
    });

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [u, v] of pts2d) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const span = Math.max(1e-5, maxU - minU, maxV - minV);
    const col = t % gridCols;
    const row = Math.floor(t / gridCols);

    const triUvs = pts2d.map(([u, v]): [number, number] => {
      const normU = (u - minU) / span;
      const normV = 1 - (v - minV) / span;
      const cellU = pad + Math.max(0, Math.min(1, normU)) * innerSpan;
      const cellV = pad + Math.max(0, Math.min(1, normV)) * innerSpan;
      return [(col + cellU) / gridCols, (row + cellV) / gridRows];
    }) as [[number, number], [number, number], [number, number]];

    result.push(triUvs);
  }

  return result;
}

/**
 * Smart Angle-Based UV Unwrap (Blender "Smart UV Project" style):
 * Groups adjacent triangles whose normals are within ~48 degrees into planar UV islands,
 * projects each island onto its average normal tangent plane, and packs all islands into [0, 1] UV space.
 */
function computeSmartAngleUvs(
  rawPositions: [number, number, number][],
  triVertexIndices: [number, number, number][],
): [[number, number], [number, number], [number, number]][] {
  const numTris = triVertexIndices.length;
  if (numTris === 0) return [];

  const faceNormals: [number, number, number][] = [];
  const faceAreas: number[] = [];
  const edgeToTris = new Map<string, number[]>();

  const addEdge = (a: number, b: number, triIdx: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const list = edgeToTris.get(key);
    if (list) list.push(triIdx);
    else edgeToTris.set(key, [triIdx]);
  };

  for (let t = 0; t < numTris; t++) {
    const [v0, v1, v2] = triVertexIndices[t];
    const p0 = rawPositions[v0] ?? [0, 0, 0];
    const p1 = rawPositions[v1] ?? [0, 0, 0];
    const p2 = rawPositions[v2] ?? [0, 0, 0];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area2 = Math.hypot(cx, cy, cz);
    faceAreas.push(Math.max(1e-6, area2 * 0.5));
    faceNormals.push(normalizeVec3(cx, cy, cz));
    addEdge(v0, v1, t);
    addEdge(v1, v2, t);
    addEdge(v2, v0, t);
  }

  // Group adjacent faces by normal angle threshold (cos(48 deg) ~= 0.669)
  const visited = new Uint8Array(numTris);
  const islands: number[][] = [];
  const angleThresholdCos = Math.cos((48 * Math.PI) / 180);

  for (let seed = 0; seed < numTris; seed++) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const island = [seed];
    let avgNx = faceNormals[seed][0] * faceAreas[seed];
    let avgNy = faceNormals[seed][1] * faceAreas[seed];
    let avgNz = faceNormals[seed][2] * faceAreas[seed];

    const queue = [seed];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const [v0, v1, v2] = triVertexIndices[curr];
      const nCurr = faceNormals[curr];
      const curAvg = normalizeVec3(avgNx, avgNy, avgNz);

      for (const [a, b] of [
        [v0, v1],
        [v1, v2],
        [v2, v0],
      ]) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const neighbors = edgeToTris.get(key) ?? [];
        for (const nb of neighbors) {
          if (visited[nb]) continue;
          const nNb = faceNormals[nb];
          const dotAdj = nCurr[0] * nNb[0] + nCurr[1] * nNb[1] + nCurr[2] * nNb[2];
          const dotIsland = curAvg[0] * nNb[0] + curAvg[1] * nNb[1] + curAvg[2] * nNb[2];
          if (dotAdj >= angleThresholdCos && dotIsland >= 0.5) {
            visited[nb] = 1;
            island.push(nb);
            avgNx += nNb[0] * faceAreas[nb];
            avgNy += nNb[1] * faceAreas[nb];
            avgNz += nNb[2] * faceAreas[nb];
            queue.push(nb);
          }
        }
      }
    }
    islands.push(island);
  }

  // Project each island onto its average normal's tangent plane
  interface ProjectedIsland {
    tris: number[];
    localUvs: [[number, number], [number, number], [number, number]][];
    width: number;
    height: number;
    placedX: number;
    placedY: number;
  }

  const projIslands: ProjectedIsland[] = islands.map((tris) => {
    let nx = 0, ny = 0, nz = 0;
    for (const t of tris) {
      nx += faceNormals[t][0] * faceAreas[t];
      ny += faceNormals[t][1] * faceAreas[t];
      nz += faceNormals[t][2] * faceAreas[t];
    }
    const avgN = normalizeVec3(nx, ny, nz);
    const { tangent: uAxis, binormal: vAxis } = computeOrthonormalBasis(avgN[0], avgN[1], avgN[2]);

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const raw2d: [[number, number], [number, number], [number, number]][] = [];

    for (const t of tris) {
      const [v0, v1, v2] = triVertexIndices[t];
      const triPts = [rawPositions[v0], rawPositions[v1], rawPositions[v2]].map((p): [number, number] => {
        const u = p[0] * uAxis[0] + p[1] * uAxis[1] + p[2] * uAxis[2];
        const v = -(p[0] * vAxis[0] + p[1] * vAxis[1] + p[2] * vAxis[2]);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        return [u, v];
      }) as [[number, number], [number, number], [number, number]];
      raw2d.push(triPts);
    }

    const w = Math.max(1e-4, maxU - minU);
    const h = Math.max(1e-4, maxV - minV);
    const localUvs = raw2d.map((triPts) =>
      triPts.map(([u, v]): [number, number] => [u - minU, v - minV]) as [[number, number], [number, number], [number, number]],
    );

    return { tris, localUvs, width: w, height: h, placedX: 0, placedY: 0 };
  });

  // Sort islands by height descending for shelf bin packing
  const sortedOrder = projIslands.map((_, i) => i).sort((a, b) => projIslands[b].height - projIslands[a].height);
  let totalArea = 0;
  let maxIslandWidth = 1e-4;
  for (const isl of projIslands) {
    totalArea += isl.width * isl.height;
    if (isl.width > maxIslandWidth) maxIslandWidth = isl.width;
  }

  const margin = Math.max(1e-4, Math.sqrt(totalArea) * 0.025);
  const targetAtlasWidth = Math.max(maxIslandWidth + 2 * margin, Math.sqrt(totalArea * 1.35) + margin * 4);

  let cursorX = margin;
  let cursorY = margin;
  let shelfHeight = 0;
  let usedMaxX = targetAtlasWidth;
  let usedMaxY = margin;

  for (const idx of sortedOrder) {
    const isl = projIslands[idx];
    if (cursorX + isl.width + margin > targetAtlasWidth && cursorX > margin) {
      cursorX = margin;
      cursorY += shelfHeight + margin;
      shelfHeight = 0;
    }
    isl.placedX = cursorX;
    isl.placedY = cursorY;
    cursorX += isl.width + margin;
    if (cursorX > usedMaxX) usedMaxX = cursorX;
    if (isl.height > shelfHeight) shelfHeight = isl.height;
    if (cursorY + isl.height + margin > usedMaxY) usedMaxY = cursorY + isl.height + margin;
  }

  const atlasSpan = Math.max(1e-4, usedMaxX, usedMaxY);
  const result = new Array<[[number, number], [number, number], [number, number]]>(numTris);

  for (const isl of projIslands) {
    for (let i = 0; i < isl.tris.length; i++) {
      const t = isl.tris[i];
      const [c0, c1, c2] = isl.localUvs[i];
      result[t] = [
        [Math.max(0.002, Math.min(0.998, (isl.placedX + c0[0]) / atlasSpan)), Math.max(0.002, Math.min(0.998, (isl.placedY + c0[1]) / atlasSpan))],
        [Math.max(0.002, Math.min(0.998, (isl.placedX + c1[0]) / atlasSpan)), Math.max(0.002, Math.min(0.998, (isl.placedY + c1[1]) / atlasSpan))],
        [Math.max(0.002, Math.min(0.998, (isl.placedX + c2[0]) / atlasSpan)), Math.max(0.002, Math.min(0.998, (isl.placedY + c2[1]) / atlasSpan))],
      ];
    }
  }

  return result;
}

/**
 * Parses and analyzes a Wavefront OBJ text string, computing bounds, normals, and UVs.
 */
export function parseObjMesh(objText: string, options: ObjParseOptions = {}): ParsedObjMesh {
  const scale = options.scale && Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 1.0;
  const flipYz = Boolean(options.flipYz);
  const centerOrigin = Boolean(options.centerOrigin);

  const lines = objText.split(/\r?\n/);
  const rawPositions: [number, number, number][] = [];
  const rawUvs: [number, number][] = [];
  const rawNormals: [number, number, number][] = [];

  interface RawFaceCorner {
    vIdx: number;
    vtIdx: number;
    vnIdx: number;
  }
  interface RawTriangle {
    corners: [RawFaceCorner, RawFaceCorner, RawFaceCorner];
    groupId: number;
    materialSlotIndex: number;
  }
  const rawTriangles: RawTriangle[] = [];
  const materialSlots: string[] = [];
  const materialSlotMap = new Map<string, number>();
  let currentGroupId = 0;
  let currentMaterialSlotIndex = 0;

  const getOrCreateMaterialSlot = (name: string): number => {
    const clean = name.trim() || 'default';
    const existing = materialSlotMap.get(clean);
    if (existing !== undefined) return existing;
    const idx = materialSlots.length;
    materialSlots.push(clean);
    materialSlotMap.set(clean, idx);
    return idx;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    const prefix = parts[0].toLowerCase();

    if (prefix === 'g' || prefix === 'o') {
      if (rawTriangles.length > 0) currentGroupId++;
    } else if (prefix === 'usemtl') {
      const matName = trimmed.slice(6).trim() || 'default';
      currentMaterialSlotIndex = getOrCreateMaterialSlot(matName);
    } else if (prefix === 'v') {
      const rx = (parseFloat(parts[1]) || 0) * scale;
      const ry = (parseFloat(parts[2]) || 0) * scale;
      const rz = (parseFloat(parts[3]) || 0) * scale;
      const pos: [number, number, number] = flipYz ? [rx, -rz, ry] : [rx, ry, rz];
      rawPositions.push(pos);
    } else if (prefix === 'vt') {
      const u = parseFloat(parts[1]) || 0;
      const v = parseFloat(parts[2]) || 0;
      // OBJ V is bottom-to-top; Direct3D/Halo CE V is top-to-bottom (1 - v)
      rawUvs.push([u, 1 - v]);
    } else if (prefix === 'vn') {
      const nx = parseFloat(parts[1]) || 0;
      const ny = parseFloat(parts[2]) || 0;
      const nz = parseFloat(parts[3]) || 0;
      const norm: [number, number, number] = flipYz
        ? normalizeVec3(nx, -nz, ny)
        : normalizeVec3(nx, ny, nz);
      rawNormals.push(norm);
    } else if (prefix === 'f') {
      if (materialSlots.length === 0) {
        currentMaterialSlotIndex = getOrCreateMaterialSlot('default');
      }
      const corners: RawFaceCorner[] = [];
      for (let i = 1; i < parts.length; i++) {
        const segs = parts[i].split('/');
        const vRaw = parseInt(segs[0], 10);
        if (isNaN(vRaw)) continue;
        const vIdx = vRaw > 0 ? vRaw - 1 : rawPositions.length + vRaw;

        let vtIdx = -1;
        if (segs.length > 1 && segs[1] !== '') {
          const vtRaw = parseInt(segs[1], 10);
          if (!isNaN(vtRaw)) vtIdx = vtRaw > 0 ? vtRaw - 1 : rawUvs.length + vtRaw;
        }

        let vnIdx = -1;
        if (segs.length > 2 && segs[2] !== '') {
          const vnRaw = parseInt(segs[2], 10);
          if (!isNaN(vnRaw)) vnIdx = vnRaw > 0 ? vnRaw - 1 : rawNormals.length + vnRaw;
        }

        if (vIdx >= 0 && vIdx < rawPositions.length) {
          corners.push({ vIdx, vtIdx, vnIdx });
        }
      }
      for (let i = 1; i < corners.length - 1; i++) {
        rawTriangles.push({
          corners: [corners[0], corners[i], corners[i + 1]],
          groupId: currentGroupId,
          materialSlotIndex: currentMaterialSlotIndex,
        });
      }
    }
  }

  if (rawPositions.length === 0 || rawTriangles.length === 0) {
    const emptySummary: ObjMeshSummary = {
      vertexCount: 0,
      triangleCount: 0,
      uvCoordCount: 0,
      normalCount: 0,
      hasUvCoordinates: false,
      hasNormals: false,
      materialSlots: ['default'],
      bounds: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], radius: 0 },
      isTooComplex: true,
      message: 'No valid 3D mesh vertices or faces were found in this OBJ file.',
    };
    return {
      summary: emptySummary,
      vertices: [],
      triangles: [],
      rawPositions: [],
      rawFaces: [],
      triangleMaterialSlots: [],
      usedAutoUv: false,
      groupBounds: [],
    };
  }

  // Compute initial bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of rawPositions) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (centerOrigin) {
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = minZ; // Place bottom at Z = 0
    for (const p of rawPositions) {
      p[0] -= cx;
      p[1] -= cy;
      p[2] -= cz;
    }
    minX -= cx;
    maxX -= cx;
    minY -= cy;
    maxY -= cy;
    maxZ -= cz;
    minZ = 0;
  }

  const minBounds: [number, number, number] = [minX, minY, minZ];
  const maxBounds: [number, number, number] = [maxX, maxY, maxZ];
  const sizeBounds: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  const radius = Math.max(0.1, Math.hypot(sizeBounds[0], sizeBounds[1], sizeBounds[2]) * 0.5);

  const hasUvCoordinates = rawUvs.length > 0 && rawTriangles.some((t) => t.corners.some((c) => c.vtIdx >= 0 && c.vtIdx < rawUvs.length));
  const uvUnwrapMode: CustomObjectUvUnwrapMode = options.uvUnwrapMode ?? 'box';
  const usedAutoUv = !hasUvCoordinates || Boolean(options.forceAutoUv) || uvUnwrapMode !== 'box';

  // Precompute per-triangle or smart UV coordinates when needed
  const precomputedTriUvs =
    usedAutoUv && uvUnwrapMode === 'per_triangle'
      ? computePerTriangleGridUvs(
          rawPositions,
          rawTriangles.map((t) => [t.corners[0].vIdx, t.corners[1].vIdx, t.corners[2].vIdx]),
        )
      : usedAutoUv && uvUnwrapMode === 'smart'
        ? computeSmartAngleUvs(
            rawPositions,
            rawTriangles.map((t) => [t.corners[0].vIdx, t.corners[1].vIdx, t.corners[2].vIdx]),
          )
        : null;

  // Build deduplicated compiled vertices + triangle index list
  const vertices: CompiledModelVertex[] = [];
  const triangles: [number, number, number][] = [];
  const rawFaces: RawCollisionTriangle[] = [];
  const triangleMaterialSlots: number[] = [];
  const vertexLookup = new Map<string, number>();
  const groupMinMax = new Map<number, { min: [number, number, number]; max: [number, number, number] }>();

  for (let triIdx = 0; triIdx < rawTriangles.length; triIdx++) {
    const tri = rawTriangles[triIdx];
    // Note: when flipYz is enabled, (x, y, z) -> (x, -z, y) has determinant +1 (a proper 90-degree rotation around +X),
    // so vertex winding is preserved.
    const v0 = tri.corners[0].vIdx;
    const v1 = tri.corners[1].vIdx;
    const v2 = tri.corners[2].vIdx;
    const p0 = rawPositions[v0];
    const p1 = rawPositions[v1];
    const p2 = rawPositions[v2];

    rawFaces.push({
      v0,
      v1,
      v2,
      materialSlotIndex: tri.materialSlotIndex,
      groupId: tri.groupId,
    });
    triangleMaterialSlots.push(tri.materialSlotIndex);

    // Track per-group bounds for multi-box collision
    let gb = groupMinMax.get(tri.groupId);
    if (!gb) {
      gb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      groupMinMax.set(tri.groupId, gb);
    }
    for (const p of [p0, p1, p2]) {
      if (p[0] < gb.min[0]) gb.min[0] = p[0];
      if (p[1] < gb.min[1]) gb.min[1] = p[1];
      if (p[2] < gb.min[2]) gb.min[2] = p[2];
      if (p[0] > gb.max[0]) gb.max[0] = p[0];
      if (p[1] > gb.max[1]) gb.max[1] = p[1];
      if (p[2] > gb.max[2]) gb.max[2] = p[2];
    }

    // Face normal from cross(p1 - p0, p2 - p0)
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const faceNormal = normalizeVec3(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    );

    const triOut: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const corner = tri.corners[k];
      const pos = rawPositions[corner.vIdx];
      const norm = corner.vnIdx >= 0 && corner.vnIdx < rawNormals.length
        ? rawNormals[corner.vnIdx]
        : faceNormal;
      const uv = !usedAutoUv && corner.vtIdx >= 0 && corner.vtIdx < rawUvs.length
        ? rawUvs[corner.vtIdx]
        : precomputedTriUvs?.[triIdx]?.[k] ?? projectBoxAtlasUv(pos, faceNormal, minBounds, maxBounds);

      const key = `${corner.vIdx}:${norm[0].toFixed(4)},${norm[1].toFixed(4)},${norm[2].toFixed(4)}:${uv[0].toFixed(4)},${uv[1].toFixed(4)}`;
      let compiledIdx = vertexLookup.get(key);
      if (compiledIdx === undefined && vertices.length < 65534) {
        const { binormal, tangent } = computeOrthonormalBasis(norm[0], norm[1], norm[2]);
        compiledIdx = vertices.length;
        vertices.push({
          position: [pos[0], pos[1], pos[2]],
          normal: norm,
          binormal,
          tangent,
          uv,
          node0Index: 0,
          node1Index: 0,
          node0Weight: 1.0,
          node1Weight: 0.0,
        });
        vertexLookup.set(key, compiledIdx);
      }
      triOut[k] = compiledIdx ?? 0;
    }
    triangles.push(triOut);
  }

  const groupBounds = Array.from(groupMinMax.values()).filter(
    (g) => Number.isFinite(g.min[0]) && Number.isFinite(g.max[0]),
  );

  const MAX_SIMPLE_TRIANGLES = 64;
  const isTooComplex = rawTriangles.length > MAX_SIMPLE_TRIANGLES;
  const uvModeLabel =
    uvUnwrapMode === 'per_triangle'
      ? 'Per-Triangle Ordered Grid'
      : uvUnwrapMode === 'smart'
        ? 'Smart Angle Unwrap'
        : '6-Side Box Unfold';
  const uvStatus = !usedAutoUv && hasUvCoordinates
    ? `${rawUvs.length} UV coords`
    : `Auto-unwrapped (${uvModeLabel})`;

  const finalMaterialSlots = materialSlots.length > 0 ? materialSlots : ['default'];

  let meshIntegrity: MeshIntegrityReview | undefined;
  if (rawPositions.length > 0 && rawFaces.length > 0 && rawFaces.length <= 32000) {
    try {
      const flatPos = new Float32Array(rawPositions.length * 3);
      for (let i = 0; i < rawPositions.length; i++) {
        flatPos[i * 3] = rawPositions[i][0];
        flatPos[i * 3 + 1] = rawPositions[i][1];
        flatPos[i * 3 + 2] = rawPositions[i][2];
      }
      const flatIdx = new Uint32Array(rawFaces.length * 3);
      for (let i = 0; i < rawFaces.length; i++) {
        flatIdx[i * 3] = rawFaces[i].v0;
        flatIdx[i * 3 + 1] = rawFaces[i].v1;
        flatIdx[i * 3 + 2] = rawFaces[i].v2;
      }
      meshIntegrity = auditMeshIntegrity({ positions: flatPos, indices: flatIdx });
    } catch {
      // Leave meshIntegrity undefined if bounds exceeded
    }
  }

  const summary: ObjMeshSummary = {
    vertexCount: rawPositions.length,
    triangleCount: rawTriangles.length,
    uvCoordCount: rawUvs.length,
    normalCount: rawNormals.length,
    hasUvCoordinates,
    hasNormals: rawNormals.length > 0,
    materialSlots: finalMaterialSlots,
    bounds: {
      min: minBounds,
      max: maxBounds,
      size: sizeBounds,
      radius,
    },
    isTooComplex,
    message: `Mesh ready: ${rawPositions.length} vertices, ${rawTriangles.length} triangles (${uvStatus}). Dimensions: ${sizeBounds[0].toFixed(2)} x ${sizeBounds[1].toFixed(2)} x ${sizeBounds[2].toFixed(2)} world units.`,
    meshIntegrity,
  };

  const parsedMesh: ParsedObjMesh = {
    summary,
    vertices,
    triangles,
    rawPositions,
    rawFaces,
    triangleMaterialSlots,
    usedAutoUv,
    groupBounds,
  };

  // Pre-compute collision preview stats (welded vertices, coplanar-merged surfaces, planes, BSP nodes)
  if (
    options.collisionMode !== 'box' &&
    rawPositions.length >= 3 &&
    rawFaces.length > 0 &&
    rawFaces.length <= 32760
  ) {
    const previewBsp = compileMeshCollisionBspData(parsedMesh, Math.max(1, finalMaterialSlots.length), {
      mode: options.collisionMode ?? 'exact',
      targetFaces: options.targetCollisionFaces ?? 4096,
    });
    if (previewBsp) {
      summary.collisionPreview = previewBsp.stats;
    }
  }

  return parsedMesh;
}

/**
 * Analyzes an OBJ file and returns summary metrics.
 */
export function parseAndAnalyzeObj(objText: string, options?: ObjParseOptions): ObjMeshSummary {
  return parseObjMesh(objText, options).summary;
}

/* ---------------------------------------------------------------------------------------------- */
/*                             UV Template Generator & Texture Helpers                            */
/* ---------------------------------------------------------------------------------------------- */

function drawLineRgba(
  rgba: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  let ix0 = Math.max(0, Math.min(size - 1, Math.round(x0)));
  let iy0 = Math.max(0, Math.min(size - 1, Math.round(y0)));
  const ix1 = Math.max(0, Math.min(size - 1, Math.round(x1)));
  const iy1 = Math.max(0, Math.min(size - 1, Math.round(y1)));

  const dx = Math.abs(ix1 - ix0);
  const sx = ix0 < ix1 ? 1 : -1;
  const dy = -Math.abs(iy1 - iy0);
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    const idx = (iy0 * size + ix0) * 4;
    rgba[idx + 0] = r;
    rgba[idx + 1] = g;
    rgba[idx + 2] = b;
    rgba[idx + 3] = a;

    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ix0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      iy0 += sy;
    }
  }
}

function fillTriangleRgba(
  rgba: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));

  const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(denom) < 1e-5) return;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
      const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
        const idx = (py * size + px) * 4;
        rgba[idx + 0] = Math.round(rgba[idx + 0] * (1 - alpha) + r * alpha);
        rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - alpha) + g * alpha);
        rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - alpha) + b * alpha);
        rgba[idx + 3] = 255;
      }
    }
  }
}

/**
 * Renders a UV wireframe template image (RGBA8888) for the given OBJ mesh.
 * If the OBJ has no UVs (or `options.forceAutoUv` is true), uses the 6-face Box UV Atlas
 * and draws subtle colored face region backdrops (+X, -X, +Y, -Y, +Z, -Z).
 */
export function renderObjUvTemplateRgba(
  objText: string,
  size = 1024,
  options: ObjParseOptions = {},
): { rgba: Uint8Array; width: number; height: number; usedAutoUv: boolean } {
  const parsed = parseObjMesh(objText, options);
  const rgba = new Uint8Array(size * size * 4);

  // 1. Checkerboard background
  const cellSize = Math.max(8, Math.floor(size / 32));
  const faceTintColors: [number, number, number][] = [
    [60, 32, 32], // +X (reddish)
    [32, 56, 56], // -X (cyanish)
    [32, 60, 36], // +Y (greenish)
    [56, 32, 56], // -Y (magenta)
    [32, 42, 64], // +Z (blueish top)
    [58, 52, 30], // -Z (amber bottom)
  ];

  const uvUnwrapMode: CustomObjectUvUnwrapMode = options.uvUnwrapMode ?? 'box';
  const isBoxAtlas = parsed.usedAutoUv && uvUnwrapMode === 'box';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) & 1) === 0;
      let r = checker ? 28 : 36;
      let g = checker ? 29 : 38;
      let b = checker ? 34 : 44;

      if (isBoxAtlas) {
        const col = Math.min(2, Math.floor((x / size) * 3));
        const row = Math.min(1, Math.floor((y / size) * 2));
        const tint = faceTintColors[row * 3 + col];
        r = Math.round(r * 0.65 + tint[0] * 0.35);
        g = Math.round(g * 0.65 + tint[1] * 0.35);
        b = Math.round(b * 0.65 + tint[2] * 0.35);
      }

      const idx = (y * size + x) * 4;
      rgba[idx + 0] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  // 2. If Box Atlas mode, draw cell dividers; if Per-Triangle Grid mode, draw grid dividers
  if (isBoxAtlas) {
    for (let c = 1; c <= 2; c++) {
      const x = Math.round((c / 3) * size);
      drawLineRgba(rgba, size, x, 0, x, size - 1, 90, 100, 120, 255);
    }
    const midY = Math.round(size / 2);
    drawLineRgba(rgba, size, 0, midY, size - 1, midY, 90, 100, 120, 255);
  } else if (parsed.usedAutoUv && uvUnwrapMode === 'per_triangle' && parsed.triangles.length > 0 && parsed.triangles.length <= 2500) {
    const numTris = parsed.triangles.length;
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(numTris)));
    const gridRows = Math.max(1, Math.ceil(numTris / gridCols));
    for (let c = 1; c < gridCols; c++) {
      const x = Math.round((c / gridCols) * size);
      drawLineRgba(rgba, size, x, 0, x, size - 1, 55, 62, 76, 255);
    }
    for (let r = 1; r < gridRows; r++) {
      const y = Math.round((r / gridRows) * size);
      drawLineRgba(rgba, size, 0, y, size - 1, y, 55, 62, 76, 255);
    }
  }

  // 3. Fill UV islands with translucent cyan
  for (const [i0, i1, i2] of parsed.triangles) {
    const v0 = parsed.vertices[i0];
    const v1 = parsed.vertices[i1];
    const v2 = parsed.vertices[i2];
    if (!v0 || !v1 || !v2) continue;

    const u0 = ((v0.uv[0] % 1) + 1) % 1;
    const w0 = ((v0.uv[1] % 1) + 1) % 1;
    const u1 = ((v1.uv[0] % 1) + 1) % 1;
    const w1 = ((v1.uv[1] % 1) + 1) % 1;
    const u2 = ((v2.uv[0] % 1) + 1) % 1;
    const w2 = ((v2.uv[1] % 1) + 1) % 1;

    fillTriangleRgba(
      rgba,
      size,
      u0 * (size - 1),
      w0 * (size - 1),
      u1 * (size - 1),
      w1 * (size - 1),
      u2 * (size - 1),
      w2 * (size - 1),
      56,
      189,
      248,
      0.16,
    );
  }

  // 4. Draw crisp UV wireframe edges
  for (const [i0, i1, i2] of parsed.triangles) {
    const v0 = parsed.vertices[i0];
    const v1 = parsed.vertices[i1];
    const v2 = parsed.vertices[i2];
    if (!v0 || !v1 || !v2) continue;

    const x0 = (((v0.uv[0] % 1) + 1) % 1) * (size - 1);
    const y0 = (((v0.uv[1] % 1) + 1) % 1) * (size - 1);
    const x1 = (((v1.uv[0] % 1) + 1) % 1) * (size - 1);
    const y1 = (((v1.uv[1] % 1) + 1) % 1) * (size - 1);
    const x2 = (((v2.uv[0] % 1) + 1) % 1) * (size - 1);
    const y2 = (((v2.uv[1] % 1) + 1) % 1) * (size - 1);

    drawLineRgba(rgba, size, x0, y0, x1, y1, 56, 189, 248, 255);
    drawLineRgba(rgba, size, x1, y1, x2, y2, 56, 189, 248, 255);
    drawLineRgba(rgba, size, x2, y2, x0, y0, 56, 189, 248, 255);
  }

  return { rgba, width: size, height: size, usedAutoUv: parsed.usedAutoUv };
}

/**
 * Renders the UV wireframe template directly to a PNG Buffer.
 */
export function renderObjUvTemplatePng(
  objText: string,
  size = 1024,
  options: ObjParseOptions = {},
): { pngBuffer: Buffer; usedAutoUv: boolean } {
  const { rgba, width, height, usedAutoUv } = renderObjUvTemplateRgba(objText, size, options);
  return {
    pngBuffer: encodeRgbaToPng(rgba, width, height),
    usedAutoUv,
  };
}

/**
 * Generates a clean default neutral surface texture (no light-blue UV wireframe overlay)
 * when the user does not supply a custom texture file.
 */
export function renderCleanDefaultTextureRgba(size = 512): { rgba: Uint8Array; width: number; height: number } {
  const rgba = new Uint8Array(size * size * 4);
  const cellSize = Math.max(8, Math.floor(size / 16));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) & 1) === 0;
      const base = checker ? 132 : 142;
      const idx = (y * size + x) * 4;
      rgba[idx + 0] = base;
      rgba[idx + 1] = base + 2;
      rgba[idx + 2] = base + 5;
      rgba[idx + 3] = 255;
    }
  }
  return { rgba, width: size, height: size };
}

/**
 * If a user painted over an exported UV wireframe template PNG (`#38bdf8` = `rgb(56, 189, 248)`),
 * strips the light-blue UV guide lines by replacing exact/near `#38bdf8` guide pixels with
 * the average of surrounding painted pixels (or neutral gray if unpainted).
 */
export function stripUvWireframeOverlayFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(rgba);
  const isUvGuideLine = (r: number, g: number, b: number): boolean =>
    Math.abs(r - 56) <= 6 && Math.abs(g - 189) <= 6 && Math.abs(b - 248) <= 6;

  // Quick check if any guide pixels exist
  let hasGuidePixels = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (isUvGuideLine(rgba[i], rgba[i + 1], rgba[i + 2])) {
      hasGuidePixels = true;
      break;
    }
  }
  if (!hasGuidePixels) return out;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (!isUvGuideLine(rgba[idx], rgba[idx + 1], rgba[idx + 2])) continue;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = (ny * width + nx) * 4;
          const nr = rgba[nIdx];
          const ng = rgba[nIdx + 1];
          const nb = rgba[nIdx + 2];
          if (!isUvGuideLine(nr, ng, nb)) {
            sumR += nr;
            sumG += ng;
            sumB += nb;
            count++;
          }
        }
      }
      if (count > 0) {
        out[idx + 0] = Math.round(sumR / count);
        out[idx + 1] = Math.round(sumG / count);
        out[idx + 2] = Math.round(sumB / count);
      } else {
        out[idx + 0] = 136;
        out[idx + 1] = 138;
        out[idx + 2] = 142;
      }
    }
  }
  return out;
}

function nearestPowerOfTwo(n: number, min = 16, max = 2048): number {
  const clamped = Math.max(min, Math.min(max, n));
  return Math.pow(2, Math.round(Math.log2(clamped)));
}

/**
 * Resizes an RGBA8888 buffer to power-of-two dimensions required by Halo CE's D3D9 texture loader.
 */
export function resizeRgbaToPowerOfTwo(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxDim = 1024,
): { rgba: Uint8Array; width: number; height: number } {
  const dstW = nearestPowerOfTwo(width, 16, maxDim);
  const dstH = nearestPowerOfTwo(height, 16, maxDim);
  if (dstW === width && dstH === height) {
    return { rgba, width, height };
  }

  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(height - 1, Math.floor((y / dstH) * height));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(width - 1, Math.floor((x / dstW) * width));
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * dstW + x) * 4;
      out[dstIdx + 0] = rgba[srcIdx + 0];
      out[dstIdx + 1] = rgba[srcIdx + 1];
      out[dstIdx + 2] = rgba[srcIdx + 2];
      out[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }
  return { rgba: out, width: dstW, height: dstH };
}

/* ---------------------------------------------------------------------------------------------- */
/*                        Verified Binary Tag Builders (bitm, soso, mod2, coll)                   */
/* ---------------------------------------------------------------------------------------------- */

function writeTagString(buf: Buffer, offset: number, text: string): void {
  buf.fill(0, offset, offset + 32);
  const clean = text.slice(0, 31);
  buf.write(clean, offset, clean.length, 'ascii');
}

function writeDependencyField(buf: Buffer, offset: number, fourccStr: string, tagId = NULL_TAG_ID): void {
  buf.writeUInt32LE(fourCCFromString(fourccStr), offset + 0);
  buf.writeUInt32LE(0, offset + 4);
  buf.writeUInt32LE(0, offset + 8);
  buf.writeUInt32LE(tagId >>> 0, offset + 12);
}

/**
 * Automatically walks a flattened tag buffer using OpenCE's struct definitions and produces the
 * exact `ExtractedDependencyRef[]` array required by `tag-injector.ts`.
 */
export function buildTagDependenciesFromBuffer(
  data: Buffer,
  structName: string,
  tagPath: string,
  internalRefsByFieldPath: Map<string, { group: string; path: string; localTagIndex: number }>,
  externalOrExistingRefsByFieldPath?: Map<string, ExtractedDependencyRef>,
): ExtractedDependencyRef[] {
  const deps: ExtractedDependencyRef[] = [];

  const visit = (curStructName: string, localOffset: number, curPath: string): void => {
    const resolved = resolveStruct(curStructName);
    const decoded = decodeStruct(data, localOffset, curStructName);
    for (const field of resolved.fields) {
      const value = decoded.get(field.name);
      if (!value || field.def.nonCached) continue;
      const absFieldOffset = localOffset + field.offset;
      const path = childFieldPath(curPath, field.name);

      if (value.kind === 'dependency') {
        const internalTarget = internalRefsByFieldPath.get(path);
        const existingTarget = externalOrExistingRefsByFieldPath?.get(path);
        if (internalTarget) {
          // Ensure non-null placeholder tagId in buffer so checkDependencyMap sees a non-null field
          data.writeUInt32LE(internalTarget.localTagIndex >>> 0, absFieldOffset + 12);
          deps.push({
            fieldPath: path,
            group: internalTarget.group,
            path: internalTarget.path,
            kind: 'internal',
            localTagIndex: internalTarget.localTagIndex,
            fieldOffset: absFieldOffset,
          });
        } else if (existingTarget && existingTarget.kind !== 'null') {
          deps.push({
            ...existingTarget,
            fieldPath: path,
            fieldOffset: absFieldOffset,
          });
        } else {
          // Mark null in buffer and record null dependency
          data.writeUInt32LE(NULL_TAG_ID, absFieldOffset + 12);
          deps.push({
            fieldPath: path,
            group: '',
            path: '',
            kind: 'null',
            fieldOffset: absFieldOffset,
          });
        }
      } else if (value.kind === 'reflexive' && value.value.count > 0) {
        const childStruct = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
        if (!childStruct) continue;
        const childSize = resolveStruct(childStruct).totalSize;
        const base = value.value.pointerLow;
        if (!isRangeInBuffer(base, value.value.count * childSize, data.length)) continue;
        for (let i = 0; i < value.value.count; i++) {
          visit(childStruct, base + i * childSize, reflexiveElementPath(curPath, field.name, i));
        }
      } else if (isRelocatedTagDataField(field, value)) {
        // Relocated TagDataOffset already in buffer
      }
    }
  };

  visit(structName, 0, tagPath);
  return deps;
}

/**
 * Builds a self-contained Halo CE `bitmap` (`bitm`) tag with embedded mipmapped pixel data.
 */
export function buildCustomBitmapTag(
  tagPath: string,
  originalIndex: number,
  rgbaInput: Uint8Array,
  inputWidth: number,
  inputHeight: number,
  format: number = BitmapFormat.A8R8G8B8,
): ExtractedTag {
  const { rgba, width, height } = resizeRgbaToPowerOfTwo(rgbaInput, inputWidth, inputHeight, 1024);
  const { pixelData, mipmapCount } = encodeBitmapWithMipmaps(rgba, width, height, format, true);

  // Root Bitmap (108 bytes) + 1 BitmapGroupSequence (64 bytes) + 1 BitmapData (48 bytes) = 220 bytes
  const buf = Buffer.alloc(220, 0);

  // Bitmap root fields
  buf.writeUInt16LE(0, 0); // type = 0 (2D textures)
  buf.writeUInt16LE(format === BitmapFormat.DXT1 ? 1 : format === BitmapFormat.DXT5 ? 3 : 4, 2); // encoding format
  buf.writeUInt16LE(1, 4); // usage = 1 (Default)
  buf.writeUInt16LE(0, 6); // flags

  // sequences reflexive at +84 (0x54): count = 1, pointer = 108
  buf.writeUInt32LE(1, 84);
  buf.writeUInt32LE(108, 88);

  // bitmaps reflexive at +96 (0x60): count = 1, pointer = 172 (108 + 64)
  buf.writeUInt32LE(1, 96);
  buf.writeUInt32LE(172, 100);

  // BitmapGroupSequence at +108 (64 bytes)
  writeTagString(buf, 108, 'default');
  buf.writeUInt16LE(0, 108 + 32); // first bitmap index = 0
  buf.writeUInt16LE(1, 108 + 34); // bitmap count = 1

  // BitmapData at +172 (48 bytes)
  const bdOff = 172;
  buf.write('bitm', bdOff + 0, 4, 'ascii'); // signature 'mtib' in LE: 0x62, 0x69, 0x74, 0x6d -> readUInt32LE = 0x6d746962
  buf.writeUInt32LE(0x6269746d, bdOff + 0);
  buf.writeUInt16LE(width, bdOff + 4);
  buf.writeUInt16LE(height, bdOff + 6);
  buf.writeUInt16LE(1, bdOff + 8); // depth = 1
  buf.writeUInt16LE(0, bdOff + 10); // type = 0 (2D texture)
  buf.writeUInt16LE(format, bdOff + 12);
  const isCompressed = format === BitmapFormat.DXT1 || format === BitmapFormat.DXT3 || format === BitmapFormat.DXT5;
  // Halo CE bitmap_data.flags (bitmaps.c):
  //   bit 0 (0x0001): _bitmap_has_power_of_two_dimensions_bit
  //   bit 1 (0x0002): _bitmap_compressed_bit
  //   bit 7 (0x0080): _bitmap_cached_bit
  const bdFlags = 0x0080 | 0x0001 | (isCompressed ? 0x0002 : 0x0000);
  buf.writeUInt16LE(bdFlags, bdOff + 14);
  buf.writeUInt16LE(Math.floor(width / 2), bdOff + 16); // reg point x
  buf.writeUInt16LE(Math.floor(height / 2), bdOff + 18); // reg point y
  buf.writeUInt16LE(mipmapCount, bdOff + 20);
  buf.writeUInt16LE(0, bdOff + 22);
  buf.writeUInt32LE(0, bdOff + 24); // pixelDataOffset (patched at injection time via embeddedRawDataPatches)
  buf.writeUInt32LE(pixelData.byteLength, bdOff + 28); // pixelDataSize
  buf.writeUInt32LE(NULL_TAG_ID, bdOff + 32);
  buf.writeUInt32LE(NULL_TAG_ID, bdOff + 36);

  const embeddedRawDataAssets: ExtractedEmbeddedAsset[] = [
    { kind: 'bitmap', data: Buffer.from(pixelData) },
  ];
  const embeddedRawDataPatches: ExtractedEmbeddedPatch[] = [
    { assetIndex: 0, patchOffset: bdOff + 24, patchWidth: 4 },
  ];

  return {
    originalIndex,
    group: 'bitmap',
    path: tagPath,
    structName: 'Bitmap',
    secondaryClassFourCC: null,
    tertiaryClassFourCC: null,
    data: buf,
    dependencies: [],
    embeddedRawDataAssets,
    embeddedRawDataPatches,
    injectionBlockers: [],
  };
}

/**
 * Official Halo CE `MaterialType` enum values (indices 0..32), used by `shader_model` (+34)
 * and `model_collision_geometry.materials` (+36) to control bullet impacts, footsteps, and physics.
 */
export const HALO_MATERIAL_TYPES: readonly string[] = [
  'dirt',
  'sand',
  'stone',
  'snow',
  'wood',
  'metal hollow',
  'metal thin',
  'metal thick',
  'rubber',
  'glass',
  'force field',
  'grunt',
  'hunter armor',
  'hunter skin',
  'elite',
  'jackal',
  'jackal energy shield',
  'engineer skin',
  'engineer force field',
  'flood combat form',
  'flood carrier form',
  'cyborg armor',
  'cyborg energy shield',
  'human armor',
  'human skin',
  'sentinel',
  'monitor',
  'plastic',
  'water',
  'leaves',
  'elite energy shield',
  'ice',
  'hunter shield',
] as const;

/**
 * Builds a self-contained Halo CE `shader_model` (`soso`) tag referencing the given `bitmap` tag.
 */
export function buildCustomShaderModelTag(
  tagPath: string,
  originalIndex: number,
  bitmapPath: string,
  bitmapLocalIndex: number,
  materialType = 7,
  shaderFlags?: { twoSided?: boolean; alphaTested?: boolean },
): ExtractedTag {
  // ShaderModel is 440 bytes
  const buf = Buffer.alloc(440, 0);
  const safeMat = materialType >= 0 && materialType < HALO_MATERIAL_TYPES.length ? materialType : 7;

  // Initialize all 4 TagDependency fields in ShaderModel (+164, +188, +220, +356)
  writeDependencyField(buf, 164, 'bitm', bitmapLocalIndex); // base map
  writeDependencyField(buf, 188, 'bitm', NULL_TAG_ID); // multipurpose map
  writeDependencyField(buf, 220, 'bitm', NULL_TAG_ID); // detail map
  writeDependencyField(buf, 356, 'bitm', NULL_TAG_ID); // reflection cube map

  // Standard ShaderModel defaults verified from bloodgulch.map
  buf.writeUInt16LE(safeMat, 34); // material type (default 7 = metal thick)
  buf.writeUInt16LE(4, 36); // shader type = soso (4)
  if (shaderFlags) {
    // ShaderModelFlags at +40 (0x28):
    // bit 1 (0x0002): two sided
    // bit 2 (0x0004): not alpha tested (0 = alpha tested enabled, 0x0004 = not alpha tested)
    // bit 5 (0x0020): disable two sided culling
    let modelFlags = 0;
    if (shaderFlags.twoSided || shaderFlags.alphaTested) {
      modelFlags |= 0x0002 | 0x0020;
    }
    if (!shaderFlags.alphaTested) {
      modelFlags |= 0x0004;
    }
    buf.writeUInt16LE(modelFlags, 40);
  }
  buf.writeFloatLE(1.0, 116);
  buf.writeFloatLE(1.0, 156); // map u-scale
  buf.writeFloatLE(1.0, 160); // map v-scale
  buf.writeFloatLE(1.0, 216); // detail map scale
  buf.writeFloatLE(1.0, 236); // detail map v-scale
  buf.writeFloatLE(1.0, 256);
  buf.writeFloatLE(1.0, 264);
  buf.writeFloatLE(1.0, 272);
  buf.writeFloatLE(1.0, 280);
  buf.writeFloatLE(1.0, 288);
  buf.writeFloatLE(360.0, 296);

  const internalMap = new Map<string, { group: string; path: string; localTagIndex: number }>();
  internalMap.set(childFieldPath(tagPath, 'base map'), {
    group: 'bitmap',
    path: bitmapPath,
    localTagIndex: bitmapLocalIndex,
  });

  const dependencies = buildTagDependenciesFromBuffer(buf, 'ShaderModel', tagPath, internalMap);

  return {
    originalIndex,
    group: 'shader_model',
    path: tagPath,
    structName: 'ShaderModel',
    secondaryClassFourCC: fourCCFromString('shdr'),
    tertiaryClassFourCC: null,
    data: buf,
    dependencies,
    embeddedRawDataAssets: [],
    embeddedRawDataPatches: [],
    injectionBlockers: [],
  };
}

/**
 * Builds a standalone 836-byte `shader_environment` (`senv`) tag referencing a `bitmap` (`bitm`) base map.
 * Used for custom `ScenarioStructureBSP` (`sbsp`) materials so Halo CE / OpenCE's `structure_render_lightmaps`
 * and `rasterizer_environment` render all diffuse and alpha-tested BSP surfaces in-game and in the 3D viewport.
 */
export function buildCustomShaderEnvironmentTag(
  tagPath: string,
  originalIndex: number,
  bitmapPath: string,
  bitmapLocalIndex: number,
  materialType = 0,
  shaderFlags?: { alphaTested?: boolean },
): ExtractedTag {
  // ShaderEnvironment is 836 bytes (40-byte Shader base + 796-byte ShaderEnvironment body)
  const buf = Buffer.alloc(836, 0);
  const safeMat = materialType >= 0 && materialType < HALO_MATERIAL_TYPES.length ? materialType : 0;

  // Initialize all 8 TagDependency fields in ShaderEnvironment
  writeDependencyField(buf, 48, 'lens', NULL_TAG_ID); // lens flare
  writeDependencyField(buf, 136, 'bitm', bitmapLocalIndex); // base map (+0x88)
  writeDependencyField(buf, 184, 'bitm', NULL_TAG_ID); // primary detail map
  writeDependencyField(buf, 204, 'bitm', NULL_TAG_ID); // secondary detail map
  writeDependencyField(buf, 252, 'bitm', NULL_TAG_ID); // micro detail map
  writeDependencyField(buf, 296, 'bitm', NULL_TAG_ID); // bump map
  writeDependencyField(buf, 596, 'bitm', NULL_TAG_ID); // map (self-illumination)
  writeDependencyField(buf, 804, 'bitm', NULL_TAG_ID); // reflection cube map

  // Base Shader fields (+0..+39)
  buf.writeUInt16LE(safeMat, 34); // material type
  buf.writeUInt16LE(3, 36); // shader type = senv (3 = environment)

  // ShaderEnvironmentFlags at +40 (0x28): bit 0 (0x0001) = alpha tested
  if (shaderFlags?.alphaTested) {
    buf.writeUInt16LE(0x0001, 40);
  }
  buf.writeUInt16LE(0, 42); // shader environment type = 0 (normal)

  // Standard ShaderEnvironment scale & color defaults verified against stock Halo CE senv tags
  buf.writeFloatLE(1.0, 180); // primary detail map scale
  buf.writeFloatLE(1.0, 200); // secondary detail map scale
  buf.writeFloatLE(1.0, 248); // micro detail map scale
  buf.writeFloatLE(1.0, 268); // material color R
  buf.writeFloatLE(1.0, 272); // material color G
  buf.writeFloatLE(1.0, 276); // material color B
  buf.writeFloatLE(1.0, 292); // bump map scale
  buf.writeFloatLE(1.0, 312); // bump map scale xy.x (cacheOnly)
  buf.writeFloatLE(1.0, 316); // bump map scale xy.y (cacheOnly)
  buf.writeFloatLE(1.0, 340); // u animation period
  buf.writeFloatLE(1.0, 344); // u animation scale
  buf.writeFloatLE(1.0, 352); // v animation period
  buf.writeFloatLE(1.0, 356); // v animation scale
  buf.writeFloatLE(1.0, 440); // primary animation period
  buf.writeFloatLE(1.0, 500); // secondary animation period
  buf.writeFloatLE(1.0, 560); // plasma animation period
  buf.writeFloatLE(1.0, 592); // map scale
  buf.writeFloatLE(1.0, 680); // perpendicular color R
  buf.writeFloatLE(1.0, 684); // perpendicular color G
  buf.writeFloatLE(1.0, 688); // perpendicular color B
  buf.writeFloatLE(1.0, 692); // parallel color R
  buf.writeFloatLE(1.0, 696); // parallel color G
  buf.writeFloatLE(1.0, 700); // parallel color B
  buf.writeFloatLE(1.0, 724); // lightmap brightness scale

  const internalMap = new Map<string, { group: string; path: string; localTagIndex: number }>();
  internalMap.set(childFieldPath(tagPath, 'base map'), {
    group: 'bitmap',
    path: bitmapPath,
    localTagIndex: bitmapLocalIndex,
  });

  const dependencies = buildTagDependenciesFromBuffer(buf, 'ShaderEnvironment', tagPath, internalMap);

  return {
    originalIndex,
    group: 'shader_environment',
    path: tagPath,
    structName: 'ShaderEnvironment',
    secondaryClassFourCC: fourCCFromString('shdr'),
    tertiaryClassFourCC: null,
    data: buf,
    dependencies,
    embeddedRawDataAssets: [],
    embeddedRawDataPatches: [],
    injectionBlockers: [],
  };
}

export interface TemplateModelMarker {
  /** 64-byte ModelMarker struct (with instances reflexive rewritten on serialization). */
  headerBytes: Buffer;
  /** 32-byte ModelMarkerInstance structs (regionIndex=0, permutationIndex=0). */
  instances: Buffer[];
}

export interface TemplateRigInfo {
  nodeListChecksum: number;
  /** Raw 156-byte ModelNode structs from the template's gbxmodel. */
  modelNodesBuffer: Buffer;
  modelNodeCount: number;
  /** Raw 80-byte ModelRegionPermutationMarker structs from the template's gbxmodel. */
  markersBuffer: Buffer;
  markerCount: number;
  /** Top-level GBXModel.markers (+172) with their ModelMarkerInstance entries. */
  topLevelMarkers?: TemplateModelMarker[];
  /** Optional 664-byte root header from the template's model_collision_geometry. */
  collisionHeaderBuffer?: Buffer;
}

/**
 * Extracts node hierarchy, nodeListChecksum, and permutation markers from an existing template tag in an open map.
 */
export function extractTemplateRigFromMap(
  mapBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  templateObjectTagIndex: number,
): TemplateRigInfo | undefined {
  const entry = tagIndex.entries[templateObjectTagIndex];
  if (!entry || entry.isExternal) return undefined;

  const objOff = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (objOff + 128 > mapBuffer.length) return undefined;

  // Object.model dependency is at +40 (0x28), tagId at +52 (0x34)
  const modelTagId = mapBuffer.readUInt32LE(objOff + 52);
  const modelEntry = tagIndex.entries[modelTagId & 0xffff];
  if (!modelEntry || modelEntry.tagId !== modelTagId || modelEntry.isExternal) return undefined;

  const gbxOff = resolveTagDataPointer(modelEntry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (gbxOff + 232 > mapBuffer.length) return undefined;

  const nodeListChecksum = mapBuffer.readInt32LE(gbxOff + 4);
  const nodeCount = mapBuffer.readUInt32LE(gbxOff + 184);
  const nodePtr = mapBuffer.readUInt32LE(gbxOff + 188);
  if (nodeCount === 0 || nodeCount > 64) return undefined;

  const nodeBase = resolveTagDataPointer(nodePtr, header, tagIndex.baseMemoryAddress);
  if (nodeBase + nodeCount * 156 > mapBuffer.length) return undefined;
  const modelNodesBuffer = Buffer.from(mapBuffer.subarray(nodeBase, nodeBase + nodeCount * 156));

  // Extract markers from region 0, permutation 0 if present
  let markersBuffer: Buffer = Buffer.alloc(0);
  let markerCount = 0;
  const regCount = mapBuffer.readUInt32LE(gbxOff + 196);
  const regPtr = mapBuffer.readUInt32LE(gbxOff + 200);
  if (regCount > 0) {
    const regBase = resolveTagDataPointer(regPtr, header, tagIndex.baseMemoryAddress);
    if (regBase + 76 <= mapBuffer.length) {
      const permCount = mapBuffer.readUInt32LE(regBase + 64);
      const permPtr = mapBuffer.readUInt32LE(regBase + 68);
      if (permCount > 0) {
        const permBase = resolveTagDataPointer(permPtr, header, tagIndex.baseMemoryAddress);
        if (permBase + 88 <= mapBuffer.length) {
          const mCount = mapBuffer.readUInt32LE(permBase + 76);
          const mPtr = mapBuffer.readUInt32LE(permBase + 80);
          if (mCount > 0 && mCount <= 64) {
            const mBase = resolveTagDataPointer(mPtr, header, tagIndex.baseMemoryAddress);
            if (mBase + mCount * 80 <= mapBuffer.length) {
              markerCount = mCount;
              markersBuffer = Buffer.from(mapBuffer.subarray(mBase, mBase + mCount * 80));
            }
          }
        }
      }
    }
  }

  // Extract top-level GBXModel.markers (+172) and their ModelMarkerInstance children
  const topLevelMarkers: TemplateModelMarker[] = [];
  const topMarkerCount = mapBuffer.readUInt32LE(gbxOff + 172);
  const topMarkerPtr = mapBuffer.readUInt32LE(gbxOff + 176);
  if (topMarkerCount > 0 && topMarkerCount <= 64) {
    const topMarkerBase = resolveTagDataPointer(topMarkerPtr, header, tagIndex.baseMemoryAddress);
    if (topMarkerBase + topMarkerCount * 64 <= mapBuffer.length) {
      for (let m = 0; m < topMarkerCount; m++) {
        const mOff = topMarkerBase + m * 64;
        const headerBytes = Buffer.from(mapBuffer.subarray(mOff, mOff + 64));
        const instCount = mapBuffer.readUInt32LE(mOff + 52);
        const instPtr = mapBuffer.readUInt32LE(mOff + 56);
        const instances: Buffer[] = [];
        if (instCount > 0 && instCount <= 32) {
          const instBase = resolveTagDataPointer(instPtr, header, tagIndex.baseMemoryAddress);
          if (instBase + instCount * 32 <= mapBuffer.length) {
            for (let k = 0; k < instCount; k++) {
              const instBuf = Buffer.from(mapBuffer.subarray(instBase + k * 32, instBase + (k + 1) * 32));
              instBuf[0] = 0; // region index = 0
              instBuf[1] = 0; // permutation index = 0
              if (instBuf[2] >= nodeCount) instBuf[2] = 0; // clamp node index
              instances.push(instBuf);
            }
          }
        }
        topLevelMarkers.push({ headerBytes, instances });
      }
    }
  }

  // Optional collision header from Object.collision_model at +112 (0x70), tagId at +124 (0x7C)
  let collisionHeaderBuffer: Buffer | undefined;
  const collTagId = mapBuffer.readUInt32LE(objOff + 124);
  const collEntry = tagIndex.entries[collTagId & 0xffff];
  if (collEntry && collEntry.tagId === collTagId && !collEntry.isExternal) {
    const collOff = resolveTagDataPointer(collEntry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    if (collOff + 664 <= mapBuffer.length) {
      collisionHeaderBuffer = Buffer.from(mapBuffer.subarray(collOff, collOff + 664));
    }
  }

  return {
    nodeListChecksum,
    modelNodesBuffer,
    modelNodeCount: nodeCount,
    markersBuffer,
    markerCount,
    topLevelMarkers,
    collisionHeaderBuffer,
  };
}

/**
 * Infers a Halo CE `MaterialType` index (0..32) from a Blender / Wavefront `usemtl` slot name.
 */
export function inferHaloMaterialTypeFromName(slotName: string, fallback = 7): number {
  const s = slotName.trim().toLowerCase();
  if (!s) return fallback;
  const exactIdx = HALO_MATERIAL_TYPES.indexOf(s);
  if (exactIdx >= 0) return exactIdx;

  if (s.includes('glass') || s.includes('windshield') || s.includes('window') || s.includes('visor') || s.includes('canopy')) return 9; // glass
  if (s.includes('rubber') || s.includes('tire') || s.includes('tyre') || s.includes('wheel') || s.includes('tread')) return 8; // rubber
  if (s.includes('wood') || s.includes('plank') || s.includes('timber') || s.includes('bark') || s.includes('crate')) return 4; // wood
  if (s.includes('stone') || s.includes('rock') || s.includes('concrete') || s.includes('brick') || s.includes('granite') || s.includes('boulder')) return 2; // stone
  if (s.includes('dirt') || s.includes('mud') || s.includes('soil') || s.includes('earth')) return 0; // dirt
  if (s.includes('sand') || s.includes('desert') || s.includes('dune')) return 1; // sand
  if (s.includes('snow') || s.includes('frost')) return 3; // snow
  if (s.includes('ice') || s.includes('glacier')) return 31; // ice
  if (s.includes('water') || s.includes('liquid')) return 28; // water
  if (s.includes('leaf') || s.includes('leaves') || s.includes('foliage') || s.includes('grass') || s.includes('bush')) return 29; // leaves
  if (s.includes('plastic') || s.includes('polymer') || s.includes('vinyl') || s.includes('seat')) return 27; // plastic
  if (s.includes('cyborg') && s.includes('shield')) return 22; // cyborg energy shield
  if (s.includes('cyborg')) return 21; // cyborg armor
  if (s.includes('force') || s.includes('shield') || s.includes('energy')) return 10; // force field
  if (s.includes('hollow')) return 5; // metal hollow
  if (s.includes('thin') || s.includes('sheet') || s.includes('tin') || s.includes('aluminum')) return 6; // metal thin
  if (s.includes('metal') || s.includes('steel') || s.includes('iron') || s.includes('titanium') || s.includes('hull') || s.includes('armor') || s.includes('brass')) return 7; // metal thick
  return fallback;
}

/**
 * Encodes independent triangles into a single contiguous D3DPT_TRIANGLESTRIP buffer
 * stitched with degenerate triangles (verified against Halo CE's D3D9 renderer and OpenCE's viewport).
 *
 * Important Halo CE D3D9 conventions:
 * 1. Native Halo CE `gbxmodel` triangle strips use Clockwise (`[a, c, b]`) vertex order for even
 *    strip triangles (`cross(v1 - v0, v2 - v0) · normal < 0`), whereas Wavefront `.obj` uses
 *    Counter-Clockwise (`[a, b, c]`).
 * 2. When bridging from `prev` (the last vertex of triangle `i-1`) to `a` (the first vertex of
 *    triangle `i`), BOTH `prev` and `a` must be repeated (`prev, a, a`) so every sliding window of
 *    3 vertices across the transition is degenerate, and an additional `a` is pushed if needed so
 *    that `[a, c, b]` always starts at an EVEN index in `stripIndices`.
 */
export function stitchTrianglesToStrip(triangles: [number, number, number][]): {
  stripIndices: number[];
  triangleBufferBytes: Buffer;
  triangleCount: number;
} {
  const stripIndices: number[] = [];
  for (let i = 0; i < triangles.length; i++) {
    const [a, b, c] = triangles[i];
    if (i === 0) {
      stripIndices.push(a, c, b);
    } else {
      const prev = stripIndices[stripIndices.length - 1];
      // Push degenerate connector: repeat previous vertex AND repeat next triangle's first vertex
      stripIndices.push(prev, a, a);
      // Ensure `a, c, b` begins at an EVEN index in stripIndices so D3D9 does not flip its winding
      if ((stripIndices.length - 1) % 2 === 1) {
        stripIndices.push(a);
      }
      stripIndices.push(c, b);
    }
  }

  const triangleCount = Math.max(1, stripIndices.length - 2);
  // Pad uint16 buffer with 0xFFFF to a 4-byte boundary (and at least (triangleCount + 2) * 2 bytes)
  const paddedLen = stripIndices.length + (stripIndices.length % 2);
  const triangleBufferBytes = Buffer.alloc(paddedLen * 2, 0xff);
  for (let i = 0; i < stripIndices.length; i++) {
    triangleBufferBytes.writeUInt16LE(stripIndices[i] & 0xffff, i * 2);
  }

  return { stripIndices, triangleBufferBytes, triangleCount };
}

/**
 * Encodes `CompiledModelVertex[]` into Halo CE's 68-byte `ModelVertexUncompressed` binary format.
 */
export function encodeUncompressedVertices(vertices: CompiledModelVertex[]): Buffer {
  const buf = Buffer.alloc(vertices.length * 68, 0);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const off = i * 68;
    buf.writeFloatLE(v.position[0], off + 0);
    buf.writeFloatLE(v.position[1], off + 4);
    buf.writeFloatLE(v.position[2], off + 8);
    buf.writeFloatLE(v.normal[0], off + 12);
    buf.writeFloatLE(v.normal[1], off + 16);
    buf.writeFloatLE(v.normal[2], off + 20);
    buf.writeFloatLE(v.binormal[0], off + 24);
    buf.writeFloatLE(v.binormal[1], off + 28);
    buf.writeFloatLE(v.binormal[2], off + 32);
    buf.writeFloatLE(v.tangent[0], off + 36);
    buf.writeFloatLE(v.tangent[1], off + 40);
    buf.writeFloatLE(v.tangent[2], off + 44);
    buf.writeFloatLE(v.uv[0], off + 48);
    buf.writeFloatLE(v.uv[1], off + 52);
    buf.writeInt16LE(v.node0Index, off + 56);
    buf.writeInt16LE(v.node1Index, off + 58);
    buf.writeFloatLE(v.node0Weight, off + 60);
    buf.writeFloatLE(v.node1Weight, off + 64);
  }
  return buf;
}

/**
 * Builds a self-contained Halo CE `gbxmodel` (`mod2`) tag from a parsed OBJ mesh.
 * Populates BOTH `gbxmodelGeometryParts` (for map injection) and `embeddedRawDataAssets` / `embeddedRawDataPatches`
 * (`gbxmodel-vertex` and `gbxmodel-triangle-strip` for OpenCE Forge).
 */
export function buildCustomGbxmodelTag(
  tagPath: string,
  originalIndex: number,
  mesh: ParsedObjMesh,
  shaderPath: string,
  shaderLocalIndex: number,
  rig?: TemplateRigInfo,
): ExtractedTag {
  const vertexBytes = encodeUncompressedVertices(mesh.vertices);
  const { triangleBufferBytes, triangleCount } = stitchTrianglesToStrip(mesh.triangles);

  // Node block: either copied from template rig or 1 default "frame root" node (156 bytes)
  let nodesBuf: Buffer;
  let nodeCount = 1;
  if (rig && rig.modelNodeCount > 0 && rig.modelNodesBuffer.length === rig.modelNodeCount * 156) {
    nodeCount = rig.modelNodeCount;
    nodesBuf = Buffer.from(rig.modelNodesBuffer);
  } else {
    nodesBuf = Buffer.alloc(156, 0);
    writeTagString(nodesBuf, 0, 'frame root');
    nodesBuf.writeInt16LE(-1, 32); // next sibling
    nodesBuf.writeInt16LE(-1, 34); // first child
    nodesBuf.writeInt16LE(-1, 36); // parent
    nodesBuf.writeFloatLE(0, 40); // default translation x
    nodesBuf.writeFloatLE(0, 44); // default translation y
    nodesBuf.writeFloatLE(0, 48); // default translation z
    nodesBuf.writeFloatLE(0, 52); // default rotation i
    nodesBuf.writeFloatLE(0, 56); // default rotation j
    nodesBuf.writeFloatLE(0, 60); // default rotation k
    nodesBuf.writeFloatLE(1.0, 64); // default rotation w
    nodesBuf.writeFloatLE(1.0, 104); // runtime_default_inverse_matrix.scale
    nodesBuf.writeFloatLE(1.0, 108); // runtime_default_inverse_matrix.forward.i (+108..+119)
    nodesBuf.writeFloatLE(1.0, 124); // runtime_default_inverse_matrix.left.j    (+120..+131)
    nodesBuf.writeFloatLE(1.0, 140); // runtime_default_inverse_matrix.up.k      (+132..+143)
  }

  const markerCount = rig?.markerCount ?? 0;
  const markersBuf = markerCount > 0 && rig ? Buffer.from(rig.markersBuffer) : Buffer.alloc(0);

  const topMarkers = rig?.topLevelMarkers ?? [];
  const topMarkersHeaderSize = topMarkers.length * 64;
  const topMarkerInstancesCount = topMarkers.reduce((s, m) => s + m.instances.length, 0);
  const topMarkerInstancesSize = topMarkerInstancesCount * 32;

  // Layout offsets inside flattened GBXModel buffer:
  // 0: GBXModel header (232 bytes)
  // offTopMarkers: ModelMarker[topMarkers.length] (topMarkers.length * 64 bytes)
  // offTopMarkerInstances: ModelMarkerInstance[...] (topMarkerInstancesCount * 32 bytes)
  // offNodes: ModelNode[nodeCount] (nodeCount * 156 bytes)
  // offRegions: ModelRegion[1] (76 bytes)
  // offPermutations: ModelRegionPermutation[1] (88 bytes)
  // offMarkers: ModelRegionPermutationMarker[markerCount] (markerCount * 80 bytes)
  // offGeometries: GBXModelGeometry[1] (48 bytes)
  // offParts: GBXModelGeometryPart[1] (132 bytes)
  // offShaders: ModelShaderReference[1] (32 bytes)
  const offTopMarkers = 232;
  const offTopMarkerInstances = offTopMarkers + topMarkersHeaderSize;
  const offNodes = offTopMarkerInstances + topMarkerInstancesSize;
  const offRegions = offNodes + nodesBuf.length;
  const offPermutations = offRegions + 76;
  const offMarkers = offPermutations + 88;
  const offGeometries = offMarkers + markersBuf.length;
  const offParts = offGeometries + 48;
  const offShaders = offParts + 132;
  const totalSize = offShaders + 32;

  const buf = Buffer.alloc(totalSize, 0);

  // GBXModel header (232 bytes)
  buf.writeUInt32LE(4, 0); // flags = 4
  buf.writeInt32LE(rig?.nodeListChecksum ?? 0, 4); // node list checksum
  buf.writeUInt16LE(nodeCount, 28); // super low detail node count
  buf.writeUInt16LE(nodeCount, 30); // low detail node count
  buf.writeUInt16LE(nodeCount, 32); // medium detail node count
  buf.writeUInt16LE(nodeCount, 34); // high detail node count
  buf.writeUInt16LE(nodeCount, 36); // super high detail node count
  buf.writeFloatLE(1.0, 48); // base map u-scale
  buf.writeFloatLE(1.0, 52); // base map v-scale
  if (topMarkers.length > 0) {
    buf.writeUInt32LE(topMarkers.length, 172); // markers.count
    buf.writeUInt32LE(offTopMarkers, 176); // markers.pointer
    let instCursor = offTopMarkerInstances;
    for (let m = 0; m < topMarkers.length; m++) {
      const mHeaderOff = offTopMarkers + m * 64;
      topMarkers[m].headerBytes.copy(buf, mHeaderOff);
      const insts = topMarkers[m].instances;
      if (insts.length > 0) {
        buf.writeUInt32LE(insts.length, mHeaderOff + 52);
        buf.writeUInt32LE(instCursor, mHeaderOff + 56);
        buf.writeUInt32LE(0, mHeaderOff + 60);
        for (const inst of insts) {
          inst.copy(buf, instCursor);
          instCursor += 32;
        }
      } else {
        buf.writeUInt32LE(0, mHeaderOff + 52);
        buf.writeUInt32LE(0, mHeaderOff + 56);
        buf.writeUInt32LE(0, mHeaderOff + 60);
      }
    }
  }
  buf.writeUInt32LE(nodeCount, 184); // nodes.count
  buf.writeUInt32LE(offNodes, 188); // nodes.pointer
  buf.writeUInt32LE(1, 196); // regions.count
  buf.writeUInt32LE(offRegions, 200); // regions.pointer
  buf.writeUInt32LE(1, 208); // geometries.count
  buf.writeUInt32LE(offGeometries, 212); // geometries.pointer
  buf.writeUInt32LE(1, 220); // shaders.count
  buf.writeUInt32LE(offShaders, 224); // shaders.pointer

  // Copy ModelNode array
  nodesBuf.copy(buf, offNodes);

  // ModelRegion[0] (76 bytes)
  writeTagString(buf, offRegions, 'default');
  buf.writeUInt32LE(1, offRegions + 64); // permutations.count
  buf.writeUInt32LE(offPermutations, offRegions + 68); // permutations.pointer

  // ModelRegionPermutation[0] (88 bytes)
  writeTagString(buf, offPermutations, 'base');
  buf.writeInt16LE(0, offPermutations + 64); // super low = 0
  buf.writeInt16LE(0, offPermutations + 66); // low = 0
  buf.writeInt16LE(0, offPermutations + 68); // medium = 0
  buf.writeInt16LE(0, offPermutations + 70); // high = 0
  buf.writeInt16LE(0, offPermutations + 72); // super high = 0
  if (markerCount > 0) {
    buf.writeUInt32LE(markerCount, offPermutations + 76); // markers.count
    buf.writeUInt32LE(offMarkers, offPermutations + 80); // markers.pointer
    markersBuf.copy(buf, offMarkers);
  }

  // GBXModelGeometry[0] (48 bytes)
  buf.writeUInt32LE(1, offGeometries + 36); // parts.count
  buf.writeUInt32LE(offParts, offGeometries + 40); // parts.pointer

  // GBXModelGeometryPart[0] (132 bytes)
  const cx = (mesh.summary.bounds.min[0] + mesh.summary.bounds.max[0]) * 0.5;
  const cy = (mesh.summary.bounds.min[1] + mesh.summary.bounds.max[1]) * 0.5;
  const cz = (mesh.summary.bounds.min[2] + mesh.summary.bounds.max[2]) * 0.5;
  buf.writeUInt32LE(0, offParts + 0); // flags
  buf.writeInt16LE(0, offParts + 4); // shader index = 0
  buf.writeUInt8(255, offParts + 6); // prev filthy part index
  buf.writeUInt8(255, offParts + 7); // next filthy part index
  buf.writeInt16LE(0, offParts + 8); // centroid primary node = 0
  buf.writeInt16LE(0, offParts + 10); // centroid secondary node = 0
  buf.writeFloatLE(1.0, offParts + 12); // centroid primary weight = 1.0
  buf.writeFloatLE(0.0, offParts + 16); // centroid secondary weight = 0.0
  buf.writeFloatLE(cx, offParts + 20); // centroid x
  buf.writeFloatLE(cy, offParts + 24); // centroid y
  buf.writeFloatLE(cz, offParts + 28); // centroid z
  buf.writeUInt16LE(1, offParts + 68); // triangle buffer type = 1 (triangle strip)
  buf.writeUInt32LE(triangleCount, offParts + 72); // triangle count
  buf.writeUInt32LE(0, offParts + 76); // triangle offset (patched on inject / Forge load)
  buf.writeUInt32LE(0, offParts + 80); // triangle offset 2 (patched on inject / Forge load)
  buf.writeUInt16LE(4, offParts + 84); // vertex type = 4 (uncompressed 68-byte vertices)
  buf.writeUInt32LE(mesh.vertices.length, offParts + 88); // vertex count
  buf.writeUInt32LE(0, offParts + 100); // vertex offset (patched on inject / Forge load)

  // ModelShaderReference[0] (32 bytes)
  writeDependencyField(buf, offShaders + 0, 'soso', shaderLocalIndex);

  const internalMap = new Map<string, { group: string; path: string; localTagIndex: number }>();
  internalMap.set(`${reflexiveElementPath(tagPath, 'shaders', 0)}.shader`, {
    group: 'shader_model',
    path: shaderPath,
    localTagIndex: shaderLocalIndex,
  });

  const dependencies = buildTagDependenciesFromBuffer(buf, 'GBXModel', tagPath, internalMap);

  const gbxmodelGeometryParts: CapturedGbxmodelPart[] = [
    {
      geometryIndex: 0,
      partIndex: 0,
      vertexType: 4,
      vertexCount: mesh.vertices.length,
      vertexBytes,
      triangleBufferType: 1,
      triangleCount,
      triangleBytes: triangleBufferBytes,
    },
  ];

  // Also populate embeddedRawDataAssets/embeddedRawDataPatches for OpenCE Forge's .ocetags loader
  const embeddedRawDataAssets: ExtractedEmbeddedAsset[] = [
    { kind: 'gbxmodel-vertex', data: vertexBytes },
    { kind: 'gbxmodel-triangle-strip', data: triangleBufferBytes },
  ];
  const embeddedRawDataPatches: ExtractedEmbeddedPatch[] = [
    { assetIndex: 0, patchOffset: offParts + 0x64, patchWidth: 4 },
    { assetIndex: 1, patchOffset: offParts + 0x4c, patchWidth: 4 },
  ];

  return {
    originalIndex,
    group: 'gbxmodel',
    path: tagPath,
    structName: 'GBXModel',
    secondaryClassFourCC: null,
    tertiaryClassFourCC: null,
    data: buf,
    dependencies,
    embeddedRawDataAssets,
    embeddedRawDataPatches,
    injectionBlockers: [],
    gbxmodelGeometryParts,
  };
}

/**
 * Serializes a single verified 6-plane Box `ModelCollisionGeometryBSP` (96-byte struct + 688 bytes of child arrays)
 * into `targetBuf` at `structOff` (with child arrays written starting at `arraysOff`).
 * Topology verified byte-for-byte against `bloodgulch.map` tag #1204.
 */
function writeBoxCollisionBsp(
  targetBuf: Buffer,
  structOff: number,
  arraysOff: number,
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
): number {
  // Ensure non-degenerate thickness on all 3 axes (minimum 0.04 world units)
  const padX = Math.max(0, 0.04 - (boundsMax[0] - boundsMin[0])) * 0.5;
  const padY = Math.max(0, 0.04 - (boundsMax[1] - boundsMin[1])) * 0.5;
  const padZ = Math.max(0, 0.04 - (boundsMax[2] - boundsMin[2])) * 0.5;
  const minX = boundsMin[0] - padX, maxX = boundsMax[0] + padX;
  const minY = boundsMin[1] - padY, maxY = boundsMax[1] + padY;
  const minZ = boundsMin[2] - padZ, maxZ = boundsMax[2] + padZ;

  let cursor = arraysOff;

  // 1. bsp3d_nodes: 6 * 12 = 72 bytes
  const offBsp3dNodes = cursor;
  const bsp3dNodes: [number, number, number][] = [
    [0, 1, 0x80000005],
    [1, 2, 0x80000004],
    [2, 3, 0x80000003],
    [3, 4, 0x80000002],
    [4, 5, 0x80000001],
    [5, 0xffffffff, 0x80000000],
  ];
  for (let i = 0; i < 6; i++) {
    targetBuf.writeInt32LE(bsp3dNodes[i][0], cursor + 0);
    targetBuf.writeUInt32LE(bsp3dNodes[i][1] >>> 0, cursor + 4);
    targetBuf.writeUInt32LE(bsp3dNodes[i][2] >>> 0, cursor + 8);
    cursor += 12;
  }

  // 2. planes: 6 * 16 = 96 bytes
  const offPlanes = cursor;
  const planes: [number, number, number, number][] = [
    [0, 0, -1, -minZ],
    [0, 0, 1, maxZ],
    [1, 0, 0, maxX],
    [-1, 0, 0, -minX],
    [0, 1, 0, maxY],
    [0, -1, 0, -minY],
  ];
  for (let i = 0; i < 6; i++) {
    targetBuf.writeFloatLE(planes[i][0], cursor + 0);
    targetBuf.writeFloatLE(planes[i][1], cursor + 4);
    targetBuf.writeFloatLE(planes[i][2], cursor + 8);
    targetBuf.writeFloatLE(planes[i][3], cursor + 12);
    cursor += 16;
  }

  // 3. leaves: 6 * 8 = 48 bytes
  const offLeaves = cursor;
  for (let i = 0; i < 6; i++) {
    targetBuf.writeUInt16LE(0, cursor + 0); // flags = 0
    targetBuf.writeUInt16LE(1, cursor + 2); // bsp2d reference count = 1
    targetBuf.writeUInt32LE(i, cursor + 4); // first bsp2d reference = i
    cursor += 8;
  }

  // 4. bsp2d_references: 6 * 8 = 48 bytes
  const offBsp2dRefs = cursor;
  for (let i = 0; i < 6; i++) {
    const surfIdx = 5 - i;
    targetBuf.writeUInt32LE(surfIdx, cursor + 0); // plane
    targetBuf.writeUInt32LE((0x80000000 | surfIdx) >>> 0, cursor + 4); // bsp2d node (leaf surface flag)
    cursor += 8;
  }

  // 5. bsp2d_nodes: 0 entries

  // 6. surfaces: 6 * 12 = 72 bytes
  const offSurfaces = cursor;
  const surfaceFirstEdges = [0, 2, 0, 6, 4, 1];
  for (let i = 0; i < 6; i++) {
    targetBuf.writeUInt32LE(i, cursor + 0); // plane = i
    targetBuf.writeUInt32LE(surfaceFirstEdges[i], cursor + 4); // first edge
    targetBuf.writeUInt8(0, cursor + 8); // flags = 0
    targetBuf.writeInt8(0, cursor + 9); // breakable surface = 0
    targetBuf.writeInt16LE(0, cursor + 10); // material = 0
    cursor += 12;
  }

  // 7. edges: 12 * 24 = 288 bytes
  const offEdges = cursor;
  const edges: [number, number, number, number, number, number][] = [
    [1, 2, 1, 8, 0, 2],
    [2, 0, 6, 10, 0, 5],
    [4, 5, 3, 9, 1, 5],
    [5, 3, 4, 10, 1, 2],
    [3, 6, 5, 8, 1, 4],
    [6, 4, 2, 11, 1, 3],
    [0, 7, 7, 9, 0, 3],
    [7, 1, 0, 11, 0, 4],
    [1, 3, 3, 7, 2, 4],
    [0, 4, 5, 1, 3, 5],
    [5, 2, 0, 2, 2, 5],
    [6, 7, 6, 4, 3, 4],
  ];
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 6; k++) {
      targetBuf.writeUInt32LE(edges[i][k], cursor + k * 4);
    }
    cursor += 24;
  }

  // 8. vertices: 8 * 16 = 128 bytes
  const offVertices = cursor;
  const verts: [number, number, number, number][] = [
    [minX, minY, minZ, 6],
    [maxX, maxY, minZ, 0],
    [maxX, minY, minZ, 1],
    [maxX, maxY, maxZ, 4],
    [minX, minY, maxZ, 2],
    [maxX, minY, maxZ, 3],
    [minX, maxY, maxZ, 5],
    [minX, maxY, minZ, 7],
  ];
  for (let i = 0; i < 8; i++) {
    targetBuf.writeFloatLE(verts[i][0], cursor + 0);
    targetBuf.writeFloatLE(verts[i][1], cursor + 4);
    targetBuf.writeFloatLE(verts[i][2], cursor + 8);
    targetBuf.writeUInt32LE(verts[i][3], cursor + 12);
    cursor += 16;
  }

  // Write 96-byte ModelCollisionGeometryBSP header at structOff
  targetBuf.writeUInt32LE(6, structOff + 0); // bsp3d_nodes.count
  targetBuf.writeUInt32LE(offBsp3dNodes, structOff + 4);
  targetBuf.writeUInt32LE(6, structOff + 12); // planes.count
  targetBuf.writeUInt32LE(offPlanes, structOff + 16);
  targetBuf.writeUInt32LE(6, structOff + 24); // leaves.count
  targetBuf.writeUInt32LE(offLeaves, structOff + 28);
  targetBuf.writeUInt32LE(6, structOff + 36); // bsp2d_references.count
  targetBuf.writeUInt32LE(offBsp2dRefs, structOff + 40);
  targetBuf.writeUInt32LE(0, structOff + 48); // bsp2d_nodes.count = 0
  targetBuf.writeUInt32LE(0, structOff + 52);
  targetBuf.writeUInt32LE(6, structOff + 60); // surfaces.count
  targetBuf.writeUInt32LE(offSurfaces, structOff + 64);
  targetBuf.writeUInt32LE(12, structOff + 72); // edges.count
  targetBuf.writeUInt32LE(offEdges, structOff + 76);
  targetBuf.writeUInt32LE(8, structOff + 84); // vertices.count
  targetBuf.writeUInt32LE(offVertices, structOff + 88);

  return cursor;
}

export interface Bsp2dNodeEntry {
  planeI: number;
  planeJ: number;
  planeD: number;
  leftChild: number;
  rightChild: number;
}

export interface CompiledMeshCollisionBsp {
  bsp3dNodes: [number, number, number][];
  planes: [number, number, number, number][];
  leaves: [number, number, number][];
  bsp2dReferences: [number, number][];
  bsp2dNodes: Bsp2dNodeEntry[];
  surfaces: { planeDesignator: number; firstEdgeIndex: number; flags: number; materialIndex: number }[];
  edges: { vertexIndices: [number, number]; edgeIndices: [number, number]; surfaceIndices: [number, number] }[];
  vertices: { point: [number, number, number]; firstEdgeIndex: number }[];
  byteSize: number;
  stats: CollisionCompilationStats;
}

/**
 * Halo CE `global_projection3d_mappings[projection][sign]` from `source/math/real_math.c`.
 * Maps 3D point `(x, y, z)` onto 2D plane coordinates `(x2d, y2d)` such that a counter-clockwise
 * 3D polygon viewed against the plane normal always projects to a counter-clockwise 2D polygon.
 */
const HALO_PROJECTION3D_MAPPINGS: readonly [readonly [number, number], readonly [number, number]][] = [
  [
    [2, 1], // _x (0), sign = 0 (nx <= 0): (z, y)
    [1, 2], // _x (0), sign = 1 (nx > 0):  (y, z)
  ],
  [
    [0, 2], // _y (1), sign = 0 (ny <= 0): (x, z)
    [2, 0], // _y (1), sign = 1 (ny > 0):  (z, x)
  ],
  [
    [1, 0], // _z (2), sign = 0 (nz <= 0): (y, x)
    [0, 1], // _z (2), sign = 1 (nz > 0):  (x, y)
  ],
];

function getHaloPlaneProjection(
  plane: [number, number, number, number],
  designatorNegated = false,
): { axis: 0 | 1 | 2; sign: 0 | 1 } {
  const ai = Math.abs(plane[0]);
  const aj = Math.abs(plane[1]);
  const ak = Math.abs(plane[2]);
  const axis: 0 | 1 | 2 = ak >= aj && ak >= ai ? 2 : aj >= ai ? 1 : 0;
  const rawPositive = plane[axis] > 0;
  const sign: 0 | 1 = (rawPositive !== designatorNegated) ? 1 : 0;
  return { axis, sign };
}

function projectHaloPoint3dTo2d(
  pt: [number, number, number],
  axis: 0 | 1 | 2,
  sign: 0 | 1,
): [number, number] {
  const map = HALO_PROJECTION3D_MAPPINGS[axis][sign];
  return [pt[map[0]], pt[map[1]]];
}

/**
 * Stage 1A: Welds 3D vertices within `weldTolerance` (Blender "Merge by Distance" equivalent)
 * and strips degenerate/duplicate triangles.
 */
function weldCollisionPositions(
  rawPositions: [number, number, number][],
  rawFaces: RawCollisionTriangle[],
  weldTolerance = 1e-4,
): { positions: [number, number, number][]; faces: RawCollisionTriangle[] } {
  const invTol = 1 / Math.max(1e-6, weldTolerance);
  const gridMap = new Map<string, number>();
  const positions: [number, number, number][] = [];
  const remap = new Int32Array(rawPositions.length);

  for (let i = 0; i < rawPositions.length; i++) {
    const p = rawPositions[i];
    const gx = Math.round(p[0] * invTol);
    const gy = Math.round(p[1] * invTol);
    const gz = Math.round(p[2] * invTol);
    const key = `${gx},${gy},${gz}`;
    let idx = gridMap.get(key);
    if (idx === undefined) {
      idx = positions.length;
      positions.push([p[0], p[1], p[2]]);
      gridMap.set(key, idx);
    }
    remap[i] = idx;
  }

  const faces: RawCollisionTriangle[] = [];
  const seenTri = new Set<string>();
  for (const f of rawFaces) {
    const v0 = remap[f.v0];
    const v1 = remap[f.v1];
    const v2 = remap[f.v2];
    if (v0 === v1 || v1 === v2 || v2 === v0) continue;
    const p0 = positions[v0];
    const p1 = positions[v1];
    const p2 = positions[v2];
    if (!p0 || !p1 || !p2) continue;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (area2 < 1e-6) continue;
    // Deduplicate identical oriented triangles
    const minV = Math.min(v0, v1, v2);
    const canonKey =
      minV === v0
        ? `${v0},${v1},${v2}`
        : minV === v1
          ? `${v1},${v2},${v0}`
          : `${v2},${v0},${v1}`;
    if (seenTri.has(canonKey)) continue;
    seenTri.add(canonKey);
    faces.push({
      v0,
      v1,
      v2,
      materialSlotIndex: f.materialSlotIndex,
      groupId: f.groupId,
    });
  }

  return { positions, faces };
}

/**
 * Stage 1B: Garland-Heckbert Quadric Error Metric (QEM) Edge-Collapse Simplifier
 * (Blender "Decimate -> Collapse" modifier equivalent).
 * Preserves sharp silhouette creases, material boundaries, and open mesh borders while
 * reducing high-poly render `.obj` files down to `targetFaceCount`.
 */
function decimateCollisionMeshQem(
  positions: [number, number, number][],
  faces: RawCollisionTriangle[],
  targetFaceCount: number,
): { positions: [number, number, number][]; faces: RawCollisionTriangle[] } {
  if (faces.length <= targetFaceCount || targetFaceCount < 4) {
    return { positions, faces };
  }

  const vCount = positions.length;
  const pts: [number, number, number][] = positions.map((p) => [p[0], p[1], p[2]]);
  // Symmetric 4x4 quadric matrix per vertex (10 floats: q00, q01, q02, q03, q11, q12, q13, q22, q23, q33)
  const quadrics = new Float64Array(vCount * 10);

  const addPlaneQuadric = (vIdx: number, a: number, b: number, c: number, d: number, weight = 1.0) => {
    const base = vIdx * 10;
    quadrics[base + 0] += weight * a * a;
    quadrics[base + 1] += weight * a * b;
    quadrics[base + 2] += weight * a * c;
    quadrics[base + 3] += weight * a * d;
    quadrics[base + 4] += weight * b * b;
    quadrics[base + 5] += weight * b * c;
    quadrics[base + 6] += weight * b * d;
    quadrics[base + 7] += weight * c * c;
    quadrics[base + 8] += weight * c * d;
    quadrics[base + 9] += weight * d * d;
  };

  const evalQuadric = (qBase1: number, qBase2: number, x: number, y: number, z: number): number => {
    const q00 = quadrics[qBase1 + 0] + quadrics[qBase2 + 0];
    const q01 = quadrics[qBase1 + 1] + quadrics[qBase2 + 1];
    const q02 = quadrics[qBase1 + 2] + quadrics[qBase2 + 2];
    const q03 = quadrics[qBase1 + 3] + quadrics[qBase2 + 3];
    const q11 = quadrics[qBase1 + 4] + quadrics[qBase2 + 4];
    const q12 = quadrics[qBase1 + 5] + quadrics[qBase2 + 5];
    const q13 = quadrics[qBase1 + 6] + quadrics[qBase2 + 6];
    const q22 = quadrics[qBase1 + 7] + quadrics[qBase2 + 7];
    const q23 = quadrics[qBase1 + 8] + quadrics[qBase2 + 8];
    const q33 = quadrics[qBase1 + 9] + quadrics[qBase2 + 9];
    return (
      q00 * x * x +
      2 * q01 * x * y +
      2 * q02 * x * z +
      2 * q03 * x +
      q11 * y * y +
      2 * q12 * y * z +
      2 * q13 * y +
      q22 * z * z +
      2 * q23 * z +
      q33
    );
  };

  const edgeUseCount = new Map<string, { count: number; fIdx: number; u: number; v: number }>();
  for (let fIdx = 0; fIdx < faces.length; fIdx++) {
    const f = faces[fIdx];
    const p0 = pts[f.v0], p1 = pts[f.v1], p2 = pts[f.v2];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-8) continue;
    const a = cx / len, b = cy / len, c = cz / len;
    const d = -(a * p0[0] + b * p0[1] + c * p0[2]);
    const areaWeight = Math.max(0.1, len * 0.5);
    addPlaneQuadric(f.v0, a, b, c, d, areaWeight);
    addPlaneQuadric(f.v1, a, b, c, d, areaWeight);
    addPlaneQuadric(f.v2, a, b, c, d, areaWeight);

    const pairs: [number, number][] = [
      [f.v0, f.v1],
      [f.v1, f.v2],
      [f.v2, f.v0],
    ];
    for (const [u, v] of pairs) {
      const k = u < v ? `${u},${v}` : `${v},${u}`;
      const existing = edgeUseCount.get(k);
      if (existing) existing.count++;
      else edgeUseCount.set(k, { count: 1, fIdx, u, v });
    }
  }

  // Add boundary preservation planes for open edges (count === 1)
  for (const entry of edgeUseCount.values()) {
    if (entry.count === 1) {
      const f = faces[entry.fIdx];
      const p0 = pts[f.v0], p1 = pts[f.v1], p2 = pts[f.v2];
      const fn = normalizeVec3(
        (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]),
        (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]),
        (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]),
      );
      const pu = pts[entry.u], pv = pts[entry.v];
      const ex = pv[0] - pu[0], ey = pv[1] - pu[1], ez = pv[2] - pu[2];
      const bn = normalizeVec3(
        ey * fn[2] - ez * fn[1],
        ez * fn[0] - ex * fn[2],
        ex * fn[1] - ey * fn[0],
      );
      const bd = -(bn[0] * pu[0] + bn[1] * pu[1] + bn[2] * pu[2]);
      addPlaneQuadric(entry.u, bn[0], bn[1], bn[2], bd, 50.0);
      addPlaneQuadric(entry.v, bn[0], bn[1], bn[2], bd, 50.0);
    }
  }

  const activeFaces: (RawCollisionTriangle | null)[] = faces.map((f) => ({ ...f }));
  let aliveFaceCount = activeFaces.length;
  const vFaces: Set<number>[] = Array.from({ length: vCount }, () => new Set<number>());
  for (let i = 0; i < activeFaces.length; i++) {
    const f = activeFaces[i]!;
    vFaces[f.v0].add(i);
    vFaces[f.v1].add(i);
    vFaces[f.v2].add(i);
  }

  const parent = new Int32Array(vCount);
  for (let i = 0; i < vCount; i++) parent[i] = i;
  const findRoot = (u: number): number => {
    let r = u;
    while (parent[r] !== r) r = parent[r];
    let c = u;
    while (c !== r) {
      const nxt = parent[c];
      parent[c] = r;
      c = nxt;
    }
    return r;
  };

  // Iterative greedy pass over candidate edges sorted by QEM error
  const maxPasses = 12;
  for (let pass = 0; pass < maxPasses && aliveFaceCount > targetFaceCount; pass++) {
    interface EdgeCandidate {
      u: number;
      v: number;
      cost: number;
      bestPos: [number, number, number];
    }
    const candidates: EdgeCandidate[] = [];
    const seenEdge = new Set<string>();

    for (let fIdx = 0; fIdx < activeFaces.length; fIdx++) {
      const f = activeFaces[fIdx];
      if (!f) continue;
      const vs = [findRoot(f.v0), findRoot(f.v1), findRoot(f.v2)];
      f.v0 = vs[0];
      f.v1 = vs[1];
      f.v2 = vs[2];
      if (f.v0 === f.v1 || f.v1 === f.v2 || f.v2 === f.v0) {
        activeFaces[fIdx] = null;
        aliveFaceCount--;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const a = vs[k];
        const b = vs[(k + 1) % 3];
        const u = Math.min(a, b);
        const v = Math.max(a, b);
        const key = `${u},${v}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);

        const pu = pts[u], pv = pts[v];
        const mx = (pu[0] + pv[0]) * 0.5;
        const my = (pu[1] + pv[1]) * 0.5;
        const mz = (pu[2] + pv[2]) * 0.5;
        const qbU = u * 10, qbV = v * 10;
        const cU = evalQuadric(qbU, qbV, pu[0], pu[1], pu[2]);
        const cV = evalQuadric(qbU, qbV, pv[0], pv[1], pv[2]);
        const cM = evalQuadric(qbU, qbV, mx, my, mz);
        const edgeLen2 = (pu[0] - pv[0]) ** 2 + (pu[1] - pv[1]) ** 2 + (pu[2] - pv[2]) ** 2;
        let bestCost = cU;
        let bestPos: [number, number, number] = [pu[0], pu[1], pu[2]];
        if (cV < bestCost) {
          bestCost = cV;
          bestPos = [pv[0], pv[1], pv[2]];
        }
        if (cM < bestCost) {
          bestCost = cM;
          bestPos = [mx, my, mz];
        }
        candidates.push({
          u,
          v,
          cost: Math.max(0, bestCost) + edgeLen2 * 1e-4,
          bestPos,
        });
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.cost - b.cost);

    const lockedVertex = new Uint8Array(vCount);
    let collapsedInPass = 0;

    for (const cand of candidates) {
      if (aliveFaceCount <= targetFaceCount) break;
      const u = findRoot(cand.u);
      const v = findRoot(cand.v);
      if (u === v || lockedVertex[u] || lockedVertex[v]) continue;

      // Check that collapsing v -> u does not flip normal of incident faces
      let flipsNormal = false;
      for (const fIdx of vFaces[u]) {
        const f = activeFaces[fIdx];
        if (!f) continue;
        const v0 = findRoot(f.v0), v1 = findRoot(f.v1), v2 = findRoot(f.v2);
        if (v0 === v || v1 === v || v2 === v) continue;
        const p0 = v0 === u ? cand.bestPos : pts[v0];
        const p1 = v1 === u ? cand.bestPos : pts[v1];
        const p2 = v2 === u ? cand.bestPos : pts[v2];
        const o0 = pts[v0], o1 = pts[v1], o2 = pts[v2];
        const ox = (o1[1] - o0[1]) * (o2[2] - o0[2]) - (o1[2] - o0[2]) * (o2[1] - o0[1]);
        const oy = (o1[2] - o0[2]) * (o2[0] - o0[0]) - (o1[0] - o0[0]) * (o2[2] - o0[2]);
        const oz = (o1[0] - o0[0]) * (o2[1] - o0[1]) - (o1[1] - o0[1]) * (o2[0] - o0[0]);
        const nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
        const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
        const nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
        const oLen = Math.hypot(ox, oy, oz);
        const nLen = Math.hypot(nx, ny, nz);
        if (nLen < 1e-6 || (oLen > 1e-6 && (ox * nx + oy * ny + oz * nz) / (oLen * nLen) < 0.2)) {
          flipsNormal = true;
          break;
        }
      }
      if (flipsNormal) continue;

      for (const fIdx of vFaces[v]) {
        const f = activeFaces[fIdx];
        if (!f) continue;
        const v0 = findRoot(f.v0), v1 = findRoot(f.v1), v2 = findRoot(f.v2);
        if (v0 === u || v1 === u || v2 === u) continue;
        const p0 = v0 === v ? cand.bestPos : pts[v0];
        const p1 = v1 === v ? cand.bestPos : pts[v1];
        const p2 = v2 === v ? cand.bestPos : pts[v2];
        const o0 = pts[v0], o1 = pts[v1], o2 = pts[v2];
        const ox = (o1[1] - o0[1]) * (o2[2] - o0[2]) - (o1[2] - o0[2]) * (o2[1] - o0[1]);
        const oy = (o1[2] - o0[2]) * (o2[0] - o0[0]) - (o1[0] - o0[0]) * (o2[2] - o0[2]);
        const oz = (o1[0] - o0[0]) * (o2[1] - o0[1]) - (o1[1] - o0[1]) * (o2[0] - o0[0]);
        const nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
        const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
        const nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
        const oLen = Math.hypot(ox, oy, oz);
        const nLen = Math.hypot(nx, ny, nz);
        if (nLen < 1e-6 || (oLen > 1e-6 && (ox * nx + oy * ny + oz * nz) / (oLen * nLen) < 0.2)) {
          flipsNormal = true;
          break;
        }
      }
      if (flipsNormal) continue;

      // Collapse v into u
      pts[u] = cand.bestPos;
      parent[v] = u;
      for (let k = 0; k < 10; k++) {
        quadrics[u * 10 + k] += quadrics[v * 10 + k];
      }
      for (const fIdx of vFaces[v]) {
        const f = activeFaces[fIdx];
        if (!f) continue;
        f.v0 = findRoot(f.v0);
        f.v1 = findRoot(f.v1);
        f.v2 = findRoot(f.v2);
        if (f.v0 === f.v1 || f.v1 === f.v2 || f.v2 === f.v0) {
          activeFaces[fIdx] = null;
          vFaces[u].delete(fIdx);
          aliveFaceCount--;
        } else {
          vFaces[u].add(fIdx);
        }
      }
      vFaces[v].clear();
      lockedVertex[u] = 1;
      lockedVertex[v] = 1;
      collapsedInPass++;
    }

    if (collapsedInPass === 0) break;
  }

  // Compact surviving vertices and faces
  const newPositions: [number, number, number][] = [];
  const compactMap = new Map<number, number>();
  const getCompactIdx = (oldV: number): number => {
    const r = findRoot(oldV);
    let idx = compactMap.get(r);
    if (idx === undefined) {
      idx = newPositions.length;
      newPositions.push(pts[r]);
      compactMap.set(r, idx);
    }
    return idx;
  };

  const survivingFaces: RawCollisionTriangle[] = [];
  for (const f of activeFaces) {
    if (!f) continue;
    const v0 = getCompactIdx(f.v0);
    const v1 = getCompactIdx(f.v1);
    const v2 = getCompactIdx(f.v2);
    if (v0 === v1 || v1 === v2 || v2 === v0) continue;
    survivingFaces.push({
      v0,
      v1,
      v2,
      materialSlotIndex: f.materialSlotIndex,
      groupId: f.groupId,
    });
  }

  return survivingFaces.length >= 4
    ? { positions: newPositions, faces: survivingFaces }
    : { positions, faces };
}

interface CollisionConvexPolygon {
  ring: number[]; // 3..8 vertex indices in CCW order around `planes[planeIdx]`
  planeIdx: number;
  materialIndex: number;
}

/**
 * Stage 1C: Coplanar Convex Polygon Merging (Blender "Limited Dissolve" equivalent).
 * Merges adjacent coplanar triangles sharing an edge and material into convex polygons
 * with up to 8 edges (`MAXIMUM_EDGES_PER_COLLISION_SURFACE = 8` in `collision_bsp.c`).
 */
function mergeCoplanarConvexPolygons(
  positions: [number, number, number][],
  polys: CollisionConvexPolygon[],
  planes: [number, number, number, number][],
): CollisionConvexPolygon[] {
  const MAX_EDGES = 8; // Halo CE MAXIMUM_EDGES_PER_COLLISION_SURFACE

  const isRingStrictlyConvexIn2d = (ring: number[], planeIdx: number): boolean => {
    if (ring.length < 3 || ring.length > MAX_EDGES) return false;
    const pl = planes[planeIdx];
    const { axis, sign } = getHaloPlaneProjection(pl, false);
    const pts2d = ring.map((vIdx) => projectHaloPoint3dTo2d(positions[vIdx], axis, sign));
    const n = pts2d.length;
    for (let i = 0; i < n; i++) {
      const pPrev = pts2d[(i + n - 1) % n];
      const pCurr = pts2d[i];
      const pNext = pts2d[(i + 1) % n];
      // In Halo's 2D projection, `cross_product2d(point - p0, p1 - p0) <= 0` for interior points.
      // Specifically, for consecutive edges e1 = pCurr - pPrev, e2 = pNext - pCurr:
      // cross2d(pNext - pPrev, pCurr - pPrev) must be < -1e-6 for strict convexity without collinearity.
      const v0x = pNext[0] - pPrev[0];
      const v0y = pNext[1] - pPrev[1];
      const v1x = pCurr[0] - pPrev[0];
      const v1y = pCurr[1] - pPrev[1];
      const cross = v0x * v1y - v0y * v1x;
      if (cross >= -1e-5) {
        return false;
      }
    }
    return true;
  };

  // Group polygons by (planeIdx, materialIndex)
  const byPlaneMat = new Map<string, CollisionConvexPolygon[]>();
  for (const poly of polys) {
    const key = `${poly.planeIdx}:${poly.materialIndex}`;
    let list = byPlaneMat.get(key);
    if (!list) {
      list = [];
      byPlaneMat.set(key, list);
    }
    list.push({ ring: [...poly.ring], planeIdx: poly.planeIdx, materialIndex: poly.materialIndex });
  }

  const result: CollisionConvexPolygon[] = [];
  for (const groupPolys of byPlaneMat.values()) {
    let changed = true;
    while (changed && groupPolys.length > 1) {
      changed = false;
      outer: for (let i = 0; i < groupPolys.length; i++) {
        const polyA = groupPolys[i];
        if (polyA.ring.length >= MAX_EDGES) continue;
        for (let j = i + 1; j < groupPolys.length; j++) {
          const polyB = groupPolys[j];
          if (polyA.ring.length + polyB.ring.length - 2 > MAX_EDGES) continue;

          // Find a shared opposite directed edge: A has (u -> v), B has (v -> u)
          const nA = polyA.ring.length;
          const nB = polyB.ring.length;
          for (let ea = 0; ea < nA; ea++) {
            const u = polyA.ring[ea];
            const v = polyA.ring[(ea + 1) % nA];
            for (let eb = 0; eb < nB; eb++) {
              if (polyB.ring[eb] === v && polyB.ring[(eb + 1) % nB] === u) {
                // Splice rings: A[0..ea], B[(eb+2)..(eb+nB-1)], A[(ea+1)..(nA-1)]
                const mergedRing: number[] = [];
                for (let k = 0; k <= ea; k++) mergedRing.push(polyA.ring[k]);
                for (let k = 2; k < nB; k++) mergedRing.push(polyB.ring[(eb + k) % nB]);
                for (let k = ea + 1; k < nA; k++) mergedRing.push(polyA.ring[k]);

                // Ensure no duplicate vertices in mergedRing (handles hole-pinching)
                if (new Set(mergedRing).size === mergedRing.length && isRingStrictlyConvexIn2d(mergedRing, polyA.planeIdx)) {
                  polyA.ring = mergedRing;
                  groupPolys.splice(j, 1);
                  changed = true;
                  break outer;
                }
              }
            }
          }
        }
      }
    }
    result.push(...groupPolys);
  }

  return result;
}

/**
 * Builds a 2D BSP tree (`bsp2d_nodes`) on a single 3D plane (`planeDesignator`) when multiple
 * convex surfaces share that plane. Uses Halo CE's exact 2D edge-line equation from `real_math.h`
 * (`plane2d_from_points`) and `bsp2d.c` (`bsp2d_test_point`).
 */
function buildPlaneBsp2dTree(
  surfaceIndices: number[],
  surfaces: { ring: number[] }[],
  positions: [number, number, number][],
  plane: [number, number, number, number],
  designatorNegated: boolean,
  bsp2dNodes: Bsp2dNodeEntry[],
): number {
  if (surfaceIndices.length === 0) return 0xffffffff;
  if (surfaceIndices.length === 1) {
    return (0x80000000 | surfaceIndices[0]) >>> 0;
  }

  const { axis, sign } = getHaloPlaneProjection(plane, designatorNegated);
  const poly2dMap = new Map<number, [number, number][]>();
  const centroid2dMap = new Map<number, [number, number]>();

  for (const sIdx of surfaceIndices) {
    const ring = surfaces[sIdx].ring;
    const pts2d = ring.map((vIdx) => {
      const p2d = projectHaloPoint3dTo2d(positions[vIdx], axis, sign);
      return p2d;
    });
    // If designatorNegated, reverse ring order so polygon is CCW in the negated 2D projection
    if (designatorNegated) pts2d.reverse();
    poly2dMap.set(sIdx, pts2d);
    let cx = 0, cy = 0;
    for (const p of pts2d) {
      cx += p[0];
      cy += p[1];
    }
    centroid2dMap.set(sIdx, [cx / pts2d.length, cy / pts2d.length]);
  }

  const MAX_BSP2D_DEPTH = 30; // Halo CE MAXIMUM_BSP2D_TRAVERSAL_DEPTH is 32

  const build2dRecursive = (sList: number[], depth: number): number => {
    if (sList.length === 1 || depth >= MAX_BSP2D_DEPTH || bsp2dNodes.length >= 65535) {
      return (0x80000000 | sList[0]) >>> 0;
    }

    // Try to find a separating 2D edge line from one of the polygons in `sList`
    let bestLine: { ni: number; nj: number; d: number } | null = null;
    let bestLeft: number[] = [];
    let bestRight: number[] = [];
    let bestScore = Infinity;

    for (const candSurf of sList) {
      const pts = poly2dMap.get(candSurf)!;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % pts.length];
        // From real_math.h `plane2d_from_points`:
        // ni = p1.y - p0.y, nj = p0.x - p1.x
        // For a CCW polygon in Halo's 2D projection, `candSurf` itself has distance <= 0 (leftChild).
        const rawNi = p1[1] - p0[1];
        const rawNj = p0[0] - p1[0];
        const len = Math.hypot(rawNi, rawNj);
        if (len < 1e-6) continue;
        const ni = rawNi / len;
        const nj = rawNj / len;
        const d = ni * p0[0] + nj * p0[1];

        const left: number[] = [];
        const right: number[] = [];
        let straddleCount = 0;
        for (const otherSurf of sList) {
          if (otherSurf === candSurf) {
            left.push(otherSurf);
            continue;
          }
          const oPts = poly2dMap.get(otherSurf)!;
          let minDist = Infinity;
          let maxDist = -Infinity;
          for (const op of oPts) {
            const dist = ni * op[0] + nj * op[1] - d;
            if (dist < minDist) minDist = dist;
            if (dist > maxDist) maxDist = dist;
          }
          if (maxDist <= 1e-4) {
            left.push(otherSurf);
          } else if (minDist >= -1e-4) {
            right.push(otherSurf);
          } else {
            // Polygon straddles the 2D splitting line: insert into BOTH left and right subtrees
            // (matching Guilty Spark's `bsp_compile.rs` / `bsp2d.c`) so neither side has a collision hole!
            left.push(otherSurf);
            right.push(otherSurf);
            straddleCount++;
          }
        }

        // Only accept a split if it strictly reduces both children below `sList.length`
        if (
          left.length > 0 &&
          right.length > 0 &&
          left.length < sList.length &&
          right.length < sList.length
        ) {
          const score = Math.abs(left.length - right.length) + straddleCount * 2;
          if (score < bestScore) {
            bestScore = score;
            bestLine = { ni, nj, d };
            bestLeft = left;
            bestRight = right;
            if (score <= 1) break;
          }
        }
      }
      if (bestScore <= 1) break;
    }

    // Fallback: axis-aligned 2D median split if no edge line strictly reduced both sides
    if (!bestLine || bestLeft.length === 0 || bestRight.length === 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const sIdx of sList) {
        const [cx, cy] = centroid2dMap.get(sIdx)!;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      const splitX = (maxX - minX) >= (maxY - minY);
      const sorted = [...sList].sort((a, b) => {
        const ca = centroid2dMap.get(a)!;
        const cb = centroid2dMap.get(b)!;
        return splitX ? ca[0] - cb[0] : ca[1] - cb[1];
      });
      const mid = Math.max(1, Math.floor(sorted.length / 2));
      const cA = centroid2dMap.get(sorted[mid - 1])!;
      const cB = centroid2dMap.get(sorted[mid])!;
      const splitVal = splitX ? (cA[0] + cB[0]) * 0.5 : (cA[1] + cB[1]) * 0.5;
      bestLine = splitX
        ? { ni: 1, nj: 0, d: splitVal }
        : { ni: 0, nj: 1, d: splitVal };

      // Classify against the axis-aligned split line, duplicating straddling polygons when doing so still reduces both sides
      const candLeft: number[] = [];
      const candRight: number[] = [];
      for (const sIdx of sorted) {
        const oPts = poly2dMap.get(sIdx)!;
        let minD = Infinity;
        let maxD = -Infinity;
        for (const op of oPts) {
          const dist = bestLine.ni * op[0] + bestLine.nj * op[1] - bestLine.d;
          if (dist < minD) minD = dist;
          if (dist > maxD) maxD = dist;
        }
        if (maxD <= 1e-4) candLeft.push(sIdx);
        else if (minD >= -1e-4) candRight.push(sIdx);
        else {
          candLeft.push(sIdx);
          candRight.push(sIdx);
        }
      }
      if (
        candLeft.length > 0 &&
        candRight.length > 0 &&
        candLeft.length < sList.length &&
        candRight.length < sList.length
      ) {
        bestLeft = candLeft;
        bestRight = candRight;
      } else {
        bestLeft = sorted.slice(0, mid);
        bestRight = sorted.slice(mid);
      }
    }

    const nodeIdx = bsp2dNodes.length;
    bsp2dNodes.push({
      planeI: bestLine.ni,
      planeJ: bestLine.nj,
      planeD: bestLine.d,
      leftChild: 0xffffffff,
      rightChild: 0xffffffff,
    });

    const leftChild = build2dRecursive(bestLeft, depth + 1);
    const rightChild = build2dRecursive(bestRight, depth + 1);
    bsp2dNodes[nodeIdx].leftChild = leftChild >>> 0;
    bsp2dNodes[nodeIdx].rightChild = rightChild >>> 0;
    return nodeIdx;
  };

  return build2dRecursive(surfaceIndices, 0);
}

/**
 * Coplanar diagonal flipper ported from Guilty Spark (`bsp_triangulate.rs:51-112`).
 * Finds pairs of triangles sharing an internal edge that are coplanar (normal dot > 0.9999),
 * checks if the quad is strictly convex, and flips the shared diagonal if doing so improves
 * minimum triangle compactness (`area / perimeter^2`), eliminating sliver/needle triangles
 * before BSP plane construction.
 */
function improveCoplanarDiagonals(
  positions: [number, number, number][],
  faces: { v0: number; v1: number; v2: number; materialSlotIndex: number }[],
): { v0: number; v1: number; v2: number; materialSlotIndex: number }[] {
  const out = faces.map((f) => ({ ...f }));
  if (out.length < 2 || out.length > 16384) return out;

  const triQuality = (a: number, b: number, c: number): { quality: number; nx: number; ny: number; nz: number } => {
    const p0 = positions[a], p1 = positions[b], p2 = positions[c];
    if (!p0 || !p1 || !p2) return { quality: 0, nx: 0, ny: 0, nz: 0 };
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const wx = p2[0] - p1[0], wy = p2[1] - p1[1], wz = p2[2] - p1[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area2 = Math.hypot(cx, cy, cz);
    if (area2 < 1e-7) return { quality: 0, nx: 0, ny: 0, nz: 0 };
    const perim = Math.hypot(ux, uy, uz) + Math.hypot(vx, vy, vz) + Math.hypot(wx, wy, wz);
    const quality = area2 / Math.max(1e-9, perim * perim);
    return { quality, nx: cx / area2, ny: cy / area2, nz: cz / area2 };
  };

  for (let pass = 0; pass < 2; pass++) {
    let flippedCount = 0;
    // Map undirected edge `min,max` -> first triangle index
    const edgeOwner = new Map<string, { tIdx: number; a: number; b: number; opp: number }>();
    const flippedInPass = new Uint8Array(out.length);

    for (let tIdx = 0; tIdx < out.length; tIdx++) {
      if (flippedInPass[tIdx]) continue;
      const f = out[tIdx];
      const edges: [number, number, number][] = [
        [f.v0, f.v1, f.v2],
        [f.v1, f.v2, f.v0],
        [f.v2, f.v0, f.v1],
      ];
      for (const [a, b, opp] of edges) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const prev = edgeOwner.get(key);
        if (!prev) {
          edgeOwner.set(key, { tIdx, a, b, opp });
          continue;
        }
        const tA = prev.tIdx;
        if (flippedInPass[tA] || flippedInPass[tIdx]) continue;
        if (out[tA].materialSlotIndex !== f.materialSlotIndex) continue;
        // Must share the edge in opposite winding order: prev has (a -> b), current has (b -> a)
        if (prev.a !== b || prev.b !== a) continue;
        const oppA = prev.opp;
        const oppB = opp;
        if (oppA === oppB || oppA === a || oppA === b || oppB === a || oppB === b) continue;

        const qCurr1 = triQuality(prev.a, prev.b, oppA);
        const qCurr2 = triQuality(a, b, oppB);
        if (qCurr1.quality <= 0 || qCurr2.quality <= 0) continue;

        const dot = qCurr1.nx * qCurr2.nx + qCurr1.ny * qCurr2.ny + qCurr1.nz * qCurr2.nz;
        if (dot < 0.9999) continue; // Only flip strictly coplanar triangles

        // Candidate flipped triangles: (oppA, prev.a, oppB) and (oppB, prev.b, oppA)
        const qFlip1 = triQuality(oppA, prev.a, oppB);
        const qFlip2 = triQuality(oppB, prev.b, oppA);
        if (qFlip1.quality <= 0 || qFlip2.quality <= 0) continue;

        // Verify flipped triangles preserve the exact same plane normal (convex quad check)
        const dot1 = qFlip1.nx * qCurr1.nx + qFlip1.ny * qCurr1.ny + qFlip1.nz * qCurr1.nz;
        const dot2 = qFlip2.nx * qCurr1.nx + qFlip2.ny * qCurr1.ny + qFlip2.nz * qCurr1.nz;
        if (dot1 < 0.9999 || dot2 < 0.9999) continue;

        const minCurr = Math.min(qCurr1.quality, qCurr2.quality);
        const minFlip = Math.min(qFlip1.quality, qFlip2.quality);
        if (minFlip > minCurr * 1.05) {
          out[tA] = { v0: oppA, v1: prev.a, v2: oppB, materialSlotIndex: f.materialSlotIndex };
          out[tIdx] = { v0: oppB, v1: prev.b, v2: oppA, materialSlotIndex: f.materialSlotIndex };
          flippedInPass[tA] = 1;
          flippedInPass[tIdx] = 1;
          flippedCount++;
          break;
        }
      }
    }
    if (flippedCount === 0) break;
  }

  return out;
}

/**
 * Compiles an arbitrary 3D `.OBJ` mesh (convex or concave, including arches, tunnels, hollow buildings,
 * sloped bridges, ramps, or high-poly models) into a Halo CE `ModelCollisionGeometryBSP` structure
 * verified against OpenCE's `collision_bsp.c` and `bsp2d.c`.
 *
 * Implements the 4-stage "Blender-Workflow-in-a-Box" pipeline:
 * 1. 3D Vertex Welding (`Merge by Distance` at `1e-4` units).
 * 2. Automatic Quadric Error Metric (QEM) Edge-Collapse Decimation (`decimateCollisionMeshQem`)
 *    when the input mesh exceeds `targetFaces` (removing the old 512-triangle box fallback cliff!).
 * 3. Coplanar Convex Polygon Merging (`Limited Dissolve` up to 8 edges per surface).
 * 4. Exact 3D & 2D BSP Compilation (`bsp3d_nodes` + `bsp2d_nodes` + winged-edge topology +
 *    two-sided surface/leaf flags on concave meshes to eliminate invisible "ghost walls").
 */
export function compileMeshCollisionBspData(
  mesh: ParsedObjMesh,
  materialCount: number,
  options?: {
    mode?: CustomObjectCollisionMode;
    targetFaces?: number;
  },
): CompiledMeshCollisionBsp | null {
  const mode: CustomObjectCollisionMode = options?.mode ?? 'auto';
  if (mode === 'box' || mesh.rawPositions.length < 3 || mesh.rawFaces.length === 0) {
    return null;
  }

  const inputTriangleCount = mesh.rawFaces.length;
  // In 'exact' mode, preserve a true 1:1 copy of every triangle in the .OBJ file up to Halo CE's int16 limit (32,760 faces).
  const maxFaceBudget =
    mode === 'exact'
      ? 32760
      : Math.max(64, Math.min(32760, options?.targetFaces ?? 4096));

  // Stage 1A: Weld UV/normal-split seams by 3D position
  const welded = weldCollisionPositions(mesh.rawPositions, mesh.rawFaces, 1e-4);
  if (welded.positions.length < 3 || welded.faces.length === 0) {
    return null;
  }

  // Stage 1B: QEM Edge-Collapse Decimation if above face budget, followed by Guilty Spark's
  // coplanar diagonal flipping (`improveCoplanarDiagonals`) to eliminate needle/sliver triangles
  const decimated =
    welded.faces.length > maxFaceBudget
      ? decimateCollisionMeshQem(welded.positions, welded.faces, maxFaceBudget)
      : welded;

  const positions = decimated.positions;
  const activeFaces = improveCoplanarDiagonals(positions, decimated.faces);

  const planes: [number, number, number, number][] = [];
  const findOrAddPlane = (nx: number, ny: number, nz: number, d: number): { planeIdx: number; negated: boolean } => {
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      if (
        Math.abs(p[0] - nx) < 1e-4 &&
        Math.abs(p[1] - ny) < 1e-4 &&
        Math.abs(p[2] - nz) < 1e-4 &&
        Math.abs(p[3] - d) < 1e-3
      ) {
        return { planeIdx: i, negated: false };
      }
      if (
        Math.abs(p[0] + nx) < 1e-4 &&
        Math.abs(p[1] + ny) < 1e-4 &&
        Math.abs(p[2] + nz) < 1e-4 &&
        Math.abs(p[3] + d) < 1e-3
      ) {
        return { planeIdx: i, negated: true };
      }
    }
    const idx = planes.length;
    planes.push([nx, ny, nz, d]);
    return { planeIdx: idx, negated: false };
  };

  // Build initial triangle polygons with deduplicated planes
  const initialPolys: CollisionConvexPolygon[] = [];
  const planeBySurfaceDesignator: [number, number, number, number][] = [];
  const findOrAddDirectedPlane = (nx: number, ny: number, nz: number, d: number): number => {
    for (let i = 0; i < planeBySurfaceDesignator.length; i++) {
      const p = planeBySurfaceDesignator[i];
      if (
        Math.abs(p[0] - nx) < 1e-4 &&
        Math.abs(p[1] - ny) < 1e-4 &&
        Math.abs(p[2] - nz) < 1e-4 &&
        Math.abs(p[3] - d) < 1e-3
      ) {
        return i;
      }
    }
    const idx = planeBySurfaceDesignator.length;
    planeBySurfaceDesignator.push([nx, ny, nz, d]);
    return idx;
  };

  for (const face of activeFaces) {
    const p0 = positions[face.v0];
    const p1 = positions[face.v1];
    const p2 = positions[face.v2];
    if (!p0 || !p1 || !p2) continue;

    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area2 = Math.hypot(cx, cy, cz);
    if (area2 < 1e-6) continue;

    const nx = cx / area2;
    const ny = cy / area2;
    const nz = cz / area2;
    const d = nx * p0[0] + ny * p0[1] + nz * p0[2];
    const dirPlaneIdx = findOrAddDirectedPlane(nx, ny, nz, d);
    const pl = planeBySurfaceDesignator[dirPlaneIdx];
    const winding = cx * pl[0] + cy * pl[1] + cz * pl[2];
    const ring = winding >= 0 ? [face.v0, face.v1, face.v2] : [face.v0, face.v2, face.v1];
    const matIdx = Math.max(0, Math.min(materialCount - 1, face.materialSlotIndex));
    initialPolys.push({ ring, planeIdx: dirPlaneIdx, materialIndex: matIdx });
  }

  if (initialPolys.length === 0) {
    return null;
  }

  // Stage 1C: Coplanar Convex Polygon Merging (Limited Dissolve up to 8 edges) in 'auto' mode,
  // or keep a true 1:1 triangle-for-triangle copy of the .OBJ faces in 'exact' mode!
  const mergedPolys =
    mode === 'exact'
      ? initialPolys
      : mergeCoplanarConvexPolygons(positions, initialPolys, planeBySurfaceDesignator);

  // Map each merged polygon's directed plane into `planes` (using `0x80000000 | planeIdx` if opposite to an existing plane)
  const dirPlaneToDesignator = new Int32Array(planeBySurfaceDesignator.length);
  for (let i = 0; i < planeBySurfaceDesignator.length; i++) {
    const dp = planeBySurfaceDesignator[i];
    const { planeIdx, negated } = findOrAddPlane(dp[0], dp[1], dp[2], dp[3]);
    dirPlaneToDesignator[i] = negated ? ((0x80000000 | planeIdx) | 0) : planeIdx;
  }

  // Check if the mesh is strictly convex (every polygon lies on or behind all other polygons' outward planes)
  let isConcave = false;
  outerConvexCheck: for (let i = 0; i < mergedPolys.length; i++) {
    const dp = planeBySurfaceDesignator[mergedPolys[i].planeIdx];
    for (let v = 0; v < positions.length; v++) {
      const pt = positions[v];
      const dist = dp[0] * pt[0] + dp[1] * pt[1] + dp[2] * pt[2] - dp[3];
      if (dist > 1e-3) {
        isConcave = true;
        break outerConvexCheck;
      }
    }
  }

  // Build winged-edge topology (`surfaces`, `edges`, `vertices`) supporting 3..8 edges per surface
  const surfaceFlags = isConcave ? 0x01 : 0x00; // 0x01 = _collision_surface_two_sided_bit
  const surfaces: { planeDesignator: number; firstEdgeIndex: number; flags: number; materialIndex: number; ring: number[] }[] = [];
  const edges: { vertexIndices: [number, number]; edgeIndices: [number, number]; surfaceIndices: [number, number] }[] = [];
  const vertexFirstEdge = new Array<number>(positions.length).fill(-1);
  const openHalfEdgeMap = new Map<string, number>();

  for (let surfIdx = 0; surfIdx < mergedPolys.length; surfIdx++) {
    const poly = mergedPolys[surfIdx];
    const designator = dirPlaneToDesignator[poly.planeIdx] >>> 0;
    const ring = poly.ring;
    const n = ring.length;
    const ringEdges = new Array<number>(n);

    for (let point = 0; point < n; point++) {
      const from = ring[point];
      const to = ring[(point + 1) % n];
      const revKey = `${to},${from}`;
      let edgeIndex = openHalfEdgeMap.get(revKey) ?? -1;

      if (edgeIndex !== -1 && edges[edgeIndex].surfaceIndices[1] === -1) {
        edges[edgeIndex].surfaceIndices[1] = surfIdx;
        openHalfEdgeMap.delete(revKey);
      } else {
        edgeIndex = edges.length;
        edges.push({
          vertexIndices: [from, to],
          edgeIndices: [-1, -1],
          surfaceIndices: [surfIdx, -1],
        });
        const fwdKey = `${from},${to}`;
        if (!openHalfEdgeMap.has(fwdKey)) {
          openHalfEdgeMap.set(fwdKey, edgeIndex);
        }
      }

      if (vertexFirstEdge[from] === -1) {
        vertexFirstEdge[from] = edgeIndex;
      }
      ringEdges[point] = edgeIndex;
    }

    for (let point = 0; point < n; point++) {
      const edge = edges[ringEdges[point]];
      const side = edge.surfaceIndices[1] === surfIdx ? 1 : 0;
      edge.edgeIndices[side] = ringEdges[(point + 1) % n];
    }

    surfaces.push({
      planeDesignator: designator,
      firstEdgeIndex: ringEdges[0],
      flags: surfaceFlags,
      materialIndex: poly.materialIndex,
      ring,
    });
  }

  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e];
    const [v0, v1] = edge.vertexIndices;
    if (vertexFirstEdge[v0] === -1) vertexFirstEdge[v0] = e;
    if (vertexFirstEdge[v1] === -1) vertexFirstEdge[v1] = e;
    // Guarantee `edge_indices[0]` and `edge_indices[1]` are always valid in-bounds indices (>= 0)
    // so Halo CE's `bsp3d_test_pill` (`&bsp->edges[edge->edge_indices[side]]`) never reads `edges[-1]`.
    if (edge.edgeIndices[0] < 0) {
      edge.edgeIndices[0] = edge.edgeIndices[1] >= 0 ? edge.edgeIndices[1] : e;
    }
    if (edge.edgeIndices[1] < 0) {
      edge.edgeIndices[1] = edge.edgeIndices[0] >= 0 ? edge.edgeIndices[0] : e;
    }
    // If an edge is an open boundary (`surfaceIndices[1] === -1`), ensure its owning surface is marked two-sided
    if (edge.surfaceIndices[1] < 0 && edge.surfaceIndices[0] >= 0 && surfaces[edge.surfaceIndices[0]]) {
      surfaces[edge.surfaceIndices[0]].flags |= 0x01;
    }
  }

  const vertices = positions.map((pt, idx) => ({
    point: [pt[0], pt[1], pt[2]] as [number, number, number],
    firstEdgeIndex: vertexFirstEdge[idx] >= 0 ? vertexFirstEdge[idx] : 0,
  }));

  // Build 3D BSP tree (`bsp3dNodes`)
  interface ClipPoly {
    pts: [number, number, number][];
    planeIdx: number; // index into `planes` (0..planes.length-1)
    centroid: [number, number, number];
  }

  const EPS = 1e-4;
  const clipPolyAgainstPlane = (
    pts: [number, number, number][],
    plane: [number, number, number, number],
  ): { front: [number, number, number][] | null; back: [number, number, number][] | null; state: 'coplanar' | 'front' | 'back' | 'split' } => {
    let maxD = -Infinity;
    let minD = Infinity;
    const dists = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const d = plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] - plane[3];
      dists[i] = d;
      if (d > maxD) maxD = d;
      if (d < minD) minD = d;
    }
    if (Math.abs(maxD) <= EPS && Math.abs(minD) <= EPS) {
      return { front: null, back: null, state: 'coplanar' };
    }
    if (minD >= -EPS) {
      return { front: pts, back: null, state: 'front' };
    }
    if (maxD <= EPS) {
      return { front: null, back: pts, state: 'back' };
    }
    const frontPts: [number, number, number][] = [];
    const backPts: [number, number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const pA = pts[i], pB = pts[j];
      const dA = dists[i], dB = dists[j];
      if (dA >= -EPS) frontPts.push(pA);
      if (dA <= EPS) backPts.push(pA);
      if ((dA > EPS && dB < -EPS) || (dA < -EPS && dB > EPS)) {
        const t = dA / (dA - dB);
        const inter: [number, number, number] = [
          pA[0] + t * (pB[0] - pA[0]),
          pA[1] + t * (pB[1] - pA[1]),
          pA[2] + t * (pB[2] - pA[2]),
        ];
        frontPts.push(inter);
        backPts.push(inter);
      }
    }
    return {
      front: frontPts.length >= 3 ? frontPts : null,
      back: backPts.length >= 3 ? backPts : null,
      state: 'split',
    };
  };

  const computeCentroid = (pts: [number, number, number][]): [number, number, number] => {
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const inv = 1 / Math.max(1, pts.length);
    return [cx * inv, cy * inv, cz * inv];
  };

  const bsp3dNodes: [number, number, number][] = [];
  // For concave meshes, both empty sides of an open/concave splitting plane terminate at leaf 0 (`0x80000000`),
  // which has `_collision_leaf_contains_two_sided_bit = 0x01`, forcing `collision_bsp_test_vector` to set
  // `test_surface = TRUE` and test exact 2D polygon boundaries instead of hitting invisible infinite walls!
  const defaultBackLeaf = isConcave ? 0x80000000 : 0xffffffff;

  const buildTree = (polys: ClipPoly[], usedPlanes: Set<number>, depth: number): number => {
    if (polys.length === 0 || depth >= 64 || bsp3dNodes.length >= 32760) {
      return defaultBackLeaf;
    }

    const uniquePlanes: number[] = [];
    const seenP = new Set<number>();
    for (const p of polys) {
      if (!usedPlanes.has(p.planeIdx) && !seenP.has(p.planeIdx)) {
        seenP.add(p.planeIdx);
        uniquePlanes.push(p.planeIdx);
      }
    }
    if (uniquePlanes.length === 0) {
      return defaultBackLeaf;
    }

    // Sample up to 24 candidate planes to keep compilation fast even on 2,000-polygon meshes
    const step = Math.max(1, Math.floor(uniquePlanes.length / 24));
    let bestPlane = uniquePlanes[0];
    let bestScore = Infinity;

    for (let idx = 0; idx < uniquePlanes.length; idx += step) {
      const pIdx = uniquePlanes[idx];
      const pl = planes[pIdx];
      let frontCount = 0, backCount = 0, splitCount = 0;
      for (const poly of polys) {
        if (poly.planeIdx === pIdx) continue;
        const c = clipPolyAgainstPlane(poly.pts, pl);
        if (c.state === 'front') frontCount++;
        else if (c.state === 'back') backCount++;
        else if (c.state === 'split') splitCount++;
      }
      const horizBonus = depth < 6 && Math.abs(pl[2]) > 0.7 ? -90 : 0;
      const score = !isConcave && frontCount === 0 && splitCount === 0
        ? -1000 - backCount + horizBonus
        : splitCount * 3 + Math.abs(frontCount - backCount) + horizBonus;
      if (score < bestScore) {
        bestScore = score;
        bestPlane = pIdx;
      }
    }

    const pl = planes[bestPlane];
    const rawFrontList: ClipPoly[] = [];
    const rawBackList: ClipPoly[] = [];
    for (const poly of polys) {
      if (poly.planeIdx === bestPlane) continue;
      const c = clipPolyAgainstPlane(poly.pts, pl);
      if (c.state === 'front') {
        rawFrontList.push(poly);
      } else if (c.state === 'back') {
        rawBackList.push(poly);
      } else if (c.state === 'split') {
        // Always include straddling planes in BOTH subtrees so horizontal bridge decks, ramps, and street pads
        // are never dropped when vertical walls split the 3D space!
        if (c.front && c.front.length >= 3) {
          rawFrontList.push({ pts: c.front, planeIdx: poly.planeIdx, centroid: computeCentroid(c.front) });
        } else {
          rawFrontList.push(poly);
        }
        if (c.back && c.back.length >= 3) {
          rawBackList.push({ pts: c.back, planeIdx: poly.planeIdx, centroid: computeCentroid(c.back) });
        } else {
          rawBackList.push(poly);
        }
      }
    }

    // Deduplicate fragments sharing the same planeIdx once the list or depth grows so the 3D BSP stays compact
    // while 100% preserving every plane on both sides of every split
    const compactByPlane = (list: ClipPoly[]): ClipPoly[] => {
      if (depth < 6 && list.length <= 180) return list;
      const byPlane = new Map<number, ClipPoly>();
      for (const item of list) {
        const existing = byPlane.get(item.planeIdx);
        if (!existing || item.pts.length > existing.pts.length) {
          byPlane.set(item.planeIdx, item);
        }
      }
      return Array.from(byPlane.values());
    };
    const frontList = compactByPlane(rawFrontList);
    const backList = compactByPlane(rawBackList);

    const nodeIdx = bsp3dNodes.length;
    bsp3dNodes.push([bestPlane, defaultBackLeaf, 0x80000000]);

    const nextUsed = new Set(usedPlanes);
    nextUsed.add(bestPlane);

    const frontChild = frontList.length === 0
      ? 0x80000000
      : buildTree(frontList, nextUsed, depth + 1);
    const backChild = backList.length === 0
      ? defaultBackLeaf
      : buildTree(backList, nextUsed, depth + 1);

    bsp3dNodes[nodeIdx][1] = backChild >>> 0;
    bsp3dNodes[nodeIdx][2] = frontChild >>> 0;
    return nodeIdx;
  };

  const bspPolys: ClipPoly[] = surfaces.map((s) => {
    const pts = s.ring.map((vIdx) => positions[vIdx]);
    return {
      pts,
      planeIdx: (s.planeDesignator & 0x7fffffff) >>> 0,
      centroid: computeCentroid(pts),
    };
  });

  buildTree(bspPolys, new Set(), 0);
  if (bsp3dNodes.length === 0) {
    return null;
  }

  // Stage 3B: Build `bsp2dNodes` and `bsp2dReferences`
  const bsp2dNodes: Bsp2dNodeEntry[] = [];
  const bsp2dReferences: [number, number][] = [];

  if (!isConcave) {
    // Group surfaces by `planeDesignator` and build a 2D BSP tree per plane
    const byDesignator = new Map<number, number[]>();
    for (let sIdx = 0; sIdx < surfaces.length; sIdx++) {
      const des = surfaces[sIdx].planeDesignator >>> 0;
      let list = byDesignator.get(des);
      if (!list) {
        list = [];
        byDesignator.set(des, list);
      }
      list.push(sIdx);
    }
    for (const [designator, sIndices] of byDesignator.entries()) {
      const rawPlaneIdx = (designator & 0x7fffffff) >>> 0;
      const isNeg = (designator & 0x80000000) !== 0;
      const rootNode = buildPlaneBsp2dTree(
        sIndices,
        surfaces,
        positions,
        planes[rawPlaneIdx],
        isNeg,
        bsp2dNodes,
      );
      bsp2dReferences.push([designator >>> 0, rootNode >>> 0]);
    }
  } else {
    // For concave/open two-sided meshes:
    // Emit per-surface forward and reverse `bsp2d_references` so:
    // 1. `collision_leaf_test_vector` (with `test_surface = TRUE`) iterates every surface on `plane_index`
    //    and tests `collision_surface_test_point` against its exact 2D polygon boundary.
    // 2. `bsp3d_test_pill_recursive` & `bsp3d_test_sphere_recursive` match both `planeIdx` and `planeIdx | 0x80000000`
    //    in `data->plane_stack` and test every surface's interior, edges, and vertices!
    for (let sIdx = 0; sIdx < surfaces.length; sIdx++) {
      const rawPlaneIdx = (surfaces[sIdx].planeDesignator & 0x7fffffff) >>> 0;
      const leafSurfRef = (0x80000000 | sIdx) >>> 0;
      bsp2dReferences.push([rawPlaneIdx, leafSurfRef]);
      bsp2dReferences.push([(0x80000000 | rawPlaneIdx) >>> 0, leafSurfRef]);
    }
  }

  const leafFlags = isConcave ? 0x01 : 0x00; // 0x01 = _collision_leaf_contains_two_sided_bit
  const leaves: [number, number, number][] = [
    [leafFlags, bsp2dReferences.length, 0],
  ];

  const byteSize =
    bsp3dNodes.length * 12 +
    planes.length * 16 +
    leaves.length * 8 +
    bsp2dReferences.length * 8 +
    bsp2dNodes.length * 20 +
    surfaces.length * 12 +
    edges.length * 24 +
    vertices.length * 16;

  return {
    bsp3dNodes,
    planes,
    leaves,
    bsp2dReferences,
    bsp2dNodes,
    surfaces: surfaces.map(({ planeDesignator, firstEdgeIndex, flags, materialIndex }) => ({
      planeDesignator,
      firstEdgeIndex,
      flags,
      materialIndex,
    })),
    edges,
    vertices,
    byteSize,
    stats: {
      mode,
      inputTriangles: inputTriangleCount,
      weldedVertices: positions.length,
      decimatedTriangles: activeFaces.length,
      mergedSurfaces: surfaces.length,
      planes: planes.length,
      edges: edges.length,
      bsp3dNodes: bsp3dNodes.length,
      bsp2dNodes: bsp2dNodes.length,
      isConcave,
    },
  };
}

/**
 * Serializes a compiled 3D polyhedral mesh `ModelCollisionGeometryBSP` into `targetBuf` at `structOff`
 * (with child arrays written starting at `arraysOff`).
 */
function writeMeshCollisionBsp(
  targetBuf: Buffer,
  structOff: number,
  arraysOff: number,
  compiled: CompiledMeshCollisionBsp,
): number {
  let cursor = arraysOff;

  // 1. bsp3d_nodes: N * 12 bytes
  const offBsp3dNodes = cursor;
  for (const node of compiled.bsp3dNodes) {
    targetBuf.writeInt32LE(node[0], cursor + 0);
    targetBuf.writeUInt32LE(node[1] >>> 0, cursor + 4);
    targetBuf.writeUInt32LE(node[2] >>> 0, cursor + 8);
    cursor += 12;
  }

  // 2. planes: P * 16 bytes
  const offPlanes = cursor;
  for (const plane of compiled.planes) {
    targetBuf.writeFloatLE(plane[0], cursor + 0);
    targetBuf.writeFloatLE(plane[1], cursor + 4);
    targetBuf.writeFloatLE(plane[2], cursor + 8);
    targetBuf.writeFloatLE(plane[3], cursor + 12);
    cursor += 16;
  }

  // 3. leaves: L * 8 bytes
  const offLeaves = cursor;
  for (const leaf of compiled.leaves) {
    targetBuf.writeUInt16LE(leaf[0] & 0xffff, cursor + 0);
    targetBuf.writeUInt16LE(leaf[1] & 0xffff, cursor + 2);
    targetBuf.writeUInt32LE(leaf[2] >>> 0, cursor + 4);
    cursor += 8;
  }

  // 4. bsp2d_references: R * 8 bytes
  const offBsp2dRefs = cursor;
  for (const ref of compiled.bsp2dReferences) {
    targetBuf.writeUInt32LE(ref[0] >>> 0, cursor + 0);
    targetBuf.writeUInt32LE(ref[1] >>> 0, cursor + 4);
    cursor += 8;
  }

  // 5. bsp2d_nodes: B * 20 bytes
  const offBsp2dNodes = compiled.bsp2dNodes.length > 0 ? cursor : 0;
  for (const node2d of compiled.bsp2dNodes) {
    targetBuf.writeFloatLE(node2d.planeI, cursor + 0);
    targetBuf.writeFloatLE(node2d.planeJ, cursor + 4);
    targetBuf.writeFloatLE(node2d.planeD, cursor + 8);
    targetBuf.writeUInt32LE(node2d.leftChild >>> 0, cursor + 12);
    targetBuf.writeUInt32LE(node2d.rightChild >>> 0, cursor + 16);
    cursor += 20;
  }

  // 6. surfaces: S * 12 bytes
  const offSurfaces = cursor;
  for (const surf of compiled.surfaces) {
    targetBuf.writeUInt32LE(surf.planeDesignator >>> 0, cursor + 0);
    targetBuf.writeUInt32LE(surf.firstEdgeIndex >>> 0, cursor + 4);
    targetBuf.writeUInt8(surf.flags & 0xff, cursor + 8); // flags (0x01 = two_sided for concave shells)
    targetBuf.writeUInt8(0xff, cursor + 9); // breakable_surface = -1 (0xFF)
    targetBuf.writeInt16LE(surf.materialIndex, cursor + 10); // material index
    cursor += 12;
  }

  // 7. edges: E * 24 bytes
  const offEdges = cursor;
  for (const edge of compiled.edges) {
    targetBuf.writeInt32LE(edge.vertexIndices[0], cursor + 0);
    targetBuf.writeInt32LE(edge.vertexIndices[1], cursor + 4);
    targetBuf.writeInt32LE(edge.edgeIndices[0], cursor + 8);
    targetBuf.writeInt32LE(edge.edgeIndices[1], cursor + 12);
    targetBuf.writeInt32LE(edge.surfaceIndices[0], cursor + 16);
    targetBuf.writeInt32LE(edge.surfaceIndices[1], cursor + 20);
    cursor += 24;
  }

  // 8. vertices: V * 16 bytes
  const offVertices = cursor;
  for (const vert of compiled.vertices) {
    targetBuf.writeFloatLE(vert.point[0], cursor + 0);
    targetBuf.writeFloatLE(vert.point[1], cursor + 4);
    targetBuf.writeFloatLE(vert.point[2], cursor + 8);
    targetBuf.writeInt32LE(vert.firstEdgeIndex, cursor + 12);
    cursor += 16;
  }

  // Write 96-byte ModelCollisionGeometryBSP header at structOff
  targetBuf.writeUInt32LE(compiled.bsp3dNodes.length, structOff + 0);
  targetBuf.writeUInt32LE(offBsp3dNodes, structOff + 4);
  targetBuf.writeUInt32LE(compiled.planes.length, structOff + 12);
  targetBuf.writeUInt32LE(offPlanes, structOff + 16);
  targetBuf.writeUInt32LE(compiled.leaves.length, structOff + 24);
  targetBuf.writeUInt32LE(offLeaves, structOff + 28);
  targetBuf.writeUInt32LE(compiled.bsp2dReferences.length, structOff + 36);
  targetBuf.writeUInt32LE(offBsp2dRefs, structOff + 40);
  targetBuf.writeUInt32LE(compiled.bsp2dNodes.length, structOff + 48);
  targetBuf.writeUInt32LE(offBsp2dNodes, structOff + 52);
  targetBuf.writeUInt32LE(compiled.surfaces.length, structOff + 60);
  targetBuf.writeUInt32LE(offSurfaces, structOff + 64);
  targetBuf.writeUInt32LE(compiled.edges.length, structOff + 72);
  targetBuf.writeUInt32LE(offEdges, structOff + 76);
  targetBuf.writeUInt32LE(compiled.vertices.length, structOff + 84);
  targetBuf.writeUInt32LE(offVertices, structOff + 88);

  return cursor;
}

/**
 * Builds a self-contained Halo CE `model_collision_geometry` (`coll`) tag with a 3D collision BSP.
 * When `exactMeshCollision` (formerly `multiBox`) is enabled (or by default for <= 512 triangles),
 * compiles an exact 3D polyhedral mesh BSP from the OBJ's triangles and `usemtl` material slots.
 * Falls back to a 6-plane bounding box BSP if disabled or if the mesh exceeds 512 triangles.
 */
export function buildCustomCollisionTag(
  tagPath: string,
  originalIndex: number,
  mesh: ParsedObjMesh,
  rig?: TemplateRigInfo,
  exactMeshCollision: boolean | CustomObjectCollisionMode = true,
  materialType = 7,
  slotMaterialTypes?: number[],
  targetCollisionFaces?: number,
): ExtractedTag {
  const nodeCount = rig && rig.modelNodeCount > 0 ? rig.modelNodeCount : 1;

  // Build material table from Blender `usemtl` slots (or 1 default material)
  const slotNames = mesh.summary.materialSlots.length > 0 ? mesh.summary.materialSlots : ['default'];
  const materials: { name: string; haloMaterialType: number }[] = slotNames.map((slotName, idx) => {
    const explicitType = slotMaterialTypes && slotMaterialTypes[idx] !== undefined
      ? slotMaterialTypes[idx]
      : slotNames.length > 1
        ? inferHaloMaterialTypeFromName(slotName, materialType)
        : materialType;
    const safeType = explicitType >= 0 && explicitType < HALO_MATERIAL_TYPES.length ? explicitType : 7;
    const cleanName = slotName === 'default' ? (HALO_MATERIAL_TYPES[safeType] ?? 'metal thick') : slotName;
    return { name: cleanName, haloMaterialType: safeType };
  });
  const materialCount = Math.max(1, materials.length);

  const collisionMode: CustomObjectCollisionMode =
    typeof exactMeshCollision === 'string'
      ? exactMeshCollision
      : exactMeshCollision
        ? 'auto'
        : 'box';

  const compiledMeshBsp =
    collisionMode !== 'box'
      ? compileMeshCollisionBspData(mesh, materialCount, {
          mode: collisionMode,
          targetFaces: targetCollisionFaces,
        })
      : null;

  if (compiledMeshBsp) {
    mesh.summary.collisionPreview = compiledMeshBsp.stats;
  } else {
    mesh.summary.collisionPreview = {
      mode: 'box',
      inputTriangles: mesh.rawFaces.length,
      weldedVertices: 8,
      decimatedTriangles: 12,
      mergedSurfaces: 6,
      planes: 6,
      edges: 12,
      bsp3dNodes: 6,
      bsp2dNodes: 0,
      isConcave: false,
    };
  }
  const bspCount = 1;
  const bspArraysByteSize = compiledMeshBsp ? compiledMeshBsp.byteSize : 752;

  // Layout offsets:
  // 0: ModelCollisionGeometry root (664 bytes)
  // 664: ModelCollisionGeometryMaterial[materialCount] (materialCount * 72 bytes)
  // offRegions: ModelCollisionGeometryRegion[1] (84 bytes)
  // offPermutations: ModelCollisionGeometryPermutation[1] (32 bytes)
  // offSpheres: ModelCollisionGeometrySphere[1] (32 bytes)
  // offNodes: ModelCollisionGeometryNode[nodeCount] (nodeCount * 64 bytes)
  // offBsps: ModelCollisionGeometryBSP[1] (96 bytes)
  // offBspArrays: bspArraysByteSize bytes
  const offMaterials = 664;
  const offRegions = offMaterials + materialCount * 72;
  const offPermutations = offRegions + 84;
  const offSpheres = offPermutations + 32;
  const offNodes = offSpheres + 32;
  const offBsps = offNodes + nodeCount * 64;
  const offBspArrays = offBsps + bspCount * 96;
  const totalSize = offBspArrays + bspArraysByteSize;

  const buf = Buffer.alloc(totalSize, 0);

  // If template has a collision header, copy its non-pointer damage/shield settings (+0..+564),
  // then clear all 8 TagDependency fields so it doesn't require extra damage/effect tags unless wired.
  if (rig?.collisionHeaderBuffer && rig.collisionHeaderBuffer.length >= 664) {
    rig.collisionHeaderBuffer.copy(buf, 0, 0, 564);
  }

  // Ensure valid enum values for indirect damage material, shield material type, and shield failure function
  buf.writeInt16LE(0, 4); // indirect damage material = 0 (first material)
  if (buf.readUInt16LE(210) >= 33) buf.writeUInt16LE(0, 210); // shield material type in [0, 32]
  if (buf.readInt16LE(236) < 0 || buf.readInt16LE(236) >= 6) buf.writeInt16LE(0, 236); // shield failure function in [0, 5]
  if (buf.readFloatLE(448) === 0) buf.writeFloatLE(1.0, 448); // runtime_shield_recharge_velocity = 1.0f

  // Initialize all 8 TagDependency fields in ModelCollisionGeometry to NULL_TAG_ID
  writeDependencyField(buf, 112, 'effe', NULL_TAG_ID); // localized damage effect
  writeDependencyField(buf, 132, 'effe', NULL_TAG_ID); // area damage effect
  writeDependencyField(buf, 152, 'effe', NULL_TAG_ID); // body damaged effect
  writeDependencyField(buf, 168, 'effe', NULL_TAG_ID); // body depleted effect
  writeDependencyField(buf, 188, 'effe', NULL_TAG_ID); // body destroyed effect
  writeDependencyField(buf, 392, 'effe', NULL_TAG_ID); // shield damaged effect
  writeDependencyField(buf, 408, 'effe', NULL_TAG_ID); // shield depleted effect
  writeDependencyField(buf, 424, 'effe', NULL_TAG_ID); // shield recharging effect

  // Reflexives on ModelCollisionGeometry:
  buf.writeUInt32LE(materialCount, 564); // materials.count
  buf.writeUInt32LE(offMaterials, 568); // materials.pointer
  buf.writeUInt32LE(1, 576); // regions.count
  buf.writeUInt32LE(offRegions, 580); // regions.pointer
  buf.writeUInt32LE(0, 588); // modifiers.count = 0
  buf.writeUInt32LE(0, 592);

  // Pathfinding box at +616..+640
  buf.writeFloatLE(mesh.summary.bounds.min[0], 616);
  buf.writeFloatLE(mesh.summary.bounds.max[0], 620);
  buf.writeFloatLE(mesh.summary.bounds.min[1], 624);
  buf.writeFloatLE(mesh.summary.bounds.max[1], 628);
  buf.writeFloatLE(mesh.summary.bounds.min[2], 632);
  buf.writeFloatLE(mesh.summary.bounds.max[2], 636);

  // pathfinding spheres reflexive at +640
  buf.writeUInt32LE(1, 640);
  buf.writeUInt32LE(offSpheres, 644);

  // nodes reflexive at +652
  buf.writeUInt32LE(nodeCount, 652);
  buf.writeUInt32LE(offNodes, 656);

  // Materials[0..materialCount-1] (72 bytes each)
  for (let m = 0; m < materialCount; m++) {
    const mOff = offMaterials + m * 72;
    writeTagString(buf, mOff, materials[m].name);
    buf.writeUInt32LE(0, mOff + 32); // flags
    buf.writeUInt16LE(materials[m].haloMaterialType, mOff + 36); // material type
    buf.writeFloatLE(0.0, mOff + 40); // shield_leak_fraction = 0.0
    buf.writeFloatLE(1.0, mOff + 44); // shield_damage_multiplier = 1.0
    buf.writeFloatLE(1.0, mOff + 60); // body_damage_multiplier = 1.0
  }

  // Region[0] (84 bytes)
  writeTagString(buf, offRegions, 'default');
  writeDependencyField(buf, offRegions + 56, 'effe', NULL_TAG_ID); // destroyed effect
  buf.writeUInt32LE(1, offRegions + 72); // permutations.count
  buf.writeUInt32LE(offPermutations, offRegions + 76); // permutations.pointer

  // Permutation[0] (32 bytes)
  writeTagString(buf, offPermutations, 'base');

  // Pathfinding Sphere[0] (32 bytes)
  const cx = (mesh.summary.bounds.min[0] + mesh.summary.bounds.max[0]) * 0.5;
  const cy = (mesh.summary.bounds.min[1] + mesh.summary.bounds.max[1]) * 0.5;
  const cz = (mesh.summary.bounds.min[2] + mesh.summary.bounds.max[2]) * 0.5;
  buf.writeInt16LE(0, offSpheres + 0); // node = 0
  buf.writeFloatLE(cx, offSpheres + 16);
  buf.writeFloatLE(cy, offSpheres + 20);
  buf.writeFloatLE(cz, offSpheres + 24);
  buf.writeFloatLE(mesh.summary.bounds.radius, offSpheres + 28);

  // Nodes[0..nodeCount-1] (64 bytes each)
  for (let i = 0; i < nodeCount; i++) {
    const nOff = offNodes + i * 64;
    if (rig && rig.modelNodesBuffer.length >= (i + 1) * 156) {
      const mOff = i * 156;
      rig.modelNodesBuffer.copy(buf, nOff, mOff, mOff + 32); // node name
      const nextSibling = rig.modelNodesBuffer.readInt16LE(mOff + 32);
      const firstChild = rig.modelNodesBuffer.readInt16LE(mOff + 34);
      const parent = rig.modelNodesBuffer.readInt16LE(mOff + 36);
      buf.writeInt16LE(i === 0 ? 0 : -1, nOff + 32); // region
      buf.writeInt16LE(parent, nOff + 34); // parent node
      buf.writeInt16LE(nextSibling, nOff + 36); // next sibling node
      buf.writeInt16LE(firstChild, nOff + 38); // first child node
    } else {
      writeTagString(buf, nOff, 'frame root');
      buf.writeInt16LE(0, nOff + 32); // region = 0
      buf.writeInt16LE(-1, nOff + 34); // parent = -1
      buf.writeInt16LE(-1, nOff + 36); // next sibling = -1
      buf.writeInt16LE(-1, nOff + 38); // first child = -1
    }
    if (i === 0) {
      buf.writeUInt32LE(1, nOff + 52); // bsps.count = 1 (permutation 0)
      buf.writeUInt32LE(offBsps, nOff + 56); // bsps.pointer
    }
  }

  // Write either the compiled 3D Mesh Collision BSP or fallback 6-plane Box BSP
  if (compiledMeshBsp) {
    writeMeshCollisionBsp(buf, offBsps, offBspArrays, compiledMeshBsp);
  } else {
    writeBoxCollisionBsp(
      buf,
      offBsps,
      offBspArrays,
      mesh.summary.bounds.min,
      mesh.summary.bounds.max,
    );
  }

  const dependencies = buildTagDependenciesFromBuffer(
    buf,
    'ModelCollisionGeometry',
    tagPath,
    new Map(),
  );

  return {
    originalIndex,
    group: 'model_collision_geometry',
    path: tagPath,
    structName: 'ModelCollisionGeometry',
    secondaryClassFourCC: null,
    tertiaryClassFourCC: null,
    data: buf,
    dependencies,
    embeddedRawDataAssets: [],
    embeddedRawDataPatches: [],
    injectionBlockers: [],
  };
}

const OBJECT_GROUP_SPEC: Record<
  CustomObjectTagGroup,
  {
    structName: 'Scenery' | 'Weapon' | 'Vehicle' | 'Equipment';
    objectTypeEnum: number;
    secondaryFourCC: number;
    tertiaryFourCC: number | null;
  }
> = {
  scenery: {
    structName: 'Scenery',
    objectTypeEnum: 6,
    secondaryFourCC: fourCCFromString('obje'),
    tertiaryFourCC: null,
  },
  weapon: {
    structName: 'Weapon',
    objectTypeEnum: 2,
    secondaryFourCC: fourCCFromString('item'),
    tertiaryFourCC: fourCCFromString('obje'),
  },
  vehicle: {
    structName: 'Vehicle',
    objectTypeEnum: 1,
    secondaryFourCC: fourCCFromString('unit'),
    tertiaryFourCC: fourCCFromString('obje'),
  },
  equipment: {
    structName: 'Equipment',
    objectTypeEnum: 3,
    secondaryFourCC: fourCCFromString('item'),
    tertiaryFourCC: fourCCFromString('obje'),
  },
};

/**
 * Builds a standalone root object tag (`scenery` / `weapon` / `vehicle` / `equipment`) or adapts
 * an extracted template root tag to point at the newly compiled `gbxmodel` and `model_collision_geometry`.
 */
export function buildCustomRootObjectTag(
  group: CustomObjectTagGroup,
  tagPath: string,
  originalIndex: number,
  mesh: ParsedObjMesh,
  gbxmodelPath: string,
  gbxmodelLocalIndex: number,
  collisionPath: string,
  collisionLocalIndex: number,
  templateRootTag?: ExtractedTag,
  templateDepRemap?: Map<string, ExtractedDependencyRef>,
): ExtractedTag {
  const spec = OBJECT_GROUP_SPEC[group];
  const resolved = resolveStruct(spec.structName);

  const cx = (mesh.summary.bounds.min[0] + mesh.summary.bounds.max[0]) * 0.5;
  const cy = (mesh.summary.bounds.min[1] + mesh.summary.bounds.max[1]) * 0.5;
  const cz = (mesh.summary.bounds.min[2] + mesh.summary.bounds.max[2]) * 0.5;
  const radius = mesh.summary.bounds.radius;

  let buf: Buffer;
  if (templateRootTag && templateRootTag.structName === spec.structName && templateRootTag.data.length >= resolved.totalSize) {
    buf = Buffer.from(templateRootTag.data);
    // Clear predicted resources (+368 on all Object types, +1252 on Weapon) so stale resource indices aren't kept
    buf.writeUInt32LE(0, 368);
    buf.writeUInt32LE(0, 372);
    if (spec.structName === 'Weapon' && buf.length >= 1264) {
      buf.writeUInt32LE(0, 1252);
      buf.writeUInt32LE(0, 1256);
    }
  } else {
    buf = Buffer.alloc(resolved.totalSize, 0);
    // Initialize every root-level TagDependency field with its default FourCC and NULL_TAG_ID
    for (const field of resolved.fields) {
      if (field.def.type === 'TagDependency' && !field.def.nonCached) {
        writeDependencyField(buf, field.offset, 'obje', NULL_TAG_ID);
      }
    }
    writeDependencyField(buf, 40, 'mod2', gbxmodelLocalIndex);
    writeDependencyField(buf, 56, 'antr', NULL_TAG_ID);
    writeDependencyField(buf, 112, 'coll', collisionLocalIndex);
    writeDependencyField(buf, 128, 'phys', NULL_TAG_ID);
    writeDependencyField(buf, 144, 'shdr', NULL_TAG_ID);
    writeDependencyField(buf, 160, 'effe', NULL_TAG_ID);
    buf.writeInt16LE(spec.objectTypeEnum, 0);
    buf.writeFloatLE(0.0, 20); // origin_offset.x = 0.0
    buf.writeFloatLE(0.0, 24); // origin_offset.y = 0.0
    buf.writeFloatLE(0.0, 28); // origin_offset.z = 0.0
    buf.writeFloatLE(1.0, 32); // acceleration_scale = 1.0
  }

  // Always update bounding sphere and wire new model + collision model
  buf.writeInt16LE(spec.objectTypeEnum, 0);
  buf.writeFloatLE(radius, 4); // bounding radius
  buf.writeFloatLE(cx, 8); // bounding offset x
  buf.writeFloatLE(cy, 12); // bounding offset y
  buf.writeFloatLE(cz, 16); // bounding offset z
  if (group === 'scenery') {
    buf.writeFloatLE(0.0, 20); // origin_offset.x = 0.0
    buf.writeFloatLE(0.0, 24); // origin_offset.y = 0.0
    buf.writeFloatLE(0.0, 28); // origin_offset.z = 0.0
  }
  buf.writeFloatLE(radius, 260); // render bounding radius

  writeDependencyField(buf, 40, 'mod2', gbxmodelLocalIndex);
  writeDependencyField(buf, 112, 'coll', collisionLocalIndex);

  const internalMap = new Map<string, { group: string; path: string; localTagIndex: number }>();
  internalMap.set(childFieldPath(tagPath, 'model'), {
    group: 'gbxmodel',
    path: gbxmodelPath,
    localTagIndex: gbxmodelLocalIndex,
  });
  internalMap.set(childFieldPath(tagPath, 'collision model'), {
    group: 'model_collision_geometry',
    path: collisionPath,
    localTagIndex: collisionLocalIndex,
  });

  const dependencies = buildTagDependenciesFromBuffer(
    buf,
    spec.structName,
    tagPath,
    internalMap,
    templateDepRemap,
  );

  return {
    originalIndex,
    group,
    path: tagPath,
    structName: spec.structName,
    secondaryClassFourCC: spec.secondaryFourCC,
    tertiaryClassFourCC: spec.tertiaryFourCC,
    data: buf,
    dependencies,
    embeddedRawDataAssets: [],
    embeddedRawDataPatches: [],
    injectionBlockers: [],
  };
}

/**
 * Synthesizes a 176-byte `item_collection` (`itmc`) tag (92-byte root + 84-byte permutation)
 * referencing a `weapon` or `equipment` tag so it can be placed via `ScenarioNetgameEquipment` in multiplayer.
 */
export function buildCustomItemCollectionTag(
  tagPath: string,
  originalIndex: number,
  itemGroup: 'weapon' | 'equipment',
  itemPath: string,
  itemLocalIndex: number,
  spawnTimeSeconds = 30,
): ExtractedTag {
  const rootSize = 92;
  const permSize = 84;
  const buf = Buffer.alloc(rootSize + permSize, 0);

  // ItemCollection root (92 bytes):
  // +0: permutations reflexive (count = 1, pointerLow = 92)
  buf.writeUInt32LE(1, 0);
  buf.writeUInt32LE(rootSize, 4);
  buf.writeUInt32LE(0, 8);
  // +12: default spawn time (int16)
  buf.writeInt16LE(spawnTimeSeconds, 12);

  // ItemCollectionPermutation (84 bytes at offset 92):
  const permOff = rootSize;
  // +32: weight (float = 1.0)
  buf.writeFloatLE(1.0, permOff + 32);
  // +36: item TagDependency (16 bytes)
  const itemFourCC = itemGroup === 'weapon' ? 0x77656170 : 0x65716970; // 'weap' or 'eqip'
  buf.writeUInt32LE(itemFourCC, permOff + 36);
  buf.writeUInt32LE(0, permOff + 40);
  buf.writeUInt32LE(0, permOff + 44);
  buf.writeUInt32LE(0xffffffff, permOff + 48);

  return {
    originalIndex,
    group: 'item_collection',
    path: tagPath,
    structName: 'ItemCollection',
    secondaryClassFourCC: null,
    tertiaryClassFourCC: null,
    data: buf,
    dependencies: [
      {
        fieldPath: `${tagPath}.permutations[0].item`,
        group: itemGroup,
        path: itemPath,
        kind: 'internal',
        localTagIndex: itemLocalIndex,
      },
    ],
    embeddedRawDataAssets: [],
    embeddedRawDataPatches: [],
    injectionBlockers: [],
  };
}

export interface BuildCustomObjectOptions {
  /** Target object tag class: scenery, weapon, vehicle, or equipment. */
  tagGroup: CustomObjectTagGroup;
  /** Target Halo tag path (e.g. "scenery\\custom\\my_crate\\my_crate"). */
  tagPath: string;
  /** Display name in OpenCE Forge palette (e.g. "Custom Crate"). */
  itemName?: string;
  /** Raw Wavefront .OBJ file text for the 3D render model. */
  objText: string;
  /** Optional separate Wavefront .OBJ file text for the collision model (defaults to `objText`). */
  collisionObjText?: string;
  /** Mesh transform & UV unwrap options. */
  meshOptions?: ObjParseOptions;
  /** Optional RGBA8888 texture pixels (if omitted, generates the UV wireframe/grid texture automatically). */
  textureRgba?: { rgba: Uint8Array; width: number; height: number };
  /** Bitmap encoding format (default: A8R8G8B8). */
  bitmapFormat?: number;
  /** Compile exact 3D mesh collision BSP following every triangle slope/ramp (default: true; false = 6-plane bounding box). */
  multiBoxCollision?: boolean;
  /** Explicit collision mode ('auto' = 1:1 / QEM Decimate + Coplanar Merge, 'exact' = 1:1 up to 2048 faces, 'box' = 6-plane box). */
  collisionMode?: CustomObjectCollisionMode;
  /** Target maximum face budget for automatic QEM collision decimation (default: 800). */
  targetCollisionFaces?: number;
  /** Halo CE MaterialType enum index (0..32, default: 7 = "metal thick"). */
  materialType?: number;
  /** Optional per-slot Halo CE MaterialType enum indices corresponding to `meshSummary.materialSlots` (`usemtl` slots from Blender). */
  slotMaterialTypes?: number[];
  /** Optional template tag set extracted from the currently open map (for inheriting animations, physics, sounds, seats, and barrels). */
  templateExtractedSet?: ExtractedTagSet;
  /** Optional template rig info (nodes, nodeListChecksum, markers) extracted from the open map. */
  templateRig?: TemplateRigInfo;
  /** Source map name for container metadata. */
  sourceMapName?: string;
}

export interface BuiltCustomObjectResult {
  container: OceContainer;
  containerBuffer: Buffer;
  meshSummary: ObjMeshSummary;
  usedAutoUv: boolean;
  rootTagPath: string;
  rootTagGroup: CustomObjectTagGroup;
  generatedTagPaths: { group: string; path: string }[];
}

/**
 * Compiles a Wavefront .OBJ model + texture into a complete Halo CE tag set (`bitmap`, `shader_model`,
 * `gbxmodel`, `model_collision_geometry`, and root `scenery`/`weapon`/`vehicle`/`equipment` tag)
 * packaged as a ready-to-inject / Forge-compatible `OceContainer` (`.ocetags`).
 */
export function buildCustomObjectContainer(options: BuildCustomObjectOptions): BuiltCustomObjectResult {
  const cleanPath = options.tagPath
    .trim()
    .replace(/\//g, '\\')
    .replace(/^\\+|\\+$/g, '')
    .replace(/\.(scenery|weapon|vehicle|equipment|scen|weap|vehi|eqip)$/i, '') || `${options.tagGroup}\\custom\\custom_object`;

  const leafName = cleanPath.split('\\').pop() || 'custom_object';
  const parentDir = cleanPath.includes('\\') ? cleanPath.slice(0, cleanPath.lastIndexOf('\\')) : cleanPath;

  const bitmapPath = `${parentDir}\\bitmaps\\${leafName}`;
  const shaderPath = `${parentDir}\\shaders\\${leafName}`;
  const gbxmodelPath = cleanPath;
  const collisionPath = cleanPath;
  const rootPath = cleanPath;

  // 1. Parse 3D render mesh (and optional collision mesh)
  const effectiveCollMode: CustomObjectCollisionMode =
    options.collisionMode ?? (options.multiBoxCollision === false ? 'box' : 'exact');
  const renderMesh = parseObjMesh(options.objText, {
    ...options.meshOptions,
    collisionMode: effectiveCollMode,
    targetCollisionFaces: options.targetCollisionFaces ?? options.meshOptions?.targetCollisionFaces,
  });
  if (renderMesh.vertices.length === 0 || renderMesh.triangles.length === 0) {
    throw new Error(renderMesh.summary.message || 'OBJ file contains no valid vertices or triangles.');
  }

  const collisionMesh = options.collisionObjText
    ? parseObjMesh(options.collisionObjText, {
        ...options.meshOptions,
        collisionMode: effectiveCollMode,
        targetCollisionFaces: options.targetCollisionFaces ?? options.meshOptions?.targetCollisionFaces,
      })
    : renderMesh;

  // 2. Prepare texture RGBA:
  //    - If user provided a texture, automatically strip any unpainted #38bdf8 UV guide lines
  //    - If omitted, generate a clean neutral surface texture (never bake the light-blue UV wireframe guide onto the model)
  const texture = options.textureRgba
    ? {
        width: options.textureRgba.width,
        height: options.textureRgba.height,
        rgba: stripUvWireframeOverlayFromRgba(
          options.textureRgba.rgba,
          options.textureRgba.width,
          options.textureRgba.height,
        ),
      }
    : renderCleanDefaultTextureRgba(512);

  // 3. If a template tag set was extracted from the open map, carry over its auxiliary tags
  //    (animations, physics, firing effects, sounds, HUD, etc.) so internal dependencies resolve!
  const carriedTags: ExtractedTag[] = [];
  let templateRootTag: ExtractedTag | undefined;
  const oldLocalToNewLocal = new Map<number, number>();

  if (options.templateExtractedSet && options.templateExtractedSet.tags.length > 0) {
    const rootOrig = options.templateExtractedSet.rootOriginalIndices[0];
    for (let i = 0; i < options.templateExtractedSet.tags.length; i++) {
      const t = options.templateExtractedSet.tags[i];
      if (t.originalIndex === rootOrig && t.group === options.tagGroup) {
        templateRootTag = t;
        continue;
      }
      const newLocalIdx = carriedTags.length;
      oldLocalToNewLocal.set(i, newLocalIdx);
      carriedTags.push({
        ...t,
        data: Buffer.from(t.data),
        dependencies: t.dependencies.map((d) => ({ ...d })),
      });
    }
    // Update localTagIndex references among carried-over dependency tags
    for (const ct of carriedTags) {
      for (const dep of ct.dependencies) {
        if (dep.kind === 'internal' && dep.localTagIndex !== undefined) {
          const mapped = oldLocalToNewLocal.get(dep.localTagIndex);
          if (mapped !== undefined) {
            dep.localTagIndex = mapped;
          }
        }
      }
    }
  }

  const baseIdx = carriedTags.length;
  const bitmapLocalIdx = baseIdx + 0;
  const shaderLocalIdx = baseIdx + 1;
  const gbxmodelLocalIdx = baseIdx + 2;
  const collisionLocalIdx = baseIdx + 3;
  const rootLocalIdx = baseIdx + 4;

  // Use Synthetic originalIndex values that won't collide with carried tags
  const maxOrig = carriedTags.reduce((m, t) => Math.max(m, t.originalIndex), 50000);
  const bitmapOrigIdx = maxOrig + 1;
  const shaderOrigIdx = maxOrig + 2;
  const gbxmodelOrigIdx = maxOrig + 3;
  const collisionOrigIdx = maxOrig + 4;
  const rootOrigIdx = maxOrig + 5;

  const bitmapTag = buildCustomBitmapTag(
    bitmapPath,
    bitmapOrigIdx,
    texture.rgba,
    texture.width,
    texture.height,
    options.bitmapFormat ?? BitmapFormat.A8R8G8B8,
  );

  const defaultMatByGroup = options.tagGroup === 'equipment' ? 6 : 7;
  const matType = options.materialType !== undefined
    ? options.materialType
    : options.slotMaterialTypes && options.slotMaterialTypes.length > 0
      ? options.slotMaterialTypes[0]
      : defaultMatByGroup;

  const shaderTag = buildCustomShaderModelTag(
    shaderPath,
    shaderOrigIdx,
    bitmapPath,
    bitmapLocalIdx,
    matType,
  );

  const gbxmodelTag = buildCustomGbxmodelTag(
    gbxmodelPath,
    gbxmodelOrigIdx,
    renderMesh,
    shaderPath,
    shaderLocalIdx,
    options.templateRig,
  );

  const collisionMode: CustomObjectCollisionMode =
    options.collisionMode ??
    (options.multiBoxCollision !== undefined ? (options.multiBoxCollision ? 'auto' : 'box') : 'auto');
  const activeCollisionMesh = collisionMesh.triangles.length > 0 ? collisionMesh : renderMesh;
  const collisionTag = buildCustomCollisionTag(
    collisionPath,
    collisionOrigIdx,
    activeCollisionMesh,
    options.templateRig,
    collisionMode,
    matType,
    options.slotMaterialTypes,
    options.targetCollisionFaces ?? options.meshOptions?.targetCollisionFaces,
  );
  if (activeCollisionMesh.summary.collisionPreview) {
    renderMesh.summary.collisionPreview = activeCollisionMesh.summary.collisionPreview;
  }

  // Map template root tag's existing dependencies (except .model and .collision model) to the new rootPath
  const templateDepRemap = new Map<string, ExtractedDependencyRef>();
  if (templateRootTag) {
    const oldPrefix = `${templateRootTag.path}.`;
    for (const dep of templateRootTag.dependencies) {
      if (!dep.fieldPath.startsWith(oldPrefix)) continue;
      const suffix = dep.fieldPath.slice(oldPrefix.length);
      if (suffix === 'model' || suffix === 'collision model') continue;
      const newFieldPath = `${rootPath}.${suffix}`;
      if (dep.kind === 'internal' && dep.localTagIndex !== undefined) {
        const mappedLocal = oldLocalToNewLocal.get(dep.localTagIndex);
        if (mappedLocal !== undefined) {
          templateDepRemap.set(newFieldPath, {
            ...dep,
            fieldPath: newFieldPath,
            localTagIndex: mappedLocal,
          });
        }
      } else if (dep.kind === 'external') {
        templateDepRemap.set(newFieldPath, {
          ...dep,
          fieldPath: newFieldPath,
        });
      }
    }
  }

  const rootObjectTag = buildCustomRootObjectTag(
    options.tagGroup,
    rootPath,
    rootOrigIdx,
    renderMesh,
    gbxmodelPath,
    gbxmodelLocalIdx,
    collisionPath,
    collisionLocalIdx,
    templateRootTag,
    templateDepRemap,
  );

  const allTags: ExtractedTag[] = [
    ...carriedTags,
    bitmapTag,
    shaderTag,
    gbxmodelTag,
    collisionTag,
    rootObjectTag,
  ];
  const rootFinalOutputs = [rootOrigIdx];
  const generatedTagPaths: { group: string; path: string }[] = [
    { group: 'bitmap', path: bitmapPath },
    { group: 'shader_model', path: shaderPath },
    { group: 'gbxmodel', path: gbxmodelPath },
    { group: 'model_collision_geometry', path: collisionPath },
    { group: options.tagGroup, path: rootPath },
  ];

  if (options.tagGroup === 'weapon' || options.tagGroup === 'equipment') {
    const itmcOrigIdx = maxOrig + 6;
    const itmcTag = buildCustomItemCollectionTag(
      rootPath,
      itmcOrigIdx,
      options.tagGroup,
      rootPath,
      rootLocalIdx,
      30,
    );
    allTags.push(itmcTag);
    rootFinalOutputs.push(itmcOrigIdx);
    generatedTagPaths.push({ group: 'item_collection', path: rootPath });
  }

  const warnings = [
    ...(options.templateExtractedSet?.warnings ?? []),
    {
      originalIndex: bitmapOrigIdx,
      path: bitmapPath,
      group: 'bitmap',
      kind: 'embeddedRawData' as const,
      message: `Embedded custom bitmap pixel data (${bitmapTag.embeddedRawDataAssets[0]?.data.length ?? 0} bytes).`,
    },
  ];

  const tagSet: ExtractedTagSet = {
    rootOriginalIndices: rootFinalOutputs,
    tags: allTags,
    notExtracted: [],
    warnings,
  };

  const displayName = options.itemName?.trim() || leafName.replace(/[_-]+/g, ' ');
  const containerBuffer = serializeContainer(
    tagSet,
    options.sourceMapName || 'custom_object_builder',
    {},
    {
      itemName: displayName,
      displayName,
      itemNames: { [rootOrigIdx]: displayName },
    },
  );
  const container = deserializeContainer(containerBuffer);

  return {
    container,
    containerBuffer,
    meshSummary: renderMesh.summary,
    usedAutoUv: renderMesh.usedAutoUv,
    rootTagPath: rootPath,
    rootTagGroup: options.tagGroup,
    generatedTagPaths,
  };
}

export interface CoupledPhysicsScaleSummary {
  objectTagId: number;
  objectPath: string;
  objectClass: string;
  scaleFactor: number;
  scaledGbxmodelVertices: number;
  scaledCollisionVertices: number;
  scaledCollisionPlanes: number;
  scaledPhysicsMassPoints: number;
  scaledVehicleSuspensions: number;
  updatedWeaponOrEquipmentScale: boolean;
  newPhysicsMass?: number;
}

/**
 * Coupled Vehicle, Weapon, Equipment & Scenery Dimensional Physics Resizer (0.1x - 5.0x),
 * ported from Guilty Spark (`live_scaling.rs:142-292` and `live_items.rs:289-307`).
 *
 * Scales in-place inside `mapBuffer`:
 * 1. Root Object (`vehi`, `scen`, `weap`, `eqip`, `bipd`): bounding radius, bounding offset, render radius ($s^1$),
 *    plus `weap`/`eqip` world item scale float at `+0x184` ($s^1$).
 * 2. `gbxmodel` (`mod2`): node translations, marker translations, part centroids, and uncompressed 3D vertices ($s^1$).
 * 3. `model_collision_geometry` (`coll`): pathfinding box/spheres, 3D BSP plane `d`, 2D BSP `plane_d`, and collision vertices ($s^1$).
 * 4. `physics` (`phys`):
 *    - `radius` (`+0x00`), `center_of_mass` (`+0x0C..0x14`), `ground_depth` (`+0x24`), `water_depth` (`+0x3C`) by $s^1$,
 *    - `mass` (`+0x08`) and `mass_points[*].mass` (`+0x28`) by $s^3$,
 *    - `xx/yy/zz_moment` (`+0x50..0x58`) and forward $3\times 3$ inertia matrix (`+0x5C` entry 0) by $s^5$,
 *    - inverse $3\times 3$ inertia matrix (`+0x5C` entry 1) by $s^{-5}$,
 *    - `powered_mass_points[*].antigrav_offset/height` (`+0x28`, `+0x2C`) by $s^1$,
 *    - `mass_points[*].position` (`+0x38..0x40`) and `radius` (`+0x68`) by $s^1$.
 * 5. `model_animations` (`antr`): `vehicles[*].suspensions[*]` extension/compression ground depths (`+0x04`, `+0x08`) by $s^1$.
 */
export function scaleObjectAndCoupledPhysicsInMap(
  mapBuffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  objectTagId: number,
  scaleFactor: number,
): CoupledPhysicsScaleSummary {
  const s1 = Math.max(0.1, Math.min(10.0, Number.isFinite(scaleFactor) ? scaleFactor : 1.0));
  const s3 = s1 * s1 * s1;
  const s5 = s3 * s1 * s1;
  const invS5 = 1.0 / Math.max(1e-6, s5);

  const entry = tagIndex.entries[objectTagId & 0xffff];
  if (!entry) {
    throw new Error(`Tag ID 0x${objectTagId.toString(16)} not found in map tag index.`);
  }

  const ptrToOff = (ptr: number): number | null => {
    if (!ptr || ptr < tagIndex.baseMemoryAddress) return null;
    const off = resolveTagDataPointer(ptr, header, tagIndex.baseMemoryAddress);
    if (off < 0 || off >= mapBuffer.length) return null;
    return off;
  };

  const scaleFloatAt = (off: number, factor: number) => {
    if (off < 0 || off + 4 > mapBuffer.length) return;
    const val = mapBuffer.readFloatLE(off);
    if (Number.isFinite(val)) {
      mapBuffer.writeFloatLE(val * factor, off);
    }
  };

  let mod2TagId = 0xffffffff;
  let antrTagId = 0xffffffff;
  let collTagId = 0xffffffff;
  let physTagId = 0xffffffff;
  let updatedWeaponOrEquipmentScale = false;

  let cls = fourCCToString(entry.primaryClassFourCC);
  let rootOff = ptrToOff(entry.tagDataPointerOrResourceIndex);
  if (rootOff === null) {
    throw new Error(`Tag "${entry.path}" (${cls}) has no in-map tag data pointer.`);
  }

  // If the caller passed an `item_collection` (`itmc`) or `actor_variant` (`actv`), unwrap its underlying Object tag first
  if (cls === 'itmc' && rootOff + 0x0c <= mapBuffer.length) {
    const permCount = mapBuffer.readUInt32LE(rootOff + 0x00);
    const permOff = ptrToOff(mapBuffer.readUInt32LE(rootOff + 0x04));
    if (permOff !== null && permCount > 0 && permOff + 0x34 <= mapBuffer.length) {
      const innerId = mapBuffer.readUInt32LE(permOff + 0x24 + 0x0c);
      const innerEntry = innerId !== 0xffffffff ? tagIndex.entries[innerId & 0xffff] : undefined;
      if (innerEntry) {
        const innerOff = ptrToOff(innerEntry.tagDataPointerOrResourceIndex);
        if (innerOff !== null) {
          cls = fourCCToString(innerEntry.primaryClassFourCC);
          rootOff = innerOff;
        }
      }
    }
  } else if (cls === 'actv' && rootOff + 0x24 <= mapBuffer.length) {
    const unitId = mapBuffer.readUInt32LE(rootOff + 0x14 + 0x0c);
    const unitEntry = unitId !== 0xffffffff ? tagIndex.entries[unitId & 0xffff] : undefined;
    if (unitEntry) {
      const unitOff = ptrToOff(unitEntry.tagDataPointerOrResourceIndex);
      if (unitOff !== null) {
        cls = fourCCToString(unitEntry.primaryClassFourCC);
        rootOff = unitOff;
      }
    }
  }

  if (cls === 'mod2' || cls === 'mode') {
    mod2TagId = entry.tagId;
    // Also check if another object tag references this gbxmodel
    for (const cand of tagIndex.entries) {
      const candCls = fourCCToString(cand.primaryClassFourCC);
      if (['vehi', 'scen', 'weap', 'eqip', 'bipd'].includes(candCls)) {
        const cOff = ptrToOff(cand.tagDataPointerOrResourceIndex);
        if (cOff !== null && cOff + 0x88 <= mapBuffer.length) {
          const mId = mapBuffer.readUInt32LE(cOff + 0x28 + 0x0c);
          if ((mId & 0xffff) === (mod2TagId & 0xffff)) {
            antrTagId = mapBuffer.readUInt32LE(cOff + 0x38 + 0x0c);
            collTagId = mapBuffer.readUInt32LE(cOff + 0x70 + 0x0c);
            physTagId = mapBuffer.readUInt32LE(cOff + 0x80 + 0x0c);
            break;
          }
        }
      }
    }
  } else if (cls === 'coll') {
    collTagId = entry.tagId;
  } else if (cls === 'phys') {
    physTagId = entry.tagId;
  } else {
    // Object tag (`vehi`, `scen`, `weap`, `eqip`, `bipd`, `garb`, `mach`, `ctrl`)
    scaleFloatAt(rootOff + 0x04, s1); // bounding_radius
    scaleFloatAt(rootOff + 0x08, s1); // bounding_offset.x
    scaleFloatAt(rootOff + 0x0c, s1); // bounding_offset.y
    scaleFloatAt(rootOff + 0x10, s1); // bounding_offset.z
    scaleFloatAt(rootOff + 0x104, s1); // render_bounding_radius

    if ((cls === 'weap' || cls === 'eqip') && rootOff + 0x188 <= mapBuffer.length) {
      const curItemScale = mapBuffer.readFloatLE(rootOff + 0x184);
      const baseScale = Number.isFinite(curItemScale) && curItemScale > 0.01 && curItemScale < 50 ? curItemScale : 1.0;
      mapBuffer.writeFloatLE(baseScale * s1, rootOff + 0x184);
      updatedWeaponOrEquipmentScale = true;
    }

    if (rootOff + 0x90 <= mapBuffer.length) {
      mod2TagId = mapBuffer.readUInt32LE(rootOff + 0x28 + 0x0c);
      antrTagId = mapBuffer.readUInt32LE(rootOff + 0x38 + 0x0c);
      collTagId = mapBuffer.readUInt32LE(rootOff + 0x70 + 0x0c);
      physTagId = mapBuffer.readUInt32LE(rootOff + 0x80 + 0x0c);
    }
  }

  let scaledGbxmodelVertices = 0;
  let scaledCollisionVertices = 0;
  let scaledCollisionPlanes = 0;
  let scaledPhysicsMassPoints = 0;
  let scaledVehicleSuspensions = 0;
  let newPhysicsMass: number | undefined;

  // 1. Scale `gbxmodel` (`mod2`) or Xbox `model` (`mode`)
  const mod2Entry = mod2TagId !== 0xffffffff ? tagIndex.entries[mod2TagId & 0xffff] : undefined;
  if (mod2Entry && !mod2Entry.isExternal) {
    const mOff = ptrToOff(mod2Entry.tagDataPointerOrResourceIndex);
    const isXboxModel = header.engine === 5 || mod2Entry.primaryClassFourCC === 0x6d6f6465;
    if (mOff !== null && mOff + 232 <= mapBuffer.length) {
      // Markers (`+0x18`, stride 64 -> instances `+0x34`, stride 32 -> translation `+0x04..0x0C`)
      const markersCount = mapBuffer.readUInt32LE(mOff + 0x18);
      const markersOff = ptrToOff(mapBuffer.readUInt32LE(mOff + 0x1c));
      if (markersOff !== null && markersCount > 0 && markersCount <= 256) {
        for (let i = 0; i < markersCount; i++) {
          const mkOff = markersOff + i * 64;
          if (mkOff + 64 > mapBuffer.length) break;
          const instCount = mapBuffer.readUInt32LE(mkOff + 0x34);
          const instOff = ptrToOff(mapBuffer.readUInt32LE(mkOff + 0x38));
          if (instOff !== null && instCount > 0 && instCount <= 256) {
            for (let j = 0; j < instCount; j++) {
              const io = instOff + j * 32;
              scaleFloatAt(io + 0x04, s1);
              scaleFloatAt(io + 0x08, s1);
              scaleFloatAt(io + 0x0c, s1);
            }
          }
        }
      }

      // Nodes (`+0xB8`, stride 156 -> default_translation `+0x28..0x30`, distance_from_parent `+0x44`, inverse_translation `+0x90..0x98`)
      const nodesCount = mapBuffer.readUInt32LE(mOff + 0xb8);
      const nodesOff = ptrToOff(mapBuffer.readUInt32LE(mOff + 0xbc));
      if (nodesOff !== null && nodesCount > 0 && nodesCount <= 256) {
        for (let n = 0; n < nodesCount; n++) {
          const no = nodesOff + n * 156;
          if (no + 156 > mapBuffer.length) break;
          scaleFloatAt(no + 0x28, s1);
          scaleFloatAt(no + 0x2c, s1);
          scaleFloatAt(no + 0x30, s1);
          scaleFloatAt(no + 0x44, s1);
          scaleFloatAt(no + 0x90, s1);
          scaleFloatAt(no + 0x94, s1);
          scaleFloatAt(no + 0x98, s1);
        }
      }

      // Geometries (`+0xD0`, stride 48 -> parts `+0x24`, stride 132)
      const geomCount = mapBuffer.readUInt32LE(mOff + 0xd0);
      const geomOff = ptrToOff(mapBuffer.readUInt32LE(mOff + 0xd4));
      const scaledVertexOffsets = new Set<number>();
      if (geomOff !== null && geomCount > 0 && geomCount <= 256) {
        for (let g = 0; g < geomCount; g++) {
          const go = geomOff + g * 48;
          if (go + 48 > mapBuffer.length) break;
          const partCount = mapBuffer.readUInt32LE(go + 0x24);
          const partOff = ptrToOff(mapBuffer.readUInt32LE(go + 0x28));
          if (partOff === null || partCount <= 0 || partCount > 256) continue;
          for (let p = 0; p < partCount; p++) {
            const po = partOff + p * 132;
            if (po + 132 > mapBuffer.length) break;
            // Centroid (`+0x14..0x1C`)
            scaleFloatAt(po + 0x14, s1);
            scaleFloatAt(po + 0x18, s1);
            scaleFloatAt(po + 0x1c, s1);
            const vCount = mapBuffer.readUInt32LE(po + 0x58);
            const vOffsetOrPtr = mapBuffer.readUInt32LE(po + 0x64);
            let vOff: number | null = null;
            const vStride = isXboxModel ? 32 : 68;
            if (isXboxModel) {
              const indirectOff = ptrToOff(vOffsetOrPtr);
              if (indirectOff !== null && indirectOff + 12 <= mapBuffer.length) {
                vOff = ptrToOff(mapBuffer.readUInt32LE(indirectOff + 4));
              }
            } else {
              vOff = tagIndex.modelDataFileOffset + vOffsetOrPtr;
            }
            if (
              vOff !== null &&
              !scaledVertexOffsets.has(vOff) &&
              vCount > 0 &&
              vCount <= 65535 &&
              vOff >= 0 &&
              vOff + vCount * vStride <= mapBuffer.length
            ) {
              scaledVertexOffsets.add(vOff);
              for (let v = 0; v < vCount; v++) {
                const vo = vOff + v * vStride;
                scaleFloatAt(vo + 0x00, s1);
                scaleFloatAt(vo + 0x04, s1);
                scaleFloatAt(vo + 0x08, s1);
                scaledGbxmodelVertices++;
              }
            }
          }
        }
      }
    }
  }

  // 2. Scale `model_collision_geometry` (`coll`)
  const collEntry = collTagId !== 0xffffffff ? tagIndex.entries[collTagId & 0xffff] : undefined;
  if (collEntry) {
    const cOff = ptrToOff(collEntry.tagDataPointerOrResourceIndex);
    if (cOff !== null && cOff + 664 <= mapBuffer.length) {
      // Pathfinding box (`+616..+640`, 6 floats)
      for (let b = 0; b < 6; b++) {
        scaleFloatAt(cOff + 616 + b * 4, s1);
      }
      // Pathfinding spheres (`+640`, stride 32 -> center `+16..+24`, radius `+28`)
      const sphCount = mapBuffer.readUInt32LE(cOff + 640);
      const sphOff = ptrToOff(mapBuffer.readUInt32LE(cOff + 644));
      if (sphOff !== null && sphCount > 0 && sphCount <= 256) {
        for (let i = 0; i < sphCount; i++) {
          const so = sphOff + i * 32;
          scaleFloatAt(so + 16, s1);
          scaleFloatAt(so + 20, s1);
          scaleFloatAt(so + 24, s1);
          scaleFloatAt(so + 28, s1);
        }
      }
      // Collision nodes (`+652`, stride 64 -> bsps `+52`, stride 96)
      const cNodesCount = mapBuffer.readUInt32LE(cOff + 652);
      const cNodesOff = ptrToOff(mapBuffer.readUInt32LE(cOff + 656));
      if (cNodesOff !== null && cNodesCount > 0 && cNodesCount <= 256) {
        for (let n = 0; n < cNodesCount; n++) {
          const no = cNodesOff + n * 64;
          if (no + 64 > mapBuffer.length) break;
          const bspCount = mapBuffer.readUInt32LE(no + 52);
          const bspOff = ptrToOff(mapBuffer.readUInt32LE(no + 56));
          if (bspOff === null || bspCount <= 0 || bspCount > 64) continue;
          for (let b = 0; b < bspCount; b++) {
            const bo = bspOff + b * 96;
            if (bo + 96 > mapBuffer.length) break;
            // Planes (`+12`, stride 16 -> `d` at `+12`)
            const pCount = mapBuffer.readUInt32LE(bo + 12);
            const pOff = ptrToOff(mapBuffer.readUInt32LE(bo + 16));
            if (pOff !== null && pCount > 0 && pCount <= 65535) {
              for (let p = 0; p < pCount; p++) {
                scaleFloatAt(pOff + p * 16 + 12, s1);
                scaledCollisionPlanes++;
              }
            }
            // bsp2d_nodes (`+48`, stride 20 -> `plane_d` at `+8`)
            const n2dCount = mapBuffer.readUInt32LE(bo + 48);
            const n2dOff = ptrToOff(mapBuffer.readUInt32LE(bo + 52));
            if (n2dOff !== null && n2dCount > 0 && n2dCount <= 65535) {
              for (let n2 = 0; n2 < n2dCount; n2++) {
                scaleFloatAt(n2dOff + n2 * 20 + 8, s1);
              }
            }
            // Vertices (`+84`, stride 16 -> `point` at `+0..+8`)
            const vCount = mapBuffer.readUInt32LE(bo + 84);
            const vOff = ptrToOff(mapBuffer.readUInt32LE(bo + 88));
            if (vOff !== null && vCount > 0 && vCount <= 65535) {
              for (let v = 0; v < vCount; v++) {
                const vo = vOff + v * 16;
                scaleFloatAt(vo + 0, s1);
                scaleFloatAt(vo + 4, s1);
                scaleFloatAt(vo + 8, s1);
                scaledCollisionVertices++;
              }
            }
          }
        }
      }
    }
  }

  // 3. Scale `physics` (`phys`) using Guilty Spark's exact dimensional laws ($s^1, s^3, s^5, s^{-5}$)
  const physEntry = physTagId !== 0xffffffff ? tagIndex.entries[physTagId & 0xffff] : undefined;
  if (physEntry) {
    const pOff = ptrToOff(physEntry.tagDataPointerOrResourceIndex);
    if (pOff !== null && pOff + 128 <= mapBuffer.length) {
      scaleFloatAt(pOff + 0x00, s1); // radius
      scaleFloatAt(pOff + 0x08, s3); // mass ($s^3$)
      newPhysicsMass = mapBuffer.readFloatLE(pOff + 0x08);
      scaleFloatAt(pOff + 0x0c, s1); // center_of_mass.x
      scaleFloatAt(pOff + 0x10, s1); // center_of_mass.y
      scaleFloatAt(pOff + 0x14, s1); // center_of_mass.z
      scaleFloatAt(pOff + 0x24, s1); // ground_depth
      scaleFloatAt(pOff + 0x3c, s1); // water_depth
      scaleFloatAt(pOff + 0x50, s5); // xx_moment ($s^5$)
      scaleFloatAt(pOff + 0x54, s5); // yy_moment ($s^5$)
      scaleFloatAt(pOff + 0x58, s5); // zz_moment ($s^5$)

      // inertial_matrix_and_inverse (`+0x5C`, count 2, stride 36)
      const imCount = mapBuffer.readUInt32LE(pOff + 0x5c);
      const imOff = ptrToOff(mapBuffer.readUInt32LE(pOff + 0x60));
      if (imOff !== null && imCount >= 2 && imOff + 72 <= mapBuffer.length) {
        // First 3x3 matrix: forward inertia tensor ($s^5$)
        for (let k = 0; k < 9; k++) {
          scaleFloatAt(imOff + k * 4, s5);
        }
        // Second 3x3 matrix: inverse inertia tensor ($s^{-5}$)
        for (let k = 0; k < 9; k++) {
          scaleFloatAt(imOff + 36 + k * 4, invS5);
        }
      }

      // powered_mass_points (`+0x68`, stride 128 -> antigrav_offset `+0x28`, antigrav_height `+0x2C`)
      const pmpCount = mapBuffer.readUInt32LE(pOff + 0x68);
      const pmpOff = ptrToOff(mapBuffer.readUInt32LE(pOff + 0x6c));
      if (pmpOff !== null && pmpCount > 0 && pmpCount <= 64) {
        for (let i = 0; i < pmpCount; i++) {
          const mo = pmpOff + i * 128;
          if (mo + 128 > mapBuffer.length) break;
          scaleFloatAt(mo + 0x28, s1);
          scaleFloatAt(mo + 0x2c, s1);
        }
      }

      // mass_points (`+0x74`, stride 128 -> mass `+0x28` by $s^3$, position `+0x38..0x40` by $s^1$, radius `+0x68` by $s^1$)
      const mpCount = mapBuffer.readUInt32LE(pOff + 0x74);
      const mpOff = ptrToOff(mapBuffer.readUInt32LE(pOff + 0x78));
      if (mpOff !== null && mpCount > 0 && mpCount <= 128) {
        for (let i = 0; i < mpCount; i++) {
          const mo = mpOff + i * 128;
          if (mo + 128 > mapBuffer.length) break;
          scaleFloatAt(mo + 0x28, s3); // mass ($s^3$)
          scaleFloatAt(mo + 0x38, s1); // position.x
          scaleFloatAt(mo + 0x3c, s1); // position.y
          scaleFloatAt(mo + 0x40, s1); // position.z
          scaleFloatAt(mo + 0x68, s1); // radius
          scaledPhysicsMassPoints++;
        }
      }
    }
  }

  // 4. Scale `model_animations` (`antr`) vehicle suspension ground depths (`+0x04`, `+0x08` by $s^1$)
  const antrEntry = antrTagId !== 0xffffffff ? tagIndex.entries[antrTagId & 0xffff] : undefined;
  if (antrEntry) {
    const aOff = ptrToOff(antrEntry.tagDataPointerOrResourceIndex);
    if (aOff !== null && aOff + 128 <= mapBuffer.length) {
      const vehCount = mapBuffer.readUInt32LE(aOff + 0x24);
      const vehOff = ptrToOff(mapBuffer.readUInt32LE(aOff + 0x28));
      if (vehOff !== null && vehCount > 0 && vehCount <= 32) {
        for (let v = 0; v < vehCount; v++) {
          const vo = vehOff + v * 116;
          if (vo + 116 > mapBuffer.length) break;
          const suspCount = mapBuffer.readUInt32LE(vo + 0x68);
          const suspOff = ptrToOff(mapBuffer.readUInt32LE(vo + 0x6c));
          if (suspOff !== null && suspCount > 0 && suspCount <= 32) {
            for (let sp = 0; sp < suspCount; sp++) {
              const so = suspOff + sp * 20;
              if (so + 20 > mapBuffer.length) break;
              scaleFloatAt(so + 0x04, s1); // full_extension_ground_depth
              scaleFloatAt(so + 0x08, s1); // full_compression_ground_depth
              scaledVehicleSuspensions++;
            }
          }
        }
      }
    }
  }

  return {
    objectTagId: entry.tagId,
    objectPath: entry.path,
    objectClass: cls,
    scaleFactor: s1,
    scaledGbxmodelVertices,
    scaledCollisionVertices,
    scaledCollisionPlanes,
    scaledPhysicsMassPoints,
    scaledVehicleSuspensions,
    updatedWeaponOrEquipmentScale,
    newPhysicsMass,
  };
}

