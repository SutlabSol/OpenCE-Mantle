import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const MAX_RECENT = 10;

function storePath(): string {
  return path.join(app.getPath('userData'), 'recent-maps.json');
}

export function getRecentMaps(): string[] {
  try {
    const raw = fs.readFileSync(storePath(), 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string' && fs.existsSync(p)) : [];
  } catch {
    return [];
  }
}

export function addRecentMap(filePath: string): string[] {
  const current = getRecentMaps().filter((p) => p !== filePath);
  const updated = [filePath, ...current].slice(0, MAX_RECENT);
  try {
    fs.writeFileSync(storePath(), JSON.stringify(updated, null, 2));
  } catch {
    // Non-fatal: recent maps list just won't persist.
  }
  return updated;
}
