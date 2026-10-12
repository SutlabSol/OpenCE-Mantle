import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { classifyMapLayout } from '../src/map/convert/classify';
import { convertDemoToCustomEdition, DEMO_TO_CE_DELTA, normalizeDemoMap, preflightDemoConversion, readDemoHeader } from '../src/map/convert/demo-to-ce';
import type { DemoNormalization } from '../src/map/convert/demo-to-ce';
import { ConversionRefusedError } from '../src/map/convert/retail-to-ce';
import { finalizeForSave } from '../src/map/finalize-map';
import { inspectCustomEditionMap } from '../src/map/open-map';
import { readSampleMap, sampleIn, sampleMapPath, skippableTest } from './helpers/sample-maps';
import { rawBspRegions, rawCrc } from './helpers/raw-map';
import { bytesOutside, CE_BASE, changedWords, DEMO_BASE, MACDEMO, MACDEMO_RES, rawDemo, sha256, TAG_SPACE, withResources } from './helpers/demo-map';

/**
 * Converter Phase 2 (true demo layout, version 6 -> Custom Edition 609), stage 1: the stock Mac demo
 * bloodgulch.map with the Mac demo's own bitmaps.map / sounds.map. Nothing is written to disk.
 *
 * Independent checks (raw byte offsets, node:zlib, and PC bloodgulch.map as ground truth, none of the
 * converter's walk): every word the rebase changed moved by exactly -0x0BAD0000; how many changed in the
 * tag data and in the BSP; every BSP-space word it changed now equals PC bloodgulch's; model data
 * untouched; the output's CRC (rawCrc) and size; the old prototype's CRC 0x46B6B108 when the 94 BSP
 * reference paths are put back. Same-reader: the per-kind counts (anchored by the prototype's own
 * per-kind numbers), the pre-flight rows and the read-back with the CE reader.
 */

const DEMO_BG = MACDEMO.bloodgulch;
const DEMO_UI = MACDEMO.ui;
const PC_BG = sampleIn('pc', 'bloodgulch.map');
const RES = MACDEMO_RES;
const HALOMD_RES = { bitmaps: sampleIn('haloMD', 'bitmaps.map'), sounds: sampleIn('haloMD', 'sounds.map') };
const MODS = [MACDEMO.mgm, MACDEMO.paranoia, MACDEMO.trueInfection, MACDEMO.zombiemod];

