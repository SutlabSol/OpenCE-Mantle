import { CE_TAG_SPACE_SIZE, TAG_DATA_HEADER_PC_SIZE } from '../../constants/cache-file';
import { parseCacheFileHeader } from '../header';
import type { CacheFileHeader } from '../header';
import { parseTagIndex } from '../tag-index';
import type { TagIndex } from '../tag-index';
import { decodeStruct, getGroupStructName, resolveStruct } from '../definitions/engine';
import { applyPointerShift, collectTagDataPointers, tagDataLayoutOf, UnwalkableTagError } from '../pointer-rebase';
import type { TagDataPointerKind, TagDataPointerSite, ToleratedPointer } from '../pointer-rebase';
import { bspAddresses } from './tag-data-repairs';

/**
 * Converter Phase 1c: align the tag data (PRD 2026-10-12 "Research: the sound and HUD glitches" and
 * "Phase 1c"). Format reference only, no code copied: OpenCE (6399ed9) `loaded_block_get`
 * (port/linux/game/cache_file_formats.c) treats a block whose offset in the loaded memory (the tag
 * cache at 0x40440000, or a structure BSP at its address) is not a multiple of 4 as unreadable, and
 * every OpenCE pass that walks blocks through it or `custom_edition_cache_block_element` skips such a
 * block silently: the sound conversion (Ogg Vorbis -> Xbox ADPCM), the HUD half-scale and meter passes.
 *
 * Measured: Tool pads after the last tag path string so the first struct starts 4-aligned (the 5 CE
 * maps, PC and HaloMD bloodgulch: 0 unaligned blocks); the HaloMD tool did not, so every root, block
 * and data block after the path strings has one remainder (heh_2, theisland_3, barrier: 2 mod 4;
 * crossing: 1 mod 4). The repair inserts `bytes` = (4 - remainder) mod 4 zero bytes right after the
 * path strings and moves every pointer at or past that point by `bytes`: the mechanism Inject's ADD
 * uses when the tag array grows (`applyPointerShift`). Path strings, the tag array, the BSPs, model
 * data and raw data do not move. A map whose remainders differ, or whose structs and path strings
 * interleave, is refused (no per-block re-layout).
 *
 * Pointers are found by the schema walk (`collectTagDataPointers`) in its tolerant mode: only the
 * known stale demo-era reference path pointers (outside the tag data) and roots outside the tag data
 * (replaced by the tagRootOutside repair; the caller checks) are allowed; anything else unwalkable
 * refuses. Same-reader: shares the schema engine with the rest of the converter.
 */

export const ALIGNMENT = 4;

export interface AlignmentCounts {
  checked: number;
  unaligned: number;
  /** Count per remainder of the offset from the loaded memory's start (index 0..3). */
  byRemainder: [number, number, number, number];
}

export interface BlockAlignmentReport {
  /** Blocks (count > 0) in the tag data, measured from 0x40440000: exactly what `loaded_block_get` tests. */
  blocks: AlignmentCounts;
  /** Blocks (count > 0) inside each structure BSP, measured from the BSP's address (`loaded_block_get` with the BSP). */
  bspBlocks: AlignmentCounts;
  /** Tag roots and data blocks (size > 0): not tested by `loaded_block_get`, reported for completeness. */
  roots: AlignmentCounts;
  dataBlocks: AlignmentCounts;
  /** A few unaligned blocks, for the dialog. */
  examples: string[];
}

export interface TagDataAlignmentPlan {
  report: BlockAlignmentReport;
  /** True when anything (blocks, roots or data blocks) is unaligned. */
  needed: boolean;
  /** Offset from the tag data start where the bytes go (the end of the path strings). */
  insertAt: number;
  bytes: number;
  remainder: number;
  /** Pointers per kind that move. */
  pointersToMove: Record<TagDataPointerKind, number>;
  tolerated: ToleratedPointer[];
  /** Reasons the map can't be aligned (each refuses the conversion). */
  problems: string[];
}

export class TagDataAlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagDataAlignmentError';
  }
}

