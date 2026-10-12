import { CE_TAG_SPACE_SIZE, TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../../constants/cache-file';
import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { decodeStruct, getGroupStructName, resolveStruct } from '../definitions/engine';
import type { ExtentReport } from './extent-check';

/**
 * Opt-in repairs for the tag data problems OpenCE refuses (found by `extent-check.ts`). Both add a
 * block at the END of the tag data and point one existing pointer at it; nothing else in the map
 * changes, and the old bytes stay where they were (no longer pointed at). User decisions and
 * evidence: PRD "OpenCE findings and tag data repairs".
 *
 *   scriptSyntaxData: the scenario's script syntax data (a data array of script nodes) is moved to a
 *     new block of its full declared size: its 56-byte array header and its used nodes (count x 20
 *     bytes) are copied, the rest is zero. A zeroed node slot is a free slot: OpenCE's data array
 *     code (OpenCE 6399ed9, `source/memory/data.c`: `datum_new` l.314, `datum_try_and_get` l.135,
 *     `data_next_index` l.468, `data_iterator_next` l.438) treats a slot whose identifier (its first
 *     int16, `data.h` struct datum_header) is 0 as free, and `data_delete_all` (l.393) frees slots
 *     by writing 0 there. Tested in `tag-data-repairs.real-map.test.ts`. Required (OpenCE refuses
 *     the map without it) in two cases:
 *     - the block overlaps another block or lies outside the tag data (the validator refuses it),
 *       only when the used nodes fit in the bytes that are really the block's own;
 *     - the block is not 4-aligned, measured from the tag data start (base + offset), with or
 *       without used nodes: OpenCE's `hs_scenario_syntax_data_valid` (`source/hs/hs.c` l.12790)
 *       rejects it, and `hs_allocate` then logs "the scenario's script data is missing or damaged"
 *       with `error(0, ...)`, an `_error_immediate` that ends in `system_exit` and
 *       `halt_and_catch_fire` (the blue screen; user's bgali / bgmis experiment, OpenCE notes).
 *       OpenCE tests the absolute address, the same as measuring from the tag data start for the
 *       known base addresses, 0x40440000 and 0x4BF10000, both 4-aligned.
 *   tagRootOutside: a tag whose root struct lies (partly) outside the tag data gets a zeroed struct
 *     of its group's schema size. Only when no reference names that tag with its full tag ID, so
 *     nothing reads the zeroed values (required: OpenCE refuses the map).
 *   blockOverlap (PRD 2026-10-12, item C): a block list that overlaps another tag's bytes is moved,
 *     with its data blocks, to the end of the tag data: today's bytes are copied (what the other tag
 *     wrote over stays as it is: the original contents are lost), the data pointers are rewritten in
 *     the new copy only, and the field's block pointer points at it. Only for a block whose elements
 *     hold plain values and pointer-based data blocks (no block lists, tag references, runtime
 *     pointers or file-offset data), so nothing else points into it. Any other overlap is refused.
 *     Seen: HaloMD yoyorastv2_1 #2919 var_kill_penalty strings[2 x 20] overlaps #2920's root.
 *
 * Layout rules: the tag data must be the last block of the file and every new byte must stay below
 * the lowest structure BSP address (OpenCE `cache_file_formats.c`, `structure_bsps_verify`: a BSP
 * may not start below the loaded tags) - refused otherwise. Each new block starts 4-aligned,
 * measured from the tag data start (base address + offset), as the injector does; padding is zero.
 * Changed: header 0x8 (file size) and 0x14 (tag data size), the one pointer per repair, and the
 * appended bytes. The tag data header is unchanged (nothing in it depends on the tag data size).
 */

/** `alignTagData` is planned and applied by `align-tag-data.ts` (Phase 1c), before the others. */
export type TagDataRepairId = 'alignTagData' | 'scriptSyntaxData' | 'tagRootOutside' | 'blockOverlap';
/** Every repair id, for code that must accept exactly these (the main process's sanitizer). */
export const TAG_DATA_REPAIR_IDS: readonly TagDataRepairId[] = ['alignTagData', 'scriptSyntaxData', 'tagRootOutside', 'blockOverlap'];

export interface PlannedTagDataRepair {
  id: TagDataRepairId;
  /** True when OpenCE refuses the map without it. */
  required: boolean;
  tagIndex: number;
  tagPath: string;
  /** Memory address of the 32-bit pointer that will point at the new block, and its current value. */
  pointerAddress: number;
  oldPointer: number;
  /** Size of the new block (padding excluded). */
  blockSize: number;
  /** Bytes copied from the old block (the rest of the new block is zero). */
  copyBytes: number;
  /** Plain-language evidence for the dialog. */
  details: string[];
  /**
   * blockOverlap only: what goes into the new block, at `offset` from its start (copied from `from`, a
   * memory address, today's bytes), and where in the new block the pointer to each piece is written.
   */
  pieces?: RepairPiece[];
  /** blockOverlap only: the parts whose bytes other tags wrote over (their original contents are lost). */
  overwritten?: string[];
}

export interface RepairPiece {
  from: number;
  size: number;
  offset: number;
  /** Offset in the new block of the 32-bit pointer to this piece (null for the block itself). */
  pointerOffset: number | null;
}

export interface TagDataRepairPlan {
  /** Repairs that can be done, required and optional. */
  repairs: PlannedTagDataRepair[];
  /** Problems no repair covers, or repairs that can't be done here (each refuses the conversion). */
  unrepairable: string[];
  baseMemoryAddress: number;
  /** New tag data must end at or below this address (the lowest BSP address, or the tag space end). */
  limitAddress: number;
}

export interface AppliedTagDataRepair {
  id: TagDataRepairId;
  tagIndex: number;
  tagPath: string;
  oldPointer: number;
  newPointer: number;
  padding: number;
  blockSize: number;
  copied: number;
  /** padding + blockSize */
  bytesAppended: number;
}

export class TagDataRepairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagDataRepairError';
  }
}