describe('Phase 2: MacDemo/bloodgulch.map with the Mac demo resource files (in memory)', () => {
  const gate = skippableTest([DEMO_BG, RES.bitmaps, RES.sounds]);
  let source: Buffer;
  let sourceHash = '';
  let norm: DemoNormalization;

  beforeAll(() => {
    if (gate.skip) return;
    source = readSampleMap(DEMO_BG);
    sourceHash = sha256(source);
    const n = normalizeDemoMap(source);
    if (!n.ok) throw new Error(n.rows.map((r) => r.message).join(' '));
    norm = n.value;
  });

  it.skipIf(gate.skip)(`is the true demo layout; the demo header reads as measured${gate.titleSuffix}`, () => {
    expect(classifyMapLayout(source)).toEqual({ kind: 'demo', version: 6 });
    expect(readDemoHeader(source)).toEqual({
      version: 6,
      scenarioType: 1,
      scenarioName: 'bloodgulch',
      buildString: '01.00.00.0576',
      crc32: 0xe7e08c22,
      fileSize: 14_459_752,
      tagDataOffset: 8_722_804,
      tagDataSize: 5_736_948,
    });
  });

  it.skipIf(gate.skip)(`the retail-layout copy has a clean standard header (raw bytes)${gate.titleSuffix}`, () => {
    const h = norm.buffer.subarray(0, 2048);
    const expected = Buffer.alloc(2048);
    expected.writeUInt32LE(0x68656164, 0x0);
    expected.writeUInt32LE(7, 0x4);
    expected.writeUInt32LE(14_459_752, 0x8);
    expected.writeUInt32LE(8_722_804, 0x10);
    expected.writeUInt32LE(5_736_948, 0x14);
    expected.write('bloodgulch', 0x20, 'ascii');
    expected.write('01.00.00.0576', 0x40, 'ascii');
    expected.writeUInt16LE(1, 0x60);
    expected.writeUInt32LE(0xe7e08c22, 0x64);
    expected.writeUInt32LE(0x666f6f74, 0x7fc);
    expect(h.equals(expected)).toBe(true);
    expect(norm.buffer.readUInt32LE(8_722_804)).toBe(CE_BASE + 0x28);
  });

  it.skipIf(gate.skip)(`pointers moved per kind (same-reader; the five tag-data kinds equal the old prototype's own counts)${gate.titleSuffix}`, () => {
    expect(norm.moved).toEqual({
      tagPath: 2410,
      tagData: 2409,
      reflexive: 6982,
      dataBlock: 2052,
      referencePath: 6918,
      bspReferencePath: 94,
      bspAddress: 1,
      bspHeader: 1,
      bspReflexive: 386,
      bspDataBlock: 81,
    });
    expect(norm.tolerated).toEqual([]);
    expect(DEMO_TO_CE_DELTA).toBe(-0x0bad0000);
  });

  it.skipIf(gate.skip)(`every changed word moved by exactly -0x0BAD0000 from the demo tag space; nothing else changed (raw)${gate.titleSuffix}`, () => {
    const { tdo, tds } = rawDemo(source);
    const out = norm.buffer;
    expect(out.length).toBe(source.length);
    const [bsp] = rawBspRegions(out);
    expect(bsp).toEqual({ start: 2048, size: 1_517_568 });
    const regions = [
      { name: 'BSP', start: bsp.start, end: bsp.start + bsp.size, words: 1 + 386 + 81 + 94 },
      { name: 'tag data', start: tdo, end: tdo + tds, words: 2410 + 2409 + 6982 + 2052 + 6918 + 1 /* bsp address */ + 1 /* array pointer */ },
    ];
    for (const r of regions) {
      const words = changedWords(source, out, r.start, r.end);
      expect(words.length, r.name).toBe(r.words);
      expect(bytesOutside(source, out, r.start, r.end, words), r.name).toBe(0);
      for (const at of words) {
        const before = source.readUInt32LE(at);
        expect(before >= DEMO_BASE && before < DEMO_BASE + TAG_SPACE, `${r.name} @${at}`).toBe(true);
        expect(out.readUInt32LE(at)).toBe((before + DEMO_TO_CE_DELTA) >>> 0);
      }
    }
    // Everything between the header and the end, outside BSP and tag data (model data), is untouched.
    expect(out.subarray(bsp.start + bsp.size, tdo).equals(source.subarray(bsp.start + bsp.size, tdo))).toBe(true);
  });

  const pcGate = skippableTest([DEMO_BG, RES.bitmaps, RES.sounds, PC_BG]);
  it.skipIf(pcGate.skip)(`ground truth: every BSP-space word the rebase changed now equals PC bloodgulch's; model data equals PC's${pcGate.titleSuffix}`, () => {
    const pc = readSampleMap(PC_BG);
    const out = norm.buffer;
    const [bsp] = rawBspRegions(out);
    expect(rawBspRegions(pc)).toEqual([bsp]);
    const words = changedWords(source, out, bsp.start, bsp.start + bsp.size);
    // BSP-space values (above the tag data) vs the 94 reference path pointers into the tag data,
    // told apart by value; PC's tag data is laid out differently (2408 tags), so its paths differ.
    const { tds } = rawDemo(source);
    const bspSpace = words.filter((at) => out.readUInt32LE(at) >= CE_BASE + tds);
    expect(bspSpace.length).toBe(1 + 386 + 81);
    expect(bspSpace.filter((at) => out.readUInt32LE(at) !== pc.readUInt32LE(at))).toEqual([]);
    expect(words.length - bspSpace.length).toBe(94);
    const model = (b: Buffer, td: number) => b.subarray(b.readUInt32LE(td + 0x14), b.readUInt32LE(td + 0x14) + b.readUInt32LE(td + 0x20));
    expect(model(out, rawDemo(source).tdo).equals(model(pc, pc.readUInt32LE(0x10)))).toBe(true);
  });

  it.skipIf(gate.skip)(`cross-check: with the 94 BSP reference paths put back, the CRC is the old prototype's 0x46B6B108 (raw + node:zlib)${gate.titleSuffix}`, () => {
    const copy = Buffer.from(norm.buffer);
    const [bsp] = rawBspRegions(copy);
    const { tds } = rawDemo(source);
    for (const at of changedWords(source, copy, bsp.start, bsp.start + bsp.size)) {
      if (copy.readUInt32LE(at) < CE_BASE + tds) copy.writeUInt32LE(source.readUInt32LE(at), at);
    }
    expect(rawCrc(copy)).toBe(0x46b6b108);
  });

  it.skipIf(gate.skip)(`pre-flight: every row passes with the Mac demo files; HaloMD's files fail the range check${gate.titleSuffix}`, () => {
    const report = withResources(RES, (r) => preflightDemoConversion(source, r));
    expect(report.canConvert).toBe(true);
    expect(report.requiresAcknowledgement).toBe(false);
    expect(Object.fromEntries(report.checks.map((c) => [c.id, c.status]))).toEqual({
      demoLayout: 'pass',
      demoRebase: 'pass',
      fileSize: 'pass',
      padding: 'pass',
      tagDataAddress: 'pass',
      entryFlags: 'pass',
      tagBlockAlignment: 'pass',
      tagDataExtents: 'pass',
      regions: 'pass',
      externalData: 'info',
      resourceFiles: 'pass',
      outputSize: 'info',
      modelParts: 'pass',
      scripts: 'pass',
      validation: 'pass',
      referenceIdentity: 'pass',
      requiredTags: 'pass',
      injectAfterwards: 'pass',
      scenarioName: 'info',
      tagFileChecksum: 'info',
    });
    expect(report.estimatedOutputSize).toBe(70_828_894);
    expect(report.externalData).toEqual({ bitmaps: { count: 676, bytes: 44_396_916 }, sounds: { count: 951, bytes: 11_972_226 } });
    expect(report.previousCrc32).toBe(0xe7e08c22);
  });

  const mdGate = skippableTest([DEMO_BG, HALOMD_RES.bitmaps, HALOMD_RES.sounds]);
  it.skipIf(mdGate.skip)(`HaloMD's bitmaps.map is refused by the range check (406 of 676 ranges are not its entries)${mdGate.titleSuffix}`, () => {
    const report = withResources(HALOMD_RES, (r) => preflightDemoConversion(source, r));
    expect(report.canConvert).toBe(false);
    const row = report.checks.find((c) => c.id === 'resourceFiles')!;
    expect(row.status).toBe('refuse');
    expect(row.details[0]).toBe('bitmaps.map: 406 of 676 ranges this map needs are not entries of this file, so it is not the bitmaps.map this map was built with.');
  });

  it.skipIf(gate.skip)(`converted and finalized as bloodgulch_demo.map: 70,828,894 bytes, CRC32 0x981B3317 (raw + node:zlib), CE 609; source unchanged${gate.titleSuffix}`, () => {
    const converted = withResources(RES, (r) => convertDemoToCustomEdition(source, { acknowledgeScripts: false, resources: r }));
    expect(converted.imported?.rangesCopied).toBe(1627);
    expect(converted.alignment).toBeNull();
    expect(converted.repairs).toEqual([]);
    const out = finalizeForSave(converted.buffer, { fileName: 'bloodgulch_demo.map' }).buffer;
    expect(out.length).toBe(70_828_894);
    expect(out.readUInt32LE(0x8)).toBe(70_828_894);
    expect(out.readUInt32LE(0x4)).toBe(609);
    expect(out.toString('ascii', 0x40, 0x4d)).toBe('01.00.00.0609');
    expect(out.subarray(0x20, 0x40).equals(Buffer.concat([Buffer.from('bloodgulch_demo'), Buffer.alloc(17)]))).toBe(true);
    expect(rawCrc(out)).toBe(0x981b3317);
    expect(out.readUInt32LE(0x64)).toBe(0x981b3317);
    // Same-reader: the CE reader accepts it.
    expect(inspectCustomEditionMap(out).status).toBe('ok');
    expect(sha256(source)).toBe(sourceHash);
  }, 120_000);
});

