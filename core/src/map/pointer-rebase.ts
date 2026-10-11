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
 * - tag array entry data pointer (+0x14) - internal non-BSP entries, AND external entries of a
 *   group that keeps its base struct in the map (`EXTERNAL_GROUPS_WITH_BASE_STRUCT`: sound). The
 *   external flag does not mean "resource index" for those: an external sound's data field is
 *   the address of its base struct in tag data; only its pitch ranges are in sounds.map (pointer
 *   null). Missing this blue-screened ADD maps in OpenCE (user-confirmed 2026-10-11);
 * - TagReflexive pointer (+4) - including count-0 reflexives with a non-null pointer (0 seen);
 * - pointer-based TagDataOffset (+12) - not `externalFileOffset` (that is a file offset);
 * - TagDependency path pointer (+4) when non-zero;
 * - TagDependency path pointers inside each BSP (`bspReferencePath`): the BSP struct lives in BSP
 *   memory, but its references' path pointers point at path strings in tag data. Not read at load
 *   (a map loads without them, user-confirmed), moved anyway to match Tool. Each BSP is found
 *   through the scenario's "structure bsps" (bsp start, bsp address; the BSP header's first word
 *   is the address of the BSP struct) and walked in BSP space; its own reflexive and data
 *   pointers are BSP addresses and never sites.
 * Not sites: `nonCached` fields (skipped like the extractor does), `Pointer`-typed fields (model
 * vertex offsets and runtime bitmap pointers; none points into tag data - if one does, the tag is
 * unwalkable rather than guessed), BSP-space values (`bsp address`, plain uint32), and the
 * contents of data blobs (script syntax data, animation frame data, ... hold no addresses).
 *
 * A tag that cannot be walked completely (no definition, an uncertain layout, a pointer outside
 * tag data, a BSP tag whose struct sits in tag data) throws `UnwalkableTagError` naming it.
 * Nothing is skipped silently: a pointer that is missed would point at the wrong bytes.
 *
 * Tolerant mode (`CollectOptions.tolerate`, converter Phase 1c only; PRD 2026-10-12): two kinds of
 * known-bad pointer in HaloMD maps are recorded in `tolerated` instead of throwing, and are not
 * sites (never moved):
 *   - `staleReferencePath`: a reference whose path pointer lies outside the tag data (so it names no
 *     path string): demo-era leftovers, path pointers in the demo's 0x4BF10000 range. Measured:
 *     heh_2 1 (BSP sound environment palette[0], stale tag ID), theisland_3 2 (scenery palette[14],
 *     stale tag ID; vehicles\banshee\banshee_mp weapons[0].weapon, tag ID NONE), every other sample
 *     map 0. The game follows a reference by its tag ID (OpenCE corrects a stale one to NONE), never
 *     by its path pointer.
 *   - `rootOutsideTagData`: a tag whose root struct lies (partly) outside the tag data (crossing
 *     #2404): its entry's path and data pointers are sites, the tag is not walked. The caller must
 *     check that a tagRootOutside repair replaces it.
 * Every other unwalkable pointer still throws.
 */
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';
import type { CacheFileHeader } from './header';
import type { TagIndex, TagIndexEntry } from './tag-index';
import { resolveStruct, decodeStruct, getGroupStructName } from './definitions/engine';
import type { DecodedFieldValue } from './definitions/engine';
import { UNCERTAIN_GROUPS } from './dependency-walker';

export type TagDataPointerKind = 'tagPath' | 'tagData' | 'reflexive' | 'dataBlock' | 'referencePath' | 'bspReferencePath';

export const TAG_DATA_POINTER_KINDS: readonly TagDataPointerKind[] = ['tagPath', 'tagData', 'reflexive', 'dataBlock', 'referencePath', 'bspReferencePath'];

/** Where the tag data is and how its pointers resolve. Pointer p lives at file offset `tagDataOffset + (p - baseMemoryAddress)`. */
export interface TagDataLayout {
  tagDataOffset: number;
  tagDataSize: number;
  baseMemoryAddress: number;
  tagArrayFileOffset: number;
  /** Names and flags only: every pointer is read from the buffer itself, so the layout stays valid after an in-place rebase. */
  entries: readonly Pick<TagIndexEntry, 'index' | 'path' | 'primaryClassName' | 'isExternal'>[];
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

/**
 * External (resource-map) groups whose tag-array data field is the ADDRESS of a base struct kept
 * in this map's tag data, not a resource index. Measured on all 5 CE sample maps: every external
 * sound (bloodgulch 333, sidewinder 334, coldsnap 327, Yoyorast 323) holds an address of a
 * 164-byte Sound struct whose `pitch ranges` reflexive has a null pointer (data in sounds.map).
 */
export const EXTERNAL_GROUPS_WITH_BASE_STRUCT: readonly string[] = ['sound'];

/**
 * External groups whose data field is a resource-map index (nothing in tag data). Measured: every
 * external bitmap (448/439/406/416), font (3), unicode_string_list (100/100/95/97) and
 * hud_message_text (1) holds an index below 0x10000. An external entry of any other group is
 * refused rather than guessed.
 */
export const EXTERNAL_GROUPS_WITH_RESOURCE_INDEX: readonly string[] = ['bitmap', 'font', 'unicode_string_list', 'hud_message_text'];

/** A pointer the tolerant walk recorded instead of refusing (see the header comment). */
export interface ToleratedPointer {
  kind: 'staleReferencePath' | 'rootOutsideTagData';
  tagIndex: number;
  /** File offset of the 32-bit pointer. */
  at: number;
  value: number;
  /** Where it is, for the dialog. */
  where: string;
}

export interface CollectOptions {
  tolerate?: { staleReferencePaths?: boolean; rootsOutsideTagData?: boolean };
  /** Receives every tolerated pointer. */
  tolerated?: ToleratedPointer[];
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
export function collectTagDataPointers(buffer: Buffer, layout: TagDataLayout, options: CollectOptions = {}): TagDataPointerSite[] {
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
  const tolerate = (pointer: ToleratedPointer) => {
    if (seenSites.has(pointer.at)) return;
    seenSites.add(pointer.at);
    options.tolerated?.push(pointer);
  };
  /** A non-null reference whose path pointer is outside the tag data: stale (tolerated) or unwalkable. */
  const stalePath = (pathPointer: number) => options.tolerate?.staleReferencePaths === true && !inTagData(pathPointer, 1);

  for (const e of layout.entries) {
    const group = e.primaryClassName ?? '(unknown)';
    const fail = (reason: string): never => {
      throw new UnwalkableTagError(e.index, e.path, group, reason);
    };
    const entryAt = layout.tagArrayFileOffset + e.index * TAG_ENTRY_SIZE;
    if (!inTagData(buffer.readUInt32LE(entryAt + 0x10), 1)) fail('its path pointer is outside the tag data');
    addSite('tagPath', entryAt + 0x10, e.index);
    const dataPointer = buffer.readUInt32LE(entryAt + 0x14);
    // External: the group decides whether the data field is an address (base struct kept in the
    // map) or a resource index. Never decided by the value.
    const resourceBacked = e.isExternal && EXTERNAL_GROUPS_WITH_BASE_STRUCT.includes(group);
    if (e.isExternal && !resourceBacked) {
      if (EXTERNAL_GROUPS_WITH_RESOURCE_INDEX.includes(group)) continue;
      fail('it is an external (resource map) entry of a group this build has not measured, so its data field could be an address or an index');
    }
    if (group === 'scenario_structure_bsp') {
      // BSP structs live in BSP memory, not tag data (data pointer 0 in every sample map).
      if (dataPointer !== 0 && inTagData(dataPointer, 1)) fail('its BSP data pointer points into the tag data');
      continue;
    }
    if (UNCERTAIN_GROUPS.includes(group)) fail('this group has no reliable field layout');
    const rootStruct = e.primaryClassName ? getGroupStructName(e.primaryClassName) : null;
    if (!rootStruct) fail('there is no definition for this group');
    if (options.tolerate?.rootsOutsideTagData && !inTagData(dataPointer, resolveStruct(rootStruct!).totalSize)) {
      // Not walked: a tagRootOutside repair replaces the root (the caller checks).
      options.tolerated?.push({ kind: 'rootOutsideTagData', tagIndex: e.index, at: entryAt + 0x14, value: dataPointer, where: `${e.path} root` });
      addSite('tagData', entryAt + 0x14, e.index);
      continue;
    }

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
          if (stalePath(pathPointer)) {
            tolerate({ kind: 'staleReferencePath', tagIndex: e.index, at: fieldAt + 4, value: pathPointer, where: fieldWhere });
            continue;
          }
          if (!inTagData(pathPointer, 1)) fail(`${fieldWhere} has a path pointer outside the tag data`);
          addSite('referencePath', fieldAt + 4, e.index);
        } else if (value.kind === 'reflexive' && field.def.type === 'TagReflexive') {
          const pointer = value.value.pointerLow >>> 0;
          if (value.value.count === 0) {
            if (pointer !== 0) addSite('reflexive', fieldAt + 4, e.index);
            continue;
          }
          // Resource-backed base struct: blocks with a null pointer are loaded from the resource map.
          if (resourceBacked && pointer === 0) continue;
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
  collectBspReferencePaths(buffer, layout, inTagData, fileOf, addSite, (pathPointer) => stalePath(pathPointer), tolerate);
  return sites;
}

/** Reads one basic (numeric) field of a decoded struct, or undefined. */
function basicNumber(decoded: Map<string, DecodedFieldValue>, name: string): number | undefined {
  const v = decoded.get(name);
  return v?.kind === 'basic' && typeof v.value === 'number' ? v.value : undefined;
}

/**
 * Adds a `bspReferencePath` site for every non-zero reference path pointer inside every BSP the
 * scenario lists. Throws `UnwalkableTagError` naming the BSP tag if a BSP can't be walked.
 */
function collectBspReferencePaths(
  buffer: Buffer,
  layout: TagDataLayout,
  inTagData: (pointer: number, length: number) => boolean,
  fileOf: (pointer: number) => number,
  addSite: (kind: TagDataPointerKind, at: number, tagIndex: number) => void,
  stalePath: (pathPointer: number) => boolean = () => false,
  tolerate: (pointer: ToleratedPointer) => void = () => undefined,
): void {
  const scenarioStruct = getGroupStructName('scenario');
  const bspStruct = getGroupStructName('scenario_structure_bsp');
  if (!scenarioStruct || !bspStruct) return;
  const bspsField = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps');
  const scenarioBspStruct = bspsField?.def.type === 'TagReflexive' ? bspsField.def.struct : undefined;
  for (const scenario of layout.entries) {
    if (scenario.isExternal || scenario.primaryClassName !== 'scenario') continue;
    const scenarioPointer = buffer.readUInt32LE(layout.tagArrayFileOffset + scenario.index * TAG_ENTRY_SIZE + 0x14);
    const bsps = decodeStruct(buffer, fileOf(scenarioPointer), scenarioStruct).get('structure bsps');
    if (bsps?.kind !== 'reflexive' || bsps.value.count === 0) continue;
    if (!scenarioBspStruct) throw new UnwalkableTagError(scenario.index, scenario.path, 'scenario', '"structure bsps" is not a block list in this build\'s definitions');
    const elementSize = resolveStruct(scenarioBspStruct).totalSize;
    for (let b = 0; b < bsps.value.count; b++) {
      const element = decodeStruct(buffer, fileOf(bsps.value.pointerLow + b * elementSize), scenarioBspStruct);
      const ref = element.get('structure bsp');
      const bspEntry = ref?.kind === 'dependency' ? layout.entries[ref.value.tagId & 0xffff] : undefined;
      const name = bspEntry ?? { index: scenario.index, path: `${scenario.path} structure bsps[${b}]` };
      const fail = (reason: string): never => {
        throw new UnwalkableTagError(name.index, name.path, 'scenario_structure_bsp', reason);
      };
      const bspStart = basicNumber(element, 'bsp start');
      const bspSize = basicNumber(element, 'bsp size');
      const bspAddress = basicNumber(element, 'bsp address');
      if (bspStart === undefined || bspSize === undefined || bspAddress === undefined) fail('its location in the scenario could not be read');
      if (bspSize! < 4 || bspStart! + 4 > buffer.length) fail('its BSP header is outside the file');
      // Every block walked must be inside the BSP region the scenario declares AND inside the file.
      const inBsp = (pointer: number, length: number) => {
        const at = bspStart! + ((pointer - bspAddress!) | 0);
        return at >= bspStart! && at + length <= bspStart! + bspSize! && at + length <= buffer.length;
      };
      const visited = new Set<string>();
      const walk = (structName: string, pointer: number, where: string): void => {
        const size = resolveStruct(structName).totalSize;
        if (!inBsp(pointer, size)) fail(`${where} is outside the BSP data`);
        const at = bspStart! + ((pointer - bspAddress!) | 0);
        const key = `${structName}@${at}`;
        if (visited.has(key)) return;
        visited.add(key);
        const decoded = decodeStruct(buffer, at, structName);
        for (const field of resolveStruct(structName).fields) {
          const value = decoded.get(field.name);
          if (!value || field.def.nonCached) continue;
          if (value.kind === 'dependency') {
            const pathPointer = value.value.pathPointer >>> 0;
            if (pathPointer === 0) continue;
            if (stalePath(pathPointer)) {
              tolerate({ kind: 'staleReferencePath', tagIndex: name.index, at: at + field.offset + 4, value: pathPointer, where: `${where}.${field.name}` });
              continue;
            }
            if (!inTagData(pathPointer, 1)) fail(`${where}.${field.name} has a path pointer outside the tag data`);
            addSite('bspReferencePath', at + field.offset + 4, name.index);
          } else if (value.kind === 'reflexive' && field.def.type === 'TagReflexive' && value.value.count > 0) {
            const childStruct = field.def.struct;
            if (!childStruct) return fail(`${where}.${field.name} has no block definition`);
            const childSize = resolveStruct(childStruct).totalSize;
            const childPointer = value.value.pointerLow >>> 0;
            if (!inBsp(childPointer, value.value.count * childSize)) fail(`${where}.${field.name} (${value.value.count} blocks) is outside the BSP data`);
            for (let i = 0; i < value.value.count; i++) walk(childStruct, (childPointer + i * childSize) >>> 0, `${where}.${field.name}[${i}]`);
          }
        }
      };
      walk(bspStruct, buffer.readUInt32LE(bspStart!), name.path);
    }
  }
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
  return { tagPath: 0, tagData: 0, reflexive: 0, dataBlock: 0, referencePath: 0, bspReferencePath: 0 };
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
