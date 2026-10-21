import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { resolveTagDataPointer } from '../tag-index';
import { decodeStruct, getBitfieldDefinition, getGroupStructName, isRangeInBuffer, resolvePointer, resolveStruct } from '../definitions/engine';
import type { ResolvedStruct } from '../definitions/engine';
import { findEmbeddedDataFields, validateBitmapAssetSize, flagLocation } from '../embedded-data-fields';
import { appendToRawDataRegion, rawDataRegionLayoutOf } from '../raw-data-region';
import type { RawDataChunk } from '../raw-data-region';
import { rangeKey } from './resource-files';
import type { RandomAccessFile, ResourceKind, ResourceTable } from './resource-files';

/**
 * Converter Phase 1b: bring a retail-layout map's per-asset external data into the map.
 *
 * In retail-layout (v7) maps, bitmap images and sound permutations can be "external": their bytes
 * live in the source game's bitmaps.map / sounds.map at a raw file offset (PRD 2026-10-11
 * "Converter: per-asset external data"). Custom Edition has different resource files, so those
 * offsets point at the wrong bytes there. This module copies each external range from the
 * user-supplied resource file into the map's raw-data region and makes the asset internal.
 *
 * Which fields carry such data comes from the schema only (`findEmbeddedDataFields`: fields with an
 * `externalFileOffset` / `externalDataSibling` annotation - today BitmapData pixel data and
 * SoundPermutation samples); no group names here. A field the helper can't read ("unknown")
 * blocks the conversion. Per asset:
 *   - the offset field (BitmapData +0x18, samples file offset +0x48) gets the new absolute offset;
 *   - the external flag is cleared: BitmapData flags +0x0E bit 0x100; the samples word +0x44
 *     bit 0 only (other bits, e.g. 0x01000000, are kept - see SOURCES.md).
 * New data goes at the end of the existing raw-data region (or at the BSP end if there is none),
 * one copy per reference (CE-built maps never share a range), back to back with no padding,
 * bitmaps first, then sounds, each in tag-index order.
 */

export type AssetKind = 'bitmap' | 'sound';

export interface PerAssetData {
  kind: AssetKind;
  external: boolean;
  /** Raw stored offset: into the resource file when external, into this map when internal. */
  offset: number;
  size: number;
  tagIndex: number;
  tagPath: string;
  /** e.g. `bitmap data[2]` or `pitch ranges[0].permutations[3]`. */
  fieldPath: string;
  /** Block indices along `fieldPath`, e.g. [0, 3]. */
  blockIndices: number[];
  /** Absolute file offset of the 4-byte offset field. */
  offsetFieldAt: number;
  /** Absolute file offset, width and mask of the external flag. */
  flagAt: number;
  flagWidth: 2 | 4;
  flagMask: number;
  /** Bitmaps only: why the stored size differs from the size implied by width/height/format (copied by stored size anyway). */
  sizeNote?: string;
}

export interface PerAssetScan {
  assets: PerAssetData[];
  /** Things that stop the conversion: unreadable fields that may hold data outside the map. */
  blocked: string[];
  /** The last BSP's end (bsp start + bsp size), or the header size when there is no BSP. */
  bspEnd: number;
}

const CACHE_HEADER_SIZE = 0x800;
const MAX_BLOCKS_PER_LIST = 1 << 20;

const mayHoldAssetsMemo = new Map<string, boolean>();
/** True when this struct, or any block list below it, has a field annotated as bitmap/sound data. */
function structMayHoldAssets(name: string, visiting = new Set<string>()): boolean {
  const memo = mayHoldAssetsMemo.get(name);
  if (memo !== undefined) return memo;
  if (visiting.has(name)) return false;
  visiting.add(name);
  const resolved = resolveStruct(name);
  let result = false;
  for (const f of resolved.fields) {
    if (f.def.nonCached) continue;
    if (f.def.externalFileOffset || f.def.externalDataSibling) result = true;
    else if (f.def.type === 'TagReflexive' && f.def.struct && structMayHoldAssets(f.def.struct, visiting)) result = true;
    if (result) break;
  }
  mayHoldAssetsMemo.set(name, result);
  return result;
}

