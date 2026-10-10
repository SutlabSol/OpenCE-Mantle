import { fourCCToString } from '../constants/tag-classes';
import { resolveTagDataPointer } from './tag-index';
import { resolveStruct, decodeStruct, getGroupDefinition, getAllTagGroupNames, resolvePointer, isRangeInBuffer } from './definitions/engine';
import { walkDependencies } from './dependency-walker';
import type { WalkerWarning, WalkOptions } from './dependency-walker';
import { findEmbeddedDataFields, validateBitmapAssetSize } from './embedded-data-fields';
import { OperationCancelledError } from './errors';
import type { CacheFileHeader } from './header';
import type { TagIndex } from './tag-index';

const NULL_TAG_ID = 0xffffffff;

export type DependencyRefKind = 'internal' | 'external' | 'null' | 'unresolved' | 'notExtracted';

export interface ExtractedDependencyRef {
  fieldPath: string;
  group: string;
  path: string;
  kind: DependencyRefKind;
  /** Only set when kind === 'internal': index into `ExtractedTagSet.tags`. */
  localTagIndex?: number;
}

/** One unique embedded (external=0) bitmap/sound raw-data range captured from the source map. */
export interface ExtractedEmbeddedAsset {
  kind: 'bitmap' | 'sound';
  data: Buffer;
}

/** One place, within this tag's own flattened `data`, whose raw file-offset value points at `assetIndex`. */
export interface ExtractedEmbeddedPatch {
  assetIndex: number;
  patchOffset: number;
  patchWidth: number;
}

/**
 * A reason, decided at extraction time and stored per tag in the container (v4+), why this tag
 * must never be injected. The injector reads these straight from the saved `.ocetags` file - no
 * source map or walker re-run needed.
 * - `invalidReflexive`: a TagReflexive array resolves (partly or entirely) outside the source
 *   map. Its 12 bytes are left exactly as in the source (an unrelocated source-map pointer), and
 *   nothing below it was captured.
 * - `extractionFailed`: an unexpected exception while flattening this tag. `data` holds only the
 *   unmodified root struct bytes (or nothing), `dependencies` is empty.
 */
export interface InjectionBlocker {
  kind: 'invalidReflexive' | 'extractionFailed';
  fieldPath: string;
  message: string;
}

export interface ExtractedTag {
  originalIndex: number;
  group: string;
  path: string;
  structName: string;
  secondaryClassFourCC: number | null;
  tertiaryClassFourCC: number | null;
  /**
   * The tag's root struct followed by every reflexive descendant, flattened into one
   * self-contained buffer. TagReflexive pointer fields are rewritten to LOCAL byte offsets
   * within this buffer (position-independent of the source map's load address).
   * TagDependency fields are left byte-for-byte as in the source map (raw tag_id/fourcc) -
   * `dependencies` is the side-table used to remap them at injection time (M5).
   */
  data: Buffer;
  dependencies: ExtractedDependencyRef[];
  /** Embedded (external=0) bitmap/sound raw bytes captured from the source map, deduped by (fileOffset, size). Empty if this tag has none, or if any one of them failed validation (see `embeddedCaptureBlockedReasons` on the returned set's warnings - a mismatch blocks the WHOLE tag, never a partial relocation). */
  embeddedRawDataAssets: ExtractedEmbeddedAsset[];
  embeddedRawDataPatches: ExtractedEmbeddedPatch[];
  /** Non-empty = this tag is blocked from ADD/SWAP (see `InjectionBlocker`). */
  injectionBlockers: InjectionBlocker[];
}

/** A tag that was walked but whose group is not yet extractable (e.g. `scenario_structure_bsp`). */
export interface NotExtractedTag {
  originalIndex: number;
  group: string;
  path: string;
  reason: string;
}

export interface ExtractedTagSet {
  rootOriginalIndices: number[];
  tags: ExtractedTag[];
  /** Tags reached by the walk but excluded from `tags` (see each entry's `reason`). */
  notExtracted: NotExtractedTag[];
  warnings: WalkerWarning[];
}

