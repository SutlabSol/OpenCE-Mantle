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
 * TAG ARRAY GROWTH (corrected 2026-10-11, PRD "ADD tag-array growth"): the engine loads CE tag
 * data at the fixed base 0x40440000, and the tag array always sits right after the tag data header
 * (array pointer 0x40440028 in every CE map). The base can NOT be inferred from the array pointer:
 * that is only how some readers guess it (invader map.cpp:244, and this project's reader before
 * this fix). Earlier builds lowered the array pointer by the growth instead of moving pointers.
 * Our own reader accepted that; the engine did not (blue screen). ADD now grows the array in place,
 * keeps the array pointer, and moves every existing pointer at or past the old array end by the
 * growth (`pointer-rebase.ts`, schema-driven). A target with a tag that can't be walked completely
 * is refused. SWAP never grows the array: only the swapped entries' own data pointer and
 * secondary/tertiary class change (tagId/path/primary class untouched); their data is appended
 * the same way ADD's is.
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
 *   (supported for no external group yet) - falls back to untouched, reported as blocked.
 * - Conflict dialog (skip/replace/rename + "apply to all"): Step C, not built yet - for now the
 *   caller picks ADD or SWAP for the whole operation via the `mode` parameter.
 * - CRC32 / tag checksum recalculation: that is Milestone 6's job. This module leaves both
 *   fields byte-for-byte as in the target map and the caller must surface them as stale.
 */
