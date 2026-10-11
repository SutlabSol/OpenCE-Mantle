import { describe, expect, it } from 'vitest';
import { measureBlockAlignment, planTagDataAlignment, applyTagDataAlignment } from '../src/map/convert/align-tag-data';
import { preflightRetailConversion } from '../src/map/convert/retail-to-ce';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { BASE, tagDataOffsetOf } from './helpers/raw-map';
import { collectTagDataPointers, tagDataLayoutOf } from '../src/map/pointer-rebase';

/**
 * Phase 1c (`align-tag-data.ts`): OpenCE's `loaded_block_get` alignment rule and the "align the tag
 * data" plan. Same-reader (the schema walk), anchored by: 0 unaligned blocks on the 5 CE maps and the
 * stock PC / HaloMD maps, which OpenCE reads fully (the control test logged 60 sounds converted and 32
 * HUD elements on stock bloodgulch); the HaloMD counts measured in the research (PRD 2026-10-12); and
 * mutations made with raw offsets. The converted outputs are checked in convert-external.real-map.test.ts.
 */

/** Reads a CE or retail-layout (v7) map through the CE reader, on a copy with version 609. */
function load(name: string) {
  const view = Buffer.from(readSampleMap(name));
  view.writeUInt32LE(609, 0x4);
  const header = parseCacheFileHeader(view);
  return { view, header, tagIndex: parseTagIndex(view, header) };
}

const ALIGNED = [
  'bloodgulch.map',
  'sidewinder.map',
  'coldsnap.map',
  'ui.map',
  'Yoyorast_Island.map',
  sampleIn('pc', 'bloodgulch.map'),
  sampleIn('haloMD', 'bloodgulch.map'),
  sampleIn('haloMD', 'b30.map'),
  sampleIn('haloMD', 'ui.map'),
];

describe('block alignment: maps OpenCE reads fully have no unaligned block', () => {
  for (const name of ALIGNED) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name}: 0 unaligned blocks (tag data and BSPs), tags and data blocks; nothing to repair, nothing tolerated${gate.titleSuffix}`, () => {
      const { view, header, tagIndex } = load(name);
      const plan = planTagDataAlignment(view, header, tagIndex);
      const r = plan.report;
      expect([r.blocks.unaligned, r.bspBlocks.unaligned, r.roots.unaligned, r.dataBlocks.unaligned]).toEqual([0, 0, 0, 0]);
      expect(r.blocks.checked).toBeGreaterThan(1000);
      expect(plan).toMatchObject({ needed: false, bytes: 0, problems: [], tolerated: [] });
    }, 60_000);
  }

  for (const name of [sampleIn('pc', 'bloodgulch.map'), sampleIn('haloMD', 'bloodgulch.map')]) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name} (the control test): the pre-flight row passes and no alignment repair is offered${gate.titleSuffix}`, () => {
      const report = preflightRetailConversion(readSampleMap(name));
      expect(report.checks.find((k) => k.id === 'tagBlockAlignment')).toMatchObject({ status: 'pass' });
      expect(report.checks.find((k) => k.id === 'repairAlignTagData')).toBeUndefined();
    }, 60_000);
  }
});