/** OpenCE `memory/data.h` struct data_array: 0x20 maximum_count, 0x22 size (element bytes), 0x2E count (slots in use, the high-water mark); 0x38 bytes. */
export const DATA_ARRAY_HEADER_SIZE = 0x38;
export const DATA_ARRAY_MAXIMUM_COUNT = 0x20;
export const DATA_ARRAY_ELEMENT_SIZE = 0x22;
export const DATA_ARRAY_COUNT = 0x2e;
/** OpenCE `hs/hs.h` struct hs_syntax_node (asserted 0x14 in tag_schema_scenario.c). */
export const SCRIPT_NODE_SIZE = 0x14;
const TAG_DATA_FILE_SIZE_OFFSET = 0x8;
const TAG_DATA_SIZE_OFFSET = 0x14;
const TAG_DATA_TAG_DATA_OFFSET = 0x10;
/** TagDataOffset (20 bytes): size +0, external +4, file offset +8, pointer +0xC. */
const DATA_FIELD_POINTER = 0xc;
const ENTRY_DATA_POINTER = 0x14;
const ALIGNMENT = 4;

const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const padTo = (offset: number) => (ALIGNMENT - (offset % ALIGNMENT)) % ALIGNMENT;
const fmt = (n: number) => n.toLocaleString('en-US');

