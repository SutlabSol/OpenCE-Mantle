import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { convertDemoToCustomEdition, DEMO_TO_CE_DELTA, normalizeDemoMap, preflightDemoConversion } from '../src/map/convert/demo-to-ce';
import type { DemoNormalization } from '../src/map/convert/demo-to-ce';
import { ConversionRefusedError } from '../src/map/convert/retail-to-ce';
import { finalizeForSave } from '../src/map/finalize-map';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { readSampleMap, sampleMapPath, skippableTest } from './helpers/sample-maps';
import { rawBspRegions, rawCrc } from './helpers/raw-map';
import { bytesOutside, changedWords, DEMO_BASE, MACDEMO, MACDEMO_RES, rawDemo, sha256, TAG_SPACE, withResources } from './helpers/demo-map';

/**
 * Converter Phase 2, stage 2 (PRD 2026-10-12 "Converter Phase 2"): the MacDemo mods one by one, with
 * the Mac demo's resource files, in memory (nothing written). Zombiemod and TrueInfectionV2 convert;
 * MGMWeaponCollab (decision B, and 3 sound ranges past the end of the stock sounds.map) and ParanoiaV2
 * (decision C) are refused with their reasons; ui and b30 are measure-only (b30 runs only with
 * OPENCE_SLOW_TESTS=1).
 *
 * Independent: the raw rebase check (`expectRawRebase`: every changed word moved by exactly -0x0BAD0000
 * and the counts add up), the output size and CRC (rawCrc, node:zlib), the name field and the kept
 * +0x1C word read raw, the MGM range offsets against the file size. Same-reader: the per-kind counts,
 * the pre-flight rows, the CE reader read-back.
 */

type Moved = DemoNormalization['moved'];

/**
 * Raw bytes: in the tag data and in every BSP, each changed word moved by exactly -0x0BAD0000 from the
 * demo tag space and nothing else changed; the counts add up (tag data = the five tag-data kinds + the
 * BSP address(es) + the tag array pointer; BSPs = headers + reflexives + data blocks + reference paths);
 * the stale pointers the walk tolerated are unchanged.
 */
function expectRawRebase(source: Buffer, norm: DemoNormalization): void {
  const { tdo, tds } = rawDemo(source);
  const out = norm.buffer;
  const m = norm.moved;
  const bspWords: number[] = [];
  for (const b of rawBspRegions(out)) {
    const words = changedWords(source, out, b.start, b.start + b.size);
    expect(bytesOutside(source, out, b.start, b.start + b.size, words)).toBe(0);
    bspWords.push(...words);
  }
  const tagWords = changedWords(source, out, tdo, tdo + tds);
  expect(bytesOutside(source, out, tdo, tdo + tds, tagWords)).toBe(0);
  expect(tagWords.length).toBe(m.tagPath + m.tagData + m.reflexive + m.dataBlock + m.referencePath + m.bspAddress + 1);
  expect(bspWords.length).toBe(m.bspHeader + m.bspReflexive + m.bspDataBlock + m.bspReferencePath);
  for (const at of [...tagWords, ...bspWords]) {
    const before = source.readUInt32LE(at);
    expect(before >= DEMO_BASE && before < DEMO_BASE + TAG_SPACE).toBe(true);
    expect(out.readUInt32LE(at)).toBe((before + DEMO_TO_CE_DELTA) >>> 0);
  }
  for (const t of norm.tolerated) expect(out.readUInt32LE(t.at)).toBe(source.readUInt32LE(t.at));
}

/** The protection's junk references (tolerated stale paths and wrong tag IDs) are all netgame weapon groups. */
const NETGAME_JUNK = /\.netgame flags\[\d+\]\.weapon group$/;

interface ConvertingCase {
  file: string;
  out: string;
  size: number;
  crc: number;
  moved: Moved;
  tolerated: number;
  unusedWord: { tagIndex: number; detail: string; value: number };
  wrongIds: number;
  pathOnly: string;
  ranges: number;
  /** Set when a later check refuses the map (the rebase itself still works). */
  refusedBy?: 'drawableBitmaps';
}

