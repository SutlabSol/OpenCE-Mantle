import * as path from 'path';
import * as fs from 'fs';
import type { ConvertMapResult, ConvertRepairChoice, LogEvent, TagDataRepairId } from './shared-types';
import { isSamePath } from './save-map-as';
import { isBackupFilePath } from './map-file-rules';
import { TAG_DATA_REPAIR_IDS } from '../../core/src/map/convert/tag-data-repairs';

/**
 * Main-process side of Convert to Custom Edition (converter Phase 1), with its dependencies
 * injected so it can be tested without Electron. The source map is never written: the output is
 * always a new file chosen in the native Save dialog, written by the worker through the same
 * temp-file + rename path as Save As, and then opened as the current map. The backup-on-open
 * flow is not involved (nothing the user opened is overwritten).
 */
export interface ConvertMapDeps {
  /** The map the last pre-flight checked, or null. */
  getSourcePath(): string | null;
  /** The open (Custom Edition) map, if any; the output may not overwrite it. */
  getOpenMapPath(): string | null;
  /** Unsaved-changes prompt for the open map (the converted map replaces it). Returns false when cancelled. */
  confirmUnsavedChanges(): Promise<boolean>;
  showSaveDialog(defaultPath: string): Promise<string | null>;
  confirmOverwrite(filePath: string): Promise<boolean>;
  /** Warns when the file name can't become the scenario name exactly (truncated / replaced characters). */
  confirmScenarioName(filePath: string): Promise<boolean>;
  showError(message: string, detail: string): Promise<void>;
  runWorkerConvert(sourcePath: string, outputPath: string, acknowledgeScripts: boolean, repairs: ConvertRepairChoice): Promise<ConvertMapResult>;
  log(level: LogEvent['level'], message: string): void;
  fileExists?(filePath: string): boolean;
}

/** `C:\maps\heh_2.map` -> `C:\maps\heh_2_ce.map`: next to the source, never the source itself. Rename it in the dialog as you like. */
export function defaultConvertOutputPath(sourcePath: string): string {
  const dir = path.dirname(sourcePath);
  const stem = path.basename(sourcePath).replace(/\.map$/i, '');
  return path.join(dir, `${stem}_ce.map`);
}

/** Every repair id core knows (one list, so a new repair can't be dropped here). */
const REPAIR_IDS: readonly TagDataRepairId[] = TAG_DATA_REPAIR_IDS;

/** The repair ticks from the renderer, kept only when they are known ids set to exactly true. */
export function sanitizeRepairChoice(value: unknown): ConvertRepairChoice {
  const out: ConvertRepairChoice = {};
  if (!value || typeof value !== 'object') return out;
  for (const id of REPAIR_IDS) if ((value as Record<string, unknown>)[id] === true) out[id] = true;
  return out;
}

const cancelled = (): ConvertMapResult => ({ ok: false, code: 'CANCELLED', message: 'Convert was cancelled.' });

export async function convertMapFlow(deps: ConvertMapDeps, acknowledgeScripts: boolean, repairs: ConvertRepairChoice = {}): Promise<ConvertMapResult> {
  const sourcePath = deps.getSourcePath();
  if (!sourcePath) return { ok: false, code: 'NO_SOURCE', message: 'Choose a map to convert first.' };
  if (!(await deps.confirmUnsavedChanges())) return cancelled();

  const filePath = await deps.showSaveDialog(defaultConvertOutputPath(sourcePath));
  if (!filePath) return cancelled();
  const target = path.resolve(filePath);

  const refuse = async (code: string, message: string): Promise<ConvertMapResult> => {
    deps.log('error', `Convert refused: ${message}`);
    await deps.showError('The map was not converted.', message);
    return { ok: false, code, message };
  };
  if (isSamePath(target, sourcePath)) return refuse('REFUSED_SOURCE_PATH', 'The converted map cannot overwrite the map it is converted from. Choose a different file name or folder.');
  const openMap = deps.getOpenMapPath();
  if (openMap && isSamePath(target, openMap)) return refuse('REFUSED_OPEN_MAP', 'The converted map cannot overwrite the map that is open in the app. Choose a different file name.');
  if (isBackupFilePath(target)) return refuse('REFUSED_BACKUP_FILE', 'The converted map cannot be written as a .bak file. Choose a .map file name.');

  const exists = deps.fileExists ?? fs.existsSync;
  if (exists(target) && !(await deps.confirmOverwrite(target))) return cancelled();
  if (!(await deps.confirmScenarioName(target))) return cancelled();

  deps.log('info', `Converting ${sourcePath} to a Custom Edition map: ${target}`);
  try {
    const result = await deps.runWorkerConvert(sourcePath, target, acknowledgeScripts, repairs);
    if (result.ok) {
      const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
      deps.log('info', `Converted to ${result.outputPath} - map name "${result.scenarioName}", CRC32 ${hex(result.previousCrc32)} -> ${hex(result.crc32)}. ${path.basename(sourcePath)} was not changed.`);
      for (const w of result.warnings) deps.log('warn', w);
      deps.log('info', result.staleChecksumWarning);
    } else {
      deps.log('error', `Convert failed: ${result.message}`);
    }
    return result;
  } catch (err) {
    const e = err as Error & { code?: string };
    deps.log('error', `Convert failed: ${e.message}`);
    await deps.showError('The map was not converted.', e.message);
    return { ok: false, code: e.code ?? 'UNEXPECTED_ERROR', message: e.message };
  }
}
