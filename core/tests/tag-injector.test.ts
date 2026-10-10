import { describe, expect, it, beforeAll } from 'vitest';
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, OCETAGS_FORMAT_VERSION, OCETAGS_MAGIC } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planAddInjection, applyAddInjection, planSwapInjection, applySwapInjection, normalizeTagPath, computeNewTagId } from '../src/map/tag-injector';
import { computeResourceMapIdentity } from '../src/map/resource-map';
import { validateStructInstance } from '../src/map/definitions/validate-tag';
import { getGroupDefinition } from '../src/map/definitions/engine';
import { hasSampleMap, readSampleMap, missingSampleMapsMessage, skippableTest } from './helpers/sample-maps';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

const haveSamples = hasSampleMap('bloodgulch.map') && hasSampleMap('ui.map');
const suiteTitle = haveSamples
  ? 'tag-injector M5 Step A/B (ADD + SWAP modes)'
  : `tag-injector M5 Step A/B (ADD + SWAP modes) [${missingSampleMapsMessage(['bloodgulch.map', 'ui.map'])}]`;

describe.skipIf(!haveSamples)(suiteTitle, () => {
  let bgBuffer: Buffer;
  let bgHeader: CacheFileHeader;
  let bgTagIndex: TagIndex;
  let uiBuffer: Buffer;
  let uiHeader: CacheFileHeader;
  let uiTagIndex: TagIndex;

  beforeAll(() => {
    bgBuffer = readSampleMap('bloodgulch.map');
    const bg = inspectCustomEditionMap(bgBuffer);
    if (bg.status !== 'ok') throw new Error('bloodgulch did not parse');
    bgHeader = bg.header;
    bgTagIndex = bg.tagIndex;

    uiBuffer = readSampleMap('ui.map');
    const ui = inspectCustomEditionMap(uiBuffer);
    if (ui.status !== 'ok') throw new Error('ui.map did not parse');
    uiHeader = ui.header;
    uiTagIndex = ui.tagIndex;
  });

  function extractFromUi(path: string, group: string): OceContainer {
    const entry = uiTagIndex.entries.find((e) => e.path === path && e.primaryClassName === group)!;
    expect(entry).toBeDefined();
    const set = extractTagSet(uiBuffer, uiHeader, uiTagIndex, [entry.index]);
    return deserializeContainer(serializeContainer(set, 'ui'));
  }

  it('categorizes a closure with zero external/embedded data as fully addable ("clean" baseline)', () => {
    const container = extractFromUi('ui\\ticker', 'font');
    expect(container.externalResourceRefs.length).toBe(0);
    expect(bgTagIndex.entries.some((e) => e.path === 'ui\\ticker')).toBe(false); // confirms this is a genuine new-to-target tag
    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.added).toBe(container.tags.length);
    expect(plan.counts.blockedEmbedded).toBe(0);
    expect(plan.counts.blockedOther).toBe(0);
    expect(plan.counts.externalReferenced).toBe(0);
  });

  it('categorizes an internal (non-whole-tag-indexed) bitmap closure as "externally referenced" (bitmaps.map)', () => {
    const container = extractFromUi('sky\\space\\bitmaps\\star mask', 'bitmap');
    expect(container.externalResourceRefs.length).toBeGreaterThan(0);
    expect(container.externalResourceRefs[0].resourceMap).toBe('bitmaps.map');
    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.externalReferenced).toBeGreaterThan(0);
    expect(plan.counts.blockedEmbedded).toBe(0);
  });

  it('reuses an existing (whole-tag-external) target entry by normalized path+class instead of duplicating it', () => {
    const container = extractFromUi('ui\\small_ui', 'font'); // bloodgulch already has this path as an external (loc.map) font entry
    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.added).toBe(0);
    expect(plan.reusedByLocalIndex.size).toBe(container.tags.length);
  });

  it('blocks a tag with an embedded (external=0) raw-data warning and cascades the block to its dependents', () => {
    const container = extractFromUi('ui\\ticker', 'font');
    const fakeOriginal = container.tags[0].originalIndex;
    container.warnings = [...container.warnings, { originalIndex: fakeOriginal, path: 'synthetic', group: 'font', kind: 'embeddedRawData', message: 'synthetic embedded warning for test' }];
    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.blockedEmbedded).toBe(1);
    expect(plan.counts.added).toBe(0);
    expect(plan.refusedRoots.length).toBe(1);
  });

  it('blocks a tag whose "external" (resource-map) dependency does not exist in the target map', () => {
    // Redirect a REAL non-null reference field's entry (a made-up fieldPath would now be blocked
    // earlier, as an unknown field, before this check is reached).
    const widget = uiTagIndex.entries.find((e) => e.primaryClassName === 'ui_widget_definition' && !bgTagIndex.entries.some((b) => b.path === e.path))!;
    const container = extractFromUi(widget.path, 'ui_widget_definition');
    const root = container.tags.findIndex((t) => t.originalIndex === widget.index);
    const deps = container.tags[root].dependencies;
    const k = deps.findIndex((d) => d.kind === 'internal' || d.kind === 'external');
    expect(k).toBeGreaterThanOrEqual(0);
    deps[k] = { fieldPath: deps[k].fieldPath, group: 'bitmap', path: 'this\\path\\does\\not\\exist', kind: 'external' };
    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.toAddLocalIndices).not.toContain(root);
    const reasons = plan.blockedOther.find((b) => b.localIndex === root)!.reasons.join(' ');
    expect(reasons).toContain('a resource-map tag not present in the target map');
  });

  it('refuses a container newer than the supported format version', () => {
    const container = extractFromUi('ui\\ticker', 'font');
    container.formatVersion = OCETAGS_FORMAT_VERSION + 1;
    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('refused');
  });

  const fingerprintGate = skippableTest(['bitmaps.map']);
  it.skipIf(fingerprintGate.skip)(`resource map fingerprint: reports match/mismatch/unconfigured correctly${fingerprintGate.titleSuffix}`, () => {
    const bitmapsBuf = readSampleMap('bitmaps.map');
    const identity = computeResourceMapIdentity(bitmapsBuf);
    const mutated = Buffer.from(bitmapsBuf);
    mutated[0x10] = mutated[0x10] ^ 0xff; // flip a byte inside the entry table -> different fingerprint, same size
    const mismatchedIdentity = computeResourceMapIdentity(mutated);
    expect(mismatchedIdentity.fingerprint).not.toBe(identity.fingerprint);

    const container = extractFromUi('sky\\space\\bitmaps\\star mask', 'bitmap');
    container.resourceMapIdentities = { bitmaps: identity };

    const noConfigPlan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container, {});
    expect(noConfigPlan.kind).toBe('ok');
    if (noConfigPlan.kind === 'ok') expect(noConfigPlan.externalRefStatuses[0].status).toBe('unconfigured-on-target');

    const matchPlan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container, { bitmaps: { identity } });
    expect(matchPlan.kind).toBe('ok');
    if (matchPlan.kind === 'ok') expect(matchPlan.externalRefStatuses[0].status).toBe('match');

    const mismatchPlan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container, { bitmaps: { identity: mismatchedIdentity } });
    expect(mismatchPlan.kind).toBe('ok');
    if (mismatchPlan.kind === 'ok') expect(mismatchPlan.externalRefStatuses[0].status).toBe('mismatch');
  });

  it('computeNewTagId matches the cited Invader formula for a known index', () => {
    // invader/src/build/build_workload.cpp line 1230: ((index + 0x6174) | 0x8000) << 16 | index
    const id = computeNewTagId(2455);
    const expectedSalt = ((2455 + 0x6174) | 0x8000) & 0xffff;
    expect(id >>> 16).toBe(expectedSalt);
    expect(id & 0xffff).toBe(2455);
  });

  it('end-to-end: injects a clean tag + an externally-referenced tag into a COPY of bloodgulch.map; every old AND new tag re-parses and fully validates (reflexive bounds, dependency resolution, round-trip)', () => {
    const tickerEntry = uiTagIndex.entries.find((e) => e.path === 'ui\\ticker' && e.primaryClassName === 'font')!;
    const starMaskEntry = uiTagIndex.entries.find((e) => e.path === 'sky\\space\\bitmaps\\star mask' && e.primaryClassName === 'bitmap')!;
    const set = extractTagSet(uiBuffer, uiHeader, uiTagIndex, [tickerEntry.index, starMaskEntry.index]);
    const container = deserializeContainer(serializeContainer(set, 'ui'));

    const plan = planAddInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') throw new Error('plan refused');
    expect(plan.counts.added).toBe(2);
    expect(plan.refusedRoots.length).toBe(0);

    const targetCopy = Buffer.from(bgBuffer); // never mutate the original sample
    const injected = applyAddInjection(targetCopy, bgHeader, bgTagIndex, container, plan);
    expect(targetCopy.equals(bgBuffer)).toBe(true); // confirms the source buffer was never mutated

    const reparsed = inspectCustomEditionMap(injected);
    expect(reparsed.status).toBe('ok');
    if (reparsed.status !== 'ok') return;
    expect(reparsed.tagIndex.entries.length).toBe(bgTagIndex.entries.length + 2);

    const newTicker = reparsed.tagIndex.entries.find((e) => e.path === 'ui\\ticker' && e.primaryClassName === 'font');
    const newStarMask = reparsed.tagIndex.entries.find((e) => e.path === 'sky\\space\\bitmaps\\star mask' && e.primaryClassName === 'bitmap');
    expect(newTicker).toBeDefined();
    expect(newStarMask).toBeDefined();

    // Validate EVERY tag (old AND new) - the regression check that the global
    // tag_array_address re-anchor trick didn't silently break any pre-existing tag's pointers.
    const errors: string[] = [];
    const stats = { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0, elementsBoundsChecked: 0 };
    let validated = 0;
    const knownGroups = new Set(reparsed.tagIndex.entries.map((e) => e.primaryClassName).filter(Boolean));
    for (const entry of reparsed.tagIndex.entries) {
      if (entry.isExternal) continue;
      if (entry.primaryClassName === 'scenario_structure_bsp') continue; // M4 scope, unrelated to injection
      if (!entry.primaryClassName) continue; // unregistered fourcc, not this test's concern
      let def;
      try {
        def = getGroupDefinition(entry.primaryClassName);
      } catch {
        continue; // no definition registered for this group - not this test's concern
      }
      if (def.extractable === false) continue;
      const fileOffset = reparsed.header.tagDataOffset + (entry.tagDataPointerOrResourceIndex - reparsed.tagIndex.baseMemoryAddress);
      validateStructInstance(injected, reparsed.tagIndex, def.name, fileOffset, reparsed.header.tagDataOffset, reparsed.tagIndex.baseMemoryAddress, entry.path, errors, stats);
      validated++;
    }
    expect(errors).toEqual([]);
    expect(validated).toBeGreaterThan(1500);
    void knownGroups;
  });

  it('SWAP mode plan: a matched internal tag is swapped in place (keeps existing tagId); matched whole-tag-external dependencies fall back to untouched/reused with a blocked reason', () => {
    const entry = uiTagIndex.entries.find((e) => e.path === 'weapons\\frag grenade\\shaders\\frag metal' && e.primaryClassName === 'shader_model')!;
    expect(entry).toBeDefined();
    const set = extractTagSet(uiBuffer, uiHeader, uiTagIndex, [entry.index]);
    const container = deserializeContainer(serializeContainer(set, 'ui'));

    const targetRoot = bgTagIndex.entries.find((e) => e.path === 'weapons\\frag grenade\\shaders\\frag metal' && e.primaryClassName === 'shader_model')!;
    expect(targetRoot).toBeDefined();
    expect(targetRoot.isExternal).toBe(false); // confirms this is a genuine in-place-swappable match, not a resource-map entry

    const plan = planSwapInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;

    expect(plan.toSwap.some((s) => s.path === targetRoot.path && s.targetTagId === targetRoot.tagId)).toBe(true);
    expect(plan.counts.swapped).toBeGreaterThanOrEqual(1);
    expect(plan.resolvedTagIdByLocalIndex.get(container.tags.findIndex((t) => t.path === targetRoot.path))).toBe(targetRoot.tagId);

    // The shader's bitmap dependencies already exist in bloodgulch as whole-tag-EXTERNAL entries
    // (stock bitmaps.map) - nothing to swap into, so they fall back to reused + a blocked reason.
    const blockedExternalTargets = [...plan.blockedOther].filter((b) => b.group === 'bitmap');
    expect(blockedExternalTargets.length).toBeGreaterThan(0);
    for (const b of blockedExternalTargets) {
      expect(b.reasons.join(' ')).toMatch(/resource-map-indexed \(external\) entry/);
      const li = container.tags.findIndex((t) => t.path === b.path && t.group === b.group);
      expect(plan.reusedByLocalIndex.has(li)).toBe(true); // untouched fallback
    }
  });

  it('SWAP mode apply: re-parses cleanly, swapped tag keeps its OLD tagId with NEW data, tag count is unchanged (pure swap, no adds), and every old+new tag still validates', () => {
    const entry = uiTagIndex.entries.find((e) => e.path === 'weapons\\frag grenade\\shaders\\frag metal' && e.primaryClassName === 'shader_model')!;
    const set = extractTagSet(uiBuffer, uiHeader, uiTagIndex, [entry.index]);
    const container = deserializeContainer(serializeContainer(set, 'ui'));

    const targetRoot = bgTagIndex.entries.find((e) => e.path === 'weapons\\frag grenade\\shaders\\frag metal' && e.primaryClassName === 'shader_model')!;
    const plan = planSwapInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') throw new Error('plan refused');
    expect(plan.counts.added).toBe(0); // all 3 bitmap deps already matched (external) - this is a pure swap, no growth

    const targetCopy = Buffer.from(bgBuffer);
    const injected = applySwapInjection(targetCopy, bgHeader, bgTagIndex, container, plan);
    expect(targetCopy.equals(bgBuffer)).toBe(true); // source buffer never mutated

    const reparsed = inspectCustomEditionMap(injected);
    expect(reparsed.status).toBe('ok');
    if (reparsed.status !== 'ok') return;
    expect(reparsed.tagIndex.entries.length).toBe(bgTagIndex.entries.length); // unchanged - swap doesn't grow the array

    const swapped = reparsed.tagIndex.entries.find((e) => e.path === targetRoot.path && e.primaryClassName === 'shader_model')!;
    expect(swapped.tagId).toBe(targetRoot.tagId); // tagId preserved
    expect(swapped.tagDataPointerOrResourceIndex).not.toBe(targetRoot.tagDataPointerOrResourceIndex); // data pointer DID move (new content)

    const errors: string[] = [];
    const stats = { structsVisited: 0, dependenciesChecked: 0, reflexivesChecked: 0, elementsBoundsChecked: 0 };
    let validated = 0;
    for (const entry2 of reparsed.tagIndex.entries) {
      if (entry2.isExternal) continue;
      if (entry2.primaryClassName === 'scenario_structure_bsp') continue;
      if (!entry2.primaryClassName) continue;
      let def;
      try {
        def = getGroupDefinition(entry2.primaryClassName);
      } catch {
        continue;
      }
      if (def.extractable === false) continue;
      const fileOffset = reparsed.header.tagDataOffset + (entry2.tagDataPointerOrResourceIndex - reparsed.tagIndex.baseMemoryAddress);
      validateStructInstance(injected, reparsed.tagIndex, def.name, fileOffset, reparsed.header.tagDataOffset, reparsed.tagIndex.baseMemoryAddress, entry2.path, errors, stats);
      validated++;
    }
    expect(errors).toEqual([]);
    expect(validated).toBeGreaterThan(1500);
  });

  it('SWAP mode: blocks a matched tag with an embedded (external=0) raw-data warning, falling back to untouched/reused instead of writing it', () => {
    const container = extractFromUi('ui\\small_ui', 'font'); // matches an EXISTING bloodgulch entry (loc.map external font) - see the whole-tag-external test above for that path; here we force an embedded warning on it to exercise the other SWAP block reason
    const fakeOriginal = container.tags[0].originalIndex;
    container.warnings = [...container.warnings, { originalIndex: fakeOriginal, path: 'synthetic', group: 'font', kind: 'embeddedRawData', message: 'synthetic embedded warning for test' }];
    const plan = planSwapInjection({ buffer: bgBuffer, header: bgHeader, tagIndex: bgTagIndex }, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.swapped).toBe(0);
    expect(plan.toSwap.length).toBe(0);
    expect(plan.reusedByLocalIndex.size).toBe(container.tags.length);
    expect(plan.blockedEmbedded.length).toBe(1);
  });
});
