// @vitest-environment node
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap, encodeRgbaToPng } from '../../../core/src/index';
import {
  __setCurrentMapForTest,
  __setSinkForTest,
  runGetBitmapInfo,
  runGetBitmapRgba,
  runExportBitmap,
  runReplaceBitmapImage,
} from '../map-worker';
import type {
  GetBitmapInfoResult,
  GetBitmapRgbaResult,
  ExportBitmapResult,
  ReplaceBitmapResult,
} from '../shared-types';

const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR
  ? path.resolve(process.env.SAMPLE_MAPS_DIR)
  : path.resolve(__dirname, '../../../sample_maps');

const bgPath = path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map');
const bmPath = path.join(SAMPLE_MAPS_DIR, 'bitmaps.map');
const hasBg = fs.existsSync(bgPath) && fs.existsSync(bmPath);

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

describe.skipIf(!hasBg)('map-worker: Bitmap Editor & Injector (Milestone 13.1)', () => {
  let tmpDir: string;

  beforeAll(() => {
    __setSinkForTest((m) => messages.push(m as Msg));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-bitmap-test-'));
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

  it('inspects a bitmap tag and returns sequences and image plate info', async () => {
    // Find bitmap tag in bloodgulch
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const bitm = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'bitmap');
    expect(bitm).toBeDefined();

    const res = await call<GetBitmapInfoResult>(runGetBitmapInfo, {
      tagIndex: bitm!.index,
      bitmapsPath: bmPath,
    });

    expect(res.ok).toBe(true);
    expect(res.summary).toBeDefined();
    expect(res.summary!.images.length).toBeGreaterThan(0);
    expect(res.summary!.images[0].width).toBeGreaterThan(0);
  });

  it('decodes an image plate to base64 PNG dataUrl for UI preview', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const bitm = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'bitmap');
    expect(bitm).toBeDefined();

    const res = await call<GetBitmapRgbaResult>(runGetBitmapRgba, {
      tagIndex: bitm!.index,
      imageIndex: 0,
      bitmapsPath: bmPath,
    });

    expect(res.ok).toBe(true);
    expect(res.width).toBeGreaterThan(0);
    expect(res.height).toBeGreaterThan(0);
    expect(res.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('exports an image plate to PNG and DDS on disk', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const bitm = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'bitmap');
    expect(bitm).toBeDefined();

    const outPng = path.join(tmpDir, 'test_export.png');
    const outDds = path.join(tmpDir, 'test_export.dds');

    const resPng = await call<ExportBitmapResult>(runExportBitmap, {
      tagIndex: bitm!.index,
      imageIndex: 0,
      format: 'png',
      outputPath: outPng,
      bitmapsPath: bmPath,
    });
    expect(resPng.ok).toBe(true);
    expect(fs.existsSync(outPng)).toBe(true);
    expect(fs.statSync(outPng).size).toBeGreaterThan(16);

    const resDds = await call<ExportBitmapResult>(runExportBitmap, {
      tagIndex: bitm!.index,
      imageIndex: 0,
      format: 'dds',
      outputPath: outDds,
      bitmapsPath: bmPath,
    });
    expect(resDds.ok).toBe(true);
    expect(fs.existsSync(outDds)).toBe(true);
    expect(fs.readFileSync(outDds).readUInt32LE(0)).toBe(0x20534444); // "DDS "
  });

  it('imports and replaces an image plate from a custom PNG file', async () => {
    const buf = fs.readFileSync(bgPath);
    const inspected = inspectCustomEditionMap(buf);
    if (inspected.status !== 'ok') throw new Error('parse failed');
    const bitm = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'bitmap');
    expect(bitm).toBeDefined();

    // Create a 16x16 test PNG file
    const customPixels = new Uint8Array(16 * 16 * 4).fill(200);
    const pngBytes = encodeRgbaToPng(customPixels, 16, 16);
    const customPngPath = path.join(tmpDir, 'custom_input.png');
    fs.writeFileSync(customPngPath, pngBytes);

    const replaceRes = await call<ReplaceBitmapResult>(runReplaceBitmapImage, {
      tagIndex: bitm!.index,
      imageIndex: 0,
      inputPath: customPngPath,
      bitmapsPath: bmPath,
    });

    expect(replaceRes.ok).toBe(true);
    expect(replaceRes.map?.modified).toBe(true);

    // Verify re-inspection reflects updated dimensions
    const verifyRes = await call<GetBitmapInfoResult>(runGetBitmapInfo, {
      tagIndex: bitm!.index,
      bitmapsPath: bmPath,
    });
    expect(verifyRes.summary!.images[0].width).toBe(16);
    expect(verifyRes.summary!.images[0].height).toBe(16);
    expect(verifyRes.summary!.images[0].isExternal).toBe(false);
  });
});
