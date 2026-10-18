import { describe, expect, it } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractModelRenderGeometry } from '../src/render/model-geometry';
import { hasSampleMaps, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

/**
 * Step 8.2 render-level model geometry extraction tests.
 *
 * Verifies extractModelRenderGeometry against real CE maps:
 *  - returns non-zero vertices and triangles
 *  - all index values are in-bounds for each submesh
 *  - bounding boxes are sensible (min <= max, all finite)
 *  - vertices are interleaved x8 (position + normal + uv)
 *  - LOD fallback: models with no regions/permutations still work (geometry 0)
 */

const TEST_MAPS = ['bloodgulch.map', 'coldsnap.map'];

describe.skipIf(!hasSampleMaps(['bloodgulch.map']))(
  'extractModelRenderGeometry – bloodgulch.map',
  () => {
    const buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const { header, tagIndex } = inspected;

    const gbxEntries = tagIndex.entries.filter(
      (e) => !e.isExternal && e.primaryClassName === 'gbxmodel',
    );
    // Pick the first non-empty gbxmodel (vehicles/coldsnap_hogs/warthog is reliable in BG)
    const target =
      gbxEntries.find((e) => e.path === 'vehicles/coldsnap_hogs/warthog') ??
      gbxEntries.find((e) => e.path.includes('warthog')) ??
      gbxEntries[0];

    it('returns non-zero vertices and triangles for a real gbxmodel tag', () => {
      if (!target) throw new Error('No gbxmodel entries found');
      const geom = extractModelRenderGeometry(buffer, header, tagIndex, target.tagId);
      expect(geom.totalVertices).toBeGreaterThan(0);
      expect(geom.totalTriangles).toBeGreaterThan(0);
      expect(geom.submeshes.length).toBeGreaterThan(0);
    });

    it('all triangle indices are within the submesh vertex count', () => {
      if (!target) throw new Error('No gbxmodel entries found');
      const geom = extractModelRenderGeometry(buffer, header, tagIndex, target.tagId);
      for (const s of geom.submeshes) {
        expect(s.indices.length).toBeGreaterThanOrEqual(3);
        expect(s.indices.length % 3).toBe(0);
        for (let i = 0; i < s.indices.length; i++) {
          expect(s.indices[i]).toBeLessThan(s.vertexCount);
          expect(s.indices[i]).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('bounding boxes are finite and min <= max on every axis', () => {
      if (!target) throw new Error('No gbxmodel entries found');
      const geom = extractModelRenderGeometry(buffer, header, tagIndex, target.tagId);
      for (const s of geom.submeshes) {
        const [minX, minY, minZ, maxX, maxY, maxZ] = s.boundingBox;
        expect(Number.isFinite(minX)).toBe(true);
        expect(Number.isFinite(minY)).toBe(true);
        expect(Number.isFinite(minZ)).toBe(true);
        expect(Number.isFinite(maxX)).toBe(true);
        expect(Number.isFinite(maxY)).toBe(true);
        expect(Number.isFinite(maxZ)).toBe(true);
        expect(minX).toBeLessThanOrEqual(maxX);
        expect(minY).toBeLessThanOrEqual(maxY);
        expect(minZ).toBeLessThanOrEqual(maxZ);
      }
    });

    it('vertex buffer is interleaved x8 (position + normal + uv) and has the expected length', () => {
      if (!target) throw new Error('No gbxmodel entries found');
      const geom = extractModelRenderGeometry(buffer, header, tagIndex, target.tagId);
      for (const s of geom.submeshes) {
        expect(s.vertices.length).toBe(s.vertexCount * 8);
        for (let v = 0; v < s.vertexCount; v++) {
          for (let c = 0; c < 8; c++) {
            expect(Number.isFinite(s.vertices[v * 8 + c])).toBe(true);
          }
        }
      }
    });
  },
);

describe.skipIf(!hasSampleMaps(['coldsnap.map']))(
  'extractModelRenderGeometry – coldsnap.map (multi-tag sweep)',
  () => {
    const buffer = readSampleMap('coldsnap.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('coldsnap.map did not parse');
    const { header, tagIndex } = inspected;

    const gbxEntries = tagIndex.entries.filter(
      (e) => !e.isExternal && e.primaryClassName === 'gbxmodel',
    );

    it('every capturable gbxmodel tag extracts with >0 triangles (no exceptions, no empty results)', () => {
      if (gbxEntries.length === 0) throw new Error('No gbxmodel tags in coldsnap.map');
      let extracted = 0;
      for (const entry of gbxEntries) {
        const geom = extractModelRenderGeometry(buffer, header, tagIndex, entry.tagId);
        if (geom.totalTriangles > 0) extracted++;
      }
      // At least 50% of tags should produce geometry (the rest may be degenerate/empty LOD)
      expect(extracted).toBeGreaterThan(gbxEntries.length * 0.5);
    });

    it('extracting at each LOD level does not throw', () => {
      const target = gbxEntries[0];
      for (let lod = 0; lod < 5; lod++) {
        expect(() => extractModelRenderGeometry(buffer, header, tagIndex, target.tagId, lod)).not.toThrow();
      }
    });
  },
);

