import { describe, expect, it } from 'vitest';
import { convertRetailToCustomEdition, ConversionRefusedError, preflightRetailConversion } from '../src/map/convert/retail-to-ce';
import { planTagDataRepairs } from '../src/map/convert/tag-data-repairs';
import type { ExtentReport, ExtentViolation } from '../src/map/convert/extent-check';
import { renamedScenarioOf, unknownGroupEntries, parseTagIndexForConversion } from '../src/map/convert/scenario-tag';
import { resolveStruct } from '../src/map/definitions/engine';
import { finalizeForSave } from '../src/map/finalize-map';
import { parseCacheFileHeader } from '../src/map/header';
import { parseTagIndex } from '../src/map/tag-index';
import { readSampleMap, sampleIn, sampleMapPath, skippableTest } from './helpers/sample-maps';
import { rawCrc } from './helpers/raw-map';
import { openReadOnly } from './helpers/demo-map';

/**
 * Item C (PRD 2026-10-12): the scenario found by the tag data header's scenario ID with its group left as
 * it is, unknown groups refused by name, and the narrow repair for a pointer-free block that overlaps
 * another tag. Real map: HaloMD yoyorastv2_1 (scenario #0 renamed 'ztpt'; #2919's strings block overlaps
 * #2920's root). Independent: raw tag array and raw block bytes (memory addresses resolved from the
 * standard header), size and CRC by rawCrc (node:zlib). Same-reader: the pre-flight rows.
 */

const YOYO = sampleIn('haloMD', 'yoyorastv2_1.map');
const HALOMD_RES = { bitmaps: sampleIn('haloMD', 'bitmaps.map'), sounds: sampleIn('haloMD', 'sounds.map') };
const BASE = 0x40440000;
const fourcc = (b: Buffer, tagIndex: number) => b.readUInt32LE(b.readUInt32LE(0x10) + 0x28 + tagIndex * 0x20);
/** File offset of a memory address (standard header). */
const at = (b: Buffer, address: number) => b.readUInt32LE(0x10) + (address - BASE);
/** A tag's root address (raw tag array). */
const rootOf = (b: Buffer, tagIndex: number) => b.readUInt32LE(b.readUInt32LE(0x10) + 0x28 + tagIndex * 0x20 + 0x14);

/** A CE map as a retail-layout (version 7) map. */
function asRetail(ce: Buffer): Buffer {
  const out = Buffer.from(ce);
  out.writeUInt32LE(7, 0x4);
  out.fill(0, 0x40, 0x60);
  out.write('01.00.00.0576', 0x40, 'ascii');
  return out;
}

