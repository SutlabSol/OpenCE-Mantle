import * as path from 'path';
import * as fs from 'fs';
import type { LogEvent, SaveMapAsResult } from './shared-types';
import { COMPRESSED_MAP_MESSAGE } from './map-file-rules';
import { logSaved } from './save-map';

/** IPC channel for File > Save As (renderer menu -> main). The path always comes from the native dialog, never the renderer. */
export const SAVE_MAP_AS_CHANNEL = 'map:saveAs';

/** Everything `saveMapAsFlow` needs from main.ts, injected so the flow can be tested without Electron. */
export interface SaveMapAsDeps {
  /** The open map, or null. `compressed` maps cannot be saved (the worker holds nothing for them). */
  getOpenMap(): { filePath: string; compressed: boolean } | null;
  /** Native save dialog. Returns the chosen path, or null when cancelled. */
  showSaveDialog(defaultPath: string): Promise<string | null>;
  /** Overwrite confirmation for an existing file. Returns true to overwrite. */
  confirmOverwrite(filePath: string): Promise<boolean>;
  /** Warns when the file name can't become the scenario name exactly. Returns true to continue. */
  confirmScenarioName(filePath: string): Promise<boolean>;
  showError(message: string, detail: string): Promise<void>;
  /** Sends `{ type: 'saveMapAs', outputPath }` to the map worker and resolves with its result. */
  runWorkerSave(outputPath: string): Promise<SaveMapAsResult>;
  log(level: LogEvent['level'], message: string): void;
  fileExists?(filePath: string): boolean;
}

/** Windows paths are case-insensitive, so `C:\maps\A.map` and `c:\Maps\a.map` are the same file. */
export function isSamePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

/**
 * File > Save As: writes the open map (with any in-memory changes) with its scenario name set from
 * the chosen file name and the header CRC32 recomputed. Never overwrites the open map (refused here
 * and again in the worker - that's File > Save); the worker writes a temp file then renames it, and
 * the new file becomes the open map.
 */
export async function saveMapAsFlow(deps: SaveMapAsDeps): Promise<SaveMapAsResult> {
  const openMap = deps.getOpenMap();
  if (!openMap) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (openMap.compressed) {
    deps.log('warn', COMPRESSED_MAP_MESSAGE);
    await deps.showError('This map cannot be saved.', COMPRESSED_MAP_MESSAGE);
    return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };
  }
  const filePath = await deps.showSaveDialog(openMap.filePath.replace(/(\.map)?$/i, '_copy.map'));
  if (!filePath) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };

  const resolvedTarget = path.resolve(filePath);
  if (isSamePath(resolvedTarget, openMap.filePath)) {
    const message = 'Save As cannot overwrite the open map. Use File > Save, or choose a different file name.';
    deps.log('error', `Save As refused: ${resolvedTarget} is the open map.`);
    await deps.showError('Save As cannot overwrite the open map.', 'Use File > Save to overwrite it, or choose a different file name.');
    return { ok: false, code: 'REFUSED_SOURCE_PATH', message };
  }
  const exists = deps.fileExists ?? fs.existsSync;
  if (exists(resolvedTarget) && !(await deps.confirmOverwrite(resolvedTarget))) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };
  if (!(await deps.confirmScenarioName(resolvedTarget))) return { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };

  deps.log('info', `Saving map as ${resolvedTarget}`);
  try {
    const result = await deps.runWorkerSave(resolvedTarget);
    if (result.ok) logSaved(deps.log, result);
    else deps.log('error', `Save As failed: ${result.message}`);
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    deps.log('error', `Save As failed: ${e.message}`);
    await deps.showError('The map was not saved.', e.message);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Minimal slice of Electron's `ipcMain` used here (keeps this module free of Electron imports for tests). */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Registers the renderer-facing Save As channel. Takes no arguments from the renderer. */
export function registerSaveMapAsIpc(ipc: IpcMainLike, deps: SaveMapAsDeps, onResult: (result: SaveMapAsResult) => void = () => {}): void {
  ipc.handle(SAVE_MAP_AS_CHANNEL, async () => {
    const result = await saveMapAsFlow(deps);
    onResult(result);
    return result;
  });
}