const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const zeroCounts = (): AlignmentCounts => ({ checked: 0, unaligned: 0, byRemainder: [0, 0, 0, 0] });
const count = (c: AlignmentCounts, offset: number) => {
  const r = ((offset % ALIGNMENT) + ALIGNMENT) % ALIGNMENT;
  c.checked++;
  c.byRemainder[r]++;
  if (r !== 0) c.unaligned++;
};
const MAX_EXAMPLES = 20;
const TAG_DATA_FILE_SIZE_OFFSET = 0x8;
const TAG_DATA_SIZE_OFFSET = 0x14;
const TAG_DATA_TAG_DATA_OFFSET = 0x10;
/** TagReflexive: count at +0, pointer at +4. TagDataOffset: size at +0, pointer at +0xC. */
const REFLEXIVE_COUNT_BEFORE_POINTER = 4;
const DATA_SIZE_BEFORE_POINTER = 0xc;

interface Walked {
  sites: TagDataPointerSite[];
  tolerated: ToleratedPointer[];
}

function walk(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): Walked {
  const tolerated: ToleratedPointer[] = [];
  const sites = collectTagDataPointers(buffer, tagDataLayoutOf(header, tagIndex), { tolerate: { staleReferencePaths: true, rootsOutsideTagData: true }, tolerated });
  return { sites, tolerated };
}

/** Blocks inside each structure BSP the scenario lists, measured from the BSP's address. */
function countBspBlocks(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex, counts: AlignmentCounts, examples: string[]): void {
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario');
  const bspStruct = getGroupStructName('scenario_structure_bsp');
  if (!scenario || scenario.isExternal || !scenarioStruct || !bspStruct) return;
  const base = tagIndex.baseMemoryAddress;
  const scenarioAt = header.tagDataOffset + (scenario.tagDataPointerOrResourceIndex - base);
  const bsps = decodeStruct(buffer, scenarioAt, scenarioStruct).get('structure bsps');
  const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps');
  const elementStruct = field?.def.type === 'TagReflexive' ? field.def.struct : undefined;
  if (bsps?.kind !== 'reflexive' || !elementStruct) return;
  const elementSize = resolveStruct(elementStruct).totalSize;
  for (let b = 0; b < bsps.value.count; b++) {
    const element = decodeStruct(buffer, header.tagDataOffset + (bsps.value.pointerLow + b * elementSize - base), elementStruct);
    const num = (name: string) => {
      const v = element.get(name);
      return v?.kind === 'basic' ? Number(v.value) >>> 0 : 0;
    };
    const start = num('bsp start');
    const size = num('bsp size');
    const address = num('bsp address');
    const inBsp = (pointer: number, length: number) => {
      const at = start + ((pointer - address) | 0);
      return at >= start && at + length <= start + size && at + length <= buffer.length;
    };
    const visited = new Set<string>();
    const visit = (structName: string, pointer: number): void => {
      const structSize = resolveStruct(structName).totalSize;
      if (!inBsp(pointer, structSize)) return; // the extent check reports it
      const at = start + ((pointer - address) | 0);
      const key = `${structName}@${at}`;
      if (visited.has(key)) return;
      visited.add(key);
      const decoded = decodeStruct(buffer, at, structName);
      for (const f of resolveStruct(structName).fields) {
        const v = decoded.get(f.name);
        if (!v || f.def.nonCached || v.kind !== 'reflexive' || f.def.type !== 'TagReflexive' || v.value.count <= 0 || !f.def.struct) continue;
        const child = f.def.struct;
        const childSize = resolveStruct(child).totalSize;
        const childPointer = v.value.pointerLow >>> 0;
        count(counts, childPointer - address);
        if ((childPointer - address) % ALIGNMENT !== 0 && examples.length < MAX_EXAMPLES) examples.push(`structure BSP ${b} ${structName}.${f.name}: ${v.value.count} block(s) at ${hex(childPointer)}, ${(childPointer - address) % ALIGNMENT} mod 4 from the BSP address`);
        if (!inBsp(childPointer, v.value.count * childSize)) continue;
        for (let i = 0; i < v.value.count; i++) visit(child, (childPointer + i * childSize) >>> 0);
      }
    };
    if (size >= 4 && start + 4 <= buffer.length) visit(bspStruct, buffer.readUInt32LE(start));
  }
}

