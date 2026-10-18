import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import { sampleMapPath, hasSampleMap } from './helpers/sample-maps';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractBspRenderMesh } from '../src/render/bsp-geometry';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

describe('BSP Geometry Extractor (extractBspRenderMesh)', () => {
  const hasBloodgulch = hasSampleMap('bloodgulch.map');

  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;

  beforeAll(() => {
    if (hasBloodgulch) {
      buffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
      const inspection = inspectCustomEditionMap(buffer);
      if (inspection.status !== 'ok') {
        throw new Error(`Failed to parse bloodgulch.map: ${inspection.status}`);
      }
      header = inspection.header;
      tagIndex = inspection.tagIndex;
    }
  });

  it.skipIf(!hasBloodgulch)('extracts primary structure BSP geometry from bloodgulch.map', () => {
    const mesh = extractBspRenderMesh(buffer, header, tagIndex, 0);

    expect(mesh.bspIndex).toBe(0);
    expect(mesh.bspTagId).toBeGreaterThan(0);
    expect(mesh.lightmapsBitmapTagId).toBeGreaterThan(0);

    // World bounds sanity
    const [minX, minY, minZ, maxX, maxY, maxZ] = mesh.worldBounds;
    expect(maxX).toBeGreaterThan(minX);
    expect(maxY).toBeGreaterThan(minY);
    expect(maxZ).toBeGreaterThan(minZ);

    // Geometry counts
    expect(mesh.totalVertices).toBeGreaterThan(1000);
    expect(mesh.totalTriangles).toBeGreaterThan(1000);
    expect(mesh.submeshes.length).toBeGreaterThan(0);

    // Verify submeshes and data consistency
    let accumulatedVertices = 0;
    let accumulatedTriangles = 0;

    for (const submesh of mesh.submeshes) {
      expect(submesh.vertexCount).toBeGreaterThan(0);
      expect(submesh.vertices.length).toBe(submesh.vertexCount * 8);
      expect(submesh.lightmapUvs.length).toBe(submesh.vertexCount * 2);
      expect(submesh.indices.length % 3).toBe(0);

      const triangleCount = submesh.indices.length / 3;
      expect(triangleCount).toBeGreaterThan(0);

      accumulatedVertices += submesh.vertexCount;
      accumulatedTriangles += triangleCount;

      // Verify all indices are strictly within local vertex bounds [0, vertexCount - 1]
      for (let i = 0; i < submesh.indices.length; i++) {
        const idx = submesh.indices[i];
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(submesh.vertexCount);
      }

      // Verify submesh bounding box
      const [sMinX, sMinY, sMinZ, sMaxX, sMaxY, sMaxZ] = submesh.boundingBox;
      expect(sMaxX).toBeGreaterThanOrEqual(sMinX);
      expect(sMaxY).toBeGreaterThanOrEqual(sMinY);
      expect(sMaxZ).toBeGreaterThanOrEqual(sMinZ);
    }

    expect(accumulatedVertices).toBe(mesh.totalVertices);
    expect(accumulatedTriangles).toBe(mesh.totalTriangles);
  });

  it.skipIf(!hasBloodgulch)('throws descriptive error on invalid BSP index', () => {
    expect(() => extractBspRenderMesh(buffer, header, tagIndex, 99)).toThrow(/out of bounds/);
    expect(() => extractBspRenderMesh(buffer, header, tagIndex, -1)).toThrow(/out of bounds/);
  });
});
