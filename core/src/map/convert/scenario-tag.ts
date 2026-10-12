import { lookupTagClassByName } from '../../constants/tag-classes';
import { parseCacheFileHeader } from '../header';
import type { CacheFileHeader } from '../header';
import { parseTagIndex } from '../tag-index';
import type { TagIndex, TagIndexEntry } from '../tag-index';

/**
 * How the converter finds the scenario: by the tag data header's scenario ID (the full tag ID, salt
 * included), as OpenCE does (port/linux/game/cache_file_formats.c l.2270-2295, OpenCE 6399ed9), never by
 * index 0 or by group. Map protection can give the scenario another group ('ztpt' in HaloMD
 * yoyorastv2_1); OpenCE gives such a tag the scenario group back at load. The converter reads it with
 * the scenario definition and leaves its group in the file as it is (restoring it would strip
 * protection; PRD 2026-10-12, item C).
 *
 * `readScenarioAsScenario` returns the tag index with that one entry's `primaryClassName` set to
 * 'scenario' (a copy; the buffer is not touched). Every converter step that picks a tag's definition by
 * its group goes through it, so the pointer walk, the block check, the repairs and the checks all read
 * the renamed scenario as a scenario.
 */

/** The entry the tag data header's scenario ID names (full tag ID), or null. */
export function scenarioEntryOf(tagIndex: TagIndex): TagIndexEntry | null {
  const entry = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  return entry && entry.tagId >>> 0 === tagIndex.scenarioTagId >>> 0 && !entry.isExternal ? entry : null;
}

/** The scenario entry when its group is not 'scenario' (renamed), else null. */
export function renamedScenarioOf(tagIndex: TagIndex): TagIndexEntry | null {
  const entry = scenarioEntryOf(tagIndex);
  return entry && entry.primaryClassName !== 'scenario' ? entry : null;
}

export function readScenarioAsScenario(tagIndex: TagIndex): TagIndex {
  const renamed = renamedScenarioOf(tagIndex);
  if (!renamed) return tagIndex;
  return { ...tagIndex, entries: tagIndex.entries.map((e) => (e.index === renamed.index ? { ...e, primaryClassName: 'scenario' } : e)) };
}

/** `parseTagIndex`, with the scenario read as a scenario (for the converter only; the CE reader is unchanged). */
export function parseTagIndexForConversion(buffer: Buffer, header: CacheFileHeader = parseCacheFileHeader(buffer)): TagIndex {
  return readScenarioAsScenario(parseTagIndex(buffer, header));
}

/** Tags whose group this build does not know at all (not in the tag class table). The renamed scenario is not one. */
export function unknownGroupEntries(tagIndex: TagIndex): TagIndexEntry[] {
  return tagIndex.entries.filter((e) => !e.primaryClassName || !lookupTagClassByName(e.primaryClassName));
}