/**
 * Thrown when every tag reachable from the requested selection is marked `extractable: false`
 * in its group definition (e.g. a BSP-only selection) - there is nothing left to write.
 */
export class AllTagsExcludedError extends Error {
  constructor(public readonly notExtracted: NotExtractedTag[]) {
    super(`Nothing in this selection can be extracted yet: ${notExtracted.map((t) => `"${t.path}" (${t.group})`).join(', ')}.`);
    this.name = 'AllTagsExcludedError';
  }
}

function classifyDependency(
  dep: { fourcc: number; tagId: number },
  fieldPath: string,
  tagIndex: TagIndex,
  localIndexByOriginal: Map<number, number>,
  notExtractedByOriginal: Map<number, NotExtractedTag>,
): ExtractedDependencyRef {
  if (dep.tagId === NULL_TAG_ID) return { fieldPath, group: '', path: '', kind: 'null' };
  const idx = dep.tagId & 0xffff;
  const referenced = idx < tagIndex.entries.length ? tagIndex.entries[idx] : undefined;
  const group = referenced?.primaryClassName ?? fourCCToString(dep.fourcc);
  const path = referenced?.path ?? '(unknown)';
  if (referenced?.isExternal) return { fieldPath, group, path, kind: 'external' };
  const notExtracted = notExtractedByOriginal.get(idx);
  if (notExtracted) return { fieldPath, group: notExtracted.group, path: notExtracted.path, kind: 'notExtracted' };
  const localTagIndex = localIndexByOriginal.get(idx);
  if (localTagIndex !== undefined) return { fieldPath, group, path, kind: 'internal', localTagIndex };
  return { fieldPath, group, path, kind: 'unresolved' };
}

/** Accumulates embedded (external=0) bitmap/sound captures for ONE tag across every struct level reached by `flattenStruct`. Bytes deduped by (fileOffset, size); every patch offset is recorded even when it shares an asset. */
interface EmbeddedCaptureState {
  dedupeKeyToAssetIndex: Map<string, number>;
  assets: ExtractedEmbeddedAsset[];
  patches: ExtractedEmbeddedPatch[];
  /** Human-readable reasons a candidate asset was NOT captured (out of bounds, size mismatch, unrecognized layout) - a non-empty list blocks relocation for the whole tag. */
  blockedReasons: string[];
}

function captureEmbeddedFields(
  buffer: Buffer,
  resolved: ReturnType<typeof resolveStruct>,
  decoded: ReturnType<typeof decodeStruct>,
  myAbsoluteOffset: number,
  fieldPath: string,
  capture: EmbeddedCaptureState,
): void {
  for (const match of findEmbeddedDataFields(resolved, decoded)) {
    const context = `${fieldPath}.${match.fieldName}`;
    if (match.external) continue; // lives in bitmaps.map/sounds.map - out of scope here (see externalResourceRefs)
    if (match.kind === 'unknown') {
      capture.blockedReasons.push(`${context}: unrecognized embedded-data layout, not captured.`);
      continue;
    }
    if (match.fileOffset < 0 || match.size <= 0 || match.fileOffset + match.size > buffer.length) {
      capture.blockedReasons.push(`${context}: file offset ${match.fileOffset} + size ${match.size} is out of bounds of the source map.`);
      continue;
    }
    if (match.kind === 'bitmap') {
      const validation = validateBitmapAssetSize(decoded, match.size);
      if (!validation.ok) {
        capture.blockedReasons.push(`${context}: ${validation.reason}.`);
        continue;
      }
    }
    const dedupeKey = `${match.fileOffset}:${match.size}`;
    let assetIndex = capture.dedupeKeyToAssetIndex.get(dedupeKey);
    if (assetIndex === undefined) {
      assetIndex = capture.assets.length;
      capture.assets.push({ kind: match.kind, data: Buffer.from(buffer.subarray(match.fileOffset, match.fileOffset + match.size)) });
      capture.dedupeKeyToAssetIndex.set(dedupeKey, assetIndex);
    }
    capture.patches.push({ assetIndex, patchOffset: myAbsoluteOffset + match.patchOffset, patchWidth: match.patchWidth });
  }
}

