import * as fs from 'fs';
import * as path from 'path';
import {
  fourCCFromString,
  lookupTagClass,
  lookupTagClassByName,
  NULL_TAG_ID,
} from '../constants/tag-classes';
import { parseCacheFileHeader, type CacheFileHeader } from './header';
import { parseTagIndex, resolveTagDataPointer, type TagIndex } from './tag-index';
import {
  getAllTagGroupNames,
  getGroupDefinition,
  resolveStruct,
  isRangeInBuffer,
} from './definitions/engine';
import {
  readTagFieldValues,
  writeTagFieldValue,
  addReflexiveChunk,
  type TagFieldDescriptor,
  type TagFieldsResult,
  type TagReflexiveElement,
} from './tag-field-editor';
import {
  listTagDependencySlots,
  setTagDependencySlot,
} from './tag-dependency-swapper';
import { renameTagInMap } from './tag-index-editor';
import {
  inspectBlamLooseTagHeader,
  parseHekLooseTagBuffer,
  serializeContainerTagToHekLooseBuffer,
} from './legacy-tag-codec';
import {
  compareTagFieldListsSemantically,
  normalizeComparePath,
  type MapDifferenceRow,
} from './map-compare';
import type { UnicodeStringListResult } from './unicode-string-editor';

/* ============================================================================
 * 1. LOOSE `tags/` WORKSPACE & INCREMENTAL INDEXER + IN-PLACE BLAM TAG EDITING
 * ============================================================================ */

export interface LooseTagDependencyRef {
  fieldPath: string;
  group: string;
  path: string;
  targetKey: string;
}

export interface LooseWorkspaceTagEntry {
  /** Canonical lookup key: `<group>:<normalized_tag_path>` */
  key: string;
  /** Relative file path inside `tags/` directory (e.g. `weapons/pistol/pistol.weapon`) */
  relativePath: string;
  /** Blam tag path without extension (e.g. `weapons\pistol\pistol`) */
  tagPath: string;
  /** Full tag group name (e.g. `weapon`) */
  group: string;
  /** 4-char FourCC string (e.g. `weap`) */
  groupFourCC: string;
  /** Absolute path on disk */
  filePath: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp in ms */
  mtimeMs: number;
  /** Header format (`classic_blam_be`, `gen3_malb_le`, `gen3_blam_be`) */
  headerFormat: 'classic_blam_be' | 'gen3_malb_le' | 'gen3_blam_be';
  /** Outgoing tag dependencies */
  dependencies: LooseTagDependencyRef[];
}

export interface BrokenLooseTagDependency {
  sourceKey: string;
  sourceTagPath: string;
  sourceGroup: string;
  fieldPath: string;
  targetGroup: string;
  targetPath: string;
}

export interface LooseTagsWorkspaceIndex {
  tagsDir: string;
  scannedAt: string;
  entries: LooseWorkspaceTagEntry[];
  /** Forward dependencies: `sourceKey -> LooseTagDependencyRef[]` */
  dependenciesBySourceKey: Record<string, LooseTagDependencyRef[]>;
  /** Reverse dependencies: `targetKey -> Array<{ sourceKey, sourceTagPath, sourceGroup, fieldPath }>` */
  dependentsByTargetKey: Record<
    string,
    Array<{ sourceKey: string; sourceTagPath: string; sourceGroup: string; fieldPath: string }>
  >;
  brokenDependencies: BrokenLooseTagDependency[];
  unreferencedTagKeys: string[];
}

export function makeLooseTagKey(group: string, tagPath: string): string {
  return `${group.trim().toLowerCase()}:${normalizeComparePath(tagPath)}`;
}

/**
 * Scans a standard Blam `tags/` directory on disk, reusing unchanged `(size, mtimeMs)` entries
 * from `previousIndex` when provided, and builds forward + reverse dependency graphs, broken reference
 * diagnostics, and unreferenced tag lists.
 */