describe('Phase 2: refusals and the +0x1C word (synthetic changes to a copy of MacDemo/bloodgulch.map)', () => {
  const gate = skippableTest([DEMO_BG]);
  const mutate = (change: (b: Buffer) => void) => {
    const b = Buffer.from(readSampleMap(DEMO_BG));
    change(b);
    return b;
  };
  const cases: [string, (b: Buffer) => void, 'demoLayout' | 'demoRebase', RegExp][] = [
    ['cache version 7 in the demo header', (b) => b.writeUInt32LE(7, 0x588), 'demoLayout', /only version 6/],
    ['a file size that does not match', (b) => b.writeUInt32LE(b.length + 4, 0x5e8), 'demoLayout', /truncated or modified/],
    ['a tag array pointer that is not 0x4BF10028', (b) => b.writeUInt32LE(0x40440028, b.readUInt32LE(0x5ec)), 'demoLayout', /not 0x4BF10028/],
    ['a nonzero BSP header word at +0x8', (b) => b.writeUInt32LE(0x4d49d900, 2048 + 8), 'demoRebase', /BSP header word at \+0x8/],
  ];
  for (const [what, change, id, message] of cases) {
    it.skipIf(gate.skip)(`refuses ${what}${gate.titleSuffix}`, () => {
      const b = mutate(change);
      const report = preflightDemoConversion(b);
      expect(report.canConvert).toBe(false);
      expect(report.checks.find((c) => c.id === id)).toMatchObject({ status: 'refuse', message: expect.stringMatching(message) });
      expect(() => convertDemoToCustomEdition(b, { acknowledgeScripts: true })).toThrow(ConversionRefusedError);
    });
  }

  it.skipIf(gate.skip)(`a nonzero +0x1C word on the last tag is an info row naming it, and is left as it is${gate.titleSuffix}`, () => {
    const b = mutate((m) => m.writeUInt32LE(0x0a000000, m.readUInt32LE(0x5ec) + 0x28 + 2409 * 0x20 + 0x1c));
    const n = normalizeDemoMap(b);
    if (!n.ok) throw new Error('normalize failed');
    const report = preflightDemoConversion(b);
    expect(report.checks.find((c) => c.id === 'entryFlags')?.status).toBe('pass');
    const row = report.checks.find((c) => c.id === 'entryUnusedWord')!;
    expect(row.status).toBe('info');
    expect(row.details).toEqual(['#2409 sound\\sound environments\\mountains.sound_environment: +0x1C = 0xA000000']);
    expect(n.value.buffer.readUInt32LE(n.value.buffer.readUInt32LE(0x10) + 0x28 + 2409 * 0x20 + 0x1c)).toBe(0x0a000000);
  });

  const ceGate = skippableTest(['bloodgulch.map']);
  it.skipIf(ceGate.skip)(`refuses a Custom Edition map${ceGate.titleSuffix}`, () => {
    const ce = readSampleMap('bloodgulch.map');
    expect(preflightDemoConversion(ce).checks[0]).toMatchObject({ id: 'demoLayout', status: 'refuse' });
    expect(() => convertDemoToCustomEdition(ce, { acknowledgeScripts: true })).toThrow(ConversionRefusedError);
  });
});

