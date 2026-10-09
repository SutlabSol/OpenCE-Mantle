import { describe, expect, it } from 'vitest';
import { compressCustomEditionMap, decompressCustomEditionMap } from '../src/map/compression';
import { isChimeraCompressedCustomEdition } from '../src/map/header';
import { CorruptMapError, NotCompressedMapError, UnsupportedMapVersionError } from '../src/map/errors';
import { buildFakeMap } from './fixtures/build-fake-map';

describe('compressCustomEditionMap / decompressCustomEditionMap', () => {
  it('round-trips a synthetic map byte-for-byte: decompress(compress(x)) === x', async () => {
    const original = buildFakeMap({
      scenarioName: 'roundtrip',
      tags: [
        { primaryClass: 'scnr', tagId: 1, path: 'levels\\test\\roundtrip\\roundtrip' },
        { primaryClass: 'matg', tagId: 2, path: 'globals\\globals' },
      ],
    });

    const compressed = await compressCustomEditionMap(original, 19);
    expect(isChimeraCompressedCustomEdition(compressed)).toBe(true);
    // Body should actually be smaller or at least present; header must stay 2048 bytes.
    expect(compressed.length).toBeGreaterThan(0x800);

    const decompressed = await decompressCustomEditionMap(compressed);
    expect(Buffer.compare(decompressed, original)).toBe(0);
  });

  it('a second decompress -> compress -> decompress cycle still matches exactly', async () => {
    const original = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 1, path: 'a\\b' }] });
    const c1 = await compressCustomEditionMap(original);
    const d1 = await decompressCustomEditionMap(c1);
    const c2 = await compressCustomEditionMap(d1);
    const d2 = await decompressCustomEditionMap(c2);
    expect(Buffer.compare(d1, original)).toBe(0);
    expect(Buffer.compare(d2, original)).toBe(0);
  });

  it('preserves every header field (scenario name, build, crc32, map type) through the round trip', async () => {
    const original = buildFakeMap({
      scenarioName: 'bloodgulch',
      buildString: '01.00.00.0609',
      crc32: 0x7b309554,
      tags: [{ primaryClass: 'scnr', tagId: 1, path: 'levels\\test\\bloodgulch\\bloodgulch' }],
    });
    const compressed = await compressCustomEditionMap(original);
    const decompressed = await decompressCustomEditionMap(compressed);
    expect(Buffer.compare(decompressed.subarray(0, 0x800).fill(0, 0x4, 0x8), original.subarray(0, 0x800).fill(0, 0x4, 0x8))).toBe(0);
  });

  it('rejects compressing an already-compressed map', async () => {
    const original = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 1, path: 'a' }], compressed: true });
    await expect(compressCustomEditionMap(original)).rejects.toThrow(UnsupportedMapVersionError);
  });

  it('rejects decompressing a map that is not compressed', async () => {
    const original = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 1, path: 'a' }] });
    await expect(decompressCustomEditionMap(original)).rejects.toThrow(NotCompressedMapError);
  });

  it('rejects decompressing a corrupt file', async () => {
    await expect(decompressCustomEditionMap(Buffer.alloc(10))).rejects.toThrow(CorruptMapError);
  });
});