describe('block alignment: the HaloMD maps (measured, PRD 2026-10-12)', () => {
  const cases = [
    { file: sampleIn('haloMD', 'heh_2.map'), blocks: 6982, roots: 2409, data: 2052, remainder: 2, bytes: 2, insertAt: 0x2ed9e, tolerated: ['staleReferencePath levels\\test\\bloodgulch\\bloodgulch.sound environment palette[0].sound environment'] },
    {
      file: sampleIn('haloMD', 'theisland_3.map'),
      blocks: 7578,
      roots: 2601,
      data: 2066,
      remainder: 2,
      bytes: 2,
      insertAt: 0x326d6,
      tolerated: ['staleReferencePath levels\\test\\bloodgulch\\bloodgulch.scenery palette[14].name', 'staleReferencePath vehicles\\banshee\\banshee_mp.weapons[0].weapon'],
    },
    { file: sampleIn('haloMD', 'crossing.map'), blocks: 6870, roots: 2403, data: 2294, remainder: 1, bytes: 3, insertAt: 0x2f105, tolerated: ['rootOutsideTagData sound\\sound environments\\arena root'] },
    { file: sampleIn('haloMD', 'barrier.map'), blocks: 6882, roots: 2455, data: 2289, remainder: 2, bytes: 2, insertAt: 0x2fe6a, tolerated: [] },
  ];
  for (const c of cases) {
    const gate = skippableTest([c.file]);
    it.skipIf(gate.skip)(`${c.file}: every block (${c.blocks}), tag (${c.roots}) and data block (${c.data}) is ${c.remainder} mod 4; insert ${c.bytes} at the end of the tag names; only the known stale pointers tolerated; aligned after applying${gate.titleSuffix}`, () => {
      const { view, header, tagIndex } = load(c.file);
      const plan = planTagDataAlignment(view, header, tagIndex);
      const r = plan.report;
      expect([r.blocks.unaligned, r.blocks.checked, r.roots.unaligned, r.roots.checked, r.dataBlocks.unaligned, r.dataBlocks.checked]).toEqual([c.blocks, c.blocks, c.roots, c.roots, c.data, c.data]);
      expect(r.blocks.byRemainder[c.remainder]).toBe(c.blocks);
      expect(r.bspBlocks.unaligned).toBe(0);
      expect(plan).toMatchObject({ needed: true, remainder: c.remainder, bytes: c.bytes, insertAt: c.insertAt, problems: [] });
      expect(plan.tolerated.map((t) => `${t.kind} ${t.where}`)).toEqual(c.tolerated);
      // Independent: the insertion point is the end of the last tag path string (raw tag array).
      const td = tagDataOffsetOf(view);
      let end = 0;
      for (let i = 0; i < tagIndex.tagCount; i++) {
        let at = td + (view.readUInt32LE(td + 0x28 + i * 0x20 + 0x10) - BASE);
        while (view[at] !== 0) at++;
        end = Math.max(end, at + 1 - td);
      }
      expect(plan.insertAt).toBe(end);

      const aligned = applyTagDataAlignment(view, plan);
      expect(aligned.buffer.length).toBe(view.length + c.bytes);
      const h = parseCacheFileHeader(aligned.buffer);
      const after = measureBlockAlignment(aligned.buffer, h, parseTagIndex(aligned.buffer, h));
      expect([after.blocks.unaligned, after.bspBlocks.unaligned, after.roots.unaligned, after.dataBlocks.unaligned]).toEqual([0, 0, 0, 0]);
      expect(after.blocks.checked).toBe(c.blocks);
    }, 120_000);
  }
});

describe('block alignment: mutations (raw offsets)', () => {
  const gate = skippableTest(['bloodgulch.map']);
  it.skipIf(gate.skip)(`one data block moved by 2 (a mixed remainder): the check counts it, and the plan refuses (no single shift aligns the map)${gate.titleSuffix}`, () => {
    const { view, header, tagIndex } = load('bloodgulch.map');
    // The first data block of 8+ bytes the walk finds (located with the schema walk; changed with a raw write).
    const site = collectTagDataPointers(view, tagDataLayoutOf(header, tagIndex)).find((s) => s.kind === 'dataBlock' && view.readInt32LE(s.at - 0xc) >= 8)!;
    view.writeUInt32LE(site.value + 2, site.at);
    const plan = planTagDataAlignment(view, header, parseTagIndex(view, header));
    expect(plan.report.dataBlocks.unaligned).toBe(1);
    expect(plan.report.dataBlocks.byRemainder[2]).toBe(1);
    expect(plan.problems).toEqual([expect.stringMatching(/different remainders mod 4 \(0, 2\)/)]);
  }, 60_000);

  it.skipIf(gate.skip)(`a block list of count 0 is never counted, whatever its pointer (loaded_block_get: a count of 0 always passes)${gate.titleSuffix}`, () => {
    const { view, header, tagIndex } = load('bloodgulch.map');
    const before = planTagDataAlignment(view, header, tagIndex).report.blocks.checked;
    const site = collectTagDataPointers(view, tagDataLayoutOf(header, tagIndex)).find((s) => s.kind === 'reflexive' && view.readInt32LE(s.at - 4) > 0)!;
    view.writeInt32LE(0, site.at - 4); // count 0: its elements are no longer walked either
    view.writeUInt32LE(site.value + 2, site.at);
    const r = planTagDataAlignment(view, header, parseTagIndex(view, header)).report;
    expect(r.blocks.unaligned).toBe(0);
    expect(r.blocks.checked).toBeLessThan(before);
  }, 60_000);

  it.skipIf(gate.skip)(`a tag root pointing past the tag data with no repair for it is tolerated by the walk, but a reflexive pointing outside the tag data still refuses${gate.titleSuffix}`, () => {
    const { view, header } = load('bloodgulch.map');
    // The scenario's "structure bsps" block list (raw offset 0x5A4 in the scenario struct): point it far outside the tag data.
    const td = tagDataOffsetOf(view);
    const scenarioEntry = td + 0x28 + (view.readUInt32LE(td + 4) & 0xffff) * 0x20;
    const scenarioAt = td + (view.readUInt32LE(scenarioEntry + 0x14) - BASE);
    view.writeUInt32LE(0x7ff00000, scenarioAt + 0x5a4 + 4);
    const plan = planTagDataAlignment(view, header, parseTagIndex(view, header));
    expect(plan.problems).toEqual([expect.stringMatching(/can't be read completely .*outside the tag data/)]);
    expect(plan.tolerated).toEqual([]);
  }, 60_000);
});
