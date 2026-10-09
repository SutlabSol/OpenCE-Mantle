import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet, verifyExtractedTagSet, AllTagsExcludedError } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, ContainerHasBspError, OCETAGS_MAGIC, OCETAGS_FORMAT_VERSION } from '../src/map/container';
import { hasSampleMap, readSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex } from '../src/map/tag-index';

const haveBloodgulch = hasSampleMap('bloodgulch.map');
const suiteTitle = haveBloodgulch
  ? 'tag-extractor BSP guard + .ocetags container (M4)'
  : `tag-extractor BSP guard + .ocetags container (M4) [${missingSampleMapsMessage(['bloodgulch.map'])}]`;

describe.skipIf(!haveBloodgulch)(suiteTitle, () => {
  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let scenarioIndex: number;
  let bspIndex: number;
  let warthogIndex: number;

  beforeAll(() => {
    buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    header = inspected.header;
    tagIndex = inspected.tagIndex;
    scenarioIndex = tagIndex.entries.find((e) => e.primaryClassName === 'scenario')!.index;
    bspIndex = tagIndex.entries.find((e) => e.primaryClassName === 'scenario_structure_bsp')!.index;
    warthogIndex = tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\mp_warthog' && e.primaryClassName === 'vehicle')!.index;
  });

  it('extracting the scenario excludes the BSP, reports it in notExtracted, and flags the container', () => {
    const set = extractTagSet(buffer, header, tagIndex, [scenarioIndex]);
    expect(set.tags.some((t) => t.group === 'scenario_structure_bsp')).toBe(false);
    expect(set.notExtracted.length).toBeGreaterThan(0);
    expect(set.notExtracted.some((t) => t.group === 'scenario_structure_bsp')).toBe(true);
    expect(set.notExtracted[0].reason).toContain('separate memory region');

    const errors = verifyExtractedTagSet(set);
    expect(errors).toEqual([]);

    const serialized = serializeContainer(set, 'bloodgulch');
    const container = deserializeContainer(serialized);
    expect(container.magic).toBe(OCETAGS_MAGIC);
    expect(container.formatVersion).toBe(OCETAGS_FORMAT_VERSION);
    expect(container.hasUnresolvedBspReferences).toBe(true);
    expect(container.tags.some((t) => t.group === 'scenario_structure_bsp')).toBe(false);
  });

  it('selecting a BSP directly throws AllTagsExcludedError and produces no tags to write', () => {
    expect(() => extractTagSet(buffer, header, tagIndex, [bspIndex])).toThrow(AllTagsExcludedError);
    try {
      extractTagSet(buffer, header, tagIndex, [bspIndex]);
    } catch (err) {
      expect(err).toBeInstanceOf(AllTagsExcludedError);
      expect((err as InstanceType<typeof AllTagsExcludedError>).notExtracted.length).toBeGreaterThan(0);
    }
  });

  it('a mixed selection (warthog + BSP) extracts the warthog and reports the BSP as not extracted', () => {
    const set = extractTagSet(buffer, header, tagIndex, [warthogIndex, bspIndex]);
    expect(set.tags.length).toBeGreaterThan(0);
    expect(set.tags.some((t) => t.group === 'vehicle')).toBe(true);
    expect(set.notExtracted.some((t) => t.originalIndex === bspIndex)).toBe(true);
  });

  it('a clean extraction (warthog) round-trips through serializeContainer/deserializeContainer', () => {
    const set = extractTagSet(buffer, header, tagIndex, [warthogIndex]);
    const container = deserializeContainer(serializeContainer(set, 'bloodgulch'));
    expect(container.tags.length).toBe(set.tags.length);
    expect(container.hasUnresolvedBspReferences).toBe(false);
  });

  it('deserializeContainer rejects a container that includes an sbsp tag', () => {
    const fake = {
      magic: OCETAGS_MAGIC,
      formatVersion: OCETAGS_FORMAT_VERSION,
      sourceMapName: 'bloodgulch',
      createdAt: new Date().toISOString(),
      hasUnresolvedBspReferences: false,
      rootOriginalIndices: [1],
      tags: [{ originalIndex: 1, group: 'scenario_structure_bsp', path: 'levels\\test\\bloodgulch\\bloodgulch', structName: 'ScenarioStructureBSP', data: '', dependencies: [] }],
      notExtracted: [],
      warnings: [],
    };
    const buf = Buffer.from(JSON.stringify(fake), 'utf-8');
    expect(() => deserializeContainer(buf)).toThrow(ContainerHasBspError);
  });
});
