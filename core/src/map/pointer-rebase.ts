/**
 * Schema-driven pointer rebase over the tag data of a cache file. Finds every pointer the engine
 * follows inside tag data - by walking the tag array and each tag's struct tree with the
 * definitions engine, never by scanning for pointer-like values - and moves the ones that fall in
 * a virtual-address range by a fixed delta.
 *
 * Used by the injector when ADD grows the tag array in place (every byte after the old array end
 * shifts by the growth, so every pointer at or past that address must follow). Written to be
 * shared with the Demo/HaloMD converter's Phase 2 (rebase the whole tag data from 0x4BF10000 to
 * 0x40440000): it takes a plain `TagDataLayout`, not a parsed CE map.
 *
 * Pointer sites (measured on all 5 CE sample maps, PRD 2026-10-11 "ADD tag-array growth"):
 * - tag array entry path pointer (+0x10) - every entry, external ones too;
 * - tag array entry data pointer (+0x14) - internal, non-BSP entries;
 * - TagReflexive pointer (+4) - including count-0 reflexives with a non-null pointer (0 seen);
 * - pointer-based TagDataOffset (+12) - not `externalFileOffset` (that is a file offset);
 * - TagDependency path pointer (+4) when non-zero.
 * Not sites: `nonCached` fields (skipped like the extractor does), `Pointer`-typed fields (model
 * vertex offsets and runtime bitmap pointers; none points into tag data - if one does, the tag is
 * unwalkable rather than guessed), BSP-space values (`bsp address`, plain uint32), and the
 * contents of data blobs (script syntax data, animation frame data, ... hold no addresses).
 *
 * A tag that cannot be walked completely (no definition, an uncertain layout, a pointer outside
 * tag data, a BSP tag whose struct sits in tag data) throws `UnwalkableTagError` naming it.
 * Nothing is skipped silently: a pointer that is missed would point at the wrong bytes.
 */
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';
import type { CacheFileHeader } from './header';
import type { TagIndex, TagIndexEntry } from './tag-index';
import { resolveStruct, decodeStruct, getGroupStructName } from './definitions/engine';
import { UNCERTAIN_GROUPS } from './dependency-walker';

export type TagDataPointerKind = 'tagPath' | 'tagData' | 'reflexive' | 'dataBlock' | 'referencePath';

export const TAG_DATA_POINTER_KINDS: readonly TagDataPointerKind[] = ['tagPath', 'tagData', 'reflexive', 'dataBlock', 'referencePath'];

/** Where the tag data is and how its pointers resolve. Pointer p lives at file offset `tagDataOffset + (p - baseMemoryAddress)`. */
export interface TagDataLayout {
  tagDataOffset: number;
  tagDataSize: number;
  baseMemoryAddress: number;
  tagArrayFileOffset: number;
  entries: readonly Pick<TagIndexEntry, 'index' | 'path' | 'primaryClassName' | 'isExternal' | 'tagDataPointerOrResourceIndex'>[];
}

/** The layout of an already-parsed Custom Edition map (its tag array always follows the tag data header - `parseTagIndex` requires it). */
export function tagDataLayoutOf(header: CacheFileHeader, tagIndex: TagIndex): TagDataLayout {
  return {
    tagDataOffset: header.tagDataOffset,
    tagDataSize: header.tagDataSize,
    baseMemoryAddress: tagIndex.baseMemoryAddress,
    tagArrayFileOffset: header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE,
    entries: tagIndex.entries,
  };
}

/** One stored pointer: `at` is the file offset of its 32-bit value. */
export interface TagDataPointerSite {
  kind: TagDataPointerKind;
  at: number;
  value: number;
  tagIndex: number;
}

export class UnwalkableTagError extends Error {
  constructor(
    public readonly tagIndex: number,
    public readonly tagPath: string,
    public readonly group: string,
    reason: string,
  ) {
    super(`Tag "${tagPath}" (${group}) in the target map can't be read completely with this build's tag definitions (${reason}), so its pointers can't be moved safely.`);
    this.name = 'UnwalkableTagError';
  }
}

/**
 * Every pointer site in the tag data, in tag order. Reads only; throws `UnwalkableTagError` for
 * the first tag that can't be walked. Sites are unique by `at` (a struct reached twice is walked once).
 */
