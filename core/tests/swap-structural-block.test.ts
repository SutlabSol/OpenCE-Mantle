import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies, UNCERTAIN_GROUPS } from '../src/map/dependency-walker';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { planAddInjection, planSwapInjection } from '../src/map/tag-injector';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';
import { hasSampleMap, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

/**
 * Regression for a pre-existing gap found during the reflexive-bounds work: SWAP never consulted
 * `uncapturedData`, so a tag whose data the container cannot carry (e.g. model geometry) was
 * planned as SWAPPED into a map that already had it. SWAP now uses the same structural block as
 * ADD. The tag is chosen by its own walker warning (first tag in the map whose walk emits
 * `uncapturedData` for itself), never by path. Same-reader: the warning comes from our own walker.
 */
const MAP = 'bloodgulch.map';
const have = hasSampleMap(MAP);

describe.skipIf(!have)(have ? 'SWAP blocks uncapturedData tags (same as ADD)' : `SWAP blocks uncapturedData tags [${missingSampleMapsMessage([MAP])}]`, () => {
  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let index: number;

  beforeAll(() => {
    buffer = readSampleMap(MAP);
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error(`${MAP} did not parse`);
    ({ header, tagIndex } = inspected);
    const roots = tagIndex.entries.filter((e) => !e.isExternal).map((e) => e.index);
    const walk = walkDependencies(buffer, header, tagIndex, roots);
    index = walk.warnings.find((w) => w.kind === 'uncapturedData')!.originalIndex;
  });

  it('a tag with uncapturedData is blocked from SWAP into a map that already has it, from a saved-and-reloaded container', () => {
    const set = extractTagSet(buffer, header, tagIndex, [index]);
    expect(set.warnings.some((w) => w.kind === 'uncapturedData' && w.originalIndex === index)).toBe(true);
    const container = deserializeContainer(serializeContainer(set, 'src'));
    const plan = planSwapInjection(tagIndex, container);
    if (plan.kind !== 'ok') throw new Error(`plan refused: ${plan.reason}`);
    const li = container.tags.findIndex((t) => t.originalIndex === index);
    expect(plan.toSwap.some((s) => s.localIndex === li)).toBe(false);
    const blocked = plan.blockedOther.find((b) => b.localIndex === li);
    expect(blocked).toBeDefined();
    expect(blocked!.reasons.join(' ')).toContain('cannot be captured or relocated');
    expect(plan.reusedByLocalIndex.has(li)).toBe(true); // falls back to leaving the target's own tag untouched
  });
});

/**
 * `uncertainGroup` (UNCERTAIN_GROUPS = spheroid only) blocks ADD and SWAP. No sample map contains a
 * spheroid tag, so this is SYNTHETIC: an in-memory tag-index copy relabels one real tag's class as
 * "spheroid" (a single 4-byte field, no reflexives, so extracting the real bytes under that layout
 * is safe). The tag is the first non-external tag in the map, never chosen by path. Same-reader.
 */
describe.skipIf(!have)(have ? 'uncertainGroup is blocked in ADD and SWAP (synthetic spheroid relabel)' : `uncertainGroup block [${missingSampleMapsMessage([MAP])}]`, () => {
  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let relabelled: TagIndex;
  let index: number;

  beforeAll(() => {
    buffer = readSampleMap(MAP);
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error(`${MAP} did not parse`);
    ({ header, tagIndex } = inspected);
    expect(UNCERTAIN_GROUPS).toEqual(['spheroid']); // if this list grows, revisit this test and the block
    index = tagIndex.entries.find((e) => !e.isExternal)!.index;
    relabelled = { ...tagIndex, entries: tagIndex.entries.map((e) => (e.index === index ? { ...e, primaryClassName: 'spheroid' } : e)) };
  });

  function extractRelabelled() {
    const set = extractTagSet(buffer, header, relabelled, [index]);
    expect(set.warnings.some((w) => w.kind === 'uncertainGroup' && w.originalIndex === index)).toBe(true);
    const container = deserializeContainer(serializeContainer(set, 'src'));
    return { container, li: container.tags.findIndex((t) => t.originalIndex === index) };
  }

  it('ADD: blocked (target has the path, but not as a spheroid, so it is an add candidate)', () => {
    const { container, li } = extractRelabelled();
    expect(li).toBeGreaterThanOrEqual(0);
    const plan = planAddInjection(tagIndex, container);
    if (plan.kind !== 'ok') throw new Error(`plan refused: ${plan.reason}`);
    expect(plan.toAddLocalIndices).not.toContain(li);
    expect(plan.blockedOther.find((b) => b.localIndex === li)?.reasons.join(' ')).toContain('no reliable field layout');
  });

  it('SWAP: blocked (target has the same path as a spheroid, so it is a swap candidate)', () => {
    const { container, li } = extractRelabelled();
    const plan = planSwapInjection(relabelled, container);
    if (plan.kind !== 'ok') throw new Error(`plan refused: ${plan.reason}`);
    expect(plan.toSwap.some((s) => s.localIndex === li)).toBe(false);
    expect(plan.blockedOther.find((b) => b.localIndex === li)?.reasons.join(' ')).toContain('no reliable field layout');
    expect(plan.reusedByLocalIndex.has(li)).toBe(true);
  });
});
