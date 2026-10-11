import { describe, expect, it } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer } from '../src/map/container';
import { planInjection } from '../src/map/tag-injector';
import { readSampleMap, skippableTest } from './helpers/sample-maps';

/**
 * A sound permutation whose samples word is 0x01000000 is internal (only bit 0 means external). Before
 * the fix, extracting one recorded it as an external sounds.map reference and ADD wrote it into the
 * target pointing at unrelated sounds.map bytes. Now its bytes are captured as embedded data, and ADD
 * blocks it while embedded relocation stays disabled.
 */
describe('sound samples word 0x01000000 is internal (extraction and ADD)', () => {
  const cases = [
    { map: 'coldsnap.map', path: 'sound\\sfx\\vehicles\\pelican_wind', permutations: 4 },
    { map: 'Yoyorast_Island.map', path: 'sound\\sfx\\impulse\\doors\\b30_door_open', permutations: 1 },
  ];
  for (const c of cases) {
    const gate = skippableTest([c.map, 'bloodgulch.map']);
    it.skipIf(gate.skip)(`${c.map} ${c.path}: ${c.permutations} embedded asset(s) captured, 0 external references; ADD into bloodgulch blocks it${gate.titleSuffix}`, () => {
      const source = readSampleMap(c.map);
      const src = inspectCustomEditionMap(source);
      if (src.status !== 'ok') throw new Error(src.status);
      const entry = src.tagIndex.entries.find((e) => e.path === c.path && e.primaryClassName === 'sound');
      if (!entry) throw new Error(`${c.path} not found in ${c.map}`);
      const set = extractTagSet(source, src.header, src.tagIndex, [entry.index]);
      expect(set.warnings.filter((w) => w.kind === 'externalData')).toHaveLength(0);
      expect(set.warnings.filter((w) => w.kind === 'embeddedRawData')).toHaveLength(c.permutations);
      expect(set.tags[0].embeddedRawDataAssets).toHaveLength(c.permutations);

      const targetBuffer = readSampleMap('bloodgulch.map');
      const target = inspectCustomEditionMap(targetBuffer);
      if (target.status !== 'ok') throw new Error(target.status);
      const plan = planInjection('add', { buffer: targetBuffer, header: target.header, tagIndex: target.tagIndex }, deserializeContainer(serializeContainer(set, c.map)));
      if (plan.kind !== 'ok') throw new Error(plan.reason);
      expect(plan.counts).toMatchObject({ added: 0, blockedEmbedded: 1, externalReferenced: 0 });
    });
  }
});
