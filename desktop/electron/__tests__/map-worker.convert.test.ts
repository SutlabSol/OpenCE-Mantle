// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap } from '../../../core/src/index';
import { sampleIn, sampleMapPath, skippableTest } from '../../../core/tests/helpers/sample-maps';
import { rawAssets, rawCrc } from '../../../core/tests/helpers/raw-map';
import { __setCurrentMapForTest, __getCurrentMapForTest, __setSinkForTest, __setMapFsForTest, runInspect, runConvertPreflight, runConvertMap } from '../map-worker';

/**
 * Convert to Custom Edition in the worker, on COPIES of the sample maps in a temp folder (never
 * sample_maps itself). Sample paths and folders come from the core sample-maps helper. Byte checks compare the written
 * file against the source bytes directly.
 */
const gate = (names: string[]) => {
  const g = skippableTest(names);
  return { skip: g.skip, suffix: g.titleSuffix };
};
const HEH = gate([sampleIn('haloMD', 'heh_2.map')]);
const ISLAND = gate([sampleIn('haloMD', 'theisland_3.map')]);
const DEMO = gate([sampleIn('macDemo', 'bloodgulch.map')]);
const CE = gate(['bloodgulch.map']);

type Msg = { type: string; requestId?: string; payload?: any; code?: string; message?: string; stage?: string };
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
  fs.copyFileSync(sampleMapPath(name), p);
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
    const result = await call(runInspect, { filePath: copyIn(sampleIn('haloMD', 'heh_2.map')) });
    expect(result).toMatchObject({ status: 'unsupported', layout: 'retail', convertible: true });
    expect(result.message).toMatch(/Convert to Custom Edition/);
    expect(__getCurrentMapForTest()).toBeNull();
  });

  it.skipIf(DEMO.skip)(`the original demo layout (Phase 2) opens as unsupported but convertible, not as "not a Halo map"${DEMO.suffix}`, async () => {
    const result = await call(runInspect, { filePath: copyIn(sampleIn('macDemo', 'bloodgulch.map')) });
    expect(result).toMatchObject({ status: 'unsupported', layout: 'demo', convertible: true });
    expect(result.message).toMatch(/Convert to Custom Edition/);
    expect(__getCurrentMapForTest()).toBeNull();
  });
});

/**
 * A retail-layout (v7) map with all bitmap and sound data internal, written into the temp source
 * folder: ui.map with version 7, the HaloMD build string, and every asset's external bit cleared
 * (raw bytes, `core/tests/helpers/raw-map.ts`). No real v7 sample map is fully internal, and until
 * the Source files step (Stage 3) the worker cannot pass resource files, so this is the map the
 * worker's header-only success and failed-write paths are tested with.
 */
function writeInternalRetailUi(name: string): string {
  const out = Buffer.from(fs.readFileSync(sampleMapPath('ui.map')));
  for (const a of rawAssets(out)) {
    if (a.flagWidth === 2) out.writeUInt16LE(a.flagValue & ~0x100, a.flagAt);
    else out.writeUInt32LE((a.flagValue & ~1) >>> 0, a.flagAt);
  }
  out.writeUInt32LE(7, 0x4);
  out.fill(0, 0x40, 0x60);
  out.write('01.00.00.0576', 0x40, 'ascii');
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, out);
  return p;
}
const UI = gate(['ui.map']);

