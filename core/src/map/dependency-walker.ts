import { fourCCToString } from '../constants/tag-classes';
import { resolveTagDataPointer } from './tag-index';
import { OperationCancelledError } from './errors';
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';
import { resolveStruct, decodeStruct, getAllTagGroupNames, getGroupDefinition, resolvePointer } from './definitions/engine';
import { findEmbeddedDataFields } from './embedded-data-fields';

/** NULL tag id sentinel (0xFFFFFFFF), see TagDependency / TagID. */
const NULL_TAG_ID = 0xffffffff;

/** Groups with no reliable source anywhere (see SOURCES.md) - treated as an opaque blob, never promoted. */
export const UNCERTAIN_GROUPS = ['spheroid'];

/** Caps traversal of a single reflexive array, mirroring `validate-tag.ts`'s performance guard. */
const MAX_ELEMENTS_WALKED_PER_REFLEXIVE = 2000;

export type TagStatus = 'ok' | 'bsp' | 'external' | 'uncertain' | 'noDefinition';

export interface BspLocation {
  fileOffset: number;
  fileOffsetAnchor: number;
  baseMemoryAddress: number;
}

export interface WalkedTag {
  /** Index into the map's own tag index (NOT the position in `WalkResult.tags`). */
  originalIndex: number;
  tagId: number;
  path: string;
  group: string;
  status: TagStatus;
  /** Only set when status === 'bsp'. */
  bspLocation?: BspLocation;
  /** Paths of tags that pulled this one in as a dependency. Empty = one of the requested roots. */
  requiredBy: string[];
}

export type WarningKind = 'uncertainGroup' | 'noDefinition' | 'externalTag' | 'externalData' | 'embeddedRawData' | 'bspTag' | 'invalidReflexive' | 'uncapturedData';

export interface WalkerWarning {
  originalIndex: number;
  path: string;
  group: string;
  kind: WarningKind;
  message: string;
  /** Only set for 'externalData'/'embeddedRawData': which resource map this field's data lives in when external (e.g. "bitmaps.map"). */
  resourceMap?: string;
  /** Only set for 'externalData'/'embeddedRawData': the raw byte offset recorded in the field (into the resource map if external, into this same map's raw-data region if embedded). */
  fileOffset?: number;
  /** Only set for 'externalData'/'embeddedRawData': size in bytes of the referenced data. */
  size?: number;
}

export interface WalkResult {
  /** Fully-walked tags with data present in this map (status 'ok' or 'bsp'), in discovery order. */
  tags: WalkedTag[];
  /** Tags whose data lives in a resource map (bitmaps.map/sounds.map/loc.map) - not walked further. */
  externalTags: WalkedTag[];
  warnings: WalkerWarning[];
}

export interface WalkOptions {
  /** Called periodically with (tagsVisited, itemsStillQueued) while walking. */
  onProgress?: (visited: number, queued: number) => void;
  /** Checked periodically; throws OperationCancelledError once aborted. */
  signal?: AbortSignal;
}

interface QueueItem {
  index: number;
  bspLocation?: BspLocation;
  /** Path of the tag whose struct enqueued this dependency. Undefined for the original root indices. */
  fromPath?: string;
}

/**
 * Walks every TagDependency/TagReflexive reachable from `rootIndices`, transitively, producing
 * the full dependency closure. Mirrors the same generic field-walking approach as
 * `validate-tag.ts` but collects references instead of validating bytes.
 */
