import { describe, expect, it } from 'vitest';
import { CacheFileEngine } from '../src/constants/cache-file';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { buildFakeMap } from './fixtures/build-fake-map';

describe('inspectCustomEditionMap', () => {
  it('returns status "ok" with full header + tag index for a valid map', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a\\b' }] });
    const result = inspectCustomEditionMap(buffer);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.header.engine).toBeDefined();
      expect(result.tagIndex.entries).toHaveLength(1);
    }
  });

  it('returns status "compressed" for a Chimera-compressed map, without throwing', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }], compressed: true });
    const result = inspectCustomEditionMap(buffer);
    expect(result.status).toBe('compressed');
  });

  it('returns status "ok" for a retail (version 7) map', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    buffer.writeUInt32LE(CacheFileEngine.RETAIL, 0x4);
    const result = inspectCustomEditionMap(buffer);
    expect(result.status).toBe('ok');
  });

  it('returns status "ok" for an MCC (version 13) map', () => {
    const buffer = buildFakeMap({ engine: CacheFileEngine.MCC_CEA, tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    const result = inspectCustomEditionMap(buffer);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.header.engine).toBe(CacheFileEngine.MCC_CEA);
      expect(result.tagIndex.entries).toHaveLength(1);
    }
  });

  it('returns status "unsupported" with a friendly message for an Xbox map', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    buffer.writeUInt32LE(CacheFileEngine.XBOX, 0x4);
    const result = inspectCustomEditionMap(buffer);
    expect(result.status).toBe('unsupported');
    if (result.status === 'unsupported') {
      expect(result.message).toMatch(/Xbox/);
    }
  });
});
