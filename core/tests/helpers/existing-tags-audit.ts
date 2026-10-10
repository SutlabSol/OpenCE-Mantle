import { resolveStruct, decodeStruct, getGroupStructName } from '../../src/map/definitions/engine';
import type { TagIndex } from '../../src/map/tag-index';

/**
 * Independent checks for tag-array growth (PRD 2026-10-11 "ADD tag-array growth"). Shares only the
 * schema engine (field layout, decodeStruct) with the injector and pointer-rebase.ts - not their
 * walking code, and not the CE reader for the OUTPUT: the output is read raw, with the engine's
 * fixed base, and its tag array is found through the stored array pointer (so a moved array would
 * be followed, not assumed). The SOURCE's tag index (names, external flags) comes from the reader.
 */

/** The engine's CE tag data base (memory/demo-converter.md), restated here on purpose instead of imported. */
export const ENGINE_BASE = 0x40440000;

const u32 = (b: Buffer, at: number) => b.readUInt32LE(at);
const cstr = (b: Buffer, at: number) => {
  let end = at;
  while (end < b.length && b[end] !== 0) end++;
  return b.toString('latin1', at, end);
};

interface RawMap {
  buf: Buffer;
  tagDataOffset: number;
  tagDataSize: number;
}

function raw(buf: Buffer): RawMap {
  return { buf, tagDataOffset: u32(buf, 0x10), tagDataSize: u32(buf, 0x14) };
}

const fileOf = (m: RawMap, pointer: number) => m.tagDataOffset + (((pointer >>> 0) - ENGINE_BASE) | 0);
const inTagData = (m: RawMap, at: number, length: number) => at >= m.tagDataOffset && at + length <= m.tagDataOffset + m.tagDataSize && at + length <= m.buf.length;

/** Whether a tag-array data field holds an address inside the map's tag data. Decided by value here on purpose (independent of the injector, which decides by group). */
const isTagDataAddress = (m: RawMap, value: number) => inTagData(m, fileOf(m, value), 1);

const isPointerData = (f: { def: { type: string; nonCached?: boolean; externalFileOffset?: boolean } }) => f.def.type === 'TagDataOffset' && !f.def.nonCached && !f.def.externalFileOffset;

export interface ExistingTagsReport {
  /** Stored tag array pointer in the output's tag data header. */
  tagArrayAddress: number;
  /** Original tags whose struct tree was compared (internal, non-BSP). */
  compared: number;
  /** Original tags with at least one difference. */
  badTags: number;
  /** First differences found (capped). */
  problems: string[];
}

/**
 * For every tag of the source map (indices 0..n-1, which ADD/SWAP never renumber): the tag array
 * entry (classes, tagId, external flag) is unchanged, its path string reads the same, and - for
 * internal non-BSP tags not in `skip` - its struct tree is equal field by field apart from pointer
 * values: same non-pointer bytes, same reflexive counts and contents, same data-block bytes, same
 * reference path strings. Every pointer is resolved with ENGINE_BASE in both maps.
 * `skip`: tags whose data was replaced on purpose (SWAP); their entry and path are still checked.
 */
