/**
 * Milestone 5, Step A: ADD-mode tag injection. Reads a `.ocetags` container (M4) and writes its
 * tags into a COPY of a target map's buffer (caller writes the result via temp-file-then-rename;
 * this module never touches disk).
 *
 * KEY STRUCTURAL FINDING (cited, verified against the real game-compatible map READER, not just
 * the builder): every pointer in the tag-data region resolves via ONE global anchor,
 * `base_memory_address = tag_array_address - 0x28` (invader/src/map/map.cpp line 244,
 * `Map::base_memory_address = tag_data_header->tag_array_address - sizeof(CacheFileTagDataHeaderPC)`,
 * confirmed identical to this project's own `tag-index.ts` `baseMemoryAddress` derivation after
 * algebraic simplification). Growing the tag array (to add new entries) necessarily shifts every
 * byte physically located after it by `delta = addedCount * TAG_ENTRY_SIZE` - but because
 * `base_memory_address` is derived from the SINGLE stored `tag_array_address` field, decrementing
 * that one field by `delta` re-anchors EVERY existing pointer (reflexive, tag-path, tag-data) to
 * the shifted positions automatically, with NO per-tag/per-pointer rewriting needed anywhere in
 * the untouched existing tag data. Verified empirically: `tag-injector.test.ts` re-parses the
 * injected output with this project's own reader and validates every old AND new tag's full
 * struct+reflexive closure resolves correctly.
 *
 * NOT part of Step A (left for later/flagged, never done silently):
 * - Embedded (external=0) bitmap/sound raw data relocation: see `relocateEmbeddedRawData` below
 *   - disabled, blocks ADD for any such tag instead.
 * - Adding brand-new whole-tag-external (resource-map-indexed) entries: an 'external' dependency
 *   that doesn't already exist in the target map blocks the dependent tag (missing dependency),
 *   it is not auto-created.
 * - CRC32 / tag checksum recalculation: that is Milestone 6's job. This module leaves both
 *   fields byte-for-byte as in the target map and the caller must surface them as stale.
 */
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';
import { fourCCFromString, lookupTagClassByName } from '../constants/tag-classes';
import type { CacheFileHeader } from './header';
import type { TagIndex, TagIndexEntry } from './tag-index';
import { resolveStruct, decodeStruct, resolvePointer } from './definitions/engine';
import { decodeReflexive, decodeDependency, encodeDependency } from './definitions/codec';
import type { OceContainer, OceContainerTag, ExternalResourceRef } from './container';
import type { ExtractedDependencyRef } from './tag-extractor';
import type { ResourceMapIdentity } from './resource-map';
import { resourceMapIdentitiesMatch } from './resource-map';

const NULL_TAG_ID = 0xffffffff;

