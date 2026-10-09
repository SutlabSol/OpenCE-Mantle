import { CorruptMapError } from './errors';
import { createHash } from 'crypto';

/**
 * Parsed form of the Custom Edition resource map header (bitmaps.map/sounds.map/loc.map).
 * This is a DIFFERENT, much simpler format than the main cache file: a small header followed
 * by an array of fixed-size resource index entries and a block of path strings.
 *
 * SOURCE (read this session): invader/include/invader/resource/hek/resource_map.hpp
 * (SnowyMouse/invader, commit 696830f, GPL-3.0-only, reference only):
 *   `ResourceMapHeader`  (0x10 bytes): type(4) + paths(4) + resources(4) + resource_count(4)
 *   `ResourceMapResource` (0xC bytes): path_offset(4) + size(4) + data_offset(4)
 * Both static_assert'd in that header; all fields little-endian.
 */
export interface ResourceMapEntry {
  index: number;
  pathOffset: number;
  size: number;
  dataOffset: number;
}

export interface ResourceMap {
  type: number;
  resourceCount: number;
  entries: ResourceMapEntry[];
}

const RESOURCE_MAP_HEADER_SIZE = 0x10;
const RESOURCE_MAP_ENTRY_SIZE = 0xc;

export function parseResourceMap(buffer: Buffer): ResourceMap {
  if (buffer.length < RESOURCE_MAP_HEADER_SIZE) {
    throw new CorruptMapError('Resource map is smaller than its own header.');
  }
  const type = buffer.readUInt32LE(0x0);
  const pathsOffset = buffer.readUInt32LE(0x4);
  const resourcesOffset = buffer.readUInt32LE(0x8);
  const resourceCount = buffer.readUInt32LE(0xc);

  if (resourcesOffset + resourceCount * RESOURCE_MAP_ENTRY_SIZE > buffer.length) {
    throw new CorruptMapError('Resource map index is out of bounds of the file.');
  }

  const entries: ResourceMapEntry[] = [];
  for (let i = 0; i < resourceCount; i++) {
    const entryOffset = resourcesOffset + i * RESOURCE_MAP_ENTRY_SIZE;
    entries.push({
      index: i,
      pathOffset: pathsOffset + buffer.readUInt32LE(entryOffset + 0x0),
      size: buffer.readUInt32LE(entryOffset + 0x4),
      dataOffset: buffer.readUInt32LE(entryOffset + 0x8),
    });
  }

  return { type, resourceCount, entries };
}

/** True if `resourceIndex` is a valid, in-bounds entry in `map` whose data region fits in `buffer`. */
export function resourceIndexResolves(buffer: Buffer, map: ResourceMap, resourceIndex: number): boolean {
  if (resourceIndex < 0 || resourceIndex >= map.entries.length) return false;
  const entry = map.entries[resourceIndex];
  return entry.dataOffset + entry.size <= buffer.length;
}

/**
 * A lightweight identity for one resource map file, used to detect when the target map's
 * configured bitmaps.map/sounds.map/loc.map is NOT the same file (or a compatible build of it)
 * as the one the source map's tags were originally compiled against. Deliberately cheap:
 * fingerprints only the header + entry table (not the whole file, which can be 100+ MB), per
 * the explicit requirement that per-asset `pixel_data_offset`/`samples.file_offset` fields are
 * raw file offsets with no index-based lookup to validate against - a bounds check alone cannot
 * catch "right size, wrong content" (e.g. a different game build/patch's resource maps).
 */
export interface ResourceMapIdentity {
  fileSize: number;
  entryCount: number;
  /** sha256 of the resource map header + entry table (NOT the asset payload bytes). */
  fingerprint: string;
}

export function computeResourceMapIdentity(buffer: Buffer): ResourceMapIdentity {
  const map = parseResourceMap(buffer);
  const resourcesOffset = buffer.readUInt32LE(0x8);
  const tableEnd = resourcesOffset + map.resourceCount * RESOURCE_MAP_ENTRY_SIZE;
  const hash = createHash('sha256');
  hash.update(buffer.subarray(0, Math.min(tableEnd, buffer.length)));
  return { fileSize: buffer.length, entryCount: map.resourceCount, fingerprint: hash.digest('hex') };
}

export function resourceMapIdentitiesMatch(a: ResourceMapIdentity, b: ResourceMapIdentity): boolean {
  return a.fileSize === b.fileSize && a.entryCount === b.entryCount && a.fingerprint === b.fingerprint;
}

/** SOURCE: invader/include/invader/resource/hek/resource_map.hpp - `ResourceMapType` enum. */
export const RESOURCE_MAP_TYPE_BY_KIND: Record<'bitmaps' | 'sounds' | 'loc', number> = { bitmaps: 1, sounds: 2, loc: 3 };

export type ResourceMapValidationResult = { ok: true; identity: ResourceMapIdentity } | { ok: false; error: string };

/** Used by the Settings picker: confirms the chosen file is a readable resource map of the EXPECTED kind for that slot (e.g. refuses sounds.map dropped into the bitmaps.map slot), with a plain-language error otherwise. */
export function validateResourceMapFile(buffer: Buffer, kind: 'bitmaps' | 'sounds' | 'loc'): ResourceMapValidationResult {
  let map: ResourceMap;
  try {
    map = parseResourceMap(buffer);
  } catch (err) {
    return { ok: false, error: `This file doesn't look like a resource map (${err instanceof Error ? err.message : String(err)}).` };
  }
  const expectedType = RESOURCE_MAP_TYPE_BY_KIND[kind];
  if (map.type !== expectedType) {
    const kindName = (Object.keys(RESOURCE_MAP_TYPE_BY_KIND) as Array<'bitmaps' | 'sounds' | 'loc'>).find((k) => RESOURCE_MAP_TYPE_BY_KIND[k] === map.type);
    return { ok: false, error: `This file is a ${kindName ?? 'unknown'}-type resource map, not a ${kind}.map - pick the correct file for this slot.` };
  }
  return { ok: true, identity: computeResourceMapIdentity(buffer) };
}
