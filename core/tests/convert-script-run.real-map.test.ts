import { describe, expect, it } from 'vitest';
import { checkScriptsOpenCECanRun } from '../src/map/convert/script-run-check';
import { normalizeDemoMap } from '../src/map/convert/demo-to-ce';
import { preflightRetailConversion } from '../src/map/convert/retail-to-ce';
import { parseTagIndexForConversion } from '../src/map/convert/scenario-tag';
import { resolveStruct } from '../src/map/definitions/engine';
import { parseCacheFileHeader } from '../src/map/header';
import { readSampleMap, sampleIn, skippableTest } from './helpers/sample-maps';
import { MACDEMO } from './helpers/demo-map';

/**
 * The "Scripts OpenCE can run" row (`script-run-check.ts`; OpenCE hs_evaluate_begin_random). Independent:
 * `rawRandomCalls` finds begin_random calls and counts their arguments from raw bytes (node table at the
 * scenario's "script syntax data", names from "script string data"; only those two field offsets come
 * from the schema). Expected: HaloMD yoyorastv2_1 one call with exactly 32 (warn); every other sample map
 * none at 32 or more (pass). Mutations on a copy of yoyorastv2_1: 33 arguments and a chain that never
 * ends refuse; 31 passes.
 */

const YOYO = sampleIn('haloMD', 'yoyorastv2_1.map');
const SYNTAX = resolveStruct('Scenario').fields.find((f) => f.name === 'script syntax data')!.offset;
const STRINGS = resolveStruct('Scenario').fields.find((f) => f.name === 'script string data')!.offset;

interface RawTable {
  b: Buffer;
  table: number;
  count: number;
  node: (i: number) => number;
  name: (offset: number) => string;
}

function rawTable(b: Buffer): RawTable | null {
  const demo = b.readUInt32LE(0x2c0) === 0x45686564;
  const tdo = demo ? b.readUInt32LE(0x5ec) : b.readUInt32LE(0x10);
  const base = demo ? 0x4bf10000 : 0x40440000;
  const at = (p: number) => tdo + (p - base);
  const scenarioId = b.readUInt32LE(tdo + 4);
  const scenario = at(b.readUInt32LE(tdo + 0x28 + (scenarioId & 0xffff) * 0x20 + 0x14));
  if (b.readUInt32LE(scenario + SYNTAX) === 0) return null;
  const table = at(b.readUInt32LE(scenario + SYNTAX + 12));
  const strings = at(b.readUInt32LE(scenario + STRINGS + 12));
  return { b, table, count: b.readInt16LE(table + 0x2e), node: (i) => table + 0x38 + i * 20, name: (o) => b.toString('latin1', strings + o, b.indexOf(0, strings + o)) };
}

/** Every begin_random call: its node and argument nodes (null when the chain does not end). */
function rawRandomCalls(t: RawTable): { node: number; args: number[] | null }[] {
  const { b, count, node, name } = t;
  const out: { node: number; args: number[] | null }[] = [];
  for (let i = 0; i < count; i++) {
    const n = node(i);
    if (b.readUInt16LE(n) === 0 || b.readUInt16LE(n + 6) & 3) continue;
    const child = b.readUInt32LE(n + 16) & 0xffff;
    if (child >= count || name(b.readInt32LE(node(child) + 12)) !== 'begin_random') continue;
    const args: number[] = [];
    let next = b.readUInt32LE(node(child) + 8);
    while (next !== 0xffffffff && args.length <= count) {
      args.push(next & 0xffff);
      next = b.readUInt32LE(node(next & 0xffff) + 8);
    }
    out.push({ node: i, args: args.length > count ? null : args });
  }
  return out;
}

/** The map as the CE reader takes it (retail: version 609; demo: the rebased copy). */
function readable(b: Buffer): Buffer {
  if (b.readUInt32LE(0x2c0) === 0x45686564) {
    const n = normalizeDemoMap(b);
    if (!n.ok) throw new Error('normalize failed');
    n.value.buffer.writeUInt32LE(609, 4);
    return n.value.buffer;
  }
  const v = Buffer.from(b);
  if (v.readUInt32LE(4) !== 609) v.writeUInt32LE(609, 4);
  return v;
}

const run = (b: Buffer) => {
  const v = readable(b);
  const h = parseCacheFileHeader(v);
  return checkScriptsOpenCECanRun(v, h, parseTagIndexForConversion(v, h));
};

