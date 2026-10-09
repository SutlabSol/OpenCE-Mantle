/**
 * Milestone 5: tag injection. Reads a `.ocetags` container (M4) and writes its tags into a COPY
 * of a target map's buffer (caller writes the result via temp-file-then-rename; this module
 * never touches disk). Two modes, picked by the caller for the whole operation (`mode` param -
 * per-tag choice is Step C's conflict dialog, not built yet):
 * - **Step A, ADD** (done): a container tag whose normalized path+class already exists in the
 *   target is REUSED (left untouched) - nothing is overwritten, only genuinely new tags appended.
 * - **Step B, SWAP** (done this session): a container tag whose normalized path+class already
 *   exists in the target instead REPLACES that existing tag's struct data, while KEEPING the
 *   existing tag's tagId/array position/path pointer/primary class UNCHANGED - any other tag in
 *   the target that already references it by tagId keeps resolving correctly, now to the new
 *   content. This is what lets you test an injected/edited tag in-game without adding a new
 *   scenario placement: swap it into an existing stock tag at the same path (e.g. a retextured
 *   pistol back into "weapons\pistol\pistol") and the map's existing placements pick it up
 *   immediately. A matched tag that CAN'T be swapped (embedded-data/missing-dependency block, or
 *   the target entry is itself whole-tag-external with no struct to repoint) falls back to being
 *   left untouched (same as ADD's "reused") - it is reported in both `reused` (nothing changed)
 *   AND the relevant blocked list (why the swap you asked for didn't happen), which is
 *   intentionally not mutually exclusive.
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
 * struct+reflexive closure resolves correctly. SWAP mode reuses this exact mechanism - only the
 * swapped entries' OWN `tagDataPointerOrResourceIndex`/secondary/tertiary class fields are patched
 * in place (tagId/path/primary class untouched), new struct data is appended the same way ADD's is.
 * Because a matched tag's tagId NEVER changes in SWAP mode (whether the swap for that one tag
 * succeeds or falls back to untouched), nothing that depends on a matched tag by internal
 * reference can ever be blocked by that matched tag's own swap outcome - only true appends
 * (`toAdd`) participate in the block-cascade.
 *
 * NOT part of Step A/B (left for later/flagged, never done silently):
 * - Embedded (external=0) bitmap/sound raw data relocation: implemented (see `applyInjection`'s
 *   doc for the mechanism) but stays behind `InjectionOptions.allowEmbeddedRelocation`, which
 *   defaults to false and is never set by `map-worker.ts` - test-only until the user approves
 *   turning it on for real. `planInjection` blocks these tags exactly as before while the option
 *   is off.
 * - Adding brand-new whole-tag-external (resource-map-indexed) entries: an 'external' dependency
 *   that doesn't already exist in the target map blocks the dependent tag (missing dependency),
 *   it is not auto-created. Swapping INTO an existing whole-tag-external entry is also refused
 *   (there is no struct-data pointer to repoint) - falls back to untouched, reported as blocked.
 * - Conflict dialog (skip/replace/rename + "apply to all"): Step C, not built yet - for now the
 *   caller picks ADD or SWAP for the whole operation via the `mode` parameter.
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

export type InjectionMode = 'add' | 'swap';

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

/** A matched tag (SWAP mode only) whose struct data will be replaced in place - tagId/path/primary class stay unchanged. */
export interface SwappedTagInfo {
  localIndex: number;
  path: string;
  group: string;
  /** The existing target tag's stable id and array position - never changes. */
  targetTagId: number;
  targetOriginalIndex: number;
}

export interface InjectionCounts {
  totalInClosure: number;
  reused: number;
  swapped: number;
  added: number;
  blockedEmbedded: number;
  blockedOther: number;
  externalReferenced: number;
}