export function walkDependencies(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  rootIndices: number[],
  options: WalkOptions = {},
): WalkResult {
  const knownGroups = new Set(getAllTagGroupNames());
  const visited = new Map<number, WalkedTag>();
  const requiredByMap = new Map<number, Set<string>>();
  const warnings: WalkerWarning[] = [];
  const queue: QueueItem[] = rootIndices.map((index) => ({ index }));
  let processed = 0;

  const addRequiredBy = (index: number, fromPath?: string) => {
    if (!fromPath) return;
    if (!requiredByMap.has(index)) requiredByMap.set(index, new Set());
    requiredByMap.get(index)!.add(fromPath);
  };

  while (queue.length > 0) {
    if (options.signal?.aborted) throw new OperationCancelledError();
    processed++;
    if (processed % 25 === 0) options.onProgress?.(visited.size, queue.length);

    const { index, bspLocation, fromPath } = queue.shift()!;
    addRequiredBy(index, fromPath);
    if (visited.has(index)) continue;
    if (index < 0 || index >= tagIndex.entries.length) continue;

    const entry = tagIndex.entries[index];
    const group = entry.primaryClassName ?? fourCCToString(entry.primaryClassFourCC);
    const base: Omit<WalkedTag, 'status' | 'requiredBy'> = { originalIndex: index, tagId: entry.tagId, path: entry.path, group };

    if (entry.isExternal) {
      visited.set(index, { ...base, status: 'external', requiredBy: [] });
      warnings.push({
        originalIndex: index,
        path: entry.path,
        group,
        kind: 'externalTag',
        message: `"${entry.path}" (${group}) lives in a resource map (bitmaps.map/sounds.map/loc.map), not this map. Not walked further; sounds.map/loc.map resolution is a follow-up milestone.`,
      });
      continue;
    }
    if (UNCERTAIN_GROUPS.includes(group)) {
      visited.set(index, { ...base, status: 'uncertain', requiredBy: [] });
      warnings.push({
        originalIndex: index,
        path: entry.path,
        group,
        kind: 'uncertainGroup',
        message: `"${entry.path}" is a "${group}" tag - no reliable field layout exists for this group (see SOURCES.md). Treated as an opaque blob; not walked further.`,
      });
      continue;
    }
    if (!knownGroups.has(group)) {
      visited.set(index, { ...base, status: 'noDefinition', requiredBy: [] });
      warnings.push({
        originalIndex: index,
        path: entry.path,
        group,
        kind: 'noDefinition',
        message: `"${entry.path}" has unrecognized tag class "${group}" - no definition registered. Treated as an opaque blob; not walked further.`,
      });
      continue;
    }

    const status: TagStatus = group === 'scenario_structure_bsp' ? 'bsp' : 'ok';
    if (status === 'bsp') {
      if (!bspLocation) {
        warnings.push({
          originalIndex: index,
          path: entry.path,
          group,
          kind: 'bspTag',
          message: `"${entry.path}" (scenario_structure_bsp) was reached without its owning Scenario's BSP location info - cannot locate its data. Treated as an opaque blob.`,
        });
        visited.set(index, { ...base, status: 'noDefinition', requiredBy: [] });
        continue;
      }
      warnings.push({
        originalIndex: index,
        path: entry.path,
        group,
        kind: 'bspTag',
        message: `"${entry.path}" (scenario_structure_bsp) lives in a separate region with its own pointer base (bsp_start/bsp_address via a cache-header indirection, not the main tag data section). See SOURCES.md "Key finding".`,
      });
    }
    visited.set(index, { ...base, status, bspLocation, requiredBy: [] });

    const structName = getGroupDefinition(group).name;
    const fileOffset = bspLocation ? bspLocation.fileOffset : resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const fileOffsetAnchor = bspLocation ? bspLocation.fileOffsetAnchor : header.tagDataOffset;
    const baseMemoryAddress = bspLocation ? bspLocation.baseMemoryAddress : tagIndex.baseMemoryAddress;

    if (status === 'bsp' && getGroupDefinition(group).extractable === false) {
      // Not extracted this milestone (see `extractable` on the group definition). List its own
      // direct dependencies as informational only ("needed by BSP, not extracted") - never
      // walked further, never queued for extraction.
      for (const dep of collectDirectDependencyRefs(buffer, structName, fileOffset, tagIndex)) {
        warnings.push({
          originalIndex: dep.originalIndex,
          path: dep.path,
          group: dep.group,
          kind: 'bspTag',
          message: `"${dep.path}" (${dep.group}) is needed by BSP "${entry.path}" but not extracted (BSP data isn't carried into the extracted set this milestone).`,
        });
      }
      continue;
    }

    collectFromStruct(buffer, structName, fileOffset, fileOffsetAnchor, baseMemoryAddress, entry.path, entry.path, index, (dep) => queue.push(dep), (w) => warnings.push(w));
  }

  options.onProgress?.(visited.size, 0);

  const tags: WalkedTag[] = [];
  const externalTags: WalkedTag[] = [];
  for (const tag of visited.values()) {
    tag.requiredBy = Array.from(requiredByMap.get(tag.originalIndex) ?? []).sort();
    if (tag.status === 'external') externalTags.push(tag);
    else tags.push(tag);
  }
  return { tags, externalTags, warnings };
}