const MAPS: [string, number][] = [
  ['coldsnap.map', 0],
  ['ui.map', 0],
  [sampleIn('pc', 'b30.map'), 0],
  [sampleIn('haloMD', 'b30.map'), 0],
  [sampleIn('haloMD', 'heh_2.map'), 0],
  [sampleIn('haloMD', 'barrier.map'), 0],
  [MACDEMO.ui, 0],
  [MACDEMO.b30, 0],
  [YOYO, 1],
];

describe('Scripts OpenCE can run: the sample maps (independent raw count)', () => {
  for (const [file, warnings] of MAPS) {
    const gate = skippableTest([file]);
    it.skipIf(gate.skip)(`${file}: ${warnings} begin_random call(s) at 32 arguments, none above${gate.titleSuffix}`, () => {
      const source = readSampleMap(file);
      const raw = rawTable(source);
      const rawCalls = raw ? rawRandomCalls(raw) : [];
      const report = run(source);
      expect(report.randomCalls).toBe(rawCalls.length);
      const rawAt32 = rawCalls.filter((c) => c.args && c.args.length === 32).map((c) => c.node);
      expect(rawCalls.filter((c) => !c.args || c.args.length > 32)).toEqual([]);
      expect(report.findings.map((f) => f.node)).toEqual(rawAt32);
      expect(report.findings).toHaveLength(warnings);
      expect(report.findings.every((f) => f.severity === 'warn')).toBe(true);
    }, 300_000);
  }
});

describe('Scripts OpenCE can run: the row on yoyorastv2_1, and mutations of its begin_random', () => {
  const gate = skippableTest([YOYO]);
  const call = (b: Buffer) => {
    const t = rawTable(b)!;
    const [c] = rawRandomCalls(t);
    return { t, call: c };
  };

  it.skipIf(gate.skip)(`as it is: a warning naming the script, the node and the reason; the map still converts${gate.titleSuffix}`, () => {
    const source = readSampleMap(YOYO);
    const row = preflightRetailConversion(source).checks.find((c) => c.id === 'scriptsRun')!;
    expect(row.status).toBe('warn');
    expect(row.message).toMatch(/release build logs the assertion and carries on; a debug build halts there/);
    expect(row.details).toEqual(['script "randomize teleport", node 1986: begin_random with 32 arguments; OpenCE asserts fewer than 32 (they still fit its 32 bits)']);
    expect(row.requiresAcknowledgement).toBe(false);
  });

  it.skipIf(gate.skip)(`33 arguments (the last one linked to another node that ends a chain) refuse${gate.titleSuffix}`, () => {
    const b = Buffer.from(readSampleMap(YOYO));
    const { t, call: c } = call(b);
    const args = c.args!;
    const inChain = new Set(args);
    // a used node outside this chain whose next is NONE
    let extra = -1;
    for (let i = 0; i < t.count && extra < 0; i++) if (!inChain.has(i) && i !== c.node && b.readUInt16LE(t.node(i)) !== 0 && b.readUInt32LE(t.node(i) + 8) === 0xffffffff) extra = i;
    const last = t.node(args[args.length - 1]);
    b.writeUInt32LE(((b.readUInt16LE(t.node(extra)) << 16) | extra) >>> 0, last + 8);
    expect(rawRandomCalls(rawTable(b)!)[0].args!.length).toBe(33);
    const report = run(b);
    expect(report.findings).toMatchObject([{ node: 1986, severity: 'refuse', argumentCount: 33 }]);
    const row = preflightRetailConversion(b).checks.find((x) => x.id === 'scriptsRun')!;
    expect(row.status).toBe('refuse');
    expect(row.details[0]).toBe('script "randomize teleport", node 1986: begin_random with 33 arguments; OpenCE keeps one bit per argument in 32 bits, so more than 32 overrun its memory');
  });

  it.skipIf(gate.skip)(`an argument chain that loops back refuses${gate.titleSuffix}`, () => {
    const b = Buffer.from(readSampleMap(YOYO));
    const { t, call: c } = call(b);
    const first = c.args![0];
    b.writeUInt32LE(((b.readUInt16LE(t.node(first)) << 16) | first) >>> 0, t.node(c.args![31]) + 8);
    const report = run(b);
    expect(report.findings).toMatchObject([{ node: 1986, severity: 'refuse', argumentCount: null }]);
  });

  it.skipIf(gate.skip)(`31 arguments (the chain cut after the 31st) pass${gate.titleSuffix}`, () => {
    const b = Buffer.from(readSampleMap(YOYO));
    const { t, call: c } = call(b);
    b.writeUInt32LE(0xffffffff, t.node(c.args![30]) + 8);
    expect(run(b).findings).toEqual([]);
    expect(preflightRetailConversion(b).checks.find((x) => x.id === 'scriptsRun')!.status).toBe('pass');
  });
});
