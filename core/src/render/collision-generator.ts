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

import { fourCCFromString, NULL_TAG_ID } from '../constants/tag-classes';
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

export type CustomObjectTagGroup = 'scenery' | 'weapon' | 'vehicle' | 'equipment';

export interface ObjParseOptions {
  /** Uniform scale multiplier applied to vertex positions (default: 1.0). */
  scale?: number;
  /** Convert Y-up OBJ coordinates to Halo Z-up: (x, y, z) -> (x, -z, y). */
  flipYz?: boolean;
  /** Center X/Y around 0 and place bottom at Z=0. */
  centerOrigin?: boolean;
  /** Automatically unwrap UVs using a 6-face box projection atlas when the OBJ has no vt coordinates (or when forced). */
  forceAutoUv?: boolean;
}

export interface ObjMeshSummary {
  vertexCount: number;
  triangleCount: number;
  uvCoordCount: number;
  normalCount: number;
  hasUvCoordinates: boolean;
  hasNormals: boolean;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    radius: number;
  };
  isTooComplex: boolean;
  message: string;
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

export interface ParsedObjMesh {
  summary: ObjMeshSummary;
  vertices: CompiledModelVertex[];
  triangles: [number, number, number][];
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
  }
  const rawTriangles: RawTriangle[] = [];
  let currentGroupId = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    const prefix = parts[0].toLowerCase();

    if (prefix === 'g' || prefix === 'o') {
      if (rawTriangles.length > 0) currentGroupId++;
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
      bounds: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], radius: 0 },
      isTooComplex: true,
      message: 'No valid 3D mesh vertices or faces were found in this OBJ file.',
    };
    return {
      summary: emptySummary,
      vertices: [],
      triangles: [],
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
  const usedAutoUv = !hasUvCoordinates || Boolean(options.forceAutoUv);

  // Build deduplicated compiled vertices + triangle index list
  const vertices: CompiledModelVertex[] = [];
  const triangles: [number, number, number][] = [];
  const vertexLookup = new Map<string, number>();
  const groupMinMax = new Map<number, { min: [number, number, number]; max: [number, number, number] }>();

  for (const tri of rawTriangles) {
    const p0 = rawPositions[tri.corners[0].vIdx];
    const p1 = rawPositions[tri.corners[1].vIdx];
    const p2 = rawPositions[tri.corners[2].vIdx];

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
        : projectBoxAtlasUv(pos, faceNormal, minBounds, maxBounds);

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
  const uvStatus = hasUvCoordinates
    ? `${rawUvs.length} UV coords`
    : 'Auto-unwrapped (6-face Box UV Atlas)';

  const summary: ObjMeshSummary = {
    vertexCount: rawPositions.length,
    triangleCount: rawTriangles.length,
    uvCoordCount: rawUvs.length,
    normalCount: rawNormals.length,
    hasUvCoordinates,
    hasNormals: rawNormals.length > 0,
    bounds: {
      min: minBounds,
      max: maxBounds,
      size: sizeBounds,
      radius,
    },
    isTooComplex,
    message: `Mesh ready: ${rawPositions.length} vertices, ${rawTriangles.length} triangles (${uvStatus}). Dimensions: ${sizeBounds[0].toFixed(2)} x ${sizeBounds[1].toFixed(2)} x ${sizeBounds[2].toFixed(2)} world units.`,
  };

  return {
    summary,
    vertices,
    triangles,
    usedAutoUv,
    groupBounds,
  };
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

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = ((Math.floor(x / cellSize) + Math.floor(y / cellSize)) & 1) === 0;
      let r = checker ? 28 : 36;
      let g = checker ? 29 : 38;
      let b = checker ? 34 : 44;

      if (parsed.usedAutoUv) {
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

  // 2. If Box Atlas mode, draw cell dividers
  if (parsed.usedAutoUv) {
    for (let c = 1; c <= 2; c++) {
      const x = Math.round((c / 3) * size);
      drawLineRgba(rgba, size, x, 0, x, size - 1, 90, 100, 120, 255);
    }
    const midY = Math.round(size / 2);
    drawLineRgba(rgba, size, 0, midY, size - 1, midY, 90, 100, 120, 255);
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
  const bdFlags = (isCompressed ? 0x0001 : 0x0000) | 0x0080; // power of two dimensions (0x80) | compressed (0x01)
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
 * Encodes independent triangles into a single contiguous D3DPT_TRIANGLESTRIP buffer
 * stitched with degenerate triangles (verified against Halo CE's D3D9 renderer and OpenCE's viewport).
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
      stripIndices.push(a, b, c);
    } else {
      const prev = stripIndices[stripIndices.length - 1];
      // Push degenerate connector: repeat previous vertex, then push next triangle's first vertex
      stripIndices.push(prev, a);
      // Ensure `a, b, c` begins at an EVEN triangle index in the strip so winding order is preserved
      if ((stripIndices.length - 1) % 2 === 1) {
        stripIndices.push(a);
      }
      stripIndices.push(b, c);
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
    // Clear any runtime pointers inside nodes
    for (let i = 0; i < nodeCount; i++) {
      nodesBuf.writeUInt32LE(0, i * 156 + 144);
    }
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
    nodesBuf.writeFloatLE(1.0, 104); // scale
    nodesBuf.writeFloatLE(1.0, 108); // rot matrix [0][0]
    nodesBuf.writeFloatLE(1.0, 120); // rot matrix [1][1]
    nodesBuf.writeFloatLE(1.0, 132); // rot matrix [2][2]
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

/**
 * Builds a self-contained Halo CE `model_collision_geometry` (`coll`) tag with a 3D collision BSP
 * fitted to the OBJ mesh bounds (or multi-group sub-boxes).
 */
export function buildCustomCollisionTag(
  tagPath: string,
  originalIndex: number,
  mesh: ParsedObjMesh,
  rig?: TemplateRigInfo,
  multiBox = false,
  materialType = 7,
): ExtractedTag {
  const nodeCount = rig && rig.modelNodeCount > 0 ? rig.modelNodeCount : 1;
  const boxes = multiBox && mesh.groupBounds.length > 1 && mesh.groupBounds.length <= 8
    ? mesh.groupBounds
    : [{ min: mesh.summary.bounds.min, max: mesh.summary.bounds.max }];
  const bspCount = boxes.length;

  // Layout offsets:
  // 0: ModelCollisionGeometry root (664 bytes)
  // 664: ModelCollisionGeometryMaterial[1] (72 bytes)
  // 736: ModelCollisionGeometryRegion[1] (84 bytes)
  // 820: ModelCollisionGeometryPermutation[1] (32 bytes)
  // 852: ModelCollisionGeometrySphere[1] (32 bytes)
  // 884: ModelCollisionGeometryNode[nodeCount] (nodeCount * 64 bytes)
  // offBsps: ModelCollisionGeometryBSP[bspCount] (bspCount * 96 bytes)
  // offBspArrays: bspCount * 752 bytes
  const offMaterials = 664;
  const offRegions = offMaterials + 72;
  const offPermutations = offRegions + 84;
  const offSpheres = offPermutations + 32;
  const offNodes = offSpheres + 32;
  const offBsps = offNodes + nodeCount * 64;
  const offBspArrays = offBsps + bspCount * 96;
  const totalSize = offBspArrays + bspCount * 752;

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
  buf.writeUInt32LE(1, 564); // materials.count
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

  // Material[0] (72 bytes)
  const safeMat = materialType >= 0 && materialType < HALO_MATERIAL_TYPES.length ? materialType : 7;
  const matName = HALO_MATERIAL_TYPES[safeMat] ?? 'metal thick';
  writeTagString(buf, offMaterials, matName);
  buf.writeUInt32LE(0, offMaterials + 32); // flags
  buf.writeUInt16LE(safeMat, offMaterials + 36); // material type (default 7 = metal thick)
  buf.writeFloatLE(1.0, offMaterials + 40); // shield leak = 0, body damage multiplier = 1.0
  buf.writeFloatLE(1.0, offMaterials + 44);

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
      buf.writeUInt32LE(bspCount, nOff + 52); // bsps.count
      buf.writeUInt32LE(offBsps, nOff + 56); // bsps.pointer
    }
  }

  // Write each 6-plane Box BSP into offBsps + offBspArrays
  let arrayCursor = offBspArrays;
  for (let b = 0; b < bspCount; b++) {
    arrayCursor = writeBoxCollisionBsp(
      buf,
      offBsps + b * 96,
      arrayCursor,
      boxes[b].min,
      boxes[b].max,
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
    buf.writeFloatLE(1.0, 28); // acceleration scale = 1.0
  }

  // Always update bounding sphere and wire new model + collision model
  buf.writeInt16LE(spec.objectTypeEnum, 0);
  buf.writeFloatLE(radius, 4); // bounding radius
  buf.writeFloatLE(cx, 8); // bounding offset x
  buf.writeFloatLE(cy, 12); // bounding offset y
  buf.writeFloatLE(cz, 16); // bounding offset z
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
  /** Use compound multi-box collision when the OBJ has multiple sub-groups (default: false = 1 tight 3D box BSP). */
  multiBoxCollision?: boolean;
  /** Halo CE MaterialType enum index (0..32, default: 7 = "metal thick"). */
  materialType?: number;
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
  const renderMesh = parseObjMesh(options.objText, options.meshOptions);
  if (renderMesh.vertices.length === 0 || renderMesh.triangles.length === 0) {
    throw new Error(renderMesh.summary.message || 'OBJ file contains no valid vertices or triangles.');
  }

  const collisionMesh = options.collisionObjText
    ? parseObjMesh(options.collisionObjText, options.meshOptions)
    : renderMesh;

  // 2. Prepare texture RGBA (use provided PNG/DDS RGBA, or auto-generate the UV template texture)
  const texture = options.textureRgba ?? renderObjUvTemplateRgba(options.objText, 512, options.meshOptions);

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

  const matType = options.materialType !== undefined ? options.materialType : 7;

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

  const collisionTag = buildCustomCollisionTag(
    collisionPath,
    collisionOrigIdx,
    collisionMesh.triangles.length > 0 ? collisionMesh : renderMesh,
    options.templateRig,
    Boolean(options.multiBoxCollision),
    matType,
  );

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
  void rootLocalIdx;

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
    rootOriginalIndices: [rootOrigIdx],
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
    generatedTagPaths: [
      { group: 'bitmap', path: bitmapPath },
      { group: 'shader_model', path: shaderPath },
      { group: 'gbxmodel', path: gbxmodelPath },
      { group: 'model_collision_geometry', path: collisionPath },
      { group: options.tagGroup, path: rootPath },
    ],
  };
}
