// @vitest-environment node
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap } from '../../../core/src/index';
import { __setCurrentMapForTest, __setSinkForTest, __cancelForTest, runExtractTags, runSaveMapAs, runBatchExtract, runGetTagFields, runUpdateTagField, runGetDependencySlots, runSetDependencySlot, type LoadedMap } from '../map-worker';

/**
 * Not sharing `core/tests/helpers/sample-maps.ts` here: that helper uses `import.meta.url`
 * (core's tsconfig targets ESM for Vitest), which conflicts with electron's CommonJS tsc build
 * (`tsc --noEmit -p electron/tsconfig.json` fails on `import.meta` otherwise). Same
 * `SAMPLE_MAPS_DIR` env var / default-location convention, duplicated minimally.
 */
const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR ? path.resolve(process.env.SAMPLE_MAPS_DIR) : path.resolve(__dirname, '../../../sample_maps');
function sampleMapPath(name: string): string {
  return path.join(SAMPLE_MAPS_DIR, name);
}
const haveBloodgulch = fs.existsSync(sampleMapPath('bloodgulch.map'));

/**
 * extractTagSet()/walkDependencies() are fully synchronous (no `await` inside their loops), so a
 * cancel request can only take effect BEFORE that synchronous call starts or AFTER it returns -
 * Node's single-threaded event loop cannot run the cancel-polling timer mid-call. Benchmarked
 * worst case (select-all on bloodgulch.map, 2455 tags) is ~500ms total (see
 * core/scripts/bench-extract.ts) - short enough that this is an accepted trade-off, not a bug to
 * fix. This test exercises the realistic case: cancel arrives before/at the start of extraction,
 * which must guarantee no output file and no leftover temp file.
 */
const title = haveBloodgulch
  ? 'map-worker extraction cancel leaves no partial file'
  : `map-worker extraction cancel leaves no partial file [missing bloodgulch.map in "${SAMPLE_MAPS_DIR}" - set SAMPLE_MAPS_DIR or see core/README.md]`;

describe.skipIf(!haveBloodgulch)(title, () => {
  let loadedMap: LoadedMap;
  let outDir: string;

  beforeAll(() => {
    const buffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    loadedMap = { filePath: sampleMapPath('bloodgulch.map'), buffer, header: inspected.header, tagIndex: inspected.tagIndex };
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-cancel-test-'));
  });

  afterEach(() => {
    __setCurrentMapForTest(null);
  });

  it('cancelling before extraction starts writes no output file and leaves no temp file', () => {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const requestId = randomUUID();
    const outputPath = path.join(outDir, `cancel-test-${requestId}.ocetags`);
    __cancelForTest(requestId); // simulates the cancel message arriving before extraction runs

    const allIndices = loadedMap.tagIndex.entries.map((e) => e.index);
    runExtractTags({ requestId, originalIndices: allIndices, outputPath, sourceMapName: 'bloodgulch' });

    const errorMsg = messages.find((m) => m.type === 'error');
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.code).toBe('CANCELLED');
    expect(messages.some((m) => m.type === 'result')).toBe(false);

    expect(fs.existsSync(outputPath)).toBe(false);
    const leftoverTempFiles = fs.readdirSync(outDir).filter((f) => f.includes('.tmp-'));
    expect(leftoverTempFiles).toEqual([]);
  });

  it('a normal (non-cancelled) extraction writes exactly the output file, no leftover temp file', () => {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const requestId = randomUUID();
    const outputPath = path.join(outDir, `ok-test-${requestId}.ocetags`);
    const warthogIndex = loadedMap.tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\mp_warthog' && e.primaryClassName === 'vehicle')!.index;

    runExtractTags({ requestId, originalIndices: [warthogIndex], outputPath, sourceMapName: 'bloodgulch' });

    const resultMsg = messages.find((m) => m.type === 'result') as { type: string; payload: { ok: boolean; outputPath: string } } | undefined;
    expect(resultMsg?.payload.ok).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(true);
    const leftoverTempFiles = fs.readdirSync(outDir).filter((f) => f.includes('.tmp-'));
    expect(leftoverTempFiles).toEqual([]);
  });
});

const saveTitle = haveBloodgulch
  ? 'map-worker File > Save As (finalize + temp file then rename)'
  : `map-worker File > Save As [missing bloodgulch.map in "${SAMPLE_MAPS_DIR}" - set SAMPLE_MAPS_DIR or see core/README.md]`;

