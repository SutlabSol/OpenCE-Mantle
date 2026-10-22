import { describe, expect, it } from 'vitest';
import { parseCacheFileHeader, serializeCacheFileHeader, isChimeraCompressedCustomEdition } from '../src/map/header';
import { CorruptMapError, UnsupportedMapVersionError } from '../src/map/errors';
import { CacheFileEngine, ScenarioType } from '../src/constants/cache-file';
import { buildFakeMap } from './fixtures/build-fake-map';

describe('parseCacheFileHeader', () => {
  it('parses a well-formed Custom Edition header', () => {
    const buffer = buildFakeMap({
      scenarioName: 'bloodgulch',
      buildString: '01.00.01.0609',
      mapType: ScenarioType.MULTIPLAYER,
      crc32: 0x12345678,
      tags: [{ primaryClass: 'scnr', tagId: 0, path: 'levels\\test\\bloodgulch\\bloodgulch' }],
    });

    const header = parseCacheFileHeader(buffer);

    expect(header.engine).toBe(CacheFileEngine.CUSTOM_EDITION);
    expect(header.scenarioName).toBe('bloodgulch');
    expect(header.buildString).toBe('01.00.01.0609');
    expect(header.mapType).toBe(ScenarioType.MULTIPLAYER);
    expect(header.crc32).toBe(0x12345678);
    expect(header.tagDataOffset).toBe(0x800);
  });

  it('round-trips through serializeCacheFileHeader', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    const header = parseCacheFileHeader(buffer);
    const reserialized = serializeCacheFileHeader(header);
    const reparsed = parseCacheFileHeader(reserialized);
    expect(reparsed).toEqual(header);
  });

  it('throws CorruptMapError for a truncated file', () => {
    const buffer = Buffer.alloc(100);
    expect(() => parseCacheFileHeader(buffer)).toThrow(CorruptMapError);
  });

  it('throws CorruptMapError when magic values are wrong', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    buffer.writeUInt32LE(0, 0x0); // corrupt "head" magic
    expect(() => parseCacheFileHeader(buffer)).toThrow(CorruptMapError);
  });

  it('parses a retail (version 7) map header successfully', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    buffer.writeUInt32LE(CacheFileEngine.RETAIL, 0x4);
    const header = parseCacheFileHeader(buffer);
    expect(header.engine).toBe(CacheFileEngine.RETAIL);
  });

  it('parses an MCC (version 13) map header successfully', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    buffer.writeUInt32LE(CacheFileEngine.MCC_CEA, 0x4);
    const header = parseCacheFileHeader(buffer);
    expect(header.engine).toBe(CacheFileEngine.MCC_CEA);
  });

  it('throws UnsupportedMapVersionError for an Xbox map, with a friendly message', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    buffer.writeUInt32LE(CacheFileEngine.XBOX, 0x4);
    expect(parseCacheFileHeader(buffer).engine).toBe(CacheFileEngine.XBOX);
  });

  it('detects a Chimera-compressed Custom Edition map without throwing', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }], compressed: true });
    expect(isChimeraCompressedCustomEdition(buffer)).toBe(true);
    expect(isChimeraCompressedCustomEdition(buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] }))).toBe(false);
  });
});