describe('scenario by the tag data header (synthetic: CE bloodgulch as version 7 with its scenario group renamed)', () => {
  const gate = skippableTest(['bloodgulch.map']);
  it.skipIf(gate.skip)(`a renamed scenario is read as a scenario: same rows as before plus one info row (and Inject's warning); the group in the file is not changed${gate.titleSuffix}`, () => {
    const plain = asRetail(readSampleMap('bloodgulch.map'));
    const renamed = Buffer.from(plain);
    renamed.writeUInt32LE(0x7a747074, renamed.readUInt32LE(0x10) + 0x28); // 'ztpt' on tag #0
    const before = Object.fromEntries(preflightRetailConversion(plain).checks.map((c) => [c.id, c.status]));
    const report = preflightRetailConversion(renamed);
    const after = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
    // Inject reads with the app's own reader, which does not read a renamed scenario as one: it warns.
    expect(after).toEqual({ ...before, scenarioGroup: 'info', injectAfterwards: 'warn' });
    expect(report.checks.find((c) => c.id === 'scenarioGroup')!.message).toMatch(/^The scenario is #0 "levels\\test\\bloodgulch\\bloodgulch", named by the tag data header's scenario ID, but its group is "ztpt"/);
    expect(fourcc(renamed, 0)).toBe(0x7a747074);
  });

  it.skipIf(gate.skip)(`a tag of an unknown group is refused by name${gate.titleSuffix}`, () => {
    const b = asRetail(readSampleMap('bloodgulch.map'));
    b.writeUInt32LE(0x7a7a7a7a, b.readUInt32LE(0x10) + 0x28 + 5 * 0x20); // 'zzzz' on tag #5
    const report = preflightRetailConversion(b);
    expect(report.canConvert).toBe(false);
    const row = report.checks.find((c) => c.id === 'unknownGroups')!;
    expect(row.status).toBe('refuse');
    expect(row.details).toEqual([expect.stringMatching(/^#5 .* \(group "zzzz"\)$/)]);
  });

  it.skipIf(gate.skip)(`the helper: the scenario is the entry the header's full ID names, not index 0 by assumption${gate.titleSuffix}`, () => {
    const b = withVersion(readSampleMap('bloodgulch.map'), 609);
    const h = parseCacheFileHeader(b);
    const plainIndex = parseTagIndex(b, h);
    expect(renamedScenarioOf(plainIndex)).toBeNull();
    // A wrong salt in the header's scenario ID: no scenario (OpenCE refuses such a map too).
    b.writeUInt32LE((plainIndex.scenarioTagId ^ 0x00010000) >>> 0, b.readUInt32LE(0x10) + 4);
    b.writeUInt32LE(0x7a747074, b.readUInt32LE(0x10) + 0x28);
    expect(parseTagIndexForConversion(b, h).entries[0].primaryClassName).not.toBe('scenario');
  });
});

describe('the block overlap repair is narrow (planner on CE ui.map with a synthetic violation)', () => {
  const gate = skippableTest(['ui.map']);
  const fakeExtents = (v: ExtentViolation): ExtentReport => ({ violations: [v], blocksChecked: 1, tagsChecked: 1, bspsChecked: 0, tagsWithoutDefinition: [], referenceCounts: new Map(), freeTagDataBytesAt: () => 0 });
  const skies = resolveStruct('Scenario').fields.find((f) => f.name === 'skies')!.def.struct!;
  it.skipIf(gate.skip)(`an overlapping block whose elements hold a tag reference is refused, not moved${gate.titleSuffix}`, () => {
    const b = readSampleMap('ui.map');
    const h = parseCacheFileHeader(b);
    const ti = parseTagIndex(b, h);
    const v: ExtentViolation = { kind: 'overlap', region: 'tagData', tagIndex: 0, tagPath: 'x', group: 'scenario', isRoot: false, field: 'skies[1 x 16]', fieldName: 'skies', address: BASE + 0x1000, size: resolveStruct(skies).totalSize, pointerAddress: BASE + 0x2000, blockStruct: skies, overlaps: 'y', text: 'synthetic' };
    const plan = planTagDataRepairs(b, h, ti, fakeExtents(v));
    expect(plan.repairs).toEqual([]);
    expect(plan.unrepairable).toEqual(['synthetic. No repair covers this problem.']);
  });
});

describe('HaloMD/yoyorastv2_1.map with HaloMD\'s resource files (in memory)', () => {
  const gate = skippableTest([YOYO, HALOMD_RES.bitmaps, HALOMD_RES.sounds]);
  it.skipIf(gate.skip)(`converts as yoyorastv2_1_ce.map: 168,146,813 bytes, CRC32 0x21515932; scenario #0 keeps 'ztpt'; #2919's strings block moved with today's bytes; #2920 untouched${gate.titleSuffix}`, () => {
    const source = readSampleMap(YOYO);
    const view = withVersion(source, 609);
    const viewIndex = parseTagIndexForConversion(view, parseCacheFileHeader(view));
    expect(renamedScenarioOf(parseTagIndex(view, parseCacheFileHeader(view)))?.index).toBe(0);
    expect(viewIndex.entries[0].primaryClassName).toBe('scenario');
    expect(unknownGroupEntries(viewIndex)).toEqual([]);
    const bitmaps = openReadOnly(sampleMapPath(HALOMD_RES.bitmaps));
    const sounds = openReadOnly(sampleMapPath(HALOMD_RES.sounds));
    try {
      const report = preflightRetailConversion(source, { bitmaps, sounds });
      expect(report.canConvert).toBe(true);
      const status = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
      expect(status).toMatchObject({ scenarioGroup: 'info', unknownGroups: 'pass', tagBlockAlignment: 'pass', tagDataExtents: 'warn', repairBlockOverlap: 'warn', overwrittenData: 'info', scripts: 'pass', drawableBitmaps: 'pass', resourceFiles: 'pass', validation: 'pass' });
      expect(report.repairs).toEqual([{ id: 'blockOverlap', required: true, tagPath: expect.stringMatching(/var_kill_penalty$/), bytesAdded: 54 }]);
      expect(report.checks.find((c) => c.id === 'overwrittenData')!.details).toHaveLength(3);

      expect(() => convertRetailToCustomEdition(source, { acknowledgeScripts: false, resources: { bitmaps, sounds } })).toThrow(ConversionRefusedError);
      const converted = convertRetailToCustomEdition(source, { acknowledgeScripts: false, resources: { bitmaps, sounds }, repairs: { blockOverlap: true } });
      const out = finalizeForSave(converted.buffer, { fileName: 'yoyorastv2_1_ce.map' }).buffer;
      expect(out.length).toBe(168_146_813);
      expect(rawCrc(out)).toBe(0x21515932);
      expect(out.readUInt32LE(0x64)).toBe(0x21515932);

      // Raw: tag #0's group is still 'ztpt'; the header's scenario ID still names it.
      expect(fourcc(out, 0)).toBe(0x7a747074);
      expect(out.readUInt32LE(out.readUInt32LE(0x10) + 4)).toBe(source.readUInt32LE(source.readUInt32LE(0x10) + 4));
      // Raw: #2919's strings reflexive (root +4) now points at a 40-byte copy whose two data pointers
      // point at copies of today's 8 and 6 bytes; everything else in the copy equals the old block.
      const root = rootOf(out, 2919);
      expect(root).toBe(rootOf(source, 2919));
      const oldBlock = source.readUInt32LE(at(source, root) + 4);
      const newBlock = out.readUInt32LE(at(out, root) + 4);
      expect(oldBlock).toBe(0x40d512b0);
      expect(newBlock).toBe(0x40d79428);
      const oldBytes = source.subarray(at(source, oldBlock), at(source, oldBlock) + 40);
      const newBytes = out.subarray(at(out, newBlock), at(out, newBlock) + 40);
      for (let k = 0; k < 2; k++) {
        const pointerAt = k * 20 + 12;
        const size = oldBytes.readUInt32LE(k * 20);
        const oldData = oldBytes.readUInt32LE(pointerAt);
        const newData = newBytes.readUInt32LE(pointerAt);
        expect(newData).toBeGreaterThan(newBlock);
        expect(out.subarray(at(out, newData), at(out, newData) + size).equals(source.subarray(at(source, oldData), at(source, oldData) + size))).toBe(true);
        newBytes.writeUInt32LE(oldData, pointerAt); // put back for the whole-block comparison below
      }
      expect(newBytes.equals(oldBytes)).toBe(true);
      // #2920 (its root and strings) is byte-identical to the source.
      const r2920 = rootOf(source, 2920);
      expect(out.subarray(at(out, r2920), at(out, r2920) + 12).equals(source.subarray(at(source, r2920), at(source, r2920) + 12))).toBe(true);
      const s2920 = source.readUInt32LE(at(source, r2920) + 4);
      expect(out.subarray(at(out, s2920), at(out, s2920) + 5 * 20).equals(source.subarray(at(source, s2920), at(source, s2920) + 5 * 20))).toBe(true);
    } finally {
      bitmaps.close();
      sounds.close();
    }
  }, 600_000);
});

function withVersion(b: Buffer, version: number): Buffer {
  const v = Buffer.from(b);
  v.writeUInt32LE(version, 4);
  return v;
}