import { CE_TAG_SPACE_SIZE, TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../constants/cache-file';
import { fourCCFromString, lookupTagClassByName } from '../constants/tag-classes';
import type { CacheFileHeader } from './header';
import type { TagIndex, TagIndexEntry } from './tag-index';
import { collectTagDataPointers, applyPointerShift, tagDataLayoutOf, UnwalkableTagError } from './pointer-rebase';
import type { RebaseCounts } from './pointer-rebase';
import { ceStructureBspRegions } from './cache-crc';
import { resolveStruct, decodeStruct, resolvePointer, isRangeInBuffer } from './definitions/engine';
import { decodeReflexive, decodeDependency, encodeDependency } from './definitions/codec';
import type { OceContainer, OceContainerTag, ExternalResourceRef } from './container';
import { OCETAGS_FORMAT_VERSION } from './container';
import type { ExtractedDependencyRef } from './tag-extractor';
import { childFieldPath, reflexiveElementPath, isRelocatedTagDataField } from './tag-extractor';
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

/** The map being injected into: its bytes and parsed header/tag index. Never mutated. */
export interface InjectionTarget {
  buffer: Buffer;
  header: CacheFileHeader;
  tagIndex: TagIndex;
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

const OCETAGS_SUPPORTED_MAX_VERSION = OCETAGS_FORMAT_VERSION;

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
  /**
   * Relocation of gbxmodel geometry parts (vertex/triangle index data in the model data region).
   * Enabled by default (Stage 2).
   */
  allowGbxmodelGeometryRelocation?: boolean;
}

/**
 * Dry-run: decides what would be reused/swapped/added/blocked, without allocating or writing
 * any bytes. Never mutates its inputs. `mode` applies to the whole operation (per-tag choice is
 * Step C, not built yet).
 */
export function planInjection(mode: InjectionMode, target: InjectionTarget, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}, options: InjectionOptions = {}): InjectionPlanResult {
  const targetTagIndex = target.tagIndex;
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
  const invalidReflexiveByOriginal = warningMessagesOfKind(container, 'invalidReflexive');
  const extractionFailedByOriginal = warningMessagesOfKind(container, 'extractionFailed');
  const uncertainGroupByOriginal = warningMessagesOfKind(container, 'uncertainGroup');

  /** Per tag: dependency entries for skipped nonCached fields (old containers), left out of every dependency check below - see `checkDependencyMap`. */
  const ignoredDependencyPaths = new Map<OceContainerTag, Set<string>>();
  function effectiveDependencies(t: OceContainerTag): ExtractedDependencyRef[] {
    const ignored = ignoredDependencyPaths.get(t);
    const deps = t.dependencies as ExtractedDependencyRef[];
    return ignored && ignored.size > 0 ? deps.filter((d) => !ignored.has(d.fieldPath)) : deps;
  }

  /**
   * Unconditional - unlike embedded relocation, there is no opt-in for a tag the extractor
   * structurally could not carry: uncaptured data (model geometry, an unresolvable data pointer),
   * a group with no reliable field layout (`uncertainGroup`, i.e. `UNCERTAIN_GROUPS` = spheroid),
   * an out-of-bounds TagReflexive (its pointer is left unrelocated in `data`), or an extraction
   * error. Applied to ADD candidates AND matched SWAP candidates alike. Reads only the container:
   * v4 per-tag `injectionBlockers`, plus the persisted walker `warnings` (the only source for
   * v1-v3 containers). Otherwise-unblocked tags also get `checkDependencyMap` (every
   * TagDependency field must match its `dependencies` entry by fieldPath). null = not blocked.
   */
  function structuralBlockReason(t: OceContainerTag): string | null {
    const reasons: string[] = [];
    const uncaptured = uncapturedDataByOriginal.get(t.originalIndex) ?? [];
    if (uncaptured.length > 0) reasons.push(`This tag has data that cannot be captured or relocated: ${uncaptured.join('; ')}`);
    const blockers = t.injectionBlockers ?? [];
    const invalid = [...blockers.filter((b) => b.kind === 'invalidReflexive').map((b) => b.message), ...(blockers.length > 0 ? [] : invalidReflexiveByOriginal.get(t.originalIndex) ?? [])];
    if (invalid.length > 0) reasons.push(`This tag has an invalid/corrupt layout (a reflexive outside the source map) and cannot be relocated: ${invalid.join('; ')}`);
    const failed = [...blockers.filter((b) => b.kind === 'extractionFailed').map((b) => b.message), ...(blockers.length > 0 ? [] : extractionFailedByOriginal.get(t.originalIndex) ?? [])];
    if (failed.length > 0) reasons.push(`This tag failed to extract and cannot be injected: ${failed.join('; ')}`);
    const uncertain = uncertainGroupByOriginal.get(t.originalIndex) ?? [];
    if (uncertain.length > 0) reasons.push(`This tag's group has no reliable field layout, so it cannot be safely relocated: ${uncertain.join('; ')}`);
    if (t.group === 'gbxmodel') {
      if (!t.gbxmodelGeometryParts || t.gbxmodelGeometryParts.length === 0) {
        reasons.push('This gbxmodel tag has no captured model geometry parts (re-extract to capture geometry for injection).');
      } else if (options.allowGbxmodelGeometryRelocation === false) {
        reasons.push('Relocation of gbxmodel geometry is disabled by options.');
      }
    }
    if (reasons.length === 0) {
      const depMap = checkDependencyMap(t);
      ignoredDependencyPaths.set(t, depMap.ignoredPaths);
      if (depMap.reason) reasons.push(depMap.reason);
    }
    return reasons.length > 0 ? reasons.join(' ') : null;
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
    const structural = structuralBlockReason(t);
    if (structural) {
      blockedUncapturedSet.add(li);
      reasons.push(structural);
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
      for (const dep of effectiveDependencies(t)) {
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

  // Adding entries grows the tag array, so every existing pointer past it must move: every tag in
  // the target has to be walkable. Refuse (naming the tag) rather than skip one.
  if (toAddLocalIndices.length > 0) {
    try {
      collectTagDataPointers(target.buffer, tagDataLayoutOf(target.header, targetTagIndex), { tolerate: { staleReferencePaths: true } });
    } catch (err) {
      if (!(err instanceof UnwalkableTagError)) throw err;
      return { kind: 'refused', reason: `Adding tags moves every pointer in the target map, and one tag can't be handled. ${err.message} Only a SWAP that adds no new tags (every tag already in the map) can be done on this map.` };
    }
  }

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
      reasons.push(`The existing "${t.path}" (${t.group}) in the target is an external (resource map) entry; swapping into those isn't supported. Left unchanged.`);
    }
    const structuralBlockMsg = structuralBlockReason(t);
    if (structuralBlockMsg) {
      reasons.push(structuralBlockMsg);
    }
    const embeddedBlockMsg = embeddedBlockReason(t);
    if (embeddedBlockMsg) {
      reasons.push(embeddedBlockMsg);
    }
    for (const dep of effectiveDependencies(t)) {
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

  // Tag space: the grown tag data (new entries, appended data with its alignment padding, new path
  // strings) plus the largest BSP must fit, exactly as applyInjection will lay it out.
  const writeTags = [...toAddLocalIndices.map((li) => container.tags[li]), ...toSwap.map((s) => container.tags[s.localIndex])];
  if (writeTags.length > 0) {
    const layout = layoutAppend(target.buffer.length, target.header.tagDataOffset, toAddLocalIndices.length * TAG_ENTRY_SIZE, 0, writeTags.map((t) => alignTagData(Buffer.from(t.data, 'base64'), t.structName).data), toAddLocalIndices.map((li) => container.tags[li].path));
    const newTagDataSize = layout.newFileLength - target.header.tagDataOffset;
    const bsps = ceStructureBspRegions(target.buffer, target.header, targetTagIndex, 'Cannot check the tag space');
    const largestBsp = bsps.reduce((n, r) => Math.max(n, r.size), 0);
    if (newTagDataSize + largestBsp > CE_TAG_SPACE_SIZE) {
      const mib = (n: number) => `${(n / (1024 * 1024)).toFixed(2)} MiB`;
      return {
        kind: 'refused',
        reason: `The result would not fit in the game's tag space: tag data would be ${mib(newTagDataSize)} (now ${mib(target.header.tagDataSize)}) and the largest BSP is ${mib(largestBsp)}, ${mib(newTagDataSize + largestBsp)} in total; the limit is ${mib(CE_TAG_SPACE_SIZE)}. Inject fewer tags.`,
      };
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

export function planAddInjection(target: InjectionTarget, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}, options: InjectionOptions = {}): InjectionPlanResult {
  return planInjection('add', target, container, resourceMapConfig, options);
}

export function planSwapInjection(target: InjectionTarget, container: OceContainer, resourceMapConfig: ResourceMapConfig = {}, options: InjectionOptions = {}): InjectionPlanResult {
  return planInjection('swap', target, container, resourceMapConfig, options);
}

/** One TagDependency field found by walking a container tag's own (local-offset) `data`. */
interface DependencyFieldSite {
  fieldPath: string;
  tagId: number;
}

/**
 * Walks a container tag's flattened `data` exactly the way the extractor captured it: fields in
 * physical order, `nonCached` fields skipped entirely (dependencies AND reflexives - the
 * extractor neither records nor relocates them), TagReflexive pointers read as LOCAL offsets.
 * Returns every TagDependency field with its fieldPath, plus the paths of skipped nonCached
 * dependency fields (containers saved before the extractor skipped them still list those).
 * Throws if the data doesn't fit the schema (truncated buffer, reflexive outside `data`).
 */
function collectDependencyFields(data: Buffer, structName: string, localOffset: number, fieldPath: string, sites: DependencyFieldSite[], nonCachedPaths: Set<string>): void {
  const resolved = resolveStruct(structName);
  const decoded = decodeStruct(data, localOffset, structName);
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    const path = childFieldPath(fieldPath, field.name);
    if (field.def.nonCached) {
      if (value.kind === 'dependency') nonCachedPaths.add(path);
      continue;
    }
    if (value.kind === 'dependency') {
      sites.push({ fieldPath: path, tagId: value.value.tagId >>> 0 });
    } else if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const base = value.value.pointerLow;
      if (!isRangeInBuffer(base, value.value.count * childSize, data.length)) {
        throw new Error(`"${path}" (${value.value.count} x "${childStructName}") points outside the tag's own data`);
      }
      for (let i = 0; i < value.value.count; i++) {
        collectDependencyFields(data, childStructName, base + i * childSize, reflexiveElementPath(fieldPath, field.name, i), sites, nonCachedPaths);
      }
    } else if (isRelocatedTagDataField(field, value)) {
      if (!isRangeInBuffer(value.value.pointerLow, value.value.size, data.length)) {
        throw new Error(`"${path}" (${value.value.size} data bytes) points outside the tag's own data`);
      }
    }
  }
}

/**
 * Plan-time check that every TagDependency field in `t.data` can be matched to its own
 * `dependencies` entry by fieldPath (the only way `rewriteAddedTagData` looks entries up).
 * Blocks the tag (null = OK) on: a non-null field with no entry, an entry whose fieldPath is not
 * a dependency field in this build's definitions (unknown path, or a field renamed since the
 * container was saved), duplicate entries, or an entry that disagrees with the field about being
 * null. Entries for skipped nonCached fields (listed by containers saved before the extractor
 * skipped them) are returned in `ignoredPaths` so the planner leaves them out of its dependency
 * checks too. Works on every container version - `fieldPath` has been stored since v1.
 */
function checkDependencyMap(t: OceContainerTag): { reason: string | null; ignoredPaths: Set<string> } {
  const sites: DependencyFieldSite[] = [];
  const nonCachedPaths = new Set<string>();
  try {
    collectDependencyFields(Buffer.from(t.data, 'base64'), t.structName, 0, t.path, sites, nonCachedPaths);
  } catch (err) {
    return { reason: `This tag's saved data does not match this build's field layout (${err instanceof Error ? err.message : String(err)}), so its tag references cannot be matched safely. Re-extract it.`, ignoredPaths: nonCachedPaths };
  }
  const problems: string[] = [];
  const entryByPath = new Map<string, ExtractedDependencyRef>();
  for (const dep of t.dependencies as ExtractedDependencyRef[]) {
    if (entryByPath.has(dep.fieldPath)) problems.push(`"${dep.fieldPath}" is listed more than once`);
    entryByPath.set(dep.fieldPath, dep);
  }
  const sitePaths = new Set(sites.map((s) => s.fieldPath));
  for (const dep of entryByPath.values()) {
    if (!sitePaths.has(dep.fieldPath) && !nonCachedPaths.has(dep.fieldPath)) {
      problems.push(`reference "${dep.fieldPath}" is not a tag reference field in this build (unknown, or renamed since the container was saved)`);
    }
  }
  for (const site of sites) {
    const dep = entryByPath.get(site.fieldPath);
    const fieldIsNull = site.tagId === NULL_TAG_ID;
    if (!fieldIsNull && !dep) problems.push(`"${site.fieldPath}" holds a tag reference but the container has no entry for it`);
    else if (dep && (dep.kind === 'null') !== fieldIsNull) problems.push(`"${site.fieldPath}" ${fieldIsNull ? 'is empty but its entry names a tag' : 'holds a tag reference but its entry is empty'}`);
  }
  if (problems.length === 0) return { reason: null, ignoredPaths: nonCachedPaths };
  const shown = problems.slice(0, 3).join('; ') + (problems.length > 3 ? `; and ${problems.length - 3} more` : '');
  return { reason: `This tag's saved tag references don't match its fields, so they cannot be assigned safely: ${shown}. Re-extract it with this version of OpenCE.`, ignoredPaths: nonCachedPaths };
}

/**
 * Recursively rewrites one newly-added tag's own buffer in place: TagDependency.tagId fields are
 * remapped to the target map's resolved tagIds (and their path pointer set to that tag's own path
 * string, pathSize 0 - what every real CE map checked holds), and TagReflexive pointers plus
 * relocated TagDataOffset pointers (`isRelocatedTagDataField`; both currently LOCAL byte offsets
 * from extraction) become real virtual addresses for their final position in the target file. Each dependency field is matched to its entry by fieldPath (`depsByPath`), never by list
 * position - the extractor's list order differs from this walk's order. `nonCached` fields are
 * skipped exactly like the extractor skips them: their bytes stay as in the source.
 * `planInjection` (`checkDependencyMap`) has already checked every lookup here succeeds.
 * `tagBaseAbsolute` is the tag's own fixed absolute position in `data` (constant across the whole
 * recursive call tree); `localOffset` is this struct instance's absolute position in `data`.
 */
function rewriteAddedTagData(
  data: Buffer,
  structName: string,
  localOffset: number,
  fieldPath: string,
  depsByPath: Map<string, ExtractedDependencyRef>,
  translation: number,
  tagBaseAbsolute: number,
  resolveDepTagId: (dep: ExtractedDependencyRef) => number,
  pathPointerOfTagId: (tagId: number) => number,
): void {
  const resolved = resolveStruct(structName);
  const decoded = decodeStruct(data, localOffset, structName);
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    if (field.def.nonCached) continue;
    const absFieldOffset = localOffset + field.offset;
    const path = childFieldPath(fieldPath, field.name);
    if (value.kind === 'dependency') {
      if (value.value.tagId !== NULL_TAG_ID) {
        const dep = depsByPath.get(path);
        if (!dep) throw new Error(`Internal error: no dependency entry for "${path}" - planInjection should have blocked this tag.`);
        const newTagId = resolveDepTagId(dep);
        const decodedDep = decodeDependency(data, absFieldOffset);
        encodeDependency(data, absFieldOffset, { ...decodedDep, pathPointer: pathPointerOfTagId(newTagId), pathSize: 0, tagId: newTagId });
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
        rewriteAddedTagData(data, childStructName, childAbsoluteBase + i * childSize, reflexiveElementPath(fieldPath, field.name, i), depsByPath, translation, tagBaseAbsolute, resolveDepTagId, pathPointerOfTagId);
      }
    } else if (isRelocatedTagDataField(field, value)) {
      data.writeUInt32LE((value.value.pointerLow + translation) >>> 0, absFieldOffset + 12); // DecodedTagDataOffset.pointerLow
      data.writeUInt32LE(0, absFieldOffset + 16); // pointerHigh
    }
  }
}

/** Tag data blocks start at a multiple of this from the start of tag data, as in every real CE map checked (Tool pads odd-length blocks). */
const TAG_DATA_BLOCK_ALIGNMENT = 4;

function padToAlignment(length: number): number {
  return (TAG_DATA_BLOCK_ALIGNMENT - (length % TAG_DATA_BLOCK_ALIGNMENT)) % TAG_DATA_BLOCK_ALIGNMENT;
}

/**
 * Re-lays out one container tag's flattened data so every block - the root struct, each
 * reflexive array, each relocated data block (`isRelocatedTagDataField`) - starts at a multiple
 * of 4 from the tag's own start, with zero bytes between blocks. Real maps align every tag,
 * reflexive and data pointer to 4 from the tag data start; containers v1-v4 store blocks back to
 * back (a 2-byte animation struct array or an odd-length string shifts everything after it), so
 * this runs at apply time and the container format is unchanged. Block order is the extractor's
 * two-phase order. Pointers in the result are still LOCAL offsets, now into the new buffer;
 * `mapOffset` maps an offset in the old buffer to the new one (embedded-asset patch offsets).
 * `planInjection` has already checked every block lies inside `data` (`collectDependencyFields`).
 */
function alignTagData(data: Buffer, structName: string): { data: Buffer; mapOffset: (oldOffset: number) => number } {
  const copies: { from: number; to: number; length: number }[] = [];
  const pointerWrites: { at: number; value: number }[] = [];
  let length = 0;
  const place = (from: number, size: number): number => {
    length += padToAlignment(length);
    const to = length;
    copies.push({ from, to, length: size });
    length += size;
    return to;
  };
  const visit = (name: string, oldAt: number, newAt: number): void => {
    const decoded = decodeStruct(data, oldAt, name);
    const children: { struct: string; size: number; count: number; oldBase: number; newBase: number }[] = [];
    for (const field of resolveStruct(name).fields) {
      const value = decoded.get(field.name);
      if (!value || field.def.nonCached) continue;
      const childStruct = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (value.kind === 'reflexive' && value.value.count > 0 && childStruct) {
        const size = resolveStruct(childStruct).totalSize;
        const newBase = place(value.value.pointerLow, value.value.count * size);
        pointerWrites.push({ at: newAt + field.offset + 4, value: newBase });
        children.push({ struct: childStruct, size, count: value.value.count, oldBase: value.value.pointerLow, newBase });
      } else if (isRelocatedTagDataField(field, value)) {
        pointerWrites.push({ at: newAt + field.offset + 12, value: place(value.value.pointerLow, value.value.size) });
      }
    }
    for (const c of children) {
      for (let i = 0; i < c.count; i++) visit(c.struct, c.oldBase + i * c.size, c.newBase + i * c.size);
    }
  };
  place(0, resolveStruct(structName).totalSize);
  visit(structName, 0, 0);
  const out = Buffer.alloc(length);
  for (const c of copies) data.copy(out, c.to, c.from, c.from + c.length);
  for (const w of pointerWrites) out.writeUInt32LE(w.value, w.at);
  const mapOffset = (oldOffset: number): number => {
    const c = copies.find((x) => oldOffset >= x.from && oldOffset < x.from + x.length);
    if (!c) throw new Error(`Internal error: offset ${oldOffset} is not inside any block of the tag's data.`);
    return c.to + (oldOffset - c.from);
  };
  return { data: out, mapOffset };
}

/**
 * Where appended data lands: each tag's (already aligned) data block at a 4-byte boundary from the
 * tag data start, then the new entries' path strings packed back to back (no alignment, like real
 * maps). `delta` is the tag array growth, `insertSize` the embedded-data insertion before it.
 * Shared by `planInjection` (tag space check) and `applyInjection`, so both see the same size.
 */
function layoutAppend(oldFileLength: number, oldTagDataOffset: number, delta: number, insertSize: number, dataBuffers: Buffer[], newPaths: string[]): { structOffsets: number[]; pathOffsets: number[]; pathBuffers: Buffer[]; newFileLength: number } {
  const newTagDataOffset = oldTagDataOffset + insertSize;
  const structOffsets: number[] = [];
  let running = oldFileLength + insertSize + delta;
  for (const b of dataBuffers) {
    running += padToAlignment(running - newTagDataOffset); // aligned from the tag data start, not the file start (coldsnap's tagDataOffset is 2 mod 4)
    structOffsets.push(running);
    running += b.length;
  }
  const pathOffsets: number[] = [];
  const pathBuffers = newPaths.map((p) => Buffer.from(`${p}\0`, 'ascii'));
  for (const b of pathBuffers) {
    pathOffsets.push(running);
    running += b.length;
  }
  return { structOffsets, pathOffsets, pathBuffers, newFileLength: running };
}

function dependenciesByPath(t: OceContainerTag): Map<string, ExtractedDependencyRef> {
  return new Map((t.dependencies as ExtractedDependencyRef[]).map((d) => [d.fieldPath, d]));
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
 * Performs the structural rewrite: grows the tag array in place by `toAdd.length` (SWAP's
 * `toSwap` entries never change the tag count), moves every EXISTING pointer at or past the old
 * array end by the growth (`pointer-rebase.ts`; the array pointer and the base stay as they are),
 * appends every new/swapped tag's struct data (+ path strings for brand-new entries only - swapped
 * entries keep their existing path pointer), and returns a brand-new Buffer. Never mutates
 * `targetBuffer`. Callers that write a file run `finalizeForSave` (scenario name, crc32);
 * `tagFileChecksums` stays as in the target.
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
 * correctly automatically, because the whole tag data block moves as one and none of those are
 * raw/absolute file offsets (confirmed against
 * invader/src/build/build_workload.cpp's generic pointer-fixup pass - every one of them is
 * written as a translated virtual address, not a literal file offset). The two true absolute
 * file offsets in the format - `bsp_start` and the embedded bitmap/sound offsets themselves -
 * are handled explicitly: `bsp_start` always resolves to BEFORE the insertion point (BSP data
 * precedes raw-data in every real map checked) so it never shifts; the embedded offsets are
 * patched directly via each tag's `embeddedRawDataPatches`.
 */
export function applyInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): Buffer {
  return applyInjectionWithReport(targetBuffer, targetHeader, targetTagIndex, container, plan, options).buffer;
}

export interface InjectionResult {
  buffer: Buffer;
  /** Existing pointers visited/moved for tag-array growth; null when the array didn't grow. */
  rebase: RebaseCounts | null;
}

interface InjectedModelPartInfo {
  tagIndex: number;
  geometryIndex: number;
  partIndex: number;
  vertexOffset: number;
  triangleOffset: number;
}

function patchGbxmodelParts(
  out: Buffer,
  structOffset: number,
  baseMemoryAddress: number,
  newTagDataOffset: number,
  parts: InjectedModelPartInfo[],
): void {
  const partsMap = new Map<string, InjectedModelPartInfo>();
  for (const p of parts) partsMap.set(`${p.geometryIndex}:${p.partIndex}`, p);

  const gbxResolved = resolveStruct('GBXModel');
  const geomField = gbxResolved.fields.find((f) => f.name === 'geometries');
  if (!geomField) return;

  const geomSize = resolveStruct('GBXModelGeometry').totalSize;
  const partsField = resolveStruct('GBXModelGeometry').fields.find((f) => f.name === 'parts');
  if (!partsField) return;

  const partSize = resolveStruct('GBXModelGeometryPart').totalSize;
  const partFields = resolveStruct('GBXModelGeometryPart').fields;
  const vOffField = partFields.find((f) => f.name === 'vertex offset');
  const triOffField = partFields.find((f) => f.name === 'triangle offset');
  const triOff2Field = partFields.find((f) => f.name === 'triangle offset 2');
  if (!vOffField || !triOffField || !triOff2Field) return;

  const geomCount = out.readUInt32LE(structOffset + geomField.offset + 0);
  const geomPointer = out.readUInt32LE(structOffset + geomField.offset + 4);
  const geomBase = geomPointer - baseMemoryAddress + newTagDataOffset;

  for (let g = 0; g < geomCount; g++) {
    const geomOffset = geomBase + g * geomSize;
    if (geomOffset + geomSize > out.length) break;
    const partsCount = out.readUInt32LE(geomOffset + partsField.offset + 0);
    const partsPointer = out.readUInt32LE(geomOffset + partsField.offset + 4);
    const partsBase = partsPointer - baseMemoryAddress + newTagDataOffset;

    for (let p = 0; p < partsCount; p++) {
      const partOffset = partsBase + p * partSize;
      if (partOffset + partSize > out.length) break;
      const info = partsMap.get(`${g}:${p}`);
      if (info) {
        out.writeUInt32LE(info.vertexOffset, partOffset + vOffField.offset);
        out.writeUInt32LE(info.triangleOffset, partOffset + triOffField.offset);
        out.writeUInt32LE(info.triangleOffset, partOffset + triOff2Field.offset);
      }
    }
  }
}

/** `applyInjection`, also returning how many existing pointers were moved. */
export function applyInjectionWithReport(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): InjectionResult {
  const addedCount = plan.toAdd.length;
  const swappedCount = plan.toSwap.length;
  if (addedCount === 0 && swappedCount === 0) return { buffer: Buffer.from(targetBuffer), rebase: null };

  // Combined append list: brand-new entries first, then swapped-in-place entries - order is
  // arbitrary, both just append struct data past the (shifted) existing data region.
  const writeTags: OceContainerTag[] = [...plan.toAdd, ...plan.toSwap.map((s) => container.tags[s.localIndex])];

  for (const t of writeTags) {
    if (t.injectionBlockers && t.injectionBlockers.length > 0) {
      throw new Error(`Internal error: "${t.path}" reached applyInjection() with injection blockers (${t.injectionBlockers.map((b) => b.kind).join(', ')}) - planInjection() should have blocked it.`);
    }
  }
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

  // Model geometry relocation (Stage 2): collect parts across writeTags
  const injectedParts: InjectedModelPartInfo[] = [];
  const vertexBuffers: Buffer[] = [];
  const triangleBuffers: Buffer[] = [];

  let runningV = 0;
  let runningT = 0;
  for (let i = 0; i < writeTags.length; i++) {
    const t = writeTags[i];
    if (t.group !== 'gbxmodel' || !t.gbxmodelGeometryParts) continue;
    for (const p of t.gbxmodelGeometryParts) {
      const vBytes = Buffer.from(p.vertexData, 'base64');
      const tBytes = Buffer.from(p.triangleData, 'base64');
      injectedParts.push({
        tagIndex: i,
        geometryIndex: p.geometryIndex,
        partIndex: p.partIndex,
        vertexOffset: targetTagIndex.vertexSize + runningV,
        triangleOffset: (targetTagIndex.modelDataSize - targetTagIndex.vertexSize) + runningT,
      });
      vertexBuffers.push(vBytes);
      triangleBuffers.push(tBytes);
      runningV += vBytes.length;
      runningT += tBytes.length;
    }
  }

  const newVertexBytes = Buffer.concat(vertexBuffers);
  const insertVertexSize = newVertexBytes.length; // guaranteed 4-aligned (vertices are 32 or 68 bytes)

  const unpaddedTriangles = Buffer.concat(triangleBuffers);
  const padT = (4 - (unpaddedTriangles.length % 4)) % 4;
  const newTriangleBytes = padT > 0 ? Buffer.concat([unpaddedTriangles, Buffer.alloc(padT, 0)]) : unpaddedTriangles;
  const insertTriangleSize = newTriangleBytes.length;

  const totalModelPartCount = injectedParts.length;

  // Embedded relocation: every unique asset across toAdd/toSwap, inserted once right before
  // modelDataFileOffset, zero-padded to a 4-byte boundary
  const insertPos = targetTagIndex.modelDataFileOffset;
  const embeddedAssetBuffers: Buffer[] = options.allowEmbeddedRelocation
    ? writeTags.flatMap((t) => (t.embeddedRawDataAssets ?? []).filter((a) => a.kind === 'bitmap' || a.kind === 'sound').map((a) => Buffer.from(a.data, 'base64')))
    : [];
  const embeddedBlobSize = embeddedAssetBuffers.reduce((n, b) => n + b.length, 0);
  const insertSize = embeddedBlobSize === 0 ? 0 : embeddedBlobSize + ((4 - (embeddedBlobSize % 4)) % 4);

  const shiftBeforeTagData = insertSize + insertVertexSize + insertTriangleSize;

  // Key boundaries in targetBuffer
  const posVertex = targetTagIndex.modelDataFileOffset + targetTagIndex.vertexSize;
  const posTriangle = subHeaderOffset;

  // The base and the array pointer never change (module doc). Existing pointers at or past the old
  // array end move by `delta`; collected from the target before anything is copied.
  const baseMemoryAddress = targetTagIndex.baseMemoryAddress;
  const existingPointers = delta > 0 ? collectTagDataPointers(targetBuffer, tagDataLayoutOf(targetHeader, targetTagIndex), { tolerate: { staleReferencePaths: true } }) : [];
  const newTagDataOffset = subHeaderOffset + shiftBeforeTagData;
  const newArrayOffset = arrayOffset + shiftBeforeTagData;

  const laidOut = writeTags.map((t) => alignTagData(Buffer.from(t.data, 'base64'), t.structName));
  const dataBuffers = laidOut.map((l) => l.data);
  // Path strings only for brand-new entries - swapped entries reuse their existing path pointer.
  const { structOffsets, pathOffsets, pathBuffers, newFileLength } = layoutAppend(oldFileLength, subHeaderOffset, delta, shiftBeforeTagData, dataBuffers, plan.toAdd.map((t) => t.path));

  const out = Buffer.alloc(newFileLength);

  // 1. Region before model data: header + BSP + raw data
  targetBuffer.copy(out, 0, 0, insertPos);

  // 2. Insert embedded blob if any (before modelDataFileOffset)
  const assetAbsoluteOffsets: number[][] = writeTags.map(() => []);
  if (insertSize > 0) {
    let cursor = insertPos;
    for (let i = 0; i < writeTags.length; i++) {
      for (const asset of (writeTags[i].embeddedRawDataAssets ?? []).filter((a) => a.kind === 'bitmap' || a.kind === 'sound')) {
        const bytes = Buffer.from(asset.data, 'base64');
        bytes.copy(out, cursor);
        assetAbsoluteOffsets[i].push(cursor);
        cursor += bytes.length;
      }
    }
  }

  // 3. Old vertex data (shifted by +insertSize)
  targetBuffer.copy(out, insertPos + insertSize, insertPos, posVertex);

  // 4. Insert new vertex bytes (at end of vertex region)
  if (insertVertexSize > 0) {
    newVertexBytes.copy(out, insertPos + insertSize + targetTagIndex.vertexSize);
  }

  // 5. Old triangle data (shifted by +insertSize + insertVertexSize)
  targetBuffer.copy(out, insertPos + insertSize + targetTagIndex.vertexSize + insertVertexSize, posVertex, posTriangle);

  // 6. Insert new triangle bytes (at end of triangle region)
  if (insertTriangleSize > 0) {
    newTriangleBytes.copy(out, posTriangle + insertSize + insertVertexSize);
  }

  // 7. Sub-header + existing tag array (shifted by +shiftBeforeTagData)
  targetBuffer.copy(out, posTriangle + shiftBeforeTagData, posTriangle, oldStructDataOffset);

  // 8. Existing struct/path-string data (shifted by +shiftBeforeTagData + delta)
  targetBuffer.copy(out, oldStructDataOffset + shiftBeforeTagData + delta, oldStructDataOffset, oldFileLength);

  const outOffsetOf = (at: number): number => {
    if (at < insertPos) return at;
    if (at < posVertex) return at + insertSize;
    if (at < posTriangle) return at + insertSize + insertVertexSize;
    if (at < oldStructDataOffset) return at + shiftBeforeTagData;
    return at + shiftBeforeTagData + delta;
  };
  const oldArrayEndAddress = (baseMemoryAddress + (oldStructDataOffset - subHeaderOffset)) >>> 0;
  const rebase = delta > 0 ? applyPointerShift(existingPointers, { from: oldArrayEndAddress, to: (baseMemoryAddress + targetHeader.tagDataSize) >>> 0, delta }, (at, value) => out.writeUInt32LE(value, outOffsetOf(at))) : null;

  out.writeUInt32LE(oldTagCount + addedCount, newTagDataOffset + 0x0c);
  if (insertSize > 0) out.writeUInt32LE(insertPos + insertSize, newTagDataOffset + 0x14); // modelDataFileOffset
  if (totalModelPartCount > 0) {
    const newModelPartCount = targetTagIndex.modelPartCount + totalModelPartCount;
    out.writeUInt32LE(newModelPartCount, newTagDataOffset + 0x10); // modelPartCount
    out.writeUInt32LE(newModelPartCount, newTagDataOffset + 0x18); // modelPartCountAgain
    out.writeUInt32LE(targetTagIndex.vertexSize + insertVertexSize, newTagDataOffset + 0x1c); // vertexSize
    out.writeUInt32LE(targetTagIndex.modelDataSize + insertVertexSize + insertTriangleSize, newTagDataOffset + 0x20); // modelDataSize
  }

  for (let i = 0; i < addedCount; i++) {
    const t = plan.toAdd[i];
    const entryOffset = oldStructDataOffset + shiftBeforeTagData + i * TAG_ENTRY_SIZE;
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
    const pathPointer = baseMemoryAddress + (pathOffsets[i] - newTagDataOffset);
    out.writeUInt32LE(pathPointer >>> 0, entryOffset + 0x10);
    const dataPointer = baseMemoryAddress + (structOffsets[i] - newTagDataOffset);
    out.writeUInt32LE(dataPointer >>> 0, entryOffset + 0x14);
    out.writeUInt32LE(0, entryOffset + 0x18); // isExternal = false, this module never adds resource-map-indexed entries
    pathBuffers[i].copy(out, pathOffsets[i]);
  }

  for (let j = 0; j < swappedCount; j++) {
    const s = plan.toSwap[j];
    const t = container.tags[s.localIndex];
    const i = addedCount + j; // index into writeTags/dataBuffers/structOffsets
    const entryOffset = newArrayOffset + s.targetOriginalIndex * TAG_ENTRY_SIZE; // EXISTING array slot, same relative position
    const secondary = t.secondaryClassFourCC ?? 0xffffffff;
    const tertiary = t.tertiaryClassFourCC ?? 0xffffffff;
    out.writeUInt32LE(secondary === null ? 0xffffffff : secondary, entryOffset + 0x04);
    out.writeUInt32LE(tertiary === null ? 0xffffffff : tertiary, entryOffset + 0x08);
    const dataPointer = baseMemoryAddress + (structOffsets[i] - newTagDataOffset);
    out.writeUInt32LE(dataPointer >>> 0, entryOffset + 0x14);
    out.writeUInt32LE(0, entryOffset + 0x18); // Swapped tag is now internal
  }

  // Tag data is written only after EVERY tag array entry above is final, so a dependency on any
  // tag (existing, swapped or newly added) can take its path pointer from the output's own array.
  const pathPointerOfTagId = (tagId: number): number => out.readUInt32LE(newArrayOffset + (tagId & 0xffff) * TAG_ENTRY_SIZE + 0x10);
  for (let i = 0; i < writeTags.length; i++) {
    const t = writeTags[i];
    dataBuffers[i].copy(out, structOffsets[i]);
    const translation = (baseMemoryAddress - newTagDataOffset + structOffsets[i]) >>> 0;
    rewriteAddedTagData(out, t.structName, structOffsets[i], t.path, dependenciesByPath(t), translation, structOffsets[i], makeResolveDepTagId(t, plan, targetTagIndex), pathPointerOfTagId);
  }

  // Patch every relocated embedded asset's new absolute file offset into its tag's own struct
  // bytes - the one place each mechanism's raw file-offset field lives (see
  // `embedded-data-fields.ts`). Must run AFTER the struct-data copies above.
  for (let i = 0; i < writeTags.length; i++) {
    for (const patch of writeTags[i].embeddedRawDataPatches ?? []) {
      out.writeUInt32LE(assetAbsoluteOffsets[i][patch.assetIndex], structOffsets[i] + laidOut[i].mapOffset(patch.patchOffset));
    }
  }

  // Patch gbxmodel geometry parts with their new vertex/triangle offsets
  for (let i = 0; i < writeTags.length; i++) {
    const t = writeTags[i];
    if (t.group === 'gbxmodel') {
      const myParts = injectedParts.filter((p) => p.tagIndex === i);
      if (myParts.length > 0) {
        patchGbxmodelParts(out, structOffsets[i], baseMemoryAddress, newTagDataOffset, myParts);
      }
    }
  }

  // Shift raw file offsets for internal bitmap pixel data in existing tags.
  // When tags are added or embedded data inserted, bytes at/past oldStructDataOffset shift by
  // shiftBeforeTagData + delta. Any internal BitmapData whose pixel data was appended inside
  // targetBuffer (e.g. from an earlier bitmap injection/edit) must have its raw file offset updated.
  if (shiftBeforeTagData > 0 || delta > 0) {
    const swappedSet = new Set(plan.toSwap.map((sw) => sw.targetOriginalIndex));
    for (let entryIdx = 0; entryIdx < oldTagCount; entryIdx++) {
      if (swappedSet.has(entryIdx)) continue;
      const entryOffset = newArrayOffset + entryIdx * TAG_ENTRY_SIZE;
      const groupFourCC = out.readUInt32LE(entryOffset + 0x00);
      const isExternal = out.readUInt32LE(entryOffset + 0x18);
      // 'bitm' = 0x6269746d
      if (groupFourCC === 0x6269746d && !isExternal) {
        const tagDataPtr = out.readUInt32LE(entryOffset + 0x14);
        if (tagDataPtr >= baseMemoryAddress) {
          const tagStructOffset = newTagDataOffset + (tagDataPtr - baseMemoryAddress);
          if (tagStructOffset + 0x68 <= out.length) {
            const imgCount = out.readUInt32LE(tagStructOffset + 0x60);
            const imgPtr = out.readUInt32LE(tagStructOffset + 0x64);
            if (imgCount > 0 && imgPtr >= baseMemoryAddress) {
              const imgArrayOffset = newTagDataOffset + (imgPtr - baseMemoryAddress);
              for (let imgIdx = 0; imgIdx < imgCount; imgIdx++) {
                const rowOffset = imgArrayOffset + imgIdx * 48;
                if (rowOffset + 48 <= out.length) {
                  const flags = out.readUInt16LE(rowOffset + 0x0e);
                  const isImgExternal = (flags & 0x100) !== 0;
                  if (!isImgExternal) {
                    const pixelOff = out.readUInt32LE(rowOffset + 0x18);
                    if (pixelOff >= insertPos && pixelOff < oldFileLength) {
                      const newPixelOff = outOffsetOf(pixelOff);
                      out.writeUInt32LE(newPixelOff, rowOffset + 0x18);
                    }
                  }
                }
              }
            }
          }
        }
      } else if (groupFourCC === 0x736e6421 && !isExternal) {
        // 'snd!' = 0x736e6421: shift internal sound permutation sample offsets
        const tagDataPtr = out.readUInt32LE(entryOffset + 0x14);
        if (tagDataPtr >= baseMemoryAddress) {
          const tagStructOffset = newTagDataOffset + (tagDataPtr - baseMemoryAddress);
          if (tagStructOffset + 0xa0 <= out.length) {
            const pitchCount = out.readUInt32LE(tagStructOffset + 0x98);
            const pitchPtr = out.readUInt32LE(tagStructOffset + 0x9c);
            if (pitchCount > 0 && pitchCount < 32 && pitchPtr >= baseMemoryAddress) {
              const pitchArrayOffset = newTagDataOffset + (pitchPtr - baseMemoryAddress);
              const pitchStructSize = 72;
              for (let p = 0; p < pitchCount; p++) {
                const pOffset = pitchArrayOffset + p * pitchStructSize;
                if (pOffset + pitchStructSize <= out.length) {
                  const permCount = out.readUInt32LE(pOffset + 0x3c);
                  const permPtr = out.readUInt32LE(pOffset + 0x40);
                  if (permCount > 0 && permCount < 256 && permPtr >= baseMemoryAddress) {
                    const permArrayOffset = newTagDataOffset + (permPtr - baseMemoryAddress);
                    const permStructSize = 124;
                    for (let m = 0; m < permCount; m++) {
                      const mOffset = permArrayOffset + m * permStructSize;
                      if (mOffset + permStructSize <= out.length) {
                        const sampleExt = out.readUInt32LE(mOffset + 0x44);
                        if ((sampleExt & 1) === 0) {
                          const sampleOffset = out.readUInt32LE(mOffset + 0x48);
                          if (sampleOffset >= insertPos && sampleOffset < oldFileLength) {
                            out.writeUInt32LE(outOffsetOf(sampleOffset), mOffset + 0x48);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  out.writeUInt32LE(newFileLength, 0x8); // decompressedFileSize
  if (shiftBeforeTagData > 0) out.writeUInt32LE(newTagDataOffset, 0x10); // tagDataOffset
  out.writeUInt32LE(newFileLength - newTagDataOffset, 0x14); // tagDataSize
  out.writeUInt32LE(newFileLength - newTagDataOffset, 0x14); // tagDataSize
  // crc32 (0x64) and the sub-header's tagFileChecksums (subHeaderOffset+0x08) are left byte-for-byte
  // as in the target map. Callers that write a file run `finalizeForSave` (finalize-map.ts), which
  // recomputes crc32 and sets the scenario name; the tag-file checksum stays as-is (unverified).

  return { buffer: out, rebase };
}

export function applyAddInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): Buffer {
  return applyInjection(targetBuffer, targetHeader, targetTagIndex, container, plan, options);
}

export function applySwapInjection(targetBuffer: Buffer, targetHeader: CacheFileHeader, targetTagIndex: TagIndex, container: OceContainer, plan: InjectionPlan, options: InjectionOptions = {}): Buffer {
  return applyInjection(targetBuffer, targetHeader, targetTagIndex, container, plan, options);
}
