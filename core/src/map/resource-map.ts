import { CorruptMapError } from './errors';

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