describe('Phase 2: the internal name of the MacDemo mods (condition 1: up to the first 0, written zero-padded)', () => {
  for (const file of MODS) {
    const gate = skippableTest([file]);
    it.skipIf(gate.skip)(`${file}: header name "bloodgulch" with garbage after its 0; the copy's name field is clean${gate.titleSuffix}`, () => {
      const fd = fs.openSync(sampleMapPath(file), 'r');
      const head = Buffer.alloc(2048);
      fs.readSync(fd, head, 0, 2048, 0);
      fs.closeSync(fd);
      // Raw: the 32 bytes at 0x58C hold "bloodgulch", a 0, then non-zero garbage.
      const field = head.subarray(0x58c, 0x58c + 32);
      expect(field.subarray(0, 11).equals(Buffer.from('bloodgulch\0'))).toBe(true);
      expect(field.subarray(11).some((b) => b !== 0)).toBe(true);
      expect(readDemoHeader(head)?.scenarioName).toBe('bloodgulch');
    });
  }

  const zombie = MODS[3];
  const gate = skippableTest([zombie]);
  it.skipIf(gate.skip)(`${zombie}: the retail-layout copy's name field is "bloodgulch" and 22 zero bytes${gate.titleSuffix}`, () => {
    const n = normalizeDemoMap(readSampleMap(zombie));
    if (!n.ok) throw new Error(n.rows.map((r) => r.message).join(' '));
    expect(n.value.buffer.subarray(0x20, 0x40).equals(Buffer.concat([Buffer.from('bloodgulch'), Buffer.alloc(22)]))).toBe(true);
  });
});

