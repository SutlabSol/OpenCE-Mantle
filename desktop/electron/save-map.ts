import * as path from 'path';
import type { LogEvent, SaveMapResult } from './shared-types';
import { isBackupFilePath, COMPRESSED_MAP_MESSAGE, BACKUP_FILE_SAVE_MESSAGE } from './map-file-rules';

/** IPC channel for File > Save (renderer menu -> main). Takes no arguments: it always saves the open map to its own file. */
export const SAVE_MAP_CHANNEL = 'map:save';

const hex = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

/** Log lines after a successful Save / Save As: file, map name (and whether it changed to match the file name), CRC32, warnings. */
export function logSaved(log: (level: LogEvent['level'], message: string) => void, result: Extract<SaveMapResult, { ok: true }>): void {
  const renamed = result.previousScenarioName !== result.scenarioName ? ` (changed from "${result.previousScenarioName}" to match the file name)` : '';
  log('info', `Saved ${result.outputPath} - map name "${result.scenarioName}"${renamed}, CRC32 ${hex(result.crc32)}`);
  for (const w of result.warnings) log('warn', w);
  log('info', result.staleChecksumWarning);
}

export interface OpenMapState {
  filePath: string;
  compressed: boolean;
  modified: boolean;
  /** False when the backup prompt was skipped or failed for this open. */
  backedUp: boolean;
  /** The user already confirmed overwriting without a backup during this open. */
  overwriteConfirmed: boolean;
}

/** Everything `saveMapFlow` needs from main.ts, injected so the flow can be tested without Electron. */
export interface SaveMapDeps {
  getOpenMap(): OpenMapState | null;
  /** Asked before the first overwrite when no backup was made. Returns true to overwrite. */
  confirmOverwriteWithoutBackup(filePath: string): Promise<boolean>;
  markOverwriteConfirmed(): void;
  /** Warns when the file name can't become the scenario name exactly. Returns true to continue. */
  confirmScenarioName(filePath: string): Promise<boolean>;
  showError(message: string, detail: string): Promise<void>;
  /** Sends `{ type: 'saveMap' }` to the map worker and resolves with its result. */
  runWorkerSave(): Promise<SaveMapResult>;
  log(level: LogEvent['level'], message: string): void;
}

const cancelled: SaveMapResult = { ok: false, code: 'CANCELLED', message: 'Save was cancelled.' };

/**
 * File > Save: overwrites the open map file (the one permitted overwrite of a source map). Only
 * while modified; never for a map opened from a .bak or a compressed map. The worker refuses when
 * the file changed on disk and writes temp file + rename. Never touches the .bak.
 */
export async function saveMapFlow(deps: SaveMapDeps): Promise<SaveMapResult> {
  const open = deps.getOpenMap();
  if (!open) return { ok: false, code: 'NO_MAP_LOADED', message: 'No map is open.' };
  if (open.compressed) {
    deps.log('warn', COMPRESSED_MAP_MESSAGE);
    await deps.showError('This map cannot be saved.', COMPRESSED_MAP_MESSAGE);
    return { ok: false, code: 'COMPRESSED', message: COMPRESSED_MAP_MESSAGE };
  }
  if (isBackupFilePath(open.filePath)) {
    deps.log('warn', BACKUP_FILE_SAVE_MESSAGE);
    await deps.showError('Save is not available for a backup file.', BACKUP_FILE_SAVE_MESSAGE);
    return { ok: false, code: 'REFUSED_BACKUP_FILE', message: BACKUP_FILE_SAVE_MESSAGE };
  }
  if (!open.modified) return { ok: false, code: 'NOT_MODIFIED', message: 'There are no unsaved changes.' };

  if (!open.backedUp && !open.overwriteConfirmed) {
    if (!(await deps.confirmOverwriteWithoutBackup(open.filePath))) return cancelled;
    deps.markOverwriteConfirmed();
    deps.log('warn', `Overwriting ${path.basename(open.filePath)} without a backup (confirmed).`);
  }
  if (!(await deps.confirmScenarioName(open.filePath))) return cancelled;

  deps.log('info', `Saving ${open.filePath}`);
  try {
    const result = await deps.runWorkerSave();
    if (result.ok) logSaved(deps.log, result);
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    deps.log('error', `Save failed: ${e.message}`);
    await deps.showError('The map was not saved.', e.message);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}

/** Everything `confirmUnsavedChanges` needs from main.ts. */
export interface UnsavedChangesDeps {
  isModified(): boolean;
  fileName(): string;
  /** Save / Don't save / Cancel. */
  ask(fileName: string): Promise<'save' | 'dont-save' | 'cancel'>;
  /** The normal File > Save (including its no-backup confirmation). */
  save(): Promise<SaveMapResult>;
  log(level: LogEvent['level'], message: string): void;
}

/**
 * Before closing the window or opening another map: if the open map has unsaved changes, ask
 * Save / Don't save / Cancel. Returns true when it's fine to continue.
 */
export async function confirmUnsavedChanges(deps: UnsavedChangesDeps): Promise<boolean> {
  if (!deps.isModified()) return true;
  const choice = await deps.ask(deps.fileName());
  if (choice === 'cancel') return false;
  if (choice === 'dont-save') {
    deps.log('warn', `Unsaved changes to ${deps.fileName()} were discarded.`);
    return true;
  }
  const result = await deps.save();
  return result.ok;
}