/**
 * Flattens one struct instance (and everything reachable from it via TagReflexive) into
 * `outChunks`, appending to the shared `runningOffset`. TagDependency fields are recorded into
 * `dependencies` but left byte-for-byte unchanged. Embedded (external=0) bitmap/sound fields
 * found on this struct are captured into `embeddedCapture`, keyed by their position
 * (`myAbsoluteOffset`) within the tag's own final flattened buffer.
 *
 * Two-phase per struct, NOT a naive single-pass DFS: for each reflexive field, every sibling
 * element's own top-level bytes are written CONTIGUOUSLY first (phase 1), and only after that
 * whole contiguous array is reserved do we recurse into each sibling's own nested fields (phase
 * 2). TagReflexive arrays are fixed-stride (element i is at `arrayBase + i * elementSize`) - a
 * naive DFS that recurses into element 0's descendants before writing element 1 would insert
 * element 0's children BETWEEN element 0 and element 1, breaking that stride invariant for
 * every element after the first.
 */
function flattenStruct(
  buffer: Buffer,
  structName: string,
  fileOffset: number,
  myBytes: Buffer,
  myAbsoluteOffset: number,
  fileOffsetAnchor: number,
  baseMemoryAddress: number,
  outChunks: Buffer[],
  runningOffset: { value: number },
  dependencies: ExtractedDependencyRef[],
  embeddedCapture: EmbeddedCaptureState,
  injectionBlockers: InjectionBlocker[],
  fieldPath: string,
  tagIndex: TagIndex,
  localIndexByOriginal: Map<number, number>,
  notExtractedByOriginal: Map<number, NotExtractedTag>,
): void {
  const resolved = resolveStruct(structName);
  const decoded = decodeStruct(buffer, fileOffset, structName);
  captureEmbeddedFields(buffer, resolved, decoded, myAbsoluteOffset, fieldPath, embeddedCapture);

  interface ReflexiveWork {
    fieldName: string;
    childStructName: string;
    childSize: number;
    srcChildBase: number;
    localArrayStart: number;
    count: number;
    childBytesList: Buffer[];
  }
  const reflexiveWork: ReflexiveWork[] = [];

  // Phase 1: record dependencies, and reserve a CONTIGUOUS block for every reflexive field's
  // siblings (their own top-level bytes only - no recursion into grandchildren yet).
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    if (field.def.nonCached) continue; // garbage in cache format (e.g. bitmap's color-plate/processed-pixel TagDataOffset fields) - same exclusion as dependency-walker.ts's collectFromStruct and embedded-data-fields.ts's findEmbeddedDataFields, never treated as real pointer data.
    const path = `${fieldPath}.${field.name}`;

    if (value.kind === 'dependency') {
      dependencies.push(classifyDependency(value.value, path, tagIndex, localIndexByOriginal, notExtractedByOriginal));
    } else if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const srcChildBase = resolvePointer(value.value.pointerLow, fileOffsetAnchor, baseMemoryAddress);
      if (!isRangeInBuffer(srcChildBase, value.value.count * childSize, buffer.length)) {
        // Same rule as the walker's 'invalidReflexive' warning (shared helper). Copy nothing,
        // recurse into nothing, don't advance runningOffset, and leave the field's 12 bytes as
        // in the source. That unrelocated source-map pointer is only safe because the injector
        // refuses any tag carrying this blocker (see `tag-injector.ts`).
        injectionBlockers.push({
          kind: 'invalidReflexive',
          fieldPath: path,
          message: `"${path}" (${value.value.count} x "${childStructName}") resolves outside the source map (file offset ${srcChildBase}, map is ${buffer.length} bytes) - not captured, the WHOLE tag is blocked from injection.`,
        });
        continue;
      }
      const localArrayStart = runningOffset.value;
      myBytes.writeUInt32LE(localArrayStart, field.offset + 4);
      myBytes.writeUInt32LE(0, field.offset + 8);

      const childBytesList: Buffer[] = [];
      for (let i = 0; i < value.value.count; i++) {
        const childOffset = srcChildBase + i * childSize;
        const childBytes = Buffer.from(buffer.subarray(childOffset, childOffset + childSize));
        outChunks.push(childBytes);
        childBytesList.push(childBytes);
        runningOffset.value += childSize;
      }
      reflexiveWork.push({ fieldName: field.name, childStructName, childSize, srcChildBase, localArrayStart, count: value.value.count, childBytesList });
    } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset && value.value.size > 0) {
      // Pointer-based "in tag data" raw bytes (font pixels, string_list/unicode_string_list
      // strings, meter stencil, hud_message_text, input_device_defaults, model_animations frame
      // data, scenario script/comment data) - same virtual-address mechanism as TagReflexive, so
      // captured the same way: append the pointed-to bytes, rewrite the pointer to the new local
      // offset. If the pointer doesn't resolve, leave it byte-for-byte as in the source (the
      // walker already flagged this with an 'uncapturedData' warning that blocks the WHOLE tag
      // from injection - see `dependency-walker.ts`).
      const srcBase = resolvePointer(value.value.pointerLow, fileOffsetAnchor, baseMemoryAddress);
      if (isRangeInBuffer(srcBase, value.value.size, buffer.length)) {
        const localOffset = runningOffset.value;
        const bytes = Buffer.from(buffer.subarray(srcBase, srcBase + value.value.size));
        outChunks.push(bytes);
        runningOffset.value += bytes.length;
        myBytes.writeUInt32LE(localOffset, field.offset + 12); // DecodedTagDataOffset.pointerLow
        myBytes.writeUInt32LE(0, field.offset + 16); // pointerHigh
      }
    }
  }

  // Phase 2: now that every sibling array at THIS level is contiguous, recurse into each
  // element's own fields (which may append further descendants after the current offset).
  for (const work of reflexiveWork) {
    for (let i = 0; i < work.count; i++) {
      flattenStruct(
        buffer,
        work.childStructName,
        work.srcChildBase + i * work.childSize,
        work.childBytesList[i],
        work.localArrayStart + i * work.childSize,
        fileOffsetAnchor,
        baseMemoryAddress,
        outChunks,
        runningOffset,
        dependencies,
        embeddedCapture,
        injectionBlockers,
        `${fieldPath}.${work.fieldName}[${i}]`,
        tagIndex,
        localIndexByOriginal,
        notExtractedByOriginal,
      );
    }
  }
}