export function normalizeTagPath(path: string): string {
  return path.toLowerCase().replace(/\//g, '\\');
}

function tagKey(path: string, group: string): string {
  return `${normalizeTagPath(path)}|${group}`;
}

/** Mirrors invader/src/build/build_workload.cpp line 1230: `((index + 0x6174) | 0x8000) << 16 | index`. */
export function computeNewTagId(index: number): number {
  const salt = ((index + 0x6174) | 0x8000) & 0xffff;
  return ((salt << 16) | (index & 0xffff)) >>> 0;
}

export interface ResourceMapConfig {
  bitmaps?: { identity: ResourceMapIdentity };
  sounds?: { identity: ResourceMapIdentity };
  loc?: { identity: ResourceMapIdentity };
}

const RESOURCE_MAP_KEY: Record<string, keyof ResourceMapConfig> = {
  'bitmaps.map': 'bitmaps',
  'sounds.map': 'sounds',
  'loc.map': 'loc',
};

export interface BlockedTagInfo {
  localIndex: number;
  path: string;
  group: string;
  reasons: string[];
}

export interface ExternalRefStatusInfo {
  localIndex: number;
  path: string;
  resourceMap: string;
  status: 'match' | 'mismatch' | 'unconfigured-on-target' | 'unverified-at-extraction';
}

export interface RefusedRootInfo {
  originalIndex: number;
  path: string;
  reasons: string[];
}

export interface AddInjectionCounts {
  totalInClosure: number;
  reused: number;
  added: number;
  blockedEmbedded: number;
  blockedOther: number;
  externalReferenced: number;
}

export interface AddInjectionPlan {
  kind: 'ok';
  /** Container tags that will be written as new entries, in the order they will be added. */
  toAdd: OceContainerTag[];
  toAddLocalIndices: number[];
  /** local container index -> tagId of an already-existing equivalent tag reused in the target. */
  reusedByLocalIndex: Map<number, number>;
  /** local container index -> tagId it will be assigned (reused OR newly added) - the full resolution map used to rewrite dependencies. */
  resolvedTagIdByLocalIndex: Map<number, number>;
  blockedEmbedded: BlockedTagInfo[];
  blockedOther: BlockedTagInfo[];
  externalRefStatuses: ExternalRefStatusInfo[];
  refusedRoots: RefusedRootInfo[];
  counts: AddInjectionCounts;
}

export interface AddInjectionRefusal {
  kind: 'refused';
  reason: string;
}

export type AddInjectionPlanResult = AddInjectionPlan | AddInjectionRefusal;

const OCETAGS_SUPPORTED_MAX_VERSION = 2;

/**
 * Dry-run: decides what would be reused/added/blocked, without allocating or writing any bytes.
 * Never mutates its inputs.
 */
export function planAddInjection(targetTagIndex: TagIndex, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}): AddInjectionPlanResult {
  if (container.formatVersion > OCETAGS_SUPPORTED_MAX_VERSION) {
    return { kind: 'refused', reason: `This .ocetags container is format version ${container.formatVersion}, newer than this build supports (${OCETAGS_SUPPORTED_MAX_VERSION}). Update OpenCE.` };
  }
  if (container.hasUnresolvedBspReferences) {
    return { kind: 'refused', reason: 'This container has unresolved BSP references (it was extracted with a BSP in the selection). Re-extract without the scenario/BSP before injecting.' };
  }

  const targetByKey = new Map<string, TagIndexEntry>();
  for (const e of targetTagIndex.entries) targetByKey.set(tagKey(e.path, e.primaryClassName ?? ''), e);

  const reusedByLocalIndex = new Map<number, number>();
  const candidateAdd = new Set<number>();
  for (let li = 0; li < container.tags.length; li++) {
    const t = container.tags[li];
    const existing = targetByKey.get(tagKey(t.path, t.group));
    if (existing) reusedByLocalIndex.set(li, existing.tagId);
    else candidateAdd.add(li);
  }

  const embeddedWarningsByOriginal = new Map<number, string[]>();
  for (const w of container.warnings) {
    if (w.kind !== 'embeddedRawData') continue;
    if (!embeddedWarningsByOriginal.has(w.originalIndex)) embeddedWarningsByOriginal.set(w.originalIndex, []);
    embeddedWarningsByOriginal.get(w.originalIndex)!.push(w.message);
  }

  const blockedReasons = new Map<number, string[]>();
  const blockedEmbeddedSet = new Set<number>();
  for (const li of candidateAdd) {
    const t = container.tags[li];
    const msgs = embeddedWarningsByOriginal.get(t.originalIndex);
    if (msgs && msgs.length > 0) {
      blockedEmbeddedSet.add(li);
      blockedReasons.set(li, [`Relocation of embedded (non-shared) bitmap/sound data is disabled this milestone: ${msgs.join('; ')}`]);
    }
  }

  // Fixed-point cascade: a candidate that depends (internally) on a blocked/unreusable tag, or
  // on an 'external'/'unresolved'/'notExtracted' dependency the target doesn't have, is blocked too.
  const blocked = new Set<number>(blockedEmbeddedSet);
  let changed = true;
  while (changed) {
    changed = false;
    for (const li of candidateAdd) {
      if (blocked.has(li)) continue;
      const t = container.tags[li];
      for (const dep of t.dependencies as ExtractedDependencyRef[]) {
        if (dep.kind === 'null') continue;
        if (dep.kind === 'internal' && dep.localTagIndex !== undefined) {
          if (reusedByLocalIndex.has(dep.localTagIndex)) continue;
          if (candidateAdd.has(dep.localTagIndex) && !blocked.has(dep.localTagIndex)) continue;
          if (!blockedReasons.has(li)) blockedReasons.set(li, []);
          blockedReasons.get(li)!.push(`Depends on "${dep.path}" which could not be added (${(blockedReasons.get(dep.localTagIndex) ?? ['unresolvable']).join('; ')}).`);
          blocked.add(li);
          changed = true;
        } else if (dep.kind === 'external') {
          if (targetByKey.has(tagKey(dep.path, dep.group))) continue;
          if (!blockedReasons.has(li)) blockedReasons.set(li, []);
          blockedReasons.get(li)!.push(`Depends on "${dep.path}" (${dep.group}), a resource-map tag not present in the target map. Adding new resource-map references isn't supported this milestone.`);
          blocked.add(li);
          changed = true;
        } else if (dep.kind === 'unresolved' || dep.kind === 'notExtracted') {
          if (!blockedReasons.has(li)) blockedReasons.set(li, []);
          blockedReasons.get(li)!.push(`Has a ${dep.kind} dependency on "${dep.path}" from extraction time - cannot be safely injected.`);
          blocked.add(li);
          changed = true;
        }
      }
    }
  }

  const toAddLocalIndices = Array.from(candidateAdd).filter((li) => !blocked.has(li)).sort((a, b) => a - b);
  const blockedEmbedded: BlockedTagInfo[] = Array.from(blockedEmbeddedSet).map((li) => ({
    localIndex: li,
    path: container.tags[li].path,
    group: container.tags[li].group,
    reasons: blockedReasons.get(li) ?? [],
  }));
  const blockedOther: BlockedTagInfo[] = Array.from(blocked)
    .filter((li) => !blockedEmbeddedSet.has(li))
    .map((li) => ({ localIndex: li, path: container.tags[li].path, group: container.tags[li].group, reasons: blockedReasons.get(li) ?? [] }));

  const resolvedTagIdByLocalIndex = new Map<number, number>(reusedByLocalIndex);
  const oldTagCount = targetTagIndex.entries.length;
  toAddLocalIndices.forEach((li, i) => resolvedTagIdByLocalIndex.set(li, computeNewTagId(oldTagCount + i)));

  const externalRefStatuses: ExternalRefStatusInfo[] = (container.externalResourceRefs ?? []).map((ref: ExternalResourceRef) => {
    const t = container.tags[ref.tagIndex];
    const configKey = RESOURCE_MAP_KEY[ref.resourceMap];
    const targetIdentity = configKey ? resourceMapConfig[configKey]?.identity : undefined;
    const sourceIdentity = configKey ? container.resourceMapIdentities?.[configKey] : undefined;
    let status: ExternalRefStatusInfo['status'];
    if (!targetIdentity) status = 'unconfigured-on-target';
    else if (!sourceIdentity) status = 'unverified-at-extraction';
    else status = resourceMapIdentitiesMatch(sourceIdentity, targetIdentity) ? 'match' : 'mismatch';
    return { localIndex: ref.tagIndex, path: t.path, resourceMap: ref.resourceMap, status };
  });

  const refusedRoots: RefusedRootInfo[] = [];
  for (const rootOriginal of container.rootOriginalIndices) {
    const li = container.tags.findIndex((t) => t.originalIndex === rootOriginal);
    if (li === -1) continue;
    if (blocked.has(li)) {
      refusedRoots.push({ originalIndex: rootOriginal, path: container.tags[li].path, reasons: blockedReasons.get(li) ?? [] });
    }
  }

  return {
    kind: 'ok',
    toAdd: toAddLocalIndices.map((li) => container.tags[li]),
    toAddLocalIndices,
    reusedByLocalIndex,
    resolvedTagIdByLocalIndex,
    blockedEmbedded,
    blockedOther,
    externalRefStatuses,
    refusedRoots,
    counts: {
      totalInClosure: container.tags.length,
      reused: reusedByLocalIndex.size,
      added: toAddLocalIndices.length,
      blockedEmbedded: blockedEmbedded.length,
      blockedOther: blockedOther.length,
      externalReferenced: externalRefStatuses.length,
    },
  };
}

