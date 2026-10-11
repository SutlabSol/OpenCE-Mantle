import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../../constants/cache-file';
import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { resolveTagDataPointer } from '../tag-index';
import { decodeStruct, resolveStruct, resolvePointer, getAllTagGroupNames, getGroupStructName, isRangeInBuffer } from '../definitions/engine';
import { locateStructureBsp } from '../definitions/validate-tag';

/**
 * A tag reference whose full tag ID or path pointer doesn't match the tag array entry it points at.
 * The CE validator (`validate-tag.ts`) only checks a reference's index (low 16 bits) and class, so
 * it accepts these. In every CE sample map each non-null reference carries the entry's exact tag ID
 * and path pointer (measured 2026-10-11: 0 mismatches in bloodgulch, sidewinder, coldsnap, ui,
 * Yoyorast_Island). The HaloMD maps each have one, left over from the demo version of the map
 * (old salt, path pointer in the demo's 0x4BF10000 range).
 */
export interface ReferenceIdentityIssue {
  /** Where the reference is, e.g. `levels\test\bloodgulch\bloodgulch.scenario.scenery palette[14].name`. */
  context: string;
  tagId: number;
  /** The tag ID of the entry at the reference's index, or null when the index is past the tag array. */
  entryTagId: number | null;
  pathPointer: number;
  entryPathPointer: number | null;
}

const TAG_DEPENDENCY_PATH_POINTER = 0x4;
const NULL_TAG_ID = 0xffffffff;

/**
 * Walks every internal tag (and each BSP through the scenario's "structure bsps") with the schema
 * engine, never by scanning, and returns every non-null reference whose tag ID or path pointer
 * differs from its entry's. `nonCached` fields are skipped, like the validator does.
 */
export function findReferenceIdentityIssues(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): ReferenceIdentityIssue[] {
  const arrayAt = header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE;
  const entryPathPointer = (index: number) => buffer.readUInt32LE(arrayAt + index * TAG_ENTRY_SIZE + 0x10);
  const issues: ReferenceIdentityIssue[] = [];
  const visited = new Set<string>();

  const walk = (structName: string, at: number, anchor: number, base: number, context: string) => {
    const resolved = resolveStruct(structName);
    if (!isRangeInBuffer(at, resolved.totalSize, buffer.length)) return;
    const key = `${structName}@${at}`;
    if (visited.has(key)) return;
    visited.add(key);
    const decoded = decodeStruct(buffer, at, structName);
    for (const field of resolved.fields) {
      if (field.def.nonCached) continue;
      const value = decoded.get(field.name);
      if (!value) continue;
      if (value.kind === 'dependency') {
        const tagId = value.value.tagId >>> 0;
        if (tagId === NULL_TAG_ID) continue;
        const pathPointer = buffer.readUInt32LE(at + field.offset + TAG_DEPENDENCY_PATH_POINTER);
        const index = tagId & 0xffff;
        const entry = index < tagIndex.entries.length ? tagIndex.entries[index] : null;
        const entryTagId = entry ? entry.tagId >>> 0 : null;
        const entryPath = entry ? entryPathPointer(index) : null;
        if (entryTagId !== tagId || entryPath !== pathPointer) {
          issues.push({ context: `${context}.${field.name}`, tagId, entryTagId, pathPointer, entryPathPointer: entryPath });
        }
      } else if (value.kind === 'reflexive' && value.value.count > 0 && field.def.type === 'TagReflexive') {
        const child = field.def.struct;
        if (!child) continue;
        const size = resolveStruct(child).totalSize;
        const first = resolvePointer(value.value.pointerLow, anchor, base);
        if (!isRangeInBuffer(first, value.value.count * size, buffer.length)) continue;
        for (let i = 0; i < value.value.count; i++) walk(child, first + i * size, anchor, base, `${context}.${field.name}[${i}]`);
      }
    }
  };

  const known = new Set(getAllTagGroupNames());
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioAt = scenario && !scenario.isExternal ? resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress) : null;
  for (const entry of tagIndex.entries) {
    const group = entry.primaryClassName;
    if (!group || !known.has(group) || entry.isExternal) continue;
    const structName = getGroupStructName(group);
    if (!structName) continue;
    if (group === 'scenario_structure_bsp') {
      if (scenarioAt === null) continue;
      const bsp = locateStructureBsp(buffer, tagIndex, scenarioAt, header.tagDataOffset, tagIndex.baseMemoryAddress, entry.tagId);
      if (bsp) walk(structName, bsp.fileOffset, bsp.fileOffsetAnchor, bsp.baseMemoryAddress, `${entry.path}.${group}`);
    } else {
      walk(structName, resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress), header.tagDataOffset, tagIndex.baseMemoryAddress, `${entry.path}.${group}`);
    }
  }
  return issues;
}
