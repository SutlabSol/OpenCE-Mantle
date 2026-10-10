import { describe, expect, it, vi } from 'vitest';
import { registerSaveMapAsIpc, SAVE_MAP_AS_CHANNEL, type SaveMapAsDeps, type IpcMainLike } from '../save-map-as';
import type { SaveMapAsResult } from '../shared-types';

const OPEN_MAP = 'C:\\HaloCE\\maps\\bloodgulch.map';

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
        crc32: 0x0badf00d,
        warnings: ['Scenario name truncated to 31 characters.'],
        staleChecksumWarning: 'tag-file checksum not recalculated',
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
    expect(logs).toContainEqual({ level: 'info', message: 'Saved C:\\HaloCE\\maps\\bloodgulch_copy.map - map name "bloodgulch_copy", CRC32 0x0badf00d' });
    expect(logs).toContainEqual({ level: 'warn', message: 'Scenario name truncated to 31 characters.' });
  });

  it('returns NO_MAP_LOADED without opening a dialog when no map (or a compressed map) is open', async () => {
    for (const openMap of [null, { filePath: OPEN_MAP, compressed: true }]) {
      const { deps } = makeDeps('C:\\x.map', { getOpenMap: () => openMap });
      expect(await registerAndGetInvoker(deps)()).toMatchObject({ ok: false, code: 'NO_MAP_LOADED' });
      expect(deps.showSaveDialog).not.toHaveBeenCalled();
    }
  });

  it('cancel in the dialog writes nothing', async () => {
    const { deps } = makeDeps(null);
    expect(await registerAndGetInvoker(deps)()).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(deps.runWorkerSave).not.toHaveBeenCalled();
  });
});
