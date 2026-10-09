import { resolveTagDataPointer } from './tag-index';
import { fourCCFromString } from '../constants/tag-classes';
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';

const SCENARIO_STRUCTURE_BSP_FOURCC = fourCCFromString('sbsp');

/**
 * Estimated on-disk size of each tag's data "footprint": the distance from its resolved
 * file offset to the next (internal) tag's offset, or to the end of the tag data section
 * for the last one.
 *
 * TECHNIQUE SOURCE (cited, not guessed): this is the exact method the OpenCE project uses
 * to compare tag layouts across builds (`tools/custom_edition_tag_footprints.py`,
 * OpenCommunityEdition/OpenCE, CC0): "A tag's footprint is the distance from its address to
 * the next tag's (its structure and the block data after it)."
 * https://github.com/OpenCommunityEdition/OpenCE/blob/master/docs/custom_edition_caches.md
 *
 * This is an ESTIMATE, not an exact tag size (a tag's own trailing reflexive blocks can in
 * principle be interleaved with other tags' data), but it matches how Tool.exe lays out tag
 * data in practice and is good enough for a tag browser's "size" column.
 */
export interface TagFootprint {
  tagIndex: number;
  /** null for external tags AND scenario_structure_bsp tags (see module doc above). */
  estimatedSize: number | null;
}

export function estimateTagFootprints(header: CacheFileHeader, tagIndex: TagIndex): TagFootprint[] {
  const tagDataEnd = header.tagDataOffset + header.tagDataSize;

  const internalOffsets = tagIndex.entries
    .filter((e) => !e.isExternal && e.primaryClassFourCC !== SCENARIO_STRUCTURE_BSP_FOURCC)
    .map((e) => ({
      index: e.index,
      offset: resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress),
    }))
    .sort((a, b) => a.offset - b.offset);

  const footprintByIndex = new Map<number, number>();
  for (let i = 0; i < internalOffsets.length; i++) {
    const next = i + 1 < internalOffsets.length ? internalOffsets[i + 1].offset : tagDataEnd;
    footprintByIndex.set(internalOffsets[i].index, Math.max(0, next - internalOffsets[i].offset));
  }

  return tagIndex.entries.map((e) => ({
    tagIndex: e.index,
    estimatedSize:
      e.isExternal || e.primaryClassFourCC === SCENARIO_STRUCTURE_BSP_FOURCC
        ? null
        : footprintByIndex.get(e.index) ?? null,
  }));
}
