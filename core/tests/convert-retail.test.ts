import { describe, expect, it, beforeAll } from 'vitest';
import { classifyMapLayout, describeUnsupportedLayout } from '../src/map/convert/classify';
import { findReferenceIdentityIssues } from '../src/map/convert/reference-identity';
import { convertRetailToCustomEdition, preflightRetailConversion, ConversionRefusedError, CE_BUILD_STRING } from '../src/map/convert/retail-to-ce';
import { finalizeForSave } from '../src/map/finalize-map';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { resolveStruct } from '../src/map/definitions/engine';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { BASE as CE_BASE, RAW_LAYOUT, rawAssets, rawCrc } from './helpers/raw-map';

/**
 * Converter Phase 1 (retail layout, version 7 -> Custom Edition 609): the checks and the
 * header-only conversion of a map whose bitmap and sound data is all inside it. Maps with external
 * data (all HaloMD sample maps) are refused without the source game's resource files; the Phase 1b
 * conversion with those files is tested in `convert-external.real-map.test.ts`.
 *
 * Independent checks (`rawCrc`, `rawAssets`, `differingRanges`, the raw header reads) use only
 * node:zlib and raw byte offsets (`helpers/raw-map.ts`) - none of the converter, finalize, CRC or
 * tag-index code. The only shared piece is a cross-check that the Scenario "structure bsps" offset
 * (0x5A4) agrees with the schema.
 * The HaloMD maps and the original Mac demo map live in their own sample folders (see the helper), never
 * mixed with the CE maps of the same name.
 */

const CE_MAPS = ['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map', 'Yoyorast_Island.map'];
const HEH = sampleIn('haloMD', 'heh_2.map');
const ISLAND = sampleIn('haloMD', 'theisland_3.map');
const DEMO_BG = sampleIn('macDemo', 'bloodgulch.map');

const SCENARIO_STRUCTURE_BSPS = RAW_LAYOUT.scenarioStructureBsps;

/** A copy with every bitmap image and sound permutation marked internal (raw bytes): a map with no external data for the header-only path. */
function withAssetsMarkedInternal(map: Buffer): Buffer {
  const out = Buffer.from(map);
  for (const a of rawAssets(out)) {
    if (a.flagWidth === 2) out.writeUInt16LE(a.flagValue & ~0x100, a.flagAt);
    else out.writeUInt32LE((a.flagValue & ~1) >>> 0, a.flagAt);
  }
  return out;
}

/** Inclusive [start, end] ranges of differing bytes, as "0x4-0x5". */
function differingRanges(a: Buffer, b: Buffer): string[] {
  expect(b.length).toBe(a.length);
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= a.length; i++) {
    const differs = i < a.length && a[i] !== b[i];
    if (differs && start < 0) start = i;
    if (!differs && start >= 0) {
      out.push(`0x${start.toString(16).toUpperCase()}-0x${(i - 1).toString(16).toUpperCase()}`);
      start = -1;
    }
  }
  return out;
}


/** A CE map turned into a retail-layout map for synthetic tests: version 7, the HaloMD build string. */
function asRetail(ce: Buffer): Buffer {
  const out = Buffer.from(ce);
  out.writeUInt32LE(7, 0x4);
  out.fill(0, 0x40, 0x60);
  out.write('01.00.00.0576', 0x40, 'ascii');
  return out;
}

describe('converter: the raw-byte reference itself', () => {
  it('the Scenario "structure bsps" offset used by rawCrc agrees with the schema', () => {
    expect(resolveStruct('Scenario').fields.find((f) => f.name === 'structure bsps')!.offset).toBe(SCENARIO_STRUCTURE_BSPS);
  });

  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`rawCrc reproduces the crc32 Tool stored in ${name}${gate.titleSuffix}`, () => {
      const buf = readSampleMap(name);
      expect(rawCrc(buf)).toBe(buf.readUInt32LE(0x64));
    });
  }
});