function measure(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex, walked: Walked): BlockAlignmentReport {
  const base = tagIndex.baseMemoryAddress;
  const report: BlockAlignmentReport = { blocks: zeroCounts(), bspBlocks: zeroCounts(), roots: zeroCounts(), dataBlocks: zeroCounts(), examples: [] };
  const skipped = new Set(walked.tolerated.filter((t) => t.kind === 'rootOutsideTagData').map((t) => t.tagIndex));
  const name = (i: number) => tagIndex.entries[i]?.path ?? `#${i}`;
  for (const s of walked.sites) {
    const offset = s.value - base;
    if (s.kind === 'reflexive') {
      if (buffer.readInt32LE(s.at - REFLEXIVE_COUNT_BEFORE_POINTER) <= 0) continue; // loaded_block_get: a count of 0 always passes
      count(report.blocks, offset);
      if (offset % ALIGNMENT !== 0 && report.examples.length < MAX_EXAMPLES) report.examples.push(`#${s.tagIndex} ${name(s.tagIndex)}: block at ${hex(s.value)}, ${offset % ALIGNMENT} mod 4`);
    } else if (s.kind === 'tagData') {
      if (!skipped.has(s.tagIndex)) count(report.roots, offset);
    } else if (s.kind === 'dataBlock') {
      if (buffer.readInt32LE(s.at - DATA_SIZE_BEFORE_POINTER) > 0) count(report.dataBlocks, offset);
    }
  }
  countBspBlocks(buffer, header, tagIndex, report.bspBlocks, report.examples);
  return report;
}

/**
 * The alignment check alone (the checklist row and the output re-check): mirrors `loaded_block_get`
 * for every block of the tag data and the BSPs. Throws `UnwalkableTagError` like the walker.
 */
export function measureBlockAlignment(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): BlockAlignmentReport {
  return measure(buffer, header, tagIndex, walk(buffer, header, tagIndex));
}

/** Decides whether and how the tag data is aligned. Reads only; never throws for a malformed map (problems refuse). */
export function planTagDataAlignment(buffer: Buffer, header: CacheFileHeader, tagIndex: TagIndex): TagDataAlignmentPlan {
  const empty: Record<TagDataPointerKind, number> = { tagPath: 0, tagData: 0, reflexive: 0, dataBlock: 0, referencePath: 0, bspReferencePath: 0 };
  const plan: TagDataAlignmentPlan = { report: { blocks: zeroCounts(), bspBlocks: zeroCounts(), roots: zeroCounts(), dataBlocks: zeroCounts(), examples: [] }, needed: false, insertAt: 0, bytes: 0, remainder: 0, pointersToMove: { ...empty }, tolerated: [], problems: [] };
  let walked: Walked;
  try {
    walked = walk(buffer, header, tagIndex);
  } catch (err) {
    if (err instanceof UnwalkableTagError) {
      plan.problems.push(`${err.message} OpenCE's block reads can't be checked or fixed without walking every tag.`);
      return plan;
    }
    throw err;
  }
  plan.tolerated = walked.tolerated;
  plan.report = measure(buffer, header, tagIndex, walked);
  const { blocks, roots, dataBlocks, bspBlocks } = plan.report;
  plan.needed = blocks.unaligned + roots.unaligned + dataBlocks.unaligned > 0;
  if (bspBlocks.unaligned > 0) plan.problems.push(`${bspBlocks.unaligned} block(s) inside the structure BSP(s) are not 4-aligned from the BSP address. Moving BSP data is not part of this repair.`);
  if (!plan.needed) return plan;

  const base = tagIndex.baseMemoryAddress >>> 0;
  const tds = header.tagDataSize;
  const tdo = header.tagDataOffset;
  // One remainder for every root, block and data block.
  const remainders = [0, 1, 2, 3].filter((r) => blocks.byRemainder[r] + roots.byRemainder[r] + dataBlocks.byRemainder[r] > 0);
  if (remainders.length !== 1) {
    plan.problems.push(`The tag data's roots and blocks start at different remainders mod 4 (${remainders.join(', ')}), so no single shift aligns them; a per-block re-layout is not supported.`);
    return plan;
  }
  plan.remainder = remainders[0];
  plan.bytes = (ALIGNMENT - plan.remainder) % ALIGNMENT;

  // The insertion point: the end of the tag path strings (after the tag array). Every path string
  // must lie before it and every other pointer target at or after it.
  const isPath = (k: TagDataPointerKind) => k === 'tagPath' || k === 'referencePath' || k === 'bspReferencePath';
  const inTagData = (v: number) => v >= base && v - base < tds;
  let pathEnd = TAG_DATA_HEADER_PC_SIZE + tagIndex.tagCount * 32;
  for (const s of walked.sites) {
    if (!isPath(s.kind) || !inTagData(s.value)) continue;
    let end = tdo + (s.value - base);
    while (end < tdo + tds && buffer[end] !== 0) end++;
    pathEnd = Math.max(pathEnd, end + 1 - tdo);
  }
  plan.insertAt = pathEnd;
  const early = walked.sites.filter((s) => !isPath(s.kind) && s.value !== 0 && inTagData(s.value) && s.value - base < pathEnd);
  if (early.length > 0) plan.problems.push(`${early.length} block(s) start before the end of the tag path strings (${hex(base + pathEnd)}), e.g. ${hex(early[0].value)} in #${early[0].tagIndex}; the strings and the tags are interleaved, so one insertion can't align them.`);

  // Layout rules: the tag data is the last block of the file and stays below the lowest BSP.
  const fileLength = buffer.readUInt32LE(TAG_DATA_FILE_SIZE_OFFSET);
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  let limit = base + CE_TAG_SPACE_SIZE;
  if (scenario && !scenario.isExternal && inTagData(scenario.tagDataPointerOrResourceIndex >>> 0)) {
    const lowest = bspAddresses(buffer, header, tagIndex, tdo + (scenario.tagDataPointerOrResourceIndex - base))[0];
    if (lowest !== undefined) limit = Math.min(limit, lowest);
  }
  if (tdo + tds !== fileLength) plan.problems.push(`The tag data (file offset ${tdo}, ${tds} bytes) is not the last block of the file (${fileLength} bytes), so it can't grow.`);
  else if (base + tds + plan.bytes > limit) plan.problems.push(`The aligned tag data would end at ${hex(base + tds + plan.bytes)}, past ${hex(limit)} (the lowest structure BSP address or the end of the tag space).`);

  for (const s of walked.sites) if (s.value >= base + pathEnd && s.value < base + tds) plan.pointersToMove[s.kind]++;
  return plan;
}