export interface InjectionPlan {
  kind: 'ok';
  mode: InjectionMode;
  /** Container tags that will be written as brand-new entries, in the order they will be added. */
  toAdd: OceContainerTag[];
  toAddLocalIndices: number[];
  /** SWAP mode only: matched tags whose struct data will be replaced in place. Always empty in ADD mode. */
  toSwap: SwappedTagInfo[];
  /** local container index -> tagId of an already-existing equivalent tag left untouched (ADD: every match; SWAP: only matches that couldn't be swapped - see module doc). */
  reusedByLocalIndex: Map<number, number>;
  /** local container index -> tagId it will be assigned (reused, swapped-in-place, OR newly added) - the full resolution map used to rewrite dependencies. */
  resolvedTagIdByLocalIndex: Map<number, number>;
  blockedEmbedded: BlockedTagInfo[];
  blockedOther: BlockedTagInfo[];
  externalRefStatuses: ExternalRefStatusInfo[];
  refusedRoots: RefusedRootInfo[];
  counts: InjectionCounts;
}

export interface InjectionRefusal {
  kind: 'refused';
  reason: string;
}

export type InjectionPlanResult = InjectionPlan | InjectionRefusal;

/** @deprecated kept as an alias - use `InjectionPlan` (now shared by ADD and SWAP). */
export type AddInjectionPlan = InjectionPlan;
/** @deprecated kept as an alias - use `InjectionPlanResult`. */
export type AddInjectionPlanResult = InjectionPlanResult;
/** @deprecated kept as an alias - use `InjectionRefusal`. */
export type AddInjectionRefusal = InjectionRefusal;
/** @deprecated kept as an alias - use `InjectionCounts`. */
export type AddInjectionCounts = InjectionCounts;

const OCETAGS_SUPPORTED_MAX_VERSION = 3;

function warningMessagesOfKind(container: OceContainer, kind: string): Map<number, string[]> {
  const byOriginal = new Map<number, string[]>();
  for (const w of container.warnings) {
    if (w.kind !== kind) continue;
    if (!byOriginal.has(w.originalIndex)) byOriginal.set(w.originalIndex, []);
    byOriginal.get(w.originalIndex)!.push(w.message);
  }
  return byOriginal;
}

function embeddedWarningMessages(container: OceContainer): Map<number, string[]> {
  return warningMessagesOfKind(container, 'embeddedRawData');
}

/** local container index -> how many embedded bitmap/sound patches this container actually captured for that tag (0 for v1/v2 containers, or a v3 capture that failed validation - see `tag-extractor.ts`). */
function embeddedCapturedCounts(container: OceContainer): Map<number, number> {
  const byOriginal = new Map<number, number>();
  for (const t of container.tags) byOriginal.set(t.originalIndex, t.embeddedRawDataPatches?.length ?? 0);
  return byOriginal;
}

export interface InjectionOptions {
  /**
   * Relocation of embedded (external=0) bitmap/sound raw data stays DISABLED (the default,
   * matching production) until explicitly approved - see PRD.md "Relocation research". Tests
   * may opt in explicitly; `map-worker.ts` (the real app) never passes this.
   */
  allowEmbeddedRelocation?: boolean;
}

/**
 * Dry-run: decides what would be reused/swapped/added/blocked, without allocating or writing
 * any bytes. Never mutates its inputs. `mode` applies to the whole operation (per-tag choice is
 * Step C, not built yet).
 */
