import { describe, expect, it, beforeAll } from 'vitest';
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, OCETAGS_FORMAT_VERSION, OCETAGS_MAGIC } from '../src/map/container';
import type { OceContainer } from '../src/map/container';
import { planAddInjection, applyAddInjection, normalizeTagPath, computeNewTagId } from '../src/map/tag-injector';
import { computeResourceMapIdentity } from '../src/map/resource-map';
import { validateStructInstance } from '../src/map/definitions/validate-tag';
import { getGroupDefinition } from '../src/map/definitions/engine';
import { hasSampleMap, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

const haveSamples = hasSampleMap('bloodgulch.map') && hasSampleMap('ui.map');
const suiteTitle = haveSamples
  ? 'tag-injector M5 Step A (ADD mode)'
  : `tag-injector M5 Step A (ADD mode) [${missingSampleMapsMessage(['bloodgulch.map', 'ui.map'])}]`;

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
    const plan = planAddInjection(bgTagIndex, container);
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
    const plan = planAddInjection(bgTagIndex, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.externalReferenced).toBeGreaterThan(0);
    expect(plan.counts.blockedEmbedded).toBe(0);
  });

  it('reuses an existing (whole-tag-external) target entry by normalized path+class instead of duplicating it', () => {
    const container = extractFromUi('ui\\small_ui', 'font'); // bloodgulch already has this path as an external (loc.map) font entry
    const plan = planAddInjection(bgTagIndex, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.added).toBe(0);
    expect(plan.reusedByLocalIndex.size).toBe(container.tags.length);
  });

  it('blocks a tag with an embedded (external=0) raw-data warning and cascades the block to its dependents', () => {
    const container = extractFromUi('ui\\ticker', 'font');
    const fakeOriginal = container.tags[0].originalIndex;
    container.warnings = [...container.warnings, { originalIndex: fakeOriginal, path: 'synthetic', group: 'font', kind: 'embeddedRawData', message: 'synthetic embedded warning for test' }];
    const plan = planAddInjection(bgTagIndex, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.blockedEmbedded).toBe(1);
    expect(plan.counts.added).toBe(0);
    expect(plan.refusedRoots.length).toBe(1);
  });

  it('blocks a tag whose "external" (resource-map) dependency does not exist in the target map', () => {
    const container = extractFromUi('ui\\ticker', 'font');
    container.tags[0].dependencies = [...container.tags[0].dependencies, { fieldPath: '.synthetic', group: 'bitmap', path: 'this\\path\\does\\not\\exist', kind: 'external' }];
    const plan = planAddInjection(bgTagIndex, container);
    expect(plan.kind).toBe('ok');
    if (plan.kind !== 'ok') return;
    expect(plan.counts.blockedOther).toBe(1);
    expect(plan.counts.added).toBe(0);
  });

  it('refuses a container newer than the supported format version', () => {
    const container = extractFromUi('ui\\ticker', 'font');
    container.formatVersion = OCETAGS_FORMAT_VERSION + 1;
    const plan = planAddInjection(bgTagIndex, container);
    expect(plan.kind).toBe('refused');
  });

  it('resource map fingerprint: reports match/mismatch/unconfigured correctly', () => {
    const bitmapsBuf = readSampleMap('bitmaps.map');
    const identity = computeResourceMapIdentity(bitmapsBuf);
    const mutated = Buffer.from(bitmapsBuf);
    mutated[0x10] = mutated[0x10] ^ 0xff; // flip a byte inside the entry table -> different fingerprint, same size
    const mismatchedIdentity = computeResourceMapIdentity(mutated);
    expect(mismatchedIdentity.fingerprint).not.toBe(identity.fingerprint);

    const container = extractFromUi('sky\\space\\bitmaps\\star mask', 'bitmap');
    container.resourceMapIdentities = { bitmaps: identity };

    const noConfigPlan = planAddInjection(bgTagIndex, container, {});
    expect(noConfigPlan.kind).toBe('ok');
    if (noConfigPlan.kind === 'ok') expect(noConfigPlan.externalRefStatuses[0].status).toBe('unconfigured-on-target');

    const matchPlan = planAddInjection(bgTagIndex, container, { bitmaps: { identity } });
    expect(matchPlan.kind).toBe('ok');
    if (matchPlan.kind === 'ok') expect(matchPlan.externalRefStatuses[0].status).toBe('match');

    const mismatchPlan = planAddInjection(bgTagIndex, container, { bitmaps: { identity: mismatchedIdentity } });
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

    const plan = planAddInjection(bgTagIndex, container);
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
});
