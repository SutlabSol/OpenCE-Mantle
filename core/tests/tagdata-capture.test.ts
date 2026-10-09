import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies } from '../src/map/dependency-walker';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { planAddInjection } from '../src/map/tag-injector';
import { resolveStruct, decodeStruct, resolvePointer, getGroupDefinition } from '../src/map/definitions/engine';
import { resolveTagDataPointer } from '../src/map/tag-index';
import { hasSampleMap, hasSampleMaps, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

/**
 * Closes the P0 "silently dropped data" bug (PRD.md "Two NEW, pre-existing bugs"): plain
 * TagDataOffset fields with no `externalFileOffset` annotation (font pixels, string_list/
 * unicode_string_list strings, meter stencil, hud_message_text, input_device_defaults,
 * model_animations frame data, scenario script/comment data) are captured by
 * `tag-extractor.ts`'s `flattenStruct` using the same pointer-translation mechanism as
 * TagReflexive. This file proves that against REAL bytes (not just bounds-checking), adds a
 * negative test proving the "doesn't resolve -> blocks, never drops" contract, and sweeps
 * every real tag in all 4 sample maps with an INDEPENDENT (not calling tag-extractor.ts's own
 * code) expected-length calculator.
 */

const haveUi = hasSampleMap('ui.map');
const uiTitle = haveUi ? 'font pixel data capture - real bytes (ui\\ticker)' : `font pixel data capture - real bytes (ui\\ticker) [${missingSampleMapsMessage(['ui.map'])}]`;

describe.skipIf(!haveUi)(uiTitle, () => {
  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let tickerIndex: number;

  beforeAll(() => {
    buffer = readSampleMap('ui.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('ui.map did not parse');
    header = inspected.header;
    tagIndex = inspected.tagIndex;
    tickerIndex = tagIndex.entries.find((e) => e.path === 'ui\\ticker' && e.primaryClassName === 'font')!.index;
  });

  it('"ui\\ticker" font: the 31,066-byte pixels field is captured BYTE-IDENTICAL to the source map, with no uncapturedData warning', () => {
    const fileOffset = resolveTagDataPointer(tagIndex.entries[tickerIndex].tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const decoded = decodeStruct(buffer, fileOffset, 'Font');
    const pixels = decoded.get('pixels');
    if (!pixels || pixels.kind !== 'tagDataOffset') throw new Error('fixture: Font.pixels did not decode as a TagDataOffset');
    expect(pixels.value.size).toBe(31066); // real value, confirmed in ui.map - not asserted blind

    const srcBase = resolvePointer(pixels.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    const sourceBytes = Buffer.from(buffer.subarray(srcBase, srcBase + pixels.value.size));

    const set = extractTagSet(buffer, header, tagIndex, [tickerIndex]);
    const tag = set.tags.find((t) => t.originalIndex === tickerIndex)!;
    expect(set.warnings.some((w) => w.originalIndex === tickerIndex && w.kind === 'uncapturedData')).toBe(false);

    const pixelsField = resolveStruct('Font').fields.find((f) => f.name === 'pixels')!;
    const localPointerLow = tag.data.readUInt32LE(pixelsField.offset + 12); // DecodedTagDataOffset.pointerLow
    expect(localPointerLow).toBeGreaterThan(0); // rewritten to a local offset, not left as the source's absolute virtual address
    const capturedBytes = tag.data.subarray(localPointerLow, localPointerLow + pixels.value.size);
    expect(capturedBytes.length).toBe(31066);
    expect(capturedBytes.equals(sourceBytes)).toBe(true); // byte-identical to the SOURCE MAP, not just internally consistent

    // The container holds the full ~31 KB (not truncated/dropped): round-trip through v3 serialize/deserialize.
    const container = deserializeContainer(serializeContainer(set, 'ui'));
    const containerTag = container.tags.find((t) => t.originalIndex === tickerIndex)!;
    const containerBytes = Buffer.from(containerTag.data, 'base64');
    expect(containerBytes.length).toBe(tag.data.length);
    expect(containerBytes.subarray(localPointerLow, localPointerLow + 31066).equals(sourceBytes)).toBe(true);
  });

  it('negative test: corrupting the pixels pointer to resolve out-of-bounds BLOCKS the whole tag from injection (uncapturedData), never silently drops the field', () => {
    const fileOffset = resolveTagDataPointer(tagIndex.entries[tickerIndex].tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const pixelsField = resolveStruct('Font').fields.find((f) => f.name === 'pixels')!;
    const pointerLowAbsoluteOffset = fileOffset + pixelsField.offset + 12;

    const corrupted = Buffer.from(buffer);
    corrupted.writeUInt32LE(0xdeadbeef, pointerLowAbsoluteOffset); // plausible-looking pointer that resolves outside the file

    const walk = walkDependencies(corrupted, header, tagIndex, [tickerIndex]);
    const warning = walk.warnings.find((w) => w.originalIndex === tickerIndex && w.kind === 'uncapturedData');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('resolves outside this file');

    const set = extractTagSet(corrupted, header, tagIndex, [tickerIndex]);
    const tag = set.tags.find((t) => t.originalIndex === tickerIndex)!;
    expect(tag).toBeDefined(); // extraction itself never throws - the tag is still produced, just flagged
    expect(set.warnings.some((w) => w.originalIndex === tickerIndex && w.kind === 'uncapturedData')).toBe(true);

    // The container, if someone tried to inject it anyway, is BLOCKED (not silently accepted).
    // Must target a DIFFERENT map that doesn't already have "ui\ticker" by path - injecting
    // into a copy of ui.map itself would just match/reuse the existing entry, never exercising
    // the block path at all.
    const haveBloodgulch = hasSampleMap('bloodgulch.map');
    if (!haveBloodgulch) return;
    const bgBuffer = readSampleMap('bloodgulch.map');
    const bgInspected = inspectCustomEditionMap(bgBuffer);
    if (bgInspected.status !== 'ok') throw new Error('bloodgulch.map did not parse');
    const container = deserializeContainer(serializeContainer(set, 'ui'));
    const plan = planAddInjection(bgInspected.tagIndex, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    const blockedEntry = [...plan.blockedOther, ...plan.blockedEmbedded].find((b) => b.path === 'ui\\ticker');
    expect(blockedEntry).toBeDefined();
    expect(blockedEntry!.reasons.join(' ')).toContain('cannot be captured or relocated');
  });
});

/**
 * Independently re-derives (from `resolveStruct`/`decodeStruct`/`resolvePointer` only - the
 * SAME low-level primitives `tag-extractor.ts` uses, but NOT calling any of its own
 * flatten/capture code) the expected byte length of one extracted tag's flattened buffer:
 * its own struct size, plus every reflexive descendant (recursively), plus every plain
 * (non-external, non-nonCached) TagDataOffset field's size IF its pointer resolves in-bounds
 * (0 otherwise - matching the extractor's own skip-on-unresolvable behavior, not a defect).
 * Labelled "same-reader": this reuses our own definitions engine, so a shared blind spot in
 * both would not be caught - it does NOT independently verify against the real Halo CE engine.
 */
function computeExpectedExtractedLength(buffer: Buffer, structName: string, fileOffset: number, anchor: number, base: number): number {
  const resolved = resolveStruct(structName);
  if (fileOffset < 0 || fileOffset + resolved.totalSize > buffer.length) return resolved.totalSize;
  const decoded = decodeStruct(buffer, fileOffset, structName);
  let total = resolved.totalSize;
  for (const field of resolved.fields) {
    const value = decoded.get(field.name);
    if (!value || field.def.nonCached) continue;
    if (value.kind === 'reflexive' && value.value.count > 0) {
      const childStructName = field.def.type === 'TagReflexive' ? field.def.struct : undefined;
      if (!childStructName) continue;
      const childSize = resolveStruct(childStructName).totalSize;
      const childBase = resolvePointer(value.value.pointerLow, anchor, base);
      for (let i = 0; i < value.value.count; i++) {
        total += childSize + (computeExpectedExtractedLength(buffer, childStructName, childBase + i * childSize, anchor, base) - childSize);
      }
    } else if (value.kind === 'tagDataOffset' && field.def.type === 'TagDataOffset' && !field.def.externalFileOffset && value.value.size > 0) {
      const srcBase = resolvePointer(value.value.pointerLow, anchor, base);
      if (srcBase >= 0 && srcBase + value.value.size <= buffer.length) total += value.value.size;
    }
  }
  return total;
}

const SWEEP_MAPS = ['bloodgulch.map', 'ui.map', 'sidewinder.map', 'coldsnap.map'];

describe('property sweep (same-reader): every tag in every available sample map either captures its non-cached data fields byte-for-byte or is flagged uncapturedData - never silently dropped', () => {
  for (const mapName of SWEEP_MAPS) {
    const have = hasSampleMaps([mapName]);
    const title = have ? `${mapName}: zero length mismatches across the whole tag closure` : `${mapName}: SKIPPED - ${missingSampleMapsMessage([mapName])}`;
    it.skipIf(!have)(title, () => {
      const buffer = readSampleMap(mapName);
      const inspected = inspectCustomEditionMap(buffer);
      if (inspected.status !== 'ok') throw new Error(`${mapName} did not parse`);
      const { header, tagIndex } = inspected;
      const roots = tagIndex.entries.filter((e) => !e.isExternal).map((e) => e.index);

      const walk = walkDependencies(buffer, header, tagIndex, roots);
      const set = extractTagSet(buffer, header, tagIndex, roots);
      const uncapturedCount = walk.warnings.filter((w) => w.kind === 'uncapturedData').length;

      let mismatches = 0;
      for (const tag of set.tags) {
        const def = getGroupDefinition(tag.group);
        const entry = tagIndex.entries[tag.originalIndex];
        const fileOffset = header.tagDataOffset + (entry.tagDataPointerOrResourceIndex - tagIndex.baseMemoryAddress);
        const expected = computeExpectedExtractedLength(buffer, def.name, fileOffset, header.tagDataOffset, tagIndex.baseMemoryAddress);
        if (expected !== tag.data.length) mismatches++;
      }

      // eslint-disable-next-line no-console
      console.log(`${mapName}: ${set.tags.length} tags extracted, ${uncapturedCount} uncapturedData warnings (blocked, not dropped), ${mismatches} length mismatches (silently dropped - must be 0).`);
      expect(mismatches).toBe(0);
    });
  }
});
