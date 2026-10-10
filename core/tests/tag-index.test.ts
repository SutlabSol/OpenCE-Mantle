import { describe, expect, it } from 'vitest';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex, inferBaseMemoryAddressForClassifier } from '../src/map/tag-index';
import { CorruptMapError, UnexpectedTagArrayAddressError } from '../src/map/errors';
import { buildFakeMap } from './fixtures/build-fake-map';

describe('parseTagIndex', () => {
  it('parses multiple tags with correct classes, ids, and paths', () => {
    const buffer = buildFakeMap({
      scenarioTagId: 0xffff0000,
      tags: [
        { primaryClass: 'scnr', tagId: 0xffff0000, path: 'levels\\test\\bloodgulch\\bloodgulch' },
        { primaryClass: 'matg', tagId: 0xffff0001, path: 'globals\\globals' },
        { primaryClass: 'snd!', tagId: 0xffff0002, path: 'sound\\sfx\\weapons\\pistol\\fire', isExternal: true, tagDataPointerOrResourceIndex: 42 },
        { primaryClass: 'mod2', secondaryClass: null, tagId: 0xffff0003, path: 'vehicles\\warthog\\warthog' },
      ],
    });

    const header = parseCacheFileHeader(buffer);
    const tagIndex = parseTagIndex(buffer, header);

    expect(tagIndex.tagCount).toBe(4);
    expect(tagIndex.scenarioTagId).toBe(0xffff0000);
    expect(tagIndex.entries).toHaveLength(4);

    expect(tagIndex.entries[0].primaryClassName).toBe('scenario');
    expect(tagIndex.entries[0].path).toBe('levels\\test\\bloodgulch\\bloodgulch');
    expect(tagIndex.entries[0].isExternal).toBe(false);

    expect(tagIndex.entries[1].primaryClassName).toBe('globals');
    expect(tagIndex.entries[1].path).toBe('globals\\globals');

    expect(tagIndex.entries[2].primaryClassName).toBe('sound');
    expect(tagIndex.entries[2].isExternal).toBe(true);
    expect(tagIndex.entries[2].tagDataPointerOrResourceIndex).toBe(42);

    expect(tagIndex.entries[3].primaryClassName).toBe('gbxmodel');
    expect(tagIndex.entries[3].secondaryClassFourCC).toBeNull();
  });

  it('rejects a map whose tag array pointer is not 0x40440028 (e.g. lowered by an earlier broken ADD), with a message that says to re-create it', () => {
    // A self-consistent map at another base: the old inferring reader would have accepted it.
    const buffer = buildFakeMap({ baseMemoryAddress: 0x40440000 - 64, tags: [{ primaryClass: 'weap', tagId: 1, path: 'weapons\\pistol\\pistol' }] });
    const header = parseCacheFileHeader(buffer);
    expect(() => parseTagIndex(buffer, header)).toThrow(UnexpectedTagArrayAddressError);
    expect(() => parseTagIndex(buffer, header)).toThrow(/0x4043FFE8.*0x40440028.*earlier, broken build.*Re-create it/s);
    expect(() => parseTagIndex(buffer, header)).toThrow(CorruptMapError);
  });

  it('inferBaseMemoryAddressForClassifier (converter only) guesses the base from the array pointer', () => {
    expect(inferBaseMemoryAddressForClassifier(0x40440028)).toBe(0x40440000);
    expect(inferBaseMemoryAddressForClassifier(0x4bf10028)).toBe(0x4bf10000);
  });

  it('uses the fixed CE base 0x40440000 (not inferred) and resolves paths through it', () => {
    const buffer = buildFakeMap({
      tags: [
        { primaryClass: 'bipd', tagId: 1, path: 'characters\\masterchief\\masterchief' },
        { primaryClass: 'weap', tagId: 2, path: 'weapons\\pistol\\pistol' },
      ],
    });
    const header = parseCacheFileHeader(buffer);
    expect(buffer.readUInt32LE(header.tagDataOffset)).toBe(0x40440028);
    const tagIndex = parseTagIndex(buffer, header);
    expect(tagIndex.baseMemoryAddress).toBe(0x40440000);
    expect(tagIndex.entries[0].path).toBe('characters\\masterchief\\masterchief');
    expect(tagIndex.entries[1].path).toBe('weapons\\pistol\\pistol');
  });

  it('throws CorruptMapError when tag count would read out of bounds', () => {
    const buffer = buildFakeMap({ tags: [{ primaryClass: 'scnr', tagId: 0, path: 'a' }] });
    const header = parseCacheFileHeader(buffer);
    buffer.writeUInt32LE(99999, header.tagDataOffset + 0x0c); // corrupt tag count
    expect(() => parseTagIndex(buffer, header)).toThrow(CorruptMapError);
  });
});
