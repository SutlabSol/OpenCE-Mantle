// @vitest-environment node
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap, extractTagSet, serializeContainer, finalizeForSave, parseCacheFileHeader, parseTagIndex } from '../../../core/src/index';
import type { TagIndex } from '../../../core/src/index';
import { auditExistingTags, entryAddressIssues, bspReferencePaths, ENGINE_BASE } from '../../../core/tests/helpers/existing-tags-audit';
import {
  __setCurrentMapForTest,
  __getCurrentMapForTest,
  __setSinkForTest,
  __setMapFsForTest,
  runInspect,
  runPlanInject,
  runApplyInject,
  runSaveMap,
  runSaveMapAs,
  runExtractTags,
} from '../map-worker';

/**
 * In-memory Inject + File > Save / Save As, on COPIES of the sample maps in a temp folder (never
 * sample_maps itself). Correctness of the injected map is checked with core's independent audit
 * helpers (fixed engine base, raw output; they share only the schema engine with the injector),
 * on both the in-memory buffer and the saved file.
 */
const SAMPLE_MAPS_DIR = process.env.SAMPLE_MAPS_DIR ? path.resolve(process.env.SAMPLE_MAPS_DIR) : path.resolve(__dirname, '../../../sample_maps');
const needed = ['bloodgulch.map', 'ui.map'];
const missing = needed.filter((n) => !fs.existsSync(path.join(SAMPLE_MAPS_DIR, n)));
const title = (t: string) => (missing.length ? `${t} [missing ${missing.join(', ')} in "${SAMPLE_MAPS_DIR}" - set SAMPLE_MAPS_DIR]` : t);

type Msg = { type: string; requestId?: string; payload?: any; code?: string; message?: string };
let messages: Msg[] = [];

/** Runs one worker request and returns its result payload, or throws with the worker's error code. */
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

const listing = (dir: string) =>
  fs
    .readdirSync(dir)
    .sort()
    .map((f) => {
      const s = fs.statSync(path.join(dir, f));
      return `${f}|${s.size}|${s.mtimeMs}`;
    });

