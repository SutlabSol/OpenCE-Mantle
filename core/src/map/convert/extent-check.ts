import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../../constants/cache-file';
import type { CacheFileHeader } from '../header';
import type { TagIndex } from '../tag-index';
import { decodeStruct, getAllTagGroupNames, getGroupStructName, resolveStruct } from '../definitions/engine';

/**
 * The tag data block check OpenCE runs on every map it loads, mirrored so the converter can find
 * (and the repairs can fix) what OpenCE refuses. Format reference only, no code copied: OpenCE
 * (CC0, github.com/OpenCommunityEdition/OpenCE) `port/linux/game/tag_validate.c`:
 *   - `validate_tag_table`: the tag data header (0x28 bytes) and the tag instances are claimed, then
 *     every tag's root struct, in index order ("has its data at %08lx, outside the tags or
 *     overlapping another's"); structure BSP roots are skipped (they load with their BSP);
 *   - `validate_element` / `validate_block_extent` / `validate_data_extent`: each tag is walked from
 *     its root; for each element, first every block list (count x element size) and every data
 *     field (size bytes) of that element must lie inside the tag data and touch no byte claimed
 *     before ("has %ld bytes at %08lx, outside the tags or overlapping another's"), then each
 *     block's elements are walked the same way. File data (bitmap pixels, sound samples) is checked
 *     against the files instead, so it is skipped here;
 *   - `tag_validate_structure_bsp`: each BSP is checked the same way inside its own region (its
 *     24-byte header, then its root struct and blocks).
 * OpenCE stops at the first refusal; this check reports every problem, and does not walk into a
 * block that failed (as OpenCE never would). Tag names are not claimed, as in OpenCE.
 *
 * Simplifications, stated: whole-tag external entries (CE resource-map tags) are skipped (the
 * converter refuses maps that have them); fields marked `nonCached` are skipped (as everywhere in
 * this repo). Measured with this check: 0 problems on all 5 CE sample maps (bloodgulch, sidewinder,
 * coldsnap, ui, Yoyorast_Island) and on HaloMD heh_2; HaloMD theisland_3 and barrier: the scenario's
 * script syntax data overlaps (OpenCE reports the same addresses, 0x404864FE and 0x4047662A);
 * crossing: tag #2404's root lies past the tag data (OpenCE: 0x409DC695). PRD "OpenCE findings".
 * This shares the schema engine with the rest of the converter, so it is "same-reader".
 */

export type ExtentViolationKind = 'outside' | 'overlap';

export interface ExtentViolation {
  kind: ExtentViolationKind;
  region: 'tagData' | 'bsp';
  tagIndex: number;
  tagPath: string;
  group: string | null;
  /** True for the tag's own (root) struct; false for a block list or data field. */
  isRoot: boolean;
  /** Where in the tag: "root", or a field path such as `regions[2].permutations`. */
  field: string;
  /** The field's own name (null for a root), e.g. "script syntax data". */
  fieldName: string | null;
  /** Memory address and byte count of the block. */
  address: number;
  /** Memory address of the 32-bit pointer that points at this block (in the tag data), when it is a field's. */
  pointerAddress: number | null;
  /** The element struct of a block list (null for a data field or a root). */
  blockStruct: string | null;
  size: number;
  /** What the first already-claimed byte belongs to (overlaps only). */
  overlaps: string | null;
  /** One line for the dialog and the logs. */
  text: string;
}

export interface ExtentReport {
  violations: ExtentViolation[];
  /** Roots, block lists and data fields checked (tag data and BSPs). */
  blocksChecked: number;
  tagsChecked: number;
  bspsChecked: number;
  /** Tags whose group has no definition in this build (not checked). */
  tagsWithoutDefinition: string[];
  /** Number of tag references (in tag data and BSPs) per full tag ID, null references excluded. */
  referenceCounts: Map<number, number>;
  /**
   * Bytes free from `address` (inside the tag data) up to the first byte any checked block claims,
   * or the tag data end, at most `limit`. Blocks that failed the check are not claimed.
   */
  freeTagDataBytesAt(address: number, limit: number): number;
}

const hex = (n: number) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const BSP_HEADER_SIZE = 0x18;
const NULL_TAG_ID = 0xffffffff;

