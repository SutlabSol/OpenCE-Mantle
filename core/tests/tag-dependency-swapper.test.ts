import { describe, expect, it, beforeAll } from 'vitest';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { listTagDependencySlots, setTagDependencySlot, TagDependencySwapError } from '../src/map/tag-dependency-swapper';
import { hasSampleMaps, readSampleMap } from './helpers/sample-maps';
import { NULL_TAG_ID } from '../src/constants/tag-classes';

describe('tag-dependency-swapper', () => {
  const SAMPLES = ['bloodgulch.map'];
  let buf: Buffer;
  let header: ReturnType<typeof inspectCustomEditionMap>['header'];
  let tagIndex: ReturnType<typeof inspectCustomEditionMap>['tagIndex'];
  let rifle = -1;
  let warthog = -1;

  beforeAll(() => {
    if (!hasSampleMaps(SAMPLES)) return;
    buf = readSampleMap('bloodgulch.map');
    const r = inspectCustomEditionMap(buf);
    header = r.header;
    tagIndex = r.tagIndex;
    rifle = tagIndex.entries.findIndex((e) => e.path === 'weapons\\assault rifle\\assault rifle' && e.primaryClassName === 'weapon');
    warthog = tagIndex.entries.findIndex((e) => e.primaryClassName === 'vehicle');
  });

  it('lists nested and null slots for the assault rifle', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const slots = listTagDependencySlots(buf, header, tagIndex, rifle);
    expect(slots.length).toBeGreaterThanOrEqual(30);
    expect(slots.some((s) => /\[\d+\]\./.test(s.fieldPath))).toBe(true);
    expect(slots.some((s) => s.currentTagId === NULL_TAG_ID)).toBe(true);
    expect(slots.some((s) => s.currentGroup === 'projectile')).toBe(true);
    expect(new Set(slots.map((s) => s.fieldPath)).size).toBe(slots.length);
  });

  it('swaps one slot changing only its 16 bytes, and swapping back restores the buffer', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const copy = Buffer.from(buf);
    const slot = listTagDependencySlots(copy, header, tagIndex, rifle).find((s) => s.currentGroup === 'projectile')!;
    setTagDependencySlot(copy, header, tagIndex, rifle, slot.fieldPath, tagIndex.entries[warthog].tagId);

    let changed = 0;
    for (let i = 0; i < copy.length; i++) if (copy[i] !== buf[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(16);

    const after = listTagDependencySlots(copy, header, tagIndex, rifle).find((s) => s.fieldPath === slot.fieldPath)!;
    expect(after.currentGroup).toBe('vehicle');
    expect(after.currentPath).toBe(tagIndex.entries[warthog].path);

    setTagDependencySlot(copy, header, tagIndex, rifle, slot.fieldPath, slot.currentTagId);
    expect(copy.equals(buf)).toBe(true);
  });

  it('writes into a null slot and clears a slot', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const copy = Buffer.from(buf);
    const nul = listTagDependencySlots(copy, header, tagIndex, rifle).find((s) => s.currentTagId === NULL_TAG_ID)!;
    setTagDependencySlot(copy, header, tagIndex, rifle, nul.fieldPath, tagIndex.entries[warthog].tagId);
    expect(listTagDependencySlots(copy, header, tagIndex, rifle).find((s) => s.fieldPath === nul.fieldPath)!.currentGroup).toBe('vehicle');
    setTagDependencySlot(copy, header, tagIndex, rifle, nul.fieldPath, null);
    expect(listTagDependencySlots(copy, header, tagIndex, rifle).find((s) => s.fieldPath === nul.fieldPath)!.currentTagId).toBe(NULL_TAG_ID);
  });

  it('throws on an unknown slot or unknown target', () => {
    if (!hasSampleMaps(SAMPLES)) return;
    const copy = Buffer.from(buf);
    expect(() => setTagDependencySlot(copy, header, tagIndex, rifle, 'nope[9].x', null)).toThrow(TagDependencySwapError);
    const slot = listTagDependencySlots(copy, header, tagIndex, rifle)[0];
    expect(() => setTagDependencySlot(copy, header, tagIndex, rifle, slot.fieldPath, 0x12345678)).toThrow(TagDependencySwapError);
  });
});
