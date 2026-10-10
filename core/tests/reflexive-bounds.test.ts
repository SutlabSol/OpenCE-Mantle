import { describe, expect, it, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies } from '../src/map/dependency-walker';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, OCETAGS_FORMAT_VERSION } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planAddInjection, planSwapInjection, applyAddInjection } from '../src/map/tag-injector';
import type { InjectionPlanResult } from '../src/map/tag-injector';
import { resolveStruct, decodeStruct, resolvePointer, getGroupDefinition, getAllTagGroupNames } from '../src/map/definitions/engine';
import type { ResolvedField } from '../src/map/definitions/engine';
import { resolveTagDataPointer } from '../src/map/tag-index';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';
import { computeExpectedExtractedLength } from './helpers/expected-length';
import { hasSampleMaps, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

/**
 * Out-of-bounds TagReflexive handling (PRD.md "extractor reflexive bounds-check"). Before the
 * fix, an out-of-bounds reflexive either crashed the whole extraction with a raw RangeError, or
 * (when only trailing struct padding was past EOF) silently produced a container with EOF garbage
 * and every later reflexive shifted - which ADD and SWAP then accepted.
 *
 * The tag is chosen by the schema, never by path: the first tag in the source map with >= 2
 * non-empty top-level reflexives, whose first non-empty reflexive's element struct has trailing
 * padding (so case (c) is reachable), and which a clean ADD into the target and a clean SWAP into
 * the source both accept (so a block can only come from the corruption).
 *
 * Labels: "same-reader" = expected values derived with our own schema engine (shared blind spots
 * possible). Byte comparisons read raw source bytes, but the OFFSETS they read at still come from
 * the schema, so they are same-reader too. Nothing here proves OpenCE behavior.
 */

const SOURCE = 'bloodgulch.map';
const TARGET = 'ui.map';
const haveMaps = hasSampleMaps([SOURCE, TARGET]);
const title = haveMaps
  ? 'out-of-bounds reflexive: extraction never throws, tag data matches the source, ADD/SWAP block it'
  : `out-of-bounds reflexive [${missingSampleMapsMessage([SOURCE, TARGET])}]`;

interface Pick {
  index: number;
  structName: string;
  fileOffset: number;
  field: ResolvedField;
  childStruct: string;
  childSize: number;
  count: number;
  trailingPad: number;
}

/** Byte ranges within a struct instance that the extractor legitimately rewrites (non-empty reflexive / in-bounds TagDataOffset pointer words). Same-reader: positions come from the schema. */
function rewrittenPointerRanges(buffer: Buffer, structName: string, fileOffset: number, anchor: number, base: number, skipField?: string): [number, number][] {
  const resolved = resolveStruct(structName);
  const decoded = decodeStruct(buffer, fileOffset, structName);
  const ranges: [number, number][] = [];
  for (const f of resolved.fields) {
    const v = decoded.get(f.name);
    if (!v || f.def.nonCached || f.name === skipField) continue;
    if (v.kind === 'reflexive' && v.value.count > 0) ranges.push([f.offset + 4, f.offset + 12]);
    if (v.kind === 'tagDataOffset' && f.def.type === 'TagDataOffset' && !f.def.externalFileOffset && v.value.size > 0) {
      const src = resolvePointer(v.value.pointerLow, anchor, base);
      if (src >= 0 && src + v.value.size <= buffer.length) ranges.push([f.offset + 12, f.offset + 20]);
    }
  }
  return ranges;
}

function maskedEqual(a: Buffer, b: Buffer, masks: [number, number][]): boolean {
  if (a.length !== b.length) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  for (const [s, e] of masks) {
    x.fill(0, s, e);
    y.fill(0, s, e);
  }
  return x.equals(y);
}

function roundTrip(set: ReturnType<typeof extractTagSet>): OceContainer {
  return deserializeContainer(serializeContainer(set, 'src'));
}

function outcome(plan: InjectionPlanResult, container: OceContainer, originalIndex: number): { status: string; reasons: string } {
  if (plan.kind !== 'ok') return { status: 'refused', reasons: plan.reason };
  const li = container.tags.findIndex((t) => t.originalIndex === originalIndex);
  const blocked = [...plan.blockedOther, ...plan.blockedEmbedded].find((b) => b.localIndex === li);
  if (plan.toAddLocalIndices.includes(li)) return { status: 'added', reasons: '' };
  if (plan.toSwap.some((s) => s.localIndex === li)) return { status: 'swapped', reasons: '' };
  if (blocked) return { status: 'blocked', reasons: blocked.reasons.join(' ') };
  return { status: 'reused', reasons: '' };
}

describe.skipIf(!haveMaps)(title, () => {
  let src: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let target: Buffer;
  let targetHeader: CacheFileHeader;
  let targetIndex: TagIndex;
  let pick: Pick;
  let anchor: number;
  let base: number;

  beforeAll(() => {
    src = readSampleMap(SOURCE);
    target = readSampleMap(TARGET);
    const s = inspectCustomEditionMap(src);
    const t = inspectCustomEditionMap(target);
    if (s.status !== 'ok' || t.status !== 'ok') throw new Error('sample maps did not parse');
    ({ header, tagIndex } = s);
    targetHeader = t.header;
    targetIndex = t.tagIndex;
    anchor = header.tagDataOffset;
    base = tagIndex.baseMemoryAddress;

    const known = new Set(getAllTagGroupNames());
    for (const e of tagIndex.entries) {
      if (e.isExternal || !e.primaryClassName || !known.has(e.primaryClassName)) continue;
      const def = getGroupDefinition(e.primaryClassName);
      if (def.extractable === false) continue;
      const fileOffset = resolveTagDataPointer(e.tagDataPointerOrResourceIndex, header, base);
      const resolved = resolveStruct(def.name);
      const decoded = decodeStruct(src, fileOffset, def.name);
      const nonEmpty = resolved.fields.filter((f) => {
        const v = decoded.get(f.name);
        return v?.kind === 'reflexive' && v.value.count > 0 && f.def.type === 'TagReflexive' && !f.def.nonCached;
      });
      if (nonEmpty.length < 2) continue;
      const field = nonEmpty[0];
      if (field.def.type !== 'TagReflexive') continue;
      const child = resolveStruct(field.def.struct);
      const trailingPad = child.totalSize - Math.max(...child.fields.map((f) => f.offset + f.size));
      if (trailingPad <= 0) continue;
      const set = extractTagSet(src, header, tagIndex, [e.index]);
      const c = roundTrip(set);
      if (outcome(planAddInjection(targetIndex, c), c, e.index).status !== 'added') continue;
      if (outcome(planSwapInjection(tagIndex, c), c, e.index).status !== 'swapped') continue;
      const v = decoded.get(field.name);
      if (v?.kind !== 'reflexive') continue;
      pick = { index: e.index, structName: def.name, fileOffset, field, childStruct: field.def.struct, childSize: child.totalSize, count: v.value.count, trailingPad };
      break;
    }
    if (!pick) throw new Error(`fixture: no tag in ${SOURCE} matches the schema-based selection criteria`);
  });

  it('clean control: no invalidReflexive, no blockers, length matches the independent calculator (same-reader), ADD adds and SWAP swaps', () => {
    const walk = walkDependencies(src, header, tagIndex, [pick.index]);
    expect(walk.warnings.filter((w) => w.kind === 'invalidReflexive')).toEqual([]);
    const set = extractTagSet(src, header, tagIndex, [pick.index]);
    const tag = set.tags.find((t) => t.originalIndex === pick.index)!;
    expect(tag.injectionBlockers).toEqual([]);
    expect(tag.data.length).toBe(computeExpectedExtractedLength(src, pick.structName, pick.fileOffset, anchor, base));
    const c = roundTrip(set);
    expect(c.formatVersion).toBe(OCETAGS_FORMAT_VERSION);
    expect(c.tags.find((t) => t.originalIndex === pick.index)!.injectionBlockers).toEqual([]);
    expect(outcome(planAddInjection(targetIndex, c), c, pick.index).status).toBe('added');
    expect(outcome(planSwapInjection(tagIndex, c), c, pick.index).status).toBe('swapped');
  });

  const cases: { label: string; childBase: (len: number, p: Pick) => number }[] = [
    { label: '(a) array partly past EOF (half of it in the file)', childBase: (len, p) => len - Math.max(1, Math.floor((p.count * p.childSize) / 2)) },
    { label: '(b) array entirely past EOF', childBase: (len) => len + 0x10000 },
    { label: '(c) only the last element\'s trailing padding past EOF (silently corrupt before the fix)', childBase: (len, p) => len - p.count * p.childSize + p.trailingPad },
    { label: '(d) pointer resolves to a negative file offset', childBase: (_len, p) => -p.count * p.childSize },
  ];

  for (const c of cases) {
    it(`${c.label}: no throw, walker + per-tag blocker, data == source bytes (same-reader offsets), ADD and SWAP block it`, () => {
      const childBase = c.childBase(src.length, pick);
      const corrupted = Buffer.from(src);
      const fieldAbs = pick.fileOffset + pick.field.offset; // TagReflexive: count +0, pointer +4, pointerHigh +8
      const pointer = (childBase - anchor + base) >>> 0;
      corrupted.writeUInt32LE(pointer, fieldAbs + 4);
      expect(resolvePointer(corrupted.readUInt32LE(fieldAbs + 4), anchor, base)).toBe(childBase); // fixture sanity

      const walk = walkDependencies(corrupted, header, tagIndex, [pick.index]);
      expect(walk.warnings.some((w) => w.kind === 'invalidReflexive' && w.originalIndex === pick.index && w.path.endsWith(`.${pick.field.name}`))).toBe(true);

      const set = extractTagSet(corrupted, header, tagIndex, [pick.index]); // must not throw
      const tag = set.tags.find((t) => t.originalIndex === pick.index)!;
      expect(tag.injectionBlockers.map((b) => [b.kind, b.fieldPath])).toEqual([['invalidReflexive', `${tagIndex.entries[pick.index].path}.${pick.field.name}`]]);

      // Length: the independent calculator (same-reader) skips the out-of-bounds subtree.
      expect(tag.data.length).toBe(computeExpectedExtractedLength(corrupted, pick.structName, pick.fileOffset, anchor, base));

      // The corrupted reflexive's 12 bytes are exactly what the test wrote - left as in the source.
      expect(tag.data.subarray(pick.field.offset, pick.field.offset + 12).equals(corrupted.subarray(fieldAbs, fieldAbs + 12))).toBe(true);
      expect(tag.data.readUInt32LE(pick.field.offset + 4)).toBe(pointer);

      // Root struct == source root bytes, except the pointer words of the OTHER fields the extractor rewrites.
      const rootSize = resolveStruct(pick.structName).totalSize;
      const rootMasks = rewrittenPointerRanges(corrupted, pick.structName, pick.fileOffset, anchor, base, pick.field.name);
      expect(maskedEqual(tag.data.subarray(0, rootSize), corrupted.subarray(pick.fileOffset, pick.fileOffset + rootSize), rootMasks)).toBe(true);

      // Every OTHER non-empty top-level reflexive's local pointer lands on its own source elements (no shift).
      const decodedRoot = decodeStruct(corrupted, pick.fileOffset, pick.structName);
      let checked = 0;
      for (const f of resolveStruct(pick.structName).fields) {
        const v = decodedRoot.get(f.name);
        if (f === pick.field || f.def.type !== 'TagReflexive' || f.def.nonCached || v?.kind !== 'reflexive' || v.value.count === 0) continue;
        const childSize = resolveStruct(f.def.struct).totalSize;
        const srcBase = resolvePointer(v.value.pointerLow, anchor, base);
        const localBase = tag.data.readUInt32LE(f.offset + 4);
        expect(localBase + v.value.count * childSize).toBeLessThanOrEqual(tag.data.length);
        for (let i = 0; i < v.value.count; i++) {
          const srcOff = srcBase + i * childSize;
          const masks = rewrittenPointerRanges(corrupted, f.def.struct, srcOff, anchor, base);
          const local = tag.data.subarray(localBase + i * childSize, localBase + (i + 1) * childSize);
          expect(maskedEqual(local, corrupted.subarray(srcOff, srcOff + childSize), masks)).toBe(true);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(0);

      // Container saved and reloaded (bytes only - no source map involved in planning).
      const container = roundTrip(set);
      expect(container.tags.find((t) => t.originalIndex === pick.index)!.injectionBlockers?.[0]?.kind).toBe('invalidReflexive');
      const add = outcome(planAddInjection(targetIndex, container), container, pick.index);
      expect(add.status).toBe('blocked');
      expect(add.reasons).toContain('invalid/corrupt layout');
      const swap = outcome(planSwapInjection(tagIndex, container), container, pick.index);
      expect(swap.status).toBe('blocked');
      expect(swap.reasons).toContain('invalid/corrupt layout');
    });
  }

  it('the block works from a .ocetags file on disk alone: per-tag flag (v4) without any warnings, and persisted warnings for a v3-style container without the flag', () => {
    const corrupted = Buffer.from(src);
    const fieldAbs = pick.fileOffset + pick.field.offset;
    corrupted.writeUInt32LE((src.length + 0x10000 - anchor + base) >>> 0, fieldAbs + 4);
    const set = extractTagSet(corrupted, header, tagIndex, [pick.index]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocetags-test-'));
    const file = path.join(dir, `${randomUUID()}.ocetags`);
    try {
      fs.writeFileSync(file, serializeContainer(set, 'src'));
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));

      // v4 flag alone: strip every warning, keep the per-tag blocker.
      const flagOnly = deserializeContainer(Buffer.from(JSON.stringify({ ...raw, warnings: [] })));
      expect(outcome(planAddInjection(targetIndex, flagOnly), flagOnly, pick.index).status).toBe('blocked');
      expect(outcome(planSwapInjection(tagIndex, flagOnly), flagOnly, pick.index).status).toBe('blocked');

      // v3-style: no injectionBlockers field at all - falls back to the persisted walker warning.
      const v3 = { ...raw, formatVersion: 3, tags: raw.tags.map((t: Record<string, unknown>) => { const { injectionBlockers: _drop, ...rest } = t; return rest; }) };
      const legacy = deserializeContainer(Buffer.from(JSON.stringify(v3)));
      expect(legacy.formatVersion).toBe(3);
      expect(legacy.tags[0].injectionBlockers).toBeUndefined();
      const add = outcome(planAddInjection(targetIndex, legacy), legacy, pick.index);
      expect(add.status).toBe('blocked');
      expect(add.reasons).toContain('invalid/corrupt layout');
      expect(outcome(planSwapInjection(tagIndex, legacy), legacy, pick.index).status).toBe('blocked');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('(e) an unexpected exception while extracting one tag blocks only that tag with a structured message; the rest of the selection still extracts', () => {
    // Corrupt the tag-array entry (in memory) so the root struct straddles EOF - the walker skips
    // it silently, and decoding it in the extractor throws.
    const rootSize = resolveStruct(pick.structName).totalSize;
    const badPointer = (src.length - Math.floor(rootSize / 2) - anchor + base) >>> 0;
    const corruptIndex: TagIndex = { ...tagIndex, entries: tagIndex.entries.map((e) => (e.index === pick.index ? { ...e, tagDataPointerOrResourceIndex: badPointer } : e)) };
    const other = tagIndex.entries.find((e) => e.index !== pick.index && !e.isExternal && e.primaryClassName === tagIndex.entries[pick.index].primaryClassName)!;

    const set = extractTagSet(src, header, corruptIndex, [pick.index, other.index]); // must not throw
    const bad = set.tags.find((t) => t.originalIndex === pick.index)!;
    const good = set.tags.find((t) => t.originalIndex === other.index)!;
    expect(bad.injectionBlockers.map((b) => b.kind)).toEqual(['extractionFailed']);
    expect(bad.injectionBlockers[0].message).toMatch(/could not be extracted \(unexpected error: RangeError/);
    expect(bad.dependencies).toEqual([]);
    expect(bad.data.length).toBe(0); // root struct itself is out of bounds - nothing unmodified to keep
    expect(set.warnings.some((w) => w.kind === 'extractionFailed' && w.originalIndex === pick.index)).toBe(true);
    expect(good.injectionBlockers).toEqual([]);
    expect(good.data.length).toBe(computeExpectedExtractedLength(src, getGroupDefinition(other.primaryClassName!).name, resolveTagDataPointer(other.tagDataPointerOrResourceIndex, header, base), anchor, base));

    const container = roundTrip(set);
    const add = outcome(planAddInjection(targetIndex, container), container, pick.index);
    expect(add.status).toBe('blocked');
    expect(add.reasons).toContain('failed to extract');
    expect(outcome(planSwapInjection(tagIndex, container), container, pick.index).status).toBe('blocked');
  });

  it('(f) a tag of an unknown class (noDefinition) is blocked on its own; a good tag in the same selection still extracts', () => {
    // In-memory tag-index copy: give one tag a class name with no registered definition.
    const unknownGroup = 'no_such_group';
    expect(getAllTagGroupNames()).not.toContain(unknownGroup);
    const corruptIndex: TagIndex = { ...tagIndex, entries: tagIndex.entries.map((e) => (e.index === pick.index ? { ...e, primaryClassName: unknownGroup } : e)) };
    const other = tagIndex.entries.find((e) => e.index !== pick.index && !e.isExternal && e.primaryClassName === tagIndex.entries[pick.index].primaryClassName)!;

    const walk = walkDependencies(src, header, corruptIndex, [pick.index, other.index]);
    expect(walk.warnings.some((w) => w.kind === 'noDefinition' && w.originalIndex === pick.index)).toBe(true);

    const set = extractTagSet(src, header, corruptIndex, [pick.index, other.index]); // must not throw
    const bad = set.tags.find((t) => t.originalIndex === pick.index)!;
    const good = set.tags.find((t) => t.originalIndex === other.index)!;
    expect(bad.injectionBlockers.map((b) => b.kind)).toEqual(['extractionFailed']);
    expect(bad.injectionBlockers[0].message).toContain(`No tag group definition registered for "${unknownGroup}"`);
    expect(bad.structName).toBe('');
    expect(bad.data.length).toBe(0);
    expect(bad.dependencies).toEqual([]);
    expect(good.injectionBlockers).toEqual([]);
    expect(good.data.length).toBe(computeExpectedExtractedLength(src, getGroupDefinition(other.primaryClassName!).name, resolveTagDataPointer(other.tagDataPointerOrResourceIndex, header, base), anchor, base));

    const container = roundTrip(set);
    const add = planAddInjection(targetIndex, container);
    const addBad = outcome(add, container, pick.index);
    expect(addBad.status).toBe('blocked');
    expect(addBad.reasons).toContain('failed to extract');
    expect(outcome(add, container, other.index).status).toBe('added');
    expect(outcome(planSwapInjection(tagIndex, container), container, pick.index).status).toBe('blocked');
  });

  it('defense in depth: applyInjection refuses a tag carrying blockers even if a plan lets it through', () => {
    const set = extractTagSet(src, header, tagIndex, [pick.index]);
    const container = roundTrip(set);
    const plan = planAddInjection(targetIndex, container);
    if (plan.kind !== 'ok') throw new Error('fixture: clean plan refused');
    const li = container.tags.findIndex((t) => t.originalIndex === pick.index);
    container.tags[li].injectionBlockers = [{ kind: 'invalidReflexive', fieldPath: 'x', message: 'x' }];
    expect(() => applyAddInjection(Buffer.from(target), targetHeader, targetIndex, container, plan)).toThrow(/injection blockers/);
  });
});