export function auditExistingTags(sourceBuf: Buffer, sourceIndex: TagIndex, outputBuf: Buffer, skip: Set<number> = new Set()): ExistingTagsReport {
  const src = raw(sourceBuf);
  const out = raw(outputBuf);
  const srcArray = fileOf(src, u32(src.buf, src.tagDataOffset));
  const outArrayPointer = u32(out.buf, out.tagDataOffset);
  const outArray = fileOf(out, outArrayPointer);
  const problems: string[] = [];
  const bad = new Set<number>();
  const report = (i: number, s: string) => {
    bad.add(i);
    if (problems.length < 20) problems.push(s);
  };

  const compare = (i: number, structName: string, so: number, oo: number, where: string) => {
    const R = resolveStruct(structName);
    if (!inTagData(out, oo, R.totalSize)) return report(i, `${where}: struct outside the output's tag data`);
    const a = decodeStruct(src.buf, so, structName);
    const b = decodeStruct(out.buf, oo, structName);
    const pointerBytes = new Uint8Array(R.totalSize);
    for (const f of R.fields) {
      const av = a.get(f.name);
      const bv = b.get(f.name);
      if (!av || !bv || f.def.nonCached) continue;
      const p = `${where}.${f.name}`;
      if (av.kind === 'dependency' && bv.kind === 'dependency') {
        pointerBytes.fill(1, f.offset + 4, f.offset + 8);
        const sp = av.value.pathPointer >>> 0;
        const op = bv.value.pathPointer >>> 0;
        if (sp === 0 || op === 0) {
          if (sp !== op) report(i, `${p}: path pointer 0x${sp.toString(16)} -> 0x${op.toString(16)}`);
          continue;
        }
        const ot = fileOf(out, op);
        const want = cstr(src.buf, fileOf(src, sp));
        const got = inTagData(out, ot, 1) ? cstr(out.buf, ot) : '<outside tag data>';
        if (want !== got) report(i, `${p}: reference path "${want}" -> "${got}"`);
      } else if (av.kind === 'reflexive' && bv.kind === 'reflexive' && f.def.type === 'TagReflexive') {
        if (av.value.count === 0) continue; // compared as raw bytes below (pointer included)
        if (av.value.pointerLow >>> 0 === 0) continue; // blocks in a resource map (external sound pitch ranges): raw bytes below
        pointerBytes.fill(1, f.offset + 4, f.offset + 8);
        if (av.value.count !== bv.value.count) {
          report(i, `${p}: count ${av.value.count} -> ${bv.value.count}`);
          continue;
        }
        const size = resolveStruct(f.def.struct).totalSize;
        const sb = fileOf(src, av.value.pointerLow);
        const ob = fileOf(out, bv.value.pointerLow);
        for (let k = 0; k < av.value.count; k++) compare(i, f.def.struct, sb + k * size, ob + k * size, `${p}[${k}]`);
      } else if (av.kind === 'tagDataOffset' && bv.kind === 'tagDataOffset' && isPointerData(f) && av.value.size > 0) {
        pointerBytes.fill(1, f.offset + 12, f.offset + 16);
        const sb = fileOf(src, av.value.pointerLow);
        const ob = fileOf(out, bv.value.pointerLow);
        if (!inTagData(out, ob, av.value.size) || !src.buf.subarray(sb, sb + av.value.size).equals(out.buf.subarray(ob, ob + av.value.size))) report(i, `${p}: data block (${av.value.size} bytes) differs`);
      }
    }
    for (let k = 0; k < R.totalSize; k++) {
      if (pointerBytes[k] || src.buf[so + k] === out.buf[oo + k]) continue;
      report(i, `${where} ${structName}+0x${k.toString(16)}: non-pointer byte 0x${src.buf[so + k].toString(16)} -> 0x${out.buf[oo + k].toString(16)}`);
      break;
    }
  };

  let compared = 0;
  for (const e of sourceIndex.entries) {
    const i = e.index;
    const se = srcArray + i * 32;
    const oe = outArray + i * 32;
    if (!inTagData(out, oe, 32)) {
      report(i, `tag #${i}: array entry outside the output's tag data (array pointer 0x${outArrayPointer.toString(16)})`);
      continue;
    }
    const changed = [0x0, 0x4, 0x8, 0xc, 0x18].filter((f) => !(skip.has(i) && (f === 0x4 || f === 0x8)) && u32(src.buf, se + f) !== u32(out.buf, oe + f));
    if (changed.length > 0) report(i, `tag #${i} ${e.path}: entry fields +${changed.map((f) => `0x${f.toString(16)}`).join(',')} changed`);
    const outPathAt = fileOf(out, u32(out.buf, oe + 0x10));
    const outPath = inTagData(out, outPathAt, 1) ? cstr(out.buf, outPathAt) : '<outside tag data>';
    if (outPath !== e.path) {
      report(i, `tag #${i}: path "${e.path}" -> "${outPath}"`);
      continue;
    }
    // An external entry whose data field is an address (external sounds keep their base struct in
    // the map) is compared like an internal tag; a resource index or a BSP entry must be unchanged.
    const sourceData = u32(src.buf, se + 0x14);
    if (e.primaryClassName === 'scenario_structure_bsp' || (e.isExternal && !isTagDataAddress(src, sourceData))) {
      if (sourceData !== u32(out.buf, oe + 0x14)) report(i, `tag #${i} ${e.path}: data pointer / resource index changed`);
      continue;
    }
    if (skip.has(i)) continue;
    const structName = e.primaryClassName ? getGroupStructName(e.primaryClassName) : null;
    if (!structName) {
      report(i, `tag #${i} ${e.path}: no definition for ${e.primaryClassName}`);
      continue;
    }
    compared++;
    compare(i, structName, fileOf(src, u32(src.buf, se + 0x14)), fileOf(out, u32(out.buf, oe + 0x14)), e.path);
  }
  return { tagArrayAddress: outArrayPointer, compared, badTags: bad.size, problems };
}

export interface PointerCensus {
  tagPath: number;
  tagData: number;
  reflexive: number;
  dataBlock: number;
  referencePath: number;
  total: number;
}

/**
 * Counts every pointer the engine follows in an ORIGINAL map's tag data, by its own walk (separate
 * code from pointer-rebase.ts): every entry's path pointer, the data pointer of every non-BSP entry
 * whose data field is a tag-data address (internal tags and external sounds - decided by value
 * here), non-null reflexive pointers, pointer-based data blocks, non-zero reference path pointers.
 */
export function pointerCensus(buf: Buffer, ti: TagIndex): PointerCensus {
  const m = raw(buf);
  const c: PointerCensus = { tagPath: 0, tagData: 0, reflexive: 0, dataBlock: 0, referencePath: 0, total: 0 };
  const seen = new Set<string>();
  const walk = (structName: string, at: number) => {
    const key = `${structName}@${at}`;
    if (seen.has(key)) return;
    seen.add(key);
    const d = decodeStruct(buf, at, structName);
    for (const f of resolveStruct(structName).fields) {
      const v = d.get(f.name);
      if (!v || f.def.nonCached) continue;
      if (v.kind === 'dependency') {
        if (v.value.pathPointer >>> 0 !== 0) c.referencePath++;
      } else if (v.kind === 'reflexive' && f.def.type === 'TagReflexive') {
        if (v.value.pointerLow >>> 0 === 0) continue; // count 0, or blocks in a resource map
        c.reflexive++;
        const size = resolveStruct(f.def.struct).totalSize;
        for (let k = 0; k < v.value.count; k++) walk(f.def.struct, fileOf(m, v.value.pointerLow) + k * size);
      } else if (v.kind === 'tagDataOffset' && isPointerData(f) && (v.value.size > 0 || v.value.pointerLow >>> 0 !== 0)) {
        c.dataBlock++;
      }
    }
  };
  for (const e of ti.entries) {
    c.tagPath++;
    if (e.primaryClassName === 'scenario_structure_bsp') continue;
    if (e.isExternal && !isTagDataAddress(m, e.tagDataPointerOrResourceIndex >>> 0)) continue; // resource index
    c.tagData++;
    walk(getGroupStructName(e.primaryClassName!)!, fileOf(m, e.tagDataPointerOrResourceIndex));
  }
  c.total = c.tagPath + c.tagData + c.reflexive + c.dataBlock + c.referencePath;
  return c;
}