describe('classifyMapLayout', () => {
  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name} is Custom Edition${gate.titleSuffix}`, () => {
      expect(classifyMapLayout(readSampleMap(name))).toEqual({ kind: 'customEdition' });
    });
  }

  for (const name of [HEH, ISLAND]) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name} is retail layout at the CE base${gate.titleSuffix}`, () => {
      const layout = classifyMapLayout(readSampleMap(name));
      expect(layout).toEqual({ kind: 'retail', version: 7, inferredBase: CE_BASE });
      expect(describeUnsupportedLayout(layout)).toMatch(/Convert to Custom Edition/);
    });
  }

  const demoGate = skippableTest([DEMO_BG]);
  it.skipIf(demoGate.skip)(`the original demo bloodgulch is the true demo layout (Phase 2)${demoGate.titleSuffix}`, () => {
    const layout = classifyMapLayout(readSampleMap(DEMO_BG));
    expect(layout).toEqual({ kind: 'demo', version: 6 });
    expect(describeUnsupportedLayout(layout)).toMatch(/not supported yet/);
  });

  it('a too-short or unknown file is not a map', () => {
    expect(classifyMapLayout(Buffer.alloc(100))).toEqual({ kind: 'notAMap' });
    expect(classifyMapLayout(Buffer.alloc(4096))).toEqual({ kind: 'notAMap' });
  });
});

describe('reference identity (full tag ID + path pointer)', () => {
  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`${name}: 0 mismatches${gate.titleSuffix}`, () => {
      const buf = readSampleMap(name);
      const ins = inspectCustomEditionMap(buf);
      if (ins.status !== 'ok') throw new Error(ins.status);
      expect(findReferenceIdentityIssues(buf, ins.header, ins.tagIndex)).toEqual([]);
    });
  }
});

describe('converter refuses what it must not convert', () => {
  for (const name of CE_MAPS) {
    const gate = skippableTest([name]);
    it.skipIf(gate.skip)(`refuses ${name}: already Custom Edition${gate.titleSuffix}`, () => {
      const buf = readSampleMap(name);
      const report = preflightRetailConversion(buf);
      expect(report.canConvert).toBe(false);
      expect(report.checks.find((c) => c.id === 'layout')).toMatchObject({ status: 'refuse', message: expect.stringMatching(/already a Custom Edition map/) });
      expect(() => convertRetailToCustomEdition(buf, { acknowledgeScripts: true })).toThrow(ConversionRefusedError);
    });
  }

  const demoGate = skippableTest([DEMO_BG]);
  it.skipIf(demoGate.skip)(`refuses the true demo layout with the Phase 2 message${demoGate.titleSuffix}`, () => {
    const report = preflightRetailConversion(readSampleMap(DEMO_BG));
    expect(report.canConvert).toBe(false);
    expect(report.checks[0].message).toMatch(/Phase 2/);
  });

  const uiGate = skippableTest(['ui.map']);
  const refusals: [string, (b: Buffer) => void, string][] = [
    ['a nonzero entry word at +0x18', (b) => b.writeUInt32LE(1, b.readUInt32LE(0x10) + 0x28 + 5 * 0x20 + 0x18), 'entryFlags'],
    ['a nonzero entry word at +0x1C', (b) => b.writeUInt32LE(0x10000, b.readUInt32LE(0x10) + 0x28 + 9 * 0x20 + 0x1c), 'entryFlags'],
    ['a header file size that does not match', (b) => b.writeUInt32LE(b.length + 4, 0x8), 'fileSize'],
    ['a nonzero header padding length', (b) => b.writeUInt32LE(16, 0xc), 'padding'],
    ['a tag array pointer that is not 0x40440028', (b) => b.writeUInt32LE(0x4bf10028, b.readUInt32LE(0x10)), 'tagDataAddress'],
  ];
  for (const [what, corrupt, id] of refusals) {
    it.skipIf(uiGate.skip)(`refuses a retail-layout map with ${what}${uiGate.titleSuffix}`, () => {
      const buf = asRetail(readSampleMap('ui.map'));
      corrupt(buf);
      const report = preflightRetailConversion(buf);
      expect(report.canConvert).toBe(false);
      expect(report.checks.find((c) => c.id === id)?.status).toBe('refuse');
      expect(() => convertRetailToCustomEdition(buf, { acknowledgeScripts: true })).toThrow(ConversionRefusedError);
    });
  }
});