export function planInjection(mode: InjectionMode, targetTagIndex: TagIndex, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}, options: InjectionOptions = {}): InjectionPlanResult {
  if (container.formatVersion > OCETAGS_SUPPORTED_MAX_VERSION) {
    return { kind: 'refused', reason: `This .ocetags container is format version ${container.formatVersion}, newer than this build supports (${OCETAGS_SUPPORTED_MAX_VERSION}). Update OpenCE.` };
  }
  if (container.hasUnresolvedBspReferences) {
    return { kind: 'refused', reason: 'This container has unresolved BSP references (it was extracted with a BSP in the selection). Re-extract without the scenario/BSP before injecting.' };
  }

  const targetByKey = new Map<string, TagIndexEntry>();
  for (const e of targetTagIndex.entries) targetByKey.set(tagKey(e.path, e.primaryClassName ?? ''), e);

  const matchedByLocalIndex = new Map<number, TagIndexEntry>();
  const candidateAdd = new Set<number>();
  for (let li = 0; li < container.tags.length; li++) {
    const t = container.tags[li];
    const existing = targetByKey.get(tagKey(t.path, t.group));
    if (existing) matchedByLocalIndex.set(li, existing);
    else candidateAdd.add(li);
  }

  const embeddedWarningsByOriginal = embeddedWarningMessages(container);
  const embeddedCapturedByOriginal = embeddedCapturedCounts(container);
  const uncapturedDataByOriginal = warningMessagesOfKind(container, 'uncapturedData');

  /** Unconditional - unlike embedded relocation, there is no opt-in for data the extractor structurally cannot carry at all (model geometry, an out-of-bounds pointer). Always blocks ADD and SWAP alike. */
  function uncapturedDataBlockReason(t: OceContainerTag): string | null {
    const msgs = uncapturedDataByOriginal.get(t.originalIndex);
    if (!msgs || msgs.length === 0) return null;
    return `This tag has data that cannot be captured or relocated: ${msgs.join('; ')}`;
  }

  /** null = not blocked by embedded data. Otherwise the reason to surface. */
  function embeddedBlockReason(t: OceContainerTag): string | null {
    const msgs = embeddedWarningsByOriginal.get(t.originalIndex);
    if (!msgs || msgs.length === 0) return null;
    if (!options.allowEmbeddedRelocation) {
      return `Relocation of embedded (non-shared) bitmap/sound data is disabled this milestone: ${msgs.join('; ')}`;
    }
    const captured = embeddedCapturedByOriginal.get(t.originalIndex) ?? 0;
    if (captured < msgs.length) {
      return `This container doesn't have the embedded bitmap/sound bytes captured for relocation (extracted by a build without this feature, or a capture mismatch at extraction time) - re-extract to enable relocation: ${msgs.join('; ')}`;
    }
    return null;
  }

  const blockedReasons = new Map<number, string[]>();
  const blockedEmbeddedSet = new Set<number>();
  const blockedUncapturedSet = new Set<number>();
  for (const li of candidateAdd) {
    const t = container.tags[li];
    const reasons: string[] = [];
    const uncaptured = uncapturedDataBlockReason(t);
    if (uncaptured) {
      blockedUncapturedSet.add(li);
      reasons.push(uncaptured);
    }
    const embedded = embeddedBlockReason(t);
    if (embedded) {
      blockedEmbeddedSet.add(li);
      reasons.push(embedded);
    }
    if (reasons.length > 0) blockedReasons.set(li, reasons);
  }

  // Fixed-point cascade over `toAdd` candidates only: a matched tag's tagId never changes
  // (whether swapped or left untouched - see module doc), so nothing depending on a matched tag
  // by internal reference can ever be blocked by it. Only true appends participate here.
  const blocked = new Set<number>([...blockedEmbeddedSet, ...blockedUncapturedSet]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const li of candidateAdd) {
      if (blocked.has(li)) continue;
      const t = container.tags[li];
      for (const dep of t.dependencies as ExtractedDependencyRef[]) {
        if (dep.kind === 'null') continue;
        if (dep.kind === 'internal' && dep.localTagIndex !== undefined) {
          if (matchedByLocalIndex.has(dep.localTagIndex)) continue;
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

  // SWAP mode only: decide, per matched tag, whether it can actually be swapped. Single pass
  // (no cascade needed - a matched tag's own block never propagates, per the finding above).
  const reusedByLocalIndex = new Map<number, number>();
  const toSwap: SwappedTagInfo[] = [];
  for (const [li, existing] of matchedByLocalIndex) {
    if (mode === 'add') {
      reusedByLocalIndex.set(li, existing.tagId);
      continue;
    }
    const t = container.tags[li];
    const reasons: string[] = [];
    if (existing.isExternal) {
      reasons.push(`The existing "${t.path}" (${t.group}) in the target is a resource-map-indexed (external) entry - there is no struct-data pointer to swap into. Left unchanged.`);
    }
    const embeddedBlockMsg = embeddedBlockReason(t);
    if (embeddedBlockMsg) {
      reasons.push(embeddedBlockMsg);
    }
    for (const dep of t.dependencies as ExtractedDependencyRef[]) {
      if (dep.kind === 'null') continue;
      if (dep.kind === 'internal' && dep.localTagIndex !== undefined) {
        if (matchedByLocalIndex.has(dep.localTagIndex)) continue;
        if (candidateAdd.has(dep.localTagIndex) && !blocked.has(dep.localTagIndex)) continue;
        reasons.push(`Depends on "${dep.path}" which could not be added (${(blockedReasons.get(dep.localTagIndex) ?? ['unresolvable']).join('; ')}).`);
      } else if (dep.kind === 'external') {
        if (targetByKey.has(tagKey(dep.path, dep.group))) continue;
        reasons.push(`Depends on "${dep.path}" (${dep.group}), a resource-map tag not present in the target map. Adding new resource-map references isn't supported this milestone.`);
      } else if (dep.kind === 'unresolved' || dep.kind === 'notExtracted') {
        reasons.push(`Has a ${dep.kind} dependency on "${dep.path}" from extraction time - cannot be safely injected.`);
      }
    }
    if (reasons.length > 0) {
      blockedReasons.set(li, reasons);
      blocked.add(li);
      if (embeddedBlockMsg) blockedEmbeddedSet.add(li);
      reusedByLocalIndex.set(li, existing.tagId); // swap requested but not possible - falls back to untouched
    } else {
      toSwap.push({ localIndex: li, path: t.path, group: t.group, targetTagId: existing.tagId, targetOriginalIndex: existing.index });
    }
  }

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
  for (const s of toSwap) resolvedTagIdByLocalIndex.set(s.localIndex, s.targetTagId);
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
    if (blocked.has(li) && !matchedByLocalIndex.has(li)) {
      // Pure "couldn't add" refusal (not applicable to matched/swap tags - those always resolve
      // to a stable existing tagId, they just surface in blockedEmbedded/blockedOther instead).
      refusedRoots.push({ originalIndex: rootOriginal, path: container.tags[li].path, reasons: blockedReasons.get(li) ?? [] });
    }
  }

  return {
    kind: 'ok',
    mode,
    toAdd: toAddLocalIndices.map((li) => container.tags[li]),
    toAddLocalIndices,
    toSwap,
    reusedByLocalIndex,
    resolvedTagIdByLocalIndex,
    blockedEmbedded,
    blockedOther,
    externalRefStatuses,
    refusedRoots,
    counts: {
      totalInClosure: container.tags.length,
      reused: reusedByLocalIndex.size,
      swapped: toSwap.length,
      added: toAddLocalIndices.length,
      blockedEmbedded: blockedEmbedded.length,
      blockedOther: blockedOther.length,
      externalReferenced: externalRefStatuses.length,
    },
  };
}

export function planAddInjection(targetTagIndex: TagIndex, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}, options: InjectionOptions = {}): InjectionPlanResult {
  return planInjection('add', targetTagIndex, container, resourceMapConfig, options);
}

export function planSwapInjection(targetTagIndex: TagIndex, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}, options: InjectionOptions = {}): InjectionPlanResult {
  return planInjection('swap', targetTagIndex, container, resourceMapConfig, options);
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

function makeResolveDepTagId(t: OceContainerTag, plan: InjectionPlan, targetTagIndex: TagIndex): (dep: ExtractedDependencyRef) => number {
  return (dep) => {
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
    throw new Error(`Internal error: tag "${t.path}" reached applyInjection with an unresolved/notExtracted dependency - planInjection should have blocked it.`);
  };
}

/**
 * Performs the structural rewrite: grows the tag array by `toAdd.length` (SWAP's `toSwap`
 * entries never change the tag count), re-anchors `tag_array_address` so every EXISTING tag's
 * pointers keep resolving correctly with zero per-pointer rewriting (see module doc), appends
 * every new/swapped tag's struct data (+ path strings for brand-new entries only - swapped
 * entries keep their existing path pointer), and returns a brand-new Buffer. Never mutates
 * `targetBuffer`. Caller is responsible for writing the result via temp-file-then-rename and for
 * treating `crc32`/`tagFileChecksums` as stale (Milestone 6).
 *
 * When `options.allowEmbeddedRelocation` is true (test-only until approved - see
 * `InjectionOptions`), also relocates every captured embedded (external=0) bitmap/sound asset
 * across `toAdd`/`toSwap`: the unique asset bytes are inserted once, zero-padded to a 4-byte
 * boundary, immediately before the target's own `modelDataFileOffset` (verified via real bytes
 * to always sit exactly at the end of the raw-data region, before model data - see PRD.md
 * "Relocation research"). That shifts model data + tag data forward by the inserted size;
 * exactly 4 stored header/sub-header fields need recomputing as a result - `modelDataFileOffset`,
 * `tagDataOffset`, `tagDataSize`, `decompressedFileSize` - everything else (every existing
 * TagReflexive/TagDependency pointer, `bsp_start`, model vertex/index pointers) resolves
 * correctly automatically via the SAME `tag_array_address`-anchored translation already used for
 * tag-array growth, because none of those are raw/absolute file offsets (confirmed against
 * invader/src/build/build_workload.cpp's generic pointer-fixup pass - every one of them is
 * written as a translated virtual address, not a literal file offset). The two true absolute
 * file offsets in the format - `bsp_start` and the embedded bitmap/sound offsets themselves -
 * are handled explicitly: `bsp_start` always resolves to BEFORE the insertion point (BSP data
 * precedes raw-data in every real map checked) so it never shifts; the embedded offsets are
 * patched directly via each tag's `embeddedRawDataPatches`.
 */
export function applyInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): Buffer {
  const addedCount = plan.toAdd.length;
  const swappedCount = plan.toSwap.length;
  if (addedCount === 0 && swappedCount === 0) return Buffer.from(targetBuffer);

  // Combined append list: brand-new entries first, then swapped-in-place entries - order is
  // arbitrary, both just append struct data past the (shifted) existing data region.
  const writeTags: OceContainerTag[] = [...plan.toAdd, ...plan.toSwap.map((s) => container.tags[s.localIndex])];

  if (!options.allowEmbeddedRelocation) {
    for (const t of writeTags) {
      if (t.embeddedRawDataPatches && t.embeddedRawDataPatches.length > 0) {
        throw new Error(`Internal error: "${t.path}" reached applyInjection() with embedded raw data to relocate, but allowEmbeddedRelocation is false - planInjection() should have blocked it.`);
      }
    }
  }

  const subHeaderOffset = targetHeader.tagDataOffset; // OLD position - read-anchor for everything below
  const arrayOffset = subHeaderOffset + TAG_DATA_HEADER_PC_SIZE;
  const oldTagCount = targetTagIndex.entries.length;
  const oldStructDataOffset = arrayOffset + oldTagCount * TAG_ENTRY_SIZE;
  const oldFileLength = targetBuffer.length;
  const delta = addedCount * TAG_ENTRY_SIZE; // only brand-new entries grow the tag array

  // Embedded relocation: every unique asset across toAdd/toSwap, inserted once right before
  // modelDataFileOffset, zero-padded to a 4-byte boundary - a harmless, defensive convention
  // (matches invader's REQUIRED_PADDING_32_BIT), NOT a confirmed hard requirement: real
  // coldsnap.map's own tagDataOffset/modelDataFileOffset are themselves NOT 4-aligned (both ≡ 2
  // mod 4). Padding preserves whatever alignment the source already had either way.
  const insertPos = targetTagIndex.modelDataFileOffset;
  const embeddedAssetBuffers: Buffer[] = options.allowEmbeddedRelocation
    ? writeTags.flatMap((t) => (t.embeddedRawDataAssets ?? []).map((a) => Buffer.from(a.data, 'base64')))
    : [];
  const embeddedBlobSize = embeddedAssetBuffers.reduce((n, b) => n + b.length, 0);
  const insertSize = embeddedBlobSize === 0 ? 0 : embeddedBlobSize + ((4 - (embeddedBlobSize % 4)) % 4);

  const oldTagArrayAddress = targetBuffer.readUInt32LE(subHeaderOffset + 0x00);
  const newTagArrayAddress = (oldTagArrayAddress - delta) >>> 0;
  const newBaseMemoryAddress = (newTagArrayAddress - TAG_DATA_HEADER_PC_SIZE) >>> 0;
  const newTagDataOffset = subHeaderOffset + insertSize;
  const newArrayOffset = arrayOffset + insertSize;

  const dataBuffers = writeTags.map((t) => Buffer.from(t.data, 'base64'));
  const structDataStart = oldFileLength + insertSize + delta;
  const structOffsets: number[] = [];
  let running = structDataStart;
  for (const b of dataBuffers) {
    structOffsets.push(running);
    running += b.length;
  }
  // Path strings only needed for brand-new entries - swapped entries reuse their existing path pointer.
  const pathOffsets: number[] = [];
  const pathBuffers = plan.toAdd.map((t) => Buffer.from(`${t.path}\0`, 'ascii'));
  for (const b of pathBuffers) {
    pathOffsets.push(running);
    running += b.length;
  }
  const newFileLength = running;

  const out = Buffer.alloc(newFileLength);
  targetBuffer.copy(out, 0, 0, insertPos); // header + BSP + rest of raw-data region, byte-for-byte, unmoved

  // Per-writeTags-index, per-asset -> the asset's final absolute file offset in `out`.
  const assetAbsoluteOffsets: number[][] = writeTags.map(() => []);
  if (insertSize > 0) {
    let cursor = insertPos;
    for (let i = 0; i < writeTags.length; i++) {
      for (const asset of writeTags[i].embeddedRawDataAssets ?? []) {
        const bytes = Buffer.from(asset.data, 'base64');
        bytes.copy(out, cursor);
        assetAbsoluteOffsets[i].push(cursor);
        cursor += bytes.length;
      }
    }
    // [cursor, insertPos + insertSize) is the alignment pad - left zero by Buffer.alloc.
  }

  targetBuffer.copy(out, insertPos + insertSize, insertPos, oldStructDataOffset); // rest of model data + sub-header + existing tag array, shifted by +insertSize ONLY (the tag-array growth insertion point is further along, handled next)
  targetBuffer.copy(out, oldStructDataOffset + insertSize + delta, oldStructDataOffset, oldFileLength); // existing struct/path-string data, shifted by +insertSize AND +delta

  out.writeUInt32LE(newTagArrayAddress, newTagDataOffset + 0x00);
  out.writeUInt32LE(oldTagCount + addedCount, newTagDataOffset + 0x0c);
  if (insertSize > 0) out.writeUInt32LE(insertPos + insertSize, newTagDataOffset + 0x14); // modelDataFileOffset

  for (let i = 0; i < addedCount; i++) {
    const t = plan.toAdd[i];
    const entryOffset = oldStructDataOffset + insertSize + i * TAG_ENTRY_SIZE;
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
    const pathPointer = newBaseMemoryAddress + (pathOffsets[i] - newTagDataOffset);
    out.writeUInt32LE(pathPointer >>> 0, entryOffset + 0x10);
    const dataPointer = newBaseMemoryAddress + (structOffsets[i] - newTagDataOffset);
    out.writeUInt32LE(dataPointer >>> 0, entryOffset + 0x14);
    out.writeUInt32LE(0, entryOffset + 0x18); // isExternal = false, this module never adds resource-map-indexed entries

    dataBuffers[i].copy(out, structOffsets[i]);
    pathBuffers[i].copy(out, pathOffsets[i]);

    const translation = (newBaseMemoryAddress - newTagDataOffset + structOffsets[i]) >>> 0;
    const depCursor = { value: 0 };
    rewriteAddedTagData(out, t.structName, structOffsets[i], t.dependencies as ExtractedDependencyRef[], depCursor, translation, structOffsets[i], makeResolveDepTagId(t, plan, targetTagIndex));
  }

  for (let j = 0; j < swappedCount; j++) {
    const s = plan.toSwap[j];
    const t = container.tags[s.localIndex];
    const i = addedCount + j; // index into writeTags/dataBuffers/structOffsets
    const entryOffset = newArrayOffset + s.targetOriginalIndex * TAG_ENTRY_SIZE; // EXISTING array slot, same relative position
    const secondary = t.secondaryClassFourCC ?? 0xffffffff;
    const tertiary = t.tertiaryClassFourCC ?? 0xffffffff;
    // tagId (0x0c), path pointer (0x10), primary class (0x00) and isExternal (0x18) are
    // INTENTIONALLY left unchanged - that's what makes this a swap, not a new tag.
    out.writeUInt32LE(secondary === null ? 0xffffffff : secondary, entryOffset + 0x04);
    out.writeUInt32LE(tertiary === null ? 0xffffffff : tertiary, entryOffset + 0x08);
    const dataPointer = newBaseMemoryAddress + (structOffsets[i] - newTagDataOffset);
    out.writeUInt32LE(dataPointer >>> 0, entryOffset + 0x14);

    dataBuffers[i].copy(out, structOffsets[i]);

    const translation = (newBaseMemoryAddress - newTagDataOffset + structOffsets[i]) >>> 0;
    const depCursor = { value: 0 };
    rewriteAddedTagData(out, t.structName, structOffsets[i], t.dependencies as ExtractedDependencyRef[], depCursor, translation, structOffsets[i], makeResolveDepTagId(t, plan, targetTagIndex));
  }

  // Patch every relocated embedded asset's new absolute file offset into its tag's own struct
  // bytes - the one place each mechanism's raw file-offset field lives (see
  // `embedded-data-fields.ts`). Must run AFTER the struct-data copies above.
  for (let i = 0; i < writeTags.length; i++) {
    for (const patch of writeTags[i].embeddedRawDataPatches ?? []) {
      out.writeUInt32LE(assetAbsoluteOffsets[i][patch.assetIndex], structOffsets[i] + patch.patchOffset);
    }
  }

  out.writeUInt32LE(newFileLength, 0x8); // decompressedFileSize
  if (insertSize > 0) out.writeUInt32LE(newTagDataOffset, 0x10); // tagDataOffset
  out.writeUInt32LE(newFileLength - newTagDataOffset, 0x14); // tagDataSize
  // crc32 (0x64) and the sub-header's tagFileChecksums (subHeaderOffset+0x08) are left byte-for-byte
  // as in the target map - both are stale after this write; recalculating them is Milestone 6.

  return out;
}

export function applyAddInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): Buffer {
  return applyInjection(targetBuffer, targetHeader, targetTagIndex, container, plan, options);
}

export function applySwapInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): Buffer {
  return applyInjection(targetBuffer, targetHeader, targetTagIndex, container, plan, options);
}