/** Recursively rewrites one newly-added tag's own buffer in place: TagDependency.tagId fields are remapped to the target map's resolved tagIds, and TagReflexive pointers (currently LOCAL byte offsets from extraction) become real virtual addresses for their final position in the target file. `tagBaseAbsolute` is the tag's own fixed absolute position in `data` (constant across the whole recursive call tree); `localOffset` is this struct instance's absolute position in `data`. */
function rewriteAddedTagData(
  data: Buffer,
  structName: string,
  localOffset: number,
  dependencies: ExtractedDependencyRef[],
  depCursor: { value: number },
  translation: number,
  tagBaseAbsolute: number,
  resolveDepTagId: (dep: ExtractedDependencyRef) => number,
): void {
  const resolved = resolveStruct(structName);
  const decoded = decodeStruct(data, localOffset, structName);
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    const absFieldOffset = localOffset + field.offset;
    if (value.kind === 'dependency') {
      const dep = dependencies[depCursor.value++];
      if (value.value.tagId !== NULL_TAG_ID) {
        const newTagId = resolveDepTagId(dep);
        const decodedDep = decodeDependency(data, absFieldOffset);
        encodeDependency(data, absFieldOffset, { ...decodedDep, pathPointer: 0, pathSize: 0, tagId: newTagId });
      }
    } else if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const oldLocalChildBase = value.value.pointerLow; // offset relative to the tag's OWN extracted buffer (0-based)
      const newPointer = (oldLocalChildBase + translation) >>> 0;
      data.writeUInt32LE(newPointer, absFieldOffset + 4);
      data.writeUInt32LE(0, absFieldOffset + 8);
      const childAbsoluteBase = tagBaseAbsolute + oldLocalChildBase;
      for (let i = 0; i < value.value.count; i++) {
        rewriteAddedTagData(data, childStructName, childAbsoluteBase + i * childSize, dependencies, depCursor, translation, tagBaseAbsolute, resolveDepTagId);
      }
    }
  }
}

