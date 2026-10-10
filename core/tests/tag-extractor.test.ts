import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { extractTagSet, verifyExtractedTagSet, AllTagsExcludedError } from '../src/map/tag-extractor';
import { serializeContainer, deserializeContainer, ContainerHasBspError, OCETAGS_MAGIC, OCETAGS_FORMAT_VERSION } from '../src/map/container';
import { resolveTagDataPointer } from '../src/map/tag-index';
import { resolveStruct, decodeStruct, resolvePointer } from '../src/map/definitions/engine';
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

  it('a tag with no embedded bitmap/sound data gets empty embeddedRawDataAssets/Patches (v3 fields always present)', () => {
    const set = extractTagSet(buffer, header, tagIndex, [warthogIndex]);
    for (const t of set.tags) {
      expect(t.embeddedRawDataAssets).toEqual([]);
      expect(t.embeddedRawDataPatches).toEqual([]);
    }
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

const haveColdsnap = hasSampleMap('coldsnap.map');
const captureSuiteTitle = haveColdsnap
  ? 'tag-extractor embedded (external=0) bitmap/sound capture (M5 relocation research)'
  : `tag-extractor embedded (external=0) bitmap/sound capture (M5 relocation research) [${missingSampleMapsMessage(['coldsnap.map'])}]`;

describe.skipIf(!haveColdsnap)(captureSuiteTitle, () => {
  let buffer: Buffer;
  let header: CacheFileHeader;
  let tagIndex: TagIndex;
  let bitmapIndex: number;
  let soundIndex: number;

  beforeAll(() => {
    buffer = readSampleMap('coldsnap.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    header = inspected.header;
    tagIndex = inspected.tagIndex;
    bitmapIndex = tagIndex.entries.find((e) => e.path === 'player\\hud\\bitmaps\\waypoints' && e.primaryClassName === 'bitmap')!.index;
    soundIndex = tagIndex.entries.find((e) => e.path === 'weapons\\sphere\\sounds\\expl' && e.primaryClassName === 'sound')!.index;
  });

  it('captures embedded bitmap pixel bytes exactly as sliced from the source map, with a patch offset that resolves inside the tag', () => {
    const set = extractTagSet(buffer, header, tagIndex, [bitmapIndex]);
    const tag = set.tags.find((t) => t.originalIndex === bitmapIndex)!;
    expect(tag.embeddedRawDataAssets.length).toBeGreaterThan(0);
    expect(tag.embeddedRawDataPatches.length).toBeGreaterThanOrEqual(tag.embeddedRawDataAssets.length);
    for (const patch of tag.embeddedRawDataPatches) {
      expect(patch.patchOffset).toBeGreaterThanOrEqual(0);
      expect(patch.patchOffset + patch.patchWidth).toBeLessThanOrEqual(tag.data.length);
      expect(patch.assetIndex).toBeLessThan(tag.embeddedRawDataAssets.length);
    }
    for (const asset of tag.embeddedRawDataAssets) {
      expect(asset.kind).toBe('bitmap');
      expect(asset.data.length).toBeGreaterThan(0);
    }

    const warn = set.warnings.find((w) => w.originalIndex === bitmapIndex && w.kind === 'embeddedRawData');
    expect(warn).toBeDefined(); // the walker's own "embedded, outside this tag's struct bytes" flag - still emitted alongside the capture
  });

  it('captures embedded sound sample bytes exactly as sliced from the source map', () => {
    const set = extractTagSet(buffer, header, tagIndex, [soundIndex]);
    const tag = set.tags.find((t) => t.originalIndex === soundIndex)!;
    expect(tag.embeddedRawDataAssets.length).toBeGreaterThan(0);
    expect(tag.embeddedRawDataAssets.every((a) => a.kind === 'sound')).toBe(true);
  });

  it('round-trips through the v3 container: assets/patches survive base64 serialize/deserialize', () => {
    const set = extractTagSet(buffer, header, tagIndex, [bitmapIndex]);
    const tag = set.tags.find((t) => t.originalIndex === bitmapIndex)!;
    const container = deserializeContainer(serializeContainer(set, 'coldsnap'));
    const containerTag = container.tags.find((t) => t.originalIndex === bitmapIndex)!;
    expect(container.formatVersion).toBe(OCETAGS_FORMAT_VERSION); // assets/patches were added in v3; still carried by every later version
    expect(containerTag.embeddedRawDataAssets?.length).toBe(tag.embeddedRawDataAssets.length);
    expect(containerTag.embeddedRawDataPatches).toEqual(tag.embeddedRawDataPatches);
    for (let i = 0; i < tag.embeddedRawDataAssets.length; i++) {
      expect(Buffer.from(containerTag.embeddedRawDataAssets![i].data, 'base64').equals(tag.embeddedRawDataAssets[i].data)).toBe(true);
    }
  });

  it('a bitmap pixel-data size that does not match width/height/format/mipmaps blocks the WHOLE tag (never a partial relocation), with a clear warning', () => {
    const structName = 'Bitmap';
    const fileOffset = resolveTagDataPointer(tagIndex.entries[bitmapIndex].tagDataPointerOrResourceIndex, header, tagIndex.baseMemoryAddress);
    const resolved = resolveStruct(structName);
    const decoded = decodeStruct(buffer, fileOffset, structName);
    const bitmapDataField = decoded.get('bitmap data');
    if (!bitmapDataField || bitmapDataField.kind !== 'reflexive' || bitmapDataField.value.count === 0) throw new Error('fixture has no BitmapData entries');
    const childStructName = 'BitmapData';
    const childSize = resolveStruct(childStructName).totalSize;
    const childBase = resolvePointer(bitmapDataField.value.pointerLow, header.tagDataOffset, tagIndex.baseMemoryAddress);
    const firstChildResolved = resolveStruct(childStructName);
    const sizeField = firstChildResolved.fields.find((f) => f.name === 'pixel data size')!;
    const sizeFieldAbsoluteOffset = childBase + sizeField.offset;

    const corrupted = Buffer.from(buffer);
    corrupted.writeUInt32LE(corrupted.readUInt32LE(sizeFieldAbsoluteOffset) + 4, sizeFieldAbsoluteOffset); // plausible-looking, but wrong

    const set = extractTagSet(corrupted, header, tagIndex, [bitmapIndex]);
    const tag = set.tags.find((t) => t.originalIndex === bitmapIndex)!;
    expect(tag.embeddedRawDataAssets).toEqual([]);
    expect(tag.embeddedRawDataPatches).toEqual([]);
    const warn = set.warnings.find((w) => w.originalIndex === bitmapIndex && w.message.includes('could not be safely captured'));
    expect(warn).toBeDefined();
    expect(warn!.message).toContain('expected');
  });

  it('a v1/v2 container (no embeddedRawDataAssets field at all) still parses and reads as empty/undefined, never throws', () => {
    const fakeV1 = {
      magic: OCETAGS_MAGIC,
      formatVersion: 1,
      sourceMapName: 'coldsnap',
      createdAt: new Date().toISOString(),
      hasUnresolvedBspReferences: false,
      rootOriginalIndices: [bitmapIndex],
      tags: [{ originalIndex: bitmapIndex, group: 'bitmap', path: 'player\\hud\\bitmaps\\waypoints', structName: 'Bitmap', data: Buffer.alloc(4).toString('base64'), dependencies: [] }],
      notExtracted: [],
      warnings: [],
    };
    const container = deserializeContainer(Buffer.from(JSON.stringify(fakeV1), 'utf-8'));
    expect(container.tags[0].embeddedRawDataAssets).toBeUndefined();
    expect(container.tags[0].embeddedRawDataPatches).toBeUndefined();
  });
});
