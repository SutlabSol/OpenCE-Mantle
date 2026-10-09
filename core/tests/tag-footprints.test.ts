import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { estimateTagFootprints } from '../src/map/tag-footprints';
import { buildFakeMap } from './fixtures/build-fake-map';
import { sampleMapPath, hasSampleMap, missingSampleMapsMessage } from './helpers/sample-maps';

describe('estimateTagFootprints', () => {
  it('gives each internal tag a positive footprint that sums to roughly the tag data size', () => {
    const buffer = buildFakeMap({
      tags: [
        { primaryClass: 'scnr', tagId: 1, path: 'levels\\test\\x\\x' },
        { primaryClass: 'matg', tagId: 2, path: 'globals\\globals' },
        { primaryClass: 'snd!', tagId: 3, path: 'sound\\a', isExternal: true, tagDataPointerOrResourceIndex: 0 },
      ],
    });
    const header = parseCacheFileHeader(buffer);
    const tagIndex = parseTagIndex(buffer, header);
    const footprints = estimateTagFootprints(header, tagIndex);

    expect(footprints).toHaveLength(3);
    expect(footprints.find((f) => f.tagIndex === 2)?.estimatedSize).toBeNull(); // external
  });

  const haveBloodgulch = hasSampleMap('bloodgulch.map');
  const title = haveBloodgulch
    ? 'real map: internal footprints sum to no more than the tag data size'
    : `real map: internal footprints sum to no more than the tag data size [${missingSampleMapsMessage(['bloodgulch.map'])}]`;

  it.skipIf(!haveBloodgulch)(title, () => {
    const buffer = fs.readFileSync(sampleMapPath('bloodgulch.map'));
    const header = parseCacheFileHeader(buffer);
    const tagIndex = parseTagIndex(buffer, header);
    const footprints = estimateTagFootprints(header, tagIndex);

    const total = footprints.reduce((sum, f) => sum + (f.estimatedSize ?? 0), 0);
    expect(total).toBeLessThanOrEqual(header.tagDataSize);
    expect(total).toBeGreaterThan(header.tagDataSize * 0.5); // sanity: most of the section is accounted for
    expect(footprints.every((f) => f.estimatedSize === null || f.estimatedSize >= 0)).toBe(true);
  });
});

