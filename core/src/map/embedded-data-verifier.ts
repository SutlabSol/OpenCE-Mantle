/**
 * Tools > Verify Embedded Data (read-only diagnostic, works on any opened map). For every
 * non-external bitmap/sound tag, reports each pixel/sample data asset as embedded (external=0,
 * lives in this map's own raw-data region) or external (lives in bitmaps.map/sounds.map), and
 * for embedded ones checks offset+size are in bounds, don't overlap each other, and the bytes
 * are actually readable. Reuses `walkDependencies`'s existing per-field embedded/external
 * detection (same decode path the M5 injector's relocation guard uses) rather than
 * re-implementing struct decoding - this file only adds the bounds/overlap/readability checks
 * and the "unrecognized layout -> blocked, never guessed" reporting on top of it.
 *
 * Map-agnostic by construction: every tag of class "bitmap"/"sound" is checked the same way,
 * there is no branching on map name, tag path, or a specific file size anywhere in this file.
 */
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveTagDataPointer } from './tag-index';
import { walkDependencies } from './dependency-walker';
import { resolveStruct, getGroupDefinition, getAllTagGroupNames } from './definitions/engine';

export interface EmbeddedAssetCheck {
  tagPath: string;
  group: string;
  /** Field path within the tag, e.g. `bitmap data[0].pixel data` or `pitch ranges[0].permutations[0].samples`. */
  fieldPath: string;
  location: 'embedded' | 'external';
  /** Only set when `location === 'external'`. */
  resourceMap?: string;
  fileOffset: number;
  size: number;
  inBounds: boolean;
  /** `fieldPath`s of other embedded assets whose byte range overlaps this one. Empty if none. */
  overlapsWith: string[];
  /** Only meaningful for embedded assets - whether the bytes could actually be read from the buffer. */
  readable: boolean;
}

export interface BlockedBitmapSoundTag {
  tagPath: string;
  group: string;
  reason: string;
}

export interface EmbeddedDataReport {
  totalBitmapSoundTags: number;
  checkedTags: number;
  blockedTags: BlockedBitmapSoundTag[];
  assets: EmbeddedAssetCheck[];
  counts: {
    embedded: number;
    external: number;
    embeddedInBounds: number;
    embeddedOutOfBounds: number;
    overlapping: number;
    unreadable: number;
    blockedTags: number;
  };
}

/** Byte ranges `[offset, offset+size)` overlap iff each starts before the other ends. */
export function rangesOverlap(aOffset: number, aSize: number, bOffset: number, bSize: number): boolean {
  return aOffset < bOffset + bSize && bOffset < aOffset + aSize;
}

