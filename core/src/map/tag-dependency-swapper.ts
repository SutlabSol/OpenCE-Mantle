import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';
import { resolveStruct, getGroupDefinition, getGroupStructName, isRangeInBuffer, resolvePointer } from './definitions/engine';
import { decodeDependency, encodeDependency, decodeReflexive } from './definitions/codec';
import { NULL_TAG_ID } from '../constants/tag-classes';
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';

/** Safety cap on elements walked per reflexive (matches the dependency walker's intent). */
const MAX_ELEMENTS_PER_REFLEXIVE = 4096;

export interface TagDependencySlot {
  /** Path inside the tag, e.g. `triggers[0].projectile`. Unique per slot. */
  fieldPath: string;
  fieldName: string;
  /** Group names the schema allows for this slot (informational only: any tag may be written). */
  allowedClasses: string[];
  currentTagId: number;
  /** null when the slot is null or points at an unknown tag. */
  currentPath: string | null;
  currentGroup: string | null;
}

export class TagDependencySwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagDependencySwapError';
  }
}

interface RawSlot {
  fieldPath: string;
  fieldName: string;
  allowedClasses: string[];
  absOffset: number;
}

function walkStruct(
  buffer: Buffer,
  structName: string,
  base: number,
  anchor: number,
  baseMemoryAddress: number,
  prefix: string,
  out: RawSlot[],
): void {
  const resolved = resolveStruct(structName);
  if (!isRangeInBuffer(base, resolved.totalSize, buffer.length)) return;
  for (const field of resolved.fields) {
    if (field.def.nonCached) continue;
    const abs = base + field.offset;
    if (field.def.type === 'TagDependency') {
      out.push({ fieldPath: `${prefix}${field.name}`, fieldName: field.name, allowedClasses: field.def.classes ?? [], absOffset: abs });
    } else if (field.def.type === 'TagReflexive' && field.def.struct) {
      const refl = decodeReflexive(buffer, abs);
      if (refl.count === 0) continue;
      const childSize = resolveStruct(field.def.struct).totalSize;
      const childBase = resolvePointer(refl.pointerLow, anchor, baseMemoryAddress);
      if (!isRangeInBuffer(childBase, refl.count * childSize, buffer.length)) continue; // corrupt block: skipped, never thrown
      const n = Math.min(refl.count, MAX_ELEMENTS_PER_REFLEXIVE);
      for (let i = 0; i < n; i++) {
        walkStruct(buffer, field.def.struct, childBase + i * childSize, anchor, baseMemoryAddress, `${prefix}${field.name}[${i}].`, out);
      }
    }
  }
}

function collectSlots(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex, tagEntryIndex: number): RawSlot[] {
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry) throw new TagDependencySwapError(`Tag #${tagEntryIndex} not found.`);
  const group = entry.primaryClassName;
  if (!group || !getGroupStructName(group)) return [];
  if (entry.isExternal) return [];
  const def = getGroupDefinition(group);
  if (def.extractable === false) return []; // e.g. scenario_structure_bsp: different pointer anchor
  const rootOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  const out: RawSlot[] = [];
  walkStruct(buffer, def.name, rootOffset, header.tagDataOffset, tagIndex.baseMemoryAddress, '', out);
  return out;
}

/** Every TagDependency slot of the tag, nested blocks and null slots included, in struct order. */
export function listTagDependencySlots(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex, tagEntryIndex: number): TagDependencySlot[] {
  const byId = new Map<number, (typeof tagIndex.entries)[number]>();
  for (const e of tagIndex.entries) byId.set(e.tagId, e);
  return collectSlots(buffer, header, tagIndex, tagEntryIndex).map((s) => {
    const dep = decodeDependency(buffer, s.absOffset);
    const target = dep.tagId === NULL_TAG_ID ? undefined : byId.get(dep.tagId);
    return {
      fieldPath: s.fieldPath,
      fieldName: s.fieldName,
      allowedClasses: s.allowedClasses,
      currentTagId: dep.tagId,
      currentPath: target ? target.path : null,
      currentGroup: target ? (target.primaryClassName ?? null) : null,
    };
  });
}

/**
 * Rewrites ONE slot's 16 bytes in place. `newTagId` null clears it. Any tag of any class is accepted.
 * Nothing else is touched: no tag moves, no pointers shift.
 */
export function setTagDependencySlot(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  tagEntryIndex: number,
  fieldPath: string,
  newTagId: number | null,
): { fieldPath: string; newTagId: number } {
  const slot = collectSlots(buffer, header, tagIndex, tagEntryIndex).find((s) => s.fieldPath === fieldPath);
  if (!slot) throw new TagDependencySwapError(`Tag #${tagEntryIndex} has no dependency slot "${fieldPath}".`);
  const existing = decodeDependency(buffer, slot.absOffset);

  if (newTagId === null || (newTagId >>> 0) === NULL_TAG_ID) {
    encodeDependency(buffer, slot.absOffset, { fourcc: existing.fourcc, pathPointer: 0, pathSize: 0, tagId: NULL_TAG_ID });
    return { fieldPath, newTagId: NULL_TAG_ID };
  }

  const target = tagIndex.entries.find((e) => e.tagId === (newTagId >>> 0));
  if (!target) throw new TagDependencySwapError(`Target tag ID 0x${(newTagId >>> 0).toString(16)} is not in this map.`);
  const tagHeaderSize = header.engine === 5 ? 0x24 : TAG_DATA_HEADER_PC_SIZE;
  const arrayOffset = header.tagDataOffset + tagHeaderSize; // tag array follows the tag data header
  const pathPointer = buffer.readUInt32LE(arrayOffset + target.index * TAG_ENTRY_SIZE + 0x10);
  encodeDependency(buffer, slot.absOffset, { fourcc: target.primaryClassFourCC, pathPointer, pathSize: 0, tagId: target.tagId });
  return { fieldPath, newTagId: target.tagId };
}
