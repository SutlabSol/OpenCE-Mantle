import { parseCacheFileHeader } from '../../src/map/header';
import type { CacheFileHeader } from '../../src/map/header';
import { parseTagIndex, resolveTagDataPointer } from '../../src/map/tag-index';
import type { TagIndex } from '../../src/map/tag-index';
import { resolveStruct, decodeStruct, resolvePointer, getGroupStructName } from '../../src/map/definitions/engine';
import type { DecodedFieldValue } from '../../src/map/definitions/engine';
import { TAG_DATA_HEADER_PC_SIZE, TAG_ENTRY_SIZE } from '../../src/constants/cache-file';

/**
 * Independent audit of tag data in a real map, for injection tests. Uses only the schema engine
 * and the header/tag-index parser (shared with the injector) - none of the extractor's or
 * injector's own walking code. Which TagDataOffset fields are pointer-based is decided here from
 * the schema directly (internal, non-nonCached, not an external-file-offset field, size > 0), not
 * via the extractor's helper.
 */

const NULL_TAG_ID = 0xffffffff;

export interface AuditMap {
  buf: Buffer;
  header: CacheFileHeader;
  ti: TagIndex;
}

export function auditMap(buf: Buffer): AuditMap {
  const header = parseCacheFileHeader(buf);
  return { buf, header, ti: parseTagIndex(buf, header) };
}

export type BlockKind = 'tag' | 'reflexive' | 'data';

/** One block of tag data reached through a pointer: the tag's root struct, a reflexive array, or a TagDataOffset blob. */
export interface Block {
  kind: BlockKind;
  /** The pointer as stored (virtual address). */
  pointer: number;
  /** Offset from the start of tag data (pointer - base address); alignment is measured on this. */
  tagDataRelative: number;
  /** Absolute file offset. */
  file: number;
  length: number;
  where: string;
}

function isPointerData(f: { def: { type: string; nonCached?: boolean; externalFileOffset?: boolean } }, v: DecodedFieldValue): boolean {
  return v.kind === 'tagDataOffset' && f.def.type === 'TagDataOffset' && !f.def.nonCached && !f.def.externalFileOffset && v.value.size > 0;
}

/** Every block reachable from one internal tag. Blocks that resolve out of range are reported, not walked into. */
export function tagBlocks(m: AuditMap, index: number): Block[] {
  const e = m.ti.entries[index];
  const rootStruct = getGroupStructName(e.primaryClassName!)!;
  const blocks: Block[] = [];
  const add = (kind: BlockKind, pointer: number, length: number, where: string): Block => {
    const b: Block = { kind, pointer: pointer >>> 0, tagDataRelative: ((pointer >>> 0) - m.ti.baseMemoryAddress) | 0, file: resolvePointer(pointer >>> 0, m.header.tagDataOffset, m.ti.baseMemoryAddress), length, where };
    blocks.push(b);
    return b;
  };
  const inTagData = (b: Block) => b.file >= m.header.tagDataOffset && b.file + b.length <= m.header.tagDataOffset + m.header.tagDataSize;
  const walk = (structName: string, off: number, fp: string) => {
    const d = decodeStruct(m.buf, off, structName);
    for (const f of resolveStruct(structName).fields) {
      const v = d.get(f.name);
      if (!v || f.def.nonCached) continue;
      const p = `${fp}.${f.name}`;
      if (v.kind === 'reflexive' && v.value.count > 0 && f.def.type === 'TagReflexive') {
        const size = resolveStruct(f.def.struct).totalSize;
        const b = add('reflexive', v.value.pointerLow, v.value.count * size, p);
        if (!inTagData(b)) continue;
        for (let i = 0; i < v.value.count; i++) walk(f.def.struct, b.file + i * size, `${p}[${i}]`);
      } else if (isPointerData(f, v) && v.kind === 'tagDataOffset') {
        add('data', v.value.pointerLow, v.value.size, p);
      }
    }
  };
  const root = add('tag', e.tagDataPointerOrResourceIndex, resolveStruct(rootStruct).totalSize, e.path);
  if (inTagData(root)) walk(rootStruct, root.file, e.path);
  return blocks;
}

export function blocksOutsideTagData(m: AuditMap, blocks: Block[]): Block[] {
  return blocks.filter((b) => b.file < m.header.tagDataOffset || b.file + b.length > m.header.tagDataOffset + m.header.tagDataSize);
}

/** Path pointer stored in the tag array entry for `tagId` (array position = low 16 bits). */
export function entryPathPointer(m: AuditMap, tagId: number): number {
  return m.buf.readUInt32LE(m.header.tagDataOffset + TAG_DATA_HEADER_PC_SIZE + (tagId & 0xffff) * TAG_ENTRY_SIZE + 0x10);
}