export function scanLooseTagsWorkspace(
  tagsDir: string,
  previousIndex?: LooseTagsWorkspaceIndex,
): LooseTagsWorkspaceIndex {
  const resolvedRoot = path.resolve(tagsDir);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Tags directory does not exist: ${resolvedRoot}`);
  }

  const validGroups = new Set(getAllTagGroupNames());
  const prevByFilePath = new Map<string, LooseWorkspaceTagEntry>();
  if (previousIndex && path.resolve(previousIndex.tagsDir) === resolvedRoot) {
    for (const e of previousIndex.entries) {
      prevByFilePath.set(path.resolve(e.filePath), e);
    }
  }

  const entries: LooseWorkspaceTagEntry[] = [];

  const walk = (dir: string) => {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirEntries) {
      if (d.name.startsWith('.')) continue;
      const fullPath = path.join(dir, d.name);
      if (d.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!d.isFile()) continue;

      const ext = path.extname(d.name).slice(1).toLowerCase();
      if (['xml', 'meta', 'json', 'txt', 'md', 'png', 'jpg', 'wav', 'jms', 'jma', 'hsc', 'csv', 'bak'].includes(ext)) {
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size < 64) continue;

      const prev = prevByFilePath.get(path.resolve(fullPath));
      if (prev && prev.size === stat.size && Math.abs(prev.mtimeMs - stat.mtimeMs) < 1) {
        entries.push(prev);
        continue;
      }

      try {
        const buf = fs.readFileSync(fullPath);
        const hdr = inspectBlamLooseTagHeader(buf);
        if (!hdr) continue;

        const group = validGroups.has(ext) ? ext : hdr.groupName;
        const relFile = path.relative(resolvedRoot, fullPath);
        const relNoExt = relFile.slice(0, relFile.length - path.extname(relFile).length);
        const tagPath = relNoExt.replace(/\//g, '\\');
        const key = makeLooseTagKey(group, tagPath);

        const dependencies: LooseTagDependencyRef[] = [];
        if (hdr.format === 'classic_blam_be' && validGroups.has(group) && group !== 'scenario_structure_bsp') {
          try {
            const parsed = parseHekLooseTagBuffer(buf, tagPath, group);
            for (const dep of parsed.referencedDeps) {
              if (!dep.path) continue;
              dependencies.push({
                fieldPath: dep.fieldPath,
                group: dep.group,
                path: dep.path,
                targetKey: makeLooseTagKey(dep.group, dep.path),
              });
            }
          } catch {
            // Keep header-indexed entry even if deep struct walk fails on a custom/corrupt tag
          }
        }

        entries.push({
          key,
          relativePath: relFile.replace(/\\/g, '/'),
          tagPath,
          group,
          groupFourCC: hdr.groupFourCC,
          filePath: fullPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          headerFormat: hdr.format,
          dependencies,
        });
      } catch {
        // Ignore unreadable file
      }
    }
  };

  walk(resolvedRoot);
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const entryByKey = new Map<string, LooseWorkspaceTagEntry>();
  for (const e of entries) {
    entryByKey.set(e.key, e);
  }

  const dependenciesBySourceKey: LooseTagsWorkspaceIndex['dependenciesBySourceKey'] = {};
  const dependentsByTargetKey: LooseTagsWorkspaceIndex['dependentsByTargetKey'] = {};
  const brokenDependencies: BrokenLooseTagDependency[] = [];

  for (const e of entries) {
    dependenciesBySourceKey[e.key] = e.dependencies;
    for (const dep of e.dependencies) {
      if (!dependentsByTargetKey[dep.targetKey]) {
        dependentsByTargetKey[dep.targetKey] = [];
      }
      dependentsByTargetKey[dep.targetKey]!.push({
        sourceKey: e.key,
        sourceTagPath: e.tagPath,
        sourceGroup: e.group,
        fieldPath: dep.fieldPath,
      });

      if (!entryByKey.has(dep.targetKey)) {
        brokenDependencies.push({
          sourceKey: e.key,
          sourceTagPath: e.tagPath,
          sourceGroup: e.group,
          fieldPath: dep.fieldPath,
          targetGroup: dep.group,
          targetPath: dep.path,
        });
      }
    }
  }

  const rootGroups = new Set(['scenario', 'globals', 'tag_collection', 'ui_widget_collection']);
  const unreferencedTagKeys = entries
    .filter((e) => !rootGroups.has(e.group) && (!dependentsByTargetKey[e.key] || dependentsByTargetKey[e.key]!.length === 0))
    .map((e) => e.key);

  return {
    tagsDir: resolvedRoot,
    scannedAt: new Date().toISOString(),
    entries,
    dependenciesBySourceKey,
    dependentsByTargetKey,
    brokenDependencies,
    unreferencedTagKeys,
  };
}

/**
 * Synthesizes a minimal in-memory single-tag `.map` cache wrapper around a parsed `OceContainerTag`
 * so Mantle's `readTagFieldValues` and `writeTagFieldValue` work identically on 64-byte `'blam'`
 * loose tag files and `.map` cache tags!
 */
function buildSyntheticSingleTagCacheFromBlamBuffer(
  blamBuffer: Buffer,
  tagPath: string,
  overrideGroup?: string,
): {
  parsed: ReturnType<typeof parseHekLooseTagBuffer>;
  cacheBuffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
} {
  const parsed = parseHekLooseTagBuffer(blamBuffer, tagPath, overrideGroup);
  const tagDataBuf = Buffer.from(parsed.tag.data, 'base64');
  const baseMemoryAddress = 0x40440000;
  const tagDataOffset = 2048;

  // Build synthetic tag index: entry 0 is the root tag, entries 1..N are its unique referenced dependencies
  const uniqueDeps: Array<{ group: string; path: string; fourCC: number; tagId: number }> = [];
  const depIndexByKey = new Map<string, number>();

  for (const dep of parsed.referencedDeps) {
    const k = `${dep.group}:${dep.path.toLowerCase()}`;
    if (!depIndexByKey.has(k)) {
      const idx = uniqueDeps.length + 1;
      const cls = lookupTagClassByName(dep.group);
      const fourCC = cls ? fourCCFromString(cls.groupId) : fourCCFromString('none');
      const tagId = ((0xe174 + idx) << 16) | idx;
      uniqueDeps.push({ group: dep.group, path: dep.path, fourCC, tagId });
      depIndexByKey.set(k, idx);
    }
  }

  const totalEntries = 1 + uniqueDeps.length;
  const tagHeaderSize = 0x28;
  const entriesSize = totalEntries * 32;

  const pathStrings: Buffer[] = [];
  const pathOffsets: number[] = [];
  let runningPathBytes = 0;
  const allPaths = [tagPath, ...uniqueDeps.map((d) => d.path)];
  for (const p of allPaths) {
    pathOffsets.push(runningPathBytes);
    const b = Buffer.from(`${p}\0`, 'latin1');
    pathStrings.push(b);
    runningPathBytes += b.length;
  }
  const pathsPad = (4 - (runningPathBytes % 4)) % 4;
  if (pathsPad > 0) {
    pathStrings.push(Buffer.alloc(pathsPad, 0));
    runningPathBytes += pathsPad;
  }

  const rootDataOffsetInTagSection = tagHeaderSize + entriesSize + runningPathBytes;
  const rootVirtualPtr = baseMemoryAddress + rootDataOffsetInTagSection;

  // Rebase internal reflexive pointers and dependency tagIds inside tagDataBuf
  const workingTagData = Buffer.from(tagDataBuf);
  const rebaseReflexives = (structName: string, baseOff: number, count: number, depth: number) => {
    if (depth > 16) return;
    let structDef;
    try {
      structDef = resolveStruct(structName);
    } catch {
      return;
    }
    for (let i = 0; i < count; i++) {
      const elemOff = baseOff + i * structDef.totalSize;
      if (elemOff + structDef.totalSize > workingTagData.length) break;
      for (const f of structDef.fields) {
        if (f.def.type === 'TagReflexive' && f.def.struct) {
          const rCount = workingTagData.readUInt32LE(elemOff + f.offset);
          const rLocalOff = workingTagData.readUInt32LE(elemOff + f.offset + 4);
          if (rCount > 0 && rLocalOff > 0 && rLocalOff < workingTagData.length) {
            workingTagData.writeUInt32LE(rootVirtualPtr + rLocalOff, elemOff + f.offset + 4);
            rebaseReflexives(f.def.struct, rLocalOff, rCount, depth + 1);
          } else {
            workingTagData.writeUInt32LE(0, elemOff + f.offset + 4);
          }
        }
      }
    }
  };
  rebaseReflexives(parsed.tag.structName, 0, 1, 0);

  for (const dep of parsed.referencedDeps) {
    const k = `${dep.group}:${dep.path.toLowerCase()}`;
    const targetIdx = depIndexByKey.get(k);
    if (targetIdx !== undefined && dep.fieldOffset + 16 <= workingTagData.length) {
      const targetDep = uniqueDeps[targetIdx - 1]!;
      const pathPtr = baseMemoryAddress + tagHeaderSize + entriesSize + pathOffsets[targetIdx]!;
      workingTagData.writeUInt32LE(targetDep.fourCC, dep.fieldOffset + 0);
      workingTagData.writeUInt32LE(pathPtr, dep.fieldOffset + 4);
      workingTagData.writeUInt32LE(0, dep.fieldOffset + 8);
      workingTagData.writeUInt32LE(targetDep.tagId, dep.fieldOffset + 12);
    }
  }

  const tagDataSectionSize = rootDataOffsetInTagSection + workingTagData.length;
  const totalFileSize = tagDataOffset + tagDataSectionSize;
  const cacheBuffer = Buffer.alloc(totalFileSize, 0);

  // Write cache header
  cacheBuffer.writeUInt32LE(0x68656164, 0x00); // 'head'
  cacheBuffer.writeUInt32LE(609, 0x04); // Custom Edition
  cacheBuffer.writeUInt32LE(totalFileSize, 0x08);
  cacheBuffer.writeUInt32LE(tagDataOffset, 0x10);
  cacheBuffer.writeUInt32LE(tagDataSectionSize, 0x14);
  cacheBuffer.write('blam_loose_tag', 0x20, 'latin1');
  cacheBuffer.write('01.00.00.0609', 0x40, 'latin1');
  cacheBuffer.writeUInt32LE(0x666f6f74, 0x7fc); // 'foot'

  // Write tag data header
  const indexArrayPtr = baseMemoryAddress + tagHeaderSize;
  cacheBuffer.writeUInt32LE(indexArrayPtr, tagDataOffset + 0x00);
  cacheBuffer.writeUInt32LE(0xe1740000, tagDataOffset + 0x04); // scenarioTagId
  cacheBuffer.writeUInt32LE(0, tagDataOffset + 0x08);
  cacheBuffer.writeUInt32LE(totalEntries, tagDataOffset + 0x0c);
  cacheBuffer.writeUInt32LE(0, tagDataOffset + 0x10);
  cacheBuffer.writeUInt32LE(0, tagDataOffset + 0x14);
  cacheBuffer.writeUInt32LE(0, tagDataOffset + 0x18);
  cacheBuffer.writeUInt32LE(0, tagDataOffset + 0x1c);
  cacheBuffer.writeUInt32LE(0, tagDataOffset + 0x20);
  cacheBuffer.writeUInt32LE(0x74616773, tagDataOffset + 0x24); // 'tags'

  // Write tag index entry 0 (root tag)
  const rootCls = lookupTagClassByName(parsed.tag.group);
  const rootFourCC = rootCls ? fourCCFromString(rootCls.groupId) : fourCCFromString('none');
  const entry0Off = tagDataOffset + tagHeaderSize;
  cacheBuffer.writeUInt32LE(rootFourCC, entry0Off + 0x00);
  cacheBuffer.writeUInt32LE(0xffffffff, entry0Off + 0x04);
  cacheBuffer.writeUInt32LE(0xffffffff, entry0Off + 0x08);
  cacheBuffer.writeUInt32LE(0xe1740000, entry0Off + 0x0c);
  cacheBuffer.writeUInt32LE(baseMemoryAddress + tagHeaderSize + entriesSize + pathOffsets[0]!, entry0Off + 0x10);
  cacheBuffer.writeUInt32LE(rootVirtualPtr, entry0Off + 0x14);
  cacheBuffer.writeUInt32LE(0, entry0Off + 0x18);
  cacheBuffer.writeUInt32LE(0, entry0Off + 0x1c);

  // Write dependency entries 1..N
  for (let i = 0; i < uniqueDeps.length; i++) {
    const dep = uniqueDeps[i]!;
    const idx = i + 1;
    const eOff = tagDataOffset + tagHeaderSize + idx * 32;
    cacheBuffer.writeUInt32LE(dep.fourCC, eOff + 0x00);
    cacheBuffer.writeUInt32LE(0xffffffff, eOff + 0x04);
    cacheBuffer.writeUInt32LE(0xffffffff, eOff + 0x08);
    cacheBuffer.writeUInt32LE(dep.tagId, eOff + 0x0c);
    cacheBuffer.writeUInt32LE(baseMemoryAddress + tagHeaderSize + entriesSize + pathOffsets[idx]!, eOff + 0x10);
    cacheBuffer.writeUInt32LE(0, eOff + 0x14);
    cacheBuffer.writeUInt32LE(1, eOff + 0x18); // external placeholder
    cacheBuffer.writeUInt32LE(0, eOff + 0x1c);
  }

  // Write paths
  Buffer.concat(pathStrings).copy(cacheBuffer, tagDataOffset + tagHeaderSize + entriesSize);

  // Write root tag data
  workingTagData.copy(cacheBuffer, tagDataOffset + rootDataOffsetInTagSection);

  const header = parseCacheFileHeader(cacheBuffer);
  const tagIndex = parseTagIndex(cacheBuffer, header);

  return { parsed, cacheBuffer, header, tagIndex };
}

/**
 * Reads and decodes all root + nested reflexive fields from a 64-byte `'blam'` loose tag buffer
 * into the standard `TagFieldsResult` used by Mantle's Tag Field Editor.
 */
export function readLooseBlamTagFields(
  blamBuffer: Buffer,
  tagPath: string,
  overrideGroup?: string,
): TagFieldsResult {
  const { cacheBuffer, header, tagIndex } = buildSyntheticSingleTagCacheFromBlamBuffer(
    blamBuffer,
    tagPath,
    overrideGroup,
  );
  return readTagFieldValues(cacheBuffer, header, tagIndex, 0);
}

/**
 * Updates a single root or nested reflexive field inside a 64-byte `'blam'` loose tag buffer
 * and returns the newly serialized 64-byte `'blam'` loose tag buffer.
 */
export function writeLooseBlamTagFieldValue(
  blamBuffer: Buffer,
  tagPath: string,
  fieldPath: string,
  newValue: unknown,
  overrideGroup?: string,
): { buffer: Buffer; fields: TagFieldsResult } {
  const { parsed, cacheBuffer, header, tagIndex } = buildSyntheticSingleTagCacheFromBlamBuffer(
    blamBuffer,
    tagPath,
    overrideGroup,
  );
  const writeRes = writeTagFieldValue(cacheBuffer, header, tagIndex, 0, fieldPath, newValue);

  // Copy the modified bytes back into parsed.tag.data at the corresponding local offset
  const rootFileOffset = resolveTagDataPointer(
    tagIndex.entries[0]!.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );
  const localFieldOffset = writeRes.fieldOffset - rootFileOffset;
  const rawTagData = Buffer.from(parsed.tag.data, 'base64');

  // If the edited field was a TagDependency and newValue was a string `{ group, path }` or path string,
  // update parsed.tag.dependencies; otherwise copy scalar bytes directly.
  if (
    typeof newValue === 'object' &&
    newValue !== null &&
    'path' in newValue &&
    typeof (newValue as { path: string }).path === 'string'
  ) {
    const depObj = newValue as { group?: string; path: string };
    const fullDepPath = `${tagPath}.${fieldPath}`;
    const existingDep = parsed.tag.dependencies.find(
      (d) => d.fieldPath === fullDepPath || d.fieldOffset === localFieldOffset,
    );
    if (existingDep) {
      existingDep.path = depObj.path;
      if (depObj.group) existingDep.group = depObj.group;
    } else if (depObj.path) {
      parsed.tag.dependencies.push({
        fieldPath: fullDepPath,
        fieldOffset: localFieldOffset,
        kind: 'external',
        group: depObj.group ?? parsed.tag.group,
        path: depObj.path,
      });
    }
  } else {
    const modifiedRootSlice = cacheBuffer.subarray(rootFileOffset, rootFileOffset + rawTagData.length);
    // Preserve local reflexive offsets in rawTagData while copying the edited field's bytes
    const copyLen = Math.min(32, rawTagData.length - localFieldOffset);
    if (localFieldOffset >= 0 && copyLen > 0) {
      modifiedRootSlice.copy(rawTagData, localFieldOffset, localFieldOffset, localFieldOffset + copyLen);
    }
    parsed.tag.data = rawTagData.toString('base64');
  }

  // Ensure dependencies array is populated from referencedDeps for re-serialization
  if (parsed.tag.dependencies.length === 0 && parsed.referencedDeps.length > 0) {
    parsed.tag.dependencies = parsed.referencedDeps.map((d) => ({
      fieldPath: d.fieldPath,
      fieldOffset: d.fieldOffset,
      kind: 'external',
      group: d.group,
      path: d.path,
    }));
  }

  const newBlamBuffer = serializeContainerTagToHekLooseBuffer(parsed.tag);
  const updatedFields = readLooseBlamTagFields(newBlamBuffer, tagPath, overrideGroup);
  return { buffer: newBlamBuffer, fields: updatedFields };
}

/**
 * Compares two 64-byte `'blam'` loose tag buffers semantically using Baboon's 3-tier
 * `alignByIdentity` + `alignByContent` reflexive block alignment.
 */
export function compareBlamLooseTagBuffers(
  leftBlamBuffer: Buffer,
  rightBlamBuffer: Buffer,
  tagPath: string,
  overrideGroup?: string,
): MapDifferenceRow[] {
  const leftFields = readLooseBlamTagFields(leftBlamBuffer, tagPath, overrideGroup);
  const rightFields = readLooseBlamTagFields(rightBlamBuffer, tagPath, overrideGroup);
  const rows: MapDifferenceRow[] = [];
  const subject = `${tagPath}.${leftFields.group}`;

  compareTagFieldListsSemantically(
    leftFields.fields,
    rightFields.fields,
    (property, before, after, status = 'changed', detail) => {
      rows.push({
        id: `blam:${rows.length}`,
        category: leftFields.group,
        status,
        subject,
        property,
        before,
        after,
        detail,
      });
    },
  );
  return rows;
}

/* ============================================================================
 * 2. CONTENT EXPLORER, AUTO-FIX BROKEN DEPENDENCIES & TAG/FOLDER REFACTORING
 * ============================================================================ */

export interface ContentExplorerRelationItem {
  tagIndex: number | null;
  tagId: number | null;
  path: string;
  group: string;
  fieldPath: string;
  isExternal: boolean;
  isBroken: boolean;
}

export interface ContentExplorerNodeResult {
  tagIndex: number;
  tagId: number;
  path: string;
  group: string;
  referencedBy: ContentExplorerRelationItem[];
  references: ContentExplorerRelationItem[];
}

/**
 * Builds the two-column Baboon Content Explorer view (`Referenced by (Parents)` vs `References (Children)`)
 * for a tag in an open `.map` buffer, including exact `fieldPath` metadata for Reference Jump.
 */
export function inspectContentExplorerNodeInMap(
  buffer: Buffer,
  tagEntryIndex: number,
): ContentExplorerNodeResult {
  const header = parseCacheFileHeader(buffer);
  const tagIndex = parseTagIndex(buffer, header);
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry) {
    throw new Error(`Tag #${tagEntryIndex} not found in map.`);
  }

  const byTagId = new Map<number, (typeof tagIndex.entries)[number]>();
  for (const e of tagIndex.entries) {
    byTagId.set(e.tagId, e);
  }

  const references: ContentExplorerRelationItem[] = [];
  if (!entry.isExternal && entry.primaryClassName !== 'scenario_structure_bsp') {
    try {
      const slots = listTagDependencySlots(buffer, header, tagIndex, tagEntryIndex);
      for (const slot of slots) {
        if (slot.currentTagId === NULL_TAG_ID) continue;
        const targetEntry = byTagId.get(slot.currentTagId);
        references.push({
          tagIndex: targetEntry ? targetEntry.index : null,
          tagId: slot.currentTagId,
          path: slot.currentPath ?? targetEntry?.path ?? `Unknown (0x${slot.currentTagId.toString(16)})`,
          group: slot.currentGroup ?? targetEntry?.primaryClassName ?? '',
          fieldPath: slot.fieldPath,
          isExternal: Boolean(targetEntry?.isExternal),
          isBroken: !targetEntry,
        });
      }
    } catch {
      // Ignore unwalkable tags
    }
  }

  const referencedBy: ContentExplorerRelationItem[] = [];
  for (let i = 0; i < tagIndex.entries.length; i++) {
    if (i === tagEntryIndex) continue;
    const other = tagIndex.entries[i]!;
    if (other.isExternal || !other.primaryClassName || other.primaryClassName === 'scenario_structure_bsp') {
      continue;
    }
    try {
      const slots = listTagDependencySlots(buffer, header, tagIndex, i);
      for (const slot of slots) {
        if (slot.currentTagId === entry.tagId) {
          referencedBy.push({
            tagIndex: other.index,
            tagId: other.tagId,
            path: other.path,
            group: other.primaryClassName,
            fieldPath: slot.fieldPath,
            isExternal: other.isExternal,
            isBroken: false,
          });
        }
      }
    } catch {
      // Ignore unwalkable tags
    }
  }

  return {
    tagIndex: entry.index,
    tagId: entry.tagId,
    path: entry.path,
    group: entry.primaryClassName ?? 'unknown',
    referencedBy,
    references,
  };
}