const CONVERTING: ConvertingCase[] = [
  {
    file: MACDEMO.zombiemod,
    out: 'Zombiemod.map',
    size: 118_787_881,
    crc: 0x9c98e7d0,
    moved: { tagPath: 3691, tagData: 3690, reflexive: 10108, dataBlock: 6344, referencePath: 8678, bspReferencePath: 94, bspAddress: 1, bspHeader: 1, bspReflexive: 386, bspDataBlock: 81 },
    tolerated: 12,
    unusedWord: { tagIndex: 3690, detail: '#3690 <Zanghfei>.sound: +0x1C = 0xA000000', value: 0x0a000000 },
    wrongIds: 12,
    pathOnly: '7,674',
    ranges: 856 + 5252,
  },
  {
    file: MACDEMO.trueInfection,
    out: 'TrueInfectionV2.map',
    size: 162_786_612,
    crc: 0x45689d04,
    moved: { tagPath: 5283, tagData: 5282, reflexive: 14708, dataBlock: 3033, referencePath: 13209, bspReferencePath: 94, bspAddress: 1, bspHeader: 1, bspReflexive: 386, bspDataBlock: 81 },
    tolerated: 8,
    unusedWord: { tagIndex: 5282, detail: '#5282 <F*** You! I feel like being an asshole!.bitmap: +0x1C = 0x28000000', value: 0x28000000 },
    wrongIds: 8,
    pathOnly: '12,199',
    ranges: 0,
    // OpenCE refused the converted map: bitmap #3849 can't be drawn (PRD 2026-10-12); the row refuses it now.
    refusedBy: 'drawableBitmaps',
  },
];

for (const c of CONVERTING) {
  describe(`Phase 2 stage 2: ${c.file} ${c.refusedBy ? `rebases, then is refused by ${c.refusedBy}` : 'converts'} (protected mod; in memory)`, () => {
    const gate = skippableTest([c.file, MACDEMO_RES.bitmaps, MACDEMO_RES.sounds]);
    let source: Buffer;
    let sourceHash = '';
    let norm: DemoNormalization;

    beforeAll(() => {
      if (gate.skip) return;
      source = readSampleMap(c.file);
      sourceHash = sha256(source);
      const n = normalizeDemoMap(source);
      if (!n.ok) throw new Error(n.rows.map((r) => r.message).join(' '));
      norm = n.value;
    });

    it.skipIf(gate.skip)(`pointers moved per kind (same-reader) and the raw rebase check (independent)${gate.titleSuffix}`, () => {
      expect(norm.moved).toEqual(c.moved);
      expect(norm.tolerated).toHaveLength(c.tolerated);
      for (const t of norm.tolerated) {
        expect(t.kind).toBe('staleReferencePath');
        expect(t.where).toMatch(NETGAME_JUNK);
      }
      expectRawRebase(source, norm);
    });

    it.skipIf(gate.skip)(`pre-flight: converts with the script data repair; +0x1C info row; the path pointers protection left are one grouped line${gate.titleSuffix}`, () => {
      const report = withResources(MACDEMO_RES, (r) => preflightDemoConversion(source, r));
      expect(report.canConvert).toBe(!c.refusedBy);
      expect(report.checks.filter((k) => k.status === 'refuse').map((k) => k.id)).toEqual(c.refusedBy ? [c.refusedBy] : []);
      expect(report.repairs).toEqual([{ id: 'scriptSyntaxData', required: true, tagPath: expect.any(String), bytesAdded: 380_076 }]);
      expect(report.estimatedOutputSize).toBe(c.size);
      expect(report.checks.find((k) => k.id === 'entryFlags')?.status).toBe('pass');
      expect(report.checks.find((k) => k.id === 'entryUnusedWord')).toMatchObject({ status: 'info', details: [c.unusedWord.detail] });
      const refs = report.checks.find((k) => k.id === 'referenceIdentity')!;
      expect(refs.status).toBe('warn');
      expect(refs.details).toHaveLength(c.wrongIds);
      for (const d of refs.details) expect(d.split(':')[0]).toMatch(NETGAME_JUNK);
      expect(refs.message).toContain(`${c.pathOnly} references name the right tag ID but keep another path pointer`);
      expect(report.checks.find((k) => k.id === 'scripts')?.status).toBe('pass');
    });

    it.skipIf(gate.skip || !!c.refusedBy)(`converted and finalized as ${c.out}: ${c.size.toLocaleString('en-US')} bytes, CRC32 0x${c.crc.toString(16).toUpperCase()} (raw + node:zlib); +0x1C kept; source unchanged${gate.titleSuffix}`, () => {
      const converted = withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: false, resources: r, repairs: { scriptSyntaxData: true } }));
      expect(converted.repairs.map((r) => r.id)).toEqual(['scriptSyntaxData']);
      expect(converted.alignment).toBeNull();
      expect(converted.imported?.rangesCopied ?? 0).toBe(c.ranges);
      const out = finalizeForSave(converted.buffer, { fileName: c.out }).buffer;
      expect(out.length).toBe(c.size);
      expect(out.readUInt32LE(0x8)).toBe(c.size);
      expect(rawCrc(out)).toBe(c.crc);
      expect(out.readUInt32LE(0x64)).toBe(c.crc);
      const name = c.out.replace(/\.map$/, '');
      expect(out.subarray(0x20, 0x40).equals(Buffer.concat([Buffer.from(name), Buffer.alloc(32 - name.length)]))).toBe(true);
      // Decision A: the dummy tag's +0x1C word is kept (raw tag array read).
      expect(out.readUInt32LE(out.readUInt32LE(0x10) + 0x28 + c.unusedWord.tagIndex * 0x20 + 0x1c)).toBe(c.unusedWord.value);
      expect(inspectCustomEditionMap(out).status).toBe('ok'); // same-reader
      expect(sha256(source)).toBe(sourceHash);
    }, 300_000);

    it.skipIf(gate.skip || !c.refusedBy)(`the converter refuses it (${c.refusedBy ?? ''})${gate.titleSuffix}`, () => {
      expect(() => withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: false, resources: r, repairs: { scriptSyntaxData: true } }))).toThrow(ConversionRefusedError);
      expect(sha256(source)).toBe(sourceHash);
    }, 300_000);
  });
}

