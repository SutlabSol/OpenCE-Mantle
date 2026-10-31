import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { LogEvent } from './shared-types';
import { isBackupFilePath, backupPathFor } from './map-file-rules';

/**
 * What happened to the backup when a map was opened:
 * - backed-up: a backup exists now (created, replaced, kept, or already byte-identical)
 * - skipped / failed: no backup was made this time; File > Save asks before its first overwrite
 * - not-applicable: the map was opened from a .bak file (no prompt; Save is disabled for it)
 */
export type BackupOutcome = 'created' | 'replaced' | 'kept-existing' | 'up-to-date' | 'skipped' | 'failed' | 'not-applicable';

export function isBackedUp(outcome: BackupOutcome): boolean {
  return outcome === 'created' || outcome === 'replaced' || outcome === 'kept-existing' || outcome === 'up-to-date';
}

/** File operations used here; replaceable in tests. */
export interface BackupFs {
  existsSync(p: string): boolean;
  readFileSync(p: string): Buffer;
  copyFileSync(from: string, to: string): void;
  statSync(p: string): { size: number };
  renameSync(from: string, to: string): void;
  unlinkSync(p: string): void;
}

/** Everything `backupOnOpenFlow` needs from main.ts, injected so it can be tested without Electron. */
export interface BackupDeps {
  /** "Create a backup copy of <name>.map as <name>.map.bak?" Create backup / Skip. */
  askCreateBackup(mapName: string, backupName: string): Promise<'create' | 'skip'>;
  /** The .bak already exists (and differs): Keep existing (default) / Replace / Skip. */
  askExistingBackup(backupName: string): Promise<'keep' | 'replace' | 'skip'>;
  showError(message: string, detail: string): Promise<void>;
  log(level: LogEvent['level'], message: string): void;
  fs?: BackupFs;
}

/** Plain message for a failed backup copy (no stack trace). */
export function describeBackupError(err: unknown, backupName: string): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return `There is not enough free disk space to create ${backupName}.`;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EBUSY')
    return `${backupName} could not be written: the folder is read-only, or the file is in use by another program.`;
  return `${backupName} could not be created: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Asked once per open of a .map file: copy it to `<name>.map.bak` in the same folder (temp file,
 * size check, rename). An existing .bak is never overwritten without a choice; when it is
 * byte-identical to the opened map nothing is asked. Never throws.
 */
export async function backupOnOpenFlow(mapPath: string, deps: BackupDeps): Promise<BackupOutcome> {
  const f = deps.fs ?? fs;
  if (isBackupFilePath(mapPath)) {
    deps.log('info', `Opened a backup file (${path.basename(mapPath)}): no backup prompt, and File > Save is disabled for it - use Save As.`);
    return 'not-applicable';
  }
  const backupPath = backupPathFor(mapPath);
  const mapName = path.basename(mapPath);
  const backupName = path.basename(backupPath);

  try {
    try {
      if (f === fs && fs.existsSync(mapPath)) {
        fs.chmodSync(mapPath, 0o666);
      }
    } catch {
      /* best-effort clear ReadOnly on source map */
    }
    const exists = f.existsSync(backupPath);
    if (exists && f.statSync(backupPath).size === f.statSync(mapPath).size && f.readFileSync(backupPath).equals(f.readFileSync(mapPath))) {
      deps.log('info', `Backup already up to date: ${backupName} is identical to ${mapName}.`);
      return 'up-to-date';
    }
    if ((await deps.askCreateBackup(mapName, backupName)) === 'skip') {
      deps.log('warn', `Backup skipped for ${mapName}. File > Save will ask before overwriting it.`);
      return 'skipped';
    }
    let replacing = false;
    if (exists) {
      const choice = await deps.askExistingBackup(backupName);
      if (choice === 'keep') {
        deps.log('info', `Kept the existing ${backupName} (it differs from ${mapName}; not overwritten).`);
        return 'kept-existing';
      }
      if (choice === 'skip') {
        deps.log('warn', `Backup skipped for ${mapName}; the existing ${backupName} was left unchanged. File > Save will ask before overwriting ${mapName}.`);
        return 'skipped';
      }
      replacing = true;
    }

    const tempPath = `${backupPath}.tmp-${randomUUID()}`;
    try {
      f.copyFileSync(mapPath, tempPath);
      try {
        if (f === fs) {
          if (fs.existsSync(tempPath)) fs.chmodSync(tempPath, 0o666);
          if (fs.existsSync(backupPath)) fs.chmodSync(backupPath, 0o666);
        }
      } catch {
        /* best-effort clear ReadOnly on backup target */
      }
      const expected = f.statSync(mapPath).size;
      const copied = f.statSync(tempPath).size;
      if (copied !== expected) throw new Error(`the copy is ${copied} bytes, the map is ${expected} bytes`);
      f.renameSync(tempPath, backupPath);
    } catch (err) {
      try {
        if (f.existsSync(tempPath)) f.unlinkSync(tempPath);
      } catch {
        /* best-effort cleanup only */
      }
      throw err;
    }
    deps.log('info', `${replacing ? 'Replaced' : 'Created'} backup ${backupPath}.`);
    return replacing ? 'replaced' : 'created';
  } catch (err) {
    const message = describeBackupError(err, backupName);
    deps.log('error', `Backup failed: ${message} ${mapName} is still open; File > Save will ask before overwriting it.`);
    await deps.showError('The backup copy could not be created.', `${message}\n\n${mapName} is still open and unchanged. File > Save will ask before overwriting it.`);
    return 'failed';
  }
}