function targetKey(ti: TagIndex, tagId: number): string {
  if ((tagId >>> 0) === NULL_TAG_ID) return 'null';
  const e = ti.entries[tagId & 0xffff];
  return e && e.tagId === tagId >>> 0 ? `${e.primaryClassName}|${e.path.toLowerCase()}` : `invalid tagId 0x${(tagId >>> 0).toString(16)}`;
}

/**
 * Compares one tag in the output with its source as a tree, field by field. Allowed differences:
 * pointer values (reflexive / data-block pointers - their targets are compared instead), and a
 * dependency's tagId/path pointer when it names the same class+path in the output map and the path
 * pointer is that output tag's own tag-array path pointer. Everything else (values, flags, pad
 * bytes, nonCached fields, counts, sizes, the bytes behind every data pointer) must be identical.
 */
export function treeDiff(src: AuditMap, srcIndex: number, out: AuditMap, outIndex: number): string[] {
  const diffs: string[] = [];
  const se = src.ti.entries[srcIndex];
  const oe = out.ti.entries[outIndex];
  const structName = getGroupStructName(se.primaryClassName!)!;
  const resolveIn = (m: AuditMap, ptr: number) => resolvePointer(ptr >>> 0, m.header.tagDataOffset, m.ti.baseMemoryAddress);
  const inRange = (m: AuditMap, at: number, len: number) => at >= m.header.tagDataOffset && at + len <= m.header.tagDataOffset + m.header.tagDataSize;

  const cmp = (st: string, so: number, oo: number, fp: string) => {
    const R = resolveStruct(st);
    const a = decodeStruct(src.buf, so, st);
    const b = decodeStruct(out.buf, oo, st);
    const pointerBytes = new Uint8Array(R.totalSize);
    for (const f of R.fields) {
      const av = a.get(f.name);
      const bv = b.get(f.name);
      if (!av || !bv || f.def.nonCached) continue;
      const p = `${fp}.${f.name}`;
      if (av.kind === 'dependency' && bv.kind === 'dependency') {
        pointerBytes.fill(1, f.offset + 4, f.offset + 16); // path pointer, path size, tagId
        const want = targetKey(src.ti, av.value.tagId);
        const got = targetKey(out.ti, bv.value.tagId);
        if (want !== got) diffs.push(`${p}: target ${want} -> ${got}`);
        if (av.value.pathSize !== bv.value.pathSize) diffs.push(`${p}: path size ${av.value.pathSize} -> ${bv.value.pathSize}`);
        const wantPtr = want === 'null' ? av.value.pathPointer : entryPathPointer(out, bv.value.tagId);
        if ((bv.value.pathPointer >>> 0) !== (wantPtr >>> 0)) diffs.push(`${p}: path pointer 0x${(bv.value.pathPointer >>> 0).toString(16)}, expected 0x${(wantPtr >>> 0).toString(16)}`);
      } else if (av.kind === 'reflexive' && bv.kind === 'reflexive' && f.def.type === 'TagReflexive') {
        if (av.value.count === 0) continue; // compared raw below
        pointerBytes.fill(1, f.offset + 4, f.offset + 12);
        if (av.value.count !== bv.value.count) { diffs.push(`${p}: count ${av.value.count} -> ${bv.value.count}`); continue; }
        const size = resolveStruct(f.def.struct).totalSize;
        const sb = resolveIn(src, av.value.pointerLow);
        const ob = resolveIn(out, bv.value.pointerLow);
        if (bv.value.pointerHigh !== 0) diffs.push(`${p}: pointer high word ${bv.value.pointerHigh}`);
        if (!inRange(out, ob, size * bv.value.count)) { diffs.push(`${p}: reflexive outside tag data`); continue; }
        for (let i = 0; i < av.value.count; i++) cmp(f.def.struct, sb + i * size, ob + i * size, `${p}[${i}]`);
      } else if (isPointerData(f, av) && av.kind === 'tagDataOffset' && bv.kind === 'tagDataOffset') {
        pointerBytes.fill(1, f.offset + 12, f.offset + 20);
        const sb = resolveIn(src, av.value.pointerLow);
        const ob = resolveIn(out, bv.value.pointerLow);
        if (bv.value.pointerHigh !== 0) diffs.push(`${p}: data pointer high word ${bv.value.pointerHigh}`);
        if (av.value.size !== bv.value.size) diffs.push(`${p}: data size ${av.value.size} -> ${bv.value.size}`);
        else if (!inRange(out, ob, bv.value.size)) diffs.push(`${p}: data pointer outside tag data`);
        else if (!src.buf.subarray(sb, sb + av.value.size).equals(out.buf.subarray(ob, ob + bv.value.size))) diffs.push(`${p}: data bytes differ`);
      } else if (st === 'GBXModelGeometryPart' && (f.name === 'vertex offset' || f.name === 'triangle offset' || f.name === 'triangle offset 2')) {
        pointerBytes.fill(1, f.offset, f.offset + f.size);
        if (f.name === 'vertex offset') {
          const svOff = src.buf.readUInt32LE(so + f.offset);
          const ovOff = out.buf.readUInt32LE(oo + f.offset);
          const vCount = (a.get('vertex count') as { value: number })?.value ?? 0;
          const vType = (a.get('vertex type') as { value: number })?.value ?? 0;
          const bPerV = vType === 4 ? 68 : 32;
          const sVAbs = src.ti.modelDataFileOffset + svOff;
          const oVAbs = out.ti.modelDataFileOffset + ovOff;
          if (!src.buf.subarray(sVAbs, sVAbs + vCount * bPerV).equals(out.buf.subarray(oVAbs, oVAbs + vCount * bPerV))) {
            diffs.push(`${p}: vertex data differs`);
          }
        } else if (f.name === 'triangle offset') {
          const stOff = src.buf.readUInt32LE(so + f.offset);
          const otOff = out.buf.readUInt32LE(oo + f.offset);
          const tCount = (a.get('triangle count') as { value: number })?.value ?? 0;
          const sTAbs = src.ti.modelDataFileOffset + src.ti.vertexSize + stOff;
          const oTAbs = out.ti.modelDataFileOffset + out.ti.vertexSize + otOff;
          if (!src.buf.subarray(sTAbs, sTAbs + tCount * 2).equals(out.buf.subarray(oTAbs, oTAbs + tCount * 2))) {
            diffs.push(`${p}: triangle data differs`);
          }
        }
      }
    }
    for (let i = 0; i < R.totalSize; i++) {
      if (pointerBytes[i] || src.buf[so + i] === out.buf[oo + i]) continue;
      const f = [...R.fields].reverse().find((x) => x.offset <= i && i < x.offset + x.size);
      diffs.push(`${fp} ${st}+0x${i.toString(16)} (${f ? f.name : 'pad'}): byte 0x${src.buf[so + i].toString(16)} -> 0x${out.buf[oo + i].toString(16)}`);
      if (f) i = f.offset + f.size - 1;
    }
  };
  const so = resolveTagDataPointer(se.tagDataPointerOrResourceIndex, src.header, src.ti.baseMemoryAddress);
  const oo = resolveTagDataPointer(oe.tagDataPointerOrResourceIndex, out.header, out.ti.baseMemoryAddress);
  if (!inRange(out, oo, resolveStruct(structName).totalSize)) return [`${se.path}: tag data pointer outside tag data`];
  cmp(structName, so, oo, se.path);
  return diffs;
}

