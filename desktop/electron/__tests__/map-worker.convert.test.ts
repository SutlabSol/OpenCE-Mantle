// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap } from '../../../core/src/index';
import { __setCurrentMapForTest, __getCurrentMapForTest, __setSinkForTest, __setMapFsForTest, runInspect, runConvertPreflight, runConvertMap } from '../map-worker';

/**
 * Convert to Custom Edition in the worker, on COPIES of the sample maps in a temp folder (never
 * sample_maps itself). The HaloMD maps are in sample_maps/demo. Byte checks compare the written
 * file against the source bytes directly.
 */
const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR ? path.resolve(process.env.SAMPLE_MAPS_DIR) : path.resolve(__dirname, '../../../sample_maps');
const gate = (names: string[]) => {
  const missing = names.filter((n) => !fs.existsSync(path.join(SAMPLE_MAPS_DIR, n)));
  return { skip: missing.length > 0, suffix: missing.length ? ` [SKIPPED: missing ${missing.join(', ')} in "${SAMPLE_MAPS_DIR}" - set SAMPLE_MAPS_DIR]` : '' };
};
const HEH = gate(['demo/heh_2.map']);
const ISLAND = gate(['demo/theisland_3.map']);
const DEMO = gate(['demo/bloodgulch.map']);
const CE = gate(['bloodgulch.map']);

type Msg = { type: string; requestId?: string; payload?: any; code?: string; message?: string };
let messages: Msg[] = [];

async function call<T = any>(fn: (task: any) => unknown, task: Record<string, unknown> = {}): Promise<T> {
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

function differingRanges(a: Buffer, b: Buffer): string[] {
  expect(b.length).toBe(a.length);
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= a.length; i++) {
    const differs = i < a.length && a[i] !== b[i];
    if (differs && start < 0) start = i;
    if (!differs && start >= 0) {
      out.push(`0x${start.toString(16).toUpperCase()}-0x${(i - 1).toString(16).toUpperCase()}`);
      start = -1;
    }
  }
  return out;
}

let dir: string;
let srcDir: string;
let outDir: string;

/** Copies a sample map into the temp source folder; returns its path. */
function copyIn(name: string): string {
  const p = path.join(srcDir, path.basename(name));
  fs.copyFileSync(path.join(SAMPLE_MAPS_DIR, name), p);
  return p;
}
const statOf = (p: string) => {
  const s = fs.statSync(p);
  return `${s.size}|${s.mtimeMs}`;
};

beforeEach(() => {
  __setSinkForTest((m) => messages.push(m as Msg));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-convert-'));
  srcDir = path.join(dir, 'halomd');
  outDir = path.join(dir, 'haloce');
  fs.mkdirSync(srcDir);
  fs.mkdirSync(outDir);
});

afterEach(() => {
  __setMapFsForTest(null);
  __setCurrentMapForTest(null);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp cleanup only */
  }
});

describe('map-worker: opening maps the converter knows', () => {
  it.skipIf(HEH.skip)(`a retail-layout map opens as unsupported with Convert offered; nothing is held${HEH.suffix}`, async () => {
    const result = await call(runInspect, { filePath: copyIn('demo/heh_2.map') });
    expect(result).toMatchObject({ status: 'unsupported', layout: 'retail', convertible: true });
    expect(result.message).toMatch(/Convert to Custom Edition/);
    expect(__getCurrentMapForTest()).toBeNull();
  });

  it.skipIf(DEMO.skip)(`the original demo layout opens as unsupported (Phase 2), not as "not a Halo map"${DEMO.suffix}`, async () => {
    const result = await call(runInspect, { filePath: copyIn('demo/bloodgulch.map') });
    expect(result).toMatchObject({ status: 'unsupported', layout: 'demo', convertible: false });
    expect(result.message).toMatch(/not supported yet/);
  });
});