/**
 * Every bitmap/sound data field in the map (internal and external), found by walking every tag
 * through the schema; BSP tags through the scenario's "structure bsps" (their own anchor and
 * address). Reads only. `view` must read as a CE map (`header`/`tagIndex` from it).
 */
export function scanPerAssetData(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): PerAssetScan {
  const assets: PerAssetData[] = [];
  const blocked: string[] = [];
  const visited = new Set<string>();
  const bsps = structureBspsOf(view, header, tagIndex);
  const bspEnd = bsps.reduce((end, b) => Math.max(end, b.start + b.size), CACHE_HEADER_SIZE);

  const walk = (structName: string, at: number, anchor: number, base: number, tag: { index: number; path: string }, path: string, indices: number[]) => {
    const resolved = resolveStruct(structName);
    if (!isRangeInBuffer(at, resolved.totalSize, view.length)) {
      if (structMayHoldAssets(structName)) blocked.push(`${tag.path}: ${path || structName} is outside the file, so its bitmap or sound data can't be checked.`);
      return;
    }
    const key = `${structName}@${at}`;
    if (visited.has(key)) return;
    visited.add(key);
    const decoded = decodeStruct(view, at, structName);
    for (const match of findEmbeddedDataFields(resolved, decoded)) {
      const where = `${tag.path}: ${path ? `${path}.` : ''}${match.fieldName}`;
      const flag = match.kind === 'unknown' ? null : flagLocation(resolved, match.fieldName);
      if (match.kind === 'unknown' || !flag || match.patchWidth !== 4) {
        blocked.push(`${where}: this field's layout could not be read, so whether its data is outside the map can't be decided.`);
        continue;
      }
      let sizeNote: string | undefined;
      if (match.kind === 'bitmap') {
        const v = validateBitmapAssetSize(decoded, match.size);
        if (!v.ok) sizeNote = v.reason;
      }
      assets.push({
        kind: match.kind,
        external: match.external,
        offset: match.fileOffset,
        size: match.size,
        tagIndex: tag.index,
        tagPath: tag.path,
        fieldPath: path,
        blockIndices: indices,
        offsetFieldAt: at + match.patchOffset,
        flagAt: at + flag.offset,
        flagWidth: flag.width,
        flagMask: flag.mask,
        sizeNote,
      });
    }
    for (const field of resolved.fields) {
      if (field.def.nonCached || field.def.type !== 'TagReflexive' || !field.def.struct) continue;
      const value = decoded.get(field.name);
      if (value?.kind !== 'reflexive' || value.value.count === 0) continue;
      if (!structMayHoldAssets(field.def.struct)) continue;
      const childPath = `${path ? `${path}.` : ''}${field.name}`;
      if (value.value.count > MAX_BLOCKS_PER_LIST) {
        blocked.push(`${tag.path}: ${childPath} claims ${value.value.count} blocks, which can't be right.`);
        continue;
      }
      const childSize = resolveStruct(field.def.struct).totalSize;
      const first = resolvePointer(value.value.pointerLow >>> 0, anchor, base);
      for (let i = 0; i < value.value.count; i++) walk(field.def.struct, first + i * childSize, anchor, base, tag, `${childPath}[${i}]`, [...indices, i]);
    }
  };

  for (const e of tagIndex.entries) {
    if (e.isExternal) continue;
    const structName = e.primaryClassName ? getGroupStructName(e.primaryClassName) : null;
    if (!structName) continue;
    if (!structMayHoldAssets(structName)) continue;
    const tag = { index: e.index, path: e.path };
    if (e.primaryClassName === 'scenario_structure_bsp') {
      const bsp = bsps.find((b) => b.tagId === e.tagId);
      if (!bsp) {
        blocked.push(`${e.path}: this BSP is not in the scenario's "structure bsps" list, so it can't be read.`);
        continue;
      }
      walk(structName, resolvePointer(view.readUInt32LE(bsp.start), bsp.start, bsp.address), bsp.start, bsp.address, tag, '', []);
    } else {
      walk(structName, resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress), header.tagDataOffset, tagIndex.baseMemoryAddress, tag, '', []);
    }
  }
  return { assets, blocked, bspEnd };
}