describe.skipIf(missing.length > 0)(title('map-worker: in-memory Inject, then File > Save / Save As'), () => {
  let bgSource: Buffer;
  let bgIndex: TagIndex;
  let containerPath: string;
  let dir: string;
  let mapPath: string;

  beforeAll(() => {
    bgSource = fs.readFileSync(path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map'));
    bgIndex = parseTagIndex(bgSource, parseCacheFileHeader(bgSource));
    const ui = fs.readFileSync(path.join(SAMPLE_MAPS_DIR, 'ui.map'));
    const uiHeader = parseCacheFileHeader(ui);
    const uiIndex = parseTagIndex(ui, uiHeader);
    const root = uiIndex.entries.findIndex((e) => e.primaryClassName === 'ui_widget_definition' && e.path === 'ui\\shell\\main_menu\\halo_logo');
    const containerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-inject-container-'));
    containerPath = path.join(containerDir, 'halo_logo.ocetags');
    fs.writeFileSync(containerPath, serializeContainer(extractTagSet(ui, uiHeader, uiIndex, [root]), 'ui'));
  });

  beforeEach(async () => {
    __setSinkForTest((m) => messages.push(m as Msg));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-inject-save-'));
    mapPath = path.join(dir, 'bloodgulch.map');
    fs.copyFileSync(path.join(SAMPLE_MAPS_DIR, 'bloodgulch.map'), mapPath);
    await call(runInspect, { filePath: mapPath });
  });

  afterEach(() => {
    __setMapFsForTest(null);
    __setCurrentMapForTest(null);
    try {
      for (const f of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, f), 0o666);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp cleanup only */
    }
  });

  async function inject(mode: 'add' | 'swap' = 'add') {
    const plan = await call(runPlanInject, { containerPath, mode, resourceMapPaths: {} });
    const applied = await call(runApplyInject);
    return { plan: plan.plan, applied };
  }

  /** The independent checks (fixed base, raw): entry addresses incl. external sounds, no entry into another tag, existing tags and path strings, new entries' path strings, BSP reference paths. */
  function expectCorrectAdd(out: Buffer, addedPaths: string[]) {
    expect(out.readUInt32LE(out.readUInt32LE(0x10))).toBe(ENGINE_BASE + 0x28);
    const r = entryAddressIssues(bgSource, bgIndex, out);
    expect(r.issues).toEqual([]);
    expect(r.ownershipIssues).toEqual([]);
    expect(r.checkedExternal).toBe(333);
    expect(auditExistingTags(bgSource, bgIndex, out).problems).toEqual([]);
    const tagData = out.readUInt32LE(0x10);
    const array = tagData + (out.readUInt32LE(tagData) - ENGINE_BASE);
    const count = out.readUInt32LE(tagData + 0x0c);
    expect(count).toBe(bgIndex.tagCount + addedPaths.length);
    const str = (ptr: number) => {
      const at = tagData + (ptr - ENGINE_BASE);
      return out.toString('latin1', at, out.indexOf(0, at));
    };
    const newPaths = [];
    for (let i = bgIndex.tagCount; i < count; i++) newPaths.push(str(out.readUInt32LE(array + i * 32 + 0x10)));
    expect(newPaths.sort()).toEqual([...addedPaths].sort());
    const before = bspReferencePaths(bgSource, bgIndex).map((x) => {
      const at = bgSource.readUInt32LE(0x10) + (x.value - ENGINE_BASE);
      return bgSource.toString('latin1', at, bgSource.indexOf(0, at));
    });
    const after = bspReferencePaths(out, parseTagIndex(out, parseCacheFileHeader(out))).map((x) => str(x.value));
    expect(after).toEqual(before);
  }

  it('Inject (apply) writes nothing to disk: folder listing, sizes, times and bytes unchanged; the held map is modified', async () => {
    const before = listing(dir);
    const { plan, applied } = await inject();
    expect(plan.counts.added).toBe(2);
    expect(applied.ok).toBe(true);
    expect(applied.map.modified).toBe(true);
    expect(applied.map.header.tagCount).toBe(bgIndex.tagCount + 2);
    expect(listing(dir)).toEqual(before);
    expect(fs.readFileSync(mapPath).equals(bgSource)).toBe(true);
    expect(__getCurrentMapForTest()!.modified).toBe(true);
  }, 120_000);

  it('two injections stack: the second plan runs against the in-memory map and reuses the first one\'s tags', async () => {
    const first = await inject();
    expect(first.plan.counts.added).toBe(2);
    const second = await inject();
    expect(second.plan.counts.added).toBe(0);
    expect(second.plan.reused.map((t: { path: string }) => t.path).sort()).toEqual(first.plan.toAdd.map((t: { path: string }) => t.path).sort());
    expect(second.applied.map.header.tagCount).toBe(bgIndex.tagCount + 2);
    // Extraction reads the in-memory map too: an injected tag can be extracted before saving.
    const idx = __getCurrentMapForTest()!.tagIndex.entries.find((e) => e.path === 'ui\\shell\\main_menu\\halo_logo')!.index;
    const extracted = await call(runExtractTags, { originalIndices: [idx], outputPath: path.join(dir, 'x.ocetags'), sourceMapName: 'bg' });
    expect(extracted.ok).toBe(true);
  }, 120_000);

  it('the injected map is correct in memory AND as saved (independent checks on both); Save = finalizeForSave of the in-memory buffer', async () => {
    const { plan } = await inject();
    const added = plan.toAdd.map((t: { path: string }) => t.path);
    const inMemory = __getCurrentMapForTest()!.buffer;
    expectCorrectAdd(inMemory, added);

    const saved = await call(runSaveMap);
    expect(saved.ok).toBe(true);
    expect(saved.map.modified).toBe(false);
    const onDisk = fs.readFileSync(mapPath);
    expect(onDisk.equals(finalizeForSave(inMemory, { fileName: 'bloodgulch.map' }).buffer)).toBe(true);
    expect(onDisk.length).toBe(bgSource.length + 1346);
    expectCorrectAdd(onDisk, added);
    expect(inspectCustomEditionMap(onDisk).status).toBe('ok');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
    expect(__getCurrentMapForTest()!.buffer.equals(onDisk)).toBe(true); // held map = what is on disk now
  }, 120_000);

  it('Save leaves the .bak untouched and gives the same bytes as Save As of the same buffer (same file name, other folder)', async () => {
    const bakPath = `${mapPath}.bak`;
    fs.copyFileSync(mapPath, bakPath);
    const bakStat = fs.statSync(bakPath);
    await inject();
    const snapshot = { ...__getCurrentMapForTest()! };

    await call(runSaveMap);
    const saved = fs.readFileSync(mapPath);
    expect(fs.readFileSync(bakPath).equals(bgSource)).toBe(true);
    expect(fs.statSync(bakPath).mtimeMs).toBe(bakStat.mtimeMs);

    __setCurrentMapForTest(snapshot);
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opence-saveas-same-name-'));
    const asResult = await call(runSaveMapAs, { outputPath: path.join(otherDir, 'bloodgulch.map') });
    expect(asResult.ok).toBe(true);
    expect(fs.readFileSync(path.join(otherDir, 'bloodgulch.map')).equals(saved)).toBe(true);
    fs.rmSync(otherDir, { recursive: true, force: true });
  }, 120_000);

  it('Save of a renamed file sets the header scenario name from the file name and reports the old one', async () => {
    const renamed = path.join(dir, 'my_gulch.map');
    fs.renameSync(mapPath, renamed);
    await call(runInspect, { filePath: renamed });
    await inject();
    const saved = await call(runSaveMap);
    expect(saved.previousScenarioName).toBe('bloodgulch');
    expect(saved.scenarioName).toBe('my_gulch');
    expect(fs.readFileSync(renamed).toString('ascii', 0x20, 0x28)).toBe('my_gulch');
  }, 120_000);

  it('Save refuses when the file changed on disk since it was opened (modified time or size), and writes nothing', async () => {
    await inject();
    const t = new Date(Date.now() + 60_000);
    fs.utimesSync(mapPath, t, t);
    const err = await callError(runSaveMap);
    expect(err.code).toBe('CHANGED_ON_DISK');
    expect(err.message).toMatch(/changed on disk.*Save As/);
    expect(fs.readFileSync(mapPath).equals(bgSource)).toBe(true);
    expect(__getCurrentMapForTest()!.modified).toBe(true);

    fs.appendFileSync(mapPath, Buffer.alloc(1)); // size change too
    expect((await callError(runSaveMap)).code).toBe('CHANGED_ON_DISK');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  }, 120_000);

  it('Save is refused when nothing changed, and for a map opened from a .bak file', async () => {
    expect((await callError(runSaveMap)).code).toBe('NOT_MODIFIED');
    const bakPath = `${mapPath}.bak`;
    fs.copyFileSync(mapPath, bakPath);
    await call(runInspect, { filePath: bakPath });
    await inject();
    const err = await callError(runSaveMap);
    expect(err.code).toBe('REFUSED_BACKUP_FILE');
    expect(err.message).toMatch(/Save As/);
    expect(fs.readFileSync(bakPath).equals(bgSource)).toBe(true);
  }, 120_000);

  for (const [what, ops, pattern] of [
    ['a locked file (rename fails with EBUSY)', { renameSync: () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } }, /in use by another program/],
    ['a full disk (write fails with ENOSPC)', { writeFileSync: (p: fs.PathOrFileDescriptor) => { fs.writeFileSync(p, Buffer.alloc(10)); throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); } }, /not enough free disk space/],
  ] as const) {
    it(`a failed Save on ${what}: temp file removed, original intact, plain message, changes still in memory`, async () => {
      await inject();
      __setMapFsForTest(ops as never);
      const err = await callError(runSaveMap);
      expect(err.code).toBe('WRITE_FAILED');
      expect(err.message).toMatch(pattern);
      expect(err.message).toMatch(/was not changed/);
      expect(err.message).not.toMatch(/\n\s+at /); // no stack trace
      expect(fs.readFileSync(mapPath).equals(bgSource)).toBe(true);
      expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
      expect(__getCurrentMapForTest()!.modified).toBe(true);
    }, 120_000);
  }

  it.skipIf(process.platform !== 'win32')('a failed Save on a real read-only map file (Windows): rename refused, temp file removed, original intact', async () => {
    await inject();
    fs.chmodSync(mapPath, 0o444);
    const err = await callError(runSaveMap);
    expect(err.code).toBe('WRITE_FAILED');
    expect(err.message).toMatch(/read-only/);
    expect(fs.readFileSync(mapPath).equals(bgSource)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  }, 120_000);

  it('Save As refuses the open map path (also when modified) and writes nothing; afterwards the new file is the open, unmodified map', async () => {
    const { plan } = await inject();
    const err = await callError(runSaveMapAs, { outputPath: mapPath.toUpperCase() });
    expect(err.code).toBe('REFUSED_SOURCE_PATH');
    expect(fs.readFileSync(mapPath).equals(bgSource)).toBe(true);

    const copy = path.join(dir, 'bg_add.map');
    const res = await call(runSaveMapAs, { outputPath: copy });
    expect(res.map.filePath).toBe(copy);
    expect(res.map.modified).toBe(false);
    expect(__getCurrentMapForTest()!.filePath).toBe(copy);
    expect(fs.readFileSync(mapPath).equals(bgSource)).toBe(true); // original untouched
    expectCorrectAdd(fs.readFileSync(copy), plan.toAdd.map((t: { path: string }) => t.path));
  }, 120_000);
});