/** Output tag array index of the tag with this class and path (case-insensitive), or -1. */
export function findTag(m: AuditMap, group: string, path: string): number {
  return m.ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === group && e.path.toLowerCase() === path.toLowerCase());
}

/**
 * Every tag reference in the map's internal (non-BSP) tags, checked against what the injector
 * writes: non-null -> path pointer equals the target tag-array entry's path pointer and path size
 * 0; null -> path pointer 0 and path size 0. Returns the references that differ (empty = consistent).
 */
export function referencePathPointerIssues(m: AuditMap): string[] {
  const issues: string[] = [];
  const walk = (structName: string, off: number, fp: string) => {
    const d = decodeStruct(m.buf, off, structName);
    for (const f of resolveStruct(structName).fields) {
      const v = d.get(f.name);
      if (!v || f.def.nonCached) continue;
      const p = `${fp}.${f.name}`;
      if (v.kind === 'dependency') {
        const isNull = (v.value.tagId >>> 0) === NULL_TAG_ID;
        const want = isNull ? 0 : entryPathPointer(m, v.value.tagId) >>> 0;
        if ((v.value.pathPointer >>> 0) !== want || v.value.pathSize !== 0) issues.push(`${p}: path pointer 0x${(v.value.pathPointer >>> 0).toString(16)} size ${v.value.pathSize}, expected 0x${want.toString(16)} size 0`);
      } else if (v.kind === 'reflexive' && v.value.count > 0 && f.def.type === 'TagReflexive') {
        const size = resolveStruct(f.def.struct).totalSize;
        const base = resolvePointer(v.value.pointerLow >>> 0, m.header.tagDataOffset, m.ti.baseMemoryAddress);
        if (base < m.header.tagDataOffset || base + v.value.count * size > m.header.tagDataOffset + m.header.tagDataSize) continue;
        for (let i = 0; i < v.value.count; i++) walk(f.def.struct, base + i * size, `${p}[${i}]`);
      }
    }
  };
  for (const e of m.ti.entries) {
    if (e.isExternal || e.primaryClassName === 'scenario_structure_bsp') continue;
    walk(getGroupStructName(e.primaryClassName!)!, resolveTagDataPointer(e.tagDataPointerOrResourceIndex, m.header, m.ti.baseMemoryAddress), e.path);
  }
  return issues;
}