/**
 * Walks the dependency closure from `rootIndices` and flattens every reachable, extractable
 * internal tag into a self-contained, relocatable buffer. Tags whose group definition sets
 * `extractable: false` (e.g. `scenario_structure_bsp`) are excluded from `tags` and reported in
 * `notExtracted` instead - never silently included as broken data. Throws
 * `AllTagsExcludedError` if that would leave nothing to extract (e.g. a BSP-only selection).
 */
export function extractTagSet(
  buffer: Buffer,
  header: CacheFileHeader,
  tagIndex: TagIndex,
  rootIndices: number[],
  options: WalkOptions = {},
): ExtractedTagSet {
  const walk = walkDependencies(buffer, header, tagIndex, rootIndices, options);

  const extractableWalked: typeof walk.tags = [];
  const notExtracted: NotExtractedTag[] = [];
  const notExtractedByOriginal = new Map<number, NotExtractedTag>();
  const knownGroups = new Set(getAllTagGroupNames());
  for (const t of walk.tags) {
    // A tag with no registered definition (the walker's 'noDefinition' case) is NOT looked up
    // here - it goes on to the per-tag try below, which blocks just that tag (extractionFailed).
    const def = knownGroups.has(t.group) ? getGroupDefinition(t.group) : null;
    if (def && def.extractable === false) {
      const entry: NotExtractedTag = {
        originalIndex: t.originalIndex,
        group: t.group,
        path: t.path,
        reason: def.notExtractableReason ?? `"${t.group}" tags are not extractable yet.`,
      };
      notExtracted.push(entry);
      notExtractedByOriginal.set(t.originalIndex, entry);
    } else {
      extractableWalked.push(t);
    }
  }

  if (extractableWalked.length === 0) {
    throw new AllTagsExcludedError(notExtracted);
  }

  const localIndexByOriginal = new Map<number, number>();
  extractableWalked.forEach((t, i) => localIndexByOriginal.set(t.originalIndex, i));

  const extraWarnings: WalkerWarning[] = [];
  const tags: ExtractedTag[] = extractableWalked.map((t, i) => {
    if (options.signal?.aborted) throw new OperationCancelledError();
    options.onProgress?.(i, extractableWalked.length);

    const entry = tagIndex.entries[t.originalIndex];
    const common = { originalIndex: t.originalIndex, group: t.group, path: t.path,
      secondaryClassFourCC: entry.secondaryClassFourCC, tertiaryClassFourCC: entry.tertiaryClassFourCC };
    let structName = ''; // stays '' if the group has no definition (noDefinition)
    let fileOffset = -1;
    try {
      structName = getGroupDefinition(t.group).name;
      const fileOffsetAnchor = t.bspLocation ? t.bspLocation.fileOffsetAnchor : header.tagDataOffset;
      const baseMemoryAddress = t.bspLocation ? t.bspLocation.baseMemoryAddress : tagIndex.baseMemoryAddress;
      fileOffset = t.bspLocation
        ? t.bspLocation.fileOffset
        : resolveTagDataPointer(entry.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);

      const dependencies: ExtractedDependencyRef[] = [];
      const outChunks: Buffer[] = [];
      const runningOffset = { value: 0 };
      const embeddedCapture: EmbeddedCaptureState = { dedupeKeyToAssetIndex: new Map(), assets: [], patches: [], blockedReasons: [] };
      const injectionBlockers: InjectionBlocker[] = [];
      const rootResolved = resolveStruct(structName);
      const rootBytes = Buffer.from(buffer.subarray(fileOffset, fileOffset + rootResolved.totalSize));
      outChunks.push(rootBytes);
      runningOffset.value += rootResolved.totalSize;
      flattenStruct(
        buffer,
        structName,
        fileOffset,
        rootBytes,
        0,
        fileOffsetAnchor,
        baseMemoryAddress,
        outChunks,
        runningOffset,
        dependencies,
        embeddedCapture,
        injectionBlockers,
        t.path,
        tagIndex,
        localIndexByOriginal,
        notExtractedByOriginal,
      );

      if (embeddedCapture.blockedReasons.length > 0) {
        extraWarnings.push({
          originalIndex: t.originalIndex,
          path: t.path,
          group: t.group,
          kind: 'embeddedRawData',
          message: `"${t.path}" has embedded raw data that could not be safely captured, so NONE of it was captured (never a partial relocation): ${embeddedCapture.blockedReasons.join(' ')}`,
        });
      }

      return { ...common, structName, data: Buffer.concat(outChunks), dependencies,
        embeddedRawDataAssets: embeddedCapture.blockedReasons.length > 0 ? [] : embeddedCapture.assets,
        embeddedRawDataPatches: embeddedCapture.blockedReasons.length > 0 ? [] : embeddedCapture.patches,
        injectionBlockers };
    } catch (err) {
      if (err instanceof OperationCancelledError) throw err;
      // One bad tag must not fail the whole selection with a raw exception. Keep the tag in the
      // set (so anything depending on it is blocked too, via the injector's dependency cascade)
      // with only its unmodified root struct bytes (none if the group has no definition or the
      // root is out of bounds), no dependencies, and a blocker.
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const message = `"${t.path}" (${t.group}) could not be extracted (unexpected error: ${detail}) - the tag is blocked from injection; the rest of the selection was extracted normally.`;
      extraWarnings.push({ originalIndex: t.originalIndex, path: t.path, group: t.group, kind: 'extractionFailed', message });
      const rootSize = structName ? resolveStruct(structName).totalSize : 0;
      const data = rootSize > 0 && isRangeInBuffer(fileOffset, rootSize, buffer.length) ? Buffer.from(buffer.subarray(fileOffset, fileOffset + rootSize)) : Buffer.alloc(0);
      return { ...common, structName, data, dependencies: [], embeddedRawDataAssets: [], embeddedRawDataPatches: [],
        injectionBlockers: [{ kind: 'extractionFailed' as const, fieldPath: t.path, message }] };
    }
  });

  options.onProgress?.(extractableWalked.length, extractableWalked.length);
  return { rootOriginalIndices: rootIndices, tags, notExtracted, warnings: [...walk.warnings, ...extraWarnings] };
}