/** The scenario's structure BSP addresses, lowest first (empty when it has none). */
export function bspAddresses(view: Buffer, header: Pick<CacheFileHeader, 'tagDataOffset'>, tagIndex: TagIndex, scenarioAt: number): number[] {
  const scenarioStruct = getGroupStructName('scenario')!;
  const bsps = decodeStruct(view, scenarioAt, scenarioStruct).get('structure bsps');
  const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps');
  const elementStruct = field?.def.type === 'TagReflexive' ? field.def.struct : undefined;
  if (bsps?.kind !== 'reflexive' || !elementStruct) return [];
  const size = resolveStruct(elementStruct).totalSize;
  const out: number[] = [];
  for (let i = 0; i < bsps.value.count; i++) {
    const at = header.tagDataOffset + (bsps.value.pointerLow + i * size - tagIndex.baseMemoryAddress);
    const address = decodeStruct(view, at, elementStruct).get('bsp address');
    if (address?.kind === 'basic') out.push(Number(address.value) >>> 0);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Decides which repairs the map needs and whether they can be done. Reads only. `view` is a map read
 * through the CE reader (a retail-layout map's private copy with version 609 is fine).
 */
export function planTagDataRepairs(view: Buffer, header: Pick<CacheFileHeader, 'tagDataOffset' | 'tagDataSize'>, tagIndex: TagIndex, extents: ExtentReport): TagDataRepairPlan {
  const base = tagIndex.baseMemoryAddress >>> 0;
  const tdo = header.tagDataOffset;
  const tds = header.tagDataSize;
  const repairs: PlannedTagDataRepair[] = [];
  const unrepairable: string[] = [];
  const inTagData = (address: number, size: number) => address >= base && address - base + size <= tds;
  const fileOf = (address: number) => tdo + (address - base);
  const handled = new Set<number>();

  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario')!;
  const scenarioSize = resolveStruct(scenarioStruct).totalSize;
  const scenarioPointer = scenario ? scenario.tagDataPointerOrResourceIndex >>> 0 : 0;
  const scenarioReadable = !!scenario && !scenario.isExternal && scenario.primaryClassName === 'scenario' && inTagData(scenarioPointer, scenarioSize);
  let limitAddress = base + CE_TAG_SPACE_SIZE;

  if (scenarioReadable) {
    const scenarioAt = fileOf(scenarioPointer);
    const lowest = bspAddresses(view, header, tagIndex, scenarioAt)[0];
    if (lowest !== undefined) limitAddress = Math.min(limitAddress, lowest);

    // --- script syntax data ---
    const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'script syntax data')!;
    const syntax = decodeStruct(view, scenarioAt, scenarioStruct).get('script syntax data');
    const violationIndex = extents.violations.findIndex((v) => v.tagIndex === scenario!.index && v.fieldName === 'script syntax data' && !v.isRoot);
    if (syntax?.kind === 'tagDataOffset' && syntax.value.size > 0) {
      const address = syntax.value.pointerLow >>> 0;
      const size = syntax.value.size >>> 0;
      const aligned = (address - base) % ALIGNMENT === 0;
      const headerReadable = inTagData(address, DATA_ARRAY_HEADER_SIZE);
      const at = fileOf(address);
      const maximum = headerReadable ? view.readInt16LE(at + DATA_ARRAY_MAXIMUM_COUNT) : -1;
      const elementSize = headerReadable ? view.readInt16LE(at + DATA_ARRAY_ELEMENT_SIZE) : -1;
      const count = headerReadable ? view.readInt16LE(at + DATA_ARRAY_COUNT) : -1;
      const consistent = headerReadable && elementSize === SCRIPT_NODE_SIZE && maximum > 0 && count >= 0 && count <= maximum && size === DATA_ARRAY_HEADER_SIZE + maximum * elementSize;
      const used = consistent ? DATA_ARRAY_HEADER_SIZE + count * SCRIPT_NODE_SIZE : -1;
      const where = `${scenario!.path}.scenario script syntax data`;
      const plan = (required: boolean, details: string[]) =>
        repairs.push({
          id: 'scriptSyntaxData',
          required,
          tagIndex: scenario!.index,
          tagPath: scenario!.path,
          pointerAddress: scenarioPointer + field.offset + DATA_FIELD_POINTER,
          oldPointer: address,
          blockSize: size,
          copyBytes: used,
          details,
        });
      if (violationIndex >= 0) {
        handled.add(violationIndex);
        const violation = extents.violations[violationIndex];
        const free = extents.freeTagDataBytesAt(address, size);
        if (!consistent) {
          unrepairable.push(`${violation.text}. Its script node table header can't be read as a script node array (${maximum} slots of ${elementSize} bytes, ${count} in use, ${fmt(size)} bytes declared), so it is not known which bytes are its own.`);
        } else if (used > free) {
          unrepairable.push(`${violation.text}. Its header and ${count} used script node(s) take ${fmt(used)} bytes, but only ${fmt(free)} bytes from its start belong to it alone, so its scripts can't be recovered.`);
        } else {
          plan(true, [
            violation.text,
            `Only the first ${fmt(free)} of its ${fmt(size)} bytes are its own; the rest belongs to other tags. ${count} of ${maximum} node slots are used (${fmt(used)} bytes with the header), so everything in use fits.`,
            `New block: ${fmt(size)} bytes at the end of the tag data (4-aligned): the header and used nodes copied, the rest zero (a zeroed slot is a free slot).`,
          ]);
        }
      } else if (!aligned && consistent) {
        plan(true, [
          `${where} starts at ${hex(address)}, which is not 4-aligned from the tag data start. OpenCE stops loading at "the scenario's script data is missing or damaged; its scripts won't run" (a blue screen).`,
          `${count} of ${maximum} node slots are used. New block: ${fmt(size)} bytes at the end of the tag data (4-aligned): the header and used nodes (${fmt(used)} bytes) copied, the rest zero (a zeroed slot is a free slot).`,
        ]);
      } else if (!aligned) {
        unrepairable.push(
          `${where} starts at ${hex(address)}, which is not 4-aligned, so OpenCE stops loading at "the scenario's script data is missing or damaged". Its header can't be read as a script node array (${maximum} slots of ${elementSize} bytes, ${count} in use, ${fmt(size)} bytes declared), so it is not moved.`,
        );
      }
    }
  }

  // --- tag roots outside the tag data ---
  extents.violations.forEach((v, i) => {
    if (handled.has(i) || !v.isRoot || v.region !== 'tagData' || v.kind !== 'outside' || v.tagIndex < 0) return;
    handled.add(i);
    const entry = tagIndex.entries[v.tagIndex];
    const references = extents.referenceCounts.get(entry.tagId >>> 0) ?? 0;
    if (references > 0) {
      unrepairable.push(`${v.text}. ${references} reference(s) name this tag, so a zeroed replacement would be used by the game; it is not repaired.`);
      return;
    }
    repairs.push({
      id: 'tagRootOutside',
      required: true,
      tagIndex: v.tagIndex,
      tagPath: entry.path,
      pointerAddress: base + TAG_DATA_HEADER_PC_SIZE + v.tagIndex * TAG_ENTRY_SIZE + ENTRY_DATA_POINTER,
      oldPointer: v.address,
      blockSize: v.size,
      copyBytes: 0,
      details: [
        v.text,
        `No reference names this tag with its full tag ID, so nothing reads its values.`,
        `New block: a zeroed ${entry.primaryClassName} struct (${fmt(v.size)} bytes, its schema size) at the end of the tag data (4-aligned).`,
      ],
    });
  });

  // --- a block that overlaps another tag and holds no pointers but its own data blocks ---
  extents.violations.forEach((v, i) => {
    if (handled.has(i) || v.kind !== 'overlap' || v.region !== 'tagData' || v.isRoot || !v.blockStruct || v.pointerAddress === null) return;
    const element = resolveStruct(v.blockStruct);
    const offending = element.fields.filter(
      (f) => f.def.type === 'TagReflexive' || f.def.type === 'TagDependency' || f.def.type === 'Pointer' || (f.def.type === 'TagDataOffset' && (f.def.externalFileOffset || f.def.nonCached)),
    );
    if (offending.length > 0 || v.size % element.totalSize !== 0) return; // refused below: not this narrow case
    handled.add(i);
    const count = v.size / element.totalSize;
    const dataFields = element.fields.filter((f) => f.def.type === 'TagDataOffset');
    const pieces: RepairPiece[] = [{ from: v.address, size: v.size, offset: 0, pointerOffset: null }];
    const overwritten: string[] = [`${v.field}: ${fmt(v.size)} bytes at ${hex(v.address)} share bytes with ${v.overlaps}`];
    let end = v.size;
    let problem: string | null = null;
    for (let k = 0; k < count && !problem; k++) {
      for (const f of dataFields) {
        const fieldAt = fileOf(v.address + k * element.totalSize + f.offset);
        const size = view.readUInt32LE(fieldAt);
        const pointer = view.readUInt32LE(fieldAt + DATA_FIELD_POINTER);
        if (size === 0) continue;
        if (!inTagData(pointer, size)) {
          problem = `${v.text}. Its element ${k} "${f.name}" (${fmt(size)} bytes at ${hex(pointer)}) is outside the tag data, so the block is not moved.`;
          break;
        }
        end += padTo(end);
        pieces.push({ from: pointer, size, offset: end, pointerOffset: k * element.totalSize + f.offset + DATA_FIELD_POINTER });
        if (extents.freeTagDataBytesAt(pointer, size) < size) overwritten.push(`${v.fieldName}[${k}].${f.name}: ${fmt(size)} bytes at ${hex(pointer)} share bytes with another tag`);
        end += size;
      }
    }
    if (problem) {
      unrepairable.push(problem);
      return;
    }
    repairs.push({
      id: 'blockOverlap',
      required: true,
      tagIndex: v.tagIndex,
      tagPath: v.tagPath,
      pointerAddress: v.pointerAddress,
      oldPointer: v.address,
      blockSize: end,
      copyBytes: 0,
      pieces,
      overwritten,
      details: [
        v.text,
        `Its ${count} element(s) hold only values and data blocks (no block lists or tag references), so nothing else points into it and it can be moved whole.`,
        `New block: ${fmt(end)} bytes at the end of the tag data (4-aligned): the block and its ${pieces.length - 1} data block(s), today's bytes copied; its data pointers are rewritten in the new copy only.`,
      ],
    });
  });

  extents.violations.forEach((v, i) => {
    if (!handled.has(i)) unrepairable.push(`${v.text}. No repair covers this problem.`);
  });

  // --- layout rules (refuse every repair when they fail) ---
  if (repairs.length > 0) {
    const fileLength = view.readUInt32LE(TAG_DATA_FILE_SIZE_OFFSET);
    let end = tds;
    for (const r of repairs) end += padTo(end) + r.blockSize;
    const problem =
      tdo + tds !== fileLength
        ? `The tag data (file offset ${fmt(tdo)}, ${fmt(tds)} bytes) is not the last block of the file (${fmt(fileLength)} bytes), so nothing can be added after it.`
        : base + end > limitAddress
          ? `The repaired tag data would end at ${hex(base + end)}, past ${hex(limitAddress)} (the lowest structure BSP address, or the end of the tag space), where the game loads the BSP.`
          : null;
    if (problem) {
      for (const r of repairs) if (r.required) unrepairable.push(`${r.details[0]}. ${problem}`);
      repairs.length = 0;
    }
  }
  return { repairs, unrepairable, baseMemoryAddress: base, limitAddress };
}

/**
 * Applies `repairs` (in order) to a map whose header has the standard layout (0x8 file size, 0x10
 * tag data offset, 0x14 tag data size). Returns a new buffer; never mutates `map`. Refuses
 * (TagDataRepairError) when the tag data is not last in the file, a pointer no longer holds the
 * planned value, or the new end passes `plan.limitAddress`.
 */
export function applyTagDataRepairs(map: Buffer, plan: Pick<TagDataRepairPlan, 'baseMemoryAddress' | 'limitAddress'>, repairs: readonly PlannedTagDataRepair[]): { buffer: Buffer; applied: AppliedTagDataRepair[] } {
  if (repairs.length === 0) return { buffer: Buffer.from(map), applied: [] };
  const base = plan.baseMemoryAddress >>> 0;
  const tdo = map.readUInt32LE(TAG_DATA_TAG_DATA_OFFSET);
  const tds = map.readUInt32LE(TAG_DATA_SIZE_OFFSET);
  if (map.readUInt32LE(TAG_DATA_FILE_SIZE_OFFSET) !== map.length || tdo + tds !== map.length) {
    throw new TagDataRepairError('The tag data is not the last block of the file, so the repairs were not applied. Nothing was written.');
  }
  const blocks: { at: number; repair: PlannedTagDataRepair; padding: number }[] = [];
  let end = tds;
  for (const r of repairs) {
    const padding = padTo(end);
    blocks.push({ at: end + padding, repair: r, padding });
    end += padding + r.blockSize;
  }
  if (base + end > plan.limitAddress) throw new TagDataRepairError(`The repaired tag data would end at ${hex(base + end)}, past ${hex(plan.limitAddress)}, where the game loads the structure BSP. Nothing was written.`);

  const out = Buffer.alloc(tdo + end); // new bytes (padding and zero fill) start as zero
  map.copy(out, 0, 0, map.length);
  const applied: AppliedTagDataRepair[] = [];
  for (const { at, repair: r, padding } of blocks) {
    const pointerAt = tdo + (r.pointerAddress - base);
    const current = out.readUInt32LE(pointerAt);
    if (current !== r.oldPointer >>> 0) throw new TagDataRepairError(`${r.tagPath}: the pointer at ${hex(r.pointerAddress)} is ${hex(current)}, not ${hex(r.oldPointer)} as planned. Nothing was written.`);
    if (r.copyBytes > 0) map.copy(out, tdo + at, tdo + (r.oldPointer - base), tdo + (r.oldPointer - base) + r.copyBytes);
    for (const piece of r.pieces ?? []) {
      const from = tdo + (piece.from - base);
      map.copy(out, tdo + at + piece.offset, from, from + piece.size);
    }
    for (const piece of r.pieces ?? []) {
      if (piece.pointerOffset === null) continue;
      const pointerInCopy = tdo + at + piece.pointerOffset;
      if (out.readUInt32LE(pointerInCopy) !== piece.from >>> 0) throw new TagDataRepairError(`${r.tagPath}: a data pointer in the moved block is not ${hex(piece.from)} as planned. Nothing was written.`);
      out.writeUInt32LE((base + at + piece.offset) >>> 0, pointerInCopy);
    }
    const newPointer = (base + at) >>> 0;
    out.writeUInt32LE(newPointer, pointerAt);
    applied.push({ id: r.id, tagIndex: r.tagIndex, tagPath: r.tagPath, oldPointer: r.oldPointer >>> 0, newPointer, padding, blockSize: r.blockSize, copied: r.copyBytes, bytesAppended: padding + r.blockSize });
  }
  out.writeUInt32LE(out.length, TAG_DATA_FILE_SIZE_OFFSET);
  out.writeUInt32LE(end, TAG_DATA_SIZE_OFFSET);
  return { buffer: out, applied };
}

/** Bytes the repairs add to a tag data block of `tagDataSize` bytes (padding included). */
export function repairBytesAdded(tagDataSize: number, repairs: readonly Pick<PlannedTagDataRepair, 'blockSize'>[]): number {
  let end = tagDataSize;
  for (const r of repairs) end += padTo(end) + r.blockSize;
  return end - tagDataSize;
}
