import { describe, expect, it, vi } from 'vitest';
import { registerSaveMapAsIpc, SAVE_MAP_AS_CHANNEL, type SaveMapAsDeps, type IpcMainLike } from '../save-map-as';
import type { SaveMapAsResult, OpenMapSummary } from '../shared-types';

const OPEN_MAP = 'C:\\HaloCE\\maps\\bloodgulch.map';
const OPEN_SUMMARY: OpenMapSummary = {
  status: 'ok',
  filePath: OPEN_MAP,
  modified: false,
  header: { scenarioName: 'bloodgulch_copy', buildString: '01.00.00.0609', mapType: 1, crc32: 0x0badf00d, tagDataOffset: 0, tagDataSize: 0, decompressedFileSize: 0, fileSizeOnDisk: 0, tagCount: 0 },
  tags: [],
};

function makeDeps(chosenPath: string | null, overrides: Partial<SaveMapAsDeps> = {}) {
  const logs: { level: string; message: string }[] = [];
  const deps: SaveMapAsDeps = {
    getOpenMap: () => ({ filePath: OPEN_MAP, compressed: false }),
    showSaveDialog: vi.fn(async () => chosenPath),
    confirmOverwrite: vi.fn(async () => true),
    confirmScenarioName: vi.fn(async () => true),
    showError: vi.fn(async () => {}),
    runWorkerSave: vi.fn(
      async (outputPath: string): Promise<SaveMapAsResult> => ({
        ok: true,
        outputPath,
        scenarioName: 'bloodgulch_copy',
        previousScenarioName: 'bloodgulch',
        crc32: 0x0badf00d,
        warnings: ['Scenario name truncated to 31 characters.'],
        staleChecksumWarning: 'tag-file checksum not recalculated',
        map: { ...OPEN_SUMMARY, filePath: outputPath },
      }),
    ),
    log: (level, message) => logs.push({ level, message }),
    fileExists: () => false,
    ...overrides,
  };
  return { deps, logs };
}

/** Registers the real handler on a fake ipcMain and returns a function that invokes the channel like the renderer would. */
function registerAndGetInvoker(deps: SaveMapAsDeps) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) };
  registerSaveMapAsIpc(ipc, deps);
  const handler = handlers.get(SAVE_MAP_AS_CHANNEL);
  expect(handler, `handler registered on ${SAVE_MAP_AS_CHANNEL}`).toBeDefined();
  return () => handler!({}) as Promise<SaveMapAsResult>;
}

describe('map:saveAs IPC handler', () => {
  it('refuses the open map path (case-insensitive) and never reaches the worker', async () => {
    const { deps } = makeDeps('c:\\haloce\\MAPS\\BloodGulch.map');
    const result = await registerAndGetInvoker(deps)();
    expect(result).toMatchObject({ ok: false, code: 'REFUSED_SOURCE_PATH' });
    expect(deps.runWorkerSave).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalled();
  });

  it('refuses the exact open map path', async () => {
    const { deps } = makeDeps(OPEN_MAP);
    expect(await registerAndGetInvoker(deps)()).toMatchObject({ ok: false, code: 'REFUSED_SOURCE_PATH' });
    expect(deps.runWorkerSave).not.toHaveBeenCalled();
  });

  it('sends a different path to the worker and logs map name, CRC32 and warnings', async () => {
    const { deps, logs } = makeDeps('C:\\HaloCE\\maps\\bloodgulch_copy.map');
    const result = await registerAndGetInvoker(deps)();
    expect(result.ok).toBe(true);
    expect(deps.runWorkerSave).toHaveBeenCalledWith('C:\\HaloCE\\maps\\bloodgulch_copy.map');
    expect(logs).toContainEqual({ level: 'info', message: 'Saved C:\\HaloCE\\maps\\bloodgulch_copy.map - map name "bloodgulch_copy" (changed from "bloodgulch" to match the file name), CRC32 0x0badf00d' });
    expect(logs).toContainEqual({ level: 'warn', message: 'Scenario name truncated to 31 characters.' });
  });

  it('no map: NO_MAP_LOADED; compressed map: refused with a message pointing to Decompress; no dialog either way', async () => {
    const none = makeDeps('C:\\x.map', { getOpenMap: () => null });
    expect(await registerAndGetInvoker(none.deps)()).toMatchObject({ ok: false, code: 'NO_MAP_LOADED' });
    expect(none.deps.showSaveDialog).not.toHaveBeenCalled();
    const compressed = makeDeps('C:\\x.map', { getOpenMap: () => ({ filePath: OPEN_MAP, compressed: true }) });
    expect(await registerAndGetInvoker(compressed.deps)()).toMatchObject({ ok: false, code: 'COMPRESSED', message: expect.stringMatching(/Tools > Decompress Map/) });
    expect(compressed.deps.showSaveDialog).not.toHaveBeenCalled();
    expect(compressed.deps.runWorkerSave).not.toHaveBeenCalled();
  });

  it('cancel in the dialog writes nothing', async () => {
    const { deps } = makeDeps(null);
    expect(await registerAndGetInvoker(deps)()).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(deps.runWorkerSave).not.toHaveBeenCalled();
  });
});