/**
 * Confirms every pointer and reference inside an extracted set resolves: every TagReflexive
 * pointer (now a local byte offset) stays within its own tag's buffer, and every
 * non-null/non-external/non-excluded TagDependency resolves to another tag in the same set.
 */
export function verifyExtractedTagSet(set: ExtractedTagSet): string[] {
  const errors: string[] = [];

  for (const tag of set.tags) {
    if (tag.injectionBlockers.some((b) => b.kind === 'extractionFailed')) {
      // No flattened data to check (and possibly no struct definition at all) - report it, don't walk it.
      errors.push(`${tag.path} (#${tag.originalIndex}): not extracted (extractionFailed) - blocked from injection.`);
      continue;
    }
    verifyLocalStruct(tag.data, tag.structName, 0, `${tag.path} (#${tag.originalIndex})`, errors);
    for (const dep of tag.dependencies) {
      if (dep.kind === 'unresolved') {
        errors.push(`${tag.path}${dep.fieldPath}: dependency to "${dep.path}" (${dep.group}) did not resolve to any tag in the extracted set or an external map.`);
      } else if (dep.kind === 'internal' && (dep.localTagIndex === undefined || dep.localTagIndex < 0 || dep.localTagIndex >= set.tags.length)) {
        errors.push(`${tag.path}${dep.fieldPath}: internal dependency localTagIndex ${dep.localTagIndex} is out of range.`);
      }
    }
  }
  return errors;
}

function verifyLocalStruct(data: Buffer, structName: string, offset: number, context: string, errors: string[]): void {
  const resolved = resolveStruct(structName);
  if (offset < 0 || offset + resolved.totalSize > data.length) {
    errors.push(`${context}: struct "${structName}" at local offset ${offset} is out of bounds of its own extracted buffer (len ${data.length}).`);
    return;
  }
  const decoded = decodeStruct(data, offset, structName);
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value || value.kind !== 'reflexive' || value.value.count === 0) continue;
    const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
    if (!childStructName) continue;
    const childSize = resolveStruct(childStructName).totalSize;
    const childBase = value.value.pointerLow; // already a local offset (pointerHigh/base are 0 for extracted data)
    if (childBase < 0 || childBase + value.value.count * childSize > data.length) {
      errors.push(`${context}.${field.name}: local reflexive of ${value.value.count}x "${childStructName}" at offset ${childBase} is out of bounds.`);
      continue;
    }
    for (let i = 0; i < value.value.count; i++) {
      verifyLocalStruct(data, childStructName, childBase + i * childSize, `${context}.${field.name}[${i}]`, errors);
    }
  }
}