export function verifyEmbeddedData(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): EmbeddedDataReport {
  const knownGroups = new Set(getAllTagGroupNames());
  const candidates = tagIndex.entries.filter((e) => !e.isExternal && (e.primaryClassName === 'bitmap' || e.primaryClassName === 'sound'));

  const blockedTags: BlockedBitmapSoundTag[] = [];
  const checkedIndices: number[] = [];

  for (const e of candidates) {
    const group = e.primaryClassName!;
    if (!knownGroups.has(group)) {
      blockedTags.push({ tagPath: e.path, group, reason: 'Unrecognized tag class - no definition registered. Not guessed.' });
      continue;
    }
    const structName = getGroupDefinition(group).name;
    const resolved = resolveStruct(structName);
    const fileOffset = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    if (fileOffset < 0 || fileOffset + resolved.totalSize > buffer.length) {
      blockedTags.push({
        tagPath: e.path,
        group,
        reason: `The tag's own struct resolves outside this file (offset ${fileOffset}, ${resolved.totalSize} bytes, file is ${buffer.length} bytes) - cannot read it safely, not guessed.`,
      });
      continue;
    }
    checkedIndices.push(e.index);
  }

  const walk = checkedIndices.length > 0 ? walkDependencies(buffer, header, tagIndex, checkedIndices) : { tags: [], externalTags: [], warnings: [] };

  for (const t of [...walk.tags, ...walk.externalTags]) {
    if (t.status !== 'ok') {
      blockedTags.push({ tagPath: t.path, group: t.group, reason: `Unexpected tag status "${t.status}" for a bitmap/sound tag - treated as unrecognized, not guessed.` });
    }
  }
  for (const w of walk.warnings) {
    if (w.kind === 'invalidReflexive') {
      const entry = candidates.find((e) => e.index === w.originalIndex);
      blockedTags.push({ tagPath: entry?.path ?? `tag #${w.originalIndex}`, group: entry?.primaryClassName ?? '', reason: `${w.message} Not guessed.` });
    }
  }

  const assets: EmbeddedAssetCheck[] = [];
  for (const w of walk.warnings) {
    if (w.kind !== 'embeddedRawData' && w.kind !== 'externalData') continue;
    const entry = candidates.find((e) => e.index === w.originalIndex);
    const fileOffset = w.fileOffset ?? 0;
    const size = w.size ?? 0;
    // Bounds only mean something for embedded data (it's an offset into THIS map's own buffer).
    // An external field's offset is into a different file (bitmaps.map/sounds.map) that may not
    // even be configured/open here - never bounds-checked against this map's buffer.
    const inBounds = w.kind === 'embeddedRawData' ? fileOffset >= 0 && size >= 0 && fileOffset + size <= buffer.length : true;
    let readable = false;
    if (w.kind === 'embeddedRawData' && inBounds) {
      try {
        readable = buffer.subarray(fileOffset, fileOffset + size).length === size;
      } catch {
        readable = false;
      }
    }
    assets.push({
      tagPath: entry?.path ?? `tag #${w.originalIndex}`,
      group: entry?.primaryClassName ?? '',
      fieldPath: w.path,
      location: w.kind === 'embeddedRawData' ? 'embedded' : 'external',
      resourceMap: w.resourceMap,
      fileOffset,
      size,
      inBounds,
      overlapsWith: [],
      // External bytes live in a different file (bitmaps.map/sounds.map) not necessarily open
      // here - readability of those is a separate, already-existing fingerprint check
      // (resource-map.ts), not re-done here.
      readable: w.kind === 'embeddedRawData' ? readable : true,
    });
  }

  const embedded = assets.filter((a) => a.location === 'embedded' && a.inBounds);
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      if (rangesOverlap(embedded[i].fileOffset, embedded[i].size, embedded[j].fileOffset, embedded[j].size)) {
        embedded[i].overlapsWith.push(`${embedded[j].tagPath} ${embedded[j].fieldPath}`);
        embedded[j].overlapsWith.push(`${embedded[i].tagPath} ${embedded[i].fieldPath}`);
      }
    }
  }

  return {
    totalBitmapSoundTags: candidates.length,
    checkedTags: checkedIndices.length,
    blockedTags,
    assets,
    counts: {
      embedded: assets.filter((a) => a.location === 'embedded').length,
      external: assets.filter((a) => a.location === 'external').length,
      embeddedInBounds: assets.filter((a) => a.location === 'embedded' && a.inBounds).length,
      embeddedOutOfBounds: assets.filter((a) => a.location === 'embedded' && !a.inBounds).length,
      overlapping: assets.filter((a) => a.overlapsWith.length > 0).length,
      unreadable: assets.filter((a) => a.location === 'embedded' && a.inBounds && !a.readable).length,
      blockedTags: blockedTags.length,
    },
  };
}

/** Plain-language report, grouped and formatted for the GUI's "Copy report" button. */
export function formatEmbeddedDataReport(report: EmbeddedDataReport, mapLabel: string): string {
  const lines: string[] = [
    `Embedded data verification - "${mapLabel}"`,
    `${report.totalBitmapSoundTags} bitmap/sound tags total, ${report.checkedTags} checked, ${report.blockedTags.length} blocked.`,
    `${report.counts.embedded} embedded asset(s), ${report.counts.external} external (resource-map) asset(s).`,
    `Embedded: ${report.counts.embeddedInBounds} in bounds, ${report.counts.embeddedOutOfBounds} OUT OF BOUNDS, ${report.counts.overlapping} overlapping, ${report.counts.unreadable} unreadable.`,
    '',
  ];
  if (report.blockedTags.length > 0) {
    lines.push('BLOCKED (unrecognized layout - not guessed):');
    for (const b of report.blockedTags) lines.push(`  "${b.tagPath}" (${b.group || 'unknown'}) - ${b.reason}`);
    lines.push('');
  }
  const problems = report.assets.filter((a) => !a.inBounds || a.overlapsWith.length > 0 || (a.location === 'embedded' && !a.readable));
  if (problems.length > 0) {
    lines.push('PROBLEMS FOUND:');
    for (const a of problems) {
      const issues: string[] = [];
      if (!a.inBounds) issues.push('OUT OF BOUNDS');
      if (a.location === 'embedded' && !a.readable) issues.push('UNREADABLE');
      if (a.overlapsWith.length > 0) issues.push(`overlaps with: ${a.overlapsWith.join(', ')}`);
      lines.push(`  "${a.tagPath}" ${a.fieldPath} (${a.location}, offset ${a.fileOffset}, ${a.size} bytes) - ${issues.join('; ')}`);
    }
    lines.push('');
  } else if (report.checkedTags > 0) {
    lines.push('No bounds, overlap, or readability problems found among the checked assets.');
    lines.push('');
  }
  if (report.counts.embedded === 0) {
    lines.push('No embedded (external=0) bitmap/sound data in this map - everything routes through bitmaps.map/sounds.map.');
  }
  return lines.join('\n');
}