/** One region's claimed bytes and the intervals that claimed them (for "overlaps what?" and free-space questions). */
class Claims {
  private readonly bytes: Uint8Array;
  private readonly starts: number[] = [];
  private readonly ends: number[] = [];
  private readonly labels: string[] = [];
  constructor(readonly base: number, readonly size: number) {
    this.bytes = new Uint8Array(size);
  }
  contains(address: number, size: number): boolean {
    const offset = address - this.base;
    return offset >= 0 && offset <= this.size && size >= 0 && size <= this.size - offset;
  }
  /** Claims [address, address + size); returns the label of the first byte already claimed, or null. */
  claim(address: number, size: number, label: string): string | null {
    const offset = address - this.base;
    for (let i = offset; i < offset + size; i++) {
      if (this.bytes[i]) return this.ownerOf(i);
    }
    this.bytes.fill(1, offset, offset + size);
    this.starts.push(offset);
    this.ends.push(offset + size);
    this.labels.push(label);
    return null;
  }
  private ownerOf(offset: number): string {
    for (let k = 0; k < this.starts.length; k++) if (offset >= this.starts[k] && offset < this.ends[k]) return this.labels[k];
    return '(unknown)';
  }
  freeBytesAt(address: number, limit: number): number {
    const offset = address - this.base;
    if (offset < 0 || offset >= this.size) return 0;
    let end = Math.min(this.size, offset + limit);
    for (let k = 0; k < this.starts.length; k++) {
      if (this.starts[k] <= offset && this.ends[k] > offset) return 0;
      if (this.starts[k] > offset && this.starts[k] < end) end = this.starts[k];
    }
    return end - offset;
  }
}