/**
 * Shallow scan of `structName`'s own top-level TagDependency fields only (no reflexive
 * recursion) - used for a non-extractable BSP's "needed by BSP, not extracted" informational list.
 */
function collectDirectDependencyRefs(
  buffer: Buffer,
  structName: string,
  fileOffset: number,
  tagIndex: TagIndex,
): { originalIndex: number; group: string; path: string }[] {
  const resolved = resolveStruct(structName);
  if (fileOffset < 0 || fileOffset + resolved.totalSize > buffer.length) return [];
  const decoded = decodeStruct(buffer, fileOffset, structName);
  const out: { originalIndex: number; group: string; path: string }[] = [];
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value || value.kind !== 'dependency' || value.value.tagId === NULL_TAG_ID) continue;
    const idx = value.value.tagId & 0xffff;
    const referenced = idx < tagIndex.entries.length ? tagIndex.entries[idx] : undefined;
    out.push({ originalIndex: idx, group: referenced?.primaryClassName ?? fourCCToString(value.value.fourcc), path: referenced?.path ?? '(unknown)' });
  }
  return out;
}

function collectFromStruct(
  buffer: Buffer,
  structName: string,
  fileOffset: number,
  fileOffsetAnchor: number,
  baseMemoryAddress: number,
  contextPath: string,
  rootPath: string,
  rootOriginalIndex: number,
  enqueue: (item: QueueItem) => void,
  warn: (w: WalkerWarning) => void,
): void {
  const resolved = resolveStruct(structName);
  if (fileOffset < 0 || fileOffset + resolved.totalSize > buffer.length) return;
  const decoded = decodeStruct(buffer, fileOffset, structName);

  // ScenarioBSP carries both a dependency (to the sbsp tag) AND that tag's own location info.
  let bspLocationForStructureBsp: BspLocation | undefined;
  if (structName === 'ScenarioBSP') {
    const bspStart = (decoded.get('bsp start') as { kind: 'basic'; value: number } | undefined)?.value;
    const bspAddress = (decoded.get('bsp address') as { kind: 'basic'; value: number } | undefined)?.value;
    if (typeof bspStart === 'number' && typeof bspAddress === 'number' && bspStart + 24 <= buffer.length) {
      const metaPointer = buffer.readUInt32LE(bspStart + 0);
      bspLocationForStructureBsp = { fileOffset: resolvePointer(metaPointer, bspStart, bspAddress), fileOffsetAnchor: bspStart, baseMemoryAddress: bspAddress };
    }
  }

  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    if (field.def.nonCached) continue; // garbage in cache format, see SOURCES.md

    if (value.kind === 'dependency') {
      if (value.value.tagId !== NULL_TAG_ID) {
        enqueue({
          index: value.value.tagId & 0xffff,
          bspLocation: field.name === 'structure bsp' ? bspLocationForStructureBsp : undefined,
          fromPath: rootPath,
        });
      }
    } else if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const childBase = resolvePointer(value.value.pointerLow, fileOffsetAnchor, baseMemoryAddress);
      if (childBase < 0 || childBase + value.value.count * childSize > buffer.length) {
        warn({
          originalIndex: rootOriginalIndex,
          path: `${contextPath}.${field.name}`,
          group: '',
          kind: 'invalidReflexive',
          message: `"${contextPath}.${field.name}" (${value.value.count} x "${childStructName}") resolves outside this file (pointer base ${childBase}) - unrecognized/corrupt layout, not walked further.`,
        });
        continue;
      }
      if (childStructName === 'GBXModelGeometryPart') {
        // Model geometry (vertex/index data) is NOT modeled in our schema at all and is NOT
        // carried by the container format - see PRD.md "Model geometry relocation plan". Block
        // the WHOLE tag from injection rather than silently producing a tag whose geometry
        // pointers are meaningless in the target map.
        warn({
          originalIndex: rootOriginalIndex,
          path: `${contextPath}.${field.name}`,
          group: '',
          kind: 'uncapturedData',
          message: `"${contextPath}.${field.name}" has ${value.value.count} model geometry part(s) (vertex/index data in the separate model-data region) that this tool cannot yet capture or relocate - the WHOLE tag is blocked from injection, not silently dropped.`,
        });
      }
      const n = Math.min(value.value.count, MAX_ELEMENTS_WALKED_PER_REFLEXIVE);
      for (let i = 0; i < n; i++) {
        collectFromStruct(buffer, childStructName, childBase + i * childSize, fileOffsetAnchor, baseMemoryAddress, `${contextPath}.${field.name}[${i}]`, rootPath, rootOriginalIndex, enqueue, warn);
      }
    } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset && value.value.size > 0) {
      // Pointer-based "in tag data" raw bytes (font pixels, string_list/unicode_string_list
      // strings, meter stencil, hud_message_text, input_device_defaults, model_animations frame
      // data, scenario script/comment data) - same virtual-address mechanism as TagReflexive,
      // captured by the extractor (see `tag-extractor.ts`). Only warn here if it DOESN'T
      // resolve - the normal (in-bounds) case needs no warning, it's captured fine.
      const resolved2 = resolvePointer(value.value.pointerLow, fileOffsetAnchor, baseMemoryAddress);
      if (resolved2 < 0 || resolved2 + value.value.size > buffer.length) {
        warn({
          originalIndex: rootOriginalIndex,
          path: `${contextPath}.${field.name}`,
          group: '',
          kind: 'uncapturedData',
          message: `"${contextPath}.${field.name}" (${value.value.size} bytes) resolves outside this file (pointer base ${resolved2}) - cannot be captured, the WHOLE tag is blocked from injection, not silently dropped.`,
        });
      }
    }
  }

  for (const match of findEmbeddedDataFields(resolved, decoded)) {
    const fieldContext = `${contextPath}.${match.fieldName}`;
    if (match.kind === 'unknown') {
      warn({
        originalIndex: rootOriginalIndex,
        path: fieldContext,
        group: '',
        kind: 'embeddedRawData',
        message: `"${fieldContext}" is annotated as carrying embedded/external raw data but its layout could not be read - unrecognized, blocked, not guessed.`,
        resourceMap: match.resourceMap,
      });
    } else if (match.external) {
      warn({
        originalIndex: rootOriginalIndex,
        path: fieldContext,
        group: '',
        kind: 'externalData',
        message: `"${fieldContext}" (${match.size} bytes) lives in "${match.resourceMap}", not resolved this milestone (flagged only).`,
        resourceMap: match.resourceMap,
        fileOffset: match.fileOffset,
        size: match.size,
      });
    } else {
      warn({
        originalIndex: rootOriginalIndex,
        path: fieldContext,
        group: '',
        kind: 'embeddedRawData',
        message: `"${fieldContext}" (${match.size} bytes) is embedded in this map's own raw-data region (file offset ${match.fileOffset}), outside this tag's own struct bytes - captured into the container for relocation if the extracting build supports it (see Verify Embedded Data for status); injection is blocked unless the container has the captured bytes.`,
        resourceMap: match.resourceMap,
        fileOffset: match.fileOffset,
        size: match.size,
      });
    }
  }
}
