import { describe, expect, it } from 'vitest';
import { checkTagDataExtents } from '../src/map/convert/extent-check';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { BASE } from './helpers/raw-map';

/**
 * The tag data block check that mirrors OpenCE's validator (`extent-check.ts`). Same-reader: it
 * uses the schema engine like the converter. Anchors: 0 problems on the 5 Custom Edition sample
 * maps (if a CE map fails, the check is wrong), and the HaloMD problems sit exactly at the
 * addresses OpenCE logged (PRD "OpenCE findings"). The mutation tests change one pointer with raw
 * offsets and expect exactly that problem.
 */

const CE_MAPS = ['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map', 'Yoyorast_Island.map'];

/** Reads a CE or retail-layout (v7) map through the CE reader, on a copy with version 609. */
function check(map: Buffer) {
  const view = Buffer.from(map);
  view.writeUInt32LE(609, 0x4);
  const header = parseCacheFileHeader(view);
  return checkTagDataExtents(view, header, parseTagIndex(view, header));
}

/** Raw file offset of the scenario struct (tag data header +0x4 names the scenario). */
function scenarioAt(map: Buffer): number {
  const td = map.readUInt32LE(0x10);
  const entry = td + 0x28 + (map.readUInt32LE(td + 4) & 0xffff) * 0x20;
  return td + (map.readUInt32LE(entry + 0x14) - BASE);
}

describe('tag data block check: Custom Edition sample maps have no problems', () => {
  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name}: 0 problems, every tag and BSP checked${gate.titleSuffix}`, () => {
      const r = check(readSampleMap(name));
      expect(r.violations.map((v) => v.text)).toEqual([]);
      expect(r.tagsWithoutDefinition).toEqual([]);
      expect(r.bspsChecked).toBeGreaterThan(0);
      expect(r.blocksChecked).toBeGreaterThan(5000);
    }, 60_000);
  }
});

describe('tag data block check: HaloMD maps, at the addresses OpenCE logged', () => {
  const cases = [
    { file: sampleIn('haloMD', 'heh_2.map'), expected: [] as string[] },
    {
      file: sampleIn('haloMD', 'theisland_3.map'),
      expected: ['overlap #0 levels\\test\\bloodgulch\\bloodgulch script syntax data 380076 @ 0x404864FE'],
      free: 346_620,
    },
    { file: sampleIn('haloMD', 'barrier.map'), expected: ['overlap #0 hdm\\gvn\\barrier\\barrier script syntax data 380076 @ 0x4047662A'], free: 378_924 },
    { file: sampleIn('haloMD', 'crossing.map'), expected: ['outside #2404 sound\\sound environments\\arena root 72 @ 0x409DC695'] },
  ];
  for (const c of cases) {
    const gate = skippableTest([c.file]);
    it.skipIf(gate.skip)(`${c.file}: ${c.expected.length === 0 ? 'no problems' : c.expected.join('; ')}${gate.titleSuffix}`, () => {
      const r = check(readSampleMap(c.file));
      const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
      expect(r.violations.map((v) => `${v.kind} #${v.tagIndex} ${v.tagPath} ${v.fieldName ?? 'root'} ${v.size} @ ${hex(v.address)}`)).toEqual(c.expected);
      if (c.free !== undefined) {
        const v = r.violations[0];
        // The script string data starts right after the real gap (measured), so the free bytes end there.
        expect(r.freeTagDataBytesAt(v.address, v.size)).toBe(c.free);
      }
    }, 60_000);
  }

  const crossing = sampleIn('haloMD', 'crossing.map');
  const crossingGate = skippableTest([crossing]);
  it.skipIf(crossingGate.skip)(`crossing: no reference names tag #2404 with its full tag ID (the BSP's is stale; OpenCE sets it to none)${crossingGate.titleSuffix}`, () => {
    const map = readSampleMap(crossing);
    const td = map.readUInt32LE(0x10);
    const id = map.readUInt32LE(td + 0x28 + 2404 * 0x20 + 0xc);
    const r = check(map);
    expect(r.referenceCounts.get(id) ?? 0).toBe(0);
    expect(r.referenceCounts.get(((id & 0xffff) | (((id >>> 16) + 2) << 16)) >>> 0)).toBe(1);
  }, 60_000);
});

describe('tag data block check: one changed pointer gives exactly one problem (bloodgulch copy)', () => {
  const gate = skippableTest(['bloodgulch.map']);

  it.skipIf(gate.skip)(`a tag root moved to the tag data end is reported outside, naming the tag${gate.titleSuffix}`, () => {
    const map = readSampleMap('bloodgulch.map');
    const td = map.readUInt32LE(0x10);
    const count = map.readUInt32LE(td + 0xc);
    // The last non-BSP, internal tag (raw: entry +0x18 == 0).
    let index = count - 1;
    while (map.readUInt32LE(td + 0x28 + index * 0x20 + 0x18) !== 0 || map.readUInt32LE(td + 0x28 + index * 0x20) === 0x73627370) index--;
    map.writeUInt32LE(BASE + map.readUInt32LE(0x14), td + 0x28 + index * 0x20 + 0x14);
    const r = check(map);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ kind: 'outside', tagIndex: index, isRoot: true });
  }, 60_000);

  it.skipIf(gate.skip)(`the script string data pointed into the script syntax data is reported as an overlap of the syntax data${gate.titleSuffix}`, () => {
    const map = readSampleMap('bloodgulch.map');
    const s = scenarioAt(map);
    // Scenario +0x474 script syntax data, +0x488 script string data; a data field's pointer is at +0xC.
    map.writeUInt32LE(map.readUInt32LE(s + 0x474 + 0xc) + 100, s + 0x488 + 0xc);
    const r = check(map);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ kind: 'overlap', fieldName: 'script string data', isRoot: false });
    expect(r.violations[0].overlaps).toMatch(/script syntax data/);
  }, 60_000);

  it.skipIf(gate.skip)(`free bytes stop at the next claimed block and at the tag data end${gate.titleSuffix}`, () => {
    const map = readSampleMap('bloodgulch.map');
    const s = scenarioAt(map);
    const syntax = map.readUInt32LE(s + 0x474 + 0xc);
    const r = check(map);
    // The syntax data itself is claimed, so nothing is free at its start.
    expect(r.freeTagDataBytesAt(syntax, 1000)).toBe(0);
    expect(r.freeTagDataBytesAt(BASE + map.readUInt32LE(0x14) - 1, 1000)).toBeLessThanOrEqual(1);
  }, 60_000);
});
