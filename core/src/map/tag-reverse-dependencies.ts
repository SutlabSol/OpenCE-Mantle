import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';
import { resolveStruct, getGroupDefinition, getGroupStructName, isRangeInBuffer, resolvePointer } from './definitions/engine';
import { decodeDependency, decodeReflexive } from './definitions/codec';
import { NULL_TAG_ID } from '../constants/tag-classes';

/** Safety cap on elements walked per reflexive. */
const MAX_ELEMENTS_PER_REFLEXIVE = 4096;

export interface ReferencingTagSummary {
  /** Index in the tag array of the tag that holds the reference. */
  sourceTagIndex: number;
  /** Tag ID of the referencing tag. */
  sourceTagId: number;
  /** File path of the referencing tag. */
  sourcePath: string;
  /** Primary class name of the referencing tag (e.g. "scenario", "weapon"). */
  sourceGroup: string;
  /** Field path inside the referencing tag, e.g. "triggers[0].projectile". */
  fieldPath: string;
}

interface RawReference {
  targetTagId: number;
  fieldPath: string;
}

function walkStructForReferences(
  buffer: Buffer,
  structName: string,
  base: number,
  anchor: number,
  baseMemoryAddress: number,
  prefix: string,
  targetTagId: number | null,
  out: RawReference[],
): void {
  const resolved = resolveStruct(structName);
  if (!isRangeInBuffer(base, resolved.totalSize, buffer.length)) return;
  for (const field of resolved.fields) {
    if (field.def.nonCached) continue;
    const abs = base + field.offset;
    if (field.def.type === 'TagDependency') {
      const dep = decodeDependency(buffer, abs);
      if (dep.tagId !== NULL_TAG_ID && dep.tagId !== 0) {
        if (targetTagId === null || dep.tagId === targetTagId) {
          out.push({ targetTagId: dep.tagId, fieldPath: `${prefix}${field.name}` });
        }
      }
    } else if (field.def.type === 'TagReflexive' && field.def.struct) {
      const refl = decodeReflexive(buffer, abs);
      if (refl.count === 0) continue;
      const childSize = resolveStruct(field.def.struct).totalSize;
      const childBase = resolvePointer(refl.pointerLow, anchor, baseMemoryAddress);
      if (!isRangeInBuffer(childBase, refl.count * childSize, buffer.length)) continue;
      const n = Math.min(refl.count, MAX_ELEMENTS_PER_REFLEXIVE);
      for (let i = 0; i < n; i++) {
        walkStructForReferences(
          buffer,
          field.def.struct,
          childBase + i * childSize,
          anchor,
          baseMemoryAddress,
          `${prefix}${field.name}[${i}].`,
          targetTagId,
          out,
        );
      }
    }
  }
}

/**
 * Finds all tags in the map that have a TagDependency referencing the target tag.
 *
 * @param buffer Map file buffer
 * @param header Parsed cache file header
 * @param tagIndex Parsed tag index
 * @param targetTagIndex Index of the target tag in `tagIndex.entries`
 */
export function findReferencingTags(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  targetTagIndex: number,
): ReferencingTagSummary[] {
  const targetEntry = tagIndex.entries[targetTagIndex];
  if (!targetEntry) return [];
  const targetTagId = targetEntry.tagId;

  const results: ReferencingTagSummary[] = [];

  for (let i = 0; i < tagIndex.entries.length; i++) {
    const entry = tagIndex.entries[i];
    if (entry.isExternal) continue;
    const group = entry.primaryClassName;
    if (!group || !getGroupStructName(group)) continue;
    const def = getGroupDefinition(group);
    if (def.extractable === false) continue;

    const rootOffset = resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const references: RawReference[] = [];
    walkStructForReferences(
      buffer,
      def.name,
      rootOffset,
      header.tagDataOffset,
      tagIndex.baseMemoryAddress,
      '',
      targetTagId,
      references,
    );

    for (const ref of references) {
      results.push({
        sourceTagIndex: i,
        sourceTagId: entry.tagId,
        sourcePath: entry.path,
        sourceGroup: group,
        fieldPath: ref.fieldPath,
      });
    }
  }

  return results;
}
