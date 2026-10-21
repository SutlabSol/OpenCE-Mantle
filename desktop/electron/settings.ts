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
  openCeDirectory: null,
  openCeExecutablePath: null,
};

function migratePath(p: unknown): string | null {
  if (typeof p !== "string" || !p) return null;
  if (!fs.existsSync(p) && p.includes("OpenCE-Modding-Tool")) {
    const candidate = p.replace(/OpenCE-Modding-Tool/g, "OpenCE-Mantle");
    if (fs.existsSync(candidate)) return candidate;
  }
  return p;
}

export function getSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(storePath(), "utf-8");
    const parsed = JSON.parse(raw);
    let changed = false;

    const resourceMaps = {
      bitmaps: typeof parsed.resourceMaps?.bitmaps === "string" ? parsed.resourceMaps.bitmaps : null,
      sounds: typeof parsed.resourceMaps?.sounds === "string" ? parsed.resourceMaps.sounds : null,
      loc: typeof parsed.resourceMaps?.loc === "string" ? parsed.resourceMaps.loc : null,
    };

    const migratedBitmaps = migratePath(resourceMaps.bitmaps);
    if (migratedBitmaps !== resourceMaps.bitmaps) { resourceMaps.bitmaps = migratedBitmaps; changed = true; }
    const migratedSounds = migratePath(resourceMaps.sounds);
    if (migratedSounds !== resourceMaps.sounds) { resourceMaps.sounds = migratedSounds; changed = true; }
    const migratedLoc = migratePath(resourceMaps.loc);
    if (migratedLoc !== resourceMaps.loc) { resourceMaps.loc = migratedLoc; changed = true; }

    const versionResourceMaps: Partial<Record<HaloBitmapVersion, VersionResourceMaps>> =
      parsed.versionResourceMaps && typeof parsed.versionResourceMaps === "object"
        ? parsed.versionResourceMaps
        : {};

    for (const v of Object.keys(versionResourceMaps) as HaloBitmapVersion[]) {
      const entry = versionResourceMaps[v];
      if (entry) {
        const nb = migratePath(entry.bitmaps);
        if (nb !== entry.bitmaps) { entry.bitmaps = nb; changed = true; }
        const ns = migratePath(entry.sounds);
        if (ns !== entry.sounds) { entry.sounds = ns; changed = true; }
        const nl = migratePath(entry.loc);
        if (nl !== entry.loc) { entry.loc = nl; changed = true; }
      }
    }

    const settings: AppSettings = {
      lastExtractDir: typeof parsed.lastExtractDir === "string" ? parsed.lastExtractDir : null,
      resourceMaps,
      versionResourceMaps,
      openCeDirectory: typeof parsed.openCeDirectory === "string" ? parsed.openCeDirectory : detectOpenCeDirectory(),
      openCeExecutablePath: typeof parsed.openCeExecutablePath === "string" ? parsed.openCeExecutablePath : null,
    };

    if (changed) {
      writeSettings(settings);
    }

    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS, resourceMaps: { ...DEFAULT_SETTINGS.resourceMaps }, versionResourceMaps: {}, openCeDirectory: detectOpenCeDirectory() };
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
  maps: { bitmaps?: string | null; sounds?: string | null; loc?: string | null },
): void {
  const current = getSettings();
  const existing: VersionResourceMaps = current.versionResourceMaps?.[version] ?? { bitmaps: null, sounds: null, loc: null };
  const updatedVersion: VersionResourceMaps = {
    bitmaps: maps.bitmaps !== undefined ? maps.bitmaps : existing.bitmaps,
    sounds: maps.sounds !== undefined ? maps.sounds : existing.sounds,
    loc: maps.loc !== undefined ? maps.loc : (existing.loc ?? null),
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

export function detectOpenCeDirectory(): string | null {
  try {
    const home = app.getPath('home');
    const candidates = [
      'C:\\Users\\LeviB\\Desktop\\Halo CE Related\\Halo CE - OpenCE',
      path.join(home, 'Desktop', 'Halo CE Related', 'Halo CE - OpenCE'),
      'C:\\Halo CE - OpenCE',
      'C:\\OpenCE',
      'C:\\Games\\OpenCE',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.existsSync(path.join(c, 'halo.exe'))) {
        return c;
      }
    }
  } catch {
    // Ignore fs/app errors during detection
  }
  return null;
}

export function setOpenCeDirectory(dir: string | null): void {
  const current = getSettings();
  const exe = dir ? path.join(dir, 'halo.exe') : null;
  writeSettings({
    ...current,
    openCeDirectory: dir,
    openCeExecutablePath: exe && fs.existsSync(exe) ? exe : null,
  });
}
