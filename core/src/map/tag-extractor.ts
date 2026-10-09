import { fourCCToString } from '../constants/tag-classes';
import { resolveTagDataPointer } from './tag-index';
import { resolveStruct, decodeStruct, getGroupDefinition, resolvePointer } from './definitions/engine';
import { walkDependencies } from './dependency-walker';
import type { WalkerWarning, WalkOptions } from './dependency-walker';
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

/**
 * Flattens one struct instance (and everything reachable from it via TagReflexive) into
 * `outChunks`, appending to the shared `runningOffset`. TagDependency fields are recorded into
 * `dependencies` but left byte-for-byte unchanged.
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
  fileOffsetAnchor: number,
  baseMemoryAddress: number,
  outChunks: Buffer[],
  runningOffset: { value: number },
  dependencies: ExtractedDependencyRef[],
  fieldPath: string,
  tagIndex: TagIndex,
  localIndexByOriginal: Map<number, number>,
  notExtractedByOriginal: Map<number, NotExtractedTag>,
): void {
  const resolved = resolveStruct(structName);
  const decoded = decodeStruct(buffer, fileOffset, structName);

  interface ReflexiveWork {
    fieldName: string;
    childStructName: string;
    childSize: number;
    srcChildBase: number;
    count: number;
    childBytesList: Buffer[];
  }
  const reflexiveWork: ReflexiveWork[] = [];

  // Phase 1: record dependencies, and reserve a CONTIGUOUS block for every reflexive field's
  // siblings (their own top-level bytes only - no recursion into grandchildren yet).
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value) continue;
    const path = `${fieldPath}.${field.name}`;

    if (value.kind === 'dependency') {
      dependencies.push(classifyDependency(value.value, path, tagIndex, localIndexByOriginal, notExtractedByOriginal));
    } else if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const srcChildBase = resolvePointer(value.value.pointerLow, fileOffsetAnchor, baseMemoryAddress);
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
      reflexiveWork.push({ fieldName: field.name, childStructName, childSize, srcChildBase, count: value.value.count, childBytesList });
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
        fileOffsetAnchor,
        baseMemoryAddress,
        outChunks,
        runningOffset,
        dependencies,
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
  for (const t of walk.tags) {
    const def = getGroupDefinition(t.group);
    if (def.extractable === false) {
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

  const tags: ExtractedTag[] = extractableWalked.map((t, i) => {
    if (options.signal?.aborted) throw new OperationCancelledError();
    options.onProgress?.(i, extractableWalked.length);

    const structName = getGroupDefinition(t.group).name;
    const fileOffsetAnchor = t.bspLocation ? t.bspLocation.fileOffsetAnchor : header.tagDataOffset;
    const baseMemoryAddress = t.bspLocation ? t.bspLocation.baseMemoryAddress : tagIndex.baseMemoryAddress;
    const fileOffset = t.bspLocation
      ? t.bspLocation.fileOffset
      : resolveTagDataPointer(tagIndex.entries[t.originalIndex].tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);

    const dependencies: ExtractedDependencyRef[] = [];
    const outChunks: Buffer[] = [];
    const runningOffset = { value: 0 };
    const rootResolved = resolveStruct(structName);
    const rootBytes = Buffer.from(buffer.subarray(fileOffset, fileOffset + rootResolved.totalSize));
    outChunks.push(rootBytes);
    runningOffset.value += rootResolved.totalSize;
    flattenStruct(
      buffer,
      structName,
      fileOffset,
      rootBytes,
      fileOffsetAnchor,
      baseMemoryAddress,
      outChunks,
      runningOffset,
      dependencies,
      t.path,
      tagIndex,
      localIndexByOriginal,
      notExtractedByOriginal,
    );

    return { originalIndex: t.originalIndex, group: t.group, path: t.path, structName, data: Buffer.concat(outChunks), dependencies,
      secondaryClassFourCC: tagIndex.entries[t.originalIndex].secondaryClassFourCC,
      tertiaryClassFourCC: tagIndex.entries[t.originalIndex].tertiaryClassFourCC };
  });

  options.onProgress?.(extractableWalked.length, extractableWalked.length);
  return { rootOriginalIndices: rootIndices, tags, notExtracted, warnings: walk.warnings };
}

/**
 * Confirms every pointer and reference inside an extracted set resolves: every TagReflexive
 * pointer (now a local byte offset) stays within its own tag's buffer, and every
 * non-null/non-external/non-excluded TagDependency resolves to another tag in the same set.
 */
export function verifyExtractedTagSet(set: ExtractedTagSet): string[] {
  const errors: string[] = [];

  for (const tag of set.tags) {
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
