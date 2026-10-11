import { describe, expect, it, beforeAll } from 'vitest';
import * as zlib from 'node:zlib';
import { classifyMapLayout, describeUnsupportedLayout } from '../src/map/convert/classify';
import { findReferenceIdentityIssues } from '../src/map/convert/reference-identity';
import { convertRetailToCustomEdition, preflightRetailConversion, ConversionRefusedError, CE_BUILD_STRING } from '../src/map/convert/retail-to-ce';
import { finalizeForSave } from '../src/map/finalize-map';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { resolveStruct } from '../src/map/definitions/engine';
import { readSampleMap, skippableTest } from './helpers/sample-maps';

/**
 * Converter Phase 1 (retail layout, version 7 -> Custom Edition 609).
 *
 * Independent checks (`rawCrc`, `differingRanges`, the raw header reads) use only node:zlib and raw
 * byte offsets - none of the converter, finalize, CRC or tag-index code. The only shared piece is a
 * cross-check that the Scenario "structure bsps" offset (0x5A4) agrees with the schema.
 * The HaloMD maps live in sample_maps/demo (never mixed with the CE maps of the same name).
 */

const CE_MAPS = ['bloodgulch.map', 'sidewinder.map', 'coldsnap.map', 'ui.map', 'Yoyorast_Island.map'];
const HEH = 'demo/heh_2.map';
const ISLAND = 'demo/theisland_3.map';
const DEMO_BG = 'demo/bloodgulch.map';

const SCENARIO_STRUCTURE_BSPS = 0x5a4;
const CE_BASE = 0x40440000;

