// @vitest-environment node
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap } from '../../../core/src/index';
import {
  __setCurrentMapForTest,
  __setSinkForTest,
  runGetBspRenderMesh,
  runGetBitmapTexture,
} from '../map-worker';
import type { GetBspRenderMeshResult, GetBitmapTextureResult } from '../shared-types';

const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR
  ? path.resolve(process.env.SAMPLE_MAPS_DIR)
  : path.resolve(__dirname, '../../../sample_maps');

const bgPath = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');
const hasBg = fs.existsSync(bgPath);

type Msg = { type: string; requestId?: string; payload?: unknown; code?: string; message?: string };
let messages: Msg[] = [];

async function call<T = unknown>(fn: (task: any) => unknown, task: Record<string, unknown> = {}): Promise<T> {
  const requestId = randomUUID();
  messages = [];
  await fn({ requestId, ...task });
  const err = messages.find((m) => m.type === 'error' && m.requestId === requestId);
  if (err) throw Object.assign(new Error(err.message), { code: err.code });
  const res = messages.find((m) => m.type === 'result' && m.requestId === requestId);
  if (!res) throw new Error('no result');
  return res.payload as T;
}

async function callError(fn: (task: any) => unknown, task: Record<string, unknown> = {}): Promise<{ code: string; message: string }> {
  try {
    await call(fn, task);
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error('expected an error');
}

describe('map-worker: 3D render extraction (Step 8.4)', () => {
  beforeEach(() => {
    messages = [];
    __setSinkForTest((msg) => messages.push(msg as Msg));
    __setCurrentMapForTest(null);
  });

  it('reports NO_MAP_LOADED when no map is open', async () => {
    const errMesh = await callError(runGetBspRenderMesh);
    expect(errMesh.code).toBe('NO_MAP_LOADED');

    const errTex = await callError(runGetBitmapTexture, { bitmapTagId: 0x1234 });
    expect(errTex.code).toBe('NO_MAP_LOADED');
  });

  it.skipIf(!hasBg)('extracts Structure BSP geometry for bloodgulch.map', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    __setCurrentMapForTest({
      filePath: bgPath,
      buffer: buf,
      header: inspected.header,
      tagIndex: inspected.tagIndex,
    });

    const res = await call<GetBspRenderMeshResult>(runGetBspRenderMesh, { bspIndex: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.mesh.bspIndex).toBe(0);
    expect(res.mesh.submeshes.length).toBe(79);
    expect(res.mesh.totalVertices).toBe(5762);
    expect(res.mesh.totalTriangles).toBe(5503);

    // Verify first submesh has valid interleaved vertices and indices
    const sub0 = res.mesh.submeshes[0];
    expect(sub0.vertexCount).toBeGreaterThan(0);
    expect(sub0.vertices.length).toBe(sub0.vertexCount * 8);
    expect(sub0.indices.length).toBeGreaterThan(0);
    expect(sub0.boundingBox).toBeDefined();
  });

  it.skipIf(!hasBg)('decodes diffuse bitmap texture from a shader or bitmap tag', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    __setCurrentMapForTest({
      filePath: bgPath,
      buffer: buf,
      header: inspected.header,
      tagIndex: inspected.tagIndex,
    });

    // 1. Get BSP mesh to retrieve a valid shaderTagId
    const bspRes = await call<GetBspRenderMeshResult>(runGetBspRenderMesh, { bspIndex: 0 });
    expect(bspRes.ok).toBe(true);
    if (!bspRes.ok) return;

    const subWithShader = bspRes.mesh.submeshes.find((s) => s.shaderTagId !== 0xffffffff && s.shaderTagId !== 0);
    expect(subWithShader).toBeDefined();

    // 2. Fetch texture using the shader tag ID
    const texRes = await call<GetBitmapTextureResult>(runGetBitmapTexture, { bitmapTagId: subWithShader!.shaderTagId });
    expect(texRes.ok).toBe(true);
    if (!texRes.ok) return;

    expect(texRes.texture.width).toBeGreaterThan(0);
    expect(texRes.texture.height).toBeGreaterThan(0);
    expect(texRes.texture.rgbaData.length).toBe(texRes.texture.width * texRes.texture.height * 4);
  });
});