describe('Phase 2 stage 2: the mods that are refused, with their reasons', () => {
  const mgmGate = skippableTest([MACDEMO.mgm, MACDEMO_RES.bitmaps, MACDEMO_RES.sounds]);
  it.skipIf(mgmGate.skip)(`MGMWeaponCollab: refused for mixed alignment (decision B) and for 3 sound ranges past the end of the Mac demo's sounds.map${mgmGate.titleSuffix}`, () => {
    const source = readSampleMap(MACDEMO.mgm);
    const report = withResources(MACDEMO_RES, (r) => preflightDemoConversion(source, r));
    expect(report.canConvert).toBe(false);
    expect(report.checks.filter((k) => k.status === 'refuse').map((k) => k.id)).toEqual(['tagBlockAlignment', 'resourceFiles']);
    expect(report.checks.find((k) => k.id === 'tagBlockAlignment')!.details).toEqual([
      "The tag data's roots and blocks start at different remainders mod 4 (1, 3), so no single shift aligns them; a per-block re-layout is not supported.",
    ]);
    const files = report.checks.find((k) => k.id === 'resourceFiles')!.details;
    expect(files.slice(0, 2)).toEqual([
      'bitmaps.map: all 2306 ranges this map needs are entries of this file.',
      'sounds.map: 3 of 2894 ranges this map needs are not entries of this file, so it is not the sounds.map this map was built with.',
    ]);
    // Independent: those ranges start past the end of the stock file, so only the mod's own sounds.map can hold them.
    const offsets = files.slice(2).map((d) => Number(/offset (\d+)/.exec(d)![1]));
    expect(offsets).toEqual([90_783_640, 90_813_484, 90_838_684]);
    const soundsSize = fs.statSync(sampleMapPath(MACDEMO_RES.sounds)).size;
    expect(offsets.every((o) => o >= soundsSize)).toBe(true);
    expect(() =>
      withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: true, resources: r, repairs: { alignTagData: true, scriptSyntaxData: true } })),
    ).toThrow(ConversionRefusedError);
  });

  const paranoiaGate = skippableTest([MACDEMO.paranoia]);
  it.skipIf(paranoiaGate.skip)(`ParanoiaV2: refused, its BSP's collision bsp2d references count is 0xFFFFFFFF (decision C)${paranoiaGate.titleSuffix}`, () => {
    const source = readSampleMap(MACDEMO.paranoia);
    const report = preflightDemoConversion(source);
    expect(report.canConvert).toBe(false);
    expect(report.checks.map((k) => [k.id, k.status])).toEqual([
      ['demoLayout', 'pass'],
      ['demoRebase', 'refuse'],
    ]);
    expect(report.checks[1].message).toBe(
      "The tag data can't be moved: Tag \"levels\\test\\bloodgulch\\bloodgulch\" (scenario_structure_bsp) in the target map can't be read completely with this build's tag definitions (levels\\test\\bloodgulch\\bloodgulch.collision bsp[0].bsp2d references (4294967295 blocks) is outside the BSP data), so its pointers can't be moved safely.",
    );
    expect(() => convertDemoToCustomEdition(source, { acknowledgeScripts: true })).toThrow(ConversionRefusedError);
  });
});

