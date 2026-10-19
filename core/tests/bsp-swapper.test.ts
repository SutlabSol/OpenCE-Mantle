import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  getMapBsps,
  bspSwapPreflight,
  performBspSwap,
} from '../src/map/bsp-swapper';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractBspRenderMesh } from '../src/render/bsp-geometry';

describe('BSP Swapper Core Module', () => {
  const bgPath = path.resolve(__dirname, '../../sample_maps/bloodgulch.map');
  const b30Path = path.resolve(__dirname, '../../sample_maps/PC/b30.map');

  const hasBg = fs.existsSync(bgPath);
  const hasB30 = fs.existsSync(b30Path);

  it('enumerates BSPs correctly from bloodgulch.map and b30.map', () => {
    if (!hasBg || !hasB30) return;

    const bgBuf = fs.readFileSync(bgPath);
    const b30Buf = fs.readFileSync(b30Path);

    const bgBsps = getMapBsps(bgBuf);
    expect(bgBsps).toHaveLength(1);
    expect(bgBsps[0].path).toBe('levels\\test\\bloodgulch\\bloodgulch');
    expect(bgBsps[0].vertexCount).toBe(5762);
    expect(bgBsps[0].triangleCount).toBe(5503);

    const b30Bsps = getMapBsps(b30Buf);
    expect(b30Bsps.length).toBeGreaterThanOrEqual(2);
    expect(b30Bsps[0].path).toBe('levels\\b30\\b30a');
    expect(b30Bsps[0].vertexCount).toBe(50936);
    expect(b30Bsps[0].hasDobc).toBe(true);
    expect(b30Bsps[0].hasDecals).toBe(true);
  });

  it('runs preflight calculation with warnings for campaign DOBC/decals', () => {
    if (!hasBg || !hasB30) return;

    const bgBuf = fs.readFileSync(bgPath);
    const b30Buf = fs.readFileSync(b30Path);

    const preflight = bspSwapPreflight(b30Buf, bgBuf, 0, 0);
    expect(preflight.ok).toBe(true);
    expect(preflight.sourceBsps.length).toBeGreaterThanOrEqual(2);
    expect(preflight.targetBsps).toHaveLength(1);
    expect(preflight.sizeDelta).toBe(preflight.selectedSourceBsp!.bspSize - preflight.selectedTargetBsp!.bspSize);
    expect(preflight.warnings.some((w) => w.includes('Detail Objects'))).toBe(true);
    expect(preflight.warnings.some((w) => w.includes('Runtime Decals'))).toBe(true);
  });

  it('performs BSP swap from b30 into bloodgulch with DOBC stripping and spawn relocation', () => {
    if (!hasBg || !hasB30) return;

    const bgBuf = fs.readFileSync(bgPath);
    const b30Buf = fs.readFileSync(b30Path);

    const swapResult = performBspSwap(b30Buf, bgBuf, {
      sourceBspIndex: 0,
      targetBspIndex: 0,
      stripDobcAndDecals: true,
      relocateGroundObjects: true,
    });

    expect(swapResult.ok).toBe(true);
    expect(swapResult.summary.strippedDobc).toBe(true);
    expect(swapResult.summary.strippedDecals).toBe(true);
    expect(swapResult.buffer.length).toBe(bgBuf.length + swapResult.summary.delta);

    // Validate the swapped map with inspectCustomEditionMap
    const inspected = inspectCustomEditionMap(swapResult.buffer);
    expect(inspected.status).toBe('ok');
    if (inspected.status === 'ok') {
      expect(inspected.tagIndex.entries.length).toBe(2455);

      // Verify that the new BSP renders cleanly
      const mesh = extractBspRenderMesh(swapResult.buffer, inspected.header, inspected.tagIndex, 0);
      expect(mesh.totalVertices).toBe(50936);
      expect(mesh.totalTriangles).toBe(35105);
      expect(mesh.submeshes.length).toBe(117);
    }
  });
});
