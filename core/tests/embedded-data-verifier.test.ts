import { describe, it, expect } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { verifyEmbeddedData, formatEmbeddedDataReport, rangesOverlap } from '../src/map/embedded-data-verifier';
import type { EmbeddedDataReport } from '../src/map/embedded-data-verifier';
import type { CacheFileHeader } from '../src/map/header';
import type { TagIndex, TagIndexEntry } from '../src/map/tag-index';
import { hasSampleMaps, missingSampleMapsMessage, readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';

function fakeHeader(): CacheFileHeader {
  return { engine: 609, decompressedFileSize: 0, compressedPadding: 0, tagDataOffset: 0, tagDataSize: 0, scenarioName: 'x', buildString: 'x', mapType: 1, crc32: 0 };
}

function fakeTagIndex(entries: Partial<TagIndexEntry>[]): TagIndex {
  const full: TagIndexEntry[] = entries.map((e, i) => ({
    index: i,
    tagId: i,
    primaryClassFourCC: 0,
    secondaryClassFourCC: null,
    tertiaryClassFourCC: null,
    primaryClassName: null,
    path: `tag_${i}`,
    isExternal: false,
    tagDataPointerOrResourceIndex: 0,
    ...e,
  }));
  return { scenarioTagId: 0, tagChecksum: 0, tagCount: full.length, modelPartCount: 0, modelDataFileOffset: 0, vertexSize: 0, modelDataSize: 0, baseMemoryAddress: 0, entries: full };
}

describe('rangesOverlap', () => {
  it('detects overlapping, touching, and disjoint ranges correctly', () => {
    expect(rangesOverlap(0, 10, 5, 10)).toBe(true); // partial overlap
    expect(rangesOverlap(0, 10, 0, 10)).toBe(true); // identical
    expect(rangesOverlap(0, 10, 10, 10)).toBe(false); // touching at the boundary, not overlapping
    expect(rangesOverlap(0, 10, 11, 10)).toBe(false); // disjoint
    expect(rangesOverlap(5, 10, 0, 20)).toBe(true); // fully contained
  });
});

describe('verifyEmbeddedData - defensive/blocked paths (no real map needed, no binary layout faked)', () => {
  it('blocks a tag with an unrecognized class instead of guessing', () => {
    const tagIndex = fakeTagIndex([{ primaryClassName: 'totally_made_up_class', isExternal: false }]);
    const report = verifyEmbeddedData(Buffer.alloc(16), fakeHeader(), tagIndex);
    expect(report.totalBitmapSoundTags).toBe(0); // filtered out before counting - group must be bitmap/sound
    expect(report.blockedTags).toEqual([]);
  });

  it('blocks a bitmap/sound tag whose own struct resolves outside the file, instead of guessing', () => {
    const tagIndex = fakeTagIndex([{ primaryClassName: 'bitmap', isExternal: false, tagDataPointerOrResourceIndex: 100000, path: 'some\\bitmap' }]);
    const report = verifyEmbeddedData(Buffer.alloc(16), fakeHeader(), tagIndex);
    expect(report.totalBitmapSoundTags).toBe(1);
    expect(report.checkedTags).toBe(0);
    expect(report.blockedTags).toHaveLength(1);
    expect(report.blockedTags[0].tagPath).toBe('some\\bitmap');
    expect(report.blockedTags[0].reason).toMatch(/resolves outside this file/);
  });

  it('never checks a whole-tag-external entry (its data lives in a resource map, not this buffer)', () => {
    const tagIndex = fakeTagIndex([{ primaryClassName: 'bitmap', isExternal: true, path: 'some\\external_bitmap' }]);
    const report = verifyEmbeddedData(Buffer.alloc(16), fakeHeader(), tagIndex);
    expect(report.totalBitmapSoundTags).toBe(0);
    expect(report.assets).toEqual([]);
  });
});

describe('verifyEmbeddedData - real maps (map-agnostic: same code path for every map, no name/path/size branching)', () => {
  const maps = ['ui.map', 'bloodgulch.map', 'sidewinder.map'];
  const haveSamples = hasSampleMaps(maps);
  const suiteTitle = haveSamples ? 'checked against real sample maps' : `checked against real sample maps [${missingSampleMapsMessage(maps)}]`;

  (haveSamples ? describe : describe.skip)(suiteTitle, () => {
    it.each(maps)('%s: zero blocked tags, zero bounds/overlap/readability problems (consistent with earlier manual scans)', (mapName) => {
      const buffer = readSampleMap(mapName);
      const inspected = inspectCustomEditionMap(buffer);
      expect(inspected.status).toBe('ok');
      if (inspected.status !== 'ok') return;
      const report = verifyEmbeddedData(buffer, inspected.header, inspected.tagIndex);
      expect(report.blockedTags).toEqual([]);
      expect(report.counts.embeddedOutOfBounds).toBe(0);
      expect(report.counts.overlapping).toBe(0);
      expect(report.counts.unreadable).toBe(0);
      // None of the stock maps contain embedded (external=0) bitmap/sound data - see PRD.md.
      expect(report.counts.embedded).toBe(0);
    });
  });
});

describe('verifyEmbeddedData - coldsnap.map (a real custom map WITH embedded bitmap/sound data, unlike the stock maps above)', () => {
  const haveColdsnap = hasSampleMaps(['coldsnap.map']);
  const suiteTitle = haveColdsnap ? 'checked against coldsnap.map' : `checked against coldsnap.map [${missingSampleMapsMessage(['coldsnap.map'])}]`;

  (haveColdsnap ? describe : describe.skip)(suiteTitle, () => {
    it('reports 405 embedded, 0 external, 0 blocked, 0 bounds/overlap/readability problems (was 396 / 9 before the sound external-bit fix: 9 permutations with the word 0x01000000 are internal)', () => {
      const buffer = readSampleMap('coldsnap.map');
      const inspected = inspectCustomEditionMap(buffer);
      expect(inspected.status).toBe('ok');
      if (inspected.status !== 'ok') return;
      const report = verifyEmbeddedData(buffer, inspected.header, inspected.tagIndex);
      expect(report.blockedTags).toEqual([]);
      expect(report.counts.embeddedOutOfBounds).toBe(0);
      expect(report.counts.overlapping).toBe(0);
      expect(report.counts.unreadable).toBe(0);
      expect(report.counts.embedded).toBe(405);
      expect(report.counts.external).toBe(0);
    });
  });
});

/**
 * The sound external word: only bit 0 means external. If that rule is right, a map's embedded ranges
 * fill its raw-data region [last BSP end, model data offset) exactly, back to back. The region bounds
 * come from raw bytes (header, tag data header, scenario "structure bsps"); the asset list comes from
 * the verifier, so this shares the schema engine for finding the assets.
 */
describe('embedded ranges tile the raw-data region (sound external word: bit 0 only)', () => {
  const SCENARIO_STRUCTURE_BSPS = 0x5a4;
  const BASE = 0x40440000;
  const cases = [
    { name: 'coldsnap.map', embedded: 405, external: 0 },
    { name: 'Yoyorast_Island.map', embedded: 148, external: 0 },
    { name: sampleIn('haloMD', 'barrier.map'), embedded: 101, external: 1551 },
    { name: sampleIn('haloMD', 'crossing.map'), embedded: 77, external: 1553 },
  ];
  for (const c of cases) {
    const gate = skippableTest([c.name]);
    it.skipIf(gate.skip)(`${c.name}: ${c.embedded} embedded, ${c.external} external; embedded ranges fill [BSP end, model data) with no gap or overlap${gate.titleSuffix}`, () => {
      // HaloMD maps are retail layout (version 7): read a private copy marked 609, as the converter does.
      const buffer = Buffer.from(readSampleMap(c.name));
      if (buffer.readUInt32LE(4) === 7) buffer.writeUInt32LE(609, 4);
      const inspected = inspectCustomEditionMap(buffer);
      if (inspected.status !== 'ok') throw new Error(inspected.status);
      const report = verifyEmbeddedData(buffer, inspected.header, inspected.tagIndex);
      expect(report.counts.embedded).toBe(c.embedded);
      expect(report.counts.external).toBe(c.external);

      const tagData = buffer.readUInt32LE(0x10);
      const scenarioEntry = tagData + 0x28 + (buffer.readUInt32LE(tagData + 0x4) & 0xffff) * 0x20;
      const scenarioAt = tagData + (buffer.readUInt32LE(scenarioEntry + 0x14) - BASE);
      const bspCount = buffer.readUInt32LE(scenarioAt + SCENARIO_STRUCTURE_BSPS);
      const bspsAt = tagData + (buffer.readUInt32LE(scenarioAt + SCENARIO_STRUCTURE_BSPS + 4) - BASE);
      let bspEnd = 0;
      for (let i = 0; i < bspCount; i++) bspEnd = Math.max(bspEnd, buffer.readUInt32LE(bspsAt + i * 32) + buffer.readUInt32LE(bspsAt + i * 32 + 4));
      const modelData = buffer.readUInt32LE(tagData + 0x14);

      const ranges = report.assets.filter((a) => a.location === 'embedded').map((a) => [a.fileOffset, a.size] as const).sort((a, b) => a[0] - b[0]);
      let at = bspEnd;
      for (const [offset, size] of ranges) {
        expect(offset).toBe(at);
        at = offset + size;
      }
      expect(at).toBe(modelData);
    });
  }
});

describe('formatEmbeddedDataReport', () => {
  function baseReport(overrides: Partial<EmbeddedDataReport> = {}): EmbeddedDataReport {
    return {
      totalBitmapSoundTags: 0,
      checkedTags: 0,
      blockedTags: [],
      assets: [],
      counts: { embedded: 0, external: 0, embeddedInBounds: 0, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 },
      ...overrides,
    };
  }

  it('says there is no embedded data when counts.embedded is 0', () => {
    const text = formatEmbeddedDataReport(baseReport(), 'ui.map');
    expect(text).toContain('"ui.map"');
    expect(text).toContain('No embedded (external=0) bitmap/sound data in this map');
  });

  it('lists blocked tags with path, group, and reason', () => {
    const report = baseReport({ blockedTags: [{ tagPath: 'weapons\\x', group: 'bitmap', reason: 'Unrecognized tag class.' }], counts: { ...baseReport().counts, blockedTags: 1 } });
    const text = formatEmbeddedDataReport(report, 'custom.map');
    expect(text).toContain('BLOCKED (unrecognized layout - not guessed):');
    expect(text).toContain('"weapons\\x" (bitmap) - Unrecognized tag class.');
  });

  it('lists out-of-bounds, overlapping, and unreadable assets as problems, each with path/field/location/offset', () => {
    const report = baseReport({
      checkedTags: 1,
      counts: { embedded: 2, external: 0, embeddedInBounds: 0, embeddedOutOfBounds: 1, overlapping: 2, unreadable: 1, blockedTags: 0 },
      assets: [
        { tagPath: 'a\\bitmap', group: 'bitmap', fieldPath: 'bitmap data[0].pixel data', location: 'embedded', fileOffset: 999999, size: 128, inBounds: false, overlapsWith: [], readable: false },
        { tagPath: 'b\\bitmap', group: 'bitmap', fieldPath: 'bitmap data[0].pixel data', location: 'embedded', fileOffset: 10, size: 128, inBounds: true, overlapsWith: ['c\\bitmap bitmap data[0].pixel data'], readable: true },
      ],
    });
    const text = formatEmbeddedDataReport(report, 'custom.map');
    expect(text).toContain('PROBLEMS FOUND:');
    expect(text).toContain('"a\\bitmap" bitmap data[0].pixel data (embedded, offset 999999, 128 bytes) - OUT OF BOUNDS; UNREADABLE');
    expect(text).toContain('"b\\bitmap" bitmap data[0].pixel data (embedded, offset 10, 128 bytes) - overlaps with: c\\bitmap bitmap data[0].pixel data');
  });

  it('says no problems were found when everything checked out clean', () => {
    const report = baseReport({
      checkedTags: 1,
      counts: { embedded: 1, external: 0, embeddedInBounds: 1, embeddedOutOfBounds: 0, overlapping: 0, unreadable: 0, blockedTags: 0 },
      assets: [{ tagPath: 'a\\bitmap', group: 'bitmap', fieldPath: 'bitmap data[0].pixel data', location: 'embedded', fileOffset: 10, size: 128, inBounds: true, overlapsWith: [], readable: true }],
    });
    const text = formatEmbeddedDataReport(report, 'custom.map');
    expect(text).toContain('No bounds, overlap, or readability problems found among the checked assets.');
    expect(text).not.toContain('PROBLEMS FOUND');
  });
});
