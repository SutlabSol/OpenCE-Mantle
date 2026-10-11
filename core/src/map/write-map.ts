import { randomUUID } from 'crypto';
import { finalizeForSave } from './finalize-map';
import type { FinalizeResult } from './finalize-map';

/**
 * The one way a map is written: `finalizeForSave` (scenario name from the file name, header CRC32
 * recomputed), then a temp file in the same folder + rename, so a failure never leaves a partial
 * file at `outputPath` and never touches an existing one. Core does no file I/O itself: the caller
 * (the map worker, the developer convert script) passes the file operations.
 */
export interface MapWriteOps {
  writeFileSync(path: string, data: Buffer): void;
  renameSync(from: string, to: string): void;
  /** Best-effort removal of the temp file after a failure; must not throw. */
  removeIfExists(path: string): void;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Plain-language reason a map write failed (no stack trace). Nothing at `targetPath` changed:
 * the temp file is removed and the rename is the only step that touches it.
 */
export function describeMapWriteError(err: unknown, targetPath: string, stillOpenNote = 'your changes are still open in the app'): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  const name = baseName(targetPath);
  const unchanged = `${name} on disk was not changed, and ${stillOpenNote}.`;
  if (code === 'ENOSPC') return `There is not enough free disk space to save ${name}. ${unchanged} Free some space, or use File > Save As to save to another drive.`;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EROFS')
    return `${name} could not be written: the file is in use by another program (for example OpenCE or Halo), or the file or its folder is read-only. ${unchanged} Close the other program and try again, or use File > Save As.`;
  if (code === 'ENOENT') return `The folder for ${name} no longer exists. ${unchanged}`;
  return `Could not save ${name}: ${err instanceof Error ? err.message : String(err)}. ${unchanged}`;
}

/** Finalizes and writes `map` atomically. Throws an Error with code `WRITE_FAILED` and a plain message (temp file already removed) when writing fails. */
export function writeFinalizedMap(map: Buffer, outputPath: string, ops: MapWriteOps, stillOpenNote?: string): FinalizeResult {
  const finalized = finalizeForSave(map, { fileName: baseName(outputPath) });
  const tempPath = `${outputPath}.tmp-${randomUUID()}`;
  try {
    ops.writeFileSync(tempPath, finalized.buffer);
    ops.renameSync(tempPath, outputPath);
  } catch (err) {
    ops.removeIfExists(tempPath);
    throw Object.assign(new Error(describeMapWriteError(err, outputPath, stillOpenNote)), { code: 'WRITE_FAILED' });
  }
  return finalized;
}
