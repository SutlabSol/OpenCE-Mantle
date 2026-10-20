import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { mergeStructureBsps } from '../src/map/bsp-merger';
import { performBspSwap, bspSwapPreflight } from '../src/map/bsp-swapper';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractBspRenderMesh } from '../src/render/bsp-geometry';

describe('Multi-BSP Merger Module (Milestone 10.2)', () => {
  const bgPath = path.resolve(__dirname, '../../sample_maps/bloodgulch.map');
  const b30Path = path.resolve(__dirname, '../../sample_maps/PC/b30.map');

  const hasBg = fs.existsSync(bgPath);
  const hasB30 = fs.existsSync(b30Path);

  it('merges BSP 0 and BSP 1 from b30.map into a single valid ScenarioStructureBSP', () => {
    if (!hasB30) return;

    const b30Buf = fs.readFileSync(b30Path);
    const merged = mergeStructureBsps(b30Buf, [0, 1]);

    expect(merged.bspBuffer).toBeDefined();
    expect(merged.bspSize).toBeGreaterThan(8413184); // Larger than BSP 0 alone
    expect(merged.vertexCount).toBe(95041); // 50936 + 44105
    expect(merged.triangleCount).toBe(60313); // 35105 + 25208
    expect(merged.submeshCount).toBe(294); // 117 + 177
    expect(merged.mergedBspNames).toHaveLength(2);
    expect(merged.mergedBspNames[0]).toBe('levels\\b30\\b30a');
    expect(merged.mergedBspNames[1]).toBe('levels\\b30\\b30b');

    // Union bounds check
    expect(merged.worldBounds[0]).toBeLessThanOrEqual(-42);
    expect(merged.worldBounds[3]).toBeGreaterThanOrEqual(29);
  });

  it('runs preflight for multi-BSP selection with merge warning', () => {
    if (!hasBg || !hasB30) return;

    const bgBuf = fs.readFileSync(bgPath);
    const b30Buf = fs.readFileSync(b30Path);

    const preflight = bspSwapPreflight(b30Buf, bgBuf, 0, 0, [0, 1]);
    expect(preflight.ok).toBe(true);
    expect(preflight.selectedSourceBsps).toHaveLength(2);
    expect(preflight.warnings.some((w) => w.includes('Multi-BSP Merge Mode'))).toBe(true);
  });

  it('performs multi-BSP swap fusing b30_a + b30_b into bloodgulch.map', () => {
    if (!hasBg || !hasB30) return;

    const bgBuf = fs.readFileSync(bgPath);
    const b30Buf = fs.readFileSync(b30Path);

    const swapResult = performBspSwap(b30Buf, bgBuf, {
      sourceBspIndices: [0, 1],
      targetBspIndex: 0,
      stripDobcAndDecals: true,
      relocateGroundObjects: true,
      harvestShaders: false,
    });

    expect(swapResult.ok).toBe(true);
    expect(swapResult.summary.sourceBspName).toContain('b30a');
    expect(swapResult.summary.sourceBspName).toContain('b30b');

    // Inspect the resulting map buffer
    const reinspected = inspectCustomEditionMap(swapResult.buffer);
    expect(reinspected.status).toBe('ok');

    if (reinspected.status === 'ok') {
      // Extract 3D render mesh from the merged map at BSP 0
      const mesh = extractBspRenderMesh(swapResult.buffer, reinspected.header, reinspected.tagIndex, 0);
      expect(mesh.totalVertices).toBe(95041);
      expect(mesh.totalTriangles).toBe(60313);
      expect(mesh.submeshes.length).toBe(294);
    }
  });

  it('rebases merged BSPs so bspAddress + bspSize <= 0x41B40000 (CE cache ceiling) on a30.map', () => {
    const a30Path = path.resolve(__dirname, '../../sample_maps/the failed conversion/a30.map');
    if (!fs.existsSync(a30Path)) return;

    const a30Buf = fs.readFileSync(a30Path);
    const merged = mergeStructureBsps(a30Buf, [0, 1]);

    const CE_BSP_CACHE_CEILING = 0x41b40000;
    expect(merged.bspAddress + merged.bspSize).toBeLessThanOrEqual(CE_BSP_CACHE_CEILING);
    expect(merged.bspAddress).toBe((CE_BSP_CACHE_CEILING - merged.bspSize) & ~511);

    // Verify root pointer at offset 0 matches the rebased address
    const rootPtr = merged.bspBuffer.readUInt32LE(0);
    expect(rootPtr).toBe(merged.bspAddress + 0x18);
  });
});
