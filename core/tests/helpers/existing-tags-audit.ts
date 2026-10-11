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

const isPointerData = (f: { def: { type: string; nonCached?: boolean; externalFileOffset?: unknown } }) => f.def.type === 'TagDataOffset' && !f.def.nonCached && !f.def.externalFileOffset;

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
        const size = resolveStruct(f.def.struct!).totalSize;
        const sb = fileOf(src, av.value.pointerLow);
        const ob = fileOf(out, bv.value.pointerLow);
        for (let k = 0; k < av.value.count; k++) compare(i, f.def.struct!, sb + k * size, ob + k * size, `${p}[${k}]`);
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
  bspReferencePath: number;
  total: number;
}

/** One reference path pointer inside a BSP: `at` is its file offset, `value` the stored pointer. */
export interface BspReferencePath {
  at: number;
  value: number;
  where: string;
}

/**
 * Every non-zero reference path pointer inside the BSPs the scenario lists, by this helper's own
 * walk: the scenario's "structure bsps" give bsp start / bsp address, the BSP header's first word
 * is the BSP struct's address, and the BSP's blocks resolve in BSP space.
 */
export function bspReferencePaths(buf: Buffer, ti: TagIndex): BspReferencePath[] {
  const m = raw(buf);
  const found: BspReferencePath[] = [];
  const scenario = ti.entries[ti.scenarioTagId & 0xffff];
  const scenarioStruct = getGroupStructName('scenario')!;
  const bsps = decodeStruct(buf, fileOf(m, scenario.tagDataPointerOrResourceIndex), scenarioStruct).get('structure bsps');
  if (bsps?.kind !== 'reflexive') return found;
  const field = resolveStruct(scenarioStruct).fields.find((f) => f.name === 'structure bsps')!;
  const elementStruct = field.def.type === 'TagReflexive' ? field.def.struct ?? '' : '';
  const elementSize = resolveStruct(elementStruct).totalSize;
  for (let b = 0; b < bsps.value.count; b++) {
    const el = decodeStruct(buf, fileOf(m, bsps.value.pointerLow) + b * elementSize, elementStruct);
    const start = Number((el.get('bsp start') as { value: number }).value);
    const address = Number((el.get('bsp address') as { value: number }).value);
    const inBsp = (p: number) => start + (((p >>> 0) - address) | 0);
    const seen = new Set<string>();
    const walk = (structName: string, at: number, where: string) => {
      const key = `${structName}@${at}`;
      if (seen.has(key)) return;
      seen.add(key);
      const d = decodeStruct(buf, at, structName);
      for (const f of resolveStruct(structName).fields) {
        const v = d.get(f.name);
        if (!v || f.def.nonCached) continue;
        if (v.kind === 'dependency' && v.value.pathPointer >>> 0 !== 0) found.push({ at: at + f.offset + 4, value: v.value.pathPointer >>> 0, where: `${where}.${f.name}` });
        else if (v.kind === 'reflexive' && f.def.type === 'TagReflexive' && v.value.count > 0) {
          const size = resolveStruct(f.def.struct!).totalSize;
          for (let k = 0; k < v.value.count; k++) walk(f.def.struct!, inBsp(v.value.pointerLow) + k * size, `${where}.${f.name}[${k}]`);
        }
      }
    };
    walk(getGroupStructName('scenario_structure_bsp')!, inBsp(buf.readUInt32LE(start)), `structure bsps[${b}]`);
  }
  return found;
}

/**
 * Counts every pointer the engine follows in an ORIGINAL map's tag data, by its own walk (separate
 * code from pointer-rebase.ts): every entry's path pointer, the data pointer of every non-BSP entry
 * whose data field is a tag-data address (internal tags and external sounds - decided by value
 * here), non-null reflexive pointers, pointer-based data blocks, non-zero reference path pointers,
 * and the reference path pointers inside the BSPs (`bspReferencePaths`).
 */
export function pointerCensus(buf: Buffer, ti: TagIndex): PointerCensus {
  const m = raw(buf);
  const c: PointerCensus = { tagPath: 0, tagData: 0, reflexive: 0, dataBlock: 0, referencePath: 0, bspReferencePath: 0, total: 0 };
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
        const size = resolveStruct(f.def.struct!).totalSize;
        for (let k = 0; k < v.value.count; k++) walk(f.def.struct!, fileOf(m, v.value.pointerLow) + k * size);
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
  c.bspReferencePath = bspReferencePaths(buf, ti).length;
  c.total = c.tagPath + c.tagData + c.reflexive + c.dataBlock + c.referencePath + c.bspReferencePath;
  return c;
}

interface Block {
  start: number;
  end: number;
  owner: number;
}

/** Every block (root struct, reflexive arrays, data blocks) of every tag whose data field is a tag-data address, read raw with ENGINE_BASE. */
function ownedBlocks(m: RawMap, arrayAt: number, entries: TagIndex['entries'], skip: Set<number>): Block[] {
  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.primaryClassName === 'scenario_structure_bsp' || skip.has(e.index)) continue;
    const dataField = u32(m.buf, arrayAt + e.index * 32 + 0x14);
    if (!isTagDataAddress(m, dataField)) continue;
    const structName = getGroupStructName(e.primaryClassName!)!;
    const walk = (name: string, at: number) => {
      const key = `${name}@${at}`;
      if (seen.has(key)) return;
      seen.add(key);
      const size = resolveStruct(name).totalSize;
      if (!inTagData(m, at, size)) return;
      const d = decodeStruct(m.buf, at, name);
      for (const f of resolveStruct(name).fields) {
        const v = d.get(f.name);
        if (!v || f.def.nonCached) continue;
        if (v.kind === 'reflexive' && f.def.type === 'TagReflexive' && v.value.count > 0 && v.value.pointerLow >>> 0 !== 0) {
          const childSize = resolveStruct(f.def.struct!).totalSize;
          const childAt = fileOf(m, v.value.pointerLow);
          if (!inTagData(m, childAt, v.value.count * childSize)) continue;
          blocks.push({ start: childAt, end: childAt + v.value.count * childSize, owner: e.index });
          for (let k = 0; k < v.value.count; k++) walk(f.def.struct!, childAt + k * childSize);
        } else if (v.kind === 'tagDataOffset' && isPointerData(f) && v.value.size > 0) {
          const blockAt = fileOf(m, v.value.pointerLow);
          blocks.push({ start: blockAt, end: blockAt + v.value.size, owner: e.index });
        }
      }
    };
    const at = fileOf(m, dataField);
    blocks.push({ start: at, end: at + resolveStruct(structName).totalSize, owner: e.index });
    walk(structName, at);
  }
  return blocks.sort((a, b) => a.start - b.start);
}