describe('Phase 2: the script row on MacDemo/ui.map (its function numbers are the Mac demo\'s, not CE\'s)', () => {
  const gate = skippableTest([DEMO_UI]);
  /** Raw: the scenario's script node table and string data (offsets from the schema-free layout: tag 0's root, fields at 0x474 / 0x488). */
  const scriptTable = (b: Buffer) => {
    const tdo = b.readUInt32LE(0x10);
    const scenarioAt = tdo + (b.readUInt32LE(tdo + 0x28 + 0x14) - CE_BASE);
    return { table: tdo + (b.readUInt32LE(scenarioAt + 0x474 + 12) - CE_BASE), scenarioAt };
  };

  it.skipIf(gate.skip)(`passes: 23 calls of 3 functions, each named in the script strings; no acknowledgement${gate.titleSuffix}`, () => {
    const report = preflightDemoConversion(readSampleMap(DEMO_UI));
    const row = report.checks.find((c) => c.id === 'scripts')!;
    expect(row).toMatchObject({ status: 'pass', requiresAcknowledgement: false });
    expect(row.message).toMatch(/^23 function call\(s\) of 3 function\(s\) and 0 engine global reference\(s\)/);
    expect(row.details).toEqual(['begin: 1 call(s)', 'camera_set: 11 call(s)', 'sleep: 11 call(s)']);
  });

  it.skipIf(gate.skip)(`refuses when a call's first child is no longer a function name node${gate.titleSuffix}`, () => {
    const b = Buffer.from(readSampleMap(DEMO_UI));
    const n = normalizeDemoMap(b);
    if (!n.ok) throw new Error('normalize failed');
    // Find, in the copy, a call node (flags 8: not primitive, not a script call) and turn its first child into a value node.
    const { table } = scriptTable(n.value.buffer);
    const count = n.value.buffer.readUInt16LE(table + 0x2e);
    let call = -1;
    for (let i = 0; i < count && call < 0; i++) if (n.value.buffer.readUInt16LE(table + 56 + i * 20 + 6) === 8) call = i;
    expect(call).toBeGreaterThanOrEqual(0);
    const child = n.value.buffer.readUInt32LE(table + 56 + call * 20 + 16) & 0xffff;
    // The same node in the source file (same file offsets: the rebase moves no bytes).
    b.writeUInt16LE(7, table + 56 + child * 20 + 4);
    const row = preflightDemoConversion(b).checks.find((c) => c.id === 'scripts')!;
    expect(row.status).toBe('refuse');
    expect(row.details).toEqual([`script node ${call}: a function call whose first child (node ${child}) is not a function name with a readable name`]);
  });
});
