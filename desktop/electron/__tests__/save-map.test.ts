import { describe, expect, it, vi } from 'vitest';
import { saveMapFlow, confirmUnsavedChanges, type SaveMapDeps, type OpenMapState, type UnsavedChangesDeps } from '../save-map';
import type { SaveMapResult, OpenMapSummary } from '../shared-types';

const OPEN = 'C:\\HaloCE\\maps\\my_gulch.map';
const SUMMARY: OpenMapSummary = {
  status: 'ok',
  filePath: OPEN,
  modified: false,
  header: { scenarioName: 'my_gulch', buildString: '01.00.00.0609', mapType: 1, crc32: 0x0badf00d, tagDataOffset: 0, tagDataSize: 0, decompressedFileSize: 0, fileSizeOnDisk: 0, tagCount: 0 },
  tags: [],
};
const OK: SaveMapResult = { ok: true, outputPath: OPEN, scenarioName: 'my_gulch', previousScenarioName: 'bloodgulch', crc32: 0x0badf00d, warnings: ['name note'], staleChecksumWarning: 'stale', map: SUMMARY };

function makeDeps(state: Partial<OpenMapState> | null, overrides: Partial<SaveMapDeps> = {}) {
  const logs: { level: string; message: string }[] = [];
  let open: OpenMapState | null = state ? { filePath: OPEN, compressed: false, modified: true, backedUp: true, overwriteConfirmed: false, ...state } : null;
  const d: SaveMapDeps = {
    getOpenMap: () => open,
    confirmOverwriteWithoutBackup: vi.fn(async () => true),
    markOverwriteConfirmed: vi.fn(() => {
      if (open) open = { ...open, overwriteConfirmed: true };
    }),
    confirmScenarioName: vi.fn(async () => true),
    showError: vi.fn(async () => {}),
    runWorkerSave: vi.fn(async () => OK),
    log: (level, message) => logs.push({ level, message }),
    ...overrides,
  };
  return { d, logs };
}

describe('File > Save flow', () => {
  it('writes via the worker and logs the file, the map name change, the CRC32 and warnings', async () => {
    const { d, logs } = makeDeps({});
    expect(await saveMapFlow(d)).toEqual(OK);
    expect(d.runWorkerSave).toHaveBeenCalledWith();
    expect(logs).toContainEqual({ level: 'info', message: `Saved ${OPEN} - map name "my_gulch" (changed from "bloodgulch" to match the file name), CRC32 0x0badf00d` });
    expect(logs).toContainEqual({ level: 'warn', message: 'name note' });
  });

  it('unchanged name: no "changed from" in the log', async () => {
    const { d, logs } = makeDeps({}, { runWorkerSave: vi.fn(async () => ({ ...OK, previousScenarioName: 'my_gulch' })) });
    await saveMapFlow(d);
    expect(logs).toContainEqual({ level: 'info', message: `Saved ${OPEN} - map name "my_gulch", CRC32 0x0badf00d` });
  });

  it('refused without reaching the worker: not modified, opened from a .bak, compressed (message points to Decompress), no map', async () => {
    const cases: [Partial<OpenMapState> | null, string, RegExp?][] = [
      [{ modified: false }, 'NOT_MODIFIED'],
      [{ filePath: `${OPEN}.bak` }, 'REFUSED_BACKUP_FILE', /Save As/],
      [{ compressed: true }, 'COMPRESSED', /Tools > Decompress Map/],
      [null, 'NO_MAP_LOADED'],
    ];
    for (const [state, code, message] of cases) {
      const { d } = makeDeps(state);
      const r = await saveMapFlow(d);
      expect(r).toMatchObject({ ok: false, code });
      if (message && !r.ok) expect(r.message).toMatch(message);
      expect(d.runWorkerSave).not.toHaveBeenCalled();
    }
  });

  it('backup skipped: asks before the first overwrite only; Cancel writes nothing', async () => {
    const cancel = makeDeps({ backedUp: false }, { confirmOverwriteWithoutBackup: vi.fn(async () => false) });
    expect(await saveMapFlow(cancel.d)).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(cancel.d.runWorkerSave).not.toHaveBeenCalled();

    const { d } = makeDeps({ backedUp: false });
    await saveMapFlow(d);
    await saveMapFlow(d);
    expect(d.confirmOverwriteWithoutBackup).toHaveBeenCalledTimes(1);
    expect(d.runWorkerSave).toHaveBeenCalledTimes(2);
  });

  it('backed up: no overwrite question', async () => {
    const { d } = makeDeps({ backedUp: true });
    await saveMapFlow(d);
    expect(d.confirmOverwriteWithoutBackup).not.toHaveBeenCalled();
  });

  it('a worker failure (e.g. locked file) shows the plain message and returns it', async () => {
    const msg = 'my_gulch.map could not be written: the file is in use by another program (for example OpenCE or Halo)...';
    const { d } = makeDeps({}, { runWorkerSave: vi.fn(async () => Promise.reject(Object.assign(new Error(msg), { code: 'WRITE_FAILED' }))) });
    expect(await saveMapFlow(d)).toEqual({ ok: false, code: 'WRITE_FAILED', message: msg });
    expect(d.showError).toHaveBeenCalledWith('The map was not saved.', msg);
  });
});

describe('unsaved-changes prompt (before closing or opening another map)', () => {
  function guard(modified: boolean, choice: 'save' | 'dont-save' | 'cancel', saveResult: SaveMapResult = OK) {
    const d: UnsavedChangesDeps = {
      isModified: () => modified,
      fileName: () => 'my_gulch.map',
      ask: vi.fn(async () => choice),
      save: vi.fn(async () => saveResult),
      log: vi.fn(),
    };
    return d;
  }

  it('not modified: no prompt, continue', async () => {
    const d = guard(false, 'cancel');
    expect(await confirmUnsavedChanges(d)).toBe(true);
    expect(d.ask).not.toHaveBeenCalled();
  });

  it('modified: the prompt appears; Cancel stops, Don\'t save continues without saving', async () => {
    const cancel = guard(true, 'cancel');
    expect(await confirmUnsavedChanges(cancel)).toBe(false);
    expect(cancel.ask).toHaveBeenCalledWith('my_gulch.map');
    const dontSave = guard(true, 'dont-save');
    expect(await confirmUnsavedChanges(dontSave)).toBe(true);
    expect(dontSave.save).not.toHaveBeenCalled();
  });

  it('Save runs the normal Save; continues only if it succeeded', async () => {
    const ok = guard(true, 'save');
    expect(await confirmUnsavedChanges(ok)).toBe(true);
    expect(ok.save).toHaveBeenCalledTimes(1);
    const failed = guard(true, 'save', { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' });
    expect(await confirmUnsavedChanges(failed)).toBe(false);
  });
});
