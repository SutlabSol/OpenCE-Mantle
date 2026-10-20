// @vitest-environment node
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap } from '../../../core/src/index';
import {
  __setCurrentMapForTest,
  __setSinkForTest,
  runExportModel3d,
  runExportBsp3d,
} from '../map-worker';
import type { Export3dResult } from '../shared-types';

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
  if (err) {
    console.error('Call failed with error:', err);
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  const res = messages.find((m) => m.type === 'result' && m.requestId === requestId);
  if (!res) throw new Error('no result');
  return res.payload as T;
}

describe.skipIf(!hasBg)('map-worker: 3D Model & BSP Exporter (Milestone 13.3)', () => {
  let tmpDir: string;

  beforeAll(() => {
    __setSinkForTest((m) => messages.push(m as Msg));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-3d-test-'));
  });

  beforeEach(() => {
    messages = [];
    const buf = Buffer.from(fs.readFileSync(bgPath));
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    __setCurrentMapForTest({
      filePath: bgPath,
      buffer: buf,
      header: inspected.header,
      tagIndex: inspected.tagIndex,
      modified: false,
    });
  });

  it('exports a gbxmodel tag to glTF 2.0 Binary (.glb) on disk', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const modelTag = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'gbxmodel');
    expect(modelTag).toBeDefined();

    const outGlb = path.join(tmpDir, 'model_test.glb');
    const res = await call<Export3dResult>(runExportModel3d, {
      modelTagId: modelTag!.tagId,
      lod: 4,
      format: 'glb',
      outputPath: outGlb,
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(outGlb)).toBe(true);
    const fileBytes = fs.readFileSync(outGlb);
    expect(fileBytes.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  });

  it('exports a gbxmodel tag to Wavefront OBJ + MTL on disk', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const modelTag = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'gbxmodel');
    expect(modelTag).toBeDefined();

    const outObj = path.join(tmpDir, 'model_test.obj');
    const outMtl = path.join(tmpDir, 'model_test.mtl');
    const res = await call<Export3dResult>(runExportModel3d, {
      modelTagId: modelTag!.tagId,
      lod: 4,
      format: 'obj',
      outputPath: outObj,
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(outObj)).toBe(true);
    expect(fs.existsSync(outMtl)).toBe(true);
    const objText = fs.readFileSync(outObj, 'utf8');
    expect(objText).toContain('mtllib model_test.mtl');
    expect(objText).toContain('v ');
    expect(objText).toContain('f ');
  });

  it('exports Structure BSP 0 to glTF 2.0 Binary (.glb) on disk', async () => {
    const outGlb = path.join(tmpDir, 'bsp_test.glb');
    const res = await call<Export3dResult>(runExportBsp3d, {
      bspIndex: 0,
      format: 'glb',
      outputPath: outGlb,
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(outGlb)).toBe(true);
    const fileBytes = fs.readFileSync(outGlb);
    expect(fileBytes.readUInt32LE(0)).toBe(0x46546c67);
  });

  it('exports Structure BSP 0 to Wavefront OBJ + MTL on disk', async () => {
    const outObj = path.join(tmpDir, 'bsp_test.obj');
    const outMtl = path.join(tmpDir, 'bsp_test.mtl');
    const res = await call<Export3dResult>(runExportBsp3d, {
      bspIndex: 0,
      format: 'obj',
      outputPath: outObj,
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(outObj)).toBe(true);
    expect(fs.existsSync(outMtl)).toBe(true);
    const objText = fs.readFileSync(outObj, 'utf8');
    expect(objText).toContain('mtllib bsp_test.mtl');
    expect(objText).toContain('v ');
    expect(objText).toContain('f ');
  });
});