export function checkTagDataExtents(buffer: Buffer, header: Pick<CacheFileHeader, 'tagDataOffset' | 'tagDataSize'>, tagIndex: TagIndex): ExtentReport {
  const base = tagIndex.baseMemoryAddress >>> 0;
  const tagDataOffset = header.tagDataOffset;
  const tagDataSize = Math.max(0, Math.min(header.tagDataSize, buffer.length - tagDataOffset));
  const tagData = new Claims(base, tagDataSize);
  const known = new Set(getAllTagGroupNames());
  const violations: ExtentViolation[] = [];
  const referenceCounts = new Map<number, number>();
  const tagsWithoutDefinition: string[] = [];
  let blocksChecked = 0;
  let tagsChecked = 0;
  let bspsChecked = 0;

  const entryName = (i: number) => {
    if (i < 0) return 'the map';
    const e = tagIndex.entries[i];
    return e ? `#${i} ${e.path}.${e.primaryClassName ?? '?'}` : `#${i}`;
  };

  interface Region {
    claims: Claims;
    kind: 'tagData' | 'bsp';
    /** File offset of the region's first byte. */
    fileStart: number;
  }

  /** Checks and claims one block; records a violation and returns false when it fails. */
  const checkBlock = (r: Region, tagI: number, field: string, fieldName: string | null, isRoot: boolean, address: number, size: number, pointerAddress: number | null = null, blockStruct: string | null = null): boolean => {
    blocksChecked++;
    const e = tagIndex.entries[tagI];
    const label = `${entryName(tagI)} ${field}`;
    const fail = (kind: ExtentViolationKind, overlaps: string | null) => {
      const where = r.kind === 'bsp' ? 'the structure BSP' : 'the tag data';
      violations.push({
        kind,
        region: r.kind,
        tagIndex: tagI,
        tagPath: e?.path ?? '',
        group: e?.primaryClassName ?? null,
        isRoot,
        field,
        fieldName,
        address: address >>> 0,
        size,
        pointerAddress: r.kind === 'tagData' && pointerAddress !== null ? pointerAddress >>> 0 : null,
        blockStruct,
        overlaps,
        text:
          kind === 'outside'
            ? `${entryName(tagI)} ${field}: ${size} bytes at ${hex(address)}, outside ${where} (${hex(r.claims.base)} to ${hex(r.claims.base + r.claims.size)})`
            : `${entryName(tagI)} ${field}: ${size} bytes at ${hex(address)} overlap ${overlaps}`,
      });
      return false;
    };
    if (!r.claims.contains(address >>> 0, size)) return fail('outside', null);
    const owner = r.claims.claim(address >>> 0, size, label);
    return owner === null ? true : fail('overlap', owner);
  };

  const fileOf = (r: Region, address: number) => r.fileStart + ((address >>> 0) - r.claims.base);

  /** OpenCE's element walk: every extent of this element first, then each block's elements. */
  const walkElement = (r: Region, tagI: number, structName: string, address: number, where: string): void => {
    const at = fileOf(r, address);
    const struct = resolveStruct(structName);
    const decoded = decodeStruct(buffer, at, structName);
    const children: { struct: string; pointer: number; count: number; size: number; where: string }[] = [];
    for (const field of struct.fields) {
      const value = decoded.get(field.name);
      if (!value || field.def.nonCached) continue;
      const path = where ? `${where}.${field.name}` : field.name;
      if (value.kind === 'dependency') {
        const id = value.value.tagId >>> 0;
        if (id !== NULL_TAG_ID) referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + 1);
      } else if (value.kind === 'reflexive' && field.def.type === 'TagReflexive' && value.value.count !== 0 && field.def.struct) {
        const size = resolveStruct(field.def.struct).totalSize;
        const count = value.value.count >>> 0;
        if (checkBlock(r, tagI, `${path}[${count} x ${size}]`, field.name, false, value.value.pointerLow, count * size, address + field.offset + 4, field.def.struct)) {
          children.push({ struct: field.def.struct, pointer: value.value.pointerLow >>> 0, count, size, where: path });
        }
      } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset && value.value.size !== 0) {
        checkBlock(r, tagI, path, field.name, false, value.value.pointerLow, value.value.size >>> 0, address + field.offset + 12);
      }
    }
    for (const c of children) {
      for (let i = 0; i < c.count; i++) walkElement(r, tagI, c.struct, c.pointer + i * c.size, `${c.where}[${i}]`);
    }
  };

  const tagRegion: Region = { claims: tagData, kind: 'tagData', fileStart: tagDataOffset };
  checkBlock(tagRegion, -1, 'tag data header', null, false, base, TAG_DATA_HEADER_PC_SIZE);
  checkBlock(tagRegion, -1, 'tag instances', null, false, base + TAG_DATA_HEADER_PC_SIZE, tagIndex.entries.length * TAG_ENTRY_SIZE);

  // The tag table: every root, in index order.
  const roots: { index: number; struct: string; address: number }[] = [];
  for (const e of tagIndex.entries) {
    if (e.isExternal || e.primaryClassName === 'scenario_structure_bsp') continue;
    const structName = e.primaryClassName && known.has(e.primaryClassName) ? getGroupStructName(e.primaryClassName) : null;
    if (!structName) {
      tagsWithoutDefinition.push(entryName(e.index));
      continue;
    }
    tagsChecked++;
    const address = e.tagDataPointerOrResourceIndex >>> 0;
    if (checkBlock(tagRegion, e.index, 'root', null, true, address, resolveStruct(structName).totalSize)) roots.push({ index: e.index, struct: structName, address });
  }
  for (const root of roots) walkElement(tagRegion, root.index, root.struct, root.address, '');

  // Each structure BSP in its own region.
  const scenario = tagIndex.entries[tagIndex.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario');
  const bspStruct = getGroupStructName('scenario_structure_bsp');
  if (scenario && scenarioStruct && bspStruct && roots.some((r) => r.index === scenario.index)) {
    const scenarioAt = fileOf(tagRegion, scenario.tagDataPointerOrResourceIndex);
    const bsps = decodeStruct(buffer, scenarioAt, scenarioStruct).get('structure bsps');
    const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps');
    const elementStruct = field?.def.type === 'TagReflexive' ? field.def.struct : undefined;
    if (bsps?.kind === 'reflexive' && elementStruct && violations.every((v) => !(v.tagIndex === scenario.index && v.fieldName === 'structure bsps'))) {
      const elementSize = resolveStruct(elementStruct).totalSize;
      for (let b = 0; b < bsps.value.count; b++) {
        const element = decodeStruct(buffer, fileOf(tagRegion, bsps.value.pointerLow + b * elementSize), elementStruct);
        const num = (n: string) => {
          const v = element.get(n);
          return v?.kind === 'basic' ? Number(v.value) >>> 0 : 0;
        };
        const ref = element.get('structure bsp');
        const bspTag = ref?.kind === 'dependency' ? ref.value.tagId & 0xffff : scenario.index;
        const start = num('bsp start');
        const size = num('bsp size');
        const address = num('bsp address');
        if (start + size > buffer.length || size < BSP_HEADER_SIZE) {
          violations.push({ kind: 'outside', region: 'bsp', tagIndex: bspTag, tagPath: tagIndex.entries[bspTag]?.path ?? '', group: 'scenario_structure_bsp', isRoot: true, field: 'structure bsp', fieldName: null, address, size, pointerAddress: null, blockStruct: null, overlaps: null, text: `${entryName(bspTag)}: the structure BSP (${size} bytes at file offset ${start}) is not inside the file` });
          continue;
        }
        bspsChecked++;
        const bspRegion: Region = { claims: new Claims(address, size), kind: 'bsp', fileStart: start };
        checkBlock(bspRegion, bspTag, 'structure bsp header', null, false, address, BSP_HEADER_SIZE);
        const rootAddress = buffer.readUInt32LE(start);
        if (checkBlock(bspRegion, bspTag, 'root', null, true, rootAddress, resolveStruct(bspStruct).totalSize)) walkElement(bspRegion, bspTag, bspStruct, rootAddress, '');
      }
    }
  }

  return {
    violations,
    blocksChecked,
    tagsChecked,
    bspsChecked,
    tagsWithoutDefinition,
    referenceCounts,
    freeTagDataBytesAt: (address, limit) => tagData.freeBytesAt(address >>> 0, limit),
  };
}
