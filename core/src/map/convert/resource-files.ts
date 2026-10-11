import { RESOURCE_MAP_TYPE_BY_KIND } from '../resource-map';

/**
 * Resource maps (bitmaps.map, sounds.map) supplied for the converter, read by offset only: a full
 * HaloMD bitmaps.map is 317 MB, so it is never loaded whole. Core has no file I/O; the caller (the
 * map worker, the developer script, tests) provides a `RandomAccessFile` backed by an open file.
 *
 * Header and entry layout as in `resource-map.ts` (Invader resource_map.hpp, reference only):
 * header 0x10 = type, paths offset, table offset, count; entry 0xC = path offset (relative to the
 * paths block), data size, data offset (absolute).
 */
export interface RandomAccessFile {
  /** For messages, e.g. the file name. */
  readonly label: string;
  readonly size: number;
  /** Exactly `length` bytes at `offset`; the caller has checked the range is inside the file. */
  read(offset: number, length: number): Buffer;
}

/** A RandomAccessFile over a buffer already in memory (tests, small files). */
export function randomAccessBuffer(buffer: Buffer, label: string): RandomAccessFile {
  return { label, size: buffer.length, read: (offset, length) => Buffer.from(buffer.subarray(offset, offset + length)) };
}

export type ResourceKind = 'bitmaps' | 'sounds';

export interface ResourceTableEntry {
  index: number;
  name: string;
  dataOffset: number;
  size: number;
}

export interface ResourceTable {
  kind: ResourceKind;
  label: string;
  fileSize: number;
  entries: ResourceTableEntry[];
  /** `${dataOffset}:${size}` -> entry (the first one, if two entries share a range). */
  byRange: Map<string, ResourceTableEntry>;
}

const HEADER_SIZE = 0x10;
const ENTRY_SIZE = 0xc;
/** Sanity bound for the path strings block (HaloMD sounds.map: 653,673 bytes). */
const MAX_PATHS_BLOCK = 64 * 1024 * 1024;

export const rangeKey = (offset: number, size: number) => `${offset}:${size}`;

/**
 * Reads and checks one resource map's header and table. Returns a plain-language error instead of
 * throwing. Only checks the file's own structure; whether it is the RIGHT file for a map is decided
 * by matching every external range (`externalize-in.ts`), never by its name or size.
 */
export function readResourceTable(file: RandomAccessFile, kind: ResourceKind): { ok: true; table: ResourceTable } | { ok: false; error: string } {
  const name = `${kind}.map`;
  if (file.size < HEADER_SIZE) return { ok: false, error: `${file.label} is too small to be a resource map.` };
  const header = file.read(0, HEADER_SIZE);
  const type = header.readUInt32LE(0x0);
  const pathsOffset = header.readUInt32LE(0x4);
  const tableOffset = header.readUInt32LE(0x8);
  const count = header.readUInt32LE(0xc);
  if (type !== RESOURCE_MAP_TYPE_BY_KIND[kind]) {
    const actual = (Object.keys(RESOURCE_MAP_TYPE_BY_KIND) as (keyof typeof RESOURCE_MAP_TYPE_BY_KIND)[]).find((k) => RESOURCE_MAP_TYPE_BY_KIND[k] === type);
    return { ok: false, error: actual ? `${file.label} is a ${actual}.map resource file, not a ${name}.` : `${file.label} is not a resource map (type ${type}).` };
  }
  if (count === 0 || tableOffset + count * ENTRY_SIZE > file.size) return { ok: false, error: `${file.label}: the resource table is empty or runs past the end of the file.` };
  if (pathsOffset < HEADER_SIZE || pathsOffset > tableOffset || tableOffset - pathsOffset > MAX_PATHS_BLOCK) {
    return { ok: false, error: `${file.label}: the resource names block is not where a ${name} has it.` };
  }
  const table = file.read(tableOffset, count * ENTRY_SIZE);
  const paths = file.read(pathsOffset, tableOffset - pathsOffset);
  const entries: ResourceTableEntry[] = [];
  const byRange = new Map<string, ResourceTableEntry>();
  for (let i = 0; i < count; i++) {
    const pathAt = table.readUInt32LE(i * ENTRY_SIZE);
    const size = table.readUInt32LE(i * ENTRY_SIZE + 0x4);
    const dataOffset = table.readUInt32LE(i * ENTRY_SIZE + 0x8);
    if (dataOffset < HEADER_SIZE || dataOffset + size > pathsOffset) {
      return { ok: false, error: `${file.label}: resource #${i} (offset ${dataOffset}, ${size} bytes) is outside the data area of the file.` };
    }
    if (pathAt >= paths.length) return { ok: false, error: `${file.label}: resource #${i} has a name outside the names block.` };
    const end = paths.indexOf(0, pathAt);
    const entry = { index: i, name: paths.toString('latin1', pathAt, end < 0 ? paths.length : end), dataOffset, size };
    entries.push(entry);
    const key = rangeKey(dataOffset, size);
    if (!byRange.has(key)) byRange.set(key, entry);
  }
  return { ok: true, table: { kind, label: file.label, fileSize: file.size, entries, byRange } };
}