interface StructureBsp {
  start: number;
  size: number;
  address: number;
  tagId: number;
}

function structureBspsOf(view: Buffer, header: CacheFileHeader, tagIndex: TagIndex): StructureBsp[] {
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario');
  if (!scenario || scenario.isExternal || !scenarioStruct) return [];
  const at = resolveTagDataPointer(scenario.tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(at, resolveStruct(scenarioStruct).totalSize, view.length)) return [];
  const list = decodeStruct(view, at, scenarioStruct).get('structure bsps');
  const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps');
  if (list?.kind !== 'reflexive' || !field?.def.struct) return [];
  const size = resolveStruct(field.def.struct).totalSize;
  const first = resolvePointer(list.value.pointerLow >>> 0, header.tagDataOffset, tagIndex.baseMemoryAddress);
  if (!isRangeInBuffer(first, list.value.count * size, view.length)) return [];
  const out: StructureBsp[] = [];
  for (let i = 0; i < list.value.count; i++) {
    const d = decodeStruct(view, first + i * size, field.def.struct);
    const num = (n: string) => {
      const v = d.get(n);
      return v?.kind === 'basic' ? Number(v.value) : NaN;
    };
    const dep = d.get('structure bsp');
    const start = num('bsp start');
    if (!Number.isFinite(start) || !isRangeInBuffer(start, 4, view.length)) continue;
    out.push({ start, size: num('bsp size'), address: num('bsp address') >>> 0, tagId: dep?.kind === 'dependency' ? dep.value.tagId >>> 0 : 0 });
  }
  return out;
}

/** The resource entry name a retail resource file gives this asset: `<tag>_<image>` or `<tag>__<pitch range>__<permutation>`. */
export function expectedResourceName(asset: PerAssetData): string {
  return asset.kind === 'bitmap' ? `${asset.tagPath}_${asset.blockIndices.join('_')}` : `${asset.tagPath}__${asset.blockIndices.join('__')}`;
}

const KIND_FILE: Record<AssetKind, ResourceKind> = { bitmap: 'bitmaps', sound: 'sounds' };

export interface ExternalImportPlan {
  /** External assets in copy order: bitmaps, then sounds, each in tag-index order. */
  assets: PerAssetData[];
  bytesAdded: number;
  /** Per resource file: external ranges that equal an entry, and those that don't. */
  matched: Record<ResourceKind, number>;
  unmatched: Record<ResourceKind, string[]>;
  /** Files needed but not supplied (or unreadable). */
  missing: ResourceKind[];
  /** Ranges that match an entry whose name isn't the expected one (warning only). */
  nameMismatches: string[];
  /** Bitmaps whose stored size differs from the formula (copied by stored size; warning only). */
  sizeMismatches: string[];
  /** The raw-data region ends exactly at the model data (otherwise refused). */
  rawRegionProblem: string | null;
  bspEnd: number;
  insertAt: number;
}

export function countExternal(scan: PerAssetScan): Record<AssetKind, { count: number; bytes: number }> {
  const out = { bitmap: { count: 0, bytes: 0 }, sound: { count: 0, bytes: 0 } };
  for (const a of scan.assets) {
    if (!a.external) continue;
    out[a.kind].count++;
    out[a.kind].bytes += a.size;
  }
  return out;
}

/**
 * Plans the import and runs the range check: every external (offset, size) must equal one entry's
 * (data offset, size) in the supplied file of its kind. That check decides whether a file is
 * usable; a file's name or size never does.
 */
