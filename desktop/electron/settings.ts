import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { AppSettings, HaloBitmapVersion, ResourceMapKind, VersionResourceMaps } from './shared-types';

function storePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

const DEFAULT_SETTINGS: AppSettings = {
  lastExtractDir: null,
  resourceMaps: { bitmaps: null, sounds: null, loc: null },
  versionResourceMaps: {},
};

export function getSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(storePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      lastExtractDir: typeof parsed.lastExtractDir === 'string' ? parsed.lastExtractDir : null,
      resourceMaps: {
        bitmaps: typeof parsed.resourceMaps?.bitmaps === 'string' ? parsed.resourceMaps.bitmaps : null,
        sounds: typeof parsed.resourceMaps?.sounds === 'string' ? parsed.resourceMaps.sounds : null,
        loc: typeof parsed.resourceMaps?.loc === 'string' ? parsed.resourceMaps.loc : null,
      },
      versionResourceMaps:
        parsed.versionResourceMaps && typeof parsed.versionResourceMaps === 'object'
          ? parsed.versionResourceMaps
          : {},
    };
  } catch {
    // Missing or corrupt settings.json falls back to defaults - never crashes the app.
    return { ...DEFAULT_SETTINGS, resourceMaps: { ...DEFAULT_SETTINGS.resourceMaps }, versionResourceMaps: {} };
  }
}

function writeSettings(next: AppSettings): void {
  try {
    fs.writeFileSync(storePath(), JSON.stringify(next, null, 2));
  } catch {
    // Non-fatal: the setting just won't persist across launches.
  }
}

export function setLastExtractDir(dir: string): void {
  writeSettings({ ...getSettings(), lastExtractDir: dir });
}

/** Main process is the only thing that ever writes a resource map path - the renderer only ever receives a status, never a path to pass back (see IPC handlers in main.ts). */
export function setResourceMapPath(kind: ResourceMapKind, filePath: string | null): void {
  const current = getSettings();
  writeSettings({ ...current, resourceMaps: { ...current.resourceMaps, [kind]: filePath } });
}

export function setVersionResourceMaps(
  version: HaloBitmapVersion,
  maps: { bitmaps?: string | null; sounds?: string | null },
): void {
  const current = getSettings();
  const existing: VersionResourceMaps = current.versionResourceMaps?.[version] ?? { bitmaps: null, sounds: null };
  const updatedVersion: VersionResourceMaps = {
    bitmaps: maps.bitmaps !== undefined ? maps.bitmaps : existing.bitmaps,
    sounds: maps.sounds !== undefined ? maps.sounds : existing.sounds,
  };
  const updated: AppSettings = {
    ...current,
    versionResourceMaps: {
      ...current.versionResourceMaps,
      [version]: updatedVersion,
    },
  };
  writeSettings(updated);
}
