import { describe, expect, it } from 'vitest';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex, resolveTagDataPointer } from '../src/map/tag-index';
import type { TagIndex } from '../src/map/tag-index';
import type { CacheFileHeader } from '../src/map/header';
import { resolveStruct, decodeStruct, resolvePointer, isRangeInBuffer, getGroupStructName } from '../src/map/definitions/engine';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { applyInjection } from '../src/map/tag-injector';
import { planThatFitsTagSpace } from './helpers/fit-tag-space';
import type { InjectionMode } from '../src/map/tag-injector';
import { readSampleMap, skippableTest } from './helpers/sample-maps';

/**
 * Regression for the dependency-order P0 (PRD 2026-10-11): ADD/SWAP used to hand TagDependency
 * fields each other's targets (e.g. SWAP of globals\globals wrote 11 wrong references with no
 * error, and ~160-280 tags per map threw). Whole-map extraction (every internal tag except
 * scenario/BSP), then SWAP each map into a copy of itself and ADD ui into bloodgulch.
 *
 * The output check is INDEPENDENT of the extractor and injector code: it walks the source map
 * and the output map directly (schema engine + header/tag-index parser only - those primitives
 * are shared with the injector) and compares every reference field's target, by field path,
 * as "class|path" through each map's own tag index. Nothing is written to disk.
 */

const NULL_TAG_ID = 0xffffffff;
const DEP_MAP_BLOCK_TEXT = ["saved tag references don't match its fields", "saved data does not match this build's field layout"];

interface LoadedMap { buf: Buffer; header: CacheFileHeader; ti: TagIndex }

function load(name: string): LoadedMap {
  const buf = readSampleMap(name);
  const header = parseCacheFileHeader(buf);
  return { buf, header, ti: parseTagIndex(buf, header) };
}

/** Field-order walk of one tag in a real map: reference field path -> raw tagId, plus every path in field order. nonCached fields are skipped (never captured or rewritten). */
function referenceFields(m: LoadedMap, index: number): { byPath: Map<string, number>; order: string[] } {
  const byPath = new Map<string, number>();
  const order: string[] = [];
  const e = m.ti.entries[index];
  const walk = (structName: string, off: number, fp: string): void => {
    const decoded = decodeStruct(m.buf, off, structName);
    for (const f of resolveStruct(structName).fields) {
      const v = decoded.get(f.name);
      if (!v || f.def.nonCached) continue;
      const p = `${fp}.${f.name}`;
      if (v.kind === 'dependency') {
        byPath.set(p, v.value.tagId >>> 0);
        order.push(p);
      } else if (v.kind === 'reflexive' && v.value.count > 0 && f.def.type === 'TagReflexive') {
        const size = resolveStruct(f.def.struct).totalSize;
        const base = resolvePointer(v.value.pointerLow, m.header.tagDataOffset, m.ti.baseMemoryAddress);
        if (!isRangeInBuffer(base, v.value.count * size, m.buf.length)) continue;
        for (let i = 0; i < v.value.count; i++) walk(f.def.struct, base + i * size, `${p}[${i}]`);
      }
    }
  };
  walk(getGroupStructName(e.primaryClassName!)!, resolveTagDataPointer(e.tagDataPointerOrResourceIndex, m.header, m.ti.baseMemoryAddress), e.path);
  return { byPath, order };
}

function targetKey(ti: TagIndex, tagId: number): string {
  if (tagId === NULL_TAG_ID) return 'null';
  const e = ti.entries[tagId & 0xffff];
  return e && e.tagId === tagId ? `${e.primaryClassName}|${e.path.toLowerCase()}` : `invalid tagId 0x${tagId.toString(16)}`;
}

/** Every non-scenario tag as roots, halved only if the result wouldn't fit the tag space (`planThatFitsTagSpace`). */
function injectAndCompare(src: LoadedMap, srcName: string, tgt: LoadedMap, mode: InjectionMode) {
  const roots = src.ti.entries.filter((e) => !e.isExternal && e.primaryClassName !== 'scenario' && e.primaryClassName !== 'scenario_structure_bsp').map((e) => e.index);
  const { container, plan } = planThatFitsTagSpace(mode, { buffer: tgt.buf, header: tgt.header, tagIndex: tgt.ti }, roots, (r) => deserializeContainer(serializeContainer(extractTagSet(src.buf, src.header, src.ti, r), srcName)));
  const depMapBlocked = [...plan.blockedOther, ...plan.blockedEmbedded].filter((b) => b.reasons.some((r) => DEP_MAP_BLOCK_TEXT.some((s) => r.includes(s))));

  const out = applyInjection(tgt.buf, tgt.header, tgt.ti, container, plan); // must not throw
  const oh = parseCacheFileHeader(out);
  const output: LoadedMap = { buf: out, header: oh, ti: parseTagIndex(out, oh) };

  const written = mode === 'add' ? plan.toAddLocalIndices : plan.toSwap.map((s) => s.localIndex);
  let fieldsCompared = 0;
  let reorderedTagsWritten = 0;
  const wrong: string[] = [];
  for (const li of written) {
    const t = container.tags[li];
    const outIndex = output.ti.entries.findIndex((e) => !e.isExternal && e.primaryClassName === t.group && e.path.toLowerCase() === t.path.toLowerCase());
    expect(outIndex, `${t.path} missing from output`).toBeGreaterThanOrEqual(0);
    const before = referenceFields(src, t.originalIndex);
    const after = referenceFields(output, outIndex);
    expect(after.byPath.size, `${t.path}: reference field count`).toBe(before.byPath.size);
    for (const [p, id] of before.byPath) {
      fieldsCompared++;
      const want = targetKey(src.ti, id);
      const got = targetKey(output.ti, after.byPath.get(p) ?? -1);
      if (want !== got) wrong.push(`${t.group} ${p}: ${want} -> ${got}`);
    }
    // Was this tag's saved list in a different order than its fields? (the case a positional read got wrong)
    if (t.dependencies.map((d) => d.fieldPath).join('\n') !== before.order.join('\n')) reorderedTagsWritten++;
  }
  return { written: written.length, fieldsCompared, wrong, depMapBlocked, reorderedTagsWritten };
}

describe('dependency targets survive ADD/SWAP (real maps, independent source-vs-output comparison)', () => {
  for (const name of ['bloodgulch.map', 'ui.map', 'sidewinder.map', 'coldsnap.map']) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`SWAP ${name} into a copy of itself: no throw, 0 wrong reference targets${gate.titleSuffix}`, () => {
      const m = load(name);
      const r = injectAndCompare(m, name, m, 'swap');
      expect(r.depMapBlocked.map((b) => b.path)).toEqual([]);
      expect(r.wrong).toEqual([]);
      expect(r.written).toBeGreaterThan(0);
      expect(r.fieldsCompared).toBeGreaterThan(0);
      expect(r.reorderedTagsWritten).toBeGreaterThan(0); // the regression case is actually exercised
    }, 300_000);
  }

  const gate = skippableTest(['ui.map', 'bloodgulch.map']);
  it.skipIf(gate.skip)(`ADD ui.map into a copy of bloodgulch.map: no throw, 0 wrong reference targets${gate.titleSuffix}`, () => {
    const r = injectAndCompare(load('ui.map'), 'ui.map', load('bloodgulch.map'), 'add');
    expect(r.depMapBlocked.map((b) => b.path)).toEqual([]);
    expect(r.wrong).toEqual([]);
    expect(r.written).toBeGreaterThan(0);
    expect(r.reorderedTagsWritten).toBeGreaterThan(0);
  }, 300_000);
});