/**
 * Performs the structural rewrite: grows the tag array, re-anchors `tag_array_address` so every
 * EXISTING tag's pointers keep resolving correctly with zero per-pointer rewriting (see module
 * doc), appends the new tags' struct data + path strings, and returns a brand-new Buffer. Never
 * mutates `targetBuffer`. Caller is responsible for writing the result via temp-file-then-rename
 * and for treating `crc32`/`tagFileChecksums` as stale (Milestone 6).
 */
export function applyAddInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: AddInjectionPlan): Buffer {
  const addedCount = plan.toAdd.length;
  if (addedCount === 0) return Buffer.from(targetBuffer);

  const subHeaderOffset = targetHeader.tagDataOffset;
  const arrayOffset = subHeaderOffset + TAG_DATA_HEADER_PC_SIZE;
  const oldTagCount = targetTagIndex.entries.length;
  const oldStructDataOffset = arrayOffset + oldTagCount * TAG_ENTRY_SIZE;
  const oldFileLength = targetBuffer.length;
  const delta = addedCount * TAG_ENTRY_SIZE;

  const oldTagArrayAddress = targetBuffer.readUInt32LE(subHeaderOffset + 0x00);
  const newTagArrayAddress = (oldTagArrayAddress - delta) >>> 0;
  const newBaseMemoryAddress = (newTagArrayAddress - TAG_DATA_HEADER_PC_SIZE) >>> 0;

  const dataBuffers = plan.toAdd.map((t) => Buffer.from(t.data, 'base64'));
  const structDataStart = oldFileLength + delta;
  const structOffsets: number[] = [];
  let running = structDataStart;
  for (const b of dataBuffers) {
    structOffsets.push(running);
    running += b.length;
  }
  const pathRegionStart = running;
  const pathOffsets: number[] = [];
  const pathBuffers = plan.toAdd.map((t) => Buffer.from(`${t.path}\0`, 'ascii'));
  for (const b of pathBuffers) {
    pathOffsets.push(running);
    running += b.length;
  }
  const newFileLength = running;

  const out = Buffer.alloc(newFileLength);
  targetBuffer.copy(out, 0, 0, arrayOffset); // header + BSP + raw-data + model-data + sub-header, byte-for-byte
  out.writeUInt32LE(newTagArrayAddress, subHeaderOffset + 0x00);
  out.writeUInt32LE(oldTagCount + addedCount, subHeaderOffset + 0x0c);

  targetBuffer.copy(out, arrayOffset, arrayOffset, oldStructDataOffset); // existing array entries, UNTOUCHED (re-anchored, not rewritten)
  targetBuffer.copy(out, oldStructDataOffset + delta, oldStructDataOffset, oldFileLength); // existing struct/path-string data, shifted but UNTOUCHED

  for (let i = 0; i < addedCount; i++) {
    const t = plan.toAdd[i];
    const entryOffset = oldStructDataOffset + i * TAG_ENTRY_SIZE;
    const classInfo = lookupTagClassByName(t.group);
    if (!classInfo) throw new Error(`Unknown tag group "${t.group}" - cannot write a tag index entry for it.`);
    const primaryFourCC = fourCCFromString(classInfo.groupId);
    const secondary = t.secondaryClassFourCC ?? 0xffffffff;
    const tertiary = t.tertiaryClassFourCC ?? 0xffffffff;
    out.writeUInt32LE(primaryFourCC, entryOffset + 0x00);
    out.writeUInt32LE(secondary === null ? 0xffffffff : secondary, entryOffset + 0x04);
    out.writeUInt32LE(tertiary === null ? 0xffffffff : tertiary, entryOffset + 0x08);
    const tagId = plan.resolvedTagIdByLocalIndex.get(plan.toAddLocalIndices[i])!;
    out.writeUInt32LE(tagId, entryOffset + 0x0c);
    const pathPointer = newBaseMemoryAddress + (pathOffsets[i] - subHeaderOffset);
    out.writeUInt32LE(pathPointer >>> 0, entryOffset + 0x10);
    const dataPointer = newBaseMemoryAddress + (structOffsets[i] - subHeaderOffset);
    out.writeUInt32LE(dataPointer >>> 0, entryOffset + 0x14);
    out.writeUInt32LE(0, entryOffset + 0x18); // isExternal = false, Step A never adds resource-map-indexed entries

    dataBuffers[i].copy(out, structOffsets[i]);
    pathBuffers[i].copy(out, pathOffsets[i]);

    const translation = (newBaseMemoryAddress - subHeaderOffset + structOffsets[i]) >>> 0;
    const depCursor = { value: 0 };
    rewriteAddedTagData(out, t.structName, structOffsets[i], t.dependencies as ExtractedDependencyRef[], depCursor, translation, structOffsets[i], (dep) => {
      if (dep.kind === 'internal' && dep.localTagIndex !== undefined) {
        const resolved = plan.resolvedTagIdByLocalIndex.get(dep.localTagIndex);
        if (resolved === undefined) throw new Error(`Internal error: dependency to local tag ${dep.localTagIndex} was not resolved before applying injection.`);
        return resolved;
      }
      if (dep.kind === 'external') {
        const match = targetTagIndex.entries.find((e) => normalizeTagPath(e.path) === normalizeTagPath(dep.path) && e.primaryClassName === dep.group);
        if (!match) throw new Error(`Internal error: external dependency to "${dep.path}" was not validated as present in the target before applying injection.`);
        return match.tagId;
      }
      throw new Error(`Internal error: tag "${t.path}" reached applyAddInjection with an unresolved/notExtracted dependency - planAddInjection should have blocked it.`);
    });
  }

  out.writeUInt32LE(newFileLength, 0x8); // decompressedFileSize
  out.writeUInt32LE(newFileLength - subHeaderOffset, 0x14); // tagDataSize
  // crc32 (0x64) and the sub-header's tagFileChecksums (subHeaderOffset+0x08) are left byte-for-byte
  // as in the target map - both are stale after this write; recalculating them is Milestone 6.

  return out;
}

/**
 * DISABLED. Relocating embedded (external=0) bitmap/sound raw data requires re-deriving where
 * a map's raw-data region starts, which is NOT stored anywhere in a compiled map (confirmed:
 * it's the implicit gap between `end_of_bsps` and `model_offset` in
 * invader/src/build/build_workload.cpp's `generate_final_data` lambda, lines ~278-300 - neither
 * boundary is an explicit header field, unlike `model_data_file_offset` which IS stored).
 * Reconstructing it from a compiled file alone is under-determined without more research. Never
 * called by `planAddInjection`/`applyAddInjection`; covered only by its own synthetic-fixture
 * test (`relocation-synthetic.test.ts`), which must stay separate from "verified against real
 * bytes" per project rules - neither sample map contains a single real embedded bitmap/sound to
 * verify against (confirmed: scanned all 222 internal ui.map bitmaps + 125 ui.map sound
 * permutations, 100% external=1; bloodgulch.map has zero internal bitmap/sound tags at all).
 */
export function relocateEmbeddedRawData(): never {
  throw new Error('relocateEmbeddedRawData is disabled this milestone - see tag-injector.ts module doc.');
}