export interface AutoFixDependenciesReport {
  fixed: Array<{
    sourceTagIndex?: number;
    sourcePath: string;
    sourceGroup: string;
    fieldPath: string;
    oldTargetPath: string;
    newTargetPath: string;
    targetGroup: string;
  }>;
  ambiguous: Array<{
    sourcePath: string;
    fieldPath: string;
    oldTargetPath: string;
    targetGroup: string;
    candidatePaths: string[];
  }>;
  notFound: Array<{
    sourcePath: string;
    fieldPath: string;
    oldTargetPath: string;
    targetGroup: string;
  }>;
}

/**
 * Baboon `fix_tag_dependencies` for an open `.map`:
 * Scans broken or relocated `TagDependency` slots in `targetTagEntryIndex` (or across all tags if omitted),
 * matches by `(group, leaf_filename)` across the map's tag index, and rewires unique matches automatically.
 */
export function fixBrokenTagDependenciesInMap(
  buffer: Buffer,
  targetTagEntryIndex?: number,
): AutoFixDependenciesReport {
  const header = parseCacheFileHeader(buffer);
  const tagIndex = parseTagIndex(buffer, header);

  // Build lookup: `${group}:${leafNameLower}` -> TagIndexEntry[]
  const byGroupAndLeaf = new Map<string, typeof tagIndex.entries>();
  for (const e of tagIndex.entries) {
    if (!e.primaryClassName || e.tagId === NULL_TAG_ID) continue;
    const leaf = e.path.replace(/\//g, '\\').split('\\').pop()?.toLowerCase() ?? '';
    if (!leaf) continue;
    const k = `${e.primaryClassName.toLowerCase()}:${leaf}`;
    const list = byGroupAndLeaf.get(k);
    if (list) list.push(e);
    else byGroupAndLeaf.set(k, [e]);
  }

  const indicesToScan =
    targetTagEntryIndex !== undefined
      ? [targetTagEntryIndex]
      : tagIndex.entries.map((e) => e.index);

  const fixed: AutoFixDependenciesReport['fixed'] = [];
  const ambiguous: AutoFixDependenciesReport['ambiguous'] = [];
  const notFound: AutoFixDependenciesReport['notFound'] = [];

  const byTagId = new Map<number, (typeof tagIndex.entries)[number]>();
  for (const e of tagIndex.entries) {
    byTagId.set(e.tagId, e);
  }

  for (const idx of indicesToScan) {
    const entry = tagIndex.entries[idx];
    if (!entry || entry.isExternal || !entry.primaryClassName || entry.primaryClassName === 'scenario_structure_bsp') {
      continue;
    }
    let slots;
    try {
      slots = listTagDependencySlots(buffer, header, tagIndex, idx);
    } catch {
      continue;
    }

    for (const slot of slots) {
      if (slot.currentTagId === NULL_TAG_ID) continue;
      const targetEntry = byTagId.get(slot.currentTagId);
      const isBrokenTagId = !targetEntry;
      if (!isBrokenTagId) continue;

      const brokenPath = slot.currentPath || '';
      const leaf = brokenPath.replace(/\//g, '\\').split('\\').pop()?.toLowerCase() ?? '';
      const groupCandidates =
        slot.currentGroup
          ? [slot.currentGroup]
          : slot.allowedClasses.length > 0
            ? slot.allowedClasses
            : [];

      if (!leaf || groupCandidates.length === 0) {
        notFound.push({
          sourcePath: entry.path,
          fieldPath: slot.fieldPath,
          oldTargetPath: brokenPath || `0x${slot.currentTagId.toString(16)}`,
          targetGroup: groupCandidates[0] ?? 'unknown',
        });
        continue;
      }

      const matches: typeof tagIndex.entries = [];
      for (const g of groupCandidates) {
        const found = byGroupAndLeaf.get(`${g.toLowerCase()}:${leaf}`);
        if (found) matches.push(...found);
      }

      if (matches.length === 1) {
        const match = matches[0]!;
        setTagDependencySlot(buffer, header, tagIndex, idx, slot.fieldPath, match.tagId);
        fixed.push({
          sourceTagIndex: idx,
          sourcePath: entry.path,
          sourceGroup: entry.primaryClassName,
          fieldPath: slot.fieldPath,
          oldTargetPath: brokenPath || `0x${slot.currentTagId.toString(16)}`,
          newTargetPath: match.path,
          targetGroup: match.primaryClassName ?? groupCandidates[0]!,
        });
      } else if (matches.length > 1) {
        ambiguous.push({
          sourcePath: entry.path,
          fieldPath: slot.fieldPath,
          oldTargetPath: brokenPath,
          targetGroup: groupCandidates[0]!,
          candidatePaths: matches.map((m) => m.path),
        });
      } else {
        notFound.push({
          sourcePath: entry.path,
          fieldPath: slot.fieldPath,
          oldTargetPath: brokenPath,
          targetGroup: groupCandidates[0]!,
        });
      }
    }
  }

  return { fixed, ambiguous, notFound };
}

/**
 * Baboon `fix_tag_dependencies` for a loose `tags/` directory on disk:
 * Repairs broken `TagDependency` paths in `targetRelativePath` (or across the entire `tags/` folder)
 * by matching unique `(group, leaf_filename)` across the workspace and saving updated 64-byte `'blam'` files.
 */
export function fixBrokenTagDependenciesInWorkspace(
  tagsDir: string,
  targetRelativePath?: string,
): AutoFixDependenciesReport {
  const index = scanLooseTagsWorkspace(tagsDir);
  const byGroupAndLeaf = new Map<string, LooseWorkspaceTagEntry[]>();
  const byKey = new Map<string, LooseWorkspaceTagEntry>();

  for (const e of index.entries) {
    byKey.set(e.key, e);
    const leaf = e.tagPath.replace(/\//g, '\\').split('\\').pop()?.toLowerCase() ?? '';
    if (!leaf) continue;
    const k = `${e.group.toLowerCase()}:${leaf}`;
    const list = byGroupAndLeaf.get(k);
    if (list) list.push(e);
    else byGroupAndLeaf.set(k, [e]);
  }

  const fixed: AutoFixDependenciesReport['fixed'] = [];
  const ambiguous: AutoFixDependenciesReport['ambiguous'] = [];
  const notFound: AutoFixDependenciesReport['notFound'] = [];

  const normTargetRel = targetRelativePath ? normalizeComparePath(targetRelativePath) : null;
  const entriesToProcess = normTargetRel
    ? index.entries.filter(
        (e) =>
          normalizeComparePath(e.relativePath) === normTargetRel ||
          normalizeComparePath(e.tagPath) === normTargetRel,
      )
    : index.entries;

  for (const entry of entriesToProcess) {
    if (entry.headerFormat !== 'classic_blam_be') continue;
    const brokenInEntry = entry.dependencies.filter((d) => !byKey.has(d.targetKey));
    if (brokenInEntry.length === 0) continue;

    let parsed;
    try {
      const buf = fs.readFileSync(entry.filePath);
      parsed = parseHekLooseTagBuffer(buf, entry.tagPath, entry.group);
    } catch {
      continue;
    }

    let modified = false;
    parsed.tag.dependencies = parsed.referencedDeps.map((dep) => ({
      fieldPath: dep.fieldPath,
      fieldOffset: dep.fieldOffset,
      kind: 'external',
      group: dep.group,
      path: dep.path,
    }));

    for (const dep of parsed.tag.dependencies) {
      if (!dep.path) continue;
      const targetKey = makeLooseTagKey(dep.group, dep.path);
      if (byKey.has(targetKey)) continue;

      const leaf = dep.path.replace(/\//g, '\\').split('\\').pop()?.toLowerCase() ?? '';
      const candidates = byGroupAndLeaf.get(`${dep.group.toLowerCase()}:${leaf}`) ?? [];
      if (candidates.length === 1) {
        const match = candidates[0]!;
        const oldPath = dep.path;
        dep.path = match.tagPath;
        modified = true;
        fixed.push({
          sourcePath: entry.tagPath,
          sourceGroup: entry.group,
          fieldPath: dep.fieldPath,
          oldTargetPath: oldPath,
          newTargetPath: match.tagPath,
          targetGroup: dep.group,
        });
      } else if (candidates.length > 1) {
        ambiguous.push({
          sourcePath: entry.tagPath,
          fieldPath: dep.fieldPath,
          oldTargetPath: dep.path,
          targetGroup: dep.group,
          candidatePaths: candidates.map((c) => c.tagPath),
        });
      } else {
        notFound.push({
          sourcePath: entry.tagPath,
          fieldPath: dep.fieldPath,
          oldTargetPath: dep.path,
          targetGroup: dep.group,
        });
      }
    }

    if (modified) {
      const newBytes = serializeContainerTagToHekLooseBuffer(parsed.tag);
      fs.writeFileSync(entry.filePath, newBytes);
    }
  }

  return { fixed, ambiguous, notFound };
}

/**
 * Renames or moves an entire folder prefix of tags in an open `.map` buffer (e.g. `weapons\pistol` -> `weapons\magnum`),
 * updating all matching tag paths in the tag table and returning the count of renamed tags.
 */
export function refactorRenameOrMoveFolderInMap(
  buffer: Buffer,
  oldFolderPrefix: string,
  newFolderPrefix: string,
): {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  renamedTags: Array<{ tagIndex: number; group: string; oldPath: string; newPath: string }>;
} {
  let currentBuf = buffer;
  let header = parseCacheFileHeader(currentBuf);
  let tagIndex = parseTagIndex(currentBuf, header);

  const normOld = oldFolderPrefix
    .replace(/\//g, '\\')
    .replace(/^\\+|\\+$/g, '')
    .toLowerCase();
  const cleanNew = newFolderPrefix.replace(/\//g, '\\').replace(/^\\+|\\+$/g, '');
  if (!normOld || !cleanNew) {
    throw new Error('Both source and destination folder prefixes must be non-empty.');
  }

  const renamedTags: Array<{ tagIndex: number; group: string; oldPath: string; newPath: string }> = [];
  for (let i = 0; i < tagIndex.entries.length; i++) {
    const entry = tagIndex.entries[i]!;
    if (!entry.path) continue;
    const entryNorm = entry.path.replace(/\//g, '\\');
    const entryLower = entryNorm.toLowerCase();
    if (entryLower === normOld || entryLower.startsWith(`${normOld}\\`)) {
      const suffix = entryNorm.slice(normOld.length);
      const targetPath = `${cleanNew}${suffix}`;
      const res = renameTagInMap(currentBuf, header, tagIndex, i, targetPath);
      currentBuf = res.buffer;
      header = parseCacheFileHeader(currentBuf);
      tagIndex = parseTagIndex(currentBuf, header);
      renamedTags.push({
        tagIndex: i,
        group: entry.primaryClassName ?? 'unknown',
        oldPath: entryNorm,
        newPath: res.path,
      });
    }
  }

  return {
    buffer: currentBuf,
    header,
    tagIndex,
    renamedTags,
  };
}

/**
 * Moves/renames a loose 64-byte `'blam'` tag file inside a `tags/` workspace on disk AND rewrites
 * every referencing 64-byte `'blam'` tag file in the workspace so no references break!
 */
export function refactorRenameOrMoveLooseTagOnDisk(
  tagsDir: string,
  oldTagPath: string,
  group: string,
  newTagPath: string,
): {
  oldFilePath: string;
  newFilePath: string;
  rewrittenReferencingFiles: string[];
} {
  const index = scanLooseTagsWorkspace(tagsDir);
  const oldKey = makeLooseTagKey(group, oldTagPath);
  const targetEntry = index.entries.find((e) => e.key === oldKey);
  if (!targetEntry) {
    throw new Error(`Tag "${oldTagPath}.${group}" was not found in ${tagsDir}.`);
  }

  const cleanNewTagPath = newTagPath.replace(/\//g, '\\').replace(/^\\+|\\+$/g, '');
  const newFilePath = path.join(path.resolve(tagsDir), `${cleanNewTagPath.replace(/\\/g, path.sep)}.${group}`);
  fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
  fs.renameSync(targetEntry.filePath, newFilePath);

  const dependents = index.dependentsByTargetKey[oldKey] ?? [];
  const uniqueDepSourceKeys = [...new Set(dependents.map((d) => d.sourceKey))];
  const rewrittenReferencingFiles: string[] = [];

  for (const sourceKey of uniqueDepSourceKeys) {
    const srcEntry = index.entries.find((e) => e.key === sourceKey);
    if (!srcEntry) continue;
    const srcFilePath = srcEntry.key === oldKey ? newFilePath : srcEntry.filePath;
    if (!fs.existsSync(srcFilePath)) continue;

    try {
      const buf = fs.readFileSync(srcFilePath);
      const parsed = parseHekLooseTagBuffer(buf, srcEntry.tagPath, srcEntry.group);
      let changed = false;
      parsed.tag.dependencies = parsed.referencedDeps.map((dep) => {
        const isMatch = makeLooseTagKey(dep.group, dep.path) === oldKey;
        if (isMatch) changed = true;
        return {
          fieldPath: dep.fieldPath,
          fieldOffset: dep.fieldOffset,
          kind: 'external',
          group: dep.group,
          path: isMatch ? cleanNewTagPath : dep.path,
        };
      });
      if (changed) {
        fs.writeFileSync(srcFilePath, serializeContainerTagToHekLooseBuffer(parsed.tag));
        rewrittenReferencingFiles.push(srcFilePath);
      }
    } catch {
      // Ignore unparseable referencing tag
    }
  }

  return {
    oldFilePath: targetEntry.filePath,
    newFilePath,
    rewrittenReferencingFiles,
  };
}

/* ============================================================================
 * 3. STAGED BLOCK ORGANIZER & SPREADSHEET TSV BLOCK COPY/PASTE
 * ============================================================================ */

export interface BlockOrganizerPlanItem {
  /** Index in the original reflexive array (`>= 0` to copy/move/duplicate, or `-1` to insert a blank element) */
  sourceIndex: number;
  /** Optional new label/name to write to the element's primary string field (`name` or `label`) */
  newName?: string;
}

export interface ReorganizeReflexiveBlockResult {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  oldCount: number;
  newCount: number;
}

/**
 * Baboon Staged Block Organizer:
 * Reorders, duplicates, inserts (`sourceIndex: -1`), deletes, and renames elements of any `TagReflexive`
 * block on an open `.map` buffer in a single atomic commit.
 */
export function reorganizeReflexiveBlockInMap(
  buffer: Buffer,
  tagEntryIndex: number,
  reflexiveFieldPath: string,
  plan: BlockOrganizerPlanItem[],
): ReorganizeReflexiveBlockResult {
  const header = parseCacheFileHeader(buffer);
  const tagIndex = parseTagIndex(buffer, header);
  const entry = tagIndex.entries[tagEntryIndex];
  if (!entry) {
    throw new Error(`Tag #${tagEntryIndex} not found in map.`);
  }

  const structDef = getGroupDefinition(entry.primaryClassName!);
  const rootFileOffset = resolveTagDataPointer(
    entry.tagDataPointerOrResourceIndex,
    header,
    tagIndex.baseMemoryAddress,
  );

  // Resolve reflexive header offset and child struct
  const segments = reflexiveFieldPath.split('.');
  let currentStruct = structDef;
  let currentBase = rootFileOffset;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const m = seg.match(/^(.+)\[(\d+)\]$/);
    if (!m) throw new Error(`Invalid reflexive path segment "${seg}".`);
    const f = currentStruct.fields.find((field) => field.name === m[1]);
    if (!f || f.def.type !== 'TagReflexive' || !f.def.struct) {
      throw new Error(`Field "${m[1]}" is not a TagReflexive.`);
    }
    const idx = Number(m[2]);
    const count = buffer.readUInt32LE(currentBase + f.offset);
    const ptrLow = buffer.readUInt32LE(currentBase + f.offset + 4);
    if (idx < 0 || idx >= count) throw new Error(`Reflexive index ${idx} out of bounds.`);
    const childStruct = resolveStruct(f.def.struct);
    const childBase = header.tagDataOffset + (ptrLow - tagIndex.baseMemoryAddress);
    currentStruct = childStruct;
    currentBase = childBase + idx * childStruct.totalSize;
  }

  const leafRefName = segments[segments.length - 1]!;
  const refField = currentStruct.fields.find((field) => field.name === leafRefName);
  if (!refField || refField.def.type !== 'TagReflexive' || !refField.def.struct) {
    throw new Error(`Field "${leafRefName}" is not a TagReflexive.`);
  }

  const refHeaderAbsOffset = currentBase + refField.offset;
  const oldCount = buffer.readUInt32LE(refHeaderAbsOffset);
  const oldPtrLow = buffer.readUInt32LE(refHeaderAbsOffset + 4);
  const childStruct = resolveStruct(refField.def.struct);
  const elemSize = childStruct.totalSize;
  const oldChildBase =
    oldCount > 0 && oldPtrLow >= tagIndex.baseMemoryAddress
      ? header.tagDataOffset + (oldPtrLow - tagIndex.baseMemoryAddress)
      : 0;

  const newCount = plan.length;
  if (newCount === 0) {
    const out = Buffer.from(buffer);
    out.writeUInt32LE(0, refHeaderAbsOffset);
    out.writeUInt32LE(0, refHeaderAbsOffset + 4);
    out.writeUInt32LE(0, refHeaderAbsOffset + 8);
    return {
      buffer: out,
      header: parseCacheFileHeader(out),
      tagIndex: parseTagIndex(out, header),
      oldCount,
      newCount: 0,
    };
  }

  // Build new array bytes in a staging buffer
  const stagedArray = Buffer.alloc(newCount * elemSize, 0);
  const nameField = childStruct.fields.find(
    (f) => f.def.type === 'TagString' && (f.name === 'name' || f.name === 'label' || f.name.endsWith('name')),
  );

  for (let dstIdx = 0; dstIdx < newCount; dstIdx++) {
    const item = plan[dstIdx]!;
    const dstOff = dstIdx * elemSize;
    if (
      item.sourceIndex >= 0 &&
      item.sourceIndex < oldCount &&
      oldChildBase > 0 &&
      isRangeInBuffer(oldChildBase + item.sourceIndex * elemSize, elemSize, buffer.length)
    ) {
      buffer.copy(
        stagedArray,
        dstOff,
        oldChildBase + item.sourceIndex * elemSize,
        oldChildBase + (item.sourceIndex + 1) * elemSize,
      );
    } else {
      // Blank initialized element
      for (const cf of childStruct.fields) {
        if (cf.def.type === 'TagDependency') {
          stagedArray.writeUInt32LE(NULL_TAG_ID, dstOff + cf.offset + 0);
          stagedArray.writeUInt32LE(0, dstOff + cf.offset + 4);
          stagedArray.writeUInt32LE(0, dstOff + cf.offset + 8);
          stagedArray.writeUInt32LE(NULL_TAG_ID, dstOff + cf.offset + 12);
        } else if (cf.def.type === 'Index' && cf.name === 'name') {
          stagedArray.writeUInt16LE(0xffff, dstOff + cf.offset);
        }
      }
    }

    if (item.newName !== undefined && nameField) {
      stagedArray.fill(0, dstOff + nameField.offset, dstOff + nameField.offset + 32);
      stagedArray.write(item.newName.slice(0, 31), dstOff + nameField.offset, 'latin1');
    }
  }

  // If newCount <= oldCount and oldChildBase is valid, write in-place; otherwise allocate at EOF
  if (newCount <= oldCount && oldChildBase > 0 && isRangeInBuffer(oldChildBase, oldCount * elemSize, buffer.length)) {
    const out = Buffer.from(buffer);
    stagedArray.copy(out, oldChildBase, 0, stagedArray.length);
    out.writeUInt32LE(newCount, refHeaderAbsOffset);
    return {
      buffer: out,
      header: parseCacheFileHeader(out),
      tagIndex: parseTagIndex(out, header),
      oldCount,
      newCount,
    };
  }

  const prePad = (4 - ((buffer.length - header.tagDataOffset) % 4)) % 4;
  const postPad = (4 - (stagedArray.length % 4)) % 4;
  const newArrayOffset = buffer.length + prePad;
  const newVirtualPointer = tagIndex.baseMemoryAddress + (newArrayOffset - header.tagDataOffset);
  const out = Buffer.alloc(buffer.length + prePad + stagedArray.length + postPad, 0);
  buffer.copy(out, 0, 0, buffer.length);
  stagedArray.copy(out, newArrayOffset);

  out.writeUInt32LE(newCount, refHeaderAbsOffset);
  out.writeUInt32LE(newVirtualPointer, refHeaderAbsOffset + 4);
  out.writeUInt32LE(0, refHeaderAbsOffset + 8);

  const newFileSize = out.length;
  const newTagDataSize = out.length - header.tagDataOffset;
  out.writeUInt32LE(newFileSize, 0x08);
  out.writeUInt32LE(newTagDataSize, 0x14);

  const newHeader = parseCacheFileHeader(out);
  const newTagIndex = parseTagIndex(out, newHeader);
  return {
    buffer: out,
    header: newHeader,
    tagIndex: newTagIndex,
    oldCount,
    newCount,
  };
}

function findReflexiveDescriptorByPath(
  fields: TagFieldDescriptor[],
  reflexiveFieldPath: string,
): TagFieldDescriptor | null {
  const segments = reflexiveFieldPath.split('.');
  let currentFields = fields;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i === segments.length - 1) {
      const f = currentFields.find((field) => field.name === seg && field.kind === 'reflexive');
      return f ?? null;
    }
    const m = seg.match(/^(.+)\[(\d+)\]$/);
    if (!m) return null;
    const f = currentFields.find((field) => field.name === m[1] && field.kind === 'reflexive');
    const idx = Number(m[2]);
    const child = f?.children?.[idx];
    if (!child) return null;
    currentFields = child.fields;
  }
  return null;
}

/**
 * Exports all rows and scalar/enum/bitfield/bounds/string/dependency columns of a `TagReflexive`
 * block to spreadsheet-ready TSV (`\t`-separated columns, `\n`-separated rows), matching Baboon's
 * `block_to_tsv` workflow.
 */
export function exportReflexiveBlockToTsv(
  fieldsResult: TagFieldsResult,
  reflexiveFieldPath: string,
): { tsv: string; rowCount: number; columnNames: string[] } {
  const refField = findReflexiveDescriptorByPath(fieldsResult.fields, reflexiveFieldPath);
  if (!refField || refField.kind !== 'reflexive') {
    throw new Error(`Reflexive block "${reflexiveFieldPath}" not found.`);
  }
  const children = refField.children ?? [];
  if (children.length === 0) {
    return { tsv: '', rowCount: 0, columnNames: [] };
  }

  const firstChild = children[0]!;
  const exportableFields = firstChild.fields.filter(
    (f) => f.kind !== 'reflexive' && f.kind !== 'unsupported' && !f.readOnly,
  );
  const columnNames = exportableFields.map((f) => f.name);

  const formatCell = (f: TagFieldDescriptor): string => {
    if (f.kind === 'dependency') {
      if (!f.dependencyTarget) return '';
      return `${f.dependencyTarget.group}:${f.dependencyTarget.path}`;
    }
    if (f.kind === 'enum' && f.enumOptions && typeof f.value === 'number') {
      return f.enumOptions[f.value] ?? String(f.value);
    }
    if (Array.isArray(f.value)) {
      return f.value.join(',');
    }
    if (f.value === null || f.value === undefined) return '';
    return String(f.value).replace(/[\t\r\n]+/g, ' ');
  };

  const lines: string[] = [columnNames.join('\t')];
  for (const elem of children) {
    const byName = new Map(elem.fields.map((f) => [f.name, f]));
    const rowCells = columnNames.map((col) => {
      const f = byName.get(col);
      return f ? formatCell(f) : '';
    });
    lines.push(rowCells.join('\t'));
  }

  return {
    tsv: lines.join('\n'),
    rowCount: children.length,
    columnNames,
  };
}

/**
 * Applies spreadsheet TSV data (`\t`-separated columns with a header row) into a `TagReflexive`
 * block in an open `.map` buffer, automatically appending reflexive elements if the pasted TSV has
 * more rows than the block currently contains!
 */
export function applyTsvToReflexiveBlockInMap(
  buffer: Buffer,
  tagEntryIndex: number,
  reflexiveFieldPath: string,
  tsvText: string,
): {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
  updatedRows: number;
  updatedCells: number;
} {
  const rawLines = tsvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (rawLines.length < 2) {
    throw new Error('TSV input must include a header line and at least one data row.');
  }

  const headers = rawLines[0]!.split('\t').map((h) => h.trim());
  const dataRows = rawLines.slice(1).map((line) => line.split('\t'));

  let currentBuf: Buffer = Buffer.from(buffer);
  let header = parseCacheFileHeader(currentBuf);
  let tagIndex = parseTagIndex(currentBuf, header);

  let decoded = readTagFieldValues(currentBuf, header, tagIndex, tagEntryIndex);
  let refField = findReflexiveDescriptorByPath(decoded.fields, reflexiveFieldPath);
  if (!refField || refField.kind !== 'reflexive') {
    throw new Error(`Reflexive block "${reflexiveFieldPath}" not found.`);
  }

  const existingCount = refField.children?.length ?? 0;
  for (let r = existingCount; r < dataRows.length; r++) {
    const added = addReflexiveChunk(
      currentBuf,
      header,
      tagIndex,
      tagEntryIndex,
      reflexiveFieldPath,
      existingCount > 0 ? existingCount - 1 : -1,
    );
    currentBuf = added.buffer;
    header = added.header;
    tagIndex = added.tagIndex;
  }

  decoded = readTagFieldValues(currentBuf, header, tagIndex, tagEntryIndex);
  refField = findReflexiveDescriptorByPath(decoded.fields, reflexiveFieldPath)!;
  const children = refField.children ?? [];

  let updatedCells = 0;
  for (let rowIdx = 0; rowIdx < dataRows.length && rowIdx < children.length; rowIdx++) {
    const row = dataRows[rowIdx]!;
    const elem = children[rowIdx]!;
    const fieldByName = new Map(elem.fields.map((f) => [f.name, f]));

    for (let colIdx = 0; colIdx < headers.length && colIdx < row.length; colIdx++) {
      const colName = headers[colIdx]!;
      const rawCell = row[colIdx]!.trim();
      const fieldDesc = fieldByName.get(colName);
      if (!fieldDesc || fieldDesc.readOnly || fieldDesc.kind === 'reflexive' || fieldDesc.kind === 'unsupported') {
        continue;
      }

      const fullFieldPath = `${reflexiveFieldPath}[${rowIdx}].${colName}`;
      let parsedVal: unknown = rawCell;

      if (fieldDesc.kind === 'number') {
        const num = Number(rawCell);
        if (Number.isNaN(num)) continue;
        parsedVal = num;
      } else if (fieldDesc.kind === 'bitfield') {
        const num = rawCell.startsWith('0x') ? parseInt(rawCell, 16) : Number(rawCell);
        if (Number.isNaN(num)) continue;
        parsedVal = num >>> 0;
      } else if (fieldDesc.kind === 'bounds' || fieldDesc.kind === 'composite') {
        const parts = rawCell.split(',').map((s) => Number(s.trim()));
        if (parts.some((n) => Number.isNaN(n))) continue;
        parsedVal = parts;
      } else if (fieldDesc.kind === 'enum') {
        if (fieldDesc.enumOptions) {
          const optIdx = fieldDesc.enumOptions.findIndex(
            (o) => o.toLowerCase() === rawCell.toLowerCase(),
          );
          if (optIdx >= 0) {
            parsedVal = optIdx;
          } else {
            const num = Number(rawCell);
            if (Number.isNaN(num)) continue;
            parsedVal = num;
          }
        }
      } else if (fieldDesc.kind === 'dependency') {
        if (!rawCell || rawCell.toLowerCase() === 'null') {
          parsedVal = NULL_TAG_ID;
        } else {
          const colonIdx = rawCell.indexOf(':');
          const grp = colonIdx >= 0 ? rawCell.slice(0, colonIdx).trim().toLowerCase() : null;
          const pth = (colonIdx >= 0 ? rawCell.slice(colonIdx + 1) : rawCell).trim();
          const normPth = normalizeComparePath(pth);
          const match = tagIndex.entries.find(
            (e) =>
              normalizeComparePath(e.path) === normPth &&
              (!grp || (e.primaryClassName ?? '').toLowerCase() === grp),
          );
          if (!match) continue;
          parsedVal = match.tagId;
        }
      }

      try {
        writeTagFieldValue(currentBuf, header, tagIndex, tagEntryIndex, fullFieldPath, parsedVal);
        updatedCells++;
      } catch {
        // Skip invalid cell value without aborting whole paste
      }
    }
  }

  return {
    buffer: currentBuf,
    header,
    tagIndex,
    updatedRows: Math.min(dataRows.length, children.length),
    updatedCells,
  };
}

/* ============================================================================
 * 4. VISUAL FUNCTION CURVE & COLOR-STOP EVALUATOR
 * ============================================================================ */

export type BlamPeriodicFunctionType =
  | 'one'
  | 'zero'
  | 'sine'
  | 'cosine'
  | 'cosine (variable period)'
  | 'diagonal wave'
  | 'diagonal wave (variable period)'
  | 'slide'
  | 'slide (variable period)'
  | 'noise'
  | 'jitter'
  | 'wander'
  | 'spark';

export type BlamTransitionFunctionType =
  | 'linear'
  | 'early'
  | 'very early'
  | 'late'
  | 'very late'
  | 'cosine';

export interface BlamFunctionCurveParams {
  kind: 'periodic' | 'transition' | 'linear' | 'spline';
  periodicFunction?: BlamPeriodicFunctionType | string;
  transitionFunction?: BlamTransitionFunctionType | string;
  frequency?: number;
  phase?: number;
  min?: number;
  max?: number;
  minBound?: number;
  maxBound?: number;
  controlPoints?: Array<{ x: number; y: number }>;
  colorStops?: Array<{ t: number; hex: string } | [number, number, number]>;
}

export interface BlamFunctionCurveEvaluation {
  samples: Array<{ x: number; y: number; colorHex?: string; rgbHex?: string }>;
  minY: number;
  maxY: number;
}

function evalPeriodicWave(fnName: string, t: number): number {
  const u = ((t % 1) + 1) % 1;
  switch (fnName.toLowerCase()) {
    case 'one':
      return 1;
    case 'zero':
      return 0;
    case 'sine':
      return 0.5 * (1 + Math.sin(2 * Math.PI * u));
    case 'cosine':
    case 'cosine (variable period)':
      return 0.5 * (1 + Math.cos(2 * Math.PI * u));
    case 'diagonal wave':
    case 'diagonal wave (variable period)':
      return u < 0.5 ? 2 * u : 2 * (1 - u);
    case 'slide':
    case 'slide (variable period)':
      return u;
    case 'noise':
    case 'jitter':
    case 'wander': {
      const s = Math.sin(u * 12.9898 * 43.758) * 43758.5453;
      return s - Math.floor(s);
    }
    case 'spark': {
      const s = Math.sin(u * 78.233) * 43758.5453;
      return (s - Math.floor(s)) > 0.8 ? 1 : 0;
    }
    default:
      return 0.5 * (1 + Math.cos(2 * Math.PI * u));
  }
}

function evalTransitionCurve(fnName: string, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  switch (fnName.toLowerCase()) {
    case 'early':
      return Math.sqrt(u);
    case 'very early':
      return Math.pow(u, 0.25);
    case 'late':
      return u * u;
    case 'very late':
      return u * u * u * u;
    case 'cosine':
      return 0.5 * (1 - Math.cos(Math.PI * u));
    case 'linear':
    default:
      return u;
  }
}

function interpolateHexColors(
  stops: Array<{ t: number; hex: string } | [number, number, number]>,
  u: number,
): string | undefined {
  if (!stops || stops.length === 0) return undefined;
  const normalizedStops: Array<{ t: number; hex: string }> = stops.map((stop, idx) => {
    if (Array.isArray(stop)) {
      const r = Math.max(0, Math.min(255, Math.round((stop[0] ?? 0) * 255)));
      const g = Math.max(0, Math.min(255, Math.round((stop[1] ?? 0) * 255)));
      const b = Math.max(0, Math.min(255, Math.round((stop[2] ?? 0) * 255)));
      const t = stops.length > 1 ? idx / (stops.length - 1) : 0;
      return {
        t,
        hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      };
    }
    return stop;
  });
  if (normalizedStops.length === 1) return normalizedStops[0]!.hex;
  const sorted = [...normalizedStops].sort((a, b) => a.t - b.t);
  const clamped = Math.max(0, Math.min(1, u));
  let left = sorted[0]!;
  let right = sorted[sorted.length - 1]!;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (clamped >= sorted[i]!.t && clamped <= sorted[i + 1]!.t) {
      left = sorted[i]!;
      right = sorted[i + 1]!;
      break;
    }
  }
  const span = Math.max(1e-6, right.t - left.t);
  const alpha = Math.max(0, Math.min(1, (clamped - left.t) / span));
  const parseRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace(/^#/, '');
    const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16) || 0;
    return [(n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  };
  const [r1, g1, b1] = parseRgb(left.hex);
  const [r2, g2, b2] = parseRgb(right.hex);
  const r = Math.round(r1 + (r2 - r1) * alpha);
  const g = Math.round(g1 + (g2 - g1) * alpha);
  const b = Math.round(b1 + (b2 - b1) * alpha);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Evaluates a Blam function curve (Periodic, Transition, Linear, or Cubic Hermite/Catmull-Rom Spline)
 * over `[0..1]` for Mantle's interactive Function Curve Editor.
 */
export function evaluateBlamFunctionCurve(
  params: BlamFunctionCurveParams,
  sampleCount = 65,
): BlamFunctionCurveEvaluation {
  const n = Math.max(2, Math.min(512, sampleCount));
  const minVal = params.min ?? params.minBound ?? 0;
  const maxVal = params.max ?? params.maxBound ?? 1;
  const freq = params.frequency ?? 1;
  const phase = params.phase ?? 0;

  const samples: Array<{ x: number; y: number; colorHex?: string; rgbHex?: string }> = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let normY = x;
    if (params.kind === 'periodic') {
      normY = evalPeriodicWave(params.periodicFunction ?? 'cosine', x * freq + phase);
    } else if (params.kind === 'transition') {
      normY = evalTransitionCurve(params.transitionFunction ?? 'linear', x);
    } else if (params.kind === 'spline' && params.controlPoints && params.controlPoints.length >= 2) {
      const pts = [...params.controlPoints].sort((a, b) => a.x - b.x);
      let p1 = pts[0]!;
      let p2 = pts[pts.length - 1]!;
      for (let j = 0; j < pts.length - 1; j++) {
        if (x >= pts[j]!.x && x <= pts[j + 1]!.x) {
          p1 = pts[j]!;
          p2 = pts[j + 1]!;
          break;
        }
      }
      const u = (x - p1.x) / Math.max(1e-6, p2.x - p1.x);
      const smooth = u * u * (3 - 2 * u);
      normY = p1.y + (p2.y - p1.y) * smooth;
    } else {
      normY = x;
    }

    const y = minVal + (maxVal - minVal) * normY;
    const colorHex = interpolateHexColors(params.colorStops ?? [], normY);
    samples.push({ x, y, colorHex, rgbHex: colorHex });
  }

  return {
    samples,
    minY: Math.min(minVal, maxVal),
    maxY: Math.max(minVal, maxVal),
  };
}

/* ============================================================================
 * 5. ADVANCED STRINGS & HUD MESSAGE FIXED-INDEX SAFETY
 * ============================================================================ */

export interface HudMessageSafetyReport {
  hmtTagIndex: number;
  hmtTagPath: string;
  usage: 'global' | 'mission' | 'both' | 'unreferenced';
  referencedByPaths: string[];
  fixedIndexLocked: boolean;
  isGlobalHudMessageText: boolean;
  messageCount: number;
  warningMessage?: string;
  warningBanner: string;
}

/**
 * Baboon `HudMessageUsage` detector:
 * Inspects whether a `hud_message_text` (`hmt `) tag is referenced by `hud_globals` (`Global`),
 * by `scenario` (`Mission`), or `Both`. When referenced by `hud_globals`, the Halo engine looks up
 * HUD messages by hardcoded slot indices—reordering or deleting slots corrupts global HUD prompts!
 */
export function analyzeHudMessageTextSafety(
  buffer: Buffer,
  hmtTagEntryIndex: number,
): HudMessageSafetyReport {
  const node = inspectContentExplorerNodeInMap(buffer, hmtTagEntryIndex);
  let hasGlobal = false;
  let hasMission = false;
  const referencedByPaths: string[] = [];

  for (const parent of node.referencedBy) {
    referencedByPaths.push(`${parent.path}.${parent.group}`);
    if (parent.group === 'hud_globals' || parent.group === 'globals') {
      hasGlobal = true;
    } else if (parent.group === 'scenario') {
      hasMission = true;
    }
  }

  // Also check path convention (`ui\hud\default` is Halo CE's global HUD message table)
  if (node.path.toLowerCase().startsWith('ui\\hud\\')) {
    hasGlobal = true;
  }

  const usage: HudMessageSafetyReport['usage'] =
    hasGlobal && hasMission
      ? 'both'
      : hasGlobal
        ? 'global'
        : hasMission
          ? 'mission'
          : 'unreferenced';

  const fixedIndexLocked = hasGlobal;
  let messageCount = 0;
  try {
    const header = parseCacheFileHeader(buffer);
    const tagIndex = parseTagIndex(buffer, header);
    const fields = readTagFieldValues(buffer, header, tagIndex, hmtTagEntryIndex);
    const msgRef = fields.fields.find((f) => f.name === 'messages' && f.kind === 'reflexive');
    messageCount = msgRef && msgRef.kind === 'reflexive' ? (msgRef.children?.length ?? 0) : 0;
  } catch {
    // non-fatal
  }
  const warningMsg = fixedIndexLocked
    ? 'This HUD message tag is referenced by hud_globals. The Halo engine indexes its slots by hardcoded slot numbers — edit message text in-place or append at the end, and never delete or reorder existing slots.'
    : 'Mission-scoped HUD message text tag. If you reorder or delete slots, recompile scenario HaloScript (.hsc) so script message indices stay aligned.';
  return {
    hmtTagIndex: hmtTagEntryIndex,
    hmtTagPath: node.path,
    usage,
    referencedByPaths,
    fixedIndexLocked,
    isGlobalHudMessageText: fixedIndexLocked,
    messageCount,
    warningMessage: fixedIndexLocked ? warningMsg : undefined,
    warningBanner: warningMsg,
  };
}

export interface HaloStringMarkupToken {
  type: 'text' | 'button_token' | 'control_token';
  raw: string;
  start: number;
  end: number;
  description?: string;
}

export const HALO_HUD_MARKUP_TOKENS: Record<string, string> = {
  '%a-button': 'A Button',
  '%b-button': 'B Button',
  '%x-button': 'X Button',
  '%y-button': 'Y Button',
  '%black-button': 'Black Button',
  '%white-button': 'White Button',
  '%left-trigger': 'Left Trigger',
  '%right-trigger': 'Right Trigger',
  '%dpad-up': 'D-Pad Up',
  '%dpad-down': 'D-Pad Down',
  '%dpad-left': 'D-Pad Left',
  '%dpad-right': 'D-Pad Right',
  '%start-button': 'Start Button',
  '%back-button': 'Back Button',
  '%left-thumb': 'Left Thumbstick',
  '%right-thumb': 'Right Thumbstick',
  '%action': 'Action / Use Key',
  '%jump': 'Jump Key',
  '%accept': 'Accept Key',
  '%cancel': 'Cancel Key',
  '%reload': 'Reload Key',
  '%melee': 'Melee Key',
  '%throw-grenade': 'Throw Grenade Key',
  '%fire': 'Primary Fire Key',
  '%switch-weapon': 'Switch Weapon Key',
  '%switch-grenade': 'Switch Grenade Key',
  '%zoom': 'Zoom Key',
  '%crouch': 'Crouch Key',
  '%flashlight': 'Flashlight Key',
  '%scores': 'Scoreboard Key',
  '%chat': 'Chat Key',
  '%custom-1': 'Custom Bind 1',
  '%custom-2': 'Custom Bind 2',
  '%custom-3': 'Custom Bind 3',
  '%custom-4': 'Custom Bind 4',
  '|n': 'New Line',
  '|t': 'Tab',
  '|l': 'Align Left',
  '|r': 'Align Right',
  '|c': 'Align Center',
};

/**
 * Tokenizes a Halo HUD / Unicode string into plain text, `%button` / `&glyph` tokens, and `|n` control tokens.
 */
export function tokenizeHaloHudStringMarkup(text: string): HaloStringMarkupToken[] {
  const tokenRegex = /(%(?:[a-z0-9-]+)|&(?:[a-z0-9_]+)|\|[ntlrc])/gi;
  const tokens: HaloStringMarkupToken[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({
        type: 'text',
        raw: text.slice(lastIdx, match.index),
        start: lastIdx,
        end: match.index,
      });
    }
    const raw = match[0];
    const isControl = raw.startsWith('|');
    tokens.push({
      type: isControl ? 'control_token' : 'button_token',
      raw,
      start: match.index,
      end: match.index + raw.length,
      description: HALO_HUD_MARKUP_TOKENS[raw.toLowerCase()] ?? 'Halo Input / Control Token',
    });
    lastIdx = match.index + raw.length;
  }

  if (lastIdx < text.length) {
    tokens.push({
      type: 'text',
      raw: text.slice(lastIdx),
      start: lastIdx,
      end: text.length,
    });
  }

  return tokens;
}

/**
 * Exports a `UnicodeStringListResult` to RFC-4180 CSV (`index,text`).
 */
export function exportUnicodeStringsToCsv(
  list: UnicodeStringListResult | Array<{ index: number; text: string }>,
): string {
  const escapeCsv = (val: string): string => {
    if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };
  const items = Array.isArray(list) ? list : list.strings;
  const lines = ['index,text'];
  for (const item of items) {
    lines.push(`${item.index},${escapeCsv(item.text)}`);
  }
  return lines.join('\r\n');
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      currentRow.push(currentCell);
      currentCell = '';
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentCell += ch;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows;
}

export interface StringsCsvImportPreview {
  mode: 'amend' | 'replace';
  mergedStrings: string[];
  addedCount: number;
  appendedCount: number;
  modifiedCount: number;
  updatedCount: number;
  removedCount: number;
  unchangedCount: number;
  diffs: Array<{
    index: number;
    status: 'added' | 'appended' | 'modified' | 'removed' | 'unchanged';
    before: string;
    after: string;
    oldText: string | null;
    newText: string;
  }>;
}

/**
 * Baboon CSV Amend / Replace importer for `unicode_string_list`:
 * - `amend`: overlays matching `index` rows onto existing strings and appends new indices without deleting unmentioned slots.
 * - `replace`: replaces the string table with the rows from the CSV.
 */
export function previewUnicodeStringsCsvImport(
  existingInput: string[] | Array<{ index: number; text: string }>,
  csvText: string,
  mode: 'amend' | 'replace' = 'amend',
): StringsCsvImportPreview {
  const existingStrings: string[] = existingInput.map((item) =>
    typeof item === 'string' ? item : item.text,
  );
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    throw new Error('CSV is empty.');
  }

  const startIdx =
    rows[0]![0]?.trim().toLowerCase() === 'index' || rows[0]![0]?.trim().toLowerCase() === 'key'
      ? 1
      : 0;

  const incomingByIndex = new Map<number, string>();
  let maxIndex = mode === 'amend' ? existingStrings.length - 1 : -1;

  for (let r = startIdx; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.length < 2) continue;
    const idx = Number(row[0]!.trim());
    const text = row[1] ?? '';
    if (!Number.isInteger(idx) || idx < 0) continue;
    incomingByIndex.set(idx, text);
    if (idx > maxIndex) maxIndex = idx;
  }

  const mergedStrings: string[] = [];
  const diffs: StringsCsvImportPreview['diffs'] = [];
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  const totalLen = Math.max(existingStrings.length, maxIndex + 1);
  for (let i = 0; i < totalLen; i++) {
    const hadOld = i < existingStrings.length;
    const oldVal = hadOld ? existingStrings[i]! : '';
    const hasNew = incomingByIndex.has(i);
    const newVal = hasNew ? incomingByIndex.get(i)! : mode === 'amend' ? oldVal : '';

    if (mode === 'replace' && i > maxIndex) {
      removedCount++;
      diffs.push({ index: i, status: 'removed', before: oldVal, after: '', oldText: oldVal, newText: '' });
      continue;
    }

    mergedStrings.push(newVal);
    if (!hadOld) {
      addedCount++;
      diffs.push({ index: i, status: 'added', before: '', after: newVal, oldText: null, newText: newVal });
    } else if (oldVal !== newVal) {
      modifiedCount++;
      diffs.push({ index: i, status: 'modified', before: oldVal, after: newVal, oldText: oldVal, newText: newVal });
    } else {
      unchangedCount++;
    }
  }

  return {
    mode,
    mergedStrings,
    addedCount,
    appendedCount: addedCount,
    modifiedCount,
    updatedCount: modifiedCount,
    removedCount,
    unchangedCount,
    diffs,
  };
}

/* ============================================================================
 * 6. BYTE-SNAPSHOT EDIT JOURNAL (`EditJournal`) & TRANSACTIONAL POKING
 * ============================================================================ */

export interface EditJournalSnapshot {
  id: number;
  label: string;
  fieldPath?: string;
  timestampMs: number;
  bytes: Buffer;
}

/**
 * Baboon `EditJournal`:
 * Capped (`maxSnapshots = 100`) byte-snapshot undo/redo stack with 250ms drag coalescing
 * and `savedAtId` dirty tracking (`isModified` is true if the user saves and then undoes).
 */
export class EditJournal {
  private undoStack: EditJournalSnapshot[] = [];
  private redoStack: EditJournalSnapshot[] = [];
  private currentSnapshot: EditJournalSnapshot;
  private savedAtId: number;
  private nextId = 1;
  private readonly maxSnapshots: number;
  private readonly coalesceWindowMs: number;

  constructor(initialBytes: Buffer, maxSnapshots = 100, coalesceWindowMs = 250) {
    this.maxSnapshots = maxSnapshots;
    this.coalesceWindowMs = coalesceWindowMs;
    this.currentSnapshot = {
      id: this.nextId++,
      label: 'Initial state',
      timestampMs: Date.now(),
      bytes: Buffer.from(initialBytes),
    };
    this.savedAtId = this.currentSnapshot.id;
  }

  public recordEdit(newBytes: Buffer, label: string, fieldPath?: string, nowMs = Date.now()): void {
    if (this.currentSnapshot.bytes.equals(newBytes)) return;

    const canCoalesce =
      fieldPath !== undefined &&
      this.currentSnapshot.fieldPath === fieldPath &&
      nowMs - this.currentSnapshot.timestampMs <= this.coalesceWindowMs &&
      this.undoStack.length > 0;

    if (canCoalesce) {
      this.currentSnapshot = {
        id: this.nextId++,
        label,
        fieldPath,
        timestampMs: nowMs,
        bytes: Buffer.from(newBytes),
      };
      this.redoStack = [];
      return;
    }

    this.undoStack.push(this.currentSnapshot);
    if (this.undoStack.length > this.maxSnapshots) {
      this.undoStack.shift();
    }
    this.currentSnapshot = {
      id: this.nextId++,
      label,
      fieldPath,
      timestampMs: nowMs,
      bytes: Buffer.from(newBytes),
    };
    this.redoStack = [];
  }

  public undo(): EditJournalSnapshot | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(this.currentSnapshot);
    this.currentSnapshot = prev;
    return { ...this.currentSnapshot, bytes: Buffer.from(this.currentSnapshot.bytes) };
  }

  public redo(): EditJournalSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(this.currentSnapshot);
    this.currentSnapshot = next;
    return { ...this.currentSnapshot, bytes: Buffer.from(this.currentSnapshot.bytes) };
  }

  public markSaved(): void {
    this.savedAtId = this.currentSnapshot.id;
  }

  public get isModified(): boolean {
    return this.currentSnapshot.id !== this.savedAtId;
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get undoStackSize(): number {
    return this.undoStack.length;
  }

  public get redoStackSize(): number {
    return this.redoStack.length;
  }

  public get currentBytes(): Buffer {
    return Buffer.from(this.currentSnapshot.bytes);
  }
}

export interface TransactionalMemoryPokePatch {
  address: number;
  size: number;
  expectedBeforeBase64: string;
  afterBase64: string;
}

export interface TransactionalPokePlan {
  patches: TransactionalMemoryPokePatch[];
  rollbackPatches: TransactionalMemoryPokePatch[];
  totalBytesPatched: number;
}

/**
 * Baboon Transactional Poke Planner:
 * Diffs `beforeBuffer` and `afterBuffer` (anchored at `virtualBaseAddress`) to produce contiguous
 * memory patches with `expectedBeforeBase64` pre-write verification and an automatic `rollbackPatches` list.
 */
export function buildTransactionalPokePlan(
  beforeBuffer: Buffer,
  afterBuffer: Buffer,
  virtualBaseAddress = 0x40440000,
  startFileOffset = 0,
): TransactionalPokePlan {
  const len = Math.min(beforeBuffer.length, afterBuffer.length);
  const patches: TransactionalMemoryPokePatch[] = [];
  const rollbackPatches: TransactionalMemoryPokePatch[] = [];
  let totalBytesPatched = 0;

  let i = startFileOffset;
  while (i < len) {
    if (beforeBuffer[i] === afterBuffer[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < len && beforeBuffer[i] !== afterBuffer[i]) {
      i++;
    }
    const end = i;
    const size = end - start;
    const addr = (virtualBaseAddress + (start - startFileOffset)) >>> 0;
    const beforeSlice = beforeBuffer.subarray(start, end);
    const afterSlice = afterBuffer.subarray(start, end);
    const expectedBeforeBase64 = beforeSlice.toString('base64');
    const afterBase64 = afterSlice.toString('base64');

    patches.push({
      address: addr,
      size,
      expectedBeforeBase64,
      afterBase64,
    });
    rollbackPatches.push({
      address: addr,
      size,
      expectedBeforeBase64: afterBase64,
      afterBase64: expectedBeforeBase64,
    });
    totalBytesPatched += size;
  }

  return {
    patches,
    rollbackPatches: rollbackPatches.reverse(),
    totalBytesPatched,
  };
}

/* ============================================================================
 * 7. HALOSCRIPT MULTI-ENGINE DOCS & VISUAL `tool.exe` COMMAND CATALOG
 * ============================================================================ */

export interface HaloScriptDocEntry {
  name: string;
  kind: 'function' | 'global';
  returnType: string;
  signature: string;
  description: string;
  category: string;
  networkSafe: boolean;
  engines: string[];
  example?: string;
}

export const HALOSCRIPT_REFERENCE_CATALOG: HaloScriptDocEntry[] = [
  {
    name: 'ai_place',
    kind: 'function',
    returnType: 'void',
    signature: '(ai_place <ai>)',
    description: 'Places the specified squad or actor encounter into the world.',
    category: 'AI & Encounters',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(ai_place enc_cov_intro/grunts)',
  },
  {
    name: 'ai_kill',
    kind: 'function',
    returnType: 'void',
    signature: '(ai_kill <ai>)',
    description: 'Instantly kills the specified actor encounter or squad.',
    category: 'AI & Encounters',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(ai_kill enc_cov_intro)',
  },
  {
    name: 'ai_living_count',
    kind: 'function',
    returnType: 'short',
    signature: '(ai_living_count <ai>)',
    description: 'Returns the number of living actors in the specified encounter or squad.',
    category: 'AI & Encounters',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(sleep_until (<= (ai_living_count enc_cov_intro) 0))',
  },
  {
    name: 'ai_attach',
    kind: 'function',
    returnType: 'void',
    signature: '(ai_attach <unit> <ai>)',
    description: 'Attaches the specified unit to an AI encounter/actor list.',
    category: 'AI & Encounters',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3'],
  },
  {
    name: 'ai_command_list',
    kind: 'function',
    returnType: 'void',
    signature: '(ai_command_list <ai> <command_list>)',
    description: 'Assigns a scripted command list to an AI encounter or platoon.',
    category: 'AI & Encounters',
    networkSafe: false,
    engines: ['haloce', 'halo2'],
  },
  {
    name: 'object_create',
    kind: 'function',
    returnType: 'void',
    signature: '(object_create <object_name>)',
    description: 'Creates a named scenario object from the scenario object names table.',
    category: 'Objects & Units',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(object_create pelican_dropship_1)',
  },
  {
    name: 'object_create_anew',
    kind: 'function',
    returnType: 'void',
    signature: '(object_create_anew <object_name>)',
    description: 'Destroys and recreates the named object at its scenario spawn point.',
    category: 'Objects & Units',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'object_destroy',
    kind: 'function',
    returnType: 'void',
    signature: '(object_destroy <object>)',
    description: 'Removes the specified object from the world.',
    category: 'Objects & Units',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'object_teleport',
    kind: 'function',
    returnType: 'void',
    signature: '(object_teleport <object> <cutscene_flag>)',
    description: 'Teleports the specified object to a named cutscene flag.',
    category: 'Objects & Units',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(object_teleport (unit (list_get (players) 0)) flag_arena_start)',
  },
  {
    name: 'unit_enter_vehicle',
    kind: 'function',
    returnType: 'void',
    signature: '(unit_enter_vehicle <unit> <vehicle> <string:seat_label>)',
    description: 'Puts the specified unit into the specified vehicle seat marker (e.g. "W-driver").',
    category: 'Objects & Units',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(unit_enter_vehicle chief warthog_1 "W-driver")',
  },
  {
    name: 'volume_test_objects',
    kind: 'function',
    returnType: 'boolean',
    signature: '(volume_test_objects <trigger_volume> <object_list>)',
    description: 'Returns true if any object in the list is inside the named trigger volume.',
    category: 'Trigger Volumes',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(sleep_until (volume_test_objects trig_bridge (players)) 15)',
  },
  {
    name: 'camera_control',
    kind: 'function',
    returnType: 'void',
    signature: '(camera_control <boolean>)',
    description: 'Toggles scripted director camera control on or off.',
    category: 'Camera & Cutscenes',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(camera_control true)',
  },
  {
    name: 'camera_set',
    kind: 'function',
    returnType: 'void',
    signature: '(camera_set <cutscene_camera_point> <short:ticks>)',
    description: 'Moves the scripted camera to the named camera point over the given number of ticks (30 ticks = 1 sec).',
    category: 'Camera & Cutscenes',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(camera_set cam_intro_pan 90)',
  },
  {
    name: 'cinematic_start',
    kind: 'function',
    returnType: 'void',
    signature: '(cinematic_start)',
    description: 'Starts letterboxed cinematic mode and hides player HUD.',
    category: 'Camera & Cutscenes',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'cinematic_stop',
    kind: 'function',
    returnType: 'void',
    signature: '(cinematic_stop)',
    description: 'Ends letterboxed cinematic mode and restores player HUD.',
    category: 'Camera & Cutscenes',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'fade_in',
    kind: 'function',
    returnType: 'void',
    signature: '(fade_in <real:r> <real:g> <real:b> <short:ticks>)',
    description: 'Fades the screen in from the specified RGB color (0..1) over the given ticks.',
    category: 'Camera & Cutscenes',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(fade_in 0 0 0 60)',
  },
  {
    name: 'fade_out',
    kind: 'function',
    returnType: 'void',
    signature: '(fade_out <real:r> <real:g> <real:b> <short:ticks>)',
    description: 'Fades the screen out to the specified RGB color (0..1) over the given ticks.',
    category: 'Camera & Cutscenes',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(fade_out 0 0 0 60)',
  },
  {
    name: 'switch_bsp',
    kind: 'function',
    returnType: 'void',
    signature: '(switch_bsp <short:bsp_index>)',
    description: 'Switches the active Structure BSP by index in the scenario Structure BSPs block.',
    category: 'World & BSP',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(switch_bsp 1)',
  },
  {
    name: 'game_save',
    kind: 'function',
    returnType: 'void',
    signature: '(game_save)',
    description: 'Checks if it is safe to save and triggers a campaign checkpoint.',
    category: 'Campaign & Checkpoints',
    networkSafe: false,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'show_hud_help_text',
    kind: 'function',
    returnType: 'void',
    signature: '(show_hud_help_text <boolean>)',
    description: 'Shows or hides the HUD help text box.',
    category: 'HUD & UI',
    networkSafe: true,
    engines: ['haloce', 'halo2'],
  },
  {
    name: 'hud_set_help_text',
    kind: 'function',
    returnType: 'void',
    signature: '(hud_set_help_text <hud_message>)',
    description: 'Displays the named HUD message from the scenario hud_message_text tag.',
    category: 'HUD & UI',
    networkSafe: true,
    engines: ['haloce', 'halo2'],
  },
  {
    name: 'hud_set_objective_text',
    kind: 'function',
    returnType: 'void',
    signature: '(hud_set_objective_text <hud_message>)',
    description: 'Sets the pause-screen & HUD primary objective message.',
    category: 'HUD & UI',
    networkSafe: true,
    engines: ['haloce', 'halo2'],
  },
  {
    name: 'device_set_position',
    kind: 'function',
    returnType: 'void',
    signature: '(device_set_position <device> <real:position>)',
    description: 'Animates a device_machine (door/elevator) to target position (0.0 = closed, 1.0 = open).',
    category: 'Devices & Doors',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(device_set_position door_hangar_main 1.0)',
  },
  {
    name: 'device_set_power',
    kind: 'function',
    returnType: 'void',
    signature: '(device_set_power <device> <real:power>)',
    description: 'Sets the power state (0.0..1.0) of a device or light fixture.',
    category: 'Devices & Doors',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'sleep',
    kind: 'function',
    returnType: 'void',
    signature: '(sleep <short:ticks> [<script>])',
    description: 'Pauses the current script (or target script) for the specified number of ticks (30 ticks = 1 second).',
    category: 'Control Flow',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(sleep 90)',
  },
  {
    name: 'sleep_until',
    kind: 'function',
    returnType: 'void',
    signature: '(sleep_until <boolean_expr> [<short:poll_ticks>])',
    description: 'Suspends execution until the boolean condition evaluates to true.',
    category: 'Control Flow',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
    example: '(sleep_until (volume_test_objects trig_hall (players)) 15)',
  },
  {
    name: 'wake',
    kind: 'function',
    returnType: 'void',
    signature: '(wake <script_name>)',
    description: 'Wakes a dormant script so it begins executing.',
    category: 'Control Flow',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'players',
    kind: 'function',
    returnType: 'object_list',
    signature: '(players)',
    description: 'Returns a list of all active player biped units.',
    category: 'Players & Cheats',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'cheat_deathless_player',
    kind: 'global',
    returnType: 'boolean',
    signature: '(set cheat_deathless_player true)',
    description: 'Makes players invulnerable to damage when set to true.',
    category: 'Players & Cheats',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
  {
    name: 'cheat_infinite_ammo',
    kind: 'global',
    returnType: 'boolean',
    signature: '(set cheat_infinite_ammo true)',
    description: 'Grants infinite ammunition and bottomless clip when set to true.',
    category: 'Players & Cheats',
    networkSafe: true,
    engines: ['haloce', 'halo2', 'halo3', 'odst', 'reach'],
  },
];

export function queryHaloScriptDocs(query?: string, engineFilter?: string): HaloScriptDocEntry[] {
  const q = (query ?? '').trim().toLowerCase();
  const rawEng = (engineFilter ?? '').trim().toLowerCase();
  const engMap: Record<string, string> = {
    all: '',
    h1: 'haloce',
    h2: 'halo2',
    h3: 'halo3',
    hr: 'reach',
  };
  const eng = engMap[rawEng] !== undefined ? engMap[rawEng]! : rawEng;
  return HALOSCRIPT_REFERENCE_CATALOG.filter((entry) => {
    if (eng && !entry.engines.includes(eng)) return false;
    if (!q) return true;
    return (
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.category.toLowerCase().includes(q) ||
      entry.signature.toLowerCase().includes(q)
    );
  });
}

export interface ToolCommandArgSchema {
  name: string;
  type: 'path_data' | 'path_tag' | 'path_file' | 'enum' | 'string' | 'optional_string';
  description: string;
  required: boolean;
  values?: string[];
}

export interface ToolCommandSchema {
  name: string;
  category: string;
  description: string;
  example: string;
  args: ToolCommandArgSchema[];
}

const DEFAULT_HALOCE_TOOL_COMMANDS: ToolCommandSchema[] = [
  {
    name: 'build-cache-file',
    category: 'Cache Files',
    description: 'Compiles a scenario tag and all referenced loose tags in tags\\ into a playable .map cache file.',
    example: 'tool build-cache-file "levels\\test\\bloodgulch\\bloodgulch"',
    args: [
      {
        name: 'scenario-path',
        type: 'path_tag',
        description: 'Tag-relative path to the .scenario tag (without extension).',
        required: true,
      },
    ],
  },
  {
    name: 'structure',
    category: 'Structure & Lightmaps',
    description: 'Compiles a level geometry .jms file in data\\ into a scenario_structure_bsp (.sbsp) tag.',
    example: 'tool structure "levels\\test\\bloodgulch" "bloodgulch"',
    args: [
      {
        name: 'scenario-directory',
        type: 'path_data',
        description: 'Data directory containing the models\\ subfolder.',
        required: true,
      },
      {
        name: 'bsp-name',
        type: 'string',
        description: 'Name of the JMS file to compile into a scenario_structure_bsp.',
        required: true,
      },
    ],
  },
  {
    name: 'lightmaps',
    category: 'Structure & Lightmaps',
    description: 'Runs radiosity lightmap baking for a scenario BSP.',
    example: 'tool lightmaps "levels\\test\\bloodgulch\\bloodgulch" bloodgulch 0 0.1',
    args: [
      {
        name: 'scenario',
        type: 'path_tag',
        description: 'Scenario tag path (without extension).',
        required: true,
      },
      {
        name: 'bsp-name',
        type: 'string',
        description: 'BSP name.',
        required: true,
      },
      {
        name: 'quality',
        type: 'enum',
        description: '0 = draft, 1 = high quality.',
        required: true,
        values: ['0', '1'],
      },
      {
        name: 'stop-threshold',
        type: 'string',
        description: 'Radiosity stop threshold (e.g. 0.1 for draft, 0.001 for final).',
        required: true,
      },
    ],
  },
  {
    name: 'bitmaps',
    category: 'Bitmaps',
    description: 'Bulk-compiles a folder of .tif/.tiff images in data\\ into .bitmap tags in tags\\.',
    example: 'tool bitmaps "weapons\\pistol\\bitmaps"',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Data directory containing .tif/.tiff images.',
        required: true,
      },
    ],
  },
  {
    name: 'model',
    category: 'Models & Physics',
    description: 'Compiles model .jms files in data\\<dir>\\models\\ into a .gbxmodel tag.',
    example: 'tool model "weapons\\pistol"',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Asset folder under data\\.',
        required: true,
      },
    ],
  },
  {
    name: 'collision-geometry',
    category: 'Models & Physics',
    description: 'Compiles collision .jms files in data\\<dir>\\physics\\ into a .model_collision_geometry tag.',
    example: 'tool collision-geometry "weapons\\pistol"',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Asset folder under data\\.',
        required: true,
      },
    ],
  },
  {
    name: 'physics',
    category: 'Models & Physics',
    description: 'Compiles #mass_* sphere markers in data\\<dir>\\physics\\physics.jms into a .physics tag.',
    example: 'tool physics "vehicles\\warthog"',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Asset folder under data\\.',
        required: true,
      },
    ],
  },
  {
    name: 'animations',
    category: 'Models & Physics',
    description: 'Compiles .jma/.jmm/.jmt/.jmo/.jmr/.jmw/.jmz skeletal animations into a .model_animations tag.',
    example: 'tool animations "characters\\cyborg"',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Asset folder under data\\.',
        required: true,
      },
    ],
  },
  {
    name: 'sounds',
    category: 'Sounds',
    description: 'Compiles 16-bit WAV/Ogg files in data\\<dir>\\ into a .sound tag.',
    example: 'tool sounds "weapons\\pistol\\fire" ogg 1',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Sound directory under data\\.',
        required: true,
      },
      {
        name: 'platform',
        type: 'enum',
        description: 'Audio codec (ogg, wav, xbox).',
        required: true,
        values: ['ogg', 'wav', 'xbox'],
      },
      {
        name: 'ogg-quality',
        type: 'optional_string',
        description: 'Quality (0.0..1.0) when platform is ogg.',
        required: false,
      },
    ],
  },
  {
    name: 'unicode-strings',
    category: 'Strings & HUD',
    description: 'Compiles UTF-16LE .txt files (terminated by ###END-STRING###) into a .unicode_string_list tag.',
    example: 'tool unicode-strings "ui\\mp_map_ui"',
    args: [
      {
        name: 'source-directory',
        type: 'path_data',
        description: 'Directory under data\\ containing .txt files.',
        required: true,
      },
    ],
  },
  {
    name: 'hud-messages',
    category: 'Strings & HUD',
    description: 'Compiles UTF-16LE .hmt text files into a .hud_message_text tag.',
    example: 'tool hud-messages "levels\\a10" "a10"',
    args: [
      {
        name: 'path',
        type: 'path_data',
        description: 'Scenario folder under data\\.',
        required: true,
      },
      {
        name: 'scenario-name',
        type: 'string',
        description: 'Name of the .hmt file.',
        required: true,
      },
    ],
  },
];

