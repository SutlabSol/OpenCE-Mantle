import type { CacheFileHeader } from '../map/header';
import type { TagIndex } from '../map/tag-index';
import { extractBspRenderMesh } from './bsp-geometry';
import { inspectCustomEditionMap } from '../map/open-map';
import { ensureXboxMapDecompressed } from '../map/compression';

/**
 * Compact normalized top-down 2D orthographic BSP wireframe representation.
 * Each segment is `[nx0, ny0, nx1, ny1, nx2, ny2, zNorm]` where coordinates are normalized to `0..1`.
 */
export interface BspTopDownWireframeData {
  /** Width-to-height world aspect ratio (`spanX / spanY`). */
  aspect: number;
  /** Total vertex count in primary BSP. */
  totalVertices: number;
  /** Total triangle count in primary BSP. */
  totalTriangles: number;
  /** Number of structure BSPs in the scenario. */
  bspCount: number;
  /** Normalized 2D triangle segments `[nx0, ny0, nx1, ny1, nx2, ny2, zNorm]`. */
  segments: Array<[number, number, number, number, number, number, number]>;
}

/**
 * Extracts a top-down 2D orthographic wireframe from a map's primary `scenario_structure_bsp` (`sbsp`).
 * Uses 2nd-to-98th percentile vertex bounds so huge skybox or ocean planes (e.g. `deathisland.map`)
 * do not shrink the playable geometry in the thumbnail.
 */
export function extractBspTopDownWireframe(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  maxTriangles = 1800,
): BspTopDownWireframeData | null {
  try {
    const bsp = extractBspRenderMesh(buffer, header, tagIndex, 0);
    if (!bsp || !bsp.submeshes || bsp.submeshes.length === 0) {
      return null;
    }

    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];

    for (const sub of bsp.submeshes) {
      const verts = sub.vertices;
      for (let v = 0; v + 2 < verts.length; v += 8) {
        xs.push(verts[v]!);
        ys.push(verts[v + 1]!);
        zs.push(verts[v + 2]!);
      }
    }

    if (xs.length < 3) {
      return null;
    }

    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    zs.sort((a, b) => a - b);

    const minX = xs[Math.floor(xs.length * 0.02)] ?? bsp.worldBounds[0];
    const maxX = xs[Math.floor(xs.length * 0.98)] ?? bsp.worldBounds[3];
    const minY = ys[Math.floor(ys.length * 0.02)] ?? bsp.worldBounds[1];
    const maxY = ys[Math.floor(ys.length * 0.98)] ?? bsp.worldBounds[4];
    const minZ = zs[Math.floor(zs.length * 0.02)] ?? bsp.worldBounds[2];
    const maxZ = zs[Math.floor(zs.length * 0.98)] ?? bsp.worldBounds[5];

    const spanX = Math.max(1e-4, maxX - minX);
    const spanY = Math.max(1e-4, maxY - minY);
    const spanZ = Math.max(1e-4, maxZ - minZ);

    const totalTris = Math.max(1, bsp.totalTriangles || 1);
    const step = Math.max(1, Math.floor(totalTris / Math.max(200, maxTriangles)));

    const segments: Array<[number, number, number, number, number, number, number]> = [];
    let triCounter = 0;

    for (const sub of bsp.submeshes) {
      const verts = sub.vertices;
      const idx = sub.indices;
      for (let i = 0; i + 2 < idx.length; i += 3) {
        triCounter++;
        if (triCounter % step !== 0) continue;

        const i0 = idx[i]! * 8;
        const i1 = idx[i + 1]! * 8;
        const i2 = idx[i + 2]! * 8;

        const x0 = verts[i0]!, y0 = verts[i0 + 1]!, z0 = verts[i0 + 2]!;
        const x1 = verts[i1]!, y1 = verts[i1 + 1]!, z1 = verts[i1 + 2]!;
        const x2 = verts[i2]!, y2 = verts[i2 + 1]!, z2 = verts[i2 + 2]!;

        const nx0 = (x0 - minX) / spanX;
        const ny0 = (y0 - minY) / spanY;
        const nx1 = (x1 - minX) / spanX;
        const ny1 = (y1 - minY) / spanY;
        const nx2 = (x2 - minX) / spanX;
        const ny2 = (y2 - minY) / spanY;

        // Skip out-of-bounds skybox/ocean plane triangles
        if (
          nx0 < -0.06 || nx0 > 1.06 || ny0 < -0.06 || ny0 > 1.06 ||
          nx1 < -0.06 || nx1 > 1.06 || ny1 < -0.06 || ny1 > 1.06 ||
          nx2 < -0.06 || nx2 > 1.06 || ny2 < -0.06 || ny2 > 1.06
        ) {
          continue;
        }

        const zNorm = Math.max(0, Math.min(1, ((z0 + z1 + z2) / 3 - minZ) / spanZ));
        segments.push([
          Number(nx0.toFixed(3)),
          Number(ny0.toFixed(3)),
          Number(nx1.toFixed(3)),
          Number(ny1.toFixed(3)),
          Number(nx2.toFixed(3)),
          Number(ny2.toFixed(3)),
          Number(zNorm.toFixed(2)),
        ]);
      }
    }

    return {
      aspect: Number((spanX / spanY).toFixed(4)),
      totalVertices: bsp.totalVertices,
      totalTriangles: bsp.totalTriangles,
      bspCount: bsp.bspCount ?? 1,
      segments,
    };
  } catch {
    return null;
  }
}

/**
 * Inspects a `.map` buffer and extracts both its summary metadata and top-down BSP wireframe.
 */
export function inspectMapBufferForRecentCard(
  buffer: Buffer,
  maxTriangles = 1800,
): {
  scenarioName: string;
  engine: number;
  mapEdition: string;
  mapType: number;
  tagCount: number;
  wireframe: BspTopDownWireframeData | null;
} | null {
  try {
    const decompressed = ensureXboxMapDecompressed(buffer);
    const inspected = inspectCustomEditionMap(decompressed);
    if (inspected.status !== 'ok') {
      return null;
    }
    const { header, tagIndex } = inspected;
    const wireframe = extractBspTopDownWireframe(decompressed, header, tagIndex, maxTriangles);
    return {
      scenarioName: header.scenarioName,
      engine: header.engine,
      mapEdition: header.engine === 609 ? 'ce' : header.engine === 13 ? 'mcc' : header.engine === 5 ? 'xbox' : 'pc',
      mapType: header.mapType,
      tagCount: tagIndex.entries.length,
      wireframe,
    };
  } catch {
    return null;
  }
}