describe('map-worker: Convert to Custom Edition', () => {
  it.skipIf(HEH.skip)(`heh_2: pre-flight, then convert to a new file that becomes the open map; the source is untouched${HEH.suffix}`, async () => {
    const source = copyIn('demo/heh_2.map');
    const sourceBytes = fs.readFileSync(source);
    const sourceStat = statOf(source);

    const pre = await call(runConvertPreflight, { filePath: source });
    expect(pre).toMatchObject({ ok: true, sourceFileName: 'heh_2.map', report: { canConvert: true, requiresAcknowledgement: false, newCrc32: 0xd1c331e9 } });

    const output = path.join(outDir, 'heh_2.map');
    const result = await call(runConvertMap, { sourcePath: source, outputPath: output, acknowledgeScripts: false });
    expect(result).toMatchObject({ ok: true, outputPath: output, scenarioName: 'heh_2', crc32: 0xd1c331e9, previousCrc32: 0 });

    const written = fs.readFileSync(output);
    expect(differingRanges(sourceBytes, written)).toEqual(['0x4-0x5', '0x4A-0x4C', '0x64-0x67']);
    expect(written.readUInt32LE(0x64)).toBe(0xd1c331e9);
    expect(inspectCustomEditionMap(written).status).toBe('ok');

    // Source never written; no temp files or backups anywhere.
    expect(fs.readFileSync(source).equals(sourceBytes)).toBe(true);
    expect(statOf(source)).toBe(sourceStat);
    expect(fs.readdirSync(srcDir)).toEqual(['heh_2.map']);
    expect(fs.readdirSync(outDir)).toEqual(['heh_2.map']);

    const held = __getCurrentMapForTest()!;
    expect(held.filePath).toBe(output);
    expect(held.modified).toBe(false);
    expect(held.buffer.equals(written)).toBe(true);
    expect(result.map).toMatchObject({ status: 'ok', filePath: output, modified: false, header: { scenarioName: 'heh_2', buildString: '01.00.00.0609' } });
  });

  it.skipIf(ISLAND.skip)(`theisland_3 under another name: CRC32 0x0A5AFEA5, the name bytes change too${ISLAND.suffix}`, async () => {
    const source = copyIn('demo/theisland_3.map');
    const sourceBytes = fs.readFileSync(source);
    const output = path.join(outDir, 'island_ce.map');
    const result = await call(runConvertMap, { sourcePath: source, outputPath: output, acknowledgeScripts: false });
    expect(result).toMatchObject({ ok: true, scenarioName: 'island_ce', previousScenarioName: 'theisland_3', crc32: 0x0a5afea5 });
    expect(differingRanges(sourceBytes, fs.readFileSync(output))).toEqual(['0x4-0x5', '0x20-0x2A', '0x4A-0x4C', '0x64-0x67']);
    expect(fs.readFileSync(source).equals(sourceBytes)).toBe(true);
  });

  it.skipIf(HEH.skip)(`refuses to write over the source map${HEH.suffix}`, async () => {
    const source = copyIn('demo/heh_2.map');
    const before = statOf(source);
    const err = await callError(runConvertMap, { sourcePath: source, outputPath: source.toUpperCase(), acknowledgeScripts: false });
    expect(err.code).toBe('REFUSED_SOURCE_PATH');
    expect(statOf(source)).toBe(before);
    expect(fs.readdirSync(srcDir)).toEqual(['heh_2.map']);
  });

  it.skipIf(CE.skip)(`refuses an already-Custom-Edition map and writes nothing${CE.suffix}`, async () => {
    const source = copyIn('bloodgulch.map');
    const err = await callError(runConvertMap, { sourcePath: source, outputPath: path.join(outDir, 'bg.map'), acknowledgeScripts: true });
    expect(err.code).toBe('REFUSED');
    expect(err.message).toMatch(/already a Custom Edition map/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it.skipIf(HEH.skip)(`a failed write leaves no output and no temp file, and says the source was not changed${HEH.suffix}`, async () => {
    const source = copyIn('demo/heh_2.map');
    __setMapFsForTest({
      renameSync: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    });
    const err = await callError(runConvertMap, { sourcePath: source, outputPath: path.join(outDir, 'heh_2.map'), acknowledgeScripts: false });
    expect(err.code).toBe('WRITE_FAILED');
    expect(err.message).toMatch(/source map was not changed/);
    expect(fs.readdirSync(outDir)).toEqual([]);
    expect(__getCurrentMapForTest()).toBeNull();
  });
});