/**
 * Loads the `tool.exe` command schema catalog for the specified Halo game (`haloce`, `haloce_mcc`,
 * `halo2_mcc`, `halo3_mcc`, `halo3odst_mcc`, `haloreach_mcc`), reading from `SAMPLE CODE/Baboon/tool_commands`
 * when present and merging with the built-in curated Halo CE command schemas.
 */
export function getToolCommandCatalog(
  game: 'haloce' | 'haloce_mcc' | 'halo2_mcc' | 'halo3_mcc' | 'halo3odst_mcc' | 'haloreach_mcc' | string = 'haloce_mcc',
): ToolCommandSchema[] {
  const gameAlias: Record<string, string> = {
    h1: 'haloce_mcc',
    h2: 'halo2_mcc',
    h3: 'halo3_mcc',
    odst: 'halo3odst_mcc',
    hr: 'haloreach_mcc',
  };
  const resolvedGame = gameAlias[game] ?? game;
  const candidates = [
    path.resolve(process.cwd(), 'SAMPLE CODE', 'Baboon', 'tool_commands', `${resolvedGame}.json`),
    path.resolve(process.cwd(), '..', 'SAMPLE CODE', 'Baboon', 'tool_commands', `${resolvedGame}.json`),
    `C:\\Users\\LeviB\\Projects\\OpenCE-Mantle\\SAMPLE CODE\\Baboon\\tool_commands\\${resolvedGame}.json`,
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { commands?: ToolCommandSchema[] };
        if (Array.isArray(parsed.commands) && parsed.commands.length > 0) {
          // Enrich any empty-arg commands with our curated arg schemas if names match
          const curatedByName = new Map(DEFAULT_HALOCE_TOOL_COMMANDS.map((c) => [c.name, c]));
          return parsed.commands.map((cmd) => {
            const curated = curatedByName.get(cmd.name);
            if (curated && (!cmd.args || cmd.args.length === 0)) {
              return {
                ...cmd,
                category: curated.category !== 'Advanced / Unknown' ? curated.category : cmd.category,
                args: curated.args,
              };
            }
            return cmd;
          });
        }
      }
    } catch {
      // Fallback to built-in catalog
    }
  }

  return DEFAULT_HALOCE_TOOL_COMMANDS;
}
