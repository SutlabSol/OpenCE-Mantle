import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies, UNCERTAIN_GROUPS } from '../src/map/dependency-walker';
import { extractTagSet, verifyExtractedTagSet } from '../src/map/tag-extractor';
import { hasSampleMap, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

const haveBloodgulch = hasSampleMap('bloodgulch.map');
const suiteTitle = haveBloodgulch ? 'dependency walker + extraction (M4)' : `dependency walker + extraction (M4) [${missingSampleMapsMessage(['bloodgulch.map'])}]`;

describe.skipIf(!haveBloodgulch)(suiteTitle, () => {
  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let warthogIndex: number;
  let assaultRifleIndex: number;

  beforeAll(() => {
    buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    header = inspected.header;
    tagIndex = inspected.tagIndex;
    warthogIndex = tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\mp_warthog' && e.primaryClassName === 'vehicle')!.index;
    assaultRifleIndex = tagIndex.entries.find((e) => e.path === 'weapons\\assault rifle\\assault rifle' && e.primaryClassName === 'weapon')!.index;
  });

  it('walks the full dependency closure of a vehicle (warthog) with no crashes and sane warnings', () => {
    const walk = walkDependencies(buffer, header, tagIndex, [warthogIndex]);
    expect(walk.tags.length).toBeGreaterThan(5);
    expect(walk.tags.some((t) => t.group === 'vehicle')).toBe(true);
    expect(walk.tags.some((t) => t.group === 'gbxmodel')).toBe(true);
    // Every warning must reference a real kind and not crash the walk.
    for (const w of walk.warnings) {
      expect(['uncertainGroup', 'noDefinition', 'externalTag', 'externalData', 'embeddedRawData', 'bspTag']).toContain(w.kind);
    }
    // eslint-disable-next-line no-console
    console.log(`warthog closure: ${walk.tags.length} internal tags, ${walk.externalTags.length} external, ${walk.warnings.length} warnings`);
  });

  it('walks the full dependency closure of a weapon (assault rifle)', () => {
    const walk = walkDependencies(buffer, header, tagIndex, [assaultRifleIndex]);
    expect(walk.tags.length).toBeGreaterThan(3);
    expect(walk.tags.some((t) => t.group === 'weapon')).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`assault rifle closure: ${walk.tags.length} internal tags, ${walk.externalTags.length} external, ${walk.warnings.length} warnings`);
  });

  it('extracting the warthog produces a self-contained set where every pointer and reference resolves', () => {
    const set = extractTagSet(buffer, header, tagIndex, [warthogIndex]);
    expect(set.tags.length).toBeGreaterThan(5);
    const errors = verifyExtractedTagSet(set);
    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.log('warthog extraction errors:\n' + errors.join('\n'));
    }
    expect(errors).toEqual([]);
  });

  it('extracting the assault rifle produces a self-contained set where every pointer and reference resolves', () => {
    const set = extractTagSet(buffer, header, tagIndex, [assaultRifleIndex]);
    expect(set.tags.length).toBeGreaterThan(3);
    const errors = verifyExtractedTagSet(set);
    if (errors.length > 0) {
      // eslint-disable-next-line no-console
      console.log('assault rifle extraction errors:\n' + errors.join('\n'));
    }
    expect(errors).toEqual([]);
  });

  it('extracting both the warthog and the assault rifle together shares common dependencies in one set', () => {
    const set = extractTagSet(buffer, header, tagIndex, [warthogIndex, assaultRifleIndex]);
    const errors = verifyExtractedTagSet(set);
    expect(errors).toEqual([]);
    // Shared shader/bitmap/sound dependencies should be deduplicated (walker visits each tag once).
    const originalIndices = set.tags.map((t) => t.originalIndex);
    expect(new Set(originalIndices).size).toBe(originalIndices.length);
  });

  it('spheroid is never promoted - would be treated as an opaque blob with a warning if encountered', () => {
    expect(UNCERTAIN_GROUPS).toContain('spheroid');
  });
});
