import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { walkDependencies, UNCERTAIN_GROUPS } from '../src/map/dependency-walker';
import { extractTagSet, verifyExtractedTagSet } from '../src/map/tag-extractor';

const SAMPLE_DIR = '/app/sample_maps';
const haveBloodgulch = fs.existsSync(`${SAMPLE_DIR}/bloodgulch.map`);

describe.skipIf(!haveBloodgulch)('dependency walker + extraction (M4)', () => {
  const buffer = fs.readFileSync(`${SAMPLE_DIR}/bloodgulch.map`);
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') throw new Error('sample map did not parse');
  const { header, tagIndex } = inspected;

  const warthogIndex = tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\mp_warthog' && e.primaryClassName === 'vehicle')!.index;
  const assaultRifleIndex = tagIndex.entries.find((e) => e.path === 'weapons\\assault rifle\\assault rifle' && e.primaryClassName === 'weapon')!.index;

  it('walks the full dependency closure of a vehicle (warthog) with no crashes and sane warnings', () => {
    const walk = walkDependencies(buffer, header, tagIndex, [warthogIndex]);
    expect(walk.tags.length).toBeGreaterThan(5);
    expect(walk.tags.some((t) => t.group === 'vehicle')).toBe(true);
    expect(walk.tags.some((t) => t.group === 'gbxmodel')).toBe(true);
    // Every warning must reference a real kind and not crash the walk.
    for (const w of walk.warnings) {
      expect(['uncertainGroup', 'noDefinition', 'externalTag', 'externalData', 'bspTag']).toContain(w.kind);
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