/** Halo's header crc32 from raw bytes: bit-inverted CRC-32 over each BSP, model data, then tag data. */
function rawCrc(buf: Buffer): number {
  const tagDataOffset = buf.readUInt32LE(0x10);
  const tagDataSize = buf.readUInt32LE(0x14);
  const scenarioId = buf.readUInt32LE(tagDataOffset + 0x4);
  const entry = tagDataOffset + 0x28 + (scenarioId & 0xffff) * 0x20;
  const scenarioAt = tagDataOffset + (buf.readUInt32LE(entry + 0x14) - CE_BASE);
  const bspCount = buf.readUInt32LE(scenarioAt + SCENARIO_STRUCTURE_BSPS);
  const bspsAt = tagDataOffset + (buf.readUInt32LE(scenarioAt + SCENARIO_STRUCTURE_BSPS + 4) - CE_BASE);
  let crc = 0;
  for (let i = 0; i < bspCount; i++) {
    const start = buf.readUInt32LE(bspsAt + i * 32);
    crc = zlib.crc32(buf.subarray(start, start + buf.readUInt32LE(bspsAt + i * 32 + 4)), crc);
  }
  const modelAt = buf.readUInt32LE(tagDataOffset + 0x14);
  crc = zlib.crc32(buf.subarray(modelAt, modelAt + buf.readUInt32LE(tagDataOffset + 0x20)), crc);
  crc = zlib.crc32(buf.subarray(tagDataOffset, tagDataOffset + tagDataSize), crc);
  return ~crc >>> 0;
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

const ascii = (buf: Buffer, at: number) => buf.subarray(at, at + 32).toString('latin1').replace(/\0+$/, '');

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

describe('converter on a synthetic retail-layout map (ui.map with version 7)', () => {
  const gate = skippableTest(['ui.map']);
  let ui: Buffer;
  let retail: Buffer;
  beforeAll(() => {
    if (gate.skip) return;
    ui = readSampleMap('ui.map');
    retail = asRetail(ui);
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

  it.skipIf(gate.skip)(`converted and finalized as ui.map it is byte-identical to the real ui.map${gate.titleSuffix}`, () => {
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

interface HaloMdCase {
  file: string;
  name: string;
  crc: number;
  /** The output name used for the "different file name" case and the name bytes it changes. */
  renamed: string;
  renamedNameRange: string;
}

const HALOMD_CASES: HaloMdCase[] = [
  { file: HEH, name: 'heh_2', crc: 0xd1c331e9, renamed: 'heh_2_ce.map', renamedNameRange: '0x25-0x27' },
  { file: ISLAND, name: 'theisland_3', crc: 0x0a5afea5, renamed: 'island_ce.map', renamedNameRange: '0x20-0x2A' },
];

for (const c of HALOMD_CASES) {
  describe(`converter on ${c.file} (real bytes)`, () => {
    const gate = skippableTest([c.file]);
    let source: Buffer;
    let sourceCopy: Buffer;
    beforeAll(() => {
      if (gate.skip) return;
      source = readSampleMap(c.file);
      sourceCopy = Buffer.from(source);
    });

    it.skipIf(gate.skip)(`pre-flight: convertible, no acknowledgement, new CRC32 0x${c.crc.toString(16).toUpperCase()}${gate.titleSuffix}`, () => {
      const report = preflightRetailConversion(source);
      expect(report.canConvert).toBe(true);
      expect(report.requiresAcknowledgement).toBe(false);
      expect(report.newCrc32).toBe(c.crc);
      expect(report.previousCrc32).toBe(0);
      expect(report.scenarioName).toBe(c.name);
      const status = Object.fromEntries(report.checks.map((k) => [k.id, k.status]));
      expect(status).toMatchObject({ layout: 'pass', fileSize: 'pass', padding: 'pass', tagDataAddress: 'pass', entryFlags: 'pass', regions: 'pass', scripts: 'pass', requiredTags: 'pass', referenceIdentity: 'warn', injectAfterwards: 'warn' });
      const refs = report.checks.find((k) => k.id === 'referenceIdentity')!;
      expect(refs.details).toHaveLength(1);
      expect(refs.details[0]).toMatch(/path pointer 0x4BF/);
    });

    it.skipIf(gate.skip)(`output named ${c.name}.map: CRC32 0x${c.crc.toString(16).toUpperCase()}, differs only at 0x4-0x5, 0x4A-0x4C, 0x64-0x67${gate.titleSuffix}`, () => {
      const out = finalizeForSave(convertRetailToCustomEdition(source, { acknowledgeScripts: false }).buffer, { fileName: `${c.name}.map` }).buffer;
      expect(differingRanges(source, out)).toEqual(['0x4-0x5', '0x4A-0x4C', '0x64-0x67']);
      // Independent of the converter: raw header bytes and node:zlib.
      expect(out.readUInt32LE(0x4)).toBe(609);
      expect(ascii(out, 0x40)).toBe(CE_BUILD_STRING);
      expect(ascii(out, 0x20)).toBe(c.name);
      expect(out.readUInt32LE(0x64)).toBe(c.crc);
      expect(rawCrc(out)).toBe(c.crc);
      expect(rawCrc(source)).toBe(c.crc);
    });

    it.skipIf(gate.skip)(`output named ${c.renamed}: also the name bytes ${c.renamedNameRange}, same CRC32${gate.titleSuffix}`, () => {
      const out = finalizeForSave(convertRetailToCustomEdition(source, { acknowledgeScripts: false }).buffer, { fileName: c.renamed }).buffer;
      expect(differingRanges(source, out)).toEqual(['0x4-0x5', c.renamedNameRange, '0x4A-0x4C', '0x64-0x67']);
      expect(ascii(out, 0x20)).toBe(c.renamed.replace(/\.map$/, ''));
      expect(out.readUInt32LE(0x64)).toBe(c.crc);
    });

    it.skipIf(gate.skip)(`the output reads with the CE reader${gate.titleSuffix}`, () => {
      const out = finalizeForSave(convertRetailToCustomEdition(source, { acknowledgeScripts: false }).buffer, { fileName: `${c.name}.map` }).buffer;
      const ins = inspectCustomEditionMap(out);
      expect(ins.status).toBe('ok');
      if (ins.status !== 'ok') return;
      expect(ins.header.engine).toBe(609);
      expect(ins.header.buildString).toBe(CE_BUILD_STRING);
      expect(ins.header.scenarioName).toBe(c.name);
      expect(ins.header.crc32 >>> 0).toBe(c.crc);
      expect(ins.tagIndex.tagCount).toBe(source.readUInt32LE(source.readUInt32LE(0x10) + 0xc));
      // Converted again: refused, it's a CE map now.
      expect(() => convertRetailToCustomEdition(out, { acknowledgeScripts: true })).toThrow(/already a Custom Edition map/);
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