describe('converter on a synthetic retail-layout map with all data internal (ui.map, version 7, assets marked internal)', () => {
  const gate = skippableTest(['ui.map']);
  let ui: Buffer;
  let retail: Buffer;
  beforeAll(() => {
    if (gate.skip) return;
    // Re-finalized so its stored crc32 matches the changed flags (the reference for "byte-identical").
    ui = finalizeForSave(withAssetsMarkedInternal(readSampleMap('ui.map')), { fileName: 'ui.map' }).buffer;
    expect(ui.readUInt32LE(0x64)).toBe(rawCrc(ui));
    retail = asRetail(ui);
  });

  it.skipIf(gate.skip)(`the unmodified ui.map as version 7 is refused: its 575 bitmap/sound assets are external and no resource files were given${gate.titleSuffix}`, () => {
    const report = preflightRetailConversion(asRetail(readSampleMap('ui.map')));
    expect(report.canConvert).toBe(false);
    expect(report.externalData).toEqual({ bitmaps: { count: 450, bytes: 22_962_736 }, sounds: { count: 125, bytes: 3_534_102 } });
    expect(report.checks.find((c) => c.id === 'externalData')?.status).toBe('refuse');
  });

  it.skipIf(gate.skip)(`with all data internal: no external data, header-only, estimated size = source size${gate.titleSuffix}`, () => {
    const report = preflightRetailConversion(retail);
    expect(report.externalData).toEqual({ bitmaps: { count: 0, bytes: 0 }, sounds: { count: 0, bytes: 0 } });
    expect(report.checks.find((c) => c.id === 'externalData')?.status).toBe('pass');
    expect(report.estimatedOutputSize).toBe(retail.length);
    expect(report.newCrc32).toBe(rawCrc(ui));
  });

  it.skipIf(gate.skip)(`its script function calls need an acknowledgement; without it the converter refuses${gate.titleSuffix}`, () => {
    const report = preflightRetailConversion(retail);
    expect(report.canConvert).toBe(true);
    expect(report.requiresAcknowledgement).toBe(true);
    expect(report.checks.find((c) => c.id === 'scripts')).toMatchObject({ status: 'warn', requiresAcknowledgement: true });
    try {
      convertRetailToCustomEdition(retail, { acknowledgeScripts: false });
      throw new Error('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(ConversionRefusedError);
      expect((err as ConversionRefusedError).code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    }
  });

  it.skipIf(gate.skip)(`converted and finalized as ui.map it is byte-identical to the (internal-marked) ui.map${gate.titleSuffix}`, () => {
    const out = finalizeForSave(convertRetailToCustomEdition(retail, { acknowledgeScripts: true }).buffer, { fileName: 'ui.map' }).buffer;
    expect(differingRanges(ui, out)).toEqual([]);
  });

  it.skipIf(gate.skip)(`never mutates its input${gate.titleSuffix}`, () => {
    const before = Buffer.from(retail);
    convertRetailToCustomEdition(retail, { acknowledgeScripts: true });
    preflightRetailConversion(retail);
    expect(retail.equals(before)).toBe(true);
  });
});

const HALOMD_CASES = [
  // heh_2: no tag data problem; its script data is only misaligned and has no used nodes (a note, no repair).
  { file: HEH, name: 'heh_2', bitmaps: { count: 676, bytes: 44_396_916 }, sounds: { count: 951, bytes: 11_972_226 }, size: 70_827_478, rows: { tagDataExtents: 'pass', scriptDataAlignment: 'info' }, repairs: [] as string[] },
  // theisland_3: + 2 bytes of padding + 380,076 bytes for the required script data repair.
  { file: ISLAND, name: 'theisland_3', bitmaps: { count: 742, bytes: 60_659_138 }, sounds: { count: 1129, bytes: 20_946_198 }, size: 105_728_562, rows: { tagDataExtents: 'warn', repairScriptSyntaxData: 'warn' }, repairs: ['scriptSyntaxData'] },
];

/**
 * heh_2 and theisland_3 keep their bitmap and sound data in the source game's resource files. Their
 * header-only conversion (CRC32 0xD1C331E9 / 0x0A5AFEA5) blue-screened in OpenCE, so without the
 * resource files they are refused. Converting them with the files: convert-external.real-map.test.ts.
 */
for (const c of HALOMD_CASES) {
  describe(`converter on ${c.file} without resource files (real bytes)`, () => {
    const gate = skippableTest([c.file]);
    let source: Buffer;
    let sourceCopy: Buffer;
    beforeAll(() => {
      if (gate.skip) return;
      source = readSampleMap(c.file);
      sourceCopy = Buffer.from(source);
    });

    it.skipIf(gate.skip)(`pre-flight: refused because ${c.bitmaps.count} bitmap images and ${c.sounds.count} sound permutations are external; the other rows as before${gate.titleSuffix}`, () => {
      const report = preflightRetailConversion(source);
      expect(report.canConvert).toBe(false);
      expect(report.requiresAcknowledgement).toBe(false);
      expect(report.newCrc32).toBeNull();
      expect(report.previousCrc32).toBe(0);
      expect(report.scenarioName).toBe(c.name);
      expect(report.externalData).toEqual({ bitmaps: c.bitmaps, sounds: c.sounds });
      expect(report.estimatedOutputSize).toBe(c.size);
      const status = Object.fromEntries(report.checks.map((k) => [k.id, k.status]));
      expect(status).toMatchObject({ layout: 'pass', fileSize: 'pass', padding: 'pass', tagDataAddress: 'pass', entryFlags: 'pass', regions: 'pass', ...c.rows, externalData: 'refuse', scripts: 'pass', requiredTags: 'pass', referenceIdentity: 'warn', injectAfterwards: 'warn' });
      expect(report.repairs.map((r) => r.id)).toEqual(c.repairs);
      expect(report.repairs.every((r) => r.required)).toBe(true);
      expect(report.checks.find((k) => k.id === 'externalData')!.message).toMatch(/Missing: bitmaps\.map, sounds\.map/);
      const refs = report.checks.find((k) => k.id === 'referenceIdentity')!;
      expect(refs.details).toHaveLength(1);
      expect(refs.details[0]).toMatch(/path pointer 0x4BF/);
    });

    it.skipIf(gate.skip)(`convert without resource files throws REFUSED and returns nothing${gate.titleSuffix}`, () => {
      try {
        convertRetailToCustomEdition(source, { acknowledgeScripts: true, repairs: { scriptSyntaxData: true, tagRootOutside: true } });
        throw new Error('expected a refusal');
      } catch (err) {
        expect(err).toBeInstanceOf(ConversionRefusedError);
        expect((err as ConversionRefusedError).code).toBe('REFUSED');
        expect((err as Error).message).toMatch(/source game's bitmaps\.map and sounds\.map/);
      }
    });

    it.skipIf(gate.skip)(`the source buffer is never changed${gate.titleSuffix}`, () => {
      expect(source.equals(sourceCopy)).toBe(true);
    });
  });
}

const islandGate = skippableTest([ISLAND]);
describe('converter warnings specific to theisland_3', () => {
  it.skipIf(islandGate.skip)(`reports the scenery palette problems as warnings, not fixes${islandGate.titleSuffix}`, () => {
    const report = preflightRetailConversion(readSampleMap(ISLAND));
    const validation = report.checks.find((k) => k.id === 'validation')!;
    expect(validation.status).toBe('warn');
    expect(validation.details.some((d) => d.includes('scenery palette[14]'))).toBe(true);
    expect(validation.details.some((d) => d.includes('scenery palette[15]'))).toBe(true);
    expect(report.checks.find((k) => k.id === 'referenceIdentity')!.details[0]).toMatch(/scenery palette\[14\]/);
  });
});