describe.skipIf(!haveBloodgulch)(saveTitle, () => {
  let source: Buffer;
  let outDir: string;
  let loadedMap: LoadedMap;

  beforeAll(() => {
    source = fs.readFileSync(sampleMapPath('bloodgulch.map'));
    const inspected = inspectCustomEditionMap(source);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-saveas-test-'));
    // The "open map" path is a temp location, so a broken guard could never touch sample_maps.
    loadedMap = { filePath: path.join(outDir, 'open.map'), buffer: source, header: inspected.header, tagIndex: inspected.tagIndex };
  });

  afterEach(() => {
    __setCurrentMapForTest(null);
  });

  function save(outputPath: string) {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));
    runSaveMapAs({ requestId: randomUUID(), outputPath });
    return messages;
  }

  it('saved under its own scenario name: byte-identical to the source, no temp file left', () => {
    const outputPath = path.join(outDir, 'bloodgulch.map');
    const result = save(outputPath).find((m) => m.type === 'result') as { payload: { ok: boolean; scenarioName: string } } | undefined;
    expect(result?.payload.ok).toBe(true);
    expect(result?.payload.scenarioName).toBe('bloodgulch');
    expect(fs.readFileSync(outputPath).equals(source)).toBe(true);
    expect(fs.readdirSync(outDir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('saved under another name: only the scenario name (0x20-0x3F) and CRC32 (0x64-0x67) may differ', () => {
    const outputPath = path.join(outDir, 'my test copy.map');
    const result = save(outputPath).find((m) => m.type === 'result') as { payload: { ok: boolean; scenarioName: string } } | undefined;
    expect(result?.payload.scenarioName).toBe('my test copy');
    const written = fs.readFileSync(outputPath);
    expect(written.length).toBe(source.length);
    const diffs: number[] = [];
    for (let i = 0; i < source.length; i++) if (written[i] !== source[i]) diffs.push(i);
    expect(diffs.filter((i) => !((i >= 0x20 && i <= 0x3f) || (i >= 0x64 && i <= 0x67)))).toEqual([]);
    expect(written.toString('ascii', 0x20, 0x2c)).toBe('my test copy');
  });

  it('refuses to overwrite the open map and writes nothing', () => {
    const messages = save(loadedMap.filePath.toUpperCase());
    expect(messages.find((m) => m.type === 'error')?.code).toBe('REFUSED_SOURCE_PATH');
    expect(fs.existsSync(loadedMap.filePath)).toBe(false);
  });
});

const batchTitle = haveBloodgulch
  ? 'map-worker whole map batch extract (Roadmap Item C)'
  : `map-worker whole map batch extract [missing bloodgulch.map in "${SAMPLE_MAPS_DIR}"]`;

describe.skipIf(!haveBloodgulch)(batchTitle, () => {
  let loadedMap: LoadedMap;
  let batchOutDir: string;

  beforeAll(() => {
    const buffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    loadedMap = { filePath: sampleMapPath('bloodgulch.map'), buffer, header: inspected.header, tagIndex: inspected.tagIndex };
    batchOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-batch-test-'));
  });

  afterEach(() => {
    __setCurrentMapForTest(null);
  });

  it('cancels batch extraction and returns cancelled result with partial summary and staging path', () => {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const requestId = randomUUID();
    __cancelForTest(requestId);

    runBatchExtract({
      requestId,
      parentDir: batchOutDir,
      sourceMapName: 'bloodgulch',
      mode: 'replace',
      resourceMapPaths: {},
    });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | {
          type: string;
          payload: { ok: boolean; code?: string; stagingDir?: string; targetDir?: string; partialSummary?: unknown };
        }
      | undefined;

    expect(resultMsg?.payload.ok).toBe(false);
    expect(resultMsg?.payload.code).toBe('CANCELLED');
    expect(resultMsg?.payload.stagingDir).toBeDefined();
    expect(resultMsg?.payload.targetDir).toBe(path.join(batchOutDir, 'bloodgulch'));
  });

  it('extracts a slice of tags in batch mode, generating correct folders, container files, manifest, and report', () => {
    // Create a sub-map with 3 tags: 1 extractable weapon, 1 external bitmap, 1 bsp
    const arIndex = loadedMap.tagIndex.entries.find((e) => e.path === 'weapons\\assault rifle\\assault rifle')!;
    const bspIndex = loadedMap.tagIndex.entries.find((e) => e.primaryClassName === 'scenario_structure_bsp')!;
    const extIndex = loadedMap.tagIndex.entries.find((e) => e.isExternal) ?? loadedMap.tagIndex.entries[0];

    // Keep all slots so tag IDs resolve, but mark all non-test tags as external
    const miniEntries = loadedMap.tagIndex.entries.map((e) => {
      if (e.index === arIndex.index || e.index === bspIndex.index) return e;
      return { ...e, isExternal: true };
    });

    const miniMap: LoadedMap = {
      filePath: path.join(batchOutDir, 'bloodgulch_mini.map'),
      buffer: loadedMap.buffer,
      header: loadedMap.header,
      tagIndex: {
        ...loadedMap.tagIndex,
        entries: miniEntries,
      },
    };

    __setCurrentMapForTest(miniMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const requestId = randomUUID();
    runBatchExtract({
      requestId,
      parentDir: batchOutDir,
      sourceMapName: 'bloodgulch_mini',
      mode: 'replace',
      resourceMapPaths: {},
    });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | {
          type: string;
          payload: { ok: boolean; summary: any };
        }
      | undefined;

    expect(resultMsg?.payload.ok).toBe(true);
    const summary = resultMsg?.payload.summary;
    expect(summary.extractedCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(summary.externalCount).toBe(miniEntries.length - 2);

    const targetFolder = path.join(batchOutDir, 'bloodgulch_mini');
    expect(fs.existsSync(targetFolder)).toBe(true);

    const arPath = path.join(targetFolder, 'weapons', 'assault rifle', 'assault rifle.weapon.ocetags');
    expect(fs.existsSync(arPath)).toBe(true);
    expect(fs.existsSync(path.join(targetFolder, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetFolder, 'batch-extract-report.txt'))).toBe(true);

    // Staging folder should be cleaned up
    const stagingFolders = fs.readdirSync(targetFolder).filter((f) => f.startsWith('.staging'));
    expect(stagingFolders).toEqual([]);

    // Run again in 'skip' mode
    const messages2: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages2.push(msg));
    const requestId2 = randomUUID();
    runBatchExtract({
      requestId: requestId2,
      parentDir: batchOutDir,
      sourceMapName: 'bloodgulch_mini',
      mode: 'skip',
      resourceMapPaths: {},
    });

    const resultMsg2 = messages2.find((m) => m.type === 'result') as
      | {
          type: string;
          payload: { ok: boolean; summary: any };
        }
      | undefined;
    expect(resultMsg2?.payload.ok).toBe(true);
    expect(resultMsg2?.payload.summary.extractedCount).toBe(0);
    expect(resultMsg2?.payload.summary.skippedCount).toBe(1);
  });

  it('runGetTagFields returns decoded fields for weapon in loaded map', () => {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const arIndex = loadedMap.tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    expect(arIndex).toBeGreaterThanOrEqual(0);

    const requestId = randomUUID();
    runGetTagFields({ requestId, tagIndex: arIndex });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | { type: string; payload: { ok: boolean; data: any } }
      | undefined;
    expect(resultMsg?.payload.ok).toBe(true);
    expect(resultMsg?.payload.data.tagPath).toBe('weapons\\assault rifle\\assault rifle');
    expect(resultMsg?.payload.data.fields.length).toBeGreaterThan(20);
  });

  it('runUpdateTagField updates field in-place and marks map modified', () => {
    // Work on a copy of loadedMap buffer so sample map bytes are not changed
    const testMap: LoadedMap = {
      ...loadedMap,
      buffer: Buffer.from(loadedMap.buffer),
    };
    __setCurrentMapForTest(testMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const arIndex = testMap.tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const requestId = randomUUID();

    runUpdateTagField({
      requestId,
      tagIndex: arIndex,
      fieldName: 'autoaim angle',
      newValue: 0.75,
    });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | { type: string; payload: { ok: boolean; fieldName: string; newValue: unknown; map: any } }
      | undefined;
    expect(resultMsg?.payload.ok).toBe(true);
    expect(resultMsg?.payload.fieldName).toBe('autoaim angle');
    expect(resultMsg?.payload.newValue).toBe(0.75);
    expect(resultMsg?.payload.map.modified).toBe(true);
    expect(testMap.modified).toBe(true);
  });

  it('runGetDependencySlots lists all dependency slots including nested reflexives', () => {
    __setCurrentMapForTest(loadedMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const arIndex = loadedMap.tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    expect(arIndex).toBeGreaterThanOrEqual(0);

    const requestId = randomUUID();
    runGetDependencySlots({ requestId, tagIndex: arIndex });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | { type: string; payload: { ok: boolean; slots: any[] } }
      | undefined;
    expect(resultMsg?.payload.ok).toBe(true);
    expect(resultMsg?.payload.slots.length).toBeGreaterThanOrEqual(30);
    expect(resultMsg?.payload.slots.some((s) => s.fieldPath === 'triggers[0].projectile')).toBe(true);
  });

  it('runSetDependencySlot swaps projectile slot to a vehicle tag in-place and marks map modified', () => {
    const testMap: LoadedMap = {
      ...loadedMap,
      buffer: Buffer.from(loadedMap.buffer),
    };
    __setCurrentMapForTest(testMap);
    const messages: { type: string; [key: string]: unknown }[] = [];
    __setSinkForTest((msg) => messages.push(msg));

    const arIndex = testMap.tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle');
    const vehicleEntry = testMap.tagIndex.entries.find((e) => e.primaryClassName === 'vehicle');
    expect(vehicleEntry).toBeDefined();

    const requestId = randomUUID();
    runSetDependencySlot({
      requestId,
      tagIndex: arIndex,
      fieldPath: 'triggers[0].projectile',
      newTagId: vehicleEntry!.tagId,
    });

    const resultMsg = messages.find((m) => m.type === 'result') as
      | { type: string; payload: { ok: boolean; fieldPath: string; newTagId: number; map: any } }
      | undefined;
    expect(resultMsg?.payload.ok).toBe(true);
    expect(resultMsg?.payload.fieldPath).toBe('triggers[0].projectile');
    expect(resultMsg?.payload.newTagId).toBe(vehicleEntry!.tagId);
    expect(resultMsg?.payload.map.modified).toBe(true);
    expect(testMap.modified).toBe(true);
  });
});