/**
 * Inserts the planned bytes into `map` (standard header: 0x8 file size, 0x10 tag data offset, 0x14
 * tag data size; read with the CE reader, so version 609) and moves every pointer past the insertion
 * point. The plan is made again on `map` (its file offsets can differ from the pre-flight copy's, e.g.
 * after external data was copied in) and must give the same insertion point and size. Returns a new
 * buffer; never mutates `map`.
 */
export function applyTagDataAlignment(map: Buffer, expected: Pick<TagDataAlignmentPlan, 'insertAt' | 'bytes'>): { buffer: Buffer; plan: TagDataAlignmentPlan; moved: number } {
  const header = parseCacheFileHeader(map);
  const tagIndex = parseTagIndex(map, header);
  const plan = planTagDataAlignment(map, header, tagIndex);
  if (plan.problems.length > 0) throw new TagDataAlignmentError(`The tag data can't be aligned: ${plan.problems.join(' ')} Nothing was written.`);
  if (!plan.needed || plan.insertAt !== expected.insertAt || plan.bytes !== expected.bytes) {
    throw new TagDataAlignmentError(`The tag data alignment differs from the pre-flight plan (${plan.bytes} bytes at ${plan.insertAt}, planned ${expected.bytes} at ${expected.insertAt}). Nothing was written.`);
  }
  const base = tagIndex.baseMemoryAddress >>> 0;
  const tdo = map.readUInt32LE(TAG_DATA_TAG_DATA_OFFSET);
  const tds = map.readUInt32LE(TAG_DATA_SIZE_OFFSET);
  if (map.readUInt32LE(TAG_DATA_FILE_SIZE_OFFSET) !== map.length || tdo + tds !== map.length) throw new TagDataAlignmentError('The tag data is not the last block of the file. Nothing was written.');
  const cut = tdo + plan.insertAt;
  const out = Buffer.alloc(map.length + plan.bytes); // the inserted bytes start as zero
  map.copy(out, 0, 0, cut);
  map.copy(out, cut + plan.bytes, cut);
  const sites = collectTagDataPointers(map, tagDataLayoutOf(header, tagIndex), { tolerate: { staleReferencePaths: true, rootsOutsideTagData: true }, tolerated: [] });
  const outOffset = (at: number) => (at < cut ? at : at + plan.bytes);
  const counts = applyPointerShift(sites, { from: (base + plan.insertAt) >>> 0, to: (base + tds) >>> 0, delta: plan.bytes }, (at, value) => out.writeUInt32LE(value, outOffset(at)));
  out.writeUInt32LE(out.length, TAG_DATA_FILE_SIZE_OFFSET);
  out.writeUInt32LE(tds + plan.bytes, TAG_DATA_SIZE_OFFSET);
  return { buffer: out, plan, moved: counts.totalRebased };
}
