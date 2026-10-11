/** Small, dependency-free rules shared by main, the worker and the renderer (no Node or Electron imports). */

/** A map opened from a `.bak` file is a backup: File > Save is disabled for it (Save As only), and no backup prompt is shown. */
export function isBackupFilePath(filePath: string): boolean {
  return /\.bak$/i.test(filePath);
}

/** `C:\maps\bloodgulch.map` -> `C:\maps\bloodgulch.map.bak` (same folder). */
export function backupPathFor(mapPath: string): string {
  return `${mapPath}.bak`;
}

/** Shown when editing, injecting or saving is asked for while a compressed map is open. Nothing of a compressed map is held for editing. */
export const COMPRESSED_MAP_MESSAGE =
  'This map is compressed, so it cannot be edited, injected into or saved. Use Tools > Decompress Map to write a decompressed copy, then open that copy.';

/** File > Save is refused for a map opened from a backup file. */
export const BACKUP_FILE_SAVE_MESSAGE = 'This map was opened from a backup (.bak) file. Use File > Save As to write it under a new name; Save would overwrite the backup.';
