import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet, verifyExtractedTagSet, AllTagsExcludedError } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, ContainerHasBspError, OCETAGS_MAGIC, OCETAGS_FORMAT_VERSION } from '../src/map/container';

const SAMPLE_DIR = '/app/sample_maps';
const haveBloodgulch = fs.existsSync(`${SAMPLE_DIR}/bloodgulch.map`);

describe.skipIf(!haveBloodgulch)('tag-extractor BSP guard + .ocetags container (M4)', () => {
  const buffer = fs.readFileSync(`${SAMPLE_DIR}/bloodgulch.map`);
  const inspected = inspectCustomEditionMap(buffer);
  if (inspected.status !== 'ok') throw new Error('sample map did not parse');
  const { header, tagIndex } = inspected;

  const scenarioIndex = tagIndex.entries.find((e) => e.primaryClassName === 'scenario')!.index;
  const bspIndex = tagIndex.entries.find((e) => e.primaryClassName === 'scenario_structure_bsp')!.index;
  const warthogIndex = tagIndex.entries.find((e) => e.path === 'vehicles\\warthog\\mp_warthog' && e.primaryClassName === 'vehicle')!.index;

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
