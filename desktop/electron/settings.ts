import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AppSettings } from './shared-types';

function storePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(storePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { lastExtractDir: typeof parsed.lastExtractDir === 'string' ? parsed.lastExtractDir : null };
  } catch {
    return { lastExtractDir: null };
  }
}

export function setLastExtractDir(dir: string): void {
  const current = getSettings();
  try {
    fs.writeFileSync(storePath(), JSON.stringify({ ...current, lastExtractDir: dir }, null, 2));
  } catch {
    // Non-fatal: the last-used directory just won't persist across launches.
  }
}
