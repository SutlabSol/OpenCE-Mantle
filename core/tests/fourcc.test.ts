import { describe, expect, it } from 'vitest';
import { fourCCFromString, fourCCToString, lookupTagClass, TAG_CLASSES } from '../src/constants/tag-classes';

describe('FourCC helpers', () => {
  it('round-trips string -> number -> string', () => {
    for (const cls of TAG_CLASSES) {
      const value = fourCCFromString(cls.groupId);
      expect(fourCCToString(value)).toBe(cls.groupId);
    }
  });

  it('matches the known scenario tag class fourcc', () => {
    // 'scnr' = 0x73636E72 (big-endian ASCII reading, per Invader's TagFourCC convention)
    expect(fourCCFromString('scnr')).toBe(0x73636e72);
  });

  it('looks up a tag class by fourcc', () => {
    const info = lookupTagClass(fourCCFromString('bipd'));
    expect(info?.name).toBe('biped');
    expect(info?.parent).toBe('unit');
  });

  it('returns null for an unknown fourcc', () => {
    expect(lookupTagClass(0x00000000)).toBeNull();
  });
});