describe('Phase 2 stage 2: MacDemo/ui.map (measure only; OpenCE uses its own ui.map)', () => {
  const gate = skippableTest([MACDEMO.ui, MACDEMO_RES.bitmaps, MACDEMO_RES.sounds]);
  it.skipIf(gate.skip)(`converts as ui_demo.map: 29,146,822 bytes, CRC32 0xCBABF9E8; raw rebase check${gate.titleSuffix}`, () => {
    const source = readSampleMap(MACDEMO.ui);
    const n = normalizeDemoMap(source);
    if (!n.ok) throw new Error('normalize failed');
    expect(n.value.moved).toEqual({ tagPath: 1411, tagData: 1410, reflexive: 1895, dataBlock: 2280, referencePath: 3301, bspReferencePath: 0, bspAddress: 1, bspHeader: 1, bspReflexive: 14, bspDataBlock: 1 });
    expectRawRebase(source, n.value);
    const converted = withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: false, resources: r }));
    const out = finalizeForSave(converted.buffer, { fileName: 'ui_demo.map' }).buffer;
    expect(out.length).toBe(29_146_822);
    expect(rawCrc(out)).toBe(0xcbabf9e8);
  }, 120_000);
});

/** b30 (36 MB in, 171 MB out) is not in the normal suite: it runs only with OPENCE_SLOW_TESTS=1. */
const SLOW = process.env.OPENCE_SLOW_TESTS === '1';
describe('Phase 2 stage 2: MacDemo/b30.map (measure only; two BSPs; scripts)', () => {
  const gate = skippableTest([MACDEMO.b30, MACDEMO_RES.bitmaps, MACDEMO_RES.sounds]);
  const skip = gate.skip || !SLOW;
  const suffix = gate.skip ? gate.titleSuffix : SLOW ? '' : ' [SKIPPED: slow test, set OPENCE_SLOW_TESTS=1 to run it]';
  it.skipIf(skip)(`converts as b30_demo.map: 170,964,588 bytes, CRC32 0x27DD7F80; raw rebase check over both BSPs${suffix}`, () => {
    const source = readSampleMap(MACDEMO.b30);
    const n = normalizeDemoMap(source);
    if (!n.ok) throw new Error('normalize failed');
    expect(n.value.moved).toEqual({ tagPath: 3696, tagData: 3694, reflexive: 11544, dataBlock: 8290, referencePath: 7744, bspReferencePath: 393, bspAddress: 2, bspHeader: 2, bspReflexive: 2064, bspDataBlock: 298 });
    expect(rawBspRegions(n.value.buffer)).toHaveLength(2);
    expectRawRebase(source, n.value);
    const report = withResources(MACDEMO_RES, (r) => preflightDemoConversion(source, r));
    expect(report.canConvert).toBe(true);
    expect(report.checks.find((k) => k.id === 'scripts')!.message).toMatch(/^1451 function call\(s\) of 122 function\(s\) and 1 engine global reference\(s\)/);
    const converted = withResources(MACDEMO_RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: false, resources: r }));
    const out = finalizeForSave(converted.buffer, { fileName: 'b30_demo.map' }).buffer;
    expect(out.length).toBe(170_964_588);
    expect(rawCrc(out)).toBe(0x27dd7f80);
  }, 600_000);
});