describe('map-worker: Convert to Custom Edition', () => {
  it.skipIf(UI.skip)(`a v7 map with all data internal: pre-flight, then convert to a new file that becomes the open map; the source is untouched${UI.suffix}`, async () => {
    const source = writeInternalRetailUi('ui_retail.map');
    const sourceBytes = fs.readFileSync(source);
    const sourceStat = statOf(source);

    const pre = await call(runConvertPreflight, { filePath: source });
    expect(pre).toMatchObject({ ok: true, sourceFileName: 'ui_retail.map', report: { canConvert: true, externalData: { bitmaps: { count: 0 }, sounds: { count: 0 } } } });
    const crc = pre.report.newCrc32;
    expect(crc).toBe(rawCrc(sourceBytes));

    const output = path.join(outDir, 'ui_retail.map');
    const result = await call(runConvertMap, { sourcePath: source, outputPath: output, acknowledgeScripts: true });
    expect(result).toMatchObject({ ok: true, outputPath: output, scenarioName: 'ui_retail', previousScenarioName: 'ui', crc32: crc });

    const written = fs.readFileSync(output);
    expect(differingRanges(sourceBytes, written)).toEqual(['0x4-0x5', '0x22-0x28', '0x4A-0x4C', '0x64-0x67']);
    expect(written.readUInt32LE(0x64)).toBe(rawCrc(written));
    expect(inspectCustomEditionMap(written).status).toBe('ok');

    // Source never written; no temp files or backups anywhere.
    expect(fs.readFileSync(source).equals(sourceBytes)).toBe(true);
    expect(statOf(source)).toBe(sourceStat);
    expect(fs.readdirSync(srcDir)).toEqual(['ui_retail.map']);
    expect(fs.readdirSync(outDir)).toEqual(['ui_retail.map']);

    const held = __getCurrentMapForTest()!;
    expect(held.filePath).toBe(output);
    expect(held.modified).toBe(false);
    expect(held.buffer.equals(written)).toBe(true);
    expect(result.map).toMatchObject({ status: 'ok', filePath: output, modified: false, header: { scenarioName: 'ui_retail', buildString: '01.00.00.0609' } });
  });

  for (const [g, file] of [
    [HEH, 'heh_2.map'],
    [ISLAND, 'theisland_3.map'],
  ] as const) {
    it.skipIf(g.skip)(`${file}: its bitmap and sound data is external, so without resource files it is refused and nothing is written${g.suffix}`, async () => {
      const source = copyIn(sampleIn('haloMD', file));
      const before = statOf(source);
      const pre = await call(runConvertPreflight, { filePath: source });
      expect(pre.report.canConvert).toBe(false);
      expect(pre.report.checks.find((k: { id: string }) => k.id === 'externalData')).toMatchObject({ status: 'refuse' });
      const err = await callError(runConvertMap, { sourcePath: source, outputPath: path.join(outDir, file), acknowledgeScripts: true });
      expect(err.code).toBe('REFUSED');
      expect(err.message).toMatch(/source game's bitmaps\.map and sounds\.map/);
      expect(fs.readdirSync(outDir)).toEqual([]);
      expect(statOf(source)).toBe(before);
      expect(__getCurrentMapForTest()).toBeNull();
    });
  }

  it.skipIf(HEH.skip)(`heh_2.map with HaloMD's bitmaps.map and sounds.map: pre-flight passes and the convert copies the external data in${HEH.suffix}`, async () => {
    const source = copyIn(sampleIn('haloMD', 'heh_2.map'));
    const sourceBytes = fs.readFileSync(source);
    const sourceStat = statOf(source);
    const bitmaps = sampleMapPath(sampleIn('haloMD', 'bitmaps.map'));
    const sounds = sampleMapPath(sampleIn('haloMD', 'sounds.map'));

    const pre = await call(runConvertPreflight, { filePath: source, bitmapsPath: bitmaps, soundsPath: sounds });
    expect(pre.report.canConvert).toBe(true);
    expect(pre.report.checks.find((k: { id: string }) => k.id === 'externalData')).toMatchObject({ status: 'info' });
    expect(pre.report.checks.find((k: { id: string }) => k.id === 'resourceFiles')).toMatchObject({ status: 'pass' });

    const output = path.join(outDir, 'heh_2.map');
    const result = await call(runConvertMap, {
      sourcePath: source,
      outputPath: output,
      acknowledgeScripts: true,
      repairs: { alignTagData: true },
      bitmapsPath: bitmaps,
      soundsPath: sounds,
    });
    expect(result).toMatchObject({ ok: true, outputPath: output, scenarioName: 'heh_2' });

    const written = fs.readFileSync(output);
    expect(written.length).toBe(70_827_478 + 2); // the core test's expected Phase 1b size + the required alignment
    expect(written.readUInt32LE(0x64)).toBe(rawCrc(written));
    expect(inspectCustomEditionMap(written).status).toBe('ok');

    // The external-data copy reported progress to the window (onProgress -> worker progress()).
    expect(messages.some((m) => m.type === 'progress' && /^Copying bitmap and sound data \(\d+%\)$/.test(m.stage ?? ''))).toBe(true);

    // Source untouched; only the output is in the out folder.
    expect(fs.readFileSync(source).equals(sourceBytes)).toBe(true);
    expect(statOf(source)).toBe(sourceStat);
    expect(fs.readdirSync(outDir)).toEqual(['heh_2.map']);

    const held = __getCurrentMapForTest()!;
    expect(held.filePath).toBe(output);
    expect(held.modified).toBe(false);
    expect(held.buffer.equals(written)).toBe(true);
  });

  it.skipIf(DEMO.skip)(`a true demo map (MacDemo bloodgulch.map) is convertible and converts to bloodgulch_demo.map with the Mac demo's resource files${DEMO.suffix}`, async () => {
    const source = copyIn(sampleIn('macDemo', 'bloodgulch.map'));
    const sourceBytes = fs.readFileSync(source);
    const sourceStat = statOf(source);
    const bitmaps = sampleMapPath(sampleIn('macDemo', 'bitmaps.map'));
    const sounds = sampleMapPath(sampleIn('macDemo', 'sounds.map'));

    // runInspect reports the unsupported layout as convertible (the demo converter pipeline).
    const inspected = await call(runInspect, { filePath: source });
    expect(inspected).toMatchObject({ status: 'unsupported', layout: 'demo', convertible: true });
    expect('message' in inspected && inspected.message).toMatch(/original Halo demo map/);

    // Step 1: the pre-flight dispatches to the demo pipeline and passes with the demo's own resource files.
    const pre = await call(runConvertPreflight, { filePath: source, bitmapsPath: bitmaps, soundsPath: sounds });
    expect(pre).toMatchObject({ ok: true, sourceFileName: 'bloodgulch.map', report: { canConvert: true, estimatedOutputSize: 70_828_894 } });
    expect(pre.report.previousCrc32).toBe(0xe7e08c22);
    expect(pre.report.checks.find((k: { id: string }) => k.id === 'demoRebase')).toMatchObject({ status: 'pass' });
    expect(pre.report.checks.find((k: { id: string }) => k.id === 'resourceFiles')).toMatchObject({ status: 'pass' });

    // Step 2: the conversion writes the CE map; it is named after the output file and reads back cleanly.
    const output = path.join(outDir, 'bloodgulch_demo.map');
    const result = await call(runConvertMap, { sourcePath: source, outputPath: output, acknowledgeScripts: false, bitmapsPath: bitmaps, soundsPath: sounds });
    expect(result).toMatchObject({ ok: true, outputPath: output, scenarioName: 'bloodgulch_demo', previousCrc32: 0xe7e08c22 });

    const written = fs.readFileSync(output);
    expect(written.length).toBe(70_828_894);
    expect(written.readUInt32LE(0x4)).toBe(609);
    expect(written.toString('ascii', 0x40, 0x4d)).toBe('01.00.00.0609');
    expect(written.readUInt32LE(0x64)).toBe(rawCrc(written));
    expect(written.subarray(0x20, 0x40).equals(Buffer.concat([Buffer.from('bloodgulch_demo'), Buffer.alloc(17)]))).toBe(true);
    expect(inspectCustomEditionMap(written).status).toBe('ok');

    // The external-data copy reported progress to the window.
    expect(messages.some((m) => m.type === 'progress' && /^Copying bitmap and sound data \(\d+%\)/.test(m.stage ?? ''))).toBe(true);

    // Source untouched; only the output is in the out folder.
    expect(fs.readFileSync(source).equals(sourceBytes)).toBe(true);
    expect(statOf(source)).toBe(sourceStat);
    expect(fs.readdirSync(outDir)).toEqual(['bloodgulch_demo.map']);

    const held = __getCurrentMapForTest()!;
    expect(held.filePath).toBe(output);
    expect(held.modified).toBe(false);
    expect(held.buffer.equals(written)).toBe(true);
  }, 120_000);

  it.skipIf(HEH.skip)(`refuses to write over the source map${HEH.suffix}`, async () => {
    const source = copyIn(sampleIn('haloMD', 'heh_2.map'));
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

  it.skipIf(UI.skip)(`a failed write leaves no output and no temp file, and says the source was not changed${UI.suffix}`, async () => {
    const source = writeInternalRetailUi('ui_retail.map');
    __setMapFsForTest({
      renameSync: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    });
    const err = await callError(runConvertMap, { sourcePath: source, outputPath: path.join(outDir, 'ui_retail.map'), acknowledgeScripts: true });
    expect(err.code).toBe('WRITE_FAILED');
    expect(err.message).toMatch(/source map was not changed/);
    expect(fs.readdirSync(outDir)).toEqual([]);
    expect(__getCurrentMapForTest()).toBeNull();
  });
});
