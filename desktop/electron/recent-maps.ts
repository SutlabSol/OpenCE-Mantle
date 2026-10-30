import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { inspectMapBufferForRecentCard } from '../../core/src/index';
import type { RecentMapCardEntry } from './shared-types';

const MAX_RECENT = 24;

function storePath(): string {
  return path.join(app.getPath('userData'), 'recent-maps.json');
}

function cardsCachePath(): string {
  return path.join(app.getPath('userData'), 'recent-maps-cards.json');
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

function readCardsCache(): Record<string, RecentMapCardEntry> {
  try {
    const raw = fs.readFileSync(cardsCachePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCardsCache(cache: Record<string, RecentMapCardEntry>): void {
  try {
    fs.writeFileSync(cardsCachePath(), JSON.stringify(cache));
  } catch {
    // Non-fatal
  }
}

function buildCardForMapPath(
  filePath: string,
  existing?: RecentMapCardEntry,
  touchTimestamp = false,
): RecentMapCardEntry | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    // Reuse cached wireframe if file size matches and wireframe was already computed
    if (
      existing &&
      existing.fileSizeBytes === stat.size &&
      existing.wireframe !== undefined &&
      existing.tagCount > 0
    ) {
      return {
        ...existing,
        filePath,
        fileName,
        lastOpenedAt: touchTimestamp ? Date.now() : existing.lastOpenedAt || stat.mtimeMs,
      };
    }

    const buf = fs.readFileSync(filePath);
    const inspected = inspectMapBufferForRecentCard(buf, 1600);
    if (!inspected) {
      return {
        filePath,
        fileName,
        scenarioName: path.basename(filePath, path.extname(filePath)),
        engine: 609,
        mapEdition: 'ce',
        mapType: 1,
        tagCount: 0,
        fileSizeBytes: stat.size,
        lastOpenedAt: touchTimestamp ? Date.now() : existing?.lastOpenedAt ?? stat.mtimeMs,
        pinned: existing?.pinned ?? false,
        wireframe: null,
      };
    }

    return {
      filePath,
      fileName,
      scenarioName: inspected.scenarioName || path.basename(filePath, path.extname(filePath)),
      engine: inspected.engine,
      mapEdition: inspected.mapEdition,
      mapType: inspected.mapType,
      tagCount: inspected.tagCount,
      fileSizeBytes: stat.size,
      lastOpenedAt: touchTimestamp ? Date.now() : existing?.lastOpenedAt ?? stat.mtimeMs,
      pinned: existing?.pinned ?? false,
      wireframe: inspected.wireframe,
    };
  } catch {
    return null;
  }
}

export function addRecentMap(filePath: string): string[] {
  const normalizedTarget = path.resolve(filePath);
  const current = getRecentMaps().filter((p) => path.resolve(p).toLowerCase() !== normalizedTarget.toLowerCase());
  const updated = [filePath, ...current].slice(0, MAX_RECENT);
  try {
    fs.writeFileSync(storePath(), JSON.stringify(updated, null, 2));
  } catch {
    // Non-fatal: recent maps list just won't persist.
  }

  // Update card cache with BSP wireframe
  const cache = readCardsCache();
  const key = normalizedTarget.toLowerCase();
  const built = buildCardForMapPath(filePath, cache[key], true);
  if (built) {
    cache[key] = built;
    writeCardsCache(cache);
  }

  return updated;
}

export function getRecentMapCards(): RecentMapCardEntry[] {
  const paths = getRecentMaps();
  const cache = readCardsCache();
  let dirty = false;
  const results: RecentMapCardEntry[] = [];

  for (const p of paths) {
    const key = path.resolve(p).toLowerCase();
    const card = buildCardForMapPath(p, cache[key], false);
    if (card) {
      if (!cache[key] || cache[key]!.fileSizeBytes !== card.fileSizeBytes) {
        cache[key] = card;
        dirty = true;
      }
      results.push(card);
    }
  }

  if (dirty) {
    writeCardsCache(cache);
  }

  // Sort pinned first, then by lastOpenedAt descending
  results.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
  });

  return results;
}

export function togglePinRecentMap(filePath: string): RecentMapCardEntry[] {
  const key = path.resolve(filePath).toLowerCase();
  const cache = readCardsCache();
  const existing = cache[key] ?? buildCardForMapPath(filePath, undefined, false);
  if (existing) {
    cache[key] = { ...existing, pinned: !existing.pinned };
    writeCardsCache(cache);
  }
  return getRecentMapCards();
}

export function removeRecentMapEntry(filePath: string): RecentMapCardEntry[] {
  const targetKey = path.resolve(filePath).toLowerCase();
  const filtered = getRecentMaps().filter((p) => path.resolve(p).toLowerCase() !== targetKey);
  try {
    fs.writeFileSync(storePath(), JSON.stringify(filtered, null, 2));
  } catch {
    // Non-fatal
  }
  const cache = readCardsCache();
  if (cache[targetKey]) {
    delete cache[targetKey];
    writeCardsCache(cache);
  }
  return getRecentMapCards();
}
