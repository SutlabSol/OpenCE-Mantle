import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { serializeContainer, deserializeContainer, OCETAGS_MAGIC, OCETAGS_FORMAT_VERSION, ContainerFormatError } from '../src/map/container';
import { extractTagSet } from '../src/map/tag-extractor';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { computeResourceMapIdentity } from '../src/map/resource-map';
import { readSampleMap, skippableTest } from './helpers/sample-maps';

/**
 * Each test is gated individually on exactly the sample file(s) IT needs (not a blanket
 * describe-level skip) - the first two tests need no sample map at all and must always run,
 * even if none of bloodgulch.map/ui.map/bitmaps.map are present.
 */
describe('.ocetags container v2', () => {
  it('reads a real v1 fixture file (no secondaryClassFourCC/resourceMapIdentities/externalResourceRefs fields) without error', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'v1-warthog.ocetags');
    const buf = fs.readFileSync(fixturePath);
    const parsedRaw = JSON.parse(buf.toString('utf-8'));
    expect(parsedRaw.formatVersion).toBe(1);
    expect(parsedRaw.tags[0].secondaryClassFourCC).toBeUndefined();

    const container = deserializeContainer(buf);
    expect(container.magic).toBe(OCETAGS_MAGIC);
    expect(container.formatVersion).toBe(1);
    expect(container.resourceMapIdentities).toEqual({});
    expect(container.externalResourceRefs).toEqual([]);
    expect(container.externalData).toBe('referenced');
    expect(container.tags.length).toBeGreaterThan(0);
  });

  it('rejects a container newer than this build supports, with a plain-language message', () => {
    const fake = {
      magic: OCETAGS_MAGIC,
      formatVersion: OCETAGS_FORMAT_VERSION + 1,
      sourceMapName: 'x',
      createdAt: new Date().toISOString(),
      hasUnresolvedBspReferences: false,
      rootOriginalIndices: [],
      tags: [],
      notExtracted: [],
      warnings: [],
    };
    expect(() => deserializeContainer(Buffer.from(JSON.stringify(fake)))).toThrow(ContainerFormatError);
    try {
      deserializeContainer(Buffer.from(JSON.stringify(fake)));
    } catch (e) {
      expect((e as Error).message).toContain('newer version of OpenCE');
    }
  });

  const roundTrip = skippableTest(['bloodgulch.map']);
  it.skipIf(roundTrip.skip)(`v2 round-trips secondaryClassFourCC/externalResourceRefs/resourceMapIdentities through serialize+deserialize${roundTrip.titleSuffix}`, () => {
    const buffer = readSampleMap('bloodgulch.map');
    const inspected = inspectCustomEditionMap(buffer);
    if (inspected.status !== 'ok') throw new Error('sample map did not parse');
    const shaderEntry = inspected.tagIndex.entries.find((e) => e.primaryClassName === 'shader_transparent_chicago' && e.secondaryClassFourCC !== null)!;
    expect(shaderEntry).toBeDefined();
    const set = extractTagSet(buffer, inspected.header, inspected.tagIndex, [shaderEntry.index]);
    const container = deserializeContainer(serializeContainer(set, 'bloodgulch'));
    expect(container.tags[0].secondaryClassFourCC).not.toBeNull();
    expect(container.tags[0].secondaryClassFourCC).toBe(shaderEntry.secondaryClassFourCC);
  });

  const refStatus = skippableTest(['ui.map', 'bitmaps.map']);
  it.skipIf(refStatus.skip)(
    `records externalResourceRefs as "unverified" when no resource map was configured at extraction time, and "verified" when one was${refStatus.titleSuffix}`,
    () => {
      const uiBuf = readSampleMap('ui.map');
      const inspected = inspectCustomEditionMap(uiBuf);
      if (inspected.status !== 'ok') throw new Error('ui.map did not parse');
      const bitmapEntry = inspected.tagIndex.entries.find((e) => e.path === 'sky\\space\\bitmaps\\star mask' && e.primaryClassName === 'bitmap')!;
      const set = extractTagSet(uiBuf, inspected.header, inspected.tagIndex, [bitmapEntry.index]);

      const unverified = deserializeContainer(serializeContainer(set, 'ui'));
      expect(unverified.externalResourceRefs.length).toBeGreaterThan(0);
      expect(unverified.externalResourceRefs[0].status).toBe('unverified');
      expect(unverified.resourceMapIdentities.bitmaps).toBeUndefined();

      const bitmapsBuf = readSampleMap('bitmaps.map');
      const identity = computeResourceMapIdentity(bitmapsBuf);
      const verified = deserializeContainer(serializeContainer(set, 'ui', { bitmaps: identity }));
      expect(verified.externalResourceRefs[0].status).toBe('verified');
      expect(verified.resourceMapIdentities.bitmaps?.fingerprint).toBe(identity.fingerprint);
    },
  );
});