export interface EntryAddressReport {
  /** Entries whose data field is a tag-data address in the source (internal tags and external sounds). */
  checked: number;
  /** Of those, external entries (external sounds). */
  checkedExternal: number;
  issues: string[];
  /** Entries whose data field lands inside a block of a different tag (count, and the first few). */
  ownershipCount: number;
  ownershipIssues: string[];
}

/**
 * Independent check of every tag-array data field that is an ADDRESS (decided by value, whatever
 * the external flag): for each source entry, the output entry keeps its external flag, still
 * holds an address, and its root struct is byte-identical to the source's apart from pointer
 * fields (reflexive / data-block / reference path pointers). Also: no entry's data field points
 * inside a block (root struct, reflexive array, data block) that belongs to a different tag.
 * Reads the output raw with ENGINE_BASE and finds its array through the stored array pointer.
 */
export function entryAddressIssues(sourceBuf: Buffer, sourceIndex: TagIndex, outputBuf: Buffer): EntryAddressReport {
  const src = raw(sourceBuf);
  const out = raw(outputBuf);
  const srcArray = fileOf(src, u32(src.buf, src.tagDataOffset));
  const outArray = fileOf(out, u32(out.buf, out.tagDataOffset));
  const issues: string[] = [];
  const bad = new Set<number>();
  let current = -1;
  const push = (s: string) => {
    if (current >= 0) bad.add(current);
    if (issues.length < 20) issues.push(s);
  };
  let checked = 0;
  let checkedExternal = 0;
  for (const e of sourceIndex.entries) {
    if (e.primaryClassName === 'scenario_structure_bsp') continue;
    const se = srcArray + e.index * 32;
    const oe = outArray + e.index * 32;
    if (!isTagDataAddress(src, u32(src.buf, se + 0x14))) continue;
    current = e.index;
    checked++;
    if (e.isExternal) checkedExternal++;
    if (u32(src.buf, se + 0x18) !== u32(out.buf, oe + 0x18)) push(`tag #${e.index} ${e.path}: external flag changed`);
    const outData = u32(out.buf, oe + 0x14);
    if (!isTagDataAddress(out, outData)) {
      push(`tag #${e.index} ${e.path} (${e.primaryClassName}${e.isExternal ? ', external' : ''}): data field 0x${outData.toString(16)} is no longer an address in tag data`);
      continue;
    }
    const structName = getGroupStructName(e.primaryClassName!)!;
    const R = resolveStruct(structName);
    const so = fileOf(src, u32(src.buf, se + 0x14));
    const oo = fileOf(out, outData);
    const mask = new Uint8Array(R.totalSize);
    const d = decodeStruct(src.buf, so, structName);
    for (const f of R.fields) {
      const v = d.get(f.name);
      if (!v || f.def.nonCached) continue;
      if (v.kind === 'dependency' || (v.kind === 'reflexive' && f.def.type === 'TagReflexive')) mask.fill(1, f.offset + 4, f.offset + 8);
      else if (v.kind === 'tagDataOffset' && isPointerData(f)) mask.fill(1, f.offset + 12, f.offset + 16);
    }
    for (let k = 0; k < R.totalSize; k++) {
      if (mask[k] || src.buf[so + k] === out.buf[oo + k]) continue;
      push(`tag #${e.index} ${e.path} (${e.primaryClassName}${e.isExternal ? ', external' : ''}): data field points at different bytes (${structName}+0x${k.toString(16)})`);
      break;
    }
  }
  current = -1;
  // Ownership: a data field must never land inside another tag's block. Blocks are taken from the
  // tags that passed the check above (a bad one's struct is garbage and can't be walked).
  const blocks = ownedBlocks(out, outArray, sourceIndex.entries, bad);
  const starts = blocks.map((b) => b.start);
  let ownershipCount = 0;
  const ownershipIssues: string[] = [];
  for (const e of sourceIndex.entries) {
    if (e.primaryClassName === 'scenario_structure_bsp') continue;
    const at = fileOf(out, u32(out.buf, outArray + e.index * 32 + 0x14));
    if (!isTagDataAddress(out, u32(out.buf, outArray + e.index * 32 + 0x14))) continue;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    for (let k = lo; k >= 0 && k > lo - 16; k--) {
      const b = blocks[k];
      if (b.owner !== e.index && at >= b.start && at < b.end) {
        ownershipCount++;
        if (ownershipIssues.length < 20) ownershipIssues.push(`tag #${e.index} ${e.path}: data field points inside a block of tag #${b.owner} ${sourceIndex.entries[b.owner]?.path}`);
        break;
      }
    }
  }
  return { checked, checkedExternal, issues, ownershipCount, ownershipIssues };
}