export function collectTagDataPointers(buffer: Buffer, layout: TagDataLayout): TagDataPointerSite[] {
  const { tagDataOffset, tagDataSize, baseMemoryAddress } = layout;
  const tagDataEnd = tagDataOffset + tagDataSize;
  const fileOf = (pointer: number) => tagDataOffset + ((pointer - baseMemoryAddress) | 0);
  const inTagData = (pointer: number, length: number) => {
    const at = fileOf(pointer);
    return at >= tagDataOffset && at + length <= tagDataEnd && at + length <= buffer.length;
  };
  const sites: TagDataPointerSite[] = [];
  const seenSites = new Set<number>();
  const visitedStructs = new Set<string>();
  const addSite = (kind: TagDataPointerKind, at: number, tagIndex: number) => {
    if (seenSites.has(at)) return;
    seenSites.add(at);
    sites.push({ kind, at, value: buffer.readUInt32LE(at), tagIndex });
  };

  for (const e of layout.entries) {
    const group = e.primaryClassName ?? '(unknown)';
    const fail = (reason: string): never => {
      throw new UnwalkableTagError(e.index, e.path, group, reason);
    };
    const entryAt = layout.tagArrayFileOffset + e.index * TAG_ENTRY_SIZE;
    if (!inTagData(buffer.readUInt32LE(entryAt + 0x10), 1)) fail('its path pointer is outside the tag data');
    addSite('tagPath', entryAt + 0x10, e.index);
    if (e.isExternal) continue;

    const dataPointer = e.tagDataPointerOrResourceIndex >>> 0;
    if (group === 'scenario_structure_bsp') {
      // BSP structs live in BSP memory, not tag data (data pointer 0 in every sample map).
      if (dataPointer !== 0 && inTagData(dataPointer, 1)) fail('its BSP data pointer points into the tag data');
      continue;
    }
    if (UNCERTAIN_GROUPS.includes(group)) fail('this group has no reliable field layout');
    const rootStruct = e.primaryClassName ? getGroupStructName(e.primaryClassName) : null;
    if (!rootStruct) fail('there is no definition for this group');

    const walk = (structName: string, pointer: number, where: string): void => {
      const size = resolveStruct(structName).totalSize;
      if (!inTagData(pointer, size)) fail(`${where} is outside the tag data`);
      const at = fileOf(pointer);
      const key = `${structName}@${at}`;
      if (visitedStructs.has(key)) return;
      visitedStructs.add(key);
      const decoded = decodeStruct(buffer, at, structName);
      for (const field of resolveStruct(structName).fields) {
        const value = decoded.get(field.name);
        if (!value || field.def.nonCached) continue;
        const fieldAt = at + field.offset;
        const fieldWhere = `${where}.${field.name}`;
        if (value.kind === 'dependency') {
          const pathPointer = value.value.pathPointer >>> 0;
          if (pathPointer === 0) continue;
          if (!inTagData(pathPointer, 1)) fail(`${fieldWhere} has a path pointer outside the tag data`);
          addSite('referencePath', fieldAt + 4, e.index);
        } else if (value.kind === 'reflexive' && field.def.type === 'TagReflexive') {
          const pointer = value.value.pointerLow >>> 0;
          if (value.value.count === 0) {
            if (pointer !== 0) addSite('reflexive', fieldAt + 4, e.index);
            continue;
          }
          const childStruct = field.def.struct;
          if (!childStruct) return fail(`${fieldWhere} has no block definition`);
          const childSize = resolveStruct(childStruct).totalSize;
          if (!inTagData(pointer, value.value.count * childSize)) fail(`${fieldWhere} (${value.value.count} blocks) is outside the tag data`);
          addSite('reflexive', fieldAt + 4, e.index);
          for (let i = 0; i < value.value.count; i++) walk(childStruct, (pointer + i * childSize) >>> 0, `${fieldWhere}[${i}]`);
        } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset') {
          if (field.def.externalFileOffset) continue; // a file offset (resource map or raw data), not a tag-data pointer
          const pointer = value.value.pointerLow >>> 0;
          if (value.value.size > 0) {
            if (!inTagData(pointer, value.value.size)) fail(`${fieldWhere} (${value.value.size} bytes) is outside the tag data`);
            addSite('dataBlock', fieldAt + 12, e.index);
          } else if (pointer !== 0) {
            addSite('dataBlock', fieldAt + 12, e.index);
          }
        } else if (field.def.type === 'Pointer') {
          const raw = buffer.readUInt32LE(fieldAt);
          if (raw !== 0 && raw !== 0xffffffff && inTagData(raw, 1)) fail(`${fieldWhere} is a runtime pointer into the tag data, which this build doesn't know how to move`);
        }
      }
    };
    addSite('tagData', entryAt + 0x14, e.index);
    walk(rootStruct!, dataPointer, e.path);
  }
  return sites;
}

/** Pointers whose value is in [from, to) move by `delta` (virtual addresses, end exclusive). */
export interface PointerShift {
  from: number;
  to: number;
  delta: number;
}

export interface RebaseCounts {
  visited: Record<TagDataPointerKind, number>;
  rebased: Record<TagDataPointerKind, number>;
  totalVisited: number;
  totalRebased: number;
}

function zeroCounts(): Record<TagDataPointerKind, number> {
  return { tagPath: 0, tagData: 0, reflexive: 0, dataBlock: 0, referencePath: 0 };
}

/**
 * Applies `shift` to the collected sites: `write(at, newValue)` is called for every site in range
 * (`at` is the site's file offset in the buffer the sites were collected from - the caller maps it
 * if it writes into a re-laid-out copy). Returns per-kind counts.
 */
export function applyPointerShift(sites: readonly TagDataPointerSite[], shift: PointerShift, write: (at: number, value: number) => void): RebaseCounts {
  const counts: RebaseCounts = { visited: zeroCounts(), rebased: zeroCounts(), totalVisited: 0, totalRebased: 0 };
  for (const s of sites) {
    counts.visited[s.kind]++;
    counts.totalVisited++;
    if (s.value < shift.from || s.value >= shift.to) continue;
    write(s.at, (s.value + shift.delta) >>> 0);
    counts.rebased[s.kind]++;
    counts.totalRebased++;
  }
  return counts;
}

/** Collects and rebases in place (no bytes move). For a converter that only changes the base. */
export function rebaseTagDataPointersInPlace(buffer: Buffer, layout: TagDataLayout, shift: PointerShift): RebaseCounts {
  const sites = collectTagDataPointers(buffer, layout);
  return applyPointerShift(sites, shift, (at, value) => buffer.writeUInt32LE(value, at));
}