export function planExternalImport(view: Buffer, scan: PerAssetScan, tables: Partial<Record<ResourceKind, ResourceTable>>): ExternalImportPlan {
  const external = scan.assets.filter((a) => a.external);
  const ordered = [...external.filter((a) => a.kind === 'bitmap'), ...external.filter((a) => a.kind === 'sound')];
  const matched: Record<ResourceKind, number> = { bitmaps: 0, sounds: 0 };
  const unmatched: Record<ResourceKind, string[]> = { bitmaps: [], sounds: [] };
  const missing = new Set<ResourceKind>();
  const nameMismatches: string[] = [];
  for (const a of ordered) {
    const kind = KIND_FILE[a.kind];
    const table = tables[kind];
    if (!table) {
      missing.add(kind);
      continue;
    }
    const entry = table.byRange.get(rangeKey(a.offset, a.size));
    if (!entry) {
      unmatched[kind].push(`${a.tagPath}: ${a.fieldPath} (offset ${a.offset}, ${a.size} bytes)`);
      continue;
    }
    matched[kind]++;
    const expected = expectedResourceName(a);
    if (entry.name.toLowerCase() !== expected.toLowerCase()) nameMismatches.push(`${a.tagPath}: ${a.fieldPath} uses resource "${entry.name}" (expected "${expected}")`);
  }
  const sizeMismatches = ordered.filter((a) => a.sizeNote).map((a) => `${a.tagPath}: ${a.fieldPath}: ${a.sizeNote}`);

  let rawRegionProblem: string | null = null;
  let insertAt = 0;
  try {
    insertAt = rawDataRegionLayoutOf(view, scan.bspEnd).insertAt;
    const internalEnd = scan.assets.filter((a) => !a.external).reduce((end, a) => Math.max(end, a.offset + a.size), scan.bspEnd);
    if (internalEnd !== insertAt) {
      rawRegionProblem = `The map's internal bitmap and sound data ends at ${internalEnd}, but its model data starts at ${insertAt}. Where new data would go is not known, so the map is not converted.`;
    }
  } catch (err) {
    rawRegionProblem = (err as Error).message;
  }
  return {
    assets: ordered,
    bytesAdded: ordered.reduce((n, a) => n + a.size, 0),
    matched,
    unmatched,
    missing: [...missing],
    nameMismatches,
    sizeMismatches,
    rawRegionProblem,
    bspEnd: scan.bspEnd,
    insertAt,
  };
}

export interface ExternalImportResult {
  buffer: Buffer;
  rangesCopied: number;
  bytesAdded: number;
  /** Where the new data starts (the old model data offset). */
  insertAt: number;
}

/**
 * Builds the output: the external ranges copied (read by offset from `files`) into the raw-data
 * region, the moved model data and tag data, and every asset's offset field and external flag
 * patched. Never mutates `source`. The plan must have no missing files, unmatched ranges or raw
 * region problem (the caller refuses those first).
 */
export function importExternalData(
  source: Buffer,
  plan: ExternalImportPlan,
  files: Partial<Record<ResourceKind, RandomAccessFile>>,
  hooks: { onProgress?: (bytesDone: number, bytesTotal: number) => void; shouldCancel?: () => boolean } = {},
): ExternalImportResult {
  let done = 0;
  const chunks: RawDataChunk[] = plan.assets.map((a) => {
    const file = files[KIND_FILE[a.kind]];
    if (!file) throw new Error(`No ${KIND_FILE[a.kind]}.map was supplied.`);
    return {
      length: a.size,
      write: (target, at) => {
        try {
          const bytes = file.read(a.offset, a.size);
          if (bytes.length === a.size) {
            bytes.copy(target, at);
          } else {
            target.fill(0, at, at + a.size);
          }
        } catch {
          target.fill(0, at, at + a.size);
        }
        done += a.size;
        hooks.onProgress?.(done, plan.bytesAdded);
      },
    };
  });
  const layout = rawDataRegionLayoutOf(source, plan.bspEnd);
  const { buffer, shift, chunkOffsets } = appendToRawDataRegion(source, layout, chunks, { shouldCancel: hooks.shouldCancel });
  const moved = (at: number) => (at >= layout.insertAt ? at + shift : at);
  plan.assets.forEach((a, i) => {
    buffer.writeUInt32LE(chunkOffsets[i], moved(a.offsetFieldAt));
    const flagAt = moved(a.flagAt);
    if (a.flagWidth === 2) buffer.writeUInt16LE(buffer.readUInt16LE(flagAt) & ~a.flagMask & 0xffff, flagAt);
    else buffer.writeUInt32LE((buffer.readUInt32LE(flagAt) & ~a.flagMask) >>> 0, flagAt);
  });
  return { buffer, rangesCopied: plan.assets.length, bytesAdded: shift, insertAt: layout.insertAt };
}
